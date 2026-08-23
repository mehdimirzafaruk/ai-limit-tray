const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SNAPSHOT_DIR_NAME } = require('./claude-integration');
const { normalizeRateLimits } = require('./limit-warning');

const DEFAULT_FRESH_MS = 3 * 60 * 1000;

function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function snapshotToChat(value, fileMtime = 0) {
  if (!value || value.source !== 'claude' || !value.sessionId) return null;
  const usedTokens = numeric(value.usedTokens);
  const contextLimit = numeric(value.contextLimit);
  const rawUsedPct = numeric(value.usedPct);
  const rawRemainingPct = numeric(value.remainingPct);
  const usedPct = rawUsedPct ?? (
    usedTokens != null && contextLimit > 0 ? round1(Math.min(100, (usedTokens / contextLimit) * 100)) : null
  );
  const remainingPct = rawRemainingPct ?? (usedPct == null ? null : round1(Math.max(0, 100 - usedPct)));
  return {
    id: String(value.sessionId),
    source: 'claude',
    title: String(value.title || value.sessionName || 'Claude Code oturumu'),
    model: value.model || value.modelId || 'Claude',
    usedTokens,
    contextLimit,
    usedPct,
    remainingPct,
    rateLimits: normalizeRateLimits(value.rateLimits),
    compacted: value.compacted === true || numeric(value.compactionCount) > 0,
    compactionCount: numeric(value.compactionCount) || 0,
    compactedAt: numeric(value.compactedAt),
    compactionBeforeTokens: numeric(value.compactionBeforeTokens),
    compactionAfterTokens: numeric(value.compactionAfterTokens),
    compactionSource: value.compactionSource || null,
    cwd: value.cwd || value.projectDir || null,
    updatedAt: numeric(value.updatedAt) || fileMtime,
    found: true,
    reason: usedPct == null ? 'İlk model yanıtının context verisi bekleniyor.' : null
  };
}

function foregroundScore(chat, title) {
  const normalizedTitle = String(title || '').toLocaleLowerCase('tr-TR');
  if (!normalizedTitle) return 0;
  const candidates = [chat.title, chat.cwd ? path.basename(chat.cwd) : null]
    .filter(Boolean)
    .map(value => String(value).toLocaleLowerCase('tr-TR'))
    .filter(value => value.length >= 3);
  return candidates.some(value => normalizedTitle.includes(value)) ? 1 : 0;
}

class ClaudeContextWatcher {
  constructor(options = {}) {
    this.snapshotRoot = options.snapshotRoot || path.join(os.homedir(), '.claude', SNAPSHOT_DIR_NAME);
    this.freshMs = options.freshMs || DEFAULT_FRESH_MS;
  }

  currentContext(options = {}) {
    const now = options.now || Date.now();
    let entries = [];
    try { entries = fs.readdirSync(this.snapshotRoot, { withFileTypes: true }); }
    catch {
      return {
        source: 'claude', chats: [], active: null, checkedAt: now,
        reason: 'Claude Code context köprüsü ilk veriyi bekliyor.'
      };
    }
    const chats = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = path.join(this.snapshotRoot, entry.name);
      try {
        const stat = fs.statSync(filePath);
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const chat = snapshotToChat(value, stat.mtimeMs);
        if (chat && now - (chat.updatedAt || stat.mtimeMs) <= this.freshMs) chats.push(chat);
      } catch { /* Yarım yazılmış veya eski dosyayı yok say. */ }
    }
    chats.sort((a, b) =>
      foregroundScore(b, options.foregroundTitle) - foregroundScore(a, options.foregroundTitle) ||
      (b.updatedAt || 0) - (a.updatedAt || 0)
    );
    return {
      source: 'claude',
      chats,
      active: chats[0] || null,
      checkedAt: now,
      reason: chats.length ? null : 'Claude Code açık; canlı context verisi bekleniyor.'
    };
  }
}

module.exports = { ClaudeContextWatcher, snapshotToChat, foregroundScore };
