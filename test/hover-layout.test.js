const test = require('node:test');
const assert = require('node:assert/strict');
const { hoverSize } = require('../src/hover-layout');

test('hover genişliği hesap sayısından bağımsız sabit kalır', () => {
  assert.equal(hoverSize(0).width, 390);
  assert.equal(hoverSize(100).width, 390);
});

test('hover yüksekliği kontrollü artar ve 460 pikseli geçmez', () => {
  assert.deepEqual(hoverSize(3), { width: 390, height: 242 });
  assert.deepEqual(hoverSize(100), { width: 390, height: 460 });
});

test('yalnızca aktif sohbet sayısı kadar context alanı ayırır', () => {
  assert.deepEqual(hoverSize(0, 1), { width: 390, height: 206 });
  assert.deepEqual(hoverSize(0, 4), { width: 390, height: 332 });
});

test('düşük limit uyarısı için hover panelinde ek satır ayırır', () => {
  assert.deepEqual(hoverSize(0, 1, 1), { width: 390, height: 226 });
  assert.deepEqual(hoverSize(0, 2, 1), { width: 390, height: 268 });
});
