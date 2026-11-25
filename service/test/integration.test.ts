// Integration + security tests: real ML-DSA-87 signing, the Chit API, and ChitPay on a LOCAL DEVNET
// (Anvil with the clearly labelled TEST-ONLY PQC mock precompile). No Diana funds are used.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { mldsa87 } from "@qorechain/pqc";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import {
  chitPayAbi,
  EVM_CHAIN_ID,
  generateReference,
  hashDetails,
  NATIVE_ASSET,
  referenceToBytes32,
  requestId,
  serializeRequest,
  signRequest,
  verifyReceiptAttestation,
  type PaymentRequest,
  type SignedReceipt,
} from "@chit/core";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  hexToBytes,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

const anvilPort = 18_545 + Math.floor(Math.random() * 500);
const apiPort = anvilPort + 1000;
const deploymentPath = `/tmp/chit-it-${anvilPort}.json`;
const api = `http://127.0.0.1:${apiPort}`;
let devnet: ChildProcess;
let chitPay: Address;
const chain = {
  id: 9800,
  name: "devnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [`http://127.0.0.1:${anvilPort}`] } },
} as const;
const pub = createPublicClient({ chain, transport: http() });

const merchantKey: Hex = `0x${"42".repeat(32)}`;
const merchant = privateKeyToAccount(merchantKey);
const classical = classicalKeyFromPrivate(hexToBytes(merchantKey), "eth_secp256k1");
const pq = mldsa87.keygen(new Uint8Array(32).fill(5));
const payer = privateKeyToAccount(`0x${"43".repeat(32)}`);
const payerWallet = createWalletClient({ account: payer, chain, transport: http() });

async function post(path: string, body: unknown) {
  const res = await fetch(api + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
    headers: res.headers,
  };
}

function makeRequest(amount: bigint, partialAllowed = true, expiresIn = 3600n): PaymentRequest {
  return {
    merchant: merchant.address,
    recipient: merchant.address,
    asset: NATIVE_ASSET,
    amount,
    expiresAt: BigInt(Math.floor(Date.now() / 1000)) + expiresIn,
    reference: generateReference(),
    detailsHash: hashDetails("Integration invoice"),
    partialAllowed,
    payContract: chitPay,
    chainId: EVM_CHAIN_ID,
  };
}

async function pay(req: PaymentRequest, sig: Hex, value: bigint) {
  const { reference: _ref, ...rest } = req;
  const hash = await payerWallet.sendTransaction({
    to: chitPay,
    value,
    data: encodeFunctionData({
      abi: chitPayAbi,
      functionName: "payNative",
      args: [{ ...rest, paymentRef: referenceToBytes32(req.reference) }, sig],
    }),
  });
  await pub.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  return hash;
}

beforeAll(async () => {
  devnet = spawn("bun", ["scripts/devnet.ts"], {
    env: {
      ...process.env,
      ANVIL_PORT: String(anvilPort),
      CHIT_API_PORT: String(apiPort),
      CHIT_LOCAL_DEPLOYMENT: deploymentPath,
    },
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("devnet did not start")), 45_000);
    devnet.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("LOCAL DEVNET API http")) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  chitPay = (JSON.parse(readFileSync(deploymentPath, "utf8")) as { chitPay: Address }).chitPay;
  await post("/local/fund", { address: payer.address });
  await post("/local/register-key", {
    address: merchant.address,
    publicKey: bytesToHex(pq.publicKey),
  });
}, 60_000);

