'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { DataService, USER_AGENT } = require('../src-main/services/dataService');
const { Store } = require('../src-main/services/store');
const { buildView, searchItems, itemDetail } = require('../src-main/services/plannerView');

const NOW = 1_800_000_000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'merch-'));
function fakeApi(log, { fail = false } = {}) {
  return async (url, init) => {
    log.push({ url, ua: init.headers['User-Agent'] });
    if (fail) return { ok: false, status: 503 };
    const body = url.includes('/mapping') ? [{ id: 4151, name: 'Abyssal whip', limit: 70, members: true, icon: 'w.png' }]
      : url.includes('/latest') ? { data: { 4151: { high: 1100, highTime: NOW - 30, low: 1000, lowTime: NOW - 30 } } }
      : url.includes('/5m') ? { data: { 4151: { avgHighPrice: 1090, highPriceVolume: 9, avgLowPrice: 1005, lowPriceVolume: 9 } } }
      : url.includes('/1h') ? { data: { 4151: { avgHighPrice: 1100, highPriceVolume: 500, avgLowPrice: 1000, lowPriceVolume: 500 } } }
      : { data: [{ timestamp: NOW - 86400, avgHighPrice: 1200, avgLowPrice: 1180, highPriceVolume: 1, lowPriceVolume: 1 }] };
    return { ok: true, json: async () => body };
  };
}
test('uses v2 routes, one bulk latest call, and a custom user agent', async () => {
  const log = [];
  const d = new DataService({ cacheDir: tmp(), fetchImpl: fakeApi(log), pauseMs: 0 });
  await d.refreshLive(NOW);
  assert.ok(log.every((r) => r.url.includes('/api/v2/osrs') && r.ua === USER_AGENT));
  assert.equal(log.filter((r) => r.url.includes('/latest')).length, 1);
  assert.ok(!log.some((r) => r.url.includes('latest?id')));
});
test('hourly history is cached, so a restart refetches nothing', async () => {
  const dir = tmp(), log = [];
  const d = new DataService({ cacheDir: dir, fetchImpl: fakeApi(log), pauseMs: 0 });
  await d.refreshHours(NOW);
  assert.equal(log.length, 24);
  const again = [];
  const d2 = new DataService({ cacheDir: dir, fetchImpl: fakeApi(again), pauseMs: 0 });
  d2.load();
  await d2.refreshHours(NOW);
  assert.equal(again.length, 0);
  await d2.refreshHours(NOW + 3600);
  assert.equal(again.length, 1, 'only the new hour');
  assert.equal(Object.keys(d2.hours).length, 24);
});
test('an outage keeps the last prices and reports the error', async () => {
  const d = new DataService({ cacheDir: tmp(), fetchImpl: fakeApi([]), pauseMs: 0 });
  await d.refreshLive(NOW);
  d.fetch = fakeApi([], { fail: true });
  await d.refreshLive(NOW + 60);
  assert.match(d.status.lastError, /503/);
  assert.equal(d.latest[4151].high, 1100);
});
test('30-day history covers every item from shared samples, and is cached', async () => {
  const dir = tmp(), log = [];
  const d = new DataService({ cacheDir: dir, fetchImpl: fakeApi(log), pauseMs: 0 });
  await d.refreshLive(NOW);
  log.length = 0;
  await d.refreshBaselines(NOW);
  assert.equal(log.length, 60);
  assert.ok(log.every((r) => r.url.includes('/1h?timestamp=')));
  assert.equal(d.items()[0].baseline.length, 60);
  assert.equal(d.items()[0].baseline[0].avgHighPrice, 1100);
  const again = [];
  const d2 = new DataService({ cacheDir: dir, fetchImpl: fakeApi(again), pauseMs: 0 });
  d2.load();
  await d2.refreshBaselines(NOW);
  assert.equal(again.length, 0);
});
test('chart uses the API when it covers the range', async () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ timestamp: NOW - i * 3600, avgHighPrice: 10, avgLowPrice: 9 }));
  const log = [];
  const d = new DataService({ cacheDir: tmp(), pauseMs: 0, fetchImpl: async (url) => { log.push(url); return { ok: true, json: async () => ({ data: pts }) }; } });
  const h = await d.history(4151, '7d', NOW);
  assert.equal(h.source, 'api');
  assert.equal(h.partial, false);
  assert.equal(h.points[0].timestamp, NOW - 199 * 3600, 'oldest first');
  assert.ok(log[0].endsWith('/timeseries?id=4151&lookback=7d'));
  await d.history(4151, '7d', NOW + 60);
  assert.equal(log.length, 1, 'a second look within five minutes uses the cache');
  await assert.rejects(d.history(4151, 'nonsense', NOW), /Unknown chart range/);
});
test('chart falls back to stored history when the API returns too little', async () => {
  const short = Array.from({ length: 60 }, (_, i) => ({ timestamp: NOW - i * 300, avgHighPrice: 10, avgLowPrice: 9 }));
  const d = new DataService({ cacheDir: tmp(), pauseMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ data: short }) }) });
  for (let i = 0; i < 40; i++) d.samples[NOW - i * 43200] = { 4151: [900, 1000] };
  const h = await d.history(4151, '30d', NOW);
  assert.equal(h.source, 'stored');
  assert.equal(h.partial, false);
  assert.equal(h.points.length, 40);
  const six = await d.history(4151, '6m', NOW);
  assert.equal(six.partial, true, 'stored data cannot cover six months');
});
test('chart survives an outage using stored history, and reports when it has none', async () => {
  const d = new DataService({ cacheDir: tmp(), pauseMs: 0, fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(d.history(4151, '7d', NOW), /503/);
  for (let i = 0; i < 14; i++) d.samples[NOW - i * 43200] = { 4151: [900, 1000] };
  d.baselineCache = null;
  assert.equal((await d.history(4151, '7d', NOW)).source, 'stored');
});
test('search puts names starting with the text first', async () => {
  const d = new DataService({ cacheDir: tmp(), fetchImpl: fakeApi([]), pauseMs: 0 });
  d.mapping = [{ id: 1, name: 'Black whip' }, { id: 2, name: 'Whip vine' }, { id: 3, name: 'Abyssal whip' }, { id: 4, name: 'Shark' }];
  assert.deepEqual(searchItems(d, 'whip').map((r) => r.name), ['Whip vine', 'Abyssal whip', 'Black whip']);
  assert.deepEqual(searchItems(d, 'w'), []);
  assert.deepEqual(searchItems(d, 'zzz'), []);
});
test('item details work for an unranked item and explain why', async () => {
  const dir = tmp();
  const d = new DataService({ cacheDir: dir, fetchImpl: fakeApi([]), pauseMs: 0 });
  await d.refreshLive(NOW); await d.refreshHours(NOW);
  d.mapping.push({ id: 5, name: 'Untraded thing', limit: 5, members: false });
  const s = new Store(dir), nowMs = NOW * 1000;
  assert.match(itemDetail(d, s, 5, nowMs).reason, /traded recently/);
  const ok = itemDetail(d, s, 4151, nowMs);
  assert.equal(ok.reason, null);
  assert.equal(ok.candidate.id, 4151);
  s.updateSettings({ members: false });
  assert.match(itemDetail(d, s, 4151, nowMs).reason, /Members/);
  s.updateSettings({ members: true });
  s.addTrade({ itemId: 4151, name: 'Abyssal whip', mode: 'fast', qty: 2, buyPrice: 1000, boughtAt: nowMs - 1000 });
  const held = itemDetail(d, s, 4151, nowMs);
  assert.equal(held.held[0].breakEven, 1020);
  assert.equal(held.limitUsed, 2);
  assert.throws(() => itemDetail(d, s, 999999, nowMs), /not in the price list/);
});
test('store survives a restart and refuses to oversell', () => {
  const dir = tmp();
  const s = new Store(dir);
  const t = s.addTrade({ itemId: 4151, name: 'Abyssal whip', mode: 'fast', qty: 5, buyPrice: 1000, expectedSell: 1100 });
  s.addSell(t.id, 3, 1100);
  assert.throws(() => s.addSell(t.id, 3, 1100), /Only 2 left/);
  assert.equal(new Store(dir).data.trades[0].sells.length, 1);
});
test('editing a trade changes it and rejects impossible numbers', () => {
  const s = new Store(tmp());
  const t = s.addTrade({ itemId: 1, name: 'Shark', mode: 'fast', qty: 10, buyPrice: 1000, expectedSell: 1100 });
  s.addSell(t.id, 4, 1100);
  const sells = s.data.trades[0].sells;
  s.updateTrade(t.id, { qty: 10, buyPrice: 950, expectedSell: null, sells });
  assert.equal(s.data.trades[0].buyPrice, 950);
  assert.equal(s.data.trades[0].expectedSell, null);
  assert.throws(() => s.updateTrade(t.id, { qty: 3, buyPrice: 950, expectedSell: null, sells }), /Sales add up to 4/);
  s.updateTrade(t.id, { qty: 10, buyPrice: 950, expectedSell: null, sells: [{ ...sells[0], qty: 0 }] });
  assert.equal(s.data.trades[0].sells.length, 0);
});
test('a corrupt save is kept to one side, not overwritten', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'planner-data.json'), '{oops');
  new Store(dir).save();
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.corrupt-')));
});
test('full view: logging a buy lowers the planned quantity', async () => {
  const dir = tmp();
  const d = new DataService({ cacheDir: dir, fetchImpl: fakeApi([]), pauseMs: 0 });
  await d.refreshLive(NOW); await d.refreshHours(NOW);
  const s = new Store(dir);
  const nowMs = NOW * 1000;
  assert.equal(buildView(d, s, nowMs).ranked[0].qty, 70);
  s.addTrade({ itemId: 4151, name: 'Abyssal whip', mode: 'fast', qty: 30, buyPrice: 1000, expectedSell: 1100, boughtAt: nowMs - 1000 });
  const v = buildView(d, s, nowMs);
  assert.equal(v.ranked[0].qty, 40);
  assert.equal(v.limits[0].used, 30);
  const open = v.stats.trades[0];
  assert.equal(open.breakEven, 1020);
  assert.equal(open.sellNow, 1089, 'tighter of latest and 5-minute average, less 1 gp');
  assert.equal(open.profitNow, 30 * (1089 - 21 - 1000));
  assert.equal(searchItems(d, 'whip')[0].id, 4151);
});
