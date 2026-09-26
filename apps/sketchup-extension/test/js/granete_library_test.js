// #848 Phase B — real JavaScript harness for granete-library.js: the
// library browser module under window.GraneteUI. Drives the actual module
// file in a vm sandbox (mock DOM + recording GraneteUI.media/account and
// sketchup bridge) and proves the ownership contract: single browsing
// authority over furniture definitions, category cascade with subtree-
// inclusive filtering, search, visual states (loading/empty/no-results/
// grid/license blocker), media URL resolution through GraneteUI.media and
// the configurator hand-off via the injected onSelectDefinition callback.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-library.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');
const DIALOG_HTML = fs.readFileSync(
  path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html'), 'utf8'
);

const FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
const SIGNED_A = 'https://cdn.test/grant-a?exp=1';

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
    onchange: null,
    onclick: null,
    onerror: null,
    nextElementSibling: null,
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

function definition(overrides) {
  return Object.assign({
    furniture_definition_id: 'def-x',
    name: 'Mueble X',
    parameters: []
  }, overrides);
}

// Fresh sandbox per test: mock DOM registry, recording GraneteUI.media /
// GraneteUI.account mocks (the real modules own those domains) and the
// sketchup bridge — the same host contracts the module documents.
function runModule(deps) {
  const registry = {};
  const bridgeCalls = [];
  const mediaCalls = { filenameFromPath: [], resolveUrl: [], requestRefresh: [] };
  const accountOpens = [];
  const selections = [];

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => createMockElement('', tag)
  };

  const sandbox = {
    document: documentMock,
    window: {
      sketchup: {
        get_catalog: () => bridgeCalls.push('get_catalog')
      },
      GraneteUI: {
        media: {
          filenameFromPath: (p) => {
            mediaCalls.filenameFromPath.push(p);
            return typeof p === 'string' && p ? p.split('/').pop() : '';
          },
          resolveUrl: (p) => {
            mediaCalls.resolveUrl.push(p);
            const name = typeof p === 'string' && p ? p.split('/').pop() : '';
            return (sandbox.__mediaUrls || {})[name];
          },
          requestRefresh: (f) => mediaCalls.requestRefresh.push(f)
        },
        account: {
          open: () => accountOpens.push('open')
        }
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  sandbox.__media = mediaCalls;
  sandbox.__accountOpens = accountOpens;
  sandbox.__selections = selections;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });

  sandbox.window.GraneteUI.library.init(Object.assign({
    icon: (name) => '<svg-' + name + '>',
    createFurniturePlaceholderSvg: () => 'PLACEHOLDER-SVG',
    onSelectDefinition: (def) => selections.push(def),
    getSelectedDefinitionId: () => (sandbox.__selectedDefinitionId || null)
  }, deps));
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

function setSearch(sandbox, value) {
  el(sandbox, 'library-search-input').value = value;
  el(sandbox, 'library-search-input').dispatchEvent({ type: 'input' });
}

function selectCategory(sandbox, categoryId) {
  el(sandbox, 'library-category-l1').value = categoryId;
  el(sandbox, 'library-category-l1').onchange();
}

const TREE_CATEGORIES = [
  { categoryId: 'cat-1', name: 'Cocinas', sortOrder: 0 },
  { categoryId: 'cat-2', name: 'Inferiores', parentId: 'cat-1', sortOrder: 0 },
  { categoryId: 'cat-3', name: 'Puertas', parentId: 'cat-2', sortOrder: 1 }
];

const TREE_DEFINITIONS = [
  definition({ furniture_definition_id: 'def-door', name: 'Puerta 60', categoryId: 'cat-3', category: 'Cocinas › Puertas' }),
  definition({ furniture_definition_id: 'def-drawer', name: 'Cajón 60', categoryId: 'cat-2', category: 'Cocinas › Inferiores' }),
  definition({ furniture_definition_id: 'def-free', name: 'Suelto', category: 'misc' })
];

function loadTreeCatalog(sandbox) {
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: TREE_DEFINITIONS,
    categories: TREE_CATEGORIES,
    source: 'remote'
  });
  sandbox.window.GraneteUI.library.render();
}

