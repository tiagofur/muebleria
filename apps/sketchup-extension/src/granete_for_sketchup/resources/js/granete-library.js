// #848 Phase B — library browser module.
// Owns:
// - furniture definition browsing: search, category cascade (L1/L2/L3,
//   subtree-inclusive filtering, "Sin categoría" bucket, legacy flat mode)
// - library visual states: loading skeletons, empty (local / unauthenticated /
//   connection error / license blocked), no-results, card grid
// - furniture cards (media-backed preview + isometric fallback, badges, dims)
// - the catalog browsing authority: definitions, categories, source,
//   licenseBlocked — single owner; dialog.html holds no second copy
//
// Consumes:
// - window.GraneteUI.media (filenameFromPath/resolveUrl/requestRefresh) —
//   cards never mint or store image URLs here
// - window.GraneteUI.account.open() for the unauthenticated/error CTAs
// - window.sketchup.get_catalog() for the explicit retry action
// - injected bootstrap dependencies via init(): icon and
//   createFurniturePlaceholderSvg (shared presentation helpers),
//   onSelectDefinition (GraneteUI.configurator.open — Library ends at
//   the choice), getSelectedDefinitionId (highlights the definition
//   being configured)
//
// Does NOT own:
// - furniture configuration: params, presets, material roles, insert
//   (js/granete-configurator.js, #848 C4.4)
// - presets / materials / hardware catalogs (future slices)
// - the browser↔configurator view transition (configurator module owns
//   both directions since #848 C4.4)
// - Inspector, Project Furniture
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.library) return;

  var catalog = [];
  var catalogCategories = [];
  var catalogSource = "loading";
  var licenseBlocked = false;

  var searchQuery = "";
  var selectedCategory = "ALL";

  // Injected by the dialog bootstrap before the first render: shared
  // presentation helpers stay single-implementation in dialog.html.
  var icon = null;
  var createFurniturePlaceholderSvg = null;
  var onSelectDefinition = null;
  var getSelectedDefinitionId = null;

  // Library Browser elements
  var libCountBadge = document.getElementById("library-count-badge");
  var libSearchInput = document.getElementById("library-search-input");
  var libSearchClear = document.getElementById("library-search-clear");
  var libCategoriesContainer = document.getElementById("library-categories-container");
  var libCategoryL1 = document.getElementById("library-category-l1");
  var libCategoryL2 = document.getElementById("library-category-l2");
  var libCategoryL3 = document.getElementById("library-category-l3");
  var libCardsGrid = document.getElementById("library-cards-grid");
  var libLicenseBlocker = document.getElementById("library-license-blocker");
  var libSourceNote = document.getElementById("library-source-note");

  // Library States
  var libLoadingState = document.getElementById("library-loading-state");
  var libEmptyState = document.getElementById("library-empty-state");
  var libEmptyIcon = document.getElementById("library-empty-icon");
  var libEmptyTitle = document.getElementById("library-empty-title");
  var libEmptyMsg = document.getElementById("library-empty-msg");
  var btnEmptyAction = document.getElementById("btn-library-empty-action");
  var btnLibraryRetry = document.getElementById("btn-library-retry");
  var libNoResultsState = document.getElementById("library-no-results-state");
  var libNoResultsMsg = document.getElementById("library-no-results-msg");
  var btnClearSearch = document.getElementById("btn-clear-search");

  // Category UI mapping dictionary
  var CATEGORY_LABELS = {
    "kitchen_base": "Bases",
    "kitchen_wall": "Alacenas",
    "closet": "Torres / Closets",
    "desk": "Escritorios",
    "base": "Bases",
    "wall": "Alacenas",
    "tall": "Torres / Despensas",
    "drawer": "Cajoneros",
    "drawers": "Cajoneros",
    "cajonero": "Cajoneros",
    "cajoneros": "Cajoneros",
    "inferior": "Bases",
    "superior": "Alacenas"
  };

  function formatCategoryLabel(catKey) {
    if (!catKey) return "General";
    if (CATEGORY_LABELS[catKey]) return CATEGORY_LABELS[catKey];
    return String(catKey)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function getDefinitionDefaultDims(def) {
    var params = def.parameters || [];
    var width = 600;
    var height = 720;
    var depth = 590;

    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      if (p.name === "widthMm" || p.name === "lengthMm" || p.name === "width" || p.name === "length") {
        width = p.defaultValue !== undefined ? p.defaultValue : width;
      } else if (p.name === "heightMm" || p.name === "height") {
        height = p.defaultValue !== undefined ? p.defaultValue : height;
      } else if (p.name === "depthMm" || p.name === "depth") {
        depth = p.defaultValue !== undefined ? p.defaultValue : depth;
      }
    }

    return width + " × " + height + " × " + depth + " mm";
  }

  function catalogSourceNote(source, blocked, count) {
    if (blocked) return "Tu licencia no está activa; la biblioteca del taller quedó bloqueada.";
    if (source === "remote") {
      return count > 0
        ? "Biblioteca del taller (servidor Granete) — " + count + " mueble" + (count === 1 ? "" : "s")
        : "El taller todavía no tiene muebles. Creá muebles en Granete y volvé a abrir la biblioteca.";
    }
    if (source === "unauthenticated") {
      return "Iniciá sesión con tu cuenta del taller (pill superior derecha) para cargar la biblioteca.";
    }
    if (source === "error") {
      return "No se pudo conectar con Granete. Revisá el servidor desde tu cuenta (pill superior derecha) e iniciá sesión de nuevo.";
    }
    return "Catálogo local (modo desarrollo)";
  }

  function renderLibraryState(stateType, options) {
    options = options || {};
    libLoadingState.style.display = stateType === "loading" ? "block" : "none";
    libEmptyState.style.display = stateType === "empty" ? "block" : "none";
    libNoResultsState.style.display = stateType === "no-results" ? "block" : "none";
    libCardsGrid.style.display = stateType === "grid" ? "grid" : "none";
    // Una sola voz de carga: con los skeletons visibles, el badge de
    // conteo y los selects de categoría vacíos no compiten por atención.
    libCountBadge.style.display = stateType === "loading" ? "none" : "";
    if (stateType === "loading") libCategoriesContainer.style.display = "none";

    // Recoverability: only the remote-error empty state offers an
    // explicit retry of the read-only catalog fetch.
    btnLibraryRetry.style.display = stateType === "empty" &&
      (options.source || "local") === "error" && !options.blocked
      ? "inline-flex"
      : "none";

    if (stateType === "empty") {
      var source = options.source || "local";
      var blocked = !!options.blocked;

      if (blocked) {
        libEmptyIcon.innerHTML = icon("lock", 28);
        libEmptyTitle.textContent = "Licencia inactiva";
        libEmptyMsg.textContent = "Tu cuenta no tiene una licencia activa, por lo que la biblioteca del taller no está disponible.";
        btnEmptyAction.style.display = "none";
      } else if (source === "unauthenticated") {
        libEmptyIcon.innerHTML = icon("key", 28);
        libEmptyTitle.textContent = "Sesión requerida";
        libEmptyMsg.textContent = "Iniciá sesión con tu cuenta del taller (pill superior derecha) para cargar la biblioteca de muebles.";
        btnEmptyAction.textContent = "Ir a Iniciar Sesión";
        btnEmptyAction.style.display = "inline-flex";
        btnEmptyAction.onclick = function () { window.GraneteUI.account.open(); };
      } else if (source === "error") {
        libEmptyIcon.innerHTML = icon("warning", 28);
        libEmptyTitle.textContent = "Error de conexión";
        libEmptyMsg.textContent = "No se pudo conectar con el servidor Granete. Verificá tu conexión y estado del servidor.";
        btnEmptyAction.textContent = "Revisar conexión";
        btnEmptyAction.style.display = "inline-flex";
        btnEmptyAction.onclick = function () { window.GraneteUI.account.open(); };
      } else {
        libEmptyIcon.innerHTML = icon("box", 28);
        libEmptyTitle.textContent = "El taller todavía no tiene muebles";
        libEmptyMsg.textContent = "Creá muebles en la plataforma Granete para verlos e insertarlos directamente en SketchUp.";
        btnEmptyAction.style.display = "none";
      }
    } else if (stateType === "no-results") {
      var q = options.query;
      if (q) {
        libNoResultsMsg.textContent = 'No se encontraron muebles que coincidan con "' + q + '".';
      } else {
        libNoResultsMsg.textContent = "No hay muebles en la categoría seleccionada.";
      }
    }
  }

  // -------------------------------------------------------------
  // Category cascade (web app library logic): the catalog carries the
  // workshop category tree (up to 3 levels, e.g. Cocinas › Inferiores ›
  // Puertas); filtering by a node includes its whole subtree, and
  // "Sin categoría" buckets modules without a category.
  // -------------------------------------------------------------
  var categoryNodeById = {};
  var categoryChildren = {};

  function buildCategoryIndex() {
    categoryNodeById = {};
    categoryChildren = {};
    catalogCategories.forEach(function (c) {
      categoryNodeById[c.categoryId] = c;
      var parent = c.parentId || "";
      (categoryChildren[parent] = categoryChildren[parent] || []).push(c);
    });
    Object.keys(categoryChildren).forEach(function (key) {
      categoryChildren[key].sort(function (a, b) {
        var byOrder = (a.sortOrder || 0) - (b.sortOrder || 0);
        if (byOrder !== 0) return byOrder;
        return String(a.name).localeCompare(String(b.name), "es");
      });
    });
  }

  function subtreeCategoryIds(rootId) {
    var ids = {};
    var stack = [rootId];
    while (stack.length > 0) {
      var id = stack.pop();
      if (ids[id]) continue;
      ids[id] = true;
      (categoryChildren[id] || []).forEach(function (child) {
        stack.push(child.categoryId);
      });
    }
    return ids;
  }

  function countModulesInSubtree(rootId) {
    var ids = subtreeCategoryIds(rootId);
    return catalog.filter(function (d) { return d.categoryId && ids[d.categoryId]; }).length;
  }

  function categoryPathIdsOf(catId) {
    if (!catId || catId === "ALL" || catId === "UNCAT" || !categoryNodeById[catId]) return [];
    var ids = [];
    var current = catId;
    while (current && categoryNodeById[current]) {
      ids.unshift(current);
      current = categoryNodeById[current].parentId;
    }
    return ids;
  }

  function appendCategoryOption(select, value, label) {
    var opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }

  function fillCascadeLevel(select, parentId, selectedId, allLabel, allValue, onSelect) {
    var children = categoryChildren[parentId] || [];
    if (children.length === 0) {
      select.style.display = "none";
      select.innerHTML = "";
      select.onchange = null;
      return;
    }
    select.style.display = "block";
    select.innerHTML = "";
    appendCategoryOption(select, allValue, allLabel);
    children.forEach(function (c) {
      appendCategoryOption(select, c.categoryId, c.name + " (" + countModulesInSubtree(c.categoryId) + ")");
    });
    select.value = selectedId && categoryNodeById[selectedId] ? selectedId : allValue;
    select.onchange = function () {
      onSelect(select.value);
    };
  }

  function renderCategoryFilters(categories, activeCategory, onSelectCategory) {
    buildCategoryIndex();

    if (catalogCategories.length === 0) {
      // Legacy payload without a category tree (e.g. offline catalog):
      // flat options from the definitions' category strings.
      var distinct = {};
      catalog.forEach(function (def) {
        var cat = def.category || "general";
        distinct[cat] = true;
      });
      var keys = Object.keys(distinct).sort();
      if (keys.length <= 1) {
        libCategoriesContainer.style.display = "none";
        return;
      }
      libCategoriesContainer.style.display = "flex";
      libCategoryL2.style.display = "none";
      libCategoryL3.style.display = "none";
      libCategoryL1.innerHTML = "";
      appendCategoryOption(libCategoryL1, "ALL", "Todas las categorías");
      keys.forEach(function (key) {
        appendCategoryOption(libCategoryL1, key, formatCategoryLabel(key));
      });
      libCategoryL1.value = activeCategory && distinct[activeCategory] ? activeCategory : "ALL";
      libCategoryL1.onchange = function () {
        onSelectCategory(libCategoryL1.value);
      };
      return;
    }

    var roots = categoryChildren[""] || [];
    var hasUncategorized = catalog.some(function (d) { return !d.categoryId; });
    if (roots.length === 0 && !hasUncategorized) {
      libCategoriesContainer.style.display = "none";
      return;
    }

    libCategoriesContainer.style.display = "flex";
    var pathIds = categoryPathIdsOf(activeCategory);
    var l1Choice = pathIds[0] || null;

    libCategoryL1.innerHTML = "";
    appendCategoryOption(libCategoryL1, "ALL", "Todas las categorías");
    if (hasUncategorized) appendCategoryOption(libCategoryL1, "UNCAT", "Sin categoría");
    roots.forEach(function (c) {
      appendCategoryOption(libCategoryL1, c.categoryId, c.name + " (" + countModulesInSubtree(c.categoryId) + ")");
    });
    libCategoryL1.value = activeCategory === "UNCAT" ? "UNCAT" : (l1Choice || "ALL");
    libCategoryL1.onchange = function () {
      onSelectCategory(libCategoryL1.value);
    };

    var l2Choice = pathIds[1] || null;
    fillCascadeLevel(libCategoryL2, l1Choice || "", l2Choice, "Todas", l1Choice || "ALL", onSelectCategory);

    var l3Choice = pathIds[2] || null;
    fillCascadeLevel(libCategoryL3, l2Choice || "", l3Choice, "Todas", l2Choice || l1Choice || "ALL", onSelectCategory);
  }

  function renderFurnitureCards(definitions, container, selectDefinition) {
    container.innerHTML = "";
    if (!definitions || definitions.length === 0) return;

    definitions.forEach(function (def) {
      var selectedId = getSelectedDefinitionId ? getSelectedDefinitionId() : null;
      var card = document.createElement("div");
      card.className = "furniture-card" + (selectedId && selectedId === def.furniture_definition_id ? " selected" : "");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", "Seleccionar " + def.name);
      card.setAttribute("data-definition-id", def.furniture_definition_id);

      // Preview Area
      var preview = document.createElement("div");
      preview.className = "furniture-card-preview";

      var rawImageUrl = def.imageUrl || def.thumbnailUrl || def.previewUrl;
      var mediaName = window.GraneteUI.media.filenameFromPath(rawImageUrl);
      var imageUrl = window.GraneteUI.media.resolveUrl(rawImageUrl);
      if (mediaName) {
        // Server catalog media: the <img> always exists (tagged with its
        // canonical filename) so a re-minted grant can repaint it; while
        // the signed URL is pending the placeholder covers it.
        var img = document.createElement("img");
        img.alt = def.name;
        img.className = "furniture-card-img";
        img.loading = "lazy";
        img.setAttribute("data-media-name", mediaName);
        if (imageUrl) {
          img.src = imageUrl;
        } else {
          img.style.display = "none";
        }
        img.onerror = function () {
          img.style.display = "none";
          if (img.nextElementSibling) img.nextElementSibling.style.display = "flex";
          // #460 SEC-3: most likely an expired grant — re-mint and retry.
          window.GraneteUI.media.requestRefresh(mediaName);
        };
        preview.appendChild(img);

        var fallbackPlaceholder = document.createElement("div");
        fallbackPlaceholder.className = "furniture-card-placeholder";
        fallbackPlaceholder.style.display = imageUrl ? "none" : "flex";
        fallbackPlaceholder.innerHTML = createFurniturePlaceholderSvg();
        preview.appendChild(fallbackPlaceholder);
      } else if (imageUrl) {
        var img = document.createElement("img");
        img.src = imageUrl;
        img.alt = def.name;
        img.className = "furniture-card-img";
        img.loading = "lazy";
        img.onerror = function () {
          img.style.display = "none";
          if (img.nextElementSibling) img.nextElementSibling.style.display = "flex";
        };
        preview.appendChild(img);

        var fallbackPlaceholder = document.createElement("div");
        fallbackPlaceholder.className = "furniture-card-placeholder";
        fallbackPlaceholder.style.display = "none";
        fallbackPlaceholder.innerHTML = createFurniturePlaceholderSvg();
        preview.appendChild(fallbackPlaceholder);
      } else {
        var placeholder = document.createElement("div");
        placeholder.className = "furniture-card-placeholder";
        placeholder.innerHTML = createFurniturePlaceholderSvg();
        preview.appendChild(placeholder);
      }

      if (def.categoryId || def.category) {
        var catBadge = document.createElement("span");
        catBadge.className = "furniture-card-badge";
        // El árbol del taller es la fuente; CATEGORY_LABELS sólo
        // cubre catálogos legacy sin categorías.
        catBadge.textContent =
          (def.categoryId && categoryNodeById[def.categoryId] && categoryNodeById[def.categoryId].name) ||
          formatCategoryLabel(def.category);
        preview.appendChild(catBadge);
      }

      card.appendChild(preview);

      // Card Body
      var body = document.createElement("div");
      body.className = "furniture-card-body";

      var title = document.createElement("h3");
      title.className = "furniture-card-title";
      title.textContent = def.name;
      body.appendChild(title);

      var dims = document.createElement("span");
      dims.className = "furniture-card-dims";
      dims.textContent = getDefinitionDefaultDims(def);
      body.appendChild(dims);

      if (def.code) {
        var code = document.createElement("span");
        code.className = "furniture-card-code";
        code.textContent = def.code;
        body.appendChild(code);
      }

      card.appendChild(body);

      // Interaction events
      card.addEventListener("click", function () {
        selectDefinition(def);
      });

      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.keyCode === 13 || e.keyCode === 32) {
          e.preventDefault();
          selectDefinition(def);
        }
      });

      container.appendChild(card);
    });
  }

  function renderLibraryBrowser() {
    if (catalogSource === "loading" && catalog.length === 0) {
      libCountBadge.textContent = "Cargando…";
      renderLibraryState("loading");
      return;
    }

    if (catalog.length === 0) {
      libCountBadge.textContent = "0 muebles";
      libCategoriesContainer.style.display = "none";
      renderLibraryState("empty", { source: catalogSource, blocked: licenseBlocked });
      return;
    }

    renderCategoryFilters(null, selectedCategory, function (newCat) {
      selectedCategory = newCat;
      renderLibraryBrowser();
    });

    // Filter definitions: subtree-inclusive when the catalog carries a
    // category tree; exact string match for legacy flat catalogs.
    var filterIds = null;
    if (selectedCategory === "UNCAT") {
      filterIds = "UNCAT";
    } else if (selectedCategory && selectedCategory !== "ALL" && categoryNodeById[selectedCategory]) {
      filterIds = subtreeCategoryIds(selectedCategory);
    }

    var query = searchQuery.trim().toLowerCase();
    var filtered = catalog.filter(function (def) {
      if (filterIds === "UNCAT") {
        if (def.categoryId) return false;
      } else if (filterIds) {
        if (!def.categoryId || !filterIds[def.categoryId]) return false;
      } else if (selectedCategory !== "ALL" && catalogCategories.length === 0) {
        if ((def.category || "general") !== selectedCategory) return false;
      }
      if (!query) return true;

      var nameMatch = (def.name || "").toLowerCase().indexOf(query) !== -1;
      var codeMatch = (def.code || "").toLowerCase().indexOf(query) !== -1;
      var catMatch = (def.category || "").toLowerCase().indexOf(query) !== -1;
      var descMatch = (def.description || "").toLowerCase().indexOf(query) !== -1;

      return nameMatch || codeMatch || catMatch || descMatch;
    });

    libCountBadge.textContent = filtered.length + (filtered.length === 1 ? " mueble" : " muebles");

    if (filtered.length === 0) {
      renderLibraryState("no-results", { query: searchQuery, category: selectedCategory });
    } else {
      renderLibraryState("grid");
      renderFurnitureCards(filtered, libCardsGrid, function (def) {
        onSelectDefinition(def);
      });
    }
  }

  // Search event bindings
  libSearchInput.addEventListener("input", function () {
    searchQuery = libSearchInput.value;
    libSearchClear.style.display = searchQuery ? "block" : "none";
    renderLibraryBrowser();
  });

  libSearchClear.addEventListener("click", function () {
    searchQuery = "";
    libSearchInput.value = "";
    libSearchClear.style.display = "none";
    libSearchInput.focus();
    renderLibraryBrowser();
  });

  btnClearSearch.addEventListener("click", function () {
    searchQuery = "";
    selectedCategory = "ALL";
    libSearchInput.value = "";
    libSearchClear.style.display = "none";
    renderLibraryBrowser();
  });

  // Re-asks Ruby for the catalog; setCatalog pushes the next truthful
  // state (error again if the server is still down), so the panel never
  // fakes a client-side loading flip here.
  btnLibraryRetry.addEventListener("click", function () {
    if (window.sketchup && window.sketchup.get_catalog) {
      window.sketchup.get_catalog();
    }
  });

  window.GraneteUI.library = {
    // The dialog bootstrap injects the shared presentation helpers and the
    // configurator hand-off before the first render (Ruby answers
    // dialog_ready with setCatalog right after the bootstrap finishes).
    init: function (deps) {
      deps = deps || {};
      if (deps.icon) icon = deps.icon;
      if (deps.createFurniturePlaceholderSvg) createFurniturePlaceholderSvg = deps.createFurniturePlaceholderSvg;
      if (deps.onSelectDefinition) onSelectDefinition = deps.onSelectDefinition;
      if (deps.getSelectedDefinitionId) getSelectedDefinitionId = deps.getSelectedDefinitionId;
    },

    // Ruby-facing payload (array = legacy local catalog, object = workshop
    // catalog). Owns the browsing slice only — presets/materials/hardware/
    // media stay with the bootstrap orchestrator. Updates state, license
    // blocker and source note; the caller drives the view transition and
    // calls render() exactly as before.
    setCatalog: function (payload) {
      if (Object.prototype.toString.call(payload) === "[object Array]") {
        catalog = payload || [];
        catalogCategories = [];
        catalogSource = "local";
        licenseBlocked = false;
      } else {
        payload = payload || {};
        catalog = payload.definitions || [];
        catalogCategories = payload.categories || [];
        catalogSource = payload.source || "local";
        licenseBlocked = !!payload.licenseBlocked;
      }

      libLicenseBlocker.style.display = licenseBlocked ? "block" : "none";
      libSourceNote.textContent = catalogSourceNote(catalogSource, licenseBlocked, catalog.length);
    },

    render: renderLibraryBrowser,

    getDefinitions: function () {
      return catalog;
    },

    getCategories: function () {
      return catalogCategories;
    },

    findDefinitionById: function (id) {
      return catalog.find(function (d) { return d.furniture_definition_id === id; });
    },

    // Categories are Library's domain; the configurator module badge
    // consumes this instead of carrying a second label table.
    formatCategoryLabel: formatCategoryLabel
  };
})();
