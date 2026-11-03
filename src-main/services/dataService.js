'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://prices.runescape.wiki/api/v2/osrs';
const USER_AGENT = 'osrs-merch-planner/0.1 - personal desktop GE planning tool';
const HOUR = 3600;
const HOURS_KEPT = 24;
const SAMPLE_STEP = 12 * HOUR;
const SAMPLES_KEPT = 60; // Two a day for 30 days, covering every item in one request each.

const LOOKBACKS = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400, '6m': 182 * 86400 };
const HISTORY_MAX_AGE = 5 * 60;
const covered = (pts) => (pts.length > 1 ? pts[pts.length - 1].timestamp - pts[0].timestamp : 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DataService {
  constructor({ cacheDir, baseUrl = BASE, fetchImpl = fetch, pauseMs = 250 }) {
    this.file = path.join(cacheDir, 'price-cache.json');
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.pauseMs = pauseMs;
    this.mapping = [];
    this.mappingAt = 0;
    this.latest = {};
    this.m5 = {};
    this.hours = {}; // start timestamp -> { itemId: bucket }
    this.samples = {}; // start timestamp -> { itemId: [low, high] }
    this.baselineCache = null;
    this.status = { lastUpdate: null, lastError: null, hoursLoaded: 0, baselineLoaded: 0 };
    this.baselineRunning = false;
    this.historyCache = new Map();
  }

  load() {
    try {
      const c = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      Object.assign(this, { mapping: c.mapping || [], mappingAt: c.mappingAt || 0, hours: c.hours || {}, samples: c.samples || {} });
    } catch { /* no cache yet, or an unreadable one: start again from the API */ }
    this.status.hoursLoaded = Object.keys(this.hours).length;
    this.status.baselineLoaded = Object.keys(this.samples).length;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ mapping: this.mapping, mappingAt: this.mappingAt, hours: this.hours, samples: this.samples }));
    fs.renameSync(tmp, this.file);
  }

  async get(route) {
    const res = await this.fetch(`${this.baseUrl}${route}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Price server answered ${res.status} for ${route.split('?')[0]}`);
    return res.json();
  }

  async track(fn) {
    try {
      const out = await fn();
      this.status.lastError = null;
      return out;
    } catch (e) {
      this.status.lastError = e.message;
      return null;
    }
  }

  async refreshMapping(nowSec) {
    if (this.mapping.length && nowSec - this.mappingAt < 24 * HOUR) return;
    const m = await this.get('/mapping');
    if (Array.isArray(m) && m.length) { this.mapping = m; this.mappingAt = nowSec; }
  }

  // The quick refresh: all items in one request each, which is what the Wiki asks for.
  async refreshLive(nowSec = Math.floor(Date.now() / 1000)) {
    return this.track(async () => {
      await this.refreshMapping(nowSec);
      const [latest, m5] = await Promise.all([this.get('/latest'), this.get('/5m')]);
      this.latest = latest.data || {};
      this.m5 = m5.data || {};
      this.status.lastUpdate = nowSec;
      return true;
    });
  }

  async refreshHours(nowSec = Math.floor(Date.now() / 1000)) {
    const current = Math.floor(nowSec / HOUR) * HOUR;
    const wanted = Array.from({ length: HOURS_KEPT }, (_, i) => current - HOUR * (i + 1));
    return this.track(async () => {
      for (const ts of wanted) {
        if (this.hours[ts]) continue;
        const res = await this.get(`/1h?timestamp=${ts}`);
        this.hours[ts] = res.data || {};
        this.status.hoursLoaded = Object.keys(this.hours).length;
        await sleep(this.pauseMs);
      }
      const keep = new Set(wanted.map(String));
      for (const k of Object.keys(this.hours)) if (!keep.has(k)) delete this.hours[k];
      this.status.hoursLoaded = Object.keys(this.hours).length;
      this.save();
      return true;
    });
  }

  // Long holds compare every item to its own 30 days.
  async refreshBaselines(nowSec = Math.floor(Date.now() / 1000)) {
    if (this.baselineRunning) return;
    this.baselineRunning = true;
    const current = Math.floor(nowSec / SAMPLE_STEP) * SAMPLE_STEP;
    const wanted = Array.from({ length: SAMPLES_KEPT }, (_, i) => current - SAMPLE_STEP * (i + 1));
    await this.track(async () => {
      let fetched = 0;
      for (const ts of wanted) {
        if (this.samples[ts]) continue;
        const res = await this.get(`/1h?timestamp=${ts}`);
        const compact = {};
        for (const [id, b] of Object.entries(res.data || {})) compact[id] = [b.avgLowPrice ?? null, b.avgHighPrice ?? null];
        this.samples[ts] = compact;
        this.status.baselineLoaded = Object.keys(this.samples).length;
        this.baselineCache = null;
        if (++fetched % 10 === 0) this.save();
        await sleep(this.pauseMs);
      }
      const keep = new Set(wanted.map(String));
      for (const k of Object.keys(this.samples)) if (!keep.has(k)) delete this.samples[k];
      this.status.baselineLoaded = Object.keys(this.samples).length;
      this.baselineCache = null;
      this.save();
    });
    this.baselineRunning = false;
  }

  baselineFor() {
    if (this.baselineCache) return this.baselineCache;
    const byItem = {};
    for (const ts of Object.keys(this.samples).map(Number).sort((a, b) => a - b)) {
      for (const [id, [low, high]] of Object.entries(this.samples[ts])) {
        (byItem[id] ||= []).push({ timestamp: ts, avgLowPrice: low, avgHighPrice: high });
      }
    }
    this.baselineCache = byItem;
    return byItem;
  }

  // The app's own stored prices, used when the API returns less than the range asked for.
  localHistory(id, lookback, nowSec) {
    const start = nowSec - LOOKBACKS[lookback];
    const pts = new Map();
    if (lookback !== '24h') {
      for (const p of this.baselineFor()[id] || []) {
        if (p.timestamp >= start) pts.set(p.timestamp, { ...p, highPriceVolume: null, lowPriceVolume: null });
      }
    }
    for (const [ts, hour] of Object.entries(this.hours)) {
      const b = hour[id];
      if (b && Number(ts) >= start) pts.set(Number(ts), { timestamp: Number(ts), ...b });
    }
    return [...pts.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  // Chart data for one item, fetched only when you open that item.
  async history(id, lookback, nowSec = Math.floor(Date.now() / 1000)) {
    const wanted = LOOKBACKS[lookback];
    if (!wanted) throw new Error(`Unknown chart range ${lookback}`);
    const key = `${id}:${lookback}`;
    const hit = this.historyCache.get(key);
    if (hit && nowSec - hit.at < HISTORY_MAX_AGE) return hit.value;

    let points = [], failure = null;
    try {
      const res = await this.get(`/timeseries?id=${Number(id)}&lookback=${lookback}`);
      points = [...(res.data || [])].sort((a, b) => a.timestamp - b.timestamp);
    } catch (e) { failure = e; }

    let source = 'api';
    const local = this.localHistory(id, lookback, nowSec);
    if (covered(points) < wanted * 0.5 && covered(local) > covered(points)) {
      points = local;
      source = 'stored';
    }
    if (!points.length && failure) throw failure;
    const value = { id, lookback, points, source, partial: covered(points) < wanted * 0.5 };
    if (!failure) this.historyCache.set(key, { at: nowSec, value });
    return value;
  }

  // Joins everything the scoring engine reads into one record per item.
  items() {
    const stamps = Object.keys(this.hours).map(Number).sort((a, b) => a - b);
    const baselines = this.baselineFor();
    const out = [];
    for (const m of this.mapping) {
      const latest = this.latest[m.id];
      if (!latest) continue;
      out.push({
        id: m.id, name: m.name, icon: m.icon, members: m.members, limit: m.limit ?? null,
        latest, m5: this.m5[m.id] || null,
        hours: stamps.map((t) => this.hours[t][m.id] || null),
        baseline: baselines[m.id] || [],
      });
    }
    return out;
  }
}

module.exports = { DataService, BASE, USER_AGENT, LOOKBACKS };
