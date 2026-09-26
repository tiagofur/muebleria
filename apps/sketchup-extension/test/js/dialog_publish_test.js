// Real JavaScript test harness for the #392 / DT-8 publish panel in
// dialog.html: drives the actual dialog script (vm sandbox + mock DOM) and
// asserts the publish button availability (connected + can_publish_revision
// only), the honest progress steps, the success/failure rendering and that a
// publish in flight blocks a second click.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { dialogSources } = require('./support/dialog_scripts');

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
  el.setAttribute = (name, value) => { el['data-' + name] = value; };
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
    addEventListener: () => {},
    dispatchEvent: (event) => bridgeCalls.push({ action: 'document_event', event })
  };

  const sandbox = {
    console,
    // Timers must NOT fire synchronously: the publish confirmation arms with
    // a 6s reset window — a firing mock would disarm before the assertion
    // runs (same contract as dialog_ux_states_test.js).
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    CustomEvent: function (type, init) { return { type, detail: init && init.detail }; },
    document: documentMock,
    window: {
      addEventListener: () => {},
      sketchup: {
        dialog_ready: () => {},
        get_model_binding: () => bridgeCalls.push({ action: 'get_model_binding' }),
        refresh_model_binding: () => bridgeCalls.push({ action: 'refresh_model_binding' }),
        adopt_binding_base: () => bridgeCalls.push({ action: 'adopt_binding_base' }),
        publish_design_revision: () => bridgeCalls.push({ action: 'publish_design_revision' }),
        validate_design_revision: () => bridgeCalls.push({ action: 'validate_design_revision' }),
        select_project_furniture: (payload) =>
          bridgeCalls.push({ action: 'select_project_furniture', payload: payload }),
        preflight_review: (payload) => bridgeCalls.push({ action: 'preflight_review', payload: payload }),
        select_furniture: (payload) => bridgeCalls.push({ action: 'select_furniture', payload: payload }),
        enroll: () => {}, logout: () => {}, close_dialog: () => {}
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  return sandbox;
}

function runDialog() {
  // The real dialog loads granete-media.js, granete-account.js,
  // granete-library.js, the shared runtime state and the #466 review
  // controller around the inline script: load them so the publish gate is
  // exercised exactly as in the HtmlDialog.
  const resources = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js');
  const stateSource = fs.readFileSync(path.join(resources, 'granete-state.js'), 'utf8');
  const preflightSource = fs.readFileSync(path.join(resources, 'granete-preflight-review.js'), 'utf8');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  const { media, account, library, inline } = dialogSources();
  vm.runInContext(media, sandbox, { filename: 'granete-media.js' });
  vm.runInContext(account, sandbox, { filename: 'granete-account.js' });
  vm.runInContext(library, sandbox, { filename: 'granete-library.js' });
  vm.runInContext(stateSource, sandbox, { filename: 'granete-state.js' });
  vm.runInContext(preflightSource, sandbox, { filename: 'granete-preflight-review.js' });
  vm.runInContext(inline, sandbox, { filename: 'dialog-inline.js' });
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
        hostAvailable: true,
        hostClean: true,
        hostAttention: 0,
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
      { can_edit_working_copy: true, can_publish_revision: true, can_create_initial_quote: true }
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
      status('connected', { can_edit_working_copy: true, can_publish_revision: false, can_create_initial_quote: false }));
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

  // #731 PR2: without a Ruby gate projection the button stays clickable —
  // the click starts the orchestration and Ruby fails closed with the
  // honest scope reason. The informational line stays.
  test('publish button stays actionable without a gate projection', (sandbox) => {
    pushGate(sandbox, null);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const btn = el(sandbox, 'btn-binding-publish');
    assert.ok(visible(btn));
    assert.ok(!btn.disabled, 'the click runs the orchestration; Ruby is the barrier');
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(visible(progress));
    assert.ok(progress.textContent.indexOf('alcance de publicación') >= 0);
  });

  // #731 PR2: unverified furniture no longer walls the button — the click
  // auto-validates the design. The honest scope counts stay visible.
  test('unverified scope furniture keeps the button actionable with honest counts', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 3, verified: 2, pending: 1, unverified: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    assert.ok(!el(sandbox, 'btn-binding-publish').disabled,
      'Publicar diseño now runs the automatic validation');
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('requiere verificar todos los muebles') >= 0);
    assert.ok(progress.textContent.indexOf('3 muebles · 2 verificados · 1 pendiente') >= 0,
      'counts denominator is the canonical #392 scope: ' + progress.textContent);
  });

  test('host divergence keeps an actionable button with an honest count', (sandbox) => {
    pushGate(sandbox, { allowed: false, hostClean: false, hostAttention: 3 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    assert.ok(!el(sandbox, 'btn-binding-publish').disabled);
    assert.ok(el(sandbox, 'binding-publish-progress').textContent.indexOf('3 muebles') >= 0);
    assert.ok(el(sandbox, 'binding-publish-progress').textContent.indexOf('reconciliación') >= 0);
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

  // Review #847 P1: Publicar crea una revisión inmutable. El botón original
  // SÓLO arma una confirmación separada (Cancelar / Publicar revisión);
  // publicar exige esa acción deliberada distinta, así un doble clic físico
  // sobre el botón original jamás atraviesa la frontera.
  test('first click arms a separate confirmation row, not a second-click trap', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 2, verified: 1, pending: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 0, 'the first click only arms; nothing reaches Ruby');
    const row = el(sandbox, 'binding-publish-confirm');
    assert.ok(visible(row), 'the armed state reveals the confirmation row');
    assert.ok(!visible(el(sandbox, 'btn-binding-publish')),
      'the original button hides while armed — the confirm action is distinct');
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(visible(progress));
    assert.ok(progress.textContent.indexOf('revisión inmutable') >= 0,
      'the arm hint explains what confirming creates');
  });

  test('an immediate double click on Publicar diseño never publishes', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-binding-publish').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 0,
      're-clicking the original button re-arms at most; only the separate confirm action publishes');
    assert.ok(visible(el(sandbox, 'binding-publish-confirm')));
  });

  test('explicit confirm publishes exactly once; cancel disarms without publishing', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    let baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-publish-confirm').click();
    let publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 1,
      'arm + explicit confirm reaches Ruby exactly once');
    // Close the cycle like Ruby does, so later tests start idle.
    sandbox.window.GraneteDialog.onPublishResult({ ok: true, revisionNumber: 8, baseRevisionId: 'r8' });

    baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-publish-cancel').click();
    publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 0, 'cancel disarms; nothing reaches Ruby');
    assert.ok(!visible(el(sandbox, 'binding-publish-confirm')),
      'the confirmation row closes on cancel');
    assert.ok(visible(el(sandbox, 'btn-binding-publish')),
      'the original button returns after cancel');
  });

  test('a blocked gate still starts the orchestration on confirm', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 2, verified: 1, pending: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-publish-confirm').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 1,
      'the confirmed action reaches Ruby; the fresh gate there decides');
    // Close the cycle like Ruby does, so later tests start idle.
    sandbox.window.GraneteDialog.onPublishResult({
      ok: false, code: 'preflight_incomplete', reason: 'faltan verificar 2 de 2 muebles del diseño'
    });
  });

  test('click publishes and shows the validating step', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-publish-confirm').click();
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
    el(sandbox, 'btn-publish-confirm').click();
    sandbox.window.GraneteDialog.onPublishResult({ ok: true, revisionNumber: 8, baseRevisionId: 'r8' });

    const progress = el(sandbox, 'binding-publish-progress');
    assert.equal(progress.textContent, 'Diseño publicado · Revisión R8');
    const btn = el(sandbox, 'btn-binding-publish');
    assert.ok(!btn.disabled);
    assert.ok(sandbox.__bridge.some((c) => c.action === 'get_model_binding'));
    assert.ok(!sandbox.__bridge.some((c) => c.action === 'document_event' &&
      c.event.type === 'granete-mutation-state' && c.event.detail.serverSynchronized === true));
  });

  test('failure renders the specific duplicate-identity blocker', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-publish-confirm').click();
    sandbox.window.GraneteDialog.onPublishResult({
      ok: false, code: 'duplicate_furniture_identity', reason: 'FI-001'
    });

    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('copias con la misma identidad') >= 0);
    const btn = el(sandbox, 'btn-binding-publish');
    assert.ok(!btn.disabled);
    assert.equal(btn.textContent, 'Reintentar publicación');
  });

  test('in-flight publish blocks a second click', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    // The bridge journal is cumulative across tests: count from this test's
    // own baseline instead of filtering the whole log.
    const baseline = sandbox.__bridge.length;
    el(sandbox, 'btn-binding-publish').click();
    el(sandbox, 'btn-publish-confirm').click();
    el(sandbox, 'btn-publish-confirm').click();
    const publishCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'publish_design_revision');
    assert.equal(publishCalls.length, 1, 'a publish in flight must not re-enter');
  });

  // ------------------------------------------------------------------
  // #731 PR2 — design-wide validation UX.
  // ------------------------------------------------------------------

  test('design validation progress appends counts to the validating step', (sandbox) => {
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    sandbox.window.GraneteDialog.onPublishProgress({ step: 'validating', detail: 'Validando diseño… 12 de 30' });
    const progress = el(sandbox, 'binding-publish-progress');
    assert.equal(progress.textContent, 'Validando identidad de los muebles… Validando diseño… 12 de 30');
  });

  // Caso 10: 29 ready / 1 blocked shows a summary line and ONLY the
  // exception card — never per-unit success cards.
  test('publish failure with validation shows only the exceptions', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 30, verified: 29, pending: 1, blocked: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    sandbox.window.GraneteDialog.onPublishResult({
      ok: false,
      code: 'preflight_incomplete',
      reason: 'hay muebles con problemas de fabricación',
      validation: {
        total: 30,
        ready: 29,
        attention: 1,
        exceptions: [
          {
            furnitureInstanceId: '51000000-0000-0000-0000-0000000000c3',
            displayName: 'Gabinete Bajo 3 Cajones',
            state: 'blocked',
            reason: null,
            review: {
              groups: [
                { key: 'materials', label: 'Materiales', count: 1, issues: [
                  { issueId: 'issue-0', title: 'Material sin resolver',
                    message: 'FRENTES sin resolver', remediation: 'Elegí el material.',
                    severity: 'error' }
                ] }
              ]
            }
          }
        ]
      }
    });

    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('30 muebles') >= 0);
    assert.ok(progress.textContent.indexOf('29 listos') >= 0);
    assert.ok(progress.textContent.indexOf('1 requiere atención') >= 0);

    const container = el(sandbox, 'binding-publish-exceptions');
    assert.ok(visible(container));
    assert.equal(container.children.length, 1, 'exactly one card: the exception');
    const card = container.children[0];
    assert.equal(card.children[0].children[0].textContent, 'Gabinete Bajo 3 Cajones');
    const detailLine = card.children[1].textContent;
    assert.ok(detailLine.indexOf('Material sin resolver') >= 0, detailLine);
    assert.ok(detailLine.indexOf('FRENTES sin resolver') >= 0, detailLine);
  });

  test('exception card selects by furniture identity and navigates the issue', (sandbox) => {
    pushGate(sandbox, { allowed: false, total: 2, verified: 1, pending: 1, blocked: 1 });
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    sandbox.window.GraneteDialog.onPublishResult({
      ok: false,
      code: 'preflight_incomplete',
      validation: {
        total: 2, ready: 1, attention: 1,
        exceptions: [
          { furnitureInstanceId: '51000000-0000-0000-0000-0000000000c3',
            displayName: 'Gabinete Bajo 3 Cajones', state: 'blocked',
            review: { groups: [{ key: 'materials', label: 'Materiales', count: 1, issues: [
              { issueId: 'issue-0', title: 'Material sin resolver', message: 'x', severity: 'error' }
            ] }] } }
        ]
      }
    });

    const container = el(sandbox, 'binding-publish-exceptions');
    const card = container.children[0];
    const actions = card.children[card.children.length - 1];
    const baseline = sandbox.__bridge.length;
    actions.children[0].click(); // [Seleccionar]
    const selectCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'select_project_furniture');
    assert.equal(selectCalls.length, 1);
    assert.ok(selectCalls[0].payload.indexOf('51000000-0000-0000-0000-0000000000c3') >= 0);

    const baseline2 = sandbox.__bridge.length;
    actions.children[1].click(); // [Ir al origen]
    const navigateCalls = sandbox.__bridge.slice(baseline2)
      .filter((c) => c.action === 'preflight_review');
    assert.equal(navigateCalls.length, 1, 'navigation reuses the #466 navigate_issue channel');
    const envelope = JSON.parse(navigateCalls[0].payload);
    assert.equal('navigate_issue', envelope.command);
    assert.equal('51000000-0000-0000-0000-0000000000c3', envelope.semanticTarget.furnitureInstanceId);
  });

  test('publish success clears the exceptions view', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    sandbox.window.GraneteDialog.onPublishResult({
      ok: false, code: 'preflight_incomplete', validation: {
        total: 1, ready: 0, attention: 1,
        exceptions: [{ furnitureInstanceId: 'x', state: 'unverified' }]
      }
    });
    assert.ok(visible(el(sandbox, 'binding-publish-exceptions')));

    sandbox.window.GraneteDialog.onPublishResult({ ok: true, revisionNumber: 3 });
    assert.ok(!visible(el(sandbox, 'binding-publish-exceptions')));
  });

  // Entrega D: Validar diseño runs the same batch without publishing.
  test('validate design button starts the same batch without publishing', (sandbox) => {
    pushGate(sandbox);
    sandbox.window.GraneteDialog.onModelBindingStatus(status('connected'));
    const btn = el(sandbox, 'btn-design-validate');
    assert.ok(visible(btn));
    assert.ok(!btn.disabled);

    const baseline = sandbox.__bridge.length;
    btn.click();
    const validateCalls = sandbox.__bridge.slice(baseline)
      .filter((c) => c.action === 'validate_design_revision');
    assert.equal(validateCalls.length, 1);
    assert.equal(btn.textContent, 'Validando…');

    sandbox.window.GraneteDialog.onDesignValidationResult({
      ok: true,
      validation: { total: 4, ready: 4, attention: 0, exceptions: [] }
    });
    assert.equal(btn.textContent, 'Validar diseño');
    assert.ok(!btn.disabled);
    const progress = el(sandbox, 'binding-publish-progress');
    assert.ok(progress.textContent.indexOf('4 listos') >= 0);
    assert.ok(!visible(el(sandbox, 'binding-publish-exceptions')));
  });

  // Entrega G: the binding refresh copy no longer promises manufacturing
  // validation — it refreshes the connection.
  test('binding refresh copy is Actualizar conexión, not Validar de nuevo', () => {
    const html = fs.readFileSync(
      path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html'), 'utf8');
    assert.ok(html.indexOf('Actualizar conexión') >= 0);
    assert.equal(html.indexOf('>Validar de nuevo<'), -1,
      'the misleading copy must not survive in the binding context');
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
