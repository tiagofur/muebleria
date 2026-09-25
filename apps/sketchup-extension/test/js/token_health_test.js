// Design-token health for the HtmlDialog surfaces: every var(--token) a
// stylesheet references must be defined in the same file (or carry an inline
// fallback). The panel's state signal depends on tokens resolving — a
// `var(--warning)` against an undefined token silently kills the amber border
// of "Guardá este archivo" and no copy test catches it (found in the 2026-09
// UX review: --warning/--border-subtle/.btn-sm/--font-mono were all dead).
//
// Static analysis over the HTML source: no vm sandbox needed.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const RESOURCES = path.resolve(__dirname, '../../src/granete_for_sketchup/resources');
const SURFACES = ['dialog.html', 'material_selector.html', 'migration_review.html', 'mount_frame_preparer.html'];
// #848: el CSS del panel vive en css/*.css — las definiciones del dialog son
// la unión de todos los archivos de estilos; los usos, dialog + css.
const DIALOG_CSS = ['theme.css', 'base.css', 'library.css', 'configurator.css', 'materials.css', 'inspector.css', 'project.css']
  .map((name) => ({ name, text: fs.readFileSync(path.join(RESOURCES, 'css', name), 'utf8') }));

function definedTokens(html) {
  const tokens = new Set();
  // Declarations appear as `--name: value` (root block or scoped rules).
  const declarationRe = /(--[a-z0-9-]+)\s*:/gi;
  let match;
  while ((match = declarationRe.exec(html)) !== null) {
    tokens.add(match[1]);
  }
  return tokens;
}

function usedTokensWithoutFallback(html) {
  const uses = new Map(); // token -> sample line
  // var(--name) without a fallback is the fail-silent case; var(--name, x)
  // degrades consciously and is allowed.
  const useRe = /var\((--[a-z0-9-]+)\s*(,|\))/gi;
  const lines = html.split('\n');
  lines.forEach((line, index) => {
    let m;
    const lineRe = /var\((--[a-z0-9-]+)\s*(,|\))/gi;
    while ((m = lineRe.exec(line)) !== null) {
      if (m[2] === ',') return; // fallback present on this use
      if (!uses.has(m[1])) uses.set(m[1], `${index + 1}: ${line.trim().slice(0, 90)}`);
    }
    void useRe;
  });
  return uses;
}

function run() {
  let checked = 0;
  SURFACES.forEach((surface) => {
    const isDialog = surface === 'dialog.html';
    const html = fs.readFileSync(path.join(RESOURCES, surface), 'utf8');
    // Definiciones: el propio archivo y — para el panel — todos los css.
    const defined = definedTokens(html);
    if (isDialog) {
      DIALOG_CSS.forEach((f) => {
        const extra = definedTokens(f.text);
        extra.forEach((t) => defined.add(t));
      });
    }
    // Usos: el propio archivo y — para el panel — todos los css.
    const uses = usedTokensWithoutFallback(html);
    if (isDialog) {
      DIALOG_CSS.forEach((f) => {
        usedTokensWithoutFallback(f.text).forEach((sample, token) => {
          if (!uses.has(token)) uses.set(token, `css/${f.name} ${sample}`);
        });
      });
    }
    uses.forEach((sample, token) => {
      checked += 1;
      assert(defined.has(token),
        `${surface}: var(${token}) no está definido (ni lleva fallback).\n  ${sample}`);
    });
  });

  // Regression anchors for the tokens the 2026-09 review found dead.
  const allDialogCss = DIALOG_CSS.map((f) => f.text).join('\n');
  const dialogTokens = definedTokens(allDialogCss);
  ['--warning', '--border-subtle', '--font-mono'].forEach((token) => {
    assert(dialogTokens.has(token), `el CSS del panel debe definir ${token} (señal de estado viva)`);
    checked += 1;
  });
  assert(/\.btn-sm\s*\{/.test(allDialogCss), 'el CSS del panel debe definir .btn-sm (se usa en el flujo de vinculación)');
  checked += 1;

  return checked;
}

try {
  const checked = run();
  process.stdout.write(JSON.stringify({ success: true, referencesChecked: checked }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, error: String(error && error.message || error) }));
  process.exit(1);
}
