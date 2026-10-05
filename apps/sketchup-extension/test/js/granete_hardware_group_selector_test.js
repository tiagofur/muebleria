// #1046 S3 — real JavaScript harness for granete-hardware-group-selector.js:
// the hardware group member modal under window.GraneteUI.hardwareGroupSelector.
// Drives the actual module file in a vm sandbox (mock DOM faithful to the
// dialog.html markup: backdrop starts display:none, list/badge/title/empty
// ids) and proves the ownership contract: registration/idempotence, the
// minimal public API, row rendering with the current-member badge, the
// selection model (apply disabled until a DIFFERENT member is selected),
// Apply commits through the injected onPick exactly once and clears the
// session, Cancel/backdrop/Escape close without committing, and the empty
// state for a group without members. Pure presentation: no catalog access,
// no mutation submission — those stay with the caller.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-hardware-group-selector.js');
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

  const el = {
    id,
    tagName,
    children,
    style: { display: id === 'hardware-group-modal' ? 'none' : '' },
    disabled: false,
    type: '',
    classList: {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    setAttribute: (k, v) => { attributes[k] = String(v); },
    getAttribute: (k) => attributes[k],
    addEventListener: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    click: () => {
      (listeners['click'] || []).forEach((cb) => cb({ preventDefault: () => {}, target: el }));
    },
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
  const docListeners = {};
  const sandbox = {
    window: {},
    document: {
      getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
      createElement: (tag) => createMockElement('', tag),
      addEventListener: (event, cb) => {
        docListeners[event] = docListeners[event] || [];
        docListeners[event].push(cb);
      }
    },
    console: { log: () => {} }
  };
  sandbox.window.GraneteUI = sandbox.window.GraneteUI || {};
  sandbox.__registry = registry;
  sandbox.__docListeners = docListeners;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-hardware-group-selector.js' });
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

const ROWS = [
  { id: 'hw-blum', name: 'Bisagra Blum', code: 'BIS-CL110', categoryLabel: 'Bisagras', unitLabel: 'por unidad', notes: 'Cierre lento' },
  { id: 'hw-eco', name: 'Bisagra económica', code: 'BIS-ECO', categoryLabel: 'Bisagras', unitLabel: 'por unidad', notes: null }
];

test('registration: namespace, idempotent re-execution, minimal public API', () => {
  const sandbox = buildSandbox();
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-hardware-group-selector.js (re-run)' });
  const api = sandbox.window.GraneteUI.hardwareGroupSelector;
  assert(api, 'window.GraneteUI.hardwareGroupSelector must exist');
  assert.deepStrictEqual(Object.keys(api).sort(), ['close', 'isOpen', 'open']);
});

test('open renders member rows, marks the current one and disables Aplicar until a different member is selected', () => {
  const sandbox = buildSandbox();
  const api = sandbox.window.GraneteUI.hardwareGroupSelector;
  api.open({ title: 'Elegir Bisagras', groupLabel: 'Bisagras', rows: ROWS, chosenId: 'hw-blum', onPick: () => {} });

  assert(visible(el(sandbox, 'hardware-group-modal')), 'backdrop visible');
  assert.strictEqual(el(sandbox, 'hw-group-modal-title').textContent, 'Elegir Bisagras');
  assert.strictEqual(el(sandbox, 'hw-group-modal-badge').textContent, 'Grupo: Bisagras');
  const list = el(sandbox, 'hw-group-list');
  assert.strictEqual(list.children.length, 2);
  const first = list.children[0];
  assert.strictEqual(first.children[0].children[0].textContent, 'Bisagra Blum');
  assert.strictEqual(first.children[1].textContent, 'BIS-CL110 · Bisagras · por unidad');
  assert.strictEqual(first.children[2].textContent, 'Cierre lento');
  assert.strictEqual(first.children[0].children[1].textContent, 'Actual', 'the chosen member carries the badge');
  assert(el(sandbox, 'btn-hw-group-apply').disabled, 'Aplicar disabled with no selection');

  // Selecting the CURRENT member keeps Aplicar disabled (no no-op commit).
  first.click();
  assert(el(sandbox, 'btn-hw-group-apply').disabled, 're-selecting the current member never commits');

  // A different member enables Aplicar.
  list.children[1].click();
  assert(!el(sandbox, 'btn-hw-group-apply').disabled);
});

test('Aplicar commits the picked id through onPick exactly once and closes', () => {
  const sandbox = buildSandbox();
  const picks = [];
  const api = sandbox.window.GraneteUI.hardwareGroupSelector;
  api.open({ rows: ROWS, chosenId: 'hw-blum', onPick: (id) => picks.push(id) });

  el(sandbox, 'hw-group-list').children[1].click();
  el(sandbox, 'btn-hw-group-apply').click();
  assert.deepStrictEqual(picks, ['hw-eco']);
  assert(!api.isOpen(), 'the modal closes after committing');
  assert.strictEqual(el(sandbox, 'hw-group-list').children.length, 0, 'rows leave with the session');

  // A second click on the (now session-less) Aplicar must not re-commit.
  el(sandbox, 'btn-hw-group-apply').click();
  assert.deepStrictEqual(picks, ['hw-eco']);
});

test('Cancelar, backdrop click and Escape close without committing', () => {
  const sandbox = buildSandbox();
  const picks = [];
  const api = sandbox.window.GraneteUI.hardwareGroupSelector;
  api.open({ rows: ROWS, chosenId: 'hw-blum', onPick: (id) => picks.push(id) });

  el(sandbox, 'btn-hw-group-cancel').click();
  assert(!api.isOpen());
  assert.deepStrictEqual(picks, []);

  api.open({ rows: ROWS, chosenId: 'hw-blum', onPick: (id) => picks.push(id) });
  el(sandbox, 'hw-group-list').children[1].click(); // selection in flight
  el(sandbox, 'hardware-group-modal').click({ target: el(sandbox, 'hardware-group-modal') });
  assert(!api.isOpen());
  assert.deepStrictEqual(picks, [], 'backdrop click never commits a pending selection');

  api.open({ rows: ROWS, chosenId: 'hw-blum', onPick: (id) => picks.push(id) });
  (sandbox.__docListeners.keydown || []).forEach((cb) => cb({ key: 'Escape' }));
  assert(!api.isOpen());
  assert.deepStrictEqual(picks, []);
});

test('a group without members renders the honest empty state', () => {
  const sandbox = buildSandbox();
  const api = sandbox.window.GraneteUI.hardwareGroupSelector;
  api.open({ title: 'Elegir Bisagras', rows: [], chosenId: null, onPick: () => {} });

  assert(visible(el(sandbox, 'hardware-group-modal')));
  assert.strictEqual(el(sandbox, 'hw-group-list').children.length, 0);
  assert(visible(el(sandbox, 'hw-group-empty')), 'empty message surfaces');
  assert(el(sandbox, 'btn-hw-group-apply').disabled);
});

console.log(JSON.stringify({ success: true, testsPassed: testsPassed, module: 'granete-hardware-group-selector.js' }));
