'use strict';
// #848 Phase B: dialog.html loads external JS around its inline bootstrap
// (granete-media.js, granete-account.js, granete-library.js,
// granete-configurator.js, granete-finish-selector.js,
// granete-material-roles.js, granete-inspector-child.js,
// granete-inspector.js, granete-model-binding.js,
// granete-project-furniture.js, granete-param-form.js). Harnesses execute
// the REAL files in dialog.html load order — never a copy of their contents.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RESOURCES = path.resolve(__dirname, '../../../src/granete_for_sketchup/resources');

function dialogSources() {
  const html = fs.readFileSync(path.join(RESOURCES, 'dialog.html'), 'utf-8');
  const inlineMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  if (!inlineMatch) throw new Error('dialog.html must carry its inline script');
  return {
    html,
    inline: inlineMatch[1],
    media: fs.readFileSync(path.join(RESOURCES, 'js/granete-media.js'), 'utf8'),
    account: fs.readFileSync(path.join(RESOURCES, 'js/granete-account.js'), 'utf8'),
    library: fs.readFileSync(path.join(RESOURCES, 'js/granete-library.js'), 'utf8'),
    configurator: fs.readFileSync(path.join(RESOURCES, 'js/granete-configurator.js'), 'utf8'),
    finishSelector: fs.readFileSync(path.join(RESOURCES, 'js/granete-finish-selector.js'), 'utf8'),
    materialRoles: fs.readFileSync(path.join(RESOURCES, 'js/granete-material-roles.js'), 'utf8'),
    inspectorChild: fs.readFileSync(path.join(RESOURCES, 'js/granete-inspector-child.js'), 'utf8'),
    inspector: fs.readFileSync(path.join(RESOURCES, 'js/granete-inspector.js'), 'utf8'),
    designInspector: fs.readFileSync(path.join(RESOURCES, 'js/granete-design-inspector.js'), 'utf8'),
    modelBinding: fs.readFileSync(path.join(RESOURCES, 'js/granete-model-binding.js'), 'utf8'),
    projectFurniture: fs.readFileSync(path.join(RESOURCES, 'js/granete-project-furniture.js'), 'utf8'),
    paramForm: fs.readFileSync(path.join(RESOURCES, 'js/granete-param-form.js'), 'utf8')
  };
}

// Runs the dialog scripts in dialog.html load order (granete-media.js,
// granete-account.js, granete-library.js, granete-configurator.js,
// granete-finish-selector.js, granete-material-roles.js,
// granete-inspector-child.js, granete-inspector.js,
// granete-model-binding.js, granete-project-furniture.js,
// granete-param-form.js, then the inline bootstrap) inside an
// already-created vm context.
function runDialogScripts(sandbox) {
  const sources = dialogSources();
  vm.runInContext(sources.media, sandbox, { filename: 'granete-media.js' });
  vm.runInContext(sources.account, sandbox, { filename: 'granete-account.js' });
  vm.runInContext(sources.library, sandbox, { filename: 'granete-library.js' });
  vm.runInContext(sources.configurator, sandbox, { filename: 'granete-configurator.js' });
  vm.runInContext(sources.finishSelector, sandbox, { filename: 'granete-finish-selector.js' });
  vm.runInContext(sources.materialRoles, sandbox, { filename: 'granete-material-roles.js' });
  vm.runInContext(sources.inspectorChild, sandbox, { filename: 'granete-inspector-child.js' });
  vm.runInContext(sources.designInspector, sandbox, { filename: 'granete-design-inspector.js' });
  vm.runInContext(sources.inspector, sandbox, { filename: 'granete-inspector.js' });
  vm.runInContext(sources.modelBinding, sandbox, { filename: 'granete-model-binding.js' });
  vm.runInContext(sources.projectFurniture, sandbox, { filename: 'granete-project-furniture.js' });
  vm.runInContext(sources.paramForm, sandbox, { filename: 'granete-param-form.js' });
  vm.runInContext(sources.inline, sandbox, { filename: 'dialog-inline.js' });
}

module.exports = { dialogSources, runDialogScripts };
