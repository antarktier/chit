// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ChitPay} from "../src/ChitPay.sol";
import {MockQorePQC, QorePQCMockTest} from "./mocks/MockQorePQC.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// Uses the clearly labelled test-only PQC mock; on Diana the real ML-DSA-87 precompile runs.
contract ChitPayTest is QorePQCMockTest {
    ChitPay private pay;
    MockQorePQC private keys;
    MockERC20 private token;
    bytes private constant PUBKEY = hex"c0ffee";
    address private constant MERCHANT = address(0xA11CE);
    address private constant RECIPIENT = address(0xB0B);
    address private constant PAYER = address(0xCAFE);

    function setUp() public {
        keys = installQorePQCMocks();
        keys.setKeyStatus(MERCHANT, MockQorePQC.KeyStatus(true, 1, PUBKEY, true));
        pay = new ChitPay();
        token = new MockERC20();
        vm.chainId(9800);
        vm.warp(1_000);
        vm.deal(PAYER, 100 ether);
    }

    function _req(address asset, uint256 amount, bool partialAllowed, bytes32 ref)
        private
        view
        returns (ChitPay.PaymentRequest memory)
    {
        return ChitPay.PaymentRequest({
            merchant: MERCHANT,
            recipient: RECIPIENT,
            asset: asset,
            amount: amount,
            expiresAt: 2_000,
            paymentRef: ref,
            detailsHash: keccak256("invoice"),
            partialAllowed: partialAllowed,
            payContract: address(pay),
            chainId: 9800
        });
    }

    function _sig(ChitPay.PaymentRequest memory r) private pure returns (bytes memory) {
        bytes memory message = abi.encodePacked("qorechain-msg-v1|qorechain-diana|", abi.encode("CHIT_REQUEST_V1", r));
        return abi.encodePacked(keccak256(abi.encode(PUBKEY, message)));
    }

    function test_nativeFullPaymentGoesStraightToRecipient() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, false, "CH-REF-1");
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(r, _sig(r));
        assert(RECIPIENT.balance == 1 ether);
        assert(address(pay).balance == 0);
        assert(pay.paid(pay.requestId(r)) == 1 ether);
        assert(pay.authenticated(pay.requestId(r)));
    }

    function test_partialPaymentsThenSettledRejectsDuplicate() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, true, "CH-REF-2");
        vm.prank(PAYER);
        pay.payNative{value: 0.4 ether}(r, _sig(r));
        vm.prank(PAYER);
        pay.payNative{value: 0.6 ether}(r, "");
        assert(pay.outstanding(r) == 0);
        vm.expectRevert(abi.encodeWithSelector(ChitPay.AlreadySettled.selector));
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(r, "");
    }

    function test_rejectsOverpayment() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, true, "CH-REF-3");
        vm.expectRevert(abi.encodeWithSelector(ChitPay.ExceedsOutstanding.selector, 1 ether));
        vm.prank(PAYER);
        pay.payNative{value: 2 ether}(r, _sig(r));
    }

    function test_rejectsPartialWhenNotAllowed() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, false, "CH-REF-4");
        vm.expectRevert(abi.encodeWithSelector(ChitPay.PartialNotAllowed.selector));
        vm.prank(PAYER);
        pay.payNative{value: 0.5 ether}(r, _sig(r));
    }

    function test_rejectsTamperedRecipientOrAmount() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, false, "CH-REF-5");
        bytes memory sig = _sig(r);
        r.recipient = PAYER;
        vm.expectRevert(abi.encodeWithSelector(ChitPay.InvalidSignature.selector));
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(r, sig);
        r.recipient = RECIPIENT;
        r.amount = 0.5 ether;
        vm.expectRevert(abi.encodeWithSelector(ChitPay.InvalidSignature.selector));
        vm.prank(PAYER);
        pay.payNative{value: 0.5 ether}(r, sig);
    }

    function test_rejectsExpiredAndWrongDomain() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, false, "CH-REF-6");
        vm.warp(2_001);
        vm.expectRevert(abi.encodeWithSelector(ChitPay.Expired.selector));
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(r, _sig(r));
        vm.warp(1_000);
        r.chainId = 1;
        vm.expectRevert(abi.encodeWithSelector(ChitPay.WrongDomain.selector));
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(r, _sig(r));
    }

    function test_partialPaymentAtExpiryCannotBeCompletedAfterExpiry() public {
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, true, "CH-REF-DEADLINE");
        vm.warp(r.expiresAt);
        vm.prank(PAYER);
        pay.payNative{value: 0.4 ether}(r, _sig(r));

        vm.warp(r.expiresAt + 1);
        vm.expectRevert(abi.encodeWithSelector(ChitPay.Expired.selector));
        vm.prank(PAYER);
        pay.payNative{value: 0.6 ether}(r, "");

        assert(pay.outstanding(r) == 0.6 ether);
        assert(RECIPIENT.balance == 0.4 ether);
    }

    function test_rejectsUnprovenMerchantKey() public {
        keys.setKeyStatus(MERCHANT, MockQorePQC.KeyStatus(true, 1, PUBKEY, false));
        ChitPay.PaymentRequest memory r = _req(address(0), 1 ether, false, "CH-REF-7");
        vm.expectRevert(abi.encodeWithSelector(ChitPay.PqcKeyNotProven.selector));
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(r, _sig(r));
    }

    function test_referenceCannotBeReusedForAnotherRequest() public {
        ChitPay.PaymentRequest memory a = _req(address(0), 1 ether, false, "CH-REF-8");
        vm.prank(PAYER);
        pay.payNative{value: 1 ether}(a, _sig(a));
        ChitPay.PaymentRequest memory b = _req(address(0), 2 ether, false, "CH-REF-8");
        vm.expectRevert(abi.encodeWithSelector(ChitPay.ReferenceReused.selector));
        vm.prank(PAYER);
        pay.payNative{value: 2 ether}(b, _sig(b));
    }

    function test_tokenPaymentAndFeeOnTransferRejected() public {
        ChitPay.PaymentRequest memory r = _req(address(token), 100, true, "CH-REF-9");
        token.mint(PAYER, 1_000);
        vm.prank(PAYER);
        token.approve(address(pay), 1_000);
        vm.prank(PAYER);
        pay.payToken(r, _sig(r), 60);
        assert(token.balanceOf(RECIPIENT) == 60);
        token.setBehavior(MockERC20.Behavior.Fee);
        vm.expectRevert(abi.encodeWithSelector(ChitPay.TransferFailed.selector));
        vm.prank(PAYER);
        pay.payToken(r, "", 40);
    }

    function test_rejectsWrongAssetEntryPoints() public {
        ChitPay.PaymentRequest memory r = _req(address(token), 100, true, "CH-REF-10");
        vm.expectRevert(abi.encodeWithSelector(ChitPay.WrongValue.selector));
        vm.prank(PAYER);
        pay.payNative{value: 100}(r, _sig(r));
    }
}
