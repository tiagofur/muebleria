// Focused #848 post-C4.9 harness for the REAL
// resources/js/granete-param-form.js module (window.GraneteUI.paramForm):
// namespace registration + idempotent re-execution, exact 4-entry public
// API, stateless-by-contract behavior (no init, no deps, no module state),
// getDefaultParams, every renderParamForm control type (mm dim inputs,
// clamped steppers, enums, boolean checkbox + badge, string inputs +
// hints), the onChange(name, value, unit) contract, parameterIssueMessage
// exact copy/branching and estimatedPartsLabel honesty semantics (#847).
// The integrated surface (bootstrap wiring into the configurator and
// inspector init bags, full dialog.html chain) stays covered by the
// dialog_* harnesses via test/js/support/dialog_scripts.js — this harness
// drives the module directly, never a copy of its code.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RESOURCES = path.resolve(__dirname, '../../src/granete_for_sketchup/resources');
const MODULE_SOURCE = fs.readFileSync(path.join(RESOURCES, 'js/granete-param-form.js'), 'utf8');

function createMockElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: '',
    children: [],
    listeners: {},
    className: '',
    type: '',
    value: '',
    checked: false,
    required: false,
    step: undefined,
    min: undefined,
    max: undefined,
    inputMode: '',
    maxLength: undefined,
    selected: false,
    _textContent: '',
    attributes: {}
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(v) { el._textContent = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { el.children.length = 0; }
  });
  el.setAttribute = (name, value) => { el.attributes[name] = String(value); };
  el.getAttribute = (name) => (name in el.attributes ? el.attributes[name] : null);
  el.addEventListener = (evt, cb) => {
    el.listeners[evt] = el.listeners[evt] || [];
    el.listeners[evt].push(cb);
  };
  el.fire = (evt, event) => {
    (el.listeners[evt] || []).forEach((cb) => cb(event || {}));
  };
  el.appendChild = (child) => { el.children.push(child); return child; };
  return el;
}

// Bare sandbox: only window + document exist. No sketchup host, no other
// GraneteUI module, no configurator/inspector state — the module must be
// self-sufficient.
function buildSandbox() {
  const created = [];
  const documentMock = {
    createElement: (tag) => {
      const el = createMockElement(tag);
      created.push(el);
      return el;
    }
  };
  const sandbox = { console, document: documentMock, window: {} };
  vm.createContext(sandbox);
  return { sandbox, created, run: (src) => vm.runInContext(src, sandbox, { filename: 'granete-param-form.js' }) };
}

function find(root, predicate, acc) {
  acc = acc || [];
  for (const child of root.children || []) {
    if (predicate(child)) acc.push(child);
    find(child, predicate, acc);
  }
  return acc;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- helpers

test('registers window.GraneteUI.paramForm with exactly the 4-entry public API', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.ok(pf, 'paramForm namespace must be registered');
  assert.deepStrictEqual(Object.keys(pf).sort(),
    ['estimatedPartsLabel', 'getDefaultParams', 'parameterIssueMessage', 'renderParamForm']);
  Object.keys(pf).forEach((key) => assert.strictEqual(typeof pf[key], 'function'));
  // Nothing else leaks onto the namespace.
  assert.deepStrictEqual(Object.keys(sandbox.window.GraneteUI), ['paramForm']);
});

test('re-execution is idempotent (same API object, no duplication)', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const first = sandbox.window.GraneteUI.paramForm;
  run(MODULE_SOURCE);
  assert.strictEqual(sandbox.window.GraneteUI.paramForm, first,
    're-executing the file must not rebuild the API object');
  assert.strictEqual(Object.keys(sandbox.window.GraneteUI.paramForm).length, 4);
});

