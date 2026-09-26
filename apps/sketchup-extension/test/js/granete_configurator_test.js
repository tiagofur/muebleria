// #848 Phase B C4.4 — real JavaScript harness for granete-configurator.js:
// the configurator module under window.GraneteUI. Drives the actual module
// file in a vm sandbox (mock DOM + recording GraneteUI.media/library mocks
// and sketchup bridge, injected shared-helper doubles) and proves the
// ownership contract: active definition configuration (params, material
// choices snapshot, presets), the browser↔configurator transition, the
// preview/summary dock, registered measures and the whole catalog placement
// intent (#469 preview payload + repeat + legacy fallbacks + idempotency).
// Shared helpers are INJECTED — the module must never duplicate them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-configurator.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

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
    onchange: null,
    onclick: null,
    onerror: null,
    alt: '',
    src: '',
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
    querySelectorAll: (selector) => {
      // Shallow class query over direct children (preset chips).
      const cls = selector.replace(/^\./, '');
      return children.filter((c) => c.classList && c.classList.contains(cls));
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

function definition(overrides) {
  return Object.assign({
    furniture_definition_id: 'def-x',
    name: 'Mueble X',
    parameters: [
      { name: 'widthMm', label: 'Ancho (mm)', type: 'number', unit: 'mm', defaultValue: 800 },
      { name: 'heightMm', label: 'Alto (mm)', type: 'number', unit: 'mm', defaultValue: 720 }
    ]
  }, overrides);
}

// Fresh sandbox per test: mock DOM registry, recording GraneteUI.media /
// GraneteUI.library mocks (the real modules own those domains), the
// sketchup bridge and shared-helper doubles that record every call. The
// param/material onChange handles are captured so tests can drive edits.
function runModule(overrides) {
  const registry = {};
  const calls = {
    bridge: [],
    media: { filenameFromPath: [], resolveUrl: [], requestRefresh: [] },
    toasts: [],
    getDefaultParams: [],
    renderParamForm: [],
    defaultMaterialChoices: [],
    renderMaterialSelectors: [],
    estimatedPartsLabel: [],
    parameterIssueMessage: [],
    materialById: [],
    setProjectDefaultMaterial: [],
    switchTab: [],
    requestProjectFurniture: [],
    libraryRender: 0,
    formatCategoryLabel: [],
    insertionResults: []
  };
  const timeouts = [];
  let uuid = 0;

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag)
  };

  const state = { connected: false, mediaUrls: {}, catalog: [], failBegin: false };

  const deps = {
    icon: (name) => '<svg-' + name + '>',
    showToast: (type, message) => calls.toasts.push({ type, message }),
    createFurniturePlaceholderSvg: () => 'PLACEHOLDER-SVG',
    getDefaultParams: (def) => {
      calls.getDefaultParams.push(def);
      const p = {};
      ((def && def.parameters) || []).forEach((param) => { p[param.name] = param.defaultValue; });
      return p;
    },
    renderParamForm: (container, def, values, onChange) => {
      calls.renderParamForm.push({ container, def, values: Object.assign({}, values) });
      registry.__paramOnChange = onChange;
    },
    defaultMaterialChoices: (def) => {
      calls.defaultMaterialChoices.push(def);
      return { INTERIOR: 'mat-a', FRENTES: 'mat-b' };
    },
    renderMaterialSelectors: (card, container, def, choices, onChange, ctx) => {
      calls.renderMaterialSelectors.push({
        card, container, def,
        choices: Object.assign({}, choices),
        ctx: Object.assign({}, ctx)
      });
      registry.__materialOnChange = onChange;
    },
    estimatedPartsLabel: (def, values) => {
      calls.estimatedPartsLabel.push({ def, values: Object.assign({}, values) });
      return 'Aprox. 5 piezas';
    },
    parameterIssueMessage: (result, fallback) => {
      calls.parameterIssueMessage.push({ result, fallback });
      return 'ISSUE: ' + fallback;
    },
    materialById: (id) => {
      calls.materialById.push(id);
      return { materialId: id, name: 'Material ' + id };
    },
    isModelConnected: () => state.connected,
    setProjectDefaultMaterial: (role, id) => calls.setProjectDefaultMaterial.push({ role, id }),
    switchTab: (tab) => calls.switchTab.push(tab),
    requestProjectFurniture: () => calls.requestProjectFurniture.push('reload'),
    pfPlaceFailureMessage: (result) => (result && result.reason) || 'fallo de colocación'
  };

  const sandbox = {
    document: documentMock,
    setTimeout: (fn) => timeouts.push(fn),
    window: {
      crypto: { randomUUID: () => 'uuid-' + (++uuid) },
      sketchup: {
        begin_catalog_placement_preview: (payload) => {
          if (state.failBegin) { state.failBegin = false; throw new Error('bridge refused'); }
          calls.bridge.push({ fn: 'begin_catalog_placement_preview', payload: JSON.parse(payload) });
        },
        create_project_furniture: (payload) => calls.bridge.push({ fn: 'create_project_furniture', payload: JSON.parse(payload) }),
        insert_furniture: (payload) => calls.bridge.push({ fn: 'insert_furniture', payload: JSON.parse(payload) })
      },
      GraneteDialog: {
        onInsertionResult: (result) => calls.insertionResults.push(result)
      },
      GraneteUI: {
        media: {
          filenameFromPath: (p) => {
            calls.media.filenameFromPath.push(p);
            return typeof p === 'string' && p ? p.split('/').pop() : '';
          },
          resolveUrl: (p) => {
            calls.media.resolveUrl.push(p);
            const name = typeof p === 'string' && p ? p.split('/').pop() : '';
            return state.mediaUrls[name];
          },
          requestRefresh: (f) => calls.media.requestRefresh.push(f)
        },
        library: {
          render: () => { calls.libraryRender += 1; },
          formatCategoryLabel: (catKey) => {
            calls.formatCategoryLabel.push(catKey);
            return 'Cat:' + catKey;
          },
          findDefinitionById: (id) => state.catalog.find((d) => d.furniture_definition_id === id) || null
        }
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__calls = calls;
  sandbox.__timeouts = timeouts;
  sandbox.__state = state;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });

  sandbox.window.GraneteUI.configurator.init(Object.assign({}, deps, overrides));
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const PREVIEW_HOST = 'library-selected-preview';

test('registers window.GraneteUI.configurator with the expected public API', () => {
  const { window } = runModule();
  const configurator = window.GraneteUI.configurator;
  assert(configurator, 'window.GraneteUI.configurator must exist');
  ['init', 'open', 'close', 'getActiveDefinitionId', 'hasActiveDefinition', 'setPresets',
    'refreshAfterCatalog', 'updateInsertButton', 'rearmInsertButton', 'isRepeatPreviewActive',
    'cancelRepeatPreview', 'getIntentKey', 'onInsertionResult', 'onCreateProjectFurnitureResult',
    'applyMaterialChoice']
    .forEach((key) => assert.strictEqual(typeof configurator[key], 'function', key));
});

test('re-execution is idempotent — one registration, same authority', () => {
  const sandbox = runModule();
  const first = sandbox.window.GraneteUI.configurator;
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert.strictEqual(sandbox.window.GraneteUI.configurator, first,
    'dialog reopen safety: the module never registers a second authority');
});

test('init fails fast when a shared helper is missing — no silent duplication', () => {
  const sandbox = { document: { getElementById: () => createMockElement(), createElement: () => createMockElement() }, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert.throws(() => sandbox.window.GraneteUI.configurator.init({ icon: () => '' }),
    /missing deps/);
});

test('open(def) switches the pane and renders identity, badge and description', () => {
  const sandbox = runModule();
  const def = definition({ code: 'BASE-60', category: 'kitchen_base', description: 'Módulo base' });
  sandbox.window.GraneteUI.configurator.open(def);
  assert.strictEqual(el(sandbox, 'library-browser-view').style.display, 'none');
  assert.strictEqual(el(sandbox, 'library-configurator-view').style.display, 'block');
  assert.strictEqual(el(sandbox, 'library-selected-name').textContent, 'Mueble X');
  assert.strictEqual(el(sandbox, 'library-selected-code').textContent, 'BASE-60');
  assert.strictEqual(el(sandbox, 'library-selected-category-badge').textContent, 'Cat:kitchen_base',
    'the category label comes from the Library authority API');
  assert.strictEqual(el(sandbox, 'library-furniture-desc').textContent, 'Módulo base');
  assert.deepStrictEqual(sandbox.__calls.formatCategoryLabel, ['kitchen_base']);
});

test('active definition identity: getActiveDefinitionId / hasActiveDefinition', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  assert.strictEqual(configurator.getActiveDefinitionId(), null);
  assert.strictEqual(configurator.hasActiveDefinition(), false);
  configurator.open(definition());
  assert.strictEqual(configurator.getActiveDefinitionId(), 'def-x');
  assert.strictEqual(configurator.hasActiveDefinition(), true);
  // Distinct semantics preserved: a definition object without id keeps
  // hasActiveDefinition true while getActiveDefinitionId is falsy
  // (undefined, exactly like the original inline accessor).
  configurator.open(definition({ furniture_definition_id: undefined }));
  assert.ok(!configurator.getActiveDefinitionId());
  assert.strictEqual(configurator.hasActiveDefinition(), true);
});

test('open resets params to the definition defaults through the injected helper', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.configurator.open(definition());
  assert.strictEqual(sandbox.__calls.getDefaultParams.length, 1);
  const form = sandbox.__calls.renderParamForm[sandbox.__calls.renderParamForm.length - 1];
  assert.strictEqual(form.container.id, 'library-params-container');
  assert.deepStrictEqual(form.values, { widthMm: 800, heightMm: 720 });
});

