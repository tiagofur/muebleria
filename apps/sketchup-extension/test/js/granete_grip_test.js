// #1535 — real JavaScript harness for granete-grip.js: the project grip
// module under window.GraneteUI. Drives the actual module file in a vm
// sandbox (mock DOM + recording sketchup bridge) and proves the ownership
// contract: the plugin sends INTENT and paints the server answer; state is
// keyed by project so late answers never cross; the six card states of the
// acceptance (hereda, excepción, varios, bloqueado, sin conexión,
// desactualizado) render with workshop copy — no OPENING_/GRIP_ codes
// visible.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-grip.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function mockNode(id) {
  // innerHTML/textContent are INTERCONNECTED (the module's esc() relies on
  // the DOM semantics: textContent set → innerHTML escapes it).
  const node = {
    id,
    style: {},
    className: '',
    disabled: false,
    onclick: null,
    removed: false,
    children: [],
    attrs: {},
    __text: '',
    addEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      // The rows live inside the rendered innerHTML string; the sandbox DOM
      // is not a real parser — the harness asserts on the innerHTML content
      // instead of the selector picks.
      return [];
    },
    appendChild(child) { this.children.push(child); },
    remove() { this.removed = true; }
  };
  Object.defineProperties(node, {
    textContent: {
      get() { return node.__text; },
      set(v) { node.__text = v == null ? '' : String(v); }
    },
    innerHTML: {
      get() { return node.__html !== undefined ? node.__html : node.__text; },
      set(v) { node.__html = v == null ? '' : String(v); }
    }
  });
  return node;
}

function buildSandbox() {
  const registry = {};
  const toastCalls = [];
  const stateChanges = [];
  const bridgeCalls = [];
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || mockNode(id)),
    createElement: (tag) => mockNode(tag),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const sandbox = {
    window: {},
    document: documentMock,
    JSON,
    isFinite,
    Number,
    String,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    console
  };
  sandbox.window.GraneteUI = {};
  sandbox.sketchup = new Proxy({}, {
    get(_target, action) {
      return (payloadJson) => {
        bridgeCalls.push({ action, payload: JSON.parse(payloadJson) });
      };
    }
  });
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-grip.js' });
  const grip = sandbox.window.GraneteUI.grip;
  grip.init({
    sketchup: sandbox.sketchup,
    showToast: (kind, text) => toastCalls.push({ kind, text }),
    onStateChange: () => stateChanges.push(1)
  });
  return { sandbox, grip, registry, toastCalls, stateChanges, bridgeCalls };
}

// Feeds the bridge answer through the module's callback (the dialog dispatch
// would call the same function).
function answer(grip, name, payload) {
  grip[name](payload);
}

// The GET answers must echo the requestId the module issued (the bridge
// contract): the helper takes it from the recorded ensureLoaded call.
function answerGet(grip, bridgeCalls, payload) {
  var rid = bridgeCalls.length > 0 ? bridgeCalls[0].payload.requestId : null;
  payload.requestId = rid;
  grip.onProjectGrip(Object.assign({ projectId: PROJECT }, payload));
}

const STYLE_ID = '11111111-1111-4111-8111-111111111111';
const STYLE_OTHER = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const PROJECT_B = '44444444-4444-4444-8444-444444444444';
const INSTANCE = '55555555-5555-4555-8555-555555555555';
const INSTANCE_B = '66666666-6666-4666-8666-666666666666';

function okGrip(styleId, overrides, items) {
  return {
    projectId: PROJECT,
    gripVersion: 7,
    gripStyleId: styleId,
    snapshot: { styleId: styleId, styleName: styleId ? 'Gola negra' : '', recipes: {} },
    overrides: (overrides || []).map(function (o) {
      return { furnitureInstanceId: o.id, snapshot: { styleId: o.styleId, styleName: o.name } };
    }),
    report: { items: items || [] }
  };
}

function stylesList() {
  return [
    { id: STYLE_ID, name: 'Gola negra', offered: true, isDefault: true },
    { id: STYLE_OTHER, name: 'Italiana 70', offered: true, isDefault: false }
  ];
}

function resolvedItem() {
  return {
    furnitureInstanceId: INSTANCE,
    furnitureType: 'inferior',
    source: 'project',
    recipeMode: 'gola',
    applied: { topDiscountMm: 40, betweenDiscountMm: 36 },
    layout: { state: 'resolved', rows: [{ id: 'row-1', heightMm: 680 }, { id: 'row-2', heightMm: 680 }] }
  };
}

