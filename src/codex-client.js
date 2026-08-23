const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TOKEN_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const AUTH_RECOVERY_INTERVAL_MS = 15 * 60 * 1000;

function isAuthError(error) {
  return /token[_ ]invalidated|authentication token has been invalidated|401|unauthorized/i.test(String(error?.message || ''));
}

function codexBinary() {
  const triple = process.platform === 'win32'
    ? (process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc')
    : null;
  if (triple) {
    try {
      const root = path.dirname(require.resolve(`@openai/codex-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}/package.json`));
      let candidate = path.join(root, 'vendor', triple, 'bin', 'codex.exe');
      if (candidate.includes('app.asar')) candidate = candidate.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* PATH fallback */ }
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

class CodexClient {
  constructor(home) {
    this.home = home;
    fs.mkdirSync(home, { recursive: true });
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  start() {
    if (this.child) return;
    const child = spawn(codexBinary(), ['app-server'], {
      env: { ...process.env, CODEX_HOME: this.home },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this.onMessage(JSON.parse(line)); } catch { /* diagnostics may be non-JSON */ }
      }
    });
    // App-server tanı çıktısı zamanla pipe tamponunu doldurup süreci kilitlemesin.
    child.stderr.resume();
    const finish = error => {
      if (this.child !== child) return;
      this.child = null;
      this.initialized = false;
      this.initializing = null;
      for (const { reject } of this.pending.values()) reject(error || new Error('Codex app-server kapandı'));
      this.pending.clear();
    };
    child.on('error', error => finish(new Error(`Codex app-server başlatılamadı: ${error.message}`)));
    child.on('exit', () => finish(new Error('Codex app-server kapandı')));
  }

  onMessage(message) {
    if (message.id != null && this.pending.has(message.id)) {
      const call = this.pending.get(message.id); this.pending.delete(message.id);
      return message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
    }
    for (const listener of this.listeners) listener(message);
  }

  request(method, params, timeoutMs = 30000) {
    this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} zaman aşımı`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      const message = { jsonrpc: '2.0', id, method };
      if (params !== undefined) message.params = params;
      this.child.stdin.write(`${JSON.stringify(message)}\n`, error => {
        if (!error || !this.pending.has(id)) return;
        const call = this.pending.get(id);
        this.pending.delete(id);
        call.reject(new Error(`${method} gönderilemedi: ${error.message}`));
      });
    });
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.initializing) {
      this.initializing = (async () => {
        await this.request('initialize', { clientInfo: { name: 'ai-limit-tray', title: 'AI Limit Tray', version: '0.1.0' } });
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
        this.initialized = true;
      })().finally(() => { this.initializing = null; });
    }
    return this.initializing;
  }

  async login() {
    await this.initialize();
    const result = await this.request('account/login/start', { type: 'chatgpt' });
    return result;
  }

  async account(refreshToken = true) {
    await this.initialize();
    return this.request('account/read', { refreshToken });
  }

  async limits() {
    await this.initialize();
    return this.request('account/rateLimits/read');
  }

  async usage() {
    // Token yenilemesi limit isteğinden önce tamamlanmalı. Paralel çağrı eski erişim
    // tokenı ile yarışıp profili hatalı biçimde oturum dışı gösterebiliyordu.
    const refreshToken = this.tokenRefreshDue();
    const account = await this.account(refreshToken);
    if (refreshToken) this.lastRefreshAttemptAt = Date.now();
    try {
      const limits = await this.limits();
      this.lastAuthRecoveryAt = null;
      return { account, limits };
    } catch (error) {
      // Planlı yenileme zamanı gelmeden token sunucu tarafında iptal edilmişse bir
      // kez zorla yenileyip limit isteğini tekrar dene. Sunucu refresh tokenını
      // tamamen iptal ettiyse her dakika OAuth servisini gereksiz yere çağırma.
      if (!isAuthError(error)) throw error;
      const now = Date.now();
      if (refreshToken) {
        this.lastAuthRecoveryAt = now;
        throw error;
      }
      if (this.lastAuthRecoveryAt && now - this.lastAuthRecoveryAt < AUTH_RECOVERY_INTERVAL_MS) throw error;
      const refreshedAccount = await this.account(true);
      this.lastRefreshAttemptAt = now;
      this.lastAuthRecoveryAt = now;
      const limits = await this.limits();
      this.lastAuthRecoveryAt = null;
      return { account: refreshedAccount, limits };
    }
  }

  tokenRefreshDue(now = Date.now()) {
    if (this.lastRefreshAttemptAt) return now - this.lastRefreshAttemptAt >= TOKEN_REFRESH_INTERVAL_MS;
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(this.home, 'auth.json'), 'utf8'));
      const lastRefresh = Date.parse(auth.last_refresh);
      return !Number.isFinite(lastRefresh) || now - lastRefresh >= TOKEN_REFRESH_INTERVAL_MS;
    } catch {
      return true;
    }
  }

  async thread(threadId) {
    await this.initialize();
    const result = await this.request('thread/read', { threadId, includeTurns: false }, 5000);
    return result?.thread || null;
  }

  close() { if (this.child) this.child.kill(); }
}

module.exports = { CodexClient, isAuthError, TOKEN_REFRESH_INTERVAL_MS, AUTH_RECOVERY_INTERVAL_MS };
