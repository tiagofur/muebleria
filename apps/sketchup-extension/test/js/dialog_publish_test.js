// Real JavaScript test harness for the #392 / DT-8 publish panel in
// dialog.html: drives the actual dialog script (vm sandbox + mock DOM) and
// asserts the publish button availability (connected + can_publish_revision
// only), the honest progress steps, the success/failure rendering and that a
// publish in flight blocks a second click.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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
    createElement: () => createMockElement(''),
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
        dialog_ready: () => {},
        get_model_binding: () => bridgeCalls.push({ action: 'get_model_binding' }),
        refresh_model_binding: () => bridgeCalls.push({ action: 'refresh_model_binding' }),
        adopt_binding_base: () => bridgeCalls.push({ action: 'adopt_binding_base' }),
        publish_design_revision: () => bridgeCalls.push({ action: 'publish_design_revision' }),
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
  const resources = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js');
  // The real dialog loads the shared runtime state + the #466 review
  // controller before the inline script: load them so the publish gate is
  // exercised exactly as in the HtmlDialog.
  const stateSource = fs.readFileSync(path.join(resources, 'granete-state.js'), 'utf8');
  const preflightSource = fs.readFileSync(path.join(resources, 'granete-preflight-review.js'), 'utf8');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(stateSource, sandbox, { filename: 'granete-state.js' });
  vm.runInContext(preflightSource, sandbox, { filename: 'granete-preflight-review.js' });
  vm.runInContext(scriptMatch[1], sandbox);
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

// Pushes a Ruby-composed design-wide publication gate projection (#466)
// into the preflight slice — the only shape that may unblock publication.
// `null` clears the projection (fail-closed state).
function pushGate(sandbox, overrides) {
  var gate = overrides === null
    ? null
    : Object.assign({
        scopeAvailable: true,
        allowed: true,
        total: 1,
        verified: 1,
        pending: 0,
        blocked: 0,
        stale: 0,
        unavailable: 0,
        unverified: 0
      }, overrides || {});
  sandbox.window.GraneteState.set('preflight', { entries: {}, review: null, gate: gate });
}

const PROJECT_ID = '41000000-0000-0000-0000-000000000001';
const DESIGN_ID = '52000000-0000-0000-0000-000000000001';
const REVISION_R7 = '53000000-0000-0000-0000-000000000007';

function status(state, capabilities) {
  return {
    state: state,
    binding: {
      projectId: PROJECT_ID,
      designId: DESIGN_ID,
      baseRevisionId: REVISION_R7,
      organizationName: 'Carpintería García',
      projectName: 'Cocina García',
      designName: 'Cocina Principal',
      designStatus: 'active'
    },
    authoritativeBaseRevisionId: REVISION_R7,
    authoritativeBaseRevisionNumber: 7,
    capabilities: capabilities ||
      { can_edit_working_copy: true, can_publish_revision: true }
  };
}

