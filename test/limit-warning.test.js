const test = require('node:test');
const assert = require('node:assert/strict');
const { limitsFromUsage, lowLimitWarnings, normalizeRateLimits } = require('../src/limit-warning');

test('kullanılan orandan 5 saatlik ve haftalık kalan limiti hesaplar', () => {
  assert.deepEqual(limitsFromUsage({
    primaryUsed: 82.5, primaryMinutes: 300, primaryReset: 1000,
    secondaryUsed: 91, secondaryMinutes: 10080, secondaryReset: 2000
  }), {
    primary: { label: '5 saatlik', windowMinutes: 300, usedPct: 82.5, remainingPct: 17.5, resetsAt: 1000 },
    secondary: { label: 'Haftalık', windowMinutes: 10080, usedPct: 91, remainingPct: 9, resetsAt: 2000 }
  });
});

test('son yüzde 20 dahil yalnızca düşük kalan limitleri uyarır', () => {
  const warnings = lowLimitWarnings(normalizeRateLimits({
    primary: { remainingPct: 20, label: '5 saatlik' },
    secondary: { remainingPct: 20.1, label: 'Haftalık' }
  }));
  assert.deepEqual(warnings.map(limit => [limit.label, limit.remainingPct]), [['5 saatlik', 20]]);
});

test('iki limit de düşükse en kritik olanı önce gösterir', () => {
  const warnings = lowLimitWarnings({
    primary: { usedPct: 84, label: '5 saatlik' },
    secondary: { usedPct: 95, label: 'Haftalık' }
  });
  assert.deepEqual(warnings.map(limit => limit.remainingPct), [5, 16]);
});
