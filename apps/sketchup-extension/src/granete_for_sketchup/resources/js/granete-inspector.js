// #848 Phase B C4.7 — inspector module (boundary-adjusted split).
// Owns:
// - the Inspector UI working selection context (selectedContext: the
//   dialog's working copy of the SelectionContext the Ruby resolver
//   publishes; the shared runtime truth stays in GraneteState/GraneteMutation)
// - top-level Inspector routing by kind (null/unmanaged/furniture/child
//   dispatch) and the furniture Inspector rendering
// - the Inspector parameter/material working snapshots (inspectorParams,
//   inspectorMaterialChoices) and the capability-driven Inspector actions
//   (update, delete, material-choice apply)
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
  var inspectorSummaryDims = document.getElementById("inspector-summary-dims");
  var inspectorSummaryParts = document.getElementById("inspector-summary-parts");
  var btnUpdate = document.getElementById("btn-update");
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
  // Contextual inspector (#476): renders the canonical SelectionContext
  // by kind. Legality comes exclusively from the Ruby capability set —
  // the client never infers it from names, slot ids or entity types.
  // ------------------------------------------------------------------

  function hideInspectorViews() {
    inspectorEmpty.style.display = "none";
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

  // La intersección de opciones válidas: una elección que un miembro no
  // admite haría fallar SU resolve y, con lote atómico, al lote entero.
  function batchRoleOptionIds(members, role) {
    var sets = members.map(function (m) {
      var def = m.definition || {};
      var entry = (def.materialRoles || []).filter(function (r) { return r.role === role; })[0];
      return entry ? (entry.optionIds || []) : null;
    });
    if (sets.indexOf(null) !== -1) return [];
    var roles = window.GraneteUI.materialRoles;
    var resolvable = function (id) {
      return !roles || typeof roles.materialById !== "function" || roles.materialById(id);
    };
    return sets.reduce(function (acc, ids) {
      return acc.filter(function (id) { return ids.indexOf(id) !== -1 && resolvable(id); });
    });
  }

  function batchRoleSelect(role, optionIds, common) {
    var select = document.createElement("select");
    select.className = "input";
    select.style.width = "100%";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = common ? "--" : "Mixto";
    select.appendChild(placeholder);
    optionIds.forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = batchMaterialLabel(id);
      select.appendChild(opt);
    });
    if (common && optionIds.indexOf(common) !== -1) select.value = common;
    select.addEventListener("change", function () {
      if (select.value) {
        batchSelections[role] = select.value;
      } else {
        delete batchSelections[role];
      }
      updateBatchFooter(selectedContext && selectedContext.furniture || [], selectedContext);
    });
    return select;
  }

  function renderBatchRoles(members, context) {
    inspectorBatchRoles.innerHTML = "";
    var seen = [];
    members.forEach(function (m) {
      var def = m.definition || {};
      (def.materialRoles || []).forEach(function (r) {
        if (seen.indexOf(r.role) === -1) seen.push(r.role);
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
        return (def.materialRoles || []).some(function (r) { return r.role === role; });
      });
      if (supported.length < members.length) {
        inspectorBatchRoles.appendChild(
          batchRow(role, "No aplica a " + (members.length - supported.length), true));
        return;
      }
      var values = members.map(function (m) { return (m.materialChoices || {})[role]; });
      var common = batchCommonValue(values);
      var optionIds = batchRoleOptionIds(members, role);
      if (editable && optionIds.length > 0) {
        var row = document.createElement("div");
        row.className = "kv-row";
        var k = document.createElement("span");
        k.className = "k";
        k.textContent = role;
        var v = document.createElement("span");
        v.className = "v";
        v.appendChild(batchRoleSelect(role, optionIds, common));
        row.appendChild(k);
        row.appendChild(v);
        inspectorBatchRoles.appendChild(row);
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
      if (common === true) input.checked = true;
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
      var raw = input.type === "checkbox" ? input.checked : input.value;
      if (raw === "" || raw === null || raw === undefined) {
        delete batchParamEdits[name];
      } else {
        batchParamEdits[name] = contract.type === "number" ? Number(raw) : raw;
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
      return {
        instanceId: m.furnitureInstanceRef,
        definitionId: m.furnitureDefinitionId,
        // One complete per-member intent: current parameters overridden by
        // the batch edits, current choices overridden by the chosen roles
        // (Ruby merges with each entity's persisted materialChoices).
        parameters: Object.assign({}, m.parameters || {}, paramEdits),
        materialChoices: chosen
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

    // One native switch for params + materials + both buttons.
    inspectorEditFieldset.disabled = Boolean(multi || !canEditParams);
    btnUpdate.disabled = Boolean(!canEditParams || multi);
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
      inspectorMaterialsCard.style.display = "none";
      return;
    }
    inspectorMaterialsCard.style.display = canEditMaterials ? "block" : "none";
    if (!canEditMaterials) {
      inspectorMaterialChoices = {};
    }

    inspectorParams = Object.assign({}, (def ? deps.getDefaultParams(def) : {}), context.parameters || {});
    inspectorMaterialChoices = Object.assign({}, window.GraneteUI.materialRoles.defaultMaterialChoices(def), context.materialChoices || {});

    deps.renderParamForm(inspectorParamsContainer, def, inspectorParams, function (name, val, unit) {
      inspectorParams[name] = val;
      updateInspectorSummary();
      validateInteractiveClient(def, inspectorParams);
    });
    if (canEditMaterials) {
      window.GraneteUI.materialRoles.renderMaterialSelectors(inspectorMaterialsCard, inspectorMaterialsContainer, def,
        inspectorMaterialChoices, function (role, id) {
          inspectorMaterialChoices[role] = id;
        });
    }

    updateInspectorSummary();
  }

  // #471 R2: the batch Apply button lives in the batch view; it is wired
  // once here and reads the CURRENT selectedContext at click time.
  var btnBatchApply = document.getElementById("btn-batch-apply");
  if (btnBatchApply) {
    btnBatchApply.addEventListener("click", applyBatchSelections);
  }

  btnUpdate.addEventListener("click", function () {
    if (!selectedContext || selectedContext.kind !== "furniture") return;
    if (!deps.capabilityEnabled(selectedContext, "canEditParameters")) return;
    if (selectedContext.selectionCount > 1) return;
    btnUpdate.disabled = true;
    btnUpdate.innerHTML = deps.icon("clock") + "<span>Actualizando…</span>";

    var payload = {
      instanceId: selectedContext.furnitureInstanceRef,
      definitionId: selectedContext.furnitureDefinitionId,
      parameters: inspectorParams,
      materialChoices: inspectorMaterialChoices
    };

    // #498: managed edits ride the shared mutation controller —
    // explicit state machine, one correlated command, double-submit
    // guard. The legacy direct call remains as fallback when the
    // runtime modules are not loaded.
    var submitted = "unavailable";
    if (window.GraneteMutation) {
      submitted = window.GraneteMutation.submitUpdate(payload, selectedContext);
    }
    if (submitted === "unavailable" && window.sketchup && window.sketchup.update_furniture) {
      window.sketchup.update_furniture(JSON.stringify(payload));
    } else if (submitted === "unavailable") {
      setTimeout(function () {
        window.GraneteDialog.onUpdateResult({ success: true, name: selectedContext.display ? selectedContext.display.name : "" });
      }, 500);
    }
  });

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
    btnUpdate.disabled = !deps.capabilityEnabled(selectedContext, "canEditParameters") ||
      (selectedContext && selectedContext.selectionCount > 1);
    btnUpdate.innerHTML = deps.icon("save") + "<span>Actualizar Mueble</span>";
    if (result && result.success) {
      var detail = typeof result.component_count === "number" && result.component_count > 0
        ? " — " + result.component_count + " componente" + (result.component_count === 1 ? "" : "s")
        : "";
      deps.showToast("success", "✓ Mueble " + (result.name || "") + " actualizado in-place" + detail + ".");
      if (selectedContext) {
        selectedContext.parameters = Object.assign({}, inspectorParams);
        selectedContext.materialChoices = Object.assign({}, inspectorMaterialChoices);
      }
    } else {
      deps.showToast("error", deps.parameterIssueMessage(result, "No se pudo actualizar el mueble."));
      // Rollback in-memory inspector state to last confirmed values from selectedContext
      if (selectedContext && inspectorDef) {
        inspectorParams = Object.assign({}, (inspectorDef ? deps.getDefaultParams(inspectorDef) : {}), selectedContext.parameters || {});
        inspectorMaterialChoices = Object.assign({}, window.GraneteUI.materialRoles.defaultMaterialChoices(inspectorDef), selectedContext.materialChoices || {});
        deps.renderParamForm(inspectorParamsContainer, inspectorDef, inspectorParams, function (name, val, unit) {
          inspectorParams[name] = val;
          updateInspectorSummary();
          validateInteractiveClient(inspectorDef, inspectorParams);
        });
        window.GraneteUI.materialRoles.renderMaterialSelectors(inspectorMaterialsCard, inspectorMaterialsContainer, inspectorDef,
          inspectorMaterialChoices, function (role, id, s) {
            inspectorMaterialChoices[role] = id;
            if (s === "project" || s === "project_default") {
              window.GraneteUI.materialRoles.setProjectDefaultMaterial(role, id);
            }
          }, { context: "inspector", instanceId: selectedContext.furnitureInstanceRef, definitionId: selectedContext.furnitureDefinitionId });
        updateInspectorSummary();
      }
    }
  }

  function onSelectionChange(context) {
    requireDeps();
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
      inspectorMaterialChoices[role] = materialId;

      window.GraneteUI.materialRoles.renderMaterialSelectors(inspectorMaterialsCard, inspectorMaterialsContainer, inspectorDef,
        inspectorMaterialChoices, function (r, id, s) {
          inspectorMaterialChoices[r] = id;
          if (s === "project" || s === "project_default") {
            window.GraneteUI.materialRoles.setProjectDefaultMaterial(r, id);
          }
        }, { context: "inspector", instanceId: selectedContext.furnitureInstanceRef, definitionId: selectedContext.furnitureDefinitionId });
      updateInspectorSummary();

      var updatePayload = {
        instanceId: selectedContext.furnitureInstanceRef,
        definitionId: selectedContext.furnitureDefinitionId,
        parameters: inspectorParams,
        materialChoices: inspectorMaterialChoices
      };

      if (window.sketchup && window.sketchup.update_furniture) {
        btnUpdate.disabled = true;
        btnUpdate.innerHTML = deps.icon("clock") + "<span>Actualizando…</span>";
        window.sketchup.update_furniture(JSON.stringify(updatePayload));
      } else {
        var mat = window.GraneteUI.materialRoles.materialById(materialId);
        var toastMsg = isProjectScope
          ? "✓ Acabado temporal de sesión: " + (mat ? mat.name : materialId)
          : "✓ Acabado actualizado: " + (mat ? mat.name : materialId);
        deps.showToast("success", toastMsg);
      }
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
    activateInspectorTab: activateInspectorTab,
    // Read-only accessors consumed by the bootstrap wiring (material
    // roles context payload fallback; inline manufacturing/preflight
    // runtime adapters). Dep-free: they only read module state.
    getSelectedContext: function () { return selectedContext; },
    getDefinition: function () { return inspectorDef; },
    getMaterialsCard: function () { return inspectorMaterialsCard; },
    setHardwareCatalog: setHardwareCatalog,
    getHardwareCatalog: function () { return catalogHardware; }
  };
})();
