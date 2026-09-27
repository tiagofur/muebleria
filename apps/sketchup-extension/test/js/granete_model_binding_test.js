// #848 Phase B C4.8 — real JavaScript harness for granete-model-binding.js:
// the Model ↔ Project/Design binding authority under
// window.GraneteUI.modelBinding. Drives the actual module file in a vm
// sandbox (mock DOM, fake timers, recording sketchup/GraneteState/
// GranetePreflightReview/GraneteCommercialProjection stubs) and proves the
// ownership contract: registration + idempotent re-execution, the nine
// distinct binding states + reason/base-label copy, the temporary Project
// Furniture invalidation seam, the Configurator presentation seam, the
// manual bind/rebind picker, the pairing-code flow (#499), the publish
// confirmation/orchestration (#392/#847: 6 s arm timer, separate confirm
// action, double-click protection), the #466 publish-gate VIEW (never
// recomputed locally) and the #731 design-wide validation UX.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-model-binding.js');
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
  const listeners = {};
  const children = [];
  const el = {
    id,
    tagName,
    children,
    listeners,
    style: {},
    disabled: false,
    value: '',
    selected: false,
    type: '',
    focus: () => {},
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    dispatchEvent: (event) => {
      (listeners[event.type] || []).forEach((cb) => cb(event));
      return true;
    },
    click: () => {
      (listeners.click || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    appendChild: (child) => { children.push(child); return child; },
    setAttribute: (name, value) => { el[name] = value; },
    get innerHTML() { return ''; },
    set innerHTML(val) { children.length = 0; },
    textContent: '',
    className: ''
  };
  return el;
}

// Fresh sandbox per test. The module file runs verbatim; init() receives
// recording deps. Pass { skipInit: true } for the fail-fast test or
// { partialDeps: [...] } to init with a missing dep.
function runModule(options) {
  options = options || {};
  const registry = {};
  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag),
    addEventListener: (evt, cb) => {
      documentListeners[evt] = documentListeners[evt] || [];
      documentListeners[evt].push(cb);
    }
  };
  const documentListeners = {};
  const bridge = [];
  const toasts = [];
  const pfInvalidations = { count: 0 };
  const subscribers = [];
  const insertButtonCalls = { count: 0 };
  const commercialBindings = [];
  const timers = [];

  const sandbox = {
    document: documentMock,
    window: {
      GraneteUI: {
        configurator: {
          updateInsertButton: () => { insertButtonCalls.count += 1; }
        }
      },
      sketchup: {
        list_binding_projects: () => bridge.push({ action: 'list_binding_projects' }),
        list_binding_designs: (payload) => bridge.push({ action: 'list_binding_designs', payload: JSON.parse(payload) }),
        connect_model: (payload) => bridge.push({ action: 'connect_model', payload: JSON.parse(payload) }),
        connect_with_code: (payload) => bridge.push({ action: 'connect_with_code', payload: JSON.parse(payload) }),
        refresh_model_binding: () => bridge.push({ action: 'refresh_model_binding' }),
        adopt_binding_base: () => bridge.push({ action: 'adopt_binding_base' }),
        get_model_binding: () => bridge.push({ action: 'get_model_binding' }),
        publish_design_revision: () => bridge.push({ action: 'publish_design_revision' }),
        validate_design_revision: () => bridge.push({ action: 'validate_design_revision' }),
        select_project_furniture: (payload) => bridge.push({ action: 'select_project_furniture', payload: JSON.parse(payload) })
      },
      GraneteState: {
        subscribe: (fn) => { subscribers.push(fn); }
      },
      GranetePreflightReview: {
        blocked: false,
        gate: null,
        publishBlocked() { return this.blocked; },
        publicationGate() { return this.gate; },
        navigateFurnitureIssue: (furnitureInstanceId, issueId, region) =>
          bridge.push({ action: 'navigate_furniture_issue', furnitureInstanceId, issueId, region })
      },
      GraneteCommercialProjection: {
        setBinding: (status) => commercialBindings.push(status)
      }
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridge;
  sandbox.__timers = timers;
  sandbox.__subscribers = subscribers;
  sandbox.__documentListeners = documentListeners;
  sandbox.__calls = { toasts, pfInvalidations, insertButtonCalls, commercialBindings };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-model-binding.js' });

  sandbox.init = (deps) => {
    sandbox.window.GraneteUI.modelBinding.init(deps || {
      showToast: (type, message) => toasts.push({ type, message }),
      invalidateProjectFurniture: () => { pfInvalidations.count += 1; }
    });
  };
  if (!options.skipInit) {
    if (options.partialDeps) {
      const partial = {};
      (options.partialDeps || []).forEach((name) => {
        partial[name] = name === 'showToast'
          ? (type, message) => toasts.push({ type, message })
          : () => { pfInvalidations.count += 1; };
      });
      sandbox.init(partial);
    } else {
      sandbox.init();
    }
  }
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const CONNECTED = {
  state: 'connected',
  binding: {
    organizationName: 'Taller Norte',
    customerName: 'Juana Pérez',
    projectName: 'Cocina Sur',
    designName: 'Cocina v2',
    baseRevisionId: 'abcdef1234567890'
  },
  authoritativeBaseRevisionNumber: 3,
  capabilities: { can_publish_revision: true }
};

// ---------------------------------------------------------------------
// Registration / API
// ---------------------------------------------------------------------

test('registration: namespace, exact public API and idempotent re-execution', () => {
  const sandbox = runModule();
  const mb = sandbox.window.GraneteUI.modelBinding;
  assert.ok(mb, 'module registers window.GraneteUI.modelBinding');
  ['init', 'setStatus', 'onResult', 'onPublishProgress', 'onPublishResult',
    'onDesignValidationProgress', 'onDesignValidationResult',
    'onBindingProjects', 'onBindingDesigns', 'isConnected'].forEach((entry) => {
    assert.strictEqual(typeof mb[entry], 'function', 'public API entry: ' + entry);
  });
  assert.strictEqual(Object.keys(mb).length, 10, 'exactly the 10 audited public entries');

  const connectListenersBefore = el(sandbox, 'btn-binding-connect').listeners.click.length;
  const keydownBefore = sandbox.__documentListeners.keydown.length;
  const subscribersBefore = sandbox.__subscribers.length;
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-model-binding.js' });
  assert.strictEqual(sandbox.window.GraneteUI.modelBinding, mb, 'same namespace object after re-execution');
  assert.strictEqual(el(sandbox, 'btn-binding-connect').listeners.click.length, connectListenersBefore,
    're-execution must not duplicate element listeners');
  assert.strictEqual(sandbox.__documentListeners.keydown.length, keydownBefore,
    're-execution must not duplicate the document keydown listener');
  assert.strictEqual(sandbox.__subscribers.length, subscribersBefore,
    're-execution must not duplicate the GraneteState subscription');
});

test('init fail-fast: public render entries refuse to run without deps', () => {
  const sandbox = runModule({ skipInit: true });
  const mb = sandbox.window.GraneteUI.modelBinding;
  assert.throws(() => mb.setStatus({ state: 'unbound' }), /missing deps: showToast, invalidateProjectFurniture/);
  assert.throws(() => mb.onResult({}), /missing deps/);
  assert.throws(() => mb.onPublishProgress({ step: 'validating' }), /missing deps/);
  assert.throws(() => mb.onPublishResult({ ok: true }), /missing deps/);
  assert.throws(() => mb.onBindingProjects({ ok: true, entries: [] }), /missing deps/);

  const partial = runModule({ partialDeps: ['showToast'] });
  assert.throws(() => partial.window.GraneteUI.modelBinding.setStatus({ state: 'unbound' }),
    /missing deps: invalidateProjectFurniture/, 'partial init fails fast listing the missing dep');
});

// ---------------------------------------------------------------------
// Status rendering
// ---------------------------------------------------------------------

test('setStatus(null) renders the unbound fallback exactly like the old call', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus(null);
  const badge = el(sandbox, 'model-binding-badge');
  assert.strictEqual(badge.textContent, 'Sin conectar');
  assert.strictEqual(badge.className, 'status-badge pending');
  assert.strictEqual(el(sandbox, 'model-binding-detail').textContent,
    'Conectá este modelo a un proyecto y diseño de Granete para trabajar sobre su contexto exacto.');
  assert.ok(visible(el(sandbox, 'btn-binding-connect')), 'connect offered when unbound');
  assert.strictEqual(el(sandbox, 'btn-bootstrap-project').style.display, 'block',
    'bootstrap-project button follows the unbound state');
  assert.ok(visible(el(sandbox, 'pairing-entry')), 'pairing entry offered when unbound');
  assert.ok(!visible(el(sandbox, 'btn-binding-refresh')), 'refresh hidden when unbound');
  assert.ok(!visible(el(sandbox, 'btn-binding-adopt')), 'adopt hidden when unbound');
});

test('connected status fills the binding card, hides connect/pairing and gates publish', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  const badge = el(sandbox, 'model-binding-badge');
  assert.strictEqual(badge.textContent, 'Conectado');
  assert.strictEqual(badge.className, 'status-badge valid');
  assert.strictEqual(el(sandbox, 'model-binding-info').style.display, 'block');
  assert.strictEqual(el(sandbox, 'binding-org-name').textContent, 'Taller Norte');
  assert.strictEqual(el(sandbox, 'binding-customer-name').textContent, 'Juana Pérez');
  assert.strictEqual(el(sandbox, 'binding-project-name').textContent, 'Cocina Sur');
  assert.strictEqual(el(sandbox, 'binding-design-name').textContent, 'Cocina v2');
  assert.strictEqual(el(sandbox, 'binding-base-revision').textContent, 'R3',
    'base label prefers the authoritative revision number');
  assert.strictEqual(el(sandbox, 'btn-binding-connect').style.display, 'none');
  assert.strictEqual(el(sandbox, 'pairing-entry').style.display, 'none',
    'once linked there is nothing to connect (#499/#388)');
  assert.strictEqual(el(sandbox, 'btn-binding-refresh').style.display, 'block');
  assert.strictEqual(el(sandbox, 'btn-binding-adopt').style.display, 'none');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').style.display, 'block',
    'publish visible with the can_publish_revision capability');
  assert.ok(sandbox.window.GraneteUI.modelBinding.isConnected(), 'isConnected true when connected');
});

