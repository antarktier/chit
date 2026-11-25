import { describe, expect, it } from "vite-plus/test";
import { exactUnits, formatCount, formatUnits, parseAmount, relative, shortHex } from "./format";

describe("amount formatting", () => {
  it("groups the integer part and trims trailing zeros without floating point", () => {
    expect(formatUnits(1_234_567_890_000_000_000_000n, 18, 6, "en-US")).toBe("1,234.56789");
    expect(formatUnits("1500000000000000000", 18, 6, "en-US")).toBe("1.5");
    expect(formatUnits(0n, 18, 6, "en-US")).toBe("0");
    expect(formatUnits(123_456_789n, 0, 6, "en-US")).toBe("123,456,789");
  });

  it("uses the locale's decimal separator", () => {
    expect(formatUnits(1_500_000n, 6, 6, "de-DE")).toBe("1,5");
  });

  it("caps visible decimals but keeps the exact value available", () => {
    const wei = 1_000_000_000_000_000_001n;
    expect(formatUnits(wei, 18, 6, "en-US")).toBe("1");
    expect(exactUnits(wei, 18)).toBe("1.000000000000000001");
  });
});

describe("parseAmount", () => {
  it("parses decimals exactly", () => {
    expect(parseAmount("1.5", 18)).toEqual({ ok: true, value: 1_500_000_000_000_000_000n });
    expect(parseAmount(" 0.000001 ", 18, 6)).toEqual({ ok: true, value: 1_000_000_000_000n });
  });

  it("rejects ambiguous or invalid input with plain-language errors", () => {
    expect(parseAmount("", 18)).toEqual({ ok: false, error: "Enter an amount." });
    expect(parseAmount("1,000", 18)).toMatchObject({ ok: false });
    expect(parseAmount("-1", 18)).toMatchObject({ ok: false });
    expect(parseAmount("0", 18)).toEqual({ ok: false, error: "Enter an amount greater than 0." });
    expect(parseAmount("1.0000001", 18, 6)).toEqual({
      ok: false,
      error: "Use at most 6 decimal places.",
    });
  });
});

describe("misc", () => {
  it("formats English count labels with locale grouping", () => {
    expect(formatCount(0, "request", "en-US")).toBe("0 requests");
    expect(formatCount("1", "confirmation", "en-US")).toBe("1 confirmation");
    expect(formatCount(2n, "request", "en-US")).toBe("2 requests");
    expect(formatCount(1234, "request", "de-DE")).toBe("1.234 requests");
    expect(parseAmount("1.23", 1)).toEqual({ ok: false, error: "Use at most 1 decimal place." });
  });
  it("shortens hashes", () => {
    expect(shortHex("0x" + "a".repeat(64), 6, 4)).toBe("0xaaaa…aaaa");
    expect(shortHex("0x1234")).toBe("0x1234");
  });
  it("describes relative time", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(relative(new Date("2026-11-26T12:00:00Z"), now, "en")).toBe("tomorrow");
    expect(relative(new Date("2026-11-25T09:00:00Z"), now, "en")).toBe("3 hours ago");
  });
});
