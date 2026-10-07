// Focused #848 Phase B C4.9 harness for the REAL
// resources/js/granete-project-furniture.js module (window.GraneteUI.
// projectFurniture): registration + idempotent re-execution, public API
// shape, init contract + fail-fast deps, state ownership (lastPfState,
// in-flight maps, #810 sync outcomes), request/invalidate/tab-visible
// semantics, exact bridge calls, every panel state render, the result
// handlers (place/confirm/cancel/restore/sync + shared #469 preview
// handlers), the button listeners, the Model Binding invalidation seam
// and the preserved quirks. The integrated surface (GraneteDialog
// wrappers, full dialog.html chain) stays covered by
// test/js/dialog_project_furniture_test.js — this harness drives the
// module directly, never a copy of its code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RESOURCES = path.resolve(__dirname, '../../src/granete_for_sketchup/resources');
const MODULE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'js/granete-project-furniture.js'), 'utf8');

function createMockElement(id) {
  const el = {
    id: id || '',
    children: [],
    disabled: false,
    value: '',
    listeners: {},
    _textContent: '',
    // All PF state cards start hidden in the markup (no pre-render).
    style: { display: 'none' },
    className: ''
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(v) { el._textContent = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { el.children.length = 0; }
  });
  el.addEventListener = (evt, cb) => {
    el.listeners[evt] = el.listeners[evt] || [];
    el.listeners[evt].push(cb);
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
  const toasts = [];
  const timers = [];
  const configuratorCalls = [];
  let projectionRefreshes = 0;

  const documentListeners = {};
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: () => createMockElement(''),
    addEventListener: (evt, cb) => {
      documentListeners[evt] = documentListeners[evt] || [];
      documentListeners[evt].push(cb);
    },
    dispatchEvent: (evt) => {
      (documentListeners[evt.type] || []).forEach((cb) => cb(evt));
      return true;
    }
  };

  class MockCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = (init && init.detail) || {};
    }
  }

  const sandbox = {
    console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { if (id && timers[id - 1]) timers[id - 1] = null; },
    document: documentMock,
    CustomEvent: MockCustomEvent,
    JSON,
    window: {
      CustomEvent: MockCustomEvent,
      sketchup: {
        get_project_furniture: () => bridgeCalls.push({ action: 'get_project_furniture' }),
        begin_placement_preview: (p) => bridgeCalls.push({ action: 'begin_placement_preview', payload: JSON.parse(p) }),
        place_furniture_instance: (p) => bridgeCalls.push({ action: 'place_furniture_instance', payload: JSON.parse(p) }),
        confirm_placement_instance: (p) => bridgeCalls.push({ action: 'confirm_placement_instance', payload: JSON.parse(p) }),
        cancel_placement_instance: (p) => bridgeCalls.push({ action: 'cancel_placement_instance', payload: JSON.parse(p) }),
        restore_furniture_instance: (p) => bridgeCalls.push({ action: 'restore_furniture_instance', payload: JSON.parse(p) }),
        remove_project_furniture: (p) => bridgeCalls.push({ action: 'remove_project_furniture', payload: JSON.parse(p) }),
        select_project_furniture: (p) => bridgeCalls.push({ action: 'select_project_furniture', payload: JSON.parse(p) }),
        synchronize_design: () => bridgeCalls.push({ action: 'synchronize_design' })
      },
      GraneteUI: {
        configurator: {
          isRepeatPreviewActive: () => { configuratorCalls.push('isRepeatPreviewActive'); return false; },
          cancelRepeatPreview: () => configuratorCalls.push('cancelRepeatPreview'),
          rearmInsertButton: () => configuratorCalls.push('rearmInsertButton')
        }
      },
      GraneteCommercialProjection: {
        refresh: () => { projectionRefreshes += 1; }
      }
    },
    __registry: registry,
    __bridge: bridgeCalls,
    __toasts: toasts,
    __timers: timers,
    __configuratorCalls: configuratorCalls,
    __projectionRefreshes: () => projectionRefreshes
  };
  return sandbox;
}

// Runs the REAL module source; showToast is injectable to capture toasts.
function runModule(sandbox, deps) {
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'granete-project-furniture.js' });
  sandbox.window.GraneteUI.projectFurniture.init(Object.assign({
    showToast: (type, message) => sandbox.__toasts.push({ type, message })
  }, deps || {}));
  return sandbox.window.GraneteUI.projectFurniture;
}

function reexecuteModuleSource(sandbox) {
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'granete-project-furniture.js' });
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const FI_1 = '51000000-0000-0000-0000-0000000000f1';
const FI_2 = '51000000-0000-0000-0000-0000000000f2';

function connectedPanel() {
  return {
    state: 'connected',
    pending: 2,
    placed: 1,
    items: [
      { id: FI_1, name: 'Base 600', dimensions_label: '600 × 720 × 560 mm', definitionId: 'def-1',
        origin: 'quote', terminal: false, placed: false, reconciliationState: 'unplaced', unitIndex: 1, unitTotal: 2 },
      { id: FI_2, name: 'Base 600', dimensions_label: '600 × 720 × 560 mm', definitionId: 'def-1',
        origin: 'quote', terminal: false, placed: false, reconciliationState: 'unplaced', unitIndex: 2, unitTotal: 2 },
      { id: '51000000-0000-0000-0000-0000000000f3', name: 'Torre horno', dimensions_label: '600 × 2100 × 560 mm',
        definitionId: 'def-2', origin: 'quote', terminal: false, placed: true,
        reconciliationState: 'present_synced', unitIndex: 1, unitTotal: 1 }
    ]
  };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------
// Registration, API shape, init contract
// ---------------------------------------------------------------------

test('registers window.GraneteUI.projectFurniture with the exact public API', () => {
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'granete-project-furniture.js' });
  const pf = sandbox.window.GraneteUI.projectFurniture;
  const api = Object.keys(pf).sort();
  const expected = ['handleCancelPlacementResult', 'handleConfirmPlacementResult',
    'handlePlaceFurnitureResult', 'handlePlacementPreviewCancelled',
    'handlePlacementPreviewStarted', 'handleRemoveFurnitureResult',
    'handleRestoreFurnitureResult',
    'handleSynchronizeDesignResult', 'init', 'invalidate',
    'onProjectTabVisible', 'pfPlaceFailureMessage', 'renderHostSaveAwareness',
    'renderProjectFurniture', 'requestProjectFurniture',
    'cancelDebouncedSync', 'scheduleDebouncedSync', 'synchronizeDesign'].sort();
  assert.deepStrictEqual(api, expected);
  Object.keys(pf).forEach((key) => assert.strictEqual(typeof pf[key], 'function', key + ' must be a function'));
});

test('module re-execution is idempotent: same API identity, no duplicated listeners', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  reexecuteModuleSource(sandbox);
  assert.strictEqual(sandbox.window.GraneteUI.projectFurniture, pf,
    're-execution must keep the first registration');
  assert.equal(el(sandbox, 'btn-pf-refresh').listeners.click.length, 1);
  assert.equal(el(sandbox, 'btn-pf-retry').listeners.click.length, 1);
  assert.equal(el(sandbox, 'btn-design-sync').listeners.click.length, 1);
});

