import { mldsa87 } from "@qorechain/pqc";
import type { MessageSignature } from "@qorechain/qoresign";
import {
  buildReceipt,
  deserializeRequest,
  eventKey,
  EVM_CHAIN_ID,
  fromBech32,
  NATIVE_CHAIN_ID,
  nativePaymentEvents,
  hashDetails,
  isValidReference,
  requestId,
  serializeRequest,
  signReceipt,
  toBech32,
  verifyRequest,
  type Reconciliation,
  type SerializedRequest,
} from "@chit/core";
import { bytesToHex, getAddress, hexToBytes, isAddress, type Hex } from "viem";
import { z, ZodError } from "zod";
import type { ChainSource } from "./chain";
import { originAllowed, type Config } from "./config";
import { indexOnce, insertEvent, reconcileStored, refreshStatuses } from "./indexer";
import type { Store } from "./store";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const address = z.string().refine((v) => isAddress(v), "Expected a 0x address");
const serializedRequest = z.strictObject({
  merchant: address,
  recipient: address,
  asset: address,
  amount: z.string().regex(/^[1-9]\d{0,77}$/),
  expiresAt: z.string().regex(/^\d{1,20}$/),
  reference: z.string().refine(isValidReference, "Invalid payment reference"),
  detailsHash: hex.length(66),
  partialAllowed: z.boolean(),
  payContract: address,
  chainId: z.string().regex(/^\d+$/),
});
const createBody = z.strictObject({
  request: serializedRequest,
  signature: z.looseObject({ signatureType: z.string() }),
  details: z.string().max(2000),
});
const paymentBody = z.strictObject({
  txHash: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
  source: z.enum(["evm", "native"]),
});
const listQuery = z.strictObject({
  status: z.enum(["unpaid", "partially_paid", "completed", "overpaid", "expired"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const exportQuery = z.strictObject({
  format: z.enum(["csv", "json"]).default("csv"),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

interface RequestRow {
  id: string;
  merchant: string;
  reference: string;
  recipient: string;
  asset: string;
  amount: string;
  expires_at: number;
  partial_allowed: number;
  details: string;
  request_json: string;
  signature_json: string;
  created_at: string;
  status: string;
  paid: string;
  pending: string;
  updated_at: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } },
  );
}

const qorePrefix = "/v1/qore";
const cosmosTxs = "/cosmos/tx/v1beta1/txs";
const maxBroadcastBytes = 64 * 1024;

function qoreCache(method: string | null, path: string, search: string) {
  if (method === "POST" && path === cosmosTxs && !search) return "no-store";
  if (method !== "GET") return;
  if (
    !search &&
    path.startsWith(cosmosTxs + "/") &&
    /^[0-9A-F]{64}$/.test(path.slice(cosmosTxs.length + 1))
  )
    return "public, max-age=60";
  const balance = /^\/cosmos\/bank\/v1beta1\/balances\/(qor1[0-9a-z]{38})\/by_denom$/.exec(path);
  const account = /^\/cosmos\/auth\/v1beta1\/accounts\/(qor1[0-9a-z]{38})$/.exec(path);
  const address = search === "?denom=uqor" ? balance?.[1] : !search ? account?.[1] : undefined;
  if (!address) return;
  try {
    fromBech32(address);
    return balance ? "public, max-age=10" : "no-store";
  } catch {
    return;
  }
}

async function qoreProxy(req: Request, url: URL, restUrl: string) {
  const path = url.pathname.slice(qorePrefix.length);
  const preflight = req.method === "OPTIONS";
  const cache = qoreCache(
    preflight ? req.headers.get("access-control-request-method") : req.method,
    path,
    url.search,
  );
  if (!cache) throw new HttpError(404, "Not found");
  if (preflight) return new Response(null, { status: 204 });

  const headers = new Headers({ "user-agent": "Chit/1.0" });
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (req.method === "POST") {
    const contentType = req.headers.get("content-type");
    if (contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json")
      throw new HttpError(415, "Expected application/json");
    if (Number(req.headers.get("content-length")) > maxBroadcastBytes)
      throw new HttpError(413, "Broadcast body exceeds 64 KiB");
    headers.set("content-type", "application/json");
    const bytes = new Uint8Array(maxBroadcastBytes);
    let length = 0;
    if (req.body) {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (length + value.byteLength > bytes.byteLength) {
          void reader.cancel().catch(() => {});
          throw new HttpError(413, "Broadcast body exceeds 64 KiB");
        }
        bytes.set(value, length);
        length += value.byteLength;
      }
    }
    body = bytes.subarray(0, length);
  }

  let upstream: Response;
  try {
    upstream = await fetch(restUrl.replace(/\/$/, "") + path + url.search, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      throw new Error("Unexpected QoreChain REST redirect");
    }
  } catch {
    return json({ error: "QoreChain REST is unavailable" }, 502, { "cache-control": "no-store" });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": upstream.status === 200 ? cache : "no-store",
    },
  });
}

function recJson(rec: Reconciliation) {
  return {
    status: rec.status,
    requested: rec.requested.toString(),
    paid: rec.paid.toString(),
    pending: rec.pending.toString(),
    outstanding: rec.outstanding.toString(),
    overpaidBy: rec.overpaidBy.toString(),
    unattributed: rec.unattributed.toString(),
    completedAt: rec.completedAt && {
      txHash: rec.completedAt.txHash,
      blockHeight: rec.completedAt.blockHeight.toString(),
      blockTime: rec.completedAt.blockTime.toString(),
    },
  };
}

function summary(r: RequestRow) {
  return {
    id: r.id,
    merchant: r.merchant,
    reference: r.reference,
    recipient: r.recipient,
    asset: r.asset,
    amount: r.amount,
    expiresAt: String(r.expires_at),
    partialAllowed: Boolean(r.partial_allowed),
    details: r.details,
    createdAt: r.created_at,
    status: r.status,
    paid: r.paid,
    pending: r.pending,
    updatedAt: r.updated_at,
  };
}

function csvCell(v: string | number) {
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function attestationKey(cfg: Config) {
  if (!cfg.attestationSeed) return undefined;
  const seed = hexToBytes(cfg.attestationSeed as Hex);
  if (seed.length !== 32) throw new Error("CHIT_ATTESTATION_SEED must be 32 bytes");
  return mldsa87.keygen(seed);
}

export function api(store: Store, chain: ChainSource, cfg: Config) {
  const key = attestationKey(cfg);
  const keyHex = key ? bytesToHex(key.publicKey) : undefined;

  async function head() {
    // Live head so confirmations are current; fall back to the indexer's last seen head.
    try {
      return await chain.head();
    } catch {
      const [row] = await store.all<{ value: string }>(
        "SELECT value FROM cursors WHERE name = 'head'",
      );
      if (!row) throw new HttpError(503, "QoreChain RPC is unavailable");
      return BigInt(row.value);
    }
  }

  async function loadRow(id: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(id))
      throw new HttpError(400, "Request ID must be a 32-byte hex value");
    const [row] = await store.all<RequestRow>(
      "SELECT * FROM requests WHERE id = ?",
      id.toLowerCase(),
    );
    if (!row) throw new HttpError(404, "No payment request with this ID");
    return row;
  }

  async function scan(scope: { recipient: string } | { merchant: string }) {
    try {
      return BigInt((await indexOnce(store, chain, cfg, scope)).head);
    } catch {
      // A chain outage must leave already indexed payment evidence readable.
      return head();
    }
  }

  async function detail(row: RequestRow, scanPayments = true) {
    const h = scanPayments ? await scan({ recipient: row.recipient }) : await head();
    const rec = await reconcileStored(store, row.id, row.request_json, h, cfg);
    return {
      id: row.id,
      request: JSON.parse(row.request_json) as SerializedRequest,
      signature: JSON.parse(row.signature_json) as unknown,
      details: row.details,
      createdAt: row.created_at,
      headHeight: h.toString(),
      reconciliation: recJson(rec),
      events: rec.events.map((e) => ({
        key: e.key,
        source: e.event.source,
        txHash: e.event.txHash,
        index: e.event.index,
        blockHeight: e.event.blockHeight.toString(),
        blockTime: e.event.blockTime.toString(),
        payer: e.event.payer,
        amount: e.event.amount.toString(),
        confirmations: e.confirmations.toString(),
        class: e.class,
        explorerUrl: cfg.explorer ? `${cfg.explorer}/tx/${String(e.event.txHash)}` : null,
      })),
      rec,
    };
  }

  async function create(body: z.infer<typeof createBody>) {
    let request;
    try {
      request = deserializeRequest(body.request as SerializedRequest);
    } catch (error) {
      throw new HttpError(422, error instanceof Error ? error.message : "Invalid request");
    }
    if (request.chainId !== EVM_CHAIN_ID)
      throw new HttpError(422, "Request is not for Diana (chain 9800)");
    if (request.payContract !== cfg.chitPay)
      throw new HttpError(422, "Request names a different payment contract");
    if (hashDetails(body.details) !== body.request.detailsHash.toLowerCase())
      throw new HttpError(422, "Details do not match the signed details hash");
    const id = requestId(request).toLowerCase();
    const pq = await chain.pqKey(toBech32(request.merchant));
    if (!pq.registered || !pq.possessionProven || !pq.publicKey)
      throw new HttpError(
        422,
        "Merchant has no ML-DSA-87 key with proof of possession on QoreChain",
      );
    if (!verifyRequest(request, body.signature as unknown as MessageSignature, pq.publicKey))
      throw new HttpError(
        422,
        "Merchant signature does not verify against the on-chain ML-DSA-87 key",
      );
    const [existing] = await store.all<{ id: string }>(
      "SELECT id FROM requests WHERE merchant = ? AND reference = ?",
      request.merchant,
      request.reference,
    );
    if (existing && existing.id !== id)
      throw new HttpError(409, "This reference is already used by another request");
    if (existing) return { status: 200, id };
    const now = new Date().toISOString();
    const h = await head();
    const backfill = [];
    for (let from = cfg.startBlock; from <= h; from += 2_000n) {
      const to = from + 1_999n < h ? from + 1_999n : h;
      for (const event of await chain.paymentLogs(from, to, id as Hex))
        backfill.push(insertEvent(event, eventKey(event), now));
    }
    try {
      await store.batch([
        [
          "INSERT INTO requests (id, merchant, reference, recipient, asset, amount, expires_at, partial_allowed, pay_contract, details, request_json, signature_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          request.merchant,
          request.reference,
          request.recipient,
          request.asset,
          request.amount.toString(),
          Number(request.expiresAt),
          request.partialAllowed ? 1 : 0,
          request.payContract,
          body.details,
          JSON.stringify(serializeRequest(request)),
          JSON.stringify(body.signature),
          now,
          now,
        ],
        // Rescan this recipient's native history so payments made before registration are found.
        ["DELETE FROM cursors WHERE name = ?", `native:${toBech32(request.recipient)}`],
        ...backfill,
      ]);
    } catch (error) {
      const [winner] = await store.all<{ id: string }>(
        "SELECT id FROM requests WHERE merchant = ? AND reference = ?",
        request.merchant,
        request.reference,
      );
      if (!winner) throw error;
      if (winner.id !== id)
        throw new HttpError(409, "This reference is already used by another request");
      return { status: 200, id };
    }
    return { status: 201, id };
  }

  function range(merchant: string, q: { from?: string; to?: string }) {
    const where = ["merchant = ?"];
    const params: (string | number)[] = [merchant];
    if (q.from) {
      where.push("created_at >= ?");
      params.push(q.from);
    }
    if (q.to) {
      where.push("created_at <= ?");
      params.push(q.to);
    }
    return { where, params };
  }

  async function route(req: Request, url: URL): Promise<Response> {
    const parts = url.pathname.split("/").filter(Boolean);
    const query = Object.fromEntries(url.searchParams);
    if (parts[0] !== "v1") throw new HttpError(404, "Not found");
    if (req.method === "GET" && parts[1] === "status" && parts.length === 2) {
      const h = await chain.head();
      const [evm] = await store.all<{ value: string }>(
        "SELECT value FROM cursors WHERE name = 'evm_block'",
      );
      const indexed = evm ? BigInt(evm.value) : cfg.startBlock;
      return json({
        environment: cfg.environment,
        chainId: EVM_CHAIN_ID.toString(),
        nativeChainId: NATIVE_CHAIN_ID,
        evmUrl: cfg.evmUrl,
        restUrl: cfg.environment === "DIANA" ? url.origin + qorePrefix : cfg.restUrl,
        explorer: cfg.explorer,
        chitPay: cfg.chitPay,
        headHeight: h.toString(),
        indexedHeight: indexed.toString(),
        lagBlocks: (h > indexed ? h - indexed : 0n).toString(),
        minConfirmations: cfg.minConfirmations.toString(),
        attestationKey: keyHex ?? null,
      });
    }
    if (parts[1] === "requests") {
      if (req.method === "POST" && parts.length === 2) {
        const body = createBody.parse(await req.json().catch(() => ({})));
        const { status, id } = await create(body);
        const row = await loadRow(id);
        const { rec: _rec, ...out } = await detail(row, false);
        return json(out, status);
      }
      if (req.method === "GET" && parts[2] === "by-reference" && parts.length === 5) {
        const merchant = getAddress(address.parse(parts[3]));
        const reference = decodeURIComponent(parts[4] ?? "");
        const [row] = await store.all<RequestRow>(
          "SELECT * FROM requests WHERE merchant = ? AND reference = ?",
          merchant,
          reference,
        );
        if (!row) throw new HttpError(404, "No payment request with this reference");
        const { rec: _rec, ...out } = await detail(row);
        return json(out);
      }
      if (req.method === "GET" && parts.length === 3) {
        const { rec: _rec, ...out } = await detail(await loadRow(parts[2]!));
        return json(out);
      }
      if (req.method === "GET" && parts.length === 4 && parts[3] === "receipt") {
        if (!key) throw new HttpError(503, "Receipt attestation key is not configured");
        const row = await loadRow(parts[2]!);
        const d = await detail(row);
        const receipt = buildReceipt(d.request, d.signature, d.rec, new Date());
        return json(
          signReceipt(receipt, key),
          200,
          url.searchParams.has("download")
            ? {
                "content-disposition": `attachment; filename="chit-receipt-${d.request.reference}.json"`,
              }
            : undefined,
        );
      }
    }
    if (req.method === "GET" && parts[1] === "merchants" && parts.length === 4) {
      const merchant = getAddress(address.parse(parts[2]));
      if (parts[3] === "requests") {
        const q = listQuery.parse(query);
        await refreshStatuses(store, await scan({ merchant }), cfg, new Date(), merchant);
        const { where, params } = range(merchant, q);
        if (q.status) {
          where.push("status = ?");
          params.push(q.status);
        }
        const items = await store.all<RequestRow>(
          `SELECT * FROM requests WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          ...params,
          q.limit,
          q.offset,
        );
        const [count] = await store.all<{ n: number }>(
          `SELECT COUNT(*) AS n FROM requests WHERE ${where.join(" AND ")}`,
          ...params,
        );
        return json({ items: items.map(summary), total: count?.n ?? 0 });
      }
      if (parts[3] === "summary") {
        const q = exportQuery.omit({ format: true }).parse(query);
        await refreshStatuses(store, await scan({ merchant }), cfg, new Date(), merchant);
        const { where, params } = range(merchant, q);
        const rows = await store.all<RequestRow>(
          `SELECT * FROM requests WHERE ${where.join(" AND ")}`,
          ...params,
        );
        const byStatus: Record<string, number> = {
          unpaid: 0,
          partially_paid: 0,
          completed: 0,
          overpaid: 0,
          expired: 0,
        };
        let requested = 0n;
        let received = 0n;
        let outstanding = 0n;
        const assets = new Map<
          string,
          { requested: bigint; received: bigint; outstanding: bigint }
        >();
        for (const r of rows) {
          byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
          const amount = BigInt(r.amount);
          const paid = BigInt(r.paid);
          const owed =
            (r.status === "unpaid" || r.status === "partially_paid") && amount > paid
              ? amount - paid
              : 0n;
          const totals = assets.get(r.asset) ?? { requested: 0n, received: 0n, outstanding: 0n };
          totals.requested += amount;
          totals.received += paid;
          totals.outstanding += owed;
          assets.set(r.asset, totals);
          requested += amount;
          received += paid;
          outstanding += owed;
        }
        return json({
          merchant,
          requests: rows.length,
          byStatus,
          requested: requested.toString(),
          received: received.toString(),
          outstanding: outstanding.toString(),
          byAsset: Array.from(assets, ([asset, totals]) => ({
            asset,
            requested: totals.requested.toString(),
            received: totals.received.toString(),
            outstanding: totals.outstanding.toString(),
          })),
        });
      }
      if (parts[3] === "export") {
        const q = exportQuery.parse(query);
        const h = await scan({ merchant });
        await refreshStatuses(store, h, cfg, new Date(), merchant);
        const { where, params } = range(merchant, q);
        const rows = await store.all<RequestRow>(
          `SELECT * FROM requests WHERE ${where.join(" AND ")} ORDER BY created_at`,
          ...params,
        );
        const records = [];
        for (const r of rows) {
          const rec = await reconcileStored(store, r.id, r.request_json, h, cfg);
          records.push({ row: r, rec });
        }
        if (q.format === "json")
          return json(
            records.map(({ row, rec }) => ({
              ...summary(row),
              reconciliation: recJson(rec),
              payments: rec.events.map((e) => ({
                source: e.event.source,
                txHash: e.event.txHash,
                blockHeight: e.event.blockHeight.toString(),
                blockTime: new Date(Number(e.event.blockTime) * 1000).toISOString(),
                payer: e.event.payer,
                amount: e.event.amount.toString(),
                class: e.class,
              })),
            })),
            200,
            { "content-disposition": `attachment; filename="chit-${merchant}.json"` },
          );
        const header = [
          "record",
          "request_id",
          "reference",
          "created_at",
          "expires_at",
          "asset",
          "requested_wei",
          "status",
          "paid_wei",
          "outstanding_wei",
          "tx_hash",
          "source",
          "block_height",
          "block_time",
          "payer",
          "amount_wei",
          "classification",
          "details",
        ];
        const lines = [header.join(",")];
        for (const { row, rec } of records) {
          const base = [
            row.id,
            row.reference,
            row.created_at,
            new Date(row.expires_at * 1000).toISOString(),
            row.asset,
            row.amount,
            rec.status,
            rec.paid.toString(),
            rec.outstanding.toString(),
          ];
          lines.push(
            ["request", ...base, "", "", "", "", "", "", "", row.details].map(csvCell).join(","),
          );
          for (const e of rec.events)
            lines.push(
              [
                "payment",
                ...base,
                String(e.event.txHash),
                e.event.source,
                e.event.blockHeight.toString(),
                new Date(Number(e.event.blockTime) * 1000).toISOString(),
                e.event.payer,
                e.event.amount.toString(),
                e.class,
                "",
              ]
                .map(csvCell)
                .join(","),
            );
        }
        return new Response(lines.join("\r\n") + "\r\n", {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="chit-${merchant}.csv"`,
          },
        });
      }
    }
    if (req.method === "POST" && parts[1] === "payments" && parts.length === 2) {
      // Fast path: index one tx now. The server reads the tx from chain and never trusts the client.
      const body = paymentBody.parse(await req.json().catch(() => ({})));
      const hash = (
        body.txHash.startsWith("0x") ? body.txHash : `0x${body.txHash}`
      ).toLowerCase() as Hex;
      let events;
      if (body.source === "evm") events = await chain.evmTxEvents(hash);
      else {
        const tx = await chain.nativeTx(hash);
        events = tx ? nativePaymentEvents(tx) : [];
      }
      const ids = new Set(
        (await store.all<{ id: string }>("SELECT id FROM requests")).map((r) => r.id),
      );
      const matched = events.filter((e) => ids.has(e.requestId.toLowerCase()));
      if (!matched.length)
        throw new HttpError(404, "No confirmed Chit payment found in this transaction yet");
      const now = new Date().toISOString();
      await store.batch(matched.map((e) => insertEvent(e, eventKey(e), now)));
      await refreshStatuses(store, await chain.head(), cfg);
      return json(
        {
          requestIds: [...new Set(matched.map((e) => e.requestId.toLowerCase()))],
          events: matched.length,
        },
        202,
      );
    }
    if (
      req.method === "GET" &&
      parts[1] === "payments" &&
      parts[2] === "recent" &&
      parts.length === 3
    ) {
      const merchant = url.searchParams.get("merchant");
      const rows = merchant
        ? await store.all(
            "SELECT e.*, r.reference FROM events e JOIN requests r ON r.id = e.request_id WHERE r.merchant = ? ORDER BY e.block_height DESC LIMIT 50",
            getAddress(address.parse(merchant)),
          )
        : await store.all(
            "SELECT e.*, r.reference FROM events e JOIN requests r ON r.id = e.request_id ORDER BY e.block_height DESC LIMIT 50",
          );
      return json({ items: rows });
    }
    throw new HttpError(404, "Not found");
  }

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    const cors: Record<string, string> =
      origin && originAllowed(origin, cfg.corsOrigins)
        ? {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "86400",
            vary: "origin",
          }
        : { vary: "origin" };
    let res: Response;
    const url = new URL(req.url);
    const proxy = url.pathname === qorePrefix || url.pathname.startsWith(qorePrefix + "/");
    if (req.method === "OPTIONS" && !proxy) res = new Response(null, { status: 204 });
    else
      try {
        res = proxy ? await qoreProxy(req, url, cfg.restUrl) : await route(req, url);
      } catch (error) {
        if (error instanceof HttpError) res = json({ error: error.message }, error.status);
        else if (error instanceof ZodError)
          res = json(
            {
              error: error.issues
                .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
                .join("; "),
            },
            400,
          );
        else {
          console.error(error);
          res = json({ error: "The service could not complete this request" }, 500);
        }
      }
    if (proxy && !res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  };
}
