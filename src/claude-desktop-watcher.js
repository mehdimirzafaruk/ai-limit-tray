const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { findSerializedValue } = require('./v8-value-parser');
const { normalizeRateLimits } = require('./limit-warning');

const DEFAULT_CONTEXT_LIMIT = 200_000;
const SYSTEM_CONTEXT_ESTIMATE = 3_000;

function round1(value) {
  return Math.round(value * 10) / 10;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function newestFile(root) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile()) {
        const stat = fs.statSync(filePath);
        files.push({ filePath, stat });
      }
    }
  };
  visit(root);
  return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] || null;
}

function queryName(query) {
  return Array.isArray(query?.queryKey) ? query.queryKey[0] : null;
}

function latestQuery(queries, name) {
  return queries
    .filter(query => queryName(query) === name && query?.state?.data)
    .sort((a, b) => (b.state.dataUpdatedAt || b.dehydratedAt || 0) - (a.state.dataUpdatedAt || a.dehydratedAt || 0))[0] || null;
}

function activeBranch(tree) {
  const messages = Array.isArray(tree?.chat_messages) ? tree.chat_messages : [];
  const byId = new Map(messages.filter(message => message?.uuid).map(message => [message.uuid, message]));
  const branch = [];
  const seen = new Set();
  let id = tree?.current_leaf_message_uuid;
  while (id && byId.has(id) && !seen.has(id)) {
    seen.add(id);
    const message = byId.get(id);
    branch.push(message);
    id = message.parent_message_uuid;
  }
  if (branch.length) return branch.reverse();
  return [...messages].sort((a, b) => (a.index || 0) - (b.index || 0));
}

function textTokenEstimate(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const characters = [...text].length;
  const words = text.split(/\s+/u).filter(Boolean).length;
  return Math.ceil(Math.max(characters / 4, words * 1.35));
}

function messageTokenEstimate(message) {
  let tokens = textTokenEstimate(message?.text);
  const blocks = Array.isArray(message?.content) ? message.content : [];
  if (!tokens) {
    for (const block of blocks) tokens += textTokenEstimate(block?.text || block?.thinking);
  }
  for (const block of blocks) {
    if (block?.input && typeof block.input === 'object') tokens += textTokenEstimate(JSON.stringify(block.input));
    if (block?.content && typeof block.content !== 'string') tokens += textTokenEstimate(JSON.stringify(block.content));
  }
  return tokens + 8; // Rol, sıra ve mesaj sınırı için küçük protokol payı.
}

function modelLimit(account, model) {
  const configs = Object.values(account?.model_selector_config || {});
  const chatConfig = configs.find(config => config?.id === 'chat');
  const candidates = [...(chatConfig?.models || []), ...configs.flatMap(config => config?.models || [])];
  const selected = candidates.find(candidate => candidate?.id === model);
  return numeric(selected?.hard_limit) || DEFAULT_CONTEXT_LIMIT;
}

function usageFromHistory(value) {
  const samples = Array.isArray(value?.samples) ? value.samples : [];
  const latest = samples.filter(sample => sample?.u).sort((a, b) => (b.t || 0) - (a.t || 0))[0];
  if (!latest) return { primary: null, secondary: null };
  return normalizeRateLimits({
    primary: { usedPct: latest.u.fh, windowMinutes: 300 },
    secondary: { usedPct: latest.u.sd, windowMinutes: 10080 }
  });
}

function desktopCompactionInfo(tree) {
  const messages = Array.isArray(tree?.chat_messages) ? tree.chat_messages : [];
  const boundaries = messages.filter(message =>
    message?.subtype === 'compact_boundary' ||
    message?.type === 'compact_boundary' ||
    (Array.isArray(message?.content) && message.content.some(block => block?.type === 'compact_boundary'))
  );
  const summaries = messages.filter(message => message?.isCompactSummary === true);
  const explicitCount = numeric(tree?.compactionCount ?? tree?.compaction_count);
  const compactionCount = explicitCount ?? (boundaries.length || summaries.length);
  const latest = [...boundaries, ...summaries]
    .sort((a, b) => Date.parse(b.updated_at || b.timestamp || b.created_at || 0) - Date.parse(a.updated_at || a.timestamp || a.created_at || 0))[0];
  const timestamp = Date.parse(latest?.updated_at || latest?.timestamp || latest?.created_at || '');
  return {
    compacted: compactionCount > 0,
    compactionCount: compactionCount || 0,
    compactedAt: Number.isFinite(timestamp) ? timestamp : numeric(tree?.compactedAt ?? tree?.compacted_at),
    compactionBeforeTokens: numeric(latest?.compactMetadata?.preTokens),
    compactionAfterTokens: numeric(latest?.compactMetadata?.postTokens),
    compactionSource: compactionCount > 0 ? 'conversation-marker' : null
  };
}

