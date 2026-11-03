'use strict';
// Made-up market data for tests only. The shapes match the Wiki v2 API responses.
const HOUR = 3600;
const NOW = 1_800_000_000;
function hours({ low, high, lowVol = 600, highVol = 600, n = 24, f = () => 0 }) {
  return Array.from({ length: n }, (_, i) => ({
    avgLowPrice: low * (1 + f(i)), avgHighPrice: high * (1 + f(i)),
    lowPriceVolume: lowVol, highPriceVolume: highVol,
  }));
}
function item(over = {}) {
  const low = over.low ?? 1000, high = over.high ?? 1100;
  return {
    id: over.id ?? 1, name: over.name ?? 'Test item', icon: 'x.png', members: over.members ?? true,
    limit: over.limit === undefined ? 1000 : over.limit,
    latest: { low, high, lowTime: over.time ?? NOW - 60, highTime: over.time ?? NOW - 60 },
    m5: null, hours: over.hours ?? hours({ low, high }), baseline: over.baseline ?? [],
  };
}
module.exports = { HOUR, NOW, hours, item };
