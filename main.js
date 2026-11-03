'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
// Must run before anything calls app.getPath, so userData always lands in the same folder.
app.setName('OSRS Merch Planner');

const path = require('path');
const { DataService } = require('./src-main/services/dataService');
const { Store } = require('./src-main/services/store');
const { buildView, searchItems, itemDetail } = require('./src-main/services/plannerView');

let win, data, store;

const push = () => { if (win && !win.isDestroyed()) win.webContents.send('view', buildView(data, store)); };
const loadBaselines = () => {
  if (store.data.settings.mode !== 'long') return;
  const timer = setInterval(push, 5000);
  data.refreshBaselines().finally(() => { clearInterval(timer); push(); });
};

function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => { const r = await fn(...args); return r === undefined ? buildView(data, store) : r; });
  handle('view:get', () => buildView(data, store));
  handle('settings:update', (patch) => { store.updateSettings(patch); loadBaselines(); });
  handle('items:search', (q) => searchItems(data, q));
  handle('items:detail', (id) => itemDetail(data, store, id));
  handle('items:history', ({ id, lookback }) => data.history(id, lookback));
  handle('trade:add', (t) => { store.addTrade(t); });
  handle('trade:sell', ({ id, qty, price }) => { store.addSell(id, qty, price); });
  handle('trade:update', ({ id, ...patch }) => { store.updateTrade(id, patch); });
  handle('trade:delete', (id) => { store.deleteTrade(id); });
  handle('limit:add', (b) => { store.addLimitBuy(b); });
  handle('watch:set', ({ itemId, name, target }) => { store.setWatch(itemId, name, target); loadBaselines(); });
  handle('data:refresh', async () => { await data.refreshLive(); });
}

async function startData() {
  await data.refreshLive(); push();
  const hourlyTimer = setInterval(push, 3000);
  await data.refreshHours();
  clearInterval(hourlyTimer); push();
  loadBaselines();
  setInterval(async () => { await data.refreshLive(); push(); }, 60_000);
  setInterval(async () => { await data.refreshHours(); push(); loadBaselines(); }, 10 * 60_000);
}

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  store = new Store(dir);
  data = new DataService({ cacheDir: dir });
  data.load();
  registerIpc();
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 980, minHeight: 640,
    backgroundColor: '#231c15', title: 'OSRS Merch Planner', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile('index.html');
  win.webContents.once('did-finish-load', startData);
});
app.on('window-all-closed', () => app.quit());
