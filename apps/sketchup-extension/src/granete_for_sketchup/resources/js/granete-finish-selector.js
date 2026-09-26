// #848 Phase B C4.5 — finish selector module.
// Owns:
// - the visual material picker modal interaction (Slice B - Miller
//   Columns): open/close lifecycle, selectorCtx, selectorLastFocus
// - category navigation inside the modal (L1/L2/L3 columns, breadcrumb)
// - search (name/code/manufacturer), subtree + role-allowed filtering
// - the candidate grid (swatch cards, grain badge, selected check,
//   code/thickness/manufacturer tags) and the material detail inspector
// - selected candidate, Apply/Cancel and the scope radios passthrough
// - modal keyboard/focus lifecycle: focus restoration to the opener,
//   focus trap (Tab/Shift+Tab wrap), Escape, Enter-not-in-search
//
// Consumes:
// - material catalog/category accessors injected via init()
//   (getMaterialCategories) — never a second catalog authority
// - the role allowed-material resolver (optionMaterialIds), material
//   lookup (materialById), the shared swatch renderer
//   (updateMaterialSwatch, also used by the material-roles module
//   rendering) and the icon helper — all injected, never copied
//
// Does NOT own:
// - material catalog state (catalogMaterials/catalogMaterialCategories
//   are owned by window.GraneteUI.materialRoles since #848 C4.6)
// - material-role rendering (renderMaterialSelectors/renderSelectors is
//   owned by window.GraneteUI.materialRoles) nor role option assignments
// - Configurator/Inspector material choices or project defaults
// - the Ruby-native selector (window.sketchup.open_material_selector
//   remains the PRIMARY path; this modal is the local fallback)
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.finishSelector) return;

  var selectorModal = document.getElementById("material-selector-modal");
  var selectorTitle = document.getElementById("selector-modal-title");
  var selectorRoleBadge = document.getElementById("selector-modal-role-badge");
  var selectorCloseBtn = document.getElementById("btn-selector-modal-close");
  var selectorCancelBtn = document.getElementById("btn-selector-cancel");
  var selectorApplyBtn = document.getElementById("btn-selector-apply");
  var selectorSearchInput = document.getElementById("selector-search-input");
  var selectorSearchClear = document.getElementById("selector-search-clear");
  var selectorBreadcrumbs = document.getElementById("selector-breadcrumbs");
  var selectorMillerColumns = document.getElementById("selector-miller-columns");
  var selectorColLevel1 = document.getElementById("selector-col-level-1");
  var selectorColLevel2 = document.getElementById("selector-col-level-2");
  var selectorColLevel3 = document.getElementById("selector-col-level-3");
  var selectorColList1 = document.getElementById("selector-col-list-1");
  var selectorColList2 = document.getElementById("selector-col-list-2");
  var selectorColList3 = document.getElementById("selector-col-list-3");
  var selectorCandidateGrid = document.getElementById("selector-candidate-grid");
  var selectorCandidateCount = document.getElementById("selector-candidate-count");
  var selectorCandidateEmpty = document.getElementById("selector-candidate-empty");
  var selectorCandidateEmptyMsg = document.getElementById("selector-candidate-empty-msg");

  var selectorDetailSwatch = document.getElementById("selector-detail-swatch");
  var selectorDetailName = document.getElementById("selector-detail-name");
  var selectorDetailCode = document.getElementById("selector-detail-code");
  var selectorSpecManufacturer = document.getElementById("selector-spec-manufacturer");
  var selectorSpecThickness = document.getElementById("selector-spec-thickness");
  var selectorSpecGrain = document.getElementById("selector-spec-grain");
  var selectorSpecCategory = document.getElementById("selector-spec-category");
  var selectorSpecTexture = document.getElementById("selector-spec-texture");

  var selectorCtx = null;
  var selectorLastFocus = null;

  // Injected by the dialog bootstrap before any open(): the catalog
  // accessors and shared material helpers come from
  // window.GraneteUI.materialRoles (#848 C4.6).
  var deps = {};

  function requireDeps() {
    var missing = ["getMaterialCategories", "materialById", "optionMaterialIds",
      "updateMaterialSwatch", "icon"].filter(function (name) { return typeof deps[name] !== "function"; });
    if (missing.length > 0) {
      throw new Error("GraneteUI.finishSelector.init is required before use; missing deps: " + missing.join(", "));
    }
  }

  function findMaterialCategoryById(id) {
    if (!id) return null;
    var categories = deps.getMaterialCategories();
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i];
    }
    return null;
  }

  function getCategoryPathNodes(catId) {
    var path = [];
    var curr = findMaterialCategoryById(catId);
    var guard = 0;
    while (curr && guard < 10) {
      path.unshift(curr);
      curr = curr.parentId ? findMaterialCategoryById(curr.parentId) : null;
      guard++;
    }
    return path;
  }

  function isMaterialInSubtree(mat, rootCatId) {
    if (!rootCatId) return true;
    if (!mat || !mat.categoryId) return false;
    if (mat.categoryId === rootCatId) return true;
    var path = getCategoryPathNodes(mat.categoryId);
    for (var i = 0; i < path.length; i++) {
      if (path[i].id === rootCatId) return true;
    }
    return false;
  }

  function countMaterialsInSubtree(roleEntry, catId) {
    var allowed = deps.optionMaterialIds(roleEntry);
    var count = 0;
    for (var i = 0; i < allowed.length; i++) {
      var m = deps.materialById(allowed[i]);
      if (m && isMaterialInSubtree(m, catId)) {
        count++;
      }
    }
    return count;
  }

  function openMaterialSelector(roleEntry, initialSelectedId, onApply, contextKind) {
    requireDeps();
    selectorCtx = {
      roleEntry: roleEntry,
      selectedCandidateId: initialSelectedId || null,
      activeCatL1: null,
      activeCatL2: null,
      activeCatL3: null,
      searchQuery: "",
      allowedCount: deps.optionMaterialIds(roleEntry).length,
      onApply: onApply
    };

    // If the initially selected material has a category, auto-expand its hierarchy
    var initialMat = deps.materialById(initialSelectedId);
    if (initialMat && initialMat.categoryId) {
      var path = getCategoryPathNodes(initialMat.categoryId);
      if (path[0]) selectorCtx.activeCatL1 = path[0].id;
      if (path[1]) selectorCtx.activeCatL2 = path[1].id;
      if (path[2]) selectorCtx.activeCatL3 = path[2].id;
    }

    selectorRoleBadge.textContent = "Rol: " + (roleEntry.label || roleEntry.role);
    // Alcance honesto por contexto: en el configurador todavía no hay
    // mueble — la elección acompaña a la próxima inserción.
    var scopeFurnitureLabel = document.getElementById("selector-scope-furniture-label");
    if (scopeFurnitureLabel) {
      scopeFurnitureLabel.textContent = contextKind === "inspector"
        ? "Aplicar a este mueble"
        : "Aplicar a esta configuración";
    }
    selectorSearchInput.value = "";
    selectorSearchClear.style.display = "none";

    renderSelectorNavigation();
    renderSelectorGrid();
    updateSelectorDetail();

    selectorLastFocus = document.activeElement || null;
    selectorModal.style.display = "flex";
    selectorSearchInput.focus();
  }

  function closeMaterialSelector() {
    selectorModal.style.display = "none";
    selectorCtx = null;
    // El modal es un diálogo: el foco vuelve a quien lo abrió.
    if (selectorLastFocus && selectorLastFocus.focus) selectorLastFocus.focus();
    selectorLastFocus = null;
  }

  function renderSelectorNavigation() {
    if (!selectorCtx) return;
    renderBreadcrumbs();
    renderMillerColumns();
  }

  function renderBreadcrumbs() {
    selectorBreadcrumbs.innerHTML = "";
    var crumbs = [{ label: "Catálogo", l1: null, l2: null, l3: null }];

    if (selectorCtx.activeCatL1) {
      var l1 = findMaterialCategoryById(selectorCtx.activeCatL1);
      if (l1) crumbs.push({ label: l1.name, l1: l1.id, l2: null, l3: null });
    }
    if (selectorCtx.activeCatL2) {
      var l2 = findMaterialCategoryById(selectorCtx.activeCatL2);
      if (l2) crumbs.push({ label: l2.name, l1: selectorCtx.activeCatL1, l2: l2.id, l3: null });
    }
    if (selectorCtx.activeCatL3) {
      var l3 = findMaterialCategoryById(selectorCtx.activeCatL3);
      if (l3) crumbs.push({ label: l3.name, l1: selectorCtx.activeCatL1, l2: selectorCtx.activeCatL2, l3: l3.id });
    }

    crumbs.forEach(function (c, idx) {
      if (idx > 0) {
        var sep = document.createElement("span");
        sep.className = "selector-breadcrumb-separator";
        sep.textContent = "›";
        selectorBreadcrumbs.appendChild(sep);
      }
      var item = document.createElement("span");
      item.className = "selector-breadcrumb-item" + (idx === crumbs.length - 1 ? " active" : "");
      item.textContent = c.label;
      item.addEventListener("click", function () {
        selectorCtx.activeCatL1 = c.l1;
        selectorCtx.activeCatL2 = c.l2;
        selectorCtx.activeCatL3 = c.l3;
        renderSelectorNavigation();
        renderSelectorGrid();
      });
      selectorBreadcrumbs.appendChild(item);
    });
  }

  // Column items are built with DOM APIs (never innerHTML) so catalog
  // category names can't inject markup into the dev-fallback modal.
  function appendSelectorColumnItem(list, label, count, isActive, onClick) {
    var item = document.createElement("li");
    item.className = "selector-column-item" + (isActive ? " active" : "");
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");

    var labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    item.appendChild(labelSpan);

    var countSpan = document.createElement("span");
    countSpan.className = "selector-column-count";
    countSpan.textContent = String(count);
    item.appendChild(countSpan);

    item.addEventListener("click", onClick);
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    });
    list.appendChild(item);
  }

  function renderMillerColumns() {
    if (!selectorCtx) return;

    var categories = deps.getMaterialCategories();
    if (categories.length === 0) {
      selectorMillerColumns.style.display = "none";
      return;
    }
    selectorMillerColumns.style.display = "flex";

    // Column 1: Root categories (no parentId)
    var l1Cats = categories.filter(function (c) {
      return !c.parentId || c.parentId === "";
    }).sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

    selectorColList1.innerHTML = "";
    appendSelectorColumnItem(selectorColList1, "Todas",
      countMaterialsInSubtree(selectorCtx.roleEntry, null),
      selectorCtx.activeCatL1 === null,
      function () {
        selectorCtx.activeCatL1 = null;
        selectorCtx.activeCatL2 = null;
        selectorCtx.activeCatL3 = null;
        renderSelectorNavigation();
        renderSelectorGrid();
      });

    l1Cats.forEach(function (cat) {
      appendSelectorColumnItem(selectorColList1, cat.name,
        countMaterialsInSubtree(selectorCtx.roleEntry, cat.id),
        selectorCtx.activeCatL1 === cat.id,
        function () {
          selectorCtx.activeCatL1 = cat.id;
          selectorCtx.activeCatL2 = null;
          selectorCtx.activeCatL3 = null;
          renderSelectorNavigation();
          renderSelectorGrid();
        });
    });

    // Column 2: Subcategories of selected L1
    var l2Cats = selectorCtx.activeCatL1 ? categories.filter(function (c) {
      return c.parentId === selectorCtx.activeCatL1;
    }).sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }) : [];

    if (l2Cats.length > 0) {
      selectorColLevel2.style.display = "flex";
      selectorColList2.innerHTML = "";

      appendSelectorColumnItem(selectorColList2, "Todas",
        countMaterialsInSubtree(selectorCtx.roleEntry, selectorCtx.activeCatL1),
        selectorCtx.activeCatL2 === null,
        function () {
          selectorCtx.activeCatL2 = null;
          selectorCtx.activeCatL3 = null;
          renderSelectorNavigation();
          renderSelectorGrid();
        });

      l2Cats.forEach(function (cat) {
        appendSelectorColumnItem(selectorColList2, cat.name,
          countMaterialsInSubtree(selectorCtx.roleEntry, cat.id),
          selectorCtx.activeCatL2 === cat.id,
          function () {
            selectorCtx.activeCatL2 = cat.id;
            selectorCtx.activeCatL3 = null;
            renderSelectorNavigation();
            renderSelectorGrid();
          });
      });
    } else {
      selectorColLevel2.style.display = "none";
    }

    // Column 3: Subcategories of selected L2
    var l3Cats = selectorCtx.activeCatL2 ? categories.filter(function (c) {
      return c.parentId === selectorCtx.activeCatL2;
    }).sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); }) : [];

    if (l3Cats.length > 0) {
      selectorColLevel3.style.display = "flex";
      selectorColList3.innerHTML = "";

      appendSelectorColumnItem(selectorColList3, "Todas",
        countMaterialsInSubtree(selectorCtx.roleEntry, selectorCtx.activeCatL2),
        selectorCtx.activeCatL3 === null,
        function () {
          selectorCtx.activeCatL3 = null;
          renderSelectorNavigation();
          renderSelectorGrid();
        });

      l3Cats.forEach(function (cat) {
        appendSelectorColumnItem(selectorColList3, cat.name,
          countMaterialsInSubtree(selectorCtx.roleEntry, cat.id),
          selectorCtx.activeCatL3 === cat.id,
          function () {
            selectorCtx.activeCatL3 = cat.id;
            renderSelectorNavigation();
            renderSelectorGrid();
          });
      });
    } else {
      selectorColLevel3.style.display = "none";
    }
  }

  function getFilteredSelectorMaterials() {
    if (!selectorCtx) return [];
    var allowedIds = deps.optionMaterialIds(selectorCtx.roleEntry);
    var list = allowedIds.map(deps.materialById).filter(Boolean);

    // Apply category filter
    var targetCat = selectorCtx.activeCatL3 || selectorCtx.activeCatL2 || selectorCtx.activeCatL1;
    if (targetCat) {
      list = list.filter(function (m) {
        return isMaterialInSubtree(m, targetCat);
      });
    }

    // Apply search filter
    var q = (selectorCtx.searchQuery || "").trim().toLowerCase();
    if (q) {
      list = list.filter(function (m) {
        var nameMatch = (m.name || "").toLowerCase().indexOf(q) >= 0;
        var codeMatch = (m.code || "").toLowerCase().indexOf(q) >= 0;
        var mfgMatch = (m.manufacturer || "").toLowerCase().indexOf(q) >= 0;
        return nameMatch || codeMatch || mfgMatch;
      });
    }

    return list;
  }

  function renderSelectorGrid() {
    if (!selectorCtx) return;
    var materials = getFilteredSelectorMaterials();
    selectorCandidateCount.textContent = materials.length + " opción" + (materials.length === 1 ? "" : "es");

    if (materials.length === 0) {
      selectorCandidateGrid.style.display = "none";
      selectorCandidateEmpty.style.display = "block";
      selectorCandidateEmptyMsg.textContent = selectorCtx.allowedCount === 0
        ? "Este rol no tiene materiales asignados. Configurá el grupo de opciones en Granete."
        : (selectorCtx.searchQuery
            ? "No se encontraron materiales que coincidan con la búsqueda."
            : "No hay materiales en esta categoría.");
      return;
    }

    selectorCandidateGrid.style.display = "grid";
    selectorCandidateEmpty.style.display = "none";
    selectorCandidateGrid.innerHTML = "";

    materials.forEach(function (mat) {
      var card = document.createElement("div");
      var isSelected = mat.materialId === selectorCtx.selectedCandidateId;
      card.className = "mat-card" + (isSelected ? " selected" : "");

      var swatch = document.createElement("div");
      swatch.className = "mat-card-swatch";
      deps.updateMaterialSwatch(swatch, mat);

      if (mat.grain) {
        var grainBadge = document.createElement("span");
        grainBadge.className = "mat-card-badge-grain";
        grainBadge.innerHTML = deps.icon("grain", 11) + " Veta";
        swatch.appendChild(grainBadge);
      }
      card.appendChild(swatch);

      if (isSelected) {
        var check = document.createElement("div");
        check.className = "mat-card-selected-check";
        check.textContent = "✓";
        card.appendChild(check);
      }

      var info = document.createElement("div");
      info.className = "mat-card-info";

      var nameEl = document.createElement("div");
      nameEl.className = "mat-card-name";
      nameEl.textContent = mat.name || "Material";
      info.appendChild(nameEl);

      var metaEl = document.createElement("div");
      metaEl.className = "mat-card-meta";
      if (mat.code) {
        var codeTag = document.createElement("span");
        codeTag.className = "mat-card-tag";
        codeTag.textContent = mat.code;
        metaEl.appendChild(codeTag);
      }
      if (mat.thicknessMm) {
        var thkTag = document.createElement("span");
        thkTag.className = "mat-card-tag";
        thkTag.textContent = mat.thicknessMm + " mm";
        metaEl.appendChild(thkTag);
      }
      if (mat.manufacturer) {
        var mfgTag = document.createElement("span");
        mfgTag.className = "mat-card-tag";
        mfgTag.textContent = mat.manufacturer;
        metaEl.appendChild(mfgTag);
      }
      info.appendChild(metaEl);
      card.appendChild(info);

      card.addEventListener("click", function () {
        selectorCtx.selectedCandidateId = mat.materialId;
        renderSelectorGrid();
        updateSelectorDetail();
      });

      card.addEventListener("dblclick", function () {
        selectorCtx.selectedCandidateId = mat.materialId;
        applySelectorChoice();
      });

      selectorCandidateGrid.appendChild(card);
    });
  }

  function updateSelectorDetail() {
    if (!selectorCtx) return;
    var mat = selectorCtx.selectedCandidateId ? deps.materialById(selectorCtx.selectedCandidateId) : null;
    selectorApplyBtn.disabled = !mat;

    if (!mat) {
      deps.updateMaterialSwatch(selectorDetailSwatch, null);
      selectorDetailName.textContent = "Seleccioná un material";
      selectorDetailCode.textContent = "--";
      selectorSpecManufacturer.textContent = "--";
      selectorSpecThickness.textContent = "--";
      selectorSpecGrain.textContent = "--";
      selectorSpecCategory.textContent = "--";
      selectorSpecTexture.textContent = "--";
      return;
    }

    deps.updateMaterialSwatch(selectorDetailSwatch, mat);
    selectorDetailName.textContent = mat.name || "Material";
    selectorDetailCode.textContent = mat.code ? "Código: " + mat.code : "";
    selectorSpecManufacturer.textContent = mat.manufacturer || "Sin fabricante";
    selectorSpecThickness.textContent = mat.thicknessMm ? mat.thicknessMm + " mm" : "--";
    selectorSpecGrain.textContent = mat.grain ? "Sí (con veta)" : "No";

    var path = mat.categoryId ? getCategoryPathNodes(mat.categoryId) : [];
    selectorSpecCategory.textContent = path.length > 0
      ? path.map(function (n) { return n.name; }).join(" › ")
      : "Sin categoría";

    if (mat.previewTextureUrl) {
      selectorSpecTexture.textContent = "Textura 3D / PBR";
    } else if (mat.imageUrl) {
      selectorSpecTexture.textContent = "Imagen / Foto";
    } else if (mat.previewColor) {
      selectorSpecTexture.textContent = "Color sólido (" + mat.previewColor + ")";
    } else {
      selectorSpecTexture.textContent = "Color estándar";
    }
  }

  function applySelectorChoice() {
    if (!selectorCtx || !selectorCtx.selectedCandidateId) return;
    var chosenId = selectorCtx.selectedCandidateId;
    var scopeRadio = document.querySelector('input[name="selector-scope"]:checked');
    var scope = (scopeRadio && scopeRadio.value) || "furniture";
    var cb = selectorCtx.onApply;
    closeMaterialSelector();
    if (cb) cb(chosenId, scope);
  }

  // Wire Selector Modal controls
  selectorCloseBtn.addEventListener("click", closeMaterialSelector);
  selectorCancelBtn.addEventListener("click", closeMaterialSelector);
  selectorApplyBtn.addEventListener("click", applySelectorChoice);

  selectorSearchInput.addEventListener("input", function () {
    if (!selectorCtx) return;
    selectorCtx.searchQuery = selectorSearchInput.value;
    selectorSearchClear.style.display = selectorCtx.searchQuery ? "block" : "none";
    renderSelectorGrid();
  });

  selectorSearchClear.addEventListener("click", function () {
    if (!selectorCtx) return;
    selectorSearchInput.value = "";
    selectorCtx.searchQuery = "";
    selectorSearchClear.style.display = "none";
    renderSelectorGrid();
    selectorSearchInput.focus();
  });

  // Global Esc / Enter / Tab inside modal
  document.addEventListener("keydown", function (e) {
    if (selectorModal.style.display !== "none") {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMaterialSelector();
      } else if (e.key === "Enter" && !selectorApplyBtn.disabled && document.activeElement !== selectorSearchInput) {
        e.preventDefault();
        applySelectorChoice();
      } else if (e.key === "Tab") {
        // Focus trap: con el backdrop abierto, Tab se queda dentro del
        // diálogo (primero/último controlable con wrap) — nunca escapa
        // al panel de atrás.
        var focusables = selectorModal.querySelectorAll(
          'button, input, select, [tabindex="0"]');
        if (focusables.length === 0) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = document.activeElement;
        if (e.shiftKey && (active === first || active === selectorModal)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });

  window.GraneteUI.finishSelector = {
    init: function (injected) {
      deps = injected || {};
    },
    open: openMaterialSelector,
    close: closeMaterialSelector
  };
})();