test('init contract: the toast dep enters by injection and is consumed at call time', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.handleSynchronizeDesignResult({ ok: false, code: 'conflict', reason: 'x' });
  assert.equal(sandbox.__toasts.length, 1);
  assert.equal(sandbox.__toasts[0].type, 'error');
});

test('public entries fail fast listing missing deps when init was skipped', () => {
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'granete-project-furniture.js' });
  const pf = sandbox.window.GraneteUI.projectFurniture;
  ['renderProjectFurniture', 'requestProjectFurniture', 'handlePlaceFurnitureResult',
    'handlePlacementPreviewStarted', 'handlePlacementPreviewCancelled',
    'handleConfirmPlacementResult', 'handleCancelPlacementResult',
    'handleRestoreFurnitureResult', 'handleSynchronizeDesignResult',
    'renderHostSaveAwareness'].forEach((entry) => {
    assert.throws(() => pf[entry]({}), /GraneteUI\.projectFurniture\.init is required before use; missing deps: showToast/,
      entry + ' must fail fast before init');
  });
});

test('invalidate and pfPlaceFailureMessage are dep-free by contract', () => {
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SOURCE, sandbox, { filename: 'granete-project-furniture.js' });
  const pf = sandbox.window.GraneteUI.projectFurniture;
  assert.doesNotThrow(() => pf.invalidate());
  assert.equal(pf.pfPlaceFailureMessage({ code: 'unbound' }), 'Conectá el modelo al proyecto primero.');
});

// ---------------------------------------------------------------------
// State ownership + request/invalidate/tab-visible semantics
// ---------------------------------------------------------------------

test('onProjectTabVisible requests the rows exactly once on first load', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  assert.equal(visible(el(sandbox, 'pf-loading-state')), false, 'no pre-render');
  pf.onProjectTabVisible();
  assert.equal(visible(el(sandbox, 'pf-loading-state')), true);
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 1);
  pf.onProjectTabVisible();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 2,
    'preserved quirk: visits before the first payload re-request (lastPfState stays null until a render)');
});

test('request keeps the rendered connected list and never flashes the loading card', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  assert.equal(visible(el(sandbox, 'pf-list-view')), true);
  pf.requestProjectFurniture();
  assert.equal(visible(el(sandbox, 'pf-loading-state')), false,
    'stale-state handling: the list stays visible while refreshing');
  assert.equal(visible(el(sandbox, 'pf-list-view')), true);
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 1);
});

test('request without a bridge falls back to the unbound render', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  delete sandbox.window.sketchup;
  pf.onProjectTabVisible();
  assert.equal(visible(el(sandbox, 'pf-unbound-state')), true);
});

test('invalidate clears the rendered-state guard so the next tab visit reloads', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  pf.onProjectTabVisible();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 0,
    'a rendered connected panel is not re-requested');
  pf.invalidate();
  pf.onProjectTabVisible();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 1,
    'after invalidation the Proyecto tab reloads the rows');
  assert.equal(visible(el(sandbox, 'pf-loading-state')), true,
    'invalidated rows show the loading card again');
});

// ---------------------------------------------------------------------
// Panel state rendering
// ---------------------------------------------------------------------

test('connected render: counts, titles, pending/placed split and terminal exclusion', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.items.push({ id: '51000000-0000-0000-0000-0000000000f4', name: 'Viejo',
    terminal: true, placed: false, reconciliationState: 'terminal', unitIndex: 3, unitTotal: 3 });
  pf.renderProjectFurniture(panel);
  assert.equal(visible(el(sandbox, 'pf-list-view')), true);
  assert.equal(el(sandbox, 'pf-count-badge').textContent, '1 puesto · 2 pendientes');
  assert.equal(el(sandbox, 'pf-pending-title').textContent, 'Pendientes y divergencias (2)');
  assert.equal(el(sandbox, 'pf-placed-title').textContent, 'Puestos / Sincronizados (1)');
  assert.equal(el(sandbox, 'pf-pending-list').children.length, 2);
  assert.equal(el(sandbox, 'pf-placed-list').children.length, 1);
  assert.equal(visible(el(sandbox, 'design-sync-card')), true);
});

test('attention suffix renders only when attention > 0', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  assert.equal(el(sandbox, 'pf-count-badge').textContent, '1 puesto · 2 pendientes');
  const panel = connectedPanel();
  panel.attention = 2;
  pf.renderProjectFurniture(panel);
  assert.equal(el(sandbox, 'pf-count-badge').textContent, '1 puesto · 2 pendientes · 2 requieren atención');
});

test('empty project renders the honest empty state (and hides the sync card)', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture({ state: 'connected', items: [], pending: 0, placed: 0 });
  assert.equal(visible(el(sandbox, 'pf-empty-state')), true);
  assert.equal(visible(el(sandbox, 'pf-list-view')), false);
});

test('error states: titles, copy table and the unreachable reason-suffix rule', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture({ state: 'unbound' });
  assert.equal(visible(el(sandbox, 'pf-unbound-state')), true);

  pf.renderProjectFurniture({ state: 'unreachable', reason: 'timeout' });
  assert.equal(el(sandbox, 'pf-error-title').textContent, 'No se pudieron cargar');
  assert.equal(el(sandbox, 'pf-error-detail').textContent, 'No se pudo contactar al servidor. Probá de nuevo.',
    'preserved quirk: unreachable never appends the reason suffix');

  pf.renderProjectFurniture({ state: 'stale_base' });
  assert.equal(el(sandbox, 'pf-error-title').textContent, 'Diseño no editable');
  assert.equal(visible(el(sandbox, 'pf-error-state')), true);

  pf.renderProjectFurniture({ state: 'bad_contract', reason: 'shape mismatch' });
  assert.equal(el(sandbox, 'pf-error-detail').textContent,
    'El servidor respondió datos que esta extensión no entiende. Actualizá la extensión. (shape mismatch)');

  pf.renderProjectFurniture({ state: 'mystery_state', reason: 'algo raro' });
  assert.equal(el(sandbox, 'pf-error-detail').textContent, 'algo raro',
    'unknown states fall back to the raw reason');
});

