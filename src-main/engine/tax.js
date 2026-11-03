'use strict';
// Rules from the OSRS Wiki Grand Exchange page, checked 2 Nov 2026.
const TAX_RATE = 0.02;
const TAX_CAP = 5_000_000;
const NO_TAX_BELOW = 50;

const EXEMPT_NAMES = new Set([
  'Old school bond',
  'Energy potion(1)', 'Energy potion(2)', 'Energy potion(3)', 'Energy potion(4)',
  'Bronze arrow', 'Iron arrow', 'Steel arrow', 'Bronze dart', 'Iron dart', 'Steel dart', 'Mind rune',
  'Bass', 'Bread', 'Cake', 'Cooked chicken', 'Cooked meat', 'Herring', 'Lobster', 'Mackerel',
  'Meat pie', 'Pike', 'Salmon', 'Shrimps', 'Tuna',
  'Ardougne teleport (tablet)', 'Camelot teleport (tablet)', 'Civitas illa fortis teleport',
  'Falador teleport (tablet)', 'Kourend castle teleport (tablet)', 'Lumbridge teleport (tablet)',
  'Varrock teleport (tablet)', 'Teleport to house (tablet)',
  'Games necklace(8)', 'Ring of dueling(8)',
  'Chisel', 'Gardening trowel', 'Glassblowing pipe', 'Hammer', 'Needle', 'Pestle and mortar',
  'Rake', 'Saw', 'Secateurs', 'Seed dibber', 'Shears', 'Spade', 'Watering can',
]);

function taxPerItem(price, name) {
  if (price < NO_TAX_BELOW || EXEMPT_NAMES.has(name)) return 0;
  return Math.min(Math.floor(price * TAX_RATE), TAX_CAP);
}
const netSell = (price, name) => price - taxPerItem(price, name);

// The lowest sell price that gets your money back after tax.
function breakEven(buyPrice, name) {
  if (EXEMPT_NAMES.has(name)) return buyPrice;
  let price = Math.max(buyPrice, Math.min(Math.floor(buyPrice / (1 - TAX_RATE)) - 1, buyPrice + TAX_CAP));
  while (netSell(price, name) < buyPrice) price++;
  return price;
}

module.exports = { taxPerItem, netSell, breakEven, EXEMPT_NAMES, TAX_RATE, TAX_CAP, NO_TAX_BELOW };
