import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseBps, priceLimit, unpackDelta, abiHash, canonical, poolId } from '../src/protocol.mjs';
import { readFileSync } from 'node:fs';
const Q96 = 2n**96n;
test('amount validation preserves wei precision and rejects rounded or unsafe input', () => {
  assert.equal(parseAmount('1.000000000000000001',18),1000000000000000001n);
  for(const value of ['0','-1','1e3','.2','1,2','NaN','0.0000000000000000001',String(2n**128n)]) assert.throws(()=>parseAmount(value,18));
});
test('price tolerance enforces exact boundaries',()=>{
  assert.equal(parseBps('0.1'),10); assert.equal(parseBps('5'),500); assert.equal(parseBps('0.51'),51);
  for(const value of ['0','0.09','5.01','abc','1.001']) assert.throws(()=>parseBps(value));
});
test('sqrt limits are correctly directed and bound squared price with integer arithmetic',()=>{
  const buy=priceLimit(Q96,true,50),sell=priceLimit(Q96,false,50);
  assert(buy<Q96 && sell>Q96); assert(buy*buy<=Q96*Q96*9950n/10000n);
  assert(sell*sell<=Q96*Q96*10050n/10000n);
});
test('signed packed balance delta decodes both directions and partial fills',()=>{
  const pack=(a,b)=>BigInt.asIntN(256,(BigInt.asUintN(128,a)<<128n)|BigInt.asUintN(128,b));
  assert.deepEqual(unpackDelta(pack(-12n,40n),true),{spent:12n,received:40n});
  assert.deepEqual(unpackDelta(pack(40n,-12n),false),{spent:12n,received:40n});
});
test('canonical ABIs bind the deployment to pinned implementation exports',()=>{
  const config=JSON.parse(readFileSync(new URL('../config/deployment-handoff.json',import.meta.url)));
  for(const c of config.contracts) assert.equal(abiHash(JSON.parse(readFileSync(new URL(`../../docs/abi/${c.name}.json`,import.meta.url)))),c.abiHash);
  assert.equal(canonical({z:1,a:{z:2,a:3}}),'{'+'"a":{"a":3,"z":2},"z":1}');
  assert.equal(poolId({currency0:'0x0000000000000000000000000000000000000000',currency1:config.contracts[0].address,fee:3000,tickSpacing:60,hooks:config.contracts[1].address}).length,66);
});
