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
    err.stack = `[${name}] ${err.stack}`;
    err.message = `[${name}] ${err.message}`;
    console.error(`FAILING: ${name}`);
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
    checked: false,
    text: '',
    value: '',
    listeners,
    addEventListener: (evt, cb) => { listeners[evt] = listeners[evt] || []; listeners[evt].push(cb); },
    dispatchEvent: (evt) => {
      const type = (evt && evt.type) || evt;
      const handlerName = `on${type}`;
      if (typeof el[handlerName] === 'function') el[handlerName]({ type });
      (listeners[type] || []).forEach((cb) => cb({ type }));
    },
    appendChild: (child) => children.push(child),
    removeChild: (child) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
    contains: () => false,
    focus: () => {},
    click: () => {
      if (typeof el.onclick === 'function') el.onclick({ type: 'click' });
      (listeners.click || []).forEach((cb) => cb({ type: 'click' }));
    },
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
    // Real-DOM behavior: a created element becomes findable by id once it
    // carries one (R2 change buttons are created dynamically per role).
    createElement: (tagName) => {
      const el = createMockElement('', String(tagName).toUpperCase());
      let currentId = '';
      Object.defineProperty(el, 'id', {
        get: () => currentId,
        set: (v) => {
          if (currentId && registry[currentId] === el) delete registry[currentId];
          currentId = String(v);
          if (currentId) registry[currentId] = el;
        }
      });
      return el;
    }
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
      get_design_defaults: (payload) => { sketchupCalls.push(['get_design_defaults', JSON.parse(payload)]); },
      apply_design_defaults: (payload) => { sketchupCalls.push(['apply_design_defaults', JSON.parse(payload)]); }
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

