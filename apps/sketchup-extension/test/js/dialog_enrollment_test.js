// #563 test harness for device enrollment in dialog.html:
// proves 5s poll interval, countdown display, copy button, web devices link,
// and resilient error handling (429 does not abort enrollment).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function createClassList(initial) {
  const classes = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  return {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
    _classes: classes
  };
}

function createMockElement(id) {
  const el = {
    id: id || '',
    children: [],
    disabled: false,
    value: '',
    listeners: {},
    _textContent: '',
    style: {},
    classList: createClassList('')
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(v) { el._textContent = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set(v) { el.children.length = 0; }
  });
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el.classList._classes).join(' '); },
    set(v) { el.classList = createClassList(v); }
  });
  el.addEventListener = (evt, cb) => {
    el.listeners[evt] = el.listeners[evt] || [];
    el.listeners[evt].push(cb);
  };
  el.dispatchEvent = (event) => {
    (el.listeners[event.type] || []).forEach((cb) => cb(event));
    return true;
  };
  el.click = () => {
    (el.listeners.click || []).forEach((cb) => cb({ preventDefault: () => {} }));
  };
  el.appendChild = (child) => { el.children.push(child); return child; };
  return el;
}

function buildSandbox() {
  const registry = {};
  const bridgeCalls = [];
  const intervals = [];
  const timeouts = [];

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    document: {
      getElementById: (id) => {
        if (!registry[id]) registry[id] = createMockElement(id);
        return registry[id];
      },
      createElement: (tag) => createMockElement(tag),
      body: createMockElement('body'),
      querySelectorAll: () => [],
      querySelector: () => {
        const q = createMockElement('q');
        q.getAttribute = () => null;
        return q;
      },
      addEventListener: () => {}
    },
    navigator: {
      clipboard: {
        writeText: (text) => {
          sandbox.__lastCopied = text;
          return Promise.resolve();
        }
      }
    },
    window: {
      open: (url) => { sandbox.__lastWindowOpen = url; },
      sketchup: {
        dialog_ready: () => bridgeCalls.push(['dialog_ready']),
        enroll: (payload) => bridgeCalls.push(['enroll', payload]),
        poll_enrollment: (payload) => bridgeCalls.push(['poll_enrollment', payload]),
        open_external_url: (payload) => bridgeCalls.push(['open_external_url', payload]),
        logout: () => bridgeCalls.push(['logout'])
      }
    },
    setInterval: (cb, ms) => {
      const id = intervals.length + 1;
      intervals.push({ id, cb, ms });
      return id;
    },
    clearInterval: (id) => {
      const idx = intervals.findIndex(i => i.id === id);
      if (idx !== -1) intervals.splice(idx, 1);
    },
    setTimeout: (cb, ms) => {
      const id = timeouts.length + 1;
      timeouts.push({ id, cb, ms });
      return id;
    },
    clearTimeout: (id) => {
      const idx = timeouts.findIndex(t => t.id === id);
      if (idx !== -1) timeouts.splice(idx, 1);
    }
  };

  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  sandbox.__intervals = intervals;
  return sandbox;
}

function runDialog() {
  const htmlPath = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/dialog.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'dialog.html must contain script');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

let passed = 0;

