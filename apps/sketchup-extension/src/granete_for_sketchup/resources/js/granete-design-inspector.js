// #784 R1 — Design Inspector READ module under window.GraneteUI.
// Owns:
// - the Design Inspector read state: binding identity subset (connected +
//   designId + names, render copies only — the binding authority stays in
//   js/granete-model-binding.js), the durable authoring defaults payload
//   (from the DesignInspectorBridge get_design_defaults read), the
//   request correlation token and the honest render states
//   (loading / ready / empty defaults / unknown material / error+retry)
//
// Does NOT own:
// - the material catalog or role labels (injected: materialById,
//   getRoleLabel single implementations), the binding truth, the selection
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
    requestId: 0
  };

  var view = null;
  var bodyEl = null;
  var designNameEl = null;
  var projectNameEl = null;
  var retryEl = null;

  function elements() {
    if (!view) {
      view = document.getElementById("inspector-design-view");
      bodyEl = document.getElementById("design-inspector-body");
      designNameEl = document.getElementById("design-inspector-design-name");
      projectNameEl = document.getElementById("design-inspector-project-name");
      retryEl = document.getElementById("design-inspector-retry");
      if (retryEl) {
        retryEl.addEventListener("click", function () {
          requestDefaults(true);
          render();
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

  function renderRow(role, materialId) {
    var material = deps.materialById(materialId);
    var label = deps.getRoleLabel(role);
    var value = material && material.name
      ? material.name
      : null;
    var row = document.createElement("div");
    row.className = "design-insp-row";
    var roleEl = document.createElement("span");
    roleEl.className = "design-insp-role";
    roleEl.textContent = label;
    var valueEl = document.createElement("span");
    valueEl.className = "design-insp-value";
    if (value) {
      valueEl.textContent = value;
    } else {
      valueEl.textContent = "Material no disponible en el catálogo actual";
      valueEl.title = materialId;
      valueEl.className = "design-insp-value design-insp-unavailable";
    }
    row.appendChild(roleEl);
    row.appendChild(valueEl);
    return row;
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
    if (!elements() || !state.connected) return;
    designNameEl.textContent = state.designName || "";
    projectNameEl.textContent = state.projectName || "";
    renderBody();
    view.style.display = "block";
  }

  function hide() {
    if (!elements()) return;
    view.style.display = "none";
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
      } else {
        state.designId = binding.designId;
        state.projectId = binding.projectId || null;
        state.projectName = binding.projectName || "";
        state.designName = binding.designName || "";
        if (designChanged) {
          state.defaults = {};
          state.workingVersion = null;
          state.status = "idle";
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
        state.defaults = choices;
        state.workingVersion = payload.workingVersion || null;
        state.status = "ready";
        render();
      } else if (payload.status === "error") {
        state.status = "error";
        render();
      } else if (payload.status === "unbound" || payload.status === "stale_binding") {
        // The model is no longer bound to the requested design: drop the
        // cached payload; the next binding status re-establishes truth.
        state.defaults = {};
        state.workingVersion = null;
        state.status = "idle";
      }
    },

    hide: hide,
    render: render
  };
})();