test('open resets the material choices snapshot (context derived by the shared renderer)', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.configurator.open(definition());
  assert.strictEqual(sandbox.__calls.defaultMaterialChoices.length, 1);
  const render = sandbox.__calls.renderMaterialSelectors[sandbox.__calls.renderMaterialSelectors.length - 1];
  assert.strictEqual(render.card.id, 'library-materials-card');
  assert.deepStrictEqual(render.choices, { INTERIOR: 'mat-a', FRENTES: 'mat-b' });
  // Preserved shape: the open path passes NO contextInfo — the shared
  // renderer derives "configurator" from the card (original behavior).
  assert.strictEqual(render.ctx.context, undefined);
});

test('preview renders the media-backed image with its grant name', () => {
  const sandbox = runModule();
  sandbox.__state.mediaUrls['preview.png'] = 'https://cdn.test/grant?exp=1';
  sandbox.window.GraneteUI.configurator.open(definition({ imageUrl: 'https://cdn.test/previews/preview.png' }));
  const host = el(sandbox, PREVIEW_HOST);
  assert.strictEqual(host.children.length, 1);
  const img = host.children[0];
  assert.strictEqual(img.tagName.toLowerCase(), 'img');
  assert.strictEqual(img.getAttribute('data-media-name'), 'preview.png');
  assert.strictEqual(img.src, 'https://cdn.test/grant?exp=1');
});

