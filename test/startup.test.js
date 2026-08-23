const test = require('node:test');
const assert = require('node:assert/strict');
const { loginItemSettings } = require('../src/startup');

test('paketli uygulamayı Windows girişinde arka planda başlatır', () => {
  assert.deepEqual(loginItemSettings({ isPackaged: true, execPath: 'C:\\App\\AI Limit Tray.exe', appPath: 'ignored' }), {
    openAtLogin: true,
    name: 'AI Limit Tray',
    path: 'C:\\App\\AI Limit Tray.exe',
    args: ['--background']
  });
});

test('kaynak sürümde Electron ile proje yolunu arka planda başlatır', () => {
  assert.deepEqual(loginItemSettings({ isPackaged: false, execPath: 'C:\\electron.exe', appPath: 'C:\\AI-Limit-Tray' }), {
    openAtLogin: true,
    name: 'AI Limit Tray',
    path: 'C:\\electron.exe',
    args: ['C:\\AI-Limit-Tray', '--background']
  });
});
