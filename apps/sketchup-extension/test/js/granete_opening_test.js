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
    placements: ['top']
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

test('#1272: el resultado del canal gola (placeholder) se muestra junto a la geometría', () => {
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
    resolution: { state: 'resolved', fronts: [{ zoneId: 'z1', widthMm: 400, heightMm: 680, offsetMm: 0, grips: [], rules: {} }] },
    dimsKnown: true
  };

  opening.onDesignOpeningApplied({
    requestId: applyCall.payload.requestId, status: 'ok', state: freshState,
    geometry: { status: 'converged', units: 1, channel: { status: 'drawn', source: 'asset', heightMm: 27, depthMm: 56 } }
  });
  let channel = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-channel-outcome');
  assert.ok(channel, 'the drawn channel outcome must render');
  assert.ok(channel.textContent.includes('diseño del perfil'), channel.textContent);
  assert.ok(channel.textContent.includes('SKP del catálogo'), channel.textContent);

  // A skipped placeholder keeps the honest reason visible too.
  const systemSelect2 = findDeep(elementsById['design-inspector-opening-body'], (child) => child.id === 'opening-system-select');
  systemSelect2.value = 'gola';
  systemSelect2.onchange();
  findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply').onclick();
  opening.onDesignOpeningApplied({
    requestId: bridgeCalls[bridgeCalls.length - 1].payload.requestId, status: 'ok', state: freshState,
    geometry: { status: 'converged', units: 1, channel: { status: 'skipped', reason: 'sin puerta en el mueble' } }
  });
  channel = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-channel-outcome');
  assert.ok(channel.textContent.includes('sin representar'), channel.textContent);
  assert.ok(channel.textContent.includes('sin puerta en el mueble'), channel.textContent);
});

test('#1261: getSummary reporta el resumen de apertura y ensureLoaded consulta en background', () => {
  const bridgeCalls = [];
  const { opening } = initModule(bridgeCalls);

  // Unbound -> getSummary es null
  assert.strictEqual(opening.getSummary(), null);

  // ensureLoaded dispara get_design_opening
  opening.ensureLoaded('d-1261');
  assert.strictEqual(bridgeCalls.length, 1);
  assert.strictEqual(bridgeCalls[0].command, 'get_design_opening');
  assert.strictEqual(bridgeCalls[0].payload.designId, 'd-1261');

  // getSummary con gola
  opening.onDesignOpening({
    requestId: bridgeCalls[0].payload.requestId,
    status: 'ready',
    designId: 'd-1261',
    opening: { system: 'gola', profileId: 'profile.gola-l.alu', placements: ['top'] },
    resolution: { state: 'resolved', fronts: [{ zoneId: 'z1', widthMm: 600, heightMm: 650 }] },
    profiles: [{ id: 'profile.gola-l.alu', name: 'Gola L Cymisa' }]
  });

  const summary = opening.getSummary();
  assert.ok(summary);
  assert.strictEqual(summary.system, 'gola');
  assert.strictEqual(summary.profileName, 'Gola L Cymisa');
  assert.strictEqual(summary.placementLabel, 'Superior');
  assert.strictEqual(summary.resolvedText, '600 × 650 mm');
  assert.strictEqual(summary.isGola, true);
});

test('#1261: toggleInlineEditor alterna el editor inline de apertura en el contenedor del mueble', () => {
  const bridgeCalls = [];
  const { opening, sandbox } = initModule(bridgeCalls);
  opening.refresh('d-1261', 'v1');
  opening.onDesignOpening(READY_ANSWER);

  assert.strictEqual(opening.isInlineActive(), false);
  const inlineContainer = sandbox.document.getElementById('inspector-opening-inline-editor');
  const btn = sandbox.document.getElementById('btn-configure-design-opening');

  opening.toggleInlineEditor();
  assert.strictEqual(opening.isInlineActive(), true);
  assert.strictEqual(inlineContainer.style.display, 'block');
  assert.strictEqual(btn.textContent, 'Cerrar');
  assert.ok(findDeep(inlineContainer, (c) => c.attributes['data-testid'] === 'opening-system-select'), 'debe renderizar el selector de sistema');

  opening.toggleInlineEditor();
  assert.strictEqual(opening.isInlineActive(), false);
  assert.strictEqual(inlineContainer.style.display, 'none');
  assert.strictEqual(btn.textContent, 'Configurar');
});

