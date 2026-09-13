const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-commercial-projection.js'), 'utf8');
const dialogSource = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html'), 'utf8');
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

function projectionResponse(requestId, binding, value) {
  return {
    requestId, projectId: binding.binding.projectId, designId: binding.binding.designId,
    workState: {
      projectId: binding.binding.projectId, designId: binding.binding.designId,
      generation: 0, localChangesPending: false, matchConfirmed: true
    },
    projection: value
  };
}

test('renders a legitimate zero rather than missing', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, projection(0, 0))), true);
  assert.ok(s.__elements['commercial-projection-total'].textContent.includes('$0.00'));
  assert.strictEqual(s.__elements['commercial-projection-cost-row'].style.display, '');
  assert.ok(s.__elements['commercial-projection-cost'].textContent.includes('$0.00'));
  assert.strictEqual(s.__elements['commercial-projection-delta'].textContent.includes('%'), false);
  assert.ok(s.__elements['commercial-projection-reference'].textContent.includes('Aceptada'));
  assert.strictEqual(s.__elements['commercial-projection-reference'].textContent.includes('accepted'), false);
});

test('drops a late response after an exact context switch', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const old = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.setBinding(bindingB);
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(projectionResponse(old, bindingA, projection(90, 80))), false);
});

test('drops a late response after the device session changes', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const old = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.invalidateSession();
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(projectionResponse(old, bindingA, projection(90, 80))), false);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sin sesión');
});

test('drops a response that predates an in-flight mutation', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const old = s.__calls[s.__calls.length - 1].payload.requestId;
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(projectionResponse(old, bindingA, projection(90, 80))), false);
  assert.strictEqual(s.__elements['commercial-projection-values'].style.display, 'none');
});

test('drops a response that predates a local commit even without a resolving event', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const old = s.__calls[s.__calls.length - 1].payload.requestId;
  s.__events['granete-mutation-state']({ detail: { phase: 'committed' } });
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(
    projectionResponse(old, bindingA, projection(90, 80))
  ), false);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
});

test('manual refresh requested before a local commit cannot become current afterward', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const first = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(first, bindingA, projection(100, 80)));
  s.__elements['btn-commercial-projection-refresh'].listeners.click();
  const refresh = s.__calls[s.__calls.length - 1].payload.requestId;
  s.__events['granete-mutation-state']({ detail: { phase: 'committed' } });
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(
    projectionResponse(refresh, bindingA, projection(110, 80))
  ), false);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
});

test('refresh and receive cannot become current while a mutation is resolving', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const first = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(first, bindingA, projection(100, 80)));
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  const before = s.__calls.length;

  s.window.GraneteCommercialProjection.refresh();
  const attempted = s.__calls.length > before
    ? s.__calls[s.__calls.length - 1].payload.requestId
    : 'commercial-blocked';

  assert.strictEqual(s.window.GraneteCommercialProjection.receive(
    projectionResponse(attempted, bindingA, projection(110, 80))
  ), false);
  assert.strictEqual(s.__calls.length, before);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sincronizando');
});

test('refresh and receive cannot become current while a host mutation is applying', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const first = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(first, bindingA, projection(100, 80)));
  s.__events['granete-mutation-state']({ detail: { phase: 'applying_host_mutation' } });
  const before = s.__calls.length;

  s.window.GraneteCommercialProjection.refresh();
  const attempted = s.__calls.length > before
    ? s.__calls[s.__calls.length - 1].payload.requestId
    : 'commercial-blocked';

  assert.strictEqual(s.window.GraneteCommercialProjection.receive(
    projectionResponse(attempted, bindingA, projection(110, 80))
  ), false);
  assert.strictEqual(s.__calls.length, before);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sincronizando');
});

test('cancellation preserves previously pending local work', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const initial = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive({
    requestId: initial, projectId: 'p-a', designId: 'd-a',
    workState: { projectId: 'p-a', designId: 'd-a', generation: 4, localChangesPending: true, matchConfirmed: false },
    state: 'stale'
  });

  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  const before = s.__calls.length;
  s.__events['granete-mutation-state']({ detail: { phase: 'cancelled' } });

  assert.strictEqual(s.__calls.length, before);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
  assert.strictEqual(s.__elements['commercial-projection-values'].style.display, 'none');
});

test('rejected mutation during initial loading starts a recoverable readback', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const before = s.__calls.length;
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  s.__events['granete-mutation-state']({ detail: { phase: 'rejected' } });
  assert.strictEqual(s.__calls.length, before + 1);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Calculando');
});

test('cancelled mutation restores the last valid projection without claiming a new match', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, projection(100, 80)));
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  s.__events['granete-mutation-state']({ detail: { phase: 'cancelled' } });
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
  assert.ok(s.__elements['commercial-projection-total'].textContent.includes('$100.00'));
});

test('aborted mutation restores only a previously confirmed projection', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, projection(100, 80)));

  s.__events['granete-mutation-state']({ detail: { phase: 'applying_host_mutation' } });
  s.__events['granete-mutation-state']({ detail: { phase: 'aborted' } });

  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
  assert.ok(s.__elements['commercial-projection-total'].textContent.includes('$100.00'));
});

