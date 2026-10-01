// #848 Phase B C4.7 — real JavaScript harness for granete-inspector.js:
// the inspector module under window.GraneteUI. Drives the ACTUAL module
// file in a vm sandbox (mock DOM + recording collaborators) and proves the
// module contract: registration/idempotence, exact public API, init
// dependency contract, the selection lifecycle (null/unmanaged/furniture/
// part/hardware/aggregate/multi), the furniture inspector capability
// gating and working snapshots, the update payload/rollback path, the
// material-choice routing (Inspector/Configurator/project scopes), the
// delete arm/confirm flow, the child-kind routing delegation to
// GraneteUI.inspectorChild (boundary-adjusted split) and the hardware
// catalog ownership (set/get + live identity), plus the integrated
// array-payload non-reset quirk through the real dialog chain
// (runDialogScripts). The CHILD-focused coverage (breadcrumb, owner
// recovery, hardware provenance/conflicts, part authoring) moved to
// granete_inspector_child_test.js (#848 boundary adjustment); the
// integrated dialog_inspector_test.js continues to cover the same
// behaviors through the REAL collaborators — this harness drills the
// module API and its boundaries directly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { runDialogScripts } = require('./support/dialog_scripts');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-inspector.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const DIALOG_HTML = fs.readFileSync(
  path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html'), 'utf8'
// Windows checkouts materialize CRLF (no .gitattributes): normalize once so
// the multi-line wrapper thin-delegation assertions are platform-stable.
).replace(/\r\n/g, '\n');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function createMockElement(id = '', tagName = 'DIV') {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  const children = [];
  let innerHTMLValue = '';
  let textContentValue = '';

  let classNameValue = '';
  const el = {
    id,
    tagName,
    children,
    style: {},
    disabled: false,
    hidden: false,
    type: '',
    title: '',
    value: '',
    checked: false,
    required: false,
    maxLength: -1,
    get className() {
      return classNameValue;
    },
    set className(val) {
      classNameValue = String(val);
      classes.clear();
      classNameValue.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    getAttribute: (k) => (k in attributes ? attributes[k] : null),
    setAttribute: (k, v) => { attributes[k] = String(v); },
    removeAttribute: (k) => { delete attributes[k]; },
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    dispatchEvent: (event) => {
      (listeners[event.type] || []).forEach((cb) => cb(event));
      return true;
    },
    click: () => {
      (listeners['click'] || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    focus: () => {},
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    get innerHTML() {
      return innerHTMLValue;
    },
    set innerHTML(val) {
      innerHTMLValue = String(val);
      children.length = 0;
    },
    get textContent() {
      return textContentValue;
    },
    set textContent(val) {
      textContentValue = String(val);
    }
  };
  return el;
}

// Builds a sandbox holding ONLY the real inspector module: collaborators
// (material roles, library, configurator, mutation, state, manufacturing,
// preflight, sketchup bridge, GraneteDialog) are recording stubs so each
// test observes the module's side of the boundary.
function buildModuleSandbox(overrides) {
  const registry = {};
  const created = [];
  const toastCalls = [];
  const tabCalls = [];
  const bridgeCalls = [];
  const mutationCalls = [];
  const childRenders = [];
  const childHides = [];
  const docListeners = {};

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => {
      const el = createMockElement('', tag);
      created.push(el);
      return el;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (evt, cb) => {
      docListeners[evt] = (docListeners[evt] || []).concat(cb);
    }
  };

  // Default collaborator stubs (recording, inert). Per-test overrides are
  // merged per sub-module so a test only names what it asserts on.
  const defaultUI = {
    library: { findDefinitionById: () => undefined },
    materialRoles: {
      defaultMaterialChoices: () => ({}),
      renderMaterialSelectors: () => {},
      materialById: () => null,
      setProjectDefaultMaterial: () => {}
    },
    configurator: { hasActiveDefinition: () => false, applyMaterialChoice: () => {} },
    // Recording stand-in for the CHILD module (granete-inspector-child.js):
    // the inspector routes child kinds through this boundary and drops the
    // child lane on every top-level re-render.
    inspectorChild: {
      render: (context) => childRenders.push(context),
      hide: () => { childHides.push(1); }
    }
  };
  const overridesUI = (overrides && overrides.GraneteUI) || {};
  const graneteUI = Object.assign({}, defaultUI);
  Object.keys(overridesUI).forEach((k) => {
    graneteUI[k] = Object.assign({}, defaultUI[k] || {}, overridesUI[k]);
  });
  const windowOverrides = Object.assign({}, overrides || {});
  delete windowOverrides.GraneteUI;

  const sandbox = {
    console,
    setTimeout: (fn) => {
      bridgeCalls.push({ action: '__setTimeout' });
      return 0;
    },
    clearTimeout: () => {},
    document: documentMock,
    window: Object.assign({
      sketchup: {
        update_furniture: (p) => bridgeCalls.push({ action: 'update_furniture', payload: JSON.parse(p) }),
        delete_selected_furniture: (p) => bridgeCalls.push({ action: 'delete_selected_furniture', payload: JSON.parse(p) }),
        select_furniture: (p) => bridgeCalls.push({ action: 'select_furniture', payload: JSON.parse(p) }),
        open_material_selector: (p) => bridgeCalls.push({ action: 'open_material_selector', payload: JSON.parse(p) })
      },
      GraneteDialog: {
        onUpdateResult: (r) => bridgeCalls.push({ action: 'onUpdateResult', payload: r }),
        onDeleteResult: (r) => bridgeCalls.push({ action: 'onDeleteResult', payload: r }),
        onSelectionChange: (c) => bridgeCalls.push({ action: 'onSelectionChange', payload: c })
      },
      GraneteMutation: {
        publishSelection: (c) => mutationCalls.push({ action: 'publishSelection', payload: c }),
        submitUpdate: (payload, ctx) => {
          mutationCalls.push({ action: 'submitUpdate', payload, ctx });
          return 'submitted';
        },
        submitBatchUpdate: (items) => {
          mutationCalls.push({ action: 'submitBatchUpdate', items });
          return 'sent';
        },
        phase: () => 'idle',
        submitHardwarePlacementUpdate: (val, ctx) => {
          mutationCalls.push({ action: 'submitHardwarePlacementUpdate', val, ctx });
          return 'submitted';
        },
        submitHardwareSubstitution: (id, ctx) => {
          mutationCalls.push({ action: 'submitHardwareSubstitution', id, ctx });
          return 'submitted';
        },
        submitComponentMutation: (op, t, ctx) => {
          mutationCalls.push({ action: 'submitComponentMutation', op, t, ctx });
          return 'submitted';
        },
        startComponentViewportMove: (ctx) => {
          mutationCalls.push({ action: 'startComponentViewportMove', ctx });
          return 'submitted';
        }
      },
      GraneteState: {
        get: () => null,
        set: () => {}
      },
      GraneteUI: graneteUI
    }, windowOverrides)
  };
  sandbox.__registry = registry;
  sandbox.__created = created;
  sandbox.__bridge = bridgeCalls;
  sandbox.__mutation = mutationCalls;
  sandbox.__toastCalls = toastCalls;
  sandbox.__tabCalls = tabCalls;
  sandbox.__childRenders = childRenders;
  sandbox.__childHides = childHides;
  sandbox.__docListeners = docListeners;
  return sandbox;
}

function runModule(sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-inspector.js' });
  return sandbox;
}

// Injects the standard recording deps (shared-helper stand-ins).
function initDeps(sandbox, overrides) {
  const deps = Object.assign({
    icon: (name) => 'icon:' + name,
    showToast: (type, msg) => sandbox.__toastCalls.push({ type, msg }),
    switchTab: (id) => sandbox.__tabCalls.push(id),
    getDefaultParams: (def) => {
      const p = {};
      ((def && def.parameters) || []).forEach((x) => { p[x.name] = x.defaultValue; });
      return p;
    },
    renderParamForm: (container, def, values, onChange) => {
      container.__lastRender = { def, values, onChange };
    },
    estimatedPartsLabel: () => 'Aprox. 5 piezas',
    parameterIssueMessage: (result, fallback) => (result && result.error) || fallback,
    // Same single implementation dialog.html injects (shared helper).
    capabilityEnabled: (context, name) =>
      !!(context && context.capabilities && context.capabilities[name] && context.capabilities[name].supported)
  }, overrides || {});
  sandbox.window.GraneteUI.inspector.init(deps);
  return deps;
}

function el(sandbox, id) {
  // Same auto-registering mock DOM the module sees: ids introduced by newer
  // slices (e.g. the #784 R3b draft footer) resolve without pre-declaring.
  return sandbox.document.getElementById(id);
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const DEFINITION = {
  furniture_definition_id: 'mod-test',
  name: 'Mueble de Prueba',
  parameters: [{ name: 'widthMm', defaultValue: 600, type: 'number', label: 'Ancho', min: 300, max: 900, step: 10, unit: 'mm' }],
  materialRoles: [{ role: 'BODY', label: 'Cuerpo', optionIds: ['mat-1'] }]
};

function furnitureContext(overrides) {
  return Object.assign({
    kind: 'furniture',
    furnitureInstanceRef: 'ref-1',
    furnitureDefinitionId: 'mod-test',
    representation: 'native',
    ownerRecovery: 'none',
    semanticPath: ['Mueble de Prueba'],
    display: { name: 'Mueble de Prueba' },
    definition: DEFINITION,
    parameters: { widthMm: 600 },
    materialChoices: {},
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: true, reason: null },
      canDelete: { supported: true, reason: null },
      canInspectManufacturing: { supported: false, reason: 'r' }
    }
  }, overrides);
}

// runTests -----------------------------------------------------------------

let registeredApi = null;

test('registration: namespace, idempotent re-execution, exact public API', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  assert(api, 'window.GraneteUI.inspector must exist');

  const expectedApi = ['init', 'onSelectionChange', 'onUpdateResult', 'onDeleteResult',
    'onMaterialChoiceApplied', 'activateInspectorTab', 'getSelectedContext',
    'getDefinition', 'getMaterialsCard', 'setHardwareCatalog', 'getHardwareCatalog'];
  expectedApi.forEach((k) => assert.strictEqual(typeof api[k], 'function', 'public API entry ' + k));

  // Idempotent re-execution: the same object survives a second load.
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-inspector.js' });
  assert.strictEqual(sandbox.window.GraneteUI.inspector, api, 're-execution must not rebuild the module');
  registeredApi = api;
});

test('init dependency contract: fail-fast lists every missing shared helper', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  assert.throws(() => api.onSelectionChange(furnitureContext()),
    /GraneteUI\.inspector\.init is required before use; missing deps: .+/,
    'selection rendering before init must fail fast');
  assert.strictEqual(api.getSelectedContext(), null, 'dep-free accessors stay safe before init');
  assert.strictEqual(api.getHardwareCatalog().length, 0, 'dep-free hardware accessor stays safe before init');
});