test('#1261: un error de carga muestra superficie honesta con Reintentar, nunca un loading eterno', () => {
  const bridgeCalls = [];
  const { opening, sandbox } = initModule(bridgeCalls);
  opening.refresh('d-err', 'v1');
  opening.onDesignOpening(READY_ANSWER); // arranca listo para el lane

  opening.toggleInlineEditor();
  // El servidor rechaza la relectura (403/transporte): status error.
  opening.onDesignOpening({
    requestId: bridgeCalls[bridgeCalls.length - 1].payload.requestId,
    status: 'error',
    reason: 'credencial sin permisos'
  });

  const inlineContainer = sandbox.document.getElementById('inspector-opening-inline-editor');
  const errorLine = findDeep(inlineContainer, (c) => c.attributes['data-testid'] === 'opening-inline-error');
  assert.ok(errorLine, 'the honest error line must render');
  assert.ok(errorLine.textContent.includes('credencial sin permisos'), errorLine.textContent);
  const retryBtn = findDeep(inlineContainer, (c) => c.attributes['data-testid'] === 'opening-inline-retry');
  assert.ok(retryBtn, 'the retry button must render');

  const callsBefore = bridgeCalls.length;
  retryBtn.onclick();
  assert.strictEqual(bridgeCalls.length, callsBefore + 1, 'retry re-issues the authoritative read');
  assert.strictEqual(bridgeCalls[bridgeCalls.length - 1].command, 'get_design_opening');
});

// #1329 fixtures: two verified gola L of DIFFERENT makers (the picker's
// hard case) curated by the factory, with the workshop's standard marked
// for section L.
const STANDARD_ANSWER = {
  ...READY_ANSWER,
  capabilities: {
    version: 1,
    grips: {
      handle: { enabled: true, default: true },
      gola: {
        enabled: true,
        profiles: ['profile.gola-l.alu', 'profile.gola-l.marca-b'],
        standardProfiles: { L: 'profile.gola-l.alu' }
      },
      bottom_overhang: { enabled: false }
    }
  },
  profiles: [
    {
      id: 'profile.gola-l.alu', name: 'Gola L SCILM 8006', manufacturer: 'SCILM',
      cross_section_shape: 'L', datasheet_status: 'verified', compatible_placements: ['top'],
      door_reduction_mm: 40,
      body_modifiers: [{ role: 'lateral', notch_height_mm: 56.5, notch_depth_mm: 27.2, notch_at: 'top_front' }]
    },
    {
      id: 'profile.gola-l.marca-b', name: 'Gola L Marca B', manufacturer: 'Marca B',
      cross_section_shape: 'L', datasheet_status: 'verified', compatible_placements: ['top'],
      door_reduction_mm: 35
    }
  ]
};

function pickGola(elementsById) {
  const body = elementsById['design-inspector-opening-body'];
  const systemSelect = findDeep(body, (child) => child.id === 'opening-system-select');
  const golaOption = systemSelect.children.find((option) => option.value === 'gola');
  golaOption.selected = true;
  systemSelect.value = 'gola';
  systemSelect.onchange();
}

function pickProfile(elementsById, profileId) {
  const body = elementsById['design-inspector-opening-body'];
  const profileSelect = findDeep(body, (child) => child.id === 'opening-profile-select');
  const option = profileSelect.children.find((child) => child.value === profileId);
  option.selected = true;
  profileSelect.value = profileId;
  profileSelect.onchange();
}

test('#1329: elegir gola preselecciona el único estándar seleccionable del taller', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(STANDARD_ANSWER);

  pickGola(elementsById);
  assert.strictEqual(opening._state().draft.profileId, 'profile.gola-l.alu',
    'the workshop standard is the preselection for a fresh gola choice');
  // And the single-placement profile auto-assigns its placement as today.
  // (JSON compare: the array lives in the vm realm, not this one.)
  assert.strictEqual(JSON.stringify(opening._state().draft.placements), JSON.stringify(['top']));
});

