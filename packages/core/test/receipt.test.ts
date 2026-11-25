import { mldsa87 } from "@qorechain/pqc";
import { expect, test } from "vite-plus/test";
import {
  buildReceipt,
  fromBech32,
  generateReference,
  hashDetails,
  memoForRequest,
  NATIVE_ASSET,
  nativePaymentEvents,
  reconcile,
  requestId,
  serializeRequest,
  signReceipt,
  toBech32,
  verifyReceiptAttestation,
  type CosmosTxResponse,
  type PaymentRequest,
} from "../src/index";

const request: PaymentRequest = {
  merchant: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  recipient: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  asset: NATIVE_ASSET,
  amount: 2_000_000_000_000_000_000n,
  expiresAt: 4_000_000_000n,
  reference: generateReference(),
  detailsHash: hashDetails("Coffee beans"),
  partialAllowed: true,
  payContract: "0x1111111111111111111111111111111111111111",
  chainId: 9800n,
};
const id = requestId(request);

function tx(over: Partial<CosmosTxResponse> = {}, memo = memoForRequest(id)): CosmosTxResponse {
  return {
    txhash: "AB".repeat(32),
    height: "100",
    code: 0,
    timestamp: "2026-11-25T12:00:00Z",
    tx: {
      body: {
        memo,
        messages: [
          {
            "@type": "/cosmos.bank.v1beta1.MsgSend",
            from_address: toBech32("0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF"),
            to_address: toBech32(request.recipient),
            amount: [{ denom: "uqor", amount: "2000000" }],
          },
        ],
      },
    },
    ...over,
  };
}

test("bech32 and EVM addresses are the same unified account", () => {
  expect(fromBech32(toBech32(request.recipient))).toBe(request.recipient);
});

test("native memo sends become payment events in wei; failed or unrelated txs are ignored", () => {
  const [e] = nativePaymentEvents(tx());
  expect(e?.amount).toBe(2_000_000_000_000_000_000n);
  expect(e?.recipient).toBe(request.recipient);
  expect(e?.txHash).toBe(`0x${"ab".repeat(32)}`);
  expect(nativePaymentEvents(tx({ code: 5 }))).toHaveLength(0);
  expect(nativePaymentEvents(tx({}, "thanks"))).toHaveLength(0);
});

test("receipts are attested with ML-DSA-87 and any edit breaks the attestation", () => {
  const rec = reconcile(id, request, nativePaymentEvents(tx()), {
    now: 1n,
    headHeight: 200n,
    minConfirmations: 1n,
  });
  expect(rec.status).toBe("completed");
  const key = mldsa87.keygen(new Uint8Array(32).fill(9));
  const signed = signReceipt(
    buildReceipt(serializeRequest(request), { sig: "x" }, rec, new Date(0)),
    key,
  );
  const trusted = signed.attestationKey;
  expect(verifyReceiptAttestation(signed, trusted)).toBe(true);
  expect(
    verifyReceiptAttestation({ ...signed, receipt: { ...signed.receipt, paid: "1" } }, trusted),
  ).toBe(false);
  const other = mldsa87.keygen(new Uint8Array(32).fill(10));
  expect(
    verifyReceiptAttestation(signed, `0x${Buffer.from(other.publicKey).toString("hex")}`),
  ).toBe(false);
});
