const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONFIG_FILE = path.join(__dirname, 'ai-limit-tray-statusline.config.json');
const SNAPSHOT_DIR = path.join(__dirname, 'ai-limit-tray-context');
const TRANSCRIPT_INITIAL_SCAN_BYTES = 64 * 1024 * 1024;
const TRANSCRIPT_UPDATE_SCAN_BYTES = 4 * 1024 * 1024;

function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function safeFilePart(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 160);
}

function statuslineRateLimit(value, label, windowMinutes) {
  if (!value || typeof value !== 'object') return null;
  const usedPct = numeric(value.used_percentage ?? value.usedPercentage ?? value.utilization);
  const explicitRemaining = numeric(value.remaining_percentage ?? value.remainingPercentage);
  const remainingPct = explicitRemaining ?? (usedPct == null ? null : round1(Math.max(0, 100 - usedPct)));
  if (usedPct == null && remainingPct == null) return null;
  return {
    label,
    windowMinutes,
    usedPct: usedPct ?? round1(Math.max(0, 100 - remainingPct)),
    remainingPct,
    resetsAt: value.resets_at ?? value.resetsAt ?? null
  };
}

function statuslineSnapshot(input, now = Date.now()) {
  const sessionId = String(input?.session_id || '').trim();
  if (!sessionId) return null;
  const context = input?.context_window || {};
  const current = context.current_usage || {};
  const components = [current.input_tokens, current.cache_creation_input_tokens, current.cache_read_input_tokens]
    .map(numeric);
  const componentTotal = components.some(value => value != null)
    ? components.reduce((total, value) => total + (value || 0), 0)
    : null;
  const usedTokens = numeric(context.total_input_tokens) ?? componentTotal;
  const contextLimit = numeric(context.context_window_size);
  const rawUsedPct = numeric(context.used_percentage);
  const rawRemainingPct = numeric(context.remaining_percentage);
  const usedPct = rawUsedPct ?? (
    usedTokens != null && contextLimit > 0 ? round1(Math.min(100, (usedTokens / contextLimit) * 100)) : null
  );
  const remainingPct = rawRemainingPct ?? (usedPct == null ? null : round1(Math.max(0, 100 - usedPct)));
  const cwd = input?.workspace?.current_dir || input?.cwd || null;
  const projectDir = input?.workspace?.project_dir || cwd;
  const rateLimits = input?.rate_limits || {};
  return {
    schemaVersion: 1,
    source: 'claude',
    sessionId,
    sessionName: input?.session_name || null,
    title: input?.session_name || (projectDir ? path.basename(projectDir) : null) || 'Claude Code oturumu',
    cwd,
    projectDir,
    transcriptPath: input?.transcript_path || null,
    model: input?.model?.display_name || input?.model?.id || null,
    modelId: input?.model?.id || null,
    usedTokens,
    contextLimit,
    usedPct,
    remainingPct,
    rateLimits: {
      primary: statuslineRateLimit(rateLimits.five_hour || rateLimits.fiveHour, '5 saatlik', 300),
      secondary: statuslineRateLimit(rateLimits.seven_day || rateLimits.sevenDay, 'Haftalık', 10080)
    },
    updatedAt: now,
    terminal: {
      wtSession: process.env.WT_SESSION || null,
      termProgram: process.env.TERM_PROGRAM || null
    }
  };
}

