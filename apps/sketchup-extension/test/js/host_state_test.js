// Real JavaScript harness for the #498 shared dialog state store
// (granete-state.js): slice semantics, subscription notifications, update
// merging and module idempotence under re-execution (dialog reopen
// safety). Runs the actual module file in a vm sandbox — no SketchUp, no
// full dialog HTML.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-state.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function runModule(times = 1) {
  const sandbox = { console, Object, Math, Date, window: {} };
  vm.createContext(sandbox);
  for (let i = 0; i < times; i += 1) {
    vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  }
  return sandbox;
}

test('exposes the six shared slices with their initial shapes', () => {
  const { window } = runModule();
  const store = window.GraneteState;
  assert.strictEqual(JSON.stringify(store.SLICES), JSON.stringify(['session', 'catalog', 'selection', 'mutation', 'preflight', 'degraded']));
  assert.strictEqual(store.get('mutation').phase, 'idle');
  assert.strictEqual(store.get('degraded'), null);
});

test('set replaces a slice and notifies subscribers with the slice name', () => {
  const { window } = runModule();
  const store = window.GraneteState;
  const seen = [];
  store.subscribe((slice, value) => seen.push([slice, value]));
  store.set('degraded', 'offline_cached');
  assert.strictEqual(store.get('degraded'), 'offline_cached');
  assert.strictEqual(JSON.stringify(seen), JSON.stringify([['degraded', 'offline_cached']]));
});

test('update merges a patch and never mutates the previous slice object', () => {
  const { window } = runModule();
  const store = window.GraneteState;
  const before = store.get('mutation');
  store.update('mutation', { outcome: 'committed' });
  const after = store.get('mutation');
  assert.strictEqual(after.outcome, 'committed');
  assert.strictEqual(after.phase, 'idle');
  assert.notStrictEqual(before, after);
  assert.strictEqual(before.outcome, null);
});

test('unknown slices fail closed instead of inventing state', () => {
  const { window } = runModule();
  const store = window.GraneteState;
  assert.throws(() => store.set('isEditing', true), /unknown state slice/);
  assert.throws(() => store.update('isLoading', {}), /unknown state slice/);
});

test('unsubscribe stops further notifications', () => {
  const { window } = runModule();
  const store = window.GraneteState;
  let count = 0;
  const unsubscribe = store.subscribe(() => { count += 1; });
  store.set('session', { state: 'logged_in' });
  unsubscribe();
  store.set('session', { state: 'disabled' });
  assert.strictEqual(count, 1);
});

test('re-executing the module registers nothing twice (dialog reopen safety)', () => {
  const { window } = runModule(5);
  const store = window.GraneteState;
  let count = 0;
  store.subscribe(() => { count += 1; });
  store.set('selection', { kind: 'furniture' });
  assert.strictEqual(count, 1);
});

console.log(JSON.stringify({ success: true, testsPassed }));
