import { fetchPqKeyStatus } from "@qorechain/qoresign/network";
import { paymentReceivedEvent, type CosmosTxResponse, type PaymentEvent } from "@chit/core";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  hexToBytes,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { fromBech32 } from "@chit/core";
import type { Config } from "./config";

/** Everything the service needs from QoreChain. Swappable so tests can run without a network. */
export interface ChainSource {
  head(): Promise<bigint>;
  paymentLogs(from: bigint, to: bigint, requestId?: Hex): Promise<PaymentEvent[]>;
  /** Native txs that paid `recipient`, newest first. */
  nativeTxsTo(recipient: string, page: number, limit: number): Promise<CosmosTxResponse[]>;
  /** PaymentReceived events in one EVM tx (for the fast-path POST /v1/payments). */
  evmTxEvents(hash: Hex): Promise<PaymentEvent[]>;
  /** One native tx by hash, or undefined if not found yet. */
  nativeTx(hash: string): Promise<CosmosTxResponse | undefined>;
  pqKey(
    bech32: string,
  ): Promise<{ registered: boolean; possessionProven: boolean; publicKey?: Uint8Array }>;
}

const pqcAbi = parseAbi([
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);

export function dianaSource(cfg: Config): ChainSource {
  const evm = createPublicClient({
    cacheTime: 0,
    transport: http(cfg.evmUrl, { timeout: 15_000, retryCount: 2, batch: { batchSize: 40 } }),
  });
  return {
    head: () => evm.getBlockNumber(),
    async paymentLogs(from, to, requestId) {
      const logs = await evm.getLogs({
        address: cfg.chitPay,
        event: paymentReceivedEvent,
        args: requestId ? { requestId } : undefined,
        fromBlock: from,
        toBlock: to,
      });
      const heights = [...new Set(logs.map((l) => l.blockNumber))];
      const blocks = await Promise.all(heights.map((blockNumber) => evm.getBlock({ blockNumber })));
      const time = new Map(blocks.map((b) => [b.number, b.timestamp]));
      return logs.map((l) => ({
        source: "evm" as const,
        txHash: l.transactionHash,
        index: l.logIndex,
        blockHeight: l.blockNumber,
        blockTime: time.get(l.blockNumber) ?? 0n,
        requestId: l.args.requestId as Hex,
        payer: getAddress(l.args.payer as Address),
        recipient: getAddress(l.args.recipient as Address),
        asset: getAddress(l.args.asset as Address),
        amount: l.args.amount as bigint,
      }));
    },
    async evmTxEvents(hash) {
      const receipt = await evm.getTransactionReceipt({ hash }).catch(() => undefined);
      if (!receipt || receipt.status !== "success") return [];
      const block = await evm.getBlock({ blockNumber: receipt.blockNumber });
      const out: PaymentEvent[] = [];
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== cfg.chitPay) continue;
        try {
          const d = decodeEventLog({
            abi: [paymentReceivedEvent],
            data: log.data,
            topics: log.topics,
          });
          out.push({
            source: "evm",
            txHash: receipt.transactionHash,
            index: log.logIndex,
            blockHeight: receipt.blockNumber,
            blockTime: block.timestamp,
            requestId: d.args.requestId,
            payer: getAddress(d.args.payer),
            recipient: getAddress(d.args.recipient),
            asset: getAddress(d.args.asset),
            amount: d.args.amount,
          });
        } catch {
          // Not a PaymentReceived log.
        }
      }
      return out;
    },
    async nativeTx(hash) {
      if (cfg.environment === "LOCAL DEVNET") return undefined;
      const res = await fetch(
        `${cfg.restUrl}/cosmos/tx/v1beta1/txs/${hash.replace(/^0x/, "").toUpperCase()}`,
        {
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (res.status === 404 || res.status === 400) return undefined;
      if (!res.ok) throw new Error(`Native tx lookup failed (HTTP ${res.status})`);
      return ((await res.json()) as { tx_response: CosmosTxResponse }).tx_response;
    },
    async nativeTxsTo(recipient, page, limit) {
      if (cfg.environment === "LOCAL DEVNET") return [];
      const q = new URLSearchParams({
        query: `transfer.recipient='${recipient}'`,
        order_by: "ORDER_BY_DESC",
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`${cfg.restUrl}/cosmos/tx/v1beta1/txs?${q}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Native tx search failed (HTTP ${res.status})`);
      const body = (await res.json()) as { tx_responses?: CosmosTxResponse[] };
      return body.tx_responses ?? [];
    },
    async pqKey(bech32) {
      if (cfg.environment === "LOCAL DEVNET") {
        // Anvil devnet: read the test-only mock precompile through the same pqcKeyStatus ABI.
        const [registered, , pubkey, possessionProven] = await evm.readContract({
          address: "0x0000000000000000000000000000000000000a02",
          abi: pqcAbi,
          functionName: "pqcKeyStatus",
          args: [fromBech32(bech32)],
        });
        return {
          registered,
          possessionProven,
          publicKey: pubkey === "0x" ? undefined : hexToBytes(pubkey),
        };
      }
      const s = await fetchPqKeyStatus({ rest: cfg.restUrl, address: bech32 });
      return {
        registered: s.registered,
        possessionProven: Boolean(s.possessionProven),
        publicKey: s.publicKey,
      };
    },
  };
}