test('module is stateless by contract: no init entry, pure repeated calls', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(pf.init, undefined, 'no init(): the module takes no injected deps');
  const def = { parameters: [{ name: 'shelfCount', defaultValue: 2 }] };
  assert.deepStrictEqual(pf.getDefaultParams(def), pf.getDefaultParams(def));
  assert.strictEqual(pf.estimatedPartsLabel(def, {}), pf.estimatedPartsLabel(def, {}));
  // Calls must not grow or mutate the namespace surface.
  assert.strictEqual(Object.keys(sandbox.window.GraneteUI).length, 1);
  assert.strictEqual(Object.keys(sandbox.window.GraneteUI.paramForm).length, 4);
  // No host bridge use anywhere in the module source (comments excluded).
  const codeOnly = MODULE_SOURCE.replace(/\/\/[^\n]*/g, '');
  assert.ok(!codeOnly.includes('window.sketchup'), 'param-form must never call the Ruby bridge');
  assert.ok(!codeOnly.includes('document.getElementById'), 'param-form owns no DOM ids');
});

// -------------------------------------------------------- getDefaultParams

test('getDefaultParams returns the registered default of every parameter', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const def = { parameters: [
    { name: 'ancho', defaultValue: 600 },
    { name: 'boxes', defaultValue: 3 },
    { name: 'label', defaultValue: 'Mueble' }
  ] };
  assert.deepStrictEqual({ ...sandbox.window.GraneteUI.paramForm.getDefaultParams(def) },
    { ancho: 600, boxes: 3, label: 'Mueble' });
});

test('getDefaultParams handles definitions without parameters', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.deepStrictEqual({ ...pf.getDefaultParams({}) }, {});
  assert.deepStrictEqual({ ...pf.getDefaultParams({ parameters: [] }) }, {});
  assert.deepStrictEqual({ ...pf.getDefaultParams({ parameters: undefined }) }, {});
});

// ---------------------------------------------------------- renderParamForm

function mmFixture() {
  const container = createMockElement('div');
  container.id = 'params-container';
  return { container, def: { parameters: [
    { name: 'ancho total', type: 'number', unit: 'mm', label: 'Ancho', defaultValue: 600, min: 100, max: 2000, step: 5 }
  ] } };
}

test('renderParamForm with no definition clears the container', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const container = createMockElement('div');
  container.children.push(createMockElement('span'));
  sandbox.window.GraneteUI.paramForm.renderParamForm(container, null, {}, () => {});
  assert.strictEqual(container.children.length, 0, 'stale content must be cleared');
});

test('mm number param renders a dim input + mm unit with bound id/aria and clamping change handler', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const { container, def } = mmFixture();
  const changes = [];
  pf.renderParamForm(container, def, {}, (name, value, unit) => changes.push({ name, value, unit }));

  const group = container.children[0];
  assert.strictEqual(group.className, 'param-group');
  const label = find(group, (n) => n.tagName === 'LABEL')[0];
  assert.strictEqual(label.textContent, 'Ancho');
  assert.strictEqual(label.attributes.for, 'param-ancho-total-params-container',
    'controlId sanitizes the parameter name and binds label[for]');
  const input = find(group, (n) => n.className === 'dim-input')[0];
  assert.strictEqual(input.type, 'number');
  assert.strictEqual(input.inputMode, 'numeric');
  assert.strictEqual(input.value, 600, 'falls back to the registered default');
  assert.strictEqual(input.min, 100);
  assert.strictEqual(input.max, 2000);
  assert.strictEqual(input.step, 5);
  assert.strictEqual(input.attributes['aria-label'], 'Ancho');
  const unit = find(group, (n) => n.className === 'dim-unit')[0];
  assert.strictEqual(unit.textContent, 'mm');

  input.value = '720';
  input.fire('change');
  assert.deepStrictEqual(changes, [{ name: 'ancho total', value: 720, unit: 'mm' }]);

  input.value = 'not-a-number';
  input.fire('change');
  assert.strictEqual(changes[1].value, 600, 'NaN falls back to the registered default');

  input.value = '50';
  input.fire('change');
  assert.strictEqual(changes[2].value, 100, 'below min clamps to min');

  input.value = '9999';
  input.fire('change');
  assert.strictEqual(changes[3].value, 2000, 'above max clamps to max');
});

