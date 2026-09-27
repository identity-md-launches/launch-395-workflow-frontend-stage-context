# Allowlist (ALST) launch: token and Uniswap v4 hook

Contracts for the `univ4_hook` launch of **Allowlist (ALST)** on Sepolia (chain id 11155111).

| Contract              | File                          | Purpose                                                                                  |
| --------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `Allowlist`           | `src/Allowlist.sol`           | Fixed-supply ERC-20, 1,000,000,000 ALST with 18 decimals, minted once to the deployer.  |
| `AllowlistLaunchHook` | `src/AllowlistLaunchHook.sol` | v4 hook that gates the first 24 hours of a native-ETH pool to wallets already holding ALST. |
| `HookFlags`           | `src/HookFlags.sol`           | Permission-bit constants and address helpers used by tests and manifest checks.          |

ABI exports: `docs/abi/Allowlist.json`, `docs/abi/AllowlistLaunchHook.json`.

This stage delivers source, tests and ABI documentation only. `launch.json` is written by the separate
manifest assignment, and the website is built after the factory has opened the live pool. No deployment
script is included: the factory deploys both contracts (see "Deployment parameters").

## Token

- `constructor()` takes no arguments and mints the whole supply (`TOTAL_SUPPLY = 1_000_000_000e18`) to
  `msg.sender`, which at launch is the factory.
- No owner, no mint path after construction, no pause, no proxy, no `selfdestruct`. The implementation is
  solmate's audited `ERC20` (vendored under `lib/solmate`), which also provides EIP-2612 `permit`.
- Holding at least 1 ALST is the allowlist criterion of the hook, so the reward distribution the factory
  performs at launch is what populates the list.

## Hook

`AllowlistLaunchHook` extends v4-periphery `BaseHook`. Its only constructor argument is the PoolManager.

### Permissions

Exactly `afterInitialize` and `beforeSwap`. Address bits: `0x1080`
(`AFTER_INITIALIZE = 1 << 12`, `BEFORE_SWAP = 1 << 7`). No return deltas, no fees, no liquidity or donate
callbacks. The factory's pool initialisation and its one-sided ALST seed cannot be reverted by this hook,
and liquidity may be added or removed at any time, including inside the window.

### Behaviour

- State is keyed by `PoolId`. One deployment serves any number of pools.
- `afterInitialize`: if the pool's `currency0` is native ETH, records `openAt[poolId] = block.timestamp + 24 hours`
  and the pool's `currency1`. Pools whose `currency0` is not native ETH are never gated: nothing is recorded,
  `openAt` stays 0, `isOpen` is true, `isAllowed` is true.
- `beforeSwap`, while `block.timestamp < openAt[poolId]`: the swap (either direction) is allowed only if
  `tx.origin` holds at least `MIN_BALANCE = 1e18` units of the pool's `currency1`. Otherwise it reverts
  `NotAllowlisted(tx.origin)`. Each admitted swap emits `HolderSwap(poolId, origin, balance)`.
- From `openAt` on, anyone swaps. `beforeSwap` returns immediately, reads nothing and emits nothing.
- The balance is read with a low-level `staticcall` to `balanceOf` capped at `BALANCE_OF_GAS = 50_000`, and
  decoded only if the call succeeds and returns exactly 32 bytes. A revert, out-of-gas, empty, short or long
  return counts as a balance of zero, so a misbehaving token yields `NotAllowlisted`, never an unexpected
  error. Being a `staticcall`, it cannot reenter the pool manager or the hook.
- Views: `openAt(poolId)`, `isOpen(poolId)`, `isAllowed(poolId, account)` (true from `openAt` on, else the
  balance rule applied to `account`), `gatedCurrency1(poolId)`.
- Nothing can extend, shorten or reopen a window. There is no owner, signer, admin or fee.

Reverts raised from `beforeSwap` surface from the PoolManager wrapped as the ERC-7751
`WrappedError(hook, IHooks.beforeSwap.selector, abi.encode(NotAllowlisted(origin)), abi.encode(HookCallFailed()))`.

### Why `tx.origin`, and its limits

The hook credits nobody, so it does not need an authenticated swapper identity; the canonical "read identity
from hookData" rule is for hooks that credit someone. Here an address passed in `hookData` would let anyone
borrow a holder's place, and the v4 `sender` is the router, not the user. The transaction signer is the only
identity a hook can check without a trusted router. The consequences are deliberate and documented:

- **Contract wallets and ERC-4337 accounts** are judged by the EOA that sends the transaction (for 4337, the
  bundler), not by the smart account that holds the ALST. A holder whose ALST sits in a smart-contract wallet
  cannot swap during the window unless the sending EOA itself holds 1 ALST. Conversely, a contract that holds
  nothing can swap if the signing EOA holds ALST.
- **Phishing**: a malicious contract that a holder is tricked into calling can make that holder swap on the
  gated pool (with the holder's funds, subject to the router's own approvals and slippage limits).
- **The list is transferable**: sending 1 ALST to any wallet adds it to the list, and spending below 1 ALST
  removes it. There is no snapshot.
- **An empty window is possible**: if nobody has claimed launch rewards, no wallet outside the pool holds
  ALST and no swap can happen until `openAt`.
