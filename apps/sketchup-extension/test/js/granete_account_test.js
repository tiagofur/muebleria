// #848 Phase B — real JavaScript harness for granete-account.js: the
// account/session/device-enrollment module under window.GraneteUI. Drives
// the actual module file in a vm sandbox (mock DOM with captured document
// listeners, recording sketchup bridge, manual interval queue) and proves
// the EXISTING behavior: popover open/close/focus (logged-in and out),
// Esc/outside-click dismissal, enrollment start, 5s polling, 429
// resilience, reject/expiry/cancel cleanup, countdown expiry, logout,
// web-devices URL derivation and code copy (clipboard + fallback).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-account.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function createMockElement(id, sandbox) {
  const classes = new Set();
  const listeners = {};
  const el = {
    id: id || '',
    tagName: 'DIV',
    children: [],
    disabled: false,
    value: '',
    listeners,
    _textContent: '',
    _innerHTML: '',
    style: {},
    parentNode: null,
    attrs: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    get className() {
      return Array.from(classes).join(' ');
    },
    set className(v) {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    addEventListener: (evt, cb) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(cb);
    },
    dispatchEvent: (event) => {
      (listeners[event.type] || []).forEach((cb) => cb(event));
      return true;
    },
    click: () => {
      (listeners.click || []).forEach((cb) => cb({ preventDefault: () => {} }));
    },
    focus: () => { sandbox.__focusLog.push(el.id); },
    select: () => {},
    appendChild: (child) => { el.children.push(child); return child; },
    removeChild: (child) => {
      const i = el.children.indexOf(child);
      if (i !== -1) el.children.splice(i, 1);
    }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._textContent; },
    set(v) { el._textContent = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) { el._innerHTML = String(v); el.children.length = 0; }
  });
  return el;
}

// Fresh sandbox per test: registry DOM, captured document listeners,
// recording bridge, manual interval/timeout queues. The module is loaded
// exactly as dialog.html loads it, then the bootstrap-level dependency
// injection (init) is replayed with recording helpers.
function runModule(withNavigator) {
  const registry = {};
  const bridgeCalls = [];
  const intervals = [];
  const timeouts = [];
  const toasts = [];
  const docListeners = {};
  const focusLog = [];
  let invalidatedSession = 0;

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    isNaN,
    document: {
      getElementById: (id) => (registry[id] = registry[id] || createMockElement(id, sandbox)),
      createElement: (tag) => createMockElement(tag, sandbox),
      body: null,
      addEventListener: (evt, cb) => {
        (docListeners[evt] = docListeners[evt] || []).push(cb);
      },
      execCommand: () => {
        sandbox.__execCommands = (sandbox.__execCommands || 0) + 1;
        return true;
      }
    },
    navigator: {},
    window: {
      open: (url) => bridgeCalls.push(['window_open', url]),
      sketchup: {
        enroll: (payload) => bridgeCalls.push(['enroll', payload]),
        poll_enrollment: (payload) => bridgeCalls.push(['poll_enrollment', payload]),
        logout: () => bridgeCalls.push(['logout']),
        open_external_url: (payload) => bridgeCalls.push(['open_external_url', payload]),
        get_model_binding: () => bridgeCalls.push(['get_model_binding'])
      }
    },
    setInterval: (cb, ms) => {
      const id = intervals.length + 1;
      intervals.push({ id, cb, ms, cleared: false });
      return id;
    },
    clearInterval: (id) => {
      const iv = intervals.find((i) => i.id === id);
      if (iv) iv.cleared = true;
    },
    setTimeout: (cb, ms) => {
      const id = timeouts.length + 1;
      timeouts.push({ id, cb, ms });
      return id;
    },
    clearTimeout: () => {}
  };
  sandbox.document.body = createMockElement('body', sandbox);
  if (withNavigator !== false) {
    sandbox.navigator = {
      clipboard: {
        // Synchronous thenable: the .then(setCopiedUI) chain runs inline so
        // the harness stays deterministic without a real microtask pump.
        writeText: (text) => {
          sandbox.__lastCopied = text;
          return {
            then: (cb) => { cb(); return { catch: () => {} }; },
            catch: () => {}
          };
        }
      }
    };
  }
  // The commercial projection runtime loads later in the real dialog; the
  // module only touches it lazily at onLoginResult time.
  sandbox.window.GraneteCommercialProjection = {
    invalidateSession: () => { invalidatedSession += 1; }
  };

  sandbox.__registry = registry;
  sandbox.__bridge = bridgeCalls;
  sandbox.__intervals = intervals;
  sandbox.__timeouts = timeouts;
  sandbox.__toasts = toasts;
  sandbox.__docListeners = docListeners;
  sandbox.__focusLog = focusLog;
  sandbox.__invalidatedSession = () => invalidatedSession;

  vm.createContext(sandbox);
  // The markup ships the popover hidden.
  sandbox.document.getElementById('account-popover').style.display = 'none';
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  sandbox.window.GraneteUI.account.init({
    showToast: (type, message) => toasts.push([type, message]),
    icon: (name, size) => '<svg data-icon="' + name + '" size="' + size + '"></svg>'
  });
  return sandbox;
}

