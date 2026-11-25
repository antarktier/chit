import { fetchPqKeyStatus } from "@qorechain/qoresign/network";
import { paymentReceivedEvent, type CosmosTxResponse, type PaymentEvent } from "@chit/core";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import type { Config } from "./config";

/** Everything the service needs from QoreChain. Swappable so tests can run without a network. */
export interface ChainSource {
  head(): Promise<bigint>;
  paymentLogs(from: bigint, to: bigint, requestId?: Hex): Promise<PaymentEvent[]>;
  /** Native txs that paid `recipient`, newest first. */
  nativeTxsTo(recipient: string, page: number, limit: number): Promise<CosmosTxResponse[]>;
  pqKey(
    bech32: string,
  ): Promise<{ registered: boolean; possessionProven: boolean; publicKey?: Uint8Array }>;
}

export function dianaSource(cfg: Config): ChainSource {
  const evm = createPublicClient({
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
    async nativeTxsTo(recipient, page, limit) {
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
      const s = await fetchPqKeyStatus({ rest: cfg.restUrl, address: bech32 });
      return {
        registered: s.registered,
        possessionProven: Boolean(s.possessionProven),
        publicKey: s.publicKey,
      };
    },
  };
}
