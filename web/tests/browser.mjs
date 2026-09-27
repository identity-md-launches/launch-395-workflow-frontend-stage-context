import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, toHex } from 'viem';
import { sqrt } from '../src/protocol.mjs';
const root = resolve(import.meta.dirname, '../..'), out = resolve(root,'dist'), evidence = resolve(root,'docs/evidence');
const manifest = JSON.parse(await readFile(resolve(out,'imd-deployment.json'),'utf8'));
const abis = {};
for (const name of ['Allowlist','AllowlistLaunchHook','PoolSwapTest','V4Quoter','StateView']) abis[name] = JSON.parse(await readFile(resolve(out,`abi/${name}.json`),'utf8'));
const account = '0x1111111111111111111111111111111111111111', secondAccount = '0x2222222222222222222222222222222222222222';
const poolManager = manifest.network.uniswapV4.poolManager;
const token = manifest.contracts.find(c=>c.name==='Allowlist').address;
const eth = 10n**18n, blockNumber = 12000000n, timestamp = Math.floor(Date.now()/1000);
const zeroHash='0x'+'0'.repeat(64);
let mock, sent, rpcCalls;
function resetMock() { mock={open:false,balance:125n*eth/10n,native:2n*eth,allowance:0n,fail:false,revert:false,partial:false,badCode:false,contractWallet:false,blockOld:false}; sent=[]; rpcCalls=[]; }
resetMock();
const server = createServer(async (req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!path.startsWith('/preview/') || path.includes('..')) {res.writeHead(404);res.end();return;}
    const file=resolve(out,path.slice('/preview/'.length)||'index.html');
    if(!file.startsWith(out+'/')) {res.writeHead(403);res.end();return;}
    const bytes=await readFile(file); const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(bytes);
  }catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/preview/`;
const browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}), args:['--no-sandbox']});
const results=[], screenshots=[], errors=[];
let page;
function decode(data) {for(const abi of Object.values(abis)){try{return {abi,...decodeFunctionData({abi,data})};}catch{}}throw Error('Unknown call '+data);}
function encode(abi,functionName,result){return encodeFunctionResult({abi,functionName,result});}
function receipt(hash) {return {transactionHash:hash,transactionIndex:'0x0',blockHash:zeroHash,blockNumber:toHex(blockNumber),from:account,to:manifest.integrations.swapRouter.address,cumulativeGasUsed:'0x186a0',gasUsed:'0x186a0',effectiveGasPrice:'0x3b9aca00',contractAddress:null,logs:[],logsBloom:'0x'+'0'.repeat(512),status:'0x1',type:'0x2'};}
async function rpc(payload) {
  rpcCalls.push(payload);
  const {method,params=[]}=payload;
  if(mock.fail) return {jsonrpc:'2.0',id:payload.id,error:{code:-32000,message:'Public RPC unavailable. Retry live reads.'}};
  let result;
  switch(method){
    case 'eth_chainId':result=toHex(manifest.chainId);break;
    case 'eth_getCode':result=mock.badCode?'0x': [account,secondAccount].includes(params[0].toLowerCase())&&!mock.contractWallet?'0x':'0x60006000';break;
    case 'eth_blockNumber':result=toHex(blockNumber);break;
    case 'eth_getBalance':result=toHex(mock.native);break;
    case 'eth_getLogs':result=[];break;
    case 'eth_gasPrice':result='0x3b9aca00';break;
    case 'eth_estimateGas':result='0x186a0';break;
    case 'eth_getTransactionReceipt':result=receipt(params[0]);break;
    case 'eth_getBlockByNumber': result={number:toHex(blockNumber),hash:zeroHash,parentHash:zeroHash,nonce:'0x0000000000000000',sha3Uncles:zeroHash,logsBloom:'0x'+'0'.repeat(512),transactionsRoot:zeroHash,stateRoot:zeroHash,receiptsRoot:zeroHash,miner:account,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0x1c9c380',gasUsed:'0x0',timestamp:toHex(timestamp-(mock.blockOld?3600:0)),transactions:[],uncles:[],baseFeePerGas:'0x3b9aca00',mixHash:zeroHash};break;
    case 'eth_call': {
      const {abi,functionName,args}=decode(params[0].data); let value;
      switch(functionName){
        case 'poolManager': case 'manager':value=poolManager;break;
        case 'decimals':value=18;break;
        case 'openAt':value=BigInt(timestamp+(mock.open?-100:45300));break;
        case 'isOpen':value=mock.open;break;
        case 'gatedCurrency1':value=token;break;
        case 'balanceOf':value=mock.balance;break;
        case 'allowance':value=mock.allowance;break;
        case 'isAllowed':value=mock.open||mock.balance>=eth;break;
        case 'getSlot0':value=[sqrt(250000n*(2n**192n)),124298,0,3000];break;
        case 'getLiquidity':value=100000000000000000000000n;break;
        case 'quoteExactInputSingle': value=[args[0].zeroForOne?args[0].exactAmount*250000n:args[0].exactAmount/250000n,100000n];break;
        case 'approve':value=true;break;
        case 'swap': {
          if(mock.revert)return {jsonrpc:'2.0',id:payload.id,error:{code:3,message:'execution reverted: price moved'}};
          const buy=args[1].zeroForOne, input=-args[1].amountSpecified, output=buy?input*250000n:input/250000n;
          const spent=mock.partial?input/2n:input;
          const d0=buy?-spent:output,d1=buy?output:-spent;
          value=BigInt.asIntN(256,(BigInt.asUintN(128,d0)<<128n)|BigInt.asUintN(128,d1));break;
        }
        default:throw Error('Unhandled ABI function '+functionName);
      }
      result=encode(abi,functionName,value); break;
    }
    default:throw Error('Unhandled RPC '+method);
  }
  return {jsonrpc:'2.0',id:payload.id,result};
}
async function openPage({wallet=true,chain=manifest.chainId,reject=false,unknown=false,corrupt=false}={}) {
  if(page) await page.context().close();
  const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  page=await context.newPage();
  await page.clock.install();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('https://**',async route=>{
    assert(manifest.network.rpcUrls.some(url=>route.request().url().startsWith(url)),'Unexpected external resource');
    const payload=route.request().postDataJSON();
    const body=Array.isArray(payload)?await Promise.all(payload.map(rpc)):await rpc(payload);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  if(corrupt) await page.route('**/abi/Allowlist.json',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.exposeFunction('__send',tx=>{
    const decoded=decode(tx.data); sent.push({...tx,functionName:decoded.functionName,args:decoded.args});
    if(decoded.functionName==='approve')mock.allowance=decoded.args[1];
    return '0x'+sent.length.toString(16).padStart(64,'0');
  });
  if(wallet) await page.addInitScript(({account,chain,reject,unknown})=>{
    const callbacks={};
    window.__wallet={account,chain,reject,unknown,requests:[],changeAccount(next){this.account=next;(callbacks.accountsChanged||[]).forEach(fn=>fn(next?[next]:[]));},changeChain(next){this.chain=next;(callbacks.chainChanged||[]).forEach(fn=>fn('0x'+next.toString(16)));}};
    window.ethereum={
      on(event,fn){(callbacks[event]??=[]).push(fn);},removeListener(event,fn){callbacks[event]=(callbacks[event]||[]).filter(f=>f!==fn);},
      async request({method,params}){
        const w=window.__wallet;w.requests.push({method,params});
        if(method==='eth_requestAccounts'){if(w.reject)throw {code:4001,message:'User rejected request'};return w.account?[w.account]:[];}
        if(method==='eth_accounts')return w.account?[w.account]:[];
        if(method==='eth_chainId')return '0x'+w.chain.toString(16);
        if(method==='wallet_switchEthereumChain'){if(w.unknown)throw {code:4902,message:'Unknown chain'};w.changeChain(Number(params[0].chainId));return null;}
        if(method==='wallet_addEthereumChain'){w.unknown=false;return null;}
        if(method==='eth_sendTransaction'){if(w.reject)throw {code:4001,message:'User rejected request'};return window.__send(params[0]);}
        throw Error('Unexpected wallet method '+method);
      }
    };
  },{account,chain,reject,unknown});
  await page.goto(url);
  if(!corrupt) await page.getByText('1 ETH ≈ 250,000 ALST').waitFor();
  return page;
}
async function check(name,fn){await fn();results.push({name,result:'pass'});console.log('PASS',name);}
async function connect(){await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByText('Eligible to swap',{exact:true}).waitFor();}
async function quote(value='0.001'){await page.getByLabel('You pay, up to').fill(value);await page.getByRole('button',{name:/^Get quote$|^Refresh quote$/}).click();await page.getByText('Quote ready.',{exact:false}).waitFor();}
async function refresh(){await page.getByRole('button',{name:'Refresh access',exact:true}).click();await page.getByRole('button',{name:'Refresh access',exact:true}).waitFor();}
async function screenshot(name){await page.evaluate(() => window.scrollTo(0, 0));const path=resolve(evidence,name+'.png');await page.screenshot({path,fullPage:true});screenshots.push('docs/evidence/'+name+'.png');}
try {
 await mkdir(evidence,{recursive:true});
 await check('Static gateway subpath, disconnected state, local assets',async()=>{
  await openPage();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());
  assert.equal(await page.locator('h1').count(),1);await screenshot('desktop-disconnected');
 });
 await check('No injected wallet and rejected connection recover visibly',async()=>{
  await openPage({wallet:false});await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByText('No browser wallet found.',{exact:false}).waitFor();
  await openPage({reject:true});await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByText('Request declined in your wallet.',{exact:false}).waitFor();
 });
 await check('Unknown network: switch, exact add-chain parameters, switch again',async()=>{
  await openPage({chain:1,unknown:true});await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByText('Wrong network',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());await page.getByRole('button',{name:'Switch to Sepolia',exact:true}).click();await page.getByText('Eligible to swap',{exact:true}).waitFor();
  const requests=await page.evaluate(()=>window.__wallet.requests);assert.deepEqual(requests.filter(r=>r.method.startsWith('wallet_')).map(r=>r.method),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain']);
  assert.deepEqual(requests.find(r=>r.method==='wallet_addEthereumChain').params,[manifest.walletAddChain]);
 });
 await check('Holder eligibility, exact amounts, validation, native buy and receipt',async()=>{
  await page.getByLabel('You pay, up to').fill('1e3');await page.getByRole('button',{name:'Get quote',exact:true}).click();await page.getByText('Enter a positive amount',{exact:false}).waitFor();
  await quote();assert.equal(await page.getByRole('button',{name:'Approve ALST',exact:true}).count(),0);
  await page.getByRole('button',{name:'Swap ETH for ALST',exact:true}).click();await page.getByText('Swap confirmed.',{exact:false}).waitFor();
  const swap=sent.at(-1);assert.equal(swap.to.toLowerCase(),manifest.integrations.swapRouter.address);assert.equal(BigInt(swap.value),10n**15n);
  assert.equal(swap.args[1].amountSpecified,-(10n**15n));assert.equal(swap.args[1].zeroForOne,true);assert(swap.args[1].sqrtPriceLimitX96>4295128739n);assert.equal(swap.args[3],'0x');
  assert(rpcCalls.some(r=>r.method==='eth_call'&&r.params[0].to.toLowerCase()===manifest.network.uniswapV4.quoter));
 });
 await check('Token sell: exact router approval, fresh quote, simulation and receipt',async()=>{
  await page.getByRole('button',{name:'Sell ALST',exact:true}).click();await quote('2');await page.getByRole('button',{name:'Approve ALST',exact:true}).click();await page.getByText('Approval confirmed.',{exact:false}).waitFor();
  const approval=sent.at(-1);assert.equal(approval.to.toLowerCase(),token);assert.equal(approval.args[0].toLowerCase(),manifest.integrations.swapRouter.address);assert.equal(approval.args[1],2n*eth);
  await quote('2');await page.getByRole('button',{name:'Swap ALST for ETH',exact:true}).click();await page.getByText('Swap confirmed.',{exact:false}).waitFor();
  assert.equal(sent.at(-1).args[1].zeroForOne,false);assert.equal(BigInt(sent.at(-1).value||'0x0'),0n);
 });
 await check('Quote invalidation on edits, expiry and wallet account/network changes',async()=>{
  await quote('2');await page.getByLabel('Price tolerance',{exact:true}).fill('1');assert.equal(await page.getByRole('button',{name:'Swap ALST for ETH',exact:true}).count(),0);
  await quote('2');await page.evaluate(()=>window.__wallet.changeAccount('0x2222222222222222222222222222222222222222'));assert.equal(await page.getByRole('button',{name:'Swap ALST for ETH',exact:true}).count(),0);
  await page.getByText('Eligible to swap',{exact:true}).waitFor();await quote('2');
  await page.clock.fastForward(31000);await page.waitForFunction(()=>[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Swap ALST for ETH"))?.disabled);assert(await page.getByRole('button',{name:'Swap ALST for ETH',exact:true}).isDisabled());
  await page.evaluate(()=>window.__wallet.changeChain(1));await page.getByText('Wrong network',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());
 });
 await check('Nonholder and below-threshold access; public boundary opens access',async()=>{
  resetMock();mock.balance=eth-1n;await openPage();await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByText('Holder access only',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());
  mock.balance=0n;mock.open=true;await refresh();await page.getByText('Eligible to swap',{exact:true}).waitFor();await page.getByText('The door is open.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isEnabled());
 });
 await check('Simulation revert and partial fill both block signing',async()=>{
  resetMock();await openPage();await connect();await quote();mock.revert=true;let count=sent.length;
  await page.getByRole('button',{name:'Swap ETH for ALST',exact:true}).click();await page.getByText('Transaction flow stopped.',{exact:false}).waitFor();assert.equal(sent.length,count);
  mock.revert=false;mock.partial=true;await quote();await page.getByRole('button',{name:'Swap ETH for ALST',exact:true}).click();await page.getByText('prevents this full swap',{exact:false}).waitFor();assert.equal(sent.length,count);
 });
 await check('Signing rejection and insufficient funds remain recoverable',async()=>{
  mock.partial=false;await quote();await page.evaluate(()=>window.__wallet.reject=true);await page.getByRole('button',{name:'Swap ETH for ALST',exact:true}).click();await page.getByText('Request declined in your wallet.',{exact:false}).waitFor();assert.equal(sent.length,0);
  await page.evaluate(()=>window.__wallet.reject=false);await page.getByLabel('You pay, up to').fill('3');await page.getByRole('button',{name:'Get quote',exact:true}).click();await page.getByText('Insufficient ETH balance.',{exact:false}).waitFor();
 });
 await check('RPC failure disables swaps; retry recovers; missing code fails verification',async()=>{
  mock.fail=true;await refresh();await page.getByText('Live reads unavailable.',{exact:false}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());
  mock.fail=false;await page.getByRole('button',{name:'Retry live reads',exact:true}).click();await page.getByText('Eligible to swap',{exact:true}).waitFor();
  mock.badCode=true;await refresh();await page.getByText('A required contract has no deployed code.',{exact:false}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());
 });
 await check('Stalled block timestamps disable signing',async()=>{resetMock();await openPage();await connect();mock.blockOld=true;await refresh();await page.getByText('The RPC block is stale',{exact:false}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());});
 await check('ABI tampering disables configuration',async()=>{resetMock();await openPage({corrupt:true});await page.getByText('ABI asset integrity failed:',{exact:false}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());});
 await check('Contract wallet limitation is visible during the window',async()=>{resetMock();mock.contractWallet=true;await openPage();await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByText('EOA required',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled());});
 await check('Keyboard-only connect, quote and native swap flow',async()=>{
  resetMock();await openPage();
  async function tabTo(locator){for(let i=0;i<65;i++){if(await locator.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Keyboard target not reached');}
  await tabTo(page.getByRole('button',{name:'Connect wallet',exact:true}).first());await page.keyboard.press('Enter');await page.getByText('Eligible to swap',{exact:true}).waitFor();
  await tabTo(page.getByLabel('You pay, up to'));await page.keyboard.type('0.001');
  await tabTo(page.getByRole('button',{name:'Get quote',exact:true}));await page.keyboard.press('Enter');await page.getByText('Quote ready.',{exact:false}).waitFor();
  await tabTo(page.getByRole('button',{name:'Swap ETH for ALST',exact:true}));await page.keyboard.press('Enter');await page.getByText('Swap confirmed.',{exact:false}).waitFor();assert.equal(sent.length,1);
 });
 await check('Desktop/mobile/intermediate reflow, keyboard focus and accessibility scan',async()=>{
  resetMock();await openPage();await connect();await quote();
  await page.getByLabel('Price tolerance',{exact:true}).fill('7');await page.getByRole('button',{name:'Get quote',exact:true}).click();await page.getByText('Use a price tolerance from 0.1% to 5%.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'tolerance');
  await page.getByLabel('Price tolerance',{exact:true}).fill('0.5');await quote();
  await screenshot('desktop-connected');
  const scan=await new AxeBuilder({page}).analyze();assert.deepEqual(scan.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[]);
  for(const width of [768,390,320]) {await page.setViewportSize({width,height:900});await page.getByText('Deployment & contracts',{exact:false}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
    await page.getByText('Deployment & contracts',{exact:false}).click();await screenshot('width-'+width);
  }
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow at 200% text');await screenshot('text-200-percent');
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.reload();await page.getByText('1 ETH ≈ 250,000 ALST').waitFor();
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineWidth),'3px');await screenshot('keyboard-focus');
  await connect();await quote();
  const contrast=await page.evaluate(()=>{
    const pairs=[['body', '--page'],['.intro-copy','--page'],['.window-description','--window'],['.pill.positive','--positive-bg'],['.button.primary:not(:disabled)','--accent'],['.swap-panel .tiny','--surface']];
    const rgb=c=>c.match(/[\d.]+/g).slice(0,3).map(Number);const lum=c=>rgb(c).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    return pairs.flatMap(([selector,token])=>{const el=document.querySelector(selector);if(!el)return[];const fg=getComputedStyle(el).color;const x=document.createElement('div');x.style.backgroundColor=`var(${token})`;document.body.append(x);const bg=getComputedStyle(x).backgroundColor;x.remove();const a=lum(fg),b=lum(bg);return [{selector,foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}];});
  });
  await writeFile(resolve(evidence,'accessibility.json'),JSON.stringify({axeViolations:scan.violations,axePasses:scan.passes.length,contrast},null,2)+'\n');
  assert(contrast.every(p=>p.ratio>=4.5));
 });
 assert.deepEqual(errors,[]);
} catch(error) {results.push({name:'Failure',result:'fail',error:error.stack});console.error(error);if(page)await screenshot('failure');process.exitCode=1;}
finally {
 await writeFile(resolve(evidence,'browser-results.json'),JSON.stringify({urlPath:'/preview/',browser:browser.version(),mockedWalletAndRpc:true,transactionsBroadcast:0,results,screenshots,consoleErrors:errors},null,2)+'\n');
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
