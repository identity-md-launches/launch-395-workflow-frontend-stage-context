# Frontend validation

Worker self-report, 2026-09-27. This evidence is not independent certification and does not substitute for the publisher's immutable-CID, named-entrypoint, asset-integrity or RPC checks.

## Scope and requirement decisions

Implemented the assigned one-page Sepolia ALST frontend: holder-window countdown, wallet balance, contract eligibility, buy/sell via PoolSwapTest, explicit token approval, live price, quote simulation, transaction status and recent holder-window activity. Source/configuration/lockfile are under `web/`; the static production export is under root `dist/`; documentation and evidence are under `docs/`. No contract, root configuration, dependency library or CI file was modified. No contracts were redeployed and no site was published.

Two conflicting requirements are resolved explicitly:

1. The overriding path allowlist excludes root `DESIGN.md`. The complete final design document is `docs/DESIGN.md`.
2. The task and approved workflow require PoolSwapTest, while generic routing text assumes Universal Router/Permit2 and says to use only addresses in the unchanged network object. The supplied table does not contain PoolSwapTest. Its approved workflow address is centralized in the manifest's `integrations.swapRouter`, the supplied network is copied unchanged, and quote/price/manager addresses come from that network. Approvals go directly to the required PoolSwapTest spender. This route does not call Universal Router or Permit2. `web/README.md` explains the rationale and router limitations.

Assumptions: a light English interface; injected browser wallets without a WalletConnect project; directly connected EOAs during the holder window; no liquidity-management or token-admin UI; dates in browser local time. No new visual assets or external font services are needed.

## Executed checks

| Check | Result and evidence |
| --- | --- |
| `npm install --prefix web …` | Installed React, Vite, TypeScript, viem, Playwright and axe into ignored `web/node_modules`; package-lock delivered. npm reported zero vulnerabilities during installation. |
| `npm --prefix web run typecheck` | Passed (`tsc --noEmit`). |
| `npm --prefix web run build` | Passed after final source corrections. Vite emits relative assets and then the manifest generator verifies both pinned ABI hashes and writes the asset inventory. One non-failing warning: the uncompressed main JS chunk is about 536 kB (about 164 kB gzip). |
| `npm --prefix web test` | 5 passing protocol tests: exact decimal validation, tolerance bounds, integer price limits, signed packed deltas, pinned ABI canonical hashes/pool ID. |
| `npm --prefix web run check:export` | Passed: exact handoff identities/contracts and unchanged network, both ABI hashes, 9 assets, every SHA-256, safe relative paths, no symlinks and size limits. Complete export including manifest: **590,646 bytes**. See `evidence/export-check.json`. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/allowlist-browsers npm --prefix web run test:browser` | **15 passing interaction groups** against the final production export at `/preview/` in Chromium 153.0.8010.12. Injected wallets and JSON-RPC responses mocked. Zero real transactions. `evidence/browser-results.json`. |
| `npm --prefix web run check:live` | All three configured public RPCs returned chain 11155111 and nonempty code for ALST, hook, PoolSwapTest, PoolManager, V4Quoter and StateView. Live pool state and PoolSwapTest manager binding read. `evidence/live-rpc.json`. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/allowlist-browsers node web/scripts/check-browser-live.mjs` | Final export rendered with actual public RPC reads. No mocks, wallet signing, console errors or failed resources. Recorded block 11791835, spot 50,000,000 ALST/ETH, holder window active. Snapshot only; these values change. `evidence/live-browser.json`, `evidence/desktop-live.png`. |

The assigned browser MCP could not initialize because its cache path under `/home/imd/.cache/ms-playwright/` was read-only (`EROFS`). No permission bypass was attempted. The permitted fallback was a frontend Playwright installation and Chromium under `/tmp/allowlist-browsers`. Foreground validation scripts manage their own temporary preview servers and browser processes, then close both.

### Interaction coverage

The delivered browser suite verifies:

- Relative gateway subpath, disconnected controls, one main heading and local application assets.
- Missing browser wallet, rejected connection, and unknown chain switch → exact `wallet_addEthereumChain` payload → switch.
- Holder balance and `isAllowed`, invalid amount, native buy calldata/value, no native approval, successful simulated receipt and explorer link.
- ALST sell with exact-amount PoolSwapTest approval, receipt, new quote and sell direction/value.
- Quote invalidation after amount/tolerance edits, account/network changes and 30-second expiry.
- A wallet below 1 ALST by one wei is blocked; zero balance can trade once the public window is confirmed.
- Reverted simulation and simulated partial fill prevent wallet signing; rejected signing and insufficient funds recover visibly.
- RPC failure, empty deployed code, stale block timestamp and ABI-tampering states all disable swaps; RPC retry recovers.
- Contract-account restriction during the holder window.
- Keyboard-only Tab/Enter connection, amount entry, quote and native swap.
- Desktop/mobile reflow, expanded contract addresses, text enlargement, focus styling and an axe scan.

The tests use actual viem ABI decoding/encoding and assert transaction targets, amounts, direction, value, hook data, approval spender and quoted integration address. They are not a live fork or proof of mined swap economics.

## Better Interface consolidated review

The pinned contents, workflow, all six domains' core principles and documentation method were read before/while implementing. The final export was reviewed at 1440×1100, 768×900, 390×900 and 320×900, plus 200% root text size at desktop width. PNGs under `docs/evidence/` are actual production-browser captures. Except `desktop-live.png`, they show mocked chain/wallet state for reproducibility.

