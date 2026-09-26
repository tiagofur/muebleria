// #848 Phase B C4.5 — real JavaScript harness for granete-finish-selector.js:
// the visual material picker modal (Miller Columns) under
// window.GraneteUI.finishSelector. Drives the actual module file in a vm
// sandbox (mock DOM faithful to the dialog.html markup, including the
// initial display:none states) with the five injected dependencies
// (getMaterialCategories, materialById, optionMaterialIds,
// updateMaterialSwatch, icon) as recording functions, and proves the
// ownership contract: modal lifecycle, category navigation/subtree
// filtering, role-allowed candidates, search, candidate grid + detail,
// Apply/Cancel with scope passthrough, and the keyboard/focus lifecycle
// (Esc, Enter-not-in-search, Tab trap, Shift+Tab wrap, opener restore).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-finish-selector.js');
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
      const type = typeof event === 'string' ? event : event.type;
      (listeners[type] || []).forEach((cb) => cb(event));
      return true;
    },
    click: () => {
      (listeners['click'] || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    dblclick: () => {
      (listeners['dblclick'] || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    focus: () => {
      if (el.__document) el.__document.activeElement = el;
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    // Minimal tree search for the modal focus trap selector
    // ('button, input, select, [tabindex="0"]').
    querySelectorAll: (selector) => {
      if (selector !== 'button, input, select, [tabindex="0"]') return [];
      const found = [];
      const walk = (node) => {
        node.children.forEach((child) => {
          const tag = String(child.tagName || '').toUpperCase();
          if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' ||
              child.getAttribute('tabindex') === '0') {
            found.push(child);
          }
          walk(child);
        });
      };
      walk(el);
      return found;
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

// Three-level category tree mirroring the real catalog shape.
const CATEGORIES = [
  { id: 'cat-l1a', name: 'Tableros', sortOrder: 1 },
  { id: 'cat-l1b', name: 'Frentes', sortOrder: 2 },
  { id: 'cat-l2a', name: 'Melamina', parentId: 'cat-l1a', sortOrder: 1 },
  { id: 'cat-l2b', name: 'Madera Maciza', parentId: 'cat-l1a', sortOrder: 2 },
  { id: 'cat-l3a', name: 'Roble', parentId: 'cat-l2a', sortOrder: 1 }
];

const MATERIALS = [
  { materialId: 'mat-1', name: 'Melamina Blanca', code: 'MB-01', manufacturer: 'Finsa', thicknessMm: 18, grain: false, categoryId: 'cat-l2a' },
  { materialId: 'mat-2', name: 'Roble Natural', code: 'ROB-02', manufacturer: 'Egger', thicknessMm: 19, grain: true, categoryId: 'cat-l3a', previewColor: '#8B5A2B' },
  { materialId: 'mat-3', name: 'Frente Laca', code: 'FL-03', manufacturer: 'Blum', thicknessMm: 0, grain: false, categoryId: 'cat-l1b', previewTextureUrl: 'tex/laca.png' },
  { materialId: 'mat-4', name: 'Sin Categoría', code: 'SC-04', manufacturer: 'Otro', thicknessMm: 22, grain: false, imageUrl: 'img/sc.png' }
];

function materialById(id) {
  for (let i = 0; i < MATERIALS.length; i++) {
    if (MATERIALS[i].materialId === id) return MATERIALS[i];
  }
  return null;
}

// Mirrors the inline optionMaterialIds: the role's curated optionIds when
// they resolve, else every material in the catalog.
function optionMaterialIds(roleEntry) {
  const ids = (roleEntry.optionIds || []).filter((id) => !!materialById(id));
  if (ids.length > 0) return ids;
  return MATERIALS.map((m) => m.materialId);
}

const FULL_ROLE = { role: 'FRENTES', label: 'Frentes', optionIds: ['mat-1', 'mat-2', 'mat-3', 'mat-4'] };

// Fresh sandbox per test. The modal subtree mirrors the dialog.html markup
// (focusables inside the modal, initial display:none states) so the focus
// trap and visibility behavior are exercised faithfully.
function runModule(depOverrides) {
  const registry = {};
  const documentListeners = {};
  const documentMock = {
    activeElement: null,
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag),
    querySelector: (sel) => {
      if (sel === 'input[name="selector-scope"]:checked') {
        const project = registry['selector-scope-project'];
        if (project && project.checked) return project;
        const furniture = registry['selector-scope-furniture'];
        if (furniture && furniture.checked) return furniture;
        return null;
      }
      return null;
    },
    addEventListener: (evt, cb) => {
      documentListeners[evt] = documentListeners[evt] || [];
      documentListeners[evt].push(cb);
    }
  };

  const calls = { swatch: [], icon: [], categories: 0, apply: [] };

  const sandbox = {
    document: documentMock,
    window: {}
  };
  sandbox.__registry = registry;
  sandbox.__listeners = documentListeners;
  sandbox.__calls = calls;

  // Pre-create the elements the module binds at load time, wire focus()
  // into document.activeElement and mirror the markup's initial states.
  ['material-selector-modal', 'selector-modal-title', 'selector-modal-role-badge',
    'btn-selector-modal-close', 'btn-selector-cancel', 'btn-selector-apply',
    'selector-search-input', 'selector-search-clear', 'selector-breadcrumbs',
    'selector-miller-columns', 'selector-col-level-1', 'selector-col-level-2',
    'selector-col-level-3', 'selector-col-list-1', 'selector-col-list-2',
    'selector-col-list-3', 'selector-candidate-grid', 'selector-candidate-count',
    'selector-candidate-empty', 'selector-candidate-empty-msg', 'selector-detail-swatch',
    'selector-detail-name', 'selector-detail-code', 'selector-spec-manufacturer',
    'selector-spec-thickness', 'selector-spec-grain', 'selector-spec-category',
    'selector-spec-texture', 'selector-scope-furniture-label'].forEach((id) => {
    registry[id] = createMockElement(id);
    registry[id].__document = documentMock;
  });

  const modal = registry['material-selector-modal'];
  const closeBtn = registry['btn-selector-modal-close'];
  closeBtn.tagName = 'BUTTON';
  const searchInput = registry['selector-search-input'];
  searchInput.tagName = 'INPUT';
  const searchClear = registry['selector-search-clear'];
  searchClear.tagName = 'BUTTON';
  searchClear.style.display = 'none';
  const scopeFurniture = registry['selector-scope-furniture'] = createMockElement('selector-scope-furniture', 'INPUT');
  scopeFurniture.value = 'furniture';
  scopeFurniture.checked = true;
  scopeFurniture.__document = documentMock;
  const scopeProject = registry['selector-scope-project'] = createMockElement('selector-scope-project', 'INPUT');
  scopeProject.value = 'project';
  scopeProject.checked = false;
  scopeProject.__document = documentMock;
  const cancelBtn = registry['btn-selector-cancel'];
  cancelBtn.tagName = 'BUTTON';
  const applyBtn = registry['btn-selector-apply'];
  applyBtn.tagName = 'BUTTON';
  registry['selector-col-level-2'].style.display = 'none';
  registry['selector-col-level-3'].style.display = 'none';
  registry['selector-candidate-empty'].style.display = 'none';
  modal.style.display = 'none';

  // Focusables inside the modal, in markup order (header close → search →
  // clear → scope radios → footer cancel/apply). The trap wraps first↔last.
  [closeBtn, searchInput, searchClear, scopeFurniture, scopeProject, cancelBtn, applyBtn]
    .forEach((el) => modal.appendChild(el));

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });

  sandbox.window.GraneteUI.finishSelector.init(Object.assign({
    getMaterialCategories: () => {
      calls.categories += 1;
      return sandbox.__categories || CATEGORIES;
    },
    materialById: materialById,
    optionMaterialIds: optionMaterialIds,
    updateMaterialSwatch: (el, mat) => calls.swatch.push([el, mat]),
    icon: (name, size) => {
      calls.icon.push([name, size]);
      return `<svg-${name}-${size}>`;
    }
  }, depOverrides || {}));
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function modalOpen(sandbox) {
  return el(sandbox, 'material-selector-modal').style.display !== 'none';
}

function openerFor(sandbox) {
  const opener = createMockElement('opener');
  opener.__document = { activeElement: null };
  // The module restores focus on the element captured from
  // document.activeElement at open() time.
  sandbox.document.activeElement = opener;
  opener.focus = () => {
    sandbox.document.activeElement = opener;
  };
  return opener;
}

function openModal(sandbox, opts) {
  const options = opts || {};
  const opener = options.opener || openerFor(sandbox);
  const applied = [];
  sandbox.window.GraneteUI.finishSelector.open(
    options.roleEntry || FULL_ROLE,
    options.initialSelectedId === undefined ? 'mat-1' : options.initialSelectedId,
    (newId, scope) => applied.push([newId, scope]),
    options.contextKind || 'configurator'
  );
  return { opener, applied };
}

function pressKey(sandbox, key, shiftKey) {
  let prevented = false;
  (sandbox.__listeners.keydown || []).forEach((cb) => {
    cb({ key, shiftKey: !!shiftKey, preventDefault: () => { prevented = true; } });
  });
  return prevented;
}

function setSearch(sandbox, value) {
  const input = el(sandbox, 'selector-search-input');
  input.value = value;
  input.dispatchEvent({ type: 'input', target: input });
}

// --- Registration / API / init contract ---

test('registers on window.GraneteUI.finishSelector with exactly init/open/close', () => {
  const sandbox = runModule();
  const api = sandbox.window.GraneteUI.finishSelector;
  assert(api && typeof api.init === 'function' && typeof api.open === 'function' &&
    typeof api.close === 'function', 'public API must be init/open/close');
  assert(Object.keys(api).length === 3, 'no extra public surface: ' + Object.keys(api).join(','));
});

test('re-execution is idempotent (no duplicate document listeners)', () => {
  const sandbox = runModule();
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert((sandbox.__listeners.keydown || []).length === 1,
    'second execution must not register the modal keydown listener again');
});

test('open without init fails fast listing the missing deps', () => {
  const sandbox = { document: { getElementById: () => createMockElement(), createElement: (t) => createMockElement('', t), addEventListener: () => {}, querySelector: () => null, activeElement: null }, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert.throws(
    () => sandbox.window.GraneteUI.finishSelector.open(FULL_ROLE, null, null, 'configurator'),
    (err) => /missing deps/.test(err.message) &&
      /getMaterialCategories/.test(err.message) && /materialById/.test(err.message) &&
      /optionMaterialIds/.test(err.message) && /updateMaterialSwatch/.test(err.message) &&
      /icon/.test(err.message),
    'must name every missing dependency');
});

test('open with a partial init fails fast naming only the missing dep', () => {
  const sandbox = { document: { getElementById: () => createMockElement(), createElement: (t) => createMockElement('', t), addEventListener: () => {}, querySelector: () => null, activeElement: null }, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  sandbox.window.GraneteUI.finishSelector.init({ icon: () => '' });
  assert.throws(
    () => sandbox.window.GraneteUI.finishSelector.open(FULL_ROLE, null, null, 'configurator'),
    (err) => /missing deps: getMaterialCategories/.test(err.message),
    'must list only the missing deps');
});

// --- Modal lifecycle ---

test('open shows the modal, resets search, badges the role and focuses search', () => {
  const sandbox = runModule();
  el(sandbox, 'selector-search-input').value = 'stale';
  openModal(sandbox);
  assert(modalOpen(sandbox), 'modal must be visible (display flex)');
  assert(el(sandbox, 'selector-modal-role-badge').textContent === 'Rol: Frentes');
  assert(el(sandbox, 'selector-search-input').value === '', 'search input resets');
  assert(el(sandbox, 'selector-search-clear').style.display === 'none', 'clear button hidden');
  assert(sandbox.document.activeElement === el(sandbox, 'selector-search-input'),
    'focus moves into the modal search input');
});

test('close hides the modal and restores focus to the opener', () => {
  const sandbox = runModule();
  const { opener } = openModal(sandbox);
  sandbox.window.GraneteUI.finishSelector.close();
  assert(!modalOpen(sandbox), 'modal hidden');
  assert(sandbox.document.activeElement === opener, 'focus returns to the opener');
});

test('context copy: configurator vs inspector furniture scope label', () => {
  const configurator = runModule();
  openModal(configurator, { contextKind: 'configurator' });
  assert(el(configurator, 'selector-scope-furniture-label').textContent === 'Aplicar a esta configuración');
  const inspector = runModule();
  openModal(inspector, { contextKind: 'inspector' });
  assert(el(inspector, 'selector-scope-furniture-label').textContent === 'Aplicar a este mueble');
});

// --- Category navigation / Miller columns ---

test('empty catalog hides the Miller columns entirely', () => {
  const sandbox = runModule();
  sandbox.__categories = [];
  openModal(sandbox);
  assert(el(sandbox, 'selector-miller-columns').style.display === 'none',
    'no categories → no columns');
});

test('L1 renders "Todas" plus the root categories in sortOrder', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  const items = el(sandbox, 'selector-col-list-1').children;
  assert(items.length === 3, 'Todas + Tableros + Frentes');
  assert(items[0].children[0].textContent === 'Todas');
  assert(items[0].children[1].textContent === '4');
  assert(items[1].children[0].textContent === 'Tableros');
  assert(items[2].children[0].textContent === 'Frentes');
  assert(el(sandbox, 'selector-col-level-2').style.display === 'none',
    'no L1 selected → L2 column hidden');
});

test('selected material auto-expands its category path (L1/L2/L3)', () => {
  const sandbox = runModule();
  // mat-2 lives in Tableros › Melamina › Roble (cat-l3a)
  openModal(sandbox, { initialSelectedId: 'mat-2' });
  assert(el(sandbox, 'selector-col-level-2').style.display === 'flex', 'L2 visible');
  assert(el(sandbox, 'selector-col-level-3').style.display === 'flex', 'L3 visible');
  const crumbs = el(sandbox, 'selector-breadcrumbs').children;
  const labels = crumbs.map((c) => c.textContent).filter((t) => t !== '›');
  assert.deepStrictEqual(labels, ['Catálogo', 'Tableros', 'Melamina', 'Roble'],
    'breadcrumb follows the auto-expanded path');
});

test('L1 click opens L2; L2 click opens L3 (progressive columns)', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  el(sandbox, 'selector-col-list-1').children[1].click(); // Tableros
  assert(el(sandbox, 'selector-col-level-2').style.display === 'flex');
  const l2 = el(sandbox, 'selector-col-list-2').children;
  assert(l2.length === 3, 'Todas + Melamina + Madera Maciza');
  l2[1].click(); // Melamina
  assert(el(sandbox, 'selector-col-level-3').style.display === 'flex');
  const l3 = el(sandbox, 'selector-col-list-3').children;
  assert(l3.length === 2, 'Todas + Roble');
  assert(l3[1].children[0].textContent === 'Roble');
});

test('subtree filtering: selecting an L1 shows only its subtree materials', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  el(sandbox, 'selector-col-list-1').children[1].click(); // Tableros
  // Tableros subtree: mat-1 (Melamina) + mat-2 (Roble); NOT mat-3 (Frentes)
  const cards = el(sandbox, 'selector-candidate-grid').children;
  assert(cards.length === 2, 'subtree-inclusive filtering, got ' + cards.length);
  el(sandbox, 'selector-col-list-2').children[1].click(); // Melamina
  assert(el(sandbox, 'selector-candidate-grid').children.length === 2,
    'Melamina keeps Roble (deeper) + Melamina Blanca');
  el(sandbox, 'selector-col-list-3').children[1].click(); // Roble
  assert(el(sandbox, 'selector-candidate-grid').children.length === 1,
    'L3 narrows to the Roble leaf');
});

test('breadcrumb navigation resets the columns (click on "Catálogo")', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: 'mat-2' });
  const crumbs = el(sandbox, 'selector-breadcrumbs').children.filter((c) => c.textContent !== '›');
  crumbs[0].click(); // Catálogo root
  assert(el(sandbox, 'selector-col-level-2').style.display === 'none');
  assert(el(sandbox, 'selector-col-level-3').style.display === 'none');
  assert(el(sandbox, 'selector-candidate-grid').children.length === 4,
    'root shows every allowed material');
});

