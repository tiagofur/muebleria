// Real JavaScript test harness for the #476 contextual inspector in
// dialog.html: renders SelectionContext payloads through the actual dialog
// script (vm sandbox + mock DOM) and asserts capability-driven gating,
// breadcrumb navigation, provenance copy, unmanaged state and multi-selection
// fail-closed behavior. Complements the Ruby tests (which prove the payload)
// by proving what the HtmlDialog actually renders and blocks.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createMockElement(id = '', tagName = 'DIV') {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  const children = [];
  let innerHTMLValue = '';
  let textContentValue = '';

  let classNameValue = '';
  const el = {
    id,
    tagName,
    children,
    style: {},
    disabled: false,
    type: '',
    title: '',
    value: '',
    checked: false,
    required: false,
    maxLength: -1,
    get className() {
      return classNameValue;
    },
    set className(val) {
      classNameValue = String(val);
      classes.clear();
      classNameValue.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c))
    },
    getAttribute: (k) => (k in attributes ? attributes[k] : null),
    setAttribute: (k, v) => { attributes[k] = String(v); },
    removeAttribute: (k) => { delete attributes[k]; },
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    dispatchEvent: (event) => {
      (listeners[event.type] || []).forEach((cb) => cb(event));
      return true;
    },
    click: () => {
      (listeners['click'] || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    focus: () => {},
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    get innerHTML() {
      return innerHTMLValue;
    },
    set innerHTML(val) {
      innerHTMLValue = String(val);
      children.length = 0;
    },
    get textContent() {
      return textContentValue;
    },
    set textContent(val) {
      textContentValue = String(val);
    }
  };
  return el;
}

function buildSandbox() {
  const registry = {};
  const created = [];
  const bridgeCalls = [];

  const documentMock = {
    getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
    createElement: (tag) => {
      const el = createMockElement('', tag);
      created.push(el);
      return el;
    },
    querySelector: () => createMockElement('q', 'BUTTON'), // tab probe: getAttribute -> null
    querySelectorAll: () => [],
    addEventListener: (evt, cb) => {
      (registry.__docListeners = registry.__docListeners || {})[evt] =
        (registry.__docListeners[evt] || []).concat(cb);
    }
  };

  const sandbox = {
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    document: documentMock,
    window: {
      addEventListener: () => {},
      sketchup: {
        dialog_ready: () => bridgeCalls.push({ action: 'dialog_ready' }),
        get_catalog: () => bridgeCalls.push({ action: 'get_catalog' }),
        insert_furniture: (p) => bridgeCalls.push({ action: 'insert_furniture', payload: JSON.parse(p) }),
        update_furniture: (p) => bridgeCalls.push({ action: 'update_furniture', payload: JSON.parse(p) }),
        delete_selected_furniture: (p) => bridgeCalls.push({ action: 'delete_selected_furniture', payload: JSON.parse(p) }),
        select_furniture: (p) => bridgeCalls.push({ action: 'select_furniture', payload: JSON.parse(p) }),
        open_material_selector: (p) => bridgeCalls.push({ action: 'open_material_selector', payload: JSON.parse(p) }),
        login: () => {}, logout: () => {}, close_dialog: () => {}
      }
    }
  };
  sandbox.__registry = registry;
  sandbox.__created = created;
  sandbox.__bridge = bridgeCalls;
  return sandbox;
}

function runDialog() {
  const htmlPath = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'dialog.html must carry its script');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

function descendants(root) {
  return (root.children || []).reduce((all, child) => all.concat([child], descendants(child)), []);
}

const DEFINITION = {
  furniture_definition_id: 'mod-test',
  name: 'Mueble de Prueba',
  parameters: [{ name: 'widthMm', defaultValue: 600, type: 'number', label: 'Ancho', min: 300, max: 900, step: 10, unit: 'mm' }],
  materialRoles: [{ role: 'BODY', label: 'Cuerpo', optionIds: ['mat-1'] }]
};

function furnitureContext(overrides) {
  return Object.assign({
    kind: 'furniture',
    furnitureInstanceRef: 'ref-1',
    furnitureDefinitionId: 'mod-test',
    representation: 'native',
    ownerRecovery: 'none',
    semanticPath: ['Mueble de Prueba'],
    display: { name: 'Mueble de Prueba' },
    definition: DEFINITION,
    parameters: { widthMm: 600 },
    materialChoices: {},
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: true, reason: null },
      canEditHighLevelHardware: { supported: false, reason: 'x' },
      canDuplicate: { supported: false, reason: 'x' },
      canDelete: { supported: true, reason: null },
      canReviewPreflight: { supported: false, reason: 'x' },
      canInspectManufacturing: { supported: false, reason: 'x' }
    }
  }, overrides);
}

