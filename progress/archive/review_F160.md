# Review — feature F160 (round 2) / GitHub #345

**Veredicto:** APPROVED

Candidate reviewed exactly as `origin/codex/345-sketchup-extension-bootstrap`
(PR #365) after the round-1 corrections, the brand rename to **Granete**, and
the in-host smoke findings. Round 1 (`progress/review_F160_round1.md`) was
CHANGES_REQUESTED; all eight changes requested there are implemented and
verified.

## Round-1 changes required — status

1. ✅ Sync + collision-free id F160; ledger/evidence/history reconciled
   (`feature_list.json` F160, `progress/implementation_F160.md`,
   `progress/current.md`).
2. ✅ Target narrowed to SketchUp 2026.2 macOS as the only target — and then
   **actually tested in-host**: TestUp CI 2.5.4, 7 tests / 27 assertions,
   0 failures / 0 errors / 0 skips, installed-RBZ binding, process exit 0.
3. ✅ Real lifecycle: `AppLifecycleObserver < Sketchup::AppObserver`
   registered by `Runtime.start`; `onUnloadExtension` drives shutdown
   (proven in-host); uncheck ≠ unload documented in README.
4. ✅ TestUp tests the installed extension and fails closed
   (`source_location` of the loaded `Runtime`, Plugins-path assertion,
   checkout rejection).
5. ✅ Redaction leaks fixed (`/Volumes/…`, non-`Users` drive roots, UNC,
   spaces) and over-redaction fixed (min substitution length 4, literal
   matching); URLs/query credentials; adversarial tests in
   `test/unit/logging_test.rb`.
6. ✅ Mutation-resistant guards: word-boundary forbidden terms (incl.
   `part/parts`, `postprocessing`, release/stale), all require/load/gem
   forms, packaged-`main.rb` wiring test (`test/unit/wiring_test.rb`).
7. ✅ Dialog coherence (heading+message+state injected together, neutral
   default, tokenized colors); host render proven by the in-host dialog
   open/close/recreate pass on CEF 137.
8. ✅ Delivery chained in work units; CI matrix ubuntu/macOS/Windows green on
   PR #365 (6/6 jobs on the pre-smoke push).

## In-host findings (found by the smoke, fixed, re-verified)

1. `include Sketchup::AppObserver` raised `TypeError` at load (host API
   declares a class) — fixed by subclassing; the unit stub now models a
   class. Local gates alone could not catch this: the stub had diverged from
   the host.
2. `Sketchup::Console#puts` is private and TestUp swaps `$stdout` around
   tests — `SafeLogger` now writes via `IO#write` with `Kernel.puts`
   fallback.
3. Empty groups are purged by model transactions ("reference to deleted
   Entity") — smoke fixture now carries geometry; recorded for #346.
4. `Sketchup.find_support_file` unreliable for the user Plugins folder;
   `CEF_VERSION` is a String in-host — both handled in the suite.

## Verification executed by reviewer

| Command / probe | Result |
|---|---|
| `bundle exec rake verify` (final tree) | PASS — 25 files lint 0 offenses; 25 unit runs/115 assertions; 3 boundary runs/421 assertions; RBZ deterministic SHA-256 `9b392da4b76eddf73278bb143c0ffdc98f170509eba914eea0fbbb3130be3f59` |
| `./init.sh` (real exit code, full log) | exit 0 — typecheck 7 workspaces; 3,069 TS tests / 289 files; Go all packages; Ruby/RBZ gate OK |
| Host smoke (SketchUp Pro 26.2 macOS 26.6.2, Ruby 3.2.2, CEF 137.0.7151.121, TestUp 2.5.4) | **Success 7/7** against the installed RBZ; installed bytes `diff -r`-identical to `dist/granete_for_sketchup.rbz` |
| Boundary spot-checks | No manufacturing terms in `src/`; only `extensions/json/sketchup` requires; RBZ topology exact; no secrets in src |
| Remote CI on PR #365 | success 6/6 (incl. Ruby matrix ubuntu/macOS/windows) on the pre-smoke push; final push re-runs it |
| Pushed state | `git status` clean; `origin/main...HEAD` contains the chained units; no AI attribution in commits |

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0 (real, full log).
- C2: [x] Una sola feature `in_progress` (F160); current.md describe la
  sesión activa.
- C3: [x] Boundaries respetados: Ruby de la extensión sin manufacturing
  truth; puertos fail-closed; metadata sólo intención opaca; sin `entityID`.
- C4: [x] Verificación real: gates locales + host smoke in-host 7/7 contra
  el RBZ instalado con binding por `source_location`.
- C5: [x] Sesión cerrada: ledger F160 `done`, `progress/history.md` con
  entrada, `current.md` en plantilla limpia, árbol limpio y pusheado.

## Diseño UI/UX (shell HtmlDialog)

- D1: [x] Todos los colores desde el bloque de tokens local (sin HSL sueltos).
- D2: [x] Shell local contenido, apropiado para el host externo.
- D3: [x] Close/recreate nativo probado in-host (CEF 137) sin callbacks
  duplicados.
- D4: [x] Sin toasts; no aplica al shell mínimo.
- D5: [x] Sin librería de iconos competidora.
- D6: [x] focus-visible + prefers-reduced-motion.
- D7: [x] §8 aplicado al scope del shell host: estados coherentes
  (neutral/configurado/no configurado), copy taller en español; el screenshot
  visual queda cubierto por el render real en CEF 137 del smoke.
- D8: [x] Semántica accesible (role=status, aria-live, labels) y coherencia
  heading/mensaje/estado verificada por los tests del script inyectado.

skill_resolution: paths-injected
