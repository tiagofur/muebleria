// #469 — placement preview wiring in dialog.html: the Project panel Colocar
// button and the connected Library insert both route through the shared
// preview entry points when the host exposes them, keep the entry point
// disabled while the transient preview follows the cursor, and re-arm it on
// cancel/failure with the unit still pending. The commit result flows
// through the EXISTING onPlaceFurnitureResult / onCreateProjectFurnitureResult
// handlers — no parallel success path exists.
const vm = require('vm');
const { runDialogScripts } = require('./support/dialog_scripts');

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
  const attrs = {};
  el.setAttribute = (k, v) => { attrs[k] = String(v); };
  el.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  el.removeAttribute = (k) => { delete attrs[k]; };
  el.appendChild = (child) => { el.children.push(child); return child; };
  return el;
}

function buildSandbox(withPreviewCallbacks) {
  const registry = {};
  const bridgeCalls = [];

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: () => createMockElement(''),
    querySelector: () => createMockElement('q'),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  const sketchupMock = {
    dialog_ready: () => bridgeCalls.push({ action: 'dialog_ready' }),
    get_model_binding: () => bridgeCalls.push({ action: 'get_model_binding' }),
    get_project_furniture: () => bridgeCalls.push({ action: 'get_project_furniture' }),
    place_furniture_instance: (p) => bridgeCalls.push({ action: 'place_furniture_instance', payload: JSON.parse(p) }),
    create_project_furniture: (p) => bridgeCalls.push({ action: 'create_project_furniture', payload: JSON.parse(p) }),
    confirm_placement_instance: (p) => bridgeCalls.push({ action: 'confirm_placement_instance', payload: JSON.parse(p) }),
    cancel_placement_instance: (p) => bridgeCalls.push({ action: 'cancel_placement_instance', payload: JSON.parse(p) }),
    restore_furniture_instance: (p) => bridgeCalls.push({ action: 'restore_furniture_instance', payload: JSON.parse(p) }),
    select_project_furniture: (p) => bridgeCalls.push({ action: 'select_project_furniture', payload: JSON.parse(p) }),
    synchronize_design: () => bridgeCalls.push({ action: 'synchronize_design' }),
    insert_furniture: (p) => bridgeCalls.push({ action: 'insert_furniture', payload: JSON.parse(p) }),
    enroll: () => {}, logout: () => {}, close_dialog: () => {}
  };
  if (withPreviewCallbacks) {
    sketchupMock.begin_placement_preview = (p) =>
      bridgeCalls.push({ action: 'begin_placement_preview', payload: JSON.parse(p) });
    sketchupMock.begin_catalog_placement_preview = (p) =>
      bridgeCalls.push({ action: 'begin_catalog_placement_preview', payload: JSON.parse(p) });
  }

  const sandbox = {
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: documentMock,
    crypto: { randomUUID: (() => { let seq = 0; return () => `key-${++seq}`; })() },
    window: { addEventListener: () => {}, sketchup: sketchupMock }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  return sandbox;
}

function runDialog(withPreviewCallbacks) {
  const sandbox = buildSandbox(withPreviewCallbacks);
  vm.createContext(sandbox);
  runDialogScripts(sandbox);
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
assert.equal = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error((message || 'assert.equal') + ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
assert.deepEqual = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error((message || 'assert.deepEqual') + ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
assert.notEqual = (actual, expected, message) => {
  if (actual === expected) {
    throw new Error((message || 'assert.notEqual') + ` — both were ${JSON.stringify(actual)}`);
  }
};
assert.ok = (condition, message) => {
  if (!condition) throw new Error(message || 'expected truthy');
};

const FI_1 = '51000000-0000-0000-0000-0000000000f1';

function connectedPanel() {
  return {
    state: 'connected',
    pending: 1,
    placed: 0,
    items: [
      { id: FI_1, name: 'Torre horno', dimensions: [600, 2100, 560],
        dimensions_label: '600 × 2100 × 560 mm', definitionId: 'def-2', origin: 'quote',
        terminal: false, placed: false, reconciliationState: 'unplaced', unitIndex: 1, unitTotal: 1 }
    ]
  };
}

function pendingCardButton(sandbox) {
  sandbox.window.GraneteDialog.onProjectFurniture(connectedPanel());
  const card = el(sandbox, 'pf-pending-list').children[0];
  assert.ok(card, 'pending card exists');
  return card.children[card.children.length - 1];
}

const tests = [];

tests.push(() => {
  // Without the preview callbacks the legacy origin-first command still
  // works (older host / degraded runtime).
  const sandbox = runDialog(false);
  const button = pendingCardButton(sandbox);
  button.click();
  const legacy = sandbox.__bridge.find((c) => c.action === 'place_furniture_instance');
  assert.ok(legacy, 'legacy place_furniture_instance is dispatched');
  assert.equal(legacy.payload.furnitureInstanceId, FI_1);
});

tests.push(() => {
  // With #469 the Colocar button routes to the shared preview entry point.
  const sandbox = runDialog(true);
  const button = pendingCardButton(sandbox);
  button.click();
  const preview = sandbox.__bridge.find((c) => c.action === 'begin_placement_preview');
  assert.ok(preview, 'begin_placement_preview is dispatched');
  assert.equal(preview.payload.furnitureInstanceId, FI_1);
  assert.equal(sandbox.__bridge.find((c) => c.action === 'place_furniture_instance'), undefined,
    'the legacy command must not also fire');
  assert.equal(button.disabled, true, 'entry point stays disabled while previewing');
});

tests.push(() => {
  // Preview started: guidance copy, button still held.
  const sandbox = runDialog(true);
  const button = pendingCardButton(sandbox);
  button.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, code: 'preview_active', instanceId: FI_1 });
  assert.equal(button.disabled, true);
  assert.ok(/Vista previa activa/.test(el(sandbox, 'toast-message').textContent),
    'activation toast explains click-to-place and Esc');
});

tests.push(() => {
  // Host refused the preview: honest failure, button re-armed, no success.
  const sandbox = runDialog(true);
  const button = pendingCardButton(sandbox);
  button.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted(
    { ok: false, code: 'definition_unavailable', instanceId: FI_1, reason: 'falta definición' });
  assert.equal(button.disabled, false, 'failed preview start re-arms the button');
  assert.equal(button.textContent, 'Colocar');
  assert.ok(el(sandbox, 'toast-message').textContent.length > 0, 'an honest error message is shown');
});

tests.push(() => {
  // Esc: zero residue — the unit stays pending and the button re-arms.
  const sandbox = runDialog(true);
  const button = pendingCardButton(sandbox);
  button.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, instanceId: FI_1 });
  sandbox.window.GraneteDialog.onPlacementPreviewCancelled({ ok: true, instanceId: FI_1, reason: 'escape' });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Colocar');
  assert.ok(/cancelada/.test(el(sandbox, 'toast-message').textContent),
    'cancel toast says the unit stays pending');
});