test('unit cards: per-unit badge, reconciliation copy, ref slice and empty list notes', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const pending = el(sandbox, 'pf-pending-list');
  const name = pending.children[0].children[0].children[0];
  assert.ok(name.children[0].textContent.includes('Base 600'));
  assert.equal(name.children[1].textContent, 'Unidad 1 de 2');
  assert.equal(pending.children[0].children[0].children[2].textContent, 'Unidad ' + FI_1.slice(0, 8),
    'Granete IDs are diagnostics: muted "Unidad <short-id>" secondary line (#870)');

  const placed = el(sandbox, 'pf-placed-list');
  assert.ok(buttonWithLabel(placed.children[0], 'Seleccionar'),
    'the placed card footer owns the Seleccionar action');

  pf.renderProjectFurniture({ state: 'connected', items: [], pending: 0, placed: 0, dirty: 0 });
  // Empty connected went to the empty state; force a list render through
  // the missing_local path to exercise the no-rows note instead.
  const panel = connectedPanel();
  panel.items = [];
  panel.pending = 0;
  panel.placed = 0;
  // items: [] renders the empty card, so exercise renderPfList emptiness
  // through a payload whose only rows are terminal (filtered out).
  const terminalOnly = { state: 'connected', pending: 0, placed: 0, dirty: 0,
    items: [{ id: 't1', name: 'Viejo', terminal: true, placed: false, reconciliationState: 'terminal' }] };
  pf.renderProjectFurniture(terminalOnly);
  assert.equal(el(sandbox, 'pf-pending-list').children.length, 1);
  assert.ok(el(sandbox, 'pf-pending-list').children[0].textContent.includes('No hay unidades pendientes ni divergencias.'));
  assert.ok(el(sandbox, 'pf-placed-list').children[0].textContent.includes('Todavía no hay unidades sincronizadas.'));
});

// ---------------------------------------------------------------------
// Exact bridge calls + action lifecycle
// ---------------------------------------------------------------------

test('Colocar prefers the #469 preview and sends identity only, with in-flight guard', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const button = buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar');
  button.click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_placement_preview').length, 1);
  assert.equal(sandbox.__bridge[0].payload.furnitureInstanceId, FI_1);
  assert.ok(!sandbox.__bridge[0].payload.definitionId, 'definition/name/position never ride the payload');
  assert.equal(button.textContent, 'Colocando…');
  button.click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_placement_preview').length, 1,
    'double click must not re-send');
  const second = buttonWithLabel(el(sandbox, 'pf-pending-list').children[1], 'Colocar');
  second.click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_placement_preview').length, 2);
});

test('Colocar falls back to place_furniture_instance without the preview bridge', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  delete sandbox.window.sketchup.begin_placement_preview;
  buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar').click();
  const call = sandbox.__bridge.find((c) => c.action === 'place_furniture_instance');
  assert.ok(call, 'legacy place command must be the fallback');
  assert.equal(call.payload.furnitureInstanceId, FI_1);
});

test('Colocar without any bridge re-arms honestly with the exact toast', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  delete sandbox.window.sketchup;
  buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar').click();
  assert.equal(buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar').textContent, 'Colocar');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Colocar disponible sólo dentro de SketchUp.');
});

test('Seleccionar dispatches select_project_furniture with exact identity', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  buttonWithLabel(el(sandbox, 'pf-placed-list').children[0], 'Seleccionar').click();
  const call = sandbox.__bridge.find((c) => c.action === 'select_project_furniture');
  assert.ok(call);
  assert.equal(call.payload.furnitureInstanceId, '51000000-0000-0000-0000-0000000000f3');
});

test('pending_confirmation row offers confirm + cancel with exact payloads', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.items[0].reconciliationState = 'pending_confirmation';
  pf.renderProjectFurniture(panel);
  const actions = el(sandbox, 'pf-pending-list').children[0].children[1];
  assert.equal(actions.children[0].textContent, 'Reintentar sincronización');
  assert.equal(actions.children[1].textContent, 'Cancelar');
  actions.children[0].click();
  actions.children[1].click();
  assert.equal(sandbox.__bridge.find((c) => c.action === 'confirm_placement_instance').payload.furnitureInstanceId, FI_1);
  assert.equal(sandbox.__bridge.find((c) => c.action === 'cancel_placement_instance').payload.furnitureInstanceId, FI_1);
});

// ---------------------------------------------------------------------
// #870 — missing_local dual recovery (restore recorded position + manual
// placement of the SAME existing unit through the shared #469 preview)
// ---------------------------------------------------------------------

function renderMissingCard(sandbox, pf) {
  const panel = connectedPanel();
  panel.items[0].reconciliationState = 'missing_local';
  panel.items[0].reason = 'Granete espera este mueble, pero falta en este archivo SketchUp';
  pf.renderProjectFurniture(panel);
  return el(sandbox, 'pf-pending-list').children[0];
}

test('missing card: full-width information first, then the two compact recovery actions', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const card = renderMissingCard(sandbox, pf);

  assert.equal(card.className, 'card pf-unit-card pf-unit-card--recovery',
    'the recovery card stacks vertically — no side-by-side giant button');
  assert.equal(card.children.length, 2, 'information block + one unified action footer (#1177 smoke fix)');
  const main = card.children[0];
  const actions = card.children[1];
  assert.equal(main.className, 'pf-unit-main');
  assert.equal(actions.className, 'pf-unit-actions');
  assert.equal(actions.children.length, 3, 'two recovery intents + the danger remove exit');
  assert.equal(actions.children[0].textContent, '↶ Restaurar posición');
  assert.equal(actions.children[1].textContent, '+ Colocar manualmente');
  const removeSection = actions.children[2];
  assert.equal(removeSection.className, 'btn btn-danger', 'the remove action is the danger exit (#1177)');
  assert.equal(removeSection.children[1].textContent, 'Quitar del proyecto');
  assert.equal(removeSection.disabled, false);

  // New plain copy replaces the raw reconciliation reason (#870 §8).
  const mainText = main.children.map((child) => child.textContent).join('\n');
  assert.ok(mainText.includes('Este mueble pertenece al proyecto, pero ya no está en este archivo de SketchUp.'));
  assert.ok(mainText.includes('Puedes restaurarlo en su posición anterior o colocarlo nuevamente.'));
  assert.ok(!mainText.includes('Granete espera este mueble'), 'the old confusing reason copy is gone');

  // Technical id stays diagnostic: muted secondary line.
  const ref = main.children[main.children.length - 1];
  assert.equal(ref.className, 'pf-unit-ref');
  assert.equal(ref.textContent, 'Unidad ' + FI_1.slice(0, 8));

  // Information precedes the actions in DOM order (narrow-panel safe).
  assert.ok(card.children.indexOf(main) < card.children.indexOf(actions));
});

test('Restaurar posición dispatches the exact restore bridge and blocks the manual intent', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const actions = renderMissingCard(sandbox, pf).children[1];

  actions.children[0].click();
  const call = sandbox.__bridge.find((c) => c.action === 'restore_furniture_instance');
  assert.ok(call, 'the existing restore bridge serves the recorded-position intent');
  assert.deepStrictEqual(call.payload, { furnitureInstanceId: FI_1 });
  assert.equal(actions.children[0].textContent, 'Restaurando…');
  assert.equal(actions.children[0].disabled, true);

  actions.children[1].click();
  assert.ok(!sandbox.__bridge.find((c) => c.action === 'begin_placement_preview'),
    'no preview may start while the same unit is restoring');
});

