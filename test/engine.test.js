'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { taxPerItem, netSell, breakEven } = require('../src-main/engine/tax');
const { scoreItem, evaluateItem, rankItems, sequenceHitRate, recoveryRate, percentile } = require('../src-main/engine/score');
const { buildPlan } = require('../src-main/engine/plan');
const { limitUsage, tradeStats, FOUR_HOURS } = require('../src-main/engine/trades');
const { NOW, hours, item } = require('./fixtures');
const base = { budget: 1e9, nowSec: NOW };

test('tax: 2% rounded down per item', () => {
  assert.equal(taxPerItem(1000), 20);
  assert.equal(taxPerItem(149), 2);   // 2.98 rounds down
  assert.equal(netSell(1000), 980);
});
test('tax: nothing below 50 gp', () => {
  assert.equal(taxPerItem(49), 0);
  assert.equal(taxPerItem(50), 1);
});
test('tax: capped at 5m per item, reached at 250m', () => {
  assert.equal(taxPerItem(249_999_950), 4_999_999);
  assert.equal(taxPerItem(250_000_000), 5_000_000);
  assert.equal(taxPerItem(3_000_000_000), 5_000_000);
});
test('tax: exempt items pay nothing', () => {
  assert.equal(taxPerItem(12_000_000, 'Old school bond'), 0);
  assert.equal(taxPerItem(200, 'Lobster'), 0);
  assert.equal(taxPerItem(500, 'Ardougne teleport (tablet)'), 0);
  assert.equal(taxPerItem(200, 'Shark'), 4);
});
test('percentile interpolates and skips nulls', () => {
  assert.equal(percentile([1, null, 3], 0.5), 2);
  assert.equal(percentile([], 0.5), null);
});

test('fast: margin is after tax and offers sit inside the spread', () => {
  const c = scoreItem(item(), 'fast', base);
  assert.equal(c.buy, 1001);
  assert.equal(c.sell, 1099);
  assert.equal(c.tax, 21);
  assert.equal(c.netMargin, 77);
});
test('quantity stops at the tightest of cash, limit and volume', () => {
  assert.equal(scoreItem(item({ limit: 50 }), 'fast', base).qty, 50);
  assert.equal(scoreItem(item({ limit: 50 }), 'fast', base).limitedBy, 'buy limit');
  assert.equal(scoreItem(item(), 'fast', { ...base, budget: 20_020 }).qty, 20);
  assert.equal(scoreItem(item(), 'fast', { ...base, budget: 20_020 }).limitedBy, 'cash');
  // 600/h × 10% capture × 4h = 240
  const v = scoreItem(item({ limit: 100000 }), 'fast', base);
  assert.equal(v.qty, 240);
  assert.equal(v.limitedBy, 'volume');
});
test('a margin wiped out by tax is dropped', () => {
  assert.equal(scoreItem(item({ low: 1000, high: 1015 }), 'fast', base), null);
});
test('buys logged this window reduce quantity; a used-up limit drops the item', () => {
  assert.equal(scoreItem(item({ limit: 200 }), 'fast', { ...base, limitUsed: 150 }).qty, 50);
  assert.equal(scoreItem(item({ limit: 200 }), 'fast', { ...base, limitUsed: 200 }), null);
});
test('a huge margin on a dead item loses to a small margin that trades', () => {
  const dead = item({ id: 1, name: 'Dead', low: 1_000_000, high: 1_200_000, hours: hours({ low: 1_000_000, high: 1_200_000, lowVol: 3, highVol: 3 }) });
  const live = item({ id: 2, name: 'Live', low: 1000, high: 1100, limit: 10000 });
  const ranked = rankItems([dead, live], 'fast', { cash: 1e9, nowSec: NOW });
  assert.equal(ranked[0].name, 'Live');
  assert.equal(ranked.length, 1, 'thin item is hidden by default');
  assert.equal(rankItems([dead], 'fast', { cash: 1e9, nowSec: NOW, showRisky: true })[0].risky, true);
});
test('flags: stale price', () => {
  const c = scoreItem(item({ time: NOW - 3600 }), 'fast', base);
  assert.ok(c.flags.some((f) => f.id === 'stale'));
  assert.ok(c.risky);
});
test('flags: spike above the 24h norm', () => {
  const c = scoreItem(item({ low: 1300, high: 1420, hours: hours({ low: 1000, high: 1100 }) }), 'fast', base);
  assert.ok(c.flags.some((f) => f.id === 'spike'));
});
test('flags: falling price and unusually wide margin', () => {
  const falling = item({ hours: hours({ low: 1000, high: 1100, f: (i) => (i >= 21 ? -0.1 : 0) }) });
  assert.ok(scoreItem(falling, 'fast', base).flags.some((f) => f.id === 'falling'));
  const wide = item({ low: 1000, high: 1060, hours: hours({ low: 1020, high: 1030 }) });
  assert.ok(scoreItem(wide, 'fast', base).flags.some((f) => f.id === 'wide'));
});
test('flags: lopsided trading', () => {
  const it = item({ hours: hours({ low: 1000, high: 1100, lowVol: 700, highVol: 50 }) });
  assert.ok(scoreItem(it, 'fast', base).flags.some((f) => f.id === 'lopsided'));
});
test('missing buy limit falls back to volume and warns', () => {
  const c = scoreItem(item({ limit: null }), 'fast', base);
  assert.equal(c.qty, 240);
  assert.ok(c.flags.some((f) => f.id === 'nolimit'));
});

