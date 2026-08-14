const test = require('node:test'); const assert = require('node:assert/strict');
const { codex, claude, aggregate } = require('../src/normalize');
test('Codex yanıtını ve pencere süresini normalize eder',()=>assert.deepEqual(
  { used: codex({rateLimits:{primary:{usedPercent:35,windowDurationMins:300}}}).primaryUsed, minutes: codex({rateLimits:{primary:{usedPercent:35,windowDurationMins:300}}}).primaryMinutes },
  { used: 35, minutes: 300 }
));
test('Claude yanıtını ve pencere süresini normalize eder',()=>assert.deepEqual(
  { used: claude({five_hour:{utilization:72}}).primaryUsed, minutes: claude({five_hour:{utilization:72}}).primaryMinutes },
  { used: 72, minutes: 300 }
));
test('Codex hesaplarını kapasite bazında toplar',()=>assert.deepEqual(aggregate([{status:'ok',usage:{primaryUsed:20}},{status:'ok',usage:{primaryUsed:50}}]),{accounts:2,capacity:200,remaining:130,remainingPercent:65}));
