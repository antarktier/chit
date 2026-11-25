// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IQorePQC, PQC_VERIFY, PQC_KEY_STATUS} from "../../src/interfaces/IQorePQC.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
    function chainId(uint256 newChainId) external;
    function warp(uint256 newTimestamp) external;
    function etch(address target, bytes calldata code) external;
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function parseUint(string calldata value) external pure returns (uint256);
    function expectRevert(bytes calldata revertData) external;
    function expectPartialRevert(bytes4 selector) external;
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function parseJsonBytesArray(string calldata json, string calldata key) external pure returns (bytes[] memory);
}

contract MockQorePQC is IQorePQC {
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

    // Test-only signature binding. The chain precompile performs ML-DSA-87 verification.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return keccak256(signature) == keccak256(abi.encodePacked(keccak256(abi.encode(pubkey, message))));
    }
}

abstract contract QorePQCMockTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function installQorePQCMocks() internal returns (MockQorePQC) {
        bytes memory code = address(new MockQorePQC()).code;
        vm.etch(PQC_VERIFY, code);
        vm.etch(PQC_KEY_STATUS, code);
        return MockQorePQC(PQC_KEY_STATUS);
    }
}