test('registers window.GraneteUI.library with the expected public API', () => {
  const { window } = runModule();
  const library = window.GraneteUI.library;
  assert(library, 'window.GraneteUI.library must exist');
  ['init', 'setCatalog', 'render', 'getDefinitions', 'getCategories',
    'findDefinitionById', 'formatCategoryLabel']
    .forEach((key) => assert.strictEqual(typeof library[key], 'function', key));
});

test('re-execution is idempotent — one registration, same authority', () => {
  const sandbox = runModule();
  const first = sandbox.window.GraneteUI.library;
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert.strictEqual(sandbox.window.GraneteUI.library, first,
    'dialog reopen safety: the module never registers a second authority');
});

test('bootstrap state renders the loading skeletons before any catalog', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.render();
  assert(visible(el(sandbox, 'library-loading-state')), 'loading state is the initial surface');
  assert(!visible(el(sandbox, 'library-empty-state')), 'empty state hidden while loading');
  assert(el(sandbox, 'library-count-badge').style.display === 'none',
    'the count badge stays silent under the skeletons');
  assert(el(sandbox, 'library-count-badge').textContent === 'Cargando…');
});

test('local empty catalog renders the workshop-empty copy without CTA', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({ definitions: [], source: 'local' });
  sandbox.window.GraneteUI.library.render();
  assert(visible(el(sandbox, 'library-empty-state')));
  assert(el(sandbox, 'library-empty-title').textContent === 'El taller todavía no tiene muebles');
  assert(!visible(el(sandbox, 'btn-library-empty-action')), 'no CTA for a truly empty workshop');
  assert(!visible(el(sandbox, 'btn-library-retry')), 'no retry for the local empty catalog');
  assert(el(sandbox, 'library-count-badge').textContent === '0 muebles');
  assert(el(sandbox, 'library-source-note').textContent === 'Catálogo local (modo desarrollo)');
});

test('unauthenticated state offers the account CTA and opens the popover', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({ definitions: [], source: 'unauthenticated' });
  sandbox.window.GraneteUI.library.render();
  assert(el(sandbox, 'library-empty-title').textContent === 'Sesión requerida');
  assert(visible(el(sandbox, 'btn-library-empty-action')));
  assert(el(sandbox, 'btn-library-empty-action').textContent === 'Ir a Iniciar Sesión');
  el(sandbox, 'btn-library-empty-action').onclick();
  assert(sandbox.__accountOpens.length === 1, 'the CTA routes to GraneteUI.account.open');
});

test('connection error state keeps the explicit retry and re-asks Ruby', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({ definitions: [], source: 'error' });
  sandbox.window.GraneteUI.library.render();
  assert(el(sandbox, 'library-empty-title').textContent === 'Error de conexión');
  assert(visible(el(sandbox, 'btn-library-retry')), 'remote errors are retryable');
  el(sandbox, 'btn-library-retry').click();
  assert(sandbox.__bridge.includes('get_catalog'),
    'retry re-asks Ruby for the catalog — never a client-side loading flip');
  el(sandbox, 'btn-library-empty-action').onclick();
  assert(sandbox.__accountOpens.length === 1, 'the error CTA also routes to the account popover');
});

test('license block surfaces the blocker overlay and hides the retry', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({ definitions: [], source: 'remote', licenseBlocked: true });
  assert(visible(el(sandbox, 'library-license-blocker')), 'the blocker overlay is visible');
  assert(el(sandbox, 'library-source-note').textContent.indexOf('licencia no está activa') !== -1);
  sandbox.window.GraneteUI.library.render();
  assert(el(sandbox, 'library-empty-title').textContent === 'Licencia inactiva');
  assert(!visible(el(sandbox, 'btn-library-retry')), 'a license block is not a fetch error');
});

test('array payload keeps the legacy local-catalog semantics', () => {
  const sandbox = runModule();
  const defs = [definition({ furniture_definition_id: 'def-1' })];
  sandbox.window.GraneteUI.library.setCatalog(defs);
  assert.strictEqual(sandbox.window.GraneteUI.library.getDefinitions(), defs,
    'the definitions array is owned, not copied');
  assert.strictEqual(sandbox.window.GraneteUI.library.getCategories().length, 0);
  sandbox.window.GraneteUI.library.render();
  assert(el(sandbox, 'library-source-note').textContent === 'Catálogo local (modo desarrollo)');
});

