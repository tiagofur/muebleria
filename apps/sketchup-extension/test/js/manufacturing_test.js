// Real JavaScript harness for the #470 manufacturing inspection controller
// (granete-manufacturing.js): validated Ruby→JS state envelopes, read-only
// inspection commands through the versioned channel, honest status copy,
// feature list/detail rendering driven ONLY by the Ruby state (never local
// computation), `Ir al origen` wiring and dialog reopen safety.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RESOURCES = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js');
const STATE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-state.js'), 'utf8');
const BRIDGE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-bridge.js'), 'utf8');
const MANUFACTURING_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-manufacturing.js'), 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function createMockElement(id = '') {
  const listeners = {};
  const span = { textContent: '' };
  const el = {
    id,
    children: [],
    style: {},
    hidden: false,
    textContent: '',
    className: '',
    innerHTML: '',
    disabled: false,
    setAttribute: () => {},
    appendChild: (child) => el.children.push(child),
    querySelector: (selector) => (selector === 'span' ? span : null),
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    }
  };
  el.__listeners = listeners;
  el.__span = span;
  return el;
}

function buildSandbox() {
  const registry = {};
  const bridgeCalls = [];
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement(`<${tag}>`)
  };
  const sandbox = {
    console,
    Object,
    Math,
    Date,
    JSON,
    Error,
    document: documentMock,
    window: {
      sketchup: {
        manufacturing_inspection: (payload) =>
          bridgeCalls.push({ action: 'manufacturing_inspection', payload: JSON.parse(payload) })
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
    vm.runInContext(MANUFACTURING_SOURCE, sandbox, { filename: 'granete-manufacturing.js' });
  }
}

function selectionPayload() {
  return {
    kind: 'part',
    furnitureInstanceRef: 'inst-overlay-1',
    componentInstanceId: 'side-left-01'
  };
}

function pushState(sandbox, state) {
  return sandbox.window.GraneteManufacturing.handleManufacturingState(
    JSON.stringify({
      schemaId: 'granete.sketchup-host-command.v1',
      type: 'manufacturing_state',
      messageId: 'out-1',
      state
    })
  );
}

// --- runtime basics ------------------------------------------------------

test('attaches once and survives re-execution (dialog reopen safety)', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteDialog = {};
  runRuntime(sandbox, 3);
  assert.strictEqual(typeof sandbox.window.GraneteDialog.onManufacturingState, 'function');
  const first = sandbox.window.GraneteDialog.onManufacturingState;
  runRuntime(sandbox);
  assert.strictEqual(sandbox.window.GraneteDialog.onManufacturingState, first,
    're-execution must not re-attach');
});

// --- command submission --------------------------------------------------

test('toggle sends a set_mode command with the selection semantic target', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  sandbox.window.__selection = selectionPayload();
  const result = vm.runInContext('window.GraneteManufacturing.toggle(window.__selection)', sandbox);
  assert.strictEqual(result, 'sent');
  const sent = sandbox.__bridge[0];
  assert.strictEqual(sent.action, 'manufacturing_inspection');
  assert.strictEqual(sent.payload.type, 'manufacturing_command');
  assert.strictEqual(sent.payload.command, 'set_mode');
  assert.strictEqual(sent.payload.payload.mode, 'on');
  assert.strictEqual(sent.payload.semanticTarget.componentInstanceId, 'side-left-01');
});

test('no host bridge: unavailable, never fakes success', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  sandbox.window.sketchup.manufacturing_inspection = undefined;
  const result = vm.runInContext('window.GraneteManufacturing.toggle(null)', sandbox);
  assert.strictEqual(result, 'unavailable');
  assert.strictEqual(sandbox.__bridge.length, 0);
});

test('navigateToSource sends the active feature visual id', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  sandbox.window.GraneteState.set('selection', selectionPayload());
  pushState(sandbox, {
    mode: 'on', status: 'current', filter: 'all', activeFeatureId: 'hp-hinge-01:op-1#h0',
    features: [{ visualId: 'hp-hinge-01:op-1#h0', sourceKind: 'manualHardwarePlacement' }]
  });
  const result = vm.runInContext(
    'window.GraneteManufacturing.navigateToSource("hp-hinge-01:op-1#h0")', sandbox);
  assert.strictEqual(result, 'sent');
  const sent = sandbox.__bridge[0];
  assert.strictEqual(sent.payload.command, 'navigate_to_source');
  assert.strictEqual(sent.payload.payload.visualId, 'hp-hinge-01:op-1#h0');
});