function runTests() {
  // Test 1: onEnrollResult renders code, switches views, sets 5s interval and starts countdown
  {
    const sb = runDialog();
    const futureDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    sb.window.GraneteDialog.onEnrollResult({
      success: true,
      id: 'enr-1',
      code: 'K7M2QP',
      expires_at: futureDate
    });

    assert.strictEqual(el(sb, 'enroll-code-display').textContent, 'K7M2QP');
    assert.strictEqual(el(sb, 'enroll-code-area').style.display, 'block');
    assert.strictEqual(el(sb, 'login-form-area').style.display, 'none');

    // Interval must be 5000ms (#563)
    const pollInterval = sb.__intervals.find(i => i.ms === 5000);
    assert.ok(pollInterval, 'polling interval must be 5000ms');

    // Countdown interval must be 1000ms
    const cdInterval = sb.__intervals.find(i => i.ms === 1000);
    assert.ok(cdInterval, 'countdown interval must be 1000ms');
    assert.match(el(sb, 'enroll-countdown-display').textContent, /^\d{2}:\d{2}$/);
    passed++;
  }

  // Test 2: Copy button copies code to clipboard
  {
    const sb = runDialog();
    sb.window.GraneteDialog.onEnrollResult({
      success: true,
      id: 'enr-1',
      code: 'ABC123',
      expires_at: new Date(Date.now() + 60000).toISOString()
    });

    el(sb, 'btn-copy-enroll-code').click();
    assert.strictEqual(sb.__lastCopied, 'ABC123');
    passed++;
  }

  // Test 3: Open web devices button parses server URL and calls bridge
  {
    const sb = runDialog();
    el(sb, 'login-server').value = 'https://taller.granete.com/api/';
    el(sb, 'btn-open-web-devices').click();

    const openCall = sb.__bridge.find(c => c[0] === 'open_external_url');
    assert.ok(openCall, 'must invoke open_external_url on bridge');
    const parsed = JSON.parse(openCall[1]);
    assert.strictEqual(parsed.url, 'https://taller.granete.com/devices');
    passed++;
  }

  // Test 4: Open web devices button handles server URL without /api
  {
    const sb = runDialog();
    el(sb, 'login-server').value = 'http://localhost:5173';
    el(sb, 'btn-open-web-devices').click();

    const openCall = sb.__bridge.find(c => c[0] === 'open_external_url');
    const parsed = JSON.parse(openCall[1]);
    assert.strictEqual(parsed.url, 'http://localhost:5173/devices');
    passed++;
  }

  // Test 5: Resilient polling: 429 does NOT abort the enrollment flow
  {
    const sb = runDialog();
    sb.window.GraneteDialog.onEnrollResult({
      success: true,
      id: 'enr-1',
      code: 'XYZ999',
      expires_at: new Date(Date.now() + 60000).toISOString()
    });

    // Simulate 429 response during poll
    sb.window.GraneteDialog.onPollResult({
      success: false,
      http_status: 429,
      error: 'Error al consultar estado (429).'
    });

    // Must NOT hide code area or restore login area
    assert.strictEqual(el(sb, 'enroll-code-area').style.display, 'block');
    assert.strictEqual(el(sb, 'login-form-area').style.display, 'none');
    // Must update status text gracefully
    assert.match(el(sb, 'enroll-status-text').textContent, /429|ocupado/i);

    // Poll interval must still be alive!
    const pollInterval = sb.__intervals.find(i => i.ms === 5000);
    assert.ok(pollInterval, 'polling interval must stay active on 429');
    passed++;
  }

  // Test 6: Rejection or expiration clears timers and closes code area
  {
    const sb = runDialog();
    sb.window.GraneteDialog.onEnrollResult({
      success: true,
      id: 'enr-1',
      code: 'XYZ999',
      expires_at: new Date(Date.now() + 60000).toISOString()
    });

    sb.window.GraneteDialog.onPollResult({
      success: true,
      status: 'rejected'
    });

    assert.strictEqual(el(sb, 'enroll-code-area').style.display, 'none');
    assert.strictEqual(el(sb, 'login-form-area').style.display, 'block');
    const pollInterval = sb.__intervals.find(i => i.ms === 5000);
    assert.strictEqual(pollInterval, undefined, 'polling interval must be cleared on reject');
    passed++;
  }

  // Test 7: Cancel button clears timers and restores login area
  {
    const sb = runDialog();
    sb.window.GraneteDialog.onEnrollResult({
      success: true,
      id: 'enr-1',
      code: 'XYZ999',
      expires_at: new Date(Date.now() + 60000).toISOString()
    });

    el(sb, 'btn-cancel-enroll').click();
    assert.strictEqual(el(sb, 'enroll-code-area').style.display, 'none');
    assert.strictEqual(el(sb, 'login-form-area').style.display, 'block');
    assert.strictEqual(sb.__intervals.length, 0, 'all intervals must be cleared on cancel');
    passed++;
  }

  console.log(JSON.stringify({ success: true, testsPassed: passed }));
}

runTests();