test('category tree renders the L1 cascade with subtree counts and Sin categoría', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  const l1 = el(sandbox, 'library-category-l1');
  const options = l1.children.map((o) => o.value);
  assert.deepStrictEqual(options, ['ALL', 'UNCAT', 'cat-1'],
    'L1 carries Todas, the uncategorized bucket and the workshop roots');
  const cocinas = l1.children.find((o) => o.value === 'cat-1');
  assert(cocinas.textContent === 'Cocinas (2)', 'the root count includes its whole subtree');
  assert.strictEqual(l1.value, 'ALL');
});

test('selecting an L1 node filters subtree-inclusive and re-renders', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  selectCategory(sandbox, 'cat-1');
  const cards = el(sandbox, 'library-cards-grid').children;
  assert(cards.length === 2, 'grandchild cat-3 and child cat-2 both match the root filter');
  assert(el(sandbox, 'library-count-badge').textContent === '2 muebles');
  selectCategory(sandbox, 'ALL');
  assert(el(sandbox, 'library-cards-grid').children.length === 3);
});

test('Sin categoría buckets only the definitions without categoryId', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  selectCategory(sandbox, 'UNCAT');
  const cards = el(sandbox, 'library-cards-grid').children;
  assert(cards.length === 1);
  assert(cards[0].getAttribute('data-definition-id') === 'def-free');
});

test('L2 cascade fills from the chosen L1 and narrows the grid', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  selectCategory(sandbox, 'cat-1');
  const l2 = el(sandbox, 'library-category-l2');
  assert(visible(l2), 'L2 appears when the chosen L1 has children');
  assert.deepStrictEqual(l2.children.map((o) => o.value), ['cat-1', 'cat-2']);
  l2.value = 'cat-2';
  l2.onchange();
  assert(el(sandbox, 'library-cards-grid').children.length === 2,
    'both cat-2 and its child cat-3 stay under the Inferiores subtree');
  const l3 = el(sandbox, 'library-category-l3');
  assert.deepStrictEqual(l3.children.map((o) => o.value), ['cat-2', 'cat-3']);
  l3.value = 'cat-3';
  l3.onchange();
  assert(el(sandbox, 'library-cards-grid').children.length === 1);
  assert(el(sandbox, 'library-cards-grid').children[0].getAttribute('data-definition-id') === 'def-door');
});

test('legacy flat catalogs fall back to distinct category strings', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [
      definition({ furniture_definition_id: 'def-a', category: 'kitchen_base' }),
      definition({ furniture_definition_id: 'def-b', category: 'kitchen_base' }),
      definition({ furniture_definition_id: 'def-c', category: 'closet' })
    ],
    categories: [],
    source: 'local'
  });
  sandbox.window.GraneteUI.library.render();
  const l1 = el(sandbox, 'library-category-l1');
  assert.deepStrictEqual(l1.children.map((o) => o.textContent),
    ['Todas las categorías', 'Torres / Closets', 'Bases'],
    'flat mode labels through formatCategoryLabel (keys sorted alphabetically)');
  l1.value = 'kitchen_base';
  l1.onchange();
  assert(el(sandbox, 'library-cards-grid').children.length === 2);
});

test('search filters by name, code, category and description', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [
      definition({ furniture_definition_id: 'def-n', name: 'Alacena Alta' }),
      definition({ furniture_definition_id: 'def-c', name: 'Otro', code: 'ALACENA-01' }),
      definition({ furniture_definition_id: 'def-d', name: 'Otro', description: 'alacena de pared' }),
      definition({ furniture_definition_id: 'def-x', name: 'Mesa' })
    ],
    source: 'local'
  });
  sandbox.window.GraneteUI.library.render();
  setSearch(sandbox, 'alacena');
  const cards = el(sandbox, 'library-cards-grid').children;
  assert(cards.length === 3, 'name, code and description all match');
  assert(visible(el(sandbox, 'library-search-clear')), 'the clear affordance appears with a query');
});

