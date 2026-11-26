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

export function insertEvent(
  e: PaymentEvent,
  key: string,
  now: string,
  knownOnly = false,
): Statement {
  // INSERT OR IGNORE on the (source, txHash, index) key makes indexing idempotent.
  return [
    `INSERT OR IGNORE INTO events (key, request_id, source, tx_hash, idx, block_height, block_time, payer, recipient, asset, amount, indexed_at) ${
      knownOnly
        ? "SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM requests WHERE id = ?)"
        : "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    }`,
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
    ...(knownOnly ? [e.requestId.toLowerCase()] : []),
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
  "INSERT INTO cursors (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value WHERE CAST(excluded.value AS INTEGER) > CAST(cursors.value AS INTEGER)",
  name,
  value,
];

type ScanScope = { recipient: string } | { merchant: string };

async function indexEvm(store: Store, chain: ChainSource, cfg: Config, head: bigint, iso: string) {
  const last = await cursor(store, "evm_block");
  const from = last ? BigInt(last) + 1n : cfg.startBlock;
  const until = scanEnd(from, head, cfg.blocksPerTick);
  let events = 0;
  for (let start = from; start <= until; start += 2_000n) {
    const end = scanEnd(start, until, 2_000n);
    const logs = await chain.paymentLogs(start, end);
    await store.batch([
      ...logs.map((e) => insertEvent(e, eventKey(e), iso)),
      setCursor("evm_block", end.toString()),
    ]);
    events += logs.length;
  }
  return events;
}

function scanEnd(from: bigint, head: bigint, blocks: bigint) {
  const end = from + blocks - 1n;
  return end < head ? end : head;
}

async function indexNative(
  store: Store,
  chain: ChainSource,
  cfg: Config,
  head: bigint,
  iso: string,
  scope?: ScanScope,
) {
  if (cfg.environment === "LOCAL DEVNET") return 0;
  const recipients =
    scope && "recipient" in scope
      ? [scope]
      : await store.all<{ recipient: string }>(
          scope
            ? "SELECT DISTINCT recipient FROM requests WHERE merchant = ?"
            : "SELECT DISTINCT recipient FROM requests",
          ...(scope ? [scope.merchant] : []),
        );
  let events = 0;
  for (const { recipient } of recipients) {
    const bech32 = toBech32(recipient as `0x${string}`);
    const name = `native:${bech32}`;
    const initial = cfg.startBlock - 1n;
    let saved = await cursor(store, name);
    if (saved === undefined) {
      await store.batch([
        ["INSERT OR IGNORE INTO cursors (name, value) VALUES (?, ?)", name, initial.toString()],
      ]);
      saved = await cursor(store, name);
    }
    if (saved === undefined) continue;
    const seen = BigInt(saved);
    const next = seen > initial ? seen + 1n : cfg.startBlock;
    const until = scanEnd(next, head, cfg.blocksPerTick);
    // Overlap the last 20 heights to pick up transactions indexed late by the REST node.
    const from = next - 20n > cfg.startBlock ? next - 20n : cfg.startBlock;
    if (from > until) continue;
    for (let page = 1; ; page++) {
      const txs = await chain.nativeTxsTo(bech32, page, 50, from, until);
      const statements: Statement[] = [];
      for (const tx of txs) {
        for (const e of nativePaymentEvents(tx)) {
          statements.push(insertEvent(e, eventKey(e), iso, true));
          events++;
        }
      }
      if (statements.length) await store.batch(statements);
      if (txs.length < 50) break;
    }
    if (until > seen) {
      // Registration may reset this recipient's cursor while the RPC calls are in flight.
      await store.batch([
        [
          "UPDATE cursors SET value = ? WHERE name = ? AND value = ?",
          until.toString(),
          name,
          saved,
        ],
      ]);
    }
  }
  return events;
}

/** Advances the chain cursors by one bounded pass. */
export async function indexOnce(store: Store, chain: ChainSource, cfg: Config, scope?: ScanScope) {
  const now = new Date();
  const iso = now.toISOString();
  const head = await chain.head();
  await store.batch([setCursor("head", head.toString())]);
  const [evm, native] = await Promise.allSettled([
    indexEvm(store, chain, cfg, head, iso),
    indexNative(store, chain, cfg, head, iso, scope),
  ]);
  if (evm.status === "rejected") throw evm.reason;
  if (native.status === "rejected") throw native.reason;
  const refreshed = scope ? 0 : await refreshStatuses(store, head, cfg, now);
  return { head: head.toString(), evmEvents: evm.value, nativeEvents: native.value, refreshed };
}

/** Recomputes and stores each request's derived status (used for listing and filtering). */
export async function refreshStatuses(
  store: Store,
  head: bigint,
  cfg: Config,
  now = new Date(),
  merchant?: string,
) {
  const rows = await store.all<{ id: string; request_json: string; status: string }>(
    `SELECT id, request_json, status FROM requests${merchant ? " WHERE merchant = ?" : ""}`,
    ...(merchant ? [merchant] : []),
  );
  const statements: Statement[] = [];
  for (const row of rows) {
    const rec = await reconcileStored(store, row.id, row.request_json, head, cfg, now);
    statements.push([
      "UPDATE requests SET status = ?, paid = ?, pending = ?, updated_at = ? WHERE id = ? AND updated_at <= ?",
      rec.status,
      rec.paid.toString(),
      rec.pending.toString(),
      now.toISOString(),
      row.id,
      now.toISOString(),
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