test('role allowedMaterialIds restrict candidates (resolver contract)', () => {
  const sandbox = runModule();
  openModal(sandbox, {
    roleEntry: { role: 'FRENTES', label: 'Frentes', optionIds: ['mat-3'] },
    initialSelectedId: null
  });
  const cards = el(sandbox, 'selector-candidate-grid').children;
  assert(cards.length === 1, 'only the role-curated material renders');
  assert(el(sandbox, 'selector-candidate-count').textContent === '1 opción',
    'singular count copy');
});

// --- Search ---

test('search by name, code and manufacturer', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  setSearch(sandbox, 'roble natural');
  assert(el(sandbox, 'selector-candidate-grid').children.length === 1, 'by name');
  setSearch(sandbox, 'mb-01');
  assert(el(sandbox, 'selector-candidate-grid').children.length === 1, 'by code');
  setSearch(sandbox, 'blum');
  assert(el(sandbox, 'selector-candidate-grid').children.length === 1, 'by manufacturer');
});

test('search clear button resets the query and refocuses the input', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  setSearch(sandbox, 'zzz-inexistente');
  assert(el(sandbox, 'selector-candidate-empty').style.display === 'block',
    'empty search state');
  assert(el(sandbox, 'selector-candidate-empty-msg').textContent ===
    'No se encontraron materiales que coincidan con la búsqueda.');
  const clear = el(sandbox, 'selector-search-clear');
  assert(clear.style.display === 'block', 'clear visible while typing');
  sandbox.document.activeElement = null;
  clear.click();
  assert(el(sandbox, 'selector-search-input').value === '');
  assert(el(sandbox, 'selector-candidate-grid').children.length === 4, 'full grid back');
  assert(sandbox.document.activeElement === el(sandbox, 'selector-search-input'),
    'clear refocuses the search input');
});