test('preview image failure falls back to the isometric placeholder and asks for a re-mint', () => {
  const sandbox = runModule();
  sandbox.__state.mediaUrls['preview.png'] = 'https://cdn.test/grant?exp=1';
  sandbox.window.GraneteUI.configurator.open(definition({ imageUrl: 'x/preview.png' }));
  const img = el(sandbox, PREVIEW_HOST).children[0];
  img.onerror();
  assert.strictEqual(el(sandbox, PREVIEW_HOST).innerHTML, 'PLACEHOLDER-SVG');
  assert.deepStrictEqual(sandbox.__calls.media.requestRefresh, ['preview.png']);
});

test('preview without any URL renders the placeholder fallback', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.configurator.open(definition({}));
  assert.strictEqual(el(sandbox, PREVIEW_HOST).innerHTML, 'PLACEHOLDER-SVG');
  assert.deepStrictEqual(sandbox.__calls.media.requestRefresh, [],
    'no media name → no refresh request');
});

test('a parameter edit updates the state, the summary and clears the intent key', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click(); // mints an intent key
  const keyBefore = configurator.getIntentKey();
  assert.ok(keyBefore);
  sandbox.__registry.__paramOnChange('widthMm', 900, 'mm');
  assert.strictEqual(el(sandbox, 'library-summary-dims').textContent, '900 × 720 × 590 mm');
  assert.strictEqual(configurator.getIntentKey(), null, 'editing invalidates the intent');
  const parts = sandbox.__calls.estimatedPartsLabel[sandbox.__calls.estimatedPartsLabel.length - 1];
  assert.strictEqual(parts.values.widthMm, 900, 'the parts label consumes the CURRENT values');
});