function transcriptCompactionFromLines(lines, previous = {}) {
  const previousAt = numeric(previous.compactedAt);
  let compactionCount = numeric(previous.compactionCount) || 0;
  let compactedAt = previousAt;
  let compactionBeforeTokens = numeric(previous.compactionBeforeTokens);
  let compactionAfterTokens = numeric(previous.compactionAfterTokens);
  const events = [];
  for (const line of lines) {
    if (!/"subtype"\s*:\s*"compact_boundary"/.test(line)) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'system' || entry?.subtype !== 'compact_boundary') continue;
    const timestamp = Date.parse(entry.timestamp);
    events.push({
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      preTokens: numeric(entry?.compactMetadata?.preTokens),
      postTokens: numeric(entry?.compactMetadata?.postTokens)
    });
  }
  events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const newEvents = previousAt == null ? events : events.filter(event => event.timestamp != null && event.timestamp > previousAt);
  if (previousAt == null) compactionCount = Math.max(compactionCount, events.length);
  else compactionCount += newEvents.length;
  const latest = newEvents.at(-1) || (previousAt == null ? events.at(-1) : null);
  if (latest) {
    compactedAt = latest.timestamp ?? compactedAt;
    compactionBeforeTokens = latest.preTokens ?? compactionBeforeTokens;
    compactionAfterTokens = latest.postTokens ?? compactionAfterTokens;
  }
  return {
    compacted: compactionCount > 0,
    compactionCount,
    compactedAt,
    compactionBeforeTokens,
    compactionAfterTokens,
    compactionSource: compactionCount > 0 ? 'transcript-boundary' : null
  };
}

function transcriptCompaction(transcriptPath, previous = {}) {
  if (!transcriptPath) return transcriptCompactionFromLines([], previous);
  try {
    const stat = fs.statSync(transcriptPath);
    const maxBytes = previous.compactionCount ? TRANSCRIPT_UPDATE_SCAN_BYTES : TRANSCRIPT_INITIAL_SCAN_BYTES;
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(transcriptPath, 'r');
    let text;
    try {
      const buffer = Buffer.alloc(stat.size - start);
      if (buffer.length) fs.readSync(fd, buffer, 0, buffer.length, start);
      text = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    const lines = text.split(/\r?\n/);
    if (start > 0) lines.shift();
    return transcriptCompactionFromLines(lines, previous);
  } catch {
    return transcriptCompactionFromLines([], previous);
  }
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function saveSnapshot(input) {
  const snapshot = statuslineSnapshot(input);
  if (!snapshot) return;
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const outputPath = path.join(SNAPSHOT_DIR, `${safeFilePart(snapshot.sessionId)}.json`);
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch { /* İlk durum kaydı. */ }
  Object.assign(snapshot, transcriptCompaction(snapshot.transcriptPath, previous));
  atomicWrite(
    outputPath,
    JSON.stringify(snapshot)
  );

  // Kapanmış oturumların küçük durum dosyalarını sınırsız biriktirme.
  if (Math.random() < 0.02) {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const name of fs.readdirSync(SNAPSHOT_DIR)) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(SNAPSHOT_DIR, name);
      try { if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true }); } catch { /* En iyi çaba. */ }
    }
  }
}

function originalCommand() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const command = String(config?.originalStatusLine?.command || '').trim();
    return /ai-limit-tray-statusline[.]cjs/i.test(command) ? '' : command;
  } catch {
    return '';
  }
}

function findGitBash() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : null
  ].filter(Boolean);
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function forwardToOriginal(command, rawInput) {
  if (!command) return Promise.resolve(0);
  return new Promise(resolve => {
    const gitBash = findGitBash();
    const child = gitBash ? spawn(gitBash, ['-lc', command], {
      windowsHide: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    }) : spawn(command, {
      shell: true,
      windowsHide: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('error', () => resolve(1));
    child.on('exit', code => resolve(Number.isInteger(code) ? code : 0));
    child.stdin.end(rawInput);
  });
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const rawInput = Buffer.concat(chunks).toString('utf8');
  try { saveSnapshot(JSON.parse(rawInput)); } catch { /* Claude Code akışını bozma. */ }
  process.exitCode = await forwardToOriginal(originalCommand(), rawInput);
}

if (require.main === module) main().catch(() => { process.exitCode = 0; });

module.exports = { findGitBash, statuslineSnapshot, transcriptCompaction, transcriptCompactionFromLines };
