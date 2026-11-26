import { afterEach, expect, test, vi } from "vite-plus/test";
import { api } from "../src/api";
import { config } from "../src/config";
import type { ChainSource } from "../src/chain";

const origin = "https://chit.antarktier.com";
const apiOrigin = "https://chit-api.antarktier.com";
const upstream = "https://rest.example";
const address = "qor12k54uyuewqjus6pvjzpc2z4c6kw5m7m4ukr95a";
const balancePath = `/cosmos/bank/v1beta1/balances/${address}/by_denom`;
const accountPath = `/cosmos/auth/v1beta1/accounts/${address}`;
const txs = "/cosmos/tx/v1beta1/txs";
const txPath = `${txs}/${"AB".repeat(32)}`;
const cfg = config({
  CHIT_PAY: "0x0000000000000000000000000000000000000001",
  CHIT_REST_URL: upstream,
});
const chain: ChainSource = {
  head: async () => 1n,
  paymentLogs: async () => [],
  nativeTxsTo: async () => [],
  evmTxEvents: async () => [],
  nativeTx: async () => undefined,
  pqKey: async () => ({ registered: false, possessionProven: false }),
};
const handle = api({ all: async () => [], batch: async () => {} }, chain, cfg);

function proxy(path: string, init?: RequestInit) {
  return handle(new Request(`${apiOrigin}/v1/qore${path}`, init));
}

afterEach(() => vi.unstubAllGlobals());

test("Diana status advertises the proxy on the incoming API origin", async () => {
  const response = await handle(new Request("https://api.example/v1/status"));
  expect(await response.json()).toMatchObject({
    restUrl: "https://api.example/v1/qore",
    evmUrl: cfg.evmUrl,
  });
});

test.each([
  [balancePath + "?denom=uqor", 200, "public, max-age=10"],
  [accountPath, 200, "no-store"],
  [txPath, 200, "public, max-age=60"],
  [txPath, 404, "no-store"],
  [accountPath, 400, "no-store"],
] as const)("forwards GET %s with upstream status %i", async (path, status, cache) => {
  const payload = { code: status };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(payload, { status, headers: { "set-cookie": "upstream=1" } }));
  vi.stubGlobal("fetch", fetchMock);
  const response = await proxy(path, {
    headers: { origin, cookie: "browser=1", authorization: "Bearer browser", connection: "close" },
  });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    upstream + path,
    expect.objectContaining({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: new Headers({ "user-agent": "Chit/1.0" }),
    }),
  );
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(payload);
  expect(response.headers.get("cache-control")).toBe(cache);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  expect(response.headers.get("vary")).toBe("origin");
  expect(response.headers.has("set-cookie")).toBe(false);
});

test("handles broadcast preflight locally and forwards the POST body verbatim", async () => {
  const payload = '{ "tx_bytes": "AA==", "mode": "BROADCAST_MODE_SYNC" }';
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ tx_response: { code: 0 } }));
  vi.stubGlobal("fetch", fetchMock);
  const preflight = await proxy(txs, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  expect(preflight.headers.get("access-control-allow-headers")).toBe("content-type");
  expect(fetchMock).not.toHaveBeenCalled();

  const response = await proxy(txs, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: payload,
  });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    upstream + txs,
    expect.objectContaining({
      method: "POST",
      headers: new Headers({ "user-agent": "Chit/1.0", "content-type": "application/json" }),
      body: new TextEncoder().encode(payload),
    }),
  );
  expect(await response.json()).toEqual({ tx_response: { code: 0 } });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
});

test.each([
  ["GET", txs],
  ["GET", txs + "?events=message.sender"],
  ["GET", txPath + "?extra=1"],
  ["GET", txPath.toLowerCase()],
  ["GET", txs + "/AB"],
  ["GET", accountPath + "?extra=1"],
  ["GET", accountPath.slice(0, -1) + "q"],
  ["GET", balancePath],
  ["GET", balancePath + "?denom=other"],
  ["GET", balancePath + "?denom=uqor&denom=uqor"],
  ["GET", "/qore/pqc/v1/accounts/" + address],
  ["POST", "/cosmos/tx/v1beta1/encode"],
  ["POST", "/cosmos/tx/v1beta1/simulate"],
  ["POST", txs + "?extra=1"],
  ["HEAD", accountPath],
  ["OPTIONS", "/cosmos/tx/v1beta1/simulate"],
])("rejects %s %s without calling upstream", async (method, path) => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const response = await proxy(path, {
    method,
    headers: { "access-control-request-method": "POST" },
  });
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("rejects a non-JSON broadcast and caps bodies without a Content-Length", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  expect((await proxy(txs, { method: "POST", body: "hello" })).status).toBe(415);
  const response = await proxy(txs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: " ".repeat(64 * 1024 + 1),
  });
  expect(response.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});
