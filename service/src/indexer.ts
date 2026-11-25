import {
  deserializeRequest,
  eventKey,
  nativePaymentEvents,
  reconcile,
  toBech32,
  type PaymentEvent,
  type SerializedRequest,
} from "@chit/core";
import type { ChainSource } from "./chain";
import type { Config } from "./config";
import type { Statement, Store } from "./store";

export interface EventRow {
  key: string;
  request_id: string;
  source: "evm" | "native";
  tx_hash: string;
  idx: number;
  block_height: number;
  block_time: number;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
}

export function rowToEvent(r: EventRow): PaymentEvent {
  return {
    source: r.source,
    txHash: r.tx_hash,
    index: r.idx,
    blockHeight: BigInt(r.block_height),
    blockTime: BigInt(r.block_time),
    requestId: r.request_id as `0x${string}`,
    payer: r.payer,
    recipient: r.recipient as `0x${string}`,
    asset: r.asset as `0x${string}`,
    amount: BigInt(r.amount),
  };
}

export function insertEvent(e: PaymentEvent, key: string, now: string): Statement {
  // INSERT OR IGNORE on the (source, txHash, index) key makes indexing idempotent.
  return [
    "INSERT OR IGNORE INTO events (key, request_id, source, tx_hash, idx, block_height, block_time, payer, recipient, asset, amount, indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    key,
    e.requestId.toLowerCase(),
    e.source,
    String(e.txHash).toLowerCase(),
    e.index,
    Number(e.blockHeight),
    Number(e.blockTime),
    e.payer,
    e.recipient,
    e.asset,
    e.amount.toString(),
    now,
  ];
}

async function cursor(store: Store, name: string): Promise<string | undefined> {
  const [row] = await store.all<{ value: string }>(
    "SELECT value FROM cursors WHERE name = ?",
    name,
  );
  return row?.value;
}

const setCursor = (name: string, value: string): Statement => [
  "INSERT INTO cursors (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
  name,
  value,
];

/** One indexer pass: EVM ChitPay logs, native memo transfers, then status refresh. */
export async function indexOnce(store: Store, chain: ChainSource, cfg: Config, now = new Date()) {
  const iso = now.toISOString();
  const head = await chain.head();
  const known = new Set(
    (await store.all<{ id: string }>("SELECT id FROM requests")).map((r) => r.id.toLowerCase()),
  );
  const statements: Statement[] = [];

  // EVM: scan forward from the stored cursor in bounded chunks.
  const last = await cursor(store, "evm_block");
  let from = last ? BigInt(last) + 1n : cfg.startBlock;
  const until = from + cfg.blocksPerTick - 1n < head ? from + cfg.blocksPerTick - 1n : head;
  let evmEvents = 0;
  while (from <= until) {
    const to = from + 1999n < until ? from + 1999n : until;
    for (const e of await chain.paymentLogs(from, to)) {
      statements.push(insertEvent(e, eventKey(e), iso));
      evmEvents++;
    }
    from = to + 1n;
  }
  if (until >= (last ? BigInt(last) + 1n : cfg.startBlock))
    statements.push(setCursor("evm_block", until.toString()));

  // Native: newest-first search per recipient until we reach the stored height.
  const recipients = await store.all<{ recipient: string }>(
    "SELECT DISTINCT recipient FROM requests WHERE status IN ('unpaid','partially_paid','completed') OR expires_at > ?",
    Math.floor(now.getTime() / 1000) - 7 * 86_400,
  );
  let nativeEvents = 0;
  for (const { recipient } of recipients) {
    const bech32 = toBech32(recipient as `0x${string}`);
    const name = `native:${bech32}`;
    const seen = BigInt((await cursor(store, name)) ?? "0");
    let top = seen;
    for (let page = 1; ; page++) {
      const txs = await chain.nativeTxsTo(bech32, page, 50);
      let done = txs.length < 50;
      for (const tx of txs) {
        const height = BigInt(tx.height);
        if (height <= seen) {
          done = true;
          continue;
        }
        if (height > top) top = height;
        for (const e of nativePaymentEvents(tx)) {
          if (!known.has(e.requestId.toLowerCase())) continue;
          statements.push(insertEvent(e, eventKey(e), iso));
          nativeEvents++;
        }
      }
      if (done) break;
    }
    // Keep a margin so txs still being indexed by the node near the top are re-read next pass.
    const margin = top > 20n ? top - 20n : 0n;
    if (margin > seen) statements.push(setCursor(name, margin.toString()));
  }
  statements.push(setCursor("head", head.toString()));
  if (statements.length) await store.batch(statements);
  const refreshed = await refreshStatuses(store, head, cfg, now);
  return { head: head.toString(), evmEvents, nativeEvents, refreshed };
}

/** Recomputes and stores each request's derived status (used for listing and filtering). */
export async function refreshStatuses(store: Store, head: bigint, cfg: Config, now = new Date()) {
  const rows = await store.all<{ id: string; request_json: string; status: string }>(
    "SELECT id, request_json, status FROM requests",
  );
  const statements: Statement[] = [];
  for (const row of rows) {
    const rec = await reconcileStored(store, row.id, row.request_json, head, cfg, now);
    statements.push([
      "UPDATE requests SET status = ?, paid = ?, pending = ?, updated_at = ? WHERE id = ?",
      rec.status,
      rec.paid.toString(),
      rec.pending.toString(),
      now.toISOString(),
      row.id,
    ]);
  }
  if (statements.length) await store.batch(statements);
  return statements.length;
}

export async function reconcileStored(
  store: Store,
  id: string,
  requestJson: string,
  head: bigint,
  cfg: Config,
  now = new Date(),
) {
  const events = await store.all<EventRow>(
    "SELECT * FROM events WHERE request_id = ? ORDER BY block_height, tx_hash, idx",
    id.toLowerCase(),
  );
  return reconcile(
    id as `0x${string}`,
    deserializeRequest(JSON.parse(requestJson) as SerializedRequest),
    events.map(rowToEvent),
    {
      now: BigInt(Math.floor(now.getTime() / 1000)),
      headHeight: head,
      minConfirmations: cfg.minConfirmations,
    },
  );
}
