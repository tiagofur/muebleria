// #848 Phase B C4.7 (boundary-adjusted split) — real JavaScript harness
// for granete-inspector-child.js: the CHILD Inspector module under
// window.GraneteUI.inspectorChild. Drives the ACTUAL module file in a vm
// sandbox (mock DOM + recording collaborators) and proves the child
// contract: registration/idempotence, the minimal public API
// (init/render/hide), the init dependency contract, the child general
// surface (part/hardware/aggregate render, breadcrumb, owner recovery
// path/scan/ambiguous/none, facts, capabilities), the #468 hardware
// surface (manual/derived/unknown provenance, anchor labels, offset,
// derived lock, replacement compatibility, drilling conflict, offset
// mutation, substitution) and the #467 part surface (structural hidden,
// authorable visible, XYZ prefill, capability gating, move, viewport,
// duplicate, add, remove, mutation feedback). Also proves the lane
// hygiene: the context is the SAME object the Inspector routed (no
// clone) and hide() drops it. The routing itself (child kinds dispatched
// by kind) stays proven in granete_inspector_test.js; the integrated
// dialog_inspector_test.js covers the real chain.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-inspector-child.js');
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

// Builds a sandbox holding ONLY the real child module: collaborators
// (mutation controller, state, sketchup bridge) are recording stubs so
// each test observes the module's side of the boundary.
function buildModuleSandbox(overrides) {
  const registry = {};
  const created = [];
  const toastCalls = [];
  const bridgeCalls = [];
  const mutationCalls = [];
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

  const windowOverrides = Object.assign({}, overrides || {});
  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: documentMock,
    window: Object.assign({
      sketchup: {
        select_furniture: (p) => bridgeCalls.push({ action: 'select_furniture', payload: JSON.parse(p) })
      },
      GraneteMutation: {
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
      }
    }, windowOverrides)
  };
  sandbox.__registry = registry;
  sandbox.__created = created;
  sandbox.__bridge = bridgeCalls;
  sandbox.__mutation = mutationCalls;
  sandbox.__toastCalls = toastCalls;
  sandbox.__docListeners = docListeners;
  sandbox.__hardwareCatalog = [];
  return sandbox;
}

function runModule(sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-inspector-child.js' });
  return sandbox;
}

// Injects the standard deps: the shared toast stand-in, the SAME
// capability logic dialog.html injects and a call-time hardware catalog
// accessor (the catalog slice stays owned by granete-inspector.js).
function initChildDeps(sandbox, overrides) {
  const deps = Object.assign({
    showToast: (type, msg) => sandbox.__toastCalls.push({ type, msg }),
    capabilityEnabled: (context, name) =>
      !!(context && context.capabilities && context.capabilities[name] && context.capabilities[name].supported),
    getHardwareCatalog: () => sandbox.__hardwareCatalog
  }, overrides || {});
  sandbox.window.GraneteUI.inspectorChild.init(deps);
  return deps;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

function descendants(root) {
  return (root.children || []).reduce((all, child) => all.concat([child], descendants(child)), []);
}

function partContext(overrides) {
  return Object.assign({
    kind: 'part',
    furnitureInstanceRef: 'ref-1',
    componentInstanceId: 'shelf-a',
    componentDefinitionId: 'st-comp-shelf',
    ownerRecovery: 'scan',
    semanticPath: ['Mueble de Prueba', 'Entrepaño 1'],
    display: { name: 'Entrepaño 1', role: 'shelf_1' },
    capabilities: {
      canMoveWithinConstraint: { supported: false, reason: 'Las posiciones internas las resuelve Granete.' },
      canDuplicate: { supported: false, reason: 'r' },
      canAddRelated: { supported: false, reason: 'r' },
      canRemove: { supported: false, reason: 'r' },
      canChangeJoinery: { supported: false, reason: 'r' },
      canInspectManufacturing: { supported: false, reason: 'r' }
    }
  }, overrides);
}

function hardwareContext(placementKind, overrides) {
  return Object.assign({
    kind: 'hardware',
    furnitureInstanceRef: 'ref-1',
    hardwarePlacementId: 'place-hw-1',
    hardwareDefinitionId: 'hw-handle',
    hostComponentInstanceId: 'door-1',
    placementKind: placementKind,
    ownerRecovery: 'scan',
    semanticPath: ['Mueble de Prueba', 'Manija 160'],
    display: { name: 'Manija 160' },
    capabilities: {
      canMove: { supported: false, reason: 'procedencia' },
      canRotate: { supported: false, reason: 'r' },
      canChangeHandedness: { supported: false, reason: 'r' },
      canReplaceDefinition: { supported: false, reason: 'r' },
      canInspectMachining: { supported: false, reason: 'r' }
    }
  }, overrides);
}

function aggregateContext(overrides) {
  return Object.assign({
    kind: 'aggregate',
    furnitureInstanceRef: 'ref-1',
    componentInstanceId: 'carc-1',
    ownerRecovery: 'path',
    semanticPath: ['Mueble de Prueba', 'Cuerpo'],
    display: { name: 'Cuerpo', role: 'body' },
    capabilities: {}
  }, overrides);
}

// runTests -----------------------------------------------------------------

test('registration: namespace, idempotent re-execution, minimal public API', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  assert(api, 'window.GraneteUI.inspectorChild must exist');

  const expectedApi = ['init', 'render', 'hide'];
  expectedApi.forEach((k) => assert.strictEqual(typeof api[k], 'function', 'public API entry ' + k));
  const extra = Object.keys(api).filter((k) => !expectedApi.includes(k));
  assert.deepStrictEqual(extra, [], 'no internal helpers leak into the public API');

  // Idempotent re-execution: the same object survives a second load.
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-inspector-child.js' });
  assert.strictEqual(sandbox.window.GraneteUI.inspectorChild, api, 're-execution must not rebuild the module');
});