test('current values win over defaults in the rendered control', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const { container, def } = mmFixture();
  sandbox.window.GraneteUI.paramForm.renderParamForm(container, def, { 'ancho total': 800 }, () => {});
  const input = find(container, (n) => n.className === 'dim-input')[0];
  assert.strictEqual(input.value, 800);
});

test('bounded number without mm renders a stepper with step and boundary clamping', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const container = createMockElement('div');
  const def = { parameters: [
    { name: 'doorCount', type: 'number', label: 'Puertas', defaultValue: 2, min: 0, max: 4, step: 1 }
  ] };
  const changes = [];
  // The stepper recomputes from currentValues on every click (the live
  // values object the host modules keep) — never from the displayed node.
  const values = {};
  pf.renderParamForm(container, def, values, (name, value) => {
    values[name] = value;
    changes.push({ name, value });
  });

  const minus = find(container, (n) => n.tagName === 'BUTTON' && n.textContent === '−')[0];
  const plus = find(container, (n) => n.tagName === 'BUTTON' && n.textContent === '+')[0];
  const display = find(container, (n) => n.className === 'stepper-value')[0];
  assert.strictEqual(display.textContent, '2');
  assert.strictEqual(minus.attributes['aria-label'], 'Disminuir Puertas');
  assert.strictEqual(plus.attributes['aria-label'], 'Aumentar Puertas');

  minus.fire('click');
  assert.strictEqual(changes[0].value, 1, 'step is honored');
  assert.strictEqual(display.textContent, '1');

  minus.fire('click');
  assert.strictEqual(display.textContent, '0');

  minus.fire('click');
  assert.strictEqual(changes.length, 2, 'at min the stepper refuses and does not call onChange');
  assert.strictEqual(display.textContent, '0');

  plus.fire('click'); plus.fire('click'); plus.fire('click'); plus.fire('click');
  assert.strictEqual(display.textContent, '4');
  plus.fire('click');
  assert.strictEqual(changes.length, 6, 'at max the stepper refuses and does not call onChange');

  const stepper = find(container, (n) => n.className === 'stepper')[0];
  assert.ok(stepper, 'the stepper wrapper class is preserved');
});

test('enum param renders a select with one option per value and change wiring', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const container = createMockElement('div');
  const def = { parameters: [
    { name: 'color', type: 'enum', label: 'Color', options: ['Rojo', 'Verde', 'Azul'], required: true }
  ] };
  const changes = [];
  pf.renderParamForm(container, def, { color: 'Verde' }, (name, value) => changes.push({ name, value }));

  const select = find(container, (n) => n.tagName === 'SELECT')[0];
  assert.strictEqual(select.attributes['aria-required'], 'true');
  assert.strictEqual(select.children.length, 3);
  assert.deepStrictEqual(select.children.map((o) => o.value), ['Rojo', 'Verde', 'Azul']);
  const green = select.children[1];
  assert.strictEqual(green.selected, true, 'current value marks the selected option');
  select.value = 'Azul';
  select.fire('change');
  assert.deepStrictEqual(changes, [{ name: 'color', value: 'Azul' }]);
});

test('boolean param renders checkbox + Sí/No badge and keeps them in sync', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const container = createMockElement('div');
  const def = { parameters: [
    { name: 'trasera', type: 'boolean', label: 'Trasera' }
  ] };
  const changes = [];
  pf.renderParamForm(container, def, {}, (name, value) => changes.push({ name, value }));

  const badge = find(container, (n) => n.className === 'param-value-badge')[0];
  const checkbox = find(container, (n) => n.className === 'param-checkbox')[0];
  assert.strictEqual(badge.textContent, 'No', 'undefined current value renders the No badge');
  assert.strictEqual(checkbox.checked, false);
  assert.strictEqual(checkbox.attributes['aria-label'], 'Trasera');

  checkbox.checked = true;
  checkbox.fire('change');
  assert.strictEqual(badge.textContent, 'Sí', 'the badge follows the checkbox');
  assert.deepStrictEqual(changes, [{ name: 'trasera', value: true }]);

  checkbox.checked = false;
  checkbox.fire('change');
  assert.strictEqual(badge.textContent, 'No');
  assert.deepStrictEqual(changes[1], { name: 'trasera', value: false });
});

