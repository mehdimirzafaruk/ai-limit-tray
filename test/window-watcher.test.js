const test = require('node:test');
const assert = require('node:assert/strict');
const { isClaudeCodeWindow, isClaudeDesktopWindow, isCodexWindow, overlayBounds } = require('../src/window-watcher');

test('MSIX Codex masaüstü penceresini tanır', () => {
  assert.equal(isCodexWindow({
    processName: 'ChatGPT',
    executablePath: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0_x64__id\\app\\ChatGPT.exe',
    title: 'ChatGPT',
    minimized: false
  }), true);
});

test('başka bir Electron penceresinde katmanı göstermez', () => {
  assert.equal(isCodexWindow({ processName: 'electron', executablePath: 'C:\\app\\electron.exe', minimized: false }), false);
});

test('Claude Code çalışan aktif terminal penceresini tanır', () => {
  assert.equal(isClaudeCodeWindow({
    processName: 'WindowsTerminal',
    title: 'Claude Code — ai-limit-tray',
    claudeCodeOpen: true,
    claudeCodeForeground: true,
    minimized: false
  }), true);
});

test('Claude başka yerde açıkken sıradan terminalde katmanı göstermez', () => {
  assert.equal(isClaudeCodeWindow({
    processName: 'WindowsTerminal',
    title: 'PowerShell',
    claudeCodeOpen: true,
    claudeCodeForeground: false,
    minimized: false
  }), false);
});

test('MSIX Claude Desktop penceresini Claude Code sanmaz', () => {
  const state = {
    processName: 'Claude',
    executablePath: 'C:\\Program Files\\WindowsApps\\Claude_1.0_x64__id\\app\\Claude.exe',
    claudeCodeOpen: false,
    claudeCodeForeground: false,
    minimized: false
  };
  assert.equal(isClaudeDesktopWindow(state), true);
  assert.equal(isClaudeCodeWindow(state), false);
});

test('katmanı hedef pencerenin sağ üstünde ve çalışma alanında tutar', () => {
  assert.deepEqual(
    overlayBounds({ x: 100, y: 80, width: 1000, height: 700 }, { width: 360, height: 78 }, { x: 0, y: 0, width: 1920, height: 1040 }),
    { x: 724, y: 126, width: 360, height: 78 }
  );
});

test('çok küçük hedef pencerede katman açmaz', () => {
  assert.equal(overlayBounds({ x: 0, y: 0, width: 240, height: 120 }, { width: 360, height: 78 }, { x: 0, y: 0, width: 1920, height: 1040 }), null);
});
