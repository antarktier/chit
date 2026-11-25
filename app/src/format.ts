import type { EventClass, PaymentStatus } from "@chit/core";
import type { BadgeTone } from "./components";

/** Groups the integer part with the user's locale and keeps up to `maxFraction` decimals, exactly (no floats). */
export function formatUnits(
  value: bigint | string,
  decimals: number,
  maxFraction = 6,
  locale?: string,
) {
  const v = typeof value === "string" ? BigInt(value) : value;
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const base = 10n ** BigInt(decimals);
  const integer = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction);
  fraction = fraction.replace(/0+$/, "");
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value ??
    ".";
  const grouped = new Intl.NumberFormat(locale).format(integer);
  return `${negative ? "−" : ""}${grouped}${fraction ? separator + fraction : ""}`;
}

/** Full-precision decimal string without grouping, for titles and exports. */
export function exactUnits(value: bigint | string, decimals: number) {
  const v = typeof value === "string" ? BigInt(value) : value;
  const base = 10n ** BigInt(decimals);
  const fraction = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${fraction ? "." + fraction : ""}`;
}

export type ParsedAmount = { ok: true; value: bigint } | { ok: false; error: string };

/** Parses a typed amount such as `12.5`. Rejects grouping separators so `1,000` is never misread. */
export function parseAmount(input: string, decimals: number, maxFraction = decimals): ParsedAmount {
  const text = input.trim();
  if (!text) return { ok: false, error: "Enter an amount." };
  if (!/^\d+(\.\d+)?$/.test(text))
    return { ok: false, error: "Use digits and one decimal point, for example 12.5." };
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > maxFraction)
    return {
      ok: false,
      error: `Use at most ${maxFraction} decimal places.`,
    };
  const value =
    BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (value <= 0n) return { ok: false, error: "Enter an amount greater than 0." };
  return { ok: true, value };
}

export function dateTime(value: Date | string | number, locale?: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function unixDate(seconds: string | bigint | number) {
  return new Date(Number(seconds) * 1000);
}

/** "in 3 hours" / "2 days ago" relative to `now`. */
export function relative(target: Date, now = new Date(), locale?: string) {
  const seconds = Math.round((target.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(seconds, "second");
}

export function shortHex(value: string, head = 6, tail = 4) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export const statusLabel: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partly paid",
  completed: "Paid",
  overpaid: "Overpaid",
  expired: "Expired",
};

export const statusTone: Record<PaymentStatus, BadgeTone> = {
  unpaid: "neutral",
  partially_paid: "info",
  completed: "success",
  overpaid: "warn",
  expired: "danger",
};

export const eventLabel: Record<EventClass, string> = {
  counted: "Counted",
  pending: "Waiting for confirmations",
  duplicate: "Duplicate",
  late: "After expiry",
  wrong_recipient: "Wrong recipient",
  wrong_asset: "Wrong asset",
  partial_not_allowed: "Partial not allowed",
};

export const eventTone: Record<EventClass, BadgeTone> = {
  counted: "success",
  pending: "info",
  duplicate: "warn",
  late: "danger",
  wrong_recipient: "danger",
  wrong_asset: "danger",
  partial_not_allowed: "danger",
};

/** What a payer or merchant should do about an event class. */
export const eventHelp: Record<EventClass, string> = {
  counted: "Counts toward the request.",
  pending: "Counts once the block has enough confirmations.",
  duplicate: "Arrived after the request was already paid. Refund it or keep it as credit.",
  late: "Arrived after the request expired. It does not count; refund it if needed.",
  wrong_recipient: "Sent to a different address than the request names.",
  wrong_asset: "Paid in a different asset than the request names.",
  partial_not_allowed:
    "Smaller than the outstanding amount, and this request needs one full payment.",
};