test('string param renders a text input with required/maxLength and a maxlength hint', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const container = createMockElement('div');
  const def = { parameters: [
    { name: 'nombre', type: 'string', label: 'Nombre', required: true, maxLength: 40 }
  ] };
  const changes = [];
  pf.renderParamForm(container, def, { nombre: null }, (name, value) => changes.push({ name, value }));

  const input = find(container, (n) => n.className === 'param-text-input')[0];
  assert.strictEqual(input.type, 'text');
  assert.strictEqual(input.value, '', 'null current value renders the empty string');
  assert.strictEqual(input.required, true);
  assert.strictEqual(input.maxLength, 40);
  assert.strictEqual(input.attributes['aria-required'], 'true');

  const hint = find(container, (n) => n.className === 'param-hint')[0];
  assert.strictEqual(hint.textContent, 'Máximo 40 caracteres · obligatorio');

  input.value = 'Ropero';
  input.fire('change');
  assert.deepStrictEqual(changes, [{ name: 'nombre', value: 'Ropero' }]);
});

test('string param without maxLength renders no hint and no aria-required', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const container = createMockElement('div');
  const def = { parameters: [
    { name: 'nota', type: 'string', label: 'Nota' }
  ] };
  sandbox.window.GraneteUI.paramForm.renderParamForm(container, def, {}, () => {});
  assert.strictEqual(find(container, (n) => n.className === 'param-hint').length, 0);
  const input = find(container, (n) => n.className === 'param-text-input')[0];
  assert.strictEqual(input.attributes['aria-required'], 'false',
    'the moved implementation always sets aria-required on string inputs');
});

// ---------------------------------------------------- parameterIssueMessage

test('parameterIssueMessage: no issues falls back to result.error then fallback', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(pf.parameterIssueMessage({}, 'fallback'), 'fallback');
  assert.strictEqual(pf.parameterIssueMessage(null, 'fallback'), 'fallback');
  assert.strictEqual(pf.parameterIssueMessage({ error: 'boom' }, 'fallback'), 'boom');
  assert.strictEqual(pf.parameterIssueMessage({ issues: [] }, 'fallback'), 'fallback');
});

test('parameterIssueMessage: issue without code falls back to result.error then fallback', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(pf.parameterIssueMessage({ issues: [{}] }, 'fallback'), 'fallback');
  assert.strictEqual(pf.parameterIssueMessage({ error: 'boom', issues: [{}] }, 'fallback'), 'boom');
});

test('parameterIssueMessage: exact Spanish copy for every known PARAMETER_* code', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const expectations = {
    PARAMETER_REQUIRED: 'Completá el parámetro requerido',
    PARAMETER_TYPE_INVALID: 'El parámetro tiene un tipo de valor incorrecto',
    PARAMETER_OUT_OF_RANGE: 'El parámetro está fuera del rango permitido',
    PARAMETER_STEP_INVALID: 'El parámetro no coincide con el incremento permitido',
    PARAMETER_ENUM_INVALID: 'Elegí una opción permitida',
    PARAMETER_STRING_TOO_LONG: 'El texto supera la longitud permitida',
    PARAMETER_UNKNOWN: 'La definición no reconoce el parámetro',
    PARAMETER_DEFINITION_INVALID: 'La definición paramétrica es inválida',
    PARAMETER_BINDING_CONFLICT: 'La definición tiene consumidores paramétricos en conflicto'
  };
  for (const [code, message] of Object.entries(expectations)) {
    assert.strictEqual(pf.parameterIssueMessage({ issues: [{ code }] }, 'fallback'), message, code);
  }
});

test('parameterIssueMessage appends the parameter name (top-level or details)', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(
    pf.parameterIssueMessage({ issues: [{ code: 'PARAMETER_OUT_OF_RANGE', parameter: 'ancho' }] }, 'x'),
    'El parámetro está fuera del rango permitido: ancho');
  assert.strictEqual(
    pf.parameterIssueMessage({ issues: [{ code: 'PARAMETER_REQUIRED', details: { parameter: 'alto' } }] }, 'x'),
    'Completá el parámetro requerido: alto');
});

