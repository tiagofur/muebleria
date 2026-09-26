// #848 Phase B — real JavaScript harness for granete-media.js: the catalog
// media module under window.GraneteUI. Drives the actual module file in a vm
// sandbox (mock DOM + recording sketchup bridge, fake clock for the retry
// window) and proves the ownership contract: single media authority, signed
// URL resolution, refresh request/throttle, DOM grant reapplication and
// stale-authority reset. #460 SEC-3 semantics stay put — no credentials in
// the webview, only short-lived per-file grants.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const MODULE_PATH = path.resolve(__dirname, '../../src/granete_for_sketchup/resources/js/granete-media.js');
const SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

const FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
const FILE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg';
const PATH_A = '/api/media/' + FILE_A;
const PATH_B = '/api/media/' + FILE_B;
const SIGNED_A = 'https://cdn.test/grant-a?exp=1';
const SIGNED_A2 = 'https://cdn.test/grant-a?exp=2';

let testsPassed = 0;
function test(name, fn) {
  fn();
  testsPassed += 1;
}

function mockMediaNode(name, tag) {
  return {
    tagName: tag,
    style: tag === 'IMG' ? { display: 'none' } : {},
    attrs: { 'data-media-name': name, src: '' },
    nextElementSibling: { style: { display: 'flex' } },
    getAttribute(k) { return this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); }
  };
}

// Fresh sandbox per test: recording refresh bridge, mock DOM tree, fake
// clock. The module reads bare `sketchup`, `document` and `Date.now()` the
// way the HtmlDialog globals behave.
function runModule(nodeList) {
  const refreshCalls = [];
  let fakeNow = 1_000_000;
  const sandbox = {
    Date: { now: () => fakeNow },
    sketchup: {
      refresh_media_url: (filename) => {
        if (sandbox.__refreshThrows) throw new Error('bridge down');
        refreshCalls.push(filename);
      }
    },
    document: { querySelectorAll: () => nodeList || [] },
    window: {}
  };
  sandbox.__advance = (ms) => { fakeNow += ms; };
  sandbox.__refreshCalls = refreshCalls;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  return sandbox;
}

test('registers window.GraneteUI.media with the expected public API', () => {
  const { window } = runModule();
  const media = window.GraneteUI.media;
  assert(media, 'window.GraneteUI.media must exist');
  ['filenameFromPath', 'resolveUrl', 'requestRefresh', 'updateSignedUrl', 'setCatalogMedia']
    .forEach((key) => assert.strictEqual(typeof media[key], 'function', key));
});

test('re-execution is idempotent — one registration, same authority', () => {
  const sandbox = runModule();
  const first = sandbox.window.GraneteUI.media;
  vm.runInContext(SOURCE, sandbox, { filename: MODULE_PATH });
  assert.strictEqual(sandbox.window.GraneteUI.media, first,
    'dialog reopen safety: the module never registers a second authority');
});

test('filenameFromPath keeps the canonical #460 SEC-3 filename contract', () => {
  const { window } = runModule();
  const media = window.GraneteUI.media;
  assert.strictEqual(media.filenameFromPath(PATH_A), FILE_A);
  assert.strictEqual(media.filenameFromPath('https://cdn.test/x.png'), null);
  assert.strictEqual(media.filenameFromPath(''), null);
  assert.strictEqual(media.filenameFromPath(null), null);
});

test('an existing signed grant resolves without any bridge call', () => {
  const { window, __refreshCalls } = runModule();
  window.GraneteUI.media.setCatalogMedia({ baseUrl: '', urls: { [FILE_A]: SIGNED_A } });
  assert.strictEqual(window.GraneteUI.media.resolveUrl(PATH_A), SIGNED_A);
  assert.strictEqual(__refreshCalls.length, 0, 'signed media never asks Ruby to re-mint');
});

test('non-media and absolute URLs pass through untouched', () => {
  const { window, __refreshCalls } = runModule();
  const media = window.GraneteUI.media;
  assert.strictEqual(media.resolveUrl(''), '');
  assert.strictEqual(media.resolveUrl(null), null);
  assert.strictEqual(media.resolveUrl(42), 42);
  assert.strictEqual(media.resolveUrl('https://cdn.granete.com/p.png'), 'https://cdn.granete.com/p.png');
  assert.strictEqual(media.resolveUrl('data:image/svg+xml;base64,AAA'), 'data:image/svg+xml;base64,AAA');
  assert.strictEqual(media.resolveUrl('/api/other/thing.png'), '/api/other/thing.png');
  assert.strictEqual(__refreshCalls.length, 0);
});

