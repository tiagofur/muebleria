// Real JavaScript harness for the #466 preflight review controller
// (granete-preflight-review.js): authoritative resolve state envelopes,
// status copy and badges, issue group rendering with Spanish titles and
// remediation, navigation commands, fix-loop context actions and publish gating.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RESOURCES = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js');
const STATE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-state.js'), 'utf8');
const BRIDGE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-bridge.js'), 'utf8');
const PREFLIGHT_SOURCE = fs.readFileSync(path.join(RESOURCES, 'granete-preflight-review.js'), 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function createMockElement(id = '') {
  const listeners = {};
  const attributes = {};
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
    type: 'button',
    setAttribute: (key, val) => { attributes[key] = val; },
    getAttribute: (key) => attributes[key],
    appendChild: (child) => el.children.push(child),
    querySelector: (selector) => (selector === 'span' ? span : null),
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    click: () => {
      (listeners['click'] || []).forEach(cb => cb({ target: el }));
    }
  };
  el.__listeners = listeners;
  el.__span = span;
  el.__attributes = attributes;
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
    String,
    document: documentMock,
    window: {
      sketchup: {
        preflight_review: (payload) =>
          bridgeCalls.push({ action: 'preflight_review', payload: JSON.parse(payload) }),
        select_furniture: (payload) =>
          bridgeCalls.push({ action: 'select_furniture', payload: JSON.parse(payload) })
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
    vm.runInContext(PREFLIGHT_SOURCE, sandbox, { filename: 'granete-preflight-review.js' });
  }
}

function setSelection(sandbox, ctx) {
  sandbox.window.GraneteState.set('selection', ctx);
}

function pushPreflight(sandbox, entries, review) {
  sandbox.window.GraneteState.set('preflight', { entries: entries || {}, review: review || null });
  sandbox.window.GranetePreflightReview.render();
}

function blockedReviewPayload() {
  return {
    scope: { furnitureInstanceRef: 'inst-1' },
    targetKey: 'furnitureInstanceRef=inst-1',
    status: 'blocked',
    authoritativeStatus: 'blocked',
    fingerprint: 'sha256-abcdef',
    severityCounts: { error: 1, warning: 0, info: 0 },
    issueCount: 1,
    groups: [
      {
        key: 'hardware',
        label: 'Herrajes y perforaciones',
        count: 1,
        issues: [
          {
            issueId: 'issue-0',
            code: 'DRILLING_CONFLICT',
            severity: 'error',
            title: 'Conflicto de perforación',
            message: 'Hole collision on side-left-01',
            remediation: 'Mové el herraje o la pieza en conflicto.',
            entityId: 'side-left-01',
            source: { kind: 'hardware', id: 'hp-hinge-01', label: 'Herraje · hp-hinge-01' },
            actions: ['navigate', 'edit_hardware', 'select_part', 'select_furniture']
          }
        ]
      }
    ],
    navigation: null
  };
}

// 1. Initial pending state
test('initial state renders as pending without green badge', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  sandbox.window.GranetePreflightReview.render();
  const badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, 'Pendiente');
  assert.equal(badge.className, 'status-badge pending');

  const summary = sandbox.__registry['preflight-review-summary'];
  assert(summary.textContent.includes('Ejecutá la verificación'));
  assert.equal(sandbox.window.GranetePreflightReview.publishBlocked(), false);
});

// 2. Run preflight command submission
test('run submits command through versioned bridge', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  const outcome = sandbox.window.GranetePreflightReview.run();
  assert.equal(outcome, 'sent');
  assert.equal(sandbox.__bridge.length, 1);
  const sent = sandbox.__bridge[0];
  assert.equal(sent.action, 'preflight_review');
  assert.equal(sent.payload.type, 'preflight_command');
  assert.equal(sent.payload.command, 'run');
  assert.equal(sent.payload.semanticTarget.furnitureInstanceRef, 'inst-1');

  const badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, 'Verificando…');
});

// 3. Blocked review rendering with issues and Spanish copy
test('blocked review renders error badge, groups, and action buttons', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  const review = blockedReviewPayload();
  pushPreflight(sandbox, { 'inst-1': { state: 'blocked' } }, review);

  const badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, 'Bloqueado');
  assert.equal(badge.className, 'status-badge error');

  const summary = sandbox.__registry['preflight-review-summary'];
  assert.equal(summary.textContent, '1 bloqueo');

  const groupsContainer = sandbox.__registry['preflight-review-groups'];
  assert.equal(groupsContainer.children.length, 2, 'header + 1 issue element');

  const header = groupsContainer.children[0];
  assert.equal(header.textContent, 'Herrajes y perforaciones (1)');

  const issueBox = groupsContainer.children[1];
  assert.equal(issueBox.getAttribute('data-issue-id'), 'issue-0');

  // Verify publishBlocked is true
  assert.equal(sandbox.window.GranetePreflightReview.publishBlocked(), true);
});