test('sequence backtest requires the sell to follow the buy', () => {
  const b = (l, h) => ({ avgLowPrice: l, avgHighPrice: h });
  assert.equal(sequenceHitRate([b(90, 100), b(100, 120)], 95, 115, 2), 1);
  assert.equal(sequenceHitRate([b(100, 120), b(90, 100)], 95, 115, 2), 0);
});
test('overnight: buys under and sells over the current market when history supports it', () => {
  const wave = (i) => (i % 4 < 2 ? -0.03 : 0.03);
  const c = scoreItem(item({ hours: hours({ low: 1000, high: 1020, f: wave }), low: 1000, high: 1020 }), 'overnight', base);
  assert.ok(c.buy < 1001);
  assert.ok(c.sell > 1019);
  assert.ok(c.hitRate > 0.9);
});
test('recovery rate counts separate dips and whether each recovered', () => {
  const day = 86400;
  const p = (d, l, h) => ({ timestamp: d * day, avgLowPrice: l, avgHighPrice: h });
  const pts = [p(1, 90, 95), p(2, 100, 112), p(10, 90, 95), p(11, 95, 99), p(25, 100, 104)];
  assert.equal(recoveryRate(pts, 92, 110, 7), 0.5);
  assert.equal(recoveryRate([p(1, 90, 95)], 92, 110, 7), null);
});
test('long holds: needs a real discount to the 30-day norm', () => {
  const day = 86400;
  const baseline = Array.from({ length: 30 }, (_, i) => ({ timestamp: NOW - i * day, avgLowPrice: 1180, avgHighPrice: 1200 })).reverse();
  const flat = hours({ low: 1000, high: 1020 });
  const dip = scoreItem(item({ low: 1000, high: 1020, baseline, hours: flat }), 'long', base);
  assert.equal(dip.sell, 1199);
  const none = scoreItem(item({ low: 1180, high: 1200, baseline, hours: hours({ low: 1180, high: 1200 }) }), 'long', base);
  assert.equal(none, null);
});
test('long holds: your watchlist target replaces the 30-day norm', () => {
  const c = scoreItem(item({ low: 1000, high: 1020 }), 'long', { ...base, target: 2000 });
  assert.equal(c.sell, 2000);
  assert.equal(c.netMargin, 2000 - 40 - 1001);
});

test('plan: never overspends, caps each position, uses each item once', () => {
  const items = [1, 2, 3, 4, 5].map((id) => item({ id, name: `I${id}`, limit: 100000, low: 1000 + id, high: 1100 + id }));
  const p = buildPlan(items, 'fast', { cash: 500_000, slots: 8, maxExposure: 0.35, nowSec: NOW });
  assert.ok(p.cashUsed <= 500_000);
  assert.ok(p.slots.every((s) => s.cost <= 175_000));
  assert.equal(new Set(p.slots.map((s) => s.id)).size, p.slots.length);
  assert.equal(p.cashUsed + p.cashLeft, 500_000);
});
test('plan: respects the slot count and skips risky items', () => {
  const good = [1, 2, 3, 4].map((id) => item({ id, limit: 100000 }));
  const bad = item({ id: 9, low: 1000, high: 1300, time: NOW - 9000 });
  const p = buildPlan([bad, ...good], 'fast', { cash: 1e8, slots: 3, nowSec: NOW });
  assert.equal(p.slots.length, 3);
  assert.ok(!p.slots.some((s) => s.id === 9));
});
test('free-to-play accounts see no members items', () => {
  const p = buildPlan([item({ id: 1 }), item({ id: 2, members: false })], 'fast', { cash: 1e8, slots: 3, nowSec: NOW, members: false });
  assert.deepEqual(p.slots.map((s) => s.id), [2]);
});

