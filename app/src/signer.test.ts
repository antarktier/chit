import {
  EVM_CHAIN_ID,
  generateReference,
  hashDetails,
  NATIVE_ASSET,
  verifyRequest,
  signRequest,
  type PaymentRequest,
} from "@chit/core";
import { describe, expect, it, beforeEach } from "vite-plus/test";
import { parseRecipient } from "./pages/NewRequest";
import {
  forgetKey,
  isValidPhrase,
  keyFromPhrase,
  loadKey,
  newPhrase,
  registrationFeeUqor,
  saveKey,
} from "./signer";

const phrase = "test test test test test test test test test test test junk";

describe("signing key", () => {
  beforeEach(() => forgetKey());

  it("derives the same identity as scripts/identity.ts (eth_secp256k1 + canonical ML-DSA-87)", () => {
    const key = keyFromPhrase(phrase);
    expect(key.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(key.bech32).toMatch(/^qor1/);
    expect(key.pq.publicKey).toHaveLength(2592);
    expect(keyFromPhrase(`  ${phrase.toUpperCase()} `).address).toBe(key.address);
  });

  it("generates and validates 24-word phrases", () => {
    const words = newPhrase().split(" ");
    expect(words).toHaveLength(24);
    expect(isValidPhrase(words.join(" "))).toBe(true);
    expect(isValidPhrase(words.slice(0, 23).join(" "))).toBe(false);
    expect(isValidPhrase(phrase.replace("junk", "test"))).toBe(false);
  });

  it("keeps the key in session storage unless the merchant chooses this device", () => {
    const key = keyFromPhrase(phrase);
    saveKey(key, false);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(loadKey()).toMatchObject({ remembered: false, key: { address: key.address } });
    saveKey(key, true);
    expect(sessionStorage.length).toBe(0);
    expect(loadKey()?.remembered).toBe(true);
    forgetKey();
    expect(loadKey()).toBeUndefined();
  });

  it("signs requests that verify only with the merchant's ML-DSA-87 key and unchanged terms", () => {
    const key = keyFromPhrase(phrase);
    const other = keyFromPhrase(newPhrase());
    const request: PaymentRequest = {
      merchant: key.address,
      recipient: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      asset: NATIVE_ASSET,
      amount: 1_500_000_000_000_000_000n,
      expiresAt: 2_000_000_000n,
      reference: generateReference(),
      detailsHash: hashDetails("Invoice 1042"),
      partialAllowed: true,
      payContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      chainId: EVM_CHAIN_ID,
    };
    const signature = signRequest(request, key.classical, key.pq);
    expect(verifyRequest(request, signature, key.pq.publicKey)).toBe(true);
    expect(verifyRequest({ ...request, amount: 1n }, signature, key.pq.publicKey)).toBe(false);
    expect(
      verifyRequest({ ...request, recipient: other.address }, signature, key.pq.publicKey),
    ).toBe(false);
    expect(verifyRequest(request, signature, other.pq.publicKey)).toBe(false);
  });

  it("computes the registration fee like calculateFee (350,000 gas × 0.15 uqor)", () => {
    expect(registrationFeeUqor).toBe(52_500n);
  });
});

describe("recipient input", () => {
  it("accepts EVM and qor1 addresses for the same account", () => {
    const key = keyFromPhrase(phrase);
    expect(parseRecipient(key.address.toLowerCase())).toBe(key.address);
    expect(parseRecipient(key.bech32)).toBe(key.address);
    expect(parseRecipient("qor1notanaddress")).toBeUndefined();
    expect(parseRecipient("hello")).toBeUndefined();
  });
});
