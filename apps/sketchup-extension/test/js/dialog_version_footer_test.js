// #469 tooling: the dialog footer's version MUST come from the loaded
// extension (EXTENSION_VERSION pushed through the dialog_ready bridge),
// never from a hardcoded page string — the static "v0.1.4" footer had
// already drifted two versions behind when this test was written.
// Static half: the footer markup carries no version literal and keeps
// the granete-version-footer id. Dynamic half: the real dialog script's
// setPluginVersion renders the pushed version into that footer.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createMockElement(id = '') {
  let textContentValue = '';
  return {
    id,
    style: {},
    className: '',
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    textContent: '',
    innerHTML: '',
    set textContentValue(v) { textContentValue = v; },
    get textContentValue() { return textContentValue; },
    addEventListener: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
    set text(v) { this.textContent = v; }
  };
}

const registry = {};
const documentMock = {
  getElementById: (id) => (registry[id] = registry[id] || createMockElement(id)),
  createElement: (tag) => createMockElement(''),
  querySelector: () => createMockElement('q'),
  querySelectorAll: () => [],
  addEventListener: () => {}
};

const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  document: documentMock,
  window: {
    addEventListener: () => {},
    sketchup: {
      dialog_ready: () => {}, get_catalog: () => {}, get_project_furniture: () => {},
      insert_furniture: () => {}, update_furniture: () => {}, delete_selected_furniture: () => {},
      select_furniture: () => {}, login: () => {}, logout: () => {}, close_dialog: () => {}
    }
  }
};

const htmlPath = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

// ---- static: no hardcoded version in the footer markup -----------------
const footerMatch = html.match(/<footer[^>]*id="granete-version-footer"[^>]*>([\s\S]*?)<\/footer>/);
assert(footerMatch, 'the footer must keep id="granete-version-footer"');
assert(!/v\d+\.\d+/.test(footerMatch[1]),
  `the footer must not hardcode a version (found: ${footerMatch[1].trim()}) — it renders what the extension pushes`);

// ---- dynamic: setPluginVersion renders the pushed value ----------------
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
assert(scriptMatch, 'dialog.html must carry its script');
vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

sandbox.window.GraneteDialog.setPluginVersion({ version: '0.1.6-test' });
const footer = registry['granete-version-footer'];
assert(footer, 'setPluginVersion resolves the footer element');
assert.strictEqual(footer.textContent, 'Granete para SketchUp · v0.1.6-test',
  'the footer shows the version the EXTENSION pushed, not a page constant');

sandbox.window.GraneteDialog.setPluginVersion({});
assert.strictEqual(footer.textContent, 'Granete para SketchUp · v0.1.6-test',
  'a payload without version leaves the footer untouched (never renders "undefined")');

console.log('dialog_version_footer_test: 3 assertions OK');