test('selection: null renders the empty state and publishes nothing locally', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(null);
  assert.strictEqual(api.getSelectedContext(), null);
  assert(visible(el(sandbox, 'inspector-empty-state')), 'empty state visible');
  assert(!visible(el(sandbox, 'inspector-active-view')), 'furniture view hidden');
});

test('selection: unmanaged shows its own view without stealing the tab', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange({ kind: 'unmanaged', ownerRecovery: 'none', display: { name: '' }, capabilities: {} });
  assert(visible(el(sandbox, 'inspector-unmanaged-view')), 'unmanaged view visible');
  assert(sandbox.__tabCalls.length === 0, 'unmanaged must not switch tabs');
});

test('selection: managed furniture switches to the Inspector tab when no definition is active', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: {
        defaultMaterialChoices: () => ({}),
        renderMaterialSelectors: () => {}
      },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  sandbox.window.GraneteUI.inspector.onSelectionChange(furnitureContext());
  assert.deepStrictEqual(sandbox.__tabCalls, ['inspector'], 'managed selection lands on the Inspector tab');
});

test('selection: multi-selection shows the multi note and fail-closes mutations', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ selectionCount: 3 }));
  assert(visible(el(sandbox, 'inspector-multi-note')), 'multi note visible');
  assert(el(sandbox, 'btn-apply').disabled, 'apply disabled');
  assert(el(sandbox, 'btn-delete').disabled, 'delete disabled');
  el(sandbox, 'btn-apply').click();
  assert(sandbox.__bridge.every((c) => c.action !== 'update_furniture'), 'no update under multi-selection');
});

// --- #471 R1: batch inspector de lectura ---------------------------------

function batchMember(overrides) {
  return Object.assign({
    kind: 'furniture',
    furnitureInstanceRef: 'furn-1',
    furnitureDefinitionId: 'kitchen-base-standard',
    display: { name: 'Mueble' },
    definition: {
      parameters: [{ name: 'widthMm', type: 'number', defaultValue: 600 }],
      materialRoles: [
        { role: 'FRONT', optionIds: ['mat-roble', 'mat-blanco'] },
        { role: 'BODY', optionIds: ['mat-blanco'] }
      ]
    },
    parameters: { widthMm: 600 },
    materialChoices: { FRONT: 'mat-roble', BODY: 'mat-blanco' },
    capabilities: { canEditParameters: { supported: true }, canEditMaterialRoles: { supported: true } }
  }, overrides || {});
}

function batchContext(members, excluded, editable) {
  var supported = { supported: !!editable, reason: editable ? null : '2 de 2 muebles no admiten esta edición' };
  return {
    kind: 'batch',
    origin: 'selection',
    furniture: members,
    excluded: excluded || [],
    capabilities: {
      canBatchEditParameters: supported,
      canBatchEditMaterialRoles: supported
    },
    selectionCount: (members || []).length + (excluded || []).length
  };
}

function batchRows(containerId, sandbox) {
  return el(sandbox, containerId).children.map((row) => ({
    label: row.children[0].textContent,
    value: row.children[1].textContent
  }));
}

test('batch: renders its own lane with summary and hides the single-furniture views', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(batchContext([
    batchMember(),
    batchMember({ furnitureInstanceRef: 'furn-2', parameters: { widthMm: 900 },
                  materialChoices: { FRONT: 'mat-blanco', BODY: 'mat-blanco' } })
  ]));
  assert(visible(el(sandbox, 'inspector-batch-view')), 'batch view visible');
  assert(!visible(el(sandbox, 'inspector-active-view')), 'furniture view hidden');
  assert(!visible(el(sandbox, 'inspector-empty-state')), 'empty state hidden');
  assert.strictEqual(el(sandbox, 'inspector-batch-title').textContent, '2 muebles en el lote');
  assert(el(sandbox, 'inspector-batch-summary').textContent.indexOf('2 muebles') !== -1,
    'summary names the affected count');
  assert(!visible(el(sandbox, 'inspector-batch-excluded')), 'no excluded note without exclusions');
});

