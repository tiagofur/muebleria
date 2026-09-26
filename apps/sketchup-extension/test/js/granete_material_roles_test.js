// #848 Phase B C4.6 — real JavaScript harness for granete-material-roles.js:
// the shared material/acabados authority under window.GraneteUI.materialRoles.
// Drives the actual module file in a vm sandbox (mock DOM, recording
// GraneteUI.media / finishSelector / sketchup stubs) and proves the
// ownership contract: catalog set/reset + project defaults surviving
// refreshes, role resolution (curated optionIds, invalid filtering,
// all-materials fallback), default choice resolution, role rendering
// (swatch/meta/visibility), the Ruby-native selector as PRIMARY path with
// the finish-selector fallback, context payload resolution (configurator /
// inspector / explicit contextInfo) and the single material authority
// (GraneteState projection reads the module's live arrays; part B drives
// the real GraneteDialog.setCatalog orchestrator).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { dialogSources, runDialogScripts } = require('./support/dialog_scripts');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-material-roles.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

// Objects created inside the vm realm carry that realm's Object.prototype;
// normalize through JSON before deepStrictEqual against host literals.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
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
    value: '',
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
      const type = typeof event === 'string' ? event : event.type;
      (listeners[type] || []).forEach((cb) => cb(event));
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

const MATERIALS = [
  { materialId: 'mat-1', name: 'Melamina Blanca', code: 'MB-01', manufacturer: 'Finsa', thicknessMm: 18, grain: false, previewColor: '#f5f5f5' },
  { materialId: 'mat-2', name: 'Roble Natural', code: 'ROB-02', manufacturer: 'Egger', thicknessMm: 19, grain: true, previewTextureUrl: 'tex/roble.png' },
  { materialId: 'mat-3', name: 'Frente Laca', code: 'FL-03', manufacturer: 'Blum', thicknessMm: 0, grain: false, previewTextureUrl: 'tex/laca.png', previewColor: '#123456' }
];

const MATERIAL_CATEGORIES = [{ id: 'cat-1', name: 'Tableros', sortOrder: 1 }];

// Fresh sandbox per test. The module file runs verbatim; init() receives
// recording deps (icon + Inspector context accessors). Pass
// { skipInit: true } for the fail-fast test or { omitSketchup: true } to
// exercise the finish-selector fallback path.
function runModule(options) {
  options = options || {};
  const registry = {};
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag)
  };
  const mediaCalls = { filenameFromPath: [], resolveUrl: [] };
  const selectorCalls = [];
  const rubyCalls = [];
  const iconCalls = [];

  const sandbox = {
    document: documentMock,
    window: {
      GraneteUI: {
        media: {
          filenameFromPath: (p) => {
            mediaCalls.filenameFromPath.push(p);
            return p ? String(p).split('/').pop() : null;
          },
          resolveUrl: (p) => {
            mediaCalls.resolveUrl.push(p);
            return p ? 'signed://' + p : null;
          }
        },
        finishSelector: {
          open: (roleEntry, selectedId, onApply, contextKind) => {
            selectorCalls.push({ roleEntry, selectedId, onApply, contextKind });
            return true;
          }
        }
      }
    }
  };
  if (!options.omitSketchup) {
    sandbox.window.sketchup = {
      open_material_selector: (json) => { rubyCalls.push(JSON.parse(json)); }
    };
  }

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  const mr = sandbox.window.GraneteUI.materialRoles;

  const inspectorCard = createMockElement('inspector-materials-card');
  const inspectorDef = { furnitureDefinitionId: 'insp-def', materialRoles: [{ role: 'BODY', label: 'Cuerpo', optionIds: ['mat-1'] }] };
  const selectedContext = { furnitureInstanceRef: 'ref-9' };

  if (!options.skipInit) {
    mr.init(Object.assign({
      icon: (name, size) => { iconCalls.push([name, size]); return '<svg>' + name + '</svg>'; },
      getInspectorMaterialsCard: () => inspectorCard,
      getInspectorDef: () => inspectorDef,
      getSelectedContext: () => selectedContext
    }, options.depOverrides || {}));
  }

  return { sandbox, mr, inspectorCard, inspectorDef, selectedContext, mediaCalls, selectorCalls, rubyCalls, iconCalls };
}

