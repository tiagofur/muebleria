// #470 / SU-VIS-1 — the dialog-side manufacturing inspection controller:
// `Ver fabricación` mode for Granete-resolved machining. Renders the overlay
// state (mode/status/scope/features) the Ruby manager publishes, submits
// read-only inspection commands through the versioned bridge channel, and
// renders the feature inspector with provenance + `Ir al origen`.
//
// Behavior branches on state codes (off/current/stale/unavailable); copy is
// Spanish display-only. This view NEVER computes machining: holes,
// coordinates and provenance come exclusively from the authoritative
// resolve envelope. Idempotent: re-execution registers nothing twice.
(function () {
  "use strict";
  if (window.GraneteManufacturing) return;

  var INSPECTION_COMMANDS = ["set_mode", "select_feature", "set_filter", "navigate_to_source", "refresh"];

  var STATUS_COPY = {
    current: "Vigente",
    stale: "Desactualizada",
    unavailable: "No disponible"
  };

  function store() {
    return window.GraneteState || null;
  }

  function state() {
    var slice = store() ? store().get("manufacturing") : null;
    return slice || { mode: "off", status: "off", features: [] };
  }

  function selection() {
    return store() ? store().get("selection") : null;
  }

  function semanticTarget(context) {
    var ctx = context || selection() || {};
    var target = {};
    if (ctx.furnitureInstanceId) target.furnitureInstanceId = ctx.furnitureInstanceId;
    if (ctx.furnitureInstanceRef) target.furnitureInstanceRef = ctx.furnitureInstanceRef;
    if (ctx.componentInstanceId) target.componentInstanceId = ctx.componentInstanceId;
    return target;
  }

  // Submits a read-only inspection command. Returns "sent" or "unavailable"
  // (no host bridge / no semantic target). Never blocks on a mutation.
  function submit(command, payload, context) {
    if (INSPECTION_COMMANDS.indexOf(command) === -1) throw new Error("unknown inspection command: " + command);
    var host = window.sketchup;
    if (!host || typeof host.manufacturing_inspection !== "function") return "unavailable";
    var target = semanticTarget(context);
    if (Object.keys(target).length === 0 && command !== "set_mode") return "unavailable";

    var messageId = window.GraneteBridge ? window.GraneteBridge.nextMessageId() : ("insp-" + Date.now());
    var envelope = {
      schemaId: window.GraneteBridge ? window.GraneteBridge.SCHEMA_ID : "granete.sketchup-host-command.v1",
      type: "manufacturing_command",
      messageId: messageId,
      command: command,
      semanticTarget: target,
      payload: payload || {}
    };
    host.manufacturing_inspection(JSON.stringify(envelope));
    return "sent";
  }

  function statusBadge(current) {
    var el = document.getElementById("manufacturing-status-badge");
    if (!el) return;
    var status = current.status;
    if (status === "current") {
      el.textContent = STATUS_COPY.current;
      el.className = "status-badge valid";
    } else if (status === "stale") {
      el.textContent = STATUS_COPY.stale;
      el.className = "status-badge error";
    } else {
      el.textContent = STATUS_COPY.unavailable;
      el.className = "status-badge pending";
    }
  }

  function featureRow(feature, active) {
    var li = document.createElement("li");
    li.setAttribute("data-visual-id", feature.visualId);
    li.className = "manufacturing-feature" + (active ? " active" : "") + (feature.conflict ? " conflict" : "");
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");

    var main = document.createElement("span");
    main.textContent = feature.typeLabel + " Ø" + feature.diameterMm + " × " + feature.depthMm + " mm · cara " + feature.faceLabel;
    li.appendChild(main);

    var source = document.createElement("span");
    source.className = "manufacturing-feature-source";
    source.textContent = feature.sourceLabel;
    li.appendChild(source);

    if (feature.conflict) {
      var badge = document.createElement("span");
      badge.className = "status-badge error";
      badge.textContent = "Conflicto";
      li.appendChild(badge);
    }

    function activate() {
      window.GraneteManufacturing.selectFeature(feature.visualId);
    }
    li.addEventListener("click", activate);
    li.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    return li;
  }

  function renderFeatureList(current) {
    var list = document.getElementById("manufacturing-feature-list");
    if (!list) return;
    list.innerHTML = "";
    (current.features || []).forEach(function (feature) {
      list.appendChild(featureRow(feature, feature.visualId === current.activeFeatureId));
    });
    var empty = document.getElementById("manufacturing-empty-note");
    if (empty) {
      empty.style.display = (current.features || []).length === 0 ? "block" : "none";
    }
  }

  function renderDetail(current) {
    var detail = document.getElementById("manufacturing-detail");
    if (!detail) return;
    var feature = (current.features || []).find(function (f) {
      return f.visualId === current.activeFeatureId;
    });
    if (!feature) {
      detail.style.display = "none";
      return;
    }
    detail.style.display = "block";

    setText("manufacturing-detail-type", feature.typeLabel + " (perforación)");
    setText("manufacturing-detail-diameter", feature.diameterMm + " mm");
    setText("manufacturing-detail-depth", feature.depthMm + " mm");
    setText("manufacturing-detail-face", feature.faceLabel);
    setText("manufacturing-detail-host", feature.hostComponentInstanceId);
    setText("manufacturing-detail-position", "x " + feature.xMm + " mm · y " + feature.yMm + " mm");

    var sourceLabel = feature.sourceKind === "manualHardwarePlacement"
      ? "Colocación manual de herraje"
      : feature.sourceKind === "relationship"
        ? "Relación constructiva"
        : feature.sourceKind;
    setText("manufacturing-detail-source-kind", sourceLabel);
    setText("manufacturing-detail-source-id", feature.sourceLabel);

    var conflictBox = document.getElementById("manufacturing-detail-conflict");
    if (conflictBox) {
      if (feature.conflict) {
        conflictBox.style.display = "block";
        setText("manufacturing-detail-conflict-message", feature.conflict.message);
        setText("manufacturing-detail-conflict-remediation",
          feature.conflict.remediation || "Corregí el origen del conflicto y volvé a resolver.");
      } else {
        conflictBox.style.display = "none";
      }
    }

    var gotoBtn = document.getElementById("btn-manufacturing-goto-source");
    if (gotoBtn) {
      gotoBtn.style.display =
        feature.sourceKind === "manualHardwarePlacement" || feature.sourceKind === "relationship"
          ? "inline-flex" : "none";
    }
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value == null ? "--" : String(value);
  }

  function render() {
    var current = state();
    var card = document.getElementById("manufacturing-card");
    if (!card) return;

    var toggleBtn = document.getElementById("btn-manufacturing-toggle");
    if (toggleBtn) {
      var label = toggleBtn.querySelector("span");
      if (label) label.textContent = current.mode === "on" ? "Ocultar fabricación" : "Ver fabricación";
    }

    var body = document.getElementById("manufacturing-body");
    if (body) body.style.display = current.mode === "on" ? "block" : "none";

    if (current.mode !== "on") return;

    statusBadge(current);
    renderFeatureList(current);
    renderDetail(current);

    var staleNote = document.getElementById("manufacturing-stale-note");
    if (staleNote) {
      staleNote.style.display = current.status === "stale" ? "block" : "none";
    }
    var refreshBtn = document.getElementById("btn-manufacturing-refresh");
    if (refreshBtn) refreshBtn.style.display = current.status === "stale" ? "inline-flex" : "none";

    var unavailableNote = document.getElementById("manufacturing-unavailable-note");
    if (unavailableNote) {
      unavailableNote.style.display = current.status === "unavailable" ? "block" : "none";
      if (current.status === "unavailable" && current.unavailableReason) {
        unavailableNote.textContent = current.unavailableReason;
      }
    }

    var filterAll = document.getElementById("manufacturing-filter-all");
    var filterHoles = document.getElementById("manufacturing-filter-holes");
    if (filterAll) filterAll.disabled = current.filter === "all";
    if (filterHoles) filterHoles.disabled = current.filter === "holes";
  }

  window.GraneteManufacturing = {
    state: function () { return state(); },

    toggle: function (context) {
      var next = state().mode === "on" ? "off" : "on";
      return submit("set_mode", { mode: next }, context);
    },

    selectFeature: function (visualId) {
      return submit("select_feature", { visualId: visualId });
    },

    setFilter: function (filter) {
      return submit("set_filter", { filter: filter });
    },

    navigateToSource: function (visualId) {
      return submit("navigate_to_source", { visualId: visualId });
    },

    refresh: function () {
      return submit("refresh", {});
    },

    // Ruby→JS inspection state. Validated fail-closed before any view
    // consumes it; a malformed envelope is ignored, never guessed.
    handleManufacturingState: function (raw) {
      var envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
      var check = window.GraneteBridge ? window.GraneteBridge.validate(envelope, "manufacturing_state")
                                       : { ok: false, reason: "no_bridge" };
      if (!check.ok) return { applied: false, reason: check.reason };
      if (!envelope.state || typeof envelope.state !== "object") {
        return { applied: false, reason: "missing_state" };
      }
      if (store()) store().set("manufacturing", envelope.state);
      render();
      return { applied: true };
    },

    // Renders from the current store slice (e.g. after a selection change
    // re-rendered the inspector). Safe without a host bridge.
    render: render,

    attachToDialog: function (dialogApi) {
      var api = dialogApi || window.GraneteDialog;
      if (!api || api.__graneteManufacturingAttached) return false;
      api.__graneteManufacturingAttached = true;
      api.onManufacturingState = function (payload) {
        window.GraneteManufacturing.handleManufacturingState(payload);
      };
      return true;
    }
  };

  window.GraneteManufacturing.attachToDialog();
})();
