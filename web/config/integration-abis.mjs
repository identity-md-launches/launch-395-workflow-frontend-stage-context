import { parseAbi } from 'viem';

// Minimal interfaces transcribed from the pinned implementation's vendored Solidity.
// Deployed ALST and hook ABIs are loaded from the attested implementation exports instead.
export const integrationAbis = {
  PoolSwapTest: parseAbi([
    'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
    'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }',
    'struct TestSettings { bool takeClaims; bool settleUsingBurn; }',
    'function manager() view returns (address)',
    'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)',
  ]),
  V4Quoter: parseAbi([
    'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
    'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
    'function poolManager() view returns (address)',
    'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  ]),
  StateView: parseAbi([
    'function poolManager() view returns (address)',
    'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
    'function getLiquidity(bytes32 poolId) view returns (uint128)',
  ]),
};
