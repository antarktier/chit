# Chit API

Base URL: `https://chit-api.antarktier.com`. The production Worker exposes the routes below. Send JSON for POST bodies. Response objects are JSON except for CSV downloads and empty OPTIONS responses. The API uses public reads and validates signed requests on submission. CORS controls which browser origins can read responses.

This reference follows [service/src/api.ts](../service/src/api.ts). In the shapes below, `string` and `number` are JSON types, and `?` marks an optional field. Amounts are decimal strings in the asset's smallest unit. QOR is represented with 18 decimals, including native memo payments after conversion from `uqor`. Where marked as Unix seconds, timestamps are decimal strings.

## Status

### `GET /v1/status`

No body or query parameters. Returns HTTP 200:

```ts
{
  environment: "DIANA" | "LOCAL DEVNET";
  chainId: string;
  nativeChainId: string;
  evmUrl: string;
  restUrl: string;
  explorer: string;
  chitPay: string;
  headHeight: string;
  indexedHeight: string;
  lagBlocks: string;
  minConfirmations: string;
  attestationKey: string | null;
}
```

The indexed height is the EVM cursor, or the configured start block before the cursor exists. This endpoint only reports lag. Request detail, receipt, and merchant report reads advance the cursor on demand. `lagBlocks` has a floor of zero. The attestation key is hex when configured.

## Requests

### `POST /v1/requests`

Body: `{ request: SerializedRequest, signature: MessageSignature, details: string }`. The request and body reject extra fields. The signature object permits extra fields at the schema layer and must pass hybrid verification with the on-chain key. Details have a 2,000-character limit and must match the signed hash.

```ts
type SerializedRequest = {
  merchant: string;
  recipient: string;
  asset: string;
  amount: string;
  expiresAt: string;
  reference: string;
  detailsHash: string;
  partialAllowed: boolean;
  payContract: string;
  chainId: string;
};

type MessageSignature = {
  signatureType: "ml-dsa-87-hybrid";
  classical: { keyType: string; publicKey: string; signature: string };
  pq: { algorithmId: number; signature: string };
};
```

Addresses use `0x` form. The zero asset address means QOR. The amount is a positive decimal integer string of up to 78 digits without leading zeros. `expiresAt` is a 1–20 digit decimal string in Unix seconds and must fit in a positive uint64. `detailsHash` is 32-byte hex. The reference must pass its format and check-character validation. Use chain ID `"9800"` and the configured ChitPay address. Signature and public-key bytes in the hybrid envelope use Base64. See the signed objects in the [Diana demo manifest](../deployments/diana-demo.json).

Returns `RequestDetail` with HTTP 201 for a new request or HTTP 200 for the same existing ID. A reference already bound to a different ID for that merchant returns HTTP 409. A request that fails deserialization, domain, details or signature checks returns HTTP 422.

### `GET /v1/requests/:id`

No body or query parameters. The ID must be 32-byte hex with a `0x` prefix. Returns HTTP 200 with `RequestDetail`, HTTP 400 for a malformed ID or HTTP 404 for an unknown ID.

### `GET /v1/requests/by-reference/:merchant/:reference`

No body or query parameters. Supply the merchant's `0x` address and the URL-encoded reference. Returns HTTP 200 with `RequestDetail` or HTTP 404 if the pair is unknown.

```ts
type Status = "unpaid" | "partially_paid" | "completed" | "overpaid" | "expired";
type Source = "evm" | "native";
type EventClass =
  | "counted"
  | "pending"
  | "duplicate"
  | "late"
  | "wrong_recipient"
  | "wrong_asset"
  | "partial_not_allowed";

type Completion = { txHash: string; blockHeight: string; blockTime: string };
type Reconciliation = {
  status: Status;
  requested: string;
  paid: string;
  pending: string;
  outstanding: string;
  overpaidBy: string;
  unattributed: string;
  completedAt?: Completion;
};
type Evidence = {
  source: Source;
  txHash: string;
  index: number;
  blockHeight: string;
  blockTime: string;
  payer: string;
  amount: string;
};
type RequestDetail = {
  id: string;
  request: SerializedRequest;
  signature: MessageSignature;
  details: string;
  createdAt: string;
  headHeight: string;
  reconciliation: Reconciliation;
  events: (Evidence & {
    key: string;
    confirmations: string;
    class: EventClass;
    explorerUrl: string | null;
  })[];
};
```

`createdAt` is ISO 8601. `blockTime` in events and completion is Unix seconds. The event index is a log index for EVM or a message index for native transactions.

### `GET /v1/requests/:id/receipt`

Returns HTTP 200 with the following signed snapshot or HTTP 503 if the attestation key is missing. The presence of a `download` query parameter sets the attachment filename to `chit-receipt-<reference>.json`.

