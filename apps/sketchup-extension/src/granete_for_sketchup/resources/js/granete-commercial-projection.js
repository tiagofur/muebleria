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
      incompatible: ["Actualización requerida", "invalid"]
    }[state] || ["No disponible", "invalid"];
    if (badge) { badge.textContent = copy[0]; badge.className = "status-badge " + copy[1]; }
    text("commercial-projection-status", detail || copy[0]);
  }

  function money(value, currency) {
    if (typeof value !== "number" || !isFinite(value)) return null;
    try { return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency }).format(value); }
    catch (_error) { return value.toFixed(2) + " " + currency; }
  }

  function renderProjection(projection) {
    lastProjection = projection;
    var amounts = projection.amounts;
    var total = amounts && money(amounts.saleTotal, projection.currency);
    show("commercial-projection-values", true);
    text("commercial-projection-total", total || (projection.saleAmountsWithheld ? "No disponible para esta organización" : "No disponible"));

    var cost = amounts && money(amounts.directCost, projection.currency);
    show("commercial-projection-cost-row", !!cost && !projection.costsWithheld);
    if (cost) text("commercial-projection-cost", cost);
    var margin = amounts && typeof amounts.marginFactor === "number" ? amounts.marginFactor.toFixed(2) + "×" : null;
    show("commercial-projection-margin-row", !!margin && !projection.costsWithheld);
    if (margin) text("commercial-projection-margin", margin);

    var reference = projection.reference;
    if (reference) {
      var referenceTotal = money(reference.saleTotal, reference.currency);
      text("commercial-projection-reference", "Q" + reference.revisionNumber + " · " + reference.status + (referenceTotal ? " · " + referenceTotal : ""));
    } else {
      text("commercial-projection-reference", "Sin cotización de referencia");
    }
    var latestPublished = projection.latestPublishedReference;
    var distinctPublished = latestPublished && (!reference || latestPublished.quoteRevisionId !== reference.quoteRevisionId);
    show("commercial-projection-published-row", !!distinctPublished);
    if (distinctPublished) {
      var publishedTotal = money(latestPublished.saleTotal, latestPublished.currency);
      text("commercial-projection-published", "Q" + latestPublished.revisionNumber + " · " + latestPublished.status +
        (publishedTotal ? " · " + publishedTotal : ""));
    }
    var comparison = projection.comparison;
    show("commercial-projection-delta-row", !!comparison);
    if (comparison) {
      var absolute = money(comparison.absoluteDelta, projection.currency);
      var percentage = typeof comparison.percentageDelta === "number" ? " (" + comparison.percentageDelta.toFixed(1) + " %)" : "";
      text("commercial-projection-delta", (comparison.absoluteDelta > 0 ? "+" : "") + absolute + percentage);
    }

    if (projection.status === "current") setState("current", "Estimación no vinculante del diseño conectado.");
    else setState("incomplete", "Faltan datos para calcular este diseño; no se muestra cero como reemplazo.");
  }

  function request() {
    if (!binding || !window.sketchup || typeof window.sketchup.get_commercial_projection !== "function") {
      setState("unavailable", "Conectá un modelo y una sesión para ver el presupuesto.");
      return;
    }
    sequence += 1;
    pending = { requestId: "commercial-" + sequence, projectId: binding.projectId, designId: binding.designId };
    setState("calculating", "Calculando con precios y reglas actuales del servidor…");
    window.sketchup.get_commercial_projection(JSON.stringify({ requestId: pending.requestId }));
  }

  function setBinding(status) {
    var next = status && status.state === "connected" && status.binding ? status.binding : null;
    sequence += 1;
    pending = null;
    lastProjection = null;
    binding = next;
    show("commercial-projection-card", !!binding);
    show("commercial-projection-values", false);
    if (binding) request();
  }

  function receive(payload) {
    if (!pending || !payload || payload.requestId !== pending.requestId) return false;
    if (payload.projectId && (payload.projectId !== pending.projectId || payload.designId !== pending.designId)) return false;
    pending = null;
    if (payload.projection) renderProjection(payload.projection);
    else { show("commercial-projection-values", false); setState(payload.state || "unavailable", payload.error); }
    return true;
  }

  function invalidateSession() {
    sequence += 1;
    pending = null;
    lastProjection = null;
    show("commercial-projection-values", false);
    if (binding) setState("unauthenticated", "La sesión cambió; se descartó el presupuesto anterior.");
  }

  var refresh = element("btn-commercial-projection-refresh");
  if (refresh) refresh.addEventListener("click", request);
  if (document && document.addEventListener) {
    document.addEventListener("granete-mutation-state", function (event) {
      var phase = event && event.detail && event.detail.phase;
      if (!binding) return;
      if (phase === "resolving" || phase === "applying_host_mutation") {
        sequence += 1;
        pending = null;
        show("commercial-projection-values", false);
        setState("pending_sync", "Cambio en curso; el total anterior no se presenta como actual.");
      } else if (phase === "committed") {
        request();
      } else if (["rejected", "cancelled", "aborted"].indexOf(phase) !== -1 && lastProjection) {
        renderProjection(lastProjection);
      } else if (phase === "stale" || phase === "unavailable") {
        setState("stale", "No se pudo confirmar la versión comercial del cambio.");
      }
    });
  }

  window.GraneteCommercialProjection = {
    setBinding: setBinding, receive: receive, refresh: request, invalidateSession: invalidateSession
  };
  if (window.sketchup && typeof window.sketchup.get_model_binding === "function") window.sketchup.get_model_binding();
})();
