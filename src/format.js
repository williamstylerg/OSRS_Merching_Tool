'use strict';
// In-game coin stack rules: yellow under 100K, white in K up to 10M, green in M above that.
window.fmt = {
  exact: (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US')),
  stack(n) {
    if (n == null) return { text: '–', cls: '' };
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a < 100_000) return { text: sign + Math.round(a).toLocaleString('en-US'), cls: 'stack-yellow' };
    if (a < 10_000_000) return { text: `${sign}${Math.floor(a / 1000).toLocaleString('en-US')}K`, cls: 'stack-white' };
    if (a < 1e10) return { text: `${sign}${(Math.floor(a / 1e5) / 10).toLocaleString('en-US')}M`, cls: 'stack-green' };
    return { text: `${sign}${(Math.floor(a / 1e8) / 10).toLocaleString('en-US')}B`, cls: 'stack-green' };
  },
  gp(n) {
    const s = window.fmt.stack(n);
    return `<span class="${s.cls}" title="${window.fmt.exact(n)} gp">${s.text}</span>`;
  },
  // Accepts 500k, 2.5m, 1b, or plain numbers with commas.
  parseAmount(v) {
    const m = String(v).trim().toLowerCase().replace(/[, _]/g, '').match(/^(\d*\.?\d+)([kmb]?)$/);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]]);
  },
  pct: (n, d = 1) => (n == null ? '–' : `${(n * 100).toFixed(d)}%`),
  hours(h) {
    if (h == null) return '–';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
    return `${Math.round(h / 24)} days`;
  },
  ago(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
  },
  countdown(ms) {
    const m = Math.max(0, Math.ceil(ms / 60000));
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  },
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  icon(name) {
    if (!name) return '<span class="noicon"></span>';
    return `<img alt="" loading="lazy" src="https://oldschool.runescape.wiki/images/${encodeURIComponent(name.replace(/ /g, '_'))}">`;
  },
};