function conversationTreeToChat(tree, account, rateLimits, updatedAt = Date.now()) {
  if (!tree?.uuid || !Array.isArray(tree.chat_messages)) return null;
  const branch = activeBranch(tree);
  const contextLimit = modelLimit(account, tree.model);
  const usedTokens = Math.min(contextLimit, SYSTEM_CONTEXT_ESTIMATE + branch.reduce((sum, message) => sum + messageTokenEstimate(message), 0));
  const usedPct = round1(Math.min(100, (usedTokens / contextLimit) * 100));
  const remainingPct = round1(Math.max(0, 100 - usedPct));
  const attachmentCount = branch.reduce((sum, message) =>
    sum + (Array.isArray(message?.attachments) ? message.attachments.length : 0) +
      (Array.isArray(message?.files) ? message.files.length : 0), 0);
  const compaction = desktopCompactionInfo(tree);
  return {
    id: String(tree.uuid),
    source: 'claude-desktop',
    title: String(tree.name || 'Claude sohbeti'),
    model: tree.model || 'Claude',
    usedTokens,
    contextLimit,
    usedPct,
    remainingPct,
    rateLimits,
    ...compaction,
    updatedAt: numeric(tree.updated_at) || updatedAt,
    estimated: true,
    found: true,
    reason: attachmentCount ? 'Dosya içerikleri hariç tahmini context.' : 'Yerel sohbet metninden tahmini context.'
  };
}

class ClaudeDesktopWatcher {
  constructor(options = {}) {
    this.dataRoot = options.dataRoot || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude');
    this.blobRoot = options.blobRoot || path.join(this.dataRoot, 'IndexedDB', 'https_claude.ai_0.indexeddb.blob');
    this.usagePath = options.usagePath || path.join(this.dataRoot, 'plan-usage-history.json');
    this.cacheKey = null;
    this.cachedQueries = null;
    this.usageCacheKey = null;
    this.cachedRateLimits = { primary: null, secondary: null };
  }

  rateLimits() {
    try {
      const stat = fs.statSync(this.usagePath);
      const key = `${stat.size}:${stat.mtimeMs}`;
      if (key !== this.usageCacheKey) {
        this.cachedRateLimits = usageFromHistory(JSON.parse(fs.readFileSync(this.usagePath, 'utf8')));
        this.usageCacheKey = key;
      }
    } catch { /* Limit geçmişi yoksa context yine gösterilir. */ }
    return this.cachedRateLimits;
  }

  queries() {
    const newest = newestFile(this.blobRoot);
    if (!newest) return null;
    const key = `${newest.filePath}:${newest.stat.size}:${newest.stat.mtimeMs}`;
    if (key === this.cacheKey && this.cachedQueries) return this.cachedQueries;
    const cache = findSerializedValue(fs.readFileSync(newest.filePath)).value;
    const queries = Array.isArray(cache?.clientState?.queries) ? cache.clientState.queries : [];
    this.cacheKey = key;
    this.cachedQueries = { queries, updatedAt: newest.stat.mtimeMs };
    return this.cachedQueries;
  }

  currentContext(options = {}) {
    const now = options.now || Date.now();
    try {
      const cache = this.queries();
      if (!cache) throw new Error('Claude Desktop önbelleği bulunamadı');
      const treeQuery = latestQuery(cache.queries, 'chat_conversation_tree');
      if (!treeQuery) {
        return {
          source: 'claude-desktop', chats: [], active: null, checkedAt: now,
          reason: 'Claude Desktop açık; bir sohbet açıldığında context gösterilecek.'
        };
      }
      const account = latestQuery(cache.queries, 'current_account')?.state?.data || null;
      const chat = conversationTreeToChat(treeQuery.state.data, account, this.rateLimits(), treeQuery.state.dataUpdatedAt || cache.updatedAt);
      return {
        source: 'claude-desktop',
        chats: chat ? [chat] : [],
        active: chat,
        checkedAt: now,
        reason: chat ? null : 'Aktif Claude sohbetinin context verisi bekleniyor.'
      };
    } catch (error) {
      return {
        source: 'claude-desktop', chats: [], active: null, checkedAt: now,
        reason: `Claude Desktop context okunamadı: ${error.message}`
      };
    }
  }
}

module.exports = {
  ClaudeDesktopWatcher,
  activeBranch,
  conversationTreeToChat,
  desktopCompactionInfo,
  messageTokenEstimate,
  modelLimit,
  usageFromHistory
};
