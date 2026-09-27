# Allowlist launch frontend

One React / TypeScript page for the deployed ALST native-ETH pool on Sepolia. Source and frontend build configuration live here; the committed static site is `../dist/`. It requires no backend, wallet project ID, API key, remote font, or hosted asset service.

## Install, build, and preview

Use Node 22.12+ and npm. From the repository root:

```sh
npm ci --prefix web
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run check:export
npm --prefix web run preview
```

Vite prints the preview address. `npm --prefix web run dev` provides HMR after the first build; its development middleware serves the same generated deployment JSON and ABIs. Vite uses `base: './'`, and the app uses one page and fragment anchors. Serve the complete `dist/` directory at any static gateway subpath. Do not open it with `file://`: browser module loading and RPC need HTTP(S). Wallets and Web Crypto normally require HTTPS outside localhost.

The publisher hosts the committed export without rebuilding. After any export change, run the full build again: its final step regenerates the asset inventory. Do not edit a hashed export file manually.

## Configuration and ABI provenance

- `config/deployment-handoff.json` preserves the supplied handoff. The deployed source commit is `08396f8a2a57439278b3a7f01ac26550bb2277a9`.
- `config/network.json` preserves the supplied network and exact add-chain parameters. Public RPCs, chain settings, explorers and Uniswap addresses originate here.
- `config/integrations.json` contains the approved workflow's PoolSwapTest address and integration ABI paths. This is build input, never imported by the application.
- `config/integration-abis.mjs` defines minimal interfaces from the pinned vendored `PoolSwapTest.sol`, `IV4Quoter.sol`, `IStateView.sol` and their immutable-state bases. It is used only by build/check scripts.
- `scripts/export.mjs` obtains each deployed contract's raw ABI array using `git show <sourceCommit>:docs/abi/<Contract>.json`. It verifies Keccak-256 of recursively key-sorted, compact JSON against the handoff. Arrays retain their order. The exact source commit must remain available to rebuild.
- The build exports these arrays and the integration interfaces under `dist/abi/`. It emits `dist/imd-deployment.json` **last**, retaining the exact attested contract set and the unchanged `network` object. Additional `pool`, `token`, `hook`, `integrations`, and `walletAddChain` fields supply the complete runtime configuration.
- `src/config.ts` fetches that manifest relative to the page. All runtime addresses, chain settings and ABI paths come from it. Each fetched ABI must match its asset SHA-256; ALST and hook must also match the handoff's canonical Keccak ABI hashes. There is no independent runtime address/ABI map.
- `check:export` verifies the full asset inventory, hashes, safe relative paths, file/count/total limits, handoff equality and network equality. The manifest excludes itself.

### Routing requirement resolution

The task and approved workflow explicitly require **PoolSwapTest**. That address is absent from the supplied network's `uniswapV4` table, whose generic route would use Universal Router and Permit2. The frontend therefore retains the network block unchanged and adds the specifically approved PoolSwapTest in `integrations` in the same runtime manifest. Quotes use `network.uniswapV4.quoter`; prices use `network.uniswapV4.stateView`; the hook, router, quoter and StateView must all report `network.uniswapV4.poolManager`. Sell approvals name PoolSwapTest as spender. Universal Router and Permit2 are not called. This resolves the generic routing language in favor of the explicit assigned router; adding that router to the immutable network block would violate network equality.

## Wallets, reads and transactions

Injected EIP-1193 wallets and EIP-6963 announcements are supported. No WalletConnect project was supplied. Connect is explicit; the page does not prompt on load. Account, chain and disconnect events clear pending quotes. A missing chain triggers switch → add using the supplied exact parameters → switch. Rejections leave a retryable message.

Public RPCs are tried with viem fallback transport. Signing stays with the selected wallet. Before actions the app checks the RPC chain, nonempty contract code, PoolManager bindings, pool initialization, gated token and token decimals. Reads are pinned to one latest block; they poll every 15 seconds. Access becomes unavailable after 45 seconds without a successful refresh, on read failure, or when the block timestamp differs from the device clock by over 180 seconds. Fix an inaccurate device clock if this check fires. A valid ABI hash and nonempty code are consistency checks, not independent cryptographic verification of the handoff's attestation or deployed runtime bytecode.

