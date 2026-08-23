const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Bazı uzak masaüstü / sanal ekran ortamlarında Chromium'un GPU compositor'ı pencere içeriğini
// siyah gösterebiliyor. Bu basit arayüzde donanım hızlandırması gerekli değil.
app.disableHardwareAcceleration();
const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit();

const { Store } = require('./store');
const { CodexClient, isAuthError } = require('./codex-client');
const { accountErrorText } = require('./account-error');
const { loginItemSettings } = require('./startup');
const claudeClient = require('./claude-client');
const normalize = require('./normalize');
const { limitsFromUsage, lowLimitWarnings } = require('./limit-warning');
const hoverLayout = require('./hover-layout');
const { ContextWatcher } = require('./context-watcher');
const { ClaudeContextWatcher } = require('./claude-context-watcher');
const { ClaudeDesktopWatcher } = require('./claude-desktop-watcher');
const { ensureClaudeStatuslineIntegration } = require('./claude-integration');
const { ForegroundWindowWatcher, isClaudeCodeWindow, isClaudeDesktopWindow, isCodexWindow, overlayBounds } = require('./window-watcher');

let win, hoverWin, contextOverlayWin, tray, store, timer, hoverTimer, contextTimer;
let desktopCodexClient, foregroundWatcher, foregroundState, claudeIntegration, desktopCodexUsage;
let refreshPromise, desktopLimitsPromise;
const codexClients = new Map();
const threadMetadataCache = new Map();
const threadMetadataRequests = new Map();
const contextWatcher = new ContextWatcher();
const claudeContextWatcher = new ClaudeContextWatcher();
const claudeDesktopWatcher = new ClaudeDesktopWatcher();
let snapshot = { updatedAt: null, accounts: [], codexTotal: normalize.aggregate([]), claudeTotal: normalize.aggregate([]) };
let contextSnapshot = { source: 'codex', chats: [], active: null, checkedAt: null, reason: 'Henüz kontrol edilmedi.' };
const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
const startInBackground = process.argv.includes('--background');

function validProvider(provider) {
  if (provider !== 'codex' && provider !== 'claude') throw new Error('Geçersiz sağlayıcı');
  return provider;
}

function existingProfile(provider, id) {
  validProvider(provider);
  const settings = store.read();
  if (!settings[provider].some(profile => profile.id === id)) throw new Error('Profil bulunamadı');
  return { settings, profile: settings[provider].find(item => item.id === id) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 720, minWidth: 760, minHeight: 560,
    show: false, backgroundColor: '#0b0f16', title: 'AI Limit Tray', icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', event => {
    if (!app.isQuitting) { event.preventDefault(); win.hide(); }
  });
}

