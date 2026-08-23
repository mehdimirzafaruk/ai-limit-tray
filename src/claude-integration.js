const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BRIDGE_NAME = 'ai-limit-tray-statusline.cjs';
const CONFIG_NAME = 'ai-limit-tray-statusline.config.json';
const SNAPSHOT_DIR_NAME = 'ai-limit-tray-context';

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* En iyi çaba. */ }
    throw error;
  }
}

function bridgeCommand(bridgePath) {
  return `node "${bridgePath.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

function sameBridgeCommand(command, bridgePath) {
  const normalized = String(command || '').replace(/\\/g, '/').toLowerCase();
  return normalized.includes(bridgePath.replace(/\\/g, '/').toLowerCase());
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function ensureClaudeStatuslineIntegration(options = {}) {
  const claudeRoot = options.claudeRoot || path.join(os.homedir(), '.claude');
  const sourcePath = options.sourcePath || path.join(__dirname, 'claude-statusline-bridge.cjs');
  const settingsPath = path.join(claudeRoot, 'settings.json');
  const bridgePath = path.join(claudeRoot, BRIDGE_NAME);
  const configPath = path.join(claudeRoot, CONFIG_NAME);
  const snapshotRoot = path.join(claudeRoot, SNAPSHOT_DIR_NAME);
  const backupPath = path.join(claudeRoot, 'settings.ai-limit-tray-before-context.json');

  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const source = fs.readFileSync(sourcePath, 'utf8');
  let currentBridge = null;
  try { currentBridge = fs.readFileSync(bridgePath, 'utf8'); } catch { /* İlk kurulum. */ }
  if (currentBridge !== source) atomicWrite(bridgePath, source);

  const settingsExists = fs.existsSync(settingsPath);
  const settings = settingsExists ? readJson(settingsPath, null) : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Claude settings.json geçerli JSON değil; mevcut ayar korunarak köprü kurulamadı.');
  }

  const previousConfig = readJson(configPath, {});
  const alreadyInstalled = sameBridgeCommand(settings.statusLine?.command, bridgePath);
  const originalStatusLine = alreadyInstalled
    ? (previousConfig.originalStatusLine || null)
    : (settings.statusLine && typeof settings.statusLine === 'object' ? { ...settings.statusLine } : null);

  atomicWrite(configPath, JSON.stringify({ schemaVersion: 1, originalStatusLine }, null, 2));
  if (settingsExists && !fs.existsSync(backupPath)) fs.copyFileSync(settingsPath, backupPath);

  const currentStatusLine = settings.statusLine && typeof settings.statusLine === 'object' ? settings.statusLine : {};
  const priorRefresh = Number(currentStatusLine.refreshInterval ?? originalStatusLine?.refreshInterval);
  settings.statusLine = {
    ...(originalStatusLine || {}),
    ...currentStatusLine,
    type: 'command',
    command: bridgeCommand(bridgePath),
    // Birden fazla Claude terminali arasında aktif oturum seçiminin gecikmemesi için hafif bir heartbeat.
    refreshInterval: Number.isFinite(priorRefresh) && priorRefresh > 0 ? Math.min(5, priorRefresh) : 5
  };
  atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  return {
    installed: true,
    snapshotRoot,
    bridgePath,
    settingsPath,
    disabled: settings.disableAllHooks === true
  };
}

module.exports = {
  BRIDGE_NAME,
  CONFIG_NAME,
  SNAPSHOT_DIR_NAME,
  bridgeCommand,
  ensureClaudeStatuslineIntegration
};
