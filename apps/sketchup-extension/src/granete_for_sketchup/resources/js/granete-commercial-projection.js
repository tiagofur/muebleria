// #642 -> #677 — read-only commercial projection for the exact connected
// Design working copy. Ruby owns identity and credentials; this module owns
// only presentation, correlation and refresh timing.
(function () {
  "use strict";
  if (window.GraneteCommercialProjection) return;

  var binding = null;
  var sequence = 0;
  var pending = null;
  var lastProjection = null;
  var workEpoch = 0;
  var workStates = {};
  var mutationInFlight = false;
  var mutationContextKey = null;
  var lastProjectionMatchConfirmed = false;
  var quotePending = false;
  var quoteWebUrl = null;
  var hostReconciliation = null;

  function element(id) { return document.getElementById(id); }
  function show(id, visible) { var node = element(id); if (node) node.style.display = visible ? "" : "none"; }
  function text(id, value) { var node = element(id); if (node) node.textContent = value; }

  function setState(state, detail) {
    var badge = element("commercial-projection-badge");
    var copy = {
      calculating: ["Calculando", "pending"], pending_sync: ["Sincronizando", "pending"],
      current: ["Actualizado", "valid"], incomplete: ["Incompleto", "conflict"],
      stale: ["Desactualizado", "conflict"], unavailable: ["No disponible", "invalid"],
      unreachable: ["Sin conexión", "pending"], unauthenticated: ["Sin sesión", "invalid"],
      unauthorized: ["Sin permiso", "invalid"], not_found: ["No disponible", "invalid"],
      incompatible: ["Actualización requerida", "invalid"],
      server_only: ["Servidor no verificado", "pending"]
    }[state] || ["No disponible", "invalid"];
    if (badge) { badge.textContent = copy[0]; badge.className = "status-badge " + copy[1]; }
    text("commercial-projection-status", detail || copy[0]);
  }

  function money(value, currency) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    try { return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency }).format(value); }
    catch (_error) { return value.toFixed(2) + " " + currency; }
  }

  function quoteStatus(value) {
    return { draft: "Borrador", published: "Publicada", accepted: "Aceptada", superseded: "Reemplazada" }[value] || "Estado no disponible";
  }

  function contextKey(value) {
    return value ? value.projectId + "/" + value.designId : null;
  }

  function exactContextKey(value) {
    return value ? [value.projectId, value.designId, value.baseRevisionId || "", value.schemaVersion].join("/") : null;
  }

  function activeMutationPhase(phase) {
    return ["editing_intent", "resolving", "applying_host_mutation"].indexOf(phase) !== -1;
  }

  function terminalMutationPhase(phase) {
    return ["committed", "rejected", "cancelled", "aborted", "unavailable", "stale"].indexOf(phase) !== -1;
  }

  function reconcileMutationRuntime() {
    if (!window.GraneteMutation || typeof window.GraneteMutation.phase !== "function") return;
    var phase = window.GraneteMutation.phase();
    if (activeMutationPhase(phase)) {
      if (!mutationInFlight) mutationContextKey = null;
      mutationInFlight = true;
    } else if (phase === "idle" || terminalMutationPhase(phase)) {
      mutationInFlight = false;
      mutationContextKey = null;
    }
  }

  function currentWorkState() {
    return binding ? workStates[contextKey(binding)] : null;
  }

  function hasPendingLocalWork() {
    var state = currentWorkState();
    return !!(state && state.localChangesPending === true);
  }

  function validWorkState(value) {
    return !!value && typeof value === "object" && binding &&
      value.projectId === binding.projectId && value.designId === binding.designId &&
      Number.isInteger(value.generation) && value.generation >= 0 &&
      typeof value.localChangesPending === "boolean" &&
      typeof value.matchConfirmed === "boolean";
  }

  function renderProjection(projection, matchConfirmed) {
    lastProjection = projection;
    lastProjectionMatchConfirmed = matchConfirmed === true;
    var amounts = projection.amounts;
    var total = amounts && money(amounts.saleTotal, projection.currency);
    show("commercial-projection-values", true);
    text("commercial-projection-total", total || (projection.saleAmountsWithheld ? "No disponible para esta organización" : "No disponible"));

    var cost = amounts && money(amounts.directCost, projection.currency);
    show("commercial-projection-cost-row", cost !== null && !projection.costsWithheld);
    if (cost !== null) text("commercial-projection-cost", cost);
    var margin = amounts && typeof amounts.marginFactor === "number" ? amounts.marginFactor.toFixed(2) + "×" : null;
    show("commercial-projection-margin-row", !!margin && !projection.costsWithheld);
    if (margin) text("commercial-projection-margin", margin);

    var reference = projection.reference;
    if (reference) {
      var referenceTotal = money(reference.saleTotal, reference.currency);
      text("commercial-projection-reference", "Q" + reference.revisionNumber + " · " + quoteStatus(reference.status) + (referenceTotal ? " · " + referenceTotal : ""));
    } else {
      text("commercial-projection-reference", "Sin cotización de referencia");
    }
    var latestPublished = projection.latestPublishedReference;
    var distinctPublished = latestPublished && (!reference || latestPublished.quoteRevisionId !== reference.quoteRevisionId);
    show("commercial-projection-published-row", !!distinctPublished);
    if (distinctPublished) {
      var publishedTotal = money(latestPublished.saleTotal, latestPublished.currency);
      text("commercial-projection-published", "Q" + latestPublished.revisionNumber + " · " + quoteStatus(latestPublished.status) +
        (publishedTotal ? " · " + publishedTotal : ""));
    }
    var comparison = projection.comparison;
    show("commercial-projection-delta-row", !!comparison);
    if (comparison) {
      var absolute = money(comparison.absoluteDelta, projection.currency);
      var percentage = typeof comparison.percentageDelta === "number" ? " (" + comparison.percentageDelta.toFixed(1) + " %)" : "";
      text("commercial-projection-delta", (comparison.absoluteDelta > 0 ? "+" : "") + absolute + percentage);
    }

    if (!lastProjectionMatchConfirmed) {
      var serverDetail = projection.status === "incomplete" ? incompleteReason(projection.issues) + " " : "";
      setState("server_only", serverDetail + "Importe del servidor; no se confirmó la coincidencia con el modelo local.");
    } else if (projection.status === "current") {
      setState("current", "Estimación no vinculante del diseño conectado.");
    } else {
      setState("incomplete", incompleteReason(projection.issues));
    }
    updateQuoteAction();
  }

  function quoteReady() {
    var state = currentWorkState();
    return !!binding && binding.canCreateInitialQuote === true &&
      !!hostReconciliation && hostReconciliation.clean === true &&
      hostReconciliation.contextKey === exactContextKey(binding) &&
      !pending && !quotePending && !mutationInFlight && !!lastProjection &&
      lastProjectionMatchConfirmed && !!state && state.matchConfirmed === true &&
      state.localChangesPending === false && lastProjection.status === "current" &&
      !lastProjection.reference && lastProjection.itemCount > 0 &&
      typeof lastProjection.workingVersion === "string" && lastProjection.workingVersion.length > 0 &&
      /^sha256-[0-9a-f]{64}$/.test(lastProjection.workingFingerprint || "") &&
      lastProjection.amounts && typeof lastProjection.amounts.saleTotal === "number" &&
      isFinite(lastProjection.amounts.saleTotal);
  }

  function updateQuoteAction() {
    var button = element("btn-initial-quote");
    if (!button) return;
    button.disabled = !quoteReady();
    button.textContent = quotePending ? "Emitiendo…" : "Emitir cotización";
    if (lastProjection && lastProjection.reference) {
      var frozenTotal = typeof lastProjection.reference.saleTotal === "number" ?
        " · " + money(lastProjection.reference.saleTotal, lastProjection.reference.currency) : "";
      text("initial-quote-status", "Q" + lastProjection.reference.revisionNumber + " · " +
        quoteStatus(lastProjection.reference.status) + frozenTotal);
    } else if (!quotePending && hostReconciliation && hostReconciliation.clean !== true) {
      text("initial-quote-status", "Resolvé " + hostReconciliation.attention + " divergencias con este archivo antes de emitir.");
    } else if (!quotePending) text("initial-quote-status", quoteReady() ? "Lista para crear Q1." : "Sin cotización emitible.");
  }

  function emitQuote() {
    if (!quoteReady() || !window.sketchup || typeof window.sketchup.emit_initial_quote !== "function") return false;
    quotePending = true;
    text("initial-quote-status", "Revalidando presupuesto y creando Q1…");
    updateQuoteAction();
    window.sketchup.emit_initial_quote(JSON.stringify({
      workingVersion: lastProjection.workingVersion,
      workingFingerprint: lastProjection.workingFingerprint,
      saleTotal: lastProjection.amounts.saleTotal
    }));
    return true;
  }

  function receiveQuote(result) {
    quotePending = false;
    if (!result || !result.ok) {
      text("initial-quote-status", (result && result.reason) || "No se pudo emitir la cotización.");
      updateQuoteAction();
      if (result && result.code === "refresh_required") request({ probe: true });
      if (result && result.code === "host_reconciliation_required" && window.sketchup &&
          typeof window.sketchup.get_project_furniture === "function") window.sketchup.get_project_furniture();
      return false;
    }
    var quote = result.quote || {};
    var snapshot = quote.commercialSnapshot || {};
    var total = snapshot.breakdown && snapshot.breakdown.salePrice;
    lastProjection.reference = {
      quoteRevisionId: quote.id, revisionNumber: quote.revisionNumber,
      status: quote.status, currency: snapshot.currency || lastProjection.currency, saleTotal: total
    };
    quoteWebUrl = result.webUrl || null;
    text("initial-quote-status", "Q1 · Borrador" + (typeof total === "number" ? " · " + money(total, snapshot.currency || lastProjection.currency) : ""));
    var open = element("btn-open-in-granete");
    if (open) open.style.display = quoteWebUrl ? "" : "none";
    renderProjection(lastProjection, true);
    return true;
  }

  function incompleteReason(issues) {
    var values = Array.isArray(issues) ? issues : [];
    if (values.indexOf("working_item_parameters_not_priceable") !== -1) {
      return "El diseño contiene parámetros que este presupuesto todavía no admite.";
    }
    if (values.indexOf("commercial_amounts_withheld_for_organization") !== -1) {
      return "Los importes comerciales no están disponibles para esta organización.";
    }
    if (values.indexOf("working_copy_empty") !== -1) {
      return "El diseño todavía no contiene muebles que puedan presupuestarse.";
    }
    if (values.some(function (value) {
      return value === "working_item_missing_furniture_definition" ||
        value === "working_item_pricing_context_missing" || value.indexOf("pricing_inputs_incomplete:") === 0;
    })) {
      return "Faltan datos comerciales para calcular este diseño.";
    }
    return "Faltan datos para calcular este diseño; no se muestra cero como reemplazo.";
  }

  function request(options) {
    if (mutationInFlight) {
      setState("pending_sync", "Cambio en curso; esperá su resultado antes de actualizar el presupuesto.");
      return false;
    }
    if (hasPendingLocalWork() && !(options && options.probe === true)) {
      setState("stale", "El cambio local todavía no se sincronizó con el diseño del servidor.");
      return false;
    }
    if (!binding || !window.sketchup || typeof window.sketchup.get_commercial_projection !== "function") {
      setState("unavailable", "Conectá un modelo y una sesión para ver el presupuesto.");
      return false;
    }
    sequence += 1;
    pending = { requestId: "commercial-" + sequence, projectId: binding.projectId, designId: binding.designId,
      workEpoch: workEpoch };
    setState("calculating", "Calculando con precios y reglas actuales del servidor…");
    updateQuoteAction();
    window.sketchup.get_commercial_projection(JSON.stringify({ requestId: pending.requestId }));
    return true;
  }

  function setBinding(status) {
    var next = status && status.state === "connected" && status.binding ?
      Object.assign({}, status.binding, {
        canCreateInitialQuote: !!status.capabilities && status.capabilities.can_create_initial_quote === true
      }) : null;
    sequence += 1;
    pending = null;
    lastProjection = null;
    quotePending = false;
    quoteWebUrl = null;
    hostReconciliation = null;
    binding = next;
    reconcileMutationRuntime();
    show("commercial-projection-card", !!binding);
    show("commercial-projection-values", false);
    show("btn-open-in-granete", false);
    updateQuoteAction();
    if (binding) request({ probe: true });
  }

  function setHostReconciliation(payload) {
    hostReconciliation = null;
    if (binding && payload && payload.state === "connected" &&
        payload.projectId === binding.projectId && payload.designId === binding.designId &&
        payload.baseRevisionId === (binding.baseRevisionId || null) &&
        payload.schemaVersion === binding.schemaVersion && typeof payload.snapshot === "string") {
      hostReconciliation = {
        contextKey: exactContextKey(binding), clean: payload.clean === true,
        attention: Number(payload.attention || (payload.summary && payload.summary.attention) || 0)
      };
    }
    updateQuoteAction();
    return hostReconciliation !== null;
  }

  function receive(payload) {
    if (mutationInFlight) return false;
    if (!pending || !payload || payload.requestId !== pending.requestId) return false;
    if (pending.workEpoch !== workEpoch) return false;
    if (payload.projectId && (payload.projectId !== pending.projectId || payload.designId !== pending.designId)) return false;
    pending = null;
    if (payload.projection && !validWorkState(payload.workState)) {
      show("commercial-projection-values", false);
      setState("incompatible", "No se pudo confirmar si el presupuesto corresponde al modelo local.");
      return true;
    }
    if (payload.workState) {
      if (!validWorkState(payload.workState)) return false;
      workStates[contextKey(binding)] = payload.workState;
      if (payload.workState.localChangesPending === true) {
        show("commercial-projection-values", false);
        setState("stale", payload.error || "El cambio local todavía no se sincronizó con el diseño del servidor.");
        updateQuoteAction();
        return true;
      }
      if (payload.workState.matchConfirmed !== true) {
        if (payload.projection) renderProjection(payload.projection, false);
        else {
          show("commercial-projection-values", false);
          setState("incompatible", payload.error || "No se confirmó que el presupuesto corresponda al modelo local.");
        }
        return true;
      }
    }
    if (payload.projection) renderProjection(payload.projection, true);
    else { show("commercial-projection-values", false); setState(payload.state || "unavailable", payload.error); }
    updateQuoteAction();
    return true;
  }

  function applySynchronization(payload) {
    if (!validWorkState(payload) || ["local", "partial", "full", "unconfirmed"].indexOf(payload.scope) === -1) {
      workEpoch += 1;
      sequence += 1;
      pending = null;
      show("commercial-projection-values", false);
      if (binding) setState("stale", "No se pudo confirmar la sincronización del diseño local.");
      return false;
    }
    workStates[contextKey(binding)] = payload;
    workEpoch += 1;
    sequence += 1;
    pending = null;
    lastProjection = null;
    show("commercial-projection-values", false);
    if (payload.localChangesPending === true) {
      setState("stale", "Hay cambios locales de este diseño que todavía no están sincronizados.");
    } else if (payload.matchConfirmed !== true) {
      setState("incompatible", "Todavía no se confirmó que el modelo local coincida con el diseño del servidor.");
    } else {
      request({ probe: true });
    }
    updateQuoteAction();
    return true;
  }

  function invalidateSession() {
    sequence += 1;
    workEpoch += 1;
    pending = null;
    lastProjection = null;
    show("commercial-projection-values", false);
    if (binding) setState("unauthenticated", "La sesión cambió; se descartó el presupuesto anterior.");
    updateQuoteAction();
  }

  var refresh = element("btn-commercial-projection-refresh");
  if (refresh) refresh.addEventListener("click", request);
  var quote = element("btn-initial-quote");
  if (quote) quote.addEventListener("click", emitQuote);
  var openQuote = element("btn-open-in-granete");
  if (openQuote) openQuote.addEventListener("click", function () {
    if (quoteWebUrl && window.sketchup && window.sketchup.open_external_url) {
      window.sketchup.open_external_url(JSON.stringify({ url: quoteWebUrl }));
    }
  });
  if (document && document.addEventListener) {
    document.addEventListener("granete-mutation-state", function (event) {
      var phase = event && event.detail && event.detail.phase;
      if (activeMutationPhase(phase)) {
        if (!mutationInFlight) mutationContextKey = contextKey(binding);
        mutationInFlight = true;
        if (!binding) return;
        workEpoch += 1;
        sequence += 1;
        pending = null;
        show("commercial-projection-values", false);
        setState("pending_sync", "Cambio en curso; el total anterior no se presenta como actual.");
        updateQuoteAction();
        return;
      }
      if (!terminalMutationPhase(phase)) return;

      var trackedContextKey = mutationContextKey;
      var wasInFlight = mutationInFlight;
      mutationInFlight = false;
      mutationContextKey = null;
      if (!binding) return;
      updateQuoteAction();
      if (wasInFlight && trackedContextKey !== contextKey(binding)) {
        request({ probe: true });
        return;
      }

      if (phase === "committed") {
        workEpoch += 1;
        sequence += 1;
        pending = null;
        workStates[contextKey(binding)] = {
          projectId: binding.projectId, designId: binding.designId,
          generation: ((currentWorkState() || {}).generation || 0) + 1,
          localChangesPending: true, matchConfirmed: false, scope: "local"
        };
        lastProjection = null;
        show("commercial-projection-values", false);
        setState("stale", "El cambio local todavía no se sincronizó con el diseño del servidor.");
      } else if (["rejected", "cancelled", "aborted"].indexOf(phase) !== -1 && lastProjection) {
        renderProjection(lastProjection, lastProjectionMatchConfirmed);
      } else if (["rejected", "cancelled", "aborted"].indexOf(phase) !== -1) {
        request();
      } else if (phase === "stale" || phase === "unavailable") {
        workEpoch += 1;
        sequence += 1;
        pending = null;
        show("commercial-projection-values", false);
        setState("stale", "No se pudo confirmar la versión comercial del cambio.");
      }
      updateQuoteAction();
    });
  }

  window.GraneteCommercialProjection = {
    setBinding: setBinding, receive: receive, refresh: request,
    setHostReconciliation: setHostReconciliation,
    applySynchronization: applySynchronization, invalidateSession: invalidateSession,
    receiveQuote: receiveQuote
  };
  if (window.sketchup && typeof window.sketchup.get_model_binding === "function") window.sketchup.get_model_binding();
})();
