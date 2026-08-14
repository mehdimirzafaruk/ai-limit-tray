const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store');
const { CodexClient } = require('./codex-client');
const claudeClient = require('./claude-client');
const normalize = require('./normalize');
const hoverLayout = require('./hover-layout');

let win, hoverWin, tray, store, timer, hoverTimer;
const codexClients = new Map();
let snapshot = { updatedAt: null, accounts: [], codexTotal: normalize.aggregate([]), claudeTotal: normalize.aggregate([]) };
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

function createWindow() {
  win = new BrowserWindow({ width: 920, height: 720, minWidth: 760, minHeight: 560,
    show: false, backgroundColor: '#0b0f16', title: 'AI Limit Tray', icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', event => { if (!app.isQuitting) { event.preventDefault(); win.hide(); } });
}

function createHoverWindow() {
  hoverWin = new BrowserWindow({ width: 390, height: 220, minWidth: 390, maxWidth: 390, minHeight: 180, maxHeight: 460,
    show: false, frame: false, fullscreenable: false,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#101722',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  hoverWin.loadFile(path.join(__dirname, 'renderer', 'hover.html'));
  hoverWin.setAlwaysOnTop(true, 'pop-up-menu');
}

function tooltip() {
  const c = snapshot.codexTotal, a = snapshot.claudeTotal;
  return `Claude toplam: ${a.accounts ? `%${a.remainingPercent}` : '—'} · Codex toplam: ${c.accounts ? `%${c.remainingPercent}` : '—'}`;
}

function positionHover() {
  const codexRows = snapshot.accounts.filter(a => a.provider === 'codex').length;
  const { width, height } = hoverLayout.hoverSize(codexRows);
  if (hoverWin.isFullScreen()) hoverWin.setFullScreen(false);
  if (hoverWin.isMaximized()) hoverWin.unmaximize();
  const trayBounds = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea;
  const x = Math.min(Math.max(trayBounds.x + trayBounds.width - width, area.x + 8), area.x + area.width - width - 8);
  const y = Math.max(area.y + 8, trayBounds.y - height - 8);
  hoverWin.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false);
}

function showHover() {
  if (!hoverWin || hoverWin.isDestroyed()) return;
  hoverWin.webContents.send('snapshot', snapshot);
  positionHover();
  hoverWin.showInactive();
  clearInterval(hoverTimer);
  hoverTimer = setInterval(() => {
    const point = screen.getCursorScreenPoint(), hb = hoverWin.getBounds(), tb = tray.getBounds();
    const inside = b => point.x >= b.x - 4 && point.x <= b.x + b.width + 4 && point.y >= b.y - 4 && point.y <= b.y + b.height + 4;
    if (!inside(hb) && !inside(tb)) { hoverWin.hide(); clearInterval(hoverTimer); }
  }, 250);
}

function updateTray() {
  tray.setToolTip(process.platform === 'win32' ? '' : tooltip());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: snapshot.claudeTotal.accounts ? `Claude toplam: %${snapshot.claudeTotal.remainingPercent} kaldı` : 'Claude hesabı eklenmedi', enabled: false },
    { label: snapshot.codexTotal.accounts ? `Codex toplam: %${snapshot.codexTotal.remainingPercent} kaldı` : 'Codex hesabı eklenmedi', enabled: false },
    ...snapshot.accounts.filter(a => a.provider === 'codex').map(a => ({
      label: `  ${a.name}: ${a.usage?.primaryUsed == null ? 'veri yok' : `%${Math.round(100 - a.usage.primaryUsed)} kaldı`}`,
      enabled: false
    })),
    { type: 'separator' }, { label: 'Paneli aç', click: () => { win.show(); win.focus(); } },
    { label: 'Yenile', click: refresh }, { type: 'separator' },
    { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  win?.webContents.send('snapshot', snapshot);
  hoverWin?.webContents.send('snapshot', snapshot);
}

async function readAccount(profile) {
  try {
    if (profile.provider === 'codex') {
      let client = codexClients.get(profile.id);
      if (!client) { client = new CodexClient(store.profileDir('codex', profile.id)); codexClients.set(profile.id, client); }
      const [account, raw] = await Promise.all([client.account(), client.limits()]);
      return { ...profile, status: 'ok', statusText: 'Bağlı', identity: account?.account?.email || account?.email || null, usage: normalize.codex(raw) };
    }
    const raw = await claudeClient.usage(store.profileDir('claude', profile.id));
    return { ...profile, status: 'ok', statusText: 'Bağlı', usage: normalize.claude(raw) };
  } catch (error) {
    return { ...profile, status: 'error', statusText: error.message, usage: null };
  }
}

async function refresh() {
  const settings = store.read();
  const profiles = [...settings.codex.map(x => ({ ...x, provider: 'codex' })), ...settings.claude.map(x => ({ ...x, provider: 'claude' }))];
  snapshot.accounts = await Promise.all(profiles.map(readAccount));
  snapshot.codexTotal = normalize.aggregate(snapshot.accounts.filter(a => a.provider === 'codex'));
  snapshot.claudeTotal = normalize.aggregate(snapshot.accounts.filter(a => a.provider === 'claude'));
  snapshot.updatedAt = new Date().toISOString(); updateTray(); return snapshot;
}

function schedule() {
  clearInterval(timer); const minutes = Math.max(1, Number(store.read().refreshMinutes) || 5);
  timer = setInterval(refresh, minutes * 60_000);
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData')); createWindow(); createHoverWindow();
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }));
  tray.on('click', () => win.isVisible() ? win.hide() : win.show());
  tray.on('mouse-move', showHover);
  refresh(); schedule(); win.show();
});

app.on('window-all-closed', event => event.preventDefault());
app.on('before-quit', () => { app.isQuitting = true; for (const c of codexClients.values()) c.close(); });

ipcMain.handle('get-state', () => ({ settings: store.read(), snapshot }));
ipcMain.handle('add-profile', async (_e, { provider, name }) => {
  const settings = store.read(); const id = crypto.randomUUID();
  settings[provider].push({ id, name: String(name || `${provider} hesabı`).slice(0, 40) }); store.write(settings);
  await login(provider, id); return refresh();
});
ipcMain.handle('login', (_e, { provider, id }) => login(provider, id));
ipcMain.handle('remove-profile', async (_e, { provider, id }) => {
  const settings = store.read(); settings[provider] = settings[provider].filter(x => x.id !== id); store.write(settings);
  codexClients.get(id)?.close(); codexClients.delete(id); return refresh();
});
ipcMain.handle('refresh', refresh);
ipcMain.handle('set-refresh', (_e, minutes) => { const s = store.read(); s.refreshMinutes = Number(minutes); store.write(s); schedule(); });

async function login(provider, id) {
  if (provider === 'codex') {
    let client = codexClients.get(id);
    if (!client) { client = new CodexClient(store.profileDir('codex', id)); codexClients.set(id, client); }
    const result = await client.login();
    const url = result?.authUrl || result?.auth_url || result?.url;
    if (url) await shell.openExternal(url);
    setTimeout(refresh, 5000); return result;
  }
  return claudeClient.login(store.profileDir('claude', id));
}