test('search clear restores the full grid and focuses the input', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({ definitions: TREE_DEFINITIONS, source: 'local' });
  sandbox.window.GraneteUI.library.render();
  setSearch(sandbox, 'puerta');
  assert(el(sandbox, 'library-cards-grid').children.length === 1);
  el(sandbox, 'library-search-clear').click();
  assert(el(sandbox, 'library-cards-grid').children.length === 3);
  assert(el(sandbox, 'library-search-input').value === '');
  assert(!visible(el(sandbox, 'library-search-clear')));
});

test('no-results state names the query or the category, never both', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  setSearch(sandbox, 'zzz-inexistente');
  assert(visible(el(sandbox, 'library-no-results-state')));
  assert(el(sandbox, 'library-no-results-msg').textContent.indexOf('zzz-inexistente') !== -1);
  // A category whose subtree is empty names the CATEGORY only when the
  // query is empty — with a query present, the query wins.
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [definition({ furniture_definition_id: 'def-elsewhere', categoryId: 'cat-3' })],
    categories: [{ categoryId: 'cat-empty', name: 'Vacía' }],
    source: 'remote'
  });
  sandbox.window.GraneteUI.library.render();
  setSearch(sandbox, '');
  selectCategory(sandbox, 'cat-empty');
  assert(visible(el(sandbox, 'library-no-results-state')));
  assert(el(sandbox, 'library-no-results-msg').textContent === 'No hay muebles en la categoría seleccionada.');
  assert(!visible(el(sandbox, 'library-cards-grid')));
});

test('btn-clear-search resets both the query and the category', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  selectCategory(sandbox, 'cat-1');
  setSearch(sandbox, 'cajón');
  el(sandbox, 'btn-clear-search').click();
  assert(el(sandbox, 'library-cards-grid').children.length === 3, 'back to the unfiltered grid');
  assert(el(sandbox, 'library-category-l1').value === 'ALL');
});

test('count badge distinguishes singular from plural', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [definition({ furniture_definition_id: 'def-only' })],
    source: 'local'
  });
  sandbox.window.GraneteUI.library.render();
  assert(el(sandbox, 'library-count-badge').textContent === '1 mueble');
});

test('cards render name, code, dims and the media-backed preview', () => {
  const sandbox = runModule();
  sandbox.__mediaUrls = {};
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [definition({
      furniture_definition_id: 'def-card',
      name: 'Gabinete Base',
      code: 'BASE-450',
      category: 'kitchen_base',
      imageUrl: '/api/media/' + FILE_A,
      parameters: [
        { name: 'widthMm', defaultValue: 450 },
        { name: 'heightMm', defaultValue: 720 },
        { name: 'depthMm', defaultValue: 560 }
      ]
    })],
    source: 'remote'
  });
  sandbox.window.GraneteUI.library.render();
  const card = el(sandbox, 'library-cards-grid').children[0];
  assert(card.getAttribute('data-definition-id') === 'def-card');
  assert(card.getAttribute('aria-label') === 'Seleccionar Gabinete Base');
  const preview = card.children[0];
  const img = preview.children[0];
  assert(img.getAttribute('data-media-name') === FILE_A, 'server media keeps its canonical filename');
  const badge = preview.children[2];
  assert(badge.textContent === 'Bases', 'the legacy label maps through CATEGORY_LABELS');
  const body = card.children[1];
  assert(body.children[0].textContent === 'Gabinete Base');
  assert(body.children[1].textContent === '450 × 720 × 560 mm', 'dims come from the definition defaults');
  assert(body.children[2].textContent === 'BASE-450');
});

