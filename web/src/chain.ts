import { createWalletClient, custom, encodeFunctionData, type Address, type EIP1193Provider, type Hex } from 'viem';
import type { Runtime } from './config';
import { priceLimit, unpackDelta } from './protocol.mjs';

export interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, callback: (...args: unknown[]) => void): void;
  removeListener?(event: string, callback: (...args: unknown[]) => void): void;
  providers?: Provider[];
}
declare global { interface Window { ethereum?: Provider } }
export type Snapshot = {
  block: bigint; timestamp: number; fetchedAt: number; openAt: number; open: boolean; decimals: number;
  sqrtPrice: bigint; tick: number; liquidity: bigint; balance?: bigint; nativeBalance?: bigint; allowance?: bigint;
  allowed?: boolean; contractWallet: boolean; account?: Address; events: { hash: Hex; origin: Address; balance: bigint }[]; eventError: boolean;
};
export type Quote = { amount: bigint; output: bigint; minimum: bigint; limit: bigint; buy: boolean; bps: number; hookData: Hex; account: Address; time: number };
export async function verifyDeployment(r: Runtime) {
  if (await r.client.getChainId() !== r.config.chainId) throw Error('The RPC returned the wrong chain. Transactions are disabled.');
  const addresses = [...r.config.contracts.map(c => c.address), r.config.integrations.swapRouter.address,
    r.config.network.uniswapV4.poolManager, r.config.network.uniswapV4.quoter, r.config.network.uniswapV4.stateView];
  const codes = await Promise.all(addresses.map(address => r.client.getCode({ address })));
  if (codes.some(code => !code || code === '0x')) throw Error('A required contract has no deployed code. Transactions are disabled.');
  const managers = await Promise.all([
    r.client.readContract({ address: r.hook.address, abi: r.hook.abi, functionName: 'poolManager' }),
    r.client.readContract({ address: r.config.integrations.swapRouter.address, abi: r.swapAbi, functionName: 'manager' }),
    r.client.readContract({ address: r.config.network.uniswapV4.quoter, abi: r.quoterAbi, functionName: 'poolManager' }),
    r.client.readContract({ address: r.config.network.uniswapV4.stateView, abi: r.stateAbi, functionName: 'poolManager' }),
  ]);
  if (managers.some(address => String(address).toLowerCase() !== r.config.network.uniswapV4.poolManager.toLowerCase())) throw Error('PoolManager binding does not match the supplied network.');
}
export async function readState(r: Runtime, account?: Address): Promise<Snapshot> {
  const block = await r.client.getBlock();
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 180) throw Error('The RPC block is stale or your device clock is incorrect. Check your clock and retry live reads.');
  const at = { blockNumber: block.number };
  const hookRead = (functionName: string, args: unknown[] = [r.id]) => r.client.readContract({ ...at, address: r.hook.address, abi: r.hook.abi, functionName, args });
  const tokenRead = (functionName: string, args: unknown[] = []) => r.client.readContract({ ...at, address: r.token.address, abi: r.token.abi, functionName, args });
  const [openAt, open, decimals, slot, liquidity, currency, balance, nativeBalance, allowance, allowed, code] = await Promise.all([
    hookRead('openAt'), hookRead('isOpen'), tokenRead('decimals'),
    r.client.readContract({ ...at, address: r.config.network.uniswapV4.stateView, abi: r.stateAbi, functionName: 'getSlot0', args: [r.id] }),
    r.client.readContract({ ...at, address: r.config.network.uniswapV4.stateView, abi: r.stateAbi, functionName: 'getLiquidity', args: [r.id] }),
    hookRead('gatedCurrency1'), account ? tokenRead('balanceOf', [account]) : undefined,
    account ? r.client.getBalance({ ...at, address: account }) : undefined,
    account ? tokenRead('allowance', [account, r.config.integrations.swapRouter.address]) : undefined,
    account ? hookRead('isAllowed', [r.id, account]) : undefined,
    account ? r.client.getCode({ ...at, address: account }) : undefined,
  ]);
  const [sqrtPrice, tick] = slot as readonly [bigint, number, number, number];
  if (sqrtPrice === 0n || !openAt || String(currency).toLowerCase() !== r.token.address.toLowerCase()) throw Error('The attested pool is not initialized or its token binding is wrong.');
  if (Number(decimals) !== r.config.token.decimals) throw Error('Token decimals differ from the handoff.');
  let events: Snapshot['events'] = [], eventError = false;
  try {
    const logs = await r.client.getContractEvents({ address: r.hook.address, abi: r.hook.abi, eventName: 'HolderSwap',
      args: { poolId: r.id }, fromBlock: block.number > 1000n ? block.number - 1000n : 0n, toBlock: block.number });
    events = logs.slice(-4).reverse().map(log => {
      const args = log.args as unknown as { origin: Address; balance: bigint };
      return { hash: log.transactionHash!, origin: args.origin, balance: args.balance };
    });
  } catch { eventError = true; }
  return { block: block.number, timestamp: Number(block.timestamp), fetchedAt: Date.now(), openAt: Number(openAt), open: Boolean(open), decimals: Number(decimals),
    sqrtPrice, tick, liquidity: liquidity as bigint, balance: balance as bigint | undefined, nativeBalance, allowance: allowance as bigint | undefined,
    allowed: allowed as boolean | undefined, account, contractWallet: Boolean(code && code !== '0x'), events, eventError };
}
export async function assertWallet(provider: Provider, account: Address, chainId: number) {
  const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
  if (Number(chain) !== chainId) throw Error('Wallet network changed. Switch networks and get a new quote.');
  if (!(accounts as string[])[0] || (accounts as string[])[0].toLowerCase() !== account.toLowerCase()) throw Error('Wallet account changed. Get a new quote.');
}
export async function switchChain(provider: Provider, r: Runtime) {
  const params = [{ chainId: r.config.walletAddChain.chainId }];
  try { await provider.request({ method: 'wallet_switchEthereumChain', params }); }
  catch (error) {
    const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(e.message ?? '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [r.config.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params });
  }
}
export function requireReady(state: Snapshot, account: Address) {
  if (state.account?.toLowerCase() !== account.toLowerCase() || Date.now() - state.fetchedAt > 45000 || !state.allowed) throw Error('Access is unavailable or stale. Refresh your access.');
  if (!state.open && state.contractWallet) throw Error('Use a directly connected EOA during the holder window. Contract wallets are checked by their sending EOA.');
}
export async function getQuote(r: Runtime, state: Snapshot, account: Address, amount: bigint, buy: boolean, bps: number, hookData: Hex): Promise<Quote> {
  requireReady(state, account);
  const balance = buy ? state.nativeBalance : state.balance;
  if (balance === undefined || amount > balance) throw Error(`Insufficient ${buy ? 'ETH' : 'ALST'} balance. Enter a smaller amount.`);
  const result = await r.client.simulateContract({ address: r.config.network.uniswapV4.quoter, abi: r.quoterAbi,
    functionName: 'quoteExactInputSingle', args: [{ poolKey: r.key, zeroForOne: buy, exactAmount: amount, hookData }], account });
  const [output] = result.result as readonly [bigint, bigint];
  if (output <= 0n) throw Error('This amount has no available output. Try a smaller amount or wait for liquidity.');
  return { amount, output, minimum: output * (10000n - BigInt(bps)) / 10000n, limit: priceLimit(state.sqrtPrice, buy, bps), buy, bps, hookData, account, time: Date.now() };
}
export async function sendAction(r: Runtime, provider: Provider, quote: Quote, approval: boolean, guard: () => void) {
  guard();
  await assertWallet(provider, quote.account, r.config.chainId);
  await verifyDeployment(r);
  const state = await readState(r, quote.account);
  requireReady(state, quote.account);
  guard();
  if (Date.now() - quote.time > 30000) throw Error('Quote expired. Get a new quote before continuing.');
  const address = approval ? r.token.address : r.config.integrations.swapRouter.address;
  const abi = approval ? r.token.abi : [...r.swapAbi, ...r.hook.abi.filter(item => item.type === 'error')];
  const functionName = approval ? 'approve' : 'swap';
  const args = approval ? [r.config.integrations.swapRouter.address, quote.amount] : [r.key,
    { zeroForOne: quote.buy, amountSpecified: -quote.amount, sqrtPriceLimitX96: quote.limit },
    { takeClaims: false, settleUsingBurn: false }, quote.hookData];
  if (approval && quote.buy) throw Error('Native ETH never needs an approval.');
  if (!approval && !quote.buy && (state.allowance ?? 0n) < quote.amount) throw Error('Approve this ALST amount first.');
  if (quote.amount > (quote.buy ? state.nativeBalance ?? 0n : state.balance ?? 0n)) throw Error('Balance changed. Enter a smaller amount.');
  const value = !approval && quote.buy ? quote.amount : 0n;
  const simulated = await r.client.simulateContract({ address, abi, functionName, args, account: quote.account, value });
  if (!approval) {
    const delta = unpackDelta(simulated.result as bigint, quote.buy);
    if (delta.spent !== quote.amount || delta.received < quote.minimum) throw Error('The price limit or available liquidity prevents this full swap. Reduce the amount and get a new quote.');
  } else if (simulated.result !== true) throw Error('Token approval simulation returned false.');
  const data = encodeFunctionData({ abi, functionName, args });
  const gas = await r.client.estimateGas({ account: quote.account, to: address, data, value });
  const gasPrice = await r.client.getGasPrice();
  if ((state.nativeBalance ?? 0n) < value + gas * gasPrice * 12n / 10n) throw Error('Leave enough ETH for the transaction fee. Enter a smaller amount.');
  await assertWallet(provider, quote.account, r.config.chainId);
  guard();
  if (Date.now() - quote.time > 30000) throw Error('Quote expired during simulation. Get a new quote.');
  const wallet = createWalletClient({ chain: r.chain, transport: custom(provider as EIP1193Provider) });
  return wallet.sendTransaction({ account: quote.account, chain: r.chain, to: address, data, value });
}
