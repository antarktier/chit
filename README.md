# Chit

**Request. Receive. Reconcile.**

Chit is a non-custodial payment request and reconciliation app for QoreChain. A merchant signs a request, shares a link or QR code, and receives funds directly from the payer's wallet. Chit matches transfers to the request, tracks confirmations and produces a receipt that can be checked against the chain.

Chit is a Quantum Pass entry for QoreChain’s Build Before Q-Day hackathon.

- [App](https://chit.antarktier.com)
- [API status](https://chit-api.antarktier.com/v1/status) · [API reference](docs/api.md)

## Diana testnet demo

ChitPay is deployed at [`0x0B0dCCbbE4379c02cf9743153aF9B670Ab7BfFdb`](https://explore.qore.network/address/0x0B0dCCbbE4379c02cf9743153aF9B670Ab7BfFdb?network=testnet) on Diana EVM (chain ID `9800`), at block `10731448`. [Deployment transaction](https://explore.qore.network/tx/0x9c92364f4cc173cf8aac1fa7bb35b55bfef9f3b1a9bf0c48353f48794cbb9876?network=testnet) · [Deployment manifest](deployments/diana.json)

| Demo request                                                                                                              | What the record shows                                                                       | Diana transactions                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CH-75VH-5A0Z-0A09-Z](https://chit.antarktier.com/pay/0x9d996d14c4770677be954135fab00ed7f0fdc1c4ea619c76c6febcb291cc33f9) | A 0.05 QOR invoice paid in two ChitPay instalments.                                         | [0.02 QOR](https://explore.qore.network/tx/0xd96f4ccd60caba07697a0723f1b627c150eb3a4e308b833911a95d0189ab210e?network=testnet) · [0.03 QOR](https://explore.qore.network/tx/0xf6d573194075753accaa633757392a44a12480b2d8527c1884691374debf9199?network=testnet)     |
| [CH-ZRXW-VTG0-QQZ1-4](https://chit.antarktier.com/pay/0xf8a0c38e53d3557674a9fd306e261b571966dba45c4619ecf80845f8af205dc3) | A 0.01 QOR invoice paid by native memo transfer. A second transfer overpays it by 0.01 QOR. | [Payment](https://explore.qore.network/tx/9E91A5AC009C2D06BBD6F2136DCE889FECD58A0F90E41FD7A679F71669167F10?network=testnet) · [Duplicate payment](https://explore.qore.network/tx/91788300D036C09BD5F4BE53D868B2B1A295D43B4E71470C500C5AED5D5D8163?network=testnet) |

The [demo manifest](deployments/diana-demo.json) contains the full request IDs and signed payloads. Both invoices name merchant `0x71db39fe22dFe014028e9159942c39354165F0Bc`.

## Features

| Brief requirement                                               | Where to see it                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated payment requests and unique references            | New Request signs the recipient, asset, amount, expiry, reference and payment domain with the merchant's hybrid key.                     |
| Shareable links and QR codes                                    | Request Detail provides the payment link and QR code. The customer page verifies the merchant signature against the on-chain key.        |
| Direct wallet payments in native QOR or supported tokens        | Pay uses QoreX for native memo transfers or submits a ChitPay transaction for QOR or ERC-20 settlement.                                  |
| Partial payments, duplicate detection, expiry and confirmations | Request Detail lists the transactions, confirmation counts and how each payment counts toward the request.                               |
| Automatic reconciliation and verifiable receipts                | Request reads pull chain evidence on demand. Chit derives the payment state and verifies each listed receipt transfer against the chain. |
| Merchant history and financial export                           | Requests has status filters and payment history. Reports shows totals by asset and exports CSV or JSON.                                  |

Diana's native chain uses hybrid secp256k1 and ML-DSA-87 signing, including key registration with proof of possession and native QoreX bank sends. ChitPay checks the merchant's ML-DSA-87 signature through Diana's EVM precompiles. EVM settlement uses Diana's scoped authorization windows. A native transfer includes the request ID in its memo, while a contract payment records the ID and reference in an on-chain event. See [architecture](docs/architecture.md) and [security assumptions](docs/threat-model.md).

## Repository layout

| Path             | Contents                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| `app/`           | React merchant and customer views, browser signing and Playwright tests |
| `packages/core/` | Request encoding, signatures, events, reconciliation and receipts       |
| `contracts/`     | ChitPay Solidity contract, Foundry tests and test-only precompile mocks |
| `service/`       | REST API, indexer, D1 schema and Workers configuration                  |
| `scripts/`       | Diana deployment and local test harness                                 |
| `deployments/`   | Public Diana deployment and demo manifests                              |

## Quick start

Install Bun and Foundry, then install the workspace dependencies.

```sh
bun install
bunx vp test run
forge test
```

For local development against the test harness, run `bun run devnet` from the root. In another terminal, start the app and open the URL Vite+ prints.

```sh
cd app
VITE_CHIT_API=http://127.0.0.1:8787 bunx vp dev
```

Local devnet runs Anvil with a test-only PQC precompile mock. To run Playwright, stop any dev server using the Playwright ports. Playwright starts its own devnet and app.

```sh
cd app
bunx playwright install chromium
bunx playwright test
```

## Verification

| Command                                         | Result                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bunx vp check` and `bunx vp lint`              | Passed                                                                                      |
| `bunx vp test run`                              | 45 passed across 10 files                                                                   |
| `forge test`                                    | 12 passed across 2 suites                                                                   |
| `bun run build:app` and `bun run build:service` | Both passed                                                                                 |
| `cd app && bunx playwright test`                | 6 passed, 3 desktop and 3 mobile. Zero serious or critical axe violations in audited views. |

The suites cover request authentication, encoding parity, payment state changes, event deduplication, confirmations, exports and receipt verification. The default browser suite uses local devnet. The separate `bun run test:live` command uses the deployed app and API on Diana. It spends 0.001 testnet QOR plus fees from the funded Chit signing account in `keys/chit-accounts.json`. See the [live test coverage and QoreX steps](docs/threat-model.md#live-browser-verification).

## Documentation

[Architecture](docs/architecture.md) · [REST API](docs/api.md) · [Threat model](docs/threat-model.md) · [Deployment](docs/deployment.md) · [Interface design](DESIGN.md) · [AI usage](AI_USAGE.md)

## License

[Apache-2.0](LICENSE)
