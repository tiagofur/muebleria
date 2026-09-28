// #784 R1 — real JavaScript harness for granete-design-inspector.js: the
// Design Inspector read module under window.GraneteUI.designInspector.
// Drives the ACTUAL module file in a vm sandbox (mock DOM + recording
// window.sketchup bridge) and proves the R1 contract: bound no-selection
// renders the Design Inspector with REAL authoring defaults (never session
// defaults), honest empty/unknown-material/error states, unbound falls back
// to the legacy empty lane, selection-lane hide/restore, design-switch
// invalidation and late-response discarding, and ZERO mutations (the only
// bridge call R1 may issue is get_design_defaults).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-design-inspector.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (err) {
    err.message = `[${name}] ${err.message}`;
    throw err;
  }
  testsPassed += 1;
}

function createMockElement(id = '') {
  const listeners = {};
  const children = [];
  const el = {
    id,
    tagName: 'DIV',
    children,
    style: {},
    disabled: false,
    text: '',
    value: '',
    listeners,
    addEventListener: (evt, cb) => { listeners[evt] = listeners[evt] || []; listeners[evt].push(cb); },
    dispatchEvent: (evt) => {
      const type = (evt && evt.type) || evt;
      (listeners[type] || []).forEach((cb) => cb({ type }));
    },
    appendChild: (child) => children.push(child),
    removeChild: (child) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
    contains: () => false,
    focus: () => {},
    click: () => { (listeners.click || []).forEach((cb) => cb({ type: 'click' })); },
    setAttribute: () => {},
    getAttribute: () => null
  };
  let textContentValue = '';
  Object.defineProperty(el, 'textContent', {
    get: () => {
      if (textContentValue) return textContentValue;
      // Real-DOM behavior: an element with children exposes their
      // concatenated text unless its own text was assigned.
      return children.map((child) => child.textContent).join('');
    },
    set: (v) => { textContentValue = String(v); }
  });
  let innerHTMLValue = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => innerHTMLValue,
    set: (v) => { innerHTMLValue = String(v); children.length = 0; }
  });
  return el;
}

function createSandbox() {
  const registry = {};
  const document = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tagName) => createMockElement('', String(tagName).toUpperCase())
  };
  const sketchupCalls = [];
  const sandbox = {
    window: {},
    document,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JSON,
    Math,
    Object,
    String,
    Array,
    Date,
    setTimeout: (fn) => fn(),
    sketchup: {
      get_design_defaults: (payload) => { sketchupCalls.push(['get_design_defaults', JSON.parse(payload)]); }
    }
  };
  sandbox.window.sketchup = sandbox.sketchup;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-design-inspector.js' });
  return { sandbox, registry, sketchupCalls, document,
    view: () => document.getElementById('inspector-design-view'),
    body: () => document.getElementById('design-inspector-body'),
    designName: () => document.getElementById('design-inspector-design-name'),
    projectName: () => document.getElementById('design-inspector-project-name') };
}

const MATERIALS = {
  'mat-white': { id: 'mat-white', name: 'Arauco Blanco Frosty' },
  'mat-oak': { id: 'mat-oak', name: 'Roble Natural' }
};

function initModule(sandbox) {
  sandbox.window.GraneteUI.designInspector.init({
    getRoleLabel: (role) => ({ INTERIOR: 'Interior', FRENTES: 'Frentes' }[role] || role),
    materialById: (id) => MATERIALS[id],
    rerenderInspector: () => {}
  });
}

const CONNECTED_A = {
  state: 'connected',
  binding: { projectId: 'p-1', designId: 'd-a', projectName: 'Cocina López', designName: 'Principal' }
};

