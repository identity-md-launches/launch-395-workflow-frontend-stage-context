import { createPublicClient, defineChain, fallback, http, isAddress, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { abiHash, poolId } from './protocol.mjs';

export type Contract = { name: string; address: Address; abiHash: string; abiPath: string; abi: Abi };
export type Deployment = {
  version: number; launchId: string; sourceCommit: string; chainId: number; attestationHash: string;
  contracts: Contract[]; assets: { path: string; sha256: string }[];
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<'poolManager' | 'universalRouter' | 'quoter' | 'stateView' | 'positionManager' | 'permit2', Address> };
  walletAddChain: { chainId: Hex; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls: string[] };
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number; initialPrice: string };
  token: { contract: string; name: string; symbol: string; decimals: number }; hook: { contract: string };
  integrations: { swapRouter: { name: string; address: Address; abiPath: string }; quoterAbiPath: string; stateViewAbiPath: string };
};
function safePath(path: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw Error('Unsafe deployment asset path');
  return path;
}
export async function loadConfig() {
  const response = await fetch(new URL('./imd-deployment.json', document.baseURI), { cache: 'no-cache' });
  if (!response.ok) throw Error('Deployment configuration could not be loaded. Reload to try again.');
  const config: Deployment = await response.json();
  if (config.version !== 1 || config.chainId !== config.network.chainId || BigInt(config.walletAddChain.chainId) !== BigInt(config.chainId)) throw Error('Deployment network is inconsistent.');
  if (!config.network.rpcUrls.length || config.network.rpcUrls.some(url => !url.startsWith('https://'))) throw Error('Public RPC configuration is missing.');
  const loadAbi = async (path: string, expected?: string): Promise<Abi> => {
    const asset = config.assets.find(item => item.path === path);
    if (!asset) throw Error(`ABI missing from asset inventory: ${path}`);
    const res = await fetch(new URL(safePath(path), document.baseURI));
    if (!res.ok) throw Error(`Unable to load ${path}. Reload to try again.`);
    const bytes = await res.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== asset.sha256) throw Error(`ABI asset integrity failed: ${path}`);
    const abi: Abi = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(abi) || (expected && abiHash(abi) !== expected)) throw Error(`ABI attestation mismatch: ${path}`);
    return abi;
  };
  config.contracts = await Promise.all(config.contracts.map(async c => {
    if (!isAddress(c.address)) throw Error(`Invalid contract address: ${c.name}`);
    return { ...c, abi: await loadAbi(c.abiPath, c.abiHash) };
  }));
  const token = config.contracts.find(c => c.name === config.token.contract);
  const hook = config.contracts.find(c => c.name === config.hook.contract);
  if (!token || !hook || config.pool.pairedCurrency !== zeroAddress) throw Error('This interface requires the attested native ETH / ALST pool.');
  for (const address of [...Object.values(config.network.uniswapV4), config.integrations.swapRouter.address]) if (!isAddress(address)) throw Error('Invalid integration address');
  const [swapAbi, quoterAbi, stateAbi] = await Promise.all([
    loadAbi(config.integrations.swapRouter.abiPath), loadAbi(config.integrations.quoterAbiPath), loadAbi(config.integrations.stateViewAbiPath),
  ]);
  const chain = defineChain({ id: config.chainId, name: config.network.name, nativeCurrency: config.network.nativeCurrency,
    rpcUrls: { default: { http: config.network.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: config.network.explorer } }, testnet: config.network.testnet });
  const client = createPublicClient({ chain, transport: fallback(config.network.rpcUrls.map(url => http(url, { timeout: 7000, retryCount: 0 })), { retryCount: 0 }), batch: { multicall: false } });
  const key = { currency0: config.pool.pairedCurrency, currency1: token.address, fee: config.pool.fee, tickSpacing: config.pool.tickSpacing, hooks: hook.address };
  return { config, token, hook, swapAbi, quoterAbi, stateAbi, chain, client, key, id: poolId(key) as Hex };
}
export type Runtime = Awaited<ReturnType<typeof loadConfig>>;