tests.push(() => {
  // The viewport click commits through the EXISTING place result handler;
  // the subsequent panel refresh moves the unit out of the pending list.
  const sandbox = runDialog(true);
  const button = pendingCardButton(sandbox);
  button.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, instanceId: FI_1 });
  sandbox.window.GraneteDialog.onPlaceFurnitureResult({ ok: true, code: 'placed', instanceId: FI_1 });
  assert.ok(/colocado/i.test(el(sandbox, 'toast-message').textContent), 'success copy shown');
  const placed = connectedPanel();
  placed.items[0].placed = true;
  placed.items[0].reconciliationState = 'present_synced';
  placed.pending = 0;
  placed.placed = 1;
  sandbox.window.GraneteDialog.onProjectFurniture(placed);
  const pendingButtons = el(sandbox, 'pf-pending-list').children
    .filter((child) => child.children && child.children.length > 0);
  assert.equal(pendingButtons.length, 0,
    'after the refresh the pending list holds no placeable card (only the empty note)');
});

tests.push(() => {
  // Commit failure through the preview path re-arms honestly (no false
  // success, unit still actionable).
  const sandbox = runDialog(true);
  const button = pendingCardButton(sandbox);
  button.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, instanceId: FI_1 });
  sandbox.window.GraneteDialog.onPlaceFurnitureResult(
    { ok: false, code: 'service_error', instanceId: FI_1, reason: 'sin conexión' });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Colocar');
  assert.ok(el(sandbox, 'toast-message').textContent.length > 0, 'an honest error message is shown');
});

