import type { EventClass, PaymentStatus, SerializedRequest, SignedReceipt } from "@chit/core";
import type { MessageSignature } from "@qorechain/qoresign";
import { useEffect, useState } from "react";

/** Typed client for the Chit service (`service/src/api.ts`). Bigints are decimal strings. */
export const apiBase = (import.meta.env.VITE_CHIT_API || "https://chit-api.antarktier.com").replace(
  /\/$/,
  "",
);

export type Environment = "DIANA" | "LOCAL DEVNET";

export interface ServiceStatus {
  environment: Environment;
  chainId: string;
  chitPay: `0x${string}`;
  headHeight: string;
  indexedHeight: string;
  lagBlocks: string;
  minConfirmations: string;
  attestationKey: `0x${string}` | null;
  nativeChainId?: string;
  evmUrl?: string;
  restUrl?: string;
  explorer?: string;
}

export interface Reconciliation {
  status: PaymentStatus;
  requested: string;
  paid: string;
  pending: string;
  outstanding: string;
  overpaidBy: string;
  unattributed: string;
  completedAt?: { txHash: string; blockHeight: string; blockTime: string };
}

export interface PaymentEventView {
  key: string;
  source: "evm" | "native";
  txHash: string;
  index: number;
  blockHeight: string;
  blockTime: string;
  payer: string;
  amount: string;
  confirmations: string;
  class: EventClass;
  explorerUrl: string;
}

export interface RequestDetail {
  id: `0x${string}`;
  request: SerializedRequest;
  signature: MessageSignature;
  details: string;
  createdAt: string;
  headHeight: string;
  reconciliation: Reconciliation;
  events: PaymentEventView[];
}

export interface RequestSummary {
  id: `0x${string}`;
  merchant: string;
  reference: string;
  recipient: string;
  asset: string;
  amount: string;
  expiresAt: string;
  partialAllowed: boolean;
  details: string;
  createdAt: string;
  status: PaymentStatus;
  paid: string;
  pending: string;
  updatedAt: string;
}

export interface MerchantSummary {
  merchant: string;
  requests: number;
  byStatus: Record<PaymentStatus, number>;
  requested: string;
  received: string;
  outstanding: string;
  /** Per-asset totals (requested from the backend; amounts of different assets must not be added). */
  byAsset?: { asset: string; requested: string; received: string; outstanding: string }[];
}

export interface RecentPayment {
  key: string;
  request_id: string;
  reference: string;
  source: "evm" | "native";
  tx_hash: string;
  block_height: number;
  block_time: number;
  payer: string;
  amount: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function call(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(apiBase + path, init);
  } catch {
    throw new ApiError(0, "Chit could not reach its service. Check your connection and try again.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(
      response.status,
      body?.error ?? `The Chit service returned HTTP ${response.status}.`,
    );
  }
  return response;
}

export async function get<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await call(path, { cache: "no-store", ...init })).json()) as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

export const paths = {
  status: () => "/v1/status",
  request: (id: string) => `/v1/requests/${id}`,
  receipt: (id: string) => `/v1/requests/${id}/receipt`,
  byReference: (merchant: string, reference: string) =>
    `/v1/requests/by-reference/${merchant}/${encodeURIComponent(reference)}`,
  merchantRequests: (
    merchant: string,
    q: { status?: PaymentStatus; from?: string; limit?: number; offset?: number },
  ) => `/v1/merchants/${merchant}/requests${query(q)}`,
  summary: (merchant: string, q: { from?: string } = {}) =>
    `/v1/merchants/${merchant}/summary${query(q)}`,
  exportUrl: (merchant: string, format: "csv" | "json", q: { from?: string } = {}) =>
    `${apiBase}/v1/merchants/${merchant}/export${query({ format, ...q })}`,
  recent: (merchant: string) => `/v1/payments/recent${query({ merchant })}`,
};

function query(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "",
  );
  return entries.length
    ? "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
    : "";
}

export function createRequest(body: {
  request: SerializedRequest;
  signature: MessageSignature;
  details: string;
}) {
  return post<RequestDetail>("/v1/requests", body);
}

export function fetchReceipt(id: string) {
  return get<SignedReceipt>(paths.receipt(id));
}

export function message(error: unknown) {
  return error instanceof Error ? error.message.split("\n")[0]! : "The request failed.";
}

/** Fetches `path` and refreshes every `interval` ms (0 = once). Keeps the last data on errors. */
export function useApi<T>(path: string | undefined, interval = 0, revision = 0) {
  const [state, setState] = useState<{ key?: string; data?: T; error?: string; status?: number }>(
    {},
  );
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let busy = false;
    async function load(url: string) {
      if (busy) return;
      busy = true;
      try {
        const data = await get<T>(url, { signal: controller.signal });
        if (!controller.signal.aborted) setState({ key: url, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({
            key: url,
            data: previous.key === url ? previous.data : undefined,
            error: message(error),
            status: error instanceof ApiError ? error.status : undefined,
          }));
      } finally {
        busy = false;
      }
    }
    void load(path);
    const timer = interval ? setInterval(() => void load(path), interval) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [path, interval, revision]);
  return state.key === path ? state : {};
}

/** Fast path: ask the service to index this tx now. It reads the tx from chain; 404 = not found yet. */
export async function reportPayment(txHash: string, source: "evm" | "native", attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await post<{ requestIds: string[]; events: number }>("/v1/payments", {
        txHash,
        source,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 0)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
  return undefined;
}

/** LOCAL DEVNET ONLY: helpers served by `scripts/devnet.ts` (test-only PQC mock, Anvil balances). */
export const devnet = {
  registerKey: (address: string, publicKey: string) =>
    post<{ registered: boolean }>("/local/register-key", { address, publicKey }),
  fund: (address: string) => post<{ balance: string }>("/local/fund", { address }),
};