function initModule(sandbox, extraDeps = {}) {
  sandbox.window.GraneteUI.designInspector.init(Object.assign({
    getRoleLabel: (role) => ({ INTERIOR: 'Interior', FRENTES: 'Frentes' }[role] || role),
    materialById: (id) => MATERIALS[id],
    rerenderInspector: () => {}
  }, extraDeps));
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

  // --- FINAL REVIEW ronda 2: the Design view must NEVER reopen after the
  //     lane was relinquished (hide()) — responses only update the cache.
  test('ready answer after hide() updates the cache but never reopens the view', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    assert.strictEqual(mod.handleNoSelection(), true);
    const request = ctx.sketchupCalls[0][1];
    // The user selects furniture: the lane is relinquished (hide()).
    mod.hide();
    assert.strictEqual(ctx.view().style.display, 'none');
    // The in-flight answer lands while inactive: cache only, view stays hidden.
    mod.onDesignDefaults({ requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    assert.strictEqual(ctx.view().style.display, 'none', 'a ready response must never reopen the relinquished lane');
    assert.ok(!ctx.body().textContent.includes('Arauco'), 'no render side effect while inactive');
  });

  test('error answer after hide() stays hidden too', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.hide();
    mod.onDesignDefaults({ requestId: request.requestId, designId: 'd-a', status: 'error', reason: 'backend' });
    assert.strictEqual(ctx.view().style.display, 'none', 'an error response must never reopen the lane');
  });

  test('later handleNoSelection renders the cached state normally', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.hide();
    mod.onDesignDefaults({ requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } } });
    assert.strictEqual(ctx.view().style.display, 'none');

    // The selection clears: the lane returns and the CACHED ready state
    // renders immediately (silent refresh may re-validate in background).
    assert.strictEqual(mod.handleNoSelection(), true);
    assert.strictEqual(ctx.view().style.display, 'block');
    assert.ok(ctx.body().textContent.includes('Arauco Blanco Frosty'), 'cached ready state renders');
  });

  // --- R3 owner check: restore uses the CURRENT design default even after
  //     it changed since the furniture was created (lineage, not equality).
  test('R3: after the design default changes, restore materializes the NEW default', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.onDesignInheritance({
      requestId: ctx.sketchupCalls[0][1].requestId, status: 'ready', designId: 'd-a',
      items: [{
        furnitureInstanceId: 'fi-1',
        roles: [
          // Created when INTERIOR default was blanco; overridden to roble.
          { role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak',
            designDefaultMaterialId: 'mat-white', needsRollout: false }
        ]
      }]
    });
    assert.strictEqual(mod.getRoleBadge('fi-1', 'INTERIOR').designDefault, 'mat-white');

    // The design default changes to moscato (another working-copy write).
    // The server projection now reports the NEW default as the restore
    // target — the client never remembers the old one.
    mod.onDesignInheritance({
      requestId: ctx.sketchupCalls[0][1].requestId, status: 'ready', designId: 'd-a',
      items: [{
        furnitureInstanceId: 'fi-1',
        roles: [
          { role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak',
            designDefaultMaterialId: 'mat-moscato', needsRollout: true }
        ]
      }]
    });
    const badge = mod.getRoleBadge('fi-1', 'INTERIOR');
    assert.strictEqual(badge.kind, 'override');
    assert.strictEqual(badge.designDefault, 'mat-moscato',
      'the restore target is the CURRENT design default (moscato), never the original blanco');
  });

  // --- R2: pending draft + footer + one PUT -------------------------------
  function initModuleR2(ctx) {
    ctx.sandbox.window.GraneteUI.designInspector.init({
      getRoleLabel: (role) => ({ INTERIOR: 'Interior', FRENTES: 'Frentes' }[role] || role),
      materialById: (id) => MATERIALS[id],
      rerenderInspector: () => {},
      getRoleCandidates: (role) => (role === 'INTERIOR' ? ['mat-oak', 'mat-white'] : ['mat-white', 'mat-oak']),
      openMaterialPicker: (roleEntry, initialId, onApply) => { ctx.picker = { roleEntry, initialId, onApply }; }
    });
  }

  function readyState(ctx) {
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    mod.onBindingStatus({
      state: 'connected',
      binding: { projectId: 'p-1', designId: 'd-a', projectName: 'Cocina López', designName: 'Principal',
        workingVersion: '2026-09-28T10:00:00Z' }
    });
    assert.strictEqual(mod.handleNoSelection(), true);
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      workingVersion: '2026-09-28T10:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white', FRENTES: 'mat-oak' } } });
    return mod;
  }

  test('R2: picking a material creates a pending draft and shows the footer', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    // Row action opens the picker for the role with the current value.
    const changeBtn = ctx.document.getElementById('design-inspector-change-INTERIOR');
    assert.ok(changeBtn, 'each default row carries a change affordance');
    changeBtn.click();
    assert.ok(ctx.picker, 'picker opens');
    assert.strictEqual(ctx.picker.roleEntry.role, 'INTERIOR');
    assert.strictEqual(ctx.picker.initialId, 'mat-white');
    // The pick lands in the DRAFT, never straight in the backend.
    ctx.picker.onApply('mat-oak');
    assert.ok(ctx.body().textContent.includes('Roble Natural'), 'the draft value renders');
    assert.ok(ctx.body().textContent.includes('→'), 'old → new is visible');
    const footer = ctx.document.getElementById('design-inspector-footer');
    assert.strictEqual(footer.style.display, 'block');
    assert.ok(ctx.document.getElementById('design-inspector-pending').textContent.includes('1 cambio pendiente'));
    // Nothing crossed the bridge yet: zero writes while drafting.
    assert.ok(ctx.sketchupCalls.every((c) => c[0] !== 'apply_design_defaults'));
  });

  test('R2: Descartar clears the draft without any write', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    ctx.picker.onApply('mat-white');
    assert.ok(ctx.document.getElementById('design-inspector-pending').textContent.includes('1 cambio pendiente'));
    ctx.document.getElementById('design-inspector-discard').click();
    assert.strictEqual(ctx.document.getElementById('design-inspector-footer').style.display, 'none');
    assert.ok(ctx.body().textContent.includes('Roble Natural'), 'durable value back on screen');
    assert.ok(!ctx.body().textContent.includes('→'));
    assert.ok(ctx.sketchupCalls.every((c) => c[0] === 'get_design_defaults'), 'discard is read-only');
  });

  test('R2: Aplicar issues exactly ONE apply_design_defaults PUT with V1 + merged defaults', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    ctx.document.getElementById('design-inspector-apply').click();

    const applies = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults');
    assert.strictEqual(applies.length, 1, 'exactly one apply call');
    const payload = applies[0][1];
    assert.strictEqual(payload.designId, 'd-a');
    assert.strictEqual(payload.expectedWorkingVersion, '2026-09-28T10:00:00Z');
    assert.deepStrictEqual(payload.authoringDefaults.materialChoices, { INTERIOR: 'mat-oak', FRENTES: 'mat-oak' },
      'the merged durable ∪ draft block');
    // The draft clears only on the confirmed answer.
    assert.ok(ctx.document.getElementById('design-inspector-pending').textContent.includes('1 cambio pendiente'));
    // Successful answer: new workingVersion cached, draft cleared, no reopen games.
    mod.onDesignDefaultsApplied({ requestId: payload.requestId, status: 'ok', designId: 'd-a',
      workingVersion: '2026-09-28T11:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak', FRENTES: 'mat-oak' } } });
    assert.strictEqual(ctx.document.getElementById('design-inspector-footer').style.display, 'none');
    assert.ok(ctx.body().textContent.includes('Roble Natural'));
  });

  test('R2: a conflict answer keeps the honest state without fake success', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    ctx.picker.onApply('mat-white');
    ctx.document.getElementById('design-inspector-apply').click();
    const payload = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[0][1];
    mod.onDesignDefaultsApplied({ requestId: payload.requestId, status: 'conflict', reason: 'el diseño cambió en el servidor' });
    assert.ok(ctx.body().textContent.includes('cambió en el servidor'), 'honest conflict message');
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, true,
      'no repeat apply against a stale token');
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').textContent, 'Aplicar',
      'a refusal without a fresh version offers no rebase');
  });

  // #969c: with the background auto-sync the working copy moves without any
  // user edit. A conflict refusal that carried the fresh working version
  // offers the EXPLICIT rebase through the apply button — user consent,
  // never a silent rebase — and the retry rides the fresh token.
  test('R2+#969c: conflict with a fresh version offers Actualizar y aplicar; retry rides the fresh token', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    ctx.picker.onApply('mat-white');
    ctx.document.getElementById('design-inspector-apply').click();
    const payload = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[0][1];

    mod.onDesignDefaultsApplied({ requestId: payload.requestId, status: 'conflict',
      reason: 'el diseño cambió en el servidor', workingVersion: '2026-09-28T12:00:00Z' });
    assert.ok(ctx.body().textContent.includes('cambió en el servidor'), 'honest conflict message');
    const applyBtn = ctx.document.getElementById('design-inspector-apply');
    assert.strictEqual(applyBtn.disabled, false, 'the rebase path is actionable');
    assert.strictEqual(applyBtn.textContent, 'Actualizar y aplicar', 'the explicit rebase label');

    applyBtn.click();
    const applies = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults');
    assert.strictEqual(applies.length, 2, 'exactly one retry');
    assert.strictEqual(applies[1][1].expectedWorkingVersion, '2026-09-28T12:00:00Z',
      'the retry rides the fresh working version');
    assert.deepStrictEqual(applies[1][1].authoringDefaults.materialChoices,
      { INTERIOR: 'mat-white', FRENTES: 'mat-white' },
      'the same seen draft applies onto the fresh state');

    // The confirmed answer closes the loop exactly like a first-apply ok.
    mod.onDesignDefaultsApplied({ requestId: applies[1][1].requestId, status: 'ok', designId: 'd-a',
      workingVersion: '2026-09-28T13:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak', FRENTES: 'mat-white' } } });
    assert.strictEqual(ctx.document.getElementById('design-inspector-footer').style.display, 'none');
    assert.strictEqual(applyBtn.textContent, 'Aplicar', 'the resting label is restored');
  });

  test('R2+#969c: an error answer never offers a rebase it cannot know', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    ctx.picker.onApply('mat-white');
    ctx.document.getElementById('design-inspector-apply').click();
    const payload = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[0][1];
    mod.onDesignDefaultsApplied({ requestId: payload.requestId, status: 'error', reason: 'unreachable' });
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, true,
      'a transport error keeps the apply disabled');
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').textContent, 'Aplicar');
  });

  // --- FINAL REVIEW R2 BLOCKER: the draft is PINNED to the working-copy
  //     version it started on. An external V2 never silently rebases it.
  test('external V2 read does not rebase the draft; Apply rides V1 and fails honestly', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx); // V1 with INTERIOR=mat-white
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak'); // draft starts on V1
    // An EXPLICIT refresh brings V2 from the server (another writer).
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      workingVersion: '2026-09-28T12:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-roble-server', FRENTES: 'mat-oak' } } });
    // The draft stays on its V1 base: the rendered "old" value is still the
    // V1 base, not the server's V2 value, and the pending footer survives.
    assert.ok(ctx.body().textContent.includes('→'), 'draft still rendered');
    assert.ok(ctx.body().textContent.includes('Arauco Blanco Frosty'), 'old value stays the V1 base');
    assert.ok(!ctx.body().textContent.includes('mat-roble-server'.replace('-', ' ')), 'no silent rebase');
    assert.ok(ctx.document.getElementById('design-inspector-footer').style.display === 'block' ||
              ctx.body().textContent.includes('cambió en el servidor'), 'stale draft is honestly flagged');
    // Apply rides V1 — NEVER the observed V2.
    ctx.document.getElementById('design-inspector-apply').click();
    const applies = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults');
    assert.strictEqual(applies.length, 1);
    assert.strictEqual(applies[0][1].expectedWorkingVersion, '2026-09-28T10:00:00Z',
      'Apply sends draftBaseVersion (V1), not the refreshed V2');
    assert.deepStrictEqual(applies[0][1].authoringDefaults.materialChoices,
      { INTERIOR: 'mat-oak', FRENTES: 'mat-oak' }, 'the merged block still comes from the V1 base');
    // The bridge honestly refuses (V1 vs server V2): draft preserved.
    mod.onDesignDefaultsApplied({ requestId: applies[0][1].requestId, status: 'conflict',
      reason: 'el diseño cambió en el servidor' });
    assert.ok(ctx.document.getElementById('design-inspector-pending').textContent.includes('cambió en el servidor'));
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, true);
    ctx.sketchupCalls.forEach((c) => { if (c[0] === 'apply_design_defaults') { /* the one attempt */ } });
    assert.strictEqual(ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults').length, 1, 'no write loop');
  });

  test('same-version refresh while dirty preserves the draft without rebasing', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    ctx.picker.onApply('mat-white');
    const callsBefore = ctx.sketchupCalls.length;
    // Another read of the SAME version: the draft survives untouched.
    mod.onDesignDefaults({ requestId: ctx.sketchupCalls[0][1].requestId, designId: 'd-a', status: 'ready',
      workingVersion: '2026-09-28T10:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white', FRENTES: 'mat-oak' } } });
    assert.strictEqual(ctx.document.getElementById('design-inspector-pending').textContent.includes('1 cambio pendiente'),
      true, 'draft preserved');
    // While dirty, the lane does NOT silently re-read (suppressed).
    mod.handleNoSelection();
    assert.strictEqual(ctx.sketchupCalls.length, callsBefore, 'no silent refresh while a draft is pending');
  });

  test('applied-ok opens a fresh base on the new version', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    ctx.document.getElementById('design-inspector-apply').click();
    const payload = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[0][1];
    mod.onDesignDefaultsApplied({ requestId: payload.requestId, status: 'ok', designId: 'd-a',
      workingVersion: '2026-09-28T11:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak', FRENTES: 'mat-oak' } } });
    // A new edit now rides the NEW version.
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    ctx.picker.onApply('mat-white');
    ctx.document.getElementById('design-inspector-apply').click();
    const second = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[1];
    assert.strictEqual(second[1].expectedWorkingVersion, '2026-09-28T11:00:00Z',
      'the next draft is based on V2');
  });

  // --- FINAL REVIEW #900: the Apply race boundary --------------------------
  test('R2 race: two rapid Apply clicks issue exactly ONE apply request', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    ctx.document.getElementById('design-inspector-apply').click();
    ctx.document.getElementById('design-inspector-apply').click();
    ctx.document.getElementById('design-inspector-apply').click();
    const applies = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults');
    assert.strictEqual(applies.length, 1, 'one user Apply = exactly one apply request');
    // The button is disabled while the apply is in flight.
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, true);
    // Success releases the guard: a NEW draft can apply again.
    mod.onDesignDefaultsApplied({ requestId: applies[0][1].requestId, status: 'ok', designId: 'd-a',
      workingVersion: '2026-09-28T11:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-oak', FRENTES: 'mat-oak' } } });
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, false);
  });

  test('R2 race: switching designs invalidates the in-flight answer of the old design', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    ctx.document.getElementById('design-inspector-apply').click();
    const payloadA = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[0][1];

    // The binding changes to Design B while the A apply is in flight.
    mod.onBindingStatus({
      state: 'connected',
      binding: { projectId: 'p-1', designId: 'd-b', projectName: 'Cocina López', designName: 'Alternativa',
        workingVersion: '2026-09-28T13:00:00Z' }
    });
    assert.strictEqual(mod.handleNoSelection(), true);
    const requestB = ctx.sketchupCalls.filter((c) => c[0] === 'get_design_defaults').slice(-1)[0][1];
    assert.strictEqual(requestB.designId, 'd-b');
    // B's ready answer establishes its own base.
    mod.onDesignDefaults({ requestId: requestB.requestId, designId: 'd-b', status: 'ready',
      workingVersion: '2026-09-28T13:00:00Z',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white', FRENTES: 'mat-oak' } } });

    // The late A answer must be FULLY ignored: no conflict/error, no state
    // change inside B's inspector, and B's own apply stays enabled.
    mod.onDesignDefaultsApplied({ requestId: payloadA.requestId, status: 'conflict',
      reason: 'el diseño cambió en el servidor' });
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, false,
      'a foreign late answer must not disable B');
    assert.ok(!ctx.body().textContent.includes('cambió en el servidor'), 'no foreign conflict message');

    // B still applies normally.
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    ctx.document.getElementById('design-inspector-apply').click();
    const applies = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults');
    assert.strictEqual(applies.length, 2);
    assert.strictEqual(applies[1][1].designId, 'd-b');
  });

  test('R2 race: conflict releases the in-flight guard and preserves the draft', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    ctx.document.getElementById('design-inspector-apply').click();
    const payload = ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults')[0][1];
    mod.onDesignDefaultsApplied({ requestId: payload.requestId, status: 'conflict',
      reason: 'el diseño cambió en el servidor' });
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, true,
      'a real conflict disables repeat-apply against the stale token');
    assert.ok(ctx.document.getElementById('design-inspector-pending').textContent.includes('cambió en el servidor'));
    // The draft survives per the contract; Descartar re-enables a fresh start.
    ctx.document.getElementById('design-inspector-discard').click();
    assert.strictEqual(ctx.document.getElementById('design-inspector-apply').disabled, false);
    assert.strictEqual(ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults').length, 1,
      'discard never writes');
  });

  test('R2 race: the no-bridge fallback releases the in-flight guard', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    ctx.document.getElementById('design-inspector-change-INTERIOR').click();
    ctx.picker.onApply('mat-oak');
    // Remove the bridge: the fallback path must still release the guard.
    ctx.sandbox.window.sketchup.apply_design_defaults = undefined;
    ctx.document.getElementById('design-inspector-apply').click();
    assert.strictEqual(ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults').length, 0);
    assert.ok(ctx.body().textContent.includes('Granete no está disponible'), 'honest fallback message');
    // Guard released: a restored bridge can apply again.
    ctx.sandbox.window.sketchup.apply_design_defaults =
      (payload) => ctx.sketchupCalls.push(['apply_design_defaults', JSON.parse(payload)]);
    ctx.document.getElementById('design-inspector-apply').click();
    assert.strictEqual(ctx.sketchupCalls.filter((c) => c[0] === 'apply_design_defaults').length, 1,
      'the guard released allows a new apply');
  });

  // --- FINAL REVIEW fix-up: ANY real binding change invalidates pending
  //     requests — not only applies in flight.
  function switchToB(ctx, mod) {
    // The binding changes to B while A's GET is still in flight. The late
    // answer lands BEFORE B's own read burns a new requestId — the exact
    // window where a stale requestId would still match.
    mod.onBindingStatus({
      state: 'connected',
      binding: { projectId: 'p-1', designId: 'd-b', projectName: 'Cocina López', designName: 'Alternativa' }
    });
  }

  test('binding switch: late stale_binding of the A GET is fully ignored', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    const requestA = ctx.sketchupCalls[ctx.sketchupCalls.length - 1][1];
    switchToB(ctx, mod);

    mod.onDesignDefaults({ requestId: requestA.requestId, status: 'stale_binding', designId: 'd-a' });

    // The stale fail-closed of A must NOT have hidden B or fired the safe
    // lane handoff — the answer was invalid, B still owns the lane.
    assert.strictEqual(mod.handleNoSelection(), true, 'B stays in the lane');
    assert.notStrictEqual(ctx.view().style.display, 'none', 'B view was never hidden by A');
    assert.ok(!ctx.body().textContent.includes('cambió'), 'no A-driven conflict rendered');
  });

  test('binding switch: late unbound of the A GET is fully ignored', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    const requestA = ctx.sketchupCalls[ctx.sketchupCalls.length - 1][1];
    switchToB(ctx, mod);

    mod.onDesignDefaults({ requestId: requestA.requestId, status: 'unbound' });

    assert.strictEqual(mod.handleNoSelection(), true, 'B stays connected despite the late unbound');
    assert.notStrictEqual(ctx.view().style.display, 'none', 'B view alive');
  });

  test('binding switch: late error of the A GET does not change B', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    const requestA = ctx.sketchupCalls[ctx.sketchupCalls.length - 1][1];
    switchToB(ctx, mod);

    mod.onDesignDefaults({ requestId: requestA.requestId, status: 'error', reason: 'boom-A' });

    assert.strictEqual(mod.handleNoSelection(), true, 'B still takes the lane');
    assert.ok(!ctx.body().textContent.includes('boom-A'), 'A error never renders');
    assert.ok(!ctx.body().textContent.includes('No se pudo cargar'), 'no error state from A on B');
  });

  test('same binding identity does not burn requestIds', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    const before = ctx.sketchupCalls.length;
    mod.onBindingStatus({
      state: 'connected',
      binding: { projectId: 'p-1', designId: 'd-a', projectName: 'Cocina López', designName: 'Principal' }
    });
    mod.handleNoSelection();
    // The repeat status for the SAME design must not invalidate anything:
    // a fresh request is still answered normally.
    const calls = ctx.sketchupCalls.slice(before).filter((c) => c[0] === 'get_design_defaults');
    const latest = calls[calls.length - 1][1];
    mod.onDesignDefaults({ requestId: latest.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white', FRENTES: 'mat-oak' } } });
    assert.ok(ctx.body().textContent.includes('Arauco Blanco Frosty'), 'same-identity status keeps the read path alive');
  });

  test('P2: a role no definition offers falls back to the whole catalog', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    ctx.sandbox.window.GraneteUI.designInspector.init({
      getRoleLabel: (role) => role,
      materialById: (id) => MATERIALS[id],
      rerenderInspector: () => {},
      getRoleCandidates: (role) => (role === 'INTERIOR' ? ['mat-oak'] : []),
      getMaterials: () => [{ id: 'mat-white', name: 'Arauco Blanco Frosty' }, { id: 'mat-oak', name: 'Roble Natural' }, { id: 'mat-extra', name: 'Extra' }],
      openMaterialPicker: (roleEntry, initialId, onApply) => { ctx.picker = { roleEntry, initialId, onApply }; }
    });
    const mod = readyState(ctx);
    mod.render();
    // FRENTES comes back with NO curated candidates (simulates a role no
    // definition offers): the picker must receive the whole catalog.
    ctx.document.getElementById('design-inspector-change-FRENTES').click();
    assert.ok(ctx.picker, 'picker opens');
    assert.deepStrictEqual(ctx.picker.roleEntry.optionIds,
      ['mat-white', 'mat-oak', 'mat-extra'],
      'empty curated candidates fall back to the whole catalog (presentation only)');
  });

  // --- R3: inheritance projection (badge authority) ------------------------
  test('R3: onDesignInheritance caches the projection; getRoleBadge is the only authority', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    assert.strictEqual(mod.getRoleBadge('fi-1', 'INTERIOR'), null, 'no projection yet — never a guess');
    mod.onDesignInheritance({ requestId: 999, status: 'ready', designId: 'd-a', items: [] }); // stale: ignored
    const request = ctx.sketchupCalls.filter((c) => c[0] === 'get_design_defaults')[0][1];
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [{
        furnitureInstanceId: 'fi-1',
        roles: [
          { role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: false },
          { role: 'FRENTES', mode: 'override', appliedMaterialId: 'mat-oak',
            designDefaultMaterialId: 'mat-white', needsRollout: false },
          { role: 'FONDO', mode: 'design', appliedMaterialId: 'mat-old', needsRollout: true }
        ]
      }]
    });
    const design = mod.getRoleBadge('fi-1', 'INTERIOR');
    assert.strictEqual(design.text, 'Diseño');
    assert.strictEqual(design.kind, 'design');
    const override = mod.getRoleBadge('fi-1', 'FRENTES');
    assert.strictEqual(override.text, 'Personalizado');
    assert.strictEqual(override.kind, 'override');
    assert.strictEqual(override.designDefault, 'mat-white');
    const pending = mod.getRoleBadge('fi-1', 'FONDO');
    assert.strictEqual(pending.text, 'Diseño · pendiente de aplicar');
    // Applied-ok and binding switch clear/re-refresh it.
    mod.onBindingStatus({ state: 'unbound' });
    assert.strictEqual(mod.getRoleBadge('fi-1', 'INTERIOR'), null, 'unbound clears the projection');
  });

  test('R4: a definition-backed role (curated fallback) badges as Definición, never Personalizado', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    const request = ctx.sketchupCalls.filter((c) => c[0] === 'get_design_defaults')[0][1];
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [{
        furnitureInstanceId: 'fi-1',
        roles: [
          { role: 'FRENTES', mode: 'definition', appliedMaterialId: 'mat-oak', needsRollout: false }
        ]
      }]
    });
    const badge = mod.getRoleBadge('fi-1', 'FRENTES');
    assert.strictEqual(badge.text, 'Definición');
    assert.strictEqual(badge.kind, 'definition');
    assert.strictEqual(badge.designDefault, undefined, 'definition fallback offers no restore target');
  });

  test('R3: the furniture inspector renders the badge and the restore action', () => {
    const ctx = createSandbox();
    ctx.picker = null;
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.onDesignInheritance({
      requestId: ctx.sketchupCalls[0][1].requestId, status: 'ready', designId: 'd-a',
      items: [{
        furnitureInstanceId: 'fi-1',
        roles: [
          { role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak',
            designDefaultMaterialId: 'mat-white', needsRollout: false }
        ]
      }]
    });
    // The badge comes from the module (the inspector/materials render reads
    // it through the injected dep — covered in the material-roles harness);
    // here we pin the module contract: override exposes the design default.
    const badge = mod.getRoleBadge('fi-1', 'INTERIOR');
    assert.ok(badge.designDefault, 'restore action target exists');
    // A design-backed role never offers restore.
    mod.onDesignInheritance({
      requestId: ctx.sketchupCalls[0][1].requestId, status: 'ready', designId: 'd-a',
      items: [{ furnitureInstanceId: 'fi-1',
        roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: false }] }]
    });
    assert.strictEqual(mod.getRoleBadge('fi-1', 'INTERIOR').kind, 'design');
    assert.strictEqual(mod.getRoleBadge('fi-1', 'INTERIOR').designDefault, undefined);
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

  // #784 R4: getDesignDefaults accessor
  test('R4: getDesignDefaults returns an isolated copy of active design authoring defaults', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    assert.strictEqual(JSON.stringify(mod.getDesignDefaults()), '{}');
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white', FRENTES: 'mat-oak' } },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    const defaults = mod.getDesignDefaults();
    assert.strictEqual(defaults.INTERIOR, 'mat-white');
    assert.strictEqual(defaults.FRENTES, 'mat-oak');
    defaults.INTERIOR = 'tampered';
    assert.strictEqual(mod.getDesignDefaults().INTERIOR, 'mat-white', 'mutating the returned copy must not corrupt state');
  });

  // =========================================================================
  // #784 R5: Design defaults rollout across existing furniture
  // =========================================================================
  test('R5: rollout button renders only when role has compatible items, and disables when draft is pending', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModuleR2(ctx);
    readyState(ctx);
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [
        { furnitureInstanceId: 'fi-1', furnitureDefinitionId: 'def-a', roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: true }] },
        { furnitureInstanceId: 'fi-2', furnitureDefinitionId: 'def-a', roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: false }] }
      ],
      inheritanceSummary: [
        { role: 'INTERIOR', items: 2, designBacked: 2, needsRollout: 1, designCurrent: 1, overridden: 0 },
        { role: 'FRENTES', items: 0, designBacked: 0, needsRollout: 0, designCurrent: 0, overridden: 0 }
      ]
    });
    mod.render();

    const rolloutInterior = ctx.document.getElementById('design-inspector-rollout-INTERIOR');
    assert.ok(rolloutInterior, 'rollout button exists for INTERIOR');
    assert.strictEqual(rolloutInterior.textContent, 'Aplicar a muebles existentes…');
    assert.strictEqual(rolloutInterior.disabled, false);

    const rolloutFrentes = ctx.registry['design-inspector-rollout-FRENTES'];
    assert.strictEqual(rolloutFrentes, undefined, 'rollout button not rendered when summary.items == 0');

    // Create a pending draft: rollout button must disable
    const changeInterior = ctx.document.getElementById('design-inspector-change-INTERIOR');
    changeInterior.click();
    assert.ok(ctx.picker, 'picker was opened');
    ctx.picker.onApply('mat-oak'); // Pick new material -> pending draft
    const updatedRollout = ctx.document.getElementById('design-inspector-rollout-INTERIOR');
    assert.strictEqual(updatedRollout.disabled, true);
    assert.ok(updatedRollout.title.includes('pendientes'));
  });

  test('R5: openImpactReviewModal renders title, honest stats, and default preserve scope', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    // 3 items in design: 2 compatible with INTERIOR (1 needs rollout, 1 override), 1 unsupported
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [
        { furnitureInstanceId: 'fi-1', furnitureDefinitionId: 'def-1', roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: true }] },
        { furnitureInstanceId: 'fi-2', furnitureDefinitionId: 'def-1', roles: [{ role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak', needsRollout: false }] },
        { furnitureInstanceId: 'fi-3', furnitureDefinitionId: 'def-2', roles: [] }
      ],
      inheritanceSummary: [
        { role: 'INTERIOR', items: 2, designBacked: 1, needsRollout: 1, designCurrent: 0, overridden: 1 }
      ]
    });

    mod.openImpactReviewModal('INTERIOR');
    const modal = ctx.document.getElementById('design-rollout-modal');
    assert.strictEqual(modal.style.display, 'flex');

    const title = ctx.document.getElementById('design-rollout-modal-title');
    assert.strictEqual(title.textContent, 'Aplicar Arauco Blanco Frosty a Interior');

    const statCompat = ctx.document.getElementById('rollout-stat-compatible');
    const statInherit = ctx.document.getElementById('rollout-stat-inherit');
    const statCustom = ctx.document.getElementById('rollout-stat-custom');
    const statUnsupp = ctx.document.getElementById('rollout-stat-unsupported');

    assert.strictEqual(statCompat.textContent, '2 muebles compatibles');
    assert.strictEqual(statInherit.textContent, '1 heredará/cambiará');
    assert.strictEqual(statCustom.textContent, '1 tiene personalización');
    assert.strictEqual(statUnsupp.textContent, '1 no admite este rol');

    const scopePreserve = ctx.document.getElementById('rollout-scope-preserve');
    const scopeReplace = ctx.document.getElementById('rollout-scope-replace');
    assert.strictEqual(scopePreserve.checked, true, 'preserve is default');
    assert.strictEqual(scopeReplace.checked, false);

    const applyBtn = ctx.document.getElementById('btn-design-rollout-apply');
    assert.strictEqual(applyBtn.textContent, 'Aplicar a 1');
    assert.strictEqual(applyBtn.disabled, false);

    // Cancel hides modal
    const cancelBtn = ctx.document.getElementById('btn-design-rollout-cancel');
    cancelBtn.click();
    assert.strictEqual(modal.style.display, 'none');
  });

  test('R5: scope radio switches target count between needsRollout and (needsRollout + overridden)', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [
        { furnitureInstanceId: 'fi-1', furnitureDefinitionId: 'def-1', roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: true }] },
        { furnitureInstanceId: 'fi-2', furnitureDefinitionId: 'def-1', roles: [{ role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak', needsRollout: false }] }
      ],
      inheritanceSummary: [
        { role: 'INTERIOR', items: 2, designBacked: 1, needsRollout: 1, designCurrent: 0, overridden: 1 }
      ]
    });

    mod.openImpactReviewModal('INTERIOR');
    const scopePreserve = ctx.document.getElementById('rollout-scope-preserve');
    const scopeReplace = ctx.document.getElementById('rollout-scope-replace');
    const applyBtn = ctx.document.getElementById('btn-design-rollout-apply');

    assert.strictEqual(applyBtn.textContent, 'Aplicar a 1');

    // Switch to replace
    scopePreserve.checked = false;
    scopeReplace.checked = true;
    scopeReplace.dispatchEvent({ type: 'change' });
    assert.strictEqual(applyBtn.textContent, 'Aplicar a 2');

    // Switch back to preserve
    scopePreserve.checked = true;
    scopeReplace.checked = false;
    scopePreserve.dispatchEvent({ type: 'change' });
    assert.strictEqual(applyBtn.textContent, 'Aplicar a 1');
  });

  test('R5: clicking Apply dispatches GraneteMutation.submitBatchUpdate with exact items and modes', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);

    const batchCalls = [];
    ctx.sandbox.window.GraneteMutation = {
      submitBatchUpdate: (items) => {
        batchCalls.push(items);
        return 'sent';
      }
    };

    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [
        { furnitureInstanceId: 'fi-1', furnitureDefinitionId: 'def-1', roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-white', needsRollout: true }] },
        { furnitureInstanceId: 'fi-2', furnitureDefinitionId: 'def-1', roles: [{ role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak', needsRollout: false }] }
      ],
      inheritanceSummary: [
        { role: 'INTERIOR', items: 2, designBacked: 1, needsRollout: 1, designCurrent: 0, overridden: 1 }
      ]
    });

    // 1) Apply with preserve (default)
    mod.openImpactReviewModal('INTERIOR');
    const applyBtn = ctx.document.getElementById('btn-design-rollout-apply');
    applyBtn.click();

    assert.strictEqual(batchCalls.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(batchCalls[0])), [
      {
        instanceId: 'fi-1',
        definitionId: 'def-1',
        materialChoices: { INTERIOR: 'mat-white' },
        materialChoiceModes: { INTERIOR: 'design' }
      }
    ]);
    const modal = ctx.document.getElementById('design-rollout-modal');
    assert.strictEqual(modal.style.display, 'none');

    // 2) Apply with replace
    batchCalls.length = 0;
    mod.openImpactReviewModal('INTERIOR');
    const scopePreserve = ctx.document.getElementById('rollout-scope-preserve');
    const scopeReplace = ctx.document.getElementById('rollout-scope-replace');
    scopePreserve.checked = false;
    scopeReplace.checked = true;
    scopeReplace.dispatchEvent({ type: 'change' });
    applyBtn.click();

    assert.strictEqual(batchCalls.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(batchCalls[0])), [
      {
        instanceId: 'fi-1',
        definitionId: 'def-1',
        materialChoices: { INTERIOR: 'mat-white' },
        materialChoiceModes: { INTERIOR: 'design' }
      },
      {
        instanceId: 'fi-2',
        definitionId: 'def-1',
        materialChoices: { INTERIOR: 'mat-white' },
        materialChoiceModes: { INTERIOR: 'design' }
      }
    ]);
  });

  test('R5: onBatchUpdateResult refreshes the projection and never duplicates the batch-lane toast', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    const toastCalls = [];
    ctx.sandbox.window.GraneteUI.designInspector.init({
      getRoleLabel: (role) => role,
      materialById: (id) => MATERIALS[id],
      rerenderInspector: () => {},
      showToast: (kind, text) => { toastCalls.push({ kind, text }); }
    });

    ctx.sandbox.sketchup.get_design_inheritance = (payload) => {
      ctx.sketchupCalls.push(['get_design_inheritance', JSON.parse(payload)]);
    };

    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();

    // Success outcome: refresh the server projection…
    mod.onBatchUpdateResult({ success: true, applied: 2 });
    const lastCall = ctx.sketchupCalls[ctx.sketchupCalls.length - 1];
    assert.strictEqual(lastCall[0], 'get_design_inheritance', 'refreshes server inheritance projection');

    // …but the user-facing toast belongs to the #471 batch lane
    // (granete-inspector onBatchUpdateResult): the design inspector must
    // not stack a second identical toast on either outcome.
    assert.strictEqual(toastCalls.length, 0, 'no duplicated toast from the design inspector');

    mod.onBatchUpdateResult({ success: false, error: 'Locked by other user' });
    assert.strictEqual(toastCalls.length, 0, 'no duplicated failure toast either');
  });

  test('R5: preserve scope adopts definition-fallback furniture and skips one already carrying the default', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [
        // design lineage, behind the default → always selected
        { furnitureInstanceId: 'fi-1', furnitureDefinitionId: 'def-1',
          roles: [{ role: 'INTERIOR', mode: 'design', appliedMaterialId: 'mat-oak', needsRollout: true }] },
        // definition fallback carrying a different value → adopted by preserve
        { furnitureInstanceId: 'fi-2', furnitureDefinitionId: 'def-2',
          roles: [{ role: 'INTERIOR', mode: 'definition', appliedMaterialId: 'mat-oak', needsRollout: false }] },
        // definition fallback already equal to the design default → no-op, excluded
        { furnitureInstanceId: 'fi-3', furnitureDefinitionId: 'def-3',
          roles: [{ role: 'INTERIOR', mode: 'definition', appliedMaterialId: 'mat-white', needsRollout: false }] },
        // explicit user override → only in replace scope
        { furnitureInstanceId: 'fi-4', furnitureDefinitionId: 'def-1',
          roles: [{ role: 'INTERIOR', mode: 'override', appliedMaterialId: 'mat-oak', needsRollout: false }] }
      ],
      inheritanceSummary: [
        { role: 'INTERIOR', items: 4, designBacked: 1, definitionBacked: 2, needsRollout: 1, designCurrent: 0, overridden: 1 }
      ]
    });

    mod.openImpactReviewModal('INTERIOR');
    const statDefinition = ctx.document.getElementById('rollout-stat-definition');
    assert.ok(statDefinition, 'definition stat renders');
    assert.strictEqual(statDefinition.textContent, '1 usará el default del diseño (fallback de definición)',
      'only the definition item still differing from the default counts');

    const applyBtn = ctx.document.getElementById('btn-design-rollout-apply');
    assert.strictEqual(applyBtn.textContent, 'Aplicar a 2', 'preserve = needsRollout + differing definition');

    const batchCalls = [];
    ctx.sandbox.window.GraneteMutation = {
      submitBatchUpdate: (items) => { batchCalls.push(items); return 'sent'; }
    };
    applyBtn.click();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(batchCalls[0])).map((i) => i.instanceId),
      ['fi-1', 'fi-2'], 'preserve adopts the differing definition item, skips the no-op one');

    // Replace scope additionally forces the explicit override (never the no-op member).
    batchCalls.length = 0;
    mod.openImpactReviewModal('INTERIOR');
    const scopePreserve = ctx.document.getElementById('rollout-scope-preserve');
    const scopeReplace = ctx.document.getElementById('rollout-scope-replace');
    scopePreserve.checked = false;
    scopeReplace.checked = true;
    scopeReplace.dispatchEvent({ type: 'change' });
    assert.strictEqual(ctx.document.getElementById('btn-design-rollout-apply').textContent, 'Aplicar a 3');
    ctx.document.getElementById('btn-design-rollout-apply').click();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(batchCalls[0])).map((i) => i.instanceId),
      ['fi-1', 'fi-2', 'fi-4']);
  });

  test('R5: binding switch / disconnect clears rollout state and closes modal', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { INTERIOR: 'mat-white' } },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [{ furnitureInstanceId: 'fi-1', roles: [{ role: 'INTERIOR', mode: 'design', needsRollout: true }] }],
      inheritanceSummary: [{ role: 'INTERIOR', items: 1, designBacked: 1, needsRollout: 1, designCurrent: 0, overridden: 0 }]
    });

    mod.openImpactReviewModal('INTERIOR');
    const modal = ctx.document.getElementById('design-rollout-modal');
    assert.strictEqual(modal.style.display, 'flex');

    // Disconnect clears rollout state and hides modal
    mod.onBindingStatus({ state: 'disconnected' });
    assert.strictEqual(modal.style.display, 'none');
  });

  // --- role autodiscovery and empty defaults -----------------------------
  test('empty authoringDefaults with getAvailableRoles renders unassigned rows with Asignar button', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    let pickedCallback = null;
    ctx.sandbox.window.GraneteUI.designInspector.init({
      getRoleLabel: (role) => ({ INTERIOR: 'Interior', FRENTES: 'Frentes' }[role] || role),
      materialById: (id) => MATERIALS[id],
      getAvailableRoles: () => ['FRENTES', 'INTERIOR'],
      getRoleCandidates: () => ['mat-white', 'mat-oak'],
      openMaterialPicker: (roleEntry, initialId, onApply) => {
        pickedCallback = onApply;
      },
      rerenderInspector: () => {}
    });
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: {} },
      workingVersion: '2026-09-01T00:00:00Z'
    });

    const bodyText = ctx.body().textContent;
    assert.ok(!bodyText.includes('Sin defaults configurados todavía'), 'must not render dead-end message');
    assert.ok(bodyText.includes('Sin default asignado'), 'must render unassigned role label');

    const btnFrentes = ctx.document.getElementById('design-inspector-change-FRENTES');
    assert.ok(btnFrentes, 'button for FRENTES must exist');
    assert.strictEqual(btnFrentes.textContent, 'Asignar', 'button must say Asignar');

    // Clicking Asignar and selecting mat-oak drafts the initial assignment
    btnFrentes.click();
    assert.ok(pickedCallback, 'openMaterialPicker must be called');
    pickedCallback('mat-oak');

    // Verify row now shows draft
    assert.ok(ctx.body().textContent.includes('Sin asignar → Roble Natural'));
    const updatedBtn = ctx.document.getElementById('design-inspector-change-FRENTES');
    assert.strictEqual(updatedBtn.textContent, 'Cambiar');

    // Verify footer is active with Apply
    const footer = ctx.document.getElementById('design-inspector-footer');
    assert.strictEqual(footer.style.display, 'block');
    const pending = ctx.document.getElementById('design-inspector-pending');
    assert.strictEqual(pending.textContent, '1 cambio pendiente');

    // Applying sends the new default to backend
    const applyBtn = ctx.document.getElementById('design-inspector-apply');
    applyBtn.click();
    const applyCall = ctx.sketchupCalls.find((c) => c[0] === 'apply_design_defaults');
    assert.ok(applyCall, 'apply_design_defaults must be called');
    assert.deepStrictEqual(applyCall[1].authoringDefaults.materialChoices, { FRENTES: 'mat-oak' });
  });

  test('roles discovered from inheritanceSummary render even without defaults or catalog roles', () => {
    const ctx = createSandbox();
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    initModule(ctx.sandbox);
    mod.onBindingStatus(CONNECTED_A);
    mod.handleNoSelection();
    const request = ctx.sketchupCalls[0][1];
    mod.onDesignDefaults({
      requestId: request.requestId, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: {} },
      workingVersion: '2026-09-01T00:00:00Z'
    });
    mod.onDesignInheritance({
      requestId: request.requestId, status: 'ready', designId: 'd-a',
      items: [{ furnitureInstanceId: 'fi-1', roles: [{ role: 'PUERTAS', mode: 'definition' }] }],
      inheritanceSummary: [{ role: 'PUERTAS', items: 1, designBacked: 0, needsRollout: 0, designCurrent: 0, overridden: 0 }]
    });

    const bodyText = ctx.body().textContent;
    assert.ok(!bodyText.includes('Sin defaults configurados todavía'), 'must discover PUERTAS');
    assert.ok(bodyText.includes('Sin default asignado'), 'PUERTAS must be unassigned');
    const btn = ctx.document.getElementById('design-inspector-change-PUERTAS');
    assert.ok(btn, 'button for PUERTAS must exist');
  });

  test('R2: applyMaterialPick updates the draft and footer directly', () => {
    const ctx = createSandbox();
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    mod.applyMaterialPick('INTERIOR', 'mat-oak');
    assert.ok(ctx.body().textContent.includes('Roble Natural'), 'the draft value renders');
    assert.ok(ctx.body().textContent.includes('→'), 'old → new is visible');
    const footer = ctx.document.getElementById('design-inspector-footer');
    assert.strictEqual(footer.style.display, 'block');
    assert.ok(ctx.document.getElementById('design-inspector-pending').textContent.includes('1 cambio pendiente'));
  });

  test('R2: clicking change affordance delegates to window.sketchup.open_material_selector when available', () => {
    const ctx = createSandbox();
    let selectorCall = null;
    ctx.sandbox.window.sketchup.open_material_selector = (payload) => {
      selectorCall = JSON.parse(payload);
    };
    initModuleR2(ctx);
    const mod = readyState(ctx);
    mod.render();
    const changeBtn = ctx.document.getElementById('design-inspector-change-INTERIOR');
    assert.ok(changeBtn, 'change affordance exists');
    changeBtn.click();
    assert.ok(selectorCall, 'open_material_selector was called');
    assert.strictEqual(selectorCall.role, 'INTERIOR');
    assert.strictEqual(selectorCall.context, 'design');
    assert.strictEqual(selectorCall.currentMaterialId, 'mat-white');
    assert.deepStrictEqual(selectorCall.allowedMaterialIds, ['mat-oak', 'mat-white']);
  });

  test('R2: discoveredRoles deduplicates role aliases such as FRENTE and FRENTES', () => {
    const ctx = createSandbox();
    initModule(ctx.sandbox, {
      getAvailableRoles: () => ['FRENTE', 'INTERIORES', 'FONDO']
    });
    const mod = ctx.sandbox.window.GraneteUI.designInspector;
    mod.onBindingStatus(CONNECTED_A);
    mod.onDesignDefaults({
      requestId: 1, designId: 'd-a', status: 'ready',
      authoringDefaults: { materialChoices: { FRENTES: 'mat-oak', INTERIOR: 'mat-white' } }
    });
    mod.handleNoSelection();
    // Should have exactly 3 role rows: FONDO, FRENTES (aliased from FRENTE), INTERIOR (aliased from INTERIORES)
    const rows = ctx.body().children.filter((r) => r.id && r.id.startsWith('design-inspector-row-'));
    assert.strictEqual(rows.length, 3, 'aliases must be deduplicated in discoveredRoles');
    const rowIds = rows.map((r) => r.id);
    assert.ok(rowIds.includes('design-inspector-row-FRENTES') || rowIds.includes('design-inspector-row-FRENTE'), 'front row must exist');
    assert.ok(rowIds.includes('design-inspector-row-INTERIOR') || rowIds.includes('design-inspector-row-INTERIORES'), 'interior row must exist');
    assert.ok(rowIds.includes('design-inspector-row-FONDO'), 'fondo row must exist');
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