test('init dependency contract: render fails fast before init; hide stays dep-free', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  assert.throws(() => api.render(partContext()),
    /GraneteUI\.inspectorChild\.init is required before use; missing deps: .+/,
    'render before init must fail fast');
  api.hide();
  assert.strictEqual(el(sandbox, 'inspector-child-view').style.display, 'none', 'hide is dep-free and safe pre-init');
});

test('part render: badge, name, structural card hidden; authorable card prefilled', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;

  api.render(partContext());
  assert(visible(el(sandbox, 'inspector-child-view')), 'child view visible');
  assert.strictEqual(el(sandbox, 'child-kind-badge').textContent, 'Pieza', 'part kind badge');
  assert.strictEqual(el(sandbox, 'child-name').textContent, 'Entrepaño 1', 'display name');
  assert(!visible(el(sandbox, 'part-authoring-card')), 'structural part: no authoring card');

  api.render(partContext({
    assemblyTranslationMm: [18, 18, 150],
    capabilities: {
      canMoveWithinConstraint: { supported: true, reason: null },
      canDuplicate: { supported: true, reason: null },
      canAddRelated: { supported: true, reason: null },
      canRemove: { supported: true, reason: null }
    }
  }));
  assert(visible(el(sandbox, 'part-authoring-card')), 'movable part shows the card');
  assert(el(sandbox, 'part-pos-x').value === 18 && el(sandbox, 'part-pos-y').value === 18 &&
    el(sandbox, 'part-pos-z').value === 150, 'XYZ prefilled from the resolved pose');
  assert(!el(sandbox, 'btn-apply-part-move').disabled, 'move enabled');
  assert(!el(sandbox, 'btn-part-remove').disabled, 'remove enabled');
});

test('part capability gating: each button obeys its OWN capability', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  api.render(partContext({
    assemblyTranslationMm: [1, 2, 3],
    capabilities: {
      canMoveWithinConstraint: { supported: false, reason: 'r' },
      canDuplicate: { supported: true, reason: null },
      canAddRelated: { supported: false, reason: 'r' },
      canRemove: { supported: true, reason: null }
    }
  }));
  assert(el(sandbox, 'btn-apply-part-move').disabled, 'move gated');
  assert(el(sandbox, 'btn-part-viewport-move').disabled, 'viewport gated with move');
  assert(el(sandbox, 'part-pos-x').disabled && el(sandbox, 'part-pos-y').disabled && el(sandbox, 'part-pos-z').disabled,
    'XYZ inputs gated with move');
  assert(!el(sandbox, 'btn-part-duplicate').disabled, 'duplicate obeys canDuplicate only');
  assert(el(sandbox, 'btn-part-add').disabled, 'add gated');
  assert(!el(sandbox, 'btn-part-remove').disabled, 'remove obeys canRemove only');
});

