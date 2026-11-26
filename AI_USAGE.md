# AI usage

Codex (GPT-6.2 Sol, low reasoning) used CodeGraph, Ponytail, and Antislop to write Chit’s code and this disclosure. The operator’s development agent deployed the app and API, verified the live demo, and retargeted the screenshots under the same human direction.

- **Payments and security.** Codex implemented signed requests bound to their chain and contract, direct settlement through ChitPay or native memo payments, and browser verification.
- **API and records.** Codex implemented request registration and lookup, on-demand payment scans, reconciliation, signed receipts, and exports.
- **Interface and verification.** Codex built the merchant and payer views and wrote the documentation and automated tests.

The human operator chose the static-first architecture, the custom `antarktier.com` domains, and the existing Recall/Hyge kit. The operator made the product and security decisions, reviewed the design and implementation, and directed verification.

## Live design

The [app](https://chit.antarktier.com) runs as Cloudflare Static Assets on Worker `chit`. The [API](https://chit-api.antarktier.com) runs on Worker `chit-api` with D1 database `chit-diana`. Both Workers have `workers_dev` and `preview_urls` disabled. Merchants use the API to register and list payment requests. The pay page uses it to resolve request IDs.

Request and merchant reads scan EVM payment logs and native transactions from stored cursors up to the configured blocks-per-tick cap, then reconcile chain evidence. There is no cron trigger or scheduled handler. The pay page reads the merchant key through Diana’s EVM `pqcKeyStatus` precompile and verifies the signature in the browser. After full payment, a key lookup failure appears as a note.

The expanded threat model documents the controls and remaining risks for payment links, wallet approvals, merchant keys, reconciliation, receipts, and dependencies on chain endpoints and deployment infrastructure. [Threat model](docs/threat-model.md)

## Verification

- The live demo for merchant `0x71db39fe22dFe014028e9159942c39354165F0Bc` and reference `CH-75VH-5A0Z-0A09-Z` displays “Signed by the merchant…” and “Paid in full” for 0.05 QOR. The API reports `completed` for lookups by reference and ID. [Live demo](https://chit.antarktier.com/pay/0x9d996d14c4770677be954135fab00ed7f0fdc1c4ea619c76c6febcb291cc33f9)
- The opt-in Diana browser suite (`bun run test:live`) paid 0.001 QOR through ChitPay with a real EIP-1193 signer in Chromium. The transaction hash was `0x448553c7d90e1d7a2bea4d6edf24bf8b9ba6d6d7b308eec3e7a60b48f33e5b69`. The API reported `completed`, and axe found zero serious or critical violations across four live states. [Live browser suite](app/e2e-live)
- The official QoreX 0.4.3 extension loaded in Chromium and opened its approval popup from Chit.
- Default Playwright (`bun run test:e2e`) passed 6 of 6 tests, `vp test run` (`bun run test`) passed 45 of 45, and `forge test` passed 12 of 12.
- `bun run check` passed formatting for 88 files and reported no warnings, lint errors, or type errors across 64 files.

## Limits

The local devnet uses a test-only PQC precompile mock. Completing live native payment verification requires a person to create or import a QoreX wallet, unlock it, and approve the transfer.
