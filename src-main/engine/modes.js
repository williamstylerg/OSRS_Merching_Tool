'use strict';
// One scoring engine, three sets of assumptions.
// captureShare: the portion of market volume one player can realistically expect to fill.
const MODES = {
  fast: {
    id: 'fast', label: 'Fast flips',
    summary: 'Buy and sell inside the current margin, then repeat.',
    fillHours: 4, captureShare: 0.10, staleMinutes: 20, minHourlyVolume: 30, spikePct: 0.06, bigMargin: 0.06,
  },
  overnight: {
    id: 'overnight', label: 'Overnight offers',
    summary: 'Patient offers at the edges of the daily range.',
    fillHours: 8, captureShare: 0.15, staleMinutes: 180, minHourlyVolume: 8, spikePct: 0.10, bigMargin: 0.20,
  },
  long: {
    id: 'long', label: 'Long holds',
    summary: 'Items below their 30-day norm, plus your own speculation picks.',
    fillHours: 8, captureShare: 0.25, staleMinutes: 1440, minHourlyVolume: 1, spikePct: 0.20,
    holdDays: 7, minDiscount: 0.05,
  },
};
module.exports = { MODES };
