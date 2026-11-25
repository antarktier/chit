import {
  addressFromBytes,
  messagePqSignBytes,
  signMessage,
  verifyMessage,
  type ClassicalKey,
  type MessageSignature,
} from "@qorechain/qoresign";
import type { KeyPair } from "@qorechain/pqc";
import {
  bytesToHex,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  stringToHex,
  hexToString,
  type Address,
  type Hex,
} from "viem";

export const NATIVE_CHAIN_ID = "qorechain-diana";
export const EVM_CHAIN_ID = 9800n;
export const REQUEST_TYPE_TAG = "CHIT_REQUEST_V1";
/** The zero address denotes the chain's native asset (QOR). */
export const NATIVE_ASSET: Address = "0x0000000000000000000000000000000000000000";

/**
 * Canonical payment request. Every field is bound by the merchant's ML-DSA-87
 * hybrid signature, including the payment contract and chain (domain separation).
 */
export interface PaymentRequest {
  merchant: Address;
  recipient: Address;
  asset: Address;
  amount: bigint;
  expiresAt: bigint;
  reference: string;
  detailsHash: Hex;
  partialAllowed: boolean;
  payContract: Address;
  chainId: bigint;
}

export const requestComponents = [
  { name: "merchant", type: "address" },
  { name: "recipient", type: "address" },
  { name: "asset", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "expiresAt", type: "uint64" },
  { name: "paymentRef", type: "bytes32" },
  { name: "detailsHash", type: "bytes32" },
  { name: "partialAllowed", type: "bool" },
  { name: "payContract", type: "address" },
  { name: "chainId", type: "uint256" },
] as const;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REFERENCE_PATTERN =
  /^CH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/;

function checkChar(body: string): string {
  let sum = 0;
  for (const ch of body) sum = (sum * 32 + CROCKFORD.indexOf(ch)) % 37;
  return CROCKFORD[sum % 32]!;
}

/** Generates a reference like CH-7K2M-Q9TA-4XPB-R (60 random bits + check character). */
export function generateReference(random: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = random(12);
  let body = "";
  for (const b of bytes) body += CROCKFORD[b & 31];
  return `CH-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${checkChar(body)}`;
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Validates format and check character, so mistyped references are rejected. */
export function isValidReference(reference: string): boolean {
  if (!REFERENCE_PATTERN.test(reference)) return false;
  const body = reference.slice(3, 17).replaceAll("-", "");
  return reference.at(-1) === checkChar(body);
}

export function referenceToBytes32(reference: string): Hex {
  if (!isValidReference(reference)) throw new Error(`Invalid payment reference: ${reference}`);
  return stringToHex(reference, { size: 32 });
}

export function referenceFromBytes32(value: Hex): string {
  return hexToString(value, { size: 32 }).replace(/\0+$/, "");
}

export function hashDetails(details: string): Hex {
  return keccak256(stringToHex(details.normalize("NFC")));
}

export function validateRequest(request: PaymentRequest): void {
  if (request.amount <= 0n) throw new Error("Amount must be positive");
  if (request.chainId !== EVM_CHAIN_ID) throw new Error("Expected Diana EVM chain ID 9800");
  if (request.expiresAt <= 0n || request.expiresAt >= 2n ** 64n) throw new Error("Invalid expiry");
  referenceToBytes32(request.reference);
  getAddress(request.merchant);
  getAddress(request.recipient);
  getAddress(request.asset);
  getAddress(request.payContract);
}

function requestTuple(request: PaymentRequest) {
  return {
    merchant: request.merchant,
    recipient: request.recipient,
    asset: request.asset,
    amount: request.amount,
    expiresAt: request.expiresAt,
    paymentRef: referenceToBytes32(request.reference),
    detailsHash: request.detailsHash,
    partialAllowed: request.partialAllowed,
    payContract: request.payContract,
    chainId: request.chainId,
  };
}

/** abi.encode("CHIT_REQUEST_V1", request) — identical to ChitPay.sol. */
export function encodeRequest(request: PaymentRequest): Uint8Array {
  validateRequest(request);
  return hexToBytes(
    encodeAbiParameters(
      [{ type: "string" }, { type: "tuple", components: requestComponents }],
      [REQUEST_TYPE_TAG, requestTuple(request)],
    ),
  );
}

/** requestId = keccak256(abi.encode(tag, request)). */
export function requestId(request: PaymentRequest): Hex {
  return keccak256(encodeRequest(request));
}

export function requestMessageBytes(request: PaymentRequest): Uint8Array {
  return messagePqSignBytes(NATIVE_CHAIN_ID, encodeRequest(request));
}

export function merchantBech32(merchant: Address): string {
  return addressFromBytes(hexToBytes(merchant)).bech32;
}

export function signRequest(
  request: PaymentRequest,
  classicalKey: ClassicalKey,
  pqKey: Pick<KeyPair, "secretKey">,
): MessageSignature {
  return signMessage({
    chainId: NATIVE_CHAIN_ID,
    signer: merchantBech32(request.merchant),
    data: encodeRequest(request),
    classicalKey,
    pqKey,
  });
}

/** Pass the merchant's registered ML-DSA-87 public key from a trusted source (pqcKeyStatus / REST). */
export function verifyRequest(
  request: PaymentRequest,
  signature: MessageSignature,
  pqPublicKey: Uint8Array,
): boolean {
  if (signature.signatureType !== "ml-dsa-87-hybrid") return false;
  try {
    verifyMessage({
      chainId: NATIVE_CHAIN_ID,
      signer: merchantBech32(request.merchant),
      data: encodeRequest(request),
      signature,
      pqPublicKey,
      requirePq: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** JSON-safe form used in links, QR codes and the API. */
export interface SerializedRequest {
  merchant: Address;
  recipient: Address;
  asset: Address;
  amount: string;
  expiresAt: string;
  reference: string;
  detailsHash: Hex;
  partialAllowed: boolean;
  payContract: Address;
  chainId: string;
}

export function serializeRequest(r: PaymentRequest): SerializedRequest {
  return {
    ...r,
    amount: r.amount.toString(),
    expiresAt: r.expiresAt.toString(),
    chainId: r.chainId.toString(),
  };
}

export function deserializeRequest(r: SerializedRequest): PaymentRequest {
  const request: PaymentRequest = {
    merchant: getAddress(r.merchant),
    recipient: getAddress(r.recipient),
    asset: getAddress(r.asset),
    amount: BigInt(r.amount),
    expiresAt: BigInt(r.expiresAt),
    reference: r.reference,
    detailsHash: r.detailsHash,
    partialAllowed: Boolean(r.partialAllowed),
    payContract: getAddress(r.payContract),
    chainId: BigInt(r.chainId),
  };
  validateRequest(request);
  return request;
}

export { bytesToHex };
