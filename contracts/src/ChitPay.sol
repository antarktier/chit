// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IQorePQC, PQC_VERIFY, PQC_KEY_STATUS, ML_DSA_87} from "./interfaces/IQorePQC.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title ChitPay
/// @notice Non-custodial, reference-aware payment router. A payment is accepted only for a
///         request whose every field is bound by the merchant's registered ML-DSA-87 key
///         (verified on-chain through QoreChain's pqcVerify precompile). Funds go straight
///         from payer to recipient in the same call; this contract never holds a balance.
contract ChitPay {
    string internal constant TYPE_TAG = "CHIT_REQUEST_V1";
    string internal constant MESSAGE_PREFIX = "qorechain-msg-v1|qorechain-diana|";

    struct PaymentRequest {
        address merchant;
        address recipient;
        address asset; // address(0) = native QOR
        uint256 amount;
        uint64 expiresAt;
        bytes32 paymentRef;
        bytes32 detailsHash;
        bool partialAllowed;
        address payContract;
        uint256 chainId;
    }

    /// @notice Cumulative amount paid per request ID.
    mapping(bytes32 => uint256) public paid;
    /// @notice True once the merchant signature for a request has been verified on-chain.
    mapping(bytes32 => bool) public authenticated;
    /// @notice Reference -> request ID, so a reference can never be reused for a different request.
    mapping(address => mapping(bytes32 => bytes32)) public requestOfReference;

    uint256 private locked = 1;

    event RequestAuthenticated(bytes32 indexed requestId, address indexed merchant, bytes32 indexed paymentRef);
    event PaymentReceived(
        bytes32 indexed requestId,
        bytes32 indexed paymentRef,
        address indexed payer,
        address recipient,
        address asset,
        uint256 amount,
        uint256 totalPaid
    );

    error WrongDomain();
    error Expired();
    error InvalidSignature();
    error PqcPrecompileUnavailable(address precompile);
    error PqcKeyNotProven();
    error UnsupportedPqcAlgorithm();
    error ZeroAmount();
    error AlreadySettled();
    error ExceedsOutstanding(uint256 outstanding);
    error PartialNotAllowed();
    error ReferenceReused();
    error WrongValue();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    function requestId(PaymentRequest calldata req) public pure returns (bytes32) {
        return keccak256(abi.encode(TYPE_TAG, req));
    }

    function requestMessage(PaymentRequest calldata req) public pure returns (bytes memory) {
        return abi.encodePacked(MESSAGE_PREFIX, abi.encode(TYPE_TAG, req));
    }

    function outstanding(PaymentRequest calldata req) external view returns (uint256) {
        uint256 p = paid[requestId(req)];
        return p >= req.amount ? 0 : req.amount - p;
    }

    /// @notice Pay a native-QOR request. `msg.value` is the amount. `pqSignature` (4627 bytes) is
    ///         required on the first payment for a request and may be empty afterwards.
    function payNative(PaymentRequest calldata req, bytes calldata pqSignature) external payable nonReentrant {
        if (req.asset != address(0)) revert WrongValue();
        bytes32 id = _accept(req, pqSignature, msg.value);
        // Effects and the log precede the transfer (checks-effects-interactions); a failed transfer reverts all.
        emit PaymentReceived(id, req.paymentRef, msg.sender, req.recipient, address(0), msg.value, paid[id]);
        (bool ok,) = req.recipient.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Pay an ERC-20 request. The payer must approve this contract for `amount` first.
    function payToken(PaymentRequest calldata req, bytes calldata pqSignature, uint256 amount) external nonReentrant {
        if (req.asset == address(0)) revert WrongValue();
        bytes32 id = _accept(req, pqSignature, amount);
        emit PaymentReceived(id, req.paymentRef, msg.sender, req.recipient, req.asset, amount, paid[id]);
        IERC20Minimal token = IERC20Minimal(req.asset);
        uint256 before = token.balanceOf(req.recipient);
        (bool ok, bytes memory ret) =
            req.asset.call(abi.encodeCall(IERC20Minimal.transferFrom, (msg.sender, req.recipient, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        if (token.balanceOf(req.recipient) - before != amount) revert TransferFailed();
    }

    function _accept(PaymentRequest calldata req, bytes calldata pqSignature, uint256 amount)
        private
        returns (bytes32 id)
    {
        if (req.payContract != address(this) || req.chainId != block.chainid) revert WrongDomain();
        if (block.timestamp > req.expiresAt) revert Expired();
        if (amount == 0) revert ZeroAmount();
        id = requestId(req);
        if (!authenticated[id]) {
            bytes32 existing = requestOfReference[req.merchant][req.paymentRef];
            if (existing != bytes32(0) && existing != id) revert ReferenceReused();
            if (!_verify(req.merchant, pqSignature, requestMessage(req))) revert InvalidSignature();
            authenticated[id] = true;
            requestOfReference[req.merchant][req.paymentRef] = id;
            emit RequestAuthenticated(id, req.merchant, req.paymentRef);
        }
        uint256 already = paid[id];
        if (already >= req.amount) revert AlreadySettled();
        uint256 remaining = req.amount - already;
        if (amount > remaining) revert ExceedsOutstanding(remaining);
        if (!req.partialAllowed && amount != remaining) revert PartialNotAllowed();
        paid[id] = already + amount;
    }

    function _verify(address merchant, bytes calldata signature, bytes memory message) private view returns (bool) {
        (bool ok, bytes memory result) = PQC_KEY_STATUS.staticcall(abi.encodeCall(IQorePQC.pqcKeyStatus, (merchant)));
        if (!ok || result.length < 160) revert PqcPrecompileUnavailable(PQC_KEY_STATUS);
        (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven) =
            abi.decode(result, (bool, uint8, bytes, bool));
        if (!registered || !possessionProven) revert PqcKeyNotProven();
        if (algorithmId != ML_DSA_87) revert UnsupportedPqcAlgorithm();
        (ok, result) = PQC_VERIFY.staticcall(abi.encodeCall(IQorePQC.pqcVerify, (pubkey, signature, message)));
        if (!ok || result.length != 32) revert PqcPrecompileUnavailable(PQC_VERIFY);
        return abi.decode(result, (bool));
    }

    receive() external payable {
        revert WrongValue();
    }
}
