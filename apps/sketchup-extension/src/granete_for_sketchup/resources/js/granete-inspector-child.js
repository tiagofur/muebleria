// #848 Phase B C4.7 — inspector CHILD module (part/hardware/aggregate).
// Boundary-adjusted split approved by the owner: granete-inspector.js
// measured 965 lines against the #848 ~800 hard target, so the Inspector
// CHILD surface moves to this second module. This is a real navigable
// responsibility, not a utils dump.
//
// Owns:
// - the CHILD Inspector rendering by kind: part, hardware and aggregate
//   (renderChildInspector + renderBreadcrumb + renderChildFacts +
//   renderCapabilityList)
// - the child DOM (inspector-child-view, breadcrumb, kind badge, origin/
//   owner notes, facts, capabilities, goto-furniture, #468 hardware
//   placement/conflict elements, #467 part authoring elements)
// - child provenance/origin/owner notes (manual/derived/unknown,
//   path/scan/ambiguous/none owner recovery)
// - #468 hardware child UI: placement card, provenance badge, anchor face
//   display, offset UI, replacement select, compatible/incompatible
//   rendering, derived locked state, drilling conflict banner, offset
//   mutation and hardware substitution handlers
// - #467 part child UI: authoring card, XYZ fields, move / viewport move /
//   duplicate / add / remove, mutation feedback and the
//   granete-mutation-state listener
//
// Consumes:
// - injected deps via init(): showToast, capabilityEnabled (the shared
//   helper stays single-implementation in dialog.html and is injected into
//   both Inspector modules), getHardwareCatalog (call-time accessor — the
//   hardware catalog slice stays owned by granete-inspector.js)
// - window.GraneteMutation (#498: hardware placement/substitution and
//   component mutations, call-time only), window.GraneteState (mutation
//   issues for the drilling banner and part feedback)
// - window.sketchup.select_furniture (breadcrumb + goto-furniture
//   navigation; viewport selection change only)
//
// Does NOT own:
// - selectedContext authority (granete-inspector.js does): this module
//   keeps NO second selection copy. activeChildContext below references
//   the SAME context object the Inspector passes to render(context) —
//   never a clone — and is cleared in hide() when the context leaves the
//   child lane. Handlers only fire while the child view is visible, and
//   every selection change re-renders or hides this module, so the
//   reference tracks the Inspector's selectedContext exactly.
// - business identity, the mutation state machine, the hardware catalog
//   state, the material catalog, manufacturing/preflight computation
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.inspectorChild) return;

  // Injected by the dialog bootstrap before any render: the toast and the
  // capability check are shared single implementations, and the hardware
  // catalog is read at call time from its owner (granete-inspector.js).
  var deps = {};

  function requireDeps() {
    var missing = ["showToast", "capabilityEnabled", "getHardwareCatalog"].filter(function (name) {
      return typeof deps[name] !== "function";
    });
    if (missing.length > 0) {
      throw new Error("GraneteUI.inspectorChild.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  // Child view context: the SAME object the Inspector routed here (set
  // only by render, cleared by hide). No clone, no second authority.
  var activeChildContext = null;

  // Child inspector elements
  var inspectorChild = document.getElementById("inspector-child-view");
  var childBreadcrumb = document.getElementById("child-breadcrumb");
  var childName = document.getElementById("child-name");
  var childKindBadge = document.getElementById("child-kind-badge");
  var childOriginNote = document.getElementById("child-origin-note");
  var childOwnerNote = document.getElementById("child-owner-note");
  var childFacts = document.getElementById("child-facts");
  var childCapabilities = document.getElementById("child-capabilities");
  var btnGotoFurniture = document.getElementById("btn-goto-furniture");

  // Hardware placement & conflict DOM elements (#468)
  var hwConflictBanner = document.getElementById("hw-conflict-banner");
  var hwConflictMessage = document.getElementById("hw-conflict-message");
  var hwConflictRemediation = document.getElementById("hw-conflict-remediation");
  var hwPlacementCard = document.getElementById("hw-placement-card");
  var hwDefName = document.getElementById("hw-def-name");
  var hwProvenanceBadge = document.getElementById("hw-provenance-badge");
  // #529: pertence a puerta (bisagra/jaladera) y nota de derivación por apertura.
  var hwDoorAffinityRow = document.getElementById("hw-door-affinity-row");
  var hwDoorAffinityVal = document.getElementById("hw-door-affinity-val");
  var hwOpeningDerivedNote = document.getElementById("hw-opening-derived-note");
  var hwFaceVal = document.getElementById("hw-face-val");
  var hwOffsetInput = document.getElementById("hw-offset-input");
  var btnApplyHwOffset = document.getElementById("btn-apply-hw-offset");
  var hwDerivedLockedNote = document.getElementById("hw-derived-locked-note");
  var hwReplacementSelect = document.getElementById("hw-replacement-select");
  var btnReplaceHw = document.getElementById("btn-replace-hw");
  var hwSubstitutionFeedback = document.getElementById("hw-substitution-feedback");

  // Internal component authoring DOM elements (#467)
  var partAuthoringCard = document.getElementById("part-authoring-card");
  var partPosX = document.getElementById("part-pos-x");
  var partPosY = document.getElementById("part-pos-y");
  var partPosZ = document.getElementById("part-pos-z");
  var btnApplyPartMove = document.getElementById("btn-apply-part-move");
  var btnPartViewportMove = document.getElementById("btn-part-viewport-move");
  var btnPartDuplicate = document.getElementById("btn-part-duplicate");
  var btnPartAdd = document.getElementById("btn-part-add");
  var btnPartRemove = document.getElementById("btn-part-remove");
  var partAuthoringFeedback = document.getElementById("part-authoring-feedback");

  var CAPABILITY_LABELS = {
    canEditParameters: "Editar parámetros",
    canEditMaterialRoles: "Cambiar materiales",
    canEditHighLevelHardware: "Editar herrajes del mueble",
    canDuplicate: "Duplicar",
    canDelete: "Eliminar",
    canReviewPreflight: "Revisar preflight",
    canInspectManufacturing: "Inspeccionar manufactura",
    canMoveWithinConstraint: "Mover dentro de restricciones",
    canAddRelated: "Agregar pieza relacionada",
    canRemove: "Quitar",
    canChangeJoinery: "Cambiar unión",
    canMove: "Mover herraje",
    canRotate: "Rotar herraje",
    canChangeHandedness: "Cambiar mano",
    canReplaceDefinition: "Reemplazar por compatible",
    canInspectMachining: "Inspeccionar mecanizado"
  };

  var KIND_BADGES = {
    part: "Pieza",
    hardware: "Herraje",
    aggregate: "Agregado"
  };

  // Display-only translation of the anchor-face enum; a missing value
  // renders "--" instead of a fabricated face and unknown values render
  // raw. Never touches the business payload.
  var ANCHOR_FACE_LABELS = {
    front: "Frontal",
    back: "Posterior",
    left: "Izquierda",
    right: "Derecha",
    top: "Superior",
    bottom: "Inferior"
  };

  function formatAnchorFace(anchorFace) {
    if (!anchorFace) return "--";
    return ANCHOR_FACE_LABELS[anchorFace] || anchorFace;
  }

  function renderChildInspector(context) {
    requireDeps();
    activeChildContext = context;
    inspectorChild.style.display = "block";
    childKindBadge.textContent = KIND_BADGES[context.kind] || context.kind;

    childName.textContent = (context.display && context.display.name) || "";

    renderBreadcrumb(context);

    if (context.kind === "hardware") {
      childOriginNote.style.display = "block";
      childOriginNote.textContent = context.placementKind === "manual"
        ? "Origen: colocación manual."
        : context.placementKind === "derived"
          ? "Origen: derivado de las reglas de la definición."
          : "Origen: sin determinar (faltan datos de procedencia).";
    } else {
      childOriginNote.style.display = "none";
    }

    childOwnerNote.style.display = "none";
    if (context.ownerRecovery === "ambiguous") {
      childOwnerNote.style.display = "block";
      childOwnerNote.textContent =
        "Hay varias copias del mismo mueble en el modelo; no se puede identificar con certeza el mueble dueño de esta pieza.";
    } else if (context.ownerRecovery === "none") {
      childOwnerNote.style.display = "block";
      childOwnerNote.textContent =
        "No se encontró el mueble dueño en el modelo (puede haber sido eliminado).";
    }

    // The button needs a resolvable owner ENTITY; an ambiguous or missing
    // owner is honestly not navigable.
    var ownerResolved = context.ownerRecovery === "path" || context.ownerRecovery === "scan";
    btnGotoFurniture.style.display = ownerResolved && context.furnitureInstanceRef ? "inline-flex" : "none";

    if (context.kind === "hardware") {
      if (hwPlacementCard) {
        hwPlacementCard.style.display = "block";
        var hardwareList = deps.getHardwareCatalog() || [];
        var currentDef = hardwareList.find(function (h) {
          return h.id === context.hardwareDefinitionId || h.code === context.hardwareDefinitionId;
        });
        if (hwDefName) hwDefName.textContent = currentDef ? currentDef.name : (context.hardwareDefinitionId || "--");
        if (hwFaceVal) hwFaceVal.textContent = formatAnchorFace(context.anchorFace);

        var isManual = context.placementKind === "manual";
        var isDerived = context.placementKind === "derived" || context.placementKind === "opening-derived";
        var doorAffinity = context.doorAffinity;
        var isDoorAccessory = !!doorAffinity ||
          (context.hardwareCategory === "hinge" || context.hardwareCategory === "handle" ||
           context.category === "hinge" || context.category === "handle");
        if (hwProvenanceBadge) {
          if (isManual) {
            hwProvenanceBadge.textContent = "Manual";
            hwProvenanceBadge.className = "status-badge success";
          } else if (isDerived && isDoorAccessory) {
            hwProvenanceBadge.textContent = "Derivado · Apertura";
            hwProvenanceBadge.className = "status-badge neutral";
          } else if (isDerived) {
            hwProvenanceBadge.textContent = "Derivado";
            hwProvenanceBadge.className = "status-badge pending";
          } else {
            hwProvenanceBadge.textContent = "Desconocido";
            hwProvenanceBadge.className = "status-badge";
          }
        }

        // #529: fila "Pertenece a puerta" (agrupación por apertura). Solo para
        // bisagras y jaladeras con doorAffinity (fuente: authoring-resolve /
        // Ruby bridge). El resto mantiene la card como estaba.
        if (hwDoorAffinityRow) {
          if (doorAffinity && (doorAffinity.accessoryRole === "hinge" || doorAffinity.accessoryRole === "handle")) {
            hwDoorAffinityRow.style.display = "flex";
            var roleCopy = doorAffinity.accessoryRole === "hinge" ? "Bisagra " : "Jaladera ";
            var ordinal = doorAffinity.accessoryIndex !== undefined && doorAffinity.accessoryIndex !== null
              ? (" " + (Number(doorAffinity.accessoryIndex) + 1)) : "";
            hwDoorAffinityVal.textContent =
              (doorAffinity.doorLabel || ("Puerta " + (Number(doorAffinity.doorSlotIndex || 0) + 1))) +
              " · " + roleCopy.trim() + ordinal;
          } else if (isDoorAccessory) {
            // Sin doorAffinity explícito pero sabemos que es bisagra/jaladera
            // → mostramos hint indicando que la asignación vendrá tras Apply.
            hwDoorAffinityRow.style.display = "flex";
            var hintRole = (context.hardwareCategory === "hinge" || context.category === "hinge") ? "Bisagra" : "Jaladera";
            hwDoorAffinityVal.textContent =
              "Pendiente de Aplicar · " + hintRole + " se vinculará a su puerta al confirmar el diseño.";
          } else {
            hwDoorAffinityRow.style.display = "none";
          }
        }

        var currentOffset = 0;
        if (Array.isArray(context.offsetMm)) {
          currentOffset = context.offsetMm.length > 1 ? context.offsetMm[1] : context.offsetMm[0];
        } else if (typeof context.offsetMm === "number") {
          currentOffset = context.offsetMm;
        }
        if (hwOffsetInput) {
          hwOffsetInput.value = currentOffset;
          hwOffsetInput.disabled = !isManual;
        }
        if (btnApplyHwOffset) btnApplyHwOffset.disabled = !isManual;
        if (hwDerivedLockedNote) hwDerivedLockedNote.style.display = (isDerived && !isDoorAccessory) ? "block" : "none";
        // #529: nota solo para accesorios de puerta derivados.
        if (hwOpeningDerivedNote) {
          hwOpeningDerivedNote.style.display = (isDerived && isDoorAccessory) ? "block" : "none";
        }

        if (hwReplacementSelect) {
          hwReplacementSelect.disabled = !isManual;
          hwReplacementSelect.innerHTML = "";
          // #1046 S2: sólo candidatos de la MISMA categoría (bisagra↔bisagra).
          // El resto del catálogo no se pinta ni deshabilitado: la card lista
          // lo que corresponde, nunca llena la pantalla con opciones ajenas.
          hardwareList.forEach(function (candidate) {
            var isComp = currentDef && candidate.category === currentDef.category;
            var isCurrent = candidate.id === context.hardwareDefinitionId || candidate.code === context.hardwareDefinitionId;
            if (!isComp && !isCurrent) return;
            var opt = document.createElement("option");
            opt.value = candidate.id;
            opt.textContent = isCurrent ? candidate.name + " (actual)" : candidate.name;
            if (isCurrent) {
              opt.selected = true;
            }
            hwReplacementSelect.appendChild(opt);
          });
          // Definición fuera del catálogo (borrada/renombrada): honesto —
          // una sola opción, la actual, en lugar de un select vacío.
          var rendered = hwReplacementSelect.options || hwReplacementSelect.children || [];
          if (rendered.length === 0 && context.hardwareDefinitionId) {
            var only = document.createElement("option");
            only.value = context.hardwareDefinitionId;
            only.textContent = hwDefName && hwDefName.textContent
              ? hwDefName.textContent + " (actual)"
              : context.hardwareDefinitionId;
            only.selected = true;
            hwReplacementSelect.appendChild(only);
          }
        }
        if (btnReplaceHw) btnReplaceHw.disabled = !isManual;
      }

      // Conflict banner: check recent mutation issues or preflight issues
      if (hwConflictBanner) {
        var mutState = window.GraneteState ? window.GraneteState.get("mutation") : null;
        var conflictIssue = null;
        if (mutState && mutState.issues && Array.isArray(mutState.issues)) {
          conflictIssue = mutState.issues.find(function (iss) {
            return iss.code === "DRILLING_CONFLICT";
          });
        }
        if (conflictIssue) {
          hwConflictBanner.style.display = "block";
          if (hwConflictMessage) hwConflictMessage.textContent = conflictIssue.message;
          if (hwConflictRemediation) hwConflictRemediation.textContent = conflictIssue.remediation || "Mover la bisagra a una posición libre de perforaciones de entrepaño.";
        } else {
          hwConflictBanner.style.display = "none";
        }
      }
    } else {
      if (hwPlacementCard) hwPlacementCard.style.display = "none";
      if (hwConflictBanner) hwConflictBanner.style.display = "none";
    }

    if (context.kind === "part") {
      renderPartAuthoringCard(context);
    } else if (partAuthoringCard) {
      partAuthoringCard.style.display = "none";
    }

    renderChildFacts(context);
    renderCapabilityList(childCapabilities, context.capabilities);
  }

  // #467 / SU-AUTH-1: the internal-component editor renders ONLY for
  // parts whose Ruby capability set marks them authorable. Position
  // inputs are prefilled with the server-resolved assembly pose; every
  // accepted pose comes back from the authoritative resolve.
  function renderPartAuthoringCard(context) {
    if (!partAuthoringCard) return;
    var movable = deps.capabilityEnabled(context, "canMoveWithinConstraint");
    var canDuplicate = deps.capabilityEnabled(context, "canDuplicate");
    var canAdd = deps.capabilityEnabled(context, "canAddRelated");
    var canRemove = deps.capabilityEnabled(context, "canRemove");
    var anyAction = movable || canDuplicate || canAdd || canRemove;
    partAuthoringCard.style.display = anyAction ? "block" : "none";
    if (!anyAction) return;

    var translation = Array.isArray(context.assemblyTranslationMm)
      ? context.assemblyTranslationMm : null;
    if (partPosX) {
      partPosX.value = translation ? translation[0] : "";
      partPosX.disabled = !movable;
    }
    if (partPosY) {
      partPosY.value = translation ? translation[1] : "";
      partPosY.disabled = !movable;
    }
    if (partPosZ) {
      partPosZ.value = translation ? translation[2] : "";
      partPosZ.disabled = !movable;
    }
    if (btnApplyPartMove) btnApplyPartMove.disabled = !movable;
    if (btnPartViewportMove) btnPartViewportMove.disabled = !movable;
    if (btnPartDuplicate) btnPartDuplicate.disabled = !canDuplicate;
    if (btnPartAdd) btnPartAdd.disabled = !canAdd;
    if (btnPartRemove) btnPartRemove.disabled = !canRemove;
    renderPartAuthoringFeedback();
  }

  // Honest post-command feedback: shows the last mutation issues for
  // this furniture (stable codes + messages from Ruby), never a local
  // guess. Clears when there are no issues to show.
  function renderPartAuthoringFeedback() {
    if (!partAuthoringFeedback) return;
    var mutState = window.GraneteState ? window.GraneteState.get("mutation") : null;
    var issue = null;
    if (mutState && Array.isArray(mutState.issues) && mutState.phase &&
        ["rejected", "aborted", "committed"].indexOf(mutState.phase) !== -1) {
      issue = mutState.issues[0] || null;
    }
    if (issue) {
      partAuthoringFeedback.textContent = issue.message || issue.code;
      partAuthoringFeedback.style.display = "block";
    } else {
      partAuthoringFeedback.textContent = "";
      partAuthoringFeedback.style.display = "none";
    }
  }

  function renderBreadcrumb(context) {
    childBreadcrumb.innerHTML = "";
    var path = context.semanticPath || [];

    var ownerKnown = (context.ownerRecovery === "path" || context.ownerRecovery === "scan");
    if (ownerKnown && context.furnitureInstanceRef && path.length > 1) {
      var ownerCrumb = document.createElement("button");
      ownerCrumb.type = "button";
      ownerCrumb.className = "crumb crumb-link";
      ownerCrumb.textContent = path[0];
      ownerCrumb.title = "Volver al contexto del mueble";
      ownerCrumb.addEventListener("click", function () {
        if (window.sketchup && window.sketchup.select_furniture) {
          window.sketchup.select_furniture(JSON.stringify({ furnitureInstanceRef: context.furnitureInstanceRef }));
        }
      });
      childBreadcrumb.appendChild(ownerCrumb);

      var sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "›";
      childBreadcrumb.appendChild(sep);
    }

    var current = document.createElement("span");
    current.className = "crumb current";
    current.textContent = path.length > 1 ? path[path.length - 1] : (context.display && context.display.name);
    childBreadcrumb.appendChild(current);
  }

  function renderChildFacts(context) {
    var facts = [
      ["Mueble (ref. local)", context.furnitureInstanceRef],
      ["Rol semántico", context.display && context.display.role],
      ["Ocurrencia (componentInstanceId)", context.componentInstanceId],
      ["Definición de pieza", context.componentDefinitionId],
      ["Referencia de catálogo", context.catalogComponentId],
      ["Colocación de herraje", context.hardwarePlacementId],
      ["Definición de herraje", context.hardwareDefinitionId],
      ["Pieza anfitriona", context.hostComponentInstanceId],
      ["Proyecto", context.projectId],
      ["Revisión base", context.baseRevisionId]
    ];

    childFacts.innerHTML = "";
    facts.forEach(function (fact) {
      if (!fact[1]) return;
      var row = document.createElement("div");
      row.className = "kv-row";
      var k = document.createElement("span");
      k.className = "k";
      k.textContent = fact[0];
      var v = document.createElement("span");
      v.className = "v";
      v.textContent = fact[1];
      row.appendChild(k);
      row.appendChild(v);
      childFacts.appendChild(row);
    });
  }

  function renderCapabilityList(container, capabilities) {
    container.innerHTML = "";
    var names = capabilities ? Object.keys(capabilities) : [];
    names.forEach(function (name) {
      var capability = capabilities[name] || {};
      var row = document.createElement("div");
      row.className = "capability-row";

      var head = document.createElement("div");
      head.className = "capability-row-head";
      var label = document.createElement("span");
      label.className = "capability-row-label";
      label.textContent = CAPABILITY_LABELS[name] || name;
      var badge = document.createElement("span");
      badge.className = "status-badge " + (capability.supported ? "valid" : "pending");
      badge.textContent = capability.supported ? "Disponible" : "No disponible";
      head.appendChild(label);
      head.appendChild(badge);
      row.appendChild(head);

      if (!capability.supported && capability.reason) {
        var reason = document.createElement("p");
        reason.className = "capability-reason";
        reason.textContent = capability.reason;
        row.appendChild(reason);
      }

      container.appendChild(row);
    });
  }

  // Breadcrumb "return to owning furniture": viewport selection change
  // only — the Ruby side never mutates geometry or metadata here.
  btnGotoFurniture.addEventListener("click", function () {
    if (!activeChildContext || !activeChildContext.furnitureInstanceRef) return;
    if (window.sketchup && window.sketchup.select_furniture) {
      window.sketchup.select_furniture(JSON.stringify({ furnitureInstanceRef: activeChildContext.furnitureInstanceRef }));
    }
  });

  // Interactive hardware placement editing (#468)
  if (btnApplyHwOffset) {
    btnApplyHwOffset.addEventListener("click", function () {
      if (!activeChildContext || activeChildContext.kind !== "hardware") return;
      if (activeChildContext.placementKind === "derived") {
        deps.showToast("warning", "Los herrajes derivados se calculan por regla de ingeniería; no admiten edición manual.");
        return;
      }
      var val = parseFloat(hwOffsetInput.value);
      if (isNaN(val)) return;
      if (window.GraneteMutation && typeof window.GraneteMutation.submitHardwarePlacementUpdate === "function") {
        window.GraneteMutation.submitHardwarePlacementUpdate(val, activeChildContext);
      }
    });
  }

  if (btnReplaceHw) {
    btnReplaceHw.addEventListener("click", function () {
      if (!activeChildContext || activeChildContext.kind !== "hardware") return;
      if (activeChildContext.placementKind === "derived") {
        deps.showToast("warning", "Los herrajes derivados no admiten sustitución manual.");
        return;
      }
      var targetId = hwReplacementSelect.value;
      if (!targetId) return;
      if (window.GraneteMutation && typeof window.GraneteMutation.submitHardwareSubstitution === "function") {
        window.GraneteMutation.submitHardwareSubstitution(targetId, activeChildContext);
      }
    });
  }

  // Internal component authoring (#467): precise-mm move, constrained
  // viewport drag, duplicate/add at the entered position and remove.
  // All rides the versioned authoring_mutation channel; the accepted
  // state comes only from the authoritative resolve.
  function partPositionFromInputs() {
    var x = parseFloat(partPosX.value);
    var y = parseFloat(partPosY.value);
    var z = parseFloat(partPosZ.value);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
    return [x, y, z];
  }

  function submitPartMutation(operation) {
    if (!activeChildContext || activeChildContext.kind !== "part") return;
    var translation = partPositionFromInputs();
    if (!translation && operation !== "remove") {
      deps.showToast("error", "Ingresá la posición en milímetros (X, Y y Z) del componente.");
      return;
    }
    var result = window.GraneteMutation.submitComponentMutation(operation, translation, activeChildContext);
    if (result === "busy") return;
    if (result === "unavailable") {
      deps.showToast("error", "Esta acción requiere la conexión con el servidor autoritativo de Granete.");
    }
  }

  if (btnApplyPartMove) {
    btnApplyPartMove.addEventListener("click", function () {
      submitPartMutation("move");
    });
  }

  if (btnPartViewportMove) {
    btnPartViewportMove.addEventListener("click", function () {
      if (!activeChildContext || activeChildContext.kind !== "part") return;
      var result = window.GraneteMutation.startComponentViewportMove(activeChildContext);
      if (result === "unavailable") {
        deps.showToast("error", "El gesto de viewport no está disponible para esta selección.");
      }
    });
  }

  if (btnPartDuplicate) {
    btnPartDuplicate.addEventListener("click", function () {
      submitPartMutation("duplicate");
    });
  }

  if (btnPartAdd) {
    btnPartAdd.addEventListener("click", function () {
      submitPartMutation("add");
    });
  }

  if (btnPartRemove) {
    btnPartRemove.addEventListener("click", function () {
      submitPartMutation("remove");
    });
  }

  // Mutation-state feedback refresh (#467): the shared controller
  // dispatches a DOM event after every outcome; the component editor
  // shows the authoritative issues without polling.
  document.addEventListener("granete-mutation-state", function () {
    renderPartAuthoringFeedback();
  });

  window.GraneteUI.inspectorChild = {
    init: function (injected) { deps = injected || {}; },
    render: renderChildInspector,
    // The Inspector calls this from its hideInspectorViews pass before
    // every re-render: the child view leaves the lane and drops its
    // context reference (no stale context survives a routing change).
    hide: function () {
      inspectorChild.style.display = "none";
      activeChildContext = null;
    }
  };
})();