function partContext(overrides) {
  return Object.assign({
    kind: 'part',
    furnitureInstanceRef: 'ref-1',
    componentInstanceId: 'shelf-a',
    componentDefinitionId: 'st-comp-shelf',
    ownerRecovery: 'scan',
    semanticPath: ['Mueble de Prueba', 'Entrepaño 1'],
    display: { name: 'Entrepaño 1', role: 'shelf_1' },
    capabilities: {
      canMoveWithinConstraint: { supported: false, reason: 'Las posiciones internas las resuelve Granete.' },
      canDuplicate: { supported: false, reason: 'r' },
      canAddRelated: { supported: false, reason: 'r' },
      canRemove: { supported: false, reason: 'r' },
      canChangeJoinery: { supported: false, reason: 'r' },
      canInspectManufacturing: { supported: false, reason: 'r' }
    }
  }, overrides);
}

function hardwareContext(placementKind, overrides) {
  return Object.assign({
    kind: 'hardware',
    furnitureInstanceRef: 'ref-1',
    hardwarePlacementId: 'place-hw-1',
    hardwareDefinitionId: 'hw-handle',
    hostComponentInstanceId: 'door-1',
    placementKind: placementKind,
    ownerRecovery: 'scan',
    semanticPath: ['Mueble de Prueba', 'Manija 160'],
    display: { name: 'Manija 160' },
    capabilities: {
      canMove: { supported: false, reason: 'porvenancia' },
      canRotate: { supported: false, reason: 'r' },
      canChangeHandedness: { supported: false, reason: 'r' },
      canReplaceDefinition: { supported: false, reason: 'r' },
      canInspectMachining: { supported: false, reason: 'r' }
    }
  }, overrides);
}