function el(sandbox, id) {
  return sandbox.__registry[id];
}

function visible(elm) {
  return elm.style.display !== 'none';
}

function liveIntervals(sandbox) {
  return sandbox.__intervals.filter((i) => !i.cleared);
}

function enrollSuccess(sandbox, overrides) {
  sandbox.window.GraneteUI.account.onEnrollResult(Object.assign({
    success: true,
    id: 'enr-1',
    code: 'K7M2QP',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }, overrides || {}));
}

function dispatchKey(sandbox, key) {
  (sandbox.__docListeners.keydown || []).forEach((cb) => cb({ key }));
}

function dispatchCaptureClick(sandbox, target) {
  (sandbox.__docListeners.click || []).forEach((cb) => cb({ target }));
}

// --- module registration & public API ---

test('registers window.GraneteUI.account with the expected public API', () => {
  const { window } = runModule();
  const account = window.GraneteUI.account;
  assert(account, 'window.GraneteUI.account must exist');
  ['init', 'open', 'close', 'setStatus', 'onEnrollResult', 'onPollResult',
    'onLoginResult', 'startEnrollCountdown', 'clearEnrollmentTimers']
    .forEach((key) => assert.strictEqual(typeof account[key], 'function', key));
});

test('re-execution is idempotent — one registration, same authority', () => {
  const sandbox = runModule();
  const first = sandbox.window.GraneteUI.account;
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert.strictEqual(sandbox.window.GraneteUI.account, first,
    'dialog reopen safety: the module never registers a second authority');
});

// --- popover interaction ---

test('pill click opens the popover and announces it on the pill', () => {
  const sb = runModule();
  el(sb, 'connection-pill').click();
  assert(visible(el(sb, 'account-popover')), 'popover opens');
  assert.strictEqual(el(sb, 'connection-pill').getAttribute('aria-expanded'), 'true');
});

test('a second pill click closes the popover and restores focus to the pill', () => {
  const sb = runModule();
  el(sb, 'connection-pill').click();
  sb.__focusLog.length = 0;
  el(sb, 'connection-pill').click();
  assert(!visible(el(sb, 'account-popover')), 'popover closes');
  assert.strictEqual(el(sb, 'connection-pill').getAttribute('aria-expanded'), 'false');
  assert.strictEqual(sb.__focusLog[sb.__focusLog.length - 1], 'connection-pill',
    'focus returns to the pill on close');
});

test('open()/close() public API drives the same popover state', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.open();
  assert(visible(el(sb, 'account-popover')));
  sb.window.GraneteUI.account.close();
  assert(!visible(el(sb, 'account-popover')));
});

test('without a session the popover focuses the server field', () => {
  const sb = runModule();
  sb.__focusLog.length = 0;
  sb.window.GraneteUI.account.open();
  assert.strictEqual(sb.__focusLog[sb.__focusLog.length - 1], 'login-server',
    'logged out: the main path is the server input');
});

test('with a session the popover focuses the visible logout action', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.setStatus({
    state: 'logged_in',
    user: { name: 'A', email: 'a@b' },
    server_url: 'https://x'
  });
  sb.__focusLog.length = 0;
  sb.window.GraneteUI.account.open();
  assert.strictEqual(sb.__focusLog[sb.__focusLog.length - 1], 'btn-logout',
    'logged in: focus the useful visible action, never a display:none control');
});

test('an outside click closes the popover; clicks inside do not', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.open();
  dispatchCaptureClick(sb, el(sb, 'account-popover'));
  assert(visible(el(sb, 'account-popover')), 'a click inside the popover keeps it open');
  dispatchCaptureClick(sb, el(sb, 'library-cards-grid'));
  assert(!visible(el(sb, 'account-popover')), 'a click outside closes it');
});

