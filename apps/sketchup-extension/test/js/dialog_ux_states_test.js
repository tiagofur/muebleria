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
  // #848: los estilos del panel viven en css/*.css — los checks estáticos de
  // presentación se evalúan sobre markup + css concatenados.
  const cssDir = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/css');
  const css = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(cssDir, f), 'utf-8')).join('\n');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  return { sandbox, html, htmlCss: html + '\n' + css };
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
  const { sandbox, html, htmlCss } = runDialog();
  const dialog = sandbox.window.GraneteDialog;
  assert(dialog && typeof dialog.onSelectionChange === 'function', 'GraneteDialog bridge must exist');
  let passed = 0;
  const check = (cond, msg) => { assert(cond, msg); passed += 1; };

  // --- static presentation contract (markup + styles the sandbox can't see) ---
  check(html.includes('Nada seleccionado') &&
        html.includes('para ver sus propiedades y acciones'),
    'no-selection state names the state and the next action');
  check(htmlCss.includes('skeleton-card') && htmlCss.includes('skeleton-line') && htmlCss.includes('skeleton-square'),
    'loading states ship skeleton placeholders');
  check(htmlCss.includes('.toast.info') && htmlCss.includes('.toast.warning'),
    'info and warning toasts have visible styles');
  check(htmlCss.includes('.status-badge.success') && htmlCss.includes('.status-badge.error'),
    'success and error status badges have styles');
  check(html.includes('id="btn-library-retry"'), 'library error state has a retry button');
  check(html.includes('id="inspector-kind-badge"'), 'inspector names the selected entity type');
  check(!htmlCss.includes('#ef4444') && !htmlCss.includes('#b91c1c') && !htmlCss.includes('#d97706'),
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

  // --- consecuencia invertida: el delete (reversible) cierra con su red de
  //     seguridad; el error nombra la causa en vez de dejar el panel mudo ---
  dialog.onDeleteResult({ ok: true });
  check(el(sandbox, 'toast-message').className === 'toast success' &&
        el(sandbox, 'toast-message').textContent.indexOf('Ctrl+Z') !== -1,
    'delete success closes the gesture naming the Undo safety net');
  dialog.onDeleteResult({ ok: false, reason: 'el mueble no se encontró en el modelo' });
  check(el(sandbox, 'toast-message').className === 'toast error' &&
        el(sandbox, 'toast-message').textContent.indexOf('no se encontró') !== -1,
    'delete failure explains the cause');

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

  // --- cuenta y conexión: la sesión vive en el popover del pill, no en una pestaña ---
  check(!html.includes('id="pane-status"') && !html.includes('data-tab="status"'),
    'Estado dejó de ser una pestaña del panel');
  check(html.includes('id="account-popover"') && html.includes('aria-controls="account-popover"'),
    'la cuenta vive en un popover anclado al pill del header');
  check(!html.includes('id="btn-pf-go-status"'),
    'Proyecto ya no expulsa al usuario hacia una pestaña de sesión');
  dialog.setCatalog({ source: 'unauthenticated', definitions: [] });
  check(el(sandbox, 'library-empty-title').textContent.includes('Sesión requerida'),
    'sin sesión la biblioteca lo dice con un CTA');
  el(sandbox, 'btn-library-empty-action').onclick();
  check(visible(el(sandbox, 'account-popover')), 'el CTA de sesión abre el popover de cuenta');
  check(el(sandbox, 'connection-pill').getAttribute('aria-expanded') === 'true',
    'el pill anuncia el popover abierto');
  el(sandbox, 'connection-pill').click();
  check(!visible(el(sandbox, 'account-popover')), 'clic en el pill cierra el popover');
  check(el(sandbox, 'connection-pill').getAttribute('aria-expanded') === 'false',
    'el pill anuncia el popover cerrado');
  dialog.setStatus({ state: 'logged_in', user: { name: 'A', email: 'a@b' }, server_url: 'https://x' });
  check(el(sandbox, 'connection-pill').className.includes('connection-pill-btn'),
    'setStatus conserva la clase de botón del pill (no lo rompe en <div>)');
  check(visible(el(sandbox, 'session-card')) && !visible(el(sandbox, 'login-card')),
    'con sesión el popover muestra la sesión y oculta la vinculación');

  // --- foco contextual del popover (review #847): nunca un control oculto ---
  const focusLog = [];
  ['login-server', 'btn-logout', 'connection-pill', 'btn-close'].forEach((id) => {
    el(sandbox, id).focus = () => focusLog.push(id);
  });
  focusLog.length = 0;
  el(sandbox, 'connection-pill').click();
  check(focusLog[focusLog.length - 1] === 'btn-logout',
    'con sesión el popover enfoca la acción visible (Cerrar sesión), no el input oculto');
  el(sandbox, 'connection-pill').click();
  check(focusLog[focusLog.length - 1] === 'connection-pill',
    'al cerrar el foco vuelve al pill');

  dialog.setStatus({ state: 'configured', server_url: 'https://x' });
  focusLog.length = 0;
  el(sandbox, 'connection-pill').click();
  check(focusLog[focusLog.length - 1] === 'login-server',
    'sin sesión el popover enfoca el servidor (login-card visible)');
  el(sandbox, 'connection-pill').click();
  check(focusLog[focusLog.length - 1] === 'connection-pill',
    'el retorno del foco al pill también aplica sin sesión');

  // --- selector de pestañas real (review #847): .tab-btn no existe ---
  check(html.includes('querySelector(".tab-button.active")'),
    'la selección consultada usa la clase real .tab-button.active');
  check(!html.includes('.tab-btn.active'),
    'ninguna consulta usa la clase inexistente .tab-btn');
  check(html.includes('activateInspectorTab'),
    'el puente activateInspectorTab lleva "editar en el panel" al Inspector');

  return passed;
}

try {
  const testsPassed = runTests();
  process.stdout.write(JSON.stringify({ success: true, testsPassed }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: String(error && error.message || error) }));
  process.exit(1);
}
