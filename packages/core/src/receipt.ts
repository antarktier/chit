import { mldsa87 } from "@qorechain/pqc";
import { bytesToHex, hexToBytes, keccak256, stringToBytes, type Hex } from "viem";
import type { Reconciliation } from "./reconcile";
import type { SerializedRequest } from "./request";

export const RECEIPT_TYPE_TAG = "CHIT_RECEIPT_V1";

export interface ReceiptPayment {
  source: "evm" | "native";
  txHash: string;
  index: number;
  blockHeight: string;
  blockTime: string;
  payer: string;
  amount: string;
}

/** A receipt anyone can check: the merchant signature against the on-chain key and every tx against the chain. */
export interface Receipt {
  type: typeof RECEIPT_TYPE_TAG;
  requestId: Hex;
  request: SerializedRequest;
  /** Merchant ML-DSA-87 hybrid signature over the canonical request (base64 fields as produced by qoresign). */
  merchantSignature: unknown;
  status: Reconciliation["status"];
  paid: string;
  overpaidBy: string;
  payments: ReceiptPayment[];
  completedAt?: { txHash: string; blockHeight: string; blockTime: string };
  issuedAt: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function buildReceipt(
  request: SerializedRequest,
  merchantSignature: unknown,
  rec: Reconciliation,
  issuedAt: Date,
): Receipt {
  return {
    type: RECEIPT_TYPE_TAG,
    requestId: rec.requestId,
    request,
    merchantSignature,
    status: rec.status,
    paid: rec.paid.toString(),
    overpaidBy: rec.overpaidBy.toString(),
    payments: rec.events
      .filter((e) => e.class === "counted" || e.class === "duplicate")
      .map(({ event }) => ({
        source: event.source,
        txHash: event.txHash,
        index: event.index,
        blockHeight: event.blockHeight.toString(),
        blockTime: event.blockTime.toString(),
        payer: event.payer,
        amount: event.amount.toString(),
      })),
    completedAt: rec.completedAt && {
      txHash: rec.completedAt.txHash,
      blockHeight: rec.completedAt.blockHeight.toString(),
      blockTime: rec.completedAt.blockTime.toString(),
    },
    issuedAt: issuedAt.toISOString(),
  };
}

export function receiptDigest(receipt: Receipt): Hex {
  return keccak256(stringToBytes(`${RECEIPT_TYPE_TAG}|qorechain-diana|${canonical(receipt)}`));
}

export interface SignedReceipt {
  receipt: Receipt;
  digest: Hex;
  /** ML-DSA-87 signature of the Chit service attestation key over `digest`. */
  attestation: Hex;
  attestationKey: Hex;
}

export function signReceipt(
  receipt: Receipt,
  key: { secretKey: Uint8Array; publicKey: Uint8Array },
): SignedReceipt {
  const digest = receiptDigest(receipt);
  return {
    receipt,
    digest,
    attestation: bytesToHex(mldsa87.sign(key.secretKey, hexToBytes(digest))),
    attestationKey: bytesToHex(key.publicKey),
  };
}

export function verifyReceiptAttestation(signed: SignedReceipt, trustedKey: Hex): boolean {
  if (signed.attestationKey.toLowerCase() !== trustedKey.toLowerCase()) return false;
  const digest = receiptDigest(signed.receipt);
  if (digest !== signed.digest) return false;
  try {
    return mldsa87.verify(
      hexToBytes(trustedKey),
      hexToBytes(digest),
      hexToBytes(signed.attestation),
    );
  } catch {
    return false;
  }
}