test('parameterIssueMessage: unknown code uses issue.message or the fallback', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(
    pf.parameterIssueMessage({ issues: [{ code: 'SOMETHING_ELSE', message: 'custom' }] }, 'fallback'),
    'custom');
  assert.strictEqual(
    pf.parameterIssueMessage({ issues: [{ code: 'SOMETHING_ELSE' }] }, 'fallback'),
    'fallback');
});

// ------------------------------------------------------ estimatedPartsLabel

test('estimatedPartsLabel: server estimate only while counting params sit at defaults', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const def = { estimatedPartCount: 5, estimatedHardwareCount: 2, parameters: [
    { name: 'shelfCount', defaultValue: 3 }, { name: 'doorCount', defaultValue: 1 }
  ] };
  assert.strictEqual(pf.estimatedPartsLabel(def, {}), 'Aprox. 5 piezas + 2 herrajes');
  assert.strictEqual(pf.estimatedPartsLabel(def, { shelfCount: 3, doorCount: 1 }),
    'Aprox. 5 piezas + 2 herrajes');
  assert.strictEqual(pf.estimatedPartsLabel(def, { shelfCount: 3, doorCount: null }),
    'Aprox. 5 piezas + 2 herrajes', 'null counts as at-defaults');
  assert.strictEqual(pf.estimatedPartsLabel(def, { shelfCount: 4 }),
    'Aprox. 7 piezas', 'moved counting params drop the server estimate for the heuristic');
});

test('estimatedPartsLabel: singular piece and zero hardware', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(
    pf.estimatedPartsLabel({ estimatedPartCount: 1, estimatedHardwareCount: 0, parameters: [] }, {}),
    'Aprox. 1 pieza');
  assert.strictEqual(
    pf.estimatedPartsLabel({ estimatedPartCount: 3, estimatedHardwareCount: 0, parameters: [] }, {}),
    'Aprox. 3 piezas', 'zero hardware adds no herraje suffix');
});

test('estimatedPartsLabel: heuristic reads CURRENT values with the 2-piece base', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const def = { parameters: [
    { name: 'shelfCount', defaultValue: 1 }, { name: 'doorCount', defaultValue: 2 }
  ] };
  assert.strictEqual(pf.estimatedPartsLabel(def, { shelfCount: 5, doorCount: 4 }), 'Aprox. 11 piezas');
  assert.strictEqual(pf.estimatedPartsLabel(def, {}), 'Aprox. 5 piezas',
    'missing currents fall back to the registered defaults');
});

test('estimatedPartsLabel: honesty fallback when nothing can be estimated', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  assert.strictEqual(pf.estimatedPartsLabel({}, {}), 'Piezas: se calculan al resolver');
  assert.strictEqual(pf.estimatedPartsLabel(null, {}), 'Piezas: se calculan al resolver');
  assert.strictEqual(pf.estimatedPartsLabel({ parameters: [] }, {}), 'Piezas: se calculan al resolver');
  assert.strictEqual(pf.estimatedPartsLabel({ estimatedPartCount: 7, parameters: [] }, {}),
    'Aprox. 7 piezas', 'no counting params → the server estimate applies directly');
});

// ------------------------------------------------------------------- output

const results = [];
for (const { name, fn } of tests) {
  try {
    fn();
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

// ------------------------------------------------ #497 T8 cross-surface
// The SAME golden artifact the Go chain test generates drives the SketchUp
// dialog form: the exact published parameter set a real PostgreSQL served
// (draft + projected dimensions) renders the right control per type, seeds
// the explicit false / empty-string defaults, and submits typed values
// through the onChange contract.

const CROSS_SURFACE_FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../contracts/furnitureAuthoringCrossSurface.fixture.json'), 'utf8')
);

test('cross-surface golden: getDefaultParams seeds every published default, explicit false and "" included', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const def = { parameters: CROSS_SURFACE_FIXTURE.expected.publishedParameters };

  const defaults = { ...pf.getDefaultParams(def) };
  assert.strictEqual(defaults.shelfCount, 2);
  assert.strictEqual(defaults.doorPresence, true);
  assert.strictEqual(defaults.softClose, false, 'explicit false default must survive');
  assert.strictEqual(defaults.doorStyle, 'slab');
  assert.strictEqual(defaults.clientNote, '', 'explicit empty-string default must survive');
  assert.strictEqual(defaults.widthMm, 600);
  assert.strictEqual(defaults.heightMm, 720);
  assert.strictEqual(defaults.depthMm, 590);
});