function runTests() {
  const sandbox = runDialog();
  const dialog = sandbox.window.GraneteDialog;
  assert(dialog && typeof dialog.onSelectionChange === 'function', 'GraneteDialog.onSelectionChange must exist');
  let passed = 0;
  const check = (cond, msg) => { assert(cond, msg); passed += 1; };

  // --- furniture, editable: params + materials on, buttons enabled ---
  dialog.onSelectionChange(furnitureContext());
  check(visible(el(sandbox, 'inspector-active-view')), 'furniture shows the active view');
  check(!visible(el(sandbox, 'inspector-empty-state')), 'empty state hidden for furniture');
  check(!el(sandbox, 'inspector-edit-fieldset').disabled, 'fieldset enabled when editable');
  check(!el(sandbox, 'btn-update').disabled, 'update enabled when canEditParameters');
  check(visible(el(sandbox, 'inspector-params-card')), 'params card visible when editable');
  check(!visible(el(sandbox, 'inspector-edit-blocker')), 'no blocker when editable');

  // --- furniture, capability denial (legacy/missing definition) ---
  dialog.onSelectionChange(furnitureContext({
    representation: 'legacy-group',
    definition: null,
    capabilities: {
      canEditParameters: { supported: false, reason: 'Representación legacy: requerí la migración.' },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: false, reason: 'r' }
    }
  }));
  check(el(sandbox, 'inspector-edit-fieldset').disabled, 'fieldset fail-closed when canEditParameters=false');
  check(el(sandbox, 'btn-update').disabled, 'update disabled when canEditParameters=false');
  check(visible(el(sandbox, 'inspector-edit-blocker')), 'blocker visible when canEditParameters=false');
  assert(el(sandbox, 'inspector-edit-blocker-reason').textContent.includes('legacy'),
    'blocker shows the capability reason');
  passed += 1;
  check(!visible(el(sandbox, 'inspector-params-card')), 'params hidden when not editable');

  // --- delete obeys its OWN capability: a missing catalog definition must
  //     not disable deleting the placed furniture ---
  dialog.onSelectionChange(furnitureContext({
    definition: null,
    capabilities: {
      canEditParameters: { supported: false, reason: 'La definición ya no está disponible.' },
      canEditMaterialRoles: { supported: false, reason: 'r' },
      canDelete: { supported: true, reason: null }
    }
  }));
  check(el(sandbox, 'inspector-edit-fieldset').disabled, 'edit fieldset fail-closed without definition');
  check(!el(sandbox, 'btn-delete').disabled, 'delete stays enabled when only canEditParameters is false');

  // --- furniture, materials capability gates its own card ---
  dialog.onSelectionChange(furnitureContext({
    definition: Object.assign({}, DEFINITION, { materialRoles: [] }),
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: false, reason: 'Esta definición no expone roles.' },
      canDelete: { supported: true, reason: null }
    }
  }));
  check(!el(sandbox, 'inspector-edit-fieldset').disabled, 'fieldset stays enabled');
  check(!visible(el(sandbox, 'inspector-materials-card')), 'materials card obeys canEditMaterialRoles, not canEditParameters');
  check(el(sandbox, 'btn-update').disabled === false, 'update still available for parameters');

  // --- typed parameter controls execute real change handlers and preserve
  //     explicit false / empty string values instead of falling back to defaults ---
  const typedDefinition = Object.assign({}, DEFINITION, {
    parameters: DEFINITION.parameters.concat([
      { name: 'hasBackPanel', defaultValue: true, type: 'boolean', label: 'Respaldo', required: true },
      { name: 'customerNote', defaultValue: 'default', type: 'string', label: 'Nota', required: false, maxLength: 32 }
    ])
  });
  dialog.onSelectionChange(furnitureContext({
    definition: typedDefinition,
    parameters: { widthMm: 600, hasBackPanel: false, customerNote: '' }
  }));
  const paramControls = descendants(el(sandbox, 'inspector-params-container'));
  const booleanControl = paramControls.find((node) => node.id === 'param-hasBackPanel-inspector-params-container');
  const stringControl = paramControls.find((node) => node.id === 'param-customerNote-inspector-params-container');
  check(booleanControl && booleanControl.type === 'checkbox', 'boolean renders a native checkbox');
  check(booleanControl.checked === false, 'explicit false is preserved over the true default');
  check(booleanControl.getAttribute('aria-label') === 'Respaldo', 'boolean control has an accessible name');
  check(stringControl && stringControl.type === 'text', 'string renders a native text input');
  check(stringControl.value === '', 'explicit empty string is preserved over the non-empty default');
  check(stringControl.maxLength === 32, 'string input exposes the contract maxLength');
  booleanControl.checked = true;
  booleanControl.dispatchEvent({ type: 'change' });
  stringControl.value = 'Visible note';
  stringControl.dispatchEvent({ type: 'change' });
  el(sandbox, 'btn-update').click();
  const typedUpdate = sandbox.__bridge.filter((call) => call.action === 'update_furniture').pop();
  check(typedUpdate.payload.parameters.hasBackPanel === true, 'boolean change reaches the update payload');
  check(typedUpdate.payload.parameters.customerNote === 'Visible note', 'string change reaches the update payload');

  // Structured server codes produce stable user guidance without parsing messages.
  dialog.onUpdateResult({ success: false, issues: [{ code: 'PARAMETER_STRING_TOO_LONG', parameter: 'customerNote' }] });
  check(el(sandbox, 'toast-message').textContent.includes('longitud permitida'),
    'structured parameter code renders actionable copy');

  // --- multi-selection: inspectable, every mutation fail-closed ---
  dialog.onSelectionChange(furnitureContext({ selectionCount: 3 }));
  check(el(sandbox, 'inspector-edit-fieldset').disabled, 'multi-selection disables the whole mutation fieldset');
  check(el(sandbox, 'btn-update').disabled, 'update disabled on multi-selection');
  check(el(sandbox, 'btn-delete').disabled, 'delete disabled on multi-selection');
  check(visible(el(sandbox, 'inspector-multi-note')), 'multi-selection note visible');
  check(el(sandbox, 'inspector-multi-note').textContent.indexOf('#') === -1, 'multi note uses user copy without tracking numbers');

  // material apply must not mutate under multi-selection
  const bridgeBefore = sandbox.__bridge.length;
  dialog.onMaterialChoiceApplied({ role: 'BODY', materialId: 'mat-1', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });
  check(sandbox.__bridge.slice(bridgeBefore).every((c) => c.action !== 'update_furniture'),
    'onMaterialChoiceApplied never mutates under multi-selection');

  // and not when the materials capability is off
  dialog.onSelectionChange(furnitureContext({
    definition: Object.assign({}, DEFINITION, { materialRoles: [] }),
    capabilities: {
      canEditParameters: { supported: true, reason: null },
      canEditMaterialRoles: { supported: false, reason: 'no roles' },
      canDelete: { supported: true, reason: null }
    }
  }));
  const before2 = sandbox.__bridge.length;
  dialog.onMaterialChoiceApplied({ role: 'BODY', materialId: 'mat-1', scope: 'furniture', context: 'inspector', instanceId: 'ref-1' });
  check(sandbox.__bridge.slice(before2).every((c) => c.action !== 'update_furniture'),
    'onMaterialChoiceApplied obeys canEditMaterialRoles');

  // --- update click sends the LOCAL ref, never a fabricated business id ---
  dialog.onSelectionChange(furnitureContext());
  el(sandbox, 'btn-update').click();
  const updateCall = sandbox.__bridge.filter((c) => c.action === 'update_furniture').pop();
  check(updateCall && updateCall.payload.instanceId === 'ref-1', 'update sends furnitureInstanceRef as instanceId');

  // --- part drill-down: breadcrumb + capabilities + collapsed tech detail ---
  dialog.onSelectionChange(partContext());
  check(visible(el(sandbox, 'inspector-child-view')), 'part shows the child view');
  check(!visible(el(sandbox, 'inspector-active-view')), 'furniture view hidden for part');
  const crumbOwner = el(sandbox, 'child-breadcrumb').children.find((c) => c.classList.contains('crumb-link'));
  check(!!crumbOwner && crumbOwner.textContent === 'Mueble de Prueba', 'breadcrumb names the owning furniture');
  check(el(sandbox, 'btn-goto-furniture').style.display === 'inline-flex', 'goto visible when owner resolved by scan');
  check(el(sandbox, 'child-capabilities').children.length === 6, 'all part capabilities rendered');
  const firstCap = el(sandbox, 'child-capabilities').children[0];
  check(firstCap.children.some((c) => c.textContent.includes('Las posiciones internas')),
    'capability denial shows its reason');
  check(el(sandbox, 'child-facts').children.length > 0, 'technical facts render inside the collapsible detail');

  // --- #467: structural part keeps the internal authoring card hidden ---
  check(!visible(el(sandbox, 'part-authoring-card')),
    'structural part does not offer internal authoring');

  // --- #467: movable internal renders the authoring card prefilled + gated ---
  const movablePart = partContext({
    componentPlacement: 'interno',
    assemblyTranslationMm: [18, 18, 150],
    capabilities: {
      canMoveWithinConstraint: { supported: true, reason: null },
      canDuplicate: { supported: true, reason: null },
      canAddRelated: { supported: true, reason: null },
      canRemove: { supported: true, reason: null },
      canChangeJoinery: { supported: false, reason: 'unión desde parámetros' },
      canInspectManufacturing: { supported: true, reason: null }
    }
  });
  dialog.onSelectionChange(movablePart);
  check(visible(el(sandbox, 'part-authoring-card')), 'movable internal shows the authoring card');
  check(el(sandbox, 'part-occurrence-val').textContent === 'shelf-a', 'card shows the exact occurrence id');
  check(el(sandbox, 'part-pos-x').value === 18 && el(sandbox, 'part-pos-y').value === 18 &&
    el(sandbox, 'part-pos-z').value === 150, 'position inputs prefilled with the resolved pose');
  check(el(sandbox, 'btn-apply-part-move').disabled === false, 'move enabled for movable internal');
  check(el(sandbox, 'btn-part-remove').disabled === false, 'remove enabled for movable internal');

  // hardware selection never shows the component card
  dialog.onSelectionChange(hardwareContext('manual'));
  check(!visible(el(sandbox, 'part-authoring-card')), 'hardware keeps the component card hidden');

  // breadcrumb crumb click navigates via the ref
  const crumb = el(sandbox, 'child-breadcrumb').children.find((c) => c.classList.contains('crumb-link'));
  check(!!crumb, 'owner breadcrumb crumb exists');
  crumb.click();
  const selectCall = sandbox.__bridge.filter((c) => c.action === 'select_furniture').pop();
  check(selectCall && selectCall.payload.furnitureInstanceRef === 'ref-1',
    'breadcrumb navigation sends furnitureInstanceRef');

  // ambiguous owner: honest note, no navigation
  dialog.onSelectionChange(partContext({ ownerRecovery: 'ambiguous' }));
  check(el(sandbox, 'child-owner-note').textContent.includes('varias copias'),
    'ambiguous owner explains itself');
  check(el(sandbox, 'btn-goto-furniture').style.display === 'none', 'no navigation when owner is ambiguous');

  // --- hardware provenance copy: manual / derived / unknown ---
  dialog.onSelectionChange(hardwareContext('manual'));
  check(el(sandbox, 'child-origin-note').textContent.includes('manual'), 'manual provenance copy');
  dialog.onSelectionChange(hardwareContext('derived'));
  check(el(sandbox, 'child-origin-note').textContent.includes('derivado'), 'derived provenance copy');
  dialog.onSelectionChange(hardwareContext('unknown'));
  check(el(sandbox, 'child-origin-note').textContent.includes('sin determinar'), 'unknown provenance fails closed in copy');

  // --- unmanaged ---
  dialog.onSelectionChange({ kind: 'unmanaged', ownerRecovery: 'none', display: { name: '' }, capabilities: {} });
  check(visible(el(sandbox, 'inspector-unmanaged-view')), 'unmanaged shows its own state');
  check(!visible(el(sandbox, 'inspector-child-view')), 'child view hidden for unmanaged');
  check(!visible(el(sandbox, 'inspector-active-view')), 'furniture view hidden for unmanaged');

  // --- cleared selection ---
  dialog.onSelectionChange(null);
  check(visible(el(sandbox, 'inspector-empty-state')), 'cleared selection returns to empty state');

  return { success: true, testsPassed: passed };
}

try {
  const result = runTests();
  console.log(JSON.stringify(result));
} catch (err) {
  console.log(JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
}
