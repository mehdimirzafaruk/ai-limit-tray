const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureClaudeStatuslineIntegration } = require('../src/claude-integration');

test('Claude statusLine köprüsü mevcut komutu korur ve tekrar kurulumda zincirlemez', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-claude-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.cjs');
  fs.writeFileSync(sourcePath, '/* bridge */\n');
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    theme: 'dark',
    statusLine: { type: 'command', command: 'bash ~/.claude/existing.sh', refreshInterval: 60, padding: 2 }
  }));

  const first = ensureClaudeStatuslineIntegration({ claudeRoot: root, sourcePath });
  const installed = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'ai-limit-tray-statusline.config.json'), 'utf8'));
  assert.equal(first.installed, true);
  assert.match(installed.statusLine.command, /ai-limit-tray-statusline[.]cjs/);
  assert.equal(installed.statusLine.refreshInterval, 5);
  assert.equal(installed.statusLine.padding, 2);
  assert.equal(config.originalStatusLine.command, 'bash ~/.claude/existing.sh');
  assert.equal(installed.theme, 'dark');

  ensureClaudeStatuslineIntegration({ claudeRoot: root, sourcePath });
  const secondConfig = JSON.parse(fs.readFileSync(path.join(root, 'ai-limit-tray-statusline.config.json'), 'utf8'));
  assert.equal(secondConfig.originalStatusLine.command, 'bash ~/.claude/existing.sh');
});
