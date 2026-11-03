'use strict';
// Run with: npm run smoke:live. Calls the real Wiki API and checks that the app can use it.
const os = require('os'), fs = require('fs'), path = require('path');
const { DataService } = require('../src-main/services/dataService');
const { rankItems } = require('../src-main/engine/score');
const { buildPlan } = require('../src-main/engine/plan');
const { EXEMPT_NAMES } = require('../src-main/engine/tax');

(async () => {
  const d = new DataService({ cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'merch-live-')) });
  await d.refreshLive();
  if (d.status.lastError) throw new Error(d.status.lastError);
  await d.refreshHours();
  if (d.status.lastError) throw new Error(d.status.lastError);
  const items = d.items();
  const names = new Set(d.mapping.map((m) => m.name));
  console.log(`${d.mapping.length} mapped items, ${items.length} priced, ${Object.keys(d.hours).length} hourly snapshots`);
  console.log('Exempt names missing from mapping:', [...EXEMPT_NAMES].filter((n) => !names.has(n)).join(', ') || 'none');
  const nowSec = Math.floor(Date.now() / 1000);
  for (const mode of ['fast', 'overnight']) {
    const r = rankItems(items, mode, { cash: 10e6, nowSec });
    const p = buildPlan(items, mode, { cash: 10e6, slots: 8, nowSec });
    console.log(`\n${mode}: ${r.length} candidates, plan profit ${Math.round(p.profit).toLocaleString()} gp`);
    r.slice(0, 5).forEach((c) => console.log(`  ${c.name}: buy ${c.buy} sell ${c.sell} x${c.qty} profit ${Math.round(c.profit).toLocaleString()} hit ${c.hitRate?.toFixed(2)}${c.flags.length ? ` [${c.flags.map((f) => f.id)}]` : ''}`));
  }
  await d.refreshBaselines();
  if (d.status.lastError) throw new Error(d.status.lastError);
  console.log('\nChart ranges for Abyssal whip:');
  for (const lookback of ['24h', '7d', '30d', '6m']) {
    const res = await d.get(`/timeseries?id=4151&lookback=${lookback}`);
    const pts = res.data || [];
    const days = pts.length > 1 ? (pts[pts.length - 1].timestamp - pts[0].timestamp) / 86400 : 0;
    const h = await d.history(4151, lookback);
    console.log(`  ${lookback}: API gave ${pts.length} points over ${days.toFixed(1)} days, every ${res.timestep}s. Chart uses ${h.source} data, ${h.points.length} points${h.partial ? ', partial' : ''}`);
  }
  const long = rankItems(d.items(), 'long', { cash: 10e6, nowSec });
  console.log(`\nlong: ${Object.keys(d.samples).length} samples, ${long.length} candidates`);
  long.slice(0, 5).forEach((c) => console.log(`  ${c.name}: buy ${c.buy} sell ${c.sell} x${c.qty} hit ${c.hitRate}${c.flags.length ? ` [${c.flags.map((f) => f.id)}]` : ''}`));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
