// #498 / SU-HOST-1 — the dialog-side mutation controller: an explicit
// interaction state machine (mirror of Host::InteractionState), the
// double-submit guard, late-response rejection by correlation, and honest
// Spanish status rendering for mutation/degraded/preflight states.
// Behavior branches on outcome/category codes — copy is display-only.
// Idempotent: re-execution attaches nothing twice (dialog reopen safety:
// open/close 5 times → one command → exactly one Ruby callback).
(function () {
  "use strict";
  if (window.GraneteMutation) return;

  var PHASES = ["idle", "selecting", "editing_intent", "resolving", "applying_host_mutation",
    "committed", "rejected", "cancelled", "aborted", "unavailable", "stale"];
  var OUTCOME_TO_PHASE = {
    committed: "committed",
    rejected: "rejected",
    cancelled: "cancelled",
    aborted: "aborted",
    unavailable: "unavailable",
    stale: "stale"
  };
  var BUSY_PHASES = ["editing_intent", "resolving", "applying_host_mutation"];

  // Spanish status copy per phase/outcome (#47): the user never faces an
  // infinite spinner. Category distinguishes auth from offline so an
  // expired session is never presented as "Sin conexión".
  var PHASE_COPY = {
    resolving: "Resolviendo…",
    applying_host_mutation: "Aplicando cambios…",
    committed: "Cambio aplicado.",
    rejected: "Acción rechazada.",
    cancelled: "Acción cancelada.",
    aborted: "No se aplicó el cambio; el mueble anterior permanece.",
    stale: "Cambios desactualizados.",
    unavailable: "Sin conexión"
  };
  var UNAVAILABLE_CATEGORY_COPY = {
    authentication: "Sesión expirada. Iniciá sesión de nuevo.",
    license_capability: "Tu licencia no permite esta acción.",
    incompatible_contract: "La extensión debe actualizarse para entender esta respuesta."
  };

  var machine = { phase: "idle" };
  var pendingMessageId = null;

  function store() {
    return window.GraneteState || null;
  }

  function setPhase(phase, extra) {
    if (PHASES.indexOf(phase) === -1) throw new Error("unknown phase: " + phase);
    machine.phase = phase;
    var mutation = { phase: phase, messageId: pendingMessageId };
    Object.keys(extra || {}).forEach(function (key) { mutation[key] = extra[key]; });
    if (store()) store().set("mutation", mutation);
    render();
  }

  function isBusy() {
    return BUSY_PHASES.indexOf(machine.phase) !== -1;
  }

  // Renders the shared status line + the authoritative manufacturing badge.
  // The badge NEVER claims ready: only Granete's preflight may (#466).
  function render() {
    var status = document.getElementById("mutation-status");
    if (status) {
      var copy = statusCopy();
      if (copy) {
        status.textContent = copy;
        status.hidden = false;
        status.setAttribute("data-phase", machine.phase);
      } else {
        status.hidden = true;
      }
    }
  }

  function statusCopy() {
    if (machine.phase === "unavailable" && machine.category && UNAVAILABLE_CATEGORY_COPY[machine.category]) {
      return UNAVAILABLE_CATEGORY_COPY[machine.category];
    }
    return PHASE_COPY[machine.phase] || null;
  }

  function renderPreflight(entries) {
    var badge = document.getElementById("inspector-manufacturing-badge");
    if (!badge) return;
    var state = preflightStateForSelection(entries);
    if (state === "stale") {
      badge.textContent = "Revisión técnica desactualizada";
      badge.className = "status-badge pending";
    } else if (state === "unavailable") {
      badge.textContent = "Revisión técnica no disponible";
      badge.className = "status-badge pending";
    } else {
      badge.textContent = "Revisión técnica pendiente";
      badge.className = "status-badge pending";
    }
  }

  function preflightStateForSelection(entries) {
    var selection = store() ? store().get("selection") : null;
    var ref = selection && selection.furnitureInstanceRef;
    if (!ref || !entries) return "unknown";
    var entry = entries[ref];
    return entry ? entry.state : "unknown";
  }

  window.GraneteMutation = {
    phase: function () { return machine.phase; },
    pendingMessageId: function () { return pendingMessageId; },

    // Update flow entry point used by the inspector button. Returns:
    //   "sent"         — command submitted with a correlation id
    //   "busy"         — a mutation is already in flight (double-click
    //                    guard: exactly ONE Ruby callback per action)
    //   "unavailable"  — no host bridge; the caller keeps its legacy
    //                    fallback path (browser preview)
    submitUpdate: function (payload, selectedContext) {
      if (isBusy()) return "busy";
      var host = window.sketchup;
      if (!host || typeof host.update_furniture !== "function") return "unavailable";
      var context = selectedContext || (store() ? store().get("selection") : null) || {};
      var target = {};
      if (context.furnitureInstanceRef) target.furnitureInstanceRef = context.furnitureInstanceRef;
      if (context.furnitureInstanceId) target.furnitureInstanceId = context.furnitureInstanceId;
      // Future-proof semantic targets (#467/#468): component and hardware
      // occurrences ride the same neutral channel — no hinge/shelf logic
      // here, ever.
      if (context.componentInstanceId) target.componentInstanceId = context.componentInstanceId;
      if (context.hardwarePlacementId) target.hardwarePlacementId = context.hardwarePlacementId;
      if (Object.keys(target).length === 0) return "unavailable";

      setPhase("editing_intent", { target: target });
      setPhase("resolving", { target: target });
      pendingMessageId = window.GraneteBridge ? window.GraneteBridge.nextMessageId() : null;
      var enriched = Object.assign({}, payload, { messageId: pendingMessageId });
      host.update_furniture(JSON.stringify(enriched));
      return "sent";
    },

    // Ruby→JS mutation outcome. Validated envelope + correlation guard: a
    // late outcome for an older command (inReplyTo mismatch) is discarded
    // and can never overwrite the newer state.
    handleMutationState: function (raw) {
      var envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
      var check = window.GraneteBridge ? window.GraneteBridge.validate(envelope, "mutation_state")
                                       : { ok: false, reason: "no_bridge" };
      if (!check.ok) return { applied: false, reason: check.reason };
      if (pendingMessageId && envelope.inReplyTo && envelope.inReplyTo !== pendingMessageId) {
        return { applied: false, reason: "late_response" };
      }

      machine.category = envelope.category || null;
      var phase = OUTCOME_TO_PHASE[envelope.outcome];
      if (!phase) return { applied: false, reason: "unknown_outcome" };
      if (machine.phase === "resolving" && phase !== "cancelled") {
        setPhase("applying_host_mutation", { outcome: envelope.outcome, category: machine.category });
      }
      setPhase(phase, {
        outcome: envelope.outcome,
        category: machine.category,
        reason: envelope.reason || null,
        degraded: envelope.degraded || null
      });
      pendingMessageId = null;
      return { applied: true, outcome: envelope.outcome };
    },

    handlePreflightState: function (raw) {
      var envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
      var check = window.GraneteBridge ? window.GraneteBridge.validate(envelope, "preflight_state")
                                       : { ok: false, reason: "no_bridge" };
      if (!check.ok) return { applied: false, reason: check.reason };
      var entries = {};
      (envelope.entries || []).forEach(function (entry) {
        var ref = entry.furniture || "";
        // The Ruby key is the full sorted target string; the furniture ref
        // prefix addresses the inspector badge.
        var furnitureRef = ref.match(/furnitureInstanceRef=([^|]+)/);
        entries[furnitureRef ? furnitureRef[1] : ref] = entry;
      });
      if (store()) store().set("preflight", { entries: entries });
      renderPreflight(entries);
      return { applied: true };
    },

    handleDegradedState: function (raw) {
      var envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
      var check = window.GraneteBridge ? window.GraneteBridge.validate(envelope, "degraded_state")
                                       : { ok: false, reason: "no_bridge" };
      if (!check.ok) return { applied: false, reason: check.reason };
      if (store()) store().set("degraded", envelope.state);
      return { applied: true };
    },

    // Selection→state feed (view state only). Called by the legacy
    // onSelectionChange so every consumer sees the same selection truth.
    publishSelection: function (payload) {
      if (store()) store().set("selection", payload);
      if (machine.phase !== "idle" && BUSY_PHASES.indexOf(machine.phase) === -1) {
        setPhase("idle");
      }
    },

    // Registers the Ruby→JS runtime callbacks on the dialog bridge ONCE.
    // The guard flag survives re-execution inside the same page, and the
    // fresh page per dialog open keeps reopen from multiplying callbacks.
    attachToDialog: function (dialogApi) {
      var api = dialogApi || window.GraneteDialog;
      if (!api || api.__graneteHostRuntimeAttached) return false;
      api.__graneteHostRuntimeAttached = true;
      api.onMutationState = function (payload) { window.GraneteMutation.handleMutationState(payload); };
      api.onPreflightState = function (payload) { window.GraneteMutation.handlePreflightState(payload); };
      api.onDegradedState = function (payload) { window.GraneteMutation.handleDegradedState(payload); };
      return true;
    }
  };

  window.GraneteMutation.attachToDialog();
})();