test('connected without can_publish_revision keeps the publish button hidden', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus({
    state: 'connected',
    binding: { baseRevisionId: 'abcdef1234567890' },
    capabilities: {}
  });
  assert.strictEqual(el(sandbox, 'btn-binding-publish').style.display, 'none');
  assert.strictEqual(el(sandbox, 'btn-design-validate').style.display, 'none');
  assert.strictEqual(sandbox.window.GraneteUI.modelBinding.isConnected(), true,
    'isConnected reflects the connection state, not the publish capability');
});

test('stale_base renders the warning badge, the base arrow and the adopt action', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus({
    state: 'stale_base',
    binding: { baseRevisionId: 'abcdef1234567890' },
    authoritativeBaseRevisionNumber: 4
  });
  const badge = el(sandbox, 'model-binding-badge');
  assert.strictEqual(badge.textContent, 'Base desactualizada');
  assert.strictEqual(badge.className, 'status-badge conflict');
  assert.strictEqual(el(sandbox, 'binding-base-revision').textContent, 'abcdef12 → R4',
    'stale base shows current → next');
  assert.strictEqual(el(sandbox, 'btn-binding-adopt').style.display, 'block');
  assert.strictEqual(el(sandbox, 'btn-binding-refresh').style.display, 'block');
  assert.ok(!sandbox.window.GraneteUI.modelBinding.isConnected());
});

