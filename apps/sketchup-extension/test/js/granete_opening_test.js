// #1137 — real JavaScript harness for granete-opening.js: the «Apertura»
// card module under window.GraneteUI.opening. Drives the ACTUAL module file
// in a vm sandbox (mock DOM + recording window.sketchup bridge) and proves
// the contract: filtered options (available systems only, verified profiles
// only, curated gola list), read-only server resolution rendering, the
// truthful no-dims absence, the ONE write carrying draft + workingVersion,
// the INVALID refusal keeping the draft and the persisted selection visible
// with the actionable message, and requestId correlation discarding late
// answers.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-opening.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (err) {
    err.stack = `[${name}] ${err.stack}`;
    err.message = `[${name}] ${err.message}`;
    console.error(`FAILING: ${name}`);
    throw err;
  }
  testsPassed += 1;
}

function createMockElement(id = '') {
  const listeners = {};
  const children = [];
  const el = {
    id,
    tagName: 'DIV',
    children,
    style: {},
    disabled: false,
    selected: false,
    value: '',
    textContent: '',
    className: '',
    onclick: null,
    onchange: null,
    appendChild(child) {
      children.push(child);
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      return child;
    },
    get firstChild() {
      return children.length > 0 ? children[0] : null;
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    setAttribute(name, value) {
      el.attributes[name] = value;
    },
    attributes: {},
    __listeners: listeners
  };
  return el;
}

function createSandbox(bridgeCalls) {
  const elementsById = {};
  const document = {
    createElement(tag) {
      return createMockElement(tag);
    },
    getElementById(id) {
      if (!elementsById[id]) {
        elementsById[id] = createMockElement(id);
      }
      return elementsById[id];
    }
  };
  const sandbox = {
    document,
    window: {},
    JSON,
    setTimeout,
    console,
    sketchup: {
      get_design_opening(payload) {
        bridgeCalls.push({ command: 'get_design_opening', payload: JSON.parse(payload) });
      },
      apply_design_opening(payload) {
        bridgeCalls.push({ command: 'apply_design_opening', payload: JSON.parse(payload) });
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'granete-opening.js' });
  return { sandbox, elementsById };
}

const READY_ANSWER = {
  requestId: 1,
  status: 'ready',
  designId: 'd-1',
  opening: { system: 'handle', profileId: '', placements: [] },
  resolution: {
    state: 'resolved',
    fronts: [{ zoneId: 'z1', widthMm: 600, heightMm: 720, offsetMm: 0, grips: [], rules: {} }]
  },
  dimsKnown: true,
  capabilities: {
    version: 1,
    grips: {
      handle: { enabled: true, default: true },
      gola: { enabled: true, profiles: ['profile.gola-l.alu'] },
      bottom_overhang: { enabled: false }
    }
  },
  profiles: [
    { id: 'profile.gola-l.alu', name: 'Gola L aluminio', datasheet_status: 'verified', compatible_placements: ['top'] },
    { id: 'profile.gola-c.alu', name: 'Gola C pendiente', datasheet_status: 'pending', compatible_placements: ['between'] }
  ]
};

function findDeep(root, predicate) {
  if (!root) return null;
  for (const child of root.children) {
    if (predicate(child)) return child;
    const nested = findDeep(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function findAllDeep(root, predicate, acc = []) {
  if (!root) return acc;
  for (const child of root.children) {
    if (predicate(child)) acc.push(child);
    findAllDeep(child, predicate, acc);
  }
  return acc;
}

function initModule(bridgeCalls) {
  const { sandbox, elementsById } = createSandbox(bridgeCalls);
  const vmWindow = sandbox.window;
  vmWindow.GraneteUI.opening.init({ sketchup: sandbox.sketchup });
  return { sandbox, elementsById, opening: vmWindow.GraneteUI.opening, GraneteUI: vmWindow.GraneteUI };
}

test('el card filtra sistemas por capacidades: sólo los ofrecidos aparecen', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  assert.strictEqual(elementsById['design-inspector-opening-card'].style.display, 'block');
  const body = elementsById['design-inspector-opening-body'];
  void body;
  const select = findDeep(body, (child) => child.id === 'opening-system-select');
  assert.ok(select, 'the system select must render');
  const values = select.children.map((option) => option.value);
  assert.deepStrictEqual(values, ['', 'handle', 'gola'], 'bottom_overhang is disabled today and must not appear');
});

test('sin decisión de fábrica: los tres sistemas del default de biblioteca aparecen', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening({ ...READY_ANSWER, capabilities: null });

  const body = elementsById['design-inspector-opening-body'];
  void body;
  const select = findDeep(body, (child) => child.id === 'opening-system-select');
  const values = select.children.map((option) => option.value);
  assert.deepStrictEqual(values, ['', 'handle', 'gola', 'bottom_overhang']);
});

test('sólo perfiles con ficha verificada y dentro de la curaduría son seleccionables', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  // Pick gola → the profile select renders with ONLY the verified + curated
  // profile; the pending C profile never appears as a normal choice.
  const body = elementsById['design-inspector-opening-body'];
  void body;
  const systemSelect = findDeep(body, (child) => child.id === 'opening-system-select');
  const golaOption = systemSelect.children.find((option) => option.value === 'gola');
  golaOption.selected = true;
  systemSelect.value = 'gola';
  systemSelect.onchange();

  const updatedBody = elementsById['design-inspector-opening-body'];
  const profileSelect = findDeep(updatedBody, (child) => child.id === 'opening-profile-select');
  assert.ok(profileSelect, 'the profile select must render for gola');
  const values = profileSelect.children.map((option) => option.value);
  assert.deepStrictEqual(values, ['', 'profile.gola-l.alu'], 'the pending datasheet profile must not appear');
});

test('los frentes son read-only: la resolución del servidor se renderiza tal cual', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  const body = elementsById['design-inspector-opening-body'];
  void body;
  const front = findDeep(body, (child) => child.attributes['data-testid'] === 'opening-front-1');
  assert.ok(front, 'the resolved front must render');
  assert.ok(front.textContent.includes('600 × 720 mm'), 'front dims must come verbatim from the server');
  assert.ok(front.textContent.includes('read-only'));
});

test('sin medidas explícitas: ausencia veraz, ninguna resolución inventada', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening({ ...READY_ANSWER, resolution: null, dimsKnown: false });

  const body = elementsById['design-inspector-opening-body'];
  void body;
  const note = findDeep(body, (child) => child.textContent.includes('medidas explícitas'));
  assert.ok(note, 'the truthful no-dims message must render');
  assert.ok(!findAllDeep(body, (child) => child.attributes['data-testid'] === 'opening-front-1').length);
});

