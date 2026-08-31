// Real JavaScript test harness for the #416 migration review dialog
// (migration_review.html): renders scan payloads and batch reports through
// the actual dialog script (vm sandbox + mock DOM) and asserts the honest
// review workflow — counts, per-item state badges with reasons, disabled
// migration when nothing is ready, and partial/aborted reports that never
// dress up as total success.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', '..', 'src', 'granete_for_sketchup', 'resources',
  'migration_review.html');

function createClassList(initial) {
  const classes = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
    _classes: classes
  };
}

function createMockElement(id) {
  const el = {
    id: id || '',
    children: [],
    disabled: false,
    listeners: {},
    _textContent: '',
    _innerHTML: '',
    classList: createClassList('')
  };
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el.classList._classes).join(' '); },
    set(value) { el.classList = createClassList(value); }
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(value) { el._textContent = String(value); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    // The dialog clears containers via innerHTML = '' before re-rendering:
    // mirror the DOM by dropping mock children on assignment.
    set(value) {
      el._innerHTML = String(value);
      if (el._innerHTML === '') el.children.length = 0;
    }
  });
  el.appendChild = (child) => { el.children.push(child); return child; };
  el.addEventListener = (evt, cb) => { el.listeners[evt] = cb; };
  return el;
}

function loadDialog() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('migration_review.html script block not found');

  const elements = {};
  const sketchupCalls = [];
  const document = {
    getElementById: (id) => {
      elements[id] = elements[id] || createMockElement(id);
      return elements[id];
    },
    createElement: () => createMockElement()
  };
  const window = {
    document,
    sketchup: new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'migration_ready' || prop === 'migrate_compatible' || prop === 'close_migration') {
          return () => { sketchupCalls.push(String(prop)); };
        }
        return undefined;
      }
    })
  };

  const context = vm.createContext({ window, document, console });
  vm.runInContext(match[1], context);
  return { window, elements, sketchupCalls };
}

function visibleText(node) {
  if (!node) return '';
  // innerHTML content arrives unparsed in the mock: strip tags so count
  // assertions can read through markup the dialog builds as strings.
  const own = (node._textContent || '') + ' ' + (node._innerHTML || '').replace(/<[^>]*>/g, ' ');
  const kids = (node.children || []).map(visibleText).join(' ');
  return (own + ' ' + kids).replace(/\s+/g, ' ').trim();
}

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
}