test('batch: roles triage is honest — common value, mixed, and not-applicable-with-count', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  // Read-only mode (batch capability denied): the triage renders as text.
  api.onSelectionChange(batchContext([
    batchMember(),
    // Same BODY everywhere, different FRONT, and a third member without BODY.
    batchMember({ furnitureInstanceRef: 'furn-2', materialChoices: { FRONT: 'mat-blanco', BODY: 'mat-blanco' } }),
    batchMember({
      furnitureInstanceRef: 'furn-3',
      definition: {
        parameters: [{ name: 'widthMm', type: 'number', defaultValue: 600 }],
        materialRoles: [{ role: 'FRONT', optionIds: ['mat-roble'] }]
      },
      materialChoices: { FRONT: 'mat-roble' }
    })
  ], [], false));

  const byRole = {};
  batchRows('inspector-batch-roles', sandbox).forEach((r) => { byRole[r.label] = r.value; });
  assert.strictEqual(byRole.FRONT, 'Mixto', 'differing choices render as mixed, never an arbitrary first value');
  assert.strictEqual(byRole.BODY, 'No aplica a 1', 'a role a member lacks names the count it does not apply to');
  assert.strictEqual(byRole.SIDE, undefined, 'roles nobody supports are not invented');

  // The pure common case: every member shares the same choice.
  api.onSelectionChange(batchContext([
    batchMember(),
    batchMember({ furnitureInstanceRef: 'furn-2' })
  ], [], false));
  const common = batchRows('inspector-batch-roles', sandbox).find((r) => r.label === 'BODY');
  assert(common && common.value === 'Material mat-blanco',
    'common choice renders the resolved material name');
});

test('batch: params triage mirrors the roles honesty and excluded entities get a reason', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(batchContext([
    batchMember({
      definition: {
        parameters: [{ name: 'widthMm', type: 'number', defaultValue: 600 },
                     { name: 'shelfCount', type: 'number', defaultValue: 2 }],
        materialRoles: [
          { role: 'FRONT', optionIds: ['mat-roble', 'mat-blanco'] },
          { role: 'BODY', optionIds: ['mat-blanco'] }
        ]
      },
      parameters: { widthMm: 600, shelfCount: 3 }
    }),
    batchMember({
      furnitureInstanceRef: 'furn-2',
      parameters: { widthMm: 900, shelfCount: 3 },
      definition: {
        parameters: [
          { name: 'widthMm', type: 'number', defaultValue: 600 },
          { name: 'shelfCount', type: 'number', defaultValue: 2 },
          { name: 'doorCount', type: 'number', defaultValue: 2 }
        ],
        materialRoles: [{ role: 'FRONT', optionIds: ['mat-roble'] }]
      },
      materialChoices: { FRONT: 'mat-roble' }
    })
  ], [{ kind: 'unmanaged', reason: 'geometría no gestionada por Granete' }], false));

  const params = {};
  batchRows('inspector-batch-params', sandbox).forEach((r) => { params[r.label] = r.value; });
  assert.strictEqual(params.widthMm, 'Mixto', 'differing parameter values render as mixed');
  assert.strictEqual(params.shelfCount, '3', 'common parameter value renders exactly');
  assert.strictEqual(params.doorCount, 'No aplica a 1',
    'a parameter only some definitions declare names the count it does not apply to');
  assert(visible(el(sandbox, 'inspector-batch-excluded')), 'excluded note visible');
  assert(el(sandbox, 'inspector-batch-excluded').textContent.indexOf('geometría no gestionada') !== -1,
    'the excluded reason is shown, never a silent skip');
});

// --- #471 R2: editable batch Apply --------------------------------------

function batchRoleBlocks(sandbox) {
  return el(sandbox, 'inspector-batch-roles').children.map((block) => {
    const header = block.children[0];
    const preview = block.children[1];
    const info = preview ? preview.children[1] : null;
    return {
      role: header && header.children[0] ? header.children[0].textContent : '',
      changeBtn: header && header.children[1] ? header.children[1] : null,
      preview: preview,
      nameEl: info && info.children[0] ? info.children[0] : null,
      metaEl: info && info.children[1] ? info.children[1] : null
    };
  });
}

test('batch apply: roles become visual selector cards whose options are the intersection across members', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(batchContext([
    batchMember(),
    batchMember({ furnitureInstanceRef: 'furn-2', materialChoices: { FRONT: 'mat-blanco', BODY: 'mat-blanco' } })
  ], [], true));

  const blocks = batchRoleBlocks(sandbox);
  const front = blocks.find((s) => s.role === 'FRONT');
  const body = blocks.find((s) => s.role === 'BODY');
  assert(front && body, 'editable capability renders shared roles as visual selector cards');
  assert.strictEqual(front.nameEl.textContent, 'Mixto',
    'a mixed role starts on the Mixto label');
  assert.strictEqual(body.nameEl.textContent, 'Material mat-blanco',
    'a common role starts displaying the common material');
  assert(!visible(el(sandbox, 'inspector-batch-footer')), 'footer hidden until a role is chosen');

  // Clicking Cambiar opens the native material selector with intersection of options
  let selectorPayload = null;
  sandbox.window.sketchup = {
    open_material_selector: (json) => { selectorPayload = JSON.parse(json); }
  };
  front.changeBtn.click();
  assert(selectorPayload, 'clicking Cambiar opens material selector');
  assert.strictEqual(selectorPayload.role, 'FRONT');
  assert.strictEqual(selectorPayload.context, 'batch');
  assert.deepStrictEqual(selectorPayload.allowedMaterialIds, ['mat-roble', 'mat-blanco'],
    'allowedMaterialIds is the intersection of both members');

  // Picking a material through the selector dispatches onMaterialChoiceApplied
  api.onMaterialChoiceApplied({ role: 'FRONT', materialId: 'mat-roble', context: 'batch' });
  assert(visible(el(sandbox, 'inspector-batch-footer')), 'choosing a role shows the footer');
  assert(el(sandbox, 'inspector-batch-pending').textContent.indexOf('1 cambio a aplicar') !== -1,
    'the footer counts the pending change');
  assert.strictEqual(el(sandbox, 'btn-batch-apply').textContent, 'Aplicar a 2 muebles',
    'the Apply button names the affected count');
  assert.strictEqual(batchRoleBlocks(sandbox).find((b) => b.role === 'FRONT').nameEl.textContent,
    'Mixto → Material mat-roble', 'draft shows from -> to transition');

  el(sandbox, 'btn-batch-apply').click();
  const submit = sandbox.__mutation.find((c) => c.action === 'submitBatchUpdate');
  assert(submit, 'Apply rides GraneteMutation.submitBatchUpdate');
  // JSON round-trip: the items were built in the sandbox realm, the
  // expected literal in the test realm — deepStrictEqual compares
  // prototypes across realms.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(submit.items)), [
    { instanceId: 'furn-1', definitionId: 'kitchen-base-standard',
      parameters: { widthMm: 600 }, materialChoices: { FRONT: 'mat-roble' } },
    { instanceId: 'furn-2', definitionId: 'kitchen-base-standard',
      parameters: { widthMm: 600 }, materialChoices: { FRONT: 'mat-roble' } }
  ], 'one complete per-member intent: current parameters + only the chosen roles');
});

test('batch apply: one honest all-or-nothing outcome per result', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onBatchUpdateResult({ success: true, applied: 2, total: 2 });
  const successToast = sandbox.__toastCalls.find((t) => t.type === 'success');
  assert(successToast && successToast.msg.indexOf('2 muebles') !== -1,
    'success names the applied count');

  api.onBatchUpdateResult({ success: false, applied: 0, total: 2, error: 'lote abortado' });
  const errorToast = sandbox.__toastCalls.filter((t) => t.type === 'error').pop();
  assert(errorToast && errorToast.msg.indexOf('Ningún mueble cambió') !== -1,
    'failure states honestly that nothing was applied');
});

// --- #471 R3: compatible shared parameters -------------------------------

function batchInputs(sandbox) {
  return el(sandbox, 'inspector-batch-params').children.map((row) => ({
    label: row.children[0].textContent,
    input: row.children[1].children[0]
  })).filter((r) => r.input && String(r.input.tagName).toLowerCase() === 'input');
}

