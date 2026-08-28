# Sesión

Sin sesión activa.

## F190 — validación real nativa + OpenCutList (#417) — 2026-08-28

Rama `test/417-native-ocl-validation`. Slice de validación test-only (cero
cambios en runtime): fixture canónico
`apps/sketchup-extension/test/fixtures/cabinet_validation_layout.json`
(gabinete 600×720×560 con BODY 16 / FRONT 18 / BACK 6, puerta + cajonero de 3
frentes con `componentDefinitionId` compartido, manija + 2 bisagras),
`TC_NativeValidationSmoke` (9 tests) y `TC_OpenCutListInteropSmoke` (1 test) en
host real, más test offline del fixture y boundary anti-OCL
(`opencutlist`/`ladb` prohibidos en `src/`).

Verificación: `bundle exec rake verify` verde (RuboCop 56 files, 170 unit /
1686 assertions, 3 boundary / 885, RBZ determinista `5fb741e9…` idéntico al
instalado); host smoke TestUp CI final **28/28 tests, 968 assertions, Success**
(seed 29189; 7 bootstrap + 11 native entity + 9 native validation + 1 OCL),
JSON preservado en `progress/host_smoke_F190_testup_ci.json`; reporte OCL
7.1.0 en `progress/opencutlist_smoke_F190.json`; resultados y limitaciones en
`docs/sketchup-opencutlist-interop.md`.

Hallazgos del host real: `editUndo:` es síncrono pero hubo un flake único del
test F188 de undo bajo suite completa (no reproducido aislado ni con la misma
seed; documentado, sin cambio de código); OCL analiza la selección si no está
vacía (el smoke la limpia); en SU 2026 `Length#to_s` sólo da mm decimales con
`LengthFormat` decimal + `LengthUnit` millimeter juntos; los relanzamientos
rápidos de SketchUp pueden crashear (signal 5) — se espacian las corridas.
