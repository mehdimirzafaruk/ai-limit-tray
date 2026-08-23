const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('node:v8');
const { decompressSnappy, findSerializedValue, V8ValueParser } = require('../src/v8-value-parser');

test('V8 ile serileştirilmiş JSON benzeri değeri okur', () => {
  const original = { title: 'Claude', count: 42, ok: true, nested: [null, 'Türkçe', 3.5] };
  const parser = new V8ValueParser(v8.serialize(original));
  assert.deepEqual(parser.parse(), original);
});

test('Blink ön eki içinden V8 değerini bulur', () => {
  const original = { clientState: { queries: [{ queryKey: ['conversation', 'abc'] }] } };
  const buffer = Buffer.concat([Buffer.from([1, 2, 3, 4]), v8.serialize(original)]);
  const parsed = findSerializedValue(buffer);
  assert.equal(parsed.offset, 4);
  assert.deepEqual(parsed.value, original);
});

test('IndexedDB ham Snappy literal verisini açar', () => {
  assert.deepEqual(decompressSnappy(Buffer.from([5, 0x10, ...Buffer.from('hello')])), Buffer.from('hello'));
});

test('Snappy örtüşen kopyayı doğru açar', () => {
  // 8 bayt çıktı: "ab" literal, ardından aynı iki baytı üç kez kopyala.
  assert.deepEqual(decompressSnappy(Buffer.from([8, 0x04, 0x61, 0x62, 0x16, 0x02, 0x00])), Buffer.from('abababab'));
});