function run() {
  // --- module contract -------------------------------------------------
  test('module registers under window.GraneteUI.designInspector with the R1 API', () => {
    const { sandbox } = createSandbox();
    assert.ok(sandbox.window.GraneteUI.designInspector, 'module must register');
    ['init', 'onBindingStatus', 'onDesignDefaults', 'handleNoSelection', 'hide', 'render'].forEach((entry) => {
      assert.strictEqual(typeof sandbox.window.GraneteUI.designInspector[entry], 'function', `API ${entry}`);
    });
  });

  // --- RED 1: bound + no selection renders the Design Inspector ----------
  test('bound ready defaults render the Design Inspector with real material names', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true, 'bound no-selection takes the lane');
    // First take with no payload yet → loading + request fired
    assert.strictEqual(ctx.sketchupCalls.length, 1, 'exactly one get_design_defaults request');
    assert.strictEqual(ctx.sketchupCalls[0][0], 'get_design_defaults');
    mod.onDesignDefaults({
      requestId: ctx.sketchupCalls[0][1].requestId,
      designId: 'd-a',
      status: 'ready',
      workingVersion: '2026-09-28T10:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white', FRENTES: 'mat-oak' } }
    });
    mod.render();
    assert.strictEqual(ctx.view().style.display, 'block');
    assert.ok(ctx.designName().textContent.includes('Principal'));
    assert.ok(ctx.projectName().textContent.includes('Cocina López'));
    assert.ok(ctx.body().textContent.includes('Arauco Blanco Frosty'), 'resolved material name');
    assert.ok(ctx.body().textContent.includes('Roble Natural'));
    assert.ok(ctx.body().textContent.includes('Interior'), 'role label used');
    // Zero mutation: only the read request ever crossed the bridge.
    ctx.sketchupCalls.forEach((call) => assert.strictEqual(call[0], 'get_design_defaults'));
  });

  // --- RED 2: bound without defaults stays in the Design context ---------
  test('empty authoring defaults keep the honest no-defaults state', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true);
    mod.onDesignDefaults({
      requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: {} }
    });
    assert.ok(ctx.body().textContent.includes('Sin defaults configurados todavía'));
    assert.strictEqual(ctx.view().style.display, 'block');
  });

  // --- RED 3: unbound falls back to the legacy empty lane ----------------
  test('unbound keeps the legacy empty lane and clears design state', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus({ state: 'unbound' });
    assert.strictEqual(mod.handleNoSelection(), false);
    // Even after a late ready payload, unbound keeps refusing the lane.
    mod.onDesignDefaults({ requestId: 1, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    assert.strictEqual(mod.handleNoSelection(), false);
    assert.strictEqual(ctx.view().style.display, 'none');
  });

  // --- RED 4/5: selection transitions hide and restore --------------------
  test('hide() leaves the lane and a later no-selection restores the cached view', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true);
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    // Furniture/batch selection takes the lane away.
    mod.hide();
    assert.strictEqual(ctx.view().style.display, 'none');
    // Clearing the selection restores the Design Inspector without a
    // loading flash (cached ready payload) and without extra requests.
    const before = ctx.sketchupCalls.length;
    assert.strictEqual(mod.handleNoSelection(), true);
    assert.strictEqual(ctx.view().style.display, 'block');
    assert.ok(ctx.body().textContent.includes('Arauco Blanco Frosty'));
    assert.ok(ctx.sketchupCalls.length <= before + 1, 'no request storm on restore (at most one silent refresh)');
  });

  // --- RED 6/7: design switch + late response -----------------------------
  test('design switch invalidates the old payload and discards late responses', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true);
    const requestA = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({ requestId: requestA.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    // Switch to Design B: the A payload must stop being truth.
    mod.onBindingStatus({
      state: 'connected',
      binding: { projectId: 'p-1', designId: 'd-b', projectName: 'Cocina López', designName: 'Alternativa' }
    });
    assert.strictEqual(mod.handleNoSelection(), true);
    assert.ok(ctx.body().textContent.includes('Cargando'), 'switching designs shows the loading state');
    const requestB = ctx.sketchupCalls[ctx.sketchupCalls.length - 1][1];
    assert.strictEqual(requestB.designId, 'd-b');
    // Late response for A arrives AFTER the switch: discarded, never rendered.
    mod.onDesignDefaults({ requestId: requestA.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    assert.ok(ctx.body().textContent.includes('Cargando'), 'late A response must not render');
    // Stale requestId for the SAME design is discarded too.
    mod.onDesignDefaults({ requestId: 'stale-1', designId: 'd-b', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak' } } });
    assert.ok(ctx.body().textContent.includes('Cargando'), 'stale requestId must not render');
    // The real B response renders only B.
    mod.onDesignDefaults({ requestId: requestB.requestId, designId: 'd-b', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak' } } });
    assert.ok(ctx.body().textContent.includes('Roble Natural'), 'B default renders');
    assert.ok(!ctx.body().textContent.includes('Arauco Blanco Frosty'), 'no stale A material remains');
  });

  // --- RED 8: unknown material is honest ----------------------------------
  test('unknown material id renders the honest unavailable row, never a fallback', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'missing-id' } } });
    mod.render();
    assert.ok(ctx.body().textContent.includes('Material no disponible en el catálogo actual'));
    assert.ok(!ctx.body().textContent.includes('Arauco'), 'no silent fallback to another material');
  });

  // --- FINAL REVIEW BLOCKER: current unbound/stale_binding must fail closed
  //     IMMEDIATELY — the previous design's values can never stay on screen.
  test('current stale_binding wipes the rendered design and falls to the safe lane without loops', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true);
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    assert.ok(ctx.body().textContent.includes('Arauco Blanco Frosty'), 'A defaults visible first');

    // The CURRENT request answers stale_binding: A must disappear NOW.
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, status: 'stale_binding', designId: 'd-other' });
    assert.strictEqual(ctx.view().style.display, 'none', 'the design view hides immediately');
    assert.strictEqual(mod.handleNoSelection(), false, 'no authority: the safe empty lane takes over');
    const callsAfter = ctx.sketchupCalls.length;
    mod.handleNoSelection();
    assert.strictEqual(ctx.sketchupCalls.length, callsAfter, 'no re-fetch loop from the stale answer');
  });

  test('current unbound wipes the rendered design immediately', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true);
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    assert.strictEqual(ctx.view().style.display, 'block');

    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, status: 'unbound' });
    assert.strictEqual(ctx.view().style.display, 'none', 'the design view hides immediately');
    assert.strictEqual(mod.handleNoSelection(), false);
  });

  test('after a fail-closed answer, onBindingStatus(B) loads B normally', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, status: 'unbound' });
    assert.strictEqual(mod.handleNoSelection(), false);

    // The binding authority re-establishes truth with design B.
    mod.onBindingStatus({
      state: 'connected',
      binding: { projectId: 'p-1', designId: 'd-b', projectName: 'Cocina López', designName: 'Alternativa' }
    });
    assert.strictEqual(mod.handleNoSelection(), true, 'B takes the lane again');
    const requestB = ctx.sketchupCalls[ctx.sketchupCalls.length - 1][1];
    assert.strictEqual(requestB.designId, 'd-b');
    mod.onDesignDefaults({ requestId: requestB.requestId, designId: 'd-b', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak' } } });
    assert.ok(ctx.body().textContent.includes('Roble Natural'), 'B renders after recovery');
    assert.ok(!ctx.body().textContent.includes('Arauco'), 'no A residue');
  });

  // --- error state with retry ---------------------------------------------
  test('failed load shows the error state and Reintentar re-requests read-only', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({ requestId: request.requestId, designId: 'd-a', status: 'error', reason: 'backend' });
    mod.render();
    assert.ok(ctx.body().textContent.includes('No se pudo cargar la configuración del Diseño'));
    const retry = ctx.document.getElementById('design-inspector-retry');
    assert.ok(retry, 'retry affordance exists');
    retry.click();
    const last = ctx.sketchupCalls[ctx.sketchupCalls.length - 1];
    assert.strictEqual(last[0], 'get_design_defaults', 'retry only reads');
    assert.ok(ctx.body().textContent.includes('Cargando'), 'retry returns to loading');
  });
}

let failed = 0;
try {
  run();
} catch (err) {
  failed = 1;
  console.error(err && err.stack ? err.stack : String(err));
}

console.log(JSON.stringify({ success: failed === 0, testsPassed }));
process.exit(failed === 0 ? 0 : 1);