// Renders one renderable role and returns the rendered pieces.
function renderRole(mr, overrides) {
  const card = createMockElement('some-card');
  const container = createMockElement('some-container');
  const onChangeCalls = [];
  const def = Object.assign({ furnitureDefinitionId: 'def-1', materialRoles: [Object.assign({ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2', 'mat-3'] }, {})] }, overrides && overrides.defExtra || {});
  const choices = overrides && overrides.choices ? overrides.choices : {};
  mr.renderMaterialSelectors(card, container, def, choices, function (role, id, scope) {
    onChangeCalls.push({ role, id, scope });
  }, overrides && overrides.contextInfo);
  const block = container.children[0];
  const preview = block.children[1];
  const swatch = preview.children[0];
  const info = preview.children[1];
  return { card, container, def, choices, onChangeCalls, block, preview, swatch, info };
}

// ---------------------------------------------------------------------------
// Part A — module contract (real granete-material-roles.js)
// ---------------------------------------------------------------------------

test('registers window.GraneteUI.materialRoles and is idempotent under re-execution', () => {
  const first = runModule();
  const api = first.mr;
  vm.runInContext(SOURCE, first.sandbox, { filename: MODULE_PATH });
  assert.strictEqual(first.sandbox.window.GraneteUI.materialRoles, api, 're-execution must not replace the module');
  assert.strictEqual(typeof api.setCatalog, 'function', 'module stays usable after re-execution');
});

test('public API is the exact minimal surface (10 entries, all functions)', () => {
  const { mr } = runModule();
  assert.deepStrictEqual(
    Object.keys(mr).sort(),
    ['defaultMaterialChoices', 'getMaterialCategories', 'getMaterials', 'init', 'materialById',
      'optionMaterialIds', 'renderMaterialSelectors', 'setCatalog', 'setProjectDefaultMaterial', 'updateMaterialSwatch']
  );
  Object.keys(mr).forEach((k) => assert.strictEqual(typeof mr[k], 'function', k + ' must be a function'));
});

test('setCatalog stores the slice and getMaterials/getCategories return the live arrays', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: MATERIAL_CATEGORIES });
  const materials = mr.getMaterials();
  const categories = mr.getMaterialCategories();
  assert.deepStrictEqual(materials.map((m) => m.materialId), ['mat-1', 'mat-2', 'mat-3']);
  assert.deepStrictEqual(categories, MATERIAL_CATEGORIES);
  assert.strictEqual(mr.getMaterials(), materials, 'same live array between reads — no copy per read');
  mr.setCatalog({ materials: [MATERIALS[0]], categories: [] });
  assert.notStrictEqual(mr.getMaterials(), materials, 'next setCatalog replaces the array identity');
  assert.deepStrictEqual(mr.getMaterials().map((m) => m.materialId), ['mat-1']);
});

test('reset semantics: empty slices empty the catalog', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: MATERIAL_CATEGORIES });
  mr.setCatalog({ materials: [], categories: [] });
  assert.deepStrictEqual(mr.getMaterials(), []);
  assert.deepStrictEqual(mr.getMaterialCategories(), []);
  assert.strictEqual(mr.materialById('mat-1'), null, 'lookups see the reset');
});

test('materialById resolves found and misses to null', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  assert.strictEqual(mr.materialById('mat-2'), MATERIALS[1]);
  assert.strictEqual(mr.materialById('ghost'), null);
  assert.strictEqual(mr.materialById(undefined), null);
});

test('optionMaterialIds keeps the curated order and filters invalid ids', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  assert.deepStrictEqual(mr.optionMaterialIds({ optionIds: ['mat-3', 'mat-1'] }), ['mat-3', 'mat-1']);
  assert.deepStrictEqual(
    mr.optionMaterialIds({ optionIds: ['mat-1', 'ghost-x', 'mat-2'] }),
    ['mat-1', 'mat-2'],
    'invalid option ids are filtered out'
  );
});