test('Escape closes the popover; other keys are ignored', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.open();
  dispatchKey(sb, 'Enter');
  assert(visible(el(sb, 'account-popover')), 'non-Escape keys do not close');
  dispatchKey(sb, 'Escape');
  assert(!visible(el(sb, 'account-popover')), 'Escape closes');
});

// --- session status rendering ---

test('setStatus renders pill, cards, user, server and an active license', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.setStatus({
    state: 'logged_in',
    heading: 'Todo bien',
    message: 'Sesión activa',
    server_url: 'https://taller.granete.com/api',
    user: { name: 'Ana', email: 'ana@taller.com' },
    license: { plan: 'pro', status: 'active', expires_at: '2026-12-31T00:00:00Z' }
  });
  assert.strictEqual(el(sb, 'connection-pill').textContent, 'Conectado');
  assert(el(sb, 'connection-pill').className.includes('valid'));
  assert(visible(el(sb, 'session-card')) && !visible(el(sb, 'login-card')));
  assert.strictEqual(el(sb, 'connection-heading').textContent, 'Todo bien');
  assert.strictEqual(el(sb, 'connection-detail').textContent, 'Sesión activa');
  assert.strictEqual(el(sb, 'session-user-name').textContent, 'Ana');
  assert.strictEqual(el(sb, 'session-user-email').textContent, 'ana@taller.com');
  assert.strictEqual(el(sb, 'session-server').textContent, 'https://taller.granete.com/api');
  assert.strictEqual(el(sb, 'session-license').textContent, 'Pro · vence 2026-12-31');
});

test('setStatus distinguishes configured / no-session pills and inactive licenses', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.setStatus({ state: 'configured', server_url: 'https://x' });
  assert.strictEqual(el(sb, 'connection-pill').textContent, 'Configurado');
  assert(el(sb, 'connection-pill').className.includes('pending'));
  assert.strictEqual(el(sb, 'login-server').value, 'https://x',
    'a status payload seeds the empty server field');

  sb.window.GraneteUI.account.setStatus({ state: 'disabled' });
  assert.strictEqual(el(sb, 'connection-pill').textContent, 'Sin sesión');
  assert(el(sb, 'connection-pill').className.includes('invalid'));

  sb.window.GraneteUI.account.setStatus({
    state: 'logged_in',
    license: { plan: 'trial', status: 'expired' }
  });
  assert.strictEqual(el(sb, 'session-license').textContent, 'Prueba · vencida');
  assert.strictEqual(el(sb, 'session-license').style.color, 'var(--danger-600)');
});

// --- enrollment lifecycle ---

test('login click without a server shows the error and never calls Ruby', () => {
  const sb = runModule();
  el(sb, 'btn-login').click();
  assert.deepStrictEqual(sb.__toasts, [['error', 'Completá el servidor.']]);
  assert(!sb.__bridge.some((c) => c[0] === 'enroll'));
});

test('login click starts enrollment with the server payload and disarms the button', () => {
  const sb = runModule();
  el(sb, 'login-server').value = 'https://taller.granete.com/api';
  el(sb, 'btn-login').click();
  const call = sb.__bridge.find((c) => c[0] === 'enroll');
  assert(call, 'enroll must reach the Ruby bridge');
  assert.deepStrictEqual(JSON.parse(call[1]), { serverUrl: 'https://taller.granete.com/api', displayName: '' });
  assert.strictEqual(el(sb, 'btn-login').disabled, true);
  assert.strictEqual(el(sb, 'btn-login').textContent, 'Conectando…');
});

test('without the host bridge the button recovers with an error toast', () => {
  const sb = runModule();
  delete sb.window.sketchup.enroll;
  el(sb, 'login-server').value = 'https://x';
  el(sb, 'btn-login').click();
  assert.strictEqual(el(sb, 'btn-login').disabled, false);
  assert.strictEqual(el(sb, 'btn-login').textContent, 'Generar código');
  assert(sb.__toasts.some((t) => t[0] === 'error' && /fuera de SketchUp/.test(t[1])));
});

