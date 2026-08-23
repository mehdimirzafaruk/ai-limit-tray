const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { statuslineSnapshot, transcriptCompactionFromLines } = require('../src/claude-statusline-bridge.cjs');
const { ClaudeContextWatcher, snapshotToChat } = require('../src/claude-context-watcher');

test('Claude statusLine context yüzdesini resmi input-only alanlarından alır', () => {
  const snapshot = statuslineSnapshot({
    session_id: 'session-1',
    session_name: 'Aktif iş',
    cwd: 'C:\\work\\project',
    model: { id: 'claude-sonnet-test', display_name: 'Sonnet' },
    context_window: {
      total_input_tokens: 15_500,
      total_output_tokens: 1_200,
      context_window_size: 200_000,
      used_percentage: 7.75,
      remaining_percentage: 92.25,
      current_usage: {
        input_tokens: 8_500,
        cache_creation_input_tokens: 5_000,
        cache_read_input_tokens: 2_000,
        output_tokens: 1_200
      }
    },
    rate_limits: {
      five_hour: { used_percentage: 84, resets_at: 5000 },
      seven_day: { used_percentage: 93, resets_at: 9000 }
    }
  }, 1234);
  assert.equal(snapshot.usedTokens, 15_500);
  assert.equal(snapshot.contextLimit, 200_000);
  assert.equal(snapshot.usedPct, 7.75);
  assert.equal(snapshot.remainingPct, 92.25);
  assert.equal(snapshot.model, 'Sonnet');
  assert.equal(snapshot.updatedAt, 1234);
  assert.equal(snapshot.rateLimits.primary.remainingPct, 16);
  assert.equal(snapshot.rateLimits.secondary.remainingPct, 7);
});

test('yüzde gelmezse cache dahil input tokenlarından hesaplar, output tokenını katmaz', () => {
  const snapshot = statuslineSnapshot({
    session_id: 'session-2',
    context_window: {
      context_window_size: 200_000,
      current_usage: {
        input_tokens: 10_000,
        cache_creation_input_tokens: 20_000,
        cache_read_input_tokens: 10_000,
        output_tokens: 50_000
      }
    }
  });
  assert.equal(snapshot.usedTokens, 40_000);
  assert.equal(snapshot.usedPct, 20);
  assert.equal(snapshot.remainingPct, 80);
});

test('Claude watcher taze oturumları seçer ve pencere başlığıyla eşleşeni öne alır', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-claude-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  write('latest.json', {
    source: 'claude', sessionId: 'latest', title: 'Başka Proje', cwd: 'C:\\work\\other',
    model: 'Opus', usedTokens: 50_000, contextLimit: 200_000, remainingPct: 75, updatedAt: now
  });
  write('matched.json', {
    source: 'claude', sessionId: 'matched', title: 'AI Limit Tray', cwd: 'C:\\work\\ai-limit-tray',
    model: 'Sonnet', usedTokens: 80_000, contextLimit: 200_000, remainingPct: 60, updatedAt: now - 1000
  });
  write('stale.json', {
    source: 'claude', sessionId: 'stale', title: 'Eski', usedTokens: 1, contextLimit: 200_000,
    remainingPct: 100, updatedAt: now - 10_000
  });
  const watcher = new ClaudeContextWatcher({ snapshotRoot: root, freshMs: 5_000 });
  const context = watcher.currentContext({ now, foregroundTitle: 'Claude Code — AI Limit Tray' });
  assert.deepEqual(context.chats.map(chat => chat.id), ['matched', 'latest']);
  assert.equal(context.active.source, 'claude');
});

test('eksik yüzdeli normalize Claude kaydında oranı tokenlardan türetir', () => {
  const chat = snapshotToChat({
    source: 'claude', sessionId: 'derive', title: 'Test', usedTokens: 20_000, contextLimit: 200_000,
    rateLimits: { primary: { usedPct: 85, label: '5 saatlik' } }
  });
  assert.equal(chat.usedPct, 10);
  assert.equal(chat.remainingPct, 90);
  assert.equal(chat.rateLimits.primary.remainingPct, 15);
});

test('Claude Code compact boundary kaydını context durumuna dönüştürür', () => {
  const compact = transcriptCompactionFromLines([
    JSON.stringify({
      type: 'system', subtype: 'compact_boundary', timestamp: '2026-08-23T15:33:22.175Z',
      compactMetadata: { preTokens: 185_000, postTokens: 21_000 }
    })
  ]);
  assert.equal(compact.compacted, true);
  assert.equal(compact.compactionCount, 1);
  assert.equal(compact.compactionBeforeTokens, 185_000);
  assert.equal(compact.compactionAfterTokens, 21_000);
});

test('Claude snapshot compact bilgisini gösterge kartına taşır', () => {
  const chat = snapshotToChat({
    source: 'claude', sessionId: 'compact-session', usedTokens: 30_000, contextLimit: 200_000,
    compacted: true, compactionCount: 2, compactedAt: 1234,
    compactionBeforeTokens: 185_000, compactionAfterTokens: 21_000
  });
  assert.equal(chat.compacted, true);
  assert.equal(chat.compactionCount, 2);
  assert.equal(chat.compactionBeforeTokens, 185_000);
  assert.equal(chat.compactionAfterTokens, 21_000);
});
