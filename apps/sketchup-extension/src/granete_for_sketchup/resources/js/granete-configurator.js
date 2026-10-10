// #848 Phase B C4.4 — configurator module.
// Owns:
// - the active catalog definition configuration: active definition,
//   current parameters (libParams), current material choices snapshot
// - configurator presets (chips filtered per definition) — one authority
// - the browser↔configurator view transition (open/close) and the
//   post-catalog-refresh re-entry (still-open definition or back to browser)
// - configurator preview (media-backed + isometric fallback) and the
//   measures/pieces summary dock
// - registered-measures display/restore
// - the catalog placement intent: insert button state, idempotency key,
//   #469 preview payload + repeat loop, and the insert result handlers
//   (onInsertionResult; onCreateProjectFurnitureResult — the connected
//   catalog-lane result used by BOTH the canonical #469 preview commit
//   (PlacementPreviewBridge#handle_commit_catalog_preview) and the legacy
//   create_project_furniture fallback)
//
// Consumes:
// - window.GraneteUI.library (definitions authority: findDefinitionById,
//   formatCategoryLabel) — never a second definitions collection
// - window.GraneteUI.media (filenameFromPath/resolveUrl/requestRefresh)
// - injected bootstrap dependencies via init(): shared presentation and
//   param helpers that stay single-implementation in dialog.html
//   (icon, showToast, createFurniturePlaceholderSvg, getDefaultParams,
//   renderParamForm, estimatedPartsLabel, parameterIssueMessage), the
//   material helpers from window.GraneteUI.materialRoles (#848 C4.6:
//   defaultMaterialChoices, renderMaterialSelectors, materialById), the
//   model-connected accessor (isModelConnected), the project-default
//   material write (setProjectDefaultMaterial → materialRoles) and the
//   project-side effects of the legacy create fallback (switchTab,
//   requestProjectFurniture, pfPlaceFailureMessage)
// - window.sketchup catalog placement callbacks
//   (begin_catalog_placement_preview, create_project_furniture,
//   insert_furniture)
//
// Does NOT own:
// - the material catalog/hierarchy/selector modal or role rendering
//   (renderMaterialSelectors/defaultMaterialChoices/materialById are
//   owned by window.GraneteUI.materialRoles since #848 C4.6) nor
//   projectDefaultMaterials
// - Inspector (still shares the inline param/summary helpers; material
//   helpers come from window.GraneteUI.materialRoles since #848 C4.6)
// - Project Furniture rows/lifecycle (switchTab/requestProjectFurniture
//   are injected effects of the legacy create fallback)
// - the shared #469 placement preview handlers
//   (onPlacementPreviewStarted/Cancelled stay inline: they serve the
//   Project lane too; this module exposes the catalog-side re-arm state)
// - FurnitureInstance identity, host geometry, snap, manufacturing
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.configurator) return;

  var activeLibDef = null;
  var libParams = {};
  var libMaterialChoices = {};
  var libUserCustomizedRoles = {};
  var catalogPresets = [];
  var catalogCreateIntentKey = null;
  // #469 repeat placement: the last catalog intent (definition +
  // parameters + material choices) that entered the preview flow.
  // After a successful catalog placement the SAME preset re-begins
  // the shared preview — each click is a FULL fresh gesture (new
  // session, new preparation, new guards) with a FRESH idempotency
  // key; Esc ends the loop.
  var lastCatalogPlacementPayload = null;
  var repeatPreviewActive = false;

  // Injected by the dialog bootstrap before any render: shared helpers
  // stay single-implementation (param forms are shared with the
  // Inspector until its own Phase B slice; material helpers come from
  // window.GraneteUI.materialRoles since #848 C4.6).
  var deps = {};

  // Browser↔configurator transition elements
  var libBrowserView = document.getElementById("library-browser-view");
  var libConfiguratorView = document.getElementById("library-configurator-view");
  var btnRegisteredMeasures = document.getElementById("btn-registered-measures");

  // Configurator elements
  var btnBackToLibrary = document.getElementById("btn-back-to-library");
  var libSelectedName = document.getElementById("library-selected-name");
  var libSelectedCode = document.getElementById("library-selected-code");
  var libSelectedCategoryBadge = document.getElementById("library-selected-category-badge");
  var libDesc = document.getElementById("library-furniture-desc");
  var libPresetsCard = document.getElementById("library-presets-card");
  var libPresetsContainer = document.getElementById("library-presets-container");
  var libParamsCard = document.getElementById("library-params-card");
  var libParamsContainer = document.getElementById("library-params-container");
  var libMaterialsCard = document.getElementById("library-materials-card");
  // #1144: pre-insert hardware group selectors (one per consumed group).
  var libHardwareCard = document.getElementById("library-hardware-card");
  var libHardwareContainer = document.getElementById("library-hardware-container");
  var libMaterialsContainer = document.getElementById("library-materials-container");
  var libSummaryDims = document.getElementById("library-summary-dims");
  var libSummaryParts = document.getElementById("library-summary-parts");
  var btnInsert = document.getElementById("btn-insert");

  function requireDeps() {
    var missing = ["icon", "showToast", "createFurniturePlaceholderSvg", "getDefaultParams",
      "renderParamForm", "defaultMaterialChoices", "renderMaterialSelectors", "materialById",
      "estimatedPartsLabel", "parameterIssueMessage", "isModelConnected",
      "setProjectDefaultMaterial", "switchTab", "requestProjectFurniture",
      "pfPlaceFailureMessage"].filter(function (name) { return typeof deps[name] !== "function"; });
    if (missing.length > 0) {
      throw new Error("GraneteUI.configurator.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  // Browser side of the pane switch (was the inline showLibraryView):
  // the configurator owns both directions of the browser↔configurator
  // transition; the browser CONTENT stays GraneteUI.library's.
  function showBrowserView() {
    clearCatalogIntentKey();
    libBrowserView.style.display = "block";
    libConfiguratorView.style.display = "none";
    window.GraneteUI.library.render();
  }

  function showConfiguratorView(def) {
    clearCatalogIntentKey();
    activeLibDef = def;
    libBrowserView.style.display = "none";
    libConfiguratorView.style.display = "block";

    libSelectedName.textContent = def.name || "Mueble";
    libSelectedCode.textContent = def.code || "";
    libSelectedCategoryBadge.textContent = window.GraneteUI.library.formatCategoryLabel(def.category);
    libDesc.textContent = def.description || "";
    libDesc.title = def.description || "";
    renderConfiguratorPreview(def);

    libParams = deps.getDefaultParams(def);
    libMaterialChoices = deps.defaultMaterialChoices(def);
    libUserCustomizedRoles = {};

    bindLibraryParamForm();
    // #784 R4: the explicit customization signal travels to the shared
    // renderer — the lineage badge never falls back to value equality.
    deps.renderMaterialSelectors(libMaterialsCard, libMaterialsContainer, def, libMaterialChoices, function (role, id, scope) {
      libMaterialChoices[role] = id;
      libUserCustomizedRoles[role] = true;
      clearCatalogIntentKey();
      if (scope === "project" || scope === "project_default") {
        deps.setProjectDefaultMaterial(role, id);
      }
    }, configuratorLineageContext(def));
    // #1144: herrajes por grupo — elijo el modelo ANTES de insertar.
    seedLibraryHardwareChoices(def);
    renderLibraryHardwareRoles(def);
    renderRegisteredMeasuresButton(def);
    renderPresetChips();

    updateLibrarySummary();
    updateLibraryInsertButton();
  }

  // ------------------------------------------------------------------
  // #1144 — Herrajes del mueble en la configuración de inserción. Los
  // grupos (hardwareRoles de la definición, proyección del taller) se
  // eligen ACÁ y viajan en el MISMO mapa materialChoices del insert: el
  // resolve sustituye el concreto antes de posiciones/perforaciones/
  // demanda/precio. Default = primer miembro activo (igual que los
  // acabados); la elección es visible y cambiable, nunca un pin oculto.
  // ------------------------------------------------------------------
  function hardwareEntryById(id) {
    var list = typeof deps.getHardwareCatalog === "function" ? (deps.getHardwareCatalog() || []) : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && (list[i].id === id || list[i].code === id)) return list[i];
    }
    return null;
  }

  function hardwareRoles(def) {
    return (def && Array.isArray(def.hardwareRoles)) ? def.hardwareRoles : [];
  }

  function seedLibraryHardwareChoices(def) {
    hardwareRoles(def).forEach(function (role) {
      if (role.optionIds && role.optionIds.length > 0) {
        libMaterialChoices[role.code] = role.optionIds[0];
      } else {
        delete libMaterialChoices[role.code];
      }
    });
  }

  // #1258: el selector de herrajes de Biblioteca es el MISMO catálogo
  // flotante con imágenes que usa el Inspector (open_hardware_selector,
  // context "configurator") — nunca un <select> plano. La fila replica el
  // patrón visual del Inspector: tile con imagen, nombre, meta y chevron.
  function renderLibraryHardwareRoles(def) {
    if (!libHardwareCard || !libHardwareContainer) return;
    var roles = hardwareRoles(def);
    if (roles.length === 0) {
      libHardwareCard.style.display = "none";
      return;
    }
    libHardwareCard.style.display = "block";

    libHardwareContainer.innerHTML = "";
    roles.forEach(function (role) {
      var membersKnown = role.optionIds && role.optionIds.length > 0;
      var chosenId = membersKnown ? libMaterialChoices[role.code] : null;
      var chosen = chosenId ? hardwareEntryById(chosenId) : null;

      var block = document.createElement("div");
      block.className = "material-role-block";

      var header = document.createElement("div");
      header.className = "material-role-header";
      var title = document.createElement("span");
      title.className = "material-role-title";
      title.textContent = role.name || role.code;
      header.appendChild(title);
      if (role.required) {
        var req = document.createElement("span");
        req.className = "status-badge neutral";
        req.textContent = "requerido";
        header.appendChild(req);
      }
      var changeBtn = document.createElement("button");
      changeBtn.type = "button";
      changeBtn.id = "library-hardware-change-" + role.code;
      changeBtn.className = "btn btn-secondary btn-sm design-insp-change";
      changeBtn.style.width = "auto";
      changeBtn.style.padding = "2px 10px";
      changeBtn.style.fontSize = "var(--text-xs)";
      changeBtn.style.lineHeight = "1.4";
      changeBtn.textContent = chosenId ? "Cambiar" : "Asignar";
      changeBtn.disabled = !membersKnown;
      changeBtn.title = membersKnown ? "" : "Sin miembros activos en el catálogo";
      header.appendChild(changeBtn);
      block.appendChild(header);

      var preview = document.createElement("button");
      preview.type = "button";
      preview.className = "material-selected-preview";
      preview.style.marginTop = "var(--space-1)";
      preview.title = membersKnown ? "Clic para abrir el catálogo de herrajes" : "Sin miembros activos en el catálogo";
      preview.disabled = !membersKnown;

      var tile = document.createElement("span");
      tile.className = "material-swatch material-swatch--hardware";
      var rawImg = chosen ? (chosen.imageUrl || chosen.image_url || chosen.thumbnailUrl || chosen.previewUrl) : null;
      var resolvedImg = (rawImg && window.GraneteUI && window.GraneteUI.media &&
                         typeof window.GraneteUI.media.resolveUrl === "function")
        ? window.GraneteUI.media.resolveUrl(rawImg) : rawImg;
      if (resolvedImg) {
        tile.style.backgroundImage = "url('" + resolvedImg + "')";
        tile.style.backgroundSize = "contain";
        tile.style.backgroundRepeat = "no-repeat";
        tile.style.backgroundPosition = "center";
        tile.style.backgroundColor = "var(--surface-card)";
      } else {
        tile.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8 4.5v10l-8 4.5L4 17V7z"/><circle cx="12" cy="12" r="3"/></svg>';
      }
      preview.appendChild(tile);

      var info = document.createElement("span");
      info.className = "material-selected-info";
      var nameSpan = document.createElement("span");
      nameSpan.className = "material-selected-name";
      nameSpan.textContent = chosen ? (chosen.name || chosen.code) : (chosenId || "--");
      info.appendChild(nameSpan);
      var metaSpan = document.createElement("span");
      metaSpan.className = "material-selected-meta";
      metaSpan.textContent = membersKnown
        ? ((chosen && chosen.code) ? chosen.code : "Clic para elegir un herraje del catálogo")
        : "Sin miembros activos en el catálogo";
      info.appendChild(metaSpan);
      preview.appendChild(info);

      var chevron = document.createElement("span");
      chevron.className = "material-chevron";
      chevron.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
      preview.appendChild(chevron);

      var openPicker = function () {
        if (!membersKnown) return;
        openLibraryHardwareSelector(role, chosenId);
      };
      preview.addEventListener("click", openPicker);
      changeBtn.addEventListener("click", function (evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        openPicker();
      });
      block.appendChild(preview);

      libHardwareContainer.appendChild(block);
    });
  }

  function openLibraryHardwareSelector(role, currentId) {
    var label = role.name || role.code;
    if (window.sketchup && typeof window.sketchup.open_hardware_selector === "function") {
      window.sketchup.open_hardware_selector(JSON.stringify({
        groupCode: role.code,
        groupName: label,
        currentHardwareId: currentId || null,
        optionIds: role.optionIds || [],
        context: "configurator"
      }));
    } else if (window.GraneteUI.hardwareGroupSelector) {
      var rows = (role.optionIds || []).map(function (hwId) {
        var entry = hardwareEntryById(hwId);
        return {
          id: hwId,
          name: entry ? (entry.name || entry.code) : hwId,
          code: entry ? entry.code : null,
          imageUrl: entry ? (entry.imageUrl || entry.image_url) : null
        };
      });
      window.GraneteUI.hardwareGroupSelector.open({
        title: "Elegir " + label,
        groupLabel: label,
        rows: rows,
        chosenId: currentId,
        onPick: function (hwId) {
          applyHardwareChoice(role.code, hwId);
        }
      });
    }
  }

  // #1258: la elección del catálogo flotante aterriza en el MISMO mapa
  // materialChoices del insert (#1144/#1153) — nada de estado paralelo.
  function applyHardwareChoice(groupCode, hardwareId) {
    if (!groupCode || !hardwareId) return;
    if (!libMaterialChoices) libMaterialChoices = {};
    libMaterialChoices[groupCode] = hardwareId;
    if (!libUserCustomizedRoles) libUserCustomizedRoles = {};
    libUserCustomizedRoles[groupCode] = true;
    clearCatalogIntentKey();
    renderLibraryHardwareRoles(activeLibDef);
    updateLibraryInsertButton();
    var entry = hardwareEntryById(hardwareId);
    deps.showToast("success", "✓ Herraje seleccionado: " +
      (entry ? (entry.name || entry.code) : hardwareId));
  }

  // Un grupo requerido sin elección real (sin miembros activos) bloquea
  // Insertar con motivo honesto — el resolve lo rechazaría igual.
  function unchosenRequiredHardwareRoles(def) {
    return hardwareRoles(def).filter(function (role) {
      return role.required && (!libMaterialChoices[role.code] || !hardwareEntryById(libMaterialChoices[role.code]));
    });
  }

  // #784 R4: explicit lineage context for the shared material renderer.
  // customizedRoles is the ONLY override signal (tracked on user input);
  // designLineage gates the badges to connected models — an unbound insert
  // carries no lineage statement at all.
  function configuratorLineageContext(def) {
    return {
      context: "configurator",
      definitionId: def ? (def.furnitureDefinitionId || def.furniture_definition_id) : null,
      customizedRoles: libUserCustomizedRoles,
      designLineage: typeof deps.isModelConnected === "function" ? deps.isModelConnected() : false
    };
  }

  // Preview del mueble en el encabezado del configurador: la misma
  // maquinaria de media de las tarjetas (grant re-mintable + fallback
  // isométrico) para que nunca haya una configuración a ciegas.
  function renderConfiguratorPreview(def) {
    var host = document.getElementById("library-selected-preview");
    if (!host) return;
    host.innerHTML = "";

    var rawUrl = def.imageUrl || def.thumbnailUrl || def.previewUrl;
    var mediaName = window.GraneteUI.media.filenameFromPath(rawUrl);
    var imageUrl = window.GraneteUI.media.resolveUrl(rawUrl);

    if (imageUrl) {
      var img = document.createElement("img");
      img.alt = def.name || "";
      if (mediaName) {
        img.setAttribute("data-media-name", mediaName);
        img.onerror = function () {
          host.innerHTML = deps.createFurniturePlaceholderSvg();
          window.GraneteUI.media.requestRefresh(mediaName);
        };
      } else {
        img.onerror = function () {
          host.innerHTML = deps.createFurniturePlaceholderSvg();
        };
      }
      img.src = imageUrl;
      host.appendChild(img);
    } else {
      host.innerHTML = deps.createFurniturePlaceholderSvg();
    }
  }

  function updateLibraryInsertButton() {
    if (!btnInsert) return;
    // #1144: un grupo requerido sin elección bloquea la inserción con el
    // motivo concreto (el resolve fallaría cerrado igual — nunca a ciegas).
    var missing = unchosenRequiredHardwareRoles(activeLibDef);
    if (missing.length > 0) {
      btnInsert.disabled = true;
      btnInsert.title = "Elegí herraje para: " +
        missing.map(function (r) { return r.name || r.code; }).join(", ");
      return;
    }
    var isConnected = deps.isModelConnected();
    if (isConnected) {
      btnInsert.innerHTML = deps.icon("plus") + "<span>Agregar al diseño</span>";
      btnInsert.title = "Crea un nuevo mueble en el proyecto y lo agrega a este diseño";
    } else {
      btnInsert.innerHTML = deps.icon("plus") + "<span>Insertar en Modelo</span>";
      btnInsert.title = "Inserta el mueble localmente en el modelo";
    }
  }

  function bindLibraryParamForm() {
    deps.renderParamForm(libParamsContainer, activeLibDef, libParams, function (name, val, unit) {
      libParams[name] = val;
      clearCatalogIntentKey();
      updateLibrarySummary();
    });
  }

  // Dimension parameters of a definition (mm measures).
  function registeredMeasureParams(def) {
    return (def && def.parameters ? def.parameters : []).filter(function (p) {
      return p.type === "number" && p.unit === "mm" &&
        (p.name === "widthMm" || p.name === "heightMm" || p.name === "depthMm" || p.name === "lengthMm");
    });
  }

  // The button both SHOWS the measures registered on the furniture
  // record and restores them as the current authoring values.
  function renderRegisteredMeasuresButton(def) {
    var dims = registeredMeasureParams(def);
    if (!activeLibDef || dims.length === 0) {
      btnRegisteredMeasures.style.display = "none";
      btnRegisteredMeasures.onclick = null;
      return;
    }
    var values = dims.map(function (p) { return p.defaultValue + " mm"; }).join(" × ");
    btnRegisteredMeasures.innerHTML = deps.icon("ruler", 14) + "<span>Medidas registradas: " + values + "</span>";
    btnRegisteredMeasures.style.display = "flex";
    btnRegisteredMeasures.onclick = function () {
      registeredMeasureParams(activeLibDef).forEach(function (p) {
        libParams[p.name] = p.defaultValue;
      });
      bindLibraryParamForm();
      updateLibrarySummary();
      deps.showToast("success", "Medidas del registro aplicadas: " + values);
    };
  }

  function renderPresetChips() {
    libPresetsContainer.innerHTML = "";
    if (!activeLibDef) {
      libPresetsCard.style.display = "none";
      return;
    }
    var mine = catalogPresets.filter(function (preset) {
      return preset.furnitureDefinitionId === activeLibDef.furniture_definition_id;
    });
    libPresetsCard.style.display = mine.length > 0 ? "block" : "none";
    mine.forEach(function (preset) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "preset-chip";
      chip.textContent = preset.name;
      chip.addEventListener("click", function () {
        libParams = Object.assign({}, deps.getDefaultParams(activeLibDef), preset.parameters || {});
        bindLibraryParamForm();
        libPresetsContainer.querySelectorAll(".preset-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        updateLibrarySummary();
      });
      libPresetsContainer.appendChild(chip);
    });
  }

  function updateLibrarySummary() {
    var w = libParams.widthMm || libParams.lengthMm || 600;
    var h = libParams.heightMm || 720;
    var d = libParams.depthMm || 590;
    libSummaryDims.textContent = w + " × " + h + " × " + d + " mm";
    libSummaryParts.textContent = deps.estimatedPartsLabel(activeLibDef, libParams);
  }

  function getOrCreateCatalogIntentKey() {
    if (!catalogCreateIntentKey) {
      catalogCreateIntentKey = generateIdempotencyKey();
    }
    return catalogCreateIntentKey;
  }

  function clearCatalogIntentKey() {
    catalogCreateIntentKey = null;
  }

  function generateIdempotencyKey() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return "idem-" + Date.now() + "-" + Math.random().toString(36).substring(2, 11);
  }

  // #469 repeat placement — re-begins the shared preview for the SAME
  // catalog preset after a successful placement. Every placement stays
  // one complete fresh gesture through the same entry point: the
  // bridge round trip guarantees the previous tool already unwound,
  // and a FRESH idempotency key mints a distinct identity per click
  // (retry within one gesture keeps that gesture's key). Returns
  // false when repeat is not possible (no callback / no payload) —
  // the caller then keeps the normal one-shot behavior.
  function beginRepeatCatalogPreview() {
    if (!lastCatalogPlacementPayload) return false;
    if (!window.sketchup || !window.sketchup.begin_catalog_placement_preview) return false;

    repeatPreviewActive = true;
    btnInsert.disabled = true;
    btnInsert.innerHTML = deps.icon("clock") + "<span>Vista previa en el modelo…</span>";
    clearCatalogIntentKey();
    var payload = Object.assign({}, lastCatalogPlacementPayload);
    payload.idempotencyKey = getOrCreateCatalogIntentKey();
    window.sketchup.begin_catalog_placement_preview(JSON.stringify(payload));
    return true;
  }

  function onInsertionResult(result) {
    btnInsert.disabled = false;
    updateLibraryInsertButton();
    if (result && result.success) {
      var detail = "";
      if (typeof result.component_count === "number" && result.component_count > 0) {
        detail = " — " + result.component_count + " componente" + (result.component_count === 1 ? "" : "s");
        if (typeof result.hardware_count === "number" && result.hardware_count > 0) {
          detail += " (" + result.hardware_count + " herraje" + (result.hardware_count === 1 ? "" : "s") + ")";
        }
      }
      if (result.placed_via_preview) {
        // #469: the click already placed the furniture at its final
        // position — no Move handoff exists to advertise. Repeat
        // placement: the same preset previews again for the next
        // click (each one its own fresh local unit); Esc ends it.
        deps.showToast("success", "✓ Mueble " + (result.name || "") + " insertado" + detail + ".");
        beginRepeatCatalogPreview();
      } else {
        // Legacy origin-first fallback: the Move handoff is real.
        deps.showToast("success", "✓ Mueble " + (result.name || "") + " insertado" + detail +
          ". Quedó seleccionado: movelo a su lugar (tecla M).");
      }
    } else {
      repeatPreviewActive = false;
      deps.showToast("error", deps.parameterIssueMessage(result, "No se pudo insertar el mueble."));
    }
  }

  // Connected catalog-lane result handler. Ruby reports here from BOTH
  // the canonical #469 connected preview commit
  // (PlacementPreviewBridge#handle_commit_catalog_preview) and the legacy
  // create_project_furniture fallback — both bridge calls originate in the
  // configurator's insert lane. The project-side effects (tab switch +
  // rows reload + failure copy) are injected dependencies, not owned
  // state.
  function onCreateProjectFurnitureResult(result) {
    result = result || {};
    btnInsert.disabled = false;
    updateLibraryInsertButton();
    if (result.ok) {
      clearCatalogIntentKey();
      if (typeof deps.refreshDesignInheritance === "function") {
        deps.refreshDesignInheritance();
      }
      if (result.code === "pending_position") {
        deps.showToast("info", "✓ Mueble agregado al proyecto: ubicalo con la herramienta Mover y confirmá su posición final en la pestaña Proyecto.");
      } else if (beginRepeatCatalogPreview()) {
        // #469 repeat placement: the same preset previews again —
        // each further click mints its own FurnitureInstance. Stay on
        // the library for the loop; Esc ends it.
        deps.showToast("success", "✓ Mueble creado y agregado al proyecto.");
        deps.requestProjectFurniture();
        return;
      } else {
        deps.showToast("success", "✓ Mueble creado y agregado al proyecto.");
      }
      deps.switchTab("project");
      deps.requestProjectFurniture();
    } else if (result.code === "created_pending") {
      clearCatalogIntentKey();
      deps.showToast("warning", "El mueble fue creado en el proyecto (" + (result.instanceId || "") + ") pero falló la inserción geométrica local. Podés colocarlo desde la lista del Proyecto.");
      deps.switchTab("project");
      deps.requestProjectFurniture();
    } else {
      repeatPreviewActive = false;
      deps.showToast("error", deps.pfPlaceFailureMessage(result));
    }
  }

  // Configurator branch of GraneteDialog.onMaterialChoiceApplied: the
  // visual picker (Ruby) applied a finish while a definition is being
  // configured. The renderer, material lookup and project-default
  // write stay injected shared authorities.
  function applyMaterialChoice(role, materialId, isProjectScope) {
    if (!libMaterialChoices) libMaterialChoices = {};
    libMaterialChoices[role] = materialId;
    if (!libUserCustomizedRoles) libUserCustomizedRoles = {};
    libUserCustomizedRoles[role] = true;

    deps.renderMaterialSelectors(libMaterialsCard, libMaterialsContainer, activeLibDef, libMaterialChoices, function (r, id, s) {
      libMaterialChoices[r] = id;
      libUserCustomizedRoles[r] = true;
      if (s === "project" || s === "project_default") {
        deps.setProjectDefaultMaterial(r, id);
      }
    }, configuratorLineageContext(activeLibDef));
    updateLibrarySummary();

    var matLib = deps.materialById(materialId);
    var toastLibMsg = isProjectScope
      ? "✓ Acabado temporal de sesión: " + (matLib ? matLib.name : materialId)
      : "✓ Acabado seleccionado: " + (matLib ? matLib.name : materialId);
    deps.showToast("success", toastLibMsg);
  }

  btnBackToLibrary.addEventListener("click", function () {
    activeLibDef = null;
    showBrowserView();
  });

  btnInsert.addEventListener("click", function () {
    if (!activeLibDef) return;
    btnInsert.disabled = true;
    repeatPreviewActive = false; // a manual begin is never a repeat

    var isConnected = deps.isModelConnected();

    var payload = {
      definitionId: activeLibDef.furniture_definition_id || activeLibDef.furnitureDefinitionId,
      parameters: libParams,
      materialChoices: libMaterialChoices
    };

    if (isConnected) {
      var overrides = {};
      for (var r in libUserCustomizedRoles) {
        if (libUserCustomizedRoles[r] && libMaterialChoices[r]) {
          overrides[r] = libMaterialChoices[r];
        }
      }
      // #1153: hardware group choices ALWAYS ride as overrides — they are
      // explicit pre-insert selections and the design carries no hardware
      // defaults yet; without them the connected resolve loses the choice.
      hardwareRoles(activeLibDef).forEach(function (role) {
        if (libMaterialChoices[role.code]) {
          overrides[role.code] = libMaterialChoices[role.code];
        }
      });
      payload.materialOverrides = overrides;
    }

    if (window.sketchup && window.sketchup.begin_catalog_placement_preview) {
      // #469: the SAME shared preview tool as the Project panel for
      // BOTH lanes — the Ruby side picks identity provenance from the
      // model binding (connected → #390 FurnitureInstance at commit;
      // local/disconnected → local insert semantics). The connection
      // never gates the placement interaction, and identity is minted
      // only at the commit click — never while browsing or previewing.
      btnInsert.innerHTML = deps.icon("clock") + "<span>Vista previa en el modelo…</span>";
      payload.idempotencyKey = getOrCreateCatalogIntentKey();
      lastCatalogPlacementPayload = payload;
      window.sketchup.begin_catalog_placement_preview(JSON.stringify(payload));
    } else if (isConnected && window.sketchup && window.sketchup.create_project_furniture) {
      // Legacy compat fallback (older host / degraded runtime).
      btnInsert.innerHTML = deps.icon("clock") + "<span>Agregando al diseño…</span>";
      payload.idempotencyKey = getOrCreateCatalogIntentKey();
      window.sketchup.create_project_furniture(JSON.stringify(payload));
    } else if (window.sketchup && window.sketchup.insert_furniture) {
      // Legacy compat fallback: origin-first insert + Move handoff.
      btnInsert.innerHTML = deps.icon("clock") + "<span>Insertando…</span>";
      window.sketchup.insert_furniture(JSON.stringify(payload));
    } else {
      btnInsert.innerHTML = deps.icon("clock") + "<span>Insertando…</span>";
      setTimeout(function () {
        window.GraneteDialog.onInsertionResult({ success: true, name: activeLibDef.name });
      }, 500);
    }
  });

  window.GraneteUI.configurator = {
    // Injects the shared inline helpers. Must run in the bootstrap
    // BEFORE any render or bridge call: the module never renders at
    // load time.
    init: function (injected) {
      deps = injected || {};
      requireDeps();
    },

    // Library ends at the choice: open(def) is the onSelectDefinition
    // hand-off (was the inline showConfiguratorView entry point).
    open: function (def) {
      requireDeps();
      showConfiguratorView(def);
    },

    // Back to the browser: resets the active definition and renders
    // the library view (btn-back-to-library path).
    close: function () {
      requireDeps();
      activeLibDef = null;
      showBrowserView();
    },

    getActiveDefinitionId: function () {
      return activeLibDef ? activeLibDef.furniture_definition_id : null;
    },

    // Exact truthiness of the active definition (distinct from
    // getActiveDefinitionId: selection-change/material routing reads
    // the definition object's presence, not its id).
    hasActiveDefinition: function () {
      return !!activeLibDef;
    },

    setPresets: function (presets) {
      catalogPresets = presets || [];
    },

    // setCatalog refresh tail: if a definition is being configured and
    // still exists, re-open the configurator with the fresh definition;
    // otherwise show the browser. Preserves the pre-existing quirk: a
    // disappeared definition does NOT reset the active reference.
    refreshAfterCatalog: function () {
      requireDeps();
      if (activeLibDef) {
        var found = window.GraneteUI.library.findDefinitionById(activeLibDef.furniture_definition_id);
        if (found) {
          showConfiguratorView(found);
        } else {
          showBrowserView();
        }
      } else {
        showBrowserView();
      }
    },

    // Model binding re-render hook (was the inline
    // updateLibraryInsertButton call from renderModelBindingStatus).
    updateInsertButton: function () {
      requireDeps();
      updateLibraryInsertButton();
    },

    // Catalog-lane re-arm used by the shared #469 placement preview
    // handlers (started-refused / cancelled).
    rearmInsertButton: function () {
      requireDeps();
      btnInsert.disabled = false;
      updateLibraryInsertButton();
    },

    isRepeatPreviewActive: function () {
      return repeatPreviewActive;
    },

    cancelRepeatPreview: function () {
      repeatPreviewActive = false;
    },

    getIntentKey: function () {
      return catalogCreateIntentKey;
    },

    onInsertionResult: function (result) {
      requireDeps();
      onInsertionResult(result);
    },

    onCreateProjectFurnitureResult: function (result) {
      requireDeps();
      onCreateProjectFurnitureResult(result);
    },

    applyMaterialChoice: function (role, materialId, isProjectScope) {
      requireDeps();
      applyMaterialChoice(role, materialId, isProjectScope);
    },

    // #1258: pick del catálogo flotante de herrajes (context "configurator").
    applyHardwareChoice: function (groupCode, hardwareId) {
      requireDeps();
      applyHardwareChoice(groupCode, hardwareId);
    }
  };
})();
