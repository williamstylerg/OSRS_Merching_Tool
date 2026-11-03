'use strict';
(() => {
  const { exact, gp, pct, hours, ago, countdown, esc, icon, parseAmount } = window.fmt;
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const ui = { tab: 'planner', item: null, finder: [] };
  const RANGES = ['24h', '7d', '30d', '6m'];
  const RANGE_LABEL = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '6m': '6 months' };
  const DEFAULT_RANGE = { fast: '24h', overnight: '7d', long: '30d' };
  let view = null;

  const TABS = [['planner', 'Planner'], ['limits', 'Buy limits'], ['log', 'Trade log'], ['watch', 'Watchlist']];
  const HIT_LABEL = {
    fast: 'Past hours with a profitable margin',
    overnight: 'Past 8-hour windows that filled both ways',
    long: 'Past dips that recovered within 7 days',
  };
  const modeLabel = (id) => view.modes.find((m) => m.id === id)?.label || id;

  function render() {
    if (!view) return;
    const s = view.settings;
    $('modes').innerHTML = view.modes.map((m) => `<button role="radio" aria-checked="${m.id === s.mode}" data-action="mode" data-id="${m.id}" title="${esc(m.summary)}">${esc(m.label)}</button>`).join('');
    $('tabs').innerHTML = TABS.map(([id, label]) => `<button data-action="tab" data-id="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('');
    if (document.activeElement !== $('cash')) $('cash').value = compact(s.cash);
    $('exposure').value = String(s.maxExposure);
    $('members').checked = s.members;
    renderStatus();
    const scroll = $('main').scrollTop;
    $('main').innerHTML = { planner, limits, log, watch }[ui.tab]();
    $('main').scrollTop = scroll;
  }

  // Pause keeps the slots and ranked list still, while prices keep updating underneath.
  const pauseKey = () => { const s = view.settings; return [s.mode, s.cash, s.maxExposure, s.members, s.showRisky, s.slots].join('|'); };
  function shown() {
    if (ui.paused && ui.paused.key === pauseKey()) return ui.paused;
    ui.paused = null;
    return view;
  }

  const compact = (n) => (n >= 1e9 && n % 1e8 === 0 ? `${n / 1e9}b` : n >= 1e6 && n % 1e5 === 0 ? `${n / 1e6}m` : n >= 1e3 && n % 1e3 === 0 ? `${n / 1e3}k` : String(n));

  function renderStatus() {
    const st = view.status;
    const bits = [];
    if (st.lastUpdate) bits.push(`Prices updated ${ago(view.now - st.lastUpdate * 1000)}`);
    else bits.push('Loading prices');
    if (st.hoursLoaded < 24) bits.push(`loading price history ${st.hoursLoaded} of 24 hours`);
    if (view.settings.mode === 'long' && st.baselineLoaded < 60) bits.push(`loading 30-day history ${Math.round(st.baselineLoaded / 2)} of 30 days`);
    $('freshness').textContent = bits.join('. ');
    const b = $('banner');
    b.hidden = !st.lastError;
    b.textContent = st.lastError ? `Couldn't update prices: ${st.lastError}. ${st.lastUpdate ? 'Showing the last prices received, so check them in-game before buying.' : 'The app will retry in a minute.'}` : '';
  }

  // ---- Planner
  function slotTile(c) {
    return `<button class="slot" data-action="open" data-id="${c.id}" aria-label="${esc(c.name)}, show details">
      ${icon(c.icon)}<span class="name">${esc(c.name)}</span><span class="qty">${exact(c.qty)} items</span>
      <dl><dt>Buy at</dt><dd>${exact(c.buy)}</dd><dt>Sell at</dt><dd>${exact(c.sell)}</dd><dt>Profit</dt><dd>${gp(c.profit)}</dd></dl>
    </button>`;
  }
  function planner() {
    const { settings, status } = view;
    const { plan, ranked } = shown();
    const openTrades = view.stats.trades.filter((t) => !t.closed);
    const mode = view.modes.find((m) => m.id === settings.mode);
    const tiles = [...plan.slots.map(slotTile)];
    const emptyLabel = plan.cashLeft < settings.cash * 0.05 ? 'No cash left for this slot' : 'Nothing else fits right now';
    while (tiles.length < plan.slotCount) tiles.push(`<div class="slot empty">${emptyLabel}</div>`);
    return `
      <div class="plan-head">
        <div><h1>${esc(mode.label)}</h1><p class="lede">${esc(mode.summary)}</p></div>
        <div class="plan-total"><strong>${gp(plan.profit)}</strong>possible profit using ${gp(plan.cashUsed)} of your cash<br>${gp(plan.adjustedProfit)} after allowing for risk</div>
      </div>
      <div class="slots">${tiles.join('')}</div>
      ${openTrades.length ? `<h2>Your open trades</h2>${openTable(openTrades)}` : ''}
      <div class="list-head">
        <h2>Ranked items</h2>
        <div class="list-tools">
          <button class="btn" data-action="pause" aria-pressed="${!!ui.paused}">${ui.paused ? 'Resume updates' : 'Pause list'}</button>
          <label class="check"><input type="checkbox" data-action="risky" ${settings.showRisky ? 'checked' : ''}> Show risky items</label>
        </div>
      </div>
      ${ui.paused ? `<p class="lede">Paused ${ago(view.now - ui.paused.at)}. These prices aren't updating, so check them in-game.</p>` : ''}
      ${ranked.length ? rankedTable(ranked) : emptyRanked(status)}`;
  }
  function emptyRanked(st) {
    if (!st.itemCount) return '<div class="empty-state"><strong>Waiting for prices</strong>Items appear as soon as the first prices arrive.</div>';
    if (view.settings.mode === 'long' && st.baselineLoaded < 60) return '<div class="empty-state"><strong>Building 30-day history</strong>Long holds compare each item to its 30-day norm. Results appear as that history loads.</div>';
    return '<div class="empty-state"><strong>No items fit right now</strong>Raise your cash or the limit per item, or turn on Show risky items.</div>';
  }
  function rankedTable(rows) {
    return `<table><thead><tr><th>Item</th><th>Buy at</th><th>Sell at</th><th>Margin after tax</th><th>Quantity</th><th>Profit</th><th>Track record</th></tr></thead><tbody>
      ${rows.map((c) => {
        const worst = c.flags.some((f) => f.severity === 'danger') ? 'danger' : '';
        return `<tr class="row" tabindex="0" data-action="open" data-id="${c.id}" aria-haspopup="dialog">
          <td><div class="itemcell">${icon(c.icon)}${esc(c.name)}${c.flags.length ? ` <span class="flagdot ${worst}" title="${esc(c.flags.map((f) => f.text).join('. '))}">▲</span>` : ''}</div></td>
          <td>${exact(c.buy)}</td><td>${exact(c.sell)}</td><td>${exact(c.netMargin)}</td><td>${exact(c.qty)}</td><td>${gp(c.profit)}</td><td>${c.hitRate == null ? 'Too little data' : pct(c.hitRate, 0)}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
  const itemLink = (id, name) => `<button class="linkbtn" data-action="open" data-id="${id}">${esc(name)}</button>`;

  // ---- Item window
  function candidateFacts(c) {
    return `<div class="detail-grid">
      <div><span>Buy at</span><b>${exact(c.buy)}</b></div>
      <div><span>Sell at</span><b>${exact(c.sell)}</b></div>
      <div><span>Margin after tax</span><b>${exact(c.netMargin)}</b></div>
      <div><span>Quantity</span><b>${exact(c.qty)}</b></div>
      <div><span>Profit</span><b>${gp(c.profit)}</b></div>
      <div><span>Sets the quantity</span>${c.limitedBy === 'buy limit' ? 'Your buy limit' : c.limitedBy === 'volume' ? 'Market volume' : 'Your cash cap'}</div>
      <div><span>Tax per item</span>${exact(c.tax)} gp</div>
      <div><span>Return per item</span>${pct(c.roi, 2)}</div>
      <div><span>Trades an hour</span>${exact(c.hourlyLow)} sells, ${exact(c.hourlyHigh)} buys</div>
      <div><span>Estimated time to fill</span>${hours(c.hoursToFill)}</div>
      <div><span>${HIT_LABEL[c.mode]}</span>${c.hitRate == null ? 'Too little data' : pct(c.hitRate, 0)}</div>
      <div><span>Target</span>${c.target ? 'Your watchlist price' : c.mode === 'long' ? '30-day norm' : 'Current market'}</div>
    </div>
    ${c.flags.length ? `<ul class="flags">${c.flags.map((f) => `<li class="${f.severity}">${esc(f.text)}</li>`).join('')}</ul>` : ''}`;
  }
  function itemHtml(d) {
    const c = d.candidate;
    const mode = modeLabel(d.mode);
    const limit = d.limit == null ? 'Unknown' : `${exact(Math.max(0, d.limit - d.limitUsed))} of ${exact(d.limit)}`;
    return `<div class="item-head">
        ${icon(d.icon)}<h2>${esc(d.name)}</h2>
        <button class="btn quiet" data-action="close" aria-label="Close ${esc(d.name)}">Close</button>
      </div>
      <p class="item-status">${d.reason ? `Not in ${esc(mode)} right now. ${esc(d.reason)}.` : `Suggested for ${esc(mode)}.`}</p>
      <div class="item-bar">
        <div class="range" role="group" aria-label="Chart range" id="ranges"></div>
        <div class="row-actions"><button class="btn primary" data-action="log-buy" data-id="${d.id}">Log buy</button>
        <button class="btn" data-action="watch-item" data-id="${d.id}">${d.target ? 'Change watchlist target' : 'Add to watchlist'}</button></div>
      </div>
      <div id="chart" class="chart"></div>
      <div class="detail-grid market">
        <div><span>Latest high</span>${exact(d.latest?.high)}</div>
        <div><span>Latest low</span>${exact(d.latest?.low)}</div>
        <div><span>Buy limit left</span>${limit}</div>
        ${d.limitResetAt ? `<div><span>Limit resets in</span>${countdown(d.limitResetAt - view.now)}</div>` : ''}
        ${d.target ? `<div><span>Your watchlist target</span>${exact(d.target)}</div>` : ''}
      </div>
      ${d.held.length ? `<h3>You hold</h3>${d.held.map((t) => `<p>${exact(t.openQty)} bought at ${exact(t.buyPrice)}, break-even ${exact(t.breakEven)}, ${t.profitNow == null ? 'no market price right now' : `${t.profitNow < 0 ? '-' : ''}${exact(Math.abs(t.profitNow))} gp at market`}</p>`).join('')}` : ''}
      ${c ? `<h3>${esc(mode)} plan</h3>${candidateFacts(c)}` : ''}`;
  }
  async function openItem(id) {
    let detail;
    try {
      detail = await api.getItem(id);
    } catch (ex) {
      openDialog(`<h2>Couldn't open that item</h2><form><p class="lede">${esc(ex.message.replace(/^.*Error: /, ''))}</p>${buttons('Close')}</form>`, () => null);
      return;
    }
    if (dlg.open) dlg.close();
    dlg.className = 'item';
    dlg.innerHTML = itemHtml(detail);
    ui.item = { detail, range: DEFAULT_RANGE[detail.mode] };
    dlg.showModal();
    dlg.querySelector('[data-action=close]').focus();
    dlg.scrollTop = 0;
    loadChart();
  }
  function chartLines(d) {
    const c = d.candidate;
    const lines = [];
    if (c) lines.push({ value: c.buy, label: 'Buy', kind: 'low' }, { value: c.sell, label: 'Sell', kind: 'high' });
    d.held.slice(0, 1).forEach((t) => lines.push({ value: t.buyPrice, label: 'You paid', kind: 'held' }));
    return lines;
  }
  async function loadChart() {
    const state = ui.item;
    if (!state) return;
    const { detail, range } = state;
    $('ranges').innerHTML = RANGES.map((r) => `<button class="btn" data-action="range" data-id="${r}" aria-pressed="${r === range}">${RANGE_LABEL[r]}</button>`).join('');
    const box = $('chart');
    box.innerHTML = '<p class="chart-note">Loading prices</p>';
    try {
      const h = await api.getHistory({ id: detail.id, lookback: range });
      if (ui.item !== state || state.range !== range) return;
      window.priceChart.render(box, { points: h.points, lines: chartLines(detail), name: detail.name });
      const note = h.points.length < 2 ? ''
        : h.partial ? `<p class="chart-note">Only ${esc(window.priceChart.spanText(h.points))} of the ${RANGE_LABEL[range]} is available.</p>`
          : h.source === 'stored' ? '<p class="chart-note">Drawn from history saved by this app, so points are further apart.</p>' : '';
      box.insertAdjacentHTML('beforeend', note);
    } catch (ex) {
      if (ui.item !== state || state.range !== range) return;
      box.innerHTML = `<p class="chart-note">Couldn't load this chart: ${esc(ex.message.replace(/^.*Error: /, ''))}.</p><button class="btn" data-action="retry-chart">Try again</button>`;
    }
  }

  // ---- Buy limits
  function limits() {
    const rows = view.limits;
    return `<div class="plan-head"><div><h1>Buy limits</h1><p class="lede">A window opens on your first buy and resets four hours later. This only knows about buys you log here.</p></div>
      <button class="btn primary" data-action="add-limit">Log a purchase</button></div>
      ${rows.length ? `<table><thead><tr><th>Item</th><th>Used</th><th>Limit</th><th>Resets in</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${itemLink(r.itemId, r.name)}</td><td>${r.limit ? `<span class="bar"><i class="w${Math.min(100, Math.round(r.used / r.limit * 20) * 5)}"></i></span>` : ''}${exact(r.used)}</td><td>${r.limit == null ? 'Unknown' : exact(r.limit)}</td><td>${countdown(r.resetAt - view.now)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty-state"><strong>No active limits</strong>Log a buy from the Planner, or log a purchase here for items you bought to use.</div>'}`;
  }

  // ---- Trade log
  function log() {
    const st = view.stats;
    const open = st.trades.filter((t) => !t.closed);
    const done = st.trades.filter((t) => t.closed);
    if (!st.trades.length) return `<h1>Trade log</h1><div class="empty-state"><strong>No trades yet</strong>Open an item in the Planner and choose Log buy. Once you log the sale, this page compares what you made with what the plan expected.</div>`;
    const diff = st.comparableRealized - st.expected;
    return `<h1>Trade log</h1>
      <div class="scoreline">
        <div><span>Profit made</span><strong>${gp(st.realized)}</strong></div>
        <div><span>Plan expected on the same sales</span><strong>${gp(st.expected)}</strong></div>
        <div><span>Difference</span><strong class="${diff >= 0 ? 'num-good' : 'num-bad'}">${diff >= 0 ? '+' : ''}${exact(diff)}</strong></div>
        <div><span>Tied up in open trades</span><strong>${gp(st.openCost)}</strong></div>
      </div>
      <h2>Open trades</h2>
      ${open.length ? openTable(open) : '<div class="empty-state">Nothing is open.</div>'}
      ${st.byMode.length ? `<h2>By strategy</h2>${groupTable(st.byMode, (g) => modeLabel(g.label))}` : ''}
      ${st.byItem.length ? `<h2>By item</h2>${groupTable(st.byItem, (g) => g.label)}` : ''}
      ${done.length ? `<h2>Finished trades</h2>${doneTable(done)}` : ''}`;
  }
  const tradeButtons = (t, open) => `<div class="row-actions">${open ? `<button class="btn" data-action="log-sell" data-id="${t.id}">Log sale</button>` : ''}
    <button class="btn" data-action="edit-trade" data-id="${t.id}" aria-label="Edit ${esc(t.name)} trade">Edit</button>
    <button class="btn quiet" data-action="delete-trade" data-id="${t.id}" aria-label="Delete ${esc(t.name)} trade">Delete</button></div>`;
  function openTable(rows) {
    return `<table><thead><tr><th>Item</th><th>Strategy</th><th>Left to sell</th><th>Bought at</th><th>Break-even</th><th>Planned sell</th><th>Market sell now</th><th>Profit at market</th><th></th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td>${itemLink(t.itemId, t.name)}</td><td>${esc(modeLabel(t.mode))}</td><td>${exact(t.openQty)}</td><td>${exact(t.buyPrice)}</td><td>${exact(t.breakEven)}</td>
      <td>${t.expectedSell == null ? 'Not set' : exact(t.expectedSell)}</td><td>${exact(t.sellNow)}</td>
      <td class="${t.profitNow < 0 ? 'num-bad' : ''}">${t.profitNow == null ? '–' : t.profitNow < 0 ? `-${exact(-t.profitNow)}` : gp(t.profitNow)}</td>
      <td>${tradeButtons(t, true)}</td></tr>`).join('')}
    </tbody></table>`;
  }
  function doneTable(rows) {
    return `<table><thead><tr><th>Item</th><th>Strategy</th><th>Bought</th><th>Buy price</th><th>Hours held</th><th>Profit</th><th>Expected</th><th></th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td>${itemLink(t.itemId, t.name)}</td><td>${esc(modeLabel(t.mode))}</td><td>${exact(t.qty)}</td><td>${exact(t.buyPrice)}</td>
      <td>${hours(t.hoursHeld)}</td><td>${gp(t.realized)}</td><td>${t.expected == null ? '–' : gp(t.expected)}</td><td>${tradeButtons(t, false)}</td></tr>`).join('')}
    </tbody></table>`;
  }
  function groupTable(rows, label) {
    return `<table><thead><tr><th>Name</th><th>Trades</th><th>Won</th><th>Profit</th><th>Expected</th></tr></thead><tbody>
    ${rows.map((g) => `<tr><td>${esc(label(g))}</td><td>${g.trades}</td><td>${pct(g.wins / g.trades, 0)}</td><td>${gp(g.realized)}</td><td>${g.comparable ? gp(g.expected) : '–'}</td></tr>`).join('')}
    </tbody></table>`;
  }

  // ---- Watchlist
  function watch() {
    const w = view.watchlist;
    return `<div class="plan-head"><div><h1>Watchlist</h1><p class="lede">For speculation the data can't see, like upcoming updates. Set your own target and the item appears in Long holds whenever that target is profitable.</p></div>
      <button class="btn primary" data-action="add-watch">Add item</button></div>
      ${w.length ? `<table><thead><tr><th>Item</th><th>Your target</th><th></th></tr></thead><tbody>
      ${w.map((x) => `<tr><td>${itemLink(x.itemId, x.name)}</td><td>${exact(x.target)}</td><td><button class="btn quiet" data-action="remove-watch" data-id="${x.itemId}" aria-label="Remove ${esc(x.name)}">Remove</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty-state"><strong>Your watchlist is empty</strong>Add an item you expect to rise, with the price you would sell at.</div>'}`;
  }

  // ---- Dialogs
  const dlg = $('dialog');
  function openDialog(html, onSubmit) {
    if (dlg.open) dlg.close();
    dlg.className = '';
    dlg.innerHTML = html;
    dlg.showModal();
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      try {
        const next = await onSubmit(Object.fromEntries(new FormData(form)));
        if (next) view = next;
        dlg.close();
        render();
      } catch (ex) {
        err.textContent = ex.message.replace(/^.*Error: /, '');
      }
    });
  }
  const amount = (v, name) => {
    const n = parseAmount(v);
    if (!n || n <= 0) throw new Error(`Enter a ${name} above zero, such as 1,500 or 2.5m`);
    return n;
  };
  const buttons = (label) => `<p class="form-error" role="alert"></p><div class="actions"><button class="btn primary" type="submit">${label}</button><button class="btn" type="button" data-action="close">Cancel</button></div>`;

  function logBuy(c) {
    openDialog(`<h2>Log buy: ${esc(c.name)}</h2><form>
      <label>Quantity bought<input name="qty" value="${c.qty}" required></label>
      <label>Price paid each<input name="price" value="${c.buy}" required></label>
      <label>Planned sell price<input name="sell" value="${c.sell}"></label>
      ${buttons('Log buy')}</form>`, ({ qty, price, sell }) => api.addTrade({
      itemId: c.id, name: c.name, mode: c.mode, qty: amount(qty, 'quantity'),
      buyPrice: amount(price, 'price'), expectedSell: sell ? amount(sell, 'sell price') : null,
    }));
  }
  function logSell(t) {
    openDialog(`<h2>Log sale: ${esc(t.name)}</h2><form>
      <label>Quantity sold<input name="qty" value="${t.openQty}" required></label>
      <label>Price each, before tax<input name="price" value="${t.expectedSell ?? t.sellNow ?? ''}" required></label>
      ${buttons('Log sale')}</form>`, ({ qty, price }) => api.addSell({ id: t.id, qty: amount(qty, 'quantity'), price: amount(price, 'price') }));
  }
  function editTrade(t) {
    const saleRows = t.sells.map((s, i) => `<fieldset><legend>Sale ${i + 1}</legend>
      <label>Quantity (0 removes this sale)<input name="sellQty${i}" value="${s.qty}" required></label>
      <label>Price each, before tax<input name="sellPrice${i}" value="${s.price}" required></label></fieldset>`).join('');
    openDialog(`<h2>Edit trade: ${esc(t.name)}</h2><form>
      <label>Quantity bought<input name="qty" value="${t.qty}" required></label>
      <label>Price paid each<input name="price" value="${t.buyPrice}" required></label>
      <label>Planned sell price (optional)<input name="sell" value="${t.expectedSell ?? ''}"></label>
      ${saleRows}${buttons('Save changes')}</form>`, (v) => api.updateTrade({
      id: t.id, qty: amount(v.qty, 'quantity'), buyPrice: amount(v.price, 'price'),
      expectedSell: v.sell.trim() ? amount(v.sell, 'sell price') : null,
      sells: t.sells.map((s, i) => {
        const qty = v[`sellQty${i}`].trim() === '0' ? 0 : amount(v[`sellQty${i}`], 'quantity');
        return { ...s, qty, price: qty ? amount(v[`sellPrice${i}`], 'price') : s.price };
      }),
    }));
  }
  function itemPicker(title, extra, submitLabel, onSubmit, preset) {
    openDialog(`<h2>${title}</h2><form>
      <label>Item<input name="q" autocomplete="off" required value="${esc(preset?.name || '')}"></label>
      <div class="results" id="results"></div>${extra}${buttons(submitLabel)}</form>`, (vals) => {
      if (!picked) throw new Error('Choose an item from the list');
      return onSubmit(picked, vals);
    });
    let picked = preset || null;
    const input = dlg.querySelector('[name=q]');
    input.addEventListener('input', async () => {
      picked = null;
      const found = await api.searchItems(input.value);
      $('results').innerHTML = found.map((f) => `<button type="button" data-action="pick" data-id="${f.id}" data-name="${esc(f.name)}">${esc(f.name)}</button>`).join('');
    });
    dlg.querySelector('.results').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action=pick]');
      if (!b) return;
      picked = { id: Number(b.dataset.id), name: b.dataset.name };
      input.value = picked.name;
      $('results').innerHTML = '';
    });
  }

  const candidate = (id) => (ui.item?.detail.id === id && ui.item.detail.candidate)
    || shown().ranked.find((c) => c.id === id) || shown().plan.slots.find((c) => c.id === id);
  async function apply(p) { view = await p; render(); }

  const actions = {
    mode: (b) => apply(api.updateSettings({ mode: b.dataset.id })),
    tab: (b) => { ui.tab = b.dataset.id; render(); },
    open(b) {
      openItem(Number(b.dataset.id));
    },
    'log-buy'(b) {
      const id = Number(b.dataset.id);
      const d = ui.item?.detail;
      const c = candidate(id) || {
        id, name: d.name, mode: d.mode, qty: '',
        buy: d.latest?.low == null ? '' : d.latest.low + 1,
        sell: d.latest?.high == null ? '' : d.latest.high - 1,
      };
      logBuy(c);
    },
    range(b) { ui.item.range = b.dataset.id; loadChart(); },
    'retry-chart': () => loadChart(),
    'edit-trade': (b) => editTrade(view.stats.trades.find((t) => t.id === b.dataset.id)),
    pause() {
      ui.paused = ui.paused ? null : { key: pauseKey(), plan: view.plan, ranked: view.ranked, at: view.now };
      render();
    },
    'log-sell': (b) => logSell(view.stats.trades.find((t) => t.id === b.dataset.id)),
    'delete-trade': (b) => openDialog(`<h2>Delete this trade?</h2><form><p class="lede">It comes out of your history and your buy limit count. This can't be undone.</p>${buttons('Delete trade')}</form>`, () => api.deleteTrade(b.dataset.id)),
    'add-limit': () => itemPicker('Log a purchase', '<label>Quantity bought<input name="qty" required></label>', 'Log purchase',
      (it, v) => api.addLimitBuy({ itemId: it.id, name: it.name, qty: amount(v.qty, 'quantity') })),
    'add-watch': () => itemPicker('Add to watchlist', '<label>Your target sell price<input name="target" required></label>', 'Add item',
      (it, v) => api.setWatch({ itemId: it.id, name: it.name, target: amount(v.target, 'target') })),
    'watch-item'(b) {
      const d = ui.item.detail;
      const value = d.target ?? d.candidate?.sell ?? '';
      itemPicker('Add to watchlist', `<label>Your target sell price<input name="target" value="${value}" required></label>`, 'Add item',
        (it, v) => api.setWatch({ itemId: it.id, name: it.name, target: amount(v.target, 'target') }), { id: d.id, name: d.name });
    },
    'remove-watch': (b) => apply(api.setWatch({ itemId: Number(b.dataset.id), name: '', target: null })),
    close: () => dlg.close(),
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b && actions[b.dataset.action] && e.target.type !== 'checkbox') actions[b.dataset.action](b);
  });
  dlg.addEventListener('close', () => { ui.item = null; render(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('find').focus(); $('find').select(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.row')) { e.preventDefault(); actions.open(e.target); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-action=risky]')) apply(api.updateSettings({ showRisky: e.target.checked }));
  });
  $('cash').addEventListener('change', (e) => {
    const n = parseAmount(e.target.value);
    if (n) apply(api.updateSettings({ cash: n })); else e.target.value = compact(view.settings.cash);
  });
  $('exposure').addEventListener('change', (e) => apply(api.updateSettings({ maxExposure: Number(e.target.value) })));
  $('members').addEventListener('change', (e) => apply(api.updateSettings({ members: e.target.checked })));

  // Item pictures come from the Wiki; a missing one shouldn't leave a broken image.
  document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

  // ---- Find any item
  const find = $('find'), results = $('find-results');
  function hideResults() { results.hidden = true; }
  async function runSearch() {
    const q = find.value;
    const found = await api.searchItems(q);
    if (find.value !== q) return;
    ui.finder = found;
    results.hidden = q.trim().length < 2;
    results.innerHTML = found.length
      ? found.map((f) => `<button type="button" data-action="find-pick" data-id="${f.id}">${icon(f.icon)}<span>${esc(f.name)}</span><span class="find-price">${f.latest?.high == null ? '' : exact(f.latest.high)}</span></button>`).join('')
      : `<p class="find-empty">No item matches “${esc(q)}”</p>`;
  }
  find.addEventListener('input', runSearch);
  find.addEventListener('focus', () => { if (find.value.trim().length >= 2) runSearch(); });
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && ui.finder[0] && !results.hidden) { pickResult(ui.finder[0].id); }
    if (e.key === 'ArrowDown') { e.preventDefault(); results.querySelector('button')?.focus(); }
    if (e.key === 'Escape') hideResults();
  });
  results.addEventListener('keydown', (e) => {
    const list = [...results.querySelectorAll('button')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[i + 1]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || find).focus(); }
    if (e.key === 'Escape') { hideResults(); find.focus(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.finder')) hideResults(); });
  function pickResult(id) { hideResults(); find.value = ''; ui.finder = []; openItem(id); }
  actions['find-pick'] = (b) => pickResult(Number(b.dataset.id));

  api.onView((v) => { view = v; if (!dlg.open) render(); });
  api.getView().then((v) => { view = v; render(); });
})();