test('Aplicar emite UN PUT con el draft y el token; ok limpia el draft y renderiza el estado fresco', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  const body = elementsById['design-inspector-opening-body'];
  void body;
  const systemSelect = findDeep(body, (child) => child.id === 'opening-system-select');
  const golaOption = systemSelect.children.find((option) => option.value === 'gola');
  golaOption.selected = true;
  systemSelect.value = 'gola';
  systemSelect.onchange();
  const updatedBody = elementsById['design-inspector-opening-body'];
  const profileSelect = findDeep(updatedBody, (child) => child.id === 'opening-profile-select');
  const profileOption = profileSelect.children.find((option) => option.value === 'profile.gola-l.alu');
  profileOption.selected = true;
  profileSelect.value = 'profile.gola-l.alu';
  profileSelect.onchange();

  const applyButton = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  applyButton.onclick();

  assert.strictEqual(bridgeCalls.length, 2);
  assert.strictEqual(bridgeCalls[1].command, 'apply_design_opening');
  assert.deepStrictEqual(bridgeCalls[1].payload.selection, {
    system: 'gola',
    profileId: 'profile.gola-l.alu',
    placements: []
  });
  assert.strictEqual(bridgeCalls[1].payload.expectedWorkingVersion, 'v1');

  const freshState = {
    opening: { system: 'gola', profileId: 'profile.gola-l.alu', placements: [] },
    resolution: { state: 'resolved', fronts: [{ zoneId: 'z1', widthMm: 600, heightMm: 650, offsetMm: 0, grips: [], rules: {} }] },
    dimsKnown: true
  };
  opening.onDesignOpeningApplied({ requestId: bridgeCalls[1].payload.requestId, status: 'ok', state: freshState });
  const persisted = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-persisted');
  assert.ok(persisted.textContent.includes('Gola'), 'the applied selection becomes the persisted truth');
  const front = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-front-1');
  assert.ok(front.textContent.includes('650'), 'the fresh server resolution replaces the old one');
});

