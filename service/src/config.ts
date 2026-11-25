import { diana } from "@chit/core";
import { getAddress, type Address } from "viem";

export interface Config {
  evmUrl: string;
  restUrl: string;
  chitPay: Address;
  startBlock: bigint;
  minConfirmations: bigint;
  corsOrigins: string[];
  /** 32-byte hex seed for the ML-DSA-87 receipt attestation key (Worker secret). */
  attestationSeed?: string;
  /** Max blocks scanned per indexer tick. */
  blocksPerTick: bigint;
  environment: "DIANA" | "LOCAL DEVNET";
  explorer: string;
}

/** Exact origins, or `http://127.0.0.1:*` / `http://localhost:*` for any local port. */
export function originAllowed(origin: string, allowed: string[]) {
  return allowed.some((a) =>
    a.endsWith(":*") ? origin.startsWith(a.slice(0, -1)) && /:\d{1,5}$/.test(origin) : a === origin,
  );
}

export function config(env: Record<string, string | undefined>): Config {
  if (!env.CHIT_PAY) throw new Error("CHIT_PAY is required");
  return {
    evmUrl: env.CHIT_EVM_URL ?? diana.evm,
    restUrl: env.CHIT_REST_URL ?? diana.rest,
    chitPay: getAddress(env.CHIT_PAY),
    startBlock: BigInt(env.CHIT_START_BLOCK ?? "0"),
    minConfirmations: BigInt(env.CHIT_MIN_CONFIRMATIONS ?? "2"),
    corsOrigins: (
      env.CHIT_CORS_ORIGINS ??
      (env.CHIT_ENVIRONMENT === "LOCAL DEVNET"
        ? "http://127.0.0.1:*,http://localhost:*"
        : "https://chit.antarktier.com")
    )
      .split(",")
      .filter(Boolean),
    attestationSeed: env.CHIT_ATTESTATION_SEED,
    blocksPerTick: BigInt(env.CHIT_BLOCKS_PER_TICK ?? "5000"),
    environment: env.CHIT_ENVIRONMENT === "LOCAL DEVNET" ? "LOCAL DEVNET" : "DIANA",
    explorer: env.CHIT_EXPLORER ?? diana.explorer,
  };
}
