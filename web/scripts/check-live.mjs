import { integrationAbis } from '../config/integration-abis.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, http } from 'viem';
import { poolId } from '../src/protocol.mjs';
const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(await readFile(resolve(root,'dist/imd-deployment.json'),'utf8'));
const contracts = await Promise.all(config.contracts.map(async c => ({...c, abi:JSON.parse(await readFile(resolve(root,'dist',c.abiPath),'utf8'))})));
const token = contracts.find(c => c.name === config.token.contract), hook = contracts.find(c => c.name === config.hook.contract);
const id = poolId({currency0:config.pool.pairedCurrency,currency1:token.address,fee:config.pool.fee,tickSpacing:config.pool.tickSpacing,hooks:hook.address});
const report = { checkedAt: new Date().toISOString(), poolId: id, endpoints: [], state: null, broadcastTransactions: 0 };
for (const url of config.network.rpcUrls) {
  const client = createPublicClient({ transport:http(url,{timeout:8000,retryCount:0}) });
  try {
    const chainId = await client.getChainId();
    const items = [...contracts, {name:'PoolSwapTest',address:config.integrations.swapRouter.address}, ...['poolManager','quoter','stateView'].map(name=>({name,address:config.network.uniswapV4[name]}))];
    const code = await Promise.all(items.map(async c=>({name:c.name,address:c.address,bytes:((await client.getCode({address:c.address}))?.length-2)/2})));
    report.endpoints.push({url,chainId,code,result:chainId===config.chainId && code.every(c=>c.bytes>0)?'pass':'fail'});
    if (!report.state) {
      const [block,openAt,open,slot,liquidity,routerManager] = await Promise.all([
        client.getBlock(),client.readContract({address:hook.address,abi:hook.abi,functionName:'openAt',args:[id]}),
        client.readContract({address:hook.address,abi:hook.abi,functionName:'isOpen',args:[id]}),
        client.readContract({address:config.network.uniswapV4.stateView,abi:integrationAbis.StateView,functionName:'getSlot0',args:[id]}),
        client.readContract({address:config.network.uniswapV4.stateView,abi:integrationAbis.StateView,functionName:'getLiquidity',args:[id]}),
        client.readContract({address:config.integrations.swapRouter.address,abi:integrationAbis.PoolSwapTest,functionName:'manager'}),
      ]);
      report.state = {block:block.number,timestamp:block.timestamp,openAt,open,slot,liquidity,routerManager};
    }
  } catch(e) { report.endpoints.push({url,result:'unavailable',error:e.shortMessage||e.message}); }
}
const json=JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
await writeFile(resolve(root,'docs/evidence/live-rpc.json'),json); console.log(json);
