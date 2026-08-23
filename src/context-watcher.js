// Codex Desktop'ta gerçekten açık olan sohbetleri ve bu sohbetlerin context doluluğunu izler.
// Kullanım kotası (normalize.js) ile sohbet context'i farklı kavramlardır:
// bu modül yalnızca açık sohbetin son model çağrısındaki context yükünü gösterir.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SESSION_TAIL_BYTES = 768 * 1024;
const LOG_TAIL_BYTES = 8 * 1024 * 1024;
const LOG_DISCOVERY_INTERVAL_MS = 3000;
const COMPACTION_SCAN_BYTES = 64 * 1024 * 1024;
// Codex TUI, sabit sistem/tool yükünü kullanıcının doldurabildiği alandan çıkarır.
// Böylece ilk turdaki kaçınılmaz başlangıç yükü yüzdeyi yapay olarak düşürmez.
const CODEX_BASELINE_TOKENS = 12_000;

function round1(value) {
  return Math.round(value * 10) / 10;
}

function readRange(filePath, start, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.max(0, length));
    if (buffer.length) fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readTailLines(filePath, maxBytes = SESSION_TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const text = readRange(filePath, start, stat.size - start);
  const lines = text.split(/\r?\n/);
  if (start > 0) lines.shift();
  return lines.map(line => line.trim()).filter(Boolean);
}