test('summary dims follow the widthMm || lengthMm chain with honest fallbacks', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition({ parameters: [{ name: 'lengthMm', type: 'number', unit: 'mm', defaultValue: 1200 }] }));
  assert.strictEqual(el(sandbox, 'library-summary-dims').textContent, '1200 × 720 × 590 mm');
  configurator.open(definition({ parameters: [] }));
  assert.strictEqual(el(sandbox, 'library-summary-dims').textContent, '600 × 720 × 590 mm');
});

test('a project-scoped material choice updates the snapshot and the project default', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  sandbox.__registry.__materialOnChange('FRENTES', 'mat-z', 'project');
  const render = sandbox.__calls.renderMaterialSelectors[sandbox.__calls.renderMaterialSelectors.length - 1];
  // The onChange writes through the choices object the renderer owns.
  assert.deepStrictEqual(sandbox.__calls.setProjectDefaultMaterial, [{ role: 'FRENTES', id: 'mat-z' }]);
  assert.strictEqual(configurator.getIntentKey(), null, 'a material change invalidates the intent');
  assert.ok(render);
});

test('registered measures show the recorded values and restore them on click', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  const def = definition({ parameters: [
    { name: 'widthMm', type: 'number', unit: 'mm', defaultValue: 600 },
    { name: 'heightMm', type: 'number', unit: 'mm', defaultValue: 2000 }
  ] });
  configurator.open(def);
  sandbox.__registry.__paramOnChange('widthMm', 900, 'mm');
  sandbox.__registry.__paramOnChange('heightMm', 1600, 'mm');
  const button = el(sandbox, 'btn-registered-measures');
  assert.strictEqual(button.style.display, 'flex');
  assert.ok(button.innerHTML.includes('Medidas registradas: 600 mm × 2000 mm'));
  button.onclick();
  const form = sandbox.__calls.renderParamForm[sandbox.__calls.renderParamForm.length - 1];
  assert.deepStrictEqual(form.values, { widthMm: 600, heightMm: 2000 },
    'the registered defaults replace the edited values');
  assert.strictEqual(el(sandbox, 'library-summary-dims').textContent, '600 × 2000 × 590 mm');
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'success');
  assert.ok(toast.message.includes('Medidas del registro aplicadas'));
});

test('definitions without registered mm measures hide the button', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.configurator.open(definition({ parameters: [
    { name: 'shelfCount', type: 'number', unit: 'count', defaultValue: 3 }
  ] }));
  const button = el(sandbox, 'btn-registered-measures');
  assert.strictEqual(button.style.display, 'none');
  assert.strictEqual(button.onclick, null);
});

test('presets are filtered per definition and hidden when none match', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.setPresets([
    { furnitureDefinitionId: 'def-x', name: 'Estándar', parameters: { widthMm: 900 } },
    { furnitureDefinitionId: 'def-other', name: 'Ajeno', parameters: {} }
  ]);
  configurator.open(definition());
  const container = el(sandbox, 'library-presets-container');
  assert.strictEqual(el(sandbox, 'library-presets-card').style.display, 'block');
  assert.strictEqual(container.children.length, 1);
  assert.strictEqual(container.children[0].textContent, 'Estándar');

  configurator.open(definition({ furniture_definition_id: 'def-third' }));
  assert.strictEqual(el(sandbox, 'library-presets-card').style.display, 'none');
  assert.strictEqual(el(sandbox, 'library-presets-container').children.length, 0);
});

test('applying a preset merges defaults + preset params and marks the chip active', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.setPresets([
    { furnitureDefinitionId: 'def-x', name: 'Estándar', parameters: { widthMm: 900 } }
  ]);
  configurator.open(definition());
  const chip = el(sandbox, 'library-presets-container').children[0];
  chip.click();
  const form = sandbox.__calls.renderParamForm[sandbox.__calls.renderParamForm.length - 1];
  assert.deepStrictEqual(form.values, { widthMm: 900, heightMm: 720 },
    'preset parameters ride on top of the definition defaults');
  assert(chip.classList.contains('active'));
  assert.strictEqual(el(sandbox, 'library-summary-dims').textContent, '900 × 720 × 590 mm');
});