test('Colocar manualmente begins the shared #469 preview with the exact existing identity', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const actions = renderMissingCard(sandbox, pf).children[1];

  actions.children[1].click();
  const call = sandbox.__bridge.find((c) => c.action === 'begin_placement_preview');
  assert.ok(call, 'manual placement reuses the shared preview entry point — no second pipeline');
  assert.deepStrictEqual(call.payload, { furnitureInstanceId: FI_1 },
    'identity only: the missing unit itself, never a definition/new-unit payload');
  assert.equal(actions.children[1].textContent, 'Colocando…');

  actions.children[1].click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'begin_placement_preview').length, 1,
    'double click must not re-send (no duplicate gesture)');

  actions.children[0].click();
  assert.ok(!sandbox.__bridge.find((c) => c.action === 'restore_furniture_instance'),
    'restore must not start while the same unit is placing');

  // Identity invariant (#870): this lane NEVER creates furniture.
  assert.ok(!sandbox.__bridge.some((c) => c.action === 'create_project_furniture'),
    'manual placement of an existing unit never calls the create-unit flow');
});

test('manual placement cancelled: manual label re-arm, missing-state copy, no panel mutation', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const actions = renderMissingCard(sandbox, pf).children[1];
  const before = sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length;

  actions.children[1].click();
  pf.handlePlacementPreviewCancelled({ instanceId: FI_1 });
  assert.equal(actions.children[1].textContent, '+ Colocar manualmente');
  assert.equal(actions.children[1].disabled, false);
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Colocación cancelada: el mueble sigue faltando en este archivo.');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, before,
    'cancel never re-requests the panel — the unit keeps its missing state');
});

test('manual placement preview refused: re-arm keeps the manual label and writes the diagnostic', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const actions = renderMissingCard(sandbox, pf).children[1];

  actions.children[1].click();
  pf.handlePlacementPreviewStarted({ ok: false, code: 'preview_busy', instanceId: FI_1 });
  assert.equal(actions.children[1].textContent, '+ Colocar manualmente');
  assert.equal(actions.children[1].disabled, false);
  assert.ok(el(sandbox, 'pf-placement-error').textContent.includes('preview_busy'));
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].type, 'error');
});

test('manual placement result path: success, pending_position and failure re-arm the manual label', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const actions = renderMissingCard(sandbox, pf).children[1];

  actions.children[1].click();
  pf.handlePlaceFurnitureResult({ ok: true, code: 'placed', instanceId: FI_1 });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    '✓ Mueble colocado y sincronizado con el diseño.');

  actions.children[1].click();
  pf.handlePlaceFurnitureResult({ ok: true, code: 'pending_position', instanceId: FI_1 });
  assert.equal(actions.children[1].textContent, '+ Colocar manualmente');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Mueble insertado, pero la sincronización de posición quedó pendiente.');

  actions.children[1].click();
  pf.handlePlaceFurnitureResult({ ok: false, code: 'resolution_failed', reason: 'boom', instanceId: FI_1 });
  assert.equal(actions.children[1].textContent, '+ Colocar manualmente');
  assert.ok(el(sandbox, 'pf-placement-error').textContent.includes('boom'));
});

// ---------------------------------------------------------------------
// Result handlers
// ---------------------------------------------------------------------

test('handlePlaceFurnitureResult: already_placed honest success without panel reload', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const before = sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length;
  pf.handlePlaceFurnitureResult({ ok: true, code: 'already_placed', instanceId: FI_1 });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Ese mueble ya está colocado: se seleccionó el existente.');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, before,
    'ok place results do not re-request (the Ruby push refreshes the panel)');
});

test('handlePlaceFurnitureResult: pending_position re-arms the button (preserved quirk)', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const button = buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar');
  button.click();
  pf.handlePlaceFurnitureResult({ ok: true, code: 'pending_position', instanceId: FI_1 });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Colocar');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Mueble insertado, pero la sincronización de posición quedó pendiente.');
});

test('handlePlaceFurnitureResult: failure re-arms and writes the exact diagnostic', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const button = buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar');
  button.click();
  pf.handlePlaceFurnitureResult({ ok: false, code: 'resolution_failed', reason: 'MATERIAL_CHOICE_INVALID', instanceId: FI_1 });
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Colocar');
  const diagnostic = el(sandbox, 'pf-placement-error');
  assert.ok(visible(diagnostic));
  assert.ok(diagnostic.textContent.includes('MATERIAL_CHOICE_INVALID'));
  assert.ok(diagnostic.textContent.includes(FI_1));
  assert.equal(visible(el(sandbox, 'pf-list-view')), true, 'rows keep their last server state');
});

test('handleConfirmPlacementResult / handleCancelPlacementResult re-arm on failure only', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.items[0].reconciliationState = 'pending_confirmation';
  pf.renderProjectFurniture(panel);
  const actions = el(sandbox, 'pf-pending-list').children[0].children[1];

  actions.children[0].click();
  pf.handleConfirmPlacementResult({ ok: true, instanceId: FI_1 });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, '✓ Posición sincronizada con el taller.');

  actions.children[0].click();
  pf.handleConfirmPlacementResult({ ok: false, code: 'sync_failed', instanceId: FI_1 });
  assert.equal(actions.children[0].textContent, 'Reintentar sincronización');

  actions.children[1].click();
  pf.handleCancelPlacementResult({ ok: true, instanceId: FI_1 });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'Colocación cancelada.');

  actions.children[1].click();
  pf.handleCancelPlacementResult({ ok: false, reason: 'no se pudo', instanceId: FI_1 });
  assert.equal(actions.children[1].textContent, 'Cancelar');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'no se pudo');
});

test('handleRestoreFurnitureResult: success reloads the panel, restored=false keeps the verified copy', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.items[0].reconciliationState = 'missing_local';
  pf.renderProjectFurniture(panel);
  const button = el(sandbox, 'pf-pending-list').children[0].children[1].children[0];
  button.click();
  const before = sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length;
  pf.handleRestoreFurnitureResult({ ok: true, restored: false, instanceId: FI_1 });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'El mueble ya estaba restaurado y verificado.');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, before + 1,
    'restore success re-requests the panel');
  button.click();
  pf.handleRestoreFurnitureResult({ ok: true, instanceId: FI_1 });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, '✓ Mueble restaurado en este archivo.');
  button.click();
  pf.handleRestoreFurnitureResult({ ok: false, code: 'recovery_blocked', instanceId: FI_1 });
  assert.equal(button.textContent, '↶ Restaurar posición');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'La restauración está bloqueada.');
});

// ---------------------------------------------------------------------
// Shared #469 placement-preview handlers (Project lane + catalog callouts)
// ---------------------------------------------------------------------

