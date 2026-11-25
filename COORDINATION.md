# Chit coordination notes

Two workers share this repo.

- **Backend worker** owns `contracts/`, `packages/core/`, `scripts/`, `service/`, `deployments/`, root config, deploy.
- **Frontend worker** owns the frontend app dir (`app/`) and its unit/e2e/axe tests.
- Small commits, `git pull --rebase` before every push, never force-push.

## Live Diana deployment (`deployments/diana.json`)

- ChitPay: `0x7c7773509CA77C398bd1cFd270A26B5b8Fad4236` (EVM chain 9800), deploy block in `deployments/diana.json`.
- Demo requests and txs: `deployments/diana-demo.json` (one 2-instalment ChitPay payment, one native memo payment plus an accidental duplicate).

## Public hosts (user rule: antarktier.com only, workers.dev disabled)

- Frontend: `https://chit.antarktier.com`
- API: `https://chit-api.antarktier.com` (CORS allows the frontend origin; local dev `http://localhost:5173`)

## Shared library `@chit/core` (import from the frontend)

- `PaymentRequest`, `serializeRequest`/`deserializeRequest` (JSON-safe strings for bigints), `requestId(req)`, `encodeRequest`, `requestMessageBytes`.
- `generateReference()` → `CH-XXXX-XXXX-XXXX-C` (Crockford base32 + check char), `isValidReference`.
- `hashDetails(text)` → `detailsHash` (keccak256 of NFC UTF-8). The service stores `details` and checks it matches.
- `signRequest(req, classicalKey, pqKey)` → qoresign `MessageSignature` (ML-DSA-87 hybrid). `verifyRequest(req, sig, pqPublicKey)`.
- `chitPayAbi` (payNative, payToken, outstanding, paid, events), `erc20Abi`, `NATIVE_ASSET` = zero address, `UQOR_TO_WEI`.
- Native payment path: bank MsgSend to `toBech32(recipient)` with memo `memoForRequest(requestId)` = `chit:v1:<id>`; amount in uqor = wei / 1e12.
- EVM payment path: `payNative(req tuple with paymentRef = referenceToBytes32(reference), pqSignature)` with `value`; the first payment must pass the raw 4627-byte ML-DSA-87 signature (`base64 sig.pq.signature` → hex); later instalments may pass `0x`.
- `reconcile(...)` statuses: `unpaid | partially_paid | completed | overpaid | expired`; event classes `counted | pending | duplicate | late | wrong_recipient | wrong_asset | partial_not_allowed`.
- Receipts: `Receipt`, `SignedReceipt`, `verifyReceiptAttestation(signed, trustedKeyHex)`.

## REST API (JSON; bigints as decimal strings; amounts in wei)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/status` | `{ environment, chainId, chitPay, headHeight, indexedHeight, lagBlocks, minConfirmations, attestationKey }` |
| POST | `/v1/requests` | body `{ request: SerializedRequest, signature: MessageSignature, details: string }`. Verifies merchant ML-DSA-87 key on chain (registered + possessionProven), signature, `detailsHash`, `payContract` = ChitPay, unique `(merchant, reference)`. 201 `{ id, ... }`; 200 if identical already stored; 409 reference reused; 400/422 invalid. |
| GET | `/v1/requests/:id` | `{ id, request, signature, details, createdAt, reconciliation, events[] }` where `reconciliation = { status, requested, paid, pending, outstanding, overpaidBy, unattributed, completedAt? }` and each event `{ key, source, txHash, index, blockHeight, blockTime, payer, amount, confirmations, class, explorerUrl }` |
| GET | `/v1/requests/by-reference/:merchant/:reference` | same shape as above |
| GET | `/v1/requests/:id/receipt` | `SignedReceipt` (ML-DSA-87 attestation by the service key; also verifiable directly against chain txs) |
| GET | `/v1/merchants/:address/requests?status=&from=&to=&limit=&offset=` | `{ items: [summary], total }`; `from`/`to` ISO datetimes on `createdAt` |
| GET | `/v1/merchants/:address/summary?from=&to=` | totals per status, amounts requested/received/outstanding, counts |
| GET | `/v1/merchants/:address/export?format=csv|json&from=&to=` | financial record export (one row per payment event + one per request) |
| GET | `/v1/payments/recent?merchant=` | recent indexed payment events |

Errors: `{ error: "plain-language message" }` with 4xx/5xx.