test('breadcrumb + goto: owner path/scan are navigable through the ref', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;

  api.render(partContext({ ownerRecovery: 'path' }));
  const crumb = el(sandbox, 'child-breadcrumb').children.find((c) => c.classList.contains('crumb-link'));
  assert(crumb && crumb.textContent === 'Mueble de Prueba', 'owner crumb present for path recovery');
  crumb.click();
  let nav = sandbox.__bridge.filter((c) => c.action === 'select_furniture').pop();
  assert(nav && nav.payload.furnitureInstanceRef === 'ref-1', 'crumb navigation sends the ref');
  assert.strictEqual(el(sandbox, 'btn-goto-furniture').style.display, 'inline-flex', 'goto visible for path recovery');
  el(sandbox, 'btn-goto-furniture').click();
  nav = sandbox.__bridge.filter((c) => c.action === 'select_furniture').pop();
  assert(nav && nav.payload.furnitureInstanceRef === 'ref-1', 'goto navigation sends the ref');

  api.render(partContext({ ownerRecovery: 'scan' }));
  assert.strictEqual(el(sandbox, 'btn-goto-furniture').style.display, 'inline-flex', 'goto visible for scan recovery');

  // Single-segment path: no owner crumb, current crumb shows the display name.
  api.render(partContext({ ownerRecovery: 'scan', semanticPath: ['Entrepaño 1'] }));
  assert(!el(sandbox, 'child-breadcrumb').children.some((c) => c.classList.contains('crumb-link')),
    'no owner crumb without a deeper path');
});

test('owner recovery: ambiguous and none explain themselves and never navigate', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;

  api.render(partContext({ ownerRecovery: 'ambiguous', semanticPath: ['M'] }));
  assert(el(sandbox, 'child-owner-note').textContent.includes('varias copias'), 'ambiguous note');
  assert.strictEqual(el(sandbox, 'btn-goto-furniture').style.display, 'none', 'ambiguous is not navigable');

  api.render(partContext({ ownerRecovery: 'none', semanticPath: ['M'] }));
  assert(el(sandbox, 'child-owner-note').textContent.includes('No se encontró el mueble dueño'), 'missing owner note');
  assert.strictEqual(el(sandbox, 'btn-goto-furniture').style.display, 'none', 'missing owner is not navigable');
});

test('aggregate render: kind badge, no hardware/part surface, no origin note', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.window.GraneteUI.inspectorChild.render(aggregateContext());
  assert.strictEqual(el(sandbox, 'child-kind-badge').textContent, 'Agregado', 'aggregate kind badge');
  assert.strictEqual(el(sandbox, 'child-origin-note').style.display, 'none', 'origin note is hardware-only');
  assert(!visible(el(sandbox, 'hw-placement-card')), 'hardware placement card hidden');
  assert(!visible(el(sandbox, 'hw-conflict-banner')), 'conflict banner hidden');
  assert(!visible(el(sandbox, 'part-authoring-card')), 'part authoring card hidden');
});

test('child facts: the resolved ids render exactly; absent facts are omitted', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  api.render(aggregateContext({
    componentDefinitionId: 'st-comp-body',
    catalogComponentId: 'cat-1',
    projectId: 'proj-1',
    baseRevisionId: 'rev-9'
  }));
  const texts = descendants(el(sandbox, 'child-facts')).map((n) => n.textContent);
  assert(texts.includes('ref-1'), 'furniture ref renders');
  assert(texts.includes('carc-1'), 'occurrence id renders');
  assert(texts.includes('st-comp-body'), 'component definition renders');
  assert(texts.includes('proj-1'), 'project renders');
  assert(texts.includes('rev-9'), 'base revision renders');
  assert(!texts.includes('place-hw-1'), 'absent hardware placement omitted');
});