test('stale_base without an authoritative number falls back to the id slice / sin publicar', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus({
    state: 'stale_base',
    binding: { baseRevisionId: 'abcdef1234567890' },
    authoritativeBaseRevisionId: '1234abcd1234abcd'
  });
  assert.strictEqual(el(sandbox, 'binding-base-revision').textContent, 'abcdef12 → 1234abcd');

  sandbox.window.GraneteUI.modelBinding.setStatus({ state: 'stale_base', binding: {} });
  assert.strictEqual(el(sandbox, 'binding-base-revision').textContent, 'sin publicar → sin publicar');
});

test('bound states without a published base label as Sin publicar', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus({ state: 'connected', binding: {} });
  assert.strictEqual(el(sandbox, 'binding-base-revision').textContent, 'Sin publicar');

  sandbox.window.GraneteUI.modelBinding.setStatus({
    state: 'connected',
    binding: { baseRevisionId: 'deadbeefdeadbeef' }
  });
  assert.strictEqual(el(sandbox, 'binding-base-revision').textContent, 'Rdeadbeef',
    'R-prefixed id slice when no authoritative number exists');
});

test('error states render their exact copy and append the reason', () => {
  const sandbox = runModule();
  const expectations = [
    ['design_archived', 'Diseño archivado', 'status-badge invalid'],
    ['invalid', 'Enlace inválido', 'status-badge invalid'],
    ['incompatible', 'Versión incompatible', 'status-badge invalid'],
    ['unauthenticated', 'Sin sesión', 'status-badge invalid'],
    ['unauthorized', 'Sin permiso', 'status-badge invalid'],
    ['unreachable', 'Servidor no disponible', 'status-badge pending']
  ];
  expectations.forEach(([state, badgeText, cls]) => {
    sandbox.window.GraneteUI.modelBinding.setStatus({ state, reason: 'porque no' });
    const badge = el(sandbox, 'model-binding-badge');
    assert.strictEqual(badge.textContent, badgeText, state + ' badge');
    assert.strictEqual(badge.className, cls, state + ' badge class');
    assert.ok(el(sandbox, 'model-binding-detail').textContent.includes('(porque no)'),
      state + ' appends the reason');
    assert.ok(!sandbox.window.GraneteUI.modelBinding.isConnected(), state + ' not connected');
  });
  // unreachable is bound: the saved link is preserved and refresh offered.
  sandbox.window.GraneteUI.modelBinding.setStatus({
    state: 'unreachable',
    binding: { projectName: 'Cocina Sur' }
  });
  assert.strictEqual(el(sandbox, 'model-binding-info').style.display, 'block');
  assert.strictEqual(el(sandbox, 'btn-binding-refresh').style.display, 'block');
  assert.ok(el(sandbox, 'model-binding-detail').textContent.includes(
    'No se pudo contactar al servidor. El enlace guardado se conserva; probá de nuevo.'));
});

test('unknown states fall closed to the invalid copy', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus({ state: 'something_new' });
  assert.strictEqual(el(sandbox, 'model-binding-badge').textContent, 'Enlace inválido');
});

// ---------------------------------------------------------------------
// Temporary Project Furniture seam + Configurator seam
// ---------------------------------------------------------------------

test('every status render invalidates Project Furniture exactly once', () => {
  const sandbox = runModule();
  assert.strictEqual(sandbox.__calls.pfInvalidations.count, 0, 'init does not render');

  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  assert.strictEqual(sandbox.__calls.pfInvalidations.count, 1);
  sandbox.window.GraneteUI.modelBinding.setStatus({ state: 'unbound' });
  assert.strictEqual(sandbox.__calls.pfInvalidations.count, 2,
    'each render invalidates exactly once — the seam, not a second PF authority');
});

test('the module carries no Project Furniture state (structural)', () => {
  const code = SOURCE.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!code.includes('lastPfState'), 'no lastPfState copy in the module');
  assert.ok(!code.includes('requestProjectFurniture'), 'no PF reload in the module');
  assert.ok(!code.includes('pfPlacing'), 'no PF placing state in the module');
});

test('status changes drive the Configurator insert-button presentation', () => {
  const sandbox = runModule();
  const before = sandbox.__calls.insertButtonCalls.count;
  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  assert.strictEqual(sandbox.__calls.insertButtonCalls.count, before + 1,
    'renderModelBindingStatus still calls configurator.updateInsertButton');
});

// ---------------------------------------------------------------------
// Manual bind / rebind / refresh / adopt
// ---------------------------------------------------------------------

test('connect opens the picker and asks Ruby for the project list', () => {
  const sandbox = runModule();
  el(sandbox, 'btn-binding-connect').click();
  assert.strictEqual(el(sandbox, 'model-binding-picker').style.display, 'block');
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').disabled, true);
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').textContent, 'Conectar');
  const projectOptions = el(sandbox, 'binding-project-select').children;
  // fillSelect with an empty entries array always renders
  // "Sin opciones disponibles" — the passed placeholder never shows
  // (pre-existing quirk, preserved verbatim from the inline block).
  assert.strictEqual(projectOptions[0].textContent, 'Sin opciones disponibles');
  const designOptions = el(sandbox, 'binding-design-select').children;
  assert.strictEqual(designOptions[0].textContent, 'Sin opciones disponibles');
  assert.ok(sandbox.__bridge.find((c) => c.action === 'list_binding_projects'), 'bridge asked');
});

test('picker without the host bridge fails closed with the exact copy', () => {
  const sandbox = runModule();
  delete sandbox.window.sketchup;
  el(sandbox, 'btn-binding-connect').click();
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'error');
  assert.strictEqual(toast.message, 'Conexión disponible sólo dentro de SketchUp.');
});