test('empty role shows the workshop configuration empty state', () => {
  const sandbox = runModule({ optionMaterialIds: () => [] });
  openModal(sandbox);
  assert(el(sandbox, 'selector-candidate-empty').style.display === 'block');
  assert(el(sandbox, 'selector-candidate-empty-msg').textContent ===
    'Este rol no tiene materiales asignados. Configurá el grupo de opciones en Granete.');
});

test('empty category shows the category empty state (no search)', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  // Frentes (cat-l1b) has mat-3; Madera Maciza (cat-l2b) has none.
  el(sandbox, 'selector-col-list-1').children[1].click(); // Tableros
  el(sandbox, 'selector-col-list-2').children[2].click(); // Madera Maciza
  assert(el(sandbox, 'selector-candidate-empty').style.display === 'block');
  assert(el(sandbox, 'selector-candidate-empty-msg').textContent ===
    'No hay materiales en esta categoría.');
});

test('candidate count copy: singular/plural (preserved quirk: "opción" + "es")', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  // Pre-existing copy quirk kept verbatim: the count suffix appends "es"
  // to "opción", producing "opciónes". Behavior-preserving slice — the
  // string stays exactly as the inline modal produced it.
  assert(el(sandbox, 'selector-candidate-count').textContent === '4 opciónes');
  setSearch(sandbox, 'roble natural');
  assert(el(sandbox, 'selector-candidate-count').textContent === '1 opción');
});

