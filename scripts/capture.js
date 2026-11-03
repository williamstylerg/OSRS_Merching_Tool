'use strict';
// Saves README screenshots to docs/screenshots using live prices.
// Runs with a temporary profile, so your real cash and trades never appear.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'merch-screenshots-'));
app.setPath('userData', profile);
require('../main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(run, code, what, seconds = 120) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await run(code)) return;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const SEED_TRADES = `(async () => {
  const slots = (await window.api.getView()).plan.slots;
  if (slots.length < 3) throw new Error('The plan has too few items for sample trades');
  const trade = (c, qty) => window.api.addTrade({ itemId: c.id, name: c.name, mode: 'fast', qty, buyPrice: c.buy, expectedSell: c.sell });
  await trade(slots[0], slots[0].qty);
  await trade(slots[1], slots[1].qty);
  const view = await trade(slots[2], slots[2].qty);
  const done = view.stats.trades.find((t) => t.itemId === slots[2].id);
  await window.api.addSell({ id: done.id, qty: done.qty, price: slots[2].sell });
  const cash = document.getElementById('cash');
  cash.value = '25m';
  cash.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

async function capture(contents, name) {
  await wait(1500); // Lets item pictures finish loading.
  const image = await contents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  console.log(`Saved ${name}.png`);
}

async function main() {
  await until(async () => BrowserWindow.getAllWindows().length > 0, null, 'the app window', 30);
  const win = BrowserWindow.getAllWindows()[0];
  const { webContents: contents } = win;
  const run = (code) => contents.executeJavaScript(code);
  fs.mkdirSync(OUT, { recursive: true });

  await until(run, `!!document.querySelector('.slot:not(.empty)') && !document.getElementById('freshness').textContent.includes('loading')`, 'prices to load');
  await run(SEED_TRADES);
  await until(run, `document.querySelectorAll('tbody .linkbtn').length >= 2`, 'sample trades to appear', 15);
  await capture(contents, 'planner');

  await run(`document.querySelector('tr.row').click(); true`);
  await until(run, `!!document.querySelector('#chart svg')`, 'the chart', 30);
  await capture(contents, 'item-chart');
  await run(`document.getElementById('dialog').close(); true`);

  await run(`(() => { const f = document.getElementById('find'); f.focus(); f.value = 'dragon'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await until(run, `!!document.querySelector('.find-results button')`, 'search results', 15);
  await capture(contents, 'search');
  await run(`(() => { const f = document.getElementById('find'); f.value = ''; f.blur(); document.body.click(); return true; })()`);

  await run(`document.querySelector('[data-action=tab][data-id=log]').click(); true`);
  await capture(contents, 'trade-log');
}

app.whenReady()
  .then(main)
  .then(() => console.log(`Screenshots are in ${OUT}`))
  .catch((e) => { console.error(`Screenshots failed: ${e.message}`); process.exitCode = 1; })
  .finally(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the temp folder clears itself eventually */ }
    app.quit();
  });