test('insert label follows the model connection through the injected accessor', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  const button = el(sandbox, 'btn-insert');
  assert.ok(button.innerHTML.includes('Insertar en Modelo'));
  assert.strictEqual(button.title, 'Inserta el mueble localmente en el modelo');
  sandbox.__state.connected = true;
  configurator.updateInsertButton();
  assert.ok(button.innerHTML.includes('Agregar al diseño'));
  assert.strictEqual(button.title, 'Crea un nuevo mueble en el proyecto y lo agrega a este diseño');
});

test('insert click sends the catalog placement payload with a fresh idempotency key', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  sandbox.__registry.__paramOnChange('widthMm', 900, 'mm');
  const button = el(sandbox, 'btn-insert');
  button.click();
  assert.strictEqual(sandbox.__calls.bridge.length, 1);
  const call = sandbox.__calls.bridge[0];
  assert.strictEqual(call.fn, 'begin_catalog_placement_preview');
  assert.deepStrictEqual(call.payload, {
    definitionId: 'def-x',
    parameters: { widthMm: 900, heightMm: 720 },
    materialChoices: { INTERIOR: 'mat-a', FRENTES: 'mat-b' },
    idempotencyKey: 'uuid-1'
  });
  assert.strictEqual(button.disabled, true);
  assert.ok(button.innerHTML.includes('Vista previa en el modelo'));
  assert.strictEqual(configurator.getIntentKey(), 'uuid-1');
});

test('retry within one gesture keeps the key; an invalidated gesture mints a fresh one', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  const button = el(sandbox, 'btn-insert');
  button.click();
  assert.strictEqual(configurator.getIntentKey(), 'uuid-1');
  // Cancel → re-arm → click again is a RETRY of the same gesture: the
  // configuration never changed, so the identity is stable.
  configurator.rearmInsertButton();
  button.click();
  assert.strictEqual(configurator.getIntentKey(), 'uuid-1');
  // An edit invalidates the intent: the next click is a new gesture.
  sandbox.__registry.__paramOnChange('widthMm', 900, 'mm');
  assert.strictEqual(configurator.getIntentKey(), null);
  button.click();
  assert.strictEqual(configurator.getIntentKey(), 'uuid-2');
});

test('a successful preview placement re-begins the SAME preset with a fresh key (#469 repeat)', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  const button = el(sandbox, 'btn-insert');
  button.click();
  sandbox.__calls.bridge.length = 0;
  configurator.onInsertionResult({ success: true, name: 'Mueble X', placed_via_preview: true, component_count: 4, hardware_count: 2 });
  assert.strictEqual(button.disabled, true, 'the entry point stays held while repeating');
  assert.strictEqual(sandbox.__calls.bridge.length, 1, 'repeat re-begins the preview');
  const repeat = sandbox.__calls.bridge[0];
  assert.strictEqual(repeat.fn, 'begin_catalog_placement_preview');
  assert.deepStrictEqual(repeat.payload, {
    definitionId: 'def-x',
    parameters: { widthMm: 800, heightMm: 720 },
    materialChoices: { INTERIOR: 'mat-a', FRENTES: 'mat-b' },
    idempotencyKey: 'uuid-2'
  }, 'same preset, FRESH idempotency identity');
  assert.strictEqual(configurator.getIntentKey(), 'uuid-2');
  assert.strictEqual(configurator.isRepeatPreviewActive(), true);
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.ok(toast.message.includes('4 componente') && toast.message.includes('2 herrajes'));
});

test('a successful legacy insert advertises the Move handoff instead of repeating', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  configurator.onInsertionResult({ success: true, name: 'Mueble X' });
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.ok(toast.message.includes('tecla M'));
  assert.strictEqual(configurator.isRepeatPreviewActive(), false);
  assert.strictEqual(el(sandbox, 'btn-insert').disabled, false);
});

test('a failed insert reports the shared parameter issue copy and kills the repeat', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  configurator.onInsertionResult({ success: false, issues: [{ code: 'PARAMETER_OUT_OF_RANGE' }] });
  assert.strictEqual(configurator.isRepeatPreviewActive(), false);
  assert.strictEqual(el(sandbox, 'btn-insert').disabled, false);
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'error');
  assert.strictEqual(toast.message, 'ISSUE: No se pudo insertar el mueble.');
  assert.strictEqual(sandbox.__calls.parameterIssueMessage.length, 1);
});

