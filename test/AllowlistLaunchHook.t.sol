// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {SwapRouterNoChecks} from "v4-core/src/test/SwapRouterNoChecks.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ImmutableState} from "v4-periphery/src/base/ImmutableState.sol";

import {Allowlist} from "../src/Allowlist.sol";
import {AllowlistLaunchHook} from "../src/AllowlistLaunchHook.sol";
import {HookFlags} from "../src/HookFlags.sol";
import {HookDeployer} from "./utils/HookDeployer.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {
    RevertingBalanceToken,
    LongReturnToken,
    ShortReturnToken,
    EmptyReturnToken,
    GasBurningToken,
    ReenteringToken
} from "./mocks/BadTokens.sol";

/// @notice Runs the hook against a real v4-core PoolManager: the launch rehearsal (one-sided ALST seed, a
/// first buy into an ETH-less pool, then a sell) plus every acceptance case from the workflow.
contract AllowlistLaunchHookTest is Test, HookDeployer {
    using StateLibrary for IPoolManager;

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 constant DECLARED_FLAGS = 0x1080;
    uint24 constant LP_FEE = 3_000;
    int24 constant TICK_SPACING = 60;
    uint256 constant ONE_TOKEN = 1e18;

    /// @dev One-sided seed: entirely below the opening tick (0), so the position holds only ALST.
    int24 constant SEED_TICK_LOWER = -6_000;
    int24 constant SEED_TICK_UPPER = -60;
    int256 constant SEED_LIQUIDITY = 1_000_000e18;

    PoolManager manager;
    Allowlist token;
    AllowlistLaunchHook hook;
    PoolSwapTest swapRouter;
    /// @dev `PoolSwapTest` reads `balanceOf` on both currencies before swapping, which the misbehaving
    /// tokens below would break outside the hook. This router does no such reads.
    SwapRouterNoChecks rawRouter;
    PoolModifyLiquidityTest lpRouter;

    PoolKey key;
    PoolId poolId;
    uint256 initTime;

    address holder = makeAddr("holder"); // stands in for a launch reward claimant
    address nonHolder = makeAddr("nonHolder");
    address contractWallet = makeAddr("contractWallet");

    receive() external payable {}

    function setUp() public {
        manager = new PoolManager(address(this));
        token = new Allowlist(); // this test contract is the "factory": it holds the whole supply
        hook = AllowlistLaunchHook(
            deployAtFlags(abi.encodePacked(type(AllowlistLaunchHook).creationCode, abi.encode(manager)), DECLARED_FLAGS)
        );
        swapRouter = new PoolSwapTest(manager);
        rawRouter = new SwapRouterNoChecks(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        initTime = 1_700_000_000;
        vm.warp(initTime);
        manager.initialize(key, SQRT_PRICE_1_1);

        // The factory seeds one-sided ALST liquidity inside the window. tx.origin here is forge's default
        // sender, which holds no ALST, so this also proves the seed is not gated.
        token.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams(SEED_TICK_LOWER, SEED_TICK_UPPER, SEED_LIQUIDITY, bytes32(0)), ""
        );
        assertEq(address(manager).balance, 0, "seeded pool must hold no ETH");
        assertGt(token.balanceOf(address(manager)), 0, "seeded pool must hold ALST");

        // Reward claimant: a wallet that holds some ALST outside the pool.
        token.transfer(holder, 5 * ONE_TOKEN);
        vm.deal(holder, 100 ether);
        vm.deal(nonHolder, 100 ether);
        vm.deal(contractWallet, 100 ether);
    }

    // ---------------------------------------------------------------- helpers

    function buyParams(int256 ethIn) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: ethIn, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1});
    }

    function sellParams(int256 tokenIn) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: false, amountSpecified: tokenIn, sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1});
    }

    function settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
    }

    /// @dev Buys with `ethIn` wei from `sender`, with `origin` as the transaction signer.
    function buy(address sender, address origin, uint256 ethIn) internal returns (BalanceDelta) {
        vm.prank(sender, origin);
        return swapRouter.swap{value: ethIn}(key, buyParams(-int256(ethIn)), settings(), "");
    }

    /// @dev Expects the pool manager's ERC-7751 wrapping of `NotAllowlisted(origin)` raised from `beforeSwap`.
    function expectNotAllowlisted(address origin) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeSwap.selector,
                abi.encodeWithSelector(AllowlistLaunchHook.NotAllowlisted.selector, origin),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function gatedPoolFor(address currency1) internal returns (PoolKey memory k) {
        k = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(currency1),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        manager.initialize(k, SQRT_PRICE_1_1);
    }

    // ---------------------------------------------------------------- shape

    function test_permissionsAreExactlyAfterInitializeAndBeforeSwap() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.afterInitialize);
        assertTrue(p.beforeSwap);
        assertFalse(p.beforeInitialize);
        assertFalse(p.beforeAddLiquidity);
        assertFalse(p.afterAddLiquidity);
        assertFalse(p.beforeRemoveLiquidity);
        assertFalse(p.afterRemoveLiquidity);
        assertFalse(p.afterSwap);
        assertFalse(p.beforeDonate);
        assertFalse(p.afterDonate);
        assertFalse(p.beforeSwapReturnDelta);
        assertFalse(p.afterSwapReturnDelta);
        assertFalse(p.afterAddLiquidityReturnDelta);
        assertFalse(p.afterRemoveLiquidityReturnDelta);

        assertEq(HookFlags.flagsOf(address(hook)), DECLARED_FLAGS);
        assertEq(HookFlags.AFTER_INITIALIZE | HookFlags.BEFORE_SWAP, DECLARED_FLAGS);
        assertEq(address(hook.poolManager()), address(manager));
    }

    function test_constructorRefusesAnAddressWithoutTheFlags() public {
        // A plain CREATE lands on an address whose low bits almost surely do not spell 0x1080.
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.assume(!HookFlags.matches(predicted, DECLARED_FLAGS));
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new AllowlistLaunchHook(manager);
    }

    function test_callbacksRefuseCallersOtherThanThePoolManager() public {
        vm.expectRevert(ImmutableState.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, SQRT_PRICE_1_1, 0);

        vm.expectRevert(ImmutableState.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, buyParams(-1 ether), "");
    }

    function test_afterInitializeOpensA24HourWindow() public view {
        assertEq(hook.WINDOW(), 24 hours);
        assertEq(hook.openAt(poolId), initTime + 24 hours);
        assertFalse(hook.isOpen(poolId));
        assertEq(Currency.unwrap(hook.gatedCurrency1(poolId)), address(token));
    }

    function test_nonNativePoolIsNeverGated() public {
        MockERC20 a = new MockERC20("A", "A", 1_000_000e18);
        MockERC20 b = new MockERC20("B", "B", 1_000_000e18);
        (MockERC20 t0, MockERC20 t1) = address(a) < address(b) ? (a, b) : (b, a);
        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        manager.initialize(k, SQRT_PRICE_1_1);
        PoolId id = k.toId();

        assertEq(hook.openAt(id), 0);
        assertTrue(hook.isOpen(id));
        assertTrue(hook.isAllowed(id, nonHolder));
        assertEq(Currency.unwrap(hook.gatedCurrency1(id)), address(0));

        t0.approve(address(lpRouter), type(uint256).max);
        t1.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(k, ModifyLiquidityParams(-600, 600, 100_000e18, bytes32(0)), "");

        // A signer holding neither token swaps inside what would be the window.
        t0.mint(nonHolder, 10e18);
        vm.startPrank(nonHolder, nonHolder);
        t0.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(k, SwapParams(true, -1e18, TickMath.MIN_SQRT_PRICE + 1), settings(), "");
        vm.stopPrank();
        assertGt(t1.balanceOf(nonHolder), 0);
    }

    // ---------------------------------------------------------------- launch rehearsal

    function test_launchRehearsal_holderBuysIntoEthlessPoolThenSells() public {
        uint256 ethIn = 1 ether;
        uint256 tokensBefore = token.balanceOf(holder);

        vm.expectEmit(true, true, true, true, address(hook));
        emit AllowlistLaunchHook.HolderSwap(poolId, holder, tokensBefore);
        BalanceDelta buyDelta = buy(holder, holder, ethIn);

        assertEq(buyDelta.amount0(), -int256(ethIn), "exact ETH input");
        assertGt(buyDelta.amount1(), 0, "received ALST");
        uint256 bought = uint256(int256(buyDelta.amount1()));
        assertEq(token.balanceOf(holder), tokensBefore + bought);
        assertEq(address(manager).balance, ethIn, "the first buy funds the pool with ETH");
        assertEq(holder.balance, 100 ether - ethIn);

        // Sell half of what was bought back into the pool.
        uint256 sellAmount = bought / 2;
        vm.startPrank(holder, holder);
        token.approve(address(swapRouter), sellAmount);
        vm.expectEmit(true, true, true, true, address(hook));
        emit AllowlistLaunchHook.HolderSwap(poolId, holder, tokensBefore + bought);
        BalanceDelta sellDelta = swapRouter.swap(key, sellParams(-int256(sellAmount)), settings(), "");
        vm.stopPrank();

        assertEq(sellDelta.amount1(), -int256(sellAmount), "exact ALST input");
        assertGt(sellDelta.amount0(), 0, "received ETH");
        uint256 ethOut = uint256(int256(sellDelta.amount0()));
        assertLt(ethOut, ethIn, "fees and price impact keep the round trip below the input");
        assertEq(holder.balance, 100 ether - ethIn + ethOut);
        assertEq(address(manager).balance, ethIn - ethOut);
        assertEq(token.balanceOf(holder), tokensBefore + bought - sellAmount);
    }

    // ---------------------------------------------------------------- refusals inside the window

    function test_nonHolderRevertsInsideWindow() public {
        expectNotAllowlisted(nonHolder);
        buy(nonHolder, nonHolder, 1 ether);
        assertEq(address(manager).balance, 0);
    }

    function test_oneWeiBelowThresholdReverts() public {
        address almost = makeAddr("almost");
        vm.deal(almost, 10 ether);
        token.transfer(almost, ONE_TOKEN - 1);
        assertFalse(hook.isAllowed(poolId, almost));

        expectNotAllowlisted(almost);
        buy(almost, almost, 1 ether);

        // Exactly the threshold is enough.
        token.transfer(almost, 1);
        assertTrue(hook.isAllowed(poolId, almost));
        buy(almost, almost, 1 ether);
        assertEq(address(manager).balance, 1 ether);
    }

    function test_onlyMsgSenderHoldingIsNotEnough() public {
        // msg.sender (holder) has ALST, tx.origin (nonHolder) does not: refused, and the error names tx.origin.
        expectNotAllowlisted(nonHolder);
        buy(holder, nonHolder, 1 ether);
    }

    function test_originHoldingAdmitsAContractWalletThatDoesNot() public {
        // The reverse of the previous case: the signer holds ALST, the calling contract does not. This is the
        // documented contract-wallet limitation: the EOA that sends the transaction is what is judged.
        assertEq(token.balanceOf(contractWallet), 0);
        buy(contractWallet, holder, 1 ether);
        assertEq(address(manager).balance, 1 ether);
    }

    function test_sendingOneTokenAddsAWalletToTheList() public {
        assertFalse(hook.isAllowed(poolId, nonHolder));
        vm.prank(holder);
        token.transfer(nonHolder, ONE_TOKEN);
        assertTrue(hook.isAllowed(poolId, nonHolder));
        buy(nonHolder, nonHolder, 0.5 ether);
    }

    function testFuzz_thresholdIsExactlyOneToken(uint256 held) public {
        held = bound(held, 0, 1_000 * ONE_TOKEN);
        address wallet = makeAddr("fuzzWallet");
        vm.deal(wallet, 10 ether);
        if (held > 0) token.transfer(wallet, held);

        if (held < ONE_TOKEN) {
            assertFalse(hook.isAllowed(poolId, wallet));
            expectNotAllowlisted(wallet);
            buy(wallet, wallet, 0.1 ether);
        } else {
            assertTrue(hook.isAllowed(poolId, wallet));
            buy(wallet, wallet, 0.1 ether);
            assertEq(address(manager).balance, 0.1 ether);
        }
    }

    // ---------------------------------------------------------------- misbehaving currency1

    function test_revertingBalanceOfIsNotAllowlisted() public {
        PoolKey memory k = gatedPoolFor(address(new RevertingBalanceToken()));
        assertFalse(hook.isAllowed(k.toId(), holder));
        expectNotAllowlisted(holder);
        vm.prank(holder, holder);
        rawRouter.swap{value: 1 ether}(k, buyParams(-1 ether));
    }

    function test_garbageReturnIsNotAllowlisted() public {
        address[3] memory bad =
            [address(new LongReturnToken()), address(new ShortReturnToken()), address(new EmptyReturnToken())];
        for (uint256 i = 0; i < bad.length; i++) {
            PoolKey memory k = gatedPoolFor(bad[i]);
            assertFalse(hook.isAllowed(k.toId(), holder));
            expectNotAllowlisted(holder);
            vm.prank(holder, holder);
            rawRouter.swap{value: 1 ether}(k, buyParams(-1 ether));
        }
    }

    function test_gasBurningBalanceOfIsNotAllowlisted() public {
        PoolKey memory k = gatedPoolFor(address(new GasBurningToken()));
        assertFalse(hook.isAllowed(k.toId(), holder));

        uint256 before = gasleft();
        expectNotAllowlisted(holder);
        vm.prank(holder, holder);
        rawRouter.swap{value: 1 ether}(k, buyParams(-1 ether));
        // The token could only burn the capped 50,000 gas, not the whole transaction.
        assertLt(before - gasleft(), 400_000, "balanceOf gas was not capped");
    }

    function test_reenteringBalanceOfIsNotAllowlisted() public {
        PoolKey memory k = gatedPoolFor(address(new ReenteringToken(manager)));
        assertFalse(hook.isAllowed(k.toId(), holder));
        expectNotAllowlisted(holder);
        vm.prank(holder, holder);
        rawRouter.swap{value: 1 ether}(k, buyParams(-1 ether));
    }

    // ---------------------------------------------------------------- window boundary

    function test_oneSecondBeforeOpenAtStillGated() public {
        vm.warp(initTime + 24 hours - 1);
        assertFalse(hook.isOpen(poolId));
        expectNotAllowlisted(nonHolder);
        buy(nonHolder, nonHolder, 1 ether);
    }

    function test_atExactlyOpenAtANonHolderSwaps() public {
        vm.warp(initTime + 24 hours);
        assertTrue(hook.isOpen(poolId));
        assertTrue(hook.isAllowed(poolId, nonHolder));

        vm.recordLogs();
        buy(nonHolder, nonHolder, 1 ether);
        assertEq(address(manager).balance, 1 ether);
        assertGt(token.balanceOf(nonHolder), 0);

        // Nothing is read and nothing is emitted by the hook after the window.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].emitter != address(hook), "hook emitted after the window");
        }
    }

    function test_afterOpenAtTheTokenIsNeverRead() public {
        // Driven as the pool manager would, so the pool's own liquidity checks do not get in the way.
        PoolKey memory k = gatedPoolFor(address(new GasBurningToken()));

        vm.prank(address(manager), nonHolder);
        vm.expectRevert(abi.encodeWithSelector(AllowlistLaunchHook.NotAllowlisted.selector, nonHolder));
        hook.beforeSwap(address(rawRouter), k, buyParams(-1 ether), "");

        vm.warp(initTime + 24 hours);
        assertTrue(hook.isAllowed(k.toId(), nonHolder));
        vm.recordLogs();
        vm.prank(address(manager), nonHolder);
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) =
            hook.beforeSwap(address(rawRouter), k, buyParams(-1 ether), "");
        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), BeforeSwapDelta.unwrap(BeforeSwapDeltaLibrary.ZERO_DELTA));
        assertEq(fee, 0);
        assertEq(vm.getRecordedLogs().length, 0, "no HolderSwap after the window");
    }

    // ---------------------------------------------------------------- liquidity is never gated

    function test_liquidityIsNeverGatedInsideTheWindow() public {
        // A non-holder adds ETH-only liquidity above the price (no ALST needed) and removes it, both inside
        // the window, both with tx.origin holding nothing.
        vm.startPrank(nonHolder, nonHolder);
        lpRouter.modifyLiquidity{value: 5 ether}(key, ModifyLiquidityParams(60, 6_000, 10e18, bytes32(0)), "");
        assertGt(address(manager).balance, 0);
        lpRouter.modifyLiquidity(key, ModifyLiquidityParams(60, 6_000, -10e18, bytes32(0)), "");
        vm.stopPrank();
        assertLt(address(manager).balance, 10, "only rounding dust stays behind");

        // The factory (test contract, forge's default tx.origin holding nothing) unwinds part of its seed.
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams(SEED_TICK_LOWER, SEED_TICK_UPPER, -SEED_LIQUIDITY / 2, bytes32(0)), ""
        );
        assertEq(
            IPoolManager(address(manager)).getLiquidity(poolId),
            0,
            "price is outside the seed range, so active liquidity is 0"
        );
    }

    // ---------------------------------------------------------------- views

    function test_isAllowedFollowsTheWindowAndTheBalance() public {
        assertTrue(hook.isAllowed(poolId, holder));
        assertFalse(hook.isAllowed(poolId, nonHolder));
        assertFalse(hook.isAllowed(poolId, address(0)));

        vm.warp(initTime + 24 hours);
        assertTrue(hook.isAllowed(poolId, holder));
        assertTrue(hook.isAllowed(poolId, nonHolder));

        // An id the hook never saw is open and allows everyone.
        PoolId unknown = PoolId.wrap(keccak256("unknown"));
        assertTrue(hook.isOpen(unknown));
        assertTrue(hook.isAllowed(unknown, nonHolder));
    }

    function test_beforeSwapGasInsideWindow() public {
        uint256 before = gasleft();
        buy(holder, holder, 1 ether);
        uint256 used = before - gasleft();
        // Whole router round trip (unlock, swap, settle, take). The hook's own share is a few SLOADs, one
        // capped staticcall and one event.
        assertLt(used, 300_000);
    }
}