tests.push(() => {
  // Connected Library insert routes to the SAME shared preview entry point;
  // identity is minted at commit only (the preview call carries no create).
  const sandbox = runDialog(true);
  sandbox.window.GraneteDialog.onModelBindingStatus({
    state: 'connected',
    binding: { projectId: 'p1', designId: 'd1', baseRevisionId: 'r1' }
  });
  sandbox.window.GraneteDialog.setCatalog([
    { furniture_definition_id: 'def-1', name: 'Base 600', category: 'kitchen_base',
      parameters: [{ name: 'widthMm', defaultValue: 600 }] }
  ]);
  const card = el(sandbox, 'library-cards-grid').children[0];
  card.click();
  const btnInsert = el(sandbox, 'btn-insert');
  btnInsert.click();

  const preview = sandbox.__bridge.find((c) => c.action === 'begin_catalog_placement_preview');
  assert.ok(preview, 'begin_catalog_placement_preview is dispatched');
  assert.equal(preview.payload.definitionId, 'def-1');
  assert.ok(preview.payload.idempotencyKey, 'idempotency key travels for the later commit');
  assert.equal(sandbox.__bridge.find((c) => c.action === 'create_project_furniture'), undefined,
    'no identity creation during preview/browsing');

  // Esc on the catalog lane re-arms the insert button.
  sandbox.window.GraneteDialog.onPlacementPreviewCancelled(
    { ok: true, definitionId: 'def-1', reason: 'escape' });
  assert.equal(btnInsert.disabled, false, 'catalog cancel re-arms insert');

  // The commit still flows through the existing create result handler.
  btnInsert.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, definitionId: 'def-1' });
  sandbox.window.GraneteDialog.onCreateProjectFurnitureResult(
    { ok: true, code: 'pending_position', instanceId: 'fi-new' });
  assert.equal(btnInsert.disabled, false);
});

tests.push(() => {
  // Host without the preview callbacks keeps the legacy connected create.
  const sandbox = runDialog(false);
  sandbox.window.GraneteDialog.onModelBindingStatus({
    state: 'connected',
    binding: { projectId: 'p1', designId: 'd1', baseRevisionId: 'r1' }
  });
  sandbox.window.GraneteDialog.setCatalog([
    { furniture_definition_id: 'def-1', name: 'Base 600', category: 'kitchen_base',
      parameters: [{ name: 'widthMm', defaultValue: 600 }] }
  ]);
  el(sandbox, 'library-cards-grid').children[0].click();
  el(sandbox, 'btn-insert').click();
  assert.ok(sandbox.__bridge.find((c) => c.action === 'create_project_furniture'),
    'legacy create_project_furniture fallback works');
});

