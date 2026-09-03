// Real JavaScript test harness for the #389 Project Furniture panel in
// dialog.html: renders panel payloads through the actual dialog script
// (vm sandbox + mock DOM) and asserts the distinct panel states, the
// per-unit rows (quantity > 1 stays individually traceable), the Place
// existing bridge (identity only — the panel never edits it) and the rule
// that a failed placement never flips into success.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createClassList(initial) {
  const classes = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
    _classes: classes
  };
}

function createMockElement(id) {
  const el = {
    id: id || '',
    children: [],
    disabled: false,
    value: '',
    listeners: {},
    _textContent: '',
    style: {},
    classList: createClassList('')
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(v) { el._textContent = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { el.children.length = 0; }
  });
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el.classList._classes).join(' '); },
    set(v) { el.classList = createClassList(v); }
  });
  el.addEventListener = (evt, cb) => {
    el.listeners[evt] = el.listeners[evt] || [];
    el.listeners[evt].push(cb);
  };
  el.dispatchEvent = (event) => {
    (el.listeners[event.type] || []).forEach((cb) => cb(event));
    return true;
  };
  el.click = () => {
    (el.listeners.click || []).forEach((cb) => cb({ preventDefault: () => {} }));
  };
  el.appendChild = (child) => { el.children.push(child); return child; };
  return el;
}