Live state includes `openAt`, `isOpen`, `isAllowed`, token/native balances, allowance, StateView spot price and recent `HolderSwap` events. Activity queries the current pool over the last 1,000 blocks (up to four events shown); public swaps do not emit this hook event. An event-query failure does not invalidate successful eligibility reads. The visible countdown interpolates from the latest block and only announces public trading after the contract's `isOpen` read confirms it. Display dates use the visitor's local timezone.

A buy uses native ETH and needs no approval. A sell explicitly approves the entered ALST amount to PoolSwapTest, waits for a successful receipt, then requires a fresh quote. Quotes call `V4Quoter.quoteExactInputSingle` with `simulateContract` and the connected account, never a transaction. Exact input uses negative `amountSpecified`; buying is `zeroForOne: true`. Claims/burn settlement are both false. The advanced field forwards validated even-length hex `hookData` unchanged. This hook ignores it for eligibility.

PoolSwapTest is a test router with **no output minimum or on-chain deadline**. The tolerance control sets a terminal pool price bound: integer square root of `spotSqrtPrice² × (1 ± bps/10000)`. This includes price movement through the trade, so a large trade may require a smaller amount even before prices move. Before signing, swap simulation must spend the entire requested input and return at least the quote discounted by the chosen tolerance; a partial simulation or revert blocks signing. These are preflight checks. A mined swap can still fill partially or produce a different output. The UI explicitly discloses this beside the tolerance control, uses “up to” for input, and calls output an estimate.

Quotes expire in 30 seconds and edits invalidate them. Each signing request rechecks the selected account/network, eligibility, balances, code, allowance and gas affordability, then simulates. Signing is serialized. Wallet confirmation can remain open after the frontend's quote lifetime; the router cannot enforce a deadline. Receipt success, failure or a 120-second wait timeout is shown with a transaction explorer link; a timeout does not mean the submitted transaction failed. Never automatically resubmit a pending transaction.

### Hook identity limitations

During the holder window, the contract checks `tx.origin`'s balance, not the router or a `hookData` identity. Contract and ERC-4337 wallets are judged by the sending EOA (a bundler for ERC-4337); this UI asks for a directly connected EOA during the window and blocks connected accounts with code. A phishing contract invoked by a holder can cause that holder to swap. Sending 1 ALST grants eligibility; spending below the threshold removes it. The window may elapse with no swaps. Once open, the hook stops reading `tx.origin`. Liquidity is never gated; liquidity management, token administration and deployment are outside this one-page swap assignment.

## Validation

```sh
npm --prefix web test
PLAYWRIGHT_BROWSERS_PATH=/tmp/allowlist-browsers npm --prefix web exec -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/allowlist-browsers npm --prefix web run test:browser
npm --prefix web run check:live
PLAYWRIGHT_BROWSERS_PATH=/tmp/allowlist-browsers node web/scripts/check-browser-live.mjs
```

Browser scripts own a temporary HTTP server and close it and Chromium before exiting. Mocked wallet/RPC fixtures are exclusively in the test script and are never bundled into `dist/`. `test:browser` serves the **production export under `/preview/`**, tests transactions without funds, captures responsive screenshots, checks keyboard interaction and runs axe. `check:live` and the live browser script only read Sepolia. No real approvals or swaps were broadcast.

See `../docs/VALIDATION.md`, `../docs/DESIGN.md` and `../docs/evidence/`. The root `DESIGN.md` requested by one criterion cannot be written under the overriding allowed-path rule, so the complete design document is delivered under `docs/`.

The explicit ignore-file budget is **one path: `web/.gitignore`**. It excludes dependency and cache directories at every nesting depth beneath `web/`. Do not vendor npm archives, browser binaries, dependency caches or `node_modules`. No submodules are used. Frontend lockfile and complete runtime export are included.
