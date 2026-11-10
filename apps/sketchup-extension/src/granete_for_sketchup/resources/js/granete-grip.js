/**
 * Granete UI — Project grip (#1535, ADR-0009 Amendment 1 A2.3).
 *
 * El plugin manda INTENCIONES (estilo del proyecto, excepciones por mueble)
 * y pinta lo que el servidor devuelve: snapshot congelado + reporte por
 * mueble (A3). Nada se calcula aquí. El estado vive INDEXADO POR PROYECTO y
 * toda respuesta tardía cuyo projectId no coincida con el proyecto vinculado
 * se descarta sin renderizar (aceptación de la issue).
 *
 * Superficies:
 *  - sin selección: «Agarre del proyecto» (#design-grip-card) — un clic
 *    cambia el estilo y es deshacible (re-PUT de la intención previa).
 *  - un mueble: tarjeta «Agarre» (#inspector-grip-card) — hereda o excepción.
 *  - varios: bloque del lote (#inspector-batch-grip) — N excepciones en UNA
 *    operación.
 */
(function () {
  'use strict';

  var GraneteUI = window.GraneteUI = window.GraneteUI || {};

  // Estado por proyecto — nunca global: dos proyectos no se cruzan.
  var state = {};
  var inflight = {};
  var appliedInflight = {};
  var boundProjectId = '';
  var expandedFor = null; // 'project' | furnitureInstanceId con las filas abiertas
  var deps = {
    sketchup: null,
    showToast: function () {},
    onStateChange: function () {}
  };

  // Mapa del taller (#1527): la acción y el lugar donde se arregla. Los
  // códigos GRIP_* viajan hoy en details.reason del 422 (mismo envelope que
  // la fachada de apertura).
  var GRIP_REASON_TEXT = {
    GRIP_SNAPSHOT_INVALID: 'La copia congelada del agarre no es válida: actualizá el agarre del proyecto y volvé a aplicar.',
    GRIP_PROFILE_UNUSABLE: 'Un perfil del estilo no se puede usar (le falta la ficha): completala en Granete Web › Catálogo › Perfiles de apertura.',
    GRIP_PROFILE_UNKNOWN: 'El perfil que nombra el estilo ya no existe: revisá el estilo en Granete Web › Ajustes › Agarres.',
    GRIP_PROFILE_MISSING: 'Al estilo le falta el perfil de la posición que necesita: completalo en Granete Web › Ajustes › Agarres.',
    GRIP_PROFILE_INVALID: 'El perfil del estilo no tiene su identidad congelada: volvé a aplicar el agarre del proyecto.',
    GRIP_TYPE_UNCOVERED: 'El estilo no cubre un tipo de mueble del proyecto: revisá el estilo en Granete Web › Ajustes › Agarres.',
    GRIP_TYPE_UNKNOWN: 'El estilo nombra un tipo de mueble que no existe: revisalo en Granete Web › Ajustes › Agarres.',
    GRIP_STYLE_UNKNOWN: 'El estilo del agarre ya no existe: elegí otro estilo.',
    GRIP_STYLE_INVALID: 'El estilo tiene datos inválidos: revisalo en Granete Web › Ajustes › Agarres.',
    GRIP_STYLE_NOT_OFFERED: 'El taller dejó de ofrecer ese estilo: elegí otro en Granete Web › Ajustes › Agarres.',
    GRIP_STYLE_NONE: 'El proyecto no tiene estilo de agarre: elegilo en la sección Agarre del proyecto.',
    GRIP_MODE_UNKNOWN: 'El estilo declara un tipo de agarre desconocido: revisalo en Granete Web › Ajustes › Agarres.',
    GRIP_OVERHANG_INVALID: 'El rebase necesita milímetros mayores a 0: corregilo en Granete Web › Ajustes › Agarres.',
    GRIP_RECIPE_CONFLICT: 'La receta del estilo tiene datos en conflicto: revisala en Granete Web › Ajustes › Agarres.',
    GRIP_OVERRIDES_EMPTY: 'No hay muebles para la excepción: seleccioná al menos un mueble.',
    FURNITURE_INSTANCE_UNKNOWN: 'El mueble ya no existe en este proyecto: recargá el inspector.'
  };
  var GENERIC_REASON_TEXT = 'No se pudo guardar el agarre. Revisá el estilo del proyecto en Granete Web › Ajustes › Agarres.';
  var STALE_TEXT = 'Alguien más cambió el agarre del proyecto. Recargá y volvé a aplicar.';

  /** La razón del taller JAMÁS muestra un código interno: si el servidor
   * manda «CODE: mensaje», el CODE se separa y el mensaje queda limpio
   * (aceptación: ningún texto visible contiene un código OPENING_). */
  function workshopReason(raw) {
    var text = raw == null ? '' : String(raw);
    var match = text.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/);
    if (match) return match[2];
    return text;
  }

  function reasonText(reasonCode, fallback) {
    if (reasonCode && GRIP_REASON_TEXT[reasonCode]) return GRIP_REASON_TEXT[reasonCode];
    var cleaned = workshopReason(fallback);
    if (cleaned && cleaned !== fallback) return cleaned;
    return fallback ? cleaned || fallback : GENERIC_REASON_TEXT;
  }

  // ————— helpers de forma —————

  function esc(text) {
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function fmtMm(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    return String(Math.round(n * 100) / 100);
  }

  var MODE_LABEL = { gola: 'gola', handle: 'jaladera', bottom_overhang: 'rebase' };

  /**
   * La oración del taller, SOLO con lo que el servidor resuelve (alturas por
   * fila del A3, modo y descuentos aplicados del reporte). Sin anchos ni
   * cantidades que el servidor no manda.
   */
  function sentenceFor(item) {
    if (!item) return '';
    var layout = item.layout || {};
    if (layout.state === 'blocked') {
      return 'Bloqueado: ' + workshopReason(layout.reason || 'el agarre no se puede resolver');
    }
    if (layout.state === 'unknown_dims') {
      return 'Sin dimensiones conocidas: no se pueden resolver los frentes.';
    }
    var rows = layout.rows || [];
    var mode = MODE_LABEL[item.recipeMode] || item.recipeMode || 'agarre';
    if (rows.length === 0) return mode.charAt(0).toUpperCase() + mode.slice(1);
    var heights = rows.map(function (row) { return fmtMm(row.heightMm); });
    var fronts = rows.length === 1 ? '1 frente' : rows.length + ' frentes';
    var detail = mode;
    var applied = item.applied || {};
    var places = [];
    if (applied.topDiscountMm != null) places.push('gola arriba');
    if (applied.betweenDiscountMm != null) places.push('gola entre frentes');
    if (applied.bottomOverhangMm != null) places.push('rebase abajo');
    if (places.length > 0) detail = places.join(' + ');
    return fronts + ': ' + heights.join(' y ') + ' mm · ' + detail;
  }

  // ————— acceso al estado —————

  function stateFor(projectId) {
    if (!projectId) return null;
    if (!state[projectId]) {
      state[projectId] = { grip: null, styles: [], loadStatus: 'loading', stale: false, error: null, canUndo: false, canRedo: false };
    }
    return state[projectId];
  }

  function boundProject() { return boundProjectId; }

  function notify() { deps.onStateChange(); }

  // ————— transporte —————

  function callRuby(action, payload) {
    if (!deps.sketchup || typeof deps.sketchup[action] !== 'function') return;
    deps.sketchup[action](JSON.stringify(payload));
  }

  function ensureLoaded(projectId) {
    if (!projectId || inflight[projectId]) return;
    var record = stateFor(projectId);
    // Terminal states stay until the user acts: a stale banner waits for
    // Recargar, an error waits for Reintentar — the render hooks call this
    // on EVERY repaint and an unguarded re-fire loops GETs forever
    // (r1 repros: 2772-8555 requests in 600 ms with the module real).
    if (record.stale) return;
    if (record.loadStatus === 'error') return;
    if (record.grip && record.loadStatus === 'ready') return;
    inflight[projectId] = 'grip-get-' + projectId + '-' + String(Date.now());
    callRuby('get_project_grip', { requestId: inflight[projectId], projectId: projectId });
  }

  function applyStyle(projectId, styleId, previousStyleId) {
    if (!projectId || appliedInflight[projectId]) return;
    appliedInflight[projectId] = 'grip-style-' + String(Date.now());
    callRuby('apply_project_grip_style', {
      requestId: appliedInflight[projectId], projectId: projectId,
      gripStyleId: styleId, previousStyleId: previousStyleId == null ? '' : previousStyleId
    });
  }
  /** r2 MAJOR: clicking the row already in use must NOT re-PUT — the server
   * would re-freeze a new snapshot (§14.8 reserves that to the explicit
   * «Actualizar») and the undo stack would arm a no-op. */
  function applyStyleIfChanged(projectId, styleId, previousStyleId) {
    if (styleId === previousStyleId) return;
    applyStyle(projectId, styleId, previousStyleId);
  }

  function applyFurnitureOverrides(projectId, overrides) {
    if (!projectId || appliedInflight[projectId]) return;
    appliedInflight[projectId] = 'grip-furn-' + String(Date.now());
    callRuby('apply_project_grip_furniture', {
      requestId: appliedInflight[projectId], projectId: projectId, overrides: overrides
    });
  }

  function undo(projectId) {
    if (projectId) callRuby('undo_project_grip', { requestId: 'grip-undo-' + String(Date.now()), projectId: projectId });
  }

  function redo(projectId) {
    if (projectId) callRuby('redo_project_grip', { requestId: 'grip-redo-' + String(Date.now()), projectId: projectId });
  }

  function reload(projectId) {
    if (!projectId) return;
    var record = stateFor(projectId);
    record.stale = false;
    record.error = null;
    record.grip = null;
    record.loadStatus = 'loading';
    ensureLoaded(projectId);
    notify();
  }

  // ————— respuestas del puente (todas con descarte por proyecto) —————

  function accepts(payload) {
    // Respuesta tardía de otro proyecto o sesión: se descarta sin renderizar.
    var projectId = payload && payload.projectId;
    return projectId && projectId === boundProjectId;
  }

  function onProjectGrip(payload) {
    if (!accepts(payload)) return;
    var projectId = payload.projectId;
    if (inflight[projectId] && payload.requestId !== inflight[projectId]) return;
    delete inflight[projectId];
    var record = stateFor(projectId);
    if (payload.status === 'ok') {
      record.grip = payload.grip || null;
      record.styles = payload.styles || [];
      record.loadStatus = 'ready';
      record.error = null;
    } else {
      record.loadStatus = 'error';
      record.error = reasonText(payload.reasonCode, payload.reason);
    }
    notify();
  }

  function onGripMutation(payload) {
    if (!accepts(payload)) return;
    var projectId = payload.projectId;
    if (appliedInflight[projectId] && payload.requestId !== appliedInflight[projectId]) return;
    delete appliedInflight[projectId];
    var record = stateFor(projectId);
    if (payload.status === 'ok') {
      // The mutation answer carries NO report and (for the style PUT) an
      // empty overrides list — replacing state with it would paint the card
      // against a server that says otherwise (r1 repros). Keep the
      // version/canUndo and FORCE the re-read: dropping the cached grip
      // bypasses ensureLoaded's ready-guard (r2 ×2: the round-1 re-GET was
      // inert — 0 GETs after an accepted PUT).
      record.canUndo = !!payload.canUndo;
      record.canRedo = !!payload.canRedo;
      record.stale = false;
      record.error = null;
      record.loadStatus = 'loading';
      record.grip = null;
      ensureLoaded(projectId);
      deps.showToast('success', 'Agarre aplicado.');
    } else if (payload.status === 'noop') {
      deps.showToast('info', 'Nada que deshacer o rehacer.');
    } else {
      var httpStatus = payload.httpStatus;
      if (httpStatus === 412) {
        record.stale = true;
        record.error = STALE_TEXT;
      } else {
        record.error = reasonText(payload.reasonCode, payload.reason);
      }
      deps.showToast('error', record.error);
    }
    notify();
  }

  // ————— filas de opción (mundo visual compartido) —————

  function styleRows(record, selectedStyleId, onPickAttr) {
    var styles = (record.styles || []).filter(function (style) { return style.offered !== false; });
    if (styles.length === 0) {
      return '<p class="subhead" style="font-size: var(--text-xs);">El taller aún no ofrece estilos de agarre: crealos en Granete Web › Ajustes › Agarres.</p>';
    }
    var html = '<div role="radiogroup" aria-label="Estilos de agarre">';
    for (var i = 0; i < styles.length; i++) {
      var style = styles[i];
      var selected = selectedStyleId === style.id;
      html += '<div class="hw-group-option' + (selected ? ' selected' : '') + '" role="radio" aria-checked="' + (selected ? 'true' : 'false') + '" tabindex="0" data-grip-style="' + esc(style.id) + '" data-grip-pick="' + onPickAttr + '" style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2); cursor: pointer;">' +
        '<span style="min-width: 0;">' + esc(style.name || style.id) +
        (style.isDefault ? ' <span class="status-badge neutral">Predeterminado</span>' : '') +
        '</span>' +
        (selected ? '<span class="status-badge valid">En uso</span>' : '') +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function staleBanner(record) {
    if (!record.stale) return '';
    return '<p role="alert" class="design-insp-error" style="font-size: var(--text-xs);">' + esc(STALE_TEXT) + '</p>' +
      '<button type="button" class="btn btn-sm btn-secondary" data-grip-action="reload">Recargar</button>';
  }

  function errorLine(record) {
    if (record.loadStatus !== 'error' || !record.error) return '';
    return '<p role="alert" class="design-insp-error" style="font-size: var(--text-xs);">' + esc(record.error) + '</p>' +
      '<button type="button" class="btn btn-sm btn-secondary" data-grip-action="reload">Reintentar</button>';
  }

  function skeleton() {
    return '<div class="skeleton-line" style="height: 14px; width: 70%; margin-bottom: var(--space-2);"></div>' +
      '<div class="skeleton-line" style="height: 14px; width: 45%;"></div>';
  }

  // ————— superficie 1: sin selección — «Agarre del proyecto» —————

  function renderProjectSection() {
    var card = document.getElementById('design-grip-card');
    var body = document.getElementById('design-grip-body');
    var undoBtn = document.getElementById('grip-undo');
    if (!card || !body) return;
    var projectId = boundProject();
    if (!projectId) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    var record = stateFor(projectId);
    ensureLoaded(projectId);
    if (undoBtn) {
      undoBtn.style.display = record.canUndo ? 'inline-flex' : 'none';
      undoBtn.disabled = !record.canUndo;
    }
    var redoBtn = document.getElementById('grip-redo');
    if (redoBtn) {
      redoBtn.style.display = record.canRedo ? 'inline-flex' : 'none';
      redoBtn.disabled = !record.canRedo;
    }
    if (record.loadStatus === 'loading' && !record.grip) {
      body.innerHTML = skeleton();
      return;
    }
    var html = errorLine(record) + staleBanner(record);
    if (record.grip) {
      var snapshot = record.grip.snapshot || {};
      var current = record.grip.gripStyleId || '';
      if (current) {
        html += '<p class="subhead" style="font-size: var(--text-xs); margin: 0 0 var(--space-2);">Estilo en uso: <strong>' +
          esc((snapshot && snapshot.styleName) || current) + '</strong></p>';
      } else {
        html += '<p class="subhead" style="font-size: var(--text-xs); margin: 0 0 var(--space-2);">Elegí el estilo del proyecto.</p>';
      }
      html += styleRows(record, current, 'project');
    }
    body.innerHTML = html;
    bindCommonActions(body, projectId);
  }

  // ————— superficie 2: un mueble — tarjeta «Agarre» —————

  function reportItemFor(record, furnitureInstanceId) {
    var grip = record && record.grip;
    var items = grip && grip.report && grip.report.items ? grip.report.items : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].furnitureInstanceId === furnitureInstanceId) return items[i];
    }
    return null;
  }

  function renderFurnitureCard(context) {
    var card = document.getElementById('inspector-grip-card');
    var body = document.getElementById('inspector-grip-body');
    var badge = document.getElementById('inspector-grip-badge');
    if (!card || !body) return;
    var projectId = boundProject();
    var instanceId = context && context.furnitureInstanceId;
    if (!projectId || !instanceId) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    var record = stateFor(projectId);
    ensureLoaded(projectId);
    var item = reportItemFor(record, instanceId);
    var isOverride = !!(item && item.source === 'override');
    var isBlocked = !!(item && item.layout && item.layout.state === 'blocked');
    if (badge) {
      badge.textContent = isBlocked ? 'Bloqueado' : (isOverride ? 'Excepción' : 'Hereda');
      badge.className = 'status-badge ' + (isBlocked ? 'error' : (isOverride ? 'pending' : 'valid'));
    }
    if (record.loadStatus === 'loading' && !item) {
      body.innerHTML = skeleton();
      return;
    }
    var snapshot = record.grip && record.grip.snapshot ? record.grip.snapshot : {};
    var overrideSnapshot = overrideSnapshotFor(record, instanceId);
    var selectedStyleId = (overrideSnapshot && overrideSnapshot.styleId) ||
      (record.grip && record.grip.gripStyleId) || '';
    var headline = isOverride
      ? 'Excepción de este mueble: <strong>' + esc((overrideSnapshot && overrideSnapshot.styleName) || snapshot.styleName || '—') + '</strong>'
      : 'Usa el estilo del proyecto: <strong>' + esc(snapshot.styleName || '—') + '</strong>';
    var sentence = sentenceFor(item);
    var html = errorLine(record) + staleBanner(record) +
      '<p style="margin: 0 0 var(--space-1); font-size: var(--text-xs);">' + headline + '</p>' +
      '<p aria-live="polite" class="subhead" style="margin: 0 0 var(--space-2); font-size: var(--text-xs);">' + esc(sentence) + '</p>';
    var expanded = expandedFor === instanceId;
    var actions = '<div style="display: flex; gap: var(--space-2);">';
    actions += '<button type="button" class="btn btn-sm btn-secondary" data-grip-action="toggle-furniture">' + (expanded ? 'Cerrar' : 'Cambiar sólo este mueble') + '</button>';
    if (isOverride) {
      actions += '<button type="button" class="btn btn-sm btn-ghost" data-grip-action="clear-override">Volver al del proyecto</button>';
    }
    actions += '</div>';
    html += actions;
    if (expanded) {
      html += '<div style="margin-top: var(--space-2);">' + styleRows(record, selectedStyleId, 'furniture') + '</div>';
    }
    body.innerHTML = html;
    bindCommonActions(body, projectId);
    wireFurnitureCard(body, projectId, instanceId);
  }

  /** La excepción vigente de UN mueble: {styleId, styleName} del snapshot
   * congelado del override; null cuando el mueble hereda. */
  function overrideSnapshotFor(record, furnitureInstanceId) {
    var overrides = record.grip && record.grip.overrides ? record.grip.overrides : [];
    for (var i = 0; i < overrides.length; i++) {
      if (overrides[i].furnitureInstanceId === furnitureInstanceId) {
        return overrides[i].snapshot || null;
      }
    }
    return null;
  }

  function wireFurnitureCard(body, projectId, instanceId) {
    var toggle = body.querySelector('[data-grip-action="toggle-furniture"]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        expandedFor = expandedFor === instanceId ? null : instanceId;
        notify();
      });
    }
    var clear = body.querySelector('[data-grip-action="clear-override"]');
    if (clear) {
      clear.addEventListener('click', function () {
        applyFurnitureOverrides(projectId, [{ furnitureInstanceId: instanceId, gripStyleId: null }]);
      });
    }
    var picks = body.querySelectorAll('[data-grip-pick="furniture"]');
    for (var i = 0; i < picks.length; i++) {
      picks[i].addEventListener('click', function () {
        var styleId = this.getAttribute('data-grip-style');
        applyFurnitureOverrides(projectId, [{ furnitureInstanceId: instanceId, gripStyleId: styleId }]);
        expandedFor = null;
      });
    }
  }

  // ————— superficie 3: lote — N excepciones en UNA operación —————

  function renderBatchBlock(members) {
    var container = document.getElementById('inspector-batch-grip');
    var card = document.getElementById('inspector-batch-grip-card');
    if (!container || !card) return;
    var projectId = boundProject();
    if (!projectId || !members || members.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    var record = stateFor(projectId);
    ensureLoaded(projectId);
    if (record.loadStatus === 'loading' && !record.grip) {
      container.innerHTML = skeleton();
      return;
    }
    // The pending pick never survives a re-render or a selection change
    // (r2 A-7/B-6: it leaked across both and even across projects).
    container.removeAttribute('data-grip-pending');
    var withId = (members || []).filter(function (member) {
      return member && member.furnitureInstanceId && member.furnitureInstanceId !== '';
    });
    var html = errorLine(record) + staleBanner(record) +
      '<p class="subhead" style="font-size: var(--text-xs); margin: 0 0 var(--space-2);">La excepción se aplica a los ' + withId.length + ' muebles del lote en una sola operación.</p>' +
      styleRows(record, null, 'batch');
    container.innerHTML = html;
    bindCommonActions(container, projectId);
    var picks = container.querySelectorAll('[data-grip-pick="batch"]');
    for (var i = 0; i < picks.length; i++) {
      picks[i].addEventListener('click', function () {
        container.setAttribute('data-grip-pending', this.getAttribute('data-grip-style'));
        updateBatchGripFooter(projectId, members);
      });
    }
    updateBatchGripFooter(projectId, members);
  }

  function updateBatchGripFooter(projectId, members) {
    var container = document.getElementById('inspector-batch-grip');
    if (!container) return;
    var pending = container.getAttribute('data-grip-pending');
    var footerId = 'inspector-batch-grip-footer';
    var footer = document.getElementById(footerId);
    if (!pending) {
      if (footer) footer.remove();
      return;
    }
    if (!footer) {
      footer = document.createElement('button');
      footer.id = footerId;
      footer.type = 'button';
      footer.className = 'btn btn-primary';
      footer.style.width = '100%';
      footer.style.marginTop = 'var(--space-2)';
      container.appendChild(footer);
    }
    footer.textContent = 'Aplicar a ' + members.length + ' muebles';
    footer.onclick = function () {
      var overrides = (members || []).filter(function (member) {
        return member && member.furnitureInstanceId && member.furnitureInstanceId !== '';
      }).map(function (member) {
        return { furnitureInstanceId: member.furnitureInstanceId, gripStyleId: pending };
      });
      applyFurnitureOverrides(projectId, overrides);
      container.removeAttribute('data-grip-pending');
      updateBatchGripFooter(projectId, members);
    };
  }

  // ————— acciones comunes (recargar / deshacer / elegir estilo) —————

  /** Teclado del radiogroup (brief Accesibilidad; r2 A-9/B-10: la ronda 1
   * lo declaró sin entregarlo). Enter/Espacio activan la fila enfocada;
   * las flechas mueven el ancla y activan. */
  function bindRowKeyboard(row, group) {
    row.addEventListener('keydown', function (e) {
      var rows = Array.prototype.slice.call(
        group.querySelectorAll('[data-grip-pick]'));
      var index = rows.indexOf(row);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        row.click();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = rows[(index + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length];
        if (next) next.focus();
      }
    });
  }

  function bindCommonActions(root, projectId) {
    var reloads = root.querySelectorAll('[data-grip-action="reload"]');
    for (var i = 0; i < reloads.length; i++) {
      reloads[i].addEventListener('click', function () { reload(projectId); });
    }
    var picks = root.querySelectorAll('[data-grip-pick="project"]');
    for (var j = 0; j < picks.length; j++) {
      picks[j].addEventListener('click', function () {
        var record = stateFor(projectId);
        var previous = record.grip && record.grip.gripStyleId ? record.grip.gripStyleId : '';
        applyStyleIfChanged(projectId, this.getAttribute('data-grip-style'), previous);
      });
      bindRowKeyboard(picks[j], root);
    }
  }

  function bindUndoButton() {
    var undoBtn = document.getElementById('grip-undo');
    if (undoBtn) undoBtn.addEventListener('click', function () { undo(boundProject()); });
    var redoBtn = document.getElementById('grip-redo');
    if (redoBtn) redoBtn.addEventListener('click', function () { redo(boundProject()); });
  }

  // ————— init / binding —————

  function init(options) {
    deps.sketchup = options.sketchup || null;
    deps.showToast = options.showToast || deps.showToast;
    deps.onStateChange = options.onStateChange || deps.onStateChange;
    bindUndoButton();
  }

  /** El binding manda: proyecto vinculado = el único que se renderiza. */
  function onBindingStatus(status) {
    var binding = (status && status.binding) || {};
    var connected = !!(status && status.state === 'connected' && binding.projectId);
    var next = connected ? binding.projectId : '';
    if (next === boundProjectId) {
      if (next) ensureLoaded(next);
      return;
    }
    boundProjectId = next;
    expandedFor = null;
    if (boundProjectId) ensureLoaded(boundProjectId);
    notify();
  }

  window.GraneteUI.grip = {
    init: init,
    onBindingStatus: onBindingStatus,
    ensureLoaded: ensureLoaded,
    onProjectGrip: onProjectGrip,
    onProjectGripApplied: onGripMutation,
    onProjectGripUndone: onGripMutation,
    onProjectGripRedone: onGripMutation,
    renderProjectSection: renderProjectSection,
    renderFurnitureCard: renderFurnitureCard,
    renderBatchBlock: renderBatchBlock,
    applyStyle: applyStyle,
    applyFurnitureOverrides: applyFurnitureOverrides,
    undo: undo,
    redo: redo,
    reload: reload,
    sentenceFor: sentenceFor,
    reasonText: reasonText,
    boundProjectId: boundProject,
    // prueba: reset del estado por proyecto entre casos
    _resetForTest: function () { state = {}; inflight = {}; appliedInflight = {}; boundProjectId = ''; expandedFor = null; }
  };
})();
