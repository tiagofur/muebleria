// Real JavaScript Test Harness for material_selector.html
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createMockElement(id = '', tagName = 'DIV') {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  let innerHTMLValue = '';
  let textContentValue = '';

  const el = {
    id,
    tagName,
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    getAttribute: (k) => attributes[k] || null,
    setAttribute: (k, v) => { attributes[k] = String(v); },
    removeAttribute: (k) => { delete attributes[k]; },
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    dispatchEvent: (evt) => {
      const type = typeof evt === 'string' ? evt : evt.type;
      const eventObj = typeof evt === 'string' ? { type: evt, target: el } : (evt.target ? evt : Object.assign({ target: el }, evt));
      (listeners[type] || []).forEach(cb => cb(eventObj));
    },
    click: () => {
      (listeners['click'] || []).forEach(cb => cb({ preventDefault: () => {} }));
    },
    focus: () => {},
    querySelectorAll: (selector) => {
      if (selector === '.swatch-card') {
        return (el.children || []).filter(c => c.classList.contains('swatch-card'));
      }
      if (selector === '.card-preview[data-src]') {
        return (el.children || []).map(c => (c.children || []).find(sub => sub.getAttribute('data-src'))).filter(Boolean);
      }
      return [];
    },
    children: [],
    get innerHTML() {
      return innerHTMLValue;
    },
    set innerHTML(val) {
      innerHTMLValue = val;
      // Parse basic child elements for swatch cards if inserted into grid
      if (id === 'swatch-grid') {
        el.children = [];
        const cardRegex = /<div class="swatch-card([^"]*)"[^>]*data-id="([^"]*)"/g;
        let match;
        while ((match = cardRegex.exec(val)) !== null) {
          const card = createMockElement('', 'DIV');
          if (match[1].includes('active')) card.classList.add('active');
          card.classList.add('swatch-card');
          card.setAttribute('data-id', match[2]);
          el.children.push(card);
        }
      }
    },
    get textContent() {
      return textContentValue;
    },
    set textContent(val) {
      textContentValue = val;
    },
    value: '',
    checked: false
  };

  return el;
}

