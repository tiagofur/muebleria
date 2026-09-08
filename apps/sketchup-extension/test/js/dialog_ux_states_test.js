// Presentation-state harness for the dialog UX polish slice: proves what the
// HtmlDialog actually renders for the states a workshop user hits —
// no-selection copy, loading skeletons, connection-error recovery (retry),
// invisible toast classes, denied canDelete explanation, and the distinct
// stale_base binding badge. Complements dialog_inspector_test.js (capability
// gating) without duplicating it: static copy/CSS is asserted against the
// HTML source, dynamic state against the real dialog script in a vm sandbox.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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

function buildSandbox() {
  const registry = {};
  const bridgeCalls = [];

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag),
    // Tab probes return inert mocks; the harness drives states through the
    // GraneteDialog bridge instead of tab clicks.
    querySelector: () => createMockElement('q', 'BUTTON'),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  const sandbox = {
    console,
    // Timers must NOT fire: showToast registers its own hide timeout and the
    // toast class under test would be wiped before the assertion runs.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: documentMock,
    window: {
      addEventListener: () => {},
      sketchup: {
        dialog_ready: () => bridgeCalls.push({ action: 'dialog_ready' }),
        get_catalog: () => bridgeCalls.push({ action: 'get_catalog' }),
        get_project_furniture: () => bridgeCalls.push({ action: 'get_project_furniture' }),
        insert_furniture: () => {},
        update_furniture: () => {},
        delete_selected_furniture: () => {},
        select_furniture: () => {},
        login: () => {}, logout: () => {}, close_dialog: () => {}
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  return sandbox;
}

function runDialog() {
  const htmlPath = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'dialog.html must carry its script');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  return { sandbox, html };
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const DEFINITION = {
  furniture_definition_id: 'mod-test',
  name: 'Mueble de Prueba',
  parameters: [],
  materialRoles: []
};

function furnitureContext(overrides) {
  return Object.assign({
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
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: true, reason: null }
    }
  }, overrides);
}

function runTests() {
  const { sandbox, html } = runDialog();
  const dialog = sandbox.window.GraneteDialog;
  assert(dialog && typeof dialog.onSelectionChange === 'function', 'GraneteDialog bridge must exist');
  let passed = 0;
  const check = (cond, msg) => { assert(cond, msg); passed += 1; };

  // --- static presentation contract (markup + styles the sandbox can't see) ---
  check(html.includes('Nada seleccionado') &&
        html.includes('para ver sus propiedades y acciones'),
    'no-selection state names the state and the next action');
  check(html.includes('skeleton-card') && html.includes('skeleton-line') && html.includes('skeleton-square'),
    'loading states ship skeleton placeholders');
  check(html.includes('.toast.info') && html.includes('.toast.warning'),
    'info and warning toasts have visible styles');
  check(html.includes('.status-badge.success') && html.includes('.status-badge.error'),
    'success and error status badges have styles');
  check(html.includes('id="btn-library-retry"'), 'library error state has a retry button');
  check(html.includes('id="inspector-kind-badge"'), 'inspector names the selected entity type');
  check(!html.includes('#ef4444') && !html.includes('#b91c1c') && !html.includes('#d97706'),
    'status colors come from tokens, not hardcoded hex');

  // --- no-selection: empty state is the visible inspector surface ---
  dialog.onSelectionChange(null);
  check(visible(el(sandbox, 'inspector-empty-state')), 'null selection shows the empty state');
  check(!visible(el(sandbox, 'inspector-active-view')), 'active view hidden without selection');

  // --- denied canDelete explains itself with the Ruby capability reason ---
  dialog.onSelectionChange(furnitureContext({
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: false, reason: 'Este mueble pertenece al proyecto conectado; eliminálo desde Granete.' }
    }
  }));
  check(el(sandbox, 'btn-delete').disabled, 'delete disabled when canDelete denied');
  check(el(sandbox, 'inspector-delete-blocker').hidden === false, 'delete blocker note visible when denied');
  check(el(sandbox, 'inspector-delete-blocker').textContent.includes('proyecto conectado'),
    'delete blocker carries the capability reason');

  dialog.onSelectionChange(furnitureContext({ selectionCount: 3 }));
  check(el(sandbox, 'inspector-delete-blocker').hidden === true, 'delete blocker hidden under multi-selection');
  check(visible(el(sandbox, 'inspector-multi-note')), 'multi-selection note takes over');

  dialog.onSelectionChange(furnitureContext());
  check(!el(sandbox, 'btn-delete').disabled, 'delete enabled when canDelete supported');
  check(el(sandbox, 'inspector-delete-blocker').hidden === true, 'delete blocker hidden when delete is available');

  // --- library connection error: retry is offered and re-asks Ruby ---
  dialog.setCatalog({ source: 'error', definitions: [] });
  check(visible(el(sandbox, 'library-empty-state')), 'catalog error renders the empty-state card');
  check(el(sandbox, 'library-empty-title').textContent.includes('Error de conexión'),
    'error state is distinct from a truly empty catalog');
  check(visible(el(sandbox, 'btn-library-retry')), 'retry offered on connection error');
  el(sandbox, 'btn-library-retry').click();
  check(sandbox.__bridge.some((c) => c.action === 'get_catalog'), 'retry re-asks Ruby for the catalog');

  dialog.setCatalog({ source: 'remote', definitions: [DEFINITION] });
  check(!visible(el(sandbox, 'btn-library-retry')), 'retry hidden when the catalog loads');
  dialog.setCatalog({ source: 'local', definitions: [], licenseBlocked: true });
  check(!visible(el(sandbox, 'btn-library-retry')), 'license block does not offer a fetch retry');

  // --- toast classes: info and warning must be visible states ---
  dialog.onPlaceFurnitureResult({ ok: true, code: 'pending_position', instanceId: 'u1' });
  check(el(sandbox, 'toast-message').className === 'toast info', 'pending placement surfaces an info toast');

  dialog.onCreateProjectFurnitureResult({ ok: false, code: 'created_pending' });
  check(el(sandbox, 'toast-message').className === 'toast warning', 'partial creation surfaces a warning toast');

  // --- binding states stay visually distinguishable ---
  dialog.onModelBindingStatus({ state: 'stale_base' });
  check(el(sandbox, 'model-binding-badge').className.includes('conflict'),
    'stale base renders as a warning state, not neutral pending');
  dialog.onModelBindingStatus({ state: 'unreachable' });
  check(el(sandbox, 'model-binding-badge').className.includes('pending'),
    'unreachable stays a retryable neutral state');
  dialog.onModelBindingStatus({ state: 'design_archived' });
  check(el(sandbox, 'model-binding-badge').className.includes('invalid'),
    'archived design renders as blocked');

  return passed;
}

try {
  const testsPassed = runTests();
  process.stdout.write(JSON.stringify({ success: true, testsPassed }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: String(error && error.message || error) }));
  process.exit(1);
}
