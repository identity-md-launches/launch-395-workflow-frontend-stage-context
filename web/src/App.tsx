import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits, isAddress, type Address, type Hex } from 'viem';
import { loadConfig, type Runtime } from './config';
import { assertWallet, getQuote, readState, requireReady, sendAction, switchChain, verifyDeployment, type Provider, type Quote, type Snapshot } from './chain';
import { errorMessage, parseAmount, parseBps } from './protocol.mjs';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
function amount(value?: bigint, decimals = 18, digits = 6) {
  if (value === undefined) return '—';
  const exact = formatUnits(value, decimals);
  const [whole, fraction] = exact.split('.');
  if (!fraction) return whole;
  if (value > 0n && Number(exact) < 10 ** -digits) return `< ${10 ** -digits}`;
  return `${whole}.${fraction.slice(0, digits).replace(/0+$/, '')}`.replace(/\.$/, '');
}
function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} /></svg>;
}
function External({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}<span className="sr-only"> (opens in a new tab)</span><Arrow diagonal /></a>;
}
export default function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [bootError, setBootError] = useState('');
  const [provider, setProvider] = useState<Provider>();
  const [wallets, setWallets] = useState<{ name: string; provider: Provider }[]>([]);
  const [account, setAccount] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const [state, setState] = useState<Snapshot>();
  const [verified, setVerified] = useState(false);
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [buy, setBuy] = useState(true);
  const [input, setInput] = useState('');
  const [tolerance, setTolerance] = useState('0.5');
  const [hookData, setHookData] = useState('0x');
  const [quote, setQuote] = useState<Quote>();
  const [fieldError, setFieldError] = useState('');
  const [invalidField, setInvalidField] = useState('amount');
  const [tx, setTx] = useState<{ hash: Hex; label: string }>();
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const readSeq = useRef(0);
  const actionLock = useRef(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const identity = useRef<{ account?: Address; chain?: number }>({});

  const invalidate = useCallback(() => { generation.current++; setQuote(undefined); setActionError(''); setFieldError(''); }, []);
  const updateIdentity = useCallback((nextAccount?: Address, nextChain?: number) => {
    identity.current = { account: nextAccount, chain: nextChain };
    readSeq.current++; invalidate(); setState(undefined); setAccount(nextAccount); setChain(nextChain);
  }, [invalidate]);
  useEffect(() => { loadConfig().then(setRuntime).catch(error => setBootError(errorMessage(error))); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const add = (name: string, found: Provider) => setWallets(previous => previous.some(w => w.provider === found) ? previous : [...previous, { name, provider: found }]);
    for (const found of window.ethereum?.providers ?? (window.ethereum ? [window.ethereum] : [])) add('Browser wallet', found);
    const announce = (event: Event) => { const detail = (event as CustomEvent<{ info: { name: string }; provider: Provider }>).detail; if (detail?.provider) add(detail.info.name, detail.provider); };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);
  useEffect(() => { if (!provider && wallets[0]) setProvider(wallets[0].provider); }, [provider, wallets]);
  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (...args: unknown[]) => { const accounts = args[0] as string[]; updateIdentity(accounts[0] && isAddress(accounts[0]) ? accounts[0] : undefined, identity.current.chain); setStatus('Wallet account updated.'); };
    const chainChanged = (...args: unknown[]) => { updateIdentity(identity.current.account, Number(args[0])); setStatus('Wallet network updated.'); };
    const disconnected = () => { updateIdentity(); setStatus('Wallet disconnected.'); };
    provider.on?.('accountsChanged', accountsChanged); provider.on?.('chainChanged', chainChanged); provider.on?.('disconnect', disconnected);
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); provider.removeListener?.('disconnect', disconnected); };
  }, [provider, updateIdentity]);
  const refresh = useCallback(async () => {
    if (!runtime) return;
    const seq = ++readSeq.current;
    setRefreshing(true);
    try {
      await verifyDeployment(runtime);
      const next = await readState(runtime, account);
      if (seq !== readSeq.current) return;
      setState(next); setVerified(true); setReadError('');
    } catch (error) {
      if (seq !== readSeq.current) return;
      setVerified(false); setQuote(undefined); setReadError(errorMessage(error));
    } finally { if (seq === readSeq.current) setRefreshing(false); }
  }, [runtime, account]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => { readSeq.current++; clearInterval(timer); }; }, [refresh]);

  async function connect() {
    if (!provider) { setActionError('No browser wallet found. Open this page in an Ethereum wallet browser or install a browser wallet, then reload.'); return; }
    if (actionLock.current) return;
    actionLock.current = true; setBusy('connect'); setActionError('');
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
      const currentChain = await provider.request({ method: 'eth_chainId' });
      if (!accounts[0] || !isAddress(accounts[0])) throw Error('The wallet did not return an account. Unlock it and try again.');
      updateIdentity(accounts[0], Number(currentChain)); setStatus('Wallet connected. Checking your access.');
    } catch (error) { setActionError(errorMessage(error)); }
    finally { actionLock.current = false; setBusy(''); }
  }
  async function switchNetwork() {
    if (!provider || !runtime || actionLock.current) return;
    actionLock.current = true; setBusy('network'); setActionError('');
    try { await switchChain(provider, runtime); updateIdentity(account, Number(await provider.request({ method: 'eth_chainId' }))); setStatus('Network switched. Checking your access.'); }
    catch (error) { setActionError(errorMessage(error)); }
    finally { actionLock.current = false; setBusy(''); }
  }
  async function quoteSwap(event: React.FormEvent) {
    event.preventDefault();
    if (!runtime || !provider || !account || !state || actionLock.current) return;
    let value: bigint, bps: number;
    let field = 'amount';
    try { value = parseAmount(input, buy ? runtime.config.network.nativeCurrency.decimals : state.decimals); field = 'tolerance'; bps = parseBps(tolerance); field = 'hook-data'; if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(hookData)) throw Error('Hook data must be 0x or an even number of hexadecimal digits after 0x.'); }
    catch (error) { setFieldError(errorMessage(error)); setInvalidField(field); document.getElementById(field)?.focus(); return; }
    const gen = generation.current;
    actionLock.current = true; setBusy('quote'); setActionError(''); setFieldError(''); setQuote(undefined);
    try {
      if (!verified || chain !== runtime.config.chainId) throw Error('Connect to the configured network and refresh access.');
      await assertWallet(provider, account, runtime.config.chainId);
      const fresh = await readState(runtime, account);
      const next = await getQuote(runtime, fresh, account, value, buy, bps, hookData as Hex);
      if (gen !== generation.current) throw Error('Form or wallet changed. Get a new quote.');
      setState(fresh); setQuote(next); setStatus('Quote ready. Review the estimate and price limit before continuing.');
    } catch (error) { setActionError(errorMessage(error)); }
    finally { actionLock.current = false; setBusy(''); }
  }
  async function transact(approval: boolean) {
    if (!runtime || !provider || !quote || actionLock.current) return;
    const gen = generation.current;
    const guard = () => { if (gen !== generation.current) throw Error('Form or wallet changed. Get a new quote.'); };
    actionLock.current = true; setBusy(approval ? 'approve' : 'swap'); setActionError(''); setTx(undefined);
    setStatus(`Simulating ${approval ? 'approval' : 'swap'} before requesting your signature…`);
    try {
      const hash = await sendAction(runtime, provider, quote, approval, guard);
      setTx({ hash, label: approval ? 'ALST approval' : 'Swap' }); setStatus('Transaction submitted. Waiting for confirmation…'); setQuote(undefined);
      const receipt = await runtime.client.waitForTransactionReceipt({ hash, timeout: 120000 });
      if (receipt.status !== 'success') throw Error('Transaction reverted on chain. Open the transaction for details, then refresh and try again.');
      setStatus(approval ? 'Approval confirmed. Get a fresh quote to swap.' : 'Swap confirmed. Balances and access are refreshing.');
      await refresh();
    } catch (error) { setActionError(errorMessage(error)); setQuote(undefined); setStatus('Transaction flow stopped. Check the message below and any submitted transaction.'); }
    finally { actionLock.current = false; setBusy(''); }
  }
  const stale = !state || now - state.fetchedAt > 45000;
  const wrongChain = Boolean(account && runtime && chain !== runtime.config.chainId);
  const walletState = state?.account === account ? state : undefined;
  let ready = Boolean(account && walletState && verified && !wrongChain && !stale);
  if (ready) { try { requireReady(walletState!, account!); } catch { ready = false; } }
  const elapsed = state ? Math.max(0, Math.floor((now - state.fetchedAt) / 1000)) : 0;
  const seconds = state ? Math.max(0, state.openAt - state.timestamp - elapsed) : undefined;
  const countdown = seconds === undefined ? ['—', '—', '—'] : [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(n => String(n).padStart(2, '0'));
  const open = Boolean(state?.open);
  const quoteValid = Boolean(quote && now - quote.time < 30000 && ready);
  const needsApproval = Boolean(quote && !buy && (walletState?.allowance ?? 0n) < quote.amount);
  const outputDecimals = buy ? state?.decimals ?? 18 : runtime?.config.network.nativeCurrency.decimals ?? 18;
  const unitIn = buy ? 'ETH' : 'ALST', unitOut = buy ? 'ALST' : 'ETH';
  const explorer = runtime?.config.network.explorer;
  const spot = state ? Number(state.sqrtPrice * state.sqrtPrice * 10n ** 18n / (2n ** 192n)) / 10 ** state.decimals : undefined;
  const badge = !account ? 'Connect to check' : wrongChain ? 'Wrong network' : !verified || stale ? 'Access unverified' : walletState?.contractWallet && !open ? 'EOA required' : walletState?.allowed ? 'Eligible to swap' : 'Holder access only';

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="page">
      <header className="header">
        <a className="brand" href="#main" aria-label="Allowlist home"><span className="brand-mark" aria-hidden="true">a<span>↗</span></span><span>allowlist<span className="brand-dot">.</span></span></a>
        <div className="header-actions"><span className="network-tag"><span className="dot" />{runtime?.config.network.name ?? 'Sepolia'} testnet</span>
          {account ? <button className="button small" disabled={Boolean(busy)} onClick={() => { updateIdentity(); setStatus('Disconnected from this page.'); }}>Disconnect {short(account)}</button>
            : <button className="button small" disabled={Boolean(busy)} onClick={() => void connect()}>{busy === 'connect' ? 'Connecting…' : 'Connect wallet'}<Arrow /></button>}
        </div>
      </header>
      <main id="main">
        <section className="intro" aria-labelledby="page-title"><div><p className="eyebrow">ALST / A holder-first launch</p><h1 id="page-title">A head start<br />for the holders.</h1></div><p className="intro-copy">One token. A 24-hour holder window.<br />Hold at least 1 ALST to swap early.<br />After the window, everyone is welcome.</p></section>
        {bootError && <div className="error" role="alert">{bootError} <button className="button small" onClick={() => window.location.reload()}>Reload configuration</button></div>}
        <div className="main-grid">
          <div className="launch-column">
            <section className="window-panel" aria-labelledby="window-title">
              <div className="section-top"><p className="eyebrow">01 / Launch window</p><span className="pill dark">{state ? open ? 'Public trading' : 'Holder window' : 'Checking chain'}</span></div>
              <h2 id="window-title">{open ? 'The door is open.' : 'Your place at the start.'}</h2>
              <p className="window-description">{open ? 'The holder window has ended. Anyone can swap ALST.' : 'The first 24 hours belong to wallets holding ALST.'}</p>
              <div className="countdown" aria-label={open ? 'Holder window ended' : `Time until public trading: ${countdown[0]} hours ${countdown[1]} minutes ${countdown[2]} seconds`}>
                {countdown.map((value, index) => <div key={index}><span>{value}</span><small>{['Hours', 'Minutes', 'Seconds'][index]}</small></div>)}
              </div>
              <div className="window-bottom"><span className="window-icon" aria-hidden="true">↗</span><p>{state ? open ? 'Open to everyone' : seconds === 0 ? 'Waiting for the next block to confirm opening' : 'Public trading begins' : 'Reading the launch window…'}<strong>{state ? new Date(state.openAt * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Live state will appear here'}</strong></p></div>
            </section>
            <section className="access-panel" aria-labelledby="access-title">
              <div className="section-top"><h2 id="access-title">Your access</h2><span className={`pill ${ready ? 'positive' : ''}`}>{badge}</span></div>
              <p className="balance-label">ALST balance</p><p className="balance"><span title={walletState?.balance !== undefined ? formatUnits(walletState.balance, walletState.decimals) : undefined}>{account ? amount(walletState?.balance, state?.decimals) : '—'}</span><span className="unit">ALST</span></p>
              <p className="muted">{!account ? 'Connect a wallet to see your balance and check your place in the holder window.' : wrongChain ? `Switch to ${runtime?.config.network.name} to use this wallet.` : !verified || stale ? 'Waiting for verified live state. Refresh to check again.' : walletState?.contractWallet && !open ? 'Contract wallets are judged by their sending EOA. Connect that EOA directly during this window.' : walletState?.allowed ? open ? 'Public trading is open. Your wallet may swap now.' : 'You hold at least 1 ALST. Your wallet may buy or sell now.' : 'This wallet needs at least 1 ALST to swap during the holder window. You can also wait for public trading.'}</p>
              {account && <p className="wallet-address"><External href={`${explorer}/address/${account}`}>{account}</External></p>}
              {wallets.length > 1 && !account && <label className="wallet-select">Browser wallet<select disabled={Boolean(busy)} value={wallets.findIndex(w => w.provider === provider)} onChange={e => setProvider(wallets[Number(e.target.value)].provider)}>{wallets.map((w, i) => <option key={i} value={i}>{w.name}</option>)}</select></label>}
              <div className="access-actions">{!account ? <button className="button" onClick={() => void connect()} disabled={Boolean(busy)}>Connect wallet<Arrow /></button> : wrongChain ? <button className="button" onClick={() => void switchNetwork()} disabled={Boolean(busy)}>{busy === 'network' ? 'Switching…' : `Switch to ${runtime?.config.network.name}`}</button> : <button className="button" onClick={() => void refresh()} disabled={refreshing || Boolean(busy)}>{refreshing ? 'Refreshing…' : 'Refresh access'}<span aria-hidden="true">↻</span></button>}<span className="tiny">{account ? `${amount(walletState?.nativeBalance, 18, 5)} ETH available` : 'No account or sign-up needed'}</span></div>
            </section>
          </div>
          <section className="swap-panel" aria-labelledby="swap-title">
            <div className="section-top"><p className="eyebrow">02 / Make your move</p><span className="tiny">Uniswap v4</span></div><h2 id="swap-title">Swap ALST</h2>
            <div className="direction" aria-label="Swap direction"><button type="button" aria-pressed={buy} disabled={Boolean(busy)} onClick={() => { setBuy(true); setInput(''); invalidate(); }}>Buy ALST</button><button type="button" aria-pressed={!buy} disabled={Boolean(busy)} onClick={() => { setBuy(false); setInput(''); invalidate(); }}>Sell ALST</button></div>
            <form onSubmit={event => void quoteSwap(event)} noValidate>
              <div className="amount-box"><div className="field-top"><label htmlFor="amount">You pay, up to</label><span className="tiny">Balance: {amount(buy ? walletState?.nativeBalance : walletState?.balance, buy ? 18 : state?.decimals, 4)}</span></div><div className="amount-row"><input id="amount" ref={amountInput} name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={input} disabled={Boolean(busy)} aria-invalid={Boolean(fieldError) && invalidField === 'amount'} aria-describedby="amount-hint field-error" onChange={e => { setInput(e.target.value); invalidate(); }} /><span className="token"><span className={`token-icon ${buy ? 'eth' : ''}`} aria-hidden="true">{buy ? '◇' : 'a'}</span>{unitIn}</span></div><span className="tiny" id="amount-hint">{buy ? 'Leave some ETH for network fees.' : 'Approve only the amount you want to sell.'}</span></div>
              <div className="flow-arrow" aria-hidden="true">↓</div>
              <div className="amount-box receive"><label htmlFor="estimated-output">You receive, estimated</label><div className="amount-row"><output id="estimated-output" className="output" aria-live="polite">{quote ? amount(quote.output, outputDecimals) : '—'}</output><span className="token"><span className={`token-icon ${!buy ? 'eth' : ''}`} aria-hidden="true">{buy ? 'a' : '◇'}</span>{unitOut}</span></div><span className="tiny">{quote ? quoteValid ? `Quote expires in ${Math.max(0, Math.min(30, 30 - Math.floor((now - quote.time) / 1000)))}s` : 'Quote expired. Get a fresh quote.' : 'Get a quote to see the current estimate.'}</span></div>
              <div className="tolerance-row"><label htmlFor="tolerance">Price tolerance</label><div><input id="tolerance" name="tolerance" aria-invalid={Boolean(fieldError) && invalidField === 'tolerance'} inputMode="decimal" value={tolerance} disabled={Boolean(busy)} onChange={e => { setTolerance(e.target.value); invalidate(); }} aria-describedby="limit-hint field-error" /><span>%</span></div></div>
              <p id="limit-hint" className="tiny">Limits pool price movement from the current spot price. PoolSwapTest can fill partially; it has no guaranteed minimum output or on-chain deadline.</p>
              <details className="advanced"><summary>Swap details</summary><dl className="details-list"><div><dt>LP fee</dt><dd>{runtime ? runtime.config.pool.fee / 10000 : '—'}%</dd></div><div><dt>Route</dt><dd>PoolSwapTest</dd></div><div><dt>Price limit (sqrt X96)</dt><dd className="mono">{quote?.limit.toString() ?? 'Calculated with your quote'}</dd></div></dl><label htmlFor="hook-data">Hook data (hex)</label><input id="hook-data" aria-invalid={Boolean(fieldError) && invalidField === 'hook-data'} aria-describedby="field-error" value={hookData} disabled={Boolean(busy)} onChange={e => { setHookData(e.target.value); invalidate(); }} /><p className="tiny">The hook checks the transaction’s originating EOA. Hook data cannot grant access.</p></details>
              <p id="field-error" className="field-error" role="alert">{fieldError}</p>
              <button className={`button full ${!quoteValid ? 'primary' : ''}`} type="submit" disabled={!ready || Boolean(busy)}>{busy === 'quote' ? 'Getting quote…' : quote ? 'Refresh quote' : 'Get quote'}<Arrow /></button>
            </form>
            {quote && <div className="review"><p>{needsApproval ? `Approve ${amount(quote.amount, state?.decimals)} ALST for PoolSwapTest. Then get a fresh quote to swap.` : `Swap up to ${amount(quote.amount, buy ? 18 : state?.decimals)} ${unitIn} for an estimated ${amount(quote.output, outputDecimals)} ${unitOut}.`}</p><button className="button primary full" disabled={!quoteValid || Boolean(busy)} onClick={() => void transact(needsApproval)}>{busy === 'approve' ? 'Approving…' : busy === 'swap' ? 'Confirming swap…' : needsApproval ? 'Approve ALST' : `Swap ${unitIn} for ${unitOut}`}<Arrow /></button></div>}
            <p className="swap-help">{!account ? 'Connect your wallet to get started.' : !ready ? 'Swapping unlocks when your network and access are verified.' : 'Your wallet asks you to confirm every transaction.'}</p>
            <div className="transaction-status" role="status">{status}</div>
            {tx && <div className="tx-link"><External href={`${explorer}/tx/${tx.hash}`}>{tx.label}: {short(tx.hash)}</External></div>}
            <div role="alert">{actionError && <p className="error">{actionError}</p>}</div>
          </section>
        </div>
        <section className="pool-strip" aria-label="Live pool state"><div><span className="eyebrow">Live pool price</span><strong>{spot !== undefined ? `1 ETH ≈ ${spot.toLocaleString(undefined, { maximumSignificantDigits: 7 })} ALST` : 'Awaiting pool data'}</strong></div><div><span className="eyebrow">Access threshold</span><strong>1 ALST <span className="muted">during the window</span></strong></div><div><span className="eyebrow">Latest block</span><strong>{state ? state.block.toString() : '—'} <span className="tiny">{state ? `${elapsed}s since refresh` : 'Reading Sepolia'}</span></strong></div></section>
        {readError && <div className="error" role="alert"><strong>Live reads unavailable.</strong> {readError}<button className="button small" disabled={refreshing} onClick={() => void refresh()}>Retry live reads</button></div>}
        <div className="bottom-grid">
          <section className="how-it-works" aria-labelledby="rules-title"><p className="eyebrow">A simple launch rule</p><h2 id="rules-title">Hold a little. Get in early.</h2><p>The allowlist is the holder list. Receiving 1 ALST grants access during the first day; falling below 1 ALST removes it. The window ends on schedule, even if nobody swaps.</p><details><summary>How wallet eligibility works</summary><p>The hook checks <code>tx.origin</code>, the EOA that sends the transaction. Contract and ERC-4337 wallets are judged by that sending EOA, not their own balance. A phishing contract called by a holder can cause a swap. Use a directly connected EOA during the window. After the window, the hook stops reading <code>tx.origin</code>.</p><p>Liquidity can be added or removed at any time. This page provides swaps only. Prices and quotes do not guarantee execution; the wallet transaction may revert.</p></details></section>
          <section className="activity" aria-labelledby="activity-title"><div className="section-top"><h2 id="activity-title">Holder activity</h2><span className="tiny">Last 1,000 blocks</span></div>{state?.events.length ? <ul>{state.events.map((event, i) => <li key={`${event.hash}-${i}`}><External href={`${explorer}/tx/${event.hash}`}>{short(event.origin)} swapped</External><span className="tiny">Held {amount(event.balance, state.decimals)} ALST</span></li>)}</ul> : <p className="muted">{state?.eventError ? 'Activity could not be loaded. Refresh access to retry.' : state ? 'No holder-window swaps in this range. Public swaps do not emit HolderSwap events.' : 'Holder-window events appear here after live reads load.'}</p>}</section>
        </div>
        <details className="deployment"><summary>Deployment & contracts <span className="tiny">{verified ? 'ABI hashes, chain and code checked' : 'Verification pending'}</span></summary>{runtime && <><p className="tiny">Chain {runtime.config.chainId} · Pool <span className="mono">{runtime.id}</span></p><div className="contract-list">{[...runtime.config.contracts, runtime.config.integrations.swapRouter, ...Object.entries(runtime.config.network.uniswapV4).map(([name, address]) => ({ name, address }))].map(c => <External key={c.name} href={`${explorer}/address/${c.address}`}><span>{c.name}</span><span className="mono">{c.address}</span></External>)}</div><p className="tiny">Source commit: <span className="mono">{runtime.config.sourceCommit}</span><br />Attestation: <span className="mono">{runtime.config.attestationHash}</span></p><a href="./imd-deployment.json">View deployment configuration</a></>}</details>
      </main>
      <footer><span>allowlist. <span className="muted">An open door, on a timer.</span></span><div><span className="tiny">Sepolia test tokens only</span>{runtime && <External href={runtime.config.network.faucets[0]}>Get test ETH</External>}</div></footer>
    </div>
  </>;
}
