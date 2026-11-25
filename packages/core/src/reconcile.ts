import { getAddress, type Address, type Hex } from "viem";
import type { PaymentRequest } from "./request";

export type PaymentStatus = "unpaid" | "partially_paid" | "completed" | "overpaid" | "expired";

/** A transfer observed on QoreChain that references a Chit request. */
export interface PaymentEvent {
  /** "evm" = ChitPay PaymentReceived log, "native" = bank MsgSend with a chit memo. */
  source: "evm" | "native";
  txHash: string;
  /** Log index (EVM) or message index (native). Together with txHash it is the idempotency key. */
  index: number;
  blockHeight: bigint;
  /** Unix seconds of the including block. */
  blockTime: bigint;
  requestId: Hex;
  payer: string;
  recipient: Address;
  asset: Address;
  amount: bigint;
}

export type EventClass =
  | "counted"
  | "pending"
  | "duplicate"
  | "late"
  | "wrong_recipient"
  | "wrong_asset"
  | "partial_not_allowed";

export interface ClassifiedEvent {
  event: PaymentEvent;
  key: string;
  confirmations: bigint;
  class: EventClass;
}

export interface Reconciliation {
  requestId: Hex;
  status: PaymentStatus;
  requested: bigint;
  /** Confirmed, valid value received before expiry. */
  paid: bigint;
  /** Value awaiting confirmations. */
  pending: bigint;
  outstanding: bigint;
  overpaidBy: bigint;
  /** Value that arrived but cannot count (late, wrong recipient/asset); candidates for refund. */
  unattributed: bigint;
  events: ClassifiedEvent[];
  completedAt?: { txHash: string; blockHeight: bigint; blockTime: bigint };
}

export interface ReconcileOptions {
  now: bigint;
  headHeight: bigint;
  minConfirmations: bigint;
}

export function eventKey(e: Pick<PaymentEvent, "source" | "txHash" | "index">): string {
  return `${e.source}:${String(e.txHash).toLowerCase()}:${e.index}`;
}

function order(a: PaymentEvent, b: PaymentEvent): number {
  if (a.blockHeight !== b.blockHeight) return a.blockHeight < b.blockHeight ? -1 : 1;
  const ka = eventKey(a);
  const kb = eventKey(b);
  if (String(a.txHash) === String(b.txHash)) return a.index - b.index;
  return ka < kb ? -1 : 1;
}

/**
 * Derives a request's status from confirmed chain events only. Pure and idempotent:
 * re-processing the same event (same source/txHash/index) never changes the result.
 */
export function reconcile(
  id: Hex,
  request: PaymentRequest,
  events: readonly PaymentEvent[],
  opts: ReconcileOptions,
): Reconciliation {
  const seen = new Set<string>();
  const unique: PaymentEvent[] = [];
  for (const e of events) {
    if (e.requestId.toLowerCase() !== id.toLowerCase()) continue;
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  unique.sort(order);

  const recipient = getAddress(request.recipient);
  const asset = getAddress(request.asset);
  let paid = 0n;
  let pending = 0n;
  let unattributed = 0n;
  let completedAt: Reconciliation["completedAt"];
  const classified: ClassifiedEvent[] = [];

  for (const e of unique) {
    const confirmations =
      opts.headHeight >= e.blockHeight ? opts.headHeight - e.blockHeight + 1n : 0n;
    const key = eventKey(e);
    let cls: EventClass;
    if (getAddress(e.recipient) !== recipient) cls = "wrong_recipient";
    else if (getAddress(e.asset) !== asset) cls = "wrong_asset";
    else if (e.blockTime > request.expiresAt) cls = "late";
    else if (confirmations < opts.minConfirmations) cls = "pending";
    else if (paid >= request.amount) cls = "duplicate";
    else if (!request.partialAllowed && paid + e.amount < request.amount)
      cls = "partial_not_allowed";
    else cls = "counted";

    if (cls === "counted") {
      paid += e.amount;
      if (!completedAt && paid >= request.amount)
        completedAt = {
          txHash: String(e.txHash),
          blockHeight: e.blockHeight,
          blockTime: e.blockTime,
        };
    } else if (cls === "pending") pending += e.amount;
    else if (cls === "duplicate") paid += e.amount;
    else unattributed += e.amount;
    classified.push({ event: e, key, confirmations, class: cls });
  }

  const outstanding = paid >= request.amount ? 0n : request.amount - paid;
  const overpaidBy = paid > request.amount ? paid - request.amount : 0n;
  let status: PaymentStatus;
  if (overpaidBy > 0n) status = "overpaid";
  else if (paid === request.amount) status = "completed";
  else if (opts.now > request.expiresAt) status = "expired";
  else if (paid > 0n) status = "partially_paid";
  else status = "unpaid";

  return {
    requestId: id,
    status,
    requested: request.amount,
    paid,
    pending,
    outstanding,
    overpaidBy,
    unattributed,
    events: classified,
    completedAt,
  };
}

/** Allowed status transitions as new confirmed events arrive or time passes. */
export const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ["partially_paid", "completed", "overpaid", "expired"],
  partially_paid: ["completed", "overpaid", "expired"],
  completed: ["overpaid"],
  overpaid: [],
  expired: [],
};

export function isTransitionAllowed(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Native bank-send memo that binds a transfer to a request: `chit:v1:<requestId>`. */
export const MEMO_PREFIX = "chit:v1:";

export function memoForRequest(id: Hex): string {
  return `${MEMO_PREFIX}${id.toLowerCase()}`;
}

export function requestIdFromMemo(memo: string): Hex | undefined {
  const m = /^chit:v1:(0x[0-9a-f]{64})$/.exec(memo.trim().toLowerCase());
  return m ? (m[1] as Hex) : undefined;
}

export type { Address };