| Domain | Coverage |
| --- | --- |
| Accessibility — Checked | Native buttons, inputs, linked labels/output, details and links; skip navigation; one `h1`/main; errors and status regions; field-specific focus; visible focused screenshot; keyboard primary task; reduced-motion emulation. Axe: **0 violations, 41 passing rules** in the connected quote state. Screen reader, native device, complete forced-colors and native zoom checks not performed. |
| Layout — Checked | Desktop two-column and mobile stacked order, wrapping full addresses, expanded disclosure overflow checks at 768/390/320px, 200% text enlargement. No horizontal overflow at checked sizes. RTL and pseudo-localized text not tested; only English is shipped. |
| Writing — Checked | Actions name connect/switch/quote/approve/swap; estimates and “up to” input are explicit; PoolSwapTest limitations sit next to tolerance. Errors explain recovery, receipts retain explorer links, and empty activity does not pretend to be all swap history. |
| Typography — Checked | Serif headline/system sans hierarchy, descending headings, tabular numbers, wrapped addresses, mobile input size, final screenshots and enlarged-text fixes. No downloaded font; no claim that Inter is installed. Native Safari input zoom not tested. |
| Colors — Checked | Semantic tokens, measured rendered foreground/background pairs and axe contrast checks. Body/page 13.20:1, secondary/page 5.32:1, window 9.96:1, eligible badge 7.39:1, primary button 7.77:1, swap secondary/white 5.83:1. Exact measurements in `evidence/accessibility.json`. One light theme; dark theme not applicable. Full forced-colors rendering remains unverified. |
| UI — Checked | Disconnected, selected, loading, rejected, wrong-chain, success, invalid, stale and unavailable states; neutral/primary action hierarchy; native disclosure cues; reduced-motion disables press transitions. No overlays, draggable controls, charts, images or entry animations; those checks are not applicable. Animation-panel slow replay was not performed. |

### Findings, fixes and rechecks

| Severity | Final source location | Evidence / impact | Correction and recheck |
| --- | --- | --- | --- |
| Medium | `web/src/styles.css:30`, `web/src/styles.css:61` | Initial 200% text screenshot showed fixed-size brand/launch-arrow containers becoming too small for their glyphs. | Converted those containers to rem dimensions. Final enlarged-text screenshot reviewed; no observed clipping. |
| Low | `web/src/App.tsx:201` | Connected screenshot briefly showed “Quote expires in 31s” because the last display tick preceded quote creation. | Clamp countdown display to 0–30; expiry still checks actual timestamps. Final screenshot and expiration test pass. |
| Medium | `web/src/App.tsx:114`, `web/src/App.tsx:202` | Source review: invalid tolerance/hook data previously marked and focused the amount field. | Track offending field, add field-specific `aria-invalid`, focus it and reference the error. Browser checks invalid tolerance focuses the tolerance input. |
| Low | `web/src/styles.css:142` | Full-page screenshots after scrolling captured the offscreen skip link inside document content. | Unfocused skip link also has zero opacity/pointer-events; focused link remains visible and keyboard-accessible. Rechecked mobile capture and Tab navigation. |
| High | `web/src/chain.ts:34` | Source review: a freshly fetched but stalled RPC block could otherwise look current. | Reject block timestamps outside a 180-second device-clock tolerance, in addition to the 45-second refresh age. Mocked stalled-block test blocks signing; final live browser reads still pass. |
| Medium | `web/src/config.ts:26`, `web/config/integration-abis.mjs:1` | Review of runtime configuration authority. | Keep integration interface generation only in build scripts; runtime fetches all referenced ABIs from the manifest and verifies their inventory hashes. Tampered ABI test blocks configuration. |

The initial test harness had an exponentiation syntax typo and then installed the browser clock too late for the expiry test. Both harness defects were corrected; all listed results are from the final successful run. The earlier failed screenshot was removed to avoid confusing it with final evidence.

## Limitations and completion

**Implementation and validation complete within the permitted paths; in-place Git commit blocked by the workspace.** The export, runtime manifest, source, lockfile, design document, tests and evidence are ready together in the working tree, with the two requirement conflicts resolved above.

Attempted `git add web dist docs && git commit -m "Build attested ALST launch frontend and static export"`. Git exited 128 before staging because `.git/index.lock` could not be created on the read-only filesystem. No commit hash or completed submission bundle is claimed, and no repository permission workaround was attempted. The downstream worker/publisher must capture the allowed working-tree additions.

No real wallet extension or physical device was tested; browser wallets were EIP-1193 mocks. No live approvals, holder/nonholder swaps, LP operations or mined swap receipts were exercised. Runtime state and code presence were checked against real Sepolia RPCs; the transaction flow was tested without spending funds. Network failure can change between this report and publication. Smart-wallet and bundler behavior is deliberately restricted/documented during the holder window. A browser scan is not a screen-reader test or a full accessibility certification.

PoolSwapTest cannot enforce an output minimum/deadline; preflight, quote TTL and the on-chain sqrt-price bound have the limitations documented in the interface and README. There was no contract change to add protections. No CID, site name or publication result is claimed. The subsequent publisher/control-plane checks remain outstanding by design.

See `evidence/submission-check.json` for final paths and byte accounting. The only new ignore file is the explicitly budgeted `web/.gitignore`; generated dependencies, browser binaries, package caches and unused archives are excluded at every nesting level. No submodule is present.
