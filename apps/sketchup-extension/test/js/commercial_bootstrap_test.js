const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-commercial-bootstrap.js'), 'utf8');
const dialogSource = fs.readFileSync(path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html'), 'utf8');
const elements = {};
const calls = [];
function node(id) {
  return elements[id] || (elements[id] = {
    id, value: '', style: {}, textContent: '', disabled: false, innerHTML: '', listeners: {},
    focus() { this.focused = true; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    appendChild(child) { (this.children || (this.children = [])).push(child); }
  });
}
const radios = [node('mode-existing'), node('mode-new')];
radios[0].value = 'existing'; radios[0].checked = true;
radios[1].value = 'new'; radios[1].checked = false;
const context = {
  console, JSON,
  document: {
    getElementById: node,
    querySelector: () => radios.find((radio) => radio.checked),
    querySelectorAll: () => radios,
    createElement: () => ({ value: '', textContent: '' })
  },
  window: { sketchup: {
    list_bootstrap_customers: () => calls.push({ action: 'customers' }),
    bootstrap_project_design: (payload) => calls.push({ action: 'bootstrap', payload: JSON.parse(payload) })
  } }
};
vm.createContext(context);
vm.runInContext(source, context);

assert.match(dialogSource, /id="btn-pairing-connect" class="btn btn-primary"/);
assert.match(dialogSource, /id="btn-bootstrap-project" class="btn btn-secondary"/);
context.window.GraneteCommercialBootstrap.setBinding({ state: 'unbound' });
assert.strictEqual(node('pairing-entry').style.display, '');
assert.strictEqual(node('model-binding-actions').style.display, '');
assert.strictEqual(node('project-bootstrap-form').style.display, 'none');

node('btn-bootstrap-project').listeners.click();
assert.strictEqual(calls[0].action, 'customers');
assert.strictEqual(node('bootstrap-project-name').focused, true);
assert.strictEqual(node('pairing-entry').style.display, 'none');
assert.strictEqual(node('model-binding-actions').style.display, 'none');
assert.strictEqual(node('project-bootstrap-form').style.display, '');

node('btn-bootstrap-cancel').listeners.click();
assert.strictEqual(node('pairing-entry').style.display, '');
assert.strictEqual(node('model-binding-actions').style.display, '');
assert.strictEqual(node('project-bootstrap-form').style.display, 'none');

node('btn-bootstrap-project').listeners.click();
context.window.GraneteCommercialBootstrap.receiveCustomers({ ok: true, entries: [{ id: 'c-1', name: 'Ana' }] });
assert.strictEqual(node('bootstrap-customer-select').children[1].textContent, 'Ana');
node('bootstrap-project-name').value = 'Cocina Ana';
node('bootstrap-design-name').value = 'Diseño principal';
node('bootstrap-customer-select').value = 'c-1';
node('project-bootstrap-form').listeners.submit({ preventDefault() {} });
node('project-bootstrap-form').listeners.submit({ preventDefault() {} });
assert.strictEqual(calls.filter((call) => call.action === 'bootstrap').length, 1);
assert.deepStrictEqual(calls.find((call) => call.action === 'bootstrap').payload, {
  projectName: 'Cocina Ana', designName: 'Diseño principal', customerMode: 'existing', customerId: 'c-1'
});
assert.strictEqual(node('project-bootstrap-form')['aria-busy'], 'true');
context.window.GraneteCommercialBootstrap.receiveBootstrap({ ok: false, reason: 'falló' });
assert.strictEqual(node('bootstrap-status').textContent, 'falló');
assert.strictEqual(node('project-bootstrap-form')['aria-busy'], 'false');
assert.strictEqual(node('btn-bootstrap-submit').disabled, false);
assert.strictEqual(node('pairing-entry').style.display, 'none');
assert.strictEqual(node('model-binding-actions').style.display, 'none');
assert.strictEqual(node('project-bootstrap-form').style.display, '');

node('btn-bootstrap-cancel').listeners.click();
assert.strictEqual(node('pairing-entry').style.display, '');
assert.strictEqual(node('model-binding-actions').style.display, '');
assert.strictEqual(node('project-bootstrap-form').style.display, 'none');

console.log(JSON.stringify({ success: true, testsPassed: 26 }));
