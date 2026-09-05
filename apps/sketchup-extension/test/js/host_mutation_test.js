// Real JavaScript harness for the #498 mutation controller
// (granete-mutation.js): explicit interaction state machine, double-submit
// guard (one command → exactly one Ruby callback), late-response rejection
// by correlation, validated Ruby→JS envelopes, honest Spanish status copy
// keyed on outcome/category (never on message text), preflight badge
// honesty and callback registration surviving dialog reopen.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RESOURCES = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js');
const STATE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-state.js'), 'utf8');
const BRIDGE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-bridge.js'), 'utf8');
const MUTATION_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-mutation.js'), 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function createMockElement(id = '') {
  const classes = new Set();
  const listeners = {};
  const el = {
    id,
    children: [],
    style: {},
    hidden: false,
    textContent: '',
    className: '',
    setAttribute: () => {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    click: () => (listeners.click || []).forEach((cb) => cb({ preventDefault: () => {} }))
  };
  el.__listeners = listeners;
  return el;
}

function buildSandbox() {
  const registry = {};
  const bridgeCalls = [];
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id))
  };
  const sandbox = {
    console,
    Object,
    Math,
    Date,
    JSON,
    document: documentMock,
    window: {
      sketchup: {
        update_furniture: (payload) => bridgeCalls.push({ action: 'update_furniture', payload: JSON.parse(payload) }),
        authoring_mutation: (payload) => bridgeCalls.push({ action: 'authoring_mutation', payload: JSON.parse(payload) })
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  vm.createContext(sandbox);
  return sandbox;
}

function runRuntime(sandbox, times = 1) {
  vm.runInContext(STATE_SOURCE, sandbox, { filename: 'granete-state.js' });
  vm.runInContext(BRIDGE_SOURCE, sandbox, { filename: 'granete-bridge.js' });
  for (let i = 0; i < times; i += 1) {
    vm.runInContext(MUTATION_SOURCE, sandbox, { filename: 'granete-mutation.js' });
  }
  return sandbox;
}

function fresh() {
  return runRuntime(buildSandbox());
}

function furnitureContext() {
  return { kind: 'furniture', furnitureInstanceRef: 'inst-9', furnitureDefinitionId: 'kitchen-base-standard' };
}

function mutationEnvelope(overrides) {
  return Object.assign({
    schemaId: 'granete.sketchup-host-command.v1',
    type: 'mutation_state',
    messageId: 'mut-out-1',
    inReplyTo: null,
    mutation: 'update_furniture',
    outcome: 'committed',
    category: null,
    reason: null,
    issues: [],
    resolveKind: 'native_layout',
    degraded: 'resolved_current',
    semanticTarget: { furnitureInstanceRef: 'inst-9' },
    result: { success: true }
  }, overrides);
}

test('starts idle and submits through the state machine with one bridge call', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.phase(), 'idle');
  const result = mutation.submitUpdate({ instanceId: 'inst-9', definitionId: 'kitchen-base-standard' }, furnitureContext());
  assert.strictEqual(result, 'sent');
  assert.strictEqual(mutation.phase(), 'resolving');
  assert.strictEqual(sandbox.__bridge.length, 1);
  assert.strictEqual(sandbox.__bridge[0].action, 'update_furniture');
  assert.ok(sandbox.__bridge[0].payload.messageId, 'command carries correlation');
  assert.strictEqual(sandbox.__bridge[0].payload.instanceId, 'inst-9');
});

test('double submit is blocked: one command → exactly one Ruby callback', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.submitUpdate({}, furnitureContext()), 'sent');
  assert.strictEqual(mutation.submitUpdate({}, furnitureContext()), 'busy');
  assert.strictEqual(mutation.submitUpdate({}, furnitureContext()), 'busy');
  assert.strictEqual(sandbox.__bridge.length, 1);
});

test('componentInstanceId and hardwarePlacementId ride the neutral channel', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  const context = {
    kind: 'hardware', furnitureInstanceRef: 'inst-7', hardwarePlacementId: 'hp-hinge-01'
  };
  assert.strictEqual(mutation.submitUpdate({}, context), 'sent');
  assert.strictEqual(sandbox.__bridge.length, 1);
  const storeTarget = sandbox.window.GraneteState.get('mutation').target;
  assert.strictEqual(JSON.stringify(storeTarget), JSON.stringify({ furnitureInstanceRef: 'inst-7', hardwarePlacementId: 'hp-hinge-01' }));
});

test('no host bridge → unavailable, no state corruption', () => {
  const sandbox = buildSandbox();
  sandbox.window.sketchup = {};
  runRuntime(sandbox);
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.submitUpdate({}, furnitureContext()), 'unavailable');
  assert.strictEqual(mutation.phase(), 'idle');
  assert.strictEqual(sandbox.__bridge.length, 0);
});

