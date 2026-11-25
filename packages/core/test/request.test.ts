import { mldsa87 } from "@qorechain/pqc";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { hexToBytes } from "viem";
import { expect, test } from "vite-plus/test";
import {
  deserializeRequest,
  generateReference,
  hashDetails,
  isValidReference,
  NATIVE_ASSET,
  referenceFromBytes32,
  referenceToBytes32,
  requestId,
  requestMessageBytes,
  serializeRequest,
  signRequest,
  verifyRequest,
  type PaymentRequest,
} from "../src/index";

const classicalKey = classicalKeyFromPrivate(
  hexToBytes("0x0000000000000000000000000000000000000000000000000000000000000001"),
  "eth_secp256k1",
);
const pqKey = mldsa87.keygen(new Uint8Array(32).fill(7));

const request: PaymentRequest = {
  merchant: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  recipient: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  asset: NATIVE_ASSET,
  amount: 1_500_000_000_000_000_000n,
  expiresAt: 1_900_000_000n,
  reference: "CH-0000-0000-0000-0",
  detailsHash: hashDetails("Invoice 42: design work"),
  partialAllowed: true,
  payContract: "0x1111111111111111111111111111111111111111",
  chainId: 9800n,
};
request.reference = generateReference(() => new Uint8Array(12).fill(3));

test("references are well-formed, checksummed and round-trip through bytes32", () => {
  const ref = generateReference();
  expect(isValidReference(ref)).toBe(true);
  expect(referenceFromBytes32(referenceToBytes32(ref))).toBe(ref);
  const typo = ref.slice(0, 3) + (ref[3] === "A" ? "B" : "A") + ref.slice(4);
  expect(isValidReference(typo)).toBe(false);
  expect(() => referenceToBytes32("CH-XXXX")).toThrow();
});

test("signs with ML-DSA-87 and verifies against the merchant key", () => {
  const sig = signRequest(request, classicalKey, pqKey);
  expect(Buffer.from(sig.pq!.signature, "base64").byteLength).toBe(4627);
  expect(verifyRequest(request, sig, pqKey.publicKey)).toBe(true);
  expect(
    mldsa87.verify(
      pqKey.publicKey,
      requestMessageBytes(request),
      Buffer.from(sig.pq!.signature, "base64"),
    ),
  ).toBe(true);
});

test("any tampered field invalidates the signature", () => {
  const sig = signRequest(request, classicalKey, pqKey);
  const other = mldsa87.keygen(new Uint8Array(32).fill(8));
  expect(verifyRequest({ ...request, amount: 1n }, sig, pqKey.publicKey)).toBe(false);
  expect(
    verifyRequest(
      { ...request, recipient: "0x2222222222222222222222222222222222222222" },
      sig,
      pqKey.publicKey,
    ),
  ).toBe(false);
  expect(verifyRequest({ ...request, reference: generateReference() }, sig, pqKey.publicKey)).toBe(
    false,
  );
  expect(
    verifyRequest(
      { ...request, payContract: "0x3333333333333333333333333333333333333333" },
      sig,
      pqKey.publicKey,
    ),
  ).toBe(false);
  expect(verifyRequest(request, sig, other.publicKey)).toBe(false);
});

test("request IDs are deterministic, unique per field and survive serialization", () => {
  expect(requestId(request)).toBe(requestId(deserializeRequest(serializeRequest(request))));
  expect(requestId({ ...request, expiresAt: request.expiresAt + 1n })).not.toBe(requestId(request));
  expect(() => requestId({ ...request, chainId: 1n })).toThrow();
  expect(() => requestId({ ...request, amount: 0n })).toThrow();
});
