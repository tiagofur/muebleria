// #1137 / OPEN-FRONT — Design opening card module under window.GraneteUI.
// Owns:
// - the «Apertura» card state + rendering inside the Design Inspector lane:
//   the durable opening selection (intent) as a LOCAL draft (sistema /
//   perfil / posición), the READ-ONLY server resolution (fronts W × H,
//   blocked states) and the honest absence states (sin capacidades
//   configuradas, sin medidas explícitas).
// - the ONE write: Aplicar issues exactly ONE PUT through the Ruby bridge
//   carrying the draft + the workingVersion token the card last saw. An
//   INVALID_OPENING_CONFIGURATION refusal keeps the previously persisted
//   selection visible AND the editable draft, and surfaces the server's
//   actionable message — never a silent revert. No derived-output
//   computation happens here: every number arrives from the server.
//
// Does NOT own:
// - the binding truth or the lane (js/granete-design-inspector.js drives
//   refresh()/hide()); the catalog data (server-authoritative: capabilities
//   + profiles arrive in the bridge answer); any dimension, reduction or
//   derived-output computation — every number is the server's read-only output.
//
// Consumes:
// - window.sketchup.get_design_opening({requestId, designId}) — answered by
//   GraneteDialog.onDesignOpening({requestId, status, opening, resolution,
//   dimsKnown, capabilities, profiles}) with requestId correlation.
// - window.sketchup.apply_design_opening({requestId, designId, selection,
//   expectedWorkingVersion}) — answered by
//   GraneteDialog.onDesignOpeningApplied({requestId, status: ok|invalid|
//   conflict|error, state?, reason?, message?}).
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.opening) return;

  var REQUEST_IDLE = 0;
  var state = {
    designId: null,
    workingVersion: null,
    requestId: REQUEST_IDLE,
    status: "idle", // idle | loading | ready | error
    persisted: null, // { opening, resolution, dimsKnown } — authoritative
    capabilities: null, // server-authoritative; null = sin decisión de fábrica
    profiles: [], // the org's opening profile catalog
    draft: null, // { system, profileId, placements[] } — local, unsaved
    draftError: null, // { reason, message } — the last refused apply
    saving: false,
    laneActive: false
  };

  var deps = { sketchup: null };
  var elements = {};
  var initialized = false;

  var SYSTEM_LABELS = [
    { id: "handle", label: "Jaladera" },
    { id: "gola", label: "Gola (perfil integrado)" },
    { id: "bottom_overhang", label: "Rebase inferior" }
  ];

  var PLACEMENT_LABELS = [
    { id: "top", label: "Superior" },
    { id: "between", label: "Entre frentes" },
    { id: "bottom", label: "Inferior" }
  ];

  // The library default offering when the factory has no overlay decision
  // (mirrors the domain's availableOpeningSystems nil branch).
  var DEFAULT_SYSTEMS = ["handle", "gola", "bottom_overhang"];

  function el(id) {
    if (!elements[id]) {
      elements[id] = document.getElementById(id);
    }
    return elements[id];
  }

  function availableSystems() {
    var grips = state.capabilities && state.capabilities.grips;
    if (!grips) {
      return DEFAULT_SYSTEMS.slice(0);
    }
    var offered = [];
    for (var i = 0; i < SYSTEM_LABELS.length; i++) {
      var system = SYSTEM_LABELS[i].id;
      if (grips[system] && grips[system].enabled) {
        offered.push(system);
      }
    }
    return offered;
  }

  // Selectable profiles: verified datasheet only (an incompatible option
  // never appears as a normal choice), restricted to the factory's curated
  // gola list when one exists.
  function selectableProfiles() {
    var grips = state.capabilities && state.capabilities.grips;
    var curated = grips && grips.gola && grips.gola.profiles;
    var selectable = [];
    for (var i = 0; i < state.profiles.length; i++) {
      var profile = state.profiles[i];
      if (!profile || profile.datasheet_status !== "verified") {
        continue;
      }
      if (curated && curated.length > 0 && curated.indexOf(profile.id) === -1) {
        continue;
      }
      selectable.push(profile);
    }
    return selectable;
  }

  function profileById(profileId) {
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i] && state.profiles[i].id === profileId) {
        return state.profiles[i];
      }
    }
    return null;
  }

  function placementsFor(profileId) {
    if (!profileId) {
      return [];
    }
    var profile = profileById(profileId);
    if (!profile || !profile.compatible_placements || profile.compatible_placements.length === 0) {
      return PLACEMENT_LABELS.map(function (p) { return p.id; });
    }
    return profile.compatible_placements.slice(0);
  }

  function labelFor(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        return list[i].label;
      }
    }
    return id;
  }

  function clearChildren(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function makeOption(value, label, selected) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (selected) {
      option.selected = true;
    }
    return option;
  }

  function normalizeGeometryOutcome(geometry) {
    if (!geometry || typeof geometry !== "object") return null;
    var status = geometry.status;
    if (status !== "converged" && status !== "failed") return null;
    return { status: status, units: geometry.units || 0, reason: geometry.reason || "" };
  }

  function renderGeometryOutcome(body) {
    var outcome = state.geometryOutcome;
    if (!outcome) return;
    var row = document.createElement("p");
    row.className = "subhead";
    row.style.cssText = "font-size: var(--text-xs); margin: var(--space-1) 0 0;";
    row.setAttribute("data-testid", "opening-geometry-outcome");
    if (outcome.status === "converged") {
      var unitCount = outcome.units > 0 ? " (" + outcome.units + ")" : "";
      row.textContent = "Geometría actualizada" + unitCount + ".";
    } else {
      row.textContent = "La geometría no se pudo actualizar (" + (outcome.reason || "sin razón") +
        "); convergerá en la próxima edición o sincronización.";
    }
    body.appendChild(row);
  }

  function renderReadOnlyResolution(body) {
    var resolution = state.persisted && state.persisted.resolution;
    if (!state.persisted || !state.persisted.dimsKnown) {
      var noDims = document.createElement("p");
      noDims.className = "subhead";
      noDims.style.cssText = "font-size: var(--text-xs); margin: var(--space-1) 0 0;";
      noDims.textContent = "El mueble todavía no tiene medidas explícitas: la apertura se resolverá cuando las tenga.";
      body.appendChild(noDims);
      return;
    }
    if (!resolution) {
      return;
    }
    if (resolution.state === "resolved" && resolution.fronts && resolution.fronts.length > 0) {
      for (var i = 0; i < resolution.fronts.length; i++) {
        var front = resolution.fronts[i];
        var row = document.createElement("p");
        row.className = "subhead";
        row.style.cssText = "font-size: var(--text-xs); margin: var(--space-1) 0 0;";
        row.setAttribute("data-testid", "opening-front-" + (i + 1));
        row.textContent = "Frente " + (i + 1) + ": " + front.widthMm + " × " + front.heightMm + " mm (read-only)";
        body.appendChild(row);
      }
      return;
    }
    if (resolution.state === "blocked") {
      var blocked = document.createElement("p");
      blocked.className = "subhead";
      blocked.style.cssText = "font-size: var(--text-xs); margin: var(--space-1) 0 0;";
      blocked.setAttribute("data-testid", "opening-blocked");
      blocked.textContent = "Apertura bloqueada a la espera de evidencia (" + (resolution.reason || "sin razón declarada") + ").";
      body.appendChild(blocked);
    }
  }

  function render() {
    if (!initialized || !state.laneActive) return;
    var card = el("design-inspector-opening-card");
    var body = el("design-inspector-opening-body");
    if (!card || !body) return;

    card.style.display = state.status === "ready" ? "block" : "none";
    if (state.status !== "ready") return;
    clearChildren(body);

    var offered = availableSystems();

    var systemField = document.createElement("div");
    systemField.className = "catalog-form__field";
    var systemLabel = document.createElement("label");
    systemLabel.textContent = "Sistema de apertura";
    systemLabel.setAttribute("for", "opening-system-select");
    var systemSelect = document.createElement("select");
    systemSelect.id = "opening-system-select";
    systemSelect.setAttribute("data-testid", "opening-system-select");
    systemSelect.disabled = state.saving;
    systemSelect.appendChild(makeOption("", "—", !draftSystem()));
    for (var s = 0; s < offered.length; s++) {
      systemSelect.appendChild(makeOption(offered[s], labelFor(SYSTEM_LABELS, offered[s]), draftSystem() === offered[s]));
    }
    systemSelect.onchange = function () {
      setDraftSystem(systemSelect.value);
    };
    systemField.appendChild(systemLabel);
    systemField.appendChild(systemSelect);
    body.appendChild(systemField);

    if (draftSystem() === "gola") {
      var profiles = selectableProfiles();
      var profileField = document.createElement("div");
      profileField.className = "catalog-form__field";
      var profileLabel = document.createElement("label");
      profileLabel.textContent = "Perfil";
      profileLabel.setAttribute("for", "opening-profile-select");
      var profileSelect = document.createElement("select");
      profileSelect.id = "opening-profile-select";
      profileSelect.setAttribute("data-testid", "opening-profile-select");
      profileSelect.disabled = state.saving;
      profileSelect.appendChild(makeOption("", profiles.length ? "—" : "sin perfiles verificados", !draftProfileId()));
      for (var p = 0; p < profiles.length; p++) {
        profileSelect.appendChild(makeOption(profiles[p].id, profiles[p].name || profiles[p].id, draftProfileId() === profiles[p].id));
      }
      profileSelect.onchange = function () {
        setDraftProfile(profileSelect.value);
      };
      profileField.appendChild(profileLabel);
      profileField.appendChild(profileSelect);
      body.appendChild(profileField);

      var placements = placementsFor(draftProfileId());
      if (placements.length > 0) {
        var placementField = document.createElement("div");
        placementField.className = "catalog-form__field";
        var placementLabel = document.createElement("label");
        placementLabel.textContent = "Posición";
        placementLabel.setAttribute("for", "opening-placement-select");
        var placementSelect = document.createElement("select");
        placementSelect.id = "opening-placement-select";
        placementSelect.setAttribute("data-testid", "opening-placement-select");
        placementSelect.disabled = state.saving;
        placementSelect.appendChild(makeOption("", "—", !draftPlacement()));
        for (var q = 0; q < placements.length; q++) {
          placementSelect.appendChild(makeOption(placements[q], labelFor(PLACEMENT_LABELS, placements[q]), draftPlacement() === placements[q]));
        }
        placementSelect.onchange = function () {
          setDraftPlacement(placementSelect.value);
        };
        placementField.appendChild(placementLabel);
        placementField.appendChild(placementSelect);
        body.appendChild(placementField);
      }
    }

    if (state.draftError) {
      var error = document.createElement("p");
      error.className = "subhead";
      error.style.cssText = "font-size: var(--text-xs); margin: var(--space-2) 0 0; color: var(--danger, #b00020);";
      error.setAttribute("data-testid", "opening-error");
      error.setAttribute("role", "alert");
      error.textContent = state.draftError.message || state.draftError.reason;
      body.appendChild(error);
    }

    var persistedNote = document.createElement("p");
    persistedNote.className = "subhead";
    persistedNote.style.cssText = "font-size: var(--text-xs); margin: var(--space-1) 0 0;";
    persistedNote.setAttribute("data-testid", "opening-persisted");
    if (state.persisted && state.persisted.opening) {
      persistedNote.textContent = "Apertura guardada: " + labelFor(SYSTEM_LABELS, state.persisted.opening.system);
    } else {
      persistedNote.textContent = "Sin apertura guardada todavía.";
    }
    body.appendChild(persistedNote);

    renderReadOnlyResolution(body);
    renderGeometryOutcome(body);

    if (state.draft) {
      var actions = document.createElement("div");
      actions.style.cssText = "display: flex; gap: var(--space-2); margin-top: var(--space-2);";
      var discard = document.createElement("button");
      discard.className = "btn btn-secondary";
      discard.style.flex = "1";
      discard.setAttribute("data-testid", "opening-discard");
      discard.textContent = "Descartar";
      discard.disabled = state.saving;
      discard.onclick = function () {
        state.draft = null;
        state.draftError = null;
        render();
      };
      var apply = document.createElement("button");
      apply.className = "btn btn-primary";
      apply.style.flex = "1";
      apply.setAttribute("data-testid", "opening-apply");
      apply.textContent = state.saving ? "Guardando…" : "Aplicar apertura";
      apply.disabled = state.saving;
      apply.onclick = function () {
        applyDraft();
      };
      actions.appendChild(discard);
      actions.appendChild(apply);
      body.appendChild(actions);
    }
  }

  function draftSystem() {
    return state.draft ? state.draft.system : (state.persisted && state.persisted.opening ? state.persisted.opening.system : "");
  }

  function draftProfileId() {
    return state.draft ? state.draft.profileId : (state.persisted && state.persisted.opening ? state.persisted.opening.profileId : "");
  }

  function draftPlacement() {
    if (!state.draft || !state.draft.placements || state.draft.placements.length === 0) {
      return "";
    }
    return state.draft.placements[0];
  }

  function ensureDraft() {
    if (!state.draft) {
      var carried = state.persisted && state.persisted.opening ? state.persisted.opening : { system: "", profileId: "", placements: [] };
      state.draft = {
        system: carried.system || "",
        profileId: carried.profileId || "",
        placements: (carried.placements || []).slice(0)
      };
    }
    return state.draft;
  }

  function setDraftSystem(system) {
    var draft = ensureDraft();
    draft.system = system;
    if (system !== "gola") {
      draft.profileId = "";
      draft.placements = [];
    }
    state.draftError = null;
    render();
  }

  function setDraftProfile(profileId) {
    var draft = ensureDraft();
    draft.profileId = profileId;
    draft.placements = [];
    state.draftError = null;
    render();
  }

  function setDraftPlacement(placement) {
    var draft = ensureDraft();
    draft.placements = placement ? [placement] : [];
    state.draftError = null;
    render();
  }

  function applyDraft() {
    if (!deps.sketchup || !state.draft || state.saving) return;
    state.saving = true;
    state.requestId += 1;
    var requestId = state.requestId;
    render();
    deps.sketchup.apply_design_opening(JSON.stringify({
      requestId: requestId,
      designId: state.designId,
      selection: {
        system: state.draft.system,
        profileId: state.draft.profileId,
        placements: state.draft.placements
      },
      expectedWorkingVersion: state.workingVersion || ""
    }));
  }

  function onDesignOpening(answer) {
    if (!answer || answer.requestId !== state.requestId) {
      return; // late answer of a previous design or request
    }
    state.saving = false;
    if (answer.status !== "ready") {
      state.status = "error";
      render();
      return;
    }
    state.persisted = {
      opening: answer.opening || null,
      resolution: answer.resolution || null,
      dimsKnown: answer.dimsKnown === true
    };
    state.capabilities = answer.capabilities || null;
    state.profiles = answer.profiles || [];
    // The authoritative read carries the current concurrency token; the
    // next apply sends it back (a concurrent write is a visible conflict,
    // never a silent clobber).
    if (answer.workingVersion) {
      state.workingVersion = answer.workingVersion;
    }
    state.status = "ready";
    render();
  }

  function onDesignOpeningApplied(answer) {
    if (!answer || answer.requestId !== state.requestId) {
      return;
    }
    state.saving = false;
    if (answer.status === "ok") {
      state.draft = null;
      state.draftError = null;
      // The server answered with the fresh authoritative state — render it
      // verbatim instead of guessing, and adopt the advanced token.
      state.persisted = extractPersisted(answer.state);
      if (answer.state && answer.state.workingVersion) {
        state.workingVersion = answer.state.workingVersion;
      }
      // #1264: the model convergence rides the answer — honest feedback,
      // never a local guess (a failure converges on the next edit/sync).
      state.geometryOutcome = normalizeGeometryOutcome(answer.geometry);
      render();
      return;
    }
    if (answer.status === "invalid") {
      // Keep the editable draft AND the persisted selection visible; the
      // server's message is the actionable text.
      state.draftError = { reason: answer.reason || "", message: answer.message || "la configuración de apertura no es válida" };
      state.geometryOutcome = null;
      render();
      return;
    }
    state.draftError = { reason: answer.status, message: answer.message || "no se pudo guardar la apertura" };
    render();
  }

  function extractPersisted(serverState) {
    if (!serverState || typeof serverState !== "object") {
      return state.persisted;
    }
    return {
      opening: serverState.opening || null,
      resolution: serverState.resolution || null,
      dimsKnown: serverState.dimsKnown === true
    };
  }

  window.GraneteUI.opening = {
    init: function (opts) {
      if (initialized) return;
      deps.sketchup = (opts && opts.sketchup) || (window.sketchup || null);
      initialized = true;
    },
    // The Design Inspector drives the card's lifecycle: the lane activates
    // with a bound design and deactivates on any selection.
    refresh: function (designId, workingVersion) {
      if (!initialized || !deps.sketchup || !designId) return;
      state.designId = designId;
      state.workingVersion = workingVersion || null;
      state.laneActive = true;
      state.status = "loading";
      state.requestId += 1;
      state.draft = null;
      state.draftError = null;
      render();
      deps.sketchup.get_design_opening(JSON.stringify({
        requestId: state.requestId,
        designId: designId
      }));
    },
    hide: function () {
      state.laneActive = false;
      if (!initialized) return;
      var card = el("design-inspector-opening-card");
      if (card) {
        card.style.display = "none";
      }
    },
    onDesignOpening: function (answer) {
      onDesignOpening(answer);
    },
    onDesignOpeningApplied: function (answer) {
      onDesignOpeningApplied(answer);
    },
    // Test seams: deterministic state access without DOM tricks.
    _state: function () {
      return state;
    }
  };
})();