test('optionMaterialIds falls back to every material when no curated ids resolve', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  assert.deepStrictEqual(mr.optionMaterialIds({}), ['mat-1', 'mat-2', 'mat-3'], 'no optionIds');
  assert.deepStrictEqual(mr.optionMaterialIds({ optionIds: ['ghost-1', 'ghost-2'] }), ['mat-1', 'mat-2', 'mat-3'], 'all-invalid optionIds');
});

test('defaultChoices uses the project default when it is still offered', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  mr.setProjectDefaultMaterial('FRENTES', 'mat-2');
  const def = { materialRoles: [{ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2'] }] };
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), { FRENTES: 'mat-2' });
});

test('defaultChoices falls back to the first candidate without a project default', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const def = { materialRoles: [{ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-2', 'mat-1'] }] };
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), { FRENTES: 'mat-2' }, 'first curated candidate wins');
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(null)), {}, 'null definition yields no choices');
});

test('a project default that is no longer offered is ignored', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  mr.setProjectDefaultMaterial('FRENTES', 'mat-3');
  const def = { materialRoles: [{ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2'] }] };
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), { FRENTES: 'mat-1' });
});

test('project defaults survive a catalog refresh', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  mr.setProjectDefaultMaterial('FRENTES', 'mat-2');
  mr.setCatalog({ materials: MATERIALS.slice(), categories: MATERIAL_CATEGORIES });
  const def = { materialRoles: [{ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2'] }] };
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), { FRENTES: 'mat-2' }, 'refresh must not reset project defaults');
});

test('a role without candidates is omitted from defaultChoices and hides the card', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: [], categories: [] });
  const def = { materialRoles: [{ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1'] }] };
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), {}, 'empty catalog → no candidates → no choice');

  const card = createMockElement('some-card');
  const container = createMockElement('some-container');
  mr.renderMaterialSelectors(card, container, def, {}, () => {});
  assert.strictEqual(card.style.display, 'none', 'card hides when no role has candidates');
  assert.deepStrictEqual(container.children, []);
});

