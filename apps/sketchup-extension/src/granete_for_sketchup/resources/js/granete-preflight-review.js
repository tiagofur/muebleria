// #466 / SU-UX-1 — the dialog-side authoritative preflight review
// controller: `Verificar fabricación`. Runs the AUTHORITATIVE resolve
// through the versioned preflight_command channel and renders the review
// the Ruby side publishes (overall state, severity counts, grouped issues,
// Spanish remediation) plus issue navigation (`Ir al origen`) and the
// fix-loop context actions.
//
// This view NEVER computes readiness: local parameter validity can never
// mark manufacturing ready; ready/warning/blocked arrive exclusively in the
// Ruby preflight_state envelope. stale/unavailable/offline stay visually
// distinct from success. Idempotent: re-execution registers nothing twice.
(function () {
  "use strict";
  if (window.GranetePreflightReview) return;

  var COMMANDS = ["run", "navigate_issue"];
  var SEVERITY_LABELS = { error: "Bloqueo", warning: "Aviso", info: "Info" };
  var SEVERITY_BADGE_CLASS = { error: "status-badge error", warning: "status-badge pending", info: "status-badge" };
  var STATE_COPY = {
    pending: { text: "Pendiente", className: "status-badge pending" },
    running: { text: "Verificando…", className: "status-badge pending" },
    ready: { text: "✓ Listo para fabricar", className: "status-badge passed" },
    warning: { text: "Aprobado con avisos", className: "status-badge pending" },
    blocked: { text: "Bloqueado", className: "status-badge error" },
    stale: { text: "Desactualizada", className: "status-badge pending" },
    unavailable: { text: "No disponible", className: "status-badge pending" }
  };
  var ACTION_COPY = {
    navigate: "Ir al origen",
    edit_hardware: "Editar herraje",
    select_part: "Seleccionar pieza",
    edit_material: "Editar material",
    select_furniture: "Seleccionar mueble"
  };
  // Fix-loop target preference per action: the same navigate_issue command
  // addresses the exact managed context the Ruby review resolved.
  var ACTION_TARGETS = {
    navigate: "primary",
    edit_hardware: "hardware",
    select_part: "part"
  };

  var running = false;

  function store() {
    return window.GraneteState || null;
  }

  function preflightSlice() {
    var slice = store() ? store().get("preflight") : null;
    return slice || { entries: {}, review: null };
  }

  function selection() {
    return store() ? store().get("selection") : null;
  }

  function selectionKey() {
    var context = selection() || {};
    return context.furnitureInstanceRef || context.furnitureInstanceId || null;
  }

  // Effective review state for the current selection. Tracker entries win
  // (a mutation made them stale/unavailable); the review payload only adds
  // issue detail. `pending` is the honest no-result state — never green.
  function effectiveState() {
    var slice = preflightSlice();
    var key = selectionKey();
    var entry = key ? slice.entries[key] : null;
    if (entry && ["ready", "warning", "blocked", "stale", "unavailable"].indexOf(entry.state) !== -1) {
      return entry.state;
    }
    var review = slice.review;
    if (review && key && review.scope &&
        (review.scope.furnitureInstanceRef === key || review.scope.furnitureInstanceId === key)) {
      return review.status;
    }
    return "pending";
  }

  function currentReview() {
    var slice = preflightSlice();
    var key = selectionKey();
    var review = slice.review;
    if (!review || !key || !review.scope) return null;
    if (review.scope.furnitureInstanceRef !== key && review.scope.furnitureInstanceId !== key) return null;
    return review;
  }

  // Publish gate (#466): an authoritative server `blocked` verdict prevents
  // publish/release. stale/unavailable are NOT blocked claims — they stay
  // honest and never fake a green light either.
  function publishBlocked() {
    var entries = preflightSlice().entries;
    return Object.keys(entries).some(function (key) {
      return entries[key] && entries[key].state === "blocked";
    });
  }

  function submit(command, payload, context) {
    if (COMMANDS.indexOf(command) === -1) throw new Error("unknown preflight command: " + command);
    var host = window.sketchup;
    if (!host || typeof host.preflight_review !== "function") return "unavailable";
    var target = semanticTarget(context);
    if (Object.keys(target).length === 0) return "unavailable";

    var messageId = window.GraneteBridge ? window.GraneteBridge.nextMessageId() : ("pf-" + Date.now());
    var envelope = {
      schemaId: window.GraneteBridge ? window.GraneteBridge.SCHEMA_ID : "granete.sketchup-host-command.v1",
      type: "preflight_command",
      messageId: messageId,
      command: command,
      semanticTarget: target,
      payload: payload || {}
    };
    host.preflight_review(JSON.stringify(envelope));
    return "sent";
  }

  function semanticTarget(context) {
    var ctx = context || selection() || {};
    var target = {};
    if (ctx.furnitureInstanceId) target.furnitureInstanceId = ctx.furnitureInstanceId;
    if (ctx.furnitureInstanceRef) target.furnitureInstanceRef = ctx.furnitureInstanceRef;
    if (ctx.componentInstanceId) target.componentInstanceId = ctx.componentInstanceId;
    if (ctx.hardwarePlacementId) target.hardwarePlacementId = ctx.hardwarePlacementId;
    return target;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value == null ? "--" : String(value);
  }

  function setDisplay(id, visible) {
    var el = document.getElementById(id);
    if (el) el.style.display = visible ? "block" : "none";
  }

  function statusBadge(state) {
    var badge = document.getElementById("preflight-review-badge");
    if (!badge) return;
    var copy = STATE_COPY[state] || STATE_COPY.pending;
    badge.textContent = copy.text;
    badge.className = copy.className;
  }

  function summaryLine(review, state) {
    if (state === "pending") return "Ejecutá la verificación para conocer el estado de fabricación.";
    if (state === "running") return "Consultando el servidor autoritativo…";
    if (state === "stale") {
      return "La revisión quedó desactualizada tras un cambio; volvé a verificar.";
    }
    if (state === "unavailable") {
      var review2 = currentReview();
      return (review2 && review2.reason) || "La revisión de fabricación no está disponible ahora.";
    }
    if (!review) return "--";
    var counts = review.severityCounts || {};
    var parts = [];
    if (counts.error) parts.push(counts.error + (counts.error === 1 ? " bloqueo" : " bloqueos"));
    if (counts.warning) parts.push(counts.warning + (counts.warning === 1 ? " aviso" : " avisos"));
    if (parts.length === 0) return "Sin problemas de fabricación.";
    return parts.join(" · ");
  }

  function issueElement(review, issue) {
    var box = document.createElement("div");
    box.className = "preflight-issue";
    box.setAttribute("data-issue-id", issue.issueId);

    var head = document.createElement("div");
    head.className = "preflight-issue-head";
    var title = document.createElement("strong");
    title.textContent = issue.title;
    head.appendChild(title);
    var severity = document.createElement("span");
    severity.className = SEVERITY_BADGE_CLASS[issue.severity] || SEVERITY_BADGE_CLASS.info;
    severity.textContent = SEVERITY_LABELS[issue.severity] || issue.severity;
    head.appendChild(severity);
    box.appendChild(head);

    var source = document.createElement("p");
    source.className = "preflight-issue-source";
    source.textContent = (issue.source && issue.source.label) || "Mueble";
    box.appendChild(source);

    var detail = document.createElement("p");
    detail.className = "preflight-issue-detail";
    detail.textContent = issue.message;
    box.appendChild(detail);

    var remediation = document.createElement("p");
    remediation.className = "preflight-issue-remediation";
    remediation.textContent = issue.remediation;
    box.appendChild(remediation);

    var actions = document.createElement("div");
    actions.className = "preflight-issue-actions";
    (issue.actions || []).forEach(function (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = action === "navigate" ? "btn btn-primary" : "btn btn-secondary";
      var label = document.createElement("span");
      label.textContent = ACTION_COPY[action] || action;
      button.appendChild(label);
      button.addEventListener("click", function () {
        window.GranetePreflightReview.runAction(action, issue.issueId);
      });
      actions.appendChild(button);
    });
    box.appendChild(actions);
    return box;
  }

  function renderIssues(review) {
    var container = document.getElementById("preflight-review-groups");
    if (!container) return;
    container.innerHTML = "";
    ((review && review.groups) || []).forEach(function (group) {
      var header = document.createElement("div");
      header.className = "card-title";
      header.textContent = group.label + " (" + group.count + ")";
      container.appendChild(header);
      group.issues.forEach(function (issue) {
        container.appendChild(issueElement(review, issue));
      });
    });
  }

  function renderNavigation(review) {
    var note = document.getElementById("preflight-review-navigation-note");
    if (!note) return;
    var navigation = review && review.navigation;
    if (!navigation) {
      note.style.display = "none";
      return;
    }
    note.style.display = "block";
    note.textContent = navigation.fallback
      ? "La pieza exacta ya no existe en el modelo; se seleccionó el mueble completo."
      : "Contexto seleccionado en el viewport.";
  }

  function render() {
    var card = document.getElementById("preflight-review-card");
    if (!card) return;

    var context = selection();
    var multi = context && context.selectionCount && context.selectionCount > 1;
    var eligible = context && !multi && context.kind !== "unmanaged" && selectionKey();
    card.style.display = eligible ? "block" : "none";
    if (!eligible) return;

    var state = running ? "running" : effectiveState();
    var review = currentReview();

    statusBadge(state);
    setText("preflight-review-summary", summaryLine(review, state));

    setDisplay("preflight-review-body", state !== "pending" && state !== "running");
    setDisplay("preflight-review-stale-note", state === "stale");
    setDisplay("preflight-review-unavailable-note", state === "unavailable");
    if (state === "unavailable" && review && review.reason) {
      setText("preflight-review-unavailable-note", review.reason);
    }

    var runButton = document.getElementById("btn-preflight-run");
    if (runButton) {
      var label = runButton.querySelector("span");
      if (label) label.textContent = state === "pending" ? "Verificar fabricación" : "Volver a verificar";
      runButton.disabled = running;
    }

    renderIssues(review);
    renderNavigation(review);
  }

  window.GranetePreflightReview = {
    state: function () { return running ? "running" : effectiveState(); },
    review: function () { return currentReview(); },
    publishBlocked: publishBlocked,

    run: function (context) {
      if (running) return "busy";
      var result = submit("run", {}, context);
      if (result === "sent") {
        running = true;
        render();
      }
      return result;
    },

    runAction: function (action, issueId) {
      if (action === "select_furniture" || action === "edit_material") {
        // Focus the owning furniture: its inspector owns the parameter and
        // material editors. Selection happens by semantic identity on the
        // Ruby side — never by name.
        var host = window.sketchup;
        var context = selection() || {};
        if (host && typeof host.select_furniture === "function" && context.furnitureInstanceRef) {
          host.select_furniture(JSON.stringify({ furnitureInstanceRef: context.furnitureInstanceRef }));
          return "sent";
        }
        return "unavailable";
      }
      var target = ACTION_TARGETS[action] || "primary";
      return submit("navigate_issue", { issueId: issueId, target: target });
    },

    // Ruby resets `running` implicitly by pushing the next preflight_state.
    handleRunningReset: function () {
      running = false;
      render();
    },

    render: render,

    attachToDialog: function (dialogApi) {
      var api = dialogApi || window.GraneteDialog;
      if (!api || api.__granetePreflightReviewAttached) return false;
      api.__granetePreflightReviewAttached = true;
      return true;
    }
  };

  window.GranetePreflightReview.attachToDialog();
})();