test('onBindingProjects fills the select; failures toast and reset it', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onBindingProjects({
    ok: true,
    entries: [{ id: 'p1', name: 'Cocina Sur' }, { id: 'p2', name: 'Mesa' }]
  });
  const options = el(sandbox, 'binding-project-select').children;
  assert.strictEqual(options.length, 3);
  assert.strictEqual(options[1].value, 'p1');
  assert.strictEqual(options[1].textContent, 'Cocina Sur');

  sandbox.window.GraneteUI.modelBinding.onBindingProjects({ ok: false, reason: 'boom' });
  assert.strictEqual(el(sandbox, 'binding-project-select').children[0].textContent,
    'Sin opciones disponibles', 'empty reset keeps the fillSelect quirk');
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.message, 'No se pudieron listar los proyectos: boom');
});

test('onBindingDesigns labels statuses and guards the unauthenticated toast', () => {
  const sandbox = runModule();
  el(sandbox, 'binding-project-select').value = 'p1';
  sandbox.window.GraneteUI.modelBinding.onBindingDesigns({
    ok: true,
    entries: [
      { id: 'd1', name: 'Cocina v1', status: 'archived' },
      { id: 'd2', name: 'Cocina v2', status: 'draft' },
      { id: 'd3', name: 'Cocina v3', status: 'active' }
    ]
  });
  const options = el(sandbox, 'binding-design-select').children;
  assert.strictEqual(options[1].textContent, 'Cocina v1 (archivado)');
  assert.strictEqual(options[2].textContent, 'Cocina v2 (borrador)');
  assert.strictEqual(options[3].textContent, 'Cocina v3 (activo)');
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').disabled, true,
    'still disabled until the user picks a design (placeholder selected)');
  const designSelect = el(sandbox, 'binding-design-select');
  designSelect.value = 'd2';
  designSelect.dispatchEvent({ type: 'change', preventDefault: () => {} });
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').disabled, false,
    'project + design selected enables confirm');

  const toastsBefore = sandbox.__calls.toasts.length;
  sandbox.window.GraneteUI.modelBinding.onBindingDesigns({ ok: false, code: 'unauthenticated' });
  assert.strictEqual(sandbox.__calls.toasts.length, toastsBefore,
    'unauthenticated design listing stays silent (the pill already explains)');
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').disabled, true);

  sandbox.window.GraneteUI.modelBinding.onBindingDesigns({ ok: false, reason: 'boom' });
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.message, 'No se pudieron listar los diseños: boom');
});

test('changing the project reloads the design list with the exact payload', () => {
  const sandbox = runModule();
  const projectSelect = el(sandbox, 'binding-project-select');
  projectSelect.value = 'p9';
  projectSelect.dispatchEvent({ type: 'change', preventDefault: () => {} });
  assert.strictEqual(el(sandbox, 'binding-design-select').children[0].textContent,
    'Sin opciones disponibles', 'empty reset keeps the fillSelect quirk');
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').disabled, true);
  const call = sandbox.__bridge.find((c) => c.action === 'list_binding_designs');
  assert.deepStrictEqual(call.payload, { projectId: 'p9' });
});

test('confirm connects with the exact payload and confirmRebind only on explicit rebind', () => {
  const sandbox = runModule();
  el(sandbox, 'binding-project-select').value = 'p1';
  el(sandbox, 'binding-design-select').value = 'd2';
  el(sandbox, 'btn-binding-confirm').click();
  const call = sandbox.__bridge.find((c) => c.action === 'connect_model');
  assert.deepStrictEqual(call.payload, { projectId: 'p1', designId: 'd2', confirmRebind: false });
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').disabled, true);
  assert.strictEqual(el(sandbox, 'btn-binding-confirm').textContent, 'Validando…');

  const rebind = runModule();
  rebind.window.GraneteUI.modelBinding.onResult({ ok: false, code: 'rebind_required', target: { projectId: 'p1', designId: 'd2' } });
  assert.strictEqual(el(rebind, 'model-binding-picker').style.display, 'none');
  assert.strictEqual(el(rebind, 'model-binding-rebind-review').style.display, 'block');
  el(rebind, 'btn-binding-rebind-confirm').click();
  const rebindCall = rebind.__bridge.find((c) => c.action === 'connect_model');
  assert.deepStrictEqual(rebindCall.payload, { projectId: 'p1', designId: 'd2', confirmRebind: true },
    'confirmRebind only true on the explicit rebind confirmation');

  el(rebind, 'btn-binding-rebind-cancel').click();
  assert.strictEqual(el(rebind, 'model-binding-rebind-review').style.display, 'none');
});

test('cancel hides the picker; refresh and adopt call their exact bridges', () => {
  const sandbox = runModule();
  el(sandbox, 'btn-binding-connect').click();
  el(sandbox, 'btn-binding-cancel').click();
  assert.strictEqual(el(sandbox, 'model-binding-picker').style.display, 'none');

  el(sandbox, 'btn-binding-refresh').click();
  assert.ok(sandbox.__bridge.find((c) => c.action === 'refresh_model_binding'));
  el(sandbox, 'btn-binding-adopt').click();
  assert.ok(sandbox.__bridge.find((c) => c.action === 'adopt_binding_base'));
});

// ---------------------------------------------------------------------
// Pairing (#499 Slice 3)
// ---------------------------------------------------------------------

function submitPairing(sandbox, code) {
  const input = el(sandbox, 'pairing-code-input');
  input.value = code;
  el(sandbox, 'btn-pairing-connect').click();
}