afterAll(async () => {
  devnet?.stdout?.destroy();
  // `bun` may be a shell wrapper, so signal the whole process group.
  if (devnet?.pid) process.kill(-devnet.pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
});

test("status exposes chain config and the attestation key", async () => {
  const s = (await (await fetch(`${api}/v1/status`)).json()) as Record<string, string>;
  expect(s.environment).toBe("LOCAL DEVNET");
  expect(s.chitPay).toBe(chitPay);
  expect(s.attestationKey?.length).toBe(2 + 2592 * 2);
});

test("full flow: register, partial + final payment, duplicate refused, receipt and export", async () => {
  const req = makeRequest(10n ** 18n);
  const sig = signRequest(req, classical, pq);
  const created = await post("/v1/requests", {
    request: serializeRequest(req),
    signature: sig,
    details: "Integration invoice",
  });
  expect(created.status).toBe(201);
  expect(created.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  const id = requestId(req).toLowerCase();
  expect(created.body.id).toBe(id);
  // Same request again is idempotent.
  expect(
    (
      await post("/v1/requests", {
        request: serializeRequest(req),
        signature: sig,
        details: "Integration invoice",
      })
    ).status,
  ).toBe(200);

  const raw = bytesToHex(Buffer.from(sig.pq!.signature, "base64"));
  const h1 = await pay(req, raw, 4n * 10n ** 17n);
  const fast = await post("/v1/payments", { txHash: h1, source: "evm" });
  expect(fast.status).toBe(202);
  // Re-submitting the same tx is idempotent.
  await post("/v1/payments", { txHash: h1, source: "evm" });
  let view = (await (await fetch(`${api}/v1/requests/${id}`)).json()) as {
    reconciliation: { status: string; paid: string; outstanding: string };
  };
  expect(view.reconciliation.status).toBe("partially_paid");
  expect(view.reconciliation.outstanding).toBe("600000000000000000");

  const h2 = await pay(req, "0x", 6n * 10n ** 17n);
  await post("/v1/payments", { txHash: h2, source: "evm" });
  view = (await (await fetch(`${api}/v1/requests/${id}`)).json()) as typeof view;
  expect(view.reconciliation.status).toBe("completed");

  // The contract refuses a duplicate payment of a settled request.
  await expect(pay(req, "0x", 10n ** 17n)).rejects.toThrow();

  const status = (await (await fetch(`${api}/v1/status`)).json()) as { attestationKey: Hex };
  const receipt = (await (await fetch(`${api}/v1/requests/${id}/receipt`)).json()) as SignedReceipt;
  expect(receipt.receipt.status).toBe("completed");
  expect(receipt.receipt.payments).toHaveLength(2);
  expect(verifyReceiptAttestation(receipt, status.attestationKey)).toBe(true);

  const csv = await (
    await fetch(`${api}/v1/merchants/${merchant.address}/export?format=csv`)
  ).text();
  expect(csv.split("\r\n").filter(Boolean).length).toBeGreaterThanOrEqual(4);
  expect(csv).toContain(h1);
  const summary = (await (
    await fetch(`${api}/v1/merchants/${merchant.address}/summary`)
  ).json()) as { byStatus: Record<string, number> };
  expect(summary.byStatus.completed).toBeGreaterThanOrEqual(1);
}, 60_000);

test("security: tampered amount, foreign key, wrong contract, reused reference and bad details are rejected", async () => {
  const req = makeRequest(5n * 10n ** 17n, false);
  const sig = signRequest(req, classical, pq);
  const tampered = await post("/v1/requests", {
    request: serializeRequest({ ...req, amount: 1n }),
    signature: sig,
    details: "Integration invoice",
  });
  expect(tampered.status).toBe(422);
  const other = mldsa87.keygen(new Uint8Array(32).fill(6));
  const forged = signRequest(req, classical, other);
  expect(
    (
      await post("/v1/requests", {
        request: serializeRequest(req),
        signature: forged,
        details: "Integration invoice",
      })
    ).status,
  ).toBe(422);
  const wrongContract = { ...req, payContract: merchant.address };
  expect(
    (
      await post("/v1/requests", {
        request: serializeRequest(wrongContract),
        signature: signRequest(wrongContract, classical, pq),
        details: "Integration invoice",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await post("/v1/requests", {
        request: serializeRequest(req),
        signature: sig,
        details: "Changed details",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await post("/v1/requests", {
        request: serializeRequest(req),
        signature: sig,
        details: "Integration invoice",
      })
    ).status,
  ).toBe(201);
  const reuse = { ...req, amount: 7n };
  expect(
    (
      await post("/v1/requests", {
        request: serializeRequest(reuse),
        signature: signRequest(reuse, classical, pq),
        details: "Integration invoice",
      })
    ).status,
  ).toBe(409);
  // Partial payment of a no-partial request is refused on chain.
  await expect(
    pay(req, bytesToHex(Buffer.from(sig.pq!.signature, "base64")), 10n ** 17n),
  ).rejects.toThrow();
  // Malformed input never reaches the database.
  expect(
    (await post("/v1/requests", { request: { merchant: "x" }, signature: {}, details: "" })).status,
  ).toBe(400);
  expect((await fetch(`${api}/v1/requests/not-an-id`)).status).toBe(400);
  expect(
    (await post("/v1/payments", { txHash: `0x${"0".repeat(64)}`, source: "evm" })).status,
  ).toBe(404);
}, 60_000);

test("indexer picks up payments without the fast path (cron path)", async () => {
  const req = makeRequest(2n * 10n ** 17n, false);
  const sig = signRequest(req, classical, pq);
  await post("/v1/requests", {
    request: serializeRequest(req),
    signature: sig,
    details: "Integration invoice",
  });
  await pay(req, bytesToHex(Buffer.from(sig.pq!.signature, "base64")), 2n * 10n ** 17n);
  const id = requestId(req).toLowerCase();
  let status = "";
  for (let i = 0; i < 40 && status !== "completed"; i++) {
    await new Promise((r) => setTimeout(r, 250));
    status = (
      (await (await fetch(`${api}/v1/requests/${id}`)).json()) as {
        reconciliation: { status: string };
      }
    ).reconciliation.status;
  }
  expect(status).toBe("completed");
}, 30_000);
