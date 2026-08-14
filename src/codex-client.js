const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

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
    this.child = spawn(codexBinary(), ['app-server'], {
      env: { ...process.env, CODEX_HOME: this.home },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let buffer = '';
    this.child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { this.onMessage(JSON.parse(line)); } catch { /* diagnostics may be non-JSON */ }
      }
    });
    this.child.on('exit', () => {
      this.child = null;
      this.initialized = false;
      this.initializing = null;
      for (const { reject } of this.pending.values()) reject(new Error('Codex app-server kapandı'));
      this.pending.clear();
    });
  }

  onMessage(message) {
    if (message.id != null && this.pending.has(message.id)) {
      const call = this.pending.get(message.id); this.pending.delete(message.id);
      return message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
    }
    for (const listener of this.listeners) listener(message);
  }

  request(method, params) {
    this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} zaman aşımı`)); }, 30000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      const message = { jsonrpc: '2.0', id, method };
      if (params !== undefined) message.params = params;
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
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

  async account() {
    await this.initialize();
    return this.request('account/read', { refreshToken: false });
  }

  async limits() {
    await this.initialize();
    return this.request('account/rateLimits/read');
  }

  close() { if (this.child) this.child.kill(); }
}

module.exports = { CodexClient };
