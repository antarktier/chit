import { addressFromBytes, deriveCanonicalPqKey, deriveClassicalKey } from "@qorechain/qoresign";
import { bytesToHex, encodeAbiParameters, hexToBytes, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * LOCAL DEVNET ONLY. Anvil's public test mnemonic. These identities exist so the
 * Playwright suite and local development can run against a loopback Anvil with the
 * labelled test-only PQC mock precompiles. They are never offered on Diana.
 */
export const devMnemonic = "test test test test test test test test test test test junk";
export const DEV_MERCHANT_INDEX = 1;
export const DEV_PAYER_INDEX = 2;

export function devIdentity(index: number) {
  const classical = deriveClassicalKey({
    mnemonic: devMnemonic,
    type: "eth_secp256k1",
    path: `m/44'/60'/0'/0/${index}`,
  });
  const account = privateKeyToAccount(bytesToHex(classical.privateKey));
  const bech32 = addressFromBytes(hexToBytes(account.address)).bech32;
  return {
    account,
    address: account.address,
    bech32,
    classical,
    pq: deriveCanonicalPqKey({ mnemonic: devMnemonic, address: bech32 }),
  };
}

/** Signature the test-only MockQorePQC precompile accepts: keccak256(abi.encode(pubkey, message)). */
export function mockPqSignature(publicKey: Uint8Array, message: Uint8Array): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes" }],
      [bytesToHex(publicKey), bytesToHex(message)],
    ),
  );
}