test('committed outcome walks applying_host_mutation → committed and renders copy', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  const applied = mutation.handleMutationState(mutationEnvelope({ inReplyTo: messageId }));
  assert.strictEqual(JSON.stringify(applied), JSON.stringify({ applied: true, outcome: 'committed' }));
  assert.strictEqual(mutation.phase(), 'committed');
  const status = sandbox.__registry['mutation-status'];
  assert.strictEqual(status.hidden, false);
  assert.strictEqual(status.textContent, 'Cambio aplicado.');
});

test('a late response for an older command is discarded without state change', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  const late = mutation.handleMutationState(mutationEnvelope({ inReplyTo: 'cmd-mut-old-1' }));
  assert.strictEqual(JSON.stringify(late), JSON.stringify({ applied: false, reason: 'late_response' }));
  assert.strictEqual(mutation.phase(), 'resolving');
  // The CURRENT command still completes normally afterwards.
  assert.strictEqual(
    JSON.stringify(mutation.handleMutationState(mutationEnvelope({ inReplyTo: messageId }))),
    JSON.stringify({ applied: true, outcome: 'committed' })
  );
});

test('invalid envelopes (schema/type) never reach the state machine', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  assert.strictEqual(
    JSON.stringify(mutation.handleMutationState(mutationEnvelope({ inReplyTo: messageId, schemaId: 'granete.drift.v2' }))),
    JSON.stringify({ applied: false, reason: 'schema_mismatch' })
  );
  assert.strictEqual(
    JSON.stringify(mutation.handleMutationState(mutationEnvelope({ inReplyTo: messageId, type: 'degraded_state' }))),
    JSON.stringify({ applied: false, reason: 'unexpected_type' })
  );
  assert.strictEqual(mutation.phase(), 'resolving');
});

test('authentication is never shown as offline; category drives the copy', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  mutation.handleMutationState(mutationEnvelope({
    inReplyTo: messageId, outcome: 'unavailable', category: 'authentication'
  }));
  assert.strictEqual(sandbox.__registry['mutation-status'].textContent, 'Sesión expirada. Iniciá sesión de nuevo.');
});

test('plain network unavailability keeps the offline copy', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  mutation.handleMutationState(mutationEnvelope({
    inReplyTo: messageId, outcome: 'unavailable', category: 'network_unavailable'
  }));
  assert.strictEqual(sandbox.__registry['mutation-status'].textContent, 'Sin conexión');
});

test('stale and rejected outcomes render their distinct copy', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const staleId = mutation.pendingMessageId();
  mutation.handleMutationState(mutationEnvelope({ inReplyTo: staleId, outcome: 'stale' }));
  assert.strictEqual(sandbox.__registry['mutation-status'].textContent, 'Cambios desactualizados.');

  mutation.submitUpdate({}, furnitureContext());
  const rejectedId = mutation.pendingMessageId();
  mutation.handleMutationState(mutationEnvelope({ inReplyTo: rejectedId, outcome: 'rejected' }));
  assert.strictEqual(sandbox.__registry['mutation-status'].textContent, 'Acción rechazada.');
});

test('aborted outcome states that the previous furniture survives', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  mutation.handleMutationState(mutationEnvelope({
    inReplyTo: messageId, outcome: 'aborted', category: 'host_apply_failure'
  }));
  assert.strictEqual(
    sandbox.__registry['mutation-status'].textContent,
    'No se aplicó el cambio; el mueble anterior permanece.'
  );
});

test('preflight badge: stale/unavailable honest, never ready', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.publishSelection(furnitureContext());
  mutation.handlePreflightState({
    schemaId: 'granete.sketchup-host-command.v1',
    type: 'preflight_state',
    messageId: 'mut-out-preflight-1',
    entries: [{ furniture: 'furnitureInstanceRef=inst-9', state: 'stale' }]
  });
  let badge = sandbox.__registry['inspector-manufacturing-badge'];
  assert.strictEqual(badge.textContent, 'Revisión técnica desactualizada');

  mutation.handlePreflightState({
    schemaId: 'granete.sketchup-host-command.v1',
    type: 'preflight_state',
    messageId: 'mut-out-preflight-2',
    entries: [{ furniture: 'furnitureInstanceRef=inst-9', state: 'unavailable' }]
  });
  badge = sandbox.__registry['inspector-manufacturing-badge'];
  assert.strictEqual(badge.textContent, 'Revisión técnica no disponible');
});

test('degraded state reaches the shared store', () => {
  const sandbox = fresh();
  sandbox.window.GraneteMutation.handleDegradedState({
    schemaId: 'granete.sketchup-host-command.v1',
    type: 'degraded_state',
    messageId: 'mut-out-degraded-1',
    state: 'sync_required'
  });
  assert.strictEqual(sandbox.window.GraneteState.get('degraded'), 'sync_required');
});

