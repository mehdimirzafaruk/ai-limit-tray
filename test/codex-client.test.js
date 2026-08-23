const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexClient } = require('../src/codex-client');

function fakeClient(responses = {}) {
  const client = Object.create(CodexClient.prototype);
  client.initialize = async () => {};
  client.tokenRefreshDue = () => true;
  client.calls = [];
  client.request = async (method, params) => {
    client.calls.push({ method, params });
    return responses[method];
  };
  return client;
}

test('hesap okuması varsayılan olarak yönetilen tokenı yeniler', async () => {
  const client = fakeClient({ 'account/read': { account: { email: 'user@example.com' } } });
  await client.account();
  assert.deepEqual(client.calls, [{ method: 'account/read', params: { refreshToken: true } }]);
});

test('token yenilemesini limit isteğinden önce tamamlar', async () => {
  const client = fakeClient({
    'account/read': { account: { email: 'user@example.com' } },
    'account/rateLimits/read': { rateLimits: { primary: { usedPercent: 25 } } }
  });
  const result = await client.usage();
  assert.deepEqual(client.calls, [
    { method: 'account/read', params: { refreshToken: true } },
    { method: 'account/rateLimits/read', params: undefined }
  ]);
  assert.equal(result.account.account.email, 'user@example.com');
  assert.equal(result.limits.rateLimits.primary.usedPercent, 25);
});

test('beklenmedik 401 hatasında tokenı zorla yenileyip bir kez daha dener', async () => {
  const client = fakeClient();
  client.tokenRefreshDue = () => false;
  let limitCalls = 0;
  client.request = async (method, params) => {
    client.calls.push({ method, params });
    if (method === 'account/read') return { account: { email: 'user@example.com' } };
    limitCalls += 1;
    if (limitCalls === 1) throw new Error('401 Unauthorized: token_invalidated');
    return { rateLimits: { primary: { usedPercent: 40 } } };
  };
  const result = await client.usage();
  assert.deepEqual(client.calls, [
    { method: 'account/read', params: { refreshToken: false } },
    { method: 'account/rateLimits/read', params: undefined },
    { method: 'account/read', params: { refreshToken: true } },
    { method: 'account/rateLimits/read', params: undefined }
  ]);
  assert.equal(result.limits.rateLimits.primary.usedPercent, 40);
});

test('başarısız auth kurtarmasını her dakika tekrarlamaz', async () => {
  const client = fakeClient();
  client.tokenRefreshDue = () => false;
  const recoveryAt = Date.now();
  client.lastAuthRecoveryAt = recoveryAt;
  client.request = async (method, params) => {
    client.calls.push({ method, params });
    if (method === 'account/read') return { account: { email: 'user@example.com' } };
    throw new Error('401 Unauthorized: token_invalidated');
  };
  await assert.rejects(client.usage(), /token_invalidated/);
  assert.deepEqual(client.calls, [
    { method: 'account/read', params: { refreshToken: false } },
    { method: 'account/rateLimits/read', params: undefined }
  ]);
  assert.equal(client.lastAuthRecoveryAt, recoveryAt);
});

test('yakın zamanda yenilenen tokenı her dakika tekrar yenilemez', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-limit-codex-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ last_refresh: new Date().toISOString() }));
  const client = new CodexClient(home);
  assert.equal(client.tokenRefreshDue(), false);
});
