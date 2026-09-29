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

  function renderRow(role, materialId) {
    var label = deps.getRoleLabel(role);
    var row = document.createElement("div");
    row.className = "design-insp-row";
    var roleEl = document.createElement("span");
    roleEl.className = "design-insp-role";
    roleEl.textContent = label;

    var valueEl = document.createElement("span");
    valueEl.className = "design-insp-value";
    var drafted = state.draft[role];
    var baseChoices = (state.draftBase && state.draftBase.defaults) || state.defaults;
    if (drafted && drafted !== baseChoices[role]) {
      // #784 R2: pending edit renders honestly as old → new, where the
      // "old" is the DRAFT BASE value (never a silently rebased one).
      var from = materialName(baseChoices[role]) || baseChoices[role];
      var to = materialName(drafted) || drafted;
      valueEl.textContent = from + " → " + to;
      valueEl.title = drafted;
      valueEl.className = "design-insp-value design-insp-draft";
    } else {
      var value = materialName(materialId);
      if (value) {
        valueEl.textContent = value;
      } else {
        valueEl.textContent = "Material no disponible en el catálogo actual";
        valueEl.title = materialId;
        valueEl.className = "design-insp-value design-insp-unavailable";
      }
    }
    row.appendChild(roleEl);
    row.appendChild(valueEl);

    // #784 R2: the per-role change affordance opens the shared material
    // picker; the pick lands in the LOCAL draft, never in the backend.
    if (hasDeps(["getRoleCandidates", "openMaterialPicker"])) {
      var changeBtn = document.createElement("button");
      changeBtn.id = "design-inspector-change-" + role;
      changeBtn.className = "btn design-insp-change";
      changeBtn.textContent = "Cambiar";
      changeBtn.addEventListener("click", function () {
        var candidates = deps.getRoleCandidates(role);
        if ((!candidates || candidates.length === 0) && hasDeps(["getMaterials"])) {
          // #784 R2 P2: a role no definition offers falls back to the whole
          // catalog — SOLO presentation/picker; the backend stays the
          // authority for what is valid.
          candidates = deps.getMaterials().map(function (material) { return material.id; });
        }
        var roleEntry = { role: role, label: label, optionIds: candidates };
        deps.openMaterialPicker(roleEntry, drafted || materialId, function (pickedId) {
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
        });
      });
      row.appendChild(changeBtn);
    }
    return row;
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

    var roles = Object.keys(state.defaults).sort();
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
      });
      state.inheritance = map;
      if (typeof deps.rerenderInspector === "function") deps.rerenderInspector();
    },

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

    hide: hide,
    render: render
  };
})();
