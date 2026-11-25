import { useEffect, useState } from "react";
import { diana, EVM_CHAIN_ID, NATIVE_CHAIN_ID, toBech32 } from "@chit/core";
import { fetchPqKeyStatus } from "@qorechain/qoresign/network";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import type { Environment, ServiceStatus } from "./api";

export const PQC_KEY_STATUS: Address = "0x0000000000000000000000000000000000000a02";
const pqcAbi = parseAbi([
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);
export const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface Endpoints {
  environment: Environment;
  evm: string;
  rest: string;
  explorer: string;
}

export function endpoints(status?: ServiceStatus): Endpoints {
  const environment = status?.environment ?? "DIANA";
  const local = environment === "LOCAL DEVNET";
  return {
    environment,
    evm:
      status?.evmUrl ??
      (local ? import.meta.env.VITE_CHIT_LOCAL_EVM || "http://127.0.0.1:8545" : diana.evm),
    rest: status?.restUrl ?? diana.rest,
    explorer: status?.explorer ?? diana.explorer,
  };
}

export function evmChain(rpc: string) {
  return defineChain({
    id: Number(EVM_CHAIN_ID),
    name: "QoreChain Diana testnet",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

const clients = new Map<string, ReturnType<typeof createPublicClient>>();
export function publicClient(rpc: string) {
  let client = clients.get(rpc);
  if (!client) {
    client = createPublicClient({
      chain: evmChain(rpc),
      transport: http(rpc, { timeout: 15_000, retryCount: 1 }),
    });
    clients.set(rpc, client);
  }
  return client;
}

export interface KeyStatus {
  registered: boolean;
  possessionProven: boolean;
  publicKey?: Uint8Array;
}

/**
 * The merchant's registered ML-DSA-87 key. On Diana it comes from the chain's REST API
 * (what the service checks); on the local devnet from the test-only pqcKeyStatus mock.
 */
export async function keyStatus(ep: Endpoints, address: Address): Promise<KeyStatus> {
  if (ep.environment === "DIANA") {
    const s = await fetchPqKeyStatus({ rest: ep.rest, address: toBech32(address) });
    return {
      registered: s.registered,
      possessionProven: Boolean(s.possessionProven),
      publicKey: s.publicKey,
    };
  }
  const [registered, , pubkey, possessionProven] = await publicClient(ep.evm).readContract({
    address: PQC_KEY_STATUS,
    abi: pqcAbi,
    functionName: "pqcKeyStatus",
    args: [address],
  });
  return {
    registered,
    possessionProven,
    publicKey: registered ? hexBytes(pubkey) : undefined,
  };
}

function hexBytes(value: Hex) {
  const clean = value.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Native QOR balance in uqor (Diana) or EVM wei converted to uqor (local devnet). */
export async function nativeBalanceUqor(ep: Endpoints, address: Address): Promise<bigint> {
  if (ep.environment === "LOCAL DEVNET")
    return (await publicClient(ep.evm).getBalance({ address })) / 1_000_000_000_000n;
  const response = await fetch(
    `${ep.rest}/cosmos/bank/v1beta1/balances/${toBech32(address)}/by_denom?denom=uqor`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Balance lookup failed (HTTP ${response.status}).`);
  const body = (await response.json()) as { balance?: { amount: string } | null };
  return BigInt(body.balance?.amount ?? "0");
}

export interface AssetInfo {
  address: Address;
  native: boolean;
  symbol: string;
  decimals: number;
  metadataUnavailable?: true;
}

export const QOR: AssetInfo = {
  address: "0x0000000000000000000000000000000000000000",
  native: true,
  symbol: "QOR",
  decimals: 18,
};

const assetCache = new Map<string, Promise<AssetInfo>>();
export function assetInfo(ep: Endpoints, asset: string): Promise<AssetInfo> {
  const address = getAddress(asset);
  if (address === QOR.address) return Promise.resolve(QOR);
  const key = `${ep.evm}|${address}`;
  let pending = assetCache.get(key);
  if (!pending) {
    const client = publicClient(ep.evm);
    pending = Promise.all([
      client.readContract({ address, abi: tokenAbi, functionName: "symbol" }),
      client.readContract({ address, abi: tokenAbi, functionName: "decimals" }),
    ]).then(([symbol, decimals]) => ({ address, native: false, symbol, decimals }));
    pending.catch(() => assetCache.delete(key));
    assetCache.set(key, pending);
  }
  return pending;
}

export function explorerTxUrl(ep: Endpoints, hash: string, source: "evm" | "native") {
  if (ep.environment === "LOCAL DEVNET") return undefined;
  const display = source === "native" ? hash.replace(/^0x/i, "").toUpperCase() : hash;
  return `${ep.explorer}/tx/${display}?network=testnet`;
}

export { NATIVE_CHAIN_ID };

/** Symbol and decimals for a request's asset; QOR immediately, tokens after one RPC read. */
export function useAsset(ep: Endpoints, asset: string | undefined) {
  const [info, setInfo] = useState<AssetInfo | undefined>(() =>
    asset && /^0x0{40}$/i.test(asset) ? QOR : undefined,
  );
  useEffect(() => {
    if (!asset) return;
    let live = true;
    assetInfo(ep, asset)
      .then((next) => live && setInfo(next))
      .catch(
        () =>
          live &&
          setInfo({
            address: asset as Address,
            native: false,
            symbol: "base units",
            decimals: 0,
            metadataUnavailable: true,
          }),
      );
    return () => {
      live = false;
    };
  }, [ep, asset]);
  return info?.address.toLowerCase() === asset?.toLowerCase() ? info : undefined;
}
