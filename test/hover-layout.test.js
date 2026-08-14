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