function createHoverWindow() {
  hoverWin = new BrowserWindow({
    width: 390, height: 220, minWidth: 390, maxWidth: 390, minHeight: 180, maxHeight: 460,
    show: false, frame: false, fullscreenable: false,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#101722',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  hoverWin.loadFile(path.join(__dirname, 'renderer', 'hover.html'));
  hoverWin.setAlwaysOnTop(true, 'pop-up-menu');
}

function createContextOverlayWindow() {
  contextOverlayWin = new BrowserWindow({
    width: 360, height: 78,
    show: false, frame: false, transparent: true, hasShadow: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  contextOverlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  contextOverlayWin.setAlwaysOnTop(true, 'floating');
  contextOverlayWin.setIgnoreMouseEvents(true, { forward: true });
}

function tooltip() {
  const c = snapshot.codexTotal, a = snapshot.claudeTotal;
  return `Claude toplam: ${a.accounts ? `%${a.remainingPercent}` : '—'} · Codex toplam: ${c.accounts ? `%${c.remainingPercent}` : '—'}`;
}

function cleanThreadTitle(thread) {
  const value = thread?.name || String(thread?.preview || '').split(/\r?\n/).find(line => line.trim());
  return String(value || 'İsimsiz sohbet').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function queueThreadMetadata(threadId) {
  if (!desktopCodexClient || threadMetadataRequests.has(threadId)) return;
  const cached = threadMetadataCache.get(threadId);
  if (cached?.expiresAt > Date.now()) return;
  const request = desktopCodexClient.thread(threadId)
    .then(thread => {
      threadMetadataCache.set(threadId, {
        title: cleanThreadTitle(thread),
        cwd: thread?.cwd || null,
        expiresAt: Date.now() + 30000
      });
    })
    .catch(() => {
      const previous = threadMetadataCache.get(threadId);
      threadMetadataCache.set(threadId, {
        title: previous?.title || 'İsimsiz sohbet',
        cwd: previous?.cwd || null,
        expiresAt: Date.now() + 10000
      });
    })
    .finally(() => {
      threadMetadataRequests.delete(threadId);
      refreshContext();
    });
  threadMetadataRequests.set(threadId, request);
}

function attachThreadMetadata(raw) {
  if (String(raw?.source || '').startsWith('claude')) return raw;
  const fallbackAccounts = snapshot.accounts.filter(account => account.provider === 'codex' && account.status === 'ok' && account.usage);
  const activeUsage = desktopCodexUsage || (fallbackAccounts.length === 1 ? fallbackAccounts[0].usage : null);
  const rateLimits = limitsFromUsage(activeUsage);
  const chats = raw.chats.map(chat => {
    const metadata = threadMetadataCache.get(chat.id);
    queueThreadMetadata(chat.id);
    return {
      ...chat,
      title: metadata?.title || 'Başlık yükleniyor…',
      cwd: metadata?.cwd || null,
      rateLimits
    };
  });
  const activeId = raw.active?.id;
  return { ...raw, chats, active: chats.find(chat => chat.id === activeId) || chats[0] || null };
}

function publishContext() {
  win?.webContents.send('context-snapshot', contextSnapshot);
  hoverWin?.webContents.send('context-snapshot', contextSnapshot);
  contextOverlayWin?.webContents.send('context-snapshot', contextSnapshot);
  updateContextOverlay();
}

function refreshContext() {
  try {
    let next;
    if (isClaudeDesktopWindow(foregroundState)) {
      next = claudeDesktopWatcher.currentContext();
    } else if (isClaudeCodeWindow(foregroundState)) {
      next = claudeContextWatcher.currentContext({ foregroundTitle: foregroundState?.title });
      if (claudeIntegration?.disabled && !next.chats.length) {
        next.reason = 'Claude Code statusLine, disableAllHooks ayarı nedeniyle kapalı.';
      }
    } else {
      next = { source: 'codex', ...contextWatcher.currentContext() };
      if (foregroundState?.codexOpen === false) {
        next = { source: 'codex', chats: [], active: null, checkedAt: Date.now(), reason: 'Codex masaüstü açık değil.' };
      }
    }
    contextSnapshot = attachThreadMetadata(next);
  } catch (error) {
    const source = isClaudeDesktopWindow(foregroundState) ? 'claude-desktop' : isClaudeCodeWindow(foregroundState) ? 'claude' : 'codex';
    contextSnapshot = { source, chats: [], active: null, checkedAt: Date.now(), reason: `Context okunamadı: ${error.message}` };
  }
  publishContext();
  return contextSnapshot;
}

function updateContextOverlay() {
  if (!contextOverlayWin || contextOverlayWin.isDestroyed() || !store) return;
  const enabled = store.read().contextOverlay;
  const physicalTarget = foregroundState?.bounds;
  const matchingWindow = contextSnapshot.source === 'claude-desktop'
    ? isClaudeDesktopWindow(foregroundState)
    : contextSnapshot.source === 'claude'
      ? isClaudeCodeWindow(foregroundState)
      : isCodexWindow(foregroundState);
  if (!enabled || !contextSnapshot.active || !matchingWindow || !physicalTarget) {
    contextOverlayWin.hide();
    return;
  }
  let target = physicalTarget;
  try { target = screen.screenToDipRect(null, physicalTarget); } catch { /* Eski Electron sürümünde fiziksel koordinatı kullan. */ }
  const workArea = screen.getDisplayMatching(target).workArea;
  const bounds = overlayBounds(target, { width: 360, height: 78 }, workArea);
  if (!bounds) {
    contextOverlayWin.hide();
    return;
  }
  contextOverlayWin.setBounds(bounds, false);
  contextOverlayWin.webContents.send('context-snapshot', contextSnapshot);
  contextOverlayWin.showInactive();
}

function positionHover() {
  const codexRows = snapshot.accounts.filter(a => a.provider === 'codex').length;
  const warningRows = contextSnapshot.chats.reduce((total, chat) =>
    total + Number(lowLimitWarnings(chat.rateLimits).length > 0) + Number(chat.compacted === true), 0);
  const { width, height } = hoverLayout.hoverSize(codexRows, contextSnapshot.chats.length, warningRows);
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
  hoverWin.webContents.send('snapshot', { ...snapshot, stickyHover: store.read().stickyHover });
  hoverWin.webContents.send('context-snapshot', contextSnapshot);
  positionHover();
  hoverWin.showInactive();
  clearInterval(hoverTimer);
  if (store.read().stickyHover) return;
  hoverTimer = setInterval(() => {
    const point = screen.getCursorScreenPoint(), hb = hoverWin.getBounds(), tb = tray.getBounds();
    const inside = bounds => point.x >= bounds.x - 4 && point.x <= bounds.x + bounds.width + 4 && point.y >= bounds.y - 4 && point.y <= bounds.y + bounds.height + 4;
    if (!inside(hb) && !inside(tb)) { hoverWin.hide(); clearInterval(hoverTimer); }
  }, 250);
}

function toggleSticky() {
  const settings = store.read();
  settings.stickyHover = !settings.stickyHover;
  store.write(settings);
  if (settings.stickyHover) showHover();
  else { clearInterval(hoverTimer); hoverWin?.hide(); }
  updateTray();
  return settings.stickyHover;
}

function toggleContextOverlay() {
  const settings = store.read();
  settings.contextOverlay = !settings.contextOverlay;
  store.write(settings);
  updateContextOverlay();
  updateTray();
  return settings.contextOverlay;
}

function updateTray() {
  const settings = store.read();
  tray.setToolTip(process.platform === 'win32' ? '' : tooltip());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: snapshot.claudeTotal.accounts ? `Claude toplam: %${snapshot.claudeTotal.remainingPercent} kaldı` : 'Claude hesabı eklenmedi', enabled: false },
    { label: snapshot.codexTotal.accounts ? `Codex toplam: %${snapshot.codexTotal.remainingPercent} kaldı` : 'Codex hesabı eklenmedi', enabled: false },
    ...snapshot.accounts.filter(a => a.provider === 'codex').map(a => ({
      label: `  ${a.name}: ${a.usage?.primaryUsed == null ? 'veri yok' : `%${Math.round(100 - a.usage.primaryUsed)} kaldı`}`,
      enabled: false
    })),
    { type: 'separator' },
    { label: settings.stickyHover ? '📌 Sabitlemeyi kaldır' : '📌 Paneli sabitle (her zaman göster)', click: toggleSticky },
    { label: settings.contextOverlay ? 'Context katmanını gizle' : 'Context katmanını göster', click: toggleContextOverlay },
    { label: 'Paneli aç', click: () => { win.show(); win.focus(); } },
    { label: 'Yenile', click: () => { refresh(); refreshContext(); } },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  win?.webContents.send('snapshot', snapshot);
  hoverWin?.webContents.send('snapshot', { ...snapshot, stickyHover: settings.stickyHover });
}

async function readAccount(profile, previous) {
  try {
    if (profile.provider === 'codex') {
      let client = codexClients.get(profile.id);
      if (!client) {
        client = new CodexClient(store.profileDir('codex', profile.id));
        codexClients.set(profile.id, client);
      }
      const { account, limits } = await client.usage();
      return { ...profile, status: 'ok', statusText: 'Bağlı', identity: account?.account?.email || account?.email || null, usage: normalize.codex(limits), usageUpdatedAt: new Date().toISOString() };
    }
    const raw = await claudeClient.usage(store.profileDir('claude', profile.id));
    return { ...profile, status: 'ok', statusText: 'Bağlı', usage: normalize.claude(raw), usageUpdatedAt: new Date().toISOString() };
  } catch (error) {
    const recovering = profile.provider === 'codex' && isAuthError(error);
    return {
      ...profile,
      status: recovering ? 'recovering' : 'error',
      statusText: accountErrorText(profile.provider, error),
      usage: previous?.usage || null,
      usageUpdatedAt: previous?.usageUpdatedAt || null
    };
  }
}

function refreshDesktopCodexLimits() {
  if (!desktopCodexClient) return Promise.resolve(null);
  if (desktopLimitsPromise) return desktopLimitsPromise;
  desktopLimitsPromise = desktopCodexClient.usage()
    .then(({ limits }) => {
      desktopCodexUsage = normalize.codex(limits);
      refreshContext();
      return desktopCodexUsage;
    })
    // Aktif masaüstü hesabı okunamazsa profil kartlarını ve son başarılı uyarı verisini bozma.
    .catch(() => desktopCodexUsage || null)
    .finally(() => { desktopLimitsPromise = null; });
  return desktopLimitsPromise;
}

function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const settings = store.read();
    const profiles = [
      ...settings.codex.map(profile => ({ ...profile, provider: 'codex' })),
      ...settings.claude.map(profile => ({ ...profile, provider: 'claude' }))
    ];
    refreshDesktopCodexLimits();
    const previousByProfile = new Map(snapshot.accounts.map(account => [`${account.provider}:${account.id}`, account]));
    snapshot.accounts = await Promise.all(profiles.map(profile => readAccount(profile, previousByProfile.get(`${profile.provider}:${profile.id}`))));
    snapshot.codexTotal = normalize.aggregate(snapshot.accounts.filter(account => account.provider === 'codex'));
    snapshot.claudeTotal = normalize.aggregate(snapshot.accounts.filter(account => account.provider === 'claude'));
    snapshot.updatedAt = new Date().toISOString();
    updateTray();
    refreshContext();
    return snapshot;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function schedule() {
  clearInterval(timer);
  const minutes = Math.max(1, Number(store.read().refreshMinutes) || 5);
  timer = setInterval(() => { refresh().catch(() => {}); }, minutes * 60_000);
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  try { claudeIntegration = ensureClaudeStatuslineIntegration(); }
  catch (error) { claudeIntegration = { installed: false, error: error.message }; }
  try {
    // Eski geliştirme sürümünün genel Electron başlangıç kaydını temizle.
    if (!app.isPackaged) app.setLoginItemSettings({ openAtLogin: false, name: 'electron.app.Electron' });
    app.setLoginItemSettings(loginItemSettings({
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      appPath: app.getAppPath()
    }));
  } catch { /* Başlangıç kaydı başarısız olsa da uygulama çalışmaya devam eder. */ }
  desktopCodexClient = new CodexClient(path.join(os.homedir(), '.codex'));
  createWindow();
  createHoverWindow();
  createContextOverlayWindow();
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }));
  tray.on('click', () => win.isVisible() ? win.hide() : win.show());
  tray.on('mouse-move', showHover);

  foregroundWatcher = new ForegroundWindowWatcher();
  foregroundWatcher.on('change', state => {
    const appOpenChanged = foregroundState?.codexOpen !== state.codexOpen ||
      foregroundState?.claudeDesktopOpen !== state.claudeDesktopOpen ||
      foregroundState?.claudeCodeOpen !== state.claudeCodeOpen;
    const activeProviderChanged = isCodexWindow(foregroundState) !== isCodexWindow(state) ||
      isClaudeDesktopWindow(foregroundState) !== isClaudeDesktopWindow(state) ||
      isClaudeCodeWindow(foregroundState) !== isClaudeCodeWindow(state);
    contextWatcher.setDesktopProcessIds(state.codexProcessIds);
    if (!state.codexOpen) contextWatcher.resetActivity();
    foregroundState = state;
    if (appOpenChanged || activeProviderChanged) refreshContext();
    else updateContextOverlay();
  });
  foregroundWatcher.start();

  refresh().then(() => { if (!startInBackground && store.read().stickyHover) showHover(); }).catch(() => updateTray());
  schedule();
  if (!startInBackground) win.show();
  refreshContext();
  contextTimer = setInterval(refreshContext, 1000);
});

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--background')) return;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  app.isQuitting = true;
  clearInterval(timer);
  clearInterval(hoverTimer);
  clearInterval(contextTimer);
  foregroundWatcher?.stop();
  desktopCodexClient?.close();
  for (const client of codexClients.values()) client.close();
});