test('carga: el GET pinta el estilo en uso y las filas de opción servidas', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  assert.strictEqual(bridgeCalls.length, 1, 'ensureLoaded fires on connect');
  assert.strictEqual(bridgeCalls[0].action, 'get_project_grip');
  answer(grip, 'onProjectGrip', {
    requestId: bridgeCalls[0].payload.requestId, status: 'ok', projectId: PROJECT,
    grip: okGrip(STYLE_ID), styles: stylesList()
  });
  grip.renderProjectSection();
  const body = registry['design-grip-body'];
  assert.ok(body.innerHTML.includes('Gola negra'), 'current style name renders');
  assert.ok(body.innerHTML.includes('Italiana 70'), 'other offered style renders');
  assert.ok(body.innerHTML.includes('Estilo en uso'), 'in-use headline');
  assert.ok(!body.innerHTML.includes('OPENING_'), 'no OPENING_ codes visible');
  assert.ok(!body.innerHTML.includes('GRIP_'), 'no GRIP_ codes visible');
});

test('hereda: la tarjeta del mueble muestra el estilo del proyecto y la oración del taller', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID, [], [resolvedItem()]), styles: stylesList() });
  grip.renderFurnitureCard({ furnitureInstanceId: INSTANCE });
  assert.strictEqual(registry['inspector-grip-card'].style.display, 'block');
  assert.ok(registry['inspector-grip-badge'].textContent === 'Hereda', 'badge Hereda');
  const body = registry['inspector-grip-body'].innerHTML;
  assert.ok(body.includes('Usa el estilo del proyecto: <strong>Gola negra</strong>'), 'project headline verbatim');
  assert.ok(body.includes('2 frentes: 680 y 680 mm · gola arriba + gola entre frentes'), 'workshop sentence from the server report');
  assert.ok(body.includes('Cambiar sólo este mueble'), 'override affordance');
  assert.ok(!body.includes('Volver al del proyecto'), 'no return affordance while inheriting');
});

test('excepción: badge, nombre del estilo del override y volver al del proyecto', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  const item = Object.assign({}, resolvedItem(), { source: 'override' });
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID, [{ id: INSTANCE, styleId: STYLE_OTHER, name: 'Italiana 70' }], [item]), styles: stylesList() });
  grip.renderFurnitureCard({ furnitureInstanceId: INSTANCE });
  assert.strictEqual(registry['inspector-grip-badge'].textContent, 'Excepción', 'badge Excepción');
  assert.ok(registry['inspector-grip-body'].innerHTML.includes('Excepción de este mueble: <strong>Italiana 70</strong>'));
  assert.ok(registry['inspector-grip-body'].innerHTML.includes('Volver al del proyecto'), 'return affordance');
});

test('varios: el bloque del lote arma N excepciones en UNA operación', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID), styles: stylesList()
  });
  grip.renderBatchBlock([{ furnitureInstanceId: INSTANCE }, { furnitureInstanceId: INSTANCE_B }, { furnitureInstanceId: 'i-3' }]);
  assert.strictEqual(registry['inspector-batch-grip-card'].style.display, 'block');
  assert.ok(registry['inspector-batch-grip'].innerHTML.includes('una sola operación'));
});

test('bloqueado: el motivo del taller sin códigos visibles', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  const blocked = Object.assign({}, resolvedItem(), {
    layout: { state: 'blocked', reason: 'la copia congelada del agarre no se puede usar' }
  });
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID, [], [blocked]), styles: stylesList() });
  grip.renderFurnitureCard({ furnitureInstanceId: INSTANCE });
  const body = registry['inspector-grip-body'].innerHTML;
  assert.ok(body.includes('Bloqueado:'), 'blocked headline');
  assert.ok(body.includes('la copia congelada del agarre no se puede usar'), 'server reason rendered');
  assert.ok(!body.includes('GRIP_'), 'no raw codes');
});

test('sin conexión: sin proyecto vinculado las superficies quedan ocultas', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'unbound', binding: null });
  grip.renderProjectSection();
  grip.renderFurnitureCard({ furnitureInstanceId: INSTANCE });
  assert.strictEqual(registry['design-grip-card'].style.display, 'none', 'project card hidden');
  assert.strictEqual(registry['inspector-grip-card'].style.display, 'none', 'furniture card hidden');
});

test('desactualizado: el 412 produce el banner con Recargar y re-lee el GET', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID), styles: stylesList()
  });
  answer(grip, 'onProjectGripApplied', {
    requestId: null, status: 'error', projectId: PROJECT, httpStatus: 412,
    reason: 'la versión del agarre del proyecto cambió'
  });
  // The stale banner waits for Recargar: rendering does NOT auto-fire a
  // GET (r1 repro: unguarded re-fire = 2772 GETs/600ms), and the stale
  // banner stays until the user presses Recargar.
  const before = bridgeCalls.length;
  grip.renderProjectSection();
  assert.strictEqual(bridgeCalls.length, before, 'stale does not auto-GET');
  const body = registry['design-grip-body'].innerHTML;
  assert.ok(body.includes('Alguien más cambió el agarre del proyecto'), 'stale banner copy');
  assert.ok(body.includes('Recargar'), 'reload affordance');
  // Recargar resets the terminal state and re-reads the server truth.
  grip.reload(PROJECT);
  assert.ok(bridgeCalls.length > before, 'Recargar re-reads the GET');
  assert.strictEqual(bridgeCalls[bridgeCalls.length - 1].action, 'get_project_grip');
});