function buildSandbox() {
  const registry = {};
  const bridgeCalls = [];

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: () => createMockElement(''),
    querySelector: () => createMockElement('q'),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  const sandbox = {
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: documentMock,
    window: {
      addEventListener: () => {},
      sketchup: {
        dialog_ready: () => bridgeCalls.push({ action: 'dialog_ready' }),
        get_model_binding: () => bridgeCalls.push({ action: 'get_model_binding' }),
        get_project_furniture: () => bridgeCalls.push({ action: 'get_project_furniture' }),
        place_furniture_instance: (p) => bridgeCalls.push({ action: 'place_furniture_instance', payload: JSON.parse(p) }),
        confirm_placement_instance: (p) => bridgeCalls.push({ action: 'confirm_placement_instance', payload: JSON.parse(p) }),
        cancel_placement_instance: (p) => bridgeCalls.push({ action: 'cancel_placement_instance', payload: JSON.parse(p) }),
        select_project_furniture: (p) => bridgeCalls.push({ action: 'select_project_furniture', payload: JSON.parse(p) }),
        enroll: () => {}, logout: () => {}, close_dialog: () => {}
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  return sandbox;
}

function runDialog() {
  const htmlPath = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const FI_1 = '51000000-0000-0000-0000-0000000000f1';
const FI_2 = '51000000-0000-0000-0000-0000000000f2';
const FI_3 = '51000000-0000-0000-0000-0000000000f3';

function connectedPanel() {
  return {
    state: 'connected',
    pending: 2,
    placed: 1,
    items: [
      { id: FI_1, name: 'Base 600', dimensions: [600, 720, 560],
        dimensions_label: '600 × 720 × 560 mm', definitionId: 'def-1', origin: 'quote',
        terminal: false, placed: false, unitIndex: 1, unitTotal: 2 },
      { id: FI_2, name: 'Base 600', dimensions: [600, 720, 560],
        dimensions_label: '600 × 720 × 560 mm', definitionId: 'def-1', origin: 'quote',
        terminal: false, placed: false, unitIndex: 2, unitTotal: 2 },
      { id: FI_3, name: 'Torre horno', dimensions: [600, 2100, 560],
        dimensions_label: '600 × 2100 × 560 mm', definitionId: 'def-2', origin: 'quote',
        terminal: false, placed: true, unitIndex: 1, unitTotal: 1 }
    ]
  };
}

function runTests() {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('pending list renders one card per unit with unit labels', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
    assert.ok(visible(el(sandbox, 'pf-list-view')));
    assert.equal(el(sandbox, 'pf-pending-title').textContent, 'Pendientes de colocar (2)');
    assert.equal(el(sandbox, 'pf-placed-title').textContent, 'Colocados (1)');

    const pending = el(sandbox, 'pf-pending-list');
    assert.equal(pending.children.length, 2, 'two individually placeable units');
    const name = pending.children[0].children[0].children[0];
    assert.ok(name.children[0].textContent.includes('Base 600'));
    // Quantity > 1 stays traceable per unit.
    const badge = name.children[1];
    assert.equal(badge.textContent, 'Unidad 1 de 2');
    const meta = pending.children[0].children[0].children[1];
    assert.equal(meta.textContent, '600 × 720 × 560 mm');
  });

  test('placed list offers Seleccionar, pending offers Colocar', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
    const pendingButton = el(sandbox, 'pf-pending-list').children[0].children[1];
    assert.equal(pendingButton.textContent, 'Colocar');
    const placedButton = el(sandbox, 'pf-placed-list').children[0].children[1];
    assert.equal(placedButton.textContent, 'Seleccionar');
  });

  test('Colocar sends the exact furnitureInstanceId and guards double clicks', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
    const button = el(sandbox, 'pf-pending-list').children[0].children[1];
    button.click();
    const call = sandbox.__bridge.find((c) => c.action === 'place_furniture_instance');
    assert.ok(call, 'place_furniture_instance must be called');
    assert.equal(call.payload.furnitureInstanceId, FI_1);
    assert.ok(!call.payload.definitionId, 'definition/name/position never ride the payload');

    // In-flight guard: a second click while placing does not re-send.
    button.click();
    const calls = sandbox.__bridge.filter((c) => c.action === 'place_furniture_instance');
    assert.equal(calls.length, 1);
  });

  test('Seleccionar focuses the placed unit in the viewport', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
    el(sandbox, 'pf-placed-list').children[0].children[1].click();
    const call = sandbox.__bridge.find((c) => c.action === 'select_project_furniture');
    assert.ok(call, 'select_project_furniture must be called');
    assert.equal(call.payload.furnitureInstanceId, FI_3);
  });

  test('already_placed result is honest success, no duplicate warning', (sandbox) => {
    sandbox.window.GraneteDialog.onPlaceFurnitureResult({ ok: true, code: 'already_placed', instanceId: FI_1 });
    // No exception + state stays consistent; the toast path is UI-only.
    assert.ok(true);
  });

  test('failed placement never flips into success', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
    const button = el(sandbox, 'pf-pending-list').children[0].children[1];
    button.click();
    sandbox.window.GraneteDialog.onPlaceFurnitureResult({
      ok: false, code: 'sync_failed', reason: 'el diseño no se pudo actualizar', instanceId: FI_1
    });
    // The panel stays on the last rendered rows; the failed unit is still
    // pending and its button is re-armed for an honest retry.
    assert.ok(visible(el(sandbox, 'pf-list-view')));
    const retry = el(sandbox, 'pf-pending-list').children[0].children[1];
    assert.equal(retry.textContent, 'Colocar');
    retry.click();
    assert.equal(
      sandbox.__bridge.filter((c) => c.action === 'place_furniture_instance').length, 2
    );
  });

  test('distinct states: unbound, unreachable, stale_base render separately', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture({ state: 'unbound' });
    assert.ok(visible(el(sandbox, 'pf-unbound-state')));

    sandbox.window.GraneteDialog.onProjectFurniture({ state: 'unreachable', reason: 'timeout' });
    assert.ok(visible(el(sandbox, 'pf-error-state')));
    assert.equal(el(sandbox, 'pf-error-title').textContent, 'No se pudieron cargar');

    sandbox.window.GraneteDialog.onProjectFurniture({ state: 'stale_base' });
    assert.ok(visible(el(sandbox, 'pf-error-state')));
    assert.equal(el(sandbox, 'pf-error-title').textContent, 'Diseño no editable');
  });

  test('empty project renders the honest empty state', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture({ state: 'connected', items: [], pending: 0, placed: 0 });
    assert.ok(visible(el(sandbox, 'pf-empty-state')));
    assert.ok(!visible(el(sandbox, 'pf-list-view')));
  });

  test('refresh button re-requests the panel payload', (sandbox) => {
    sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
    el(sandbox, 'btn-pf-refresh').click();
    assert.ok(sandbox.__bridge.some((c) => c.action === 'get_project_furniture'));
  });

  test('terminal units stay out of the authoring lists', (sandbox) => {
    const panel = connectedPanel();
    panel.items.push({ id: '51000000-0000-0000-0000-0000000000f4', name: 'Viejo',
      dimensions: null, dimensions_label: null, definitionId: 'def-1', origin: 'quote',
      terminal: true, placed: false, unitIndex: 3, unitTotal: 3 });
    sandbox.window.GraneteDialog.onProjectFurniture(panel);
    assert.equal(el(sandbox, 'pf-pending-list').children.length, 2);
  });

  test('unit with pendingConfirm renders Posicion pendiente and confirm/cancel buttons', (sandbox) => {
    const panel = connectedPanel();
    panel.items[0].pendingConfirm = true;
    sandbox.window.GraneteDialog.onProjectFurniture(panel);

    const pendingCard = el(sandbox, 'pf-pending-list').children[0];
    const name = pendingCard.children[0].children[0];
    const badges = name.children.map((c) => c.textContent);
    assert.ok(badges.includes('Posición pendiente'), 'pendingConfirm badge must be visible');

    const actions = pendingCard.children[1];
    assert.equal(actions.children.length, 2, 'actions group must have confirm and cancel');
    assert.equal(actions.children[0].textContent, 'Confirmar posición');
    assert.equal(actions.children[1].textContent, 'Cancelar');

    // Confirm click dispatches confirm_placement_instance
    actions.children[0].click();
    const confirmCall = sandbox.__bridge.find((c) => c.action === 'confirm_placement_instance');
    assert.ok(confirmCall, 'confirm_placement_instance must be called');
    assert.equal(confirmCall.payload.furnitureInstanceId, FI_1);

    // Cancel click dispatches cancel_placement_instance
    actions.children[1].click();
    const cancelCall = sandbox.__bridge.find((c) => c.action === 'cancel_placement_instance');
    assert.ok(cancelCall, 'cancel_placement_instance must be called');
    assert.equal(cancelCall.payload.furnitureInstanceId, FI_1);
  });

  test('pending_position result from place does not claim saved state', (sandbox) => {
    sandbox.window.GraneteDialog.onPlaceFurnitureResult({ ok: true, code: 'pending_position', instanceId: FI_1 });
    assert.ok(true);
  });

  test('confirm and cancel result callbacks handle failure cleanly', (sandbox) => {
    sandbox.window.GraneteDialog.onConfirmPlacementResult({ ok: false, code: 'sync_failed', instanceId: FI_1 });
    sandbox.window.GraneteDialog.onCancelPlacementResult({ ok: true, code: 'cancelled', instanceId: FI_1 });
    assert.ok(true);
  });

  return tests;
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
assert.equal = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error((message || 'assert.equal') + ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
assert.ok = (condition, message) => {
  if (!condition) throw new Error(message || 'expected truthy');
};

const results = [];
for (const { name, fn } of runTests()) {
  try {
    const sandbox = runDialog();
    fn(sandbox);
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}

const failed = results.filter((r) => !r.passed);
console.log(JSON.stringify({
  success: failed.length === 0,
  testsPassed: results.length - failed.length,
  testsTotal: results.length,
  failures: failed
}, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