// --- Ruby→JS state handling ----------------------------------------------

test('validated state envelopes populate the store and render honestly', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  pushState(sandbox, {
    mode: 'on', status: 'stale', filter: 'all', staleReason: 'mutación en curso',
    activeFeatureId: null, features: []
  });
  const state = vm.runInContext('window.GraneteState.get("manufacturing")', sandbox);
  assert.strictEqual(state.status, 'stale');
  const badge = sandbox.__registry['manufacturing-status-badge'];
  assert.strictEqual(badge.textContent, 'Desactualizada');
  assert.strictEqual(badge.className, 'status-badge error');
});

test('malformed envelopes are rejected, never guessed into state', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  const bad = vm.runInContext(
    'window.GraneteManufacturing.handleManufacturingState(' +
    'JSON.stringify({ schemaId: "other", type: "manufacturing_state", messageId: "x", state: { mode: "on" } }))',
    sandbox
  );
  assert.strictEqual(bad.applied, false);
  const state = vm.runInContext('window.GraneteState.get("manufacturing")', sandbox);
  assert.strictEqual(state.mode, 'off', 'rejected envelope must not leak into state');
});

test('envelope without a state object is rejected', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  const result = vm.runInContext(
    'window.GraneteManufacturing.handleManufacturingState(' +
    'JSON.stringify({ schemaId: "granete.sketchup-host-command.v1", type: "manufacturing_state", messageId: "x" }))',
    sandbox
  );
  assert.strictEqual(result.applied, false);
});

// --- rendering is driven only by the Ruby state ---------------------------

test('feature list and detail render contract data verbatim', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  sandbox.window.GraneteState.set('selection', selectionPayload());
  pushState(sandbox, {
    mode: 'on', status: 'current', filter: 'all',
    activeFeatureId: 'hp-hinge-01:op-1#h0',
    features: [
      { visualId: 'hp-hinge-01:op-1#h0', typeLabel: 'Bisagra', diameterMm: 35, depthMm: 12.5,
        faceLabel: 'frontal', sourceLabel: 'hp-hinge-01', sourceKind: 'manualHardwarePlacement',
        hostComponentInstanceId: 'side-left-01', xMm: 50, yMm: 150, conflict: null },
      { visualId: 'rel-shelf-01:op-1#h0', typeLabel: 'Minifix', diameterMm: 15, depthMm: 12.5,
        faceLabel: 'frontal', sourceLabel: 'rel-shelf-01', sourceKind: 'relationship',
        hostComponentInstanceId: 'side-left-01', xMm: 50, yMm: 150,
        conflict: { code: 'DRILLING_CONFLICT', message: 'colisión', otherOperationId: 'hp-hinge-01:op-1' } }
    ]
  });

  const list = sandbox.__registry['manufacturing-feature-list'];
  assert.strictEqual(list.children.length, 2);
  const conflictRow = list.children[1];
  assert.ok(conflictRow.className.includes('conflict'));
  assert.strictEqual(sandbox.__registry['manufacturing-detail-diameter'].textContent, '35 mm');
  assert.strictEqual(sandbox.__registry['manufacturing-detail-source-id'].textContent, 'hp-hinge-01');
  assert.strictEqual(sandbox.__registry['btn-manufacturing-goto-source'].style.display, 'inline-flex');

  // Selecting a conflicting feature asks Ruby (view state), never computes.
  vm.runInContext('window.GraneteManufacturing.selectFeature("rel-shelf-01:op-1#h0")', sandbox);
  assert.strictEqual(sandbox.__bridge.at(-1).payload.command, 'select_feature');
});

test('mode off hides the body and the toggle copy flips', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  pushState(sandbox, { mode: 'off', status: 'off', features: [] });
  assert.strictEqual(sandbox.__registry['manufacturing-body'].style.display, 'none');
  const label = sandbox.__registry['btn-manufacturing-toggle'].__span;
  assert.ok(label.textContent.includes('Ver fabricación'));
});

console.log(`manufacturing_test: ${testsPassed} passed`);