test('batch params: editable only with a common contract — range intersection, mixed placeholder', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(batchContext([
    batchMember({
      definition: {
        parameters: [
          { name: 'widthMm', type: 'number', defaultValue: 600, min: 300, max: 1200 },
          { name: 'shelfCount', type: 'number', defaultValue: 2, min: 1, max: 6 }
        ],
        materialRoles: []
      },
      parameters: { widthMm: 600, shelfCount: 2 }
    }),
    batchMember({
      furnitureInstanceRef: 'furn-2',
      definition: {
        parameters: [
          { name: 'widthMm', type: 'number', defaultValue: 900, min: 500, max: 1000 }
        ],
        materialRoles: []
      },
      parameters: { widthMm: 900 }
    })
  ], [], true));

  const inputs = batchInputs(sandbox);
  const width = inputs.find((i) => i.label === 'widthMm');
  assert(width, 'a parameter declared by every member with the same type renders an input');
  assert.strictEqual(width.input.min, '500', 'min is the strictest lower bound across members');
  assert.strictEqual(width.input.max, '1000', 'max is the narrowest upper bound across members');
  assert.strictEqual(width.input.value, '', 'a mixed value starts empty');
  assert.strictEqual(width.input.placeholder, 'Mixto', 'mixed parameters say so in the placeholder');

  const shelf = inputs.find((i) => i.label === 'shelfCount');
  assert(!shelf, 'a parameter only one definition declares is not editable');

  // A disjoint range contract has no honest common value: fail closed.
  api.onSelectionChange(batchContext([
    batchMember({
      definition: { parameters: [{ name: 'widthMm', type: 'number', defaultValue: 600, min: 300, max: 500 }] }
    }),
    batchMember({
      furnitureInstanceRef: 'furn-2',
      definition: { parameters: [{ name: 'widthMm', type: 'number', defaultValue: 900, min: 700, max: 1000 }] }
    })
  ], [], true));
  const rows = batchRows('inspector-batch-params', sandbox).filter((r) => r.label === 'widthMm');
  assert(rows.length === 1 && rows[0].value === 'sin rango común',
    'a disjoint range renders the honest no-common-contract note, not an input');
});

test('batch boolean: true+false is indeterminate, common values are exact, user resolution records the choice', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;

  const render = (a, b) => {
    const def = (v) => ({
      parameters: [{ name: 'softClose', type: 'boolean', defaultValue: v }]
    });
    api.onSelectionChange(batchContext([
      batchMember({ definition: def(a), parameters: { softClose: a } }),
      batchMember({ furnitureInstanceRef: 'furn-2', definition: def(b), parameters: { softClose: b } })
    ], [], true));
    return batchInputs(sandbox).find((i) => i.label === 'softClose');
  };

  // Common true: checked, resolved.
  const commonTrue = render(true, true);
  assert(commonTrue, 'boolean renders an input');
  assert.strictEqual(commonTrue.input.checked, true, 'true+true -> checked');
  assert(!commonTrue.input.indeterminate, 'true+true -> not indeterminate');

  // Common false: unchecked, resolved — never confused with mixed.
  const commonFalse = render(false, false);
  assert.strictEqual(commonFalse.input.checked, false, 'false+false -> unchecked');
  assert(!commonFalse.input.indeterminate, 'false+false -> not indeterminate');

  // Mixed: indeterminate tri-state, no edit recorded, footer hidden.
  const mixed = render(true, false);
  assert(mixed.input.indeterminate === true, 'true+false -> indeterminate');
  assert.strictEqual(mixed.input.checked, false, 'visual base state carries no claim');
  assert(!visible(el(sandbox, 'inspector-batch-footer')), 'an untouched mixed boolean edits nothing');

  // User resolves mixed -> true.
  mixed.input.checked = true;
  mixed.input.dispatchEvent({ type: 'change' });
  assert(!mixed.input.indeterminate, 'resolving clears indeterminate');
  el(sandbox, 'btn-batch-apply').click();
  let submit = sandbox.__mutation.find((c) => c.action === 'submitBatchUpdate');
  assert(submit, 'Apply rides submitBatchUpdate');
  let softClose = submit.items.map((i) => i.parameters.softClose);
  assert(softClose.every((v) => v === true), 'the chosen true applies to every member');

  // User resolves mixed -> false.
  sandbox.__mutation.length = 0;
  const mixedAgain = render(true, false);
  mixedAgain.input.checked = false;
  mixedAgain.input.dispatchEvent({ type: 'change' });
  assert(!mixedAgain.input.indeterminate, 'resolving to false also clears indeterminate');
  el(sandbox, 'btn-batch-apply').click();
  submit = sandbox.__mutation.find((c) => c.action === 'submitBatchUpdate');
  softClose = submit.items.map((i) => i.parameters.softClose);
  assert(softClose.every((v) => v === false), 'the chosen false applies to every member');
});

test('batch params: an edit merges into the per-member intent with current parameters', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      materialRoles: { materialById: (id) => ({ materialId: id, name: 'Material ' + id }) }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(batchContext([
    batchMember({
      definition: {
        parameters: [{ name: 'widthMm', type: 'number', defaultValue: 600, min: 300, max: 1200 }],
        materialRoles: [{ role: 'FRONT', optionIds: ['mat-roble', 'mat-blanco'] }]
      },
      parameters: { widthMm: 600, shelfCount: 4 }
    }),
    batchMember({
      furnitureInstanceRef: 'furn-2',
      definition: {
        parameters: [{ name: 'widthMm', type: 'number', defaultValue: 600, min: 300, max: 1200 }],
        materialRoles: [{ role: 'FRONT', optionIds: ['mat-roble', 'mat-blanco'] }]
      },
      parameters: { widthMm: 900 }
    })
  ], [], true));

  const width = batchInputs(sandbox).find((i) => i.label === 'widthMm');
  width.input.value = '800';
  width.input.dispatchEvent({ type: 'change' });
  api.onMaterialChoiceApplied({ role: 'FRONT', materialId: 'mat-roble', context: 'batch' });

  assert(el(sandbox, 'inspector-batch-pending').textContent.indexOf('2 cambios a aplicar') !== -1,
    'the footer counts roles and parameters together');

  el(sandbox, 'btn-batch-apply').click();
  const submit = sandbox.__mutation.find((c) => c.action === 'submitBatchUpdate');
  assert(submit, 'Apply rides GraneteMutation.submitBatchUpdate');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(submit.items)), [
    { instanceId: 'furn-1', definitionId: 'kitchen-base-standard',
      parameters: { widthMm: 800, shelfCount: 4 }, materialChoices: { FRONT: 'mat-roble' } },
    { instanceId: 'furn-2', definitionId: 'kitchen-base-standard',
      parameters: { widthMm: 800 }, materialChoices: { FRONT: 'mat-roble' } }
  ], 'each member keeps its own untouched parameters and receives the shared edits as numbers');
});

test('furniture: definition direct identity, param state, summary and materials render', () => {
  const renderCalls = [];
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: {
        defaultMaterialChoices: (def) => ({ BODY: 'mat-1' }),
        renderMaterialSelectors: (card, container, def, choices, onChange, ctx) => {
          renderCalls.push({ card, def, choices, ctx });
        }
      },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  assert.strictEqual(api.getDefinition(), DEFINITION, 'context.definition wins (no library fallback call)');
  assert(visible(el(sandbox, 'inspector-active-view')), 'active view visible');
  assert.strictEqual(el(sandbox, 'inspector-furniture-name').textContent, 'Mueble de Prueba');
  assert.strictEqual(renderCalls.length, 1, 'material roles renders once for the inspector');
  assert.strictEqual(renderCalls[0].card, api.getMaterialsCard(), 'renders into the inspector materials card');
  const form = el(sandbox, 'inspector-params-container').__lastRender;
  assert(form && form.values.widthMm === 600, 'param working snapshot prefilled from context');
  form.onChange('widthMm', 750, 'mm');
  assert.strictEqual(el(sandbox, 'inspector-summary-dims').textContent, '750 × 720 × 590 mm', 'summary follows the param edit');
});

