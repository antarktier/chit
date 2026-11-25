// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IQorePQC} from "../../src/interfaces/IQorePQC.sol";

/// @notice TEST-ONLY stand-in for QoreChain's PQC precompiles on a local Anvil devnet (used by
///         scripts/devnet.ts for end-to-end UI tests). It cannot run ML-DSA-87, so pqcVerify only
///         checks that the key is registered and the signature has the ML-DSA-87 length (4627 B).
///         The Chit service still verifies every request signature with real ML-DSA-87 off-chain,
///         and on Diana the real precompile performs full verification. Never deploy to a real chain.
contract DevnetQorePQC is IQorePQC {
    struct KeyStatus {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    mapping(address => KeyStatus) private keys;

    function setKeyStatus(address account, KeyStatus calldata status) external {
        keys[account] = status;
    }

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven)
    {
        KeyStatus storage status = keys[account];
        return (status.registered, status.algorithmId, status.pubkey, status.possessionProven);
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata) external view returns (bool) {
        return signature.length == 4627 && pubkey.length == 2592;
    }
}