test('pairing submit trims and sends the exact payload; empty never reaches the bridge', () => {
  const sandbox = runModule();
  submitPairing(sandbox, '   ');
  assert.strictEqual(sandbox.__bridge.length, 0, 'empty code: no bridge call');
  assert.strictEqual(el(sandbox, 'pairing-message').textContent, 'Pegá el código que te muestra la web.');
  assert.strictEqual(el(sandbox, 'pairing-message').style.display, 'block');

  submitPairing(sandbox, '  ABC-123  ');
  const call = sandbox.__bridge.find((c) => c.action === 'connect_with_code');
  assert.deepStrictEqual(call.payload, { code: 'ABC-123' }, 'trimmed exact payload');
  assert.strictEqual(el(sandbox, 'btn-pairing-connect').disabled, true);
  assert.strictEqual(el(sandbox, 'pairing-code-input').disabled, true);
  assert.strictEqual(el(sandbox, 'btn-pairing-connect').textContent, 'Conectando…');
  assert.strictEqual(el(sandbox, 'pairing-message').textContent, 'Conectando con Granete…');
});

test('pairing Enter submits; the raw code never persists beyond the input', () => {
  const sandbox = runModule();
  const input = el(sandbox, 'pairing-code-input');
  input.value = 'ABC-123';
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
  assert.ok(sandbox.__bridge.find((c) => c.action === 'connect_with_code'), 'Enter submitted');
});

test('pairing without the bridge recovers with the exact message', () => {
  const sandbox = runModule();
  delete sandbox.window.sketchup;
  submitPairing(sandbox, 'ABC-123');
  assert.strictEqual(el(sandbox, 'btn-pairing-connect').disabled, false, 'busy released');
  assert.strictEqual(el(sandbox, 'pairing-message').textContent, 'La conexión con Granete no está disponible.');
});

test('pairing success clears the input and shows the hint; confirmationFailed keeps the honest copy', () => {
  const sandbox = runModule();
  submitPairing(sandbox, 'ABC-123');
  sandbox.window.GraneteUI.modelBinding.onResult({
    ok: true, pairing: true, status: { state: 'connected', binding: {} }
  });
  assert.strictEqual(el(sandbox, 'pairing-code-input').value, '', 'success clears the input');
  assert.strictEqual(el(sandbox, 'btn-pairing-connect').disabled, false);
  assert.strictEqual(el(sandbox, 'pairing-message').textContent, 'Diseño vinculado en SketchUp.');
  assert.strictEqual(sandbox.__calls.toasts.length, 0,
    'pairing success uses the pairing message, not the manual toast');

  const failed = runModule();
  submitPairing(failed, 'ABC-123');
  failed.window.GraneteUI.modelBinding.onResult({
    ok: true, pairing: true, confirmationFailed: true, reason: 'web no confirmó',
    status: { state: 'connected', binding: {} }
  });
  assert.strictEqual(el(failed, 'pairing-message').textContent, 'web no confirmó',
    'the server reason wins when present');

  const failedNoReason = runModule();
  submitPairing(failedNoReason, 'ABC-123');
  failedNoReason.window.GraneteUI.modelBinding.onResult({
    ok: true, pairing: true, confirmationFailed: true,
    status: { state: 'connected', binding: {} }
  });
  assert.strictEqual(el(failedNoReason, 'pairing-message').textContent,
    'El modelo quedó conectado, pero la web no registró la confirmación.');
});

test('invalid_code keeps the value editable; code_not_found/code_unusable clear it', () => {
  const sandbox = runModule();
  submitPairing(sandbox, 'WRONG');
  sandbox.window.GraneteUI.modelBinding.onResult({
    ok: false, pairing: true, code: 'invalid_code', reason: 'formato'
  });
  assert.strictEqual(el(sandbox, 'pairing-message').textContent, 'formato');
  assert.strictEqual(el(sandbox, 'pairing-code-input').value, 'WRONG',
    'invalid code stays editable');

  const missing = runModule();
  submitPairing(missing, 'GONE');
  missing.window.GraneteUI.modelBinding.onResult({
    ok: false, pairing: true, code: 'code_not_found', reason: 'usado'
  });
  assert.strictEqual(el(missing, 'pairing-code-input').value, '', 'used/unknown code cleared');

  const unusable = runModule();
  submitPairing(unusable, 'OLD');
  unusable.window.GraneteUI.modelBinding.onResult({
    ok: false, pairing: true, code: 'code_unusable'
  });
  assert.strictEqual(el(unusable, 'pairing-message').textContent,
    'El código no existe, expiró o ya fue usado.', 'default copy when no reason');
  assert.strictEqual(el(unusable, 'pairing-code-input').value, '');
});

test('pairing_rebind_requires_new_code never opens the manual rebind and demands a fresh code', () => {
  const sandbox = runModule();
  el(sandbox, 'btn-binding-connect').click();
  submitPairing(sandbox, 'ABC-123');
  sandbox.window.GraneteUI.modelBinding.onResult({
    ok: false, code: 'pairing_rebind_requires_new_code', reason: 'cambio de base'
  });
  assert.strictEqual(el(sandbox, 'model-binding-picker').style.display, 'none');
  assert.strictEqual(el(sandbox, 'model-binding-rebind-review').style.display, 'none',
    'the manual rebind confirmation must not masquerade as completing the pairing');
  assert.strictEqual(el(sandbox, 'pairing-code-input').value, '');
  assert.strictEqual(el(sandbox, 'pairing-message').textContent,
    'cambio de base');
});

test('manual (non-pairing) results keep the traditional toasts on both paths', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onResult({ ok: true, status: { state: 'connected', binding: {} } });
  let toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'success');
  assert.strictEqual(toast.message, '✓ Modelo conectado al diseño de Granete.');

  const failing = runModule();
  failing.window.GraneteUI.modelBinding.onResult({ ok: false, reason: 'no se pudo' });
  toast = failing.__calls.toasts[failing.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'error');
  assert.strictEqual(toast.message, 'No se pudo conectar el modelo: no se pudo');
});