test('furniture: library fallback resolves the definition when context omits it', () => {
  let fallbackHits = 0;
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: (id) => { fallbackHits += 1; return DEFINITION; } },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ definition: undefined }));
  assert.strictEqual(fallbackHits, 1, 'library fallback consulted');
  assert.strictEqual(api.getDefinition(), DEFINITION);
});

test('furniture: legacy representation warning renders the migration copy', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  sandbox.window.GraneteUI.inspector.onSelectionChange(furnitureContext({
    representation: 'legacy-group',
    capabilities: {
      canEditParameters: { supported: false, reason: 'Representación legacy: requerí la migración.' },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: true, reason: null }
    }
  }));
  assert(visible(el(sandbox, 'inspector-representation-warning')), 'legacy warning visible');
  assert(el(sandbox, 'inspector-representation-warning').textContent.includes('Migrar modelos anteriores'));
  assert(el(sandbox, 'inspector-edit-blocker-reason').textContent.includes('legacy'), 'capability reason surfaced');
  assert(!visible(el(sandbox, 'inspector-params-card')), 'params card hidden');
});

test('furniture: canDelete is independent of canEditParameters', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  sandbox.window.GraneteUI.inspector.onSelectionChange(furnitureContext({
    definition: null,
    capabilities: {
      canEditParameters: { supported: false, reason: 'La definición ya no está disponible.' },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: true, reason: null }
    }
  }));
  assert(el(sandbox, 'btn-delete').disabled === false, 'delete enabled while editing is denied');
  assert(el(sandbox, 'inspector-delete-blocker').hidden === true, 'no delete blocker note while canDelete holds');
});

test('materials: inspector target lands the pick in the draft, re-renders and never submits directly', () => {
  const renderCalls = [];
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: {
        defaultMaterialChoices: () => ({}),
        renderMaterialSelectors: (card, container, def, choices) => {
          renderCalls.push(Object.assign({}, choices));
        },
        materialById: (id) => (id === 'mat-9' ? { name: 'Roble' } : null)
      },
      configurator: { hasActiveDefinition: () => false, applyMaterialChoice: () => {} }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ materialChoices: {} }));
  const before = sandbox.__bridge.length;
  api.onMaterialChoiceApplied({ role: 'BODY', materialId: 'mat-9', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });
  assert(sandbox.__bridge.slice(before).every((c) => c.action !== 'update_furniture'),
    'the pick never fires the legacy immediate update');
  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'the pick never submits while drafting');
  assert(visible(el(sandbox, 'inspector-footer')), 'the pick is pending in the draft footer');
  assert.strictEqual(el(sandbox, 'inspector-pending').textContent, '1 cambio pendiente');
  assert.strictEqual(renderCalls[renderCalls.length - 1].BODY, 'mat-9', 'working snapshot updated and re-rendered');
  el(sandbox, 'btn-apply').click();
  const submit = sandbox.__mutation.filter((c) => c.action === 'submitUpdate').pop();
  assert(submit && submit.payload.materialChoices.BODY === 'mat-9', 'the Apply materializes the pick');
  assert.strictEqual(submit.payload.materialChoiceModes.BODY, 'override');
});

test('materials: multi-selection and denied capability fail closed (no mutation, no draft)', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false, applyMaterialChoice: () => {} }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ selectionCount: 2 }));
  let before = sandbox.__bridge.length;
  api.onMaterialChoiceApplied({ role: 'BODY', materialId: 'mat-9', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });
  assert(sandbox.__bridge.slice(before).every((c) => c.action !== 'update_furniture'), 'multi-selection never mutates');
  assert(!visible(el(sandbox, 'inspector-footer')), 'multi-selection never drafts either');

  api.onSelectionChange(furnitureContext({
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: false, reason: 'no roles' },
      canDelete: { supported: true, reason: null }
    }
  }));
  before = sandbox.__bridge.length;
  api.onMaterialChoiceApplied({ role: 'BODY', materialId: 'mat-9', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });
  assert(sandbox.__bridge.slice(before).every((c) => c.action !== 'update_furniture'), 'denied capability never mutates');
  assert(!visible(el(sandbox, 'inspector-footer')), 'denied capability never drafts');
});

test('materials: configurator target delegates; project scope writes project defaults', () => {
  const applied = [];
  const projectDefaults = [];
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: {
        defaultMaterialChoices: () => ({}),
        renderMaterialSelectors: () => {},
        materialById: (id) => ({ name: 'Roble ' + id }),
        setProjectDefaultMaterial: (role, id) => projectDefaults.push([role, id])
      },
      configurator: {
        hasActiveDefinition: () => true,
        applyMaterialChoice: (role, id, scope) => applied.push([role, id, scope])
      }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ furnitureInstanceRef: 'ref-other' }));
  api.onMaterialChoiceApplied({ role: 'BODY', materialId: 'mat-3', scope: 'furniture', context: 'configurator' });
  assert.deepStrictEqual(applied, [['BODY', 'mat-3', false]], 'configurator branch delegated');

  // Project scope without any target (no inspector context, configurator
  // without an active definition): material-roles authority + honest toast.
  sandbox.window.GraneteUI.configurator.hasActiveDefinition = () => false;
  const before = sandbox.__toastCalls.length;
  api.onMaterialChoiceApplied({ role: 'FRENTES', materialId: 'mat-4', scope: 'project_default' });
  assert.deepStrictEqual(projectDefaults[0], ['FRENTES', 'mat-4'], 'project_default alias reaches the authority');
  assert(sandbox.__toastCalls.length > before, 'project-scope toast emitted');
  assert(sandbox.__bridge.every((c) => c.action !== 'update_furniture'), 'no instance mutation for project scope');
});

test('materials: onMaterialChoiceApplied with context: "design" routes to GraneteUI.designInspector.applyMaterialPick', () => {
  let designPick = null;
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false, applyMaterialChoice: () => {} },
      designInspector: {
        applyMaterialPick: (role, matId) => { designPick = { role, matId }; }
      }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onMaterialChoiceApplied({ role: 'FRENTES', materialId: 'mat-roble', scope: 'design', context: 'design' });
  assert.deepStrictEqual(designPick, { role: 'FRENTES', matId: 'mat-roble' });
});

test('delete: first click arms, second confirms with the Ruby payload; timeout resets', () => {
  const timeouts = [];
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  sandbox.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return 1; };
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'btn-delete').click();
  assert.strictEqual(el(sandbox, 'btn-delete').textContent, '¿Confirmar eliminación?', 'armed copy');
  assert.strictEqual(timeouts[0].ms, 4000, '4s arm window');
  el(sandbox, 'btn-delete').click();
  const call = sandbox.__bridge.filter((c) => c.action === 'delete_selected_furniture').pop();
  assert(call && call.payload.instanceId === 'ref-1', 'Ruby delete payload exact');
  assert.strictEqual(el(sandbox, 'btn-delete').innerHTML, 'icon:trash<span>Eliminar Mueble</span>', 'reset after confirm restores the icon+label');
});

test('delete: denied capability and multi-selection never reach the host', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: false, reason: 'proyecto conectado' }
    }
  }));
  el(sandbox, 'btn-delete').click();
  api.onSelectionChange(furnitureContext({ selectionCount: 3 }));
  el(sandbox, 'btn-delete').click();
  assert(sandbox.__bridge.every((c) => c.action !== 'delete_selected_furniture'), 'delete stays local on denials');
});

