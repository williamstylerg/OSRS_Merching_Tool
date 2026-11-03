'use strict';
const { scoreItem } = require('./score');

// Fills slots one at a time, re-sizing every candidate against the cash that is still free.
function buildPlan(items, modeId, opts) {
  const { cash, slots, maxExposure = 0.35, nowSec, members = true, limitUsage = {}, targets = {} } = opts;
  const pool = items.filter((it) => members || !it.members);
  const positionCap = cash * maxExposure;
  const chosen = [];
  const used = new Set();
  let remaining = cash;

  for (let i = 0; i < slots && remaining > 0; i++) {
    let best = null;
    for (const it of pool) {
      if (used.has(it.id)) continue;
      const c = scoreItem(it, modeId, {
        budget: Math.min(positionCap, remaining), nowSec,
        limitUsed: limitUsage[it.id]?.used || 0, target: targets[it.id] || null,
      });
      if (c && !c.risky && (!best || c.score > best.score)) best = c;
    }
    if (!best) break;
    chosen.push(best);
    used.add(best.id);
    remaining -= best.cost;
  }
  return {
    slots: chosen, slotCount: slots,
    cashUsed: cash - remaining, cashLeft: remaining,
    profit: chosen.reduce((t, c) => t + c.profit, 0),
    adjustedProfit: chosen.reduce((t, c) => t + c.score, 0),
  };
}
module.exports = { buildPlan };