test('#1329: dos secciones con estándar no adivinan — sin preselección', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening({
    ...STANDARD_ANSWER,
    capabilities: {
      version: 1,
      grips: {
        handle: { enabled: true, default: true },
        gola: {
          enabled: true,
          profiles: ['profile.gola-l.alu', 'profile.gola-l.marca-b', 'profile.gola-c.alu'],
          standardProfiles: { L: 'profile.gola-l.alu', C: 'profile.gola-c.alu' }
        }
      }
    },
    profiles: [
      ...STANDARD_ANSWER.profiles,
      { id: 'profile.gola-c.alu', name: 'Gola C', cross_section_shape: 'C', datasheet_status: 'verified', compatible_placements: ['between'] }
    ]
  });

  pickGola(elementsById);
  assert.strictEqual(opening._state().draft.profileId, '',
    'with several marked sections the card cannot guess — the honest absence');
});

test('#1329 fail-closed: un estándar no seleccionable (pendiente de ficha) no preselecciona', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening({
    ...STANDARD_ANSWER,
    capabilities: {
      version: 1,
      grips: {
        handle: { enabled: true, default: true },
        gola: {
          enabled: true,
          profiles: ['profile.gola-l.alu', 'profile.gola-l.dead'],
          standardProfiles: { L: 'profile.gola-l.dead' }
        }
      }
    },
    profiles: [
      STANDARD_ANSWER.profiles[0],
      { id: 'profile.gola-l.dead', name: 'Gola muerto', cross_section_shape: 'L', datasheet_status: 'pending', compatible_placements: ['top'] }
    ]
  });

  pickGola(elementsById);
  assert.strictEqual(opening._state().draft.profileId, '',
    'a dead standard never invents a preselection');
});

test('#1329: consecuencias visibles del perfil elegido — descuento, muesca y fabricante', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(STANDARD_ANSWER);

  pickGola(elementsById);
  const consequences = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-consequences');
  assert.ok(consequences, 'the consequences line must render for the chosen profile');
  assert.ok(consequences.textContent.includes('H−40'), consequences.textContent);
  assert.ok(consequences.textContent.includes('Muesca 56.5 × 27.2 mm'), consequences.textContent);
  assert.ok(consequences.textContent.includes('SCILM'), consequences.textContent);

  // The option names the maker too, before selecting.
  const profileSelect = findDeep(elementsById['design-inspector-opening-body'], (child) => child.id === 'opening-profile-select');
  const marcaBOption = profileSelect.children.find((child) => child.value === 'profile.gola-l.marca-b');
  assert.ok(marcaBOption.textContent.includes('Marca B'), marcaBOption.textContent);
});

test('#1329: elegir el ESTÁNDAR muestra la nota y aplica con UN click', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(STANDARD_ANSWER);

  pickGola(elementsById); // preselecciona el estándar
  const note = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-standard-note');
  assert.ok(note, 'the standard note must render');
  assert.ok(note.textContent.includes('Perfil estándar de tu taller'), note.textContent);

  const applyButton = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  applyButton.onclick();
  assert.strictEqual(bridgeCalls.length, 2);
  assert.strictEqual(bridgeCalls[1].command, 'apply_design_opening',
    'the standard applies directly — one click, no confirmation friction');
});

test('#1329: elegir un NO estándar exige confirmación — el primer click NO emite el PUT', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(STANDARD_ANSWER);

  pickGola(elementsById);
  pickProfile(elementsById, 'profile.gola-l.marca-b');
  const applyButton = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  applyButton.onclick();

  assert.strictEqual(bridgeCalls.length, 1, 'the first click only arms the warning — no write');
  const warning = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-nonstandard-warning');
  assert.ok(warning, 'the non-standard warning must render');
  assert.ok(warning.textContent.includes('no es el estándar de tu taller'), warning.textContent);
  assert.ok(warning.textContent.includes('Gola L SCILM 8006'), 'the warning names the standard');
  const confirmButton = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply');
  assert.ok(confirmButton.textContent.includes('Confirmar perfil no estándar'), confirmButton.textContent);

  // Second click: the explicit confirmation sends the ONE write.
  confirmButton.onclick();
  assert.strictEqual(bridgeCalls.length, 2);
  assert.strictEqual(bridgeCalls[1].command, 'apply_design_opening');
  assert.strictEqual(bridgeCalls[1].payload.selection.profileId, 'profile.gola-l.marca-b');
});

