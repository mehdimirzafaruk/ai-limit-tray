const HOLE = Symbol('v8-array-hole');

class V8ValueParser {
  constructor(buffer, offset = 0) {
    this.buffer = Buffer.from(buffer);
    this.offset = offset;
    this.references = [];
    this.version = null;
  }

  fail(message, tag) {
    const suffix = tag == null ? '' : ` (etiket 0x${tag.toString(16)})`;
    throw new Error(`${message}${suffix}, konum ${this.offset}`);
  }

  byte() {
    if (this.offset >= this.buffer.length) this.fail('Serileştirilmiş veri beklenmedik biçimde bitti');
    return this.buffer[this.offset++];
  }

  bytes(length) {
    const end = this.offset + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > this.buffer.length) this.fail('Geçersiz veri uzunluğu');
    const value = this.buffer.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  varint() {
    let value = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.byte();
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) {
        const number = Number(value);
        return Number.isSafeInteger(number) ? number : value;
      }
      shift += 7n;
    }
    this.fail('Varint çok uzun');
  }

  tag() {
    let tag = this.byte();
    while (tag === 0x00) tag = this.byte();
    return tag;
  }

  peekTag() {
    let cursor = this.offset;
    while (this.buffer[cursor] === 0x00) cursor += 1;
    return this.buffer[cursor];
  }

  addReference(value) {
    this.references.push(value);
    return value;
  }

  header() {
    const marker = this.tag();
    if (marker !== 0xff) this.fail('V8 başlığı bulunamadı', marker);
    this.version = Number(this.varint());
    return this.version;
  }

  parse() {
    this.header();
    return this.value();
  }

  value() {
    const tag = this.tag();
    switch (tag) {
      case 0x3f: // VerifyObjectCount
        this.varint();
        return this.value();
      case 0x2d: return HOLE;
      case 0x5f: return undefined;
      case 0x30: return null;
      case 0x54: return true;
      case 0x46: return false;
      case 0x49: return this.int32();
      case 0x55: return Number(this.varint());
      case 0x4e: return this.double();
      case 0x5a: return this.bigint();
      case 0x53: return this.string('utf8');
      case 0x22: return this.string('latin1');
      case 0x63: return this.string('utf16le');
      case 0x5e: return this.objectReference();
      case 0x6f: return this.object();
      case 0x41: return this.denseArray();
      case 0x61: return this.sparseArray();
      case 0x3b: return this.map();
      case 0x27: return this.set();
      case 0x44: return this.date();
      case 0x79: return this.boxed(Boolean(this.value()));
      case 0x78: return this.boxed(Boolean(this.value()));
      case 0x6e: return this.boxed(this.double());
      case 0x7a: return this.boxed(this.bigint());
      case 0x73: return this.boxed(this.value());
      case 0x42: return this.arrayBuffer();
      case 0x70: return this.sharedObject();
      default: this.fail('Desteklenmeyen V8 değeri', tag);
    }
  }

  int32() {
    const raw = Number(this.varint()) >>> 0;
    return (raw >>> 1) ^ -(raw & 1);
  }

  double() {
    const value = this.bytes(8).readDoubleLE(0);
    return value;
  }

  bigint() {
    const bitfield = Number(this.varint());
    const negative = Boolean(bitfield & 1);
    const length = bitfield >>> 1;
    const digits = this.bytes(length);
    let result = 0n;
    for (let index = digits.length - 1; index >= 0; index -= 1) result = (result << 8n) | BigInt(digits[index]);
    return negative ? -result : result;
  }

  string(encoding) {
    const length = Number(this.varint());
    return this.bytes(length).toString(encoding);
  }

  objectReference() {
    const id = Number(this.varint());
    if (!(id in this.references)) this.fail(`Geçersiz nesne başvurusu ${id}`);
    return this.references[id];
  }

  propertyKey(value) {
    return typeof value === 'symbol' ? String(value) : String(value);
  }

  object() {
    const result = this.addReference({});
    let properties = 0;
    while (this.peekTag() !== 0x7b) {
      const key = this.value();
      result[this.propertyKey(key)] = this.value();
      properties += 1;
    }
    this.tag();
    this.varint(); // Yazılan özellik sayısı; bozuk olmayan önbellekte yukarıdaki değerle aynıdır.
    return result;
  }

  denseArray() {
    const length = Number(this.varint());
    const result = this.addReference(new Array(length));
    for (let index = 0; index < length; index += 1) {
      const value = this.value();
      if (value !== HOLE) result[index] = value;
    }
    while (this.peekTag() !== 0x24) {
      const key = this.value();
      result[this.propertyKey(key)] = this.value();
    }
    this.tag();
    this.varint(); // özellik sayısı
    this.varint(); // dizi uzunluğu
    return result;
  }

  sparseArray() {
    const length = Number(this.varint());
    const result = this.addReference(new Array(length));
    while (this.peekTag() !== 0x40) {
      const key = this.value();
      result[this.propertyKey(key)] = this.value();
    }
    this.tag();
    this.varint(); // özellik sayısı
    this.varint(); // dizi uzunluğu
    return result;
  }

  map() {
    const result = this.addReference(new Map());
    let entries = 0;
    while (this.peekTag() !== 0x3a) {
      result.set(this.value(), this.value());
      entries += 2;
    }
    this.tag();
    this.varint(); // yazılan değer sayısı
    return result;
  }

  set() {
    const result = this.addReference(new Set());
    while (this.peekTag() !== 0x2c) result.add(this.value());
    this.tag();
    this.varint(); // yazılan değer sayısı
    return result;
  }

  date() {
    return this.addReference(new Date(this.double()));
  }

  boxed(value) {
    return this.addReference(Object(value));
  }

  arrayBuffer() {
    const length = Number(this.varint());
    return this.addReference(Buffer.from(this.bytes(length)));
  }

  sharedObject() {
    const id = Number(this.varint());
    return this.addReference({ __sharedObjectId: id });
  }
}