function parseActivityLine(line, sequence = 0) {
  if (!line.includes('thread_stream_view_activity_changed')) return null;
  const value = key => line.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`))?.[1] ?? null;
  const active = value('active');
  const threadId = value('conversationId');
  const windowId = value('rendererWindowId');
  if (!/^(true|false)$/.test(active || '') || !threadId || !windowId) return null;
  const timestamp = Date.parse(line.split(/\s+/, 1)[0]);
  return {
    active: active === 'true',
    threadId,
    windowId,
    focused: value('rendererWindowFocused') === 'true',
    visible: value('rendererWindowVisible') !== 'false',
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    sequence
  };
}

function reduceActivityEvents(events) {
  const windows = new Map();
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
  for (const event of ordered) {
    if (event.active) {
      windows.set(String(event.windowId), { ...event });
    } else if (windows.get(String(event.windowId))?.threadId === event.threadId) {
      windows.delete(String(event.windowId));
    }
  }
  return [...windows.values()].sort((a, b) => Number(b.focused) - Number(a.focused) || b.timestamp - a.timestamp);
}

function codexUsageFromLines(lines) {
  let tokenInfo = null;
  let model = null;
  let latestModel = null;
  for (let index = lines.length - 1; index >= 0; index--) {
    let entry;
    try { entry = JSON.parse(lines[index]); } catch { continue; }
    if (!tokenInfo && entry?.type === 'event_msg' && entry?.payload?.type === 'token_count') {
      tokenInfo = entry.payload.info || null;
    }
    if (entry?.type === 'turn_context' && entry?.payload?.model) {
      latestModel ||= entry.payload.model;
      // Yeni bir turn_context, önceki turun token_count kaydından sonra yazılmış olabilir.
      // Modeli yalnızca seçilen token_count kaydının öncesindeki turdan eşleştir.
      if (tokenInfo && !model) model = entry.payload.model;
    }
    if (tokenInfo && model) break;
  }
  if (!tokenInfo) model = latestModel;

  // total_token_usage oturumun ömür boyu faturalama toplamıdır ve compaction sonrası da büyür.
  // Context doluluğu için son model çağrısının tam giriş/çıkış yükü kullanılmalıdır.
  const numeric = value => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const rawUsed = numeric(tokenInfo?.last_token_usage?.total_tokens);
  const rawLimit = numeric(tokenInfo?.model_context_window);
  const hasUsed = rawUsed != null && rawUsed >= 0;
  const hasLimit = rawLimit != null && rawLimit > 0;
  const baseline = hasLimit && rawLimit > CODEX_BASELINE_TOKENS ? CODEX_BASELINE_TOKENS : 0;
  const used = hasUsed ? Math.max(0, rawUsed - baseline) : null;
  const limit = hasLimit ? rawLimit - baseline : null;
  const usedPct = used != null && limit > 0 ? round1(Math.min(100, (used / limit) * 100)) : null;
  return {
    model,
    usedTokens: used,
    contextLimit: limit,
    rawUsedTokens: hasUsed ? rawUsed : null,
    rawContextLimit: hasLimit ? rawLimit : null,
    baselineTokens: hasLimit ? baseline : null,
    usedPct,
    remainingPct: usedPct == null ? null : round1(Math.max(0, 100 - usedPct))
  };
}

function codexCompactionFromLines(lines, previous = {}) {
  let compactionCount = Number(previous.compactionCount) || 0;
  let compactedAt = Number(previous.compactedAt) || null;
  for (const line of lines) {
    if (!/"type"\s*:\s*"compacted"/.test(line)) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'compacted') continue;
    const windowNumber = Number(entry?.payload?.window_number);
    compactionCount = Number.isFinite(windowNumber) && windowNumber > 0
      ? Math.max(compactionCount, windowNumber)
      : compactionCount + 1;
    const timestamp = Date.parse(entry.timestamp);
    if (Number.isFinite(timestamp)) compactedAt = Math.max(compactedAt || 0, timestamp);
  }
  return {
    compacted: compactionCount > 0,
    compactionCount,
    compactedAt,
    compactionSource: compactionCount > 0 ? 'session-event' : null
  };
}

function listFilesRecursive(root, predicate, depth = 0) {
  if (depth > 8) return [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath, predicate, depth + 1));
    else if (entry.isFile() && predicate(entry.name)) {
      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch { /* Dosya tarama sırasında kaybolmuş olabilir. */ }
    }
  }
  return files;
}

function defaultLogRoots(localAppData = process.env.LOCALAPPDATA || '') {
  const roots = [path.join(localAppData, 'Codex', 'Logs')];
  const packagesRoot = path.join(localAppData, 'Packages');
  let packages = [];
  try { packages = fs.readdirSync(packagesRoot, { withFileTypes: true }); } catch { /* MSIX kurulumu olmayabilir. */ }
  for (const entry of packages) {
    if (entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name)) {
      roots.push(path.join(packagesRoot, entry.name, 'LocalCache', 'Local', 'Codex', 'Logs'));
    }
  }
  return [...new Set(roots)].filter(root => fs.existsSync(root));
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || null;
}

class ContextWatcher {
  constructor(options = {}) {
    this.sessionRoot = options.sessionRoot || path.join(os.homedir(), '.codex', 'sessions');
    this.useDefaultLogRoots = !Object.prototype.hasOwnProperty.call(options, 'logRoots');
    this.logRoots = options.logRoots || defaultLogRoots(options.localAppData);
    this.activityByWindow = new Map();
    this.logOffsets = new Map();
    this.logRemainders = new Map();
    this.sessionFiles = new Map();
    this.threadModels = new Map();
    this.modelLookupAttempts = new Map();
    this.compactionTrackers = new Map();
    this.desktopProcessIds = [];
    this.lastLogDiscoveryAt = 0;
    this.logFiles = [];
    this.sequence = 0;
  }

  discoverLogs(now = Date.now()) {
    if (this.logFiles.length && now - this.lastLogDiscoveryAt < LOG_DISCOVERY_INTERVAL_MS) return;
    this.lastLogDiscoveryAt = now;
    if (this.useDefaultLogRoots) this.logRoots = [...new Set([...this.logRoots, ...defaultLogRoots()])];
    let files = this.logRoots.flatMap(root => listFilesRecursive(root, name => name.endsWith('.log')));
    if (this.desktopProcessIds.length) {
      const currentProcessFiles = files.filter(file => this.desktopProcessIds.some(id => path.basename(file.path).includes(`-${id}-`)));
      if (currentProcessFiles.length) files = currentProcessFiles;
    }
    this.logFiles = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 6).sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  setDesktopProcessIds(ids = []) {
    const values = Array.isArray(ids) ? ids : [ids];
    const next = [...new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
    if (next.length === this.desktopProcessIds.length && next.every((id, index) => id === this.desktopProcessIds[index])) return;
    this.desktopProcessIds = next;
    this.resetActivity();
    this.logFiles = [];
    this.lastLogDiscoveryAt = 0;
  }

  resetActivity() {
    this.activityByWindow.clear();
  }

  applyActivity(event) {
    const key = String(event.windowId);
    if (event.active) this.activityByWindow.set(key, event);
    else if (this.activityByWindow.get(key)?.threadId === event.threadId) this.activityByWindow.delete(key);
  }

  refreshActivity(now = Date.now()) {
    this.discoverLogs(now);
    const pendingEvents = [];
    for (const file of this.logFiles) {
      let currentSize;
      try { currentSize = fs.statSync(file.path).size; } catch { continue; }
      let start = this.logOffsets.get(file.path);
      const continuing = Number.isFinite(start) && currentSize >= start;
      if (!continuing) {
        start = Math.max(0, currentSize - LOG_TAIL_BYTES);
        this.logRemainders.delete(file.path);
      }
      if (currentSize <= start) continue;
      let text;
      try { text = readRange(file.path, start, currentSize - start); }
      catch { continue; }
      if (continuing) text = `${this.logRemainders.get(file.path) || ''}${text}`;
      const lines = text.split(/\r?\n/);
      const remainder = lines.pop() || '';
      this.logRemainders.set(file.path, remainder);
      if (!continuing && start > 0) lines.shift();
      for (const line of lines) {
        const event = parseActivityLine(line, ++this.sequence);
        if (event) pendingEvents.push(event);
      }
      // Codex son log kaydını yeni satır koymadan açık tutabiliyor. Gerekli alanları
      // tamamlanmışsa şimdi uygula; parça büyürse sonraki okumada tam hali tekrar uygulanır.
      const tentativeEvent = parseActivityLine(remainder, this.sequence + 1);
      if (tentativeEvent) {
        this.sequence += 1;
        pendingEvents.push(tentativeEvent);
      }
      this.logOffsets.set(file.path, currentSize);
    }
    pendingEvents
      .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence)
      .forEach(event => this.applyActivity(event));
  }

  findSessionFile(threadId) {
    const cached = this.sessionFiles.get(threadId);
    if (cached && fs.existsSync(cached)) return cached;
    const candidates = listFilesRecursive(this.sessionRoot, name => name.endsWith('.jsonl') && name.includes(threadId));
    const file = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path || null;
    if (file) this.sessionFiles.set(threadId, file);
    return file;
  }

  sessionCompaction(filePath) {
    let tracker = this.compactionTrackers.get(filePath);
    let stat;
    try { stat = fs.statSync(filePath); }
    catch { return codexCompactionFromLines([]); }
    if (!tracker || stat.size < tracker.offset) {
      const start = Math.max(0, stat.size - COMPACTION_SCAN_BYTES);
      tracker = { offset: start, remainder: '', skipFirstLine: start > 0, ...codexCompactionFromLines([]) };
    }
    if (stat.size <= tracker.offset) return tracker;
    let text;
    try { text = `${tracker.remainder || ''}${readRange(filePath, tracker.offset, stat.size - tracker.offset)}`; }
    catch { return tracker; }
    const lines = text.split(/\r?\n/);
    tracker.remainder = lines.pop() || '';
    if (tracker.skipFirstLine) {
      lines.shift();
      tracker.skipFirstLine = false;
    }
    Object.assign(tracker, codexCompactionFromLines(lines, tracker));
    tracker.offset = stat.size;
    this.compactionTrackers.set(filePath, tracker);
    return tracker;
  }

  threadSnapshot(view) {
    const filePath = this.findSessionFile(view.threadId);
    if (!filePath) {
      return {
        id: view.threadId,
        source: 'codex',
        title: null,
        found: false,
        reason: 'Sohbet dosyası henüz bulunamadı.',
        windowId: view.windowId,
        windowFocused: view.focused,
        windowVisible: view.visible,
        viewUpdatedAt: view.timestamp
      };
    }
    try {
      const stat = fs.statSync(filePath);
      const usage = codexUsageFromLines(readTailLines(filePath));
      const compaction = this.sessionCompaction(filePath);
      if (usage.model) this.threadModels.set(view.threadId, usage.model);
      else usage.model = this.threadModels.get(view.threadId) || null;
      const lastModelAttempt = this.modelLookupAttempts.get(view.threadId) || 0;
      if (!usage.model && Date.now() - lastModelAttempt > 30000) {
        this.modelLookupAttempts.set(view.threadId, Date.now());
        const expanded = codexUsageFromLines(readTailLines(filePath, Math.min(stat.size, 8 * 1024 * 1024)));
        if (expanded.model) {
          usage.model = expanded.model;
          this.threadModels.set(view.threadId, expanded.model);
        }
      }
      return {
        id: view.threadId,
        source: 'codex',
        title: null,
        found: true,
        ...usage,
        compacted: compaction.compacted,
        compactionCount: compaction.compactionCount,
        compactedAt: compaction.compactedAt,
        compactionSource: compaction.compactionSource,
        updatedAt: stat.mtimeMs,
        windowId: view.windowId,
        windowFocused: view.focused,
        windowVisible: view.visible,
        viewUpdatedAt: view.timestamp
      };
    } catch (error) {
      return {
        id: view.threadId,
        source: 'codex',
        title: null,
        found: false,
        reason: firstLine(error.message) || 'Context verisi okunamadı.',
        windowId: view.windowId,
        windowFocused: view.focused,
        windowVisible: view.visible,
        viewUpdatedAt: view.timestamp
      };
    }
  }

  currentContext() {
    this.refreshActivity();
    const views = [...this.activityByWindow.values()]
      .filter(view => view.active && view.visible)
      .sort((a, b) => Number(b.focused) - Number(a.focused) || b.timestamp - a.timestamp);

    // Aynı sohbet iki pencerede görünüyorsa panelde yalnızca bir kez göster.
    const seen = new Set();
    const chats = [];
    for (const view of views) {
      if (seen.has(view.threadId)) continue;
      seen.add(view.threadId);
      chats.push(this.threadSnapshot(view));
    }
    return {
      chats,
      active: chats[0] || null,
      checkedAt: Date.now(),
      reason: chats.length ? null : 'Codex masaüstünde açık sohbet algılanmadı.'
    };
  }
}

module.exports = {
  ContextWatcher,
  codexCompactionFromLines,
  codexUsageFromLines,
  defaultLogRoots,
  parseActivityLine,
  reduceActivityEvents
};