test('cancelRepeatPreview + rearmInsertButton restore the honest entry point', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  configurator.cancelRepeatPreview();
  configurator.rearmInsertButton();
  const button = el(sandbox, 'btn-insert');
  assert.strictEqual(button.disabled, false);
  assert.ok(button.innerHTML.includes('Insertar en Modelo'),
    'the label follows the (disconnected) model state again');
  assert.strictEqual(configurator.isRepeatPreviewActive(), false);
});

test('legacy connected fallback: create_project_furniture and its result flow', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  sandbox.__state.connected = true;
  delete sandbox.window.sketchup.begin_catalog_placement_preview;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  assert.strictEqual(sandbox.__calls.bridge.length, 1);
  assert.strictEqual(sandbox.__calls.bridge[0].fn, 'create_project_furniture');
  assert.strictEqual(sandbox.__calls.bridge[0].payload.idempotencyKey, 'uuid-1');
  assert.ok(el(sandbox, 'btn-insert').innerHTML.includes('Agregando al diseño'));

  // ok result of a PURE create gesture: no repeat payload was saved by the
  // create path (original behavior) → navigate to the Project tab.
  configurator.onCreateProjectFurnitureResult({ ok: true });
  assert.deepStrictEqual(sandbox.__calls.switchTab, ['project']);
  assert.deepStrictEqual(sandbox.__calls.requestProjectFurniture, ['reload']);

  // created_pending → honest warning + project tab
  configurator.onCreateProjectFurnitureResult({ ok: false, code: 'created_pending', instanceId: 'fi-1' });
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'warning');
  assert.ok(toast.message.includes('fi-1'));

  // hard failure → shared failure copy, repeat killed
  configurator.onCreateProjectFurnitureResult({ ok: false, code: 'unbound' });
  const error = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(error.type, 'error');
  assert.strictEqual(configurator.isRepeatPreviewActive(), false);
});

test('create result repeats only from a prior preview gesture payload', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  sandbox.__state.connected = true;
  configurator.open(definition());
  const button = el(sandbox, 'btn-insert');
  // Gesture 1: the preview path saves the repeat payload.
  button.click();
  assert.strictEqual(sandbox.__calls.bridge[0].fn, 'begin_catalog_placement_preview');
  // Degraded runtime mid-gesture: the preview callback disappears, the
  // re-armed retry keeps the SAME key and falls back to create.
  delete sandbox.window.sketchup.begin_catalog_placement_preview;
  configurator.rearmInsertButton();
  button.click();
  assert.strictEqual(sandbox.__calls.bridge[1].fn, 'create_project_furniture');
  assert.strictEqual(sandbox.__calls.bridge[1].payload.idempotencyKey, 'uuid-1',
    'same-gesture retry keeps the identity');
  // Host recovers the preview callback before the result lands: the ok
  // result re-begins the loop (fresh key) and never hijacks the tab.
  sandbox.window.sketchup.begin_catalog_placement_preview = (payload) => {
    sandbox.__calls.bridge.push({ fn: 'begin_catalog_placement_preview', payload: JSON.parse(payload) });
  };
  sandbox.__calls.switchTab.length = 0;
  configurator.onCreateProjectFurnitureResult({ ok: true });
  assert.strictEqual(sandbox.__calls.bridge.length, 3);
  assert.strictEqual(sandbox.__calls.bridge[2].fn, 'begin_catalog_placement_preview');
  assert.strictEqual(sandbox.__calls.bridge[2].payload.idempotencyKey, 'uuid-2');
  assert.deepStrictEqual(sandbox.__calls.switchTab, []);
  assert.deepStrictEqual(sandbox.__calls.requestProjectFurniture, ['reload']);
});

test('legacy local fallback: origin-first insert without idempotency key', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  delete sandbox.window.sketchup.begin_catalog_placement_preview;
  delete sandbox.window.sketchup.create_project_furniture;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  assert.strictEqual(sandbox.__calls.bridge.length, 1);
  assert.strictEqual(sandbox.__calls.bridge[0].fn, 'insert_furniture');
  assert.strictEqual(sandbox.__calls.bridge[0].payload.idempotencyKey, undefined,
    'the legacy local path never minted an identity');
  assert.strictEqual(configurator.getIntentKey(), null);
  assert.ok(el(sandbox, 'btn-insert').innerHTML.includes('Insertando…'));
});

