// #848 Phase B C4.9 — project furniture module (window.GraneteUI.projectFurniture).
// Owns: the Project Furniture panel (#389 / DT-5) dialog-side state and
// surface — units that already exist in the connected project, reconciled
// with exact WorkingCopy intent and the open file's managed roots. That is:
// lastPfState (the rendered-state guard: the loading card shows only when
// nothing is rendered yet and the Proyecto tab reloads exactly once), the
// per-action in-flight maps (pfPlacing / pfConfirming / pfCancelling /
// pfRestoring), the #810 design-sync card state (designSyncBusy +
// lastDesignSyncOutcome), the request/reload orchestration
// (requestProjectFurniture), the render of every distinct panel state
// (loading / empty / error / unbound / connected list), the per-unit rows
// and action lifecycle (Colocar / Reintentar sincronización / Cancelar /
// Restaurar / Seleccionar), the missing-unit recovery pair #870 (Restaurar
// posición — the Restorer at the recorded WorkingCopy transform — and
// Colocar manualmente — the SAME existing unit driven through the shared
// #469 placement preview; neither ever creates a new unit), the shared #469
// placement-preview result
// handlers for the Project lane (the catalog lane's repeat state + re-arm
// live in js/granete-configurator.js and are consumed call-time), the
// failure copy tables (PF_ERROR_COPY + pfPlaceFailureMessage), the host
// save-awareness banner and the panel lifecycle (no pre-render: the panel
// loads when the Proyecto tab first becomes visible; refresh/retry/sync
// button listeners).
//
// Consumes: deps injected via init(): showToast (shared inline helper).
// Everything else call-time, never cached: window.sketchup bridges
// (get_project_furniture, begin_placement_preview, place_furniture_instance,
// confirm_placement_instance, cancel_placement_instance,
// restore_furniture_instance, select_project_furniture,
// synchronize_design); window.GraneteUI.configurator
// (isRepeatPreviewActive / cancelRepeatPreview / rearmInsertButton — the
// catalog entry point of the shared #469 handlers);
// window.GraneteCommercialProjection.refresh() after a successful design
// sync (lazy, window-qualified exactly as before).
//
// Ruby-facing boundary: Ruby keeps calling GraneteDialog with unchanged
// names/payloads; the inline wrappers delegate:
// onProjectFurniture → renderProjectFurniture (the wrapper keeps the
// Commercial Projection setHostReconciliation fan-out — cross-domain
// orchestration stays inline, the module alone never triggers it),
// onPlaceFurnitureResult → handlePlaceFurnitureResult,
// onPlacementPreviewStarted / onPlacementPreviewCancelled →
// handlePlacementPreviewStarted / handlePlacementPreviewCancelled,
// onConfirmPlacementResult → handleConfirmPlacementResult,
// onCancelPlacementResult → handleCancelPlacementResult,
// onRestoreFurnitureResult → handleRestoreFurnitureResult,
// onSynchronizeDesignResult → handleSynchronizeDesignResult,
// onHostSaveAwareness → renderHostSaveAwareness.
// Dialog seams: switchTab("project") → onProjectTabVisible() (the
// lastPfState === null condition moved with its state);
// GraneteUI.modelBinding.init receives invalidateProjectFurniture:
// projectFurniture.invalidate — every binding status render invalidates
// the PF rows through this API (the connected reload stays in the inline
// onModelBindingStatus orchestrator, exact pre-C4.9 order).
//
// Does NOT own: model binding / pairing / publish / validation state
// (GraneteUI.modelBinding), Commercial Projection/Bootstrap state, the
// catalog placement intent / #469 repeat state (GraneteUI.configurator),
// handleCreateProjectFurnitureResult (js/granete-configurator.js — the
// insert button's legacy connected fallback; GraneteDialog delegates),
// Inspector selection, Library browsing, materials/finish selection,
// Ruby placement tools / host mutation authority, business identity (the
// Ruby bridge is the authority: the panel never invents or edits it).
//
// Start here: "los muebles del proyecto no aparecen" / stale rows / wrong
// state card → this module (renderProjectFurniture +
// requestProjectFurniture) and its focused harness
// test/js/granete_project_furniture_test.js (structural guards in
// test/unit/granete_project_furniture_js_test.rb).
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.projectFurniture) return;

  // Injected by the dialog bootstrap before any user-visible action.
  var deps = {};

  function requireDeps() {
    var missing = ["showToast"].filter(function (name) {
      return typeof deps[name] !== "function";
    });
    if (missing.length > 0) {
      throw new Error("GraneteUI.projectFurniture.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  // ------------------------------------------------------------------
  // Project Furniture (#389 / DT-5). Separate source from the Catalog:
  // units that already exist in the connected project, reconciled with
  // exact WorkingCopy intent and the open file's managed roots. Every
  // action goes to Ruby; the panel never invents or edits business identity.
  // ------------------------------------------------------------------
  var pfUnbound = document.getElementById("pf-unbound-state");
  var pfLoading = document.getElementById("pf-loading-state");
  var pfError = document.getElementById("pf-error-state");
  var pfErrorTitle = document.getElementById("pf-error-title");
  var pfErrorDetail = document.getElementById("pf-error-detail");
  var pfEmpty = document.getElementById("pf-empty-state");
  var pfListView = document.getElementById("pf-list-view");
  var pfCountBadge = document.getElementById("pf-count-badge");
  var pfPendingTitle = document.getElementById("pf-pending-title");
  var pfPendingList = document.getElementById("pf-pending-list");
  var pfPlacedTitle = document.getElementById("pf-placed-title");
  var pfPlacedList = document.getElementById("pf-placed-list");
  var btnPfRefresh = document.getElementById("btn-pf-refresh");
  var btnPfRetry = document.getElementById("btn-pf-retry");
  var pfSaveAwareness = document.getElementById("pf-save-awareness");
  var designSyncCard = document.getElementById("design-sync-card");
  var designSyncStatus = document.getElementById("design-sync-status");
  var designSyncBadge = document.getElementById("design-sync-badge");
  var btnDesignSync = document.getElementById("btn-design-sync");
  var designSyncBusy = false;
  var debouncedSyncTimer = null;
  var isAutoSyncInFlight = false;
  var AUTO_SYNC_DELAY_MS = 1500;

  var PF_ERROR_COPY = {
    unauthenticated: "Iniciá sesión con tu cuenta del taller (pill superior derecha).",
    unauthorized: "No tenés permiso para el proyecto o diseño enlazado.",
    unreachable: "No se pudo contactar al servidor. Probá de nuevo.",
    stale_base: "El diseño avanzó en el servidor: actualizá la base de trabajo en la tarjeta Modelo / Diseño.",
    design_archived: "El diseño fue archivado en Granete y no puede editarse desde este modelo.",
    bad_contract: "El servidor respondió datos que esta extensión no entiende. Actualizá la extensión.",
    error: "No se pudieron cargar los muebles del proyecto."
  };

  // furnitureInstanceId → { button, label, lane }: the shared #469 preview
  // handlers serve BOTH Project lanes (unplaced #389 and missing #870), so
  // every entry carries its own re-arm label and lane for honest cancel
  // copy — never a second placement state machine.
  var pfPlacing = {};
  var pfConfirming = {};
  var pfCancelling = {};
  var pfRestoring = {};

  // Re-arms the entry point that started a placement (preview refused,
  // cancelled, failed or position-pending). Returns the button, if any.
  function rearmPlaceButton(key) {
    var entry = pfPlacing[key];
    delete pfPlacing[key];
    if (!entry) return null;
    entry.button.disabled = false;
    entry.button.textContent = entry.label;
    return entry.button;
  }

  function placeEntryLane(key) {
    return pfPlacing[key] ? pfPlacing[key].lane : null;
  }

  function renderHostSaveAwareness(payload) {
    pfSaveAwareness.style.display = payload && payload.needsSave ? "block" : "none";
  }

  function hidePfStates() {
    [pfUnbound, pfLoading, pfError, pfEmpty].forEach(function (el) { el.style.display = "none"; });
    pfListView.style.display = "none";
    designSyncCard.style.display = "none";
  }

  // #810 sync surface. The badge/state map is exhaustive and honest:
  // pending changes, syncing, synchronized, conflict and error. A
  // network failure can never render as "Sincronizado".
  function isMutationActive() {
    if (typeof window !== "undefined" && window.GraneteMutation && typeof window.GraneteMutation.phase === "function") {
      var phase = window.GraneteMutation.phase();
      return ["editing_intent", "resolving", "applying_host_mutation"].indexOf(phase) !== -1;
    }
    return false;
  }

  function cancelDebouncedSync() {
    if (debouncedSyncTimer) {
      clearTimeout(debouncedSyncTimer);
      debouncedSyncTimer = null;
    }
  }

  function scheduleDebouncedSync(delayMs) {
    cancelDebouncedSync();
    if (lastPfState !== "connected") return;
    if (lastDesignSyncOutcome && lastDesignSyncOutcome.kind === "conflict") return;
    if (isMutationActive()) return;

    var delay = typeof delayMs === "number" ? delayMs : AUTO_SYNC_DELAY_MS;
    debouncedSyncTimer = setTimeout(function () {
      debouncedSyncTimer = null;
      triggerAutoSync();
    }, delay);
  }

  function triggerAutoSync() {
    if (designSyncBusy) {
      scheduleDebouncedSync(500);
      return;
    }
    if (isMutationActive()) {
      scheduleDebouncedSync(500);
      return;
    }
    if (lastPfState !== "connected") return;
    if (lastDesignSyncOutcome && lastDesignSyncOutcome.kind === "conflict") return;

    synchronizeDesign({ isAuto: true });
  }

  function renderDesignSyncCard(payload) {
    if (designSyncBusy) return;
    var dirty = payload.dirty || 0;
    var lastOutcome = lastDesignSyncOutcome;
    designSyncCard.style.display = "block";
    if (lastOutcome && lastOutcome.kind === "conflict") {
      cancelDebouncedSync();
      designSyncBadge.className = "status-badge conflict";
      designSyncBadge.textContent = "Conflicto";
      designSyncStatus.textContent = "El diseño cambió en el servidor. " +
        (dirty > 0 ? dirty + " cambio(s) local(es) esperan una nueva sincronización." : "Sincronizá de nuevo para ver el estado actual.");
      btnDesignSync.disabled = false;
      btnDesignSync.textContent = "Sincronizar diseño";
      return;
    }
    if (lastOutcome && lastOutcome.kind === "error") {
      cancelDebouncedSync();
      designSyncBadge.className = "status-badge invalid";
      designSyncBadge.textContent = "Error de sincronización";
      designSyncStatus.textContent = lastOutcome.reason || "No se pudo sincronizar el diseño.";
      btnDesignSync.disabled = false;
      btnDesignSync.textContent = "Reintentar sincronización";
      return;
    }
    if (dirty > 0) {
      designSyncBadge.className = "status-badge pending";
      designSyncBadge.textContent = "Pendiente";
      designSyncStatus.textContent = dirty + " cambio" + (dirty === 1 ? "" : "s") +
        " local" + (dirty === 1 ? "" : "es") + " pendiente" + (dirty === 1 ? "" : "s") +
        " de sincronizar. El total del diseño todavía no los incluye.";
      btnDesignSync.disabled = false;
      btnDesignSync.textContent = "Sincronizar diseño";
      scheduleDebouncedSync();
      return;
    }
    cancelDebouncedSync();
    designSyncBadge.className = "status-badge valid";
    designSyncBadge.textContent = "Sincronizado";
    designSyncStatus.textContent = "El diseño coincide con Granete.";
    btnDesignSync.disabled = dirty === 0;
    btnDesignSync.textContent = "Sincronizar diseño";
  }

  var lastDesignSyncOutcome = null;

  function synchronizeDesign(options) {
    if (designSyncBusy) return;
    var isAuto = !!(options && options.isAuto);
    isAutoSyncInFlight = isAuto;
    cancelDebouncedSync();
    designSyncBusy = true;
    designSyncBadge.className = "status-badge pending";
    designSyncBadge.textContent = "Sincronizando";
    designSyncStatus.textContent = isAuto ? "Actualizando presupuesto…" : "Sincronizando…";
    btnDesignSync.disabled = true;
    btnDesignSync.textContent = "Sincronizando…";
    if (window.sketchup && window.sketchup.synchronize_design) {
      window.sketchup.synchronize_design();
    } else {
      designSyncBusy = false;
      isAutoSyncInFlight = false;
      lastDesignSyncOutcome = { kind: "error", reason: "La sincronización está disponible sólo dentro de SketchUp." };
      btnDesignSync.disabled = false;
      btnDesignSync.textContent = "Sincronizar diseño";
      deps.showToast("error", "Sincronización disponible sólo dentro de SketchUp.");
    }
  }

  function handleSynchronizeDesignResult(result) {
    var wasAuto = isAutoSyncInFlight;
    isAutoSyncInFlight = false;
    designSyncBusy = false;
    btnDesignSync.disabled = false;
    btnDesignSync.textContent = "Sincronizar diseño";
    result = result || {};
    if (result.ok) {
      lastDesignSyncOutcome = null;
      var changes = result.changes || {};
      var total = (changes.added || []).length + (changes.updated || []).length + (changes.removed || []).length;
      if (!wasAuto) {
        deps.showToast("success", total > 0 ? "Diseño sincronizado (" + total + " cambio" + (total === 1 ? "" : "s") + ")." : "El diseño ya estaba sincronizado.");
      }
      // The confirmed total comes from the backend projection, never
      // from local math (#810 rule F).
      if (window.GraneteCommercialProjection) { window.GraneteCommercialProjection.refresh(); }
      // #784 R3 final review: the confirmed synchronize is exactly the
      // moment the server accepted the new material lineage — re-read the
      // inheritance projection so the badges return to server truth (via
      // the injected seam; no optimistic badge inference here).
      if (typeof deps.refreshDesignInheritance === "function") { deps.refreshDesignInheritance(); }
      requestProjectFurniture();
    } else {
      lastDesignSyncOutcome = { kind: result.code === "conflict" ? "conflict" : "error", reason: result.reason };
      deps.showToast("error", result.code === "conflict"
        ? "Conflicto: el diseño cambió en el servidor."
        : "No se pudo sincronizar el diseño.");
      requestProjectFurniture();
    }
  }

  var lastPfState = null;

  function requestProjectFurniture() {
    // Keep the rendered list while refreshing; show the loading card
    // only when there is nothing rendered yet.
    if (lastPfState !== "connected") {
      hidePfStates();
      pfLoading.style.display = "block";
    }
    if (window.sketchup && window.sketchup.get_project_furniture) {
      window.sketchup.get_project_furniture();
    } else {
      renderProjectFurniture({ state: "unbound" });
    }
  }

  function renderProjectFurniture(payload) {
    payload = payload || {};
    lastPfState = payload.state;
    hidePfStates();

    if (payload.state === "connected") {
      renderDesignSyncCard(payload);
      var items = payload.items || [];
      if (!items.length) {
        pfEmpty.style.display = "block";
        return;
      }
      pfListView.style.display = "block";
      pfCountBadge.textContent = (payload.placed || 0) + " puestos · " + (payload.pending || 0) + " pendientes" +
        ((payload.attention || 0) > 0 ? " · " + payload.attention + " requieren atención" : "");
      pfPendingTitle.textContent = "Pendientes y divergencias (" + (payload.pending || 0) + ")";
      pfPlacedTitle.textContent = "Puestos / Sincronizados (" + (payload.placed || 0) + ")";
      // Terminal (removed/cancelled) units are neither placeable nor
      // placed; they are history and stay out of this authoring panel.
      renderPfList(pfPendingList, items.filter(function (row) { return !row.placed && !row.terminal; }));
      renderPfList(pfPlacedList, items.filter(function (row) { return row.placed; }));
      return;
    }

    if (payload.state === "unbound") {
      pfUnbound.style.display = "block";
      return;
    }

    pfErrorTitle.textContent = payload.state === "stale_base" || payload.state === "design_archived"
      ? "Diseño no editable" : "No se pudieron cargar";
    pfErrorDetail.textContent = PF_ERROR_COPY[payload.state] || payload.reason || "Intentá de nuevo.";
    if (payload.reason && PF_ERROR_COPY[payload.state] && payload.state !== "unreachable") {
      pfErrorDetail.textContent += " (" + payload.reason + ")";
    }
    pfError.style.display = "block";
  }

  function renderPfList(container, rows) {
    container.innerHTML = "";
    if (!rows.length) {
      var note = document.createElement("p");
      note.className = "subhead";
      note.style.margin = "0";
      note.style.fontSize = "var(--text-xs)";
      note.textContent = container === pfPendingList ?
        "No hay unidades pendientes ni divergencias." : "Todavía no hay unidades sincronizadas.";
      container.appendChild(note);
      return;
    }
    rows.forEach(function (row) {
      container.appendChild(pfUnitCard(row));
    });
  }

  function pfUnitCard(row) {
    var card = document.createElement("div");
    // #870: the missing-unit card is a stacked recovery card — information
    // owns the full width and both same-level actions sit below.
    var missing = row.reconciliationState === "missing_local";
    card.className = "card pf-unit-card" + (missing ? " pf-unit-card--recovery" : "");

    var main = document.createElement("div");
    main.className = "pf-unit-main";

    var name = document.createElement("div");
    name.className = "pf-unit-name";
    var nameText = document.createElement("span");
    nameText.textContent = row.name || "Mueble del proyecto";
    name.appendChild(nameText);
    // Quantity > 1: identical units stay individually traceable.
    if (row.unitTotal > 1) {
      var unitBadge = document.createElement("span");
      unitBadge.className = "status-badge pending";
      unitBadge.textContent = "Unidad " + row.unitIndex + " de " + row.unitTotal;
      name.appendChild(unitBadge);
    }
    var stateCopy = {
      pending_confirmation: ["Posición pendiente", "pending"],
      present_synced: ["Puesto / Sincronizado", "valid"],
      missing_local: ["Falta en este archivo", "conflict"],
      duplicate_local: ["Identidad duplicada", "invalid"],
      terminal_or_orphan_local: ["Identidad no vigente", "invalid"],
      recovery_blocked: ["Restauración bloqueada", "invalid"],
      incompatible: ["Contexto incompatible", "invalid"],
      unknown: ["Presencia no verificable", "invalid"]
    }[row.reconciliationState];
    if (stateCopy) {
      var stateBadge = document.createElement("span");
      stateBadge.className = "status-badge " + stateCopy[1];
      stateBadge.textContent = stateCopy[0];
      name.appendChild(stateBadge);
    }
    main.appendChild(name);

    if (row.dimensions_label) {
      var dims = document.createElement("div");
      dims.className = "pf-unit-meta";
      dims.textContent = row.dimensions_label;
      main.appendChild(dims);
    }

    if (missing) {
      // #870: plain recovery copy replaces the raw reconciliation reason.
      var missingLine = document.createElement("div");
      missingLine.className = "pf-unit-meta";
      missingLine.textContent = "Este mueble pertenece al proyecto, pero ya no está en este archivo de SketchUp.";
      main.appendChild(missingLine);
      var recoveryLine = document.createElement("div");
      recoveryLine.className = "pf-unit-meta";
      recoveryLine.textContent = "Puedes restaurarlo en su posición anterior o colocarlo nuevamente.";
      main.appendChild(recoveryLine);
    } else if (row.reason) {
      var reason = document.createElement("div");
      reason.className = "pf-unit-meta";
      reason.textContent = row.reason;
      main.appendChild(reason);
    }

    // Granete IDs are diagnostics, not product noise: secondary line.
    var ref = document.createElement("div");
    ref.className = "pf-unit-ref";
    ref.textContent = "Unidad " + String(row.id || "").slice(0, 8);
    main.appendChild(ref);

    card.appendChild(main);

    if (row.reconciliationState === "pending_confirmation") {
        var actionsGroup = document.createElement("div");
        actionsGroup.style.display = "flex";
        actionsGroup.style.gap = "6px";

        var btnConfirm = document.createElement("button");
        btnConfirm.className = "btn btn-secondary";
        btnConfirm.style.width = "auto";
        btnConfirm.textContent = pfConfirming[row.id] ? "Sincronizando…" : "Reintentar sincronización";
        btnConfirm.disabled = !!pfConfirming[row.id] || !!pfCancelling[row.id];
        btnConfirm.addEventListener("click", function () { confirmPlacementInstance(row.id, btnConfirm); });
        actionsGroup.appendChild(btnConfirm);

        var btnCancel = document.createElement("button");
        btnCancel.className = "btn btn-secondary";
        btnCancel.style.width = "auto";
        btnCancel.textContent = pfCancelling[row.id] ? "Cancelando…" : "Cancelar";
        btnCancel.disabled = !!pfConfirming[row.id] || !!pfCancelling[row.id];
        btnCancel.addEventListener("click", function () { cancelPlacementInstance(row.id, btnCancel); });
        actionsGroup.appendChild(btnCancel);

        card.appendChild(actionsGroup);
    } else if (row.reconciliationState === "unplaced") {
        var action = document.createElement("button");
        action.className = "btn btn-secondary";
        action.style.width = "auto";
        action.textContent = pfPlacing[row.id] ? "Colocando…" : "Colocar";
        action.disabled = !!pfPlacing[row.id];
        action.addEventListener("click", function () { placeFurnitureInstance(row.id, action); });
        card.appendChild(action);
    } else if (missing) {
      // #870 — two same-level recovery intents for the SAME unit: the
      // recorded-position restore (Restorer) or a manual placement of the
      // existing unit through the shared #469 preview. Never a new unit.
      var busy = pfRestoring[row.id] || pfPlacing[row.id];
      var actions = document.createElement("div");
      actions.className = "pf-unit-actions";

      var restore = document.createElement("button");
      restore.className = "btn btn-secondary";
      restore.style.width = "auto";
      restore.textContent = pfRestoring[row.id] ? "Restaurando…" : "↶ Restaurar posición";
      restore.disabled = !!busy;
      restore.addEventListener("click", function () { restoreFurnitureInstance(row.id, restore); });
      actions.appendChild(restore);

      var manual = document.createElement("button");
      manual.className = "btn btn-secondary";
      manual.style.width = "auto";
      manual.textContent = pfPlacing[row.id] ? "Colocando…" : "+ Colocar manualmente";
      manual.disabled = !!busy;
      manual.addEventListener("click", function () {
        placeFurnitureInstance(row.id, manual, "+ Colocar manualmente", "missing");
      });
      actions.appendChild(manual);

      card.appendChild(actions);
    } else if (row.reconciliationState === "present_synced") {
      var action = document.createElement("button");
      action.className = "btn btn-secondary";
      action.style.width = "auto";
      action.textContent = "Seleccionar";
      action.addEventListener("click", function () {
        if (window.sketchup && window.sketchup.select_project_furniture) {
          window.sketchup.select_project_furniture(JSON.stringify({ furnitureInstanceId: row.id }));
        }
      });
      card.appendChild(action);
    }
    return card;
  }

  function placeFurnitureInstance(furnitureInstanceId, button, label, lane) {
    label = label || "Colocar";
    lane = lane || "unplaced";
    // #870: a missing unit's two recovery intents are mutually exclusive
    // while one is in flight (pfRestoring guards the same identity).
    if (!furnitureInstanceId || pfPlacing[furnitureInstanceId] || pfRestoring[furnitureInstanceId]) return;
    document.getElementById("pf-placement-error").style.display = "none";
    pfPlacing[furnitureInstanceId] = { button: button, label: label, lane: lane };
    button.disabled = true;
    button.textContent = "Colocando…";
    if (window.sketchup && window.sketchup.begin_placement_preview) {
      // #469: transient cursor-following preview; the click commits
      // through the canonical place command. #870: the SAME entry point
      // and payload drive a missing unit's manual placement — Ruby keeps
      // the identity and reinserts that exact unit.
      window.sketchup.begin_placement_preview(JSON.stringify({ furnitureInstanceId: furnitureInstanceId }));
    } else if (window.sketchup && window.sketchup.place_furniture_instance) {
      window.sketchup.place_furniture_instance(JSON.stringify({ furnitureInstanceId: furnitureInstanceId }));
    } else {
      delete pfPlacing[furnitureInstanceId];
      button.disabled = false;
      button.textContent = label;
      deps.showToast("error", "Colocar disponible sólo dentro de SketchUp.");
    }
  }

  // #469 — the shared placement tool activated (or refused host-side).
  // While the preview follows the cursor the entry point stays honest:
  // nothing is placed until the viewport click. Serves BOTH lanes: the
  // Project buttons above and the catalog entry point, whose repeat
  // state + re-arm live in js/granete-configurator.js (#848 C4.4).
  function handlePlacementPreviewStarted(result) {
    result = result || {};
    if (result.ok) {
      deps.showToast("info", window.GraneteUI.configurator.isRepeatPreviewActive()
        ? "Vista previa activa: hacé clic para colocar otro · Esc para terminar."
        : "Vista previa activa: hacé clic en el modelo para colocar · Esc para cancelar.");
      return;
    }
    window.GraneteUI.configurator.cancelRepeatPreview();
    var key = result.instanceId || result.definitionId;
    rearmPlaceButton(key);
    if (!result.instanceId) {
      // Catalog lane: re-arm the library insert entry point.
      window.GraneteUI.configurator.rearmInsertButton();
    }
    var message = pfPlaceFailureMessage(result);
    var diagnostic = document.getElementById("pf-placement-error");
    diagnostic.textContent = "No se pudo iniciar la colocación. " + message +
      "\nCódigo: " + (result.code || "unknown");
    diagnostic.style.display = "block";
    deps.showToast("error", message);
  }

  // #469 — Esc / tool switch: zero residue, the unit stays in its previous
  // panel state (pending for the unplaced lane #389, still missing for the
  // manual recovery lane #870 — no automatic restore, no fallback).
  function handlePlacementPreviewCancelled(result) {
    result = result || {};
    window.GraneteUI.configurator.cancelRepeatPreview();
    var key = result.instanceId || result.definitionId;
    var lane = placeEntryLane(key);
    rearmPlaceButton(key);
    if (!result.instanceId) {
      // Catalog lane: re-arm the library insert entry point.
      window.GraneteUI.configurator.rearmInsertButton();
    }
    deps.showToast("info", !result.instanceId ? "Colocación cancelada: no se insertó nada en el modelo."
      : lane === "missing"
        ? "Colocación cancelada: el mueble sigue faltando en este archivo."
        : "Colocación cancelada: el mueble sigue pendiente.");
  }

  function confirmPlacementInstance(furnitureInstanceId, button) {
    if (!furnitureInstanceId || pfConfirming[furnitureInstanceId]) return;
    pfConfirming[furnitureInstanceId] = button;
    button.disabled = true;
    button.textContent = "Sincronizando…";
    if (window.sketchup && window.sketchup.confirm_placement_instance) {
      window.sketchup.confirm_placement_instance(JSON.stringify({ furnitureInstanceId: furnitureInstanceId }));
    } else {
      delete pfConfirming[furnitureInstanceId];
      button.disabled = false;
      button.textContent = "Reintentar sincronización";
      deps.showToast("error", "Confirmar disponible sólo dentro de SketchUp.");
    }
  }

  function cancelPlacementInstance(furnitureInstanceId, button) {
    if (!furnitureInstanceId || pfCancelling[furnitureInstanceId]) return;
    pfCancelling[furnitureInstanceId] = button;
    button.disabled = true;
    button.textContent = "Cancelando…";
    if (window.sketchup && window.sketchup.cancel_placement_instance) {
      window.sketchup.cancel_placement_instance(JSON.stringify({ furnitureInstanceId: furnitureInstanceId }));
    } else {
      delete pfCancelling[furnitureInstanceId];
      button.disabled = false;
      button.textContent = "Cancelar";
      deps.showToast("error", "Cancelar disponible sólo dentro de SketchUp.");
    }
  }

  function restoreFurnitureInstance(furnitureInstanceId, button) {
    if (!furnitureInstanceId || pfRestoring[furnitureInstanceId] || pfPlacing[furnitureInstanceId]) return;
    pfRestoring[furnitureInstanceId] = button;
    button.disabled = true;
    button.textContent = "Restaurando…";
    if (window.sketchup && window.sketchup.restore_furniture_instance) {
      window.sketchup.restore_furniture_instance(JSON.stringify({ furnitureInstanceId: furnitureInstanceId }));
    } else {
      delete pfRestoring[furnitureInstanceId];
      button.disabled = false;
      button.textContent = "↶ Restaurar posición";
      deps.showToast("error", "Restaurar está disponible sólo dentro de SketchUp.");
    }
  }

  function handlePlaceFurnitureResult(result) {
    result = result || {};
    // One lane-aware re-arm serves every outcome (the entry carries its
    // own resting label): refusal, failure and the honest
    // pending_position intermediate all leave the entry point usable
    // again without waiting for the list refresh.
    rearmPlaceButton(result.instanceId);
    if (result.ok) {
      document.getElementById("pf-placement-error").style.display = "none";
      if (result.code === "already_placed") {
        deps.showToast("success", "Ese mueble ya está colocado: se seleccionó el existente.");
      } else if (result.code === "pending_position") {
        deps.showToast("info", "Mueble insertado, pero la sincronización de posición quedó pendiente.");
      } else {
        deps.showToast("success", "✓ Mueble colocado y sincronizado con el diseño.");
      }
      return;
    }
    var message = pfPlaceFailureMessage(result);
    var diagnostic = document.getElementById("pf-placement-error");
    diagnostic.textContent = "No se pudo colocar el mueble. " + message +
      "\nCódigo: " + (result.code || "unknown") +
      " · Mueble: " + (result.instanceId || "sin identificador");
    diagnostic.style.display = "block";
    deps.showToast("error", message);
  }

  function handleConfirmPlacementResult(result) {
    result = result || {};
    var button = pfConfirming[result.instanceId];
    delete pfConfirming[result.instanceId];
    if (result.ok) {
      deps.showToast("success", "✓ Posición sincronizada con el taller.");
      return;
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Reintentar sincronización";
    }
    deps.showToast("error", pfPlaceFailureMessage(result));
  }

  function handleCancelPlacementResult(result) {
    result = result || {};
    var button = pfCancelling[result.instanceId];
    delete pfCancelling[result.instanceId];
    if (result.ok) {
      deps.showToast("info", "Colocación cancelada.");
      return;
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Cancelar";
    }
    deps.showToast("error", result.reason || "No se pudo cancelar la colocación.");
  }

  function handleRestoreFurnitureResult(result) {
    result = result || {};
    var button = pfRestoring[result.instanceId];
    delete pfRestoring[result.instanceId];
    if (result.ok) {
      deps.showToast("success", result.restored === false ?
        "El mueble ya estaba restaurado y verificado." : "✓ Mueble restaurado en este archivo.");
      requestProjectFurniture();
      return;
    }
    if (button) {
      button.disabled = false;
      button.textContent = "↶ Restaurar posición";
    }
    deps.showToast("error", pfPlaceFailureMessage(result));
  }

  // handleCreateProjectFurnitureResult — the result of the insert
  // button's legacy connected fallback — lives in
  // js/granete-configurator.js (#848 C4.4); GraneteDialog delegates.

  function pfPlaceFailureMessage(result) {
    switch (result.code) {
      case "created_pending": return result.reason || "El mueble se creó en el proyecto pero falló la colocación local; colocálo desde la pestaña Proyecto.";
      case "unbound": return "Conectá el modelo al proyecto primero.";
      case "stale_base": return "El diseño avanzó en el servidor: actualizá la base de trabajo en la tarjeta Modelo / Diseño.";
      case "not_found": return "El mueble no pertenece al proyecto conectado.";
      case "terminal": return "El mueble fue eliminado del proyecto.";
      case "duplicate_detected": return "Hay copias duplicadas del mismo mueble en el modelo; resolvé los duplicados antes.";
      case "already_placed": return "El mueble ya está colocado.";
      case "not_placed": return "El mueble no está en el modelo; colocálo primero.";
      case "intent_mismatch": return "La identidad del mueble en el modelo no coincide; colocálo de nuevo.";
      case "definition_unavailable": return "El catálogo del taller no incluye la definición de este mueble.";
      case "resolution_failed": return result.reason || "Granete no pudo resolver la composición del mueble.";
      case "service_error": return result.reason || "Error de comunicación con el servidor.";
      case "bad_contract": return result.reason || "Error de contrato con el servidor.";
      case "no_model": return "No hay un modelo activo en SketchUp.";
      case "placement_failed": return result.reason || "La colocación falló.";
      case "action_in_progress": return "La restauración de este mueble ya está en curso.";
      case "preview_busy": return result.reason || "Ya hay una colocación en curso; terminála con un clic o con Esc.";
      case "preview_unavailable": return result.reason || "La vista previa no está disponible para este mueble.";
      case "activation_failed": return result.reason || "No se pudo activar la herramienta de colocación.";
      case "auth_context_unavailable": return result.reason || "No se pudo confirmar la sesión; reintentá la colocación.";
      case "composition_changed": return result.reason || "La composición del mueble cambió desde la vista previa; generála de nuevo.";
      case "working_copy_changed":
      case "authority_changed":
      case "binding_changed":
      case "context_changed": return result.reason || "El modelo o el diseño cambió; actualizá y reintentá.";
      case "invalid_transform": return result.reason || "La posición guardada no es válida.";
      case "recovery_blocked": return result.reason || "La restauración está bloqueada.";
      case "host_readback_failed": return result.reason || "No se pudo verificar la restauración.";
      case "sync_failed": return result.reason || "El diseño no se pudo actualizar.";
      default: return result.reason || "No se pudo colocar el mueble.";
    }
  }

  btnPfRefresh.addEventListener("click", function () {
    btnPfRefresh.disabled = true;
    requestProjectFurniture();
    setTimeout(function () { btnPfRefresh.disabled = false; }, 500);
  });
  btnPfRetry.addEventListener("click", requestProjectFurniture);
  btnDesignSync.addEventListener("click", function () { synchronizeDesign(); });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("granete-mutation-state", function (event) {
      var phase = event && event.detail && event.detail.phase;
      if (["editing_intent", "resolving", "applying_host_mutation"].indexOf(phase) !== -1) {
        cancelDebouncedSync();
        return;
      }
      if (phase === "committed") {
        scheduleDebouncedSync();
      }
    });
  }
  // No pre-render: the panel loads when the tab first becomes visible
  // (all state cards start hidden in the markup).

  window.GraneteUI.projectFurniture = {
    init: function (injected) {
      deps = injected || {};
    },
    // Dialog seam: the Proyecto tab became visible. The exact historical
    // condition (lastPfState === null → first load requests the rows)
    // moved here with its state (#389: rows load when the tab becomes
    // visible and refresh on model switches / after placing).
    onProjectTabVisible: function () {
      if (lastPfState === null) requestProjectFurniture();
    },
    // Model binding seam (#848 C4.8 → C4.9): every binding status render
    // invalidates the PF rows so the next visit to the Proyecto tab
    // reloads them. Dep-free by contract: a pure state write, the exact
    // historical `lastPfState = null` semantic (like modelBinding's
    // isConnected accessor).
    invalidate: function () {
      cancelDebouncedSync();
      lastPfState = null;
      lastDesignSyncOutcome = null;
    },
    // Configurator seam (#848 C4.4 dep): the legacy connected create
    // fallback reloads the panel through the module API.
    requestProjectFurniture: function () { requireDeps(); requestProjectFurniture(); },
    renderProjectFurniture: function (payload) { requireDeps(); renderProjectFurniture(payload); },
    handlePlaceFurnitureResult: function (result) { requireDeps(); handlePlaceFurnitureResult(result); },
    handlePlacementPreviewStarted: function (result) { requireDeps(); handlePlacementPreviewStarted(result); },
    handlePlacementPreviewCancelled: function (result) { requireDeps(); handlePlacementPreviewCancelled(result); },
    handleConfirmPlacementResult: function (result) { requireDeps(); handleConfirmPlacementResult(result); },
    handleCancelPlacementResult: function (result) { requireDeps(); handleCancelPlacementResult(result); },
    handleRestoreFurnitureResult: function (result) { requireDeps(); handleRestoreFurnitureResult(result); },
    handleSynchronizeDesignResult: function (result) { requireDeps(); handleSynchronizeDesignResult(result); },
    renderHostSaveAwareness: function (payload) { requireDeps(); renderHostSaveAwareness(payload); },
    pfPlaceFailureMessage: function (result) { return pfPlaceFailureMessage(result); },
    synchronizeDesign: function (options) { requireDeps(); synchronizeDesign(options); },
    scheduleDebouncedSync: function (delayMs) { requireDeps(); scheduleDebouncedSync(delayMs); },
    cancelDebouncedSync: function () { cancelDebouncedSync(); }
  };
})();
