const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

test('ayarları atomik yazar ve yeniden okur', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  const value = { refreshMinutes: 15, codex: [{ id: '1' }], claude: [], stickyHover: false, contextOverlay: true };
  store.write(value);
  assert.deepEqual(store.read(), value);
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
});

test('bozuk alanları güvenli varsayılanlarla düzeltir', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  fs.writeFileSync(store.file, JSON.stringify({ refreshMinutes: 'x', codex: null, claude: {}, stickyHover: 'yes', contextOverlay: 1 }));
  assert.deepEqual(store.read(), { refreshMinutes: 5, codex: [], claude: [], stickyHover: true, contextOverlay: true });
});

test('profil yolu kullanıcı veri klasörünün dışına taşamaz', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  assert.throws(() => store.profileDir('codex', '..\\outside'), /Geçersiz profil yolu/);
  assert.throws(() => store.profileDir('other', 'safe'), /Geçersiz profil yolu/);
});