test('handlePlacementPreviewStarted: ok toast picks the catalog copy through the call-time configurator API', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.handlePlacementPreviewStarted({ ok: true });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Vista previa activa: hacé clic en el modelo para colocar · Esc para cancelar.');
  assert.deepStrictEqual(sandbox.__configuratorCalls, ['isRepeatPreviewActive']);

  // With the repeat preview active the catalog-lane copy wins.
  sandbox.window.GraneteUI.configurator.isRepeatPreviewActive = () => {
    sandbox.__configuratorCalls.push('isRepeatPreviewActive');
    return true;
  };
  pf.handlePlacementPreviewStarted({ ok: true });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Vista previa activa: hacé clic para colocar otro · Esc para terminar.');
});

test('handlePlacementPreviewStarted: refusal re-arms the unit + catalog entry point and writes the diagnostic', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const button = buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar');
  button.click();
  pf.handlePlacementPreviewStarted({ ok: false, code: 'preview_busy', instanceId: FI_1 });
  assert.equal(button.textContent, 'Colocar');
  assert.ok(el(sandbox, 'pf-placement-error').textContent.includes('preview_busy'));
  assert.deepStrictEqual(sandbox.__configuratorCalls, ['cancelRepeatPreview'],
    'the failed project-lane preview still cancels any catalog repeat');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].type, 'error');

  // Catalog lane (definitionId only): re-arm the library insert button.
  sandbox.__configuratorCalls.length = 0;
  pf.handlePlacementPreviewStarted({ ok: false, code: 'preview_unavailable', definitionId: 'def-9' });
  assert.deepStrictEqual(sandbox.__configuratorCalls, ['cancelRepeatPreview', 'rearmInsertButton']);
});

test('handlePlacementPreviewCancelled: unit stays pending / catalog lane re-arms the insert button', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const button = buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar');
  button.click();
  pf.handlePlacementPreviewCancelled({ instanceId: FI_1 });
  assert.equal(button.textContent, 'Colocar');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Colocación cancelada: el mueble sigue pendiente.');

  sandbox.__configuratorCalls.length = 0;
  pf.handlePlacementPreviewCancelled({ definitionId: 'def-9' });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Colocación cancelada: no se insertó nada en el modelo.');
  assert.deepStrictEqual(sandbox.__configuratorCalls, ['cancelRepeatPreview', 'rearmInsertButton']);
});

// ---------------------------------------------------------------------
// #810 design synchronization surface
// ---------------------------------------------------------------------

test('synchronizeDesign: busy guard, Sincronizando copy and the no-bridge honest failure', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  el(sandbox, 'btn-design-sync').click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'synchronize_design').length, 1);
  assert.equal(el(sandbox, 'design-sync-badge').textContent, 'Sincronizando');
  el(sandbox, 'btn-design-sync').click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'synchronize_design').length, 1,
    'double click while busy never re-enters');

  const noBridge = buildSandbox();
  const pfNoBridge = runModule(noBridge);
  delete noBridge.window.sketchup;
  pfNoBridge.handleSynchronizeDesignResult; // no-op reference check
  el(noBridge, 'btn-design-sync').click();
  assert.equal(noBridge.__toasts[noBridge.__toasts.length - 1].message,
    'Sincronización disponible sólo dentro de SketchUp.');
  assert.equal(el(noBridge, 'btn-design-sync').textContent, 'Sincronizar diseño');
});

test('handleSynchronizeDesignResult: success refreshes the projection + panel; conflict/error keep honest outcomes', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const refreshes = sandbox.__projectionRefreshes();
  pf.handleSynchronizeDesignResult({ ok: true, code: 'synchronized', changes: { added: [FI_1], updated: [], removed: [FI_2] } });
  assert.equal(sandbox.__projectionRefreshes(), refreshes + 1,
    'the confirmed total comes from the backend projection (#810 rule F)');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'Diseño sincronizado (2 cambios).');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 1);

  pf.handleSynchronizeDesignResult({ ok: true, changes: {} });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'El diseño ya estaba sincronizado.');

  pf.handleSynchronizeDesignResult({ ok: false, code: 'conflict', reason: 'cambió' });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'Conflicto: el diseño cambió en el servidor.');

  pf.handleSynchronizeDesignResult({ ok: false, code: 'unreachable', reason: 'down' });
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message, 'No se pudo sincronizar el diseño.');
});

test('design-sync card renders the exact pending/synchronized/conflict/error outcomes', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();

  panel.dirty = 2;
  pf.renderProjectFurniture(panel);
  assert.equal(el(sandbox, 'design-sync-badge').className, 'status-badge pending');
  assert.equal(el(sandbox, 'design-sync-badge').textContent, 'Pendiente');
  assert.ok(el(sandbox, 'design-sync-status').textContent.includes('2 cambios locales pendientes'));
  assert.equal(el(sandbox, 'btn-design-sync').disabled, false);

  panel.dirty = 0;
  pf.renderProjectFurniture(panel);
  assert.equal(el(sandbox, 'design-sync-badge').textContent, 'Sincronizado');
  assert.equal(el(sandbox, 'btn-design-sync').disabled, true, 'a clean design cannot re-sync');

  pf.handleSynchronizeDesignResult({ ok: false, code: 'conflict', reason: 'x' });
  pf.renderProjectFurniture(panel);
  assert.equal(el(sandbox, 'design-sync-badge').textContent, 'Conflicto');

  pf.handleSynchronizeDesignResult({ ok: false, code: 'unreachable', reason: 'abajo' });
  pf.renderProjectFurniture(panel);
  assert.equal(el(sandbox, 'design-sync-badge').textContent, 'Error de sincronización');
  assert.equal(el(sandbox, 'btn-design-sync').textContent, 'Reintentar sincronización');
});

// ---------------------------------------------------------------------
// Button listeners + seams
// ---------------------------------------------------------------------

test('refresh button disarms, requests and re-arms after the 500ms window', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());
  const refresh = el(sandbox, 'btn-pf-refresh');
  refresh.click();
  assert.equal(refresh.disabled, true);
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 1);
  assert.equal(sandbox.__timers.length, 1, 'the re-arm is timer-based, not immediate');
  sandbox.__timers[0]();
  assert.equal(refresh.disabled, false);
});

test('retry button re-requests the panel', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture({ state: 'unreachable' });
  el(sandbox, 'btn-pf-retry').click();
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'get_project_furniture').length, 1);
});

test('pfPlaceFailureMessage: reason passthrough and the grouped context-changed family', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  assert.equal(pf.pfPlaceFailureMessage({ code: 'service_error', reason: 'boom' }), 'boom');
  assert.equal(pf.pfPlaceFailureMessage({ code: 'service_error' }), 'Error de comunicación con el servidor.');
  ['working_copy_changed', 'authority_changed', 'binding_changed', 'context_changed'].forEach((code) => {
    assert.equal(pf.pfPlaceFailureMessage({ code }), 'El modelo o el diseño cambió; actualizá y reintentá.');
  });
  assert.equal(pf.pfPlaceFailureMessage({ code: 'mystery' }), 'No se pudo colocar el mueble.');
});