test('capability list: Ruby labels, availability badges and denial reasons render', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.window.GraneteUI.inspectorChild.render(partContext());
  const labels = descendants(el(sandbox, 'child-capabilities')).map((n) => n.textContent);
  assert(labels.includes('Mover dentro de restricciones'), 'known capability label translated');
  assert(labels.includes('No disponible'), 'denied badge');
  assert(labels.includes('Las posiciones internas las resuelve Granete.'), 'denial reason surfaced');
  assert.strictEqual(el(sandbox, 'child-capabilities').children.length, 6, 'one row per Ruby capability');
});

test('hardware manual render: origin note, provenance badge and def name resolve from the catalog', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.__hardwareCatalog = [{ id: 'hw-handle', code: 'HW-H', name: 'Manija 160', category: 'handles' }];
  sandbox.window.GraneteUI.inspectorChild.render(hardwareContext('manual', { anchorFace: 'front' }));
  assert.strictEqual(el(sandbox, 'child-kind-badge').textContent, 'Herraje', 'hardware kind badge');
  assert(el(sandbox, 'child-origin-note').textContent.includes('manual'), 'manual origin copy');
  assert.strictEqual(el(sandbox, 'hw-provenance-badge').textContent, 'Manual', 'manual provenance badge');
  assert.strictEqual(el(sandbox, 'hw-def-name').textContent, 'Manija 160', 'def name resolved from the catalog');
  assert(!el(sandbox, 'hw-offset-input').disabled, 'manual offset editable');
  assert(!el(sandbox, 'btn-apply-hw-offset').disabled && !el(sandbox, 'btn-replace-hw').disabled,
    'manual actions enabled');
});

test('hardware catalog is consumed at CALL time through the injected accessor (no copy)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  sandbox.__hardwareCatalog = [{ id: 'hw-handle', name: 'Manija 160', category: 'handles' }];
  api.render(hardwareContext('manual'));
  assert.strictEqual(el(sandbox, 'hw-def-name').textContent, 'Manija 160', 'first render resolves from the live catalog');

  // The owner (granete-inspector.js) swaps the slice; no re-init needed.
  sandbox.__hardwareCatalog = [];
  api.render(hardwareContext('manual'));
  assert.strictEqual(el(sandbox, 'hw-def-name').textContent, 'hw-handle', 'stale-nameless fallback renders the raw id');
});

test('hardware derived: provenance badge, locked inputs and the derived note', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.window.GraneteUI.inspectorChild.render(hardwareContext('derived', { offsetMm: 5 }));
  assert(el(sandbox, 'child-origin-note').textContent.includes('derivado'), 'derived origin copy');
  assert.strictEqual(el(sandbox, 'hw-provenance-badge').textContent, 'Derivado', 'derived provenance badge');
  assert(el(sandbox, 'hw-offset-input').disabled, 'offset locked');
  assert(el(sandbox, 'btn-apply-hw-offset').disabled && el(sandbox, 'btn-replace-hw').disabled,
    'derived actions locked');
  assert(visible(el(sandbox, 'hw-derived-locked-note')), 'locked note visible');
  assert.strictEqual(el(sandbox, 'hw-offset-input').value, 5, 'scalar offset renders');
});

test('hardware unknown provenance fails closed in badge and copy', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.window.GraneteUI.inspectorChild.render(hardwareContext('unknown'));
  assert(el(sandbox, 'child-origin-note').textContent.includes('sin determinar'), 'unknown origin copy');
  assert.strictEqual(el(sandbox, 'hw-provenance-badge').textContent, 'Desconocido', 'unknown provenance badge');
  assert(el(sandbox, 'hw-offset-input').disabled, 'unknown provenance never enables editing');
});

test('anchor face labels: missing renders --, known translates, unknown renders raw', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  api.render(hardwareContext('manual'));
  assert.strictEqual(el(sandbox, 'hw-face-val').textContent, '--', 'missing anchor face renders --');
  api.render(hardwareContext('manual', { anchorFace: 'front' }));
  assert.strictEqual(el(sandbox, 'hw-face-val').textContent, 'Frontal', 'known face translated');
  api.render(hardwareContext('manual', { anchorFace: 'weird-face' }));
  assert.strictEqual(el(sandbox, 'hw-face-val').textContent, 'weird-face', 'unknown face renders raw');
});

