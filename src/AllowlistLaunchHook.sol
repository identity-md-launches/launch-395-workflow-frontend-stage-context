// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

/// @title AllowlistLaunchHook
/// @notice Gates the first 24 hours of a native-ETH Uniswap v4 pool to wallets that already hold the pool's
/// token. The allowlist is the token's existing holder set: while the window is open a swap in either
/// direction is allowed only if the transaction signer (`tx.origin`) holds at least 1 whole token
/// (10^18 units) of the pool's `currency1`. From `openAt` on, anyone swaps and nothing is read.
///
/// @dev Design, in the order a reviewer will ask about it:
///
/// - Constructor: exactly one argument, the PoolManager. No owner, signer, admin, fee, recipient or
///   token address. Nothing can extend, shorten or reopen a window. State is keyed by `PoolId`, so one
///   deployment serves any number of pools.
/// - Permissions: exactly `afterInitialize` and `beforeSwap` (address bits `0x1080`). No return deltas, no
///   fees, no liquidity or donate callbacks, so the factory's one-sided seed and any LP activity inside
///   the window are never touched by this contract.
/// - Scope: only pools whose `currency0` is native ETH are gated. For any other pool `afterInitialize`
///   records nothing, `openAt` stays 0, `isOpen` is true and `beforeSwap` reads nothing.
/// - Identity: `tx.origin` deliberately. The hook credits nobody, so nothing needs an authenticated
///   swapper; the v4 `sender` is the router, and an address passed in `hookData` would let anyone borrow
///   a holder's place. The transaction signer is the only identity a hook can check without a trusted
///   router. Consequences, all documented in the README too:
///     * contract wallets and ERC-4337 accounts are judged by the EOA that sends the transaction
///       (the bundler, for 4337), not by the account that holds the tokens;
///     * a phishing contract that a holder calls can make that holder swap on the gated pool;
///     * sending 1 ALST to any wallet adds it to the list, and spending below 1 ALST removes it;
///     * the window can pass with no swaps at all if nobody has claimed rewards;
///     * `tx.origin` is never read once the window has passed.
/// - Balance read: a low-level `staticcall` to `balanceOf` capped at 50,000 gas, decoded only when the
///   call succeeds and returns exactly 32 bytes. A revert, an out-of-gas or a malformed return counts as
///   a balance of zero, so a misbehaving token can only ever produce `NotAllowlisted`, never an
///   unexpected revert with a different reason. The read is static, so it cannot reenter.
contract AllowlistLaunchHook is BaseHook {
    /// @notice Length of the gated window, counted from pool initialisation.
    uint256 public constant WINDOW = 24 hours;

    /// @notice Minimum `currency1` balance (in the token's smallest unit) that admits a signer inside the window.
    uint256 public constant MIN_BALANCE = 1e18;

    /// @notice Gas forwarded to the token's `balanceOf` during the window.
    uint256 public constant BALANCE_OF_GAS = 50_000;

    /// @notice Timestamp from which a pool is open to everyone. Zero for pools this hook never gated.
    mapping(PoolId poolId => uint256 timestamp) public openAt;

    /// @notice The `currency1` of each gated pool, kept so `isAllowed` can read a balance from a pool id.
    mapping(PoolId poolId => Currency currency) public gatedCurrency1;

    /// @notice Emitted for every swap admitted inside the window.
    /// @param poolId The pool being swapped on.
    /// @param origin The transaction signer that passed the balance rule.
    /// @param balance The signer's `currency1` balance at the time of the swap.
    event HolderSwap(PoolId indexed poolId, address indexed origin, uint256 balance);

    /// @notice The transaction signer does not hold `MIN_BALANCE` of the pool's `currency1` and the window
    /// has not passed.
    error NotAllowlisted(address origin);

    /// @param poolManager The Uniswap v4 PoolManager this hook serves. On Sepolia:
    /// 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543.
    constructor(IPoolManager poolManager) BaseHook(poolManager) {}

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice True once the window for `poolId` has passed (always true for pools this hook never gated).
    function isOpen(PoolId poolId) public view returns (bool) {
        return block.timestamp >= openAt[poolId];
    }

    /// @notice Whether `account` could swap on `poolId` right now if it were the transaction signer.
    /// @dev True from `openAt` on; before that, the balance rule applied to `account`.
    function isAllowed(PoolId poolId, address account) external view returns (bool) {
        if (isOpen(poolId)) return true;
        return _balanceOf(gatedCurrency1[poolId], account) >= MIN_BALANCE;
    }

    /// @dev Opens a 24 hour window for native-ETH pools; records nothing for any other pool.
    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal override returns (bytes4) {
        if (key.currency0.isAddressZero()) {
            PoolId poolId = key.toId();
            openAt[poolId] = block.timestamp + WINDOW;
            gatedCurrency1[poolId] = key.currency1;
        }
        return BaseHook.afterInitialize.selector;
    }

    /// @dev Inside the window, admits the swap only if `tx.origin` holds `MIN_BALANCE` of `currency1`.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        if (block.timestamp < openAt[poolId]) {
            uint256 balance = _balanceOf(key.currency1, tx.origin);
            if (balance < MIN_BALANCE) revert NotAllowlisted(tx.origin);
            emit HolderSwap(poolId, tx.origin, balance);
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev `balanceOf(account)` on `currency`, capped at `BALANCE_OF_GAS`. Returns 0 unless the call succeeds
    /// and returns exactly 32 bytes. Return data is only copied when it is exactly one word, so a token
    /// returning a large blob cannot bill this contract for the copy.
    function _balanceOf(Currency currency, address account) internal view returns (uint256 held) {
        address token = Currency.unwrap(currency);
        if (token == address(0)) return 0;
        bytes memory data = abi.encodeCall(IERC20Minimal.balanceOf, (account));
        uint256 gasCap = BALANCE_OF_GAS;
        assembly ("memory-safe") {
            let ok := staticcall(gasCap, token, add(data, 0x20), mload(data), 0, 0)
            if and(ok, eq(returndatasize(), 32)) {
                returndatacopy(0x00, 0x00, 32)
                held := mload(0x00)
            }
        }
    }
}
