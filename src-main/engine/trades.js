'use strict';
const { netSell } = require('./tax');
const FOUR_HOURS = 4 * 3600 * 1000;

function tradeSummary(t) {
  const soldQty = t.sells.reduce((n, s) => n + s.qty, 0);
  const proceeds = t.sells.reduce((n, s) => n + s.qty * netSell(s.price, t.name), 0);
  const realized = proceeds - soldQty * t.buyPrice;
  const expected = t.expectedSell == null ? null : soldQty * (netSell(t.expectedSell, t.name) - t.buyPrice);
  const lastSell = t.sells.length ? Math.max(...t.sells.map((s) => s.at)) : null;
  return {
    ...t, soldQty, openQty: t.qty - soldQty, realized, expected,
    closed: soldQty >= t.qty,
    hoursHeld: lastSell ? (lastSell - t.boughtAt) / 3600000 : null,
  };
}

function group(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const g = map.get(k) || { key: k, label: labelFn(r), trades: 0, wins: 0, realized: 0, expected: 0, comparable: 0, comparableRealized: 0 };
    g.trades++;
    if (r.realized > 0) g.wins++;
    g.realized += r.realized;
    if (r.expected !== null) { g.expected += r.expected; g.comparable++; g.comparableRealized += r.realized; }
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.realized - a.realized);
}

function tradeStats(trades) {
  const all = trades.map(tradeSummary);
  const sold = all.filter((t) => t.soldQty > 0);
  return {
    trades: all.sort((a, b) => b.boughtAt - a.boughtAt),
    realized: sold.reduce((n, t) => n + t.realized, 0),
    expected: sold.reduce((n, t) => n + (t.expected ?? 0), 0),
    comparableRealized: sold.filter((t) => t.expected !== null).reduce((n, t) => n + t.realized, 0),
    openCost: all.reduce((n, t) => n + t.openQty * t.buyPrice, 0),
    byMode: group(sold, (t) => t.mode, (t) => t.mode),
    byItem: group(sold, (t) => t.itemId, (t) => t.name),
  };
}

// The limit window opens on the first buy and resets four hours later, however
// many more you buy inside it. Logged buys and limit-only buys both count.
function limitUsage(buys, nowMs) {
  const byItem = new Map();
  [...buys].sort((a, b) => a.at - b.at).forEach((b) => {
    const cur = byItem.get(b.itemId);
    if (cur && b.at < cur.startedAt + FOUR_HOURS) cur.used += b.qty;
    else byItem.set(b.itemId, { itemId: b.itemId, name: b.name, used: b.qty, startedAt: b.at });
  });
  const out = {};
  for (const [id, w] of byItem) {
    const resetAt = w.startedAt + FOUR_HOURS;
    if (resetAt > nowMs) out[id] = { ...w, resetAt };
  }
  return out;
}

module.exports = { tradeSummary, tradeStats, limitUsage, FOUR_HOURS };