function runTests() {
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  test('publish button hidden when unbound', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(status('unbound'));
    assert.ok(!visible(el(sandbox, 'btn-binding-publish')));
  });

  test('publish button hidden on stale base', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(status('stale_base'));
    assert.ok(!visible(el(sandbox, 'btn-binding-publish')));
  });

  test('publish button hidden without the server capability', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(
      status('connected', { can_edit_working_copy: true, can_publish_revision: false }));
    assert.ok(!visible(el(sandbox, 'btn-binding-publish')));
  });

  test('publish button available when connected with capability and the design-wide gate allows', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const btn = el(sandbox, 'btn-binding-publish');
    assert.ok(visible(btn));
    assert.ok(!btn.disabled);
    assert.equal(btn.textContent, 'Publicar diseño');
    assert.ok(!visible(el(sandbox, 'binding-publish-progress')));
  });

  // #466 design-wide gate: without a Ruby gate projection the button stays
  // fail-closed — tracker entries alone can never unblock publication.
  test('publish button disabled without a gate projection', (sandbox) => {
    pushGate(sandbox, null);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const btn = el(sandbox, 'btn-binding-publish');
    assert.ok(visible(btn));
    assert.ok(btn.disabled);
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(visible(progress));
    assert.ok(progress.textContent.indexOf('alcance de publicación') >= 0);
  });

  test('unverified scope furniture blocks with honest scope counts', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 3, verified: 2, pending: 1, unverified: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    assert.ok(el(sandbox, 'btn-binding-publish').disabled);
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('requiere verificar todos los muebles') >= 0);
    assert.ok(progress.textContent.indexOf('3 muebles · 2 verificados · 1 pendiente') >= 0,
      'counts denominator is the canonical #392 scope: ' + progress.textContent);
  });

  test('blocked scope furniture explains manufacturing problems', (sandbox) => {
    pushGate(sandbox, { allowed: false, blocked: 1, pending: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('problemas de fabricación') >= 0);
  });

  test('stale scope furniture explains the outdated review', (sandbox) => {
    pushGate(sandbox, { allowed: false, stale: 1, pending: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('quedó desactualizada') >= 0);
    assert.ok(progress.textContent.indexOf('Volvé a verificar') >= 0);
  });

  test('unavailable scope furniture explains the unconfirmed state', (sandbox) => {
    pushGate(sandbox, { allowed: false, unavailable: 1, pending: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('No se pudo confirmar el estado de fabricación') >= 0);
  });

  test('a blocked gate swallows the click before the host callback', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 2, verified: 1, pending: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 0, 'a closed gate must not reach the publisher');
  });

  test('click publishes and shows the validating step', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 1);
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(visible(progress));
    assert.equal(progress.textContent, 'Validando identidad de los muebles…');
  });

  test('progress steps render distinctly', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const progress = el(sandbox, 'binding-publish-progress');
    sandbox.window.GraneteDialog.onPublishProgress({ step: 'validating' });
    assert.equal(progress.textContent, 'Validando identidad de los muebles…');
    sandbox.window.GraneteDialog.onPublishProgress({ step: 'syncing' });
    assert.equal(progress.textContent, 'Sincronizando borrador de trabajo…');
    sandbox.window.GraneteDialog.onPublishProgress({ step: 'exporting' });
    assert.equal(progress.textContent, 'Guardando modelo y preview…');
    sandbox.window.GraneteDialog.onPublishProgress({ step: 'uploading' });
    assert.equal(progress.textContent, 'Subiendo archivos…');
    sandbox.window.GraneteDialog.onPublishProgress({ step: 'publishing' });
    assert.equal(progress.textContent, 'Publicando revisión…');
  });

  test('success renders the published revision and refreshes the binding', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    el(sandbox, 'btn-binding-publish').click();
    sandbox.window.GraneteDialog.onPublishResult({ ok: true, revisionNumber: 8, baseRevisionId: 'r8' });

    const progress = el(sandbox, 'binding-publish-progress');
    assert.equal(progress.textContent, 'Diseño publicado · Revisión R8');
    const btn = el(sandbox, 'btn-binding-publish');
    assert.ok(!btn.disabled);
    assert.ok(sandbox.__bridge.some((c) => c.action === 'get_model_binding'));
  });

  test('failure renders the specific duplicate-identity blocker', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    el(sandbox, 'btn-binding-publish').click();
    sandbox.window.GraneteDialog.onPublishResult({
      ok: false, code: 'duplicate_furniture_identity', reason: 'FI-001'
    });

    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('copias con la misma identidad') >= 0);
    assert.ok(!el(sandbox, 'btn-binding-publish').disabled);
  });

  test('in-flight publish blocks a second click', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    // The bridge journal is cumulative across tests: count from this test's
    // own baseline instead of filtering the whole log.
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-binding-publish').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 1, 'a publish in flight must not re-enter');
  });

  const sandbox = runDialog();
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    try {
      t.fn(sandbox);
      passed += 1;
    } catch (err) {
      failures.push({ name: t.name, error: String(err && err.message) });
    }
  }
  if (failures.length > 0) {
    console.error(JSON.stringify({ success: false, testsPassed: passed, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ success: true, testsPassed: passed }));
}

runTests();