// --- Candidate grid / detail ---

test('candidate card renders swatch, tags and the selected check', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: 'mat-1' });
  const cards = el(sandbox, 'selector-candidate-grid').children;
  const selected = cards[0];
  assert(selected.classList.contains('selected'), 'initial selection is checked');
  const check = selected.children.find((c) => c.classList.contains('mat-card-selected-check'));
  assert(check && check.textContent === '✓');
  const grainy = cards.find((c) => c.children[0].children.some((s) =>
    s.classList.contains('mat-card-badge-grain')));
  assert(grainy, 'mat-2 (grain) carries the veta badge');
  const grainBadge = grainy.children[0].children.find((s) => s.classList.contains('mat-card-badge-grain'));
  assert(grainBadge.innerHTML === '<svg-grain-11> Veta');
  const tags = cards.map((c) => {
    const info = c.children.find((x) => x.classList.contains('mat-card-info'));
    const meta = info.children.find((x) => x.classList.contains('mat-card-meta'));
    return meta.children.map((t) => t.textContent);
  });
  assert.deepStrictEqual(tags[0], ['MB-01', '18 mm', 'Finsa'], 'code/thickness/manufacturer tags');
  assert(sandbox.__calls.swatch.some(([target, mat]) => mat && mat.materialId === 'mat-2'),
    'candidates paint through the shared swatch renderer');
});

