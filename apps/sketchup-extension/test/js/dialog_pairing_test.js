// Real JavaScript test harness for the #499 Slice 3 pairing entry in
// dialog.html: drives the actual dialog script (vm sandbox + mock DOM) and
// asserts the code-entry UX — submit/Enter wiring, busy states, inline
// result messaging, the raw-code-never-persists rule and the regression
// that manual (non-pairing) results keep their original toast channel.
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
    set(v) { el.children.length = 0; }
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
  el.focus = () => { el._focused = true; };
  return el;
}

function buildSandbox() {
  const registry = {};
  const bridgeCalls = [];

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement(''),
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
        refresh_model_binding: () => bridgeCalls.push({ action: 'refresh_model_binding' }),
        adopt_binding_base: () => bridgeCalls.push({ action: 'adopt_binding_base' }),
        list_binding_projects: () => bridgeCalls.push({ action: 'list_binding_projects' }),
        list_binding_designs: (p) => bridgeCalls.push({ action: 'list_binding_designs', payload: JSON.parse(p) }),
        connect_model: (p) => bridgeCalls.push({ action: 'connect_model', payload: JSON.parse(p) }),
        connect_with_code: (p) => bridgeCalls.push({ action: 'connect_with_code', payload: JSON.parse(p) }),
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

function submitKey(sandbox) {
  const input = el(sandbox, 'pairing-code-input');
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
}

function connectedStatus() {
  return {
    state: 'connected',
    binding: {
      projectId: '41000000-0000-0000-0000-000000000001',
      designId: '52000000-0000-0000-0000-000000000001',
      baseRevisionId: '53000000-0000-0000-0000-000000000001',
      organizationName: 'Carpintería García',
      projectName: 'Cocina García',
      designName: 'Cocina Principal',
      designStatus: 'active'
    },
    authoritativeBaseRevisionId: '53000000-0000-0000-0000-000000000001',
    authoritativeBaseRevisionNumber: 1,
    capabilities: { can_edit_working_copy: true, can_publish_revision: true }
  };
}

const assert = {
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message || 'assert.equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(value, message) {
    if (!value) throw new Error(message || 'assert.ok failed');
  },
  match(actual, regex, message) {
    if (!regex.test(actual)) {
      throw new Error(`${message || 'assert.match'}: ${JSON.stringify(actual)} does not match ${regex}`);
    }
  }
};

function runTests() {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('submitting a code calls the bridge with the raw input and locks the UI', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'abcd-234e fgh5';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });

    const call = sandbox.__bridge.find((c) => c.action === 'connect_with_code');
    assert.ok(call, 'connect_with_code bridge call happened');
    assert.equal(call.payload.code, 'abcd-234e fgh5', 'raw input reaches Ruby for normalization');
    assert.ok(el(sandbox, 'btn-pairing-connect').disabled, 'button disabled while pending');
    assert.ok(el(sandbox, 'pairing-code-input').disabled, 'input disabled while pending');
    assert.match(el(sandbox, 'btn-pairing-connect').textContent, /Conectando/, 'busy label');
  });

  test('Enter submits the code', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'ABCD234EFGH5';
    submitKey(sandbox);
    assert.ok(sandbox.__bridge.find((c) => c.action === 'connect_with_code'), 'Enter submitted');
  });

  test('empty code never reaches the bridge', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = '   ';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });
    assert.ok(!sandbox.__bridge.find((c) => c.action === 'connect_with_code'), 'no bridge call');
    assert.match(el(sandbox, 'pairing-message').textContent, /Pegá el código/);
  });

  test('successful pairing clears the code and confirms visually', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'ABCD234EFGH5';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: true, pairing: true, status: connectedStatus()
    });

    assert.equal(el(sandbox, 'pairing-code-input').value, '', 'raw code never persists in the dialog');
    assert.match(el(sandbox, 'pairing-message').textContent, /Diseño vinculado en SketchUp/);
    assert.equal(el(sandbox, 'model-binding-badge').textContent, 'Conectado');
    assert.ok(!el(sandbox, 'btn-pairing-connect').disabled, 'UI unlocked');
  });

  test('unknown/used code is actionable and the input is reset', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'ZZZZZZZZZZZZ';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: false, pairing: true, code: 'code_unusable',
      reason: 'el código ya fue usado, expiró o fue cancelado; generá uno nuevo en la web'
    });

    assert.match(el(sandbox, 'pairing-message').textContent, /generá uno nuevo en la web/);
    assert.equal(el(sandbox, 'pairing-code-input').value, '', 'a dead code cannot be retried');
  });

  test('invalid code keeps the input editable for correction', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'corto';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: false, pairing: true, code: 'invalid_code',
      reason: 'el código debe tener 12 caracteres (ignorá espacios y guiones)'
    });

    assert.equal(el(sandbox, 'pairing-code-input').value, 'corto', 'still editable');
    assert.ok(el(sandbox, 'pairing-code-input')._focused, 'focus returns to the input');
  });

  test('consumed pairing rebind requires a new code and never opens manual rebind confirmation', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'ABCD234EFGH5';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: false,
      pairing: true,
      code: 'pairing_rebind_requires_new_code',
      recovery: 'manual_rebind_then_new_code',
      reason: 'el código fue aceptado, pero no se aplicó para no cambiar su revisión exacta. Generá un código nuevo en la web.'
    });

    assert.match(el(sandbox, 'pairing-message').textContent, /revisión exacta/);
    assert.match(el(sandbox, 'pairing-message').textContent, /código nuevo en la web/);
    assert.equal(el(sandbox, 'pairing-code-input').value, '', 'the consumed code cannot be retried');
    assert.equal(el(sandbox, 'model-binding-rebind-review').style.display, 'none', 'pairing must not enter the manual rebind confirmation');
    assert.ok(!sandbox.__bridge.some((call) => call.action === 'connect_model'),
      'no manual bind may masquerade as completion of the consumed pairing grant');
  });

  test('null-pinned pairing rebind uses the same fresh-code recovery', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: false,
      pairing: true,
      code: 'pairing_rebind_requires_new_code',
      recovery: 'manual_rebind_then_new_code',
      pinnedBaseRevisionId: null,
      reason: 'el código fue aceptado, pero no se aplicó para no cambiar su revisión exacta. Generá un código nuevo en la web.'
    });

    assert.match(el(sandbox, 'pairing-message').textContent, /código nuevo en la web/);
    assert.equal(el(sandbox, 'model-binding-rebind-review').style.display, 'none');
    assert.ok(!sandbox.__bridge.some((call) => call.action === 'connect_model'));
  });

  test('confirmation failure is an honest partial: connected but web unaware', (sandbox) => {
    el(sandbox, 'pairing-code-input').value = 'ABCD234EFGH5';
    el(sandbox, 'btn-pairing-connect').dispatchEvent({ type: 'click' });
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: true, pairing: true, confirmationFailed: true,
      reason: 'el modelo quedó conectado, pero la web no registró la confirmación',
      status: connectedStatus()
    });

    assert.equal(el(sandbox, 'model-binding-badge').textContent, 'Conectado');
    assert.match(el(sandbox, 'pairing-message').textContent, /la web no registró la confirmación/);
  });

  test('manual results keep the original toast channel (regression)', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingResult({ ok: true, status: connectedStatus() });
    // Manual binds never surface the inline pairing message.
    assert.equal(el(sandbox, 'pairing-message').textContent, '');
    assert.equal(el(sandbox, 'model-binding-badge').textContent, 'Conectado');
  });

  return tests;
}

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