ipcMain.handle('get-state', () => {
  const settings = store.read();
  return { settings, snapshot: { ...snapshot, stickyHover: settings.stickyHover }, context: contextSnapshot };
});
ipcMain.handle('add-profile', async (_event, { provider, name }) => {
  validProvider(provider);
  const settings = store.read();
  const id = crypto.randomUUID();
  settings[provider].push({ id, name: String(name || `${provider} hesabı`).slice(0, 40) });
  store.write(settings);
  await login(provider, id);
  return refresh();
});
ipcMain.handle('login', (_event, { provider, id }) => {
  existingProfile(provider, id);
  return login(provider, id);
});
ipcMain.handle('remove-profile', async (_event, { provider, id }) => {
  const { settings } = existingProfile(provider, id);
  settings[provider] = settings[provider].filter(profile => profile.id !== id);
  store.write(settings);
  codexClients.get(id)?.close();
  codexClients.delete(id);
  return refresh();
});
ipcMain.handle('refresh', refresh);
ipcMain.handle('set-refresh', (_event, minutes) => {
  const settings = store.read();
  settings.refreshMinutes = Math.max(1, Math.min(60, Number(minutes) || 5));
  store.write(settings);
  schedule();
});
ipcMain.handle('toggle-sticky', toggleSticky);

async function login(provider, id) {
  if (provider === 'codex') {
    let client = codexClients.get(id);
    if (!client) {
      client = new CodexClient(store.profileDir('codex', id));
      codexClients.set(id, client);
    }
    const result = await client.login();
    const url = result?.authUrl || result?.auth_url || result?.url;
    if (url) await shell.openExternal(url);
    setTimeout(() => { refresh().catch(() => {}); }, 5000);
    return result;
  }
  return claudeClient.login(store.profileDir('claude', id));
}
