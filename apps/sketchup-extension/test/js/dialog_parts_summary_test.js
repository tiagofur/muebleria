// Review #847 P2: the dock's piece count must be honest — never a stale
// local number presented as the resolved BOM. Exercises the real dialog
// script: "Aprox." from the definition estimate while the counting params
// sit at their defaults, "Aprox." recomputed from CURRENT values once the
// user moves them, and an explicit "se calculan al resolver" when nothing
// can be estimated. The backend/domain stays the authority (no resolved
// count is invented here).
const vm = require('vm');
const { runDialogScripts } = require('./support/dialog_scripts');
const assert = require('assert');

function createMockElement(id = '') {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  const children = [];
  let textContentValue = '';
  const el = {
    id,
    children,
    style: {},
    disabled: false,
    hidden: false,
    type: '',
    value: '',
    checked: false,
    className: '',
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
    click: () => {
      (listeners['click'] || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    focus: () => {},
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    get innerHTML() { return ''; },
    set innerHTML(v) { children.length = 0; },
    get textContent() { return textContentValue; },
    set textContent(v) { textContentValue = String(v); }
  };
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
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: documentMock,
    window: {
      addEventListener: () => {},
      sketchup: {
        dialog_ready: () => {}, get_catalog: () => {},
        insert_furniture: () => {}, update_furniture: () => {},
        delete_selected_furniture: () => {}, select_furniture: () => {},
        login: () => {}, logout: () => {}, close_dialog: () => {}
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  return sandbox;
}

function runDialog() {
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  runDialogScripts(sandbox);
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function openConfigurator(sandbox, definition) {
  sandbox.window.GraneteDialog.setCatalog({ definitions: [definition], presets: [], categories: [], materials: [], source: 'workshop' });
  const grid = el(sandbox, 'library-cards-grid');
  assert.ok(grid.children.length > 0, 'the catalog card rendered');
  grid.children[0].click();
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('definition estimate shows as explicit Aprox. while counting params sit at defaults', () => {
  const sandbox = runDialog();
  openConfigurator(sandbox, {
    furniture_definition_id: 'def-1', name: 'Módulo', code: 'M-1',
    estimatedPartCount: 12, estimatedHardwareCount: 8,
    parameters: [
      { name: 'widthMm', label: 'Ancho', type: 'number', unit: 'mm', defaultValue: 800 },
      { name: 'shelfCount', label: 'Bandejas', type: 'number', defaultValue: 2, min: 0, max: 6 }
    ],
    materialRoles: []
  });
  assert.equal(el(sandbox, 'library-summary-parts').textContent, 'Aprox. 12 piezas + 8 herrajes',
    'the server estimate is labeled as an estimate, not a resolved BOM');
});

test('moving a counting param recomputes the local estimate from CURRENT values', () => {
  const sandbox = runDialog();
  openConfigurator(sandbox, {
    furniture_definition_id: 'def-1', name: 'Módulo', code: 'M-1',
    estimatedPartCount: 12,
    parameters: [
      { name: 'shelfCount', label: 'Bandejas', type: 'number', defaultValue: 2, min: 0, max: 6 }
    ],
    materialRoles: []
  });
  // The stepper lives in the shelfCount param group: group → control → [− value +].
  const groups = el(sandbox, 'library-params-container').children;
  assert.ok(groups.length > 0, 'param groups rendered');
  const stepper = groups[0].children[1].children[0];
  assert.ok(Array.isArray(stepper.children) && stepper.children.length === 3,
    'stepper control located');
  stepper.children[2].click(); // + one shelf: 2 + (2 + 1)
  assert.equal(el(sandbox, 'library-summary-parts').textContent, 'Aprox. 5 piezas',
    'the local heuristic follows the CURRENT params, not the defaults');
});

test('heuristic-only definitions estimate from current values, never silently', () => {
  const sandbox = runDialog();
  openConfigurator(sandbox, {
    furniture_definition_id: 'def-2', name: 'Rack', code: 'R-1',
    parameters: [
      { name: 'shelfCount', label: 'Bandejas', type: 'number', defaultValue: 2, min: 0, max: 6 },
      { name: 'doorCount', label: 'Puertas', type: 'number', defaultValue: 1, min: 0, max: 4 }
    ],
    materialRoles: []
  });
  assert.equal(el(sandbox, 'library-summary-parts').textContent, 'Aprox. 5 piezas',
    '2 + shelfCount(2) + doorCount(1), explicitly approximate');
});

test('when nothing can be estimated the dock defers to the resolve', () => {
  const sandbox = runDialog();
  openConfigurator(sandbox, {
    furniture_definition_id: 'def-3', name: 'Panel', code: 'P-1',
    parameters: [{ name: 'widthMm', label: 'Ancho', type: 'number', unit: 'mm', defaultValue: 600 }],
    materialRoles: []
  });
  assert.equal(el(sandbox, 'library-summary-parts').textContent, 'Piezas: se calculan al resolver',
    'no invented count: honesty over a fabricated number');
});

test('the inspector dock follows the same honesty', () => {
  const sandbox = runDialog();
  sandbox.window.GraneteDialog.setCatalog({
    definitions: [{
      furniture_definition_id: 'def-4', name: 'Panel', code: 'P-1',
      parameters: [{ name: 'widthMm', label: 'Ancho', type: 'number', unit: 'mm', defaultValue: 600 }],
      materialRoles: []
    }],
    presets: [], categories: [], materials: [], source: 'workshop'
  });
  sandbox.window.GraneteDialog.onSelectionChange({
    kind: 'furniture',
    furnitureInstanceRef: 'inst-1',
    furnitureDefinitionId: 'def-4',
    display: { name: 'Panel' },
    selectionCount: 1,
    capabilities: {
      canEditParameters: { supported: true },
      canEditMaterialRoles: { supported: false },
      canDelete: { supported: true }
    }
  });
  assert.equal(el(sandbox, 'inspector-summary-parts').textContent, 'Piezas: se calculan al resolver',
    'the placed furniture dock defers too — no stale estimate');
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed += 1;
  } catch (error) {
    failures.push(`${t.name}: ${error && error.message}`);
  }
}

if (failures.length > 0) {
  process.stdout.write(JSON.stringify({ success: false, failures }, null, 2));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ success: true, testsPassed: passed }));