test('#1329: cambiar el perfil después de la advertencia la limpia (se re-confirma)', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(STANDARD_ANSWER);

  pickGola(elementsById);
  pickProfile(elementsById, 'profile.gola-l.marca-b');
  findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply').onclick();
  assert.strictEqual(opening._state().confirmNonStandard, true);

  pickProfile(elementsById, 'profile.gola-l.alu');
  assert.strictEqual(opening._state().confirmNonStandard, false, 'a new choice clears the armed confirmation');
  assert.ok(!findAllDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-nonstandard-warning').length,
    'the warning disappears with the new choice');
  // And applying the standard goes straight through again.
  findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-apply').onclick();
  assert.strictEqual(bridgeCalls.length, 2);
});

// #1330 fixtures: a PERSISTED gola selection carrying its frozen pin (the
// same shape the design opening GET/PUT serializes).
const PINNED_ANSWER = {
  ...STANDARD_ANSWER,
  opening: {
    system: 'gola',
    profileId: 'profile.gola-l.alu',
    placements: ['top'],
    profilePin: {
      profileCode: 'GOLA-L-SCILM-8006',
      frontReductionMm: 38,
      gripClearanceMm: 2,
      doorReductionMm: 40,
      datasheetStatus: 'verified',
      bom: { profileVersion: 8, members: {} }
    }
  }
};

test('#1330: la tarjeta nombra el pin congelado — código, versión y descuento', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening(PINNED_ANSWER);

  const persisted = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-persisted');
  assert.ok(persisted, 'the persisted note must render');
  assert.ok(persisted.textContent.includes('Apertura guardada: Gola (perfil integrado)'), persisted.textContent);
  assert.ok(persisted.textContent.includes('GOLA-L-SCILM-8006 v8'), persisted.textContent);
  assert.ok(persisted.textContent.includes('puertas H−40'), persisted.textContent);
  // The pin wins over the live catalog name (one truth with the web).
  assert.ok(!persisted.textContent.includes('Gola L SCILM 8006 ('), persisted.textContent);
});

test('#1330: gola sin pin (pre-pin) pide re-aplicar; los otros sistemas no llevan pin', () => {
  const bridgeCalls = [];
  const { opening, elementsById } = initModule(bridgeCalls);
  opening.refresh('d-1', 'v1');
  opening.onDesignOpening({
    ...STANDARD_ANSWER,
    opening: { system: 'gola', profileId: 'profile.gola-l.alu', placements: ['top'] }
  });
  let persisted = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-persisted');
  assert.ok(persisted.textContent.includes('sin pin — re-aplicá la apertura'), persisted.textContent);

  // A different design re-issues the authoritative read (requestId advances).
  opening.ensureLoaded('d-2');
  const requestId = bridgeCalls[bridgeCalls.length - 1].payload.requestId;
  opening.onDesignOpening({
    ...STANDARD_ANSWER,
    requestId,
    designId: 'd-2',
    opening: { system: 'handle', profileId: '', placements: [] }
  });
  persisted = findDeep(elementsById['design-inspector-opening-body'], (child) => child.attributes['data-testid'] === 'opening-persisted');
  assert.ok(persisted.textContent.includes('Apertura guardada: Jaladera'), persisted.textContent);
  assert.ok(!persisted.textContent.includes('sin pin'), persisted.textContent);
});

test('#1330: getSummary reporta la versión pineada y degrada al código del pin si el perfil sale del catálogo', () => {
  const bridgeCalls = [];
  const { opening } = initModule(bridgeCalls);
  opening.refresh('d-pin', 'v1');
  opening.onDesignOpening(PINNED_ANSWER);

  const summary = opening.getSummary();
  assert.strictEqual(summary.profileName, 'GOLA-L-SCILM-8006', 'the frozen pin names the profile');
  assert.strictEqual(summary.profileVersion, 8);

  // The profile disappears from the live catalog: the pin still names it.
  opening.ensureLoaded('d-pin-2');
  const degradedRequestId = bridgeCalls[bridgeCalls.length - 1].payload.requestId;
  opening.onDesignOpening({
    ...PINNED_ANSWER,
    requestId: degradedRequestId,
    designId: 'd-pin-2',
    profiles: [{ id: 'profile.other', name: 'Otro', datasheet_status: 'verified', compatible_placements: ['top'] }]
  });
  const degraded = opening.getSummary();
  assert.strictEqual(degraded.profileName, 'GOLA-L-SCILM-8006');
  assert.strictEqual(degraded.profileVersion, 8);
});

console.log(JSON.stringify({ success: true, testsPassed }));