test('renderHostSaveAwareness toggles the banner from the Ruby projection', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderHostSaveAwareness({ needsSave: true });
  assert.equal(visible(el(sandbox, 'pf-save-awareness')), true);
  pf.renderHostSaveAwareness({ needsSave: false });
  assert.equal(visible(el(sandbox, 'pf-save-awareness')), false);
});

// ---------------------------------------------------------------------
// Structural: single authorities
// ---------------------------------------------------------------------

test('structural: the module owns no model-binding state and no wrapper fan-out', () => {
  ['var modelBindingState', 'GraneteCommercialProjection.setHostReconciliation',
    'renderModelBindingStatus', 'window.GraneteUI.modelBinding',
    'function handleCreateProjectFurnitureResult('].forEach((symbol) => {
    assert.ok(!MODULE_SOURCE.includes(symbol), 'project-furniture module must not carry ' + symbol);
  });
});

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
assert.equal = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error((message || 'assert.equal') + ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
assert.strictEqual = (actual, expected, message) => assert.equal(actual, expected, message);
assert.ok = (condition, message) => {
  if (!condition) throw new Error(message || 'expected truthy');
};
assert.deepStrictEqual = (actual, expected, message) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((message || 'assert.deepStrictEqual') + ` — expected ${e}, got ${a}`);
};
assert.throws = (fn, matcher, message) => {
  let threw = null;
  try { fn(); } catch (error) { threw = error; }
  if (!threw) throw new Error((message || 'assert.throws') + ' — no exception thrown');
  if (matcher && !matcher.test(threw.message)) {
    throw new Error((message || 'assert.throws') + ` — message "${threw.message}" does not match ${matcher}`);
  }
};
assert.doesNotThrow = (fn, message) => {
  try { fn(); } catch (error) {
    throw new Error((message || 'assert.doesNotThrow') + ` — threw ${error.message}`);
  }
};

const results = [];
// #784 R3 final review — a confirmed Sincronizar diseño re-reads the
// inheritance projection (the server just accepted the new material
// lineage; the badge must return to server truth without local inference).
// ---------------------------------------------------------------------------

test('R3 refresh: a successful synchronize_design refreshes the inheritance projection exactly once', () => {
  const refreshCalls = [];
  const sandbox = buildSandbox();
  const pf = runModule(sandbox, {
    refreshDesignInheritance: () => refreshCalls.push('refresh')
  });
  pf.handleSynchronizeDesignResult({ ok: true, changes: { added: ['a'], updated: [], removed: [] } });
  assert.strictEqual(refreshCalls.length, 1,
    'a confirmed synchronize must refresh the inheritance projection exactly once');
});

test('R3 refresh: a failed synchronize_design does not refresh the projection', () => {
  const refreshCalls = [];
  const sandbox = buildSandbox();
  const pf = runModule(sandbox, {
    refreshDesignInheritance: () => refreshCalls.push('refresh')
  });
  pf.handleSynchronizeDesignResult({ ok: false, code: 'conflict', reason: 'x' });
  assert.strictEqual(refreshCalls.length, 0,
    'a failed synchronize must not claim new server truth');
});

test('debounced auto-sync: dirty payload schedules auto-sync timer', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 2;
  pf.renderProjectFurniture(panel);
  assert.strictEqual(sandbox.__timers.filter(Boolean).length, 1, 'dirty panel must schedule debounced auto-sync');
  assert.equal(el(sandbox, 'design-sync-badge').textContent, 'Pendiente');
});

test('debounced auto-sync: consecutive dirty calls collapse into a single scheduled sync', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 1;
  pf.renderProjectFurniture(panel);
  panel.dirty = 2;
  pf.renderProjectFurniture(panel);
  panel.dirty = 3;
  pf.renderProjectFurniture(panel);

  const activeTimers = sandbox.__timers.filter(Boolean);
  assert.strictEqual(activeTimers.length, 1, 'previous timers must be cleared, leaving 1 active timer');
  // Trigger debounced auto-sync
  activeTimers[0]();
  const syncCalls = sandbox.__bridge.filter((c) => c.action === 'synchronize_design');
  assert.strictEqual(syncCalls.length, 1, 'only one synchronize_design call should be dispatched');
  assert.strictEqual(el(sandbox, 'design-sync-status').textContent, 'Actualizando presupuesto…');
});

test('debounced auto-sync: successful auto-sync suppresses success toast but refreshes projection', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 1;
  pf.renderProjectFurniture(panel);

  const activeTimers = sandbox.__timers.filter(Boolean);
  assert.strictEqual(activeTimers.length, 1);
  activeTimers[0]();

  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });

  assert.strictEqual(sandbox.__toasts.length, 0, 'auto-sync must not spam with success toast');
  assert.strictEqual(sandbox.__projectionRefreshes(), 1, 'auto-sync must refresh GraneteCommercialProjection');
});

test('debounced auto-sync: auto conflict stays silent, records the outcome and blocks further auto-sync', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 1;
  pf.renderProjectFurniture(panel);

  const activeTimers = sandbox.__timers.filter(Boolean);
  activeTimers[0]();

  pf.handleSynchronizeDesignResult({
    ok: false,
    code: 'conflict',
    reason: 'server divergence'
  });

  assert.strictEqual(sandbox.__toasts.length, 0, 'auto-sync conflict stays silent (presentation mode); the card owns the state');

  // New dirty render while in conflict should NOT schedule auto-sync
  sandbox.__timers.length = 0;
  pf.renderProjectFurniture(panel);
  assert.strictEqual(sandbox.__timers.filter(Boolean).length, 0, 'must not auto-sync during unacknowledged conflict');
  assert.strictEqual(el(sandbox, 'design-sync-badge').textContent, 'Conflicto');
});

test('debounced auto-sync: auto failure stays silent while the card renders the honest error state', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 1;
  pf.renderProjectFurniture(panel);

  const activeTimers = sandbox.__timers.filter(Boolean);
  activeTimers[0]();

  pf.handleSynchronizeDesignResult({
    ok: false,
    code: 'unreachable',
    reason: 'down'
  });

  assert.strictEqual(sandbox.__toasts.length, 0, 'a background auto-sync failure never toasts');

  pf.renderProjectFurniture(panel);
  assert.strictEqual(el(sandbox, 'design-sync-badge').textContent, 'Error de sincronización', 'the card owns the visible outcome');
  assert.strictEqual(el(sandbox, 'btn-design-sync').textContent, 'Reintentar sincronización');
});

test('debounced auto-sync: active mutation suppresses auto-sync', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteMutation = {
    phase: () => 'resolving'
  };
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 1;
  pf.renderProjectFurniture(panel);

  assert.strictEqual(sandbox.__timers.filter(Boolean).length, 0, 'active mutation must suppress auto-sync');
  const syncCalls = sandbox.__bridge.filter((c) => c.action === 'synchronize_design');
  assert.strictEqual(syncCalls.length, 0);
});

