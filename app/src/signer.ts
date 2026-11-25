import { NATIVE_CHAIN_ID } from "@chit/core";
import {
  addressFromBytes,
  buildRegisterPqKeyMessage,
  deriveCanonicalPqKey,
  deriveClassicalKey,
  type ClassicalKey,
} from "@qorechain/qoresign";
import { broadcastTx } from "@qorechain/qoresign/network";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex, getAddress, hexToBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Endpoints } from "./chain";
import { devnet } from "./api";

/**
 * A merchant's Chit signing key: eth_secp256k1 + canonical ML-DSA-87 derived from one
 * 24-word recovery phrase, exactly like `scripts/identity.ts`. QoreX cannot sign arbitrary
 * messages yet, so requests are signed here, in the browser, and never leave it unsigned.
 */
export interface SigningKey {
  kind: "phrase";
  address: Address;
  bech32: string;
  classical: ClassicalKey;
  pq: ReturnType<typeof deriveCanonicalPqKey>;
  /** The 24-word recovery phrase, available for backup. */
  phrase: string;
}

const STORAGE_KEY = "chit-signing-key";

export function newPhrase() {
  return generateMnemonic(wordlist, 256);
}

export function normalizePhrase(phrase: string) {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

export function isValidPhrase(phrase: string) {
  const words = normalizePhrase(phrase).split(" ");
  return (
    (words.length === 12 || words.length === 24) &&
    validateMnemonic(normalizePhrase(phrase), wordlist)
  );
}

export function keyFromPhrase(phrase: string): SigningKey {
  const mnemonic = normalizePhrase(phrase);
  const classical = deriveClassicalKey({ mnemonic, type: "eth_secp256k1" });
  const account = privateKeyToAccount(bytesToHex(classical.privateKey));
  const { bech32 } = addressFromBytes(hexToBytes(account.address));
  return {
    kind: "phrase",
    address: getAddress(account.address),
    bech32,
    classical,
    pq: deriveCanonicalPqKey({ mnemonic, address: bech32 }),
    phrase: mnemonic,
  };
}

interface Stored {
  kind: "phrase";
  phrase?: string;
}

/** Session storage by default; local storage only when the merchant chooses "Keep on this device". */
export function saveKey(key: SigningKey, remember: boolean) {
  const value = JSON.stringify({ kind: key.kind, phrase: key.phrase } satisfies Stored);
  forgetKey();
  (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, value);
}

export function loadKey(): { key: SigningKey; remembered: boolean } | undefined {
  for (const [storage, remembered] of [
    [sessionStorage, false],
    [localStorage, true],
  ] as const) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) continue;
      const stored = JSON.parse(raw) as Stored;
      if (stored.phrase && isValidPhrase(stored.phrase))
        return { key: keyFromPhrase(stored.phrase), remembered };
    } catch {
      // Ignore unreadable storage and treat it as no key.
    }
  }
  return undefined;
}

export function forgetKey() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private modes.
  }
}

export const REGISTRATION_GAS = 350_000n;
export const GAS_PRICE = "0.15uqor";
/** gas × 0.15 uqor, rounded up (what `calculateFee` produces). */
export const registrationFeeUqor = (REGISTRATION_GAS * 15n + 99n) / 100n;

/**
 * Registers the key's ML-DSA-87 public key with proof of possession (MsgRegisterPQCKeyV2).
 * Signed classically because the account has no PQC key yet; the chain accepts only this message that way.
 */
export async function registerKey(ep: Endpoints, key: SigningKey) {
  if (ep.environment === "LOCAL DEVNET") {
    // TEST-ONLY: the devnet service writes the key into the mock pqcKeyStatus precompile.
    await devnet.registerKey(key.address, bytesToHex(key.pq.publicKey));
    return "";
  }
  const { calculateFee, signClassicalEth } = await import("@qorechain/sdk");
  const message = buildRegisterPqKeyMessage({
    chainId: NATIVE_CHAIN_ID,
    account: key.bech32,
    pqKey: key.pq,
    classicalPublicKey: key.classical.publicKey,
  });
  type Account = { address: string; account_number?: string; sequence?: string };
  const response = await fetch(`${ep.rest}/cosmos/auth/v1beta1/accounts/${key.bech32}`, {
    cache: "no-store",
  });
  if (response.status === 404)
    throw new Error("Send a little QOR to this key's address first so it can pay the network fee.");
  if (!response.ok) throw new Error(`Account lookup failed (HTTP ${response.status}).`);
  const body = (await response.json()) as { account: Account & { base_account?: Account } };
  const account = body.account.base_account ?? body.account;
  const { txRawBytes } = signClassicalEth({
    account: {
      privateKey: bytesToHex(key.classical.privateKey),
      publicKey: bytesToHex(key.classical.publicKey),
      pqc: key.pq,
    },
    chainId: NATIVE_CHAIN_ID,
    accountNumber: BigInt(account.account_number ?? "0"),
    sequence: BigInt(account.sequence ?? "0"),
    fee: calculateFee(String(REGISTRATION_GAS), GAS_PRICE),
    messages: [message],
    memo: "",
  });
  const result = await broadcastTx({ rest: ep.rest, txBytes: txRawBytes });
  if (result.code)
    throw new Error(
      `QoreChain rejected the registration (${result.codespace}/${result.code}). ${result.log ?? ""}`.trim(),
    );
  return `0x${result.txhash.toLowerCase()}`;
}