test('delete: no-host fallback closes honestly through the bridge wrappers', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    }
  });
  sandbox.window.sketchup = {}; // no delete_selected_furniture
  runModule(sandbox);
  initDeps(sandbox);
  sandbox.window.GraneteUI.inspector.onSelectionChange(furnitureContext());
  el(sandbox, 'btn-delete').click();
  el(sandbox, 'btn-delete').click();
  const actions = sandbox.__bridge.map((c) => c.action);
  assert(actions.includes('onDeleteResult'), 'delete result answered');
  assert(actions.includes('onSelectionChange'), 'selection cleared through the bridge');
  const del = sandbox.__bridge.filter((c) => c.action === 'onDeleteResult').pop();
  assert(del.payload && del.payload.ok === true, 'fallback answers ok:true');
});

test('delete: result handler toasts the Undo copy on success and the reason on failure', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onDeleteResult({ ok: true });
  assert(sandbox.__toastCalls[0].msg.includes('Deshacé con Ctrl+Z'), 'success copy names Undo');
  api.onDeleteResult({ ok: false, reason: 'bloqueado por X' });
  assert(sandbox.__toastCalls[1].msg.includes('bloqueado por X'), 'error copy keeps the reason');
});

test('routing: child kinds delegate to GraneteUI.inspectorChild with the SAME context; other renders drop the lane', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  const childContext = {
    kind: 'part', furnitureInstanceRef: 'ref-1', ownerRecovery: 'scan',
    semanticPath: ['M', 'P'], display: { name: 'P' }, capabilities: {}
  };
  api.onSelectionChange(childContext);
  assert.deepStrictEqual(sandbox.__childRenders, [childContext],
    'child kind routed to the child module — the SAME object, no clone');
  assert.strictEqual(sandbox.__childHides.length, 1, 'the lane is dropped before the child render');

  api.onSelectionChange(furnitureContext());
  assert.strictEqual(sandbox.__childRenders.length, 1, 'furniture kind never routes to the child module');
  assert.strictEqual(sandbox.__childHides.length, 2, 'furniture render drops the child lane');

  api.onSelectionChange(null);
  assert.strictEqual(sandbox.__childHides.length, 3, 'cleared selection drops the child lane');
  assert.strictEqual(sandbox.__childRenders.length, 1, 'no child render for null');
});

test('cross-runtime: selection is published to GraneteMutation by reference', () => {
  const ctx = furnitureContext();
  let published = null;
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false }
    },
    GraneteMutation: {
      publishSelection: (c) => { published = c; },
      submitUpdate: () => 'submitted',
      submitHardwarePlacementUpdate: () => 'submitted',
      submitHardwareSubstitution: () => 'submitted',
      submitComponentMutation: () => 'submitted',
      startComponentViewportMove: () => 'submitted'
    }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(ctx);
  assert(published === ctx, 'the SAME reference is published (no clone)');
  assert.strictEqual(api.getSelectedContext(), ctx);
});

test('cross-runtime: manufacturing card visibility obeys kind/capability without computing machining', () => {
  const renderCalls = [];
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} }
    },
    GraneteManufacturing: { render: () => renderCalls.push(1) }
  });
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  assert.strictEqual(el(sandbox, 'manufacturing-card').style.display, 'none', 'no manufacturing surface without the capability');
  api.onSelectionChange(furnitureContext({
    capabilities: Object.assign({}, furnitureContext().capabilities, { canInspectManufacturing: { supported: true, reason: null } })
  }));
  assert.strictEqual(el(sandbox, 'manufacturing-card').style.display, 'block', 'card shown for capable furniture');
  assert.strictEqual(renderCalls.length, 2, 'GraneteManufacturing.render called per inspector render');
});

test('hardware catalog: set/get roundtrip with live identity', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  assert.strictEqual(api.getHardwareCatalog().length, 0, 'starts empty');
  const hardware = [{ id: 'hw-1', name: 'Manija' }];
  api.setHardwareCatalog(hardware);
  assert.strictEqual(api.getHardwareCatalog(), hardware, 'same live reference, no copy');
  api.setHardwareCatalog(undefined);
  assert.strictEqual(api.getHardwareCatalog().length, 0, 'undefined normalizes to an empty catalog');
});

test('hardware catalog: integrated setCatalog object branch delegates; array branch preserves the non-reset quirk', () => {
  const sandbox = buildModuleSandbox();
  // The real dialog chain builds window.GraneteUI itself: drop the sandbox
  // stubs so the modules' idempotence guards register the REAL modules.
  delete sandbox.window.GraneteUI;
  // The inline bootstrap needs tab probes that answer with elements and a
  // functional GraneteState store to observe the catalog projection.
  sandbox.document.querySelector = () => createMockElement('q', 'BUTTON');
  const store = {};
  sandbox.window.GraneteState = {
    get: (k) => (k in store ? store[k] : null),
    set: (k, v) => { store[k] = v; },
    subscribe: () => () => {}
  };
  vm.createContext(sandbox);
  runDialogScripts(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  const hardware = [{ id: 'hw-1', name: 'Manija', category: 'handles' }];

  // Object payload: hardware delegates to the inspector and the GraneteState
  // projection reads the SAME live reference.
  sandbox.window.GraneteDialog.setCatalog({
    definitions: [], presets: [], categories: [], materials: [], materialCategories: [], hardware: hardware
  });
  assert.strictEqual(api.getHardwareCatalog(), hardware, 'object branch delegates the hardware slice');
  const projection = sandbox.window.GraneteState.get('catalog');
  assert(projection && projection.hardware === hardware, 'GraneteState projects the same live reference');

  // Array legacy payload: presets/materials/media reset — hardware does NOT
  // (historical non-reset quirk, preserved verbatim).
  sandbox.window.GraneteDialog.setCatalog([]);
  assert.strictEqual(api.getHardwareCatalog(), hardware, 'array branch must not reset the hardware catalog');
});

test('structural: the monolith keeps no inspector implementation and delegates through thin wrappers', () => {
  ['var selectedContext = null;', 'var inspectorDef = null;', 'var inspectorParams = {};',
   'var inspectorMaterialChoices = {};', 'var catalogHardware = [];',
   'function renderInspector(', 'function renderFurnitureInspector(', 'function renderChildInspector(',
   'function renderPartAuthoringCard(', 'function renderBreadcrumb(', 'function renderChildFacts(',
   'function renderCapabilityList(', 'function formatAnchorFace(',
   'var CAPABILITY_LABELS', 'var KIND_BADGES', 'var ANCHOR_FACE_LABELS',
   'function validateInteractiveClient(', 'function updateInspectorSummary(',
   'function resetDeleteConfirm(', 'function submitPartMutation(',
   'deleteArmed', 'partPositionFromInputs'].forEach((symbol) => {
    assert(!DIALOG_HTML.includes(symbol), 'dialog.html must not carry inspector implementation: ' + symbol);
  });
  // The capability check returns to dialog.html as the SHARED helper
  // (#848 boundary-adjusted split): one single implementation there,
  // injected into BOTH Inspector modules, re-implemented in NEITHER.
  assert(DIALOG_HTML.includes('function capabilityEnabled(context, name) {'),
    'dialog.html carries the single shared capability helper');
  assert.strictEqual(DIALOG_HTML.split('capabilityEnabled: capabilityEnabled').length - 1, 2,
    'the shared capability helper is injected into both Inspector modules');
  assert(!SOURCE.includes('function capabilityEnabled('),
    'the inspector module must not re-implement the shared capability helper');
  // The child surface is delegated, never regrown in the main module.
  assert(SOURCE.includes('window.GraneteUI.inspectorChild.render(context)'),
    'child kinds route through GraneteUI.inspectorChild.render');
  assert(SOURCE.includes('window.GraneteUI.inspectorChild.hide();'),
    'top-level re-renders drop the child lane through hide()');
  // Ruby-facing wrappers stay thin delegation with unchanged names.
  ['onSelectionChange: function (context) {\n            window.GraneteUI.inspector.onSelectionChange(context);',
   'onUpdateResult: function (result) {\n            window.GraneteUI.inspector.onUpdateResult(result);',
   'onDeleteResult: function (result) {\n            window.GraneteUI.inspector.onDeleteResult(result);',
   'activateInspectorTab: function () {\n            window.GraneteUI.inspector.activateInspectorTab();',
   'onMaterialChoiceApplied: function (payload) {\n            window.GraneteUI.inspector.onMaterialChoiceApplied(payload);'].forEach((wrapper) => {
    assert(DIALOG_HTML.includes(wrapper), 'GraneteDialog wrapper must stay thin delegation: ' + wrapper.split('\n')[0]);
  });
  // The inline runtime adapters read the inspector API.
  assert(DIALOG_HTML.includes('window.GraneteManufacturing.toggle(window.GraneteUI.inspector.getSelectedContext())'),
    'manufacturing adapter reads the inspector selection');
  assert(DIALOG_HTML.includes('window.GranetePreflightReview.run(window.GraneteUI.inspector.getSelectedContext())'),
    'preflight adapter reads the inspector selection');
});

// ---------------------------------------------------------------------------
// #784 R3 final review — the update result refreshes the inheritance
// projection. (The restore-emit tests moved to the R3b draft block below:
// the restore is a draft edit now, applied by the single [Aplicar].)
// ---------------------------------------------------------------------------

test('R3 refresh: a successful update result refreshes the inheritance projection', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false },
      designInspector: { refreshInheritance: () => { sandbox.__refreshCalls.push(true); }, hide: () => {} }
    }
  });
  sandbox.__refreshCalls = [];
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());

  api.onUpdateResult({ success: true, name: 'Mueble' });

  assert.strictEqual(sandbox.__refreshCalls.length, 1,
    'a successful furniture mutation must refresh the inheritance projection');
});