test('card image resolution and refresh go through GraneteUI.media', () => {
  const sandbox = runModule();
  sandbox.__mediaUrls = {};
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [definition({
      furniture_definition_id: 'def-media',
      imageUrl: '/api/media/' + FILE_A
    })],
    source: 'remote'
  });
  sandbox.window.GraneteUI.library.render();
  const preview = el(sandbox, 'library-cards-grid').children[0].children[0];
  const img = preview.children[0];
  const placeholder = preview.children[1];
  assert(sandbox.__media.filenameFromPath.includes('/api/media/' + FILE_A));
  assert(sandbox.__media.resolveUrl.includes('/api/media/' + FILE_A));
  assert(placeholder.style.display === 'flex' && placeholder.innerHTML === 'PLACEHOLDER-SVG',
    'the injected placeholder covers the pending grant');
  // A re-minted grant repaints through the media module, not a URL here.
  sandbox.__mediaUrls[FILE_A] = SIGNED_A;
  img.nextElementSibling = placeholder;
  img.onerror();
  assert(sandbox.__media.requestRefresh.includes(FILE_A),
    '#460 SEC-3: an expired grant re-mints via GraneteUI.media.requestRefresh');
});

test('clicking a card hands the definition to the injected onSelectDefinition', () => {
  const sandbox = runModule();
  const def = definition({ furniture_definition_id: 'def-pick', name: 'Elegido' });
  sandbox.window.GraneteUI.library.setCatalog({ definitions: [def], source: 'local' });
  sandbox.window.GraneteUI.library.render();
  const card = el(sandbox, 'library-cards-grid').children[0];
  card.click();
  card.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {} });
  assert.strictEqual(sandbox.__selections[0], def, 'Library ends at the choice — same object, no copy');
  assert(sandbox.__selections.length === 2, 'click and Enter/Space both select');
});

test('the configured definition keeps its card highlight', () => {
  const sandbox = runModule();
  sandbox.window.GraneteUI.library.setCatalog({
    definitions: [
      definition({ furniture_definition_id: 'def-hi' }),
      definition({ furniture_definition_id: 'def-no' })
    ],
    source: 'local'
  });
  sandbox.__selectedDefinitionId = 'def-hi';
  sandbox.window.GraneteUI.library.render();
  const cards = el(sandbox, 'library-cards-grid').children;
  assert(cards[0].className.includes('selected'));
  assert(!cards[1].className.includes('selected'));
});

test('formatCategoryLabel keeps the legacy mapping and title-cases the rest', () => {
  const { window } = runModule();
  const label = window.GraneteUI.library.formatCategoryLabel;
  assert(label('kitchen_base') === 'Bases');
  assert(label('closet') === 'Torres / Closets');
  assert(label('') === 'General');
  assert(label('mesa_ratable') === 'Mesa Ratable');
});

test('findDefinitionById resolves through the owned definitions', () => {
  const sandbox = runModule();
  const defs = [definition({ furniture_definition_id: 'def-find' })];
  sandbox.window.GraneteUI.library.setCatalog(defs);
  assert.strictEqual(sandbox.window.GraneteUI.library.findDefinitionById('def-find'), defs[0]);
  assert.strictEqual(sandbox.window.GraneteUI.library.findDefinitionById('nope'), undefined);
});

test('furniture definitions have exactly one authority — the module', () => {
  assert(SOURCE.includes('var catalog = [];'),
    'granete-library.js owns the definitions state');
  assert(!DIALOG_HTML.includes('var catalog =') && !DIALOG_HTML.includes('var catalog =[]'),
    'dialog.html must not keep a second inline copy of the catalog');
  assert(DIALOG_HTML.includes('window.GraneteUI.library.setCatalog(payload)'),
    'GraneteDialog.setCatalog delegates the browsing slice to the module');
  assert(DIALOG_HTML.includes('window.GraneteUI.library.findDefinitionById('),
    'the inline inspector fallback reads through the module API');
});

test('setCatalog preserves the search and category across catalog refreshes', () => {
  const sandbox = runModule();
  loadTreeCatalog(sandbox);
  selectCategory(sandbox, 'cat-1');
  setSearch(sandbox, 'puerta');
  // Ruby pushes a fresh catalog while the user browses: filters survive.
  loadTreeCatalog(sandbox);
  assert(el(sandbox, 'library-cards-grid').children.length === 1,
    'the active category and query still apply after the refresh');
  assert(el(sandbox, 'library-category-l1').value === 'cat-1');
});

try {
  process.stdout.write(JSON.stringify({ success: true, testsPassed, module: 'granete-library.js' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: String(error && error.message || error) }));
  process.exit(1);
}
