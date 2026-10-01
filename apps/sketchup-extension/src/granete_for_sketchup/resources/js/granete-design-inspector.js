// #784 R1 — Design Inspector READ module under window.GraneteUI.
// Owns:
// - the Design Inspector read state: binding identity subset (connected +
//   designId + names, render copies only — the binding authority stays in
//   js/granete-model-binding.js), the durable authoring defaults payload
//   (from the DesignInspectorBridge get_design_defaults read), the
//   request correlation token, the presentation-only laneActive guard
//   (hide() relinquishes the lane; render() is a no-op while inactive —
//   responses only refresh the cache, never reopen the view) and the
//   honest render states (loading / ready / empty defaults / unknown
//   material / error+retry)
//
// Does NOT own:
// - the material catalog or role labels (injected: materialById,
//   getRoleLabel, optional getMaterials for the picker's catalog-wide
//   fallback of roles no definition offers — presentation only), the
//   binding truth, the selection
//   truth (js/granete-inspector.js routes the no-selection lane here), any
//   write surface (R1 is READ: the only bridge call it may issue is
//   get_design_defaults; working-copy PUTs/host mutations never happen)
// - session defaults: projectDefaultMaterials in
//   js/granete-material-roles.js stays explicitly TEMPORARY and is never a
//   source of truth here
//
// Consumes:
// - window.sketchup.get_design_defaults(requestId/designId JSON) — the
//   Ruby DesignInspectorBridge answers through GraneteDialog.onDesignDefaults
//   with the same requestId so late responses of a previous design are
//   discarded client-side (#784 design switch).
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.designInspector) return;

  var deps = {};
  var state = {
    connected: false,
    designId: null,
    projectId: null,
    projectName: "",
    designName: "",
    status: "idle", // idle | loading | ready | error
    defaults: {},   // role -> material id (durable authoring_defaults)
    workingVersion: null,
    requestId: 0,
    // Presentation-only lane guard (#784 R1 final review): true while the
    // no-selection lane BELONGS to the Design Inspector. hide() relinquishes
    // it (Furniture/Child/Batch own the Inspector then) and render() becomes
    // a no-op — late answers only refresh the cache, they never reopen the
    // view. handleNoSelection() re-claims it.
    laneActive: false,
    // #784 R2: the LOCAL pending draft (role -> material id). It never
    // touches the backend until the explicit Aplicar — one PUT with the
    // client's workingVersion token; the draft clears only on a confirmed
    // answer. Descartar clears it read-only.
    draft: {},
    // #784 R2 final review: the draft is PINNED to the working-copy
    // version it started on. draftBase = {version, defaults} captured at
    // the first pending edit; the render and the Apply token both ride
    // that base. An external newer read NEVER silently rebases the draft —
    // it only flags draftStale so the user sees the honest divergence (the
    // bridge remains the authority that refuses a stale token).
    draftBase: null,
    draftStale: false,
    // #784 R3: the server-side per-item inheritance projection
    // {furnitureInstanceId: {role: {mode, applied, designDefault, needsRollout}}}
    // — the ONLY badge authority. Never derived client-side.
    inheritance: {},
    // #784 R5: the server-side inheritance summary and items projection
    // inheritanceSummary: { role: { role, items, designBacked, needsRollout, designCurrent, overridden } }
    inheritanceSummary: {},
    inheritanceItems: [],
    totalDesignItems: 0,
    // #784 R2 final review: one user Apply = exactly one apply request.
    // True from applyDraft() until its correlated answer (or the no-bridge
    // fallback) lands; a binding switch invalidates the in-flight request.
    applyInFlight: false
  };

  var view = null;
  var bodyEl = null;
  var designNameEl = null;
  var projectNameEl = null;
  var retryEl = null;
  var footerEl = null;
  var pendingEl = null;
  var discardEl = null;
  var applyEl = null;

  function elements() {
    if (!view) {
      view = document.getElementById("inspector-design-view");
      bodyEl = document.getElementById("design-inspector-body");
      designNameEl = document.getElementById("design-inspector-design-name");
      projectNameEl = document.getElementById("design-inspector-project-name");
      retryEl = document.getElementById("design-inspector-retry");
      footerEl = document.getElementById("design-inspector-footer");
      pendingEl = document.getElementById("design-inspector-pending");
      discardEl = document.getElementById("design-inspector-discard");
      applyEl = document.getElementById("design-inspector-apply");
      if (retryEl) {
        retryEl.addEventListener("click", function () {
          requestDefaults(true);
          render();
        });
      }
      if (discardEl) {
        discardEl.addEventListener("click", function () {
          discardDraft();
        });
      }
      if (applyEl) {
        applyEl.addEventListener("click", function () {
          applyDraft();
        });
      }
    }
    return view;
  }

  function requireDeps() {
    var missing = ["getRoleLabel", "materialById", "rerenderInspector"].filter(function (name) {
      return typeof deps[name] !== "function";
    });
    if (missing.length > 0) {
      throw new Error("GraneteUI.designInspector.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  function hasDeps(names) {
    return names.every(function (name) { return typeof deps[name] === "function"; });
  }

  // The ONLY bridge call of R1: a read. Correlation = monotonically growing
  // requestId + the current designId; late or foreign responses are
  // discarded in onDesignDefaults.
  function requestDefaults(fresh) {
    requireDeps();
    if (!state.connected || !state.designId) return;
    state.requestId += 1;
    if (fresh || state.status !== "ready") state.status = "loading";
    var payload = { requestId: state.requestId, designId: state.designId };
    if (window.sketchup && typeof window.sketchup.get_design_defaults === "function") {
      window.sketchup.get_design_defaults(JSON.stringify(payload));
    } else {
      state.status = "error";
    }
  }

  // #784 R3: correlated read of the inheritance projection. A fresh read
  // burns a new requestId so any stale answer of a previous generation is
  // discarded by the correlation guard in onDesignInheritance.
  function requestInheritance(fresh) {
    requireDeps();
    if (!state.connected || !state.designId) return;
    if (fresh) state.requestId += 1;
    var inheritancePayload = { requestId: state.requestId, designId: state.designId };
    if (window.sketchup && typeof window.sketchup.get_design_inheritance === "function") {
      window.sketchup.get_design_inheritance(JSON.stringify(inheritancePayload));
    }
  }

  function materialName(materialId) {
    var material = deps.materialById(materialId);
    return material && material.name ? material.name : null;
  }

  function applyMaterialPick(role, pickedId) {
    if (!role) return;
    var materialId = state.defaults ? state.defaults[role] : null;
    if (!pickedId || pickedId === materialId) {
      delete state.draft[role];
    } else {
      state.draft[role] = pickedId;
    }
    if (pendingCount() > 0 && !state.draftBase) {
      // First pending edit pins the draft to the current version.
      state.draftBase = { version: state.workingVersion, defaults: shallowCopy(state.defaults) };
      state.draftStale = false;
    }
    if (pendingCount() === 0) {
      // The draft dissolved back to the durable state: drop the base.
      state.draftBase = null;
      state.draftStale = false;
    }
    render();
  }

  function renderRow(role, materialId) {
    var label = deps.getRoleLabel(role);
    var row = document.createElement("div");
    row.className = "design-insp-row material-role-block";

    var header = document.createElement("div");
    header.className = "material-role-header";

    var roleEl = document.createElement("span");
    roleEl.className = "material-role-title design-insp-role";
    roleEl.textContent = label;
    header.appendChild(roleEl);

    var drafted = state.draft[role];
    var baseChoices = (state.draftBase && state.draftBase.defaults) || state.defaults;

    var changeBtn = null;
    if (hasDeps(["getRoleCandidates", "openMaterialPicker"])) {
      changeBtn = document.createElement("button");
      changeBtn.id = "design-inspector-change-" + role;
      changeBtn.className = "btn btn-secondary btn-sm design-insp-change";
      changeBtn.style.width = "auto";
      changeBtn.style.padding = "2px 10px";
      changeBtn.style.fontSize = "var(--text-xs)";
      changeBtn.style.lineHeight = "1.4";
      changeBtn.textContent = materialId || drafted ? "Cambiar" : "Asignar";
      changeBtn.addEventListener("click", function (evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        var candidates = deps.getRoleCandidates(role);
        var curatedCandidates = (candidates && candidates.length > 0) ? candidates : [];
        var roleCandidates = curatedCandidates;
        if (roleCandidates.length === 0 && hasDeps(["getMaterials"])) {
          roleCandidates = deps.getMaterials().map(function (material) { return material.id || material.materialId; });
        }
        var roleEntry = { role: role, label: label, optionIds: roleCandidates || [] };
        if (window.sketchup && typeof window.sketchup.open_material_selector === "function") {
          window.sketchup.open_material_selector(JSON.stringify({
            role: role,
            roleName: label || role,
            currentMaterialId: drafted || materialId || null,
            context: "design",
            allowedMaterialIds: curatedCandidates
          }));
        } else {
          deps.openMaterialPicker(roleEntry, drafted || materialId, function (pickedId) {
            applyMaterialPick(role, pickedId);
          });
        }
      });
      header.appendChild(changeBtn);
    }
    row.appendChild(header);

    // Selected Preview card (interactive)
    var preview = document.createElement("div");
    preview.className = "material-selected-preview";
    preview.title = "Clic para abrir el catálogo de acabados";
    preview.setAttribute("role", "button");
    preview.setAttribute("tabindex", "0");
    preview.setAttribute("aria-label", (materialId || drafted ? "Cambiar" : "Asignar") + " acabado de " + label);

    var currentMatId = drafted || materialId;
    var currentMat = currentMatId ? deps.materialById(currentMatId) : null;

    var swatch = document.createElement("div");
    swatch.className = "material-swatch";
    if (typeof deps.updateMaterialSwatch === "function") {
      deps.updateMaterialSwatch(swatch, currentMat);
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
    valueEl.className = "material-selected-name design-insp-value";

    if (drafted && drafted !== baseChoices[role]) {
      var from = (baseChoices[role] && (materialName(baseChoices[role]) || baseChoices[role])) || "Sin asignar";
      var to = materialName(drafted) || drafted;
      valueEl.textContent = from + " → " + to;
      valueEl.title = drafted;
      valueEl.className += " design-insp-draft";
    } else if (materialId) {
      var value = materialName(materialId);
      if (value) {
        valueEl.textContent = value;
      } else {
        valueEl.textContent = "Material no disponible en el catálogo actual";
        valueEl.title = materialId;
        valueEl.className += " design-insp-unavailable";
      }
    } else {
      valueEl.textContent = "Sin default asignado";
      valueEl.className += " design-insp-unassigned";
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
    } else {
      metaEl.textContent = "Clic para elegir un acabado del catálogo";
    }
    info.appendChild(metaEl);
    preview.appendChild(info);

    var chevron = document.createElement("span");
    chevron.className = "material-chevron";
    if (typeof deps.icon === "function") {
      chevron.innerHTML = deps.icon("chevron-right", 16);
    } else {
      chevron.textContent = "›";
    }
    preview.appendChild(chevron);

    preview.addEventListener("click", function () {
      if (changeBtn) {
        changeBtn.click();
      }
    });

    row.appendChild(preview);

    // #784 R5: explicit rollout action to roll the default across existing furniture
    var summary = state.inheritanceSummary && state.inheritanceSummary[role];
    var effectiveMatId = materialId || drafted;
    if (effectiveMatId && summary && summary.items > 0) {
      var rolloutBtn = document.createElement("button");
      rolloutBtn.id = "design-inspector-rollout-" + role;
      rolloutBtn.className = "btn btn-secondary btn-sm design-insp-rollout";
      rolloutBtn.style.width = "100%";
      rolloutBtn.style.marginTop = "var(--space-2)";
      rolloutBtn.style.fontSize = "var(--text-xs)";
      rolloutBtn.style.padding = "var(--space-2) var(--space-3)";
      rolloutBtn.textContent = "Aplicar a muebles existentes…";
      if (pendingCount() > 0) {
        rolloutBtn.disabled = true;
        rolloutBtn.title = "Aplica o descarta los cambios pendientes del diseño primero";
      } else {
        rolloutBtn.addEventListener("click", function () {
          openImpactReviewModal(role);
        });
      }
      row.appendChild(rolloutBtn);
    }
    return row;
  }

  function ensureRolloutElements() {
    var modal = document.getElementById("design-rollout-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "design-rollout-modal";
      modal.className = "selector-modal-backdrop";
      modal.style.display = "none";
      if (document.body && typeof document.body.appendChild === "function") {
        document.body.appendChild(modal);
      }
    }
    var title = document.getElementById("design-rollout-modal-title") || document.createElement("h2");
    title.id = "design-rollout-modal-title";
    var closeBtn = document.getElementById("btn-design-rollout-close") || document.createElement("button");
    closeBtn.id = "btn-design-rollout-close";
    var statsContainer = document.getElementById("design-rollout-stats") || document.createElement("div");
    statsContainer.id = "design-rollout-stats";
    var scopePreserve = document.getElementById("rollout-scope-preserve") || document.createElement("input");
    scopePreserve.id = "rollout-scope-preserve";
    scopePreserve.type = "radio";
    scopePreserve.name = "design-rollout-scope";
    scopePreserve.value = "preserve";
    var scopeReplace = document.getElementById("rollout-scope-replace") || document.createElement("input");
    scopeReplace.id = "rollout-scope-replace";
    scopeReplace.type = "radio";
    scopeReplace.name = "design-rollout-scope";
    scopeReplace.value = "replace";
    var cancelBtn = document.getElementById("btn-design-rollout-cancel") || document.createElement("button");
    cancelBtn.id = "btn-design-rollout-cancel";
    var applyBtn = document.getElementById("btn-design-rollout-apply") || document.createElement("button");
    applyBtn.id = "btn-design-rollout-apply";

    return {
      modal: modal,
      title: title,
      closeBtn: closeBtn,
      statsContainer: statsContainer,
      scopePreserve: scopePreserve,
      scopeReplace: scopeReplace,
      cancelBtn: cancelBtn,
      applyBtn: applyBtn
    };
  }

  function hideRolloutModal() {
    var modal = document.getElementById("design-rollout-modal");
    if (modal) modal.style.display = "none";
  }

  function openImpactReviewModal(role) {
    var els = ensureRolloutElements();
    var materialId = state.defaults[role];
    var matName = materialName(materialId) || materialId;
    var label = (typeof deps.getRoleLabel === "function" && deps.getRoleLabel(role)) || role;
    var summary = (state.inheritanceSummary && state.inheritanceSummary[role]) || { items: 0 };
    var compatible = summary.items || 0;
    var total = state.totalDesignItems || compatible;
    var unsupported = Math.max(0, total - compatible);

    // Counts and the batch selection derive from the SAME per-item server
    // projection (explicit modes; equality only decides whether a value
    // still differs, mirroring the server's own needsRollout rule), so the
    // modal can never promise a count the dispatch then misses.
    var inheritCount = 0;
    var definitionCount = 0;
    var customCount = 0;
    (state.inheritanceItems || []).forEach(function (item) {
      var r = item.roles && item.roles[role];
      if (!r) return;
      if (r.mode === "design" && r.needsRollout === true) inheritCount += 1;
      else if (r.mode === "definition" && r.applied !== materialId) definitionCount += 1;
      else if (r.mode === "override") customCount += 1;
    });

    els.title.textContent = "Aplicar " + matName + " a " + label;

    els.statsContainer.innerHTML = "";
    var stat1 = document.createElement("div");
    stat1.id = "rollout-stat-compatible";
    stat1.className = "rollout-stat";
    stat1.textContent = compatible + (compatible === 1 ? " mueble compatible" : " muebles compatibles");
    els.statsContainer.appendChild(stat1);

    var stat2 = document.createElement("div");
    stat2.id = "rollout-stat-inherit";
    stat2.className = "rollout-stat";
    stat2.textContent = inheritCount + (inheritCount === 1 ? " heredará/cambiará" : " heredarán/cambiarán");
    els.statsContainer.appendChild(stat2);

    // #784 R5: definition-backed furniture materialized the curated
    // fallback at insertion (nobody chose it); the rollout adopts the
    // design default for them and the impact review says so explicitly.
    var statDefinition = document.createElement("div");
    statDefinition.id = "rollout-stat-definition";
    statDefinition.className = "rollout-stat";
    statDefinition.textContent = definitionCount +
      (definitionCount === 1 ? " usará el default del diseño (fallback de definición)" : " usarán el default del diseño (fallback de definición)");
    els.statsContainer.appendChild(statDefinition);

    var stat3 = document.createElement("div");
    stat3.id = "rollout-stat-custom";
    stat3.className = "rollout-stat";
    stat3.textContent = customCount + (customCount === 1 ? " tiene personalización" : " tienen personalización");
    els.statsContainer.appendChild(stat3);

    var stat4 = document.createElement("div");
    stat4.id = "rollout-stat-unsupported";
    stat4.className = "rollout-stat";
    stat4.textContent = unsupported + (unsupported === 1 ? " no admite este rol" : " no admiten este rol");
    els.statsContainer.appendChild(stat4);

    els.scopePreserve.checked = true;
    els.scopeReplace.checked = false;

    function updateApplyButton() {
      var isPreserve = els.scopePreserve.checked;
      var count = isPreserve ? (inheritCount + definitionCount) : (inheritCount + definitionCount + customCount);
      els.applyBtn.textContent = "Aplicar a " + count;
      els.applyBtn.disabled = (count === 0);
    }

    updateApplyButton();

    els.scopePreserve.onchange = updateApplyButton;
    els.scopeReplace.onchange = updateApplyButton;

    els.closeBtn.onclick = hideRolloutModal;
    els.cancelBtn.onclick = hideRolloutModal;

    els.applyBtn.onclick = function () {
      if (els.applyBtn.disabled) return;
      var isPreserve = els.scopePreserve.checked;
      var targetItems = [];
      (state.inheritanceItems || []).forEach(function (item) {
        var r = item.roles && item.roles[role];
        if (!r) return;
        // Preserve scope: everything that is NOT an explicit user exception —
        // design-lineage items behind the default AND definition-fallback
        // items still carrying a different value both adopt the design
        // default. Replace scope additionally forces explicit overrides.
        var shouldInclude = isPreserve
          ? ((r.mode === "design" && r.needsRollout === true) ||
             (r.mode === "definition" && r.applied !== materialId))
          : ((r.mode === "design" && r.needsRollout === true) ||
             (r.mode === "definition" && r.applied !== materialId) ||
             r.mode === "override");
        if (shouldInclude) {
          var choices = {};
          choices[role] = materialId;
          var modes = {};
          modes[role] = "design";
          targetItems.push({
            instanceId: item.furnitureInstanceId,
            definitionId: item.furnitureDefinitionId,
            materialChoices: choices,
            materialChoiceModes: modes
          });
        }
      });

      if (targetItems.length === 0) {
        hideRolloutModal();
        return;
      }

      if (window.GraneteMutation && typeof window.GraneteMutation.submitBatchUpdate === "function") {
        var result = window.GraneteMutation.submitBatchUpdate(targetItems);
        if (result === "busy") {
          if (typeof deps.showToast === "function") deps.showToast("error", "Ya hay una mutación en curso.");
          return;
        }
        if (result === "unavailable") {
          if (typeof deps.showToast === "function") {
            deps.showToast("error", "La edición por lote no está disponible fuera de SketchUp.");
          }
          return;
        }
      }
      hideRolloutModal();
    };

    els.modal.style.display = "flex";
  }

  // ANY real binding change (design switch or unbound) invalidates every
  // in-flight request — reads AND applies. A late answer of the previous
  // design can never pass the requestId correlation again, so it can never
  // run a fail-closed, show a conflict or alter the new design's state.
  function invalidateBindingRequests() {
    state.requestId += 1;
    state.applyInFlight = false;
  }

  function pendingCount() {
    var count = 0;
    for (var role in state.draft) {
      if (state.defaults[role] !== state.draft[role]) count += 1;
    }
    return count;
  }

  function renderFooter() {
    if (!footerEl) return;
    var pending = pendingCount();
    var conflict = state.conflict;
    var visible = state.laneActive && state.connected &&
      (pending > 0 || !!conflict);
    footerEl.style.display = visible ? "block" : "none";
    if (!visible) {
      // A hidden footer must not leave a stale disabled state behind.
      applyEl.disabled = false;
      return;
    }
    if (conflict) {
      pendingEl.textContent = conflict;
      applyEl.disabled = true;
    } else if (state.draftStale) {
      pendingEl.textContent = "El diseño cambió en el servidor; tus cambios quedaron sobre la versión anterior.";
      applyEl.disabled = false;
    } else {
      pendingEl.textContent = pending === 1 ? "1 cambio pendiente" : pending + " cambios pendientes";
      // #784 R2 final review: Aplicar disabled while the apply is in flight.
      applyEl.disabled = state.applyInFlight;
    }
  }

  function renderBody() {
    bodyEl.innerHTML = "";
    if (state.status === "loading") {
      var loading = document.createElement("p");
      loading.className = "design-insp-state";
      loading.textContent = "Cargando configuración del Diseño…";
      bodyEl.appendChild(loading);
      return;
    }
    if (state.status === "error") {
      var error = document.createElement("p");
      error.className = "design-insp-state design-insp-error";
      error.textContent = "No se pudo cargar la configuración del Diseño.";
      bodyEl.appendChild(error);
      if (retryEl) retryEl.style.display = "inline-block";
      return;
    }
    if (retryEl) retryEl.style.display = "none";
    if (state.conflict) {
      var conflictNote = document.createElement("p");
      conflictNote.className = "design-insp-state design-insp-error";
      conflictNote.textContent = state.conflict;
      bodyEl.appendChild(conflictNote);
    }

    function discoveredRoles() {
      var set = {};
      var list = [];
      function addRole(r) {
        if (r && !set[r]) {
          set[r] = true;
          list.push(r);
        }
      }
      for (var k in state.defaults) addRole(k);
      for (var d in state.draft) addRole(d);
      if (state.inheritanceSummary) {
        for (var s in state.inheritanceSummary) addRole(s);
      }
      if (typeof deps.getAvailableRoles === "function") {
        var avail = deps.getAvailableRoles() || [];
        for (var j = 0; j < avail.length; j++) addRole(avail[j]);
      }
      return list.sort();
    }

    var roles = discoveredRoles();
    if (roles.length === 0) {
      var empty = document.createElement("p");
      empty.className = "design-insp-state";
      empty.textContent = "Sin defaults configurados todavía";
      bodyEl.appendChild(empty);
    } else {
      for (var i = 0; i < roles.length; i++) {
        bodyEl.appendChild(renderRow(roles[i], state.defaults[roles[i]]));
      }
    }
    var note = document.createElement("p");
    note.className = "design-insp-note";
    note.textContent = "Estos valores se usarán como defaults del Diseño.";
    bodyEl.appendChild(note);
  }

  function render() {
    if (!state.laneActive || !elements() || !state.connected) return;
    designNameEl.textContent = state.designName || "";
    projectNameEl.textContent = state.projectName || "";
    renderBody();
    renderFooter();
    view.style.display = "block";
  }

  function hide() {
    state.laneActive = false;
    if (!elements()) return;
    view.style.display = "none";
  }

  // #784 R2: Descartar is read-only — it clears the LOCAL draft only.
  function discardDraft() {
    state.draft = {};
    state.draftBase = null;
    state.draftStale = false;
    state.conflict = null; // a fresh start after a deliberate discard
    render();
  }

  function shallowCopy(map) {
    var copy = {};
    for (var key in map) copy[key] = map[key];
    return copy;
  }

  // #784 R2: Aplicar — exactly ONE working-copy PUT with the client's
  // workingVersion token and the merged durable ∪ draft block. The answer
  // (onDesignDefaultsApplied) clears the draft only on success.
  function applyDraft() {
    requireDeps();
    if (state.applyInFlight) return; // one user Apply = one request
    var pending = pendingCount();
    if (pending === 0 || !state.connected) return;
    // #784 R2 final review: the Apply token is the DRAFT BASE version —
    // the working copy state the pending edits were made against — never
    // a silently refreshed newer version.
    var token = (state.draftBase && state.draftBase.version) || state.workingVersion;
    if (!token) return;
    var merged = {};
    var baseChoices = (state.draftBase && state.draftBase.defaults) || state.defaults;
    for (var role in baseChoices) merged[role] = baseChoices[role];
    for (var draftRole in state.draft) merged[draftRole] = state.draft[draftRole];
    state.requestId += 1;
    state.conflict = null;
    state.applyInFlight = true;
    render(); // Aplicar disabled immediately
    var payload = {
      requestId: state.requestId,
      designId: state.designId,
      expectedWorkingVersion: token,
      authoringDefaults: { materialChoices: merged }
    };
    if (window.sketchup && typeof window.sketchup.apply_design_defaults === "function") {
      window.sketchup.apply_design_defaults(JSON.stringify(payload));
    } else {
      state.applyInFlight = false;
      state.conflict = "Granete no está disponible en este momento.";
      render();
    }
  }

  return window.GraneteUI.designInspector = {
    init: function (injected) { deps = injected || {}; },

    // The binding status fan-out (from the onModelBindingStatus
    // orchestrator). Render-copy identity only; the binding authority
    // stays in the model binding module. A design switch INVALIDATES the
    // cached defaults: the previous design's values stop being truth.
    onBindingStatus: function (status) {
      var binding = (status && status.binding) || {};
      var connected = !!(status && status.state === "connected" && binding.designId);
      var designChanged = connected && state.designId !== binding.designId;
      state.connected = connected;
      if (!connected) {
        state.designId = null;
        state.defaults = {};
        state.workingVersion = null;
        state.status = "idle";
        state.draft = {};
        state.draftBase = null;
        state.draftStale = false;
        state.conflict = null;
        state.inheritance = {};
        state.inheritanceSummary = {};
        state.inheritanceItems = [];
        state.totalDesignItems = 0;
        hideRolloutModal();
        // The authority is gone: every in-flight request is dead.
        invalidateBindingRequests();
      } else {
        state.designId = binding.designId;
        state.projectId = binding.projectId || null;
        state.projectName = binding.projectName || "";
        state.designName = binding.designName || "";
        if (designChanged) {
          state.defaults = {};
          state.workingVersion = null;
          state.status = "idle";
          state.draft = {};
          state.draftBase = null;
          state.draftStale = false;
          state.conflict = null;
          state.inheritance = {};
          state.inheritanceSummary = {};
          state.inheritanceItems = [];
          state.totalDesignItems = 0;
          hideRolloutModal();
          // A design switch kills every in-flight request of the old one.
          invalidateBindingRequests();
        }
      }
      if (typeof deps.rerenderInspector === "function") deps.rerenderInspector();
    },

    // Called by the inspector when the selection lane is empty. Returns
    // true when the Design Inspector takes the lane (bound Design); false
    // keeps the legacy empty state (unbound). #846 loading policy: a
    // cached ready payload renders immediately (no flash), with at most
    // one silent refresh in flight.
    handleNoSelection: function () {
      if (!state.connected) {
        hide();
        return false;
      }
      state.laneActive = true;
      if (pendingCount() > 0) {
        // #784 R2 final review: a pending draft is pinned to its base
        // version — silent refreshes are SUPPRESSED so the working copy
        // can never drift under the draft before Apply.
        render();
        return true;
      }
      if (state.status === "ready") {
        requestDefaults(false); // silent refresh, keeps rendered values
      } else {
        requestDefaults(true);
      }
      render();
      return true;
    },

    // Bridge answer. Discards anything that is not the CURRENT request of
    // the CURRENT design — late responses of a previous design can never
    // overwrite the switch target.
    onDesignDefaults: function (payload) {
      if (!payload || payload.requestId !== state.requestId) return;
      if (payload.status === "ready") {
        if (!state.connected || payload.designId !== state.designId) return;
        var choices = (payload.authoringDefaults && payload.authoringDefaults.materialChoices) || {};
        if (state.draftBase && payload.workingVersion !== state.draftBase.version) {
          // A pinned draft exists and the server moved on: the draft is
          // NEVER rebased. Keep the base as the on-screen truth, flag the
          // divergence honestly; the bridge refuses a stale token at Apply.
          state.draftStale = true;
          render();
          return;
        }
        state.defaults = choices;
        state.workingVersion = payload.workingVersion || null;
        state.status = "ready";
        state.conflict = null;
        requestInheritance();
        render();
      } else if (payload.status === "error") {
        state.status = "error";
        render();
      } else if (payload.status === "unbound" || payload.status === "stale_binding") {
        // The model is no longer bound to the requested design. FAIL CLOSED
        // immediately: the rendered values of the previous design can never
        // stay on screen. Clear the cached identity AND defaults (the
        // stale_binding's own designId is NEVER adopted here —
        // onModelBindingStatus is the only binding authority), mark
        // disconnected, hide the view and rerender the Inspector into the
        // safe empty/binding lane. No authority means no re-fetch either.
        state.connected = false;
        state.designId = null;
        state.projectId = null;
        state.projectName = "";
        state.designName = "";
        state.defaults = {};
        state.workingVersion = null;
        state.status = "idle";
        hide();
        if (typeof deps.rerenderInspector === "function") deps.rerenderInspector();
      }
    },

    // #784 R2: the apply answer. Correlated like the reads — a late or
    // foreign answer never touches the draft. ok refreshes the cached
    // defaults + workingVersion and clears the draft; conflict keeps the
    // draft and shows the honest reason (no fake success); the
    // unbound/stale_binding shapes fail closed exactly like the reads.
    onDesignDefaultsApplied: function (payload) {
      // Foreign/late answers (a switched or unbound binding invalidates the
      // requestId) are fully ignored — they can never touch the current
      // inspector's state or release its guard.
      if (!payload || payload.requestId !== state.requestId) return;
      state.applyInFlight = false;
      if (payload.status === "ok") {
        if (!state.connected || payload.designId !== state.designId) return;
        state.defaults = (payload.authoringDefaults && payload.authoringDefaults.materialChoices) || {};
        state.workingVersion = payload.workingVersion || state.workingVersion;
        state.draft = {};
        state.draftBase = null;
        state.draftStale = false;
        state.conflict = null;
        requestInheritance();
        render();
      } else if (payload.status === "conflict" || payload.status === "error") {
        state.conflict = payload.reason || "No se pudo aplicar el cambio.";
        render();
      } else if (payload.status === "unbound" || payload.status === "stale_binding") {
        state.connected = false;
        state.designId = null;
        state.projectId = null;
        state.projectName = "";
        state.designName = "";
        state.defaults = {};
        state.workingVersion = null;
        state.draft = {};
        state.draftBase = null;
        state.draftStale = false;
        state.conflict = null;
        state.status = "idle";
        hide();
        if (typeof deps.rerenderInspector === "function") deps.rerenderInspector();
      }
    },

    // #784 R3 final review: public refresh — called after a successful
    // furniture mutation so the badge returns to the authoritative server
    // projection (mode=design after a restore) instead of any local
    // inference. Reads only: it never mutates anything itself.
    refreshInheritance: function () {
      if (!state.connected || !state.designId) return;
      requestInheritance(true);
    },

    // #784 R3: the projection answer. Correlated; only the current design.
    onDesignInheritance: function (payload) {
      if (!payload || payload.requestId !== state.requestId) return;
      if (payload.status !== "ready" || !state.connected || payload.designId !== state.designId) return;
      var map = {};
      var itemsList = [];
      (payload.items || []).forEach(function (item) {
        var roles = {};
        (item.roles || []).forEach(function (entry) {
          roles[entry.role] = {
            mode: entry.mode,
            applied: entry.appliedMaterialId,
            designDefault: entry.designDefaultMaterialId || null,
            needsRollout: entry.needsRollout === true
          };
        });
        map[item.furnitureInstanceId] = roles;
        itemsList.push({
          furnitureInstanceId: item.furnitureInstanceId,
          furnitureDefinitionId: item.furnitureDefinitionId || null,
          roles: roles
        });
      });
      state.inheritance = map;
      state.inheritanceItems = itemsList;
      state.totalDesignItems = (payload.items || []).length;

      var summaryMap = {};
      (payload.inheritanceSummary || []).forEach(function (s) {
        summaryMap[s.role] = {
          role: s.role,
          items: s.items || 0,
          designBacked: s.designBacked || 0,
          definitionBacked: s.definitionBacked || 0,
          needsRollout: s.needsRollout || 0,
          designCurrent: s.designCurrent || 0,
          overridden: s.overridden || 0
        };
      });
      state.inheritanceSummary = summaryMap;

      if (!state.laneActive && typeof deps.rerenderInspector === "function") {
        deps.rerenderInspector();
      }
      if (state.laneActive) render();
    },

    // #784 R5: batch rollout outcome listener — when a batch update commits,
    // refresh the server inheritance projection so badges and rollout counts
    // update. The user-facing toast belongs to the #471 batch lane
    // (granete-inspector onBatchUpdateResult), which already reports every
    // outcome; duplicating it here would stack two identical toasts.
    onBatchUpdateResult: function (result) {
      if (result && result.success) {
        requestInheritance(true);
      }
    },

    openImpactReviewModal: openImpactReviewModal,
    ensureRolloutElements: ensureRolloutElements,

    // #784 R3: the ONLY badge authority accessor. Returns null when there
    // is no server projection for the item/role — never a guess.
    getRoleBadge: function (furnitureInstanceId, role) {
      var roles = state.inheritance[furnitureInstanceId];
      var entry = roles && roles[role];
      if (!entry) return null;
      if (entry.mode === "design") {
        return entry.needsRollout
          ? { text: "Diseño · pendiente de aplicar", kind: "pending" }
          : { text: "Diseño", kind: "design" };
      }
      if (entry.mode === "definition") {
        return { text: "Definición", kind: "definition" };
      }
      return { text: "Personalizado", kind: "override",
               designDefault: entry.designDefault || null };
    },

    // #784 R4: returns a copy of current design-scoped authoring defaults
    getDesignDefaults: function () {
      if (!state.connected || !state.designId) return {};
      var out = {};
      for (var k in state.defaults) {
        if (Object.prototype.hasOwnProperty.call(state.defaults, k)) {
          out[k] = state.defaults[k];
        }
      }
      return out;
    },

    applyMaterialPick: applyMaterialPick,
    hide: hide,
    render: render
  };
})();