test('offset prefill: array payloads render the Y component, scalars render as-is', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  api.render(hardwareContext('manual', { offsetMm: [0, 12, 0] }));
  assert.strictEqual(el(sandbox, 'hw-offset-input').value, 12, 'Y component rendered');
  api.render(hardwareContext('manual', { offsetMm: 7 }));
  assert.strictEqual(el(sandbox, 'hw-offset-input').value, 7, 'scalar rendered');
  api.render(hardwareContext('manual'));
  assert.strictEqual(el(sandbox, 'hw-offset-input').value, 0, 'missing offset falls back to 0');
});

test('replacement select lists ONLY same-category candidates; current stays selected (#1046 S2)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.__hardwareCatalog = [
    { id: 'hw-handle', code: 'HW-H', name: 'Manija 160', category: 'handles' },
    { id: 'hw-handle-2', code: 'HW-H2', name: 'Manija Gola', category: 'handles' },
    { id: 'hw-hinge', code: 'HW-B', name: 'Bisagra', category: 'hinges' }
  ];
  sandbox.window.GraneteUI.inspectorChild.render(hardwareContext('manual'));
  const options = el(sandbox, 'hw-replacement-select').children;
  // Only the same family is offered — the rest of the catalog never fills
  // the select (owner rule: no disabled noise, no foreign families).
  assert(!options.some((o) => o.value === 'hw-hinge'), 'other-family option is not rendered at all');
  const current = options.find((o) => o.value === 'hw-handle');
  assert(current && current.selected, 'current hardware selected');
  assert(options.some((o) => o.value === 'hw-handle-2'), 'same-category alternative offered');
  assert(options.every((o) => !o.disabled), 'no option renders disabled');
});

test('replacement select with unknown current definition keeps one honest option (#1046 S2)', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.__hardwareCatalog = [
    { id: 'hw-handle', code: 'HW-H', name: 'Manija 160', category: 'handles' }
  ];
  sandbox.window.GraneteUI.inspectorChild.render(
    hardwareContext('manual', { hardwareDefinitionId: 'hw-gone' })
  );
  const options = el(sandbox, 'hw-replacement-select').children;
  assert.strictEqual(options.length, 1, 'single honest option for a catalog-missing definition');
  assert.strictEqual(options[0].value, 'hw-gone', 'the current id stays selectable');
});

test('drilling conflict banner reads ONLY from GraneteState mutation issues', () => {
  const sandbox = buildModuleSandbox({
    GraneteState: {
      get: (key) => (key === 'mutation'
        ? { issues: [{ code: 'DRILLING_CONFLICT', message: 'Choque', remediation: 'Mové la bisagra' }] }
        : null),
      set: () => {}
    }
  });
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.window.GraneteUI.inspectorChild.render(hardwareContext('manual'));
  assert(visible(el(sandbox, 'hw-conflict-banner')), 'conflict banner visible');
  assert.strictEqual(el(sandbox, 'hw-conflict-message').textContent, 'Choque', 'message from the authoritative issue');
  assert.strictEqual(el(sandbox, 'hw-conflict-remediation').textContent, 'Mové la bisagra', 'remediation from the issue');

  const sandbox2 = buildModuleSandbox({
    GraneteState: {
      get: (key) => (key === 'mutation' ? { issues: [{ code: 'DRILLING_CONFLICT', message: 'Choque' }] } : null),
      set: () => {}
    }
  });
  runModule(sandbox2);
  initChildDeps(sandbox2);
  sandbox2.window.GraneteUI.inspectorChild.render(hardwareContext('manual'));
  assert.strictEqual(el(sandbox2, 'hw-conflict-remediation').textContent,
    'Mover la bisagra a una posición libre de perforaciones de entrepaño.',
    'missing remediation falls back to the stable copy');

  const sandbox3 = buildModuleSandbox();
  runModule(sandbox3);
  initChildDeps(sandbox3);
  sandbox3.window.GraneteUI.inspectorChild.render(hardwareContext('manual'));
  assert(!visible(el(sandbox3, 'hw-conflict-banner')), 'no conflict issue, no banner');
});