- **After the window** `tx.origin` is never read.

## Assumptions

- The launch pool key is `currency0 = native ETH (address 0)`, `currency1 = ALST`, `fee = 3000`,
  `tickSpacing = 60`, `hooks = AllowlistLaunchHook`. Static LP fee; the hook never sets a fee.
- The factory seeds one-sided ALST liquidity below the opening price, so the pool holds no ETH until the
  first buy. In v4 `amountSpecified < 0` is exact input and `zeroForOne` is a buy (ETH in, ALST out).
- The ALST held outside the pool at launch is the factory's reward distribution. Those wallets, and anyone
  they send at least 1 ALST to, are the allowlist for the first 24 hours.
- The 24 hour window starts at pool initialisation (`afterInitialize`), not at the first swap or at hook
  deployment.
- The hook is deployed at an address whose low 14 bits are exactly `0x1080`; the constructor
  (`Hooks.validateHookPermissions`) reverts otherwise.

## Deployment parameters

| Item                       | Value                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Network                    | Sepolia, chain id 11155111                                                         |
| PoolManager                | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`                                       |
| Token constructor          | none                                                                               |
| Hook constructor           | `(IPoolManager poolManager)` = the PoolManager above                               |
| Hook address bits          | `0x1080` (`afterInitialize | beforeSwap`); mine a CREATE2 salt (e.g. `HookMiner`)  |
| Pool key                   | `currency0 = 0x0`, `currency1 = ALST`, `fee = 3000`, `tickSpacing = 60`, `hooks`   |
| Window                     | `24 hours` from `initialize`, constant                                             |
| Threshold                  | `1e18` units of `currency1`, constant                                              |
| `balanceOf` gas cap        | `50_000`, constant                                                                 |
| Swap router for the site   | `PoolSwapTest` `0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`                        |
| Price source for the site  | `StateView` `0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C`                           |
| Quoter for the site        | `V4Quoter` `0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227`                            |
| Compiler                   | solc 0.8.26, optimizer 200 runs, evm `cancun`, `bytecode_hash = "none"`, no via-IR |

The three site addresses are those named in the approved workflow; they are not used by the contracts.

## Operational responsibilities

- **Factory / deployer**: deploy `Allowlist`, receive the supply, mine a CREATE2 salt for the hook so that the
  address carries `0x1080`, deploy the hook with the Sepolia PoolManager, initialise the pool with the key
  above, seed one-sided ALST liquidity, distribute rewards. The reward distribution must happen before or
  during the window for the window to be usable.
- **Manifest**: list exactly `afterInitialize` and `beforeSwap`; declare decimals 18 and the constructor
  arguments above. `HookFlags.flagsOf(hook) == 0x1080` must hold for the deployed address.
- **Reviewer**: independent adversarial review before admission. Tests are not an audit.
- **Nobody**: there is no admin role, no pause, no upgrade and no way to change the window after deployment.
  If the launch parameters are wrong, the remedy is a new deployment.
- **Frontend (later stage)**: show `openAt`, the connected wallet's ALST balance and `isAllowed`; route swaps
  through the listed `PoolSwapTest`, which forwards `hookData` and `sqrtPriceLimitX96`. Warn smart-wallet users
  about the `tx.origin` rule.

## Tests

`forge test` runs 29 tests against a real v4-core `PoolManager`:

- Launch rehearsal: one-sided ALST seed below the opening price into a pool holding no ETH, a first buy from a
  wallet holding ALST (a reward claimant), then a sell, with balances checked on both sides.
- Refusals: a non-holder, a wallet holding 1 ALST minus 1 wei, and a call where only `msg.sender` (not
  `tx.origin`) holds, each revert `NotAllowlisted`; the reverse (origin holds, calling contract does not) is
  admitted, documenting the contract-wallet limitation.
- Misbehaving `currency1`: `balanceOf` that reverts, returns 64, 31 or 0 bytes, burns all forwarded gas, or
  tries to reenter the PoolManager, each gives `NotAllowlisted` and not an unexpected error; the gas burn is
  bounded by the 50,000 cap.
- Window boundary: one second before `openAt` still gated; at exactly `openAt` a non-holder swaps and the hook
  emits nothing; after `openAt` the token is never read.
- Liquidity is never gated inside the window (a non-holder adds and removes ETH-only liquidity; the seed is
  placed and partially unwound with a non-holding `tx.origin`).
- Non-native pools are never gated. Direct callback calls from anyone but the PoolManager revert. The
  constructor refuses an address without the flags. Permissions match `0x1080` bit for bit.
- Token: metadata, single mint to deployer, no mint path (even for the deployer), exact transfers, allowance,
  fuzzed supply conservation.
- Fuzz: the threshold is exactly 1 ALST over a range of balances.

Tests read no environment variables and use no `ffi` or filesystem access.

## Layout

```
src/                     contracts
test/                    forge tests, test/mocks (MockERC20, misbehaving tokens), test/utils (CREATE2 miner)
docs/abi/                ABI exports
lib/                     vendored dependencies as plain files (see lib/VENDORED.md)
foundry.toml             solc 0.8.26, cancun, bytecode_hash = "none", ffi off, no fs permissions
```