function findSerializedValue(buffer) {
  const original = Buffer.from(buffer);
  const compressed = original.length >= 3 && original[0] === 0xff && original[1] === 0x11 && original[2] === 0x02;
  const data = compressed ? decompressSnappy(original.subarray(3)) : original;
  for (let offset = 0; offset < Math.min(data.length - 2, 128); offset += 1) {
    if (data[offset] !== 0xff) continue;
    try {
      const parser = new V8ValueParser(data, offset);
      const value = parser.parse();
      if (value && typeof value === 'object') {
        return { value, offset, version: parser.version, endOffset: parser.offset, compressed };
      }
    } catch { /* IndexedDB/Blink başlıklarının içindeki yanlış eşleşmeleri atla. */ }
  }
  throw new Error('Claude önbelleğinde okunabilir V8 değeri bulunamadı');
}

function decompressSnappy(input) {
  const data = Buffer.from(input);
  let cursor = 0;
  let expected = 0;
  let shift = 0;
  while (cursor < data.length) {
    const byte = data[cursor++];
    expected |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 28) throw new Error('Geçersiz Snappy uzunluğu');
  }
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Geçersiz Snappy çıktı uzunluğu');
  const output = Buffer.allocUnsafe(expected);
  let written = 0;
  const copy = (offset, length) => {
    if (offset <= 0 || offset > written || written + length > output.length) throw new Error('Geçersiz Snappy kopyası');
    for (let index = 0; index < length; index += 1) {
      output[written] = output[written - offset];
      written += 1;
    }
  };
  while (cursor < data.length && written < output.length) {
    const tag = data[cursor++];
    const kind = tag & 0x03;
    if (kind === 0) {
      let length = tag >>> 2;
      if (length < 60) length += 1;
      else {
        const byteCount = length - 59;
        length = 0;
        for (let index = 0; index < byteCount; index += 1) length += data[cursor++] * (2 ** (8 * index));
        length += 1;
      }
      if (cursor + length > data.length || written + length > output.length) throw new Error('Eksik Snappy literal verisi');
      data.copy(output, written, cursor, cursor + length);
      cursor += length;
      written += length;
      continue;
    }
    if (kind === 1) {
      const length = 4 + ((tag >>> 2) & 0x07);
      const offset = ((tag & 0xe0) << 3) | data[cursor++];
      copy(offset, length);
      continue;
    }
    const length = 1 + (tag >>> 2);
    const byteCount = kind === 2 ? 2 : 4;
    let offset = 0;
    for (let index = 0; index < byteCount; index += 1) offset += data[cursor++] * (2 ** (8 * index));
    copy(offset, length);
  }
  if (written !== output.length) throw new Error(`Snappy verisi eksik açıldı: ${written}/${output.length}`);
  return output;
}

module.exports = { HOLE, V8ValueParser, decompressSnappy, findSerializedValue };