test('a failed enrollment re-arms the button and surfaces the error', () => {
  const sb = runModule();
  el(sb, 'login-server').value = 'https://x';
  el(sb, 'btn-login').click();
  sb.window.GraneteUI.account.onEnrollResult({ success: false, error: 'Servidor rechazado' });
  assert.strictEqual(el(sb, 'btn-login').disabled, false);
  assert(sb.__toasts.some((t) => t[0] === 'error' && t[1] === 'Servidor rechazado'));
  assert.strictEqual(liveIntervals(sb).length, 0, 'no timers after a failed start');
});

test('enrollment success renders the code and owns both timers', () => {
  const sb = runModule();
  enrollSuccess(sb);
  assert.strictEqual(el(sb, 'enroll-code-display').textContent, 'K7M2QP');
  assert(visible(el(sb, 'enroll-code-area')) && !visible(el(sb, 'login-form-area')));
  assert(liveIntervals(sb).some((i) => i.ms === 5000), '5s poll interval (#563)');
  assert(liveIntervals(sb).some((i) => i.ms === 1000), '1s countdown interval');
  assert.match(el(sb, 'enroll-countdown-display').textContent, /^\d{2}:\d{2}$/);
});

test('the 5s poll tick forwards the current enrollment id to Ruby', () => {
  const sb = runModule();
  enrollSuccess(sb);
  const poll = liveIntervals(sb).find((i) => i.ms === 5000);
  poll.cb();
  poll.cb();
  const calls = sb.__bridge.filter((c) => c[0] === 'poll_enrollment');
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(JSON.parse(calls[0][1]), { enrollmentId: 'enr-1' });
});

test('a 429 poll response keeps the enrollment alive and says so', () => {
  const sb = runModule();
  enrollSuccess(sb);
  sb.window.GraneteUI.account.onPollResult({
    success: false,
    http_status: 429,
    error: 'Error al consultar estado (429).'
  });
  assert(visible(el(sb, 'enroll-code-area')), '429 must NOT abort the enrollment flow');
  assert(liveIntervals(sb).some((i) => i.ms === 5000), 'polling stays active on 429');
  assert.match(el(sb, 'enroll-status-text').textContent, /Servidor ocupado/);
});

test('a transient poll error retries with muted status', () => {
  const sb = runModule();
  enrollSuccess(sb);
  sb.window.GraneteUI.account.onPollResult({ success: false, error: 'boom' });
  assert(visible(el(sb, 'enroll-code-area')));
  assert.match(el(sb, 'enroll-status-text').textContent, /Reintentando/);
});

test('a pending poll keeps the waiting copy', () => {
  const sb = runModule();
  enrollSuccess(sb);
  sb.window.GraneteUI.account.onPollResult({ success: true, status: 'pending' });
  assert.strictEqual(el(sb, 'enroll-status-text').textContent, 'Esperando aprobación en la web...');
});

test('a rejected or expired enrollment clears timers and restores the form', () => {
  const sb = runModule();
  enrollSuccess(sb);
  sb.window.GraneteUI.account.onPollResult({ success: true, status: 'rejected' });
  assert(visible(el(sb, 'login-form-area')) && !visible(el(sb, 'enroll-code-area')));
  assert.strictEqual(liveIntervals(sb).length, 0, 'reject clears every timer');
  assert(sb.__toasts.some((t) => t[0] === 'error' && /rechazada/.test(t[1])));

  enrollSuccess(sb);
  sb.window.GraneteUI.account.onPollResult({ success: true, status: 'expired' });
  assert(visible(el(sb, 'login-form-area')));
  assert.strictEqual(liveIntervals(sb).length, 0, 'expiry clears every timer');
});

