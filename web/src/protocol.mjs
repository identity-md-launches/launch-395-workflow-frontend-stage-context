import { encodeAbiParameters, keccak256, toHex } from 'viem';

export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const abiHash = abi => keccak256(toHex(canonical(abi))).slice(2);
export const poolKeyType = { type: 'tuple', components: [
  { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
] };
export const poolId = key => keccak256(encodeAbiParameters([poolKeyType], [key]));
export function sqrt(n) {
  if (n < 0n) throw Error('Negative square root');
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
export function priceLimit(current, buy, bps) {
  const factor = buy ? 10000n - BigInt(bps) : 10000n + BigInt(bps);
  const result = sqrt(current * current * factor / 10000n);
  const min = 4295128740n, max = 1461446703485210103287273052203988822378723970341n;
  if (result <= min || result >= max || result === current) throw Error('Price limit is outside the pool range.');
  return result;
}
export function unpackDelta(delta, buy) {
  const d0 = BigInt.asIntN(128, delta >> 128n), d1 = BigInt.asIntN(128, delta);
  return { spent: -(buy ? d0 : d1), received: buy ? d1 : d0 };
}
export function parseAmount(text, decimals) {
  if (!/^(?:\d+)(?:\.\d*)?$/.test(text)) throw Error('Enter a positive amount using numbers and a decimal point.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw Error(`Use at most ${decimals} decimal places.`);
  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (value <= 0n || value >= 2n ** 128n) throw Error('Enter an amount greater than zero and below the quote limit.');
  return value;
}
export function parseBps(text) {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Use a price tolerance from 0.1% to 5%, with at most two decimals.');
  const bps = Math.round(Number(text) * 100);
  if (bps < 10 || bps > 500) throw Error('Use a price tolerance from 0.1% to 5%.');
  return bps;
}
export function errorMessage(error) {
  const msg = error?.shortMessage || error?.message || String(error);
  if (error?.code === 4001 || /rejected|denied/i.test(msg)) return 'Request declined in your wallet. You can try again.';
  if (/NotAllowlisted/i.test(msg)) return 'The signing wallet needs at least 1 ALST until the window ends. Refresh your access and try again.';
  return msg.length > 600 ? msg.slice(0, 600) + '…' : msg;
}
