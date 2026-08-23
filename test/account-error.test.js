const test = require('node:test');
const assert = require('node:assert/strict');
const { accountErrorText } = require('../src/account-error');

test('ham Codex 401 hatasını arka plan koruma durumuna çevirir', () => {
  const error = new Error('failed to fetch codex rate limits: GET https://chatgpt.com/backend-api/wham/usage failed: 401 Unauthorized; token_invalidated');
  assert.equal(accountErrorText('codex', error), 'Oturum arka planda korunuyor');
});

test('geçici ağ hatasında hesabı yeniden eklemeyi istemez', () => {
  const error = new Error('failed to fetch codex rate limits: network timeout');
  assert.equal(accountErrorText('codex', error), 'Bağlantı arka planda yenileniyor');
});
