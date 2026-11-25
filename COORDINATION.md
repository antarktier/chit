# Coordination between Chit workers

Two agents work in this repo at the same time. Small commits, `git pull --rebase origin main` before every push, never force-push.

| Area | Owner |
| --- | --- |
| `contracts/`, `packages/core`, `scripts/`, `service/` (API, indexer, D1), deploy | Worker A (backend) |
| `app/` (React frontend), its unit tests, Playwright e2e and axe tests | Worker B (frontend) |

Root files (`package.json` workspaces, `vite.config.ts` test projects, `.gitignore`, `AI_USAGE.md`, README/docs): append, don't rewrite each other's lines.

## What the frontend (`app/`) depends on

The app imports `@chit/core` directly (request encoding, `signRequest`, `verifyRequest`, `requestId`, `memoForRequest`, `chitPayAbi`, `verifyReceiptAttestation`, reference helpers). Please keep those exports stable; tell me here if you rename one.

Typed client: `app/src/api.ts`. All bigints are decimal strings, addresses are checksummed EVM hex, times are ISO-8601 or unix seconds as stated. The app reads `VITE_CHIT_API` (default `https://chit-api.antarktier.com`).

| Method + path | Request | Response |
| --- | --- | --- |
| `GET /config` | – | `{ environment: "DIANA" \| "LOCAL DEVNET", nativeChainId, evmChainId: "9800", chitPay, evmUrl, restUrl, explorer, minConfirmations: string, attestationKey: Hex }` |
| `POST /requests` | `{ request: SerializedRequest, signature: MessageSignature, details: string }` | `201 RequestView`. Server checks `detailsHash`, `payContract`, chain, reference format, the merchant's ML-DSA-87 key via pqcKeyStatus/REST (`verifyRequest`), and `(merchant, reference)` uniqueness (`409` on reuse). |
| `GET /requests/:id` | – | `RequestView` (`404` if unknown) |
| `GET /merchants/:address/requests?status=&limit=&cursor=` | `status` one of `PaymentStatus` | `{ items: RequestView[] (without `signature`), nextCursor?: string }`, newest first |
| `GET /merchants/:address/report` | – | `{ counts: Record<PaymentStatus, number>, requested, paid, pending, outstanding, overpaid, unattributed, duplicateEvents: number, lateEvents: number }` (wei strings) |
| `GET /merchants/:address/export.csv` | – | `text/csv` one row per counted/duplicate/late/wrong event plus unpaid requests |
| `GET /receipts/:id` | – | `SignedReceipt` from `@chit/core` (JSON with bigints as strings) |
| `POST /payments` | `{ txHash: Hex, source: "evm" \| "native" }` | `202 { requestId }`. Optional fast path: index one tx now instead of waiting for the cron tick; idempotent, server reads the tx from chain. |

```ts
type RequestView = {
  id: Hex; request: SerializedRequest; signature?: MessageSignature; details: string;
  createdAt: string; // ISO
  head: { height: string; time: string }; // indexer head used for this view
  reconciliation: {
    status: PaymentStatus; requested: string; paid: string; pending: string; outstanding: string;
    overpaidBy: string; unattributed: string;
    completedAt?: { txHash: string; blockHeight: string; blockTime: string };
    events: { key: string; class: EventClass; confirmations: string; source: "evm" | "native";
      txHash: string; index: number; blockHeight: string; blockTime: string; payer: string;
      recipient: Address; asset: Address; amount: string }[];
  };
};
```

CORS: allow `https://chit.antarktier.com` and `http://127.0.0.1:*` for local/e2e.

## Local devnet for e2e

Like Gauge: a `scripts/devnet.ts` (Worker A) that starts Anvil (chain 9800, labelled test-only PQC mock precompiles), deploys ChitPay, registers dev merchant keys in the mock, runs the service locally with an in-memory/sqlite store, and serves `GET /config` on `CHIT_API_PORT`. Env I'll pass from `app/playwright.config.ts`: `ANVIL_PORT`, `CHIT_API_PORT`, `CHIT_LOCAL_DEPLOYMENT`. In LOCAL DEVNET mode the app signs with deterministic dev identities (mnemonics in `app/src/dev-keys.ts`, test-only) and pays via `payNative` over loopback Anvil, like Plinth.

## Merchant signing in the browser

QoreX refuses `signArbitrary`, so the merchant console uses a dedicated **Chit signing key** (24-word mnemonic, generated or imported in the browser, ML-DSA-87 + eth_secp256k1 via qoresign). The browser registers it with `MsgRegisterPQCKeyV2` + PoP, then signs every request. Funds still go to any recipient (normally the merchant's QoreX account), so Chit never custodies funds. Payers use QoreX: a native `MsgSend` with memo `chit:v1:<requestId>` (`signAndBroadcast`) or `payNative` on ChitPay through the QoreX EVM provider.

## Notes / open questions (append below with date + worker)

- 2026-11-25 21:55 Worker B: started `app/`. Please confirm or edit the table above in this file if the API differs; I re-read `service/src` regularly and will follow your code over this doc.
