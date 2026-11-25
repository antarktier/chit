// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ChitPay} from "../src/ChitPay.sol";
import {QorePQCMockTest} from "./mocks/MockQorePQC.sol";

/// Asserts that ChitPay hashes and signs exactly the bytes the TypeScript core package produces.
contract EncodingTest is QorePQCMockTest {
    function test_matchesTypeScriptEncoding() public {
        ChitPay pay = new ChitPay();
        string memory f = vm.readFile("contracts/test/fixtures/request.json");
        ChitPay.PaymentRequest memory r = ChitPay.PaymentRequest({
            merchant: vm.parseJsonAddress(f, ".request.merchant"),
            recipient: vm.parseJsonAddress(f, ".request.recipient"),
            asset: vm.parseJsonAddress(f, ".request.asset"),
            amount: vm.parseUint(vm.parseJsonString(f, ".request.amount")),
            expiresAt: uint64(vm.parseUint(vm.parseJsonString(f, ".request.expiresAt"))),
            paymentRef: bytes32(vm.parseJsonBytes(f, ".request.paymentRef")),
            detailsHash: bytes32(vm.parseJsonBytes(f, ".request.detailsHash")),
            partialAllowed: true,
            payContract: vm.parseJsonAddress(f, ".request.payContract"),
            chainId: vm.parseUint(vm.parseJsonString(f, ".request.chainId"))
        });
        assert(keccak256(pay.requestMessage(r)) == keccak256(vm.parseJsonBytes(f, ".message")));
        assert(pay.requestId(r) == bytes32(vm.parseJsonBytes(f, ".requestId")));
    }
}
