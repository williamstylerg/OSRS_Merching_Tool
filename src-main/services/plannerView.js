'use strict';
const { rankItems, evaluateItem } = require('../engine/score');
const { buildPlan } = require('../engine/plan');
const { tradeStats, limitUsage } = require('../engine/trades');
const { MODES } = require('../engine/modes');
const { breakEven, netSell } = require('../engine/tax');

// Sell guidance for a trade comes from the item's own prices, so it stays
// available after the item drops off the ranked list.
function withMarket(trade, item) {
  const { latest, m5 } = item || {};
  const avgHigh = m5?.avgHighPrice;
  const high = latest?.high == null ? null : avgHigh == null ? latest.high : Math.min(latest.high, Math.round(avgHigh));
  const sellNow = high == null ? null : high - 1;
  return {
    ...trade,
    breakEven: breakEven(trade.buyPrice, trade.name),
    sellNow,
    profitNow: sellNow == null ? null : trade.openQty * (netSell(sellNow, trade.name) - trade.buyPrice),
  };
}

// Everything the interface draws comes from this one function.
function buildView(data, store, nowMs = Date.now()) {
  const { settings, watchlist, trades } = store.data;
  const nowSec = Math.floor(nowMs / 1000);
  const usage = limitUsage(store.allBuys(), nowMs);
  const items = data.items();
  const targets = Object.fromEntries(watchlist.map((w) => [w.itemId, w.target]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const stats = tradeStats(trades);
  stats.trades = stats.trades.map((t) => withMarket(t, byId.get(t.itemId)));
  const slots = settings.members ? settings.slots : Math.min(settings.slots, 3);
  const opts = { cash: settings.cash, maxExposure: settings.maxExposure, nowSec, members: settings.members, limitUsage: usage, targets };
  return {
    settings, watchlist,
    modes: Object.values(MODES).map(({ id, label, summary }) => ({ id, label, summary })),
    status: { ...data.status, itemCount: items.length },
    ranked: rankItems(items, settings.mode, { ...opts, showRisky: settings.showRisky }).slice(0, 100),
    plan: buildPlan(items, settings.mode, { ...opts, slots }),
    limits: Object.values(usage).sort((a, b) => a.resetAt - b.resetAt).map((u) => ({
      ...u, limit: items.find((i) => i.id === u.itemId)?.limit ?? null,
    })),
    stats,
    now: nowMs,
  };
}

function searchItems(data, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const rank = (name) => (name.toLowerCase().startsWith(q) ? 0 : 1);
  return data.mapping.filter((m) => m.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((m) => ({ id: m.id, name: m.name, icon: m.icon, limit: m.limit ?? null, latest: data.latest[m.id] || null }));
}

// Everything the item window shows, for any item, ranked or not.
function itemDetail(data, store, id, nowMs = Date.now()) {
  const { settings, watchlist } = store.data;
  const m = data.mapping.find((x) => x.id === id);
  if (!m) throw new Error('That item is not in the price list yet');
  const item = data.items().find((x) => x.id === id);
  const usage = limitUsage(store.allBuys(), nowMs);
  const target = watchlist.find((w) => w.itemId === id)?.target || null;
  const stats = tradeStats(store.data.trades);
  const held = stats.trades.filter((t) => t.itemId === id && !t.closed).map((t) => withMarket(t, item));
  const base = {
    id, name: m.name, icon: m.icon, members: m.members, limit: m.limit ?? null,
    latest: item?.latest || null, mode: settings.mode, held, target,
    limitUsed: usage[id]?.used || 0, limitResetAt: usage[id]?.resetAt || null,
  };
  if (!item) return { ...base, candidate: null, reason: "It hasn't traded recently" };
  const { candidate, reason } = evaluateItem(item, settings.mode, {
    budget: settings.cash * settings.maxExposure, nowSec: Math.floor(nowMs / 1000),
    limitUsed: usage[id]?.used || 0, target,
  });
  let why = reason || null;
  if (!settings.members && m.members) why = 'Members is switched off';
  else if (candidate?.risky && !settings.showRisky) why = 'It is hidden as risky';
  return { ...base, candidate: candidate || null, reason: why };
}

module.exports = { buildView, searchItems, itemDetail };
