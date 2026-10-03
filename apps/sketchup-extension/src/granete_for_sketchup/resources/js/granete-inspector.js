// #848 Phase B C4.7 — inspector module (boundary-adjusted split).
// Owns:
// - the Inspector UI working selection context (selectedContext: the
//   dialog's working copy of the SelectionContext the Ruby resolver
//   publishes; the shared runtime truth stays in GraneteState/GraneteMutation)
// - top-level Inspector routing by kind (null/unmanaged/furniture/child
//   dispatch) and the furniture Inspector rendering
// - the Inspector parameter/material working snapshots (inspectorParams,
//   inspectorMaterialChoices) and the capability-driven Inspector actions
//   (delete, material-choice routing)
// - #784 R3b: the furniture edit DRAFT — param edits and material picks
//   accumulate locally against a confirmed base (confirmedBase, the render
//   anchor of the same spirit as R2's draftBase); the footer counts the
//   honest pending changes and ONE [Aplicar] emits ONE mutation with the
//   complete intent (parameters + materialChoices + materialChoiceModes:
//   override for picks, design only for restores). [Descartar] is
//   read-only. The draft dies on a real selection change, a real binding
//   change (#906 spirit) and every fail-closed lane; a failed Apply
//   preserves it with an honest message.
// - Inspector bridge result handling (onUpdateResult/onDeleteResult) and
//   the hardware catalog slice (catalogHardware: the Inspector hardware
//   view is its only renderer; setCatalog object branch updates it, the
//   historical array-payload non-reset quirk is preserved)
// - manufacturing/preflight card visibility
//
// Delegates:
// - the CHILD surface (part/hardware/aggregate rendering, breadcrumb,
//   #467 part authoring and #468 hardware placement/substitution) lives
//   in js/granete-inspector-child.js under window.GraneteUI.inspectorChild
//   (owner-approved responsibility split: this file measured 965 lines
//   against the #848 ~800 hard target). Routing passes the SAME context
//   object by reference; this module keeps the sole selectedContext
//   authority.
//
// Consumes:
// - window.GraneteUI.library (findDefinitionById fallback),
//   window.GraneteUI.materialRoles (defaultMaterialChoices,
//   renderMaterialSelectors, materialById, setProjectDefaultMaterial) and
//   window.GraneteUI.configurator (hasActiveDefinition,
//   applyMaterialChoice) — call-time references, no second catalog copy
// - window.GraneteUI.inspectorChild (render/hide) — call-time routing
// - window.GraneteMutation (#498: publishSelection + managed update),
//   window.GraneteState (mutation issues), window.GraneteManufacturing /
//   window.GranetePreflightReview — call-time only (those runtime modules
//   load after this one)
// - injected shared helpers via init(): icon, showToast, switchTab,
//   getDefaultParams, renderParamForm, estimatedPartsLabel,
//   parameterIssueMessage, capabilityEnabled (single implementations in
//   dialog.html; the capability check is shared with the child module)
// - window.sketchup bridge callbacks; window.GraneteDialog result
//   wrappers for the no-host fallbacks
//
// Does NOT own:
// - the child (part/hardware/aggregate) Inspector surface — delegated to
//   GraneteUI.inspectorChild, which keeps no second selection copy
// - backend/business selection truth (the Ruby resolver publishes the
//   SelectionContext) nor FurnitureInstance business identity
// - the material catalog or the furniture definition catalog
// - the mutation state machine; manufacturing/preflight computation
// - Model Binding, Project Furniture
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.inspector) return;

  var catalogHardware = [];

  // Central selection state (#476): the SelectionContext payload published
  // by the Ruby resolver — one model for every kind
  // (furniture/aggregate/part/hardware/unmanaged) — consumed by the
  // inspector and downstream excellence features.
  var selectedContext = null;
  var inspectorDef = null;
  var inspectorMaterialChoices = {};
  var inspectorParams = {};

  // #784 R3b: the local pending draft. `params`/`choices` carry the edited
  // values, `modes` only the explicit restore lineage markers (role →
  // "design"); `base` is the confirmed snapshot the edits are anchored to
  // and `instanceRef` the item the draft belongs to. `confirmedBase` is the
  // same anchor kept fresh by every render/success so a new draft never
  // pins stale values. `applyInFlight` is the one-Apply-one-request guard;
  // `bindingIdentity` implements the #906 rule: only a REAL binding change
  // invalidates.
  var draft = null;
  var confirmedBase = { parameters: {}, materialChoices: {} };
  var applyInFlight = false;
  var bindingIdentity = null;

  // Injected by the dialog bootstrap before any render: shared helpers
  // stay single-implementation in dialog.html (the param/summary/toast/
  // icon/tab/capability helpers are shared with the Configurator and the
  // child Inspector module).
  var deps = {};

  function requireDeps() {
    var missing = ["icon", "showToast", "switchTab", "getDefaultParams",
      "renderParamForm", "estimatedPartsLabel", "parameterIssueMessage",
      "capabilityEnabled"].filter(function (name) {
        return typeof deps[name] !== "function";
      });
    if (missing.length > 0) {
      throw new Error("GraneteUI.inspector.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  // Inspector elements
  var inspectorEmpty = document.getElementById("inspector-empty-state");
  var inspectorActive = document.getElementById("inspector-active-view");
  var inspectorUnmanaged = document.getElementById("inspector-unmanaged-view");
  var inspectorMultiNote = document.getElementById("inspector-multi-note");
  var inspectorBatchView = document.getElementById("inspector-batch-view");
  var inspectorBatchTitle = document.getElementById("inspector-batch-title");
  var inspectorBatchCountBadge = document.getElementById("inspector-batch-count-badge");
  var inspectorBatchSummary = document.getElementById("inspector-batch-summary");
  var inspectorBatchExcluded = document.getElementById("inspector-batch-excluded");
  var inspectorBatchRolesCard = document.getElementById("inspector-batch-roles-card");
  var inspectorBatchRoles = document.getElementById("inspector-batch-roles");
  var inspectorBatchParamsCard = document.getElementById("inspector-batch-params-card");
  var inspectorBatchParams = document.getElementById("inspector-batch-params");
  var inspectorName = document.getElementById("inspector-furniture-name");
  var inspectorRepresentationWarning = document.getElementById("inspector-representation-warning");
  var inspectorEditBlocker = document.getElementById("inspector-edit-blocker");
  var inspectorEditBlockerReason = document.getElementById("inspector-edit-blocker-reason");
  var inspectorParamsCard = document.getElementById("inspector-params-card");
  var inspectorEditFieldset = document.getElementById("inspector-edit-fieldset");
  var inspectorInteractiveBadge = document.getElementById("inspector-interactive-badge");
  var inspectorManufacturingBadge = document.getElementById("inspector-manufacturing-badge");
  var inspectorParamsContainer = document.getElementById("inspector-params-container");
  var inspectorMaterialsCard = document.getElementById("inspector-materials-card");
  var inspectorMaterialsContainer = document.getElementById("inspector-materials-container");
  // #529: card Apertura y Accesorios (solo definiciones con doorSwing).
  var inspectorOpeningAccessoriesCard = document.getElementById("inspector-opening-accessories-card");
  var inspectorOpeningAccessoriesContainer = document.getElementById("inspector-opening-accessories-container");
  var openingAccessoriesSummary = document.getElementById("opening-accessories-summary");
  var openingCountBadge = document.getElementById("opening-count-badge");
  var inspectorSummaryDims = document.getElementById("inspector-summary-dims");
  var inspectorSummaryParts = document.getElementById("inspector-summary-parts");
  // #784 R3b: the draft footer (pending count + Descartar + Aplicar) lives
  // inside the mutation fieldset — the native fail-closed switch covers it.
  var inspectorFooter = document.getElementById("inspector-footer");
  var inspectorPending = document.getElementById("inspector-pending");
  var btnDiscard = document.getElementById("btn-discard");
  var btnApply = document.getElementById("btn-apply");
  var btnDelete = document.getElementById("btn-delete");
  var inspectorDeleteBlocker = document.getElementById("inspector-delete-blocker");

  function validateInteractiveClient(def, currentValues) {
    if (!def || !def.parameters) return;
    var valid = true;
    for (var i = 0; i < def.parameters.length; i++) {
      var p = def.parameters[i];
      var v = Number(currentValues[p.name]);
      if (p.type === "number") {
        if (p.min !== undefined && v < p.min) valid = false;
        if (p.max !== undefined && v > p.max) valid = false;
      }
    }

    if (valid) {
      inspectorInteractiveBadge.textContent = "✓ Parámetros válidos";
      inspectorInteractiveBadge.className = "status-badge valid";
    } else {
      inspectorInteractiveBadge.textContent = "Parámetro fuera de rango";
      inspectorInteractiveBadge.className = "status-badge invalid";
    }
  }

  function updateInspectorSummary() {
    var w = inspectorParams.widthMm || inspectorParams.lengthMm || 600;
    var h = inspectorParams.heightMm || 720;
    var d = inspectorParams.depthMm || 590;
    inspectorSummaryDims.textContent = w + " × " + h + " × " + d + " mm";
    inspectorSummaryParts.textContent = deps.estimatedPartsLabel(inspectorDef, inspectorParams);
  }

  // ------------------------------------------------------------------
  // #784 R3b — the furniture edit draft. Local-only: nothing touches the
  // host or the backend while the user drafts. One [Aplicar] emits ONE
  // mutation with the complete intent; [Descartar] is read-only.
  // ------------------------------------------------------------------

  function copyMap(map) {
    var copy = {};
    for (var key in (map || {})) copy[key] = map[key];
    return copy;
  }

  function sameMap(a, b) {
    a = a || {};
    b = b || {};
    var keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (var i = 0; i < keys.length; i++) {
      if (a[keys[i]] !== b[keys[i]]) return false;
    }
    return true;
  }

  // Native fail-closed gating of the mutation controls (#476): the same
  // rule that disables the fieldset disables the footer buttons.
  function mutationGating() {
    var multi = selectedContext && selectedContext.selectionCount &&
      selectedContext.selectionCount > 1;
    var canEdit = selectedContext && deps.capabilityEnabled(selectedContext, "canEditParameters");
    return Boolean(multi || !canEdit);
  }

  // Honest pending count: a param/choice entry dissolves back to its base
  // value; a restore entry (explicit mode=design statement) always counts —
  // it is a lineage correction even when the value coincides.
  function draftPendingCount() {
    if (!draft) return 0;
    var pending = 0;
    for (var name in draft.params) {
      if (draft.params[name] !== draft.base.parameters[name]) pending += 1;
    }
    for (var role in draft.choices) {
      if (draft.modes[role]) {
        pending += 1;
      } else if (draft.choices[role] !== draft.base.materialChoices[role]) {
        pending += 1;
      }
    }
    return pending;
  }

  function ensureDraft() {
    if (draft) return;
    draft = {
      instanceRef: selectedContext ? selectedContext.furnitureInstanceRef : null,
      base: {
        parameters: copyMap(confirmedBase.parameters),
        materialChoices: copyMap(confirmedBase.materialChoices)
      },
      params: {},
      choices: {},
      modes: {}
    };
  }

  function updateInspectorFooter() {
    if (!inspectorFooter) return;
    var pending = draftPendingCount();
    if (pending === 0) {
      // The draft dissolved back to the confirmed state: drop it entirely.
      draft = null;
      inspectorFooter.style.display = "none";
      btnApply.disabled = mutationGating();
      return;
    }
    inspectorFooter.style.display = "block";
    inspectorPending.textContent =
      pending === 1 ? "1 cambio pendiente" : pending + " cambios pendientes";
    var busy = applyInFlight ||
      (window.GraneteMutation && typeof window.GraneteMutation.phase === "function" &&
       window.GraneteMutation.phase() === "applying_host_mutation");
    btnApply.disabled = busy || mutationGating();
    btnDiscard.disabled = applyInFlight;
  }

  function recordParamEdit(name, val) {
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (selectedContext.selectionCount && selectedContext.selectionCount > 1) return;
    if (!deps.capabilityEnabled(selectedContext, "canEditParameters")) return;
    ensureDraft();
    draft.params[name] = val;
    updateInspectorFooter();
  }

  // An explicit material pick is an override in the making; it supersedes
  // any restore marker of the same role (the last action wins).
  function recordMaterialPick(role, id) {
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (selectedContext.selectionCount && selectedContext.selectionCount > 1) return;
    if (!deps.capabilityEnabled(selectedContext, "canEditMaterialRoles")) return;
    ensureDraft();
    draft.choices[role] = id;
    delete draft.modes[role];
    updateInspectorFooter();
  }

  // R3 restore semantics, now inside the draft: the CURRENT design default
  // is materialized as a value plus the explicit design lineage statement.
  function recordRoleRestore(role, designDefaultId) {
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (selectedContext.selectionCount && selectedContext.selectionCount > 1) return;
    if (!deps.capabilityEnabled(selectedContext, "canEditMaterialRoles")) return;
    ensureDraft();
    draft.choices[role] = designDefaultId;
    draft.modes[role] = "design";
    updateInspectorFooter();
  }

  function paramChangeHandler() {
    return function (name, val, unit) {
      inspectorParams[name] = val;
      recordParamEdit(name, val);
      updateInspectorSummary();
      validateInteractiveClient(inspectorDef, inspectorParams);
      // #529: doorSwing / doorCount / doorComponentId / joinerySystemId pueden
      // cambiar la agrupación de la card Apertura y Accesorios (labels de
      // apertura, badges de derivado, recuento de puertas). Repintado local
      // sin tocar los snapshots confirmados: no aplicamos, solo mostramos.
      if (name === "doorSwing" || name === "doorCount" || name === "doorComponentId" ||
          name === "joinerySystemId" || name === "drawerSlideId" || name === "handleComponentId") {
        renderOpeningAccessoriesCard(selectedContext, inspectorParams);
      }
    };
  }

  // ------------------------------------------------------------------
  // #529 — Apertura y Accesorios (SketchUp Inspector).
  //
  // Pure presentation grouping layer. Backend authority remains in
  // authoring-resolve (Go), which is the single source of truth for
  // anchorFace, offsetMm and machining. This card never fabricates
  // manufacturing facts.
  //
  // Data sources, in descending preference (fail-open is hidden card):
  //   1. context.doorAccessories[] — published by Ruby bridge from the
  //      authoring-snapshot doorAffinity groupings.
  //   2. FALLBACK local derivation from def.parameters + selected params:
  //      useful while authoring-resolve is rolled out and to give an
  //      honest interactive preview even before Apply is clicked.
  // ------------------------------------------------------------------

  var FACE_LABELS = { front: "Frente", back: "Contrafrente",
                      left: "Izquierda", right: "Derecha",
                      top: "Arriba", bottom: "Abajo" };

  function roleLabel(role) {
    if (role === "hinge") return "Bisagra";
    if (role === "handle") return "Jaladera";
    return "Herraje";
  }

  function swingLabel(side) {
    if (side === "left") return "Izquierda";
    if (side === "right") return "Derecha";
    return side || "—";
  }

  function resolveSwingForDoor(doorIndex, doorCount, doorSwing) {
    var swing = doorSwing === "right" || doorSwing === "left" ? doorSwing : null;
    if (doorSwing === "pair" && doorCount >= 2) {
      swing = doorIndex === 0 ? "left" : "right";
    }
    if (!swing) swing = doorIndex === 0 ? "left" : "right";
    return swing;
  }

  function hasDoorSwingParameter(def) {
    if (!def || !def.parameters || !def.parameters.length) return false;
    for (var i = 0; i < def.parameters.length; i++) {
      if (def.parameters[i].name === "doorSwing") return true;
    }
    return false;
  }

  function buildFallbackDoorAccessories(def, params) {
    if (!hasDoorSwingParameter(def)) return null;
    var doorCount = Number(params.doorCount);
    if (!doorCount || doorCount < 1) doorCount = 1;
    var doorSwing = params.doorSwing || "left";
    var doors = [];
    for (var i = 0; i < doorCount; i++) {
      var side = resolveSwingForDoor(i, doorCount, doorSwing);
      doors.push({
        doorSlotIndex: i,
        doorLabel: "Puerta " + (i + 1) + " · " + (side === "left" ? "Izquierda" : "Derecha"),
        swingSide: side,
        hingeFace: side,              // bisagra = lado del eje
        handleFace: side === "left" ? "right" : "left", // jaladera = lado opuesto
        hinges: [],
        handles: []
      });
    }
    return doors;
  }

  function hardwareDisplayName(hw, fallbackIndex, role) {
    if (hw && hw.displayName) return hw.displayName;
    if (hw && hw.hardwareName) return hw.hardwareName;
    if (hw && hw.hardwareCode) return hw.hardwareCode;
    return roleLabel(role) + " " + (Number(fallbackIndex) + 1);
  }

  function formatOffset(hw) {
    if (!hw) return "—";
    var pos = hw.relativePosition || hw.offsetMm || hw.position || {};
    var x = pos.xMm !== undefined ? pos.xMm : (pos.x !== undefined ? pos.x : null);
    var y = pos.yMm !== undefined ? pos.yMm : (pos.y !== undefined ? pos.y : null);
    if (x === null && y === null) return "—";
    var parts = [];
    if (x !== null) parts.push("X: " + x + " mm");
    if (y !== null) parts.push("Y: " + y + " mm");
    return parts.join("  ·  ");
  }

  function provenanceClass(kind) {
    if (kind === "derived" || kind === "opening-derived") return "neutral";
    if (kind === "manual") return "valid";
    return "pending";
  }

  function provenanceLabel(kind, role) {
    if (kind === "opening-derived" ||
        (kind === "derived" && (role === "hinge" || role === "handle"))) {
      return "Derivado · Apertura";
    }
    if (kind === "derived") return "Derivado";
    if (kind === "manual") return "Manual";
    return kind ? kind : "—";
  }

  function renderAccessoryRow(container, acc, role, fallbackIndex, provenanceKind, doorSlotIndex) {
    var row = document.createElement("div");
    row.className = "door-accessory-row";

    var left = document.createElement("div");
    left.className = "door-accessory-left";

    var titleLine = document.createElement("div");
    titleLine.className = "door-accessory-title-row";

    var ordinal = document.createElement("span");
    ordinal.className = "subhead door-accessory-ordinal";
    ordinal.textContent = String(Number(fallbackIndex) + 1).padStart(2, "0");
    titleLine.appendChild(ordinal);

    var name = document.createElement("span");
    name.className = "door-accessory-name";
    name.textContent = hardwareDisplayName(acc, fallbackIndex, role);
    titleLine.appendChild(name);

    var prov = document.createElement("span");
    prov.className = "status-badge " + provenanceClass(provenanceKind);
    prov.style.marginLeft = "auto";
    prov.style.fontSize = "var(--text-xs)";
    prov.textContent = provenanceLabel(provenanceKind, role);
    titleLine.appendChild(prov);

    left.appendChild(titleLine);

    var metaLine = document.createElement("div");
    metaLine.className = "subhead door-accessory-meta";
    var face = (acc && (acc.anchorFace || acc.face)) || (role === "hinge" ? acc && acc.anchorFace : acc && acc.anchorFace) || "—";
    var faceDisplay = FACE_LABELS[face] || face;
    metaLine.textContent = "Cara: " + faceDisplay + "  ·  " + formatOffset(acc);
    left.appendChild(metaLine);

    row.appendChild(left);

    var right = document.createElement("div");
    right.className = "door-accessory-right";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Ir al herraje";
    var targetId = (acc && (acc.hardwarePlacementId || acc.id || acc.placementId)) || null;
    btn.addEventListener("click", function () {
      if (targetId && window.GraneteUI && window.GraneteUI.inspectorChild &&
          typeof window.GraneteUI.inspectorChild.navigateToHardware === "function") {
        window.GraneteUI.inspectorChild.navigateToHardware(targetId);
      } else if (targetId && window.sketchup && typeof window.sketchup.select_hardware === "function") {
        window.sketchup.select_hardware(targetId, doorSlotIndex !== undefined ? String(doorSlotIndex) : null);
      } else {
        deps.showToast("info", "Navegación a herraje: selector Ruby/Bridge no disponible todavía.");
      }
    });
    right.appendChild(btn);
    row.appendChild(right);

    container.appendChild(row);
  }

  function renderOpeningAccessoriesCard(context, overrideParams) {
    if (!inspectorOpeningAccessoriesCard) return;
    var ctx = context || selectedContext;
    if (!ctx) { inspectorOpeningAccessoriesCard.style.display = "none"; return; }
    var def = inspectorDef || ctx.definition ||
      (window.GraneteUI && window.GraneteUI.library ?
        window.GraneteUI.library.findDefinitionById(ctx.furnitureDefinitionId) : null);
    var params = overrideParams || inspectorParams || (ctx.parameters || {});

    // Gate: mostramos la card SOLO si la definición tiene el parámetro
    // doorSwing o el contexto publicó doorAccessories.
    var hasExplicit = Array.isArray(ctx.doorAccessories) && ctx.doorAccessories.length > 0;
    if (!hasExplicit && !hasDoorSwingParameter(def)) {
      inspectorOpeningAccessoriesCard.style.display = "none";
      inspectorOpeningAccessoriesContainer.innerHTML = "";
      return;
    }

    inspectorOpeningAccessoriesCard.style.display = "block";
    inspectorOpeningAccessoriesContainer.innerHTML = "";

    var doors = hasExplicit ? ctx.doorAccessories : buildFallbackDoorAccessories(def, params);
    var totalHinges = 0;
    var totalHandles = 0;
    if (doors) {
      for (var di = 0; di < doors.length; di++) {
        totalHinges += (doors[di].hinges ? doors[di].hinges.length : 0);
        totalHandles += (doors[di].handles ? doors[di].handles.length : 0);
      }
    }

    if (openingCountBadge) {
      var doorCount = doors ? doors.length : 0;
      openingCountBadge.style.display = doorCount ? "inline-flex" : "none";
      if (doorCount) {
        openingCountBadge.textContent =
          doorCount + " puert" + (doorCount === 1 ? "a" : "as") +
          (totalHinges ? " · " + totalHinges + " bisagras" : "") +
          (totalHandles ? " · " + totalHandles + " jaladera" + (totalHandles === 1 ? "" : "s") : "");
        openingCountBadge.className = "status-badge neutral";
      }
    }

    if (!doors || doors.length === 0) {
      if (openingAccessoriesSummary) {
        openingAccessoriesSummary.textContent =
          "No hay puertas para esta combinación. Modifique la cantidad de puertas para ver sus accesorios.";
      }
      return;
    }
    if (openingAccessoriesSummary) {
      openingAccessoriesSummary.textContent =
        hasExplicit
          ? "Los herrajes marcados \"Derivado · Apertura\" se recalculan al cambiar la apertura. Los manuales se conservan."
          : "Previsualización de apertura y accesorios (se materializan al hacer clic en Aplicar).";
    }

    for (var i = 0; i < doors.length; i++) {
      var d = doors[i];
      var doorCard = document.createElement("div");
      doorCard.className = "door-group-card";

      var header = document.createElement("div");
      header.className = "door-group-header";
      var title = document.createElement("span");
      title.className = "door-group-title";
      title.textContent = d.doorLabel || ("Puerta " + (i + 1));
      header.appendChild(title);
      var swingBadge = document.createElement("span");
      var badgeSide = d.swingSide === "right" ? "warning" : "info";
      swingBadge.className = "status-badge " + badgeSide;
      swingBadge.style.marginLeft = "auto";
      swingBadge.textContent = "Abre: " + swingLabel(d.swingSide);
      header.appendChild(swingBadge);
      doorCard.appendChild(header);

      var group = document.createElement("div");
      group.className = "door-accessory-group";

      var hingesLabel = document.createElement("div");
      hingesLabel.className = "door-accessory-section-label";
      hingesLabel.textContent =
        "Bisagras (" + (d.hinges ? d.hinges.length : 0) + ") · " +
        "Cara eje: " + (FACE_LABELS[d.hingeFace] || d.hingeFace || "—");
      group.appendChild(hingesLabel);

      if (d.hinges && d.hinges.length) {
        for (var hi = 0; hi < d.hinges.length; hi++) {
          var hAcc = d.hinges[hi];
          renderAccessoryRow(group, hAcc, "hinge", hi,
            (hAcc && (hAcc.placementKind || hAcc.kind)) || (hasExplicit ? "opening-derived" : "derived"),
            d.doorSlotIndex !== undefined ? d.doorSlotIndex : i);
        }
      } else {
        var emptyH = document.createElement("div");
        emptyH.className = "subhead door-accessory-empty";
        emptyH.textContent = "Sin bisagras para esta puerta.";
        group.appendChild(emptyH);
      }

      var sep = document.createElement("div");
      sep.className = "door-accessory-sep";
      group.appendChild(sep);

      var handlesLabel = document.createElement("div");
      handlesLabel.className = "door-accessory-section-label";
      handlesLabel.textContent =
        "Jaladeras (" + (d.handles ? d.handles.length : 0) + ") · " +
        "Cara: " + (FACE_LABELS[d.handleFace] || d.handleFace || "—");
      group.appendChild(handlesLabel);

      if (d.handles && d.handles.length) {
        for (var jai = 0; jai < d.handles.length; jai++) {
          renderAccessoryRow(group, d.handles[jai], "handle", jai,
            (d.handles[jai] && (d.handles[jai].placementKind || d.handles[jai].kind)) || (hasExplicit ? "opening-derived" : "derived"),
            d.doorSlotIndex !== undefined ? d.doorSlotIndex : i);
        }
      } else {
        var emptyJ = document.createElement("div");
        emptyJ.className = "subhead door-accessory-empty";
        emptyJ.textContent = "Sin jaladera para esta puerta.";
        group.appendChild(emptyJ);
      }

      doorCard.appendChild(group);
      inspectorOpeningAccessoriesContainer.appendChild(doorCard);
    }

    if (!hasExplicit) {
      var foot = document.createElement("div");
      foot.className = "subhead door-accessory-footer-note";
      foot.textContent = "💡 Los diseños de bisagras y jaladeras se seleccionan desde la tarjeta \"Herraje\" en cada puerta o desde el catálogo de perfiles.";
      inspectorOpeningAccessoriesContainer.appendChild(foot);
    }
  }

  function renderInspectorMaterialSelectors() {
    window.GraneteUI.materialRoles.renderMaterialSelectors(inspectorMaterialsCard, inspectorMaterialsContainer, inspectorDef,
      inspectorMaterialChoices, function (role, id, scope) {
        if (scope === "project" || scope === "project_default") {
          window.GraneteUI.materialRoles.setProjectDefaultMaterial(role, id);
        }
        inspectorMaterialChoices[role] = id;
        recordMaterialPick(role, id);
      }, { context: "inspector", instanceId: selectedContext ? selectedContext.furnitureInstanceRef : null,
           definitionId: selectedContext ? selectedContext.furnitureDefinitionId : null });
  }

  // Repaints the working snapshots from the CONFIRMED context (never from
  // a draft) and re-anchors confirmedBase — used by Descartar and by every
  // honest draft invalidation.
  function repaintConfirmedSnapshots() {
    if (!selectedContext || selectedContext.kind !== "furniture" || !inspectorDef ||
        !deps.capabilityEnabled(selectedContext, "canEditParameters")) return;
    inspectorParams = Object.assign({}, deps.getDefaultParams(inspectorDef), selectedContext.parameters || {});
    inspectorMaterialChoices = Object.assign({},
      window.GraneteUI.materialRoles.defaultMaterialChoices(inspectorDef), selectedContext.materialChoices || {});
    confirmedBase = { parameters: copyMap(inspectorParams), materialChoices: copyMap(inspectorMaterialChoices) };
    deps.renderParamForm(inspectorParamsContainer, inspectorDef, inspectorParams, paramChangeHandler());
    if (deps.capabilityEnabled(selectedContext, "canEditMaterialRoles")) {
      renderInspectorMaterialSelectors();
    }
    // #529: repintar Apertura y Accesorios desde el contexto confirmado.
    renderOpeningAccessoriesCard(selectedContext, inspectorParams);
    updateInspectorSummary();
  }

  // [Descartar]: read-only — clears the LOCAL draft and repaints the
  // confirmed values. Zero mutations of any kind.
  function discardDraft() {
    if (applyInFlight) return;
    draft = null;
    repaintConfirmedSnapshots();
    updateInspectorFooter();
  }

  // [Aplicar]: the ONE mutation of the whole draft. The intent carries the
  // full working snapshots plus the explicit lineage statements (override
  // for picks, design for restores; roles untouched by the draft are never
  // mentioned). Guards: in-flight, capability, multi-selection, empty
  // draft. A busy controller preserves the draft and says so.
  function applyDraft() {
    if (applyInFlight) return; // one user Apply = exactly one request
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (selectedContext.selectionCount && selectedContext.selectionCount > 1) return;
    if (!deps.capabilityEnabled(selectedContext, "canEditParameters")) return;
    if (draftPendingCount() === 0) return;
    var payload = {
      instanceId: selectedContext.furnitureInstanceRef,
      definitionId: selectedContext.furnitureDefinitionId,
      parameters: copyMap(inspectorParams),
      materialChoices: copyMap(inspectorMaterialChoices)
    };
    var modes = {};
    for (var role in draft.choices) {
      if (draft.modes[role]) {
        modes[role] = draft.modes[role];
      } else if (draft.choices[role] !== draft.base.materialChoices[role]) {
        modes[role] = "override";
      }
    }
    if (Object.keys(modes).length > 0) payload.materialChoiceModes = modes;
    appliedRef = selectedContext.furnitureInstanceRef;
    applyInFlight = true;
    btnApply.disabled = true;
    btnApply.innerHTML = deps.icon("clock") + "<span>Aplicando…</span>";
    btnDiscard.disabled = true;
    var submitted = "unavailable";
    if (window.GraneteMutation) {
      submitted = window.GraneteMutation.submitUpdate(payload, selectedContext);
    }
    if (submitted === "busy") {
      applyInFlight = false;
      btnApply.innerHTML = deps.icon("save") + "<span>Aplicar</span>";
      btnDiscard.disabled = false;
      updateInspectorFooter();
      deps.showToast("error", "Ya hay una mutación en curso.");
      return;
    }
    if (submitted === "unavailable") {
      if (window.sketchup && window.sketchup.update_furniture) {
        window.sketchup.update_furniture(JSON.stringify(payload));
      } else {
        setTimeout(function () {
          window.GraneteDialog.onUpdateResult({ success: true, name: selectedContext.display ? selectedContext.display.name : "" });
        }, 500);
      }
    }
  }

  // The identity the in-flight Apply was built for: a selection switch
  // while the mutation flies must never stamp the result onto the new
  // item's context.
  var appliedRef = null;

  // ------------------------------------------------------------------
  // Contextual inspector (#476): renders the canonical SelectionContext
  // by kind. Legality comes exclusively from the Ruby capability set —
  // the client never infers it from names, slot ids or entity types.
  // ------------------------------------------------------------------

  function hideInspectorViews() {
    inspectorEmpty.style.display = "none";
    // #784 R1: the Design Inspector leaves the lane with every non-null
    // selection, exactly like the other views.
    if (window.GraneteUI.designInspector) window.GraneteUI.designInspector.hide();
    inspectorUnmanaged.style.display = "none";
    inspectorActive.style.display = "none";
    inspectorBatchView.style.display = "none";
    // The child view (part/hardware/aggregate) and its context reference
    // belong to the child module: it leaves the lane here on every
    // top-level re-render.
    window.GraneteUI.inspectorChild.hide();
    inspectorMultiNote.style.display = "none";
  }

  function renderInspector() {
    var context = selectedContext;
    hideInspectorViews();

    if (!context) {
      // #784 R1: no selection + bound Design → the Design Inspector owns
      // the lane (durable authoring defaults, read-only). Unbound keeps
      // the legacy empty state.
      var designInspector = window.GraneteUI.designInspector;
      if (designInspector && designInspector.handleNoSelection()) {
        renderManufacturingCard(null);
        return;
      }
      inspectorEmpty.style.display = "block";
      renderManufacturingCard(null);
      return;
    }

    if (context.kind === "batch") {
      renderBatchInspector(context);
      renderManufacturingCard(null);
      return;
    }

    if (context.selectionCount && context.selectionCount > 1) {
      inspectorMultiNote.style.display = "block";
    }

    if (context.kind === "unmanaged") {
      inspectorUnmanaged.style.display = "block";
      renderManufacturingCard(context);
      return;
    }
    if (context.kind === "furniture") {
      renderFurnitureInspector(context);
      renderManufacturingCard(context);
      return;
    }
    // part/hardware/aggregate: the child lane. The SAME context object is
    // passed by reference — the child module keeps no selection copy.
    window.GraneteUI.inspectorChild.render(context);
    renderManufacturingCard(context);
  }

  // #470: the Fabricación card is the inspection entry point. Only
  // managed parts/furniture carry it — arbitrary geometry never gets a
  // manufacturing surface. Rendering is driven by the Ruby overlay
  // state; this side never computes machining.
  function renderManufacturingCard(context) {
    var card = document.getElementById("manufacturing-card");
    if (!card) return;
    var multi = context && context.selectionCount && context.selectionCount > 1;
    var eligible = context && !multi &&
      (context.kind === "part" ||
       (context.kind === "furniture" && deps.capabilityEnabled(context, "canInspectManufacturing")));
    card.style.display = eligible ? "block" : "none";
    if (window.GraneteManufacturing) window.GraneteManufacturing.render();
  }

  // ------------------------------------------------------------------
  // #471 R1/R2: batch inspector. Tripartito honesto por control compartido
  // (AC §16): común → valor; mixto → "Mixto"; no soportado por todos →
  // "No aplica a N" con conteo. R2 vuelve editables los roles soportados
  // por TODOS los miembros: las opciones son la INTERSECCIÓN de los
  // grupos de cada definición (una opción inválida para un miembro
  // bloquearía el lote entero), y el Apply envía una intención completa
  // por mueble que el backend re-resuelve — nada de manufactura aquí.
  // ------------------------------------------------------------------
  var batchSelections = {};
  var batchParamEdits = {};

  function renderBatchInspector(context) {
    inspectorBatchView.style.display = "block";
    var members = context.furniture || [];
    batchSelections = {};
    batchParamEdits = {};

    inspectorBatchTitle.textContent = members.length + " muebles en el lote";
    inspectorBatchCountBadge.textContent = members.length + " muebles";
    inspectorBatchSummary.textContent =
      "La edición por lote aplicará a los " + members.length + " muebles administrados de la selección.";

    var excluded = context.excluded || [];
    if (excluded.length > 0) {
      inspectorBatchExcluded.style.display = "block";
      inspectorBatchExcluded.textContent =
        excluded.length + " fuera del lote: " +
        excluded.map(function (entry) { return entry.reason; }).join("; ") + ".";
    } else {
      inspectorBatchExcluded.style.display = "none";
    }

    renderBatchRoles(members, context);
    renderBatchParams(members, context);
    updateBatchFooter(members, context);
  }

  function batchMaterialLabel(materialId) {
    var roles = window.GraneteUI.materialRoles;
    var mat = roles && typeof roles.materialById === "function" ? roles.materialById(materialId) : null;
    return mat && (mat.name || mat.code) ? (mat.name || mat.code) : (materialId || "--");
  }

  function batchRow(label, value, muted) {
    var row = document.createElement("div");
    row.className = "kv-row";
    var k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    var v = document.createElement("span");
    v.className = "v";
    v.textContent = value;
    if (muted) v.style.color = "var(--text-muted)";
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }

  function batchCommonValue(values) {
    var first = values[0];
    var present = first !== undefined && first !== null && first !== "";
    if (!present) return null;
    for (var i = 1; i < values.length; i++) {
      if (values[i] !== first) return null;
    }
    return first;
  }

  function matchRole(r1, r2) {
    if (!r1 || !r2) return false;
    if (r1 === r2) return true;
    var s1 = String(r1).trim().toUpperCase();
    var s2 = String(r2).trim().toUpperCase();
    if (s1 === s2) return true;
    if ((s1 === "FRENTE" && s2 === "FRENTES") || (s1 === "FRENTES" && s2 === "FRENTE")) return true;
    if ((s1 === "INTERIOR" && s2 === "INTERIORES") || (s1 === "INTERIORES" && s2 === "INTERIOR")) return true;
    return false;
  }

  // La intersección de opciones válidas: una elección que un miembro no
  // admite haría fallar SU resolve y, con lote atómico, al lote entero.
  function batchRoleOptionIds(members, role) {
    var roles = window.GraneteUI.materialRoles;
    var sets = members.map(function (m) {
      var def = m.definition || {};
      var entry = (def.materialRoles || []).filter(function (r) { return matchRole(r.role, role); })[0];
      if (!entry) return null;
      if (roles && typeof roles.optionMaterialIds === "function") {
        return roles.optionMaterialIds(entry);
      }
      return entry.optionIds || [];
    });
    if (sets.indexOf(null) !== -1) return [];
    var resolvable = function (id) {
      return !roles || typeof roles.materialById !== "function" || roles.materialById(id);
    };
    return sets.reduce(function (acc, ids) {
      return acc.filter(function (id) { return ids.indexOf(id) !== -1 && resolvable(id); });
    });
  }

  function renderBatchRoleBlock(role, optionIds, common, members, context) {
    var block = document.createElement("div");
    block.className = "material-role-block";
    block.id = "batch-role-block-" + role;

    var roleLabel = role;
    for (var i = 0; i < members.length; i++) {
      var rDef = ((members[i].definition || {}).materialRoles || []).filter(function (r) { return matchRole(r.role, role); })[0];
      if (rDef && rDef.label) {
        roleLabel = rDef.label;
        break;
      }
    }

    var header = document.createElement("div");
    header.className = "material-role-header";

    var title = document.createElement("span");
    title.className = "material-role-title";
    title.textContent = roleLabel;
    header.appendChild(title);

    var drafted = batchSelections[role];
    if (!drafted) {
      for (var bKey in batchSelections) {
        if (matchRole(bKey, role)) { drafted = batchSelections[bKey]; break; }
      }
    }
    var currentMatId = drafted || common;

    var changeBtn = document.createElement("button");
    changeBtn.id = "batch-change-" + role;
    changeBtn.className = "btn btn-secondary btn-sm";
    changeBtn.style.width = "auto";
    changeBtn.style.padding = "2px 10px";
    changeBtn.style.fontSize = "var(--text-xs)";
    changeBtn.style.lineHeight = "1.4";
    changeBtn.textContent = currentMatId ? "Cambiar" : "Asignar";

    header.appendChild(changeBtn);
    block.appendChild(header);

    // Selected Preview card (interactive)
    var preview = document.createElement("div");
    preview.className = "material-selected-preview";
    preview.title = "Clic para abrir el catálogo de acabados";
    preview.setAttribute("role", "button");
    preview.setAttribute("tabindex", "0");
    preview.setAttribute("aria-label", (currentMatId ? "Cambiar" : "Asignar") + " acabado de " + roleLabel);

    var rolesMod = window.GraneteUI.materialRoles;
    var currentMat = currentMatId && rolesMod && typeof rolesMod.materialById === "function" ? rolesMod.materialById(currentMatId) : null;

    var swatch = document.createElement("div");
    swatch.className = "material-swatch";
    if (rolesMod && typeof rolesMod.updateMaterialSwatch === "function") {
      rolesMod.updateMaterialSwatch(swatch, currentMat);
    } else if (currentMat) {
      if (currentMat.previewColor) swatch.style.backgroundColor = currentMat.previewColor;
      var textureUrl = currentMat.previewTextureUrl || currentMat.imageUrl;
      if (textureUrl) swatch.style.backgroundImage = "url('" + textureUrl + "')";
    } else {
      swatch.style.backgroundColor = "#f1f5f9";
      swatch.style.border = "1px dashed var(--border-default, #cbd5e1)";
    }
    preview.appendChild(swatch);

    var info = document.createElement("div");
    info.className = "material-selected-info";

    var valueEl = document.createElement("div");
    valueEl.className = "material-selected-name";

    if (drafted && drafted !== common) {
      var from = common ? batchMaterialLabel(common) : "Mixto";
      var to = batchMaterialLabel(drafted);
      valueEl.textContent = from + " → " + to;
      valueEl.title = drafted;
      valueEl.className += " design-insp-draft";
    } else if (common) {
      valueEl.textContent = batchMaterialLabel(common);
    } else {
      valueEl.textContent = "Mixto";
      valueEl.style.color = "var(--text-muted)";
      valueEl.style.fontWeight = "normal";
    }
    info.appendChild(valueEl);

    var metaEl = document.createElement("div");
    metaEl.className = "material-selected-meta";
    if (currentMat) {
      var parts = [];
      if (currentMat.code) parts.push(currentMat.code);
      if (currentMat.thicknessMm) parts.push(currentMat.thicknessMm + " mm");
      if (currentMat.grain) parts.push("Veta");
      if (currentMat.manufacturer) parts.push(currentMat.manufacturer);
      metaEl.textContent = parts.length > 0 ? parts.join(" · ") : "Acabado de catálogo";
    } else if (drafted) {
      metaEl.textContent = "Acabado seleccionado";
    } else if (common) {
      metaEl.textContent = "Acabado común en el lote";
    } else {
      metaEl.textContent = "Valores mixtos en la selección";
    }
    info.appendChild(metaEl);
    preview.appendChild(info);

    var chevron = document.createElement("span");
    chevron.className = "material-chevron";
    if (deps && typeof deps.icon === "function") {
      chevron.innerHTML = deps.icon("chevron-right", 16);
    } else {
      chevron.textContent = "›";
    }
    preview.appendChild(chevron);

    function triggerVisualPicker() {
      if (window.sketchup && typeof window.sketchup.open_material_selector === "function") {
        window.sketchup.open_material_selector(JSON.stringify({
          role: role,
          roleName: roleLabel || role,
          currentMaterialId: batchSelections[role] || common || null,
          context: "batch",
          allowedMaterialIds: optionIds
        }));
      } else if (window.GraneteUI.finishSelector && typeof window.GraneteUI.finishSelector.open === "function") {
        var roleEntry = { role: role, label: roleLabel || role, optionIds: optionIds };
        window.GraneteUI.finishSelector.open(roleEntry, batchSelections[role] || common, function (newId) {
          onMaterialChoiceApplied({ role: role, materialId: newId, context: "batch" });
        }, "batch");
      }
    }

    changeBtn.addEventListener("click", function (evt) {
      if (evt && evt.stopPropagation) evt.stopPropagation();
      triggerVisualPicker();
    });

    preview.addEventListener("click", function () {
      triggerVisualPicker();
    });

    preview.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        if (e.preventDefault) e.preventDefault();
        triggerVisualPicker();
      }
    });

    block.appendChild(preview);
    return block;
  }

  function renderBatchRoles(members, context) {
    inspectorBatchRoles.innerHTML = "";
    var seen = [];
    members.forEach(function (m) {
      var def = m.definition || {};
      (def.materialRoles || []).forEach(function (r) {
        if (!r || !r.role) return;
        var exists = false;
        for (var i = 0; i < seen.length; i++) {
          if (matchRole(seen[i], r.role)) { exists = true; break; }
        }
        if (!exists) seen.push(r.role);
      });
    });
    if (seen.length === 0) {
      inspectorBatchRolesCard.style.display = "none";
      return;
    }
    inspectorBatchRolesCard.style.display = "block";
    var editable = context && context.capabilities &&
      context.capabilities.canBatchEditMaterialRoles &&
      context.capabilities.canBatchEditMaterialRoles.supported;
    seen.forEach(function (role) {
      var supported = members.filter(function (m) {
        var def = m.definition || {};
        return (def.materialRoles || []).some(function (r) { return matchRole(r.role, role); });
      });
      if (supported.length < members.length) {
        inspectorBatchRoles.appendChild(
          batchRow(role, "No aplica a " + (members.length - supported.length), true));
        return;
      }
      var values = members.map(function (m) {
        var choices = m.materialChoices || {};
        if (choices[role] !== undefined) return choices[role];
        for (var k in choices) {
          if (matchRole(k, role)) return choices[k];
        }
        return null;
      });
      var common = batchCommonValue(values);
      var optionIds = batchRoleOptionIds(members, role);
      if (editable && optionIds.length > 0) {
        inspectorBatchRoles.appendChild(
          renderBatchRoleBlock(role, optionIds, common, members, context));
      } else if (optionIds.length === 0) {
        inspectorBatchRoles.appendChild(batchRow(role, "Sin opción común", true));
      } else {
        inspectorBatchRoles.appendChild(
          batchRow(role, common !== null ? batchMaterialLabel(common) : "Mixto", common === null));
      }
    });
  }

  // #471 R3: compatible shared parameters. A parameter is batch-editable
  // only when EVERY member definition declares it with the SAME type and a
  // non-empty intersection of range/options (AC §148-180: the resolver
  // selects behavior from the binding; incompatible contracts fail closed,
  // never coerced). The authoritative validation stays server-side.
  function batchParamContract(members, name) {
    var decls = members.map(function (m) {
      var def = m.definition || {};
      return (def.parameters || []).filter(function (p) { return p.name === name; })[0] || null;
    });
    if (decls.indexOf(null) !== -1) return null;
    var types = {};
    decls.forEach(function (d) { types[d.type || "string"] = true; });
    var typeKeys = Object.keys(types);
    if (typeKeys.length !== 1) return { unsupported: "tipos distintos entre definiciones" };
    var type = typeKeys[0];
    if (type === "number") {
      var mins = decls.map(function (d) { return d.min; }).filter(function (v) { return v !== undefined; });
      var maxs = decls.map(function (d) { return d.max; }).filter(function (v) { return v !== undefined; });
      var min = mins.length ? Math.max.apply(null, mins) : undefined;
      var max = maxs.length ? Math.min.apply(null, maxs) : undefined;
      if (min !== undefined && max !== undefined && min > max) return { unsupported: "sin rango común" };
      return { type: "number", min: min, max: max };
    }
    if (type === "enum") {
      var sets = decls.map(function (d) { return d.options || []; });
      var common = sets.reduce(function (acc, opts) {
        return acc.filter(function (o) { return opts.indexOf(o) !== -1; });
      });
      if (common.length === 0) return { unsupported: "sin opciones comunes" };
      return { type: "enum", options: common };
    }
    return { type: type };
  }

  function batchParamInput(name, contract, common) {
    var input;
    if (contract.type === "enum") {
      input = document.createElement("select");
      input.className = "input";
      input.style.width = "100%";
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = common ? "--" : "Mixto";
      input.appendChild(placeholder);
      contract.options.forEach(function (value) {
        var opt = document.createElement("option");
        opt.value = value;
        opt.textContent = String(value);
        input.appendChild(opt);
      });
      if (common !== null && contract.options.indexOf(common) !== -1) input.value = common;
    } else if (contract.type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      // #471 tri-state: true+true -> checked; false+false -> unchecked;
      // mixed -> indeterminate. An unchecked box must never be readable as
      // "false" when the real state is mixed.
      if (common === true) input.checked = true;
      if (common === null) input.indeterminate = true;
    } else {
      input = document.createElement("input");
      input.className = "input";
      input.type = contract.type === "number" ? "number" : "text";
      input.style.width = "100%";
      if (contract.type === "number") {
        if (contract.min !== undefined) input.min = String(contract.min);
        if (contract.max !== undefined) input.max = String(contract.max);
      }
      if (common !== null) input.value = String(common);
      else input.placeholder = "Mixto";
    }
    input.addEventListener("change", function () {
      if (input.type === "checkbox") {
        // Resolving the tri-state records exactly the boolean chosen; an
        // untouched indeterminate box never fires change and sends nothing.
        input.indeterminate = false;
        batchParamEdits[name] = input.checked;
      } else {
        var raw = input.value;
        if (raw === "" || raw === null || raw === undefined) {
          delete batchParamEdits[name];
        } else {
          batchParamEdits[name] = contract.type === "number" ? Number(raw) : raw;
        }
      }
      updateBatchFooter(selectedContext && selectedContext.furniture || [], selectedContext);
    });
    return input;
  }

  function renderBatchParams(members, context) {
    inspectorBatchParams.innerHTML = "";
    var seen = [];
    members.forEach(function (m) {
      var def = m.definition || {};
      (def.parameters || []).forEach(function (p) {
        if (seen.indexOf(p.name) === -1) seen.push(p.name);
      });
    });
    if (seen.length === 0) {
      inspectorBatchParamsCard.style.display = "none";
      return;
    }
    inspectorBatchParamsCard.style.display = "block";
    var editable = context && context.capabilities &&
      context.capabilities.canBatchEditParameters &&
      context.capabilities.canBatchEditParameters.supported;
    seen.forEach(function (name) {
      var supported = members.filter(function (m) {
        var def = m.definition || {};
        return (def.parameters || []).some(function (p) { return p.name === name; });
      });
      if (supported.length < members.length) {
        inspectorBatchParams.appendChild(
          batchRow(name, "No aplica a " + (members.length - supported.length), true));
        return;
      }
      var contract = batchParamContract(members, name);
      var values = members.map(function (m) { return (m.parameters || {})[name]; });
      var common = batchCommonValue(values);
      if (contract && contract.unsupported) {
        inspectorBatchParams.appendChild(batchRow(name, contract.unsupported, true));
        return;
      }
      if (editable && contract) {
        var row = document.createElement("div");
        row.className = "kv-row";
        var k = document.createElement("span");
        k.className = "k";
        k.textContent = name;
        var v = document.createElement("span");
        v.className = "v";
        v.appendChild(batchParamInput(name, contract, common));
        row.appendChild(k);
        row.appendChild(v);
        inspectorBatchParams.appendChild(row);
      } else if (common !== null) {
        inspectorBatchParams.appendChild(batchRow(name, String(common), false));
      } else {
        inspectorBatchParams.appendChild(batchRow(name, "Mixto", true));
      }
    });
  }

  function updateBatchFooter(members, context) {
    var footer = document.getElementById("inspector-batch-footer");
    if (!footer) return;
    var caps = (context && context.capabilities) || {};
    var rolesEditable = caps.canBatchEditMaterialRoles && caps.canBatchEditMaterialRoles.supported;
    var paramsEditable = caps.canBatchEditParameters && caps.canBatchEditParameters.supported;
    var pending = (rolesEditable ? Object.keys(batchSelections).length : 0) +
      (paramsEditable ? Object.keys(batchParamEdits).length : 0);
    if (pending === 0) {
      footer.style.display = "none";
      return;
    }
    footer.style.display = "block";
    var count = members.length || (context.furniture || []).length;
    document.getElementById("inspector-batch-pending").textContent =
      pending + (pending === 1 ? " cambio a aplicar" : " cambios a aplicar") +
      " en " + count + " muebles";
    var btn = document.getElementById("btn-batch-apply");
    btn.textContent = "Aplicar a " + count + " muebles";
    btn.disabled = window.GraneteMutation && typeof window.GraneteMutation.phase === "function" &&
      window.GraneteMutation.phase() === "applying_host_mutation";
  }

  // #471 R2: el Apply arma UNA intención completa por mueble (parametros
  // actuales + roles elegidos; Ruby mergea con los choices persistidos de
  // cada entidad) y la envía como un solo comando todo-o-nada.
  function applyBatchSelections() {
    var context = selectedContext;
    if (!context || context.kind !== "batch") return;
    var members = context.furniture || [];
    var chosen = batchSelections;
    var paramEdits = batchParamEdits;
    var pendingRoles = Object.keys(chosen).length;
    var pendingParams = Object.keys(paramEdits).length;
    if ((pendingRoles + pendingParams) === 0 || members.length === 0) return;

    var items = members.map(function (m) {
      var memberChoices = {};
      var defRoles = (m.definition && m.definition.materialRoles) || [];
      for (var chosenRole in chosen) {
        var targetRole = chosenRole;
        for (var i = 0; i < defRoles.length; i++) {
          if (matchRole(defRoles[i].role, chosenRole)) {
            targetRole = defRoles[i].role;
            break;
          }
        }
        memberChoices[targetRole] = chosen[chosenRole];
      }
      return {
        instanceId: m.furnitureInstanceRef,
        definitionId: m.furnitureDefinitionId,
        // One complete per-member intent: current parameters overridden by
        // the batch edits, current choices overridden by the chosen roles
        // (Ruby merges with each entity's persisted materialChoices).
        parameters: Object.assign({}, m.parameters || {}, paramEdits),
        materialChoices: memberChoices
      };
    });
    var result = window.GraneteMutation.submitBatchUpdate(items);
    if (result === "busy") {
      deps.showToast("error", "Ya hay una mutación en curso.");
    } else if (result === "unavailable") {
      deps.showToast("error", "La edición por lote no está disponible fuera de SketchUp.");
    }
  }

  function onBatchUpdateResult(result) {
    var success = !!(result && result.success);
    if (success) {
      deps.showToast("success", "✓ Lote aplicado a " + (result.applied || 0) + " muebles.");
    } else {
      // All-or-nothing: nothing was applied — the copy says so honestly.
      deps.showToast("error", "El lote no se aplicó: " + ((result && result.error) || "error desconocido") +
        " Ningún mueble cambió.");
    }
  }

  function renderFurnitureInspector(context) {
    inspectorActive.style.display = "block";

    var def = context.definition || window.GraneteUI.library.findDefinitionById(context.furnitureDefinitionId);
    inspectorDef = def || null;
    inspectorName.textContent = (context.display && context.display.name) || (def ? def.name : "Mueble");

    var legacy = context.representation === "legacy-group";
    inspectorRepresentationWarning.style.display = legacy ? "block" : "none";
    if (legacy) {
      inspectorRepresentationWarning.textContent =
        "Este mueble usa una representación anterior del plugin. Usá Granete → Migrar modelos anteriores… para actualizarlo y recuperar la edición.";
    }

    // Interactive validation reset
    inspectorInteractiveBadge.textContent = "✓ Medidas válidas";
    inspectorInteractiveBadge.className = "status-badge valid";

    // The authoritative preflight badge is owned by
    // GraneteMutation.renderPreflight (#466): only Ruby-pushed tracker
    // states decide ready/warning/blocked — never local validity.

    // Each control obeys its OWN capability, and a multi-selection
    // fail-closes every mutation until batch editing exists.
    var multi = context.selectionCount && context.selectionCount > 1;
    var canEditParams = deps.capabilityEnabled(context, "canEditParameters");
    var canEditMaterials = deps.capabilityEnabled(context, "canEditMaterialRoles");
    var blockerReason = !canEditParams && context.capabilities && context.capabilities.canEditParameters
      ? context.capabilities.canEditParameters.reason
      : null;
    inspectorEditBlocker.style.display = canEditParams ? "none" : "block";
    inspectorEditBlockerReason.textContent = blockerReason || "La edición no está disponible para este mueble.";
    inspectorParamsCard.style.display = canEditParams ? "block" : "none";

    // One native switch for params + materials + the draft footer.
    inspectorEditFieldset.disabled = Boolean(multi || !canEditParams);
    btnApply.disabled = Boolean(multi || !canEditParams);
    btnDelete.disabled = Boolean(!deps.capabilityEnabled(context, "canDelete") || multi);

    // A denied canDelete explains itself with the Ruby-provided reason;
    // enabled or multi-selection hides the note (multi has its own).
    var deleteCap = context.capabilities && context.capabilities.canDelete;
    var deleteUnavailable = !multi && !(deleteCap && deleteCap.supported);
    inspectorDeleteBlocker.hidden = !deleteUnavailable;
    if (deleteUnavailable) {
      inspectorDeleteBlocker.textContent = (deleteCap && deleteCap.reason) ||
        "La eliminación no está disponible para este mueble.";
    }

    if (!canEditParams) {
      inspectorParams = {};
      inspectorMaterialChoices = {};
      draft = null; // fail-closed lane: no draft survives a denied render
      inspectorMaterialsCard.style.display = "none";
      if (inspectorOpeningAccessoriesCard) inspectorOpeningAccessoriesCard.style.display = "none";
      renderOpeningAccessoriesCard(context, inspectorParams);
      updateInspectorFooter();
      return;
    }
    inspectorMaterialsCard.style.display = canEditMaterials ? "block" : "none";

    // #784 R3b: draft ownership check. The fresh context-seeded snapshots
    // decide whether an existing draft still belongs to THIS item and THIS
    // confirmed state — a diverged republish (the server moved on) kills
    // the draft honestly instead of rebasing it silently.
    var freshParams = Object.assign({}, (def ? deps.getDefaultParams(def) : {}), context.parameters || {});
    var freshChoices = canEditMaterials
      ? Object.assign({}, window.GraneteUI.materialRoles.defaultMaterialChoices(def), context.materialChoices || {})
      : {};
    if (draft && (!context || context.kind !== "furniture" ||
                  context.furnitureInstanceRef !== draft.instanceRef ||
                  !sameMap(freshParams, draft.base.parameters) ||
                  !sameMap(freshChoices, draft.base.materialChoices))) {
      draft = null;
    }
    confirmedBase = { parameters: copyMap(freshParams), materialChoices: copyMap(freshChoices) };
    inspectorParams = freshParams;
    inspectorMaterialChoices = freshChoices;
    if (draft) {
      // Surviving draft (identical same-item republish): re-apply the
      // pending values so the controls keep showing the drafted state.
      for (var draftedParam in draft.params) inspectorParams[draftedParam] = draft.params[draftedParam];
      for (var draftedRole in draft.choices) inspectorMaterialChoices[draftedRole] = draft.choices[draftedRole];
    }

    deps.renderParamForm(inspectorParamsContainer, def, inspectorParams, paramChangeHandler());
    if (canEditMaterials) {
      renderInspectorMaterialSelectors();
    }
    // #529: card Apertura y Accesorios (nivel mueble, después de params/materiales).
    renderOpeningAccessoriesCard(context, inspectorParams);

    updateInspectorSummary();
    updateInspectorFooter();
  }

  // #471 R2: the batch Apply button lives in the batch view; it is wired
  // once here and reads the CURRENT selectedContext at click time.
  var btnBatchApply = document.getElementById("btn-batch-apply");
  if (btnBatchApply) {
    btnBatchApply.addEventListener("click", applyBatchSelections);
  }

  // #784 R3b: the draft footer buttons. Aplicar = the ONE mutation of the
  // draft; Descartar = read-only discard.
  btnApply.addEventListener("click", applyDraft);
  btnDiscard.addEventListener("click", discardDraft);

  // #784 R3b: Restaurar valor del diseño — lands in the LOCAL draft with
  // the explicit design lineage marker; the single [Aplicar] materializes
  // it through the SAME authoritative path as any furniture edit (resolve
  // → ONE SketchUp operation → rebuild → metadata). Never a paint-only
  // change and never inferred from value equality: the mode travels in the
  // Apply payload.
  function applyRoleRestore(instanceId, role, designDefaultId) {
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (selectedContext.furnitureInstanceRef !== instanceId) return;
    if (!deps.capabilityEnabled(selectedContext, "canEditMaterialRoles")) return;
    recordRoleRestore(role, designDefaultId);
    inspectorMaterialChoices[role] = designDefaultId;
    renderInspectorMaterialSelectors();
  }

  // Destructive action guard: first click arms the button, second click
  // within the window confirms. Undo still applies after deletion.
  var deleteArmed = false;
  var deleteArmTimer = null;

  function resetDeleteConfirm() {
    deleteArmed = false;
    if (deleteArmTimer) {
      clearTimeout(deleteArmTimer);
      deleteArmTimer = null;
    }
    btnDelete.innerHTML = deps.icon("trash") + "<span>Eliminar Mueble</span>";
    btnDelete.setAttribute("aria-label", "Eliminar Mueble");
  }

  btnDelete.addEventListener("click", function () {
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (!deps.capabilityEnabled(selectedContext, "canDelete")) return;
    if (selectedContext.selectionCount > 1) return;
    if (!deleteArmed) {
      deleteArmed = true;
      btnDelete.textContent = "¿Confirmar eliminación?";
      btnDelete.setAttribute("aria-label", "Confirmar la eliminación del mueble");
      deleteArmTimer = setTimeout(resetDeleteConfirm, 4000);
      return;
    }
    resetDeleteConfirm();
    if (window.sketchup && window.sketchup.delete_selected_furniture) {
      var deletePayload = { instanceId: selectedContext.furnitureInstanceRef };
      window.sketchup.delete_selected_furniture(JSON.stringify(deletePayload));
    } else {
      // Fallback sin host: mismo cierre honesto que el camino Ruby.
      window.GraneteDialog.onDeleteResult({ ok: true });
      window.GraneteDialog.onSelectionChange(null);
    }
  });

  // Ruby-facing bridge result handlers: the bodies moved verbatim from
  // the GraneteDialog wrappers (#848 C4.7); GraneteDialog keeps thin
  // delegation with unchanged names and payloads.
  function onUpdateResult(result) {
    requireDeps();
    applyInFlight = false;
    btnApply.innerHTML = deps.icon("save") + "<span>Aplicar</span>";
    btnDiscard.disabled = false;
    if (result && result.success) {
      var detail = typeof result.component_count === "number" && result.component_count > 0
        ? " — " + result.component_count + " componente" + (result.component_count === 1 ? "" : "s")
        : "";
      deps.showToast("success", "✓ Mueble " + (result.name || "") + " actualizado in-place" + detail + ".");
      // Only the item the Apply was built for absorbs the result; a
      // selection switch mid-flight never gets the old item's values.
      if (selectedContext && selectedContext.kind === "furniture" &&
          selectedContext.furnitureInstanceRef === appliedRef) {
        selectedContext.parameters = Object.assign({}, inspectorParams);
        selectedContext.materialChoices = Object.assign({}, inspectorMaterialChoices);
      }
      confirmedBase = { parameters: copyMap(inspectorParams), materialChoices: copyMap(inspectorMaterialChoices) };
      draft = null; // confirmed: the draft is done
      updateInspectorFooter();
      // #784 R3 final review: the authoritative projection (server
      // material_choice_modes) must be re-read after any successful
      // furniture mutation — the badge never infers mode changes locally.
      var designInspector = window.GraneteUI.designInspector;
      if (designInspector && typeof designInspector.refreshInheritance === "function") {
        designInspector.refreshInheritance();
      }
    } else {
      deps.showToast("error", deps.parameterIssueMessage(result, "No se pudo actualizar el mueble."));
      // #784 R3b: the draft is PRESERVED on failure — the drafted values
      // stay on screen and the footer keeps counting. No silent rollback
      // repaint; the user fixes or discards with full information.
      updateInspectorFooter();
    }
  }

  function onSelectionChange(context) {
    requireDeps();
    // #784 R3b: ANY real change of selection (another item, another kind,
    // null) kills the draft — the safest default; only an identical
    // same-item republish keeps it (checked at render time).
    if (draft && (!context || context.kind !== "furniture" ||
                  context.furnitureInstanceRef !== draft.instanceRef)) {
      draft = null;
    }
    selectedContext = context || null;
    // #498: the shared store owns selection truth for downstream
    // runtime surfaces (#466–#468); the legacy variable stays as the
    // inspector's working copy.
    if (window.GraneteMutation) {
      window.GraneteMutation.publishSelection(selectedContext);
    }
    renderInspector();

    // Preserve active tab context: do not hijack the user away from
    // the library while browsing the catalog. Unmanaged geometry does
    // not pull focus either; only managed contexts do.
    var managed = selectedContext && ["furniture", "aggregate", "part", "hardware"].indexOf(selectedContext.kind) !== -1;
    var activeTabBtn = document.querySelector(".tab-button.active");
    var currentTabId = activeTabBtn ? activeTabBtn.getAttribute("data-tab") : "library";
    if (managed && (currentTabId === "inspector" || !window.GraneteUI.configurator.hasActiveDefinition())) {
      deps.switchTab("inspector");
    }
  }

  // #784 R3b: binding lifecycle seam (#906 spirit) — only a REAL change of
  // the binding identity (connected design/project or unbound) invalidates
  // the draft; same-binding refreshes never do.
  function onBindingStatus(status) {
    var binding = (status && status.binding) || {};
    var connected = !!(status && status.state === "connected" && binding.designId);
    var identity = connected ? binding.designId + "|" + (binding.projectId || "") : "unbound";
    if (identity === bindingIdentity) return;
    bindingIdentity = identity;
    if (!draft) return;
    draft = null;
    repaintConfirmedSnapshots();
    updateInspectorFooter();
  }

  // "Granete: editar en el panel" (menú contextual de una selección
  // gestionada): Ruby selecciona la entidad Y pide el Inspector —
  // aunque el configurador siga abierto (definición activa), el
  // usuario no puede quedarse mirando Biblioteca.
  function activateInspectorTab() {
    requireDeps();
    deps.switchTab("inspector");
  }

  function onMaterialChoiceApplied(payload) {
    requireDeps();
    if (!payload || !payload.role || !payload.materialId) return;
    var role = payload.role;
    var materialId = payload.materialId;

    // #784: if the finish choice belongs to the design inspector (context === "design"),
    // apply the pick to the design inspector's draft.
    if (payload.context === "design") {
      if (window.GraneteUI.designInspector && typeof window.GraneteUI.designInspector.applyMaterialPick === "function") {
        window.GraneteUI.designInspector.applyMaterialPick(role, materialId);
      }
      return;
    }

    // If the finish choice belongs to batch multi-selection (context === "batch"),
    // apply to batch selections draft and repaint batch roles + update footer.
    if (payload.context === "batch" || (selectedContext && selectedContext.kind === "batch")) {
      var batchKey = role;
      for (var bRole in batchSelections) {
        if (matchRole(bRole, role)) { delete batchSelections[bRole]; batchKey = bRole; break; }
      }
      batchSelections[batchKey] = materialId;
      var batchMembers = (selectedContext && selectedContext.furniture) || [];
      renderBatchRoles(batchMembers, selectedContext);
      updateBatchFooter(batchMembers, selectedContext);
      return;
    }

    var scope = payload.scope || "furniture";
    var isProjectScope = (scope === "project" || scope === "project_default");

    if (isProjectScope) {
      window.GraneteUI.materialRoles.setProjectDefaultMaterial(role, materialId);
    }

    var isInspectorTarget = payload.context === "inspector" || (payload.instanceId && selectedContext && payload.instanceId === selectedContext.furnitureInstanceRef);
    var isConfiguratorTarget = payload.context === "configurator" || (!isInspectorTarget && window.GraneteUI.configurator.hasActiveDefinition());

    // If the finish choice belongs to an inspected placed furniture in the model
    var materialsEditable = selectedContext && selectedContext.kind === "furniture" &&
        deps.capabilityEnabled(selectedContext, "canEditMaterialRoles") && !(selectedContext.selectionCount > 1);
    if (isInspectorTarget && selectedContext && selectedContext.kind === "furniture" && inspectorDef && materialsEditable && (!payload.instanceId || payload.instanceId === selectedContext.furnitureInstanceRef)) {
      if (!inspectorMaterialChoices) inspectorMaterialChoices = {};
      // #784 R3b: the pick lands in the LOCAL draft — no immediate
      // mutation; the footer counts it and the single [Aplicar] emits it.
      inspectorMaterialChoices[role] = materialId;
      recordMaterialPick(role, materialId);
      renderInspectorMaterialSelectors();
    } else if (isConfiguratorTarget && window.GraneteUI.configurator.hasActiveDefinition()) {
      // If configuring a module in the library before inserting —
      // the configurator snapshot/renderer live in
      // js/granete-configurator.js (#848 C4.4).
      window.GraneteUI.configurator.applyMaterialChoice(role, materialId, isProjectScope);
    } else if (isProjectScope) {
      var matProj = window.GraneteUI.materialRoles.materialById(materialId);
      deps.showToast("success", "✓ Acabado temporal de sesión: " + (matProj ? matProj.name : materialId));
    }
  }

  function onDeleteResult(result) {
    requireDeps();
    result = result || {};
    if (result.ok) {
      // Peak-end honest: la eliminación ES reversible (una operación
      // de Undo) — el cierre nombra la red de seguridad en vez de
      // dejar el panel en blanco.
      deps.showToast("success", "✓ Mueble eliminado. Deshacé con Ctrl+Z (\u2318Z) si fue un error.");
    } else {
      deps.showToast("error", result.reason
        ? "No se pudo eliminar el mueble: " + result.reason + "."
        : "No se pudo eliminar el mueble.");
    }
  }

  // Hardware catalog slice: the Inspector hardware view is its only
  // renderer, so the module is its single dialog-side owner (#848
  // C4.7). GraneteDialog.setCatalog (object branch) delegates here and
  // the GraneteState "catalog" projection reads the live reference.
  // The historical array-payload non-reset quirk is preserved upstream.
  function setHardwareCatalog(hardware) {
    catalogHardware = hardware || [];
  }

  window.GraneteUI.inspector = {
    init: function (injected) { deps = injected || {}; },
    onSelectionChange: onSelectionChange,
    onUpdateResult: onUpdateResult,
    onBatchUpdateResult: onBatchUpdateResult,
    onDeleteResult: onDeleteResult,
    onMaterialChoiceApplied: onMaterialChoiceApplied,
    onBindingStatus: onBindingStatus,
    activateInspectorTab: activateInspectorTab,
    // Read-only accessors consumed by the bootstrap wiring (material
    // roles context payload fallback; inline manufacturing/preflight
    // runtime adapters). Dep-free: they only read module state.
    getSelectedContext: function () { return selectedContext; },
    // #784 R1: repaint through the single routing (binding changes that
    // arrive while the lane is empty re-render via this seam).
    rerender: function () { renderInspector(); },
    // #784 R3: the restore action target (called from the role block).
    // #784 R3b: the restore lands in the draft (mode design).
    applyRoleRestore: function (instanceId, role, designDefaultId) {
      applyRoleRestore(instanceId, role, designDefaultId);
    },
    getDefinition: function () { return inspectorDef; },
    getMaterialsCard: function () { return inspectorMaterialsCard; },
    setHardwareCatalog: setHardwareCatalog,
    getHardwareCatalog: function () { return catalogHardware; }
  };
})();
