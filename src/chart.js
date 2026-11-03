'use strict';
// A dependency-free SVG price chart: high and low on one price scale, trades in a strip below.
window.priceChart = (() => {
  const { exact, esc } = window.fmt;
  const W = 820, LEFT = 62, RIGHT = 104, TOP = 12, PRICE_H = 232, GAP = 14, VOL_H = 46, AXIS = 24;
  const H = TOP + PRICE_H + GAP + VOL_H + AXIS;
  const plotW = W - LEFT - RIGHT;
  const short = (n) => {
    const a = Math.abs(n);
    const trim = (v) => String(Number(v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)));
    if (a >= 1e9) return `${trim(n / 1e9)}B`;
    if (a >= 1e6) return `${trim(n / 1e6)}M`;
    if (a >= 1e5) return `${trim(n / 1e3)}K`;
    return Math.round(n).toLocaleString('en-US');
  };
  function niceTicks(min, max, count = 5) {
    const raw = (max - min || Math.max(1, Math.abs(max))) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
  }
  const dateText = (ts, span) => new Date(ts * 1000).toLocaleString('en-US', span <= 2 * 86400
    ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const fullDate = (ts) => new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function spanText(points) {
    const hours = (points[points.length - 1].timestamp - points[0].timestamp) / 3600;
    return hours < 48 ? `${Math.max(1, Math.round(hours))} hours` : `${Math.round(hours / 24)} days`;
  }
  const seriesPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

  function render(box, { points, lines, name }) {
    const usable = points.filter((p) => p.avgHighPrice != null || p.avgLowPrice != null);
    if (usable.length < 2) {
      box.innerHTML = '<p class="chart-note">There are too few recent trades to draw a chart for this range.</p>';
      return;
    }
    const prices = usable.flatMap((p) => [p.avgHighPrice, p.avgLowPrice]).filter((v) => v != null);
    const all = [...prices, ...lines.map((l) => l.value)];
    let min = Math.min(...all), max = Math.max(...all);
    const pad = (max - min || max * 0.02 || 1) * 0.08;
    min = Math.max(0, min - pad); max += pad;
    const t0 = usable[0].timestamp, t1 = usable[usable.length - 1].timestamp;
    const span = t1 - t0;
    const x = (t) => LEFT + ((t - t0) / span) * plotW;
    const y = (v) => TOP + PRICE_H - ((v - min) / (max - min)) * PRICE_H;
    const volTop = TOP + PRICE_H + GAP;
    const vols = usable.map((p) => (p.highPriceVolume || 0) + (p.lowPriceVolume || 0));
    const hasVolume = vols.some((v) => v > 0);
    const maxVol = Math.max(1, ...vols);

    const high = usable.filter((p) => p.avgHighPrice != null).map((p) => [x(p.timestamp), y(p.avgHighPrice)]);
    const low = usable.filter((p) => p.avgLowPrice != null).map((p) => [x(p.timestamp), y(p.avgLowPrice)]);
    const dots = (pts, cls) => (usable.length <= 60 ? pts.map((p) => `<circle class="${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3"/>`).join('') : '');

    const grid = niceTicks(min, max).map((v) => `<line class="grid" x1="${LEFT}" x2="${LEFT + plotW}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="axis" x="${LEFT - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join('');
    const xTicks = Array.from({ length: 5 }, (_, i) => t0 + (span * i) / 4).map((t, i) => {
      const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
      return `<text class="axis" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${esc(dateText(t, span))}</text>`;
    }).join('');

    // Label positions are nudged apart so close prices stay readable.
    const placed = lines.map((l) => ({ ...l, ly: y(l.value) })).sort((a, b) => a.ly - b.ly);
    placed.forEach((l, i) => { if (i && l.ly - placed[i - 1].ly < 15) l.ly = placed[i - 1].ly + 15; });
    const refs = placed.map((l) => `<line class="ref ref-${l.kind}" x1="${LEFT}" x2="${LEFT + plotW}" y1="${y(l.value).toFixed(1)}" y2="${y(l.value).toFixed(1)}"/>
      <text class="ref-label" x="${LEFT + plotW + 6}" y="${(l.ly + 4).toFixed(1)}">${esc(l.label)} ${short(l.value)}</text>`).join('');

    const barW = Math.max(1, plotW / usable.length - 1);
    const bars = hasVolume ? usable.map((p, i) => {
      const h = (vols[i] / maxVol) * VOL_H;
      return h > 0 ? `<rect class="vol" x="${(x(p.timestamp) - barW / 2).toFixed(1)}" y="${(volTop + VOL_H - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"/>` : '';
    }).join('') : '';

    const first = prices[0], last = prices[prices.length - 1];
    const summary = `${name}: ranged from ${exact(Math.min(...prices))} to ${exact(Math.max(...prices))} gp over ${spanText(usable)}, latest ${exact(last)} gp, started at ${exact(first)} gp.`;
    box.innerHTML = `<div class="chart-legend">
        <span><i class="key key-high"></i>High, instant buy</span>
        <span><i class="key key-low"></i>Low, instant sell</span>
        <span class="chart-range">${exact(Math.min(...prices))} to ${exact(Math.max(...prices))}</span>
      </div>
      <div class="chart-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(summary)}">
          ${grid}${refs}
          <path class="line line-low" d="${seriesPath(low)}"/><path class="line line-high" d="${seriesPath(high)}"/>
          ${dots(low, 'dot-low')}${dots(high, 'dot-high')}
          ${hasVolume ? `<text class="axis" x="${LEFT - 8}" y="${volTop + 11}" text-anchor="end">${short(maxVol)}</text><text class="axis" x="${LEFT - 8}" y="${volTop + VOL_H}" text-anchor="end">trades</text>` : ''}
          ${bars}
          <line class="baseline" x1="${LEFT}" x2="${LEFT + plotW}" y1="${volTop + VOL_H}" y2="${volTop + VOL_H}"/>
          ${xTicks}
          <g class="cursor" hidden>
            <line class="cursor-line" y1="${TOP}" y2="${volTop + VOL_H}"/>
            <circle class="cursor-low" r="5"/><circle class="cursor-high" r="5"/>
          </g>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>`;

    const svg = box.querySelector('svg'), tip = box.querySelector('.chart-tip'), cursor = svg.querySelector('.cursor');
    const line = svg.querySelector('.cursor-line'), cLow = svg.querySelector('.cursor-low'), cHigh = svg.querySelector('.cursor-high');
    let index = usable.length - 1;
    function show(i) {
      index = Math.max(0, Math.min(usable.length - 1, i));
      const p = usable[index], px = x(p.timestamp);
      cursor.hidden = false;
      line.setAttribute('x1', px); line.setAttribute('x2', px);
      const place = (c, v) => { c.hidden = v == null; if (v != null) { c.setAttribute('cx', px); c.setAttribute('cy', y(v)); } };
      cHigh.toggleAttribute('hidden', p.avgHighPrice == null); cLow.toggleAttribute('hidden', p.avgLowPrice == null);
      place(cHigh, p.avgHighPrice); place(cLow, p.avgLowPrice);
      const trades = (p.highPriceVolume || 0) + (p.lowPriceVolume || 0);
      tip.innerHTML = `<strong>${esc(fullDate(p.timestamp))}</strong>
        <div><i class="key key-high"></i>High ${exact(p.avgHighPrice)}</div>
        <div><i class="key key-low"></i>Low ${exact(p.avgLowPrice)}</div>
        ${p.highPriceVolume == null ? '' : `<div>${exact(trades)} trades</div>`}`;
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W;
      const left = px * scale, room = svg.getBoundingClientRect().width - tip.offsetWidth - 8;
      tip.style.left = `${Math.min(left + 12, Math.max(8, left > room ? left - tip.offsetWidth - 12 : left + 12))}px`;
    }
    function hide() { cursor.hidden = true; tip.hidden = true; }
    function nearest(clientX) {
      const r = svg.getBoundingClientRect();
      const t = t0 + (((clientX - r.left) / r.width * W - LEFT) / plotW) * span;
      let best = 0;
      usable.forEach((p, i) => { if (Math.abs(p.timestamp - t) < Math.abs(usable[best].timestamp - t)) best = i; });
      return best;
    }
    svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => show(index));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    });
  }
  return { render, spanText, niceTicks };
})();
