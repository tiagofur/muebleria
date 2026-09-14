const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-commercial-projection.js'), 'utf8');
const mutationSource = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-mutation.js'), 'utf8');
const dialogSource = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html'), 'utf8');
let passed = 0;
function test(_name, fn) { fn(); passed += 1; }

function sandbox() {
  const elements = {};
  const documentListeners = {};
  const calls = [];
  let messageSequence = 0;
  function node(id) {
    return elements[id] || (elements[id] = {
      id, style: {}, textContent: '', className: '', hidden: false,
      setAttribute: function (name, value) { this[name] = value; },
      addEventListener: (name, callback) => { elements[id].listeners[name] = callback; }, listeners: {}
    });
  }
  const context = {
    console, JSON, Intl, isFinite,
    CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options && options.detail; },
    document: {
      getElementById: node,
      addEventListener: (name, callback) => { documentListeners[name] = callback; },
      dispatchEvent: (event) => {
        if (documentListeners[event.type]) documentListeners[event.type](event);
      }
    },
    window: { sketchup: {
      get_model_binding: () => calls.push({ action: 'binding' }),
      get_commercial_projection: (payload) => calls.push({ action: 'projection', payload: JSON.parse(payload) }),
      emit_initial_quote: (payload) => calls.push({ action: 'quote', payload: JSON.parse(payload) }),
      open_external_url: (payload) => calls.push({ action: 'open', payload: JSON.parse(payload) }),
      update_furniture: (payload) => calls.push({ action: 'mutation', payload: JSON.parse(payload) })
    }, GraneteBridge: {
      nextMessageId: () => `mutation-${++messageSequence}`,
      validate: () => ({ ok: true })
    }}
  };
  context.__elements = elements;
  context.__calls = calls;
  context.__events = documentListeners;
  vm.createContext(context);
  vm.runInContext(mutationSource, context);
  vm.runInContext(source, context);
  return context;
}

const bindingA = { state: 'connected', binding: { projectId: 'p-a', designId: 'd-a' },
  capabilities: { can_edit_working_copy: true, can_publish_revision: true } };
const bindingB = { state: 'connected', binding: { projectId: 'p-b', designId: 'd-b' },
  capabilities: { can_edit_working_copy: true, can_publish_revision: true } };
function projection(total, referenceTotal) {
  return {
    status: 'current', currency: 'MXN', costsWithheld: false, saleAmountsWithheld: false,
    amounts: { saleTotal: total, directCost: 0, marginFactor: 1 },
    reference: { revisionNumber: 2, status: 'accepted', currency: 'MXN', saleTotal: referenceTotal },
    comparison: referenceTotal === undefined ? null : { absoluteDelta: total - referenceTotal, percentageDelta: referenceTotal === 0 ? null : (total - referenceTotal) / referenceTotal * 100 }
  };
}

function initialProjection(total) {
  const value = projection(total, undefined);
  value.reference = null;
  value.itemCount = 1;
  value.workingVersion = 'working-718';
  value.workingFingerprint = 'sha256-' + 'a'.repeat(64);
  return value;
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

function startRuntimeMutation(s) {
  assert.strictEqual(s.window.GraneteMutation.submitUpdate({}, { furnitureInstanceId: 'f-a' }), 'sent');
}

function finishRuntimeMutation(s, outcome) {
  return s.window.GraneteMutation.handleMutationState({
    kind: 'mutation_state', schemaVersion: 1, inReplyTo: s.window.GraneteMutation.pendingMessageId(), outcome
  });
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

test('enables Q1 only for exact confirmed current projection and guards double click', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  const value = initialProjection(125);
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, value));
  assert.strictEqual(s.__elements['btn-initial-quote'].disabled, false);
  s.__elements['btn-initial-quote'].listeners.click();
  s.__elements['btn-initial-quote'].listeners.click();
  const quoteCalls = s.__calls.filter((call) => call.action === 'quote');
  assert.strictEqual(quoteCalls.length, 1);
  assert.deepStrictEqual(quoteCalls[0].payload, {
    workingVersion: 'working-718', workingFingerprint: 'sha256-' + 'a'.repeat(64), saleTotal: 125
  });
  assert.strictEqual(s.__elements['btn-initial-quote'].disabled, true);
});

test('Q1 remains disabled without exact local match or while mutation is active', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  const response = projectionResponse(request, bindingA, initialProjection(125));
  response.workState.matchConfirmed = false;
  s.window.GraneteCommercialProjection.receive(response);
  assert.strictEqual(s.__elements['btn-initial-quote'].disabled, true);

  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const next = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(next, bindingA, initialProjection(125)));
  s.__events['granete-mutation-state']({ detail: { phase: 'resolving' } });
  assert.strictEqual(s.__elements['btn-initial-quote'].disabled, true);
});

test('Q1 remains disabled without the canonical project mutation capability', () => {
  const s = sandbox();
  const denied = { state: 'connected', binding: bindingA.binding,
    capabilities: { can_edit_working_copy: false, can_publish_revision: false } };
  s.window.GraneteCommercialProjection.setBinding(denied);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, denied, initialProjection(125)));
  assert.strictEqual(s.__elements['btn-initial-quote'].disabled, true);
});