test('partial synchronization cannot clear another local change while a full sync can', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, projection(100, 80)));
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sincronizando');
  s.__events['granete-mutation-state']({ detail: { phase: 'rejected' } });
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
  const before = s.__calls.length;
  s.__events['granete-mutation-state']({ detail: { phase: 'committed' } });
  assert.strictEqual(s.__calls.length, before);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
  assert.strictEqual(s.__elements['commercial-projection-values'].style.display, 'none');
  s.__elements['btn-commercial-projection-refresh'].listeners.click();
  assert.strictEqual(s.__calls.length, before);
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  assert.strictEqual(s.__calls.length, before + 1);
  const reopen = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive({
    requestId: reopen, projectId: 'p-a', designId: 'd-a',
    workState: { projectId: 'p-a', designId: 'd-a', generation: 1, localChangesPending: true, matchConfirmed: false },
    state: 'stale'
  });
  s.window.GraneteCommercialProjection.applySynchronization({
    projectId: 'p-a', designId: 'd-a', generation: 2, localChangesPending: true, matchConfirmed: false, scope: 'partial'
  });
  assert.strictEqual(s.__calls.length, before + 1);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
  s.window.GraneteCommercialProjection.applySynchronization({
    projectId: 'p-a', designId: 'd-a', generation: 3, localChangesPending: false, matchConfirmed: true, scope: 'full'
  });
  assert.strictEqual(s.__calls.length, before + 2);
  assert.strictEqual(s.__elements['commercial-projection-values'].style.display, 'none');
});

test('authoritative pending work survives temporary unavailability and panel-style rebinding', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const first = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive({
    requestId: first, projectId: 'p-a', designId: 'd-a',
    workState: { projectId: 'p-a', designId: 'd-a', generation: 4, localChangesPending: true, matchConfirmed: false },
    state: 'stale'
  });
  s.window.GraneteCommercialProjection.setBinding({ state: 'unreachable', binding: bindingA.binding });
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const reconnect = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive({
    requestId: reconnect, projectId: 'p-a', designId: 'd-a',
    workState: { projectId: 'p-a', designId: 'd-a', generation: 4, localChangesPending: true, matchConfirmed: false },
    state: 'stale'
  });
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
  assert.strictEqual(s.__elements['commercial-projection-values'].style.display, 'none');
});

test('pending work state is scoped by project and design', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  s.window.GraneteCommercialProjection.applySynchronization({
    projectId: 'p-a', designId: 'd-a', generation: 1, localChangesPending: true, matchConfirmed: false, scope: 'local'
  });
  const before = s.__calls.length;
  s.window.GraneteCommercialProjection.setBinding(bindingB);
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
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, p));
  assert.strictEqual(s.__elements['commercial-projection-total'].textContent, 'No disponible para esta organización');
  assert.strictEqual(s.__elements['commercial-projection-cost-row'].style.display, 'none');
});

test('incomplete reasons distinguish unsupported parameters, missing pricing data and withheld amounts', () => {
  const cases = [
    ['working_item_parameters_not_priceable', 'parámetros'],
    ['working_item_pricing_context_missing', 'datos comerciales'],
    ['commercial_amounts_withheld_for_organization', 'esta organización']
  ];
  cases.forEach(([issue, expected]) => {
    const s = sandbox();
    s.window.GraneteCommercialProjection.setBinding(bindingA);
    const request = s.__calls[s.__calls.length - 1].payload.requestId;
    const value = projection(null, undefined);
    value.status = 'incomplete';
    value.issues = [issue];
    s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, value));
    assert.ok(s.__elements['commercial-projection-status'].textContent.includes(expected));
  });
});

test('a projection without model work evidence fails closed', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  assert.strictEqual(s.window.GraneteCommercialProjection.receive({
    requestId: request, projectId: 'p-a', designId: 'd-a', projection: projection(100, 80)
  }), true);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualización requerida');
  assert.strictEqual(s.__elements['commercial-projection-values'].style.display, 'none');
});

test('an unconfirmed model may show only an explicitly server-only estimate', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;

  assert.strictEqual(s.window.GraneteCommercialProjection.receive({
    requestId: request, projectId: 'p-a', designId: 'd-a',
    workState: {
      projectId: 'p-a', designId: 'd-a', generation: 0,
      localChangesPending: false, matchConfirmed: false, scope: 'unconfirmed'
    },
    projection: projection(100, 80)
  }), true);

  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Servidor no verificado');
  assert.notStrictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
  assert.ok(s.__elements['commercial-projection-status'].textContent.includes('servidor'));
  assert.ok(s.__elements['commercial-projection-total'].textContent.includes('$100.00'));
});

test('cancelling a mutation cannot promote a server-only estimate to current', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive({
    requestId: request, projectId: 'p-a', designId: 'd-a',
    workState: {
      projectId: 'p-a', designId: 'd-a', generation: 0,
      localChangesPending: false, matchConfirmed: false, scope: 'unconfirmed'
    },
    projection: projection(100, 80)
  });

  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  s.__events['granete-mutation-state']({ detail: { phase: 'cancelled' } });

  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Servidor no verificado');
  assert.notStrictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
});

test('successful working-copy callbacks publish a committed refresh', () => {
  assert.ok(dialogSource.includes('onCommercialProjectionSynchronization: function (payload)'));
  assert.ok(dialogSource.includes('onCommercialProjectionLocalMutation: function ()'));
  assert.ok(dialogSource.includes('applySynchronization(payload)'));
});

console.log(`commercial projection tests passed: ${passed}`);