function runTests() {
  const htmlPath = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/material_selector.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Extract <script> content
  const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'Could not find <script> tag in material_selector.html');
  const jsCode = scriptMatch[1];

  const scopeInstance = createMockElement('scope-instance', 'INPUT');
  scopeInstance.value = 'furniture';
  scopeInstance.checked = true;

  const scopeProject = createMockElement('scope-project', 'INPUT');
  scopeProject.value = 'project';
  scopeProject.checked = false;

  // Build simulated DOM elements
  const elements = {
    'role-badge': createMockElement('role-badge'),
    'search-input': createMockElement('search-input', 'INPUT'),
    'search-clear': createMockElement('search-clear', 'BUTTON'),
    'breadcrumbs-bar': createMockElement('breadcrumbs-bar'),
    'miller-pane': createMockElement('miller-pane'),
    'miller-col-1': createMockElement('miller-col-1'),
    'miller-list-1': createMockElement('miller-list-1'),
    'miller-col-2': createMockElement('miller-col-2'),
    'miller-list-2': createMockElement('miller-list-2'),
    'miller-col-3': createMockElement('miller-col-3'),
    'miller-list-3': createMockElement('miller-list-3'),
    'grid-count': createMockElement('grid-count'),
    'active-category-label': createMockElement('active-category-label'),
    'swatch-grid': createMockElement('swatch-grid'),
    'scope-instance': scopeInstance,
    'scope-project': scopeProject,
    'inspector-name': createMockElement('inspector-name'),
    'inspector-code': createMockElement('inspector-code'),
    'inspector-category': createMockElement('inspector-category'),
    'inspector-manufacturer': createMockElement('inspector-manufacturer'),
    'inspector-thickness': createMockElement('inspector-thickness'),
    'inspector-grain': createMockElement('inspector-grain'),
    'inspector-preview-box': createMockElement('inspector-preview-box'),
    'btn-cancel': createMockElement('btn-cancel', 'BUTTON'),
    'btn-apply': createMockElement('btn-apply', 'BUTTON')
  };

  const documentListeners = {};
  const windowListeners = {};
  const bridgeCalls = [];

  const sandbox = {
    console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    document: {
      getElementById: (id) => elements[id] || createMockElement(id),
      querySelector: (sel) => {
        if (sel === 'input[name="scope-choice"]:checked') {
          return elements['scope-project'].checked ? elements['scope-project'] : elements['scope-instance'];
        }
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === 'input[name="scope-choice"]') {
          return [elements['scope-instance'], elements['scope-project']];
        }
        if (sel === '.card-preview[data-src]') return [];
        return [];
      },
      addEventListener: (evt, cb) => {
        documentListeners[evt] = documentListeners[evt] || [];
        documentListeners[evt].push(cb);
      }
    },
    window: {
      addEventListener: (evt, cb) => {
        windowListeners[evt] = windowListeners[evt] || [];
        windowListeners[evt].push(cb);
      },
      sketchup: {
        selector_ready: () => bridgeCalls.push({ action: 'selector_ready' }),
        apply_selection: (payloadStr) => bridgeCalls.push({ action: 'apply_selection', payload: JSON.parse(payloadStr) }),
        close_selector: () => bridgeCalls.push({ action: 'close_selector' })
      }
    }
  };

  // Run script in sandbox
  vm.createContext(sandbox);
  vm.runInContext(jsCode + '\nwindow.__getState = () => state;\n', sandbox);

  // 1. Verify DOMContentLoaded triggers selector_ready
  assert(documentListeners['DOMContentLoaded'], 'Must register DOMContentLoaded listener');
  documentListeners['DOMContentLoaded'].forEach(cb => cb());
  assert.strictEqual(bridgeCalls.length, 1);
  assert.strictEqual(bridgeCalls[0].action, 'selector_ready');

  // 2. Test initOptionSelector with payload
  const initialPayload = {
    role: 'FRENTES',
    roleName: 'Frentes',
    currentMaterialId: 'mat-01',
    allowedMaterials: [
      { materialId: 'mat-01', name: 'Roble Natural', grain: true, previewColor: '#8B5A2B', code: 'ROB-01', manufacturer: 'Finsa', thicknessMm: 18 },
      { materialId: 'mat-02', name: 'Blanco Mate <XSS>', grain: false, previewColor: '#FFFFFF', code: 'BLA-02', manufacturer: 'Egger', thicknessMm: 18 }
    ],
    categories: [
      { id: 'cat-wood', name: 'Maderas', level: 1 }
    ],
    scope: 'instance',
    context: {
      source: 'inspector',
      instanceId: 'inst-kitchen-base-01',
      definitionId: 'kitchen-base-standard'
    }
  };

  const initFn = sandbox.initOptionSelector || sandbox.window.initOptionSelector;
  assert.strictEqual(typeof initFn, 'function', 'initOptionSelector must be defined on window');
  initFn(initialPayload);

  const testState = sandbox.window.__getState();

  // Check state initialization
  assert.strictEqual(testState.role, 'FRENTES');
  assert.strictEqual(testState.selectedMaterialId, 'mat-01');
  assert.strictEqual(testState.context.instanceId, 'inst-kitchen-base-01');

  // Check XSS escaping in grid innerHTML
  const gridHtml = elements['swatch-grid'].innerHTML;
  assert(gridHtml.includes('&lt;XSS&gt;'), 'HTML special characters must be escaped');
  assert(!gridHtml.includes('<XSS>'), 'Unescaped tags must not be present');

  // 3. Simulate user selecting mat-02 via card click
  const cards = elements['swatch-grid'].querySelectorAll('.swatch-card');
  assert.strictEqual(cards.length, 2, 'Grid must render 2 swatch cards');
  cards[1].click();
  assert.strictEqual(testState.selectedMaterialId, 'mat-02', 'Clicking second card must select mat-02');

  // 4. Simulate changing scope to project
  elements['scope-project'].checked = true;
  elements['scope-project'].dispatchEvent('change');
  assert.strictEqual(testState.scope, 'project', 'Dispatching scope change must update state.scope');

  // 5. Simulate user clicking Apply button
  elements['btn-apply'].click();

  // Check that apply_selection was called with full expected payload
  const applyCall = bridgeCalls.find(c => c.action === 'apply_selection');
  assert(applyCall, 'apply_selection must be called when clicking btn-apply');
  assert.strictEqual(applyCall.payload.role, 'FRENTES');
  assert.strictEqual(applyCall.payload.materialId, 'mat-02');
  assert.strictEqual(applyCall.payload.scope, 'project');
  assert.deepStrictEqual(applyCall.payload.context, {
    source: 'inspector',
    instanceId: 'inst-kitchen-base-01',
    definitionId: 'kitchen-base-standard'
  });

  // 6. Simulate clicking Cancel
  elements['btn-cancel'].click();
  const cancelCall = bridgeCalls.find(c => c.action === 'close_selector');
  assert(cancelCall, 'close_selector must be called when clicking btn-cancel');

  console.log(JSON.stringify({
    success: true,
    testsPassed: 6,
    appliedPayload: applyCall.payload
  }));
}

runTests();