test('missing media asks Ruby to refresh and renders empty meanwhile', () => {
  const { window, __refreshCalls } = runModule();
  assert.strictEqual(window.GraneteUI.media.resolveUrl(PATH_B), '',
    'callers receive "" so the placeholder covers the pending image');
  assert.deepStrictEqual(__refreshCalls, [FILE_B]);
});

test('the retry window throttles re-mints and reopens after 5s', () => {
  const { window, __refreshCalls, __advance } = runModule();
  const media = window.GraneteUI.media;
  media.requestRefresh(FILE_A);
  media.requestRefresh(FILE_A);
  media.requestRefresh(FILE_A);
  assert.deepStrictEqual(__refreshCalls, [FILE_A], 'no hammering Ruby inside the window');
  __advance(4999);
  media.requestRefresh(FILE_A);
  assert.deepStrictEqual(__refreshCalls, [FILE_A], 'still throttled before MEDIA_REFRESH_RETRY_MS');
  __advance(2);
  media.requestRefresh(FILE_A);
  assert.deepStrictEqual(__refreshCalls, [FILE_A, FILE_A], 'the window reopens after the retry period');
});

test('a failed mint releases the flag so failure never blocks refresh forever', () => {
  const sandbox = runModule();
  sandbox.__refreshThrows = true;
  sandbox.window.GraneteUI.media.requestRefresh(FILE_A);
  sandbox.__refreshThrows = false;
  sandbox.window.GraneteUI.media.requestRefresh(FILE_A);
  assert.deepStrictEqual(sandbox.__refreshCalls, [FILE_A],
    'the caught bridge error clears the pending flag → immediate retry is allowed');
});

test('a received grant is stored and re-applied to the tagged DOM', () => {
  const img = mockMediaNode(FILE_A, 'IMG');
  const swatch = mockMediaNode(FILE_B, 'DIV');
  const { window } = runModule([img, swatch]);
  const media = window.GraneteUI.media;

  media.updateSignedUrl(FILE_A, SIGNED_A);
  assert.strictEqual(img.attrs.src, SIGNED_A, 'the <img> src is repainted');
  assert.strictEqual(img.style.display, '', 'a grant landing after the placeholder reveals the <img>');
  assert.strictEqual(img.nextElementSibling.style.display, 'none', 'and hides the placeholder');
  assert.strictEqual(swatch.attrs.src, '', 'untagged-for-grant nodes stay untouched');
  assert.strictEqual(swatch.style.backgroundImage, undefined);

  media.updateSignedUrl(FILE_B, 'https://cdn.test/grant-b?exp=1');
  assert.strictEqual(swatch.style.backgroundImage, 'url(\'https://cdn.test/grant-b?exp=1\')',
    'swatches repaint through backgroundImage');
});

test('a grant clears the pending throttle so the next miss re-mints at once', () => {
  const { window, __refreshCalls } = runModule();
  const media = window.GraneteUI.media;
  media.resolveUrl(PATH_A);
  assert.deepStrictEqual(__refreshCalls, [FILE_A]);
  media.updateSignedUrl(FILE_A, SIGNED_A);
  media.setCatalogMedia(null); // catalog reset drops the grant again
  media.resolveUrl(PATH_A);
  assert.deepStrictEqual(__refreshCalls, [FILE_A, FILE_A],
    'updateSignedUrl released the pending flag — no 5s dead window after a mint');
});

test('catalog reset/change never keeps stale authority', () => {
  const { window } = runModule();
  const media = window.GraneteUI.media;
  media.setCatalogMedia({ baseUrl: '', urls: { [FILE_A]: SIGNED_A } });
  assert.strictEqual(media.resolveUrl(PATH_A), SIGNED_A);

  media.setCatalogMedia(null);
  assert.strictEqual(media.resolveUrl(PATH_A), '', 'reset → placeholder + refresh, never the old grant');

  media.setCatalogMedia({ baseUrl: '', urls: {} });
  assert.strictEqual(media.resolveUrl(PATH_A), '', 'new payload without grants → placeholder + refresh');

  media.setCatalogMedia(undefined);
  assert.strictEqual(media.resolveUrl(PATH_A), '', 'absent media field normalizes to no authority');
});

test('a re-minted grant replaces the previous URL (no first-grant stickiness)', () => {
  const { window } = runModule();
  const media = window.GraneteUI.media;
  media.setCatalogMedia({ baseUrl: '', urls: { [FILE_A]: SIGNED_A } });
  media.updateSignedUrl(FILE_A, SIGNED_A2);
  assert.strictEqual(media.resolveUrl(PATH_A), SIGNED_A2);
});

console.log(JSON.stringify({ success: true, testsPassed, module: 'granete-media.js' }));