test('R3 refresh: a failed update result does not refresh the projection', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      library: { findDefinitionById: () => undefined },
      materialRoles: { defaultMaterialChoices: () => ({}), renderMaterialSelectors: () => {} },
      configurator: { hasActiveDefinition: () => false },
      designInspector: { refreshInheritance: () => { sandbox.__refreshCalls.push(true); }, hide: () => {} }
    }
  });
  sandbox.__refreshCalls = [];
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());

  api.onUpdateResult({ success: false });

  assert.strictEqual(sandbox.__refreshCalls.length, 0,
    'a failed mutation must not trigger a projection refresh');
});

// ---------------------------------------------------------------------------
// #784 R3b — draft + Apply: las ediciones de parámetros y roles de material
// del Furniture Inspector van a un DRAFT local con footer de pendientes; un
// solo [Aplicar] emite UNA mutación con el intent completo (parámetros +
// materialChoices + materialChoiceModes) = un resolve = UNA operación de
// SketchUp = un undo coherente. [Descartar] es read-only. El draft muere con
// cambio real de selección o de binding (espíritu #906) y un fallo de la
// mutación lo PRESERVA con mensaje honesto.
// ---------------------------------------------------------------------------

test('R3b draft: a param edit stays local — zero mutations and the footer counts 1 pending change', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());

  const form = el(sandbox, 'inspector-params-container').__lastRender;
  form.onChange('widthMm', 750, 'mm');

  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'a param edit must not submit anything');
  assert(sandbox.__bridge.every((c) => c.action !== 'update_furniture'),
    'a param edit must not ride the legacy bridge either');
  assert(visible(el(sandbox, 'inspector-footer')), 'the draft footer becomes visible');
  assert.strictEqual(el(sandbox, 'inspector-pending').textContent, '1 cambio pendiente');
  assert(!el(sandbox, 'btn-apply').disabled, 'Aplicar is available');
});

test('R3b draft: a material pick lands in the draft (no immediate mutation) and the count accumulates', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  const form = el(sandbox, 'inspector-params-container').__lastRender;
  form.onChange('widthMm', 750, 'mm');

  api.onMaterialChoiceApplied({ role: 'FRONT', materialId: 'mat-2', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });

  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'a material pick must not submit anything while drafting');
  assert(sandbox.__bridge.every((c) => c.action !== 'update_furniture'),
    'the native-selector pick must not fire the legacy immediate update');
  assert.strictEqual(el(sandbox, 'inspector-pending').textContent, '2 cambios pendientes',
    'param + role drafts accumulate honestly');
});

test('R3b apply: exactly ONE submitUpdate carrying the complete intent (params + choices + modes override)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  const form = el(sandbox, 'inspector-params-container').__lastRender;
  form.onChange('widthMm', 750, 'mm');
  api.onMaterialChoiceApplied({ role: 'FRONT', materialId: 'mat-2', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });

  el(sandbox, 'btn-apply').click();

  const submits = sandbox.__mutation.filter((c) => c.action === 'submitUpdate');
  assert.strictEqual(submits.length, 1, 'one user Apply = exactly one mutation');
  const payload = submits[0].payload;
  assert.strictEqual(payload.instanceId, 'ref-1');
  assert.strictEqual(payload.definitionId, 'mod-test');
  assert.strictEqual(payload.parameters.widthMm, 750, 'the full working parameters ride the intent');
  assert.strictEqual(payload.materialChoices.FRONT, 'mat-2', 'the picked role materializes');
  assert.strictEqual(payload.materialChoiceModes.FRONT, 'override',
    'a picked role declares the explicit override lineage');
  assert(el(sandbox, 'btn-apply').disabled, 'Aplicar is disabled while the mutation is in flight');
});

test('R3b apply: double click emits exactly one mutation (in-flight guard)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  const form = el(sandbox, 'inspector-params-container').__lastRender;
  form.onChange('widthMm', 750, 'mm');

  el(sandbox, 'btn-apply').click();
  el(sandbox, 'btn-apply').click();

  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 1,
    'the second click must be swallowed by the in-flight guard');
});

test('R3b discard: read-only — zero mutations, snapshots restored, footer hidden', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  const form = el(sandbox, 'inspector-params-container').__lastRender;
  form.onChange('widthMm', 750, 'mm');
  api.onMaterialChoiceApplied({ role: 'FRONT', materialId: 'mat-2', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });

  el(sandbox, 'btn-discard').click();

  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'Descartar never mutates');
  assert(sandbox.__bridge.every((c) => c.action !== 'update_furniture'), 'Descartar never rides the bridge');
  assert(!visible(el(sandbox, 'inspector-footer')), 'the footer hides with no pending edits');
  assert.strictEqual(el(sandbox, 'inspector-params-container').__lastRender.values.widthMm, 600,
    'the param snapshot is restored to the confirmed value');
  assert.strictEqual(api.getSelectedContext().parameters.widthMm, 600,
    'discard never writes into the selection context');
});

test('R3b draft: a real selection change kills the draft — identical republish of the same item survives', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;

  // (a) same ref, diverged server state: the draft dies (no silent rebase).
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  api.onSelectionChange(furnitureContext({ parameters: { widthMm: 610 } }));
  assert(!visible(el(sandbox, 'inspector-footer')), 'diverged server state kills the draft');
  assert.strictEqual(el(sandbox, 'inspector-params-container').__lastRender.values.widthMm, 610,
    'the render rebuilds from the new context, never from the dead draft');

  // (b) another item: the draft dies.
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  api.onSelectionChange(furnitureContext({ furnitureInstanceRef: 'ref-2' }));
  assert(!visible(el(sandbox, 'inspector-footer')), 'a different item kills the draft');

  // (c) identical republish of the SAME item: the draft survives and the
  //     edits stay visible.
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  api.onSelectionChange(furnitureContext());
  assert(visible(el(sandbox, 'inspector-footer')), 'an identical republish keeps the draft');
  assert.strictEqual(el(sandbox, 'inspector-pending').textContent, '1 cambio pendiente');
  assert.strictEqual(el(sandbox, 'inspector-params-container').__lastRender.values.widthMm, 750,
    'the surviving draft re-applies its edits on the re-render');
  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'selection changes never mutate');
});

