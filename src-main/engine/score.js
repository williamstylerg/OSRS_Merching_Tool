'use strict';
const { netSell, taxPerItem } = require('./tax');
const { MODES } = require('./modes');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function percentile(values, p) {
  const s = values.filter((v) => num(v) !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const median = (v) => percentile(v, 0.5);
const MIN_BUCKET_TRADES = 3;
// An hourly average built on one or two trades says little, so those hours don't count.
const tradedBucket = (b) => num(b?.avgLowPrice) !== null && num(b?.avgHighPrice) !== null
  && (b.lowPriceVolume ?? MIN_BUCKET_TRADES) >= MIN_BUCKET_TRADES
  && (b.highPriceVolume ?? MIN_BUCKET_TRADES) >= MIN_BUCKET_TRADES;
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

// Hourly trade rates. Your buy offers fill from instant-sells (low side);
// your sell offers fill from instant-buys (high side).
function rates(item) {
  const hours = item.hours || [];
  if (hours.length) {
    return {
      low: hours.reduce((t, b) => t + (b?.lowPriceVolume || 0), 0) / hours.length,
      high: hours.reduce((t, b) => t + (b?.highPriceVolume || 0), 0) / hours.length,
    };
  }
  return { low: item.h1?.lowPriceVolume || 0, high: item.h1?.highPriceVolume || 0 };
}

// Walks past days of hourly data: within each window, did a buy fill and then a sell?
function sequenceHitRate(hours, buy, sell, windowLen) {
  const valid = hours.filter(tradedBucket);
  if (valid.length < windowLen) return null;
  let wins = 0, total = 0;
  for (let i = 0; i + windowLen <= valid.length; i++) {
    total++;
    const win = valid.slice(i, i + windowLen);
    const first = win.findIndex((b) => b.avgLowPrice <= buy);
    if (first >= 0 && win.slice(first).some((b) => b.avgHighPrice >= sell)) wins++;
  }
  return wins / total;
}

// Of past moments at or under this price, how many climbed back to the target within the hold period?
function recoveryRate(baseline, buy, sell, holdDays) {
  const pts = (baseline || []).filter((p) => num(p.avgLowPrice) !== null || num(p.avgHighPrice) !== null);
  const dips = [];
  let lastDip = -Infinity;
  pts.forEach((p, i) => {
    // Count separate dips, rather than every data point in one long dip.
    if (num(p.avgLowPrice) !== null && p.avgLowPrice <= buy) {
      if (p.timestamp - lastDip > 86400) dips.push(i);
      lastDip = p.timestamp;
    }
  });
  if (dips.length < 2) return null;
  const recovered = dips.filter((i) => pts.slice(i).some((p) =>
    p.timestamp <= pts[i].timestamp + holdDays * 86400 && num(p.avgHighPrice) !== null && p.avgHighPrice >= sell)).length;
  return recovered / dips.length;
}

function pricesFor(item, mode, target) {
  const { latest } = item;
  if (num(latest?.low) === null || num(latest?.high) === null) return null;
  if (mode.id === 'fast') {
    // The latest price can be a single odd trade, so take the tighter of it and the 5-minute average.
    const { m5 } = item;
    const low = num(m5?.avgLowPrice) !== null ? Math.max(latest.low, Math.round(m5.avgLowPrice)) : latest.low;
    const high = num(m5?.avgHighPrice) !== null ? Math.min(latest.high, Math.round(m5.avgHighPrice)) : latest.high;
    return { buy: low + 1, sell: high - 1 };
  }
  if (mode.id === 'overnight') {
    const traded = (item.hours || []).filter(tradedBucket);
    const lows = traded.map((b) => b.avgLowPrice);
    const highs = traded.map((b) => b.avgHighPrice);
    const p30 = percentile(lows, 0.3), p70 = percentile(highs, 0.7);
    if (p30 === null || p70 === null) return null;
    return { buy: Math.min(Math.round(p30) + 1, latest.low + 1), sell: Math.round(p70) - 1 };
  }
  const norm = median((item.baseline || []).map((p) => p.avgHighPrice));
  const sell = target ? target : norm === null ? null : Math.round(norm) - 1;
  return sell === null ? null : { buy: latest.low + 1, sell };
}

function detectFlags(item, mode, ctx) {
  const { nowSec, buy, r, limit, target } = ctx;
  const flags = [];
  const add = (id, severity, text) => flags.push({ id, severity, text });
  const { latest } = item;
  const ageMin = (nowSec - Math.min(latest.highTime || 0, latest.lowTime || 0)) / 60;
  const hours = item.hours || [];
  const roi = (ctx.sell - buy) / buy;

  if (mode.bigMargin && roi > mode.bigMargin) {
    add('bigmargin', 'warn', `A ${(roi * 100).toFixed(0)}% margin is unusually large, so check it in-game first`);
  }
  if (mode.id !== 'long' && hours.length >= 12) {
    const active = hours.filter(tradedBucket).length;
    if (active < hours.length * 0.75) {
      add('patchy', mode.id === 'overnight' ? 'danger' : 'warn', `Traded both ways in only ${active} of the last ${hours.length} hours`);
    }
  }
  if (ageMin > mode.staleMinutes) {
    add('stale', 'danger', `Last trade on one side was ${ageMin >= 120 ? `${Math.round(ageMin / 60)}h` : `${Math.round(ageMin)}m`} ago`);
  }
  if (Math.min(r.low, r.high) < mode.minHourlyVolume) {
    add('thin', 'danger', `Only about ${Math.round(Math.min(r.low, r.high))} trades an hour on the slower side`);
  }
  if (limit === null) add('nolimit', 'warn', 'Buy limit unknown, so quantity comes from volume only');

  const mids = hours.map((b) => (num(b?.avgLowPrice) !== null && num(b?.avgHighPrice) !== null
    ? (b.avgLowPrice + b.avgHighPrice) / 2 : null)).filter((v) => v !== null);
  if (mids.length < 6) {
    add('lowdata', 'warn', 'Less than six hours of price history');
  } else {
    const mid24 = median(mids);
    const now = (latest.high + latest.low) / 2;
    const move = (now - mid24) / mid24;
    if (move > mode.spikePct) add('spike', 'danger', `Trading ${(move * 100).toFixed(1)}% above its 24-hour norm`);
    else if (move < -mode.spikePct && mode.id !== 'long') add('crash', 'warn', `Trading ${(-move * 100).toFixed(1)}% below its 24-hour norm`);

    const recent = mean(mids.slice(-3)), prior = mean(mids.slice(-6, -3));
    const trend = (recent - prior) / prior;
    if (trend < -0.04) add('falling', mode.id === 'long' ? 'danger' : 'warn', `Down ${(-trend * 100).toFixed(1)}% over the last few hours`);

    const spreads = hours.filter((b) => num(b?.avgLowPrice) !== null && num(b?.avgHighPrice) !== null)
      .map((b) => (b.avgHighPrice - b.avgLowPrice) / b.avgLowPrice);
    const usual = median(spreads);
    const spread = (latest.high - latest.low) / latest.low;
    if (mode.id === 'fast' && spread > 0.02 && usual !== null && spread > usual * 3) {
      add('wide', 'warn', `Margin is ${(spread * 100).toFixed(1)}%, against a usual ${(usual * 100).toFixed(1)}%`);
    }
  }
  const skew = Math.max(r.low, r.high) / Math.max(1, Math.min(r.low, r.high));
  if (skew > 6) add('lopsided', 'warn', `${r.low > r.high ? 'Sellers' : 'Buyers'} outnumber the other side ${skew.toFixed(0)} to 1`);
  if (mode.id === 'long' && !target && (item.baseline || []).length) {
    const floor = Math.min(...item.baseline.map((p) => p.avgLowPrice).filter((v) => num(v) !== null));
    if (buy < floor) add('newlow', 'warn', 'Below its entire 30-day range');
    const pts = item.baseline.filter((p) => num(p.avgHighPrice) !== null);
    const lastWeekStart = nowSec - 7 * 86400;
    const recent = median(pts.filter((p) => p.timestamp >= lastWeekStart).map((p) => p.avgHighPrice));
    const before = median(pts.filter((p) => p.timestamp < lastWeekStart).map((p) => p.avgHighPrice));
    if (recent !== null && before !== null && recent < before * 0.92) {
      const drop = 1 - recent / before;
      // A big, lasting drop usually means the item was repriced, so it isn't treated as a bargain.
      add('downtrend', drop >= 0.2 ? 'danger' : 'warn', `Down ${(drop * 100).toFixed(0)}% for a week or more, so the old price may not return`);
    }
  }
  return flags;
}

const FLAG_FACTOR = { warn: 0.7, danger: 0.3 };

// budget is the most gp allowed in this one position.
// Returns { candidate } when the item qualifies, or { reason } saying why it doesn't.
function evaluateItem(item, modeId, { budget, nowSec, limitUsed = 0, target = null }) {
  const mode = MODES[modeId];
  const p = pricesFor(item, mode, target);
  if (!p || p.buy <= 0) {
    if (num(item.latest?.low) === null || num(item.latest?.high) === null) return { reason: "It hasn't traded on both sides recently" };
    return { reason: mode.id === 'long' ? 'There is not enough 30-day history yet' : 'There is not enough recent trading to set prices' };
  }
  const { buy, sell } = p;
  const tax = taxPerItem(sell, item.name);
  const netMargin = netSell(sell, item.name) - buy;
  if (netMargin <= 0) return { reason: "The margin doesn't cover tax at these prices" };
  if (mode.id === 'long' && !target && (sell - buy) / sell < mode.minDiscount) return { reason: 'It is less than 5% below its 30-day norm' };

  const limit = num(item.limit);
  const limitLeft = limit === null ? Infinity : Math.max(0, limit - limitUsed);
  if (limitLeft === 0) return { reason: "You've used your buy limit for this window" };

  const r = rates(item);
  // Long holds sell over days, so only the buy side has to fill within the window.
  const slowRate = mode.id === 'long' ? r.low : Math.min(r.low, r.high);
  const volumeCap = slowRate * mode.captureShare * mode.fillHours;
  const qty = Math.floor(Math.min(limitLeft, volumeCap, budget / buy));
  if (qty < 1) {
    return { reason: budget / buy < 1 ? 'One costs more than your cash limit per item' : 'It trades too rarely to expect a fill in this window' };
  }

  let hitRate;
  if (mode.id === 'fast') {
    const usable = (item.hours || []).filter((b) => num(b?.avgLowPrice) !== null && num(b?.avgHighPrice) !== null);
    hitRate = usable.length
      ? usable.filter((b) => netSell(b.avgHighPrice, item.name) - b.avgLowPrice > 0).length / usable.length
      : null;
  } else if (mode.id === 'overnight') {
    hitRate = sequenceHitRate(item.hours || [], buy, sell, mode.fillHours);
  } else {
    hitRate = recoveryRate(item.baseline, buy, sell, mode.holdDays);
  }
  // With no past recoveries to point to, a long hold gets less benefit of the doubt.
  const hitUsed = hitRate === null ? (mode.id === 'long' ? 0.25 : 0.5) : hitRate;

  const flags = detectFlags(item, mode, { nowSec, buy, sell, r, limit, target });
  const flagFactor = flags.reduce((f, x) => f * FLAG_FACTOR[x.severity], 1);
  const profit = qty * netMargin;
  const hoursToFill = qty / (slowRate * mode.captureShare);

  return { candidate: {
    id: item.id, name: item.name, icon: item.icon, members: item.members, mode: modeId,
    buy, sell, tax, netMargin, qty, cost: qty * buy, profit,
    roi: netMargin / buy, limit, limitLeft: limit === null ? null : limitLeft,
    hourlyLow: r.low, hourlyHigh: r.high, hoursToFill,
    hitRate, flags, flagFactor,
    limitedBy: qty === Math.floor(limitLeft) ? 'buy limit' : qty === Math.floor(volumeCap) ? 'volume' : 'cash',
    score: profit * hitUsed * flagFactor,
    target: target || null,
    risky: flags.some((f) => f.severity === 'danger'),
  } };
}

const scoreItem = (item, modeId, opts) => evaluateItem(item, modeId, opts).candidate || null;

function rankItems(items, modeId, opts) {
  const { cash, maxExposure = 0.35, nowSec, members = true, limitUsage = {}, targets = {}, showRisky = false } = opts;
  const budget = cash * maxExposure;
  return items
    .filter((it) => members || !it.members)
    .map((it) => scoreItem(it, modeId, {
      budget, nowSec, limitUsed: limitUsage[it.id]?.used || 0, target: targets[it.id] || null,
    }))
    .filter((c) => c && (showRisky || !c.risky))
    .sort((a, b) => b.score - a.score);
}

module.exports = { rankItems, scoreItem, evaluateItem, rates, percentile, median, sequenceHitRate, recoveryRate, FLAG_FACTOR };