test('debounced auto-sync: invalidate cancels pending debounced timer', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.dirty = 1;
  pf.renderProjectFurniture(panel);
  assert.strictEqual(sandbox.__timers.filter(Boolean).length, 1);

  pf.invalidate();
  assert.strictEqual(sandbox.__timers.filter(Boolean).length, 0, 'invalidate must cancel debounced sync timer');
});

test('debounced auto-sync: operates when model binding is connected even if Project tab was never opened', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  const pf = runModule(sandbox, {
    isModelConnected: () => true
  });
  // Note: pf.renderProjectFurniture is NEVER called; lastPfState is null!
  pf.scheduleDebouncedSync();

  const activeTimers = sandbox.__timers.filter(Boolean);
  assert.strictEqual(activeTimers.length, 1, 'must schedule auto-sync when model is connected even without opening Project tab');
  activeTimers[0]();
  const syncCalls = sandbox.__bridge.filter((c) => c.action === 'synchronize_design');
  assert.strictEqual(syncCalls.length, 1, 'synchronize_design must be dispatched');
});

test('debounced auto-sync: real granete-mutation-state CustomEvent dispatch triggers auto-sync', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  runModule(sandbox, {
    isModelConnected: () => true
  });

  // Dispatch real CustomEvent with phase: committed
  sandbox.document.dispatchEvent(new sandbox.CustomEvent('granete-mutation-state', {
    detail: { phase: 'committed' }
  }));

  const activeTimers = sandbox.__timers.filter(Boolean);
  assert.strictEqual(activeTimers.length, 1, 'committed mutation event must schedule debounced auto-sync');
});

test('debounced auto-sync: invalidate during in-flight sync discards stale response', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  const pf = runModule(sandbox, {
    isModelConnected: () => true
  });

  // Start auto-sync
  pf.synchronizeDesign({ isAuto: true });

  // Invalidate model context while request is in-flight (e.g. model switched or disconnected)
  pf.invalidate();

  // Late response arrives
  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });

  assert.strictEqual(sandbox.__projectionRefreshes(), 0, 'must NOT refresh projection on invalidated context');
  assert.strictEqual(sandbox.__toasts.length, 0, 'must NOT emit toast on invalidated context');
  // With no newer sync owning the busy panel, the drain recovers the
  // card through the same reload every outcome uses — never a
  // lingering "Sincronizando" badge.
  const getPfCalls = sandbox.__bridge.filter((c) => c.action === 'get_project_furniture');
  assert.strictEqual(getPfCalls.length, 1, 'drain must recover through the standard panel reload');
  assert.strictEqual(el(sandbox, 'btn-design-sync').disabled, false, 'drain must re-enable the sync entry point');
});

test('debounced auto-sync: stale response is drained even when a newer sync started after invalidation', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  const pf = runModule(sandbox, {
    isModelConnected: () => true
  });

  pf.synchronizeDesign({ isAuto: true }); // A in flight
  pf.invalidate();                        // context invalidated mid-flight; busy guard cleared
  pf.synchronizeDesign({ isAuto: true }); // B starts: responses carry no token, delivery is FIFO

  // The first response to arrive belongs to the invalidated context.
  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });
  assert.strictEqual(sandbox.__projectionRefreshes(), 0, 'stale response must be drained even with a newer sync in flight');
  assert.strictEqual(sandbox.__toasts.length, 0, 'stale response must not toast');

  // The newer sync's own response still applies normally.
  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });
  assert.strictEqual(sandbox.__projectionRefreshes(), 1, 'the newer sync response applies');
  const getPfCalls = sandbox.__bridge.filter((c) => c.action === 'get_project_furniture');
  assert.strictEqual(getPfCalls.length, 1, 'only the newer sync completion reloads the panel');
});

test('debounced auto-sync: repeated invalidations mid-flight arm a single discard', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  const pf = runModule(sandbox, {
    isModelConnected: () => true
  });

  pf.synchronizeDesign({ isAuto: true });
  pf.invalidate();
  pf.invalidate(); // a second binding status render during the same flight

  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });
  assert.strictEqual(sandbox.__projectionRefreshes(), 0, 'the single stale response is drained');

  pf.synchronizeDesign({ isAuto: true });
  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });
  assert.strictEqual(sandbox.__projectionRefreshes(), 1, 'the newer sync must not be swallowed by over-arming');
});

test('debounced auto-sync: two stale syncs after two invalidations are both drained', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  const pf = runModule(sandbox, {
    isModelConnected: () => true
  });

  pf.synchronizeDesign({ isAuto: true }); // A
  pf.invalidate();
  pf.synchronizeDesign({ isAuto: true }); // B
  pf.invalidate();

  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });
  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });

  assert.strictEqual(sandbox.__projectionRefreshes(), 0, 'both stale responses must be drained');
  assert.strictEqual(sandbox.__toasts.length, 0, 'drained stale responses never toast');
  const getPfCalls = sandbox.__bridge.filter((c) => c.action === 'get_project_furniture');
  assert.strictEqual(getPfCalls.length, 2, 'each drain recovers the panel through the standard reload');
});

test('debounced auto-sync: silent in presentation mode with zero toasts and live projection refresh', () => {
  const sandbox = buildSandbox();
  sandbox.window.GraneteUI.modelBinding = {
    isConnected: () => true
  };
  const pf = runModule(sandbox, {
    isModelConnected: () => true
  });

  pf.synchronizeDesign({ isAuto: true });
  pf.handleSynchronizeDesignResult({
    ok: true,
    code: 'synchronized',
    changes: { added: [FI_1], updated: [], removed: [] }
  });

  assert.strictEqual(sandbox.__toasts.length, 0, 'zero toasts in auto-sync (presentation mode friendly)');
  assert.strictEqual(sandbox.__projectionRefreshes(), 1, 'commercial projection must refresh automatically');
});

// ---------------------------------------------------------------------
// #1177 — Quitar del proyecto: danger exit, two-step confirm, results
// ---------------------------------------------------------------------

function removeButtonOf(card) {
  return allCardElements(card).filter((el) => el.className === 'btn btn-danger' && el.children.length <= 2)[0] || null;
}

function armedGroupOf(card) {
  return allCardElements(card).filter((el) => el.className === 'pf-remove-confirm')[0] || null;
}

function footerOf(card) {
  return card.children.filter((child) => child.className === 'pf-unit-actions')[0] || null;
}

function allCardElements(el) {
  return el.children.flatMap((child) => [child, ...allCardElements(child)]);
}

function buttonWithLabel(card, label) {
  return allCardElements(card).filter((el) =>
    String(el.className).includes('btn') && el.children.length === 0 && el.textContent === label)[0] || null;
}

function missingCardPanel(id, state) {
  const panel = connectedPanel();
  panel.items = [{ id: id || FI_1, name: 'Base 600', terminal: false, placed: false,
    reconciliationState: state || 'unplaced', unitIndex: 1, unitTotal: 1 }];
  return panel;
}