test('connect/rebind results update the commercial projection on success and failure', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onResult({ ok: true, status: { state: 'connected', binding: {} } });
  assert.strictEqual(sandbox.__calls.commercialBindings.length, 1);

  sandbox.window.GraneteUI.modelBinding.onResult({ ok: false, state: 'unreachable', reason: 'x' });
  assert.strictEqual(sandbox.__calls.commercialBindings.length, 2,
    'a failed validation fails closed with the same authoritative state');
  assert.deepStrictEqual(plain(sandbox.__calls.commercialBindings[1]), { state: 'unreachable', reason: 'x' });
});

// ---------------------------------------------------------------------
// Publish confirmation / orchestration (#392 / #847)
// ---------------------------------------------------------------------

function armedSandbox(gate) {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  if (gate !== undefined) {
    sandbox.window.GranetePreflightReview.blocked = true;
    sandbox.window.GranetePreflightReview.gate = gate;
    sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  }
  return sandbox;
}

test('first click NEVER publishes: it only arms the separate confirmation', () => {
  const sandbox = armedSandbox();
  el(sandbox, 'btn-binding-publish').click();
  assert.strictEqual(sandbox.__bridge.length, 0, 'no bridge call on arm');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').style.display, 'none');
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'block');
  assert.strictEqual(el(sandbox, 'binding-publish-progress').style.display, 'block');
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    'Confirmá la acción para crear la nueva revisión inmutable del diseño.');
});

test('explicit confirmation calls publish exactly once; physical double-click cannot cross the boundary', () => {
  const sandbox = armedSandbox();
  el(sandbox, 'btn-binding-publish').click();
  el(sandbox, 'btn-publish-confirm').click();
  assert.strictEqual(sandbox.__bridge.filter((c) => c.action === 'publish_design_revision').length, 1);
  assert.strictEqual(el(sandbox, 'btn-binding-publish').disabled, true);
  assert.strictEqual(el(sandbox, 'btn-binding-publish').textContent, 'Publicando…');

  el(sandbox, 'btn-publish-confirm').click();
  el(sandbox, 'btn-publish-confirm').click();
  assert.strictEqual(sandbox.__bridge.filter((c) => c.action === 'publish_design_revision').length, 1,
    'in-flight confirmation cannot publish twice');

  el(sandbox, 'btn-binding-publish').click();
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'none',
    'clicking publish while in flight does not re-arm');
});

test('cancel disarms and restores the publish button; a disarmed confirm never publishes', () => {
  const sandbox = armedSandbox();
  el(sandbox, 'btn-binding-publish').click();
  el(sandbox, 'btn-publish-cancel').click();
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'none');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').style.display, 'block');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').textContent, 'Publicar diseño');

  el(sandbox, 'btn-publish-confirm').click();
  assert.strictEqual(sandbox.__bridge.length, 0, 'confirm without arm is a no-op');
});

test('Escape disarms the armed confirmation (document keydown moved with the module)', () => {
  const sandbox = armedSandbox();
  el(sandbox, 'btn-binding-publish').click();
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'block');
  const keydownListeners = sandbox.__documentListeners.keydown;
  assert.strictEqual(keydownListeners.length, 1, 'exactly one document keydown listener');
  keydownListeners.forEach((cb) => cb({ key: 'Escape', preventDefault: () => {} }));
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'none');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').style.display, 'block');

  el(sandbox, 'btn-binding-publish').click();
  keydownListeners.forEach((cb) => cb({ key: 'Enter', preventDefault: () => {} }));
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'block',
    'other keys do not disarm');
});

test('the 6 s arm timeout is exactly 6000 ms and disarms as a backstop only', () => {
  const sandbox = armedSandbox();
  el(sandbox, 'btn-binding-publish').click();
  assert.strictEqual(sandbox.__timers.length, 1);
  assert.strictEqual(sandbox.__timers[0].ms, 6000, 'exact 6000 ms arm window');

  // The separate confirm action survives until fired — the timer is a
  // backstop, not the defense.
  sandbox.__timers[0].fn();
  assert.strictEqual(el(sandbox, 'binding-publish-confirm').style.display, 'none');
  el(sandbox, 'btn-publish-confirm').click();
  assert.strictEqual(sandbox.__bridge.length, 0, 'expired arm cannot publish');
});

test('a pending/blocked gate shows the blocked copy but does NOT disable publishing (#731)', () => {
  const sandbox = armedSandbox({ scopeAvailable: true, total: 30, verified: 12, pending: 18, blocked: 5, hostAvailable: true, hostClean: true });
  const publishBtn = el(sandbox, 'btn-binding-publish');
  assert.strictEqual(publishBtn.style.display, 'block');
  assert.strictEqual(publishBtn.disabled, false, 'blocked gate does not disable the orchestration');
  assert.strictEqual(el(sandbox, 'binding-publish-progress').style.display, 'block');
  assert.ok(el(sandbox, 'binding-publish-progress').textContent.includes(
    'La publicación está bloqueada porque existen problemas de fabricación.'));
  assert.ok(el(sandbox, 'binding-publish-progress').textContent.includes(
    '30 muebles · 12 verificados · 18 pendientes'));

  publishBtn.click();
  el(sandbox, 'btn-publish-confirm').click();
  assert.strictEqual(sandbox.__bridge.filter((c) => c.action === 'publish_design_revision').length, 1,
    'the click still starts the automatic orchestration; Ruby re-validates fail-closed');
});

