import { expect, test } from "vite-plus/test";
import {
  generateReference,
  hashDetails,
  isTransitionAllowed,
  memoForRequest,
  NATIVE_ASSET,
  reconcile,
  requestId,
  requestIdFromMemo,
  type PaymentEvent,
  type PaymentRequest,
} from "../src/index";

const request: PaymentRequest = {
  merchant: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  recipient: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  asset: NATIVE_ASSET,
  amount: 100n,
  expiresAt: 1_000n,
  reference: generateReference(),
  detailsHash: hashDetails("x"),
  partialAllowed: true,
  payContract: "0x1111111111111111111111111111111111111111",
  chainId: 9800n,
};
const id = requestId(request);
const opts = { now: 500n, headHeight: 100n, minConfirmations: 2n };

function ev(over: Partial<PaymentEvent>): PaymentEvent {
  return {
    source: "evm",
    txHash: `0x${"a".repeat(64)}`,
    index: 0,
    blockHeight: 10n,
    blockTime: 400n,
    requestId: id,
    payer: "0x2222222222222222222222222222222222222222",
    recipient: request.recipient,
    asset: request.asset,
    amount: 100n,
    ...over,
  };
}

test("unpaid, partial, completed", () => {
  expect(reconcile(id, request, [], opts).status).toBe("unpaid");
  const partial = reconcile(id, request, [ev({ amount: 40n })], opts);
  expect(partial.status).toBe("partially_paid");
  expect(partial.outstanding).toBe(60n);
  const done = reconcile(id, request, [ev({ amount: 40n }), ev({ amount: 60n, index: 1 })], opts);
  expect(done.status).toBe("completed");
  expect(done.completedAt?.blockHeight).toBe(10n);
});

test("re-processing the same event is idempotent", () => {
  const e = ev({ amount: 40n });
  const r = reconcile(
    id,
    request,
    [e, e, { ...e, txHash: e.txHash.toString().toUpperCase() }],
    opts,
  );
  expect(r.paid).toBe(40n);
  expect(r.events).toHaveLength(1);
});

test("a second full payment is flagged duplicate and marks the request overpaid", () => {
  const r = reconcile(
    id,
    request,
    [ev({}), ev({ txHash: `0x${"b".repeat(64)}`, blockHeight: 11n })],
    opts,
  );
  expect(r.status).toBe("overpaid");
  expect(r.overpaidBy).toBe(100n);
  expect(r.events.map((e) => e.class)).toEqual(["counted", "duplicate"]);
});

test("unconfirmed events stay pending and do not count", () => {
  const r = reconcile(id, request, [ev({ blockHeight: 100n })], opts);
  expect(r.status).toBe("unpaid");
  expect(r.pending).toBe(100n);
});

test("expiry, late payments and mismatched recipient/asset", () => {
  const late = reconcile(id, request, [ev({ blockTime: 1_001n })], { ...opts, now: 2_000n });
  expect(late.status).toBe("expired");
  expect(late.unattributed).toBe(100n);
  const wrong = reconcile(
    id,
    request,
    [
      ev({ recipient: "0x3333333333333333333333333333333333333333" }),
      ev({ index: 1, asset: "0x4444444444444444444444444444444444444444" }),
    ],
    opts,
  );
  expect(wrong.events.map((e) => e.class)).toEqual(["wrong_recipient", "wrong_asset"]);
  expect(wrong.status).toBe("unpaid");
});

test("partial payments are refused when the request disallows them", () => {
  const r = reconcile(id, { ...request, partialAllowed: false }, [ev({ amount: 40n })], opts);
  expect(r.events[0]?.class).toBe("partial_not_allowed");
  expect(r.paid).toBe(0n);
});

test("events for other requests are ignored", () => {
  const r = reconcile(id, request, [ev({ requestId: `0x${"c".repeat(64)}` })], opts);
  expect(r.events).toHaveLength(0);
});

test("state transitions and memo binding", () => {
  expect(isTransitionAllowed("unpaid", "completed")).toBe(true);
  expect(isTransitionAllowed("completed", "unpaid")).toBe(false);
  expect(isTransitionAllowed("expired", "completed")).toBe(false);
  expect(requestIdFromMemo(memoForRequest(id))).toBe(id.toLowerCase());
  expect(requestIdFromMemo("hello")).toBeUndefined();
});
