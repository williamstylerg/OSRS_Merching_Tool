'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld('api', {
  getView: call('view:get'),
  updateSettings: call('settings:update'),
  searchItems: call('items:search'),
  getItem: call('items:detail'),
  getHistory: call('items:history'),
  addTrade: call('trade:add'),
  addSell: call('trade:sell'),
  updateTrade: call('trade:update'),
  deleteTrade: call('trade:delete'),
  addLimitBuy: call('limit:add'),
  setWatch: call('watch:set'),
  refresh: call('data:refresh'),
  onView: (fn) => ipcRenderer.on('view', (_e, view) => fn(view)),
});
