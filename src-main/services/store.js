'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = { mode: 'fast', cash: 10_000_000, slots: 8, members: true, maxExposure: 0.35, showRisky: false };

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'planner-data.json');
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      // Keep an unreadable file instead of overwriting someone's trade history.
      if (e.code !== 'ENOENT') fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
    }
    this.data = { trades: [], limitBuys: [], watchlist: [], ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } };
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  updateSettings(patch) { Object.assign(this.data.settings, patch); this.save(); }
  addTrade(t) {
    const trade = { id: crypto.randomUUID(), boughtAt: Date.now(), sells: [], ...t };
    this.data.trades.push(trade); this.save(); return trade;
  }
  addSell(tradeId, qty, price) {
    const t = this.data.trades.find((x) => x.id === tradeId);
    if (!t) throw new Error('That trade no longer exists');
    const open = t.qty - t.sells.reduce((n, s) => n + s.qty, 0);
    if (qty > open) throw new Error(`Only ${open} left to sell on this trade`);
    t.sells.push({ qty, price, at: Date.now() }); this.save();
  }
  updateTrade(id, { qty, buyPrice, expectedSell, sells }) {
    const t = this.data.trades.find((x) => x.id === id);
    if (!t) throw new Error('That trade no longer exists');
    const kept = sells.filter((s) => s.qty > 0);
    const sold = kept.reduce((n, s) => n + s.qty, 0);
    if (sold > qty) throw new Error(`Sales add up to ${sold}, but the trade only has ${qty} items`);
    Object.assign(t, { qty, buyPrice, expectedSell, sells: kept });
    this.save();
  }
  deleteTrade(id) { this.data.trades = this.data.trades.filter((t) => t.id !== id); this.save(); }
  addLimitBuy(b) { this.data.limitBuys.push({ at: Date.now(), ...b }); this.save(); }
  setWatch(itemId, name, target) {
    this.data.watchlist = this.data.watchlist.filter((w) => w.itemId !== itemId);
    if (target !== null) this.data.watchlist.push({ itemId, name, target });
    this.save();
  }
  allBuys() {
    return [
      ...this.data.trades.map((t) => ({ itemId: t.itemId, name: t.name, qty: t.qty, at: t.boughtAt })),
      ...this.data.limitBuys,
    ];
  }
}
module.exports = { Store };