tests.push(() => {
  // #469 increment 4 — DISCONNECTED library: the actual user entry point
  // (btnInsert on an unbound model) routes to the SAME shared preview
  // callback. The legacy origin-first insert must NOT fire while previewing.
  const sandbox = runDialog(true);
  sandbox.window.GraneteDialog.setCatalog([
    { furniture_definition_id: 'def-local', name: 'Bajo Local', category: 'kitchen_base',
      parameters: [
        { name: 'widthMm', defaultValue: 600 },
        { name: 'heightMm', defaultValue: 720 },
        { name: 'depthMm', defaultValue: 590 }
      ] }
  ]);
  const card = el(sandbox, 'library-cards-grid').children[0];
  card.click();
  const btnInsert = el(sandbox, 'btn-insert');
  btnInsert.click();

  const preview = sandbox.__bridge.find((c) => c.action === 'begin_catalog_placement_preview');
  assert.ok(preview, 'disconnected insert routes to the shared preview entry point');
  assert.equal(preview.payload.definitionId, 'def-local');
  assert.equal(sandbox.__bridge.find((c) => c.action === 'insert_furniture'), undefined,
    'the legacy origin-first insert must not fire');
  assert.equal(sandbox.__bridge.find((c) => c.action === 'create_project_furniture'), undefined,
    'no identity creation either — the model is not bound');
  assert.equal(btnInsert.disabled, true, 'entry point stays disabled while previewing');

  // The committed parameters travel on the preview payload.
  assert.ok(preview.payload.parameters && typeof preview.payload.parameters === 'object',
    'configured parameters ride the preview payload');
  assert.ok(preview.payload.materialChoices,
    'configured material choices ride the preview payload');

  // Esc re-arms the disconnected entry point.
  sandbox.window.GraneteDialog.onPlacementPreviewCancelled(
    { ok: true, definitionId: 'def-local', reason: 'escape' });
  assert.equal(btnInsert.disabled, false, 'cancel re-arms insert');

  // The local commit flows through onInsertionResult with placed_via_preview:
  // success copy WITHOUT the legacy Move-tool hint, and repeat placement
  // re-begins the same preset (held entry point) until Esc.
  btnInsert.click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, definitionId: 'def-local' });
  const beginsBeforeCommit = sandbox.__bridge
    .filter((c) => c.action === 'begin_catalog_placement_preview').length;
  sandbox.window.GraneteDialog.onInsertionResult(
    { success: true, name: 'Bajo Local', placed_via_preview: true, component_count: 5 });
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_catalog_placement_preview').length,
    beginsBeforeCommit + 1,
    'the local commit re-begins the same preset for repeat placement');
  assert.equal(btnInsert.disabled, true, 'the entry point stays held while repeating');
  const toast = el(sandbox, 'toast-message').textContent;
  assert.ok(/Bajo Local insertado/.test(toast), 'success copy shown');
  assert.equal(/movelo a su lugar/.test(toast), false,
    'the preview-lane success must not advertise a Move handoff');

  // Esc ends the repeat loop and re-arms the entry point.
  sandbox.window.GraneteDialog.onPlacementPreviewCancelled(
    { ok: true, definitionId: 'def-local', reason: 'escape' });
  assert.equal(btnInsert.disabled, false, 'Esc re-arms insert');
});

tests.push(() => {
  // Legacy fallback only: a host WITHOUT the preview callback keeps the
  // origin-first local insert (and its Move hint is then true).
  const sandbox = runDialog(false);
  sandbox.window.GraneteDialog.setCatalog([
    { furniture_definition_id: 'def-local', name: 'Bajo Local', category: 'kitchen_base',
      parameters: [{ name: 'widthMm', defaultValue: 600 }] }
  ]);
  el(sandbox, 'library-cards-grid').children[0].click();
  el(sandbox, 'btn-insert').click();
  assert.ok(sandbox.__bridge.find((c) => c.action === 'insert_furniture'),
    'legacy origin-first insert remains as the compat fallback');
  sandbox.window.GraneteDialog.onInsertionResult({ success: true, name: 'Bajo Local' });
  assert.ok(/movelo a su lugar/.test(el(sandbox, 'toast-message').textContent),
    'the legacy lane still explains the real Move handoff');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'insert_furniture').length, 1,
    'legacy success never auto-repeats');
});

tests.push(() => {
  // #469 repeat placement (connected): a converged catalog commit re-begins
  // the SAME preset preview with a FRESH idempotency key — every click
  // mints its own FurnitureInstance; Esc ends the loop.
  const sandbox = runDialog(true);
  sandbox.window.GraneteDialog.onModelBindingStatus({
    state: 'connected',
    binding: { projectId: 'p1', designId: 'd1', baseRevisionId: 'r1' }
  });
  sandbox.window.GraneteDialog.setCatalog([
    { furniture_definition_id: 'def-1', name: 'Base 600', category: 'kitchen_base',
      parameters: [{ name: 'widthMm', defaultValue: 600 }] }
  ]);
  el(sandbox, 'library-cards-grid').children[0].click();
  el(sandbox, 'btn-insert').click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, definitionId: 'def-1' });
  sandbox.window.GraneteDialog.onCreateProjectFurnitureResult(
    { ok: true, code: 'placed', instanceId: 'fi-1' });

  const begins = sandbox.__bridge.filter((c) => c.action === 'begin_catalog_placement_preview');
  assert.equal(begins.length, 2, 'the converged commit re-begins the same preset');
  assert.equal(begins[1].payload.definitionId, 'def-1', 'same definition');
  assert.deepEqual(begins[1].payload.parameters, begins[0].payload.parameters,
    'same configured parameters');
  assert.notEqual(begins[1].payload.idempotencyKey, begins[0].payload.idempotencyKey,
    'each placement gesture carries a FRESH idempotency key');
  assert.equal(el(sandbox, 'btn-insert').disabled, true, 'the entry point stays held while repeating');

  // The repeated preview announces "colocar otro"; Esc terminates.
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, definitionId: 'def-1' });
  assert.ok(/colocar otro/.test(el(sandbox, 'toast-message').textContent),
    'the repeat preview explains click-for-another / Esc-to-finish');
  sandbox.window.GraneteDialog.onPlacementPreviewCancelled(
    { ok: true, definitionId: 'def-1', reason: 'escape' });
  assert.equal(el(sandbox, 'btn-insert').disabled, false, 'Esc re-arms the entry point');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_catalog_placement_preview').length, 2,
    'cancel ends the repeat loop — no further auto-begin');
});