test('R3b apply failure: honest error, the draft is preserved (no silent rollback)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  el(sandbox, 'btn-apply').click();

  api.onUpdateResult({ success: false, error: 'El ancho excede el rango del catálogo.' });

  const errorToast = sandbox.__toastCalls.filter((t) => t.type === 'error').pop();
  assert(errorToast && errorToast.msg.includes('El ancho excede el rango del catálogo.'),
    'the failure surfaces the server reason');
  assert(visible(el(sandbox, 'inspector-footer')), 'the draft survives a failed Apply');
  assert.strictEqual(el(sandbox, 'inspector-pending').textContent, '1 cambio pendiente');
  assert.strictEqual(el(sandbox, 'inspector-params-container').__lastRender.values.widthMm, 750,
    'the drafted value stays on screen — no rollback to the old state');
  assert(!el(sandbox, 'btn-apply').disabled, 'Aplicar is re-enabled after the honest failure');
});

test('R3b apply success: draft cleared, footer hidden, and refreshInheritance exactly once', () => {
  const sandbox = buildModuleSandbox({
    GraneteUI: {
      designInspector: { refreshInheritance: () => { sandbox.__refreshCalls.push(true); }, hide: () => {} }
    }
  });
  sandbox.__refreshCalls = [];
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  el(sandbox, 'btn-apply').click();

  api.onUpdateResult({ success: true, name: 'Mueble de Prueba' });

  assert(!visible(el(sandbox, 'inspector-footer')), 'success clears the draft and hides the footer');
  assert.strictEqual(sandbox.__refreshCalls.length, 1,
    'the inheritance projection is refreshed exactly once per successful Apply');
  assert.strictEqual(api.getSelectedContext().parameters.widthMm, 750,
    'the confirmed values persist into the selection context');
});

test('R3b restore: lands in the draft with mode=design and applies together with the rest', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ materialChoices: { INTERIOR: 'mat-roble' } }));

  api.applyRoleRestore('ref-1', 'INTERIOR', 'mat-blanco');

  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'a restore is a draft edit now, not an immediate mutation');
  assert.strictEqual(el(sandbox, 'inspector-pending').textContent, '1 cambio pendiente');

  // A later pick on the SAME role supersedes the restore: last action wins.
  api.onMaterialChoiceApplied({ role: 'INTERIOR', materialId: 'mat-nogal', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });
  el(sandbox, 'btn-apply').click();
  const submits = sandbox.__mutation.filter((c) => c.action === 'submitUpdate');
  assert.strictEqual(submits.length, 1);
  assert.strictEqual(submits[0].payload.materialChoiceModes.INTERIOR, 'override',
    'the explicit edit supersedes the restore marker');
  assert.strictEqual(submits[0].payload.materialChoices.INTERIOR, 'mat-nogal');
});

test('R3b restore: a pure restore Apply declares design lineage (no pick after it)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({ materialChoices: { INTERIOR: 'mat-roble' } }));
  api.applyRoleRestore('ref-1', 'INTERIOR', 'mat-blanco');

  el(sandbox, 'btn-apply').click();

  const submit = sandbox.__mutation.filter((c) => c.action === 'submitUpdate').pop();
  assert(submit, 'the Apply emits the mutation');
  assert.strictEqual(submit.payload.materialChoices.INTERIOR, 'mat-blanco',
    'the current design default is materialized');
  assert.strictEqual(submit.payload.materialChoiceModes.INTERIOR, 'design',
    'the restored role carries the design lineage');
});

test('R3b restore: unsupported canEditMaterialRoles emits nothing', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext({
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: true, reason: null }
    }
  }));

  api.applyRoleRestore('ref-1', 'INTERIOR', 'mat-blanco');

  assert.strictEqual(sandbox.__mutation.filter((c) => c.action === 'submitUpdate').length, 0,
    'an unsupported capability must not draft anything');
  assert(!visible(el(sandbox, 'inspector-footer')), 'no footer without a real draft');
});

test('R3b binding: a real binding change kills the draft; a same-binding refresh does not', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');

  api.onBindingStatus({ state: 'connected', binding: { designId: 'd1', projectId: 'p1' } });
  assert(!visible(el(sandbox, 'inspector-footer')), 'the first real binding notification kills the draft');

  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  api.onBindingStatus({ state: 'connected', binding: { designId: 'd1', projectId: 'p1' } });
  assert(visible(el(sandbox, 'inspector-footer')), 'a refresh with the SAME binding never invalidates');

  api.onBindingStatus({ state: 'connected', binding: { designId: 'd2', projectId: 'p1' } });
  assert(!visible(el(sandbox, 'inspector-footer')), 'a design switch kills the draft (espíritu #906)');

  api.onBindingStatus({ state: 'unbound' });
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  api.onBindingStatus({ state: 'connected', binding: { designId: 'd1', projectId: 'p1' } });
  assert(!visible(el(sandbox, 'inspector-footer')), 'unbound → connected is a real change too');
});

test('R3b apply: without GraneteMutation the intent rides the legacy host bridge intact', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  delete sandbox.window.GraneteMutation;
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');
  api.onMaterialChoiceApplied({ role: 'FRONT', materialId: 'mat-2', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });

  el(sandbox, 'btn-apply').click();

  const call = sandbox.__bridge.filter((c) => c.action === 'update_furniture').pop();
  assert(call, 'the legacy host bridge carries the Apply');
  assert.strictEqual(call.payload.parameters.widthMm, 750);
  assert.strictEqual(call.payload.materialChoices.FRONT, 'mat-2');
  assert.strictEqual(call.payload.materialChoiceModes.FRONT, 'override');
});

test('R3b apply: with no host bridge at all the demo fallback answers honestly', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  delete sandbox.window.GraneteMutation;
  sandbox.window.sketchup = {};
  sandbox.setTimeout = (fn) => { fn(); return 0; };
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');

  el(sandbox, 'btn-apply').click();

  const answered = sandbox.__bridge.filter((c) => c.action === 'onUpdateResult').pop();
  assert(answered && answered.payload.success === true,
    'no-host fallback answers success via the bridge wrapper');
});

test('R3b apply: a params-only draft omits materialChoiceModes; a busy controller preserves the draft', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspector;
  api.onSelectionChange(furnitureContext());
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 750, 'mm');

  el(sandbox, 'btn-apply').click();
  const submit = sandbox.__mutation.filter((c) => c.action === 'submitUpdate').pop();
  assert.strictEqual(submit.payload.materialChoiceModes, undefined,
    'no role edits — no lineage statement is invented');

  // The first Apply failed (draft preserved per contract); now another
  // surface occupies the mutation controller and the user re-applies.
  api.onUpdateResult({ success: false, error: 'x' });
  sandbox.window.GraneteMutation.submitUpdate = () => 'busy';
  el(sandbox, 'inspector-params-container').__lastRender.onChange('widthMm', 800, 'mm');
  el(sandbox, 'btn-apply').click();
  assert(visible(el(sandbox, 'inspector-footer')), 'a busy controller keeps the draft alive');
  const busyToast = sandbox.__toastCalls.filter((t) => t.type === 'error').pop();
  assert(busyToast && busyToast.msg.includes('mutación en curso'), 'the busy state is named honestly');
});

console.log(JSON.stringify({ success: true, testsPassed: testsPassed, module: 'granete-inspector.js' }));
