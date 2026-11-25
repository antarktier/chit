import { addressFromBytes, deriveCanonicalPqKey, deriveClassicalKey } from "@qorechain/qoresign";
import { bytesToHex, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * LOCAL DEVNET ONLY. Anvil's public test mnemonic. The payer identity lets the Playwright
 * suite and local development pay from a loopback Anvil account. Never used on Diana.
 */
export const devMnemonic = "test test test test test test test test test test test junk";
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
