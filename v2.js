'use strict';
// Coin Scout V2 - informational momentum scanner and browser-only paper simulator.
(function () {
  const $ = id => document.getElementById(id);
  const fee = 0.005, slippage = 0.005, storageKey = 'coinScoutPaperV2';
  const usd = n => '$' + Number(n || 0).toFixed(2);
  function stats(x) {
    const liq = Number(x.liquidity) || 0, v24 = Number(x.volume) || 0;
    const v1 = Number(x.volumeH1) || 0, pace = v24 > 0 ? 24 * v1 / v24 : 0;
    const buys = Number(x.buys) || 0, sells = Number(x.sells) || 0, trades = buys + sells;
    const buyRate = trades ? buys / trades : 0, pct = Number(x.change) || 0, age = Number(x.ageH) || 0;
    const score = (liq >= 250000 ? 18 : liq >= 100000 ? 12 : liq >= 50000 ? 6 : 0)
      + (pace >= 3 ? 25 : pace >= 1.5 ? 18 : pace >= 1 ? 10 : 0)
      + (trades >= 20 ? (buyRate >= .7 ? 20 : buyRate >= .6 ? 13 : buyRate > .5 ? 7 : 0) : 0)
      + (pct >= 3 && pct <= 25 ? 20 : pct > 0 && pct < 3 ? 10 : pct > 25 ? 5 : 0)
      + (age >= 168 ? 17 : age >= 24 ? 12 : age >= 6 ? 5 : 0);
    return {pace, trades, score: Math.min(100, score)};
  }
  window.fomoScore = x => stats(x).score;
  function risks(x) {
    const s = stats(x), out = [];
    if (!Number.isFinite(x.ageH) || x.ageH < 24) out.push('New or unknown pool age');
    if (!Number.isFinite(x.liquidity) || x.liquidity < 100000) out.push('Limited liquidity');
    if (s.trades < 20) out.push('Low hourly transaction count');
    if (x.change > 40) out.push('Sharp 1h price spike');
    if (s.pace > 10) out.push('Extreme volume activity');
    if (x.liquidity > 0 && x.volume / x.liquidity > 10) out.push('Very high turnover');
    return out;
  }
  const style = document.createElement('style');
  style.textContent = '.v2score{display:flex;gap:12px;align-items:center;border-bottom:1px solid #2b3441;padding:10px 0;margin-bottom:11px}.v2number{padding:9px;min-width:66px;text-align:center;background:#234532;border:1px solid #4d8062;border-radius:11px;color:#a0f5c5;font-size:20px;font-weight:800}.v2detail{font-size:12px;color:#9aabba}.v2detail b{display:block;color:#ecf2fa}.v2flags{display:flex;flex-wrap:wrap;gap:6px;margin:11px 0}.v2flag{background:#442b23;color:#ffdaad;border:1px solid #744a35;padding:5px 8px;border-radius:9px;font-size:11px}.v2flag.ok{background:#17372a;color:#b8f1d2;border-color:#366547}.v2buy{display:flex;gap:8px;margin-top:9px}.v2buy button{flex:1}.v2stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}.v2stat{background:#101820;padding:10px 8px;border-radius:11px}.v2stat small{color:#9aabba;display:block;font-size:11px}.v2stat strong{font-size:17px;overflow-wrap:anywhere}.v2pos{border:1px solid #2b3441;border-radius:12px;padding:11px;margin:9px 0}.v2pos p,.v2history{font-size:12px;color:#9aabba}.v2history{padding:7px 0;border-bottom:1px solid #2b3441}';
  document.head.append(style);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'v2paper';
  panel.innerHTML = '<div class="top"><h2 style="margin:0">Paper trading</h2><span class="chip">SIMULATED ONLY</span></div><p class="hint">Practice with $300 in pretend cash. Buys and sells use newly requested pool quotes plus estimated 0.5% fees and 0.5% slippage on each side. Real execution can be much worse.</p><div class="v2stats"><div class="v2stat"><small>Cash</small><strong id="v2cash">$300.00</strong></div><div class="v2stat"><small>Positions</small><strong id="v2n">0</strong></div><div class="v2stat"><small>Realized P/L</small><strong id="v2pnl">$0.00</strong></div></div><div id="v2positions"></div><div id="v2history"></div><button class="ghost" id="v2reset" style="margin-top:12px">Reset paper account</button><p class="small">Stored only on this device, not synced. No brokerage or wallet connection, background trades, live portfolio valuation, or trading alerts.</p>';
  document.querySelector('.bar').before(panel);
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (s && Number.isFinite(s.cash) && s.cash >= 0 && s.positions && typeof s.positions === 'object' && !Array.isArray(s.positions) && Array.isArray(s.history)) return s;
    } catch (e) {}
    return {cash: 300, positions: {}, realized: 0, history: []};
  }
  function persist(s) {
    try { localStorage.setItem(storageKey, JSON.stringify(s)); return true; }
    catch (e) { alert('Cannot save paper trades in this browser.'); return false; }
  }
  let busy = false;
  async function quote(p) {
    if (!['solana', 'base', 'eth', 'bsc'].includes(p.network) || !p.poolAddress) throw Error('Invalid pool');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = 'https://api.geckoterminal.com/api/v2/networks/' + encodeURIComponent(p.network) + '/pools/' + encodeURIComponent(p.poolAddress);
      const response = await fetch(url, {headers: {Accept: 'application/json'}, cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw Error('Quote unavailable (HTTP ' + response.status + ')');
      const json = await response.json();
      const price = Number(json?.data?.attributes?.base_token_price_usd);
      if (!Number.isFinite(price) || price <= 0) throw Error('No valid quote for this pool');
      return price;
    } finally { clearTimeout(timer); }
  }
  async function buy(x, amount) {
    if (busy) return; busy = true;
    try {
      if (load().cash < amount) { alert('Not enough simulated cash.'); return; }
      const price = await quote(x), qty = amount * (1 - fee) / (price * (1 + slippage));
      if (!Number.isFinite(qty) || qty <= 0) throw Error('Invalid quantity');
      const s = load();
      if (s.cash < amount) return;
      const old = s.positions[x.key] || {key: x.key, symbol: x.symbol, network: x.network, poolAddress: x.poolAddress, qty: 0, cost: 0};
      old.qty += qty; old.cost += amount; old.price = price; s.positions[x.key] = old;
      s.cash -= amount;
      s.history.unshift({side: 'BUY', symbol: x.symbol, amount, at: new Date().toISOString()});
      s.history = s.history.slice(0, 40);
      if (persist(s)) drawPaper();
    } catch (e) { alert('Paper buy failed: ' + e.message); }
    finally { busy = false; }
  }
  async function sell(key) {
    if (busy) return; busy = true;
    try {
      const s = load(), p = s.positions[key];
      if (!p) return;
      const price = await quote(p), proceeds = p.qty * price * (1 - slippage) * (1 - fee);
      if (!Number.isFinite(proceeds) || proceeds < 0) throw Error('Invalid price');
      const pnl = proceeds - p.cost;
      s.cash += proceeds; s.realized = (s.realized || 0) + pnl;
      delete s.positions[key];
      s.history.unshift({side: 'SELL', symbol: p.symbol, amount: proceeds, pnl, at: new Date().toISOString()});
      s.history = s.history.slice(0, 40);
      if (persist(s)) drawPaper();
    } catch (e) { alert('Paper sell failed: ' + e.message); }
    finally { busy = false; }
  }
  function drawPaper() {
    const s = load(), positions = Object.values(s.positions);
    $('v2cash').textContent = usd(s.cash);
    $('v2n').textContent = String(positions.length);
    $('v2pnl').textContent = (s.realized > 0 ? '+' : '') + usd(s.realized);
    $('v2pnl').className = s.realized > 0 ? 'up' : s.realized < 0 ? 'down' : '';
    const root = $('v2positions'); root.replaceChildren();
    if (!positions.length) root.append(node('p', 'hint', 'No simulated positions yet. Scan below and try Paper buy.'));
    for (const p of positions) {
      const card = node('div', 'v2pos');
      card.append(node('strong', '', p.symbol + ' · ' + p.network.toUpperCase()));
      card.append(node('p', '', 'Cost: ' + usd(p.cost) + ' · Units: ' + Number(p.qty).toPrecision(5) + ' · Last buy quote: $' + Number(p.price).toPrecision(5) + ' (not live)'));
      const btn = node('button', 'ghost', 'Paper sell full position');
      btn.onclick = () => sell(p.key);
      card.append(btn); root.append(card);
    }
    const hist = $('v2history'); hist.replaceChildren();
    if (s.history.length) hist.append(node('h2', '', 'Recent paper trades'));
    s.history.slice(0, 5).forEach(t => {
      hist.append(node('div', 'v2history', t.side + ' ' + t.symbol + ' · ' + usd(t.amount) + (t.side === 'SELL' ? ' · P/L ' + (t.pnl > 0 ? '+' : '') + usd(t.pnl) : '') + ' · ' + new Date(t.at).toLocaleString()));
    });
  }
  const priorCard = renderCard;
  renderCard = function (x) {
    const card = priorCard(x), a = stats(x), score = a.score;
    const line = node('div', 'v2score'), number = node('div', 'v2number', score + '/100');
    const detail = node('div', 'v2detail');
    detail.append(node('b', '', 'FOMO activity score · ' + (score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'lower')));
    detail.append(node('span', '', 'Hourly volume pace: ' + a.pace.toFixed(1) + '× 24h average · not predictive'));
    line.append(number, detail); card.insertBefore(line, card.children[1]);
    const tags = node('div', 'v2flags'), findings = risks(x);
    if (!findings.length) tags.append(node('span', 'v2flag ok', 'No simple flags ≠ verified safe'));
    else findings.forEach(f => tags.append(node('span', 'v2flag', f)));
    card.append(tags);
    const actions = node('div', 'v2buy');
    [10, 25].forEach(amount => {
      const btn = node('button', 'ghost', 'Paper buy ' + usd(amount));
      btn.onclick = () => buy(x, amount);
      actions.append(btn);
    });
    card.append(actions);
    card.append(node('p', 'small', 'To research in Fomo: Copy contract above and search it in the Fomo app.'));
    return card;
  };
  $('v2reset').onclick = () => {
    if (confirm('Reset simulated cash to $300 and permanently clear paper trades?')) {
      try { localStorage.removeItem(storageKey); drawPaper(); }
      catch (e) { alert('Cannot reset local storage.'); }
    }
  };
  drawPaper();
})();
