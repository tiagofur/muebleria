// Real JavaScript test harness for the #388 model binding panel in
// dialog.html: renders binding status payloads through the actual dialog
// script (vm sandbox + mock DOM) and asserts the distinct states, the
// project/design picker flow, the explicit rebind review and the rule that
// failed results never flip into success — the HtmlDialog half the Ruby
// connector tests can't cover.
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
  el.click = () => {
    (el.listeners.click || []).forEach((cb) => cb({ preventDefault: () => {} }));
  };
  el.appendChild = (child) => { el.children.push(child); return child; };
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

function visible(elm) {
  return elm.style.display !== 'none';
}

function optionValues(select) {
  return select.children.map((option) => option.value);
}

const PROJECT_ID = '41000000-0000-0000-0000-000000000001';
const DESIGN_ID = '52000000-0000-0000-0000-000000000001';
const REVISION_R1 = '53000000-0000-0000-0000-000000000001';
const REVISION_R2 = '53000000-0000-0000-0000-000000000002';

function connectedStatus() {
  return {
    state: 'connected',
    binding: {
      projectId: PROJECT_ID,
      designId: DESIGN_ID,
      baseRevisionId: REVISION_R2,
      organizationName: 'Carpintería García',
      projectName: 'Cocina García',
      designName: 'Cocina Principal',
      designStatus: 'active'
    },
    authoritativeBaseRevisionId: REVISION_R2,
    authoritativeBaseRevisionNumber: 2,
    capabilities: { can_edit_working_copy: true, can_publish_revision: true }
  };
}

