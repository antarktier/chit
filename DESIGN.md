# Interface design

The merchant console follows the work from creating a request to finding payments and exporting records. The customer view puts the merchant signature check, amount due, wallet action and transaction status on one page. Receipts give both parties a record to download and verify.

## Visual system

Chit uses the shared Recall and Hyge kit for its app shell, grouped lists, controls and neutral surfaces. [Brand tokens](app/src/styles/brand.css) supply a plum accent for primary actions, selection and focus in light and dark themes. [Radius tokens](app/src/styles/tokens.css) use 16 px for surfaces, 10 px for controls, 6 px for badges and 4 px for bars. The floating mobile navigation uses a capsule shape. Distinct status labels accompany color.

## Nielsen’s heuristics

| Heuristic                       | Decision                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Visibility of system status     | Show signature verification, wallet submission and chain confirmations as separate stages.                             |
| Match with the real world       | Use request, amount due, paid and receipt. Show QOR alongside the amount.                                              |
| User control and freedom        | Let a payer edit an instalment before submitting it and cancel in the wallet.                                          |
| Consistency and standards       | Use the same status labels, amount formatter and controls across the merchant and customer views.                      |
| Error prevention                | Check amounts and signing-key registration, and withhold payment controls when request verification fails.             |
| Recognition rather than recall  | Show the reference and wallet destination with copy controls. Use persistent labels on merchant navigation.            |
| Flexibility and efficiency      | Provide date and status filters, shareable links and QR codes, and two export formats.                                 |
| Aesthetic and minimalist design | Put the amount and primary action first. Put individual transactions and confirmations in their own table.             |
| Error recognition and recovery  | Use field-level errors with specific corrections. Link failures such as expiry to an explanation of the request state. |
| Help and documentation          | Explain what a confirmation means while the customer waits. Put signing-key setup where merchants create requests.     |

## Standards and implementation

| Standard or guidance                                                                  | Interface decision                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISO 9241-11, -110 and -112                                                            | Organize screens around completing a request, paying it or finding its evidence. Keep form labels visible and use a consistent order for the request state, amount and actions.                                                                     |
| ISO 9241-210 and -220                                                                 | The main workflow is exercised on desktop and mobile in Playwright. The same flow covers merchant creation, customer payment, receipt verification and reporting.                                                                                   |
| ISO/IEC 25010                                                                         | Share request encoding and reconciliation across layers, and use unit, integration, contract and browser tests to check their behavior.                                                                                                             |
| WCAG 2.2 AA, WAI-ARIA and APG                                                         | Use semantic headings and tables, labelled controls, keyboard focus and status text. Base UI supplies custom select and radio primitives for theme, assets and report periods. Automated axe checks cover representative desktop and mobile states. |
| GOV.UK content design, Federal Plain Language, 18F, Microsoft and Google style guides | Use action labels like “Download CSV” and state labels like “Partly paid”. “Payment sent” describes wallet submission. “Paid” describes reconciled settlement.                                                                                      |
| W3C internationalization                                                              | Format numbers and dates for the browser locale. Keep asset units exact in bigint arithmetic and English count labels singular at one. Show exact amounts where rounding would obscure the payment value.                                           |
| W3C and BBC mobile accessibility, Apple HIG and Material 3                            | The shared merchant shell switches to a fixed bottom tab bar at phone widths. The main content and scroll area reserve space for the bar and the device safe-area inset, keeping the Reports export controls reachable.                             |
| NN/g visual hierarchy and information architecture                                    | Put the request at the center of the navigation. Reports aggregate it by status and asset, and a request detail and receipt expose the transfers behind the total.                                                                                  |

See [formatting](app/src/format.ts), [controls](app/src/components/Controls.tsx), [app shell](app/src/components/AppShell.tsx) and [mobile layout styles](app/src/styles/theme.css).