test('cross-surface golden: every published parameter renders its type-correct control', () => {
  const { sandbox, run } = buildSandbox();
  run(MODULE_SOURCE);
  const pf = sandbox.window.GraneteUI.paramForm;
  const container = createMockElement('div');
  const def = { parameters: CROSS_SURFACE_FIXTURE.expected.publishedParameters };
  const changes = [];
  pf.renderParamForm(container, def, {}, (name, value, unit) => changes.push({ name, value, unit }));

  const published = CROSS_SURFACE_FIXTURE.expected.publishedParameters;

  // mm dimension projections: dim inputs with the served min/max/step.
  for (const name of ['widthMm', 'heightMm', 'depthMm']) {
    const spec = published.find((p) => p.name === name);
    const input = find(container, (n) => n.attributes['aria-label'] === spec.label)[0];
    assert.ok(input, `${name} renders its dim input`);
    assert.strictEqual(input.type, 'number');
    assert.strictEqual(input.value, spec.defaultValue);
    assert.strictEqual(input.min, spec.min);
    assert.strictEqual(input.max, spec.max);
  }

  // number + count (shelfCount): numeric control honouring min/max.
  const shelf = published.find((p) => p.name === 'shelfCount');
  const shelfInput = find(container, (n) => n.attributes['aria-label'] === 'Cantidad de estantes'
    && n.tagName === 'INPUT')[0];
  assert.ok(shelfInput, 'shelfCount renders a numeric input');
  assert.strictEqual(shelfInput.type, 'number');

  // boolean (softClose) with explicit false: checkbox + No badge.
  const softCloseBadge = find(container, (n) => n.className === 'param-value-badge'
    && n.textContent === 'No');
  assert.ok(softCloseBadge.length >= 1, 'explicit false default renders the No badge');
  const softCloseCheckbox = find(container, (n) => n.className === 'param-checkbox'
    && n.attributes['aria-label'] === 'Cierre suave')[0];
  assert.strictEqual(softCloseCheckbox.checked, false, 'checkbox reflects the explicit false default');

  // enum (doorStyle): select with the ordered options, default selected.
  const selects = find(container, (n) => n.tagName === 'SELECT');
  const styleSelect = selects.find((n) => n.children.some((o) => o.value === 'shaker'));
  assert.ok(styleSelect, 'doorStyle renders a select with its options');
  assert.deepStrictEqual(styleSelect.children.map((o) => o.value), ['slab', 'shaker']);
  assert.strictEqual(styleSelect.children[0].selected, true, 'slab default selected');

  // string (clientNote): text input with the served maxLength.
  const noteInput = find(container, (n) => n.tagName === 'INPUT' && n.attributes['aria-label'] === 'Nota del cliente')[0];
  assert.ok(noteInput, 'clientNote renders a text input');
  assert.strictEqual(String(noteInput.maxLength), '64');

  // Submit contract: user edits reach onChange as typed values.
  shelfInput.value = '3';
  shelfInput.fire('change');
  assert.deepStrictEqual(
    changes.find((c) => c.name === 'shelfCount'),
    { name: 'shelfCount', value: 3, unit: 'count' },
    'submitting a value reaches onChange typed (number + unit)'
  );
  styleSelect.value = 'shaker';
  styleSelect.fire('change');
  assert.deepStrictEqual(
    changes.find((c) => c.name === 'doorStyle'),
    { name: 'doorStyle', value: 'shaker', unit: undefined },
    'enum submit reaches onChange with the chosen option'
  );
});
