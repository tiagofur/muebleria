const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-commercial-projection.js'), 'utf8');
let passed = 0;
function test(_name, fn) { fn(); passed += 1; }

function sandbox() {
  const elements = {};
  const documentListeners = {};
  const calls = [];
  function node(id) {
    return elements[id] || (elements[id] = {
      id, style: {}, textContent: '', className: '',
      addEventListener: (name, callback) => { elements[id].listeners[name] = callback; }, listeners: {}
    });
  }
  const context = {
    console, JSON, Intl, isFinite,
    document: {
      getElementById: node,
      addEventListener: (name, callback) => { documentListeners[name] = callback; }
    },
    window: { sketchup: {
      get_model_binding: () => calls.push({ action: 'binding' }),
      get_commercial_projection: (payload) => calls.push({ action: 'projection', payload: JSON.parse(payload) })
    }}
  };
  context.__elements = elements;
  context.__calls = calls;
  context.__events = documentListeners;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

const bindingA = { state: 'connected', binding: { projectId: 'p-a', designId: 'd-a' } };
const bindingB = { state: 'connected', binding: { projectId: 'p-b', designId: 'd-b' } };
function projection(total, referenceTotal) {
  return {
    status: 'current', currency: 'MXN', costsWithheld: false, saleAmountsWithheld: false,
    amounts: { saleTotal: total, directCost: 0, marginFactor: 1 },
    reference: { revisionNumber: 2, status: 'accepted', currency: 'MXN', saleTotal: referenceTotal },
    comparison: referenceTotal === undefined ? null : { absoluteDelta: total - referenceTotal, percentageDelta: referenceTotal === 0 ? null : (total - referenceTotal) / referenceTotal * 100 }
  };
}

test('renders a legitimate zero rather than missing', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  assert.strictEqual(s.window.GraneteCommercialProjection.receive({ requestId: request, projectId: 'p-a', designId: 'd-a', projection: projection(0, 0) }), true);
  assert.ok(s.__elements['commercial-projection-total'].textContent.includes('$0.00'));
  assert.strictEqual(s.__elements['commercial-projection-delta'].textContent.includes('%'), false);
});

test('drops a late response after an exact context switch', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const old = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.setBinding(bindingB);
  assert.strictEqual(s.window.GraneteCommercialProjection.receive({ requestId: old, projectId: 'p-a', designId: 'd-a', projection: projection(90, 80) }), false);
});

test('drops a late response after the device session changes', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const old = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.invalidateSession();
  assert.strictEqual(s.window.GraneteCommercialProjection.receive({ requestId: old, projectId: 'p-a', designId: 'd-a', projection: projection(90, 80) }), false);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sin sesión');
});

test('confirmed mutation refreshes while rejected mutation restores prior truth', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive({ requestId: request, projectId: 'p-a', designId: 'd-a', projection: projection(100, 80) });
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sincronizando');
  s.__events['granete-mutation-state']({ detail: { phase: 'rejected' } });
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
  const before = s.__calls.length;
  s.__events['granete-mutation-state']({ detail: { phase: 'committed' } });
  assert.strictEqual(s.__calls.length, before + 1);
});

test('withheld amounts are explicit and cost rows stay hidden', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  const p = projection(null, undefined);
  p.saleAmountsWithheld = true;
  p.costsWithheld = true;
  p.amounts.directCost = null;
  p.amounts.marginFactor = null;
  s.window.GraneteCommercialProjection.receive({ requestId: request, projectId: 'p-a', designId: 'd-a', projection: p });
  assert.strictEqual(s.__elements['commercial-projection-total'].textContent, 'No disponible para esta organización');
  assert.strictEqual(s.__elements['commercial-projection-cost-row'].style.display, 'none');
});

console.log(`commercial projection tests passed: ${passed}`);