test('INVALID_OPENING_CONFIGURATION: el draft queda editable, la selección persistida visible y el error accionable', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  const body = elementsById['design-inspector-opening-body'];
  void body;
  const systemSelect = findDeep(body, (child) => child.id === 'opening-system-select');
  const golaOption = systemSelect.children.find((option) => option.value === 'gola');
  golaOption.selected = true;
  systemSelect.value = 'gola';
  systemSelect.onchange();
  const applyButton = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  applyButton.onclick();
  const applyCall = bridgeCalls[1];

  opening.onDesignOpeningApplied({
    requestId: applyCall.payload.requestId,
    status: 'invalid',
    reason: 'OPENING_PROFILE_DATASHEET_PENDING',
    message: 'la configuración de apertura no es válida: el perfil espera ficha técnica'
  });

  const error = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-error');
  assert.ok(error, 'the actionable error must render');
  assert.ok(error.textContent.includes('ficha técnica'), 'the server message must reach the user');
  // The draft stays editable (still gola) and the persisted handle stays
  // visible.
  assert.strictEqual(opening._state().draft.system, 'gola');
  const persisted = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-persisted');
  assert.ok(persisted.textContent.includes('Jaladera'), 'the persisted selection stays visible');
  // And the apply button is available again (not stuck saving).
  const retry = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  assert.strictEqual(retry.disabled, false);
});

test('las respuestas tardías de un request anterior se descartan', () => {
  const bridgeCalls = [];
  const { opening } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  const staleAnswer = { ...READY_ANSWER, requestId: 999 };
  opening.onDesignOpening(staleAnswer);
  assert.strictEqual(opening._state().status, 'loading', 'a late answer must not populate the card');
  opening.onDesignOpening({ ...READY_ANSWER, requestId: 1 });
  assert.strictEqual(opening._state().status, 'ready');
});

test('hide desactiva el card (el lane le pertenece al Design Inspector)', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);
  opening.hide();
  assert.strictEqual(elementsById['design-inspector-opening-card'].style.display, 'none');
  assert.strictEqual(opening._state().laneActive, false);
});

test('#1264: el outcome de geometría del apply se muestra honesto (converged y failed)', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  const body = elementsById['design-inspector-opening-body'];
  void body;
  const systemSelect = findDeep(body, (child) => child.id === 'opening-system-select');
  const golaOption = systemSelect.children.find((option) => option.value === 'gola');
  golaOption.selected = true;
  systemSelect.value = 'gola';
  systemSelect.onchange();
  const applyButton = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  applyButton.onclick();
  const applyCall = bridgeCalls[1];

  const freshState = {
    opening: { system: 'gola', profileId: 'profile.gola-l.alu', placements: [] },
    resolution: { state: 'resolved', fronts: [{ zoneId: 'z1', widthMm: 600, heightMm: 650, offsetMm: 0, grips: [], rules: {} }] },
    dimsKnown: true
  };

  opening.onDesignOpeningApplied({
    requestId: applyCall.payload.requestId, status: 'ok', state: freshState,
    geometry: { status: 'converged', units: 1 }
  });
  let outcome = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-geometry-outcome');
  assert.ok(outcome, 'the converged outcome must render');
  assert.ok(outcome.textContent.includes('Geometría actualizada (1)'), outcome.textContent);

  // A convergence failure stays honest: the selection is persisted, the
  // model converges later — never a local guess. A LATE answer (stale
  // requestId) is dropped verbatim — the card keeps the first outcome.
  opening.onDesignOpeningApplied({
    requestId: applyCall.payload.requestId + 1000, status: 'ok', state: freshState,
    geometry: { status: 'failed', reason: 'canal no disponible' }
  });
  const staleOutcome = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-geometry-outcome');
  assert.ok(staleOutcome.textContent.includes('Geometría actualizada (1)'), staleOutcome.textContent);

  // A fresh apply whose convergence fails reports the honest failure.
  const rebody = elementsById['design-inspector-opening-body'];
  void rebody;
  const systemSelect2 = findDeep(rebody, (child) => child.id === 'opening-system-select');
  const golaOption2 = systemSelect2.children.find((option) => option.value === 'gola');
  golaOption2.selected = true;
  systemSelect2.value = 'gola';
  systemSelect2.onchange();
  const applyButton2 = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  applyButton2.onclick();
  opening.onDesignOpeningApplied({
    requestId: bridgeCalls[bridgeCalls.length - 1].payload.requestId, status: 'ok', state: freshState,
    geometry: { status: 'failed', reason: 'canal no disponible' }
  });
  const failedOutcome = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-geometry-outcome');
  assert.ok(failedOutcome.textContent.includes('no se pudo actualizar'), failedOutcome.textContent);
  assert.ok(failedOutcome.textContent.includes('canal no disponible'), failedOutcome.textContent);
});

console.log(JSON.stringify({ success: true, testsPassed }));
