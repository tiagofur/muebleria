'use strict';
// #848 Phase B: dialog.html loads external JS around its inline bootstrap
// (granete-media.js, granete-account.js, granete-library.js). Harnesses
// execute the REAL files in dialog.html load order — never a copy of their
// contents.
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
    media: fs.readFileSync(path.join(RESOURCES, 'js/granete-media.js'), 'utf-8'),
    account: fs.readFileSync(path.join(RESOURCES, 'js/granete-account.js'), 'utf-8'),
    library: fs.readFileSync(path.join(RESOURCES, 'js/granete-library.js'), 'utf-8')
  };
}

// Runs the dialog scripts in dialog.html load order (granete-media.js,
// granete-account.js, granete-library.js, then the inline bootstrap) inside
// an already-created vm context.
function runDialogScripts(sandbox) {
  const sources = dialogSources();
  vm.runInContext(sources.media, sandbox, { filename: 'granete-media.js' });
  vm.runInContext(sources.account, sandbox, { filename: 'granete-account.js' });
  vm.runInContext(sources.library, sandbox, { filename: 'granete-library.js' });
  vm.runInContext(sources.inline, sandbox, { filename: 'dialog-inline.js' });
}

module.exports = { dialogSources, runDialogScripts };