tests.push(() => {
  // #469 repeat placement (local/disconnected): the placed_via_preview
  // commit re-begins the same preset; pending_position (an incomplete
  // placement) must NOT repeat.
  const sandbox = runDialog(true);
  sandbox.window.GraneteDialog.setCatalog([
    { furniture_definition_id: 'def-local', name: 'Bajo Local', category: 'kitchen_base',
      parameters: [{ name: 'widthMm', defaultValue: 600 }] }
  ]);
  el(sandbox, 'library-cards-grid').children[0].click();
  el(sandbox, 'btn-insert').click();
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, definitionId: 'def-local' });
  sandbox.window.GraneteDialog.onInsertionResult(
    { success: true, name: 'Bajo Local', placed_via_preview: true });

  const begins = sandbox.__bridge.filter((c) => c.action === 'begin_catalog_placement_preview');
  assert.equal(begins.length, 2, 'the local commit re-begins the same preset');
  assert.equal(begins[1].payload.definitionId, 'def-local');
  assert.equal(el(sandbox, 'btn-insert').disabled, true);

  // A begin failure (e.g. busy/model change) answers honestly and stops repeating.
  sandbox.window.GraneteDialog.onPlacementPreviewStarted(
    { ok: false, code: 'preview_busy', definitionId: 'def-local' });
  assert.equal(el(sandbox, 'btn-insert').disabled, false, 'a failed re-begin re-arms honestly');

  // pending_position on the connected lane is an INCOMPLETE placement: no repeat.
  sandbox.window.GraneteDialog.onModelBindingStatus({
    state: 'connected',
    binding: { projectId: 'p1', designId: 'd1', baseRevisionId: 'r1' }
  });
  sandbox.window.GraneteDialog.onPlacementPreviewStarted({ ok: true, definitionId: 'def-local' });
  sandbox.window.GraneteDialog.onCreateProjectFurnitureResult(
    { ok: true, code: 'pending_position', instanceId: 'fi-x' });
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_catalog_placement_preview').length, 2,
    'pending_position must not auto-repeat');
});

const results = [];
const names = [
  'legacy place fallback without preview callbacks',
  'project colocar routes to begin_placement_preview',
  'preview started keeps entry disabled with guidance',
  'preview start failure re-arms honestly',
  'escape cancels with unit still pending',
  'commit flows through existing place result handler',
  'commit failure re-arms without false success',
  'connected library insert uses shared preview and re-arms on cancel',
  'legacy connected create fallback without preview callbacks',
  'disconnected library insert uses shared preview without legacy insert',
  'legacy origin-first insert fallback keeps its Move hint',
  'connected repeat placement re-begins with a fresh key until Esc',
  'local repeat placement re-begins; pending_position never repeats'
];
tests.forEach((fn, index) => {
  try {
    fn();
    results.push({ name: names[index] || `test ${index}`, passed: true });
  } catch (error) {
    results.push({ name: names[index] || `test ${index}`, passed: false, error: error.message });
  }
});

const failed = results.filter((r) => !r.passed);
console.log(JSON.stringify({
  success: failed.length === 0,
  testsPassed: results.length - failed.length,
  testsTotal: results.length,
  failures: failed
}, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