```ts
{
  receipt: {
    type: "CHIT_RECEIPT_V1"
    requestId: string
    request: SerializedRequest
    merchantSignature: MessageSignature
    status: Status
    paid: string
    overpaidBy: string
    payments: Evidence[]
    completedAt?: Completion
    issuedAt: string
  }
  digest: string
  attestation: string
  attestationKey: string
}
```

`issuedAt` is ISO 8601. Payments include counted events and distinct duplicate payments. The digest, attestation and attestation key use hex.

## Merchant records

Use a merchant's `0x` address. All three routes accept optional `from` and `to` ISO datetime strings in UTC with a `Z` suffix. Both bounds apply inclusively to request creation time.

### `GET /v1/merchants/:address/requests`

Also accepts `status` (a `Status` value), `limit` (integer 1–500, default 50) and `offset` (integer 0–100000, default 0). Returns HTTP 200 with `{ items: RequestSummary[], total: number }`, newest first. `total` counts matching records before pagination. The read advances payment cursors and refreshes the merchant’s status and amounts before applying filters and pagination.

```ts
type RequestSummary = {
  id: string;
  merchant: string;
  reference: string;
  recipient: string;
  asset: string;
  amount: string;
  expiresAt: string;
  partialAllowed: boolean;
  details: string;
  createdAt: string;
  status: Status;
  paid: string;
  pending: string;
  updatedAt: string;
};
```

`expiresAt` is Unix seconds. `createdAt` and `updatedAt` are ISO 8601.

### `GET /v1/merchants/:address/summary`

Returns HTTP 200 with:

```ts
type Totals = { requested: string; received: string; outstanding: string };
type MerchantSummary = Totals & {
  merchant: string;
  requests: number;
  byStatus: Record<Status, number>;
  byAsset: (Totals & { asset: string })[];
};
```

`byAsset` gives totals in each asset's own units. The top-level amounts sum raw units across assets. Outstanding is summed only for unpaid and partly paid requests.

### `GET /v1/merchants/:address/export`

Also accepts `format=csv` (default) or `format=json`. Returns HTTP 200 with an attachment named `chit-<merchant>.<format>`. The request records are oldest first.

JSON returns an array of `RequestSummary` with two extra fields per item:

```ts
{
  reconciliation: Reconciliation
  payments: {
    source: Source
    txHash: string
    blockHeight: string
    blockTime: string
    payer: string
    amount: string
    class: EventClass
  }[]
}
```

Payment `blockTime` is ISO 8601 in this export. The nested reconciliation comes from a fresh calculation. The top-level summary fields come from the stored snapshot.

CSV returns `text/csv; charset=utf-8` with one `request` row per request followed by `payment` rows for its events. The header is:

```csv
record,request_id,reference,created_at,expires_at,asset,requested_wei,status,paid_wei,outstanding_wei,tx_hash,source,block_height,block_time,payer,amount_wei,classification,details
```

CSV times are ISO 8601. The `_wei` columns use asset base units. Payment-only fields are empty on request rows, and details are empty on payment rows. Data cells are quoted and values starting with a spreadsheet formula marker, tab or carriage return receive a leading apostrophe.

## Payments

### `POST /v1/payments`

Body: `{ txHash: string, source: Source }`. The hash is 64 hex digits with an optional `0x` prefix. The service looks the transaction up on chain, stores events for known requests and refreshes their statuses. Returns HTTP 202 with `{ requestIds: string[], events: number }`. IDs are unique in the response, and `events` is the number matched, including any already indexed. Matching events can still be awaiting confirmations. Returns HTTP 404 if no event matches.

### `GET /v1/payments/recent`

Accepts optional `merchant` (a `0x` address). Returns HTTP 200 with `{ items: RecentPayment[] }`, at most 50 joined event rows ordered by block height descending. This endpoint exposes stored events before reconciliation classification.

```ts
type RecentPayment = {
  key: string;
  request_id: string;
  source: Source;
  tx_hash: string;
  idx: number;
  block_height: number;
  block_time: number;
  payer: string;
  recipient: string;
  asset: string;
  amount: string;
  indexed_at: string;
  reference: string;
};
```

`block_time` is Unix seconds and `indexed_at` is ISO 8601.

## Errors and preflight

`OPTIONS` returns HTTP 204 with an empty body. Allowed origins receive CORS headers permitting GET, POST and OPTIONS with `content-type`.

Errors have the shape `{ error: string }`. HTTP 400 covers schema validation and malformed request IDs. HTTP 404 covers missing records, unmatched transactions and unknown routes. HTTP 409 reports reference conflicts, and HTTP 422 reports invalid signed requests. HTTP 503 covers a missing receipt key or an unavailable head when no indexed fallback exists. Unexpected failures return HTTP 500 with a generic message.

The [local test harness](../service/src/devnet.ts) adds funding and mock key registration routes only under `LOCAL DEVNET`. The production Worker serves the routes in this reference.