test('candidate click selects and enables Apply; detail updates', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  assert(el(sandbox, 'btn-selector-apply').disabled === true, 'no selection → disabled');
  el(sandbox, 'selector-candidate-grid').children[2].click(); // mat-3
  assert(el(sandbox, 'btn-selector-apply').disabled === false);
  assert(el(sandbox, 'selector-detail-name').textContent === 'Frente Laca');
  // The click re-renders the grid (innerHTML rebuild): assert on the fresh card.
  assert(el(sandbox, 'selector-candidate-grid').children[2].classList.contains('selected'));
});

test('candidate double-click applies immediately', () => {
  const sandbox = runModule();
  const { applied } = openModal(sandbox, { initialSelectedId: null });
  const mat1 = el(sandbox, 'selector-candidate-grid').children[0];
  mat1.dblclick();
  assert(applied.length === 1 && applied[0][0] === 'mat-1' && applied[0][1] === 'furniture');
  assert(!modalOpen(sandbox), 'modal closed after dblclick apply');
});

test('detail renders the full ficha técnica (path + texture variants)', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: 'mat-2' });
  const d = (id) => el(sandbox, id).textContent;
  assert(d('selector-detail-name') === 'Roble Natural');
  assert(d('selector-detail-code') === 'Código: ROB-02');
  assert(d('selector-spec-manufacturer') === 'Egger');
  assert(d('selector-spec-thickness') === '19 mm');
  assert(d('selector-spec-grain') === 'Sí (con veta)');
  assert(d('selector-spec-category') === 'Tableros › Melamina › Roble');
  assert(d('selector-spec-texture') === 'Color sólido (#8B5A2B)', 'previewColor variant');
  // Variants: texture url / image url / plain color default.
  openModal(sandbox, { initialSelectedId: 'mat-3' });
  assert(el(sandbox, 'selector-spec-texture').textContent === 'Textura 3D / PBR');
  openModal(sandbox, { initialSelectedId: 'mat-4' });
  assert(el(sandbox, 'selector-spec-texture').textContent === 'Imagen / Foto');
  assert(el(sandbox, 'selector-spec-category').textContent === 'Sin categoría');
  openModal(sandbox, { initialSelectedId: 'mat-1' });
  assert(el(sandbox, 'selector-spec-texture').textContent === 'Color estándar');
  openModal(sandbox, { initialSelectedId: null });
  assert(el(sandbox, 'selector-detail-name').textContent === 'Seleccioná un material');
  assert(el(sandbox, 'selector-detail-code').textContent === '--');
});

