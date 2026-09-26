// #848 Phase B C4.6 — material roles module.
// Owns:
// - the shared material/acabados authority: the material catalog
//   (catalogMaterials + material categories, set only through setCatalog)
// - the project-default material choices per role: TEMPORARY,
//   session-local defaults of this dialog for the current flow (the
//   choices the dialog seeds when no instance-specific choice exists;
//   they deliberately survive catalog refreshes). They are NOT persisted
//   project truth and NOT backend business truth — the authoritative
//   project/default state lives server-side; these only keep the dialog's
//   session coherent between renders
// - role-compatible material resolution (optionMaterialIds: the role's
//   curated optionIds when they resolve, else every active material)
// - default choice resolution per definition (project default when still
//   offered, else the first candidate)
// - material role rendering: role blocks, swatch, metadata, chevron and
//   the selector hand-off (Ruby-native PRIMARY, finish-selector fallback)
//
// Consumes:
// - window.GraneteUI.media (filenameFromPath/resolveUrl) — swatch
//   rendering only; no signed-URL storage or minting here
// - window.GraneteUI.finishSelector.open — local fallback at click time
//   when the Ruby-native selector is unavailable (call-time reference)
// - injected bootstrap dependencies via init(): the icon helper and the
//   read-only Inspector context accessors (getInspectorMaterialsCard,
//   getInspectorDef, getSelectedContext) that feed the context payload
//   fallback — Inspector state stays owned by the Inspector slice
//
// Does NOT own:
// - the Configurator material-choice snapshot (libMaterialChoices) —
//   callers keep their own choices; this module only renders into the
//   containers they pass and resolves materials for them
// - the Inspector material-choice snapshot (inspectorMaterialChoices),
//   the selected furniture/context itself, btnUpdate or the
//   update_furniture mutation
// - Finish Selector modal state (this module only opens it as fallback)
// - the hardware catalog (catalogHardware stays in the dialog bootstrap)
// - material_selector.html (the native Ruby dialog)
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.materialRoles) return;

  var catalogMaterialCategories = [];
  var catalogMaterials = [];
  var projectDefaultMaterials = {};

  // Injected by the dialog bootstrap before any render: the icon helper
  // and the Inspector context accessors (read-only, call-time).
  var deps = {};

  function requireDeps() {
    var missing = ["icon", "getInspectorMaterialsCard", "getInspectorDef",
      "getSelectedContext"].filter(function (name) { return typeof deps[name] !== "function"; });
    if (missing.length > 0) {
      throw new Error("GraneteUI.materialRoles.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  // Catalog slice setter called by the GraneteDialog.setCatalog
  // orchestrator with the resolved { materials, categories } shape (the
  // array-payload branch resolves to empty slices). projectDefaultMaterials
  // is intentionally NOT touched: a catalog refresh never resets the
  // session's project defaults.
  function setCatalog(slice) {
    slice = slice || {};
    catalogMaterialCategories = slice.categories || [];
    catalogMaterials = slice.materials || [];
  }

  function setProjectDefaultMaterial(role, id) {
    projectDefaultMaterials[role] = id;
  }

  function materialById(id) {
    for (var i = 0; i < catalogMaterials.length; i++) {
      if (catalogMaterials[i].materialId === id) return catalogMaterials[i];
    }
    return null;
  }

  // Material options for a role: the workshop's curated list when the
  // option group defines one, else every active material.
  function optionMaterialIds(roleEntry) {
    var ids = (roleEntry.optionIds || []).filter(function (id) { return !!materialById(id); });
    if (ids.length > 0) return ids;
    return catalogMaterials.map(function (m) { return m.materialId; });
  }

  function defaultMaterialChoices(def) {
    var choices = {};
    (def && def.materialRoles ? def.materialRoles : []).forEach(function (r) {
      var ids = optionMaterialIds(r);
      if (ids.length > 0) {
        if (projectDefaultMaterials[r.role] && ids.indexOf(projectDefaultMaterials[r.role]) !== -1) {
          choices[r.role] = projectDefaultMaterials[r.role];
        } else {
          choices[r.role] = ids[0];
        }
      }
    });
    return choices;
  }

  // Pre-existing dead code preserved verbatim (#848 C4.6): it had no
  // consumer anywhere (src or tests) at extraction time. Removing it is
  // its own cleanup, not this behavior-preserving slice.
  function materialOptionLabel(m) {
    if (!m) return "--";
    var label = m.name || m.code || m.materialId;
    if (m.code && m.name) label += " (" + m.code + ")";
    if (m.thicknessMm) label += " — " + m.thicknessMm + " mm";
    return label;
  }

  function updateMaterialSwatch(el, mat) {
    if (!mat) {
      el.removeAttribute("data-media-name");
      el.style.backgroundColor = "#e2e8f0";
      el.style.backgroundImage = "none";
      return;
    }
    var rawUrl = mat.previewTextureUrl || mat.imageUrl;
    var mediaName = window.GraneteUI.media.filenameFromPath(rawUrl);
    var url = window.GraneteUI.media.resolveUrl(rawUrl);
    if (mediaName) {
      // Tagged so a re-minted grant (updateMediaUrl) can repaint it.
      el.setAttribute("data-media-name", mediaName);
    } else {
      el.removeAttribute("data-media-name");
    }
    if (url) {
      el.style.backgroundImage = "url('" + url + "')";
      el.style.backgroundColor = mat.previewColor || "#e2e8f0";
    } else if (mat.previewColor) {
      el.style.backgroundImage = "none";
      el.style.backgroundColor = mat.previewColor;
    } else {
      el.style.backgroundImage = "none";
      el.style.backgroundColor = "#e2e8f0";
    }
  }

  function updateMaterialMeta(el, mat) {
    if (!mat) {
      el.textContent = "--";
      return;
    }
    var parts = [];
    if (mat.code) parts.push(mat.code);
    if (mat.thicknessMm) parts.push(mat.thicknessMm + " mm");
    if (mat.grain) parts.push("Veta");
    if (mat.manufacturer) parts.push(mat.manufacturer);
    el.textContent = parts.join(" · ");
  }

  function renderMaterialSelectors(card, container, def, choices, onChange, contextInfo) {
    requireDeps();
    var roles = (def && def.materialRoles ? def.materialRoles : []).filter(function (r) {
      return r && r.role && optionMaterialIds(r).length > 0;
    });
    card.style.display = roles.length > 0 ? "block" : "none";
    container.innerHTML = "";

    // The Inspector context accessors are call-time: the fallback keeps
    // the exact pre-extraction heuristic (card identity, definition
    // identity, selected instance) without owning Inspector state.
    var isInspector = (card === deps.getInspectorMaterialsCard() || def === deps.getInspectorDef());
    var ctx = contextInfo || {
      context: isInspector ? "inspector" : "configurator",
      instanceId: isInspector && deps.getSelectedContext() ? deps.getSelectedContext().furnitureInstanceRef : null,
      definitionId: def ? (def.furnitureDefinitionId || def.furniture_definition_id) : null
    };

    roles.forEach(function (r) {
      var availableIds = optionMaterialIds(r);
      if (!choices[r.role] || availableIds.indexOf(choices[r.role]) === -1) {
        choices[r.role] = availableIds[0];
      }
      var currentMat = materialById(choices[r.role]);

      var block = document.createElement("div");
      block.className = "material-role-block";

      // Header
      var header = document.createElement("div");
      header.className = "material-role-header";
      var title = document.createElement("span");
      title.className = "material-role-title";
      title.textContent = r.label || r.role;
      header.appendChild(title);
      block.appendChild(header);

      // Selected Preview (interactive card)
      var preview = document.createElement("div");
      preview.className = "material-selected-preview";
      preview.title = "Clic para abrir el selector de acabados";
      preview.setAttribute("role", "button");
      preview.setAttribute("tabindex", "0");
      preview.setAttribute("aria-label", "Cambiar material del rol " + (r.label || r.role));

      var swatch = document.createElement("div");
      swatch.className = "material-swatch";
      updateMaterialSwatch(swatch, currentMat);
      preview.appendChild(swatch);

      var info = document.createElement("div");
      info.className = "material-selected-info";

      var nameSpan = document.createElement("div");
      nameSpan.className = "material-selected-name";
      nameSpan.textContent = currentMat ? currentMat.name : "Seleccionar material";
      info.appendChild(nameSpan);

      var metaSpan = document.createElement("div");
      metaSpan.className = "material-selected-meta";
      updateMaterialMeta(metaSpan, currentMat);
      info.appendChild(metaSpan);

      preview.appendChild(info);

      // La fila es el control; el chevron comunica que abre el catálogo.
      var chevron = document.createElement("span");
      chevron.className = "material-chevron";
      chevron.innerHTML = deps.icon("chevron-right", 16);
      preview.appendChild(chevron);

      block.appendChild(preview);

      function triggerVisualPicker() {
        if (window.sketchup &&
            typeof window.sketchup.open_material_selector === "function") {
          window.sketchup.open_material_selector(JSON.stringify({
            role: r.role,
            roleName: r.label || r.role,
            currentMaterialId: choices[r.role],
            context: ctx.context,
            instanceId: ctx.instanceId,
            definitionId: ctx.definitionId,
            allowedMaterialIds: availableIds
          }));
        } else if (window.GraneteUI.finishSelector) {
          window.GraneteUI.finishSelector.open(r, choices[r.role], function (newId, scope) {
            choices[r.role] = newId;
            var newMat = materialById(newId);
            updateMaterialSwatch(swatch, newMat);
            nameSpan.textContent = newMat ? newMat.name : "Material";
            updateMaterialMeta(metaSpan, newMat);
            onChange(r.role, newId, scope);
          }, ctx.context);
        }
      }

      preview.addEventListener("click", triggerVisualPicker);
      preview.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerVisualPicker();
        }
      });

      container.appendChild(block);
    });
  }

  window.GraneteUI.materialRoles = {
    init: function (injected) { deps = injected || {}; },
    setCatalog: setCatalog,
    getMaterials: function () { return catalogMaterials; },
    getMaterialCategories: function () { return catalogMaterialCategories; },
    materialById: materialById,
    optionMaterialIds: optionMaterialIds,
    defaultMaterialChoices: defaultMaterialChoices,
    renderMaterialSelectors: renderMaterialSelectors,
    updateMaterialSwatch: updateMaterialSwatch,
    setProjectDefaultMaterial: setProjectDefaultMaterial
  };
})();