test('selection publish feeds the store and resets after terminal outcomes', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  mutation.publishSelection(furnitureContext());
  assert.strictEqual(JSON.stringify(sandbox.window.GraneteState.get('selection')), JSON.stringify(furnitureContext()));
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  mutation.handleMutationState(mutationEnvelope({ inReplyTo: messageId }));
  mutation.publishSelection(furnitureContext());
  assert.strictEqual(mutation.phase(), 'idle');
});

test('dialog reopen (module re-execution x5) keeps exactly one callback registration', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox, 5);
  const mutation = sandbox.window.GraneteMutation;
  mutation.submitUpdate({}, furnitureContext());
  const messageId = mutation.pendingMessageId();
  assert.strictEqual(sandbox.__bridge.length, 1);
  assert.strictEqual(
    JSON.stringify(mutation.handleMutationState(mutationEnvelope({ inReplyTo: messageId }))),
    JSON.stringify({ applied: true, outcome: 'committed' })
  );
  assert.strictEqual(sandbox.__bridge.length, 1);
});

test('attachToDialog registers the runtime callbacks exactly once', () => {
  const sandbox = fresh();
  const api = { onMutationState: null, onPreflightState: null, onDegradedState: null };
  assert.strictEqual(sandbox.window.GraneteMutation.attachToDialog(api), true);
  assert.strictEqual(sandbox.window.GraneteMutation.attachToDialog(api), false);
  const first = api.onMutationState;
  sandbox.window.GraneteMutation.attachToDialog(api);
  assert.strictEqual(api.onMutationState, first);
});

// --- #467 / SU-AUTH-1: internal component authoring on the neutral channel ---

function partContext() {
  return {
    kind: 'part', furnitureInstanceRef: 'inst-467', componentInstanceId: 'shelf-01',
    componentDefinitionId: 'mod-comp-shelf', componentPlacement: 'interno',
    assemblyTranslationMm: [18, 18, 150]
  };
}

test('component move submits a move_component command with mm translation and exact target', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  const result = mutation.submitComponentMutation('move', [18, 18, 520], partContext());
  assert.strictEqual(result, 'sent');
  assert.strictEqual(sandbox.__bridge.length, 1);
  const call = sandbox.__bridge[0];
  assert.strictEqual(call.action, 'authoring_mutation');
  assert.strictEqual(call.payload.mutation, 'move_component');
  assert.strictEqual(call.payload.semanticTarget.componentInstanceId, 'shelf-01');
  assert.strictEqual(call.payload.semanticTarget.furnitureInstanceRef, 'inst-467');
  assert.strictEqual(JSON.stringify(call.payload.payload.translationMm), JSON.stringify([18, 18, 520]));
  assert.ok(call.payload.messageId, 'component command carries correlation');
  assert.strictEqual(mutation.phase(), 'resolving');
});

test('component remove carries no translation and requires the occurrence identity', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.submitComponentMutation('remove', null, partContext()), 'sent');
  const call = sandbox.__bridge[0];
  assert.strictEqual(call.payload.mutation, 'remove_component');
  assert.strictEqual(call.payload.payload.translationMm, undefined);

  // Without a concrete componentInstanceId the channel refuses (never the
  // furniture root, never a guess).
  const other = fresh();
  assert.strictEqual(
    other.window.GraneteMutation.submitComponentMutation('remove', null, { kind: 'part', furnitureInstanceRef: 'inst-467' }),
    'unavailable'
  );
  assert.strictEqual(other.__bridge.length, 0);
});

test('component mutations respect the shared double-submit guard', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.submitComponentMutation('add', [18, 18, 420], partContext()), 'sent');
  assert.strictEqual(mutation.submitComponentMutation('duplicate', [18, 18, 300], partContext()), 'busy');
  assert.strictEqual(mutation.submitComponentMutation('move', [1, 2, 3], partContext()), 'busy');
  assert.strictEqual(sandbox.__bridge.length, 1);
});

test('unknown component operation never reaches the host', () => {
  const sandbox = fresh();
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.submitComponentMutation('rotate', [1, 2, 3], partContext()), 'unavailable');
  assert.strictEqual(sandbox.__bridge.length, 0);
});

test('viewport move asks Ruby to activate the constrained drag tool', () => {
  const sandbox = buildSandbox();
  const viewportCalls = [];
  sandbox.window.sketchup.component_viewport_move = (payload) => viewportCalls.push(JSON.parse(payload));
  runRuntime(sandbox);
  const mutation = sandbox.window.GraneteMutation;
  assert.strictEqual(mutation.startComponentViewportMove(partContext()), 'sent');
  assert.strictEqual(viewportCalls.length, 1);
  assert.strictEqual(viewportCalls[0].semanticTarget.componentInstanceId, 'shelf-01');
  assert.strictEqual(viewportCalls[0].semanticTarget.furnitureInstanceRef, 'inst-467');
  assert.strictEqual(mutation.startComponentViewportMove({ kind: 'part' }), 'unavailable');
  assert.strictEqual(viewportCalls.length, 1);
});

console.log(JSON.stringify({ success: true, testsPassed }));
