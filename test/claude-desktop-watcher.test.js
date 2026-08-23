const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activeBranch,
  conversationTreeToChat,
  desktopCompactionInfo,
  modelLimit,
  usageFromHistory
} = require('../src/claude-desktop-watcher');

const account = {
  model_selector_config: {
    0: { id: 'chat', models: [{ id: 'claude-test', hard_limit: 100_000 }] }
  }
};

test('aktif Claude Desktop mesaj dalını yaprak UUID üzerinden seçer', () => {
  const tree = {
    current_leaf_message_uuid: 'a2',
    chat_messages: [
      { uuid: 'h1', parent_message_uuid: null, index: 0 },
      { uuid: 'a1', parent_message_uuid: 'h1', index: 1 },
      { uuid: 'a2', parent_message_uuid: 'h1', index: 2 }
    ]
  };
  assert.deepEqual(activeBranch(tree).map(message => message.uuid), ['h1', 'a2']);
});

test('modelin Claude Desktop yapılandırmasındaki gerçek hard limitini kullanır', () => {
  assert.equal(modelLimit(account, 'claude-test'), 100_000);
  assert.equal(modelLimit(account, 'bilinmeyen'), 200_000);
});

test('plan kullanım geçmişini 5 saatlik ve haftalık limite dönüştürür', () => {
  const limits = usageFromHistory({ samples: [{ t: 1, u: { fh: 82, sd: 35 } }, { t: 2, u: { fh: 91, sd: 84 } }] });
  assert.equal(limits.primary.remainingPct, 9);
  assert.equal(limits.secondary.remainingPct, 16);
});

test('Claude Desktop sohbetinden tahmini context kartı üretir', () => {
  const tree = {
    uuid: 'chat-1', name: 'Deneme', model: 'claude-test', current_leaf_message_uuid: 'a1',
    chat_messages: [
      { uuid: 'h1', sender: 'human', text: 'Merhaba dünya', parent_message_uuid: null, index: 0, files: [] },
      { uuid: 'a1', sender: 'assistant', text: 'Selam!', parent_message_uuid: 'h1', index: 1, files: [] }
    ]
  };
  const chat = conversationTreeToChat(tree, account, { primary: null, secondary: null }, 123);
  assert.equal(chat.source, 'claude-desktop');
  assert.equal(chat.contextLimit, 100_000);
  assert.equal(chat.estimated, true);
  assert.ok(chat.usedTokens >= 3_000);
  assert.equal(chat.remainingPct, 97);
});

test('Claude Desktop yalnızca açık compact işareti varsa compact gösterir', () => {
  assert.equal(desktopCompactionInfo({ chat_messages: [{ truncated: true }] }).compacted, false);
  const compact = desktopCompactionInfo({
    chat_messages: [{ type: 'system', subtype: 'compact_boundary', timestamp: '2026-08-23T15:00:00Z' }]
  });
  assert.equal(compact.compacted, true);
  assert.equal(compact.compactionCount, 1);
});