test('offset mutation rides GraneteMutation with the SAME live context; derived warns', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  const ctx = hardwareContext('manual');
  api.render(ctx);
  el(sandbox, 'hw-offset-input').value = '8';
  el(sandbox, 'btn-apply-hw-offset').click();
  const mut = sandbox.__mutation.filter((c) => c.action === 'submitHardwarePlacementUpdate').pop();
  assert(mut && mut.val === 8, 'offset mutation payload exact');
  assert.strictEqual(mut.ctx, ctx, 'the SAME context object rides the mutation (no clone)');

  const derived = buildModuleSandbox();
  runModule(derived);
  initChildDeps(derived);
  derived.window.GraneteUI.inspectorChild.render(hardwareContext('derived'));
  el(derived, 'btn-apply-hw-offset').disabled = false; // bypass the render lock to probe the guard
  el(derived, 'btn-apply-hw-offset').click();
  assert(derived.__toastCalls.some((t) => t.type === 'warning' &&
    t.msg.includes('Los herrajes derivados se calculan por regla de ingeniería')), 'derived offset warning copy');
  assert.strictEqual(derived.__mutation.length, 0, 'derived offset never mutates');
});

test('substitution rides GraneteMutation with the selected target; derived warns', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  const ctx = hardwareContext('manual');
  api.render(ctx);
  el(sandbox, 'hw-replacement-select').value = 'hw-hinge';
  el(sandbox, 'btn-replace-hw').click();
  const mut = sandbox.__mutation.filter((c) => c.action === 'submitHardwareSubstitution').pop();
  assert(mut && mut.id === 'hw-hinge', 'substitution payload exact');
  assert.strictEqual(mut.ctx, ctx, 'the SAME context object rides the substitution');

  const derived = buildModuleSandbox();
  runModule(derived);
  initChildDeps(derived);
  derived.window.GraneteUI.inspectorChild.render(hardwareContext('derived'));
  el(derived, 'btn-replace-hw').disabled = false; // bypass the render lock to probe the guard
  el(derived, 'btn-replace-hw').click();
  assert(derived.__toastCalls.some((t) => t.type === 'warning' &&
    t.msg.includes('Los herrajes derivados no admiten sustitución manual')), 'derived substitution warning copy');
  assert.strictEqual(derived.__mutation.length, 0, 'derived substitution never mutates');
});

test('part mutations: move validates XYZ, duplicate/add/remove ride the authoring channel', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  const ctx = partContext({
    assemblyTranslationMm: [1, 2, 3],
    capabilities: {
      canMoveWithinConstraint: { supported: true, reason: null },
      canDuplicate: { supported: true, reason: null },
      canAddRelated: { supported: true, reason: null },
      canRemove: { supported: true, reason: null }
    }
  });
  api.render(ctx);

  el(sandbox, 'part-pos-x').value = 'not-a-number';
  el(sandbox, 'btn-apply-part-move').click();
  assert(sandbox.__toastCalls.some((t) => t.msg === 'Ingresá la posición en milímetros (X, Y y Z) del componente.'),
    'invalid XYZ copy exact');
  assert(!sandbox.__mutation.some((c) => c.action === 'submitComponentMutation' && c.op === 'move'),
    'no move submitted with invalid XYZ');

  el(sandbox, 'part-pos-x').value = '10';
  el(sandbox, 'btn-apply-part-move').click();
  let mut = sandbox.__mutation.filter((c) => c.action === 'submitComponentMutation' && c.op === 'move').pop();
  assert(mut && mut.t[0] === 10 && mut.t[1] === 2 && mut.t[2] === 3, 'move translation exact');
  assert.strictEqual(mut.ctx, ctx, 'move rides the SAME context object');

  el(sandbox, 'btn-part-duplicate').click();
  el(sandbox, 'btn-part-add').click();
  el(sandbox, 'btn-part-remove').click();
  const ops = sandbox.__mutation.filter((c) => c.action === 'submitComponentMutation').map((c) => c.op);
  assert.deepStrictEqual(ops, ['move', 'duplicate', 'add', 'remove'], 'operations exact');
});

