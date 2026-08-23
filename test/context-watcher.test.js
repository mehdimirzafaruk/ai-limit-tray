const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContextWatcher, codexCompactionFromLines, codexUsageFromLines, parseActivityLine, reduceActivityEvents } = require('../src/context-watcher');

test('Codex Desktop aktif sohbet olayını ayrıştırır', () => {
  const event = parseActivityLine('2026-08-20T13:17:17.755Z info thread_stream_view_activity_changed active=true conversationId=01a01f43-b43d-7613-8220-0f82c4290a44 rendererWebContentsId=1 rendererWindowFocused=true rendererWindowId=7 rendererWindowVisible=true');
  assert.deepEqual(event, {
    active: true,
    threadId: '01a01f43-b43d-7613-8220-0f82c4290a44',
    windowId: '7',
    focused: true,
    visible: true,
    timestamp: Date.parse('2026-08-20T13:17:17.755Z'),
    sequence: 0
  });
});

test('Codex compact olayından sıkıştırma sayısını ve zamanını okur', () => {
  const lines = [
    JSON.stringify({ timestamp: '2026-08-23T15:05:19.329Z', type: 'compacted', payload: { window_number: 1 } }),
    JSON.stringify({ timestamp: '2026-08-23T15:33:22.175Z', type: 'compacted', payload: { window_number: 2 } })
  ];
  const compact = codexCompactionFromLines(lines);
  assert.equal(compact.compacted, true);
  assert.equal(compact.compactionCount, 2);
  assert.equal(compact.compactedAt, Date.parse('2026-08-23T15:33:22.175Z'));
  assert.equal(compact.compactionSource, 'session-event');
});

test('sohbet değişince eski sohbeti aktif listeden çıkarır', () => {
  const base = '2026-08-20T13:17:17.755Z info thread_stream_view_activity_changed';
  const first = parseActivityLine(`${base} active=true conversationId=first rendererWindowFocused=true rendererWindowId=1 rendererWindowVisible=true`, 1);
  const close = parseActivityLine(`${base} active=false conversationId=first rendererWindowFocused=true rendererWindowId=1 rendererWindowVisible=true`, 2);
  const second = parseActivityLine(`${base} active=true conversationId=second rendererWindowFocused=true rendererWindowId=1 rendererWindowVisible=true`, 3);
  assert.deepEqual(reduceActivityEvents([first, close, second]).map(event => event.threadId), ['second']);
});

test('context doluluğunda ömür boyu toplam yerine son çağrıyı kullanır', () => {
  const lines = [
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-test' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { total_tokens: 7_714_013 },
      last_token_usage: { total_tokens: 47_864 },
      model_context_window: 258_400
    } } })
  ];
  assert.deepEqual(codexUsageFromLines(lines), {
    model: 'gpt-test',
    usedTokens: 35_864,
    contextLimit: 246_400,
    rawUsedTokens: 47_864,
    rawContextLimit: 258_400,
    baselineTokens: 12_000,
    usedPct: 14.6,
    remainingPct: 85.4
  });
});

test('ilk mesajdan önce bilinmeyen context değerini uydurmaz', () => {
  assert.deepEqual(codexUsageFromLines([JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-test' } })]), {
    model: 'gpt-test', usedTokens: null, contextLimit: null, rawUsedTokens: null,
    rawContextLimit: null, baselineTokens: null, usedPct: null, remainingPct: null
  });
});

test('null token değeri sıfır context kullanımı sayılmaz', () => {
  const lines = [JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
    last_token_usage: { total_tokens: null }, model_context_window: null
  } } })];
  const usage = codexUsageFromLines(lines);
  assert.equal(usage.usedTokens, null);
  assert.equal(usage.contextLimit, null);
  assert.equal(usage.remainingPct, null);
});

test('token kaydını kendisinden sonraki yeni turun modeliyle eşleştirmez', () => {
  const lines = [
    JSON.stringify({ type: 'turn_context', payload: { model: 'old-model' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
      last_token_usage: { total_tokens: 32_000 }, model_context_window: 112_000
    } } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'new-model' } })
  ];
  assert.equal(codexUsageFromLines(lines).model, 'old-model');
});

test('iki okumaya bölünen masaüstü log olayını kaybetmez', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logRoot = path.join(root, 'logs');
  const sessionRoot = path.join(root, 'sessions');
  fs.mkdirSync(logRoot);
  fs.mkdirSync(sessionRoot);
  const logPath = path.join(logRoot, 'desktop.log');
  const line = '2026-08-20T13:17:17.755Z info thread_stream_view_activity_changed active=true conversationId=split-thread rendererWindowFocused=true rendererWindowId=9 rendererWindowVisible=true';
  const splitAt = Math.floor(line.length / 2);
  fs.writeFileSync(logPath, line.slice(0, splitAt));

  const watcher = new ContextWatcher({ logRoots: [logRoot], sessionRoot });
  assert.equal(watcher.currentContext().chats.length, 0);
  fs.appendFileSync(logPath, `${line.slice(splitAt)}\n`);
  assert.equal(watcher.currentContext().active.id, 'split-thread');
  watcher.resetActivity();
  assert.equal(watcher.currentContext().chats.length, 0);
});

test('mevcut Codex sürecine ait logu eski süreç loguna tercih eder', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-process-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logRoot = path.join(root, 'logs');
  const sessionRoot = path.join(root, 'sessions');
  fs.mkdirSync(logRoot);
  fs.mkdirSync(sessionRoot);
  const event = id => `2026-08-20T13:17:17.755Z info thread_stream_view_activity_changed active=true conversationId=${id} rendererWindowFocused=true rendererWindowId=1 rendererWindowVisible=true\n`;
  fs.writeFileSync(path.join(logRoot, 'codex-desktop-session-111-t0.log'), event('old-thread'));
  fs.writeFileSync(path.join(logRoot, 'codex-desktop-session-222-t0.log'), event('current-thread'));

  const watcher = new ContextWatcher({ logRoots: [logRoot], sessionRoot });
  watcher.setDesktopProcessIds([222]);
  assert.deepEqual(watcher.currentContext().chats.map(chat => chat.id), ['current-thread']);
});

test('gizli sohbeti elemek ve odaktaki pencereyi aktif seçmek', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-windows-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logRoot = path.join(root, 'logs');
  const sessionRoot = path.join(root, 'sessions');
  fs.mkdirSync(logRoot);
  fs.mkdirSync(sessionRoot);
  const activity = (time, id, windowId, focused, visible) =>
    `2026-08-20T13:17:${time}.000Z info thread_stream_view_activity_changed active=true conversationId=${id} rendererWindowFocused=${focused} rendererWindowId=${windowId} rendererWindowVisible=${visible}`;
  fs.writeFileSync(path.join(logRoot, 'desktop.log'), [
    activity('01', 'hidden-thread', 1, false, false),
    activity('02', 'background-thread', 2, false, true),
    activity('03', 'focused-thread', 3, true, true)
  ].join('\n'));

  const watcher = new ContextWatcher({ logRoots: [logRoot], sessionRoot });
  const context = watcher.currentContext();
  assert.deepEqual(context.chats.map(chat => chat.id), ['focused-thread', 'background-thread']);
  assert.equal(context.active.id, 'focused-thread');
});