function runTests() {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('initial render is unbound with connect action only', (sandbox) => {
    const badge = el(sandbox, 'model-binding-badge');
    assert.equal(badge.textContent, 'Sin conectar');
    assert.ok(badge.className.includes('pending'));
    assert.ok(visible(el(sandbox, 'btn-binding-connect')));
    assert.ok(!visible(el(sandbox, 'model-binding-info')));
    assert.ok(!visible(el(sandbox, 'btn-binding-refresh')));
    assert.ok(!visible(el(sandbox, 'btn-binding-adopt')));
  });

  test('connected renders exact context and hides connect', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(connectedStatus());
    const badge = el(sandbox, 'model-binding-badge');
    assert.equal(badge.textContent, 'Conectado');
    assert.ok(badge.className.includes('valid'));
    assert.equal(el(sandbox, 'binding-org-name').textContent, 'Carpintería García');
    assert.equal(el(sandbox, 'binding-project-name').textContent, 'Cocina García');
    assert.equal(el(sandbox, 'binding-design-name').textContent, 'Cocina Principal');
    assert.equal(el(sandbox, 'binding-base-revision').textContent, 'R2');
    assert.ok(visible(el(sandbox, 'model-binding-info')));
    assert.ok(!visible(el(sandbox, 'btn-binding-connect')));
    assert.ok(visible(el(sandbox, 'btn-binding-refresh')));
    assert.ok(!visible(el(sandbox, 'btn-binding-adopt')));
  });

  test('stale base is distinct and offers explicit remediation only', (sandbox) => {
    const status = connectedStatus();
    status.state = 'stale_base';
    status.binding.baseRevisionId = REVISION_R1;
    sandbox.window.GraneteDialog.onModelBindingStatus(status);
    const badge = el(sandbox, 'model-binding-badge');
    assert.equal(badge.textContent, 'Base desactualizada');
    assert.ok(badge.className.includes('pending'));
    assert.ok(visible(el(sandbox, 'btn-binding-adopt')));
    assert.ok(visible(el(sandbox, 'btn-binding-connect')));
    assert.equal(el(sandbox, 'binding-base-revision').textContent,
      REVISION_R1.slice(0, 8) + ' → R2');
  });

  test('archived, invalid, unauthenticated and unauthorized stay distinct', (sandbox) => {
    const cases = [
      ['design_archived', 'Diseño archivado'],
      ['invalid', 'Enlace inválido'],
      ['unauthenticated', 'Sin sesión'],
      ['unauthorized', 'Sin permiso'],
      ['unreachable', 'Servidor no disponible']
    ];
    cases.forEach(([state, badgeText]) => {
      sandbox.window.GraneteDialog.onModelBindingStatus({ state });
      assert.equal(el(sandbox, 'model-binding-badge').textContent, badgeText, state);
      assert.ok(el(sandbox, 'model-binding-badge').className.length > 0, state);
    });
  });

  test('picker flow: projects → designs → connect without rebind flag', (sandbox) => {
    el(sandbox, 'btn-binding-connect').click();
    assert.ok(sandbox.__bridge.some((call) => call.action === 'list_binding_projects'));

    sandbox.window.GraneteDialog.onBindingProjects({
      ok: true,
      entries: [{ id: PROJECT_ID, name: 'Cocina García' }]
    });
    const projectSelect = el(sandbox, 'binding-project-select');
    assert.deepEqual(optionValues(projectSelect), ['', PROJECT_ID]);

    projectSelect.value = PROJECT_ID;
    projectSelect.dispatchEvent({ type: 'change' });
    const listCall = sandbox.__bridge.find((call) => call.action === 'list_binding_designs');
    assert.ok(listCall, 'designs list must be requested');
    assert.equal(listCall.payload.projectId, PROJECT_ID);

    sandbox.window.GraneteDialog.onBindingDesigns({
      ok: true,
      entries: [{ id: DESIGN_ID, name: 'Cocina Principal', status: 'active' }]
    });
    const designSelect = el(sandbox, 'binding-design-select');
    designSelect.value = DESIGN_ID;
    designSelect.dispatchEvent({ type: 'change' });
    const confirmBtn = el(sandbox, 'btn-binding-confirm');
    assert.ok(!confirmBtn.disabled, 'confirm enables with project+design');

    confirmBtn.click();
    const connectCall = sandbox.__bridge.find((call) => call.action === 'connect_model');
    assert.ok(connectCall, 'connect_model must be called');
    assert.equal(connectCall.payload.projectId, PROJECT_ID);
    assert.equal(connectCall.payload.designId, DESIGN_ID);
    assert.notEqual(connectCall.payload.confirmRebind, true);
  });

  test('rebind_required routes through the explicit review, not silent overwrite', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: false,
      code: 'rebind_required',
      reason: 'este modelo ya está conectado a otro diseño',
      current: { projectId: PROJECT_ID, designId: DESIGN_ID },
      target: { projectId: '41000000-0000-0000-0000-000000000009',
                designId: '52000000-0000-0000-0000-000000000009' }
    });
    assert.ok(visible(el(sandbox, 'model-binding-rebind-review')));
    // No connect_model with the new target was issued yet.
    assert.ok(!sandbox.__bridge.some((call) => call.action === 'connect_model'));

    el(sandbox, 'btn-binding-rebind-confirm').click();
    const connectCall = sandbox.__bridge.find((call) => call.action === 'connect_model');
    assert.ok(connectCall, 'confirmed rebind calls connect_model');
    assert.equal(connectCall.payload.confirmRebind, true);
    assert.equal(connectCall.payload.designId, '52000000-0000-0000-0000-000000000009');
  });

  test('failed validation result renders its state and never reports success', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingResult({
      ok: false,
      code: 'validation_failed',
      reason: 'proyecto, diseño o revisión inexistente',
      state: 'invalid'
    });
    assert.equal(el(sandbox, 'model-binding-badge').textContent, 'Enlace inválido');
    assert.ok(visible(el(sandbox, 'btn-binding-connect')));
  });

  test('ok result renders the fresh status', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingResult({ ok: true, status: connectedStatus() });
    assert.equal(el(sandbox, 'model-binding-badge').textContent, 'Conectado');
    assert.ok(!visible(el(sandbox, 'model-binding-picker')));
    assert.ok(!visible(el(sandbox, 'model-binding-rebind-review')));
  });

  test('refresh action asks Ruby to revalidate', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(connectedStatus());
    el(sandbox, 'btn-binding-refresh').click();
    assert.ok(sandbox.__bridge.some((call) => call.action === 'refresh_model_binding'));
  });

  return tests;
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
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((message || 'assert.deepEqual') + ` — expected ${b}, got ${a}`);
};
assert.ok = (condition, message) => {
  if (!condition) throw new Error(message || 'expected truthy');
};
assert.notEqual = (actual, expected, message) => {
  if (actual === expected) {
    throw new Error((message || 'assert.notEqual') + ` — did not expect ${JSON.stringify(expected)}`);
  }
};

const results = [];
let sandbox;
for (const { name, fn } of runTests()) {
  try {
    // Fresh dialog per test so state never bleeds between cases.
    sandbox = runDialog();
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
