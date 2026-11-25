import { describe, expect, it } from "vite-plus/test";
import { href, parseRoute } from "./state";

const id = "0x" + "ab".repeat(32);

describe("routes", () => {
  it("parses every route and round-trips through href", () => {
    for (const path of [
      "/",
      "/new",
      "/reports",
      "/key",
      `/requests/${id}`,
      `/pay/${id}`,
      `/receipts/${id}`,
    ])
      expect(href(parseRoute(path))).toBe(path);
  });
  it("normalises IDs and trailing slashes", () => {
    expect(parseRoute(`/pay/${id.toUpperCase().replace("0X", "0x")}/`)).toEqual({
      name: "pay",
      id,
    });
  });
  it("rejects malformed IDs and unknown paths", () => {
    expect(parseRoute("/pay/0x1234").name).toBe("missing");
    expect(parseRoute("/admin").name).toBe("missing");
  });
});