test('publish-gate blocked copy covers every projection branch', () => {
  const cases = [
    [null, 'No se pudo confirmar el alcance de publicación del diseño.'],
    [{ scopeAvailable: false }, 'No se pudo confirmar el alcance de publicación del diseño.'],
    [{ scopeAvailable: true, total: 10, hostAvailable: false, hostAttention: 3 }, 'Hay 3 muebles que requieren reconciliación'],
    [{ scopeAvailable: true, total: 10, hostAvailable: true, hostClean: false, hostAttention: 0 }, 'No se pudo confirmar que este archivo SketchUp coincida con el diseño.'],
    [{ scopeAvailable: true, total: 10, hostAvailable: true, hostClean: true, blocked: 1 }, 'existen problemas de fabricación'],
    [{ scopeAvailable: true, total: 10, hostAvailable: true, hostClean: true, stale: 2 }, 'Volvé a verificar antes de publicar.'],
    [{ scopeAvailable: true, total: 10, hostAvailable: true, hostClean: true, unavailable: 1 }, 'No se pudo confirmar el estado de fabricación'],
    [{ scopeAvailable: true, total: 10, hostAvailable: true, hostClean: true }, 'La publicación requiere verificar todos los muebles del diseño.']
  ];
  cases.forEach(([gate, expected]) => {
    const sandbox = armedSandbox(gate);
    const text = el(sandbox, 'binding-publish-progress').textContent;
    assert.ok(text.includes(expected), 'gate copy for ' + JSON.stringify(gate) + ' → ' + text);
  });
});

test('publish progress surfaces the distinct orchestration steps with optional detail', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onPublishProgress({ step: 'validating', detail: '12 de 30' });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    'Validando identidad de los muebles… 12 de 30');

  sandbox.window.GraneteUI.modelBinding.onPublishProgress({ step: 'uploading' });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent, 'Subiendo archivos…');

  sandbox.window.GraneteUI.modelBinding.onPublishProgress({ step: 'unknown_step' });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    'Validando identidad de los muebles…', 'unknown steps fall back to validating');

  sandbox.window.GraneteUI.modelBinding.onPublishProgress(null);
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    'Validando identidad de los muebles…', 'null payload is ignored (last render kept)');
});

test('successful publish reports the immutable revision, refreshes the binding and clears exceptions', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  el(sandbox, 'btn-binding-publish').click();
  el(sandbox, 'btn-publish-confirm').click();
  sandbox.window.GraneteUI.modelBinding.onPublishResult({ ok: true, revisionNumber: 7 });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    'Diseño publicado · Revisión R7');
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'success');
  assert.ok(toast.message.includes('revisión inmutable R7'));
  assert.ok(sandbox.__bridge.find((c) => c.action === 'get_model_binding'),
    'success refreshes the model binding');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').disabled, false);
  assert.strictEqual(el(sandbox, 'btn-binding-publish').textContent, 'Publicar diseño');
});

test('failed publish without a validation maps the exact error copy and can retry', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onPublishResult({ ok: false, code: 'stale_base', reason: 'base vieja' });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    'La base del diseño cambió en el servidor; actualizá la base de trabajo y volvé a publicar. (base vieja)');
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'error');
  assert.strictEqual(toast.message,
    'La base del diseño cambió en el servidor; actualizá la base de trabajo y volvé a publicar.');
  assert.strictEqual(el(sandbox, 'btn-binding-publish').textContent, 'Reintentar publicación',
    'failed publish can retry');

  const unknown = runModule();
  unknown.window.GraneteUI.modelBinding.onPublishResult({ ok: false, code: 'whatever' });
  assert.strictEqual(el(unknown, 'binding-publish-progress').textContent, 'No se pudo publicar el diseño.');

  const degraded = runModule();
  degraded.window.GraneteUI.modelBinding.onPublishResult(null);
  assert.ok(el(degraded, 'binding-publish-progress').textContent.includes('resultado desconocido'),
    'missing result fails closed');
});

test('failed publish with a validation projection renders the summary + cards, not a generic error', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onPublishResult({
    ok: false,
    validation: {
      total: 2, ready: 0, attention: 2,
      exceptions: [{
        furnitureInstanceId: 'fi-1', displayName: 'Módulo inferior', state: 'blocked',
        review: { groups: [{ issues: [{ issueId: 'i1', title: 'Identidad duplicada', message: 'dos copias', remediation: 'Renombrá la copia' }] }] }
      }]
    }
  });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    '2 muebles · 0 listos · 2 requieren atención');
  const exceptions = el(sandbox, 'binding-publish-exceptions');
  assert.strictEqual(exceptions.style.display, 'block');
  assert.strictEqual(exceptions.children.length, 1, 'exceptions-only: one card');
  const card = exceptions.children[0];
  assert.strictEqual(card.className, 'preflight-issue');
  assert.strictEqual(card.children[0].children[0].textContent, 'Módulo inferior');
  assert.strictEqual(card.children[0].children[1].textContent, 'Requiere atención');
  assert.strictEqual(card.children[1].textContent, 'Identidad duplicada — dos copias');
  assert.strictEqual(card.children[2].textContent, 'Renombrá la copia');
});

// ---------------------------------------------------------------------
// Design-wide validation (#731)
// ---------------------------------------------------------------------

test('validate button starts the read-only validation through the exact bridge', () => {
  const sandbox = runModule();
  const btn = el(sandbox, 'btn-design-validate');
  btn.click();
  assert.ok(sandbox.__bridge.find((c) => c.action === 'validate_design_revision'));
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent, 'Validando diseño…');
  assert.strictEqual(btn.disabled, true);
  assert.strictEqual(btn.textContent, 'Validando…');
});

test('validation progress renders detail or the done/total fallback', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onDesignValidationProgress({ done: 3, total: 9 });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent, 'Validando diseño… 3 de 9');
  sandbox.window.GraneteUI.modelBinding.onDesignValidationProgress({ detail: 'Validando módulo inferior…' });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent, 'Validando módulo inferior…');
  sandbox.window.GraneteUI.modelBinding.onDesignValidationProgress(null);
  assert.strictEqual(el(sandbox, 'btn-design-validate').disabled, true,
    'null payload is ignored — the previous progress state stays (Ruby always follows with a result)');
});

