import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateMnemonic } from "@qorechain/sdk";
import { addressFromBytes, deriveCanonicalPqKey, deriveClassicalKey } from "@qorechain/qoresign";
import { bytesToHex, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** merchant deploys ChitPay and signs requests; payer pays them. */
export const roles = ["merchant", "payer"] as const;

export function chitAccounts(generate = false, file = "keys/chit-accounts.json") {
  if (generate && !existsSync(file)) {
    mkdirSync("keys", { recursive: true, mode: 0o700 });
    writeFileSync(
      file,
      JSON.stringify(Object.fromEntries(roles.map((role) => [role, generateMnemonic(256)]))),
      { flag: "wx", mode: 0o600 },
    );
  }
  if (!existsSync(file)) throw new Error("Run bun run diana:accounts first");
  const mnemonics = JSON.parse(readFileSync(file, "utf8")) as Record<
    (typeof roles)[number],
    string
  >;
  return roles.map((role) => deriveIdentity(role, mnemonics[role]));
}

export function deriveIdentity<R extends string>(role: R, mnemonic: string) {
  {
    const classical = deriveClassicalKey({ mnemonic, type: "eth_secp256k1" });
    const privateKey = bytesToHex(classical.privateKey);
    const account = privateKeyToAccount(privateKey);
    const { bech32 } = addressFromBytes(hexToBytes(account.address));
    const pqc = deriveCanonicalPqKey({ mnemonic, address: bech32 });
    return { role: role as string, account, bech32, classical, privateKey, pqc };
  }
}
export type Identity = ReturnType<typeof deriveIdentity>;

/** Shared funding account (Plinth deployer). Every send from it must run under flock. */
export function funderIdentity(
  path = process.env.CHIT_FUNDER_KEYS ?? "/workspace/plinth/keys/diana-accounts.json",
) {
  const mnemonics = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  if (!mnemonics.deployer) throw new Error("Funder key file has no deployer");
  return deriveIdentity("funder", mnemonics.deployer);
}
