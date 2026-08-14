const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function readToken(home) {
  const candidates = [path.join(home, '.credentials.json'), path.join(home, 'credentials.json')];
  for (const file of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      return json.claudeAiOauth?.accessToken || json.accessToken || json.access_token;
    } catch { /* next */ }
  }
  return null;
}

async function usage(home) {
  const token = readToken(home);
  if (!token) throw new Error('Claude oturumu bulunamadı; önce Bağla deyin.');
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' }
  });
  if (!response.ok) throw new Error(`Claude limit servisi ${response.status} döndürdü`);
  return response.json();
}

function login(home) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    const child = spawn(command, ['auth', 'login'], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: home }, detached: true,
      shell: process.platform === 'win32', stdio: 'ignore', windowsHide: false
    });
    child.on('error', reject);
    child.unref(); resolve({ started: true });
  });
}

module.exports = { usage, login };