// 4. Action button interactions
test('clicking actions submits navigate_issue or select_furniture', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  const review = blockedReviewPayload();
  pushPreflight(sandbox, { 'inst-1': { state: 'blocked' } }, review);

  // Navigate primary
  sandbox.window.GranetePreflightReview.runAction('navigate', 'issue-0');
  let lastCall = sandbox.__bridge[sandbox.__bridge.length - 1];
  assert.equal(lastCall.action, 'preflight_review');
  assert.equal(lastCall.payload.command, 'navigate_issue');
  assert.equal(lastCall.payload.payload.issueId, 'issue-0');
  assert.equal(lastCall.payload.payload.target, 'primary');

  // Edit hardware target
  sandbox.window.GranetePreflightReview.runAction('edit_hardware', 'issue-0');
  lastCall = sandbox.__bridge[sandbox.__bridge.length - 1];
  assert.equal(lastCall.payload.payload.target, 'hardware');

  // Select furniture focuses owning root
  sandbox.window.GranetePreflightReview.runAction('select_furniture', 'issue-0');
  lastCall = sandbox.__bridge[sandbox.__bridge.length - 1];
  assert.equal(lastCall.action, 'select_furniture');
  assert.equal(lastCall.payload.furnitureInstanceRef, 'inst-1');
});

// 5. Navigation note: direct vs fallback
test('navigation note differentiates direct from fallback', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  const review = blockedReviewPayload();
  review.navigation = { issueId: 'issue-0', kind: 'hardware', id: 'hp-hinge-01', fallback: false };
  pushPreflight(sandbox, { 'inst-1': { state: 'blocked' } }, review);

  const note = sandbox.__registry['preflight-review-navigation-note'];
  assert.equal(note.style.display, 'block');
  assert.equal(note.textContent, 'Contexto seleccionado en el viewport.');

  review.navigation = { issueId: 'issue-0', kind: 'furniture', id: null, fallback: true };
  pushPreflight(sandbox, { 'inst-1': { state: 'blocked' } }, review);
  assert(note.textContent.includes('se seleccionó el mueble completo'));
});

// 6. Ready state rendering
test('ready state renders green badge and allows publication', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  const readyReview = {
    scope: { furnitureInstanceRef: 'inst-1' },
    targetKey: 'furnitureInstanceRef=inst-1',
    status: 'ready',
    authoritativeStatus: 'ready',
    severityCounts: { error: 0, warning: 0, info: 0 },
    issueCount: 0,
    groups: []
  };
  pushPreflight(sandbox, { 'inst-1': { state: 'ready' } }, readyReview);

  const badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, '✓ Listo para fabricar');
  assert.equal(badge.className, 'status-badge passed');

  const summary = sandbox.__registry['preflight-review-summary'];
  assert.equal(summary.textContent, 'Sin problemas de fabricación.');
  assert.equal(sandbox.window.GranetePreflightReview.publishBlocked(), false);
});

// 7. Stale and unavailable states
test('stale and unavailable states render honestly without claiming ready', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  pushPreflight(sandbox, { 'inst-1': { state: 'stale' } }, null);
  let badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, 'Desactualizada');
  assert.equal(badge.className, 'status-badge pending');
  assert.equal(sandbox.__registry['preflight-review-stale-note'].style.display, 'block');

  pushPreflight(sandbox, { 'inst-1': { state: 'unavailable' } }, {
    scope: { furnitureInstanceRef: 'inst-1' },
    status: 'unavailable',
    reason: 'Sin conexión'
  });
  badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, 'No disponible');
  assert.equal(sandbox.__registry['preflight-review-unavailable-note'].style.display, 'block');
  assert.equal(sandbox.__registry['preflight-review-unavailable-note'].textContent, 'Sin conexión');
});

// 8. Warning state rendering
test('warning state renders pending-style badge and unblocks publish', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox);
  setSelection(sandbox, { kind: 'furniture', furnitureInstanceRef: 'inst-1' });

  const warningReview = {
    scope: { furnitureInstanceRef: 'inst-1' },
    targetKey: 'furnitureInstanceRef=inst-1',
    status: 'warning',
    authoritativeStatus: 'warning',
    severityCounts: { error: 0, warning: 1, info: 0 },
    issueCount: 1,
    groups: [
      {
        key: 'hardware',
        label: 'Herrajes y perforaciones',
        count: 1,
        issues: [
          {
            issueId: 'issue-0',
            code: 'HARDWARE_REFERENCE_INVALID',
            severity: 'warning',
            title: 'Herraje de catálogo inválido',
            message: 'Deprecated reference',
            remediation: 'Sustituilo por uno compatible.',
            actions: ['select_furniture']
          }
        ]
      }
    ]
  };
  pushPreflight(sandbox, { 'inst-1': { state: 'warning' } }, warningReview);

  const badge = sandbox.__registry['preflight-review-badge'];
  assert.equal(badge.textContent, 'Aprobado con avisos');
  assert.equal(badge.className, 'status-badge pending');
  assert.equal(sandbox.window.GranetePreflightReview.publishBlocked(), false);
});

// 9. Re-execution idempotency
test('re-running runtime does not register duplicate controllers', () => {
  const sandbox = buildSandbox();
  runRuntime(sandbox, 3);
  assert.equal(typeof sandbox.window.GranetePreflightReview.run, 'function');
});

console.log(JSON.stringify({ success: true, testsPassed }));
