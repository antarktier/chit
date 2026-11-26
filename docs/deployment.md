# Deployment

Chit runs on QoreChain Diana (`qorechain-diana`, EVM chain `9800`). The EVM RPC is `https://evm-testnet.qore.host` and the native REST endpoint is `https://api-testnet.qore.host`. The [deployment manifest](../deployments/diana.json) records the active contract, deployment transaction and start block.

## Diana accounts and ChitPay

From the repository root, install dependencies and build the contract. The accounts command creates dedicated merchant and payer identities and prints public addresses. It stores the signing phrases in `keys/chit-accounts.json` under the gitignored `keys/` directory with file mode `0600`. Keep that directory private and out of build artifacts.

```sh
bun install
forge build
bun run diana:accounts
bun run diana:status
```

Fund both native addresses with Diana testnet QOR for gas and payments. On funded accounts, register their ML-DSA-87 keys with proof of possession. Open the merchant's EVM authorization window for contract creation before deploying.

```sh
bun run diana:register
bun run diana:windows --deploy
bun run diana:deploy
```

The deployment command reuses the contract in the manifest when it already has bytecode. For a new instance, keep the prior manifest separately and configure the API with the new `chitPay` and `block` values. Use a fresh D1 database for a new instance so its indexing cursors start at the new deployment block.

## API Worker and D1

[service/wrangler.toml](../service/wrangler.toml) configures `chit-api.antarktier.com` as a Worker custom domain. It binds D1 as `DB` and sets `workers_dev = false` and `preview_urls = false`. Request reads index payments on demand without a cron trigger. Set `CHIT_PAY` and `CHIT_START_BLOCK` from the manifest. The Diana configuration uses two confirmations and allows the production app origin and local development origins through CORS.

For a new Cloudflare account or fresh instance, create a D1 database with `wrangler d1 create chit-diana` and replace the database ID in the config. Run the migration and deploy the Worker from the repository root with an authenticated Wrangler session.

```sh
bun run build:service
bunx wrangler d1 migrations apply chit-diana --remote --config service/wrangler.toml
bunx wrangler secret put CHIT_ATTESTATION_SEED --config service/wrangler.toml
bunx wrangler deploy --config service/wrangler.toml
```

Enter a private, randomly generated 32-byte seed as a `0x`-prefixed hex string at Wrangler's secret prompt. Keep the seed out of Git, shell history and public Worker variables. The API derives the receipt attestation key from this seed and publishes only the public key via `GET /v1/status`.

## App Worker

[app/wrangler.jsonc](../app/wrangler.jsonc) serves `app/dist` at `chit.antarktier.com` with single-page routing. It also sets `workers_dev = false` and `preview_urls = false`. The build defaults to the production API domain. Set `VITE_CHIT_API` at build time if using another API for local development.

```sh
bun run build:app
bunx wrangler deploy --config app/wrangler.jsonc
curl -fsS -o /dev/null https://chit.antarktier.com/
curl -fsS https://chit-api.antarktier.com/v1/status
```

Check the app and API return HTTP 200, confirm the returned contract and chain IDs, and compare `indexedHeight` with `headHeight` before and after opening an existing request. If the cursor is behind, successive request reads advance it toward the chain head. Confirm both Workers have previews and workers.dev routes disabled.

## Demo records

To create fresh Diana demo transactions, open the payer's window scoped to ChitPay and run the demo script. It pays the contract invoice in two instalments and makes two native memo transfers for a second invoice to show how Chit records an overpayment. These commands spend testnet QOR and replace the local demo manifest.

```sh
bun run diana:windows
bun run diana:demo
CHIT_API=https://chit-api.antarktier.com bun scripts/publish-demo.ts
```

The publishing script submits the signed requests from the demo manifest to the API. The Worker can backfill their transfers. The checked-in [demo manifest](../deployments/diana-demo.json) contains public request IDs, signatures and transaction hashes.

## Local test harness

From the repository root, run `bun run devnet` to launch loopback Anvil, deploy ChitPay with test-only PQC precompiles, and start the Bun API with in-memory SQLite. The default API port is `8787`, and the generated deployment manifest defaults to `.deployments-local/devnet.json`. Use `ANVIL_PORT`, `CHIT_API_PORT` and `CHIT_LOCAL_DEPLOYMENT` to run isolated instances.

The local API exposes two test helpers. `POST /local/fund` with `{ address }` sets the Anvil balance and returns `{ address, balance }`. `POST /local/register-key` with `{ address, publicKey }` records a 2,592-byte hex ML-DSA-87 public key as registered and possession-proven in the mock. It returns `{ address, registered: true }`. The API still performs the real merchant signature check when a test submits a signed request.