test('validation success reports the summary with singular/plural and an honest toast', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onDesignValidationResult({
    ok: true, validation: { total: 30, ready: 28, attention: 2, exceptions: [] }
  });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent,
    '30 muebles · 28 listos · 2 requieren atención');
  assert.strictEqual(el(sandbox, 'binding-publish-exceptions').style.display, 'none',
    'ready majority never gets cards');
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'info');
  assert.strictEqual(toast.message, 'Validación del diseño completada.');

  const single = runModule();
  single.window.GraneteUI.modelBinding.onDesignValidationResult({
    ok: true, validation: { total: 1, ready: 0, attention: 1, exceptions: [] }
  });
  assert.strictEqual(el(single, 'binding-publish-progress').textContent,
    '1 mueble · 0 listos · 1 requiere atención');
});

test('validation result without a projection shows the reason and fails loud', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onDesignValidationResult({ ok: false, reason: 'sin contrato' });
  assert.strictEqual(el(sandbox, 'binding-publish-progress').textContent, 'sin contrato');
  const toast = sandbox.__calls.toasts[sandbox.__calls.toasts.length - 1];
  assert.strictEqual(toast.type, 'error');
  assert.strictEqual(toast.message, 'sin contrato');
  assert.strictEqual(el(sandbox, 'btn-design-validate').disabled, false);
  assert.strictEqual(el(sandbox, 'btn-design-validate').textContent, 'Validar diseño');
});

test('exception cards select the furniture by exact instance identity and navigate the issue', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.modelBinding.onDesignValidationResult({
    ok: false,
    validation: {
      total: 1, ready: 0, attention: 1,
      exceptions: [{
        furnitureInstanceId: 'fi-77', state: 'stale',
        review: { groups: [{ issues: [{ issueId: 'iss-9', title: 'Verificación desactualizada' }] }] }
      }]
    }
  });
  const card = el(sandbox, 'binding-publish-exceptions').children[0];
  assert.strictEqual(card['data-furniture-instance-id'], 'fi-77');
  assert.strictEqual(card.children[1].textContent, 'Verificación desactualizada',
    'detail falls back to the issue title when there is no message');

  const actions = card.children.find((c) => c.className === 'preflight-issue-actions');
  actions.children[0].click();
  const select = sandbox.__bridge.find((c) => c.action === 'select_project_furniture');
  assert.deepStrictEqual(select.payload, { furnitureInstanceId: 'fi-77' });

  actions.children[1].click();
  const nav = sandbox.__bridge.find((c) => c.action === 'navigate_furniture_issue');
  assert.strictEqual(nav.furnitureInstanceId, 'fi-77');
  assert.strictEqual(nav.issueId, 'iss-9');
  assert.strictEqual(nav.region, 'primary');

  // Without the review runtime only the selection action exists.
  const bare = runModule();
  delete bare.window.GranetePreflightReview;
  bare.window.GraneteUI.modelBinding.onDesignValidationResult({
    ok: false,
    validation: {
      total: 1, ready: 0, attention: 1,
      exceptions: [{ furnitureInstanceId: 'fi-1', state: 'blocked', reason: 'sin detalle' }]
    }
  });
  const bareCard = el(bare, 'binding-publish-exceptions').children[0];
  const bareActions = bareCard.children.find((c) => c.className === 'preflight-issue-actions');
  assert.strictEqual(bareActions.children.length, 1, 'no navigate button without the runtime');
  assert.strictEqual(el(bare, 'binding-publish-exceptions').children[0].children[1].textContent,
    'sin detalle', 'reason fallback when there are no issues');
});

// ---------------------------------------------------------------------
// GraneteState preflight subscription (wiring movement)
// ---------------------------------------------------------------------

test('init registers the preflight subscription exactly once and re-renders on the slice', () => {
  const sandbox = runModule();
  assert.strictEqual(sandbox.__subscribers.length, 1, 'one subscription after init');

  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
  sandbox.window.GranetePreflightReview.blocked = true;
  sandbox.window.GranetePreflightReview.gate = {
    scopeAvailable: true, total: 4, hostAvailable: true, hostClean: true, blocked: 1
  };
  sandbox.__subscribers.forEach((cb) => cb('preflight'));
  assert.ok(el(sandbox, 'binding-publish-progress').textContent.includes(
    'existen problemas de fabricación'), 'preflight slice re-evaluates the gate view');

  const callsBefore = sandbox.__calls.insertButtonCalls.count;
  sandbox.__subscribers.forEach((cb) => cb('catalog'));
  assert.strictEqual(sandbox.__calls.insertButtonCalls.count, callsBefore,
    'non-preflight slices do not re-render the publish availability');

  sandbox.window.GraneteUI.modelBinding.init({
    showToast: () => {},
    invalidateProjectFurniture: () => {}
  });
  assert.strictEqual(sandbox.__subscribers.length, 1, 'repeated init never stacks subscriptions');
});

test('without the #498 runtime the subscription stays a no-op exactly like the host', () => {
  // In the real dialog the #498 runtime loads AFTER the inline bootstrap,
  // so init() runs with no window.GraneteState — the guarded registration
  // must stay a no-op there (pre-existing timing, preserved).
  const sandbox = runModule({ skipInit: true });
  delete sandbox.window.GraneteState;
  sandbox.init();
  assert.strictEqual(sandbox.__subscribers.length, 0,
    'registration is guarded — no GraneteState, no subscription');
  sandbox.window.GraneteUI.modelBinding.setStatus(CONNECTED);
});

console.log(JSON.stringify({ success: true, testsPassed, module: 'granete-model-binding.js' }));
