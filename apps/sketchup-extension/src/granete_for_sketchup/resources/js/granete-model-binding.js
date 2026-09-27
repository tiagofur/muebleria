// #848 Phase B C4.8 — model binding module (window.GraneteUI.modelBinding).
// Owns: the Model ↔ Project/Design binding UI/state (#388: status
// rendering across the nine distinct states, manual bind picker, rebind
// review, refresh/adopt), the pairing-code entry (#499 Slice 3), the
// publish confirmation/progress/result UI (#392/#847: armed confirmation —
// the first click NEVER publishes, separate confirm action, 6 s arm
// timer, double-click protection — orchestration start, error mapping)
// and the design-wide validation UX (#731: progress, summary counts,
// exceptions-only cards, furniture selection, issue navigation). The
// publish availability VIEW reads can_publish_revision from the server
// status and the #466 publicationGate projection at call time; it never
// recomputes the preflight gate locally.
//
// Consumes: everything call-time, never cached.
// window.GraneteUI.configurator.updateInsertButton()
// after every status render; window.GraneteCommercialProjection.setBinding
// on exactly the two handleModelBindingResult paths that historically
// updated it; window.GranetePreflightReview
// publishBlocked()/publicationGate()/navigateFurnitureIssue;
// window.sketchup binding/publish/validation bridges.
// window.GraneteState.subscribe("preflight") re-render hook registers
// ONCE from init() (wiring movement: init() runs inside the same inline
// bootstrap pass where the registration lived before C4.8; the #498
// runtime loads after the inline script, so the subscription stays a
// no-op in the real host exactly as before).
// Injected via init(): showToast (shared inline helper) and
// invalidateProjectFurniture — the Project Furniture invalidation seam:
// every status render invalidates the Project Furniture rows exactly
// where renderModelBindingStatus historically set lastPfState = null.
// Since #848 C4.9 the seam delegates to the Project Furniture module
// (window.GraneteUI.projectFurniture.invalidate); the rows state lives
// there, this module never copies it.
//
// Does NOT own: backend binding truth (the Ruby connector is the
// authority; this view never invents or edits business identity and never
// rebinds silently), Project Furniture state/rows (owned by
// js/granete-project-furniture.js since #848 C4.9; this module only
// invalidates them through the injected seam), Commercial
// Projection/Bootstrap state, preflight/
// manufacturing computation, Configurator state.
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.modelBinding) return;

  // Injected by the dialog bootstrap before any render: the shared toast
  // helper and the Project Furniture invalidation seam (delegating to the
  // Project Furniture module since #848 C4.9).
  var deps = {};

  function requireDeps() {
    var missing = ["showToast", "invalidateProjectFurniture"].filter(function (name) {
      return typeof deps[name] !== "function";
    });
    if (missing.length > 0) {
      throw new Error("GraneteUI.modelBinding.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  // Binding / publish / validation DOM refs (#388/#392/#731)
  var bindingBadge = document.getElementById("model-binding-badge");
  var bindingDetail = document.getElementById("model-binding-detail");
  var bindingInfo = document.getElementById("model-binding-info");
  var bindingOrgName = document.getElementById("binding-org-name");
  var bindingCustomerName = document.getElementById("binding-customer-name");
  var bindingProjectName = document.getElementById("binding-project-name");
  var bindingDesignName = document.getElementById("binding-design-name");
  var bindingBaseRevision = document.getElementById("binding-base-revision");
  var bindingConnectBtn = document.getElementById("btn-binding-connect");
  var bindingRefreshBtn = document.getElementById("btn-binding-refresh");
  var bindingAdoptBtn = document.getElementById("btn-binding-adopt");
  var bindingPublishBtn = document.getElementById("btn-binding-publish");
  var bindingPublishProgress = document.getElementById("binding-publish-progress");
  var designValidateBtn = document.getElementById("btn-design-validate");
  var bindingPublishExceptions = document.getElementById("binding-publish-exceptions");
  var bindingPicker = document.getElementById("model-binding-picker");
  var bindingProjectSelect = document.getElementById("binding-project-select");
  var bindingDesignSelect = document.getElementById("binding-design-select");
  var bindingConfirmBtn = document.getElementById("btn-binding-confirm");
  var bindingCancelBtn = document.getElementById("btn-binding-cancel");
  var bindingRebindReview = document.getElementById("model-binding-rebind-review");
  var bindingRebindConfirmBtn = document.getElementById("btn-binding-rebind-confirm");
  var bindingRebindCancelBtn = document.getElementById("btn-binding-rebind-cancel");
  var pairingEntry = document.getElementById("pairing-entry");

  // ------------------------------------------------------------------
  // Model ↔ Project/Design binding (#388). Self-contained state + view:
  // every action goes to Ruby (connector); the panel never invents or
  // edits business identity, and states are rendered distinctly.
  // ------------------------------------------------------------------
  var MODEL_BINDING_COPY = {
    unbound: { badge: "Sin conectar", cls: "pending", detail: "Conectá este modelo a un proyecto y diseño de Granete para trabajar sobre su contexto exacto." },
    connected: { badge: "Conectado", cls: "valid", detail: "" },
    // stale_base uses the warning badge: it is a distinct actionable
    // condition, not the same neutral "sin conectar" state.
    stale_base: { badge: "Base desactualizada", cls: "conflict", detail: "El diseño avanzó en el servidor. Actualizá la base de trabajo para continuar; nada se sobrescribe en silencio." },
    design_archived: { badge: "Diseño archivado", cls: "invalid", detail: "El diseño fue archivado en Granete: no se puede editar ni publicar desde este modelo." },
    invalid: { badge: "Enlace inválido", cls: "invalid", detail: "El enlace guardado no corresponde a un proyecto o diseño accesible. Conectá nuevamente." },
    incompatible: { badge: "Versión incompatible", cls: "invalid", detail: "El servidor usa una versión del contrato de enlace que esta extensión no entiende. Actualizá la extensión." },
    unauthenticated: { badge: "Sin sesión", cls: "invalid", detail: "Iniciá sesión con tu cuenta del taller (pill superior derecha) para validar el enlace del modelo." },
    unauthorized: { badge: "Sin permiso", cls: "invalid", detail: "No tenés permiso para el proyecto o diseño enlazado." },
    unreachable: { badge: "Servidor no disponible", cls: "pending", detail: "No se pudo contactar al servidor. El enlace guardado se conserva; probá de nuevo." }
  };

  var modelBindingState = { status: null, pendingTarget: null, projects: [], designs: [] };

  function bindingBaseLabel(status) {
    var binding = status.binding || {};
    if (status.state === "stale_base") {
      var current = binding.baseRevisionId ? String(binding.baseRevisionId).slice(0, 8) : "sin publicar";
      var next = status.authoritativeBaseRevisionNumber
        ? "R" + status.authoritativeBaseRevisionNumber
        : (status.authoritativeBaseRevisionId ? String(status.authoritativeBaseRevisionId).slice(0, 8) : "sin publicar");
      return current + " → " + next;
    }
    if (binding.baseRevisionId) {
      return "R" + (status.authoritativeBaseRevisionNumber || String(binding.baseRevisionId).slice(0, 8));
    }
    return "Sin publicar";
  }

  function renderModelBindingStatus(status) {
    status = status || { state: "unbound" };
    modelBindingState.status = status;
    modelBindingState.pendingTarget = null;
    // A binding change invalidates the Project Furniture rows: the
    // next visit to the Proyecto tab reloads them (#389). The rows
    // state is owned by the Project Furniture module (#848 C4.9) —
    // this seam only informs it, never a second PF authority.
    deps.invalidateProjectFurniture();

    var copy = MODEL_BINDING_COPY[status.state] || MODEL_BINDING_COPY.invalid;
    bindingBadge.textContent = copy.badge;
    bindingBadge.className = "status-badge " + copy.cls;

    var detail = copy.detail;
    if (status.reason) detail = (detail ? detail + " " : "") + "(" + status.reason + ")";
    bindingDetail.textContent = detail;

    var bound = status.state === "connected" || status.state === "stale_base" ||
                status.state === "design_archived" || status.state === "unreachable";
    bindingInfo.style.display = bound && status.binding ? "block" : "none";
    if (bound && status.binding) {
      var binding = status.binding;
      bindingOrgName.textContent = binding.organizationName || "--";
      bindingCustomerName.textContent = binding.customerName || "--";
      bindingProjectName.textContent = binding.projectName || binding.projectId || "--";
      bindingDesignName.textContent = binding.designName || binding.designId || "--";
      bindingBaseRevision.textContent = bindingBaseLabel(status);
    }

    bindingConnectBtn.style.display = status.state === "connected" ? "none" : "block";
    var bootstrapButton = document.getElementById("btn-bootstrap-project");
    if (bootstrapButton) bootstrapButton.style.display = status.state === "unbound" ? "block" : "none";
    // The pairing-code entry is the primary connect path and follows the
    // same rule as the manual picker: once the design is linked there is
    // nothing to connect, and a new code would only rebind (#499/#388).
    pairingEntry.style.display = status.state === "connected" ? "none" : "";
    bindingRefreshBtn.style.display = bound ? "block" : "none";
    bindingAdoptBtn.style.display = status.state === "stale_base" ? "block" : "none";
    renderPublishAvailability(status);

    bindingPicker.style.display = "none";
    bindingRebindReview.style.display = "none";
    window.GraneteUI.configurator.updateInsertButton();
  }

  // ------------------------------------------------------------------
  // Publish design revision (#392 / DT-8). The button is available only
  // when the server granted can_publish_revision AND the binding base
  // is current; progress/result states are surfaced distinctly and the
  // backend remains the authority for every precondition.
  // ------------------------------------------------------------------
  var PUBLISH_STEP_COPY = {
    validating: "Validando identidad de los muebles…",
    syncing: "Sincronizando borrador de trabajo…",
    exporting: "Guardando modelo y preview…",
    uploading: "Subiendo archivos…",
    publishing: "Publicando revisión…"
  };
  var PUBLISH_ERROR_COPY = {
    unbound: "El modelo no está conectado a un diseño.",
    preflight_incomplete: "La publicación requiere verificar todos los muebles del diseño.",
    stale_base: "La base del diseño cambió en el servidor; actualizá la base de trabajo y volvé a publicar.",
    duplicate_furniture_identity: "Hay copias con la misma identidad física; resolvé los duplicados antes de publicar.",
    unresolved_duplicate_identity: "Hay un mueble copiado cuya identidad no pudo resolverse.",
    working_copy_unsynced: "Hay un mueble cuya posición todavía no se sincronizó con el taller.",
    invalid_furniture_identity: "El modelo contiene muebles con identidades no válidas.",
    foreign_project_identity: "El modelo contiene muebles de otro proyecto.",
    unknown_furniture_identity: "El modelo contiene muebles que no existen en el servidor.",
    backend_verification_failed: "No se pudo verificar la identidad autoritativa con el servidor.",
    hash_mismatch: "El archivo subido no coincide con su verificación de integridad.",
    artifact_too_large: "Uno de los archivos es demasiado grande.",
    unreachable: "No se pudo contactar al servidor."
  };
  var publishInFlight = false;
  var lastPublishOutcome = null;
  // Consecuencia invertida (revisión UX 2026-09 + review #847):
  // publicar crea una revisión INMUTABLE del diseño. El botón original
  // sólo ARMA la confirmación; publicar exige una acción deliberada
  // DISTINTA ("Publicar revisión"), así un doble clic físico nunca
  // atraviesa la frontera. El timeout de 6 s es un colchón, no la
  // defensa: la defensa es la acción separada.
  var publishArmed = false;
  var publishArmTimer = null;
  var bindingPublishConfirmRow = document.getElementById("binding-publish-confirm");
  var btnPublishConfirm = document.getElementById("btn-publish-confirm");
  var btnPublishCancel = document.getElementById("btn-publish-cancel");

  function publishIdleLabel() {
    return lastPublishOutcome && !lastPublishOutcome.ok
      ? "Reintentar publicación"
      : "Publicar diseño";
  }

  function resetPublishConfirm() {
    publishArmed = false;
    if (publishArmTimer) {
      clearTimeout(publishArmTimer);
      publishArmTimer = null;
    }
    if (bindingPublishConfirmRow) bindingPublishConfirmRow.style.display = "none";
    if (bindingPublishBtn && !publishInFlight) {
      bindingPublishBtn.style.display =
        modelBindingState.status && canPublish(modelBindingState.status) ? "block" : "none";
      bindingPublishBtn.textContent = publishIdleLabel();
    }
  }

  function armPublishConfirm() {
    publishArmed = true;
    if (bindingPublishBtn) bindingPublishBtn.style.display = "none";
    if (bindingPublishConfirmRow) bindingPublishConfirmRow.style.display = "block";
    if (bindingPublishProgress) {
      bindingPublishProgress.style.display = "block";
      bindingPublishProgress.textContent =
        "Confirmá la acción para crear la nueva revisión inmutable del diseño.";
    }
    if (btnPublishConfirm && btnPublishConfirm.focus) btnPublishConfirm.focus();
    if (publishArmTimer) clearTimeout(publishArmTimer);
    publishArmTimer = setTimeout(resetPublishConfirm, 6000);
  }

  function startPublishOrchestration() {
    resetPublishConfirm();
    // #731 PR2: the click STARTS the automatic orchestration — a
    // pending/blocked gate is no longer a client-side wall. Ruby
    // converges what is safe, validates the whole design, re-checks
    // the gate fail-closed and only then publishes (or returns the
    // exceptions-only projection).
    lastPublishOutcome = null;
    renderPublishProgress({ step: "validating" });
    if (window.sketchup && window.sketchup.publish_design_revision) {
      window.sketchup.publish_design_revision();
    } else {
      handlePublishResult({ ok: false, code: "unavailable", reason: "publicación no disponible" });
    }
  }

  function canPublish(status) {
    var caps = status.capabilities || {};
    return status.state === "connected" && caps.can_publish_revision === true;
  }

  // #466 design-wide preflight publish gate. The universe is the FULL
  // #392 publication scope — composed Ruby-side (canonical manifest
  // inventory + tracker states) and received as the publicationGate
  // projection; this view never rebuilds the scope from tracker
  // entries, selection or names. Counts' denominator is the scope.
  function publishGateCountsLine(gate) {
    if (!gate || gate.scopeAvailable === false) return "";
    if (typeof gate.total !== "number") return "";
    return gate.total + " muebles · " + (gate.verified || 0) + " verificados · " +
           (gate.pending || 0) + (gate.pending === 1 ? " pendiente" : " pendientes");
  }

  function publishGateBlockedCopy(gate) {
    var base;
    if (!gate || gate.scopeAvailable === false) {
      base = "No se pudo confirmar el alcance de publicación del diseño. " +
             "Verificá los muebles del diseño antes de publicar.";
    } else if (gate.hostAvailable !== true || gate.hostClean !== true) {
      base = (gate.hostAttention || 0) > 0
        ? "Hay " + gate.hostAttention + " muebles que requieren reconciliación con este archivo SketchUp."
        : "No se pudo confirmar que este archivo SketchUp coincida con el diseño.";
    } else if ((gate.blocked || 0) > 0) {
      base = "La publicación está bloqueada porque existen problemas de fabricación.";
    } else if ((gate.stale || 0) > 0) {
      base = "La revisión de fabricación quedó desactualizada después de una modificación. " +
             "Volvé a verificar antes de publicar.";
    } else if ((gate.unavailable || 0) > 0) {
      base = "No se pudo confirmar el estado de fabricación de todos los muebles.";
    } else {
      base = "La publicación requiere verificar todos los muebles del diseño.";
    }
    var counts = publishGateCountsLine(gate);
    return counts ? base + " " + counts : base;
  }

  function renderPublishAvailability(status) {
    if (!bindingPublishBtn || !bindingPublishProgress) return;
    // Cualquier empuje de estado re-evalúa el botón desde cero: la
    // confirmación armada no sobrevive a un cambio de contexto.
    resetPublishConfirm();
    var idle = !publishInFlight && lastPublishOutcome === null;
    var preflightBlocked = window.GranetePreflightReview &&
      window.GranetePreflightReview.publishBlocked();
    bindingPublishBtn.style.display = canPublish(status) ? "block" : "none";
    // #731 PR2: a pending/blocked gate no longer disables the button —
    // the click runs the automatic orchestration (auto-validation).
    // Only an in-flight/recent publish does. Ruby re-enforces every
    // precondition fail-closed before the publisher.
    bindingPublishBtn.disabled = publishInFlight || !idle;
    bindingPublishBtn.textContent = publishInFlight ? "Publicando…" : "Publicar diseño";
    if (designValidateBtn) {
      designValidateBtn.style.display = canPublish(status) ? "block" : "none";
      designValidateBtn.disabled = publishInFlight || designValidateInFlight;
      designValidateBtn.textContent = designValidateInFlight ? "Validando…" : "Validar diseño";
    }
    if (preflightBlocked && !publishInFlight) {
      bindingPublishProgress.style.display = "block";
      bindingPublishProgress.textContent = publishGateBlockedCopy(
        window.GranetePreflightReview ? window.GranetePreflightReview.publicationGate() : null
      );
    } else if (!publishInFlight && lastPublishOutcome === null && !designValidateInFlight) {
      bindingPublishProgress.style.display = "none";
      bindingPublishProgress.textContent = "";
    }
  }

  function renderPublishProgress(payload) {
    if (!bindingPublishProgress || !payload) return;
    publishInFlight = true;
    lastPublishOutcome = null;
    clearPublishExceptions();
    if (bindingPublishBtn) {
      bindingPublishBtn.disabled = true;
      bindingPublishBtn.textContent = "Publicando…";
    }
    if (designValidateBtn) designValidateBtn.disabled = true;
    bindingPublishProgress.style.display = "block";
    var copy = PUBLISH_STEP_COPY[payload.step] || PUBLISH_STEP_COPY.validating;
    // #731 PR2: the orchestration appends design-validation counts to
    // the validating step ("Validando diseño… 12 de 30").
    bindingPublishProgress.textContent = payload.detail ? (copy + " " + payload.detail) : copy;
  }

  function handlePublishResult(result) {
    publishInFlight = false;
    resetPublishConfirm();
    result = result || { ok: false, code: "error", reason: "resultado desconocido" };
    lastPublishOutcome = result;
    if (result.ok) {
      clearPublishExceptions();
    }
    if (bindingPublishProgress) {
      bindingPublishProgress.style.display = "block";
      if (result.ok) {
        bindingPublishProgress.textContent = "Diseño publicado · Revisión R" + (result.revisionNumber || "?");
      } else if (!result.validation) {
        var copy = PUBLISH_ERROR_COPY[result.code] || "No se pudo publicar el diseño.";
        bindingPublishProgress.textContent = copy + (result.reason ? " (" + result.reason + ")" : "");
      }
    }
    // #731: with a validation projection the summary line + exception
    // cards ARE the feedback — a generic error copy would only hide it.
    if (!result.ok && result.validation) {
      renderDesignValidation(result.validation);
    }
    if (bindingPublishBtn) {
      bindingPublishBtn.disabled = false;
      bindingPublishBtn.textContent = result.ok ? "Publicar diseño" : "Reintentar publicación";
    }
    if (result.ok) {
      deps.showToast("success", "✓ Diseño publicado como revisión inmutable R" + (result.revisionNumber || "?") + ".");
      refreshModelBinding();
    } else if (!result.validation) {
      deps.showToast("error", PUBLISH_ERROR_COPY[result.code] || "No se pudo publicar el diseño.");
    }
  }

  // ------------------------------------------------------------------
  // #731 PR2 — design-wide validation UX. `Validar diseño` and the
  // automatic publish orchestration report the SAME Ruby-composed
  // projection: summary counts plus ONLY the furniture that requires
  // attention (never a list of per-unit successes). Navigation
  // reuses the existing seams: select by FurnitureInstance identity
  // and navigate_issue through the #466 review channel.
  // ------------------------------------------------------------------
  var VALIDATION_STATE_LABELS = {
    blocked: "Requiere atención",
    stale: "Verificación desactualizada",
    unavailable: "No disponible",
    unverified: "Sin verificar",
    pending_confirmation: "Posición pendiente",
    duplicate_local: "Identidad duplicada",
    missing_local: "Falta en este archivo",
    incompatible: "Contexto incompatible",
    terminal_or_orphan_local: "Identidad no vigente",
    unknown: "No verificable",
    unbound: "Sin conectar",
    unreachable: "Servidor no disponible"
  };
  var designValidateInFlight = false;

  function validationStateLabel(state) {
    return VALIDATION_STATE_LABELS[state] || "Requiere atención";
  }

  function clearPublishExceptions() {
    if (!bindingPublishExceptions) return;
    bindingPublishExceptions.innerHTML = "";
    bindingPublishExceptions.style.display = "none";
  }

  function firstValidationIssue(review) {
    var groups = (review && review.groups) || [];
    for (var g = 0; g < groups.length; g++) {
      var issues = groups[g].issues || [];
      if (issues.length) return issues[0];
    }
    return null;
  }

  function validationExceptionCard(exception) {
    var card = document.createElement("div");
    card.className = "preflight-issue";
    card.setAttribute("data-furniture-instance-id", exception.furnitureInstanceId || "");

    var head = document.createElement("div");
    head.className = "preflight-issue-head";
    var title = document.createElement("strong");
    title.textContent = exception.displayName ||
      ("Mueble " + String(exception.furnitureInstanceId || "").slice(0, 8));
    head.appendChild(title);
    var badge = document.createElement("span");
    badge.className = "status-badge error";
    badge.textContent = validationStateLabel(exception.state);
    head.appendChild(badge);
    card.appendChild(head);

    var issue = firstValidationIssue(exception.review);
    var detail = document.createElement("p");
    detail.className = "preflight-issue-detail";
    detail.textContent = issue
      ? (issue.title + (issue.message ? " — " + issue.message : ""))
      : (exception.reason || validationStateLabel(exception.state));
    card.appendChild(detail);

    if (issue && issue.remediation) {
      var remediation = document.createElement("p");
      remediation.className = "preflight-issue-remediation";
      remediation.textContent = issue.remediation;
      card.appendChild(remediation);
    }

    var actions = document.createElement("div");
    actions.className = "preflight-issue-actions";

    var selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "btn btn-secondary";
    selectBtn.textContent = "Seleccionar";
    selectBtn.addEventListener("click", function () {
      if (window.sketchup && window.sketchup.select_project_furniture && exception.furnitureInstanceId) {
        window.sketchup.select_project_furniture(
          JSON.stringify({ furnitureInstanceId: exception.furnitureInstanceId })
        );
      }
    });
    actions.appendChild(selectBtn);

    if (issue && window.GranetePreflightReview &&
        window.GranetePreflightReview.navigateFurnitureIssue && exception.furnitureInstanceId) {
      var navigateBtn = document.createElement("button");
      navigateBtn.type = "button";
      navigateBtn.className = "btn btn-secondary";
      navigateBtn.textContent = "Ir al origen";
      navigateBtn.addEventListener("click", function () {
        window.GranetePreflightReview.navigateFurnitureIssue(
          exception.furnitureInstanceId, issue.issueId, "primary"
        );
      });
      actions.appendChild(navigateBtn);
    }
    card.appendChild(actions);
    return card;
  }

  // Summary line + exception cards (exceptions-only: the ready
  // majority never gets a card).
  function renderDesignValidation(validation) {
    validation = validation || { total: 0, ready: 0, attention: 0, exceptions: [] };
    if (bindingPublishProgress) {
      bindingPublishProgress.style.display = "block";
      bindingPublishProgress.textContent = validation.total +
        (validation.total === 1 ? " mueble · " : " muebles · ") +
        (validation.ready || 0) + " listos · " + (validation.attention || 0) +
        ((validation.attention || 0) === 1 ? " requiere atención" : " requieren atención");
    }
    if (!bindingPublishExceptions) return;
    bindingPublishExceptions.innerHTML = "";
    (validation.exceptions || []).forEach(function (exception) {
      bindingPublishExceptions.appendChild(validationExceptionCard(exception));
    });
    bindingPublishExceptions.style.display =
      (validation.exceptions || []).length ? "block" : "none";
  }

  function renderDesignValidationProgress(payload) {
    if (!bindingPublishProgress || !payload) return;
    designValidateInFlight = true;
    if (designValidateBtn) {
      designValidateBtn.disabled = true;
      designValidateBtn.textContent = "Validando…";
    }
    bindingPublishProgress.style.display = "block";
    bindingPublishProgress.textContent = payload.detail ||
      ("Validando diseño… " + (payload.done || 0) + " de " + (payload.total || 0));
  }

  function handleDesignValidationResult(result) {
    designValidateInFlight = false;
    result = result || { ok: false, code: "error", reason: "resultado desconocido" };
    if (designValidateBtn) {
      designValidateBtn.disabled = false;
      designValidateBtn.textContent = "Validar diseño";
    }
    if (result.validation) {
      renderDesignValidation(result.validation);
      deps.showToast(result.ok ? "info" : "error",
                result.ok ? "Validación del diseño completada." : "No se pudo completar la validación del diseño.");
    } else {
      if (bindingPublishProgress) {
        bindingPublishProgress.style.display = "block";
        bindingPublishProgress.textContent = result.reason || "No se pudo validar el diseño.";
      }
      deps.showToast("error", result.reason || "No se pudo validar el diseño.");
    }
  }

  function fillSelect(select, entries, placeholder, statusLabel) {
    select.innerHTML = "";
    var placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = entries.length ? placeholder : "Sin opciones disponibles";
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    select.appendChild(placeholderOption);
    entries.forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = statusLabel && entry.status ? entry.name + " (" + statusLabel(entry.status) + ")" : entry.name;
      select.appendChild(option);
    });
  }

  function designStatusLabel(status) {
    if (status === "archived") return "archivado";
    if (status === "draft") return "borrador";
    return "activo";
  }

  function openBindingPicker() {
    bindingPicker.style.display = "block";
    bindingRebindReview.style.display = "none";
    bindingConfirmBtn.disabled = true;
    bindingConfirmBtn.textContent = "Conectar";
    fillSelect(bindingProjectSelect, [], "Cargando proyectos…");
    fillSelect(bindingDesignSelect, [], "Elegí un proyecto");
    if (window.sketchup && window.sketchup.list_binding_projects) {
      window.sketchup.list_binding_projects();
    } else {
      deps.showToast("error", "Conexión disponible sólo dentro de SketchUp.");
    }
  }

  function handleBindingProjects(result) {
    if (!result || !result.ok) {
      fillSelect(bindingProjectSelect, [], "Cargando proyectos…");
      deps.showToast("error", "No se pudieron listar los proyectos: " + ((result && result.reason) || "desconocido"));
      return;
    }
    modelBindingState.projects = result.entries || [];
    fillSelect(bindingProjectSelect, modelBindingState.projects, "Elegí un proyecto");
  }

  function handleBindingDesigns(result) {
    if (!result || !result.ok) {
      fillSelect(bindingDesignSelect, [], "Elegí un proyecto");
      bindingConfirmBtn.disabled = true;
      if (result && result.code !== "unauthenticated") {
        deps.showToast("error", "No se pudieron listar los diseños: " + (result.reason || "desconocido"));
      }
      return;
    }
    modelBindingState.designs = result.entries || [];
    fillSelect(bindingDesignSelect, modelBindingState.designs, "Elegí un diseño", designStatusLabel);
    updateBindingConfirmState();
  }

  function updateBindingConfirmState() {
    bindingConfirmBtn.disabled = !(bindingProjectSelect.value && bindingDesignSelect.value);
  }

  function connectBindingModel(confirmRebind) {
    var projectId = modelBindingState.pendingTarget
      ? modelBindingState.pendingTarget.projectId
      : bindingProjectSelect.value;
    var designId = modelBindingState.pendingTarget
      ? modelBindingState.pendingTarget.designId
      : bindingDesignSelect.value;
    if (!projectId || !designId) return;
    bindingConfirmBtn.disabled = true;
    bindingConfirmBtn.textContent = "Validando…";
    if (window.sketchup && window.sketchup.connect_model) {
      window.sketchup.connect_model(JSON.stringify({
        projectId: projectId,
        designId: designId,
        confirmRebind: confirmRebind === true
      }));
    }
  }

  // Manual bind and pairing (#499 Slice 3) converge here. Pairing
  // failures keep the code editable; success clears it — the raw code
  // never persists anywhere in the dialog state.
  function handleModelBindingResult(result) {
    result = result || {};
    bindingConfirmBtn.disabled = false;
    bindingConfirmBtn.textContent = "Conectar";
    setPairingBusy(false);

    if (result.ok) {
      bindingPicker.style.display = "none";
      bindingRebindReview.style.display = "none";
      modelBindingState.pendingTarget = null;
      renderModelBindingStatus(result.status);
      // A connect/rebind result is already the authoritative status for
      // this operation. Update the commercial context immediately rather
      // than waiting for a later get_model_binding callback, which could
      // leave the previous Design total visible after a rebind.
      if (window.GraneteCommercialProjection) window.GraneteCommercialProjection.setBinding(result.status);
      if (result.pairing) {
        pairingInput.value = "";
        if (result.confirmationFailed) {
          showPairingMessage("hint", result.reason || "El modelo quedó conectado, pero la web no registró la confirmación.");
        } else {
          showPairingMessage("hint", "Diseño vinculado en SketchUp.");
        }
      } else {
        deps.showToast("success", "✓ Modelo conectado al diseño de Granete.");
      }
      return;
    }

    if (result.code === "pairing_rebind_requires_new_code") {
      // The one-time code was exchanged already. Never let the manual
      // rebind confirmation masquerade as completing this pairing;
      // manual binding uses a different, authoritative-working-base
      // contract. Keep the old binding and require a new Web code.
      bindingPicker.style.display = "none";
      bindingRebindReview.style.display = "none";
      modelBindingState.pendingTarget = null;
      pairingInput.value = "";
      showPairingMessage("error", result.reason || "El código fue aceptado pero no se aplicó. Generá uno nuevo en la web.");
      pairingInput.focus();
      return;
    }

    if (result.code === "rebind_required") {
      bindingPicker.style.display = "none";
      bindingRebindReview.style.display = "block";
      modelBindingState.pendingTarget = result.target;
      return;
    }

    var failureStatus = null;
    if (result.status) failureStatus = result.status;
    else if (result.state) failureStatus = { state: result.state, reason: result.reason };
    if (failureStatus) {
      renderModelBindingStatus(failureStatus);
      // A failed validation makes any previously rendered amount stale.
      // Fail closed with the same authoritative binding state instead of
      // leaving the card marked as current.
      if (window.GraneteCommercialProjection) window.GraneteCommercialProjection.setBinding(failureStatus);
    }
    if (result.pairing) {
      if (result.code === "invalid_code") {
        showPairingMessage("error", result.reason || "Código inválido.");
        pairingInput.focus();
      } else if (result.code === "code_not_found" || result.code === "code_unusable") {
        showPairingMessage("error", result.reason || "El código no existe, expiró o ya fue usado.");
        pairingInput.value = "";
        pairingInput.focus();
      } else {
        showPairingMessage("error", result.reason || "No se pudo conectar con el código.");
      }
    } else {
      deps.showToast("error", "No se pudo conectar el modelo: " + (result.reason || "desconocido"));
    }
  }

  function refreshModelBinding() {
    if (window.sketchup && window.sketchup.get_model_binding) {
      window.sketchup.get_model_binding();
    }
  }

  bindingConnectBtn.addEventListener("click", openBindingPicker);

  // #499 Slice 3: one-time pairing code entry. The raw code lives only
  // in this input for the duration of the attempt; it is never written
  // to model attributes and is cleared right after the exchange.
  var pairingInput = document.getElementById("pairing-code-input");
  var pairingConnectBtn = document.getElementById("btn-pairing-connect");
  var pairingMessage = document.getElementById("pairing-message");

  function setPairingBusy(busy) {
    pairingConnectBtn.disabled = busy;
    pairingInput.disabled = busy;
    pairingConnectBtn.textContent = busy ? "Conectando…" : "Conectar";
  }

  function showPairingMessage(kind, text) {
    pairingMessage.style.display = "block";
    pairingMessage.style.color = kind === "error" ? "var(--danger-600)" : "var(--text-secondary)";
    pairingMessage.textContent = text;
  }

  function submitPairingCode() {
    var code = pairingInput.value.trim();
    if (!code) {
      showPairingMessage("error", "Pegá el código que te muestra la web.");
      pairingInput.focus();
      return;
    }
    setPairingBusy(true);
    showPairingMessage("hint", "Conectando con Granete…");
    if (window.sketchup && window.sketchup.connect_with_code) {
      window.sketchup.connect_with_code(JSON.stringify({ code: code }));
    } else {
      setPairingBusy(false);
      showPairingMessage("error", "La conexión con Granete no está disponible.");
    }
  }

  pairingConnectBtn.addEventListener("click", submitPairingCode);
  pairingInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitPairingCode();
    }
  });


  bindingCancelBtn.addEventListener("click", function () {
    bindingPicker.style.display = "none";
  });
  bindingProjectSelect.addEventListener("change", function () {
    modelBindingState.designs = [];
    fillSelect(bindingDesignSelect, [], "Cargando diseños…");
    bindingConfirmBtn.disabled = true;
    if (bindingProjectSelect.value && window.sketchup && window.sketchup.list_binding_designs) {
      window.sketchup.list_binding_designs(JSON.stringify({ projectId: bindingProjectSelect.value }));
    }
  });
  bindingDesignSelect.addEventListener("change", updateBindingConfirmState);
  bindingConfirmBtn.addEventListener("click", function () { connectBindingModel(false); });
  bindingRebindConfirmBtn.addEventListener("click", function () { connectBindingModel(true); });
  bindingRebindCancelBtn.addEventListener("click", function () {
    bindingRebindReview.style.display = "none";
    modelBindingState.pendingTarget = null;
  });
  bindingRefreshBtn.addEventListener("click", function () {
    if (window.sketchup && window.sketchup.refresh_model_binding) {
      window.sketchup.refresh_model_binding();
    }
  });
  bindingAdoptBtn.addEventListener("click", function () {
    if (window.sketchup && window.sketchup.adopt_binding_base) {
      window.sketchup.adopt_binding_base();
    }
  });
  if (bindingPublishBtn) {
    bindingPublishBtn.addEventListener("click", function () {
      if (publishInFlight) return;
      // Sólo arma: publicar exige la acción confirmatoria separada.
      armPublishConfirm();
    });
  }
  if (btnPublishCancel) {
    btnPublishCancel.addEventListener("click", function () {
      resetPublishConfirm();
      if (bindingPublishBtn && bindingPublishBtn.focus) bindingPublishBtn.focus();
    });
  }
  if (btnPublishConfirm) {
    btnPublishConfirm.addEventListener("click", function () {
      if (publishInFlight || !publishArmed) return;
      startPublishOrchestration();
    });
  }
  if (designValidateBtn) {
    designValidateBtn.addEventListener("click", function () {
      if (designValidateInFlight || publishInFlight) return;
      if (window.sketchup && window.sketchup.validate_design_revision) {
        renderDesignValidationProgress({ detail: "Validando diseño…" });
        window.sketchup.validate_design_revision();
      }
    });
  }

  // Escape disarms the armed publish confirmation (was a document
  // keydown listener in the inline bootstrap before C4.8). Independent
  // of the other document keydown listeners; the namespace guard above
  // keeps module re-execution from registering it twice.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      resetPublishConfirm();
    }
  });

  // #466: a preflight state change (e.g. a new authoritative blocked
  // verdict) re-evaluates the publish gate with the last binding
  // status — the server keeps being the authority for every other
  // precondition. The registration moved here from the inline script
  // (#848 C4.8 wiring movement): init() runs inside the same inline
  // bootstrap pass, before any preflight slice can be pushed, and the
  // one-time guard keeps repeated init calls from stacking callbacks.
  var preflightSubscriptionRegistered = false;

  function registerPreflightSubscription() {
    if (preflightSubscriptionRegistered) return;
    preflightSubscriptionRegistered = true;
    if (window.GraneteState) {
      window.GraneteState.subscribe(function (slice) {
        if (slice === "preflight" && modelBindingState.status) {
          renderPublishAvailability(modelBindingState.status);
        }
      });
    }
  }

  window.GraneteUI.modelBinding = {
    init: function (injected) {
      deps = injected || {};
      registerPreflightSubscription();
    },
    // UI/internal state rendering. The Ruby-facing fan-out (commercial
    // contexts + connected Project Furniture reload) stays in the
    // GraneteDialog.onModelBindingStatus wrapper — setStatus alone never
    // triggers it (same split as the pre-C4.8 renderModelBindingStatus).
    setStatus: function (status) { requireDeps(); renderModelBindingStatus(status); },
    onResult: function (result) { requireDeps(); handleModelBindingResult(result); },
    onPublishProgress: function (payload) { requireDeps(); renderPublishProgress(payload); },
    onPublishResult: function (result) { requireDeps(); handlePublishResult(result); },
    onDesignValidationProgress: function (payload) { requireDeps(); renderDesignValidationProgress(payload); },
    onDesignValidationResult: function (result) { requireDeps(); handleDesignValidationResult(result); },
    onBindingProjects: function (result) { requireDeps(); handleBindingProjects(result); },
    onBindingDesigns: function (result) { requireDeps(); handleBindingDesigns(result); },
    // Dep-free accessor for the Configurator seam (#848 C4.4 dep): the
    // only external read of the binding state.
    isConnected: function () {
      return !!(modelBindingState.status && modelBindingState.status.state === "connected");
    }
  };
})();