test('renders normal Q1 and opens only the server-provided ID-only URL', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, initialProjection(125)));
  s.__elements['btn-initial-quote'].listeners.click();
  s.window.GraneteCommercialProjection.receiveQuote({
    ok: true,
    quote: { id: 'q-1', revisionNumber: 1, status: 'draft', commercialSnapshot: { currency: 'MXN', breakdown: { salePrice: 125 } } },
    webUrl: 'https://granete.test/quotes?projectId=p-a&quoteRevisionId=q-1'
  });
  assert.ok(s.__elements['initial-quote-status'].textContent.includes('Q1'));
  assert.ok(s.__elements['initial-quote-status'].textContent.includes('Borrador'));
  assert.ok(s.__elements['initial-quote-status'].textContent.includes('$'));
  assert.strictEqual(s.__elements['btn-initial-quote'].disabled, true);
  s.__elements['btn-open-in-granete'].listeners.click();
  assert.deepStrictEqual(s.__calls[s.__calls.length - 1], {
    action: 'open', payload: { url: 'https://granete.test/quotes?projectId=p-a&quoteRevisionId=q-1' }
  });
});

test('changed tokens require a refreshed projection and another click', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(request, bindingA, initialProjection(125)));
  s.__elements['btn-initial-quote'].listeners.click();
  const before = s.__calls.filter((call) => call.action === 'projection').length;
  s.window.GraneteCommercialProjection.receiveQuote({ ok: false, code: 'refresh_required', reason: 'cambió' });
  assert.strictEqual(s.__calls.filter((call) => call.action === 'projection').length, before + 1);
  assert.strictEqual(s.__calls.filter((call) => call.action === 'quote').length, 1);
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

test('terminal unavailability while binding is lost does not leave a phantom mutation', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const first = s.__calls[s.__calls.length - 1].payload.requestId;
  s.window.GraneteCommercialProjection.receive(projectionResponse(first, bindingA, projection(100, 80)));
  startRuntimeMutation(s);
  s.window.GraneteCommercialProjection.setBinding({ state: 'unreachable', binding: bindingA.binding });
  finishRuntimeMutation(s, 'unavailable');
  s.window.GraneteCommercialProjection.setBinding(bindingA);

  assert.strictEqual(s.window.GraneteCommercialProjection.refresh(), true);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Calculando');
});

test('cancelled or rejected while binding is lost does not leave a phantom mutation', () => {
  ['cancelled', 'rejected'].forEach((outcome) => {
    const s = sandbox();
    s.window.GraneteCommercialProjection.setBinding(bindingA);
    const first = s.__calls[s.__calls.length - 1].payload.requestId;
    s.window.GraneteCommercialProjection.receive(projectionResponse(first, bindingA, projection(100, 80)));
    startRuntimeMutation(s);
    s.window.GraneteCommercialProjection.setBinding({ state: 'unreachable', binding: bindingA.binding });
    finishRuntimeMutation(s, outcome);
    s.window.GraneteCommercialProjection.setBinding(bindingA);

    assert.strictEqual(s.window.GraneteCommercialProjection.refresh(), true, outcome);
  });
});

test('commit while binding is lost rechecks local authority and preserves pending work', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  startRuntimeMutation(s);
  s.window.GraneteCommercialProjection.setBinding({ state: 'unreachable', binding: bindingA.binding });
  finishRuntimeMutation(s, 'committed');
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  const reconnect = s.__calls[s.__calls.length - 1].payload.requestId;

  assert.strictEqual(s.window.GraneteCommercialProjection.receive({
    requestId: reconnect, projectId: 'p-a', designId: 'd-a',
    workState: { projectId: 'p-a', designId: 'd-a', generation: 5, localChangesPending: true, matchConfirmed: false },
    state: 'stale'
  }), true);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Desactualizado');
  assert.notStrictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
});

test('reconnecting while the runtime mutation is active still blocks request and receive', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  startRuntimeMutation(s);
  s.window.GraneteCommercialProjection.setBinding({ state: 'unreachable', binding: bindingA.binding });
  const before = s.__calls.length;
  s.window.GraneteCommercialProjection.setBinding(bindingA);

  assert.strictEqual(s.window.GraneteCommercialProjection.refresh(), false);
  assert.strictEqual(s.__calls.length, before);
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(
    projectionResponse('commercial-blocked', bindingA, projection(120, 80))
  ), false);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Sincronizando');
});

test('an old context outcome only releases lifecycle and rechecks the new context', () => {
  const s = sandbox();
  s.window.GraneteCommercialProjection.setBinding(bindingA);
  startRuntimeMutation(s);
  s.window.GraneteCommercialProjection.setBinding(bindingB);
  const before = s.__calls.length;
  finishRuntimeMutation(s, 'committed');

  assert.strictEqual(s.__calls.length, before + 1);
  const request = s.__calls[s.__calls.length - 1].payload.requestId;
  assert.strictEqual(s.window.GraneteCommercialProjection.receive(
    projectionResponse(request, bindingB, projection(200, 150))
  ), true);
  assert.strictEqual(s.__elements['commercial-projection-badge'].textContent, 'Actualizado');
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