test('no bridge at all: the demo timeout settles through GraneteDialog.onInsertionResult', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  delete sandbox.window.sketchup.begin_catalog_placement_preview;
  delete sandbox.window.sketchup.create_project_furniture;
  delete sandbox.window.sketchup.insert_furniture;
  configurator.open(definition());
  el(sandbox, 'btn-insert').click();
  assert.strictEqual(sandbox.__timeouts.length, 1);
  sandbox.__timeouts[0]();
  assert.strictEqual(sandbox.__calls.insertionResults.length, 1);
  assert.strictEqual(sandbox.__calls.insertionResults[0].success, true);
  assert.strictEqual(sandbox.__calls.insertionResults[0].name, 'Mueble X');
});

test('close() returns to the browser and clears the active definition', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  const renders = sandbox.__calls.libraryRender;
  configurator.close();
  assert.strictEqual(el(sandbox, 'library-browser-view').style.display, 'block');
  assert.strictEqual(el(sandbox, 'library-configurator-view').style.display, 'none');
  assert.strictEqual(sandbox.__calls.libraryRender, renders + 1, 'the browser re-renders');
  assert.strictEqual(configurator.hasActiveDefinition(), false);
  assert.strictEqual(configurator.getActiveDefinitionId(), null);
});

test('refreshAfterCatalog re-opens with the FRESH definition object when it still exists', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  const stale = definition({ description: 'vieja' });
  configurator.open(stale);
  const fresh = definition({ description: 'nueva' });
  sandbox.__state.catalog = [fresh];
  configurator.setPresets([]);
  configurator.refreshAfterCatalog();
  assert.strictEqual(el(sandbox, 'library-furniture-desc').textContent, 'nueva',
    'the configurator re-renders from the fresh catalog object, never a stale copy');
  assert.strictEqual(el(sandbox, 'library-configurator-view').style.display, 'block');
});

test('refreshAfterCatalog shows the browser when the definition disappeared — without resetting the active reference (preserved quirk)', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  sandbox.__state.catalog = [];
  configurator.refreshAfterCatalog();
  assert.strictEqual(el(sandbox, 'library-browser-view').style.display, 'block');
  assert.strictEqual(configurator.hasActiveDefinition(), true,
    'pre-existing behavior: a disappeared definition does NOT null the active reference');
});

test('applyMaterialChoice updates the snapshot through the injected renderer', () => {
  const sandbox = runModule();
  const configurator = sandbox.window.GraneteUI.configurator;
  configurator.open(definition());
  const renders = sandbox.__calls.renderMaterialSelectors.length;
  configurator.applyMaterialChoice('FRENTES', 'mat-z', false);
  assert.strictEqual(sandbox.__calls.renderMaterialSelectors.length, renders + 1);
  const render = sandbox.__calls.renderMaterialSelectors[renders];
  assert.strictEqual(render.ctx.context, 'configurator');
  assert.strictEqual(render.ctx.definitionId, 'def-x');
  assert.ok(sandbox.__calls.materialById.includes('mat-z'));
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.ok(toast.message.includes('Material mat-z'));
  assert.ok(toast.message.includes('Acabado seleccionado'));

  configurator.applyMaterialChoice('INTERIOR', 'mat-p', true);
  const projectToast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.ok(projectToast.message.includes('Acabado temporal de sesión'),
    'project scope keeps the session-scope copy');
});

test('structural: the module owns no material catalog or project furniture state', () => {
  ['var catalogMaterials', 'var catalogMaterialCategories', 'var catalogHardware',
    'var projectDefaultMaterials', 'var modelBindingState', 'pfPlacing',
    'renderLibraryBrowser', 'var catalog ='].forEach((symbol) => {
    assert.ok(!SOURCE.includes(symbol), 'configurator must not carry ' + symbol);
  });
  // Shared helpers enter by injection only — never a local implementation.
  ['function getDefaultParams', 'function renderParamForm', 'function defaultMaterialChoices',
    'function renderMaterialSelectors', 'function estimatedPartsLabel',
    'function parameterIssueMessage', 'function materialById'].forEach((symbol) => {
    assert.ok(!SOURCE.includes(symbol), 'shared helper must stay injected, not duplicated: ' + symbol);
  });
});

console.log(JSON.stringify({ success: true, testsPassed }));