test('countdown expiry asks for a new code and clears every timer on its tick', () => {
  const sb = runModule();
  enrollSuccess(sb, { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.strictEqual(el(sb, 'enroll-countdown-display').textContent, '00:00');
  assert.strictEqual(el(sb, 'enroll-status-text').textContent, 'El código expiró. Generá uno nuevo.');
  assert.strictEqual(el(sb, 'enroll-status-text').style.color, 'var(--danger-600)');
  // Preserved quirk: the poll interval is armed after startEnrollCountdown,
  // so the expiry cleanup lands on the NEXT 1s countdown tick.
  const countdown = liveIntervals(sb).find((i) => i.ms === 1000);
  countdown.cb();
  assert.strictEqual(liveIntervals(sb).length, 0, 'an expired code leaves no timers behind');
});

test('cancel clears state and timers and restores the login form', () => {
  const sb = runModule();
  enrollSuccess(sb);
  el(sb, 'btn-cancel-enroll').click();
  assert(visible(el(sb, 'login-form-area')) && !visible(el(sb, 'enroll-code-area')));
  assert.strictEqual(liveIntervals(sb).length, 0, 'cancel leaves no timers');
  // The dead enrollment no longer polls Ruby.
  const pollBefore = sb.__bridge.filter((c) => c[0] === 'poll_enrollment').length;
  sb.__intervals.forEach((i) => i.cb());
  assert.strictEqual(sb.__bridge.filter((c) => c[0] === 'poll_enrollment').length, pollBefore,
    'a cancelled enrollment id never reaches the bridge again');
});

// --- login result / logout ---

test('a logout result clears enrollment and skips model binding', () => {
  const sb = runModule();
  enrollSuccess(sb);
  sb.window.GraneteUI.account.onLoginResult({ success: true, loggedOut: true });
  assert(visible(el(sb, 'login-form-area')) && !visible(el(sb, 'enroll-code-area')));
  assert.strictEqual(liveIntervals(sb).length, 0);
  assert(!sb.__bridge.some((c) => c[0] === 'get_model_binding'),
    'logout must not re-ask for the model binding');
  assert(sb.__toasts.some((t) => t[0] === 'success' && t[1] === 'Sesión cerrada.'));
});

test('a successful enrollment exchange invalidates projection cache and rebinds', () => {
  const sb = runModule();
  sb.window.GraneteUI.account.onLoginResult({ success: true });
  assert.strictEqual(sb.__invalidatedSession(), 1,
    'commercial projection cache is invalidated once per login result');
  assert(sb.__bridge.some((c) => c[0] === 'get_model_binding'),
    'a fresh pairing re-asks for the model binding');
});

test('logout click only calls the Ruby logout bridge', () => {
  const sb = runModule();
  el(sb, 'btn-logout').click();
  assert(sb.__bridge.some((c) => c[0] === 'logout'));
  assert.strictEqual(sb.__bridge.filter((c) => c[0] === 'logout').length, 1);
});

// --- open web devices & copy ---

test('open web devices derives the URL stripping /api and trailing slashes', () => {
  const sb = runModule();
  el(sb, 'login-server').value = 'https://taller.granete.com/api/';
  el(sb, 'btn-open-web-devices').click();
  let call = sb.__bridge.find((c) => c[0] === 'open_external_url');
  assert.strictEqual(JSON.parse(call[1]).url, 'https://taller.granete.com/devices');

  el(sb, 'login-server').value = 'http://localhost:5173';
  el(sb, 'btn-open-web-devices').click();
  call = sb.__bridge.find((c) => c[1] && JSON.parse(c[1]).url === 'http://localhost:5173/devices');
  assert(call, 'servers without /api keep their origin');
});

test('copy propagates the code through the clipboard with icon feedback', () => {
  const sb = runModule();
  enrollSuccess(sb, { code: 'ABC123' });
  el(sb, 'btn-copy-enroll-code').click();
  assert.strictEqual(sb.__lastCopied, 'ABC123');
  assert.strictEqual(el(sb, 'copy-enroll-code-text').textContent, '¡Copiado!');
  assert.match(el(sb, 'copy-enroll-code-icon').innerHTML, /data-icon="check"/);
  assert(sb.__toasts.some((t) => t[0] === 'success' && /ABC123/.test(t[1])));
  sb.__timeouts.splice(0).forEach((t) => t.cb());
  assert.strictEqual(el(sb, 'copy-enroll-code-text').textContent, 'Copiar');
  assert.match(el(sb, 'copy-enroll-code-icon').innerHTML, /data-icon="copy"/);
});

test('copy falls back to the textarea path when the clipboard API is absent', () => {
  const sb = runModule(false);
  enrollSuccess(sb, { code: 'FALLBK' });
  el(sb, 'btn-copy-enroll-code').click();
  assert.strictEqual(sb.__execCommands, 1, 'fallbackCopy drives document.execCommand');
  assert.strictEqual(el(sb, 'copy-enroll-code-text').textContent, '¡Copiado!');
});

test('copy ignores the placeholder code', () => {
  const sb = runModule();
  el(sb, 'btn-copy-enroll-code').click();
  assert.strictEqual(sb.__lastCopied, undefined, '"--" never reaches the clipboard');
});

(async () => {
  console.log(JSON.stringify({ success: true, testsPassed, module: 'granete-account.js' }));
})().catch((err) => {
  console.log(JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