test('role rendering shows the card, one block per role, with title and aria', () => {
  const { mr, iconCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const card = createMockElement('some-card');
  const container = createMockElement('some-container');
  const def = {
    furnitureDefinitionId: 'def-1',
    materialRoles: [
      { role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2'] },
      { role: 'BODY', label: 'Cuerpo', optionIds: ['mat-1'] }
    ]
  };
  const choices = {};
  mr.renderMaterialSelectors(card, container, def, choices, () => {});
  assert.strictEqual(card.style.display, 'block');
  assert.strictEqual(container.children.length, 2);
  const firstBlock = container.children[0];
  assert.strictEqual(firstBlock.className, 'material-role-block');
  assert.strictEqual(firstBlock.children[0].children[0].textContent, 'Frentes');
  const preview = firstBlock.children[1];
  assert.strictEqual(preview.getAttribute('role'), 'button');
  assert.strictEqual(preview.getAttribute('tabindex'), '0');
  assert.strictEqual(preview.getAttribute('aria-label'), 'Cambiar material del rol Frentes');
  assert.strictEqual(preview.title, 'Clic para abrir el selector de acabados');
  assert.ok(iconCalls.some(([name]) => name === 'chevron-right'), 'chevron rendered through the injected icon');
  // The renderer seeds the choice with the first candidate in the caller's
  // snapshot object (same object, mutated in place).
  assert.deepStrictEqual(choices, { FRENTES: 'mat-1', BODY: 'mat-1' });
});

test('current swatch renders through GraneteUI.media signed resolution', () => {
  const { mr, mediaCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { swatch } = renderRole(mr, { choices: { FRENTES: 'mat-2' } });
  assert.ok(mediaCalls.filenameFromPath.includes('tex/roble.png'), 'filenameFromPath consulted');
  assert.ok(mediaCalls.resolveUrl.includes('tex/roble.png'), 'resolveUrl consulted');
  assert.strictEqual(swatch.getAttribute('data-media-name'), 'roble.png', 'tagged for grant re-mint repaint');
  assert.strictEqual(swatch.style.backgroundImage, "url('signed://tex/roble.png')");
});

test('swatch without a signed url falls back to the preview color', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { swatch } = renderRole(mr, { choices: { FRENTES: 'mat-1' } });
  assert.strictEqual(swatch.style.backgroundImage, 'none');
  assert.strictEqual(swatch.style.backgroundColor, '#f5f5f5');
  assert.strictEqual(swatch.getAttribute('data-media-name'), null);
});

test('meta text carries code, thickness, grain and manufacturer', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { info } = renderRole(mr, { choices: { FRENTES: 'mat-2' } });
  const metaSpan = info.children[1];
  assert.strictEqual(metaSpan.textContent, 'ROB-02 · 19 mm · Veta · Egger');
  const nameSpan = info.children[0];
  assert.strictEqual(nameSpan.textContent, 'Roble Natural');
});

test('Ruby-native selector is the PRIMARY path with the full payload', () => {
  const { mr, rubyCalls, selectorCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { choices, preview, onChangeCalls } = renderRole(mr, {});
  preview.click();
  assert.strictEqual(rubyCalls.length, 1, 'Ruby selector called');
  assert.strictEqual(selectorCalls.length, 0, 'finish selector NOT called while Ruby path exists');
  const payload = rubyCalls[0];
  assert.strictEqual(payload.role, 'FRENTES');
  assert.strictEqual(payload.roleName, 'Frentes');
  assert.strictEqual(payload.currentMaterialId, 'mat-1');
  assert.strictEqual(payload.context, 'configurator');
  assert.strictEqual(payload.instanceId, null);
  assert.strictEqual(payload.definitionId, 'def-1');
  assert.deepStrictEqual(payload.allowedMaterialIds, ['mat-1', 'mat-2', 'mat-3']);
  assert.strictEqual(choices.FRENTES, 'mat-1', 'Ruby path does not apply a choice');
  assert.deepStrictEqual(onChangeCalls, [], 'no onChange without an applied choice');
});

test('finish selector is the fallback when the Ruby selector is absent', () => {
  const { mr, selectorCalls, rubyCalls } = runModule({ omitSketchup: true });
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { preview, onChangeCalls } = renderRole(mr, { choices: { FRENTES: 'mat-2' } });
  preview.click();
  assert.strictEqual(rubyCalls.length, 0);
  assert.strictEqual(selectorCalls.length, 1);
  assert.strictEqual(selectorCalls[0].roleEntry.role, 'FRENTES');
  assert.strictEqual(selectorCalls[0].selectedId, 'mat-2');
  assert.strictEqual(selectorCalls[0].contextKind, 'configurator');
  // Apply inside the modal: the callback updates the caller's snapshot,
  // repaints the swatch and reports role/id/scope to onChange.
  selectorCalls[0].onApply('mat-3', 'project');
  assert.deepStrictEqual(onChangeCalls, [{ role: 'FRENTES', id: 'mat-3', scope: 'project' }]);
});

test('Enter/Space on the preview row opens the picker', () => {
  const { mr, rubyCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { preview } = renderRole(mr, {});
  preview.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
  preview.dispatchEvent({ type: 'keydown', key: ' ', preventDefault: () => {} });
  assert.strictEqual(rubyCalls.length, 2);
});

test('context payload defaults to configurator (no Inspector identity match)', () => {
  const { mr, rubyCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { preview } = renderRole(mr, {});
  preview.click();
  assert.strictEqual(rubyCalls[0].context, 'configurator');
  assert.strictEqual(rubyCalls[0].instanceId, null);
  assert.strictEqual(rubyCalls[0].definitionId, 'def-1');
});

test('context payload resolves inspector through the injected accessors (card identity)', () => {
  const { mr, inspectorCard, selectedContext, rubyCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const container = createMockElement('some-container');
  mr.renderMaterialSelectors(inspectorCard, container, { furnitureDefinitionId: 'def-2', materialRoles: [{ role: 'BODY', label: 'Cuerpo', optionIds: ['mat-1'] }] }, {}, () => {});
  assert.strictEqual(container.children.length, 1, 'sanity: inspector card renders');
  container.children[0].children[1].click();
  const rendered = rubyCalls[rubyCalls.length - 1];
  assert.strictEqual(rendered.context, 'inspector');
  assert.strictEqual(rendered.instanceId, selectedContext.furnitureInstanceRef);
  assert.strictEqual(rendered.definitionId, 'def-2');
});

test('context payload resolves inspector through def identity too', () => {
  const { mr, inspectorDef, rubyCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const card = createMockElement('some-card');
  const container = createMockElement('some-container');
  mr.renderMaterialSelectors(card, container, inspectorDef, {}, () => {});
  container.children[0].children[1].click();
  assert.strictEqual(rubyCalls[0].context, 'inspector');
  assert.strictEqual(rubyCalls[0].instanceId, 'ref-9');
});

test('explicit contextInfo wins over the fallback heuristic', () => {
  const { mr, rubyCalls } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  const { preview } = renderRole(mr, { contextInfo: { context: 'inspector', instanceId: 'inst-77', definitionId: 'def-9' } });
  preview.click();
  assert.deepStrictEqual(
    { context: rubyCalls[0].context, instanceId: rubyCalls[0].instanceId, definitionId: rubyCalls[0].definitionId },
    { context: 'inspector', instanceId: 'inst-77', definitionId: 'def-9' }
  );
});

test('setProjectDefaultMaterial is the single write path for project defaults', () => {
  const { mr } = runModule();
  mr.setCatalog({ materials: MATERIALS, categories: [] });
  mr.setProjectDefaultMaterial('BODY', 'mat-2');
  const def = { materialRoles: [{ role: 'BODY', label: 'Cuerpo', optionIds: ['mat-1', 'mat-2'] }] };
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), { BODY: 'mat-2' });
  // Overwriting the same role replaces the default (plain object write).
  mr.setProjectDefaultMaterial('BODY', 'mat-1');
  assert.deepStrictEqual(plain(mr.defaultMaterialChoices(def)), { BODY: 'mat-1' });
});

test('renderMaterialSelectors fail-fasts without init (deps never injected)', () => {
  const { mr } = runModule({ skipInit: true });
  assert.throws(
    () => mr.renderMaterialSelectors(createMockElement('c'), createMockElement('k'), { materialRoles: [] }, {}, () => {}),
    (err) => /GraneteUI\.materialRoles\.init is required/.test(err.message) &&
      /icon/.test(err.message) && /getInspectorMaterialsCard/.test(err.message) &&
      /getInspectorDef/.test(err.message) && /getSelectedContext/.test(err.message)
  );
});

// ---------------------------------------------------------------------------
// Part B — integrated: the real GraneteDialog orchestrator + GraneteState
// ---------------------------------------------------------------------------

const DEFINITION = {
  furniture_definition_id: 'mod-test',
  name: 'Mueble de Prueba',
  code: 'MOD-T',
  parameters: [],
  materialRoles: [{ role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2'] }]
};

function buildDialogSandbox() {
  const registry = {};
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag),
    querySelector: () => createMockElement('q', 'BUTTON'),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: documentMock,
    window: {
      addEventListener: () => {},
      sketchup: { dialog_ready: () => {}, get_catalog: () => {}, update_furniture: () => {} }
    }
  };
  sandbox.__registry = registry;
  return sandbox;
}

function runIntegratedDialog() {
  const sandbox = buildDialogSandbox();
  vm.createContext(sandbox);
  runDialogScripts(sandbox);
  // #498 shared runtime loads after the inline script in the real dialog.
  const stateSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-state.js'), 'utf8');
  vm.runInContext(stateSource, sandbox, { filename: 'granete-state.js' });
  return sandbox;
}

test('orchestrator: object payload populates the materialRoles authority', () => {
  const sandbox = runIntegratedDialog();
  sandbox.window.GraneteDialog.setCatalog({
    source: 'remote',
    definitions: [DEFINITION],
    materialCategories: [{ id: 'cat-1', name: 'Tableros' }],
    materials: MATERIALS,
    hardware: [{ hardwareId: 'hw-1' }],
    presets: []
  });
  const mr = sandbox.window.GraneteUI.materialRoles;
  assert.deepStrictEqual(mr.getMaterials().map((m) => m.materialId), ['mat-1', 'mat-2', 'mat-3']);
  assert.deepStrictEqual(mr.getMaterialCategories(), [{ id: 'cat-1', name: 'Tableros' }]);
});

test('orchestrator: array payload resets the material slice', () => {
  const sandbox = runIntegratedDialog();
  sandbox.window.GraneteDialog.setCatalog({
    definitions: [DEFINITION], materialCategories: [], materials: MATERIALS, hardware: []
  });
  sandbox.window.GraneteDialog.setCatalog([]);
  const mr = sandbox.window.GraneteUI.materialRoles;
  assert.deepStrictEqual(plain(mr.getMaterials()), [], 'array payload resets materials');
  assert.deepStrictEqual(plain(mr.getMaterialCategories()), [], 'array payload resets material categories');
});

test('GraneteState catalog projection reads the materialRoles live arrays (single authority)', () => {
  const sandbox = runIntegratedDialog();
  sandbox.window.GraneteDialog.setCatalog({
    definitions: [DEFINITION], materialCategories: [{ id: 'cat-1', name: 'Tableros' }],
    materials: MATERIALS, hardware: [{ hardwareId: 'hw-1' }]
  });
  const projection = sandbox.window.GraneteState.get('catalog');
  const mr = sandbox.window.GraneteUI.materialRoles;
  assert.strictEqual(projection.materials, mr.getMaterials(), 'no second copy: identity, not a clone');
  assert.deepStrictEqual(projection.materials.map((m) => m.materialId), ['mat-1', 'mat-2', 'mat-3']);
  assert.deepStrictEqual(projection.hardware, [{ hardwareId: 'hw-1' }], 'hardware stays orchestrator-owned');
});

test('orchestrator: a project-scope finish choice survives the next catalog refresh', () => {
  const sandbox = runIntegratedDialog();
  const dialog = sandbox.window.GraneteDialog;
  const mr = sandbox.window.GraneteUI.materialRoles;
  dialog.setCatalog({
    definitions: [DEFINITION], materialCategories: [], materials: MATERIALS, hardware: []
  });
  dialog.onMaterialChoiceApplied({ role: 'FRENTES', materialId: 'mat-2', scope: 'project' });
  dialog.setCatalog({
    definitions: [DEFINITION], materialCategories: [], materials: MATERIALS, hardware: []
  });
  assert.deepStrictEqual(
    plain(mr.defaultMaterialChoices(DEFINITION)),
    { FRENTES: 'mat-2' },
    'project default written through onMaterialChoiceApplied survives the refresh'
  );
});

test('inspector materials render through the materialRoles module', () => {
  const sandbox = runIntegratedDialog();
  const dialog = sandbox.window.GraneteDialog;
  dialog.setCatalog({
    definitions: [DEFINITION], materialCategories: [], materials: MATERIALS, hardware: []
  });
  dialog.onSelectionChange({
    kind: 'furniture',
    furnitureInstanceRef: 'ref-1',
    furnitureDefinitionId: 'mod-test',
    representation: 'native',
    ownerRecovery: 'none',
    semanticPath: ['Mueble de Prueba'],
    display: { name: 'Mueble de Prueba' },
    definition: DEFINITION,
    parameters: {},
    materialChoices: {},
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: true, reason: null }
    }
  });
  const container = sandbox.__registry['inspector-materials-container'];
  assert.strictEqual(container.children.length, 1, 'one rendered role block');
  assert.strictEqual(container.children[0].className, 'material-role-block', 'rendered by materialRoles.renderSelectors');
  assert.strictEqual(sandbox.__registry['inspector-materials-card'].style.display, 'block');
});

console.log(JSON.stringify({ success: true, testsPassed, module: 'granete-material-roles.js' }));