test('respuestas tardías: otro proyecto o request viejo se descarta sin renderizar', () => {
  const { grip, registry, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  // The initial GET answers with the bound truth (Gola negra).
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID), styles: stylesList() });
  // Foreign project: dropped (its own distinct style name must never render).
  const foreign = okGrip(STYLE_OTHER);
  foreign.snapshot.styleName = 'Estilo Ajeno';
  answer(grip, 'onProjectGrip', {
    requestId: null, status: 'ok', projectId: PROJECT_B,
    grip: foreign, styles: []
  });
  // A late ok-apply answer with a matching projectId forces a re-read and
  // NEVER paints the payload (it carries no report): the body goes to
  // loading and the re-GET answer restores the server truth — the foreign
  // style name from the payload is never rendered.
  answer(grip, 'onProjectGripApplied', {
    requestId: 'late-apply', status: 'ok', projectId: PROJECT, grip: okGrip(STYLE_OTHER)
  });
  grip.renderProjectSection();
  assert.ok(registry['design-grip-body'].innerHTML.includes('skeleton-line'), 'the card goes to loading on the forced re-read');
  // The re-GET answer (the server truth of THIS project).
  const reGet = bridgeCalls.filter(function (c) { return c.action === 'get_project_grip'; })[1];
  answer(grip, 'onProjectGrip', {
    requestId: reGet.payload.requestId, status: 'ok', projectId: PROJECT,
    grip: okGrip(STYLE_ID), styles: stylesList()
  });
  grip.renderProjectSection();
  const body = registry['design-grip-body'].innerHTML;
  assert.ok(!body.includes('Estilo Ajeno'), 'the late payload style never rendered');
  assert.ok(body.includes('Gola negra'), 'the re-read restores the server truth');
});

test('intención de estilo: el PUT lleva If-Match implícito (versión del último GET) y el deshacer re-aplica la anterior', () => {
  const { grip, bridgeCalls } = buildSandbox();
  grip.onBindingStatus({ state: 'connected', binding: { projectId: PROJECT, designId: 'd-1' } });
  answerGet(grip, bridgeCalls, { status: 'ok', grip: okGrip(STYLE_ID), styles: stylesList()
  });
  grip.applyStyle(PROJECT, STYLE_OTHER, STYLE_ID);
  const apply = bridgeCalls.filter(function (c) { return c.action === 'apply_project_grip_style'; })[0];
  assert.ok(apply, 'style intention travels');
  assert.strictEqual(apply.payload.gripStyleId, STYLE_OTHER);
  assert.strictEqual(apply.payload.previousStyleId, STYLE_ID, 'the previous style rides for undo');
  // The Ruby bridge owns the If-Match header (gripVersion 7 from the GET);
  // the JS payload carries no version — it never guesses one.
  assert.strictEqual(apply.payload.gripVersion, undefined);
  // Undo: the bridge replays the previous intention.
  answer(grip, 'onProjectGripApplied', {
    requestId: null, status: 'ok', projectId: PROJECT,
    grip: okGrip(STYLE_OTHER), styles: stylesList(), canUndo: true
  });
  grip.undo(PROJECT);
  const undo = bridgeCalls.filter(function (c) { return c.action === 'undo_project_grip'; })[0];
  assert.ok(undo, 'undo intention travels');
});

test('oración: sin dimensiones conocidas y sin filas son estados honestos', () => {
  const { grip } = buildSandbox();
  assert.ok(grip.sentenceFor({
    recipeMode: 'gola',
    layout: { state: 'unknown_dims' }
  }).includes('Sin dimensiones conocidas'), 'unknown dims honest line');
  assert.ok(grip.sentenceFor({ recipeMode: 'handle', layout: { state: 'resolved', rows: [] } }).length > 0, 'handle with no rows still names the mode');
});

test('razones: el mapa del taller nombra la acción y el lugar (sin códigos crudos)', () => {
  const { grip } = buildSandbox();
  assert.ok(grip.reasonText('GRIP_PROFILE_UNUSABLE').includes('Perfiles de apertura'), 'names the place');
  assert.ok(grip.reasonText('GRIP_STYLE_NOT_OFFERED').includes('Ajustes › Agarres'), 'names the adjustments');
  assert.ok(grip.reasonText('UNKNOWN_CODE').includes('No se pudo guardar'), 'generic fallback');
  assert.ok(!grip.reasonText('GRIP_PROFILE_UNUSABLE').includes('GRIP_'), 'no raw code in the copy');
});

console.log(JSON.stringify({ success: true, testsPassed: testsPassed, module: 'granete-grip.js' }));