function run() {
  // ── scan payload: counts + states + reasons ────────────────────────────
  let harness = loadDialog();
  harness.window.initMigrationReview({
    counts: { detected: 2, ready: 1, requiresReview: 1, unsupported: 0, unmanaged: 0 },
    ready: [{ name: 'Bajo cocina', instanceRef: 'inst-a', definitionId: 'kitchen-base-standard',
      state: 'ready' }],
    requiresReview: [{ name: 'Bajo viejo', instanceRef: 'inst-b',
      definitionId: 'kitchen-missing', state: 'requires_review',
      reason: 'definition-not-found' }],
    unsupported: []
  });

  let summary = visibleText(harness.elements.summary);
  check(summary.includes('2') && summary.includes('muebles'), 'summary shows detected count');
  check(summary.includes('1') && summary.includes('listo'), 'summary shows ready count');
  check(summary.includes('1') && summary.includes('revisión'), 'summary shows review count');

  // The dialog renders review items first, then ready ones.
  let items = harness.elements.items.children;
  check(items.length === 2, 'two items rendered');
  const reviewItem = items[0];
  const readyItem = items[1];
  check(visibleText(reviewItem).includes('inst-b'), 'review item shows its instanceRef');
  check(visibleText(readyItem).includes('inst-a'), 'ready item shows its instanceRef');
  check(!visibleText(readyItem).includes('ya no está en el catálogo'),
    'ready item has no failure detail');
  check(visibleText(reviewItem).includes('ya no está en el catálogo'),
    'review item shows the human reason (definition-not-found)');
  check(reviewItem.children.some((c) => c.className.includes('badge-requires_review')),
    'review item carries the review badge');
  check(readyItem.children.some((c) => c.className.includes('badge-ready')),
    'ready item carries the ready badge');

  const migrate = harness.elements.migrate;
  check(migrate.disabled === false, 'migrate enabled when ready > 0');
  check(visibleText(migrate).includes('(1)'), 'migrate button carries the ready count');

  // ── zero ready: migration disabled ────────────────────────────────────
  harness = loadDialog();
  harness.window.initMigrationReview({
    counts: { detected: 1, ready: 0, requiresReview: 1, unsupported: 0, unmanaged: 0 },
    ready: [],
    requiresReview: [{ name: 'Bajo roto', instanceRef: 'inst-c', state: 'requires_review',
      reason: 'corrupt-metadata', detail: 'Metadata ilegible' }],
    unsupported: []
  });
  check(harness.elements.migrate.disabled === true, 'migrate disabled when ready == 0');
  check(visibleText(harness.elements.items.children[0]).includes('Metadata ilegible'),
    'corrupt item surfaces its detail');

  // ── partial report: never total success ────────────────────────────────
  harness = loadDialog();
  harness.window.initMigrationReview({
    counts: { detected: 2, ready: 2, requiresReview: 0, unsupported: 0, unmanaged: 0 },
    ready: [
      { name: 'A', instanceRef: 'i1', state: 'ready' },
      { name: 'B', instanceRef: 'i2', state: 'ready' }
    ],
    requiresReview: [], unsupported: []
  });
  harness.window.migrationResult({
    success: true, allMigrated: false, aborted: false,
    migratedCount: 1, remainingLegacyCount: 1,
    migrated: [{ instanceRef: 'i1', name: 'A', definitionId: 'd' }],
    requiresReview: [{ instanceRef: 'i2', name: 'B', definitionId: 'd',
      reason: 'resolve-failed', detail: 'timeout' }]
  });

  let note = harness.elements['result-note'];
  check(note.className.includes('result-partial'), 'partial report uses the partial style');
  check(visibleText(note).includes('Migración parcial'), 'partial report says partial');
  check(visibleText(note).includes('1 mueble quedó sin migrar'), 'partial report counts the leftover');
  check(harness.elements.migrate.disabled === true, 'migrate disabled after a batch ran');

  items = harness.elements.items.children;
  check(items.length === 2, 'post-batch items rendered');
  const badgeText = items.map((i) => visibleText(i)).join('|');
  check(badgeText.includes('Migrado'), 'migrated item shows the migrated badge');
  check(badgeText.includes('Requiere revisión'), 'leftover item keeps the review badge');
  check(badgeText.includes('timeout'), 'leftover item shows the failure detail');

  // ── aborted report: nothing changed, honest error ──────────────────────
  harness = loadDialog();
  harness.window.initMigrationReview({
    counts: { detected: 1, ready: 1, requiresReview: 0, unsupported: 0, unmanaged: 0 },
    ready: [{ name: 'A', instanceRef: 'i1', state: 'ready' }],
    requiresReview: [], unsupported: []
  });
  harness.window.migrationResult({
    success: false, allMigrated: false, aborted: true,
    migratedCount: 0, remainingLegacyCount: 1, migrated: [],
    requiresReview: [{ instanceRef: 'i1', reason: 'batch-aborted' }], error: 'boom'
  });
  note = harness.elements['result-note'];
  check(note.className.includes('result-error'), 'aborted report uses the error style');
  check(visibleText(note).includes('no se cambió nada'), 'aborted report states nothing changed');

  // ── total success ───────────────────────────────────────────────────────
  harness = loadDialog();
  harness.window.initMigrationReview({
    counts: { detected: 1, ready: 1, requiresReview: 0, unsupported: 0, unmanaged: 0 },
    ready: [{ name: 'A', instanceRef: 'i1', state: 'ready' }],
    requiresReview: [], unsupported: []
  });
  harness.window.migrationResult({
    success: true, allMigrated: true, aborted: false,
    migratedCount: 1, remainingLegacyCount: 0,
    migrated: [{ instanceRef: 'i1', name: 'A', definitionId: 'd' }], requiresReview: []
  });
  note = harness.elements['result-note'];
  check(note.className.includes('result-ok'), 'total success uses the ok style');
  check(visibleText(note).includes('Migración completa'), 'total success says complete');

  // ── buttons reach the Ruby bridge ───────────────────────────────────────
  harness = loadDialog();
  harness.elements.migrate.listeners.click();
  check(harness.sketchupCalls.includes('migrate_compatible'), 'migrate button calls the bridge');
  harness.elements.later.listeners.click();
  check(harness.sketchupCalls.includes('close_migration'), 'later button closes the dialog');
  check(harness.sketchupCalls.includes('migration_ready'), 'ready signal reaches the bridge');

  process.stdout.write(JSON.stringify({ success: true, testsPassed: passed }));
}

try {
  run();
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: error.message }));
  process.exit(1);
}