test('no code material renders an empty code line in the detail', () => {
  const codelessMaterial = { materialId: 'mat-nc', name: 'Sin Código', grain: false };
  const sandbox = runModule({
    materialById: (id) => (id === 'mat-nc' ? codelessMaterial : null),
    optionMaterialIds: () => ['mat-nc']
  });
  openModal(sandbox, {
    roleEntry: { role: 'R', label: 'R', optionIds: ['mat-nc'] },
    initialSelectedId: 'mat-nc'
  });
  assert(el(sandbox, 'selector-detail-name').textContent === 'Sin Código');
  assert(el(sandbox, 'selector-detail-code').textContent === '', 'no code → empty string');
  assert(el(sandbox, 'selector-spec-manufacturer').textContent === 'Sin fabricante');
  assert(el(sandbox, 'selector-spec-thickness').textContent === '--');
  assert(el(sandbox, 'selector-spec-grain').textContent === 'No');
});

// --- Apply / Cancel / scope ---

test('Apply closes the modal BEFORE the callback and passes furniture scope by default', () => {
  const sandbox = runModule();
  const seen = [];
  const opener = openerFor(sandbox);
  sandbox.window.GraneteUI.finishSelector.open(FULL_ROLE, 'mat-2', (newId, scope) => {
    seen.push([newId, scope, modalOpen(sandbox)]);
  }, 'configurator');
  el(sandbox, 'btn-selector-apply').click();
  assert(seen.length === 1, 'callback fired once');
  assert.deepStrictEqual(seen[0], ['mat-2', 'furniture', false],
    'callback receives (materialId, scope) after close');
  assert(sandbox.document.activeElement === opener, 'focus restored to opener');
});

test('project scope radio is passed through untouched', () => {
  const sandbox = runModule();
  const applied = [];
  sandbox.window.GraneteUI.finishSelector.open(FULL_ROLE, 'mat-1', (id, scope) => applied.push([id, scope]), 'configurator');
  el(sandbox, 'selector-scope-furniture').checked = false;
  el(sandbox, 'selector-scope-project').checked = true;
  el(sandbox, 'btn-selector-apply').click();
  assert.deepStrictEqual(applied, [['mat-1', 'project']], 'scope passthrough, no interpretation');
});

test('Cancel closes without calling back', () => {
  const sandbox = runModule();
  const { applied, opener } = openModal(sandbox);
  el(sandbox, 'btn-selector-cancel').click();
  assert(!modalOpen(sandbox));
  assert(applied.length === 0, 'no callback on cancel');
  assert(sandbox.document.activeElement === opener);
});