test('every non-terminal card offers the danger Quitar del proyecto action', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(connectedPanel());

  const pendingCards = el(sandbox, 'pf-pending-list').children;
  const placedCards = el(sandbox, 'pf-placed-list').children;
  [pendingCards[0], pendingCards[1], placedCards[0]].forEach((card) => {
    const remove = removeButtonOf(card);
    assert.ok(remove, 'unplaced/placed cards must offer the remove exit');
    assert.equal(remove.children[1].textContent, 'Quitar del proyecto');
    assert.equal(remove.disabled, false);
  });
});

test('orphan, unverifiable and id-less rows offer no remove', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  const panel = connectedPanel();
  panel.items = [
    { id: FI_1, name: 'Zombi', terminal: false, placed: false,
      reconciliationState: 'terminal_or_orphan_local', unitIndex: 1, unitTotal: 1 },
    { id: null, name: 'Local no verificable', terminal: false, placed: false,
      reconciliationState: 'unknown', unitIndex: 2, unitTotal: 2 }
  ];
  pf.renderProjectFurniture(panel);

  el(sandbox, 'pf-pending-list').children.forEach((card) => {
    assert.equal(removeButtonOf(card), null, 'nothing to remove without a live project identity');
  });
});

test('two-step confirm: the first click arms inside the card and never calls the backend', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  const card = el(sandbox, 'pf-pending-list').children[0];

  removeButtonOf(card).click();

  const armed = armedGroupOf(el(sandbox, 'pf-pending-list').children[0]);
  assert.ok(armed, 'the confirm renders inside the same card — no modal');
  const texts = allCardElements(armed).map((el) => el.textContent).join('\n');
  assert.ok(texts.includes('¿Quitar “Base 600” del proyecto?'));
  assert.ok(texts.includes('puede volver a materializarse desde la web'),
    'the honest commercial caveat is part of the confirm');
  const [no, yes] = armed.children[2].children;
  assert.equal(no.textContent, 'No');
  assert.equal(no.className, 'btn btn-secondary');
  assert.equal(yes.textContent, 'Quitar');
  assert.equal(yes.className, 'btn btn-danger-solid',
    'the destructive confirmation is the strip only solid control');
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'remove_project_furniture').length, 0,
    'arming must not touch the backend');
});

test('[No] disarms without calling the backend', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();

  const [no] = armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children;
  no.click();

  const card = el(sandbox, 'pf-pending-list').children[0];
  assert.equal(removeButtonOf(card).children[1].textContent, 'Quitar del proyecto',
    'the resting danger action is back');
  assert.equal(armedGroupOf(card), null);
  assert.equal(sandbox.__bridge.filter((c) => c.action === 'remove_project_furniture').length, 0);
});

test('a fresh authority render disarms the confirm', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  assert.ok(armedGroupOf(el(sandbox, 'pf-pending-list').children[0]));

  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  assert.equal(armedGroupOf(el(sandbox, 'pf-pending-list').children[0]), null,
    'server-pushed rows always reset the armed confirm');
});

test('Quitar calls the bridge with the instance id and shows the honest in-flight state', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children[1].click();

  const calls = sandbox.__bridge.filter((c) => c.action === 'remove_project_furniture');
  assert.equal(calls.length, 1);
  assert.deepStrictEqual(calls[0].payload, { furnitureInstanceId: FI_1 });

  const remove = removeButtonOf(el(sandbox, 'pf-pending-list').children[0]);
  assert.equal(remove.children[1].textContent, 'Quitando…');
  assert.equal(remove.disabled, true, 'the in-flight entry point stays disabled');
});

test('removing without the bridge fails honest and re-arms the action', () => {
  const sandbox = buildSandbox();
  delete sandbox.window.sketchup.remove_project_furniture;
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children[1].click();

  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].type, 'error');
  assert.equal(sandbox.__toasts[sandbox.__toasts.length - 1].message,
    'Quitar está disponible sólo dentro de SketchUp.');
  const remove = removeButtonOf(el(sandbox, 'pf-pending-list').children[0]);
  assert.equal(remove.disabled, false, 're-armed after the refused call');
  assert.equal(remove.children[1].textContent, 'Quitar del proyecto');
});

test('handleRemoveFurnitureResult: success toasts once; partial outcomes keep their own voice', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children[1].click();

  pf.handleRemoveFurnitureResult({ ok: true, code: 'removed', instanceId: FI_1,
    designPending: false, localPending: false, localErased: true });
  const types = sandbox.__toasts.map((toast) => toast.type);
  assert.deepStrictEqual(types, ['success']);
  assert.equal(removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).disabled, false,
    'the in-flight guard cleared');
});

test('handleRemoveFurnitureResult: designPending and localPending surface their own toasts', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children[1].click();

  pf.handleRemoveFurnitureResult({ ok: true, code: 'removed', instanceId: FI_1,
    designPending: true, localPending: true,
    reason: 'la unidad fue quitada del proyecto, pero no se pudo borrar la geometría local' });
  const messages = sandbox.__toasts.map((toast) => toast.type + ': ' + toast.message);
  assert.equal(messages.length, 3);
  assert.ok(messages[0].startsWith('success: ✓ Mueble quitado del proyecto.'));
  assert.ok(messages[1].startsWith('info: El diseño aún referencia la unidad'));
  assert.ok(messages[2].startsWith('error: la unidad fue quitada del proyecto, pero no se pudo borrar'));
});

test('handleRemoveFurnitureResult: conflict asks for one honest retry', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children[1].click();

  pf.handleRemoveFurnitureResult({ ok: false, code: 'conflict', instanceId: FI_1 });
  const last = sandbox.__toasts[sandbox.__toasts.length - 1];
  assert.equal(last.type, 'error');
  assert.ok(last.message.includes('intentá de nuevo'), 'the retry copy names the refreshed panel path');
  assert.equal(removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).disabled, false);
});

test('other card actions stay gated while a remove is in flight', () => {
  const sandbox = buildSandbox();
  const pf = runModule(sandbox);
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).click();
  armedGroupOf(el(sandbox, 'pf-pending-list').children[0]).children[2].children[1].click();

  // A fresh render keeps pfRemoving (only the result clears it).
  pf.renderProjectFurniture(missingCardPanel(FI_1, 'unplaced'));
  const place = buttonWithLabel(el(sandbox, 'pf-pending-list').children[0], 'Colocar');
  assert.ok(place, 'the Colocar entry stays in the footer');
  assert.equal(place.disabled, true, 'Colocar waits while the remove flies');

  pf.handleRemoveFurnitureResult({ ok: true, code: 'removed', instanceId: FI_1,
    designPending: false, localPending: false, localErased: true });
  assert.equal(removeButtonOf(el(sandbox, 'pf-pending-list').children[0]).disabled, false);
});

for (const { name, fn } of tests) {
  try {
    fn();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}

const failed = results.filter((r) => !r.passed);
// ---------------------------------------------------------------------------
console.log(JSON.stringify({
  success: failed.length === 0,
  testsPassed: results.length - failed.length,
  testsTotal: results.length,
  failures: failed
}, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
