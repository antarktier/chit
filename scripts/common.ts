import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { diana, EVM_CHAIN_ID, NATIVE_CHAIN_ID } from "@chit/core";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";

export const dianaEndpoints = {
  evm: process.env.CHIT_EVM_URL ?? diana.evm,
  rest: process.env.CHIT_REST_URL ?? diana.rest,
};
export const evm = createPublicClient({ transport: http(dianaEndpoints.evm, { timeout: 15_000 }) });

export class RestError extends Error {
  constructor(readonly status: number) {
    super(`REST HTTP ${status}`);
  }
}

export async function rest<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(dianaEndpoints.rest + path, {
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      if (attempt >= 3) throw error;
      return undefined;
    });
    if (res?.ok) return (await res.json()) as T;
    if (res && res.status < 500 && res.status !== 429) throw new RestError(res.status);
    if (attempt >= 3) throw new RestError(res?.status ?? 0);
    await new Promise((r) => setTimeout(r, 300 * attempt));
  }
}

export async function checkDiana() {
  const [chainId, info] = await Promise.all([
    evm.getChainId(),
    rest<{ default_node_info: { network: string } }>("/cosmos/base/tendermint/v1beta1/node_info"),
  ]);
  if (BigInt(chainId) !== EVM_CHAIN_ID || info.default_node_info.network !== NATIVE_CHAIN_ID)
    throw new Error("Expected Diana EVM and native chain IDs");
}

export function artifact(name: string) {
  return JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
}

/** Signs and submits a legacy EVM tx after a balance check; never exceeds the 30M gas cap. */
export async function evmSend(
  account: LocalAccount,
  call: { to?: Address; data?: Hex; value?: bigint },
) {
  const wallet = createWalletClient({ account, transport: http(dianaEndpoints.evm) });
  const [gasPrice, nonce, balance] = await Promise.all([
    evm.getGasPrice(),
    evm.getTransactionCount({ address: account.address, blockTag: "pending" }),
    evm.getBalance({ address: account.address }),
  ]);
  const gas = await evm.estimateGas({ account: account.address, ...call });
  const gasLimit = (gas * 12n) / 10n + 1000n;
  if (gasLimit > 30_000_000n) throw new Error("Transaction exceeds the 30M gas cap");
  const required = gasPrice * gasLimit + (call.value ?? 0n);
  if (balance < required)
    throw new Error(`${account.address} needs ${formatEther(required - balance)} more QOR`);
  const serializedTransaction = await account.signTransaction({
    ...call,
    type: "legacy",
    gas: gasLimit,
    gasPrice,
    nonce,
    chainId: Number(EVM_CHAIN_ID),
  });
  const hash = await wallet.sendRawTransaction({ serializedTransaction });
  const receipt = await evm.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`EVM transaction reverted: ${hash}`);
  return receipt;
}

export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function writeJson(path: string, data: unknown, mode = 0o644) {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(
      temp,
      JSON.stringify(data, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2) +
        "\n",
      { mode, flag: "wx" },
    );
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