test('header close button behaves like cancel', () => {
  const sandbox = runModule();
  const { applied } = openModal(sandbox);
  el(sandbox, 'btn-selector-modal-close').click();
  assert(!modalOpen(sandbox));
  assert(applied.length === 0);
});

// --- Keyboard / focus lifecycle ---

test('Escape closes the modal (and prevents default)', () => {
  const sandbox = runModule();
  const { applied } = openModal(sandbox);
  const prevented = pressKey(sandbox, 'Escape');
  assert(prevented, 'Escape is preventDefault-ed');
  assert(!modalOpen(sandbox));
  assert(applied.length === 0);
});

test('Escape outside the open modal does nothing', () => {
  const sandbox = runModule();
  openModal(sandbox);
  sandbox.window.GraneteUI.finishSelector.close();
  const prevented = pressKey(sandbox, 'Escape');
  assert(!prevented, 'handler is a no-op while the modal is closed');
});

test('Enter applies when a candidate is selected', () => {
  const sandbox = runModule();
  const { applied } = openModal(sandbox, { initialSelectedId: 'mat-3' });
  sandbox.document.activeElement = el(sandbox, 'btn-selector-apply'); // not the search input
  pressKey(sandbox, 'Enter');
  assert(applied.length === 1 && applied[0][0] === 'mat-3');
});

test('Enter with a disabled Apply does nothing', () => {
  const sandbox = runModule();
  const { applied } = openModal(sandbox, { initialSelectedId: null });
  sandbox.document.activeElement = el(sandbox, 'btn-selector-apply');
  pressKey(sandbox, 'Enter');
  assert(applied.length === 0);
  assert(modalOpen(sandbox));
});

test('Enter while typing in the search input does NOT apply', () => {
  const sandbox = runModule();
  const { applied } = openModal(sandbox, { initialSelectedId: 'mat-1' });
  sandbox.document.activeElement = el(sandbox, 'selector-search-input');
  pressKey(sandbox, 'Enter');
  assert(applied.length === 0, 'Enter in search must not apply');
  assert(modalOpen(sandbox));
});

test('Tab on the last focusable wraps to the first (trap)', () => {
  const sandbox = runModule();
  openModal(sandbox);
  const modal = el(sandbox, 'material-selector-modal');
  const focusables = modal.querySelectorAll('button, input, select, [tabindex="0"]');
  assert(focusables.length === 7, 'markup focusables found, got ' + focusables.length);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  sandbox.document.activeElement = last;
  pressKey(sandbox, 'Tab');
  assert(sandbox.document.activeElement === first, 'Tab wraps forward to first');
});

test('Shift+Tab on the first focusable wraps to the last', () => {
  const sandbox = runModule();
  openModal(sandbox);
  const modal = el(sandbox, 'material-selector-modal');
  const focusables = modal.querySelectorAll('button, input, select, [tabindex="0"]');
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  sandbox.document.activeElement = first;
  pressKey(sandbox, 'Tab', true);
  assert(sandbox.document.activeElement === last, 'Shift+Tab wraps backward to last');
});

test('Tab in the middle of the dialog is not intercepted', () => {
  const sandbox = runModule();
  openModal(sandbox);
  const modal = el(sandbox, 'material-selector-modal');
  const focusables = modal.querySelectorAll('button, input, select, [tabindex="0"]');
  const middle = focusables[3];
  sandbox.document.activeElement = middle;
  const prevented = pressKey(sandbox, 'Tab');
  assert(!prevented, 'native Tab ordering between first and last');
  assert(sandbox.document.activeElement === middle);
});

// --- Boundary: catalog authority is call-time, never copied ---

test('category accessor is read at render time (catalog refresh is picked up)', () => {
  const sandbox = runModule();
  openModal(sandbox, { initialSelectedId: null });
  assert(el(sandbox, 'selector-col-list-1').children.length === 3);
  sandbox.__categories = [{ id: 'cat-only', name: 'Nuevo', sortOrder: 1 }];
  el(sandbox, 'selector-col-list-1').children[0].click(); // "Todas" re-renders navigation
  assert(el(sandbox, 'selector-col-list-1').children.length === 2,
    'renamed/refreshed catalog drives the columns on the next render');
});

try {
  process.stdout.write(JSON.stringify({ success: true, testsPassed, module: 'granete-finish-selector.js' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: String(error && error.message || error) }));
  process.exit(1);
}