test('limit window opens on first buy and resets four hours later', () => {
  const t0 = 1_000_000_000;
  const buys = [
    { itemId: 1, name: 'A', qty: 100, at: t0 },
    { itemId: 1, name: 'A', qty: 50, at: t0 + 3.9 * 3600000 },
  ];
  const u = limitUsage(buys, t0 + 3950000);
  assert.equal(u[1].used, 150);
  assert.equal(u[1].resetAt, t0 + FOUR_HOURS, 'a later buy does not extend the window');
  assert.equal(limitUsage(buys, t0 + FOUR_HOURS + 1)[1], undefined);
});
test('buy after the window starts a fresh one', () => {
  const t0 = 1_000_000_000;
  const u = limitUsage([
    { itemId: 1, name: 'A', qty: 100, at: t0 },
    { itemId: 1, name: 'A', qty: 7, at: t0 + FOUR_HOURS + 5 },
  ], t0 + FOUR_HOURS + 10);
  assert.equal(u[1].used, 7);
});
test('trade stats: realized uses tax per item and handles partial sells', () => {
  const s = tradeStats([{
    id: 'a', itemId: 1, name: 'Shark', mode: 'fast', qty: 100, buyPrice: 1000, expectedSell: 1100, boughtAt: 0,
    sells: [{ qty: 40, price: 1100, at: 3600000 }],
  }]);
  const t = s.trades[0];
  assert.equal(t.realized, 40 * (1100 - 22 - 1000));
  assert.equal(t.expected, 40 * 78);
  assert.equal(t.openQty, 60);
  assert.equal(s.openCost, 60000);
  assert.equal(s.byMode[0].wins, 1);
});

test('fast: a one-off trade cannot widen the margin past the 5-minute average', () => {
  const it = item({ low: 900, high: 1300 });
  it.m5 = { avgLowPrice: 1000, avgHighPrice: 1100, lowPriceVolume: 9, highPriceVolume: 9 };
  const c = scoreItem(it, 'fast', base);
  assert.equal(c.buy, 1001);
  assert.equal(c.sell, 1099);
});
test('overnight: hours with barely any trades do not set prices or win backtests', () => {
  const hrs = hours({ low: 1000, high: 1040 }).map((b, i) => (i % 3 ? b : { ...b, avgHighPrice: 3000, highPriceVolume: 1 }));
  const c = scoreItem(item({ low: 1000, high: 1040, hours: hrs }), 'overnight', base);
  assert.ok(c === null || c.sell < 1100);
});
test('overnight: an item that rarely trades both ways is risky', () => {
  const hrs = hours({ low: 1000, high: 1200 }).map((b, i) => (i % 2 ? b : { ...b, lowPriceVolume: 1, highPriceVolume: 1 }));
  const c = scoreItem(item({ low: 1000, high: 1200, hours: hrs }), 'overnight', base);
  assert.ok(c === null || c.flags.some((f) => f.id === 'patchy'));
});
test('long holds: a sustained fall is called out and gets less credit', () => {
  const day = 86400;
  const baseline = Array.from({ length: 30 }, (_, i) => ({
    timestamp: NOW - (30 - i) * day, avgLowPrice: i > 22 ? 1000 : 1280, avgHighPrice: i > 22 ? 1020 : 1300,
  }));
  const c = scoreItem(item({ low: 900, high: 1020, baseline }), 'long', base);
  assert.ok(c.flags.some((f) => f.id === 'downtrend' && f.severity === 'danger'));
  assert.ok(c.risky, 'a collapsed item is hidden by default');
  assert.ok(c.flags.some((f) => f.id === 'newlow'));
  assert.equal(c.hitRate, null);
  assert.ok(c.score <= c.profit * 0.25 * 0.7 * 0.7 + 1);
});

test('long holds: a moderate slide stays visible with a warning', () => {
  const day = 86400;
  const baseline = Array.from({ length: 30 }, (_, i) => ({
    timestamp: NOW - (30 - i) * day, avgLowPrice: i > 22 ? 1080 : 1180, avgHighPrice: i > 22 ? 1090 : 1200,
  }));
  const c = scoreItem(item({ low: 1000, high: 1020, baseline }), 'long', base);
  assert.ok(c.flags.some((f) => f.id === 'downtrend' && f.severity === 'warn'));
  assert.equal(c.risky, false);
});

test('break-even is the lowest sell price that returns your money after tax', () => {
  for (const buy of [40, 49, 50, 149, 1000, 1001, 156738, 300_000_000]) {
    const p = breakEven(buy);
    assert.ok(netSell(p) >= buy);
    assert.ok(netSell(p - 1) < buy);
  }
  assert.equal(breakEven(1000), 1020); // tax on 1,020 rounds down to 20
  assert.equal(breakEven(300_000_000), 305_000_000);
  assert.equal(breakEven(500, 'Lobster'), 500);
});

test('items that do not qualify say why', () => {
  const why = (it, opts = {}) => evaluateItem(it, 'fast', { ...base, ...opts }).reason;
  assert.match(why(item({ low: 1000, high: 1015 })), /cover tax/);
  assert.match(why(item({ limit: 10 }), { limitUsed: 10 }), /buy limit/);
  assert.match(why(item(), { budget: 500 }), /costs more/);
  assert.match(why(item({ hours: hours({ low: 1000, high: 1100, lowVol: 1, highVol: 1 }) })), /too rarely/);
  assert.match(evaluateItem(item(), 'long', base).reason, /30-day history/);
  const it = item(); it.latest.high = null;
  assert.match(why(it), /both sides/);
});
