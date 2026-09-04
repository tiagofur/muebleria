// Real JavaScript harness for the #498 versioned bridge module
// (granete-bridge.js): envelope validation fails closed on unknown
// schema/type/shape, command envelopes carry schema identity +
// correlation + semantic target, and the module is idempotent under
// re-execution.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-bridge.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function runModule(times = 1, withHost = true) {
  const bridgeCalls = [];
  const sandbox = {
    console,
    Object,
    Math,
    Date,
    JSON,
    window: {}
  };
  if (withHost) {
    sandbox.window.sketchup = {
      authoring_mutation: (payload) => bridgeCalls.push(JSON.parse(payload))
    };
  }
  sandbox.__bridgeCalls = bridgeCalls;
  vm.createContext(sandbox);
  for (let i = 0; i < times; i += 1) {
    vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  }
  return sandbox;
}

function envelope(overrides) {
  return Object.assign({
    schemaId: 'granete.sketchup-host-command.v1',
    type: 'mutation_state',
    messageId: 'mut-out-1',
    outcome: 'committed'
  }, overrides);
}

test('accepts a well-formed envelope', () => {
  const { window } = runModule();
  const check = window.GraneteBridge.validate(envelope({}), 'mutation_state');
  assert.strictEqual(JSON.stringify(check), JSON.stringify({ ok: true }));
});

test('rejects unknown schema id before any state consumption', () => {
  const { window } = runModule();
  assert.strictEqual(JSON.stringify(window.GraneteBridge.validate(envelope({ schemaId: 'granete.other.v9' }), 'mutation_state')), JSON.stringify({ ok: false, reason: 'schema_mismatch' }));
});

test('rejects non-objects and unknown message types', () => {
  const { window } = runModule();
  assert.strictEqual(JSON.stringify(window.GraneteBridge.validate(null, 'mutation_state')), JSON.stringify({ ok: false, reason: 'not_object' }));
  assert.strictEqual(JSON.stringify(window.GraneteBridge.validate(envelope({ type: 'mystery' }), 'mutation_state')), JSON.stringify({ ok: false, reason: 'unknown_type' }));
});

test('rejects an expected type mismatch', () => {
  const { window } = runModule();
  assert.strictEqual(JSON.stringify(window.GraneteBridge.validate(envelope({ type: 'preflight_state' }), 'mutation_state')), JSON.stringify({ ok: false, reason: 'unexpected_type' }));
});

test('rejects a missing or oversized message id', () => {
  const { window } = runModule();
  assert.strictEqual(JSON.stringify(window.GraneteBridge.validate(envelope({ messageId: '' }), 'mutation_state')), JSON.stringify({ ok: false, reason: 'invalid_message_id' }));
  assert.strictEqual(
    JSON.stringify(window.GraneteBridge.validate(envelope({ messageId: 'x'.repeat(129) }), 'mutation_state')),
    JSON.stringify({ ok: false, reason: 'invalid_message_id' })
  );
});

test('message ids are unique and ordered', () => {
  const { window } = runModule();
  const first = window.GraneteBridge.nextMessageId();
  const second = window.GraneteBridge.nextMessageId();
  assert.notStrictEqual(first, second);
  assert.ok(first.startsWith('cmd-mut-1-'), first);
  assert.ok(second.startsWith('cmd-mut-2-'), second);
});

test('sendCommand emits one versioned envelope with correlation + semantic target', () => {
  const sandbox = runModule();
  const id = sandbox.window.GraneteBridge.sendCommand('update_furniture',
    { furnitureInstanceRef: 'inst-9', componentInstanceId: 'shelf-01' },
    { definitionId: 'kitchen-base-standard' });
  assert.ok(id, 'must return the correlation id');
  assert.strictEqual(sandbox.__bridgeCalls.length, 1);
  const sent = sandbox.__bridgeCalls[0];
  assert.strictEqual(sent.schemaId, 'granete.sketchup-host-command.v1');
  assert.strictEqual(sent.type, 'mutation_command');
  assert.strictEqual(sent.messageId, id);
  assert.strictEqual(sent.mutation, 'update_furniture');
  assert.strictEqual(JSON.stringify(sent.semanticTarget), JSON.stringify({ furnitureInstanceRef: 'inst-9', componentInstanceId: 'shelf-01' }));
  assert.strictEqual(JSON.stringify(sent.payload), JSON.stringify({ definitionId: 'kitchen-base-standard' }));
});

test('hardwarePlacementId targets ride the same neutral channel', () => {
  const sandbox = runModule();
  sandbox.window.GraneteBridge.sendCommand('update_furniture',
    { furnitureInstanceRef: 'inst-7', hardwarePlacementId: 'hp-hinge-01' }, {});
  const sent = sandbox.__bridgeCalls[0];
  assert.strictEqual(JSON.stringify(sent.semanticTarget), JSON.stringify({ furnitureInstanceRef: 'inst-7', hardwarePlacementId: 'hp-hinge-01' }));
});

test('sendCommand returns null without a host bridge (browser preview)', () => {
  const { window } = runModule(1, false);
  assert.strictEqual(window.GraneteBridge.sendCommand('update_furniture', { furnitureInstanceRef: 'i' }, {}), null);
});

test('re-executing the module registers nothing twice', () => {
  const sandbox = runModule(5);
  sandbox.window.GraneteBridge.sendCommand('update_furniture', { furnitureInstanceRef: 'i' }, {});
  assert.strictEqual(sandbox.__bridgeCalls.length, 1);
});

console.log(JSON.stringify({ success: true, testsPassed }));