test('part viewport move: rides GraneteMutation; unavailable explains itself; busy stays silent', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  api.render(partContext({
    capabilities: { canMoveWithinConstraint: { supported: true, reason: null } }
  }));
  el(sandbox, 'btn-part-viewport-move').click();
  const mut = sandbox.__mutation.filter((c) => c.action === 'startComponentViewportMove').pop();
  assert(mut, 'viewport move dispatched');

  const unavailable = buildModuleSandbox({
    GraneteMutation: { startComponentViewportMove: () => 'unavailable' }
  });
  runModule(unavailable);
  initChildDeps(unavailable);
  unavailable.window.GraneteUI.inspectorChild.render(partContext({
    capabilities: { canMoveWithinConstraint: { supported: true, reason: null } }
  }));
  el(unavailable, 'btn-part-viewport-move').click();
  assert(unavailable.__toastCalls.some((t) =>
    t.msg === 'El gesto de viewport no está disponible para esta selección.'), 'viewport unavailable copy exact');

  const busy = buildModuleSandbox({
    GraneteMutation: {
      submitComponentMutation: () => 'busy',
      startComponentViewportMove: () => 'busy'
    }
  });
  runModule(busy);
  initChildDeps(busy);
  busy.window.GraneteUI.inspectorChild.render(partContext({
    capabilities: { canMoveWithinConstraint: { supported: true, reason: null } }
  }));
  el(busy, 'btn-part-viewport-move').click();
  assert.strictEqual(busy.__toastCalls.length, 0, 'busy result is silent');
});

test('part mutation feedback: authoritative issues render through granete-mutation-state', () => {
  const sandbox = buildModuleSandbox({
    GraneteState: {
      get: () => ({ phase: 'rejected', issues: [{ code: 'X', message: 'No se pudo mover' }] }),
      set: () => {}
    }
  });
  runModule(sandbox);
  initChildDeps(sandbox);
  sandbox.window.GraneteUI.inspectorChild.render(partContext({
    capabilities: { canMoveWithinConstraint: { supported: true, reason: null } }
  }));
  sandbox.__docListeners['granete-mutation-state'][0]();
  assert.strictEqual(el(sandbox, 'part-authoring-feedback').textContent, 'No se pudo mover',
    'feedback from the authoritative issue');
  assert(visible(el(sandbox, 'part-authoring-feedback')), 'feedback visible');

  const clean = buildModuleSandbox({
    GraneteState: { get: () => ({ phase: 'idle', issues: [] }), set: () => {} }
  });
  runModule(clean);
  initChildDeps(clean);
  clean.window.GraneteUI.inspectorChild.render(partContext({
    capabilities: { canMoveWithinConstraint: { supported: true, reason: null } }
  }));
  clean.__docListeners['granete-mutation-state'][0]();
  assert.strictEqual(el(clean, 'part-authoring-feedback').textContent, '', 'no issue, no feedback');
  assert(!visible(el(clean, 'part-authoring-feedback')), 'feedback hidden without issues');
});

test('lane hygiene: hide() drops the context reference; handlers go inert for other kinds', () => {
  const sandbox = buildModuleSandbox();
  runModule(sandbox);
  initChildDeps(sandbox);
  const api = sandbox.window.GraneteUI.inspectorChild;
  api.render(hardwareContext('manual'));
  api.hide();
  assert.strictEqual(el(sandbox, 'inspector-child-view').style.display, 'none', 'child view hidden');

  el(sandbox, 'btn-apply-hw-offset').disabled = false; // simulate a stale click path
  el(sandbox, 'btn-apply-hw-offset').click();
  assert.strictEqual(sandbox.__mutation.length, 0, 'no mutation without an active child context');

  // A context from another lane never leaks into child handlers.
  api.render(partContext());
  el(sandbox, 'btn-apply-hw-offset').disabled = false;
  el(sandbox, 'btn-apply-hw-offset').click();
  assert.strictEqual(sandbox.__mutation.length, 0, 'part context never feeds the hardware handlers');
});

console.log(JSON.stringify({ success: true, testsPassed: testsPassed, module: 'granete-inspector-child.js' }));
