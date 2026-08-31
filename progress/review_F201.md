# Review — feature F201 (#416: migración legacy Group → ComponentInstance nativo)

# Round 2 — veredicto final

**Veredicto:** APPROVED

Head revisado: `0d807369` (rama `feat/416-legacy-group-migration`, 1 commit sobre el round 1
`ee5bb63d`), todo pushed, working tree limpio. El diff del fix toca sólo lo pedido:
`migration/migrator.rb`, `ui/dialog_controller.rb`, tests nuevos del bridge/JS, evidencia host,
ledger y este archivo.

## Resolución de los cambios requeridos del round 1

1. **Structs en `requiresReview` — RESUELTO.**
   `Migrator#migrate` ahora normaliza TODAS las entradas:
   `scan_result.requires_review.map { |item| review_item(item) } + demoted`, y `review_item`
   ganó defaults (`reason || item.reason || 'requires-review'`). El reporte cruza el puente JSON
   sólo con hashes planos. Regression test doble:
   `MigrationBridgeTest#test_migrate_callback_returns_json_safe_report_with_reasons` (viaja por
   `DialogController` → callback → `JSON.generate` sin `#<struct` ni `Sketchup::Group`, con
   `reason`/`instanceRef`) y la cobertura JS del render del resultado.
2. **Tests del bridge + JS — RESUELTO.**
   `test/unit/migration_bridge_test.rb` (6 tests): auto-oferta sólo con legacy, quiet sin legacy,
   no re-oferta con review abierto, menú siempre abre, reporte JSON-safe, quiet tras migración
   exitosa (provider resolvable + scan fresco — AC8 a nivel bridge). `MigrationReviewJsTest` +
   `test/js/migration_review_test.js`: harness real (Node `vm` + mock DOM ejecutando el script
   actual de `migration_review.html`) con conteos, badges con motivo humano, botón deshabilitado
   sin ready, parcial/abort jamás vestidos de éxito, éxito total correcto y botones llegando al
   bridge Ruby. `DialogController` acepta `migration_review_controller:` inyectable (producción lo
   construye lazy igual que antes). El wrapper replica el patrón fail-closed de
   `DialogInspectorJsTest` (Open3 + node, sin skip silencioso).
3. **Evidencia ↔ artefacto final — RESUELTO.**
   Rebuild determinista desde el src final verificado por el revisor:
   sha256 `960f8ac85b5db13dedbe6479ebc4ffaa7be1c2470d412692195123ef6177c6d2`, idéntico al
   registrado DENTRO de la evidencia (`progress/host_smoke_F201_testup_ci.json` →
   `metadata.rbz_sha256`) y en el ledger F201. La suite TestUp completa fue re-correrida contra
   ese RBZ exacto: statistics `{total:52, assertions:1308, failures:0, errors:0, passes:52}`,
   4/4 `TC_MigrationSmoke#*` en `passes`. Timestamps coherentes (evidencia 18:28:49Z ≈ 42s antes
   del commit 12:29:31 −0600). Se cumple "record RBZ SHA/version with host evidence".
4. **Comentario duplicado — RESUELTO** (eliminado el segundo bloque en `dialog_controller.rb`).
5. **Aritmética del ledger — RESUELTO** (280 runs / 2547 assertions, coincide exactamente con el
   verify del revisor).

## Checkpoints (round 2)

- C1: [x] Harness completo; `bundle exec rake verify` verde (gate aplicable de la extensión).
- C2: [x] F201 `done` con tests que pasan; sin features `in_progress`; `progress/current.md` limpio.
- C3: [x] Feature 100% en `apps/sketchup-extension`; boundary test verde; sin vocabulario de
  manufactura en src nuevo; sin resolución paralela (reutiliza `find_definition` +
  `resolved_native_layout`).
- C4: [x] `rake verify` verde (280 unit runs / 2547 assertions + boundary 3 runs / 1181 assertions,
  0 failures/errors/skips) Y evidencia host pinned al artefacto final por sha.
- C5: [x] Tree limpio, todo pushed, `progress/history.md` y ledger actualizados.

Los 7 puntos de sospecha del round 1 permanecen verificados (ver historial); el único hallazgo
sustancial (punto 3 del round 1) quedó cerrado con el regression test correspondiente.

## Verificación ejecutada por el revisor (round 2)

```bash
git -C /Users/tiagofur/dev/carpinteria/muebles-416 log ee5bb63d..HEAD --oneline   # sólo el fix 0d807369
git -C /Users/tiagofur/dev/carpinteria/muebles-416 status --short                # limpio
git -C /Users/tiagofur/dev/carpinteria/muebles-416 log origin/feat/416-legacy-group-migration..HEAD # vacío (pushed)
git -C /Users/tiagofur/dev/carpinteria/muebles-416 diff ee5bb63d..HEAD -- apps/sketchup-extension/src # migrator + dialog_controller
cd /Users/tiagofur/dev/carpinteria/muebles-416/apps/sketchup-extension && eval "$(rbenv init - bash)"
bundle exec rake verify
# → 280 runs, 2547 assertions, 0 failures, 0 errors, 0 skips + boundary 3/1181/0
#   + RBZ verificado (sha256 960f8ac85b5db13dedbe6479ebc4ffaa7be1c2470d412692195123ef6177c6d2)
python3 - … progress/host_smoke_F201_testup_ci.json
# → statistics {total:52, failures:0, errors:0, passes:52}; 4/4 TC_MigrationSmoke en passes;
#   metadata.rbz_sha256 == 960f8ac8… == sha del rebuild local del src final
```

No se relanzó SketchUp (regla de esta revisión); la evidencia TestUp fue validada estructuralmente
y su sha es reproducible byte a byte desde el src committeado.

---

# Round 1 — historial (superseded por el round 2)

**Veredicto round 1:** CHANGES_REQUESTED (head `ee5bb63d`, base `origin/main` @ `dc37bbd3`).

La arquitectura era correcta y adhiere a `sketchup-native-entity-model.md` §19 (pipeline +
5 prohibiciones) y §5 (identidad), y a `sketchup-plugin-excellence.md` §18: scanner por metadata
namespaced, pre-flight autoritativo fuera de operación, una operación por lote, borrado sólo tras
validación, abort total, provenance fail-closed.

## Siete puntos de sospecha (round 1)

1. **¿Fuente legacy borrada tras validar y en la misma operación?** SÍ. `build_migrated_furniture`
   (termina en `validate_migrated_replacement`) → `erase_entities`, dentro de la única operación.
   Pinned por unit (journal del stub) y host (undo único restaura el Group con identidad).
2. **¿Ningún camino inventa identidad ni matchea por nombre/geometría?** SÍ. `instanceRef` sólo
   desde `existing_metadata` (raise si falta); scanner por diccionario namespaced + clase;
   `furnitureInstanceId` nunca se escribe. Negative tests de rename y nombre-distinto.
3. **¿Abort revierte todo y el reporte nunca dice éxito total con restantes?** SÍ en sustancia
   (`allMigrated = committed && requires_review.empty?`; stub journal rollback; host `editUndo:`),
   con el defecto de payload corregido en round 2.
4. **¿Store valida provenance fail-closed y el marker sobrevive?** SÍ. `validate_provenance`
   estricto; metadata ilegible → corrupt/unsupported; marker sobrevive por `json_copy(existing_metadata)`.
5. **¿Auto-oferta sin spam ni re-apertura post-migración (AC8)?** SÍ. Abre sólo con legacy, no
   reabre si ya está abierto, quiet tras migración exitosa (probado en host y ahora a nivel
   bridge). Nota menor no bloqueante: sin supresión persistente tras "Más tarde".
6. **¿Palabras prohibidas del boundary ausentes?** SÍ (grep + boundary test).
7. **¿Checklist 11 puntos coincide con el código?** SÍ, con dos deslices de documentación
   corregidos en round 2.

## Cambios requeridos (round 1) — todos resueltos en round 2

1. `Migrator` serializaba `ScannedEntity` (Struct) en `requiresReview` → string `#<struct …>` al
   cruzar el puente JSON, degradando el reporte por ítem. **Resuelto** (normalización +
   regression tests).
2. Sin tests de `MigrationBridge` ni del JS de `migration_review.html`. **Resuelto** (bridge 6
   tests + harness JS real).
3. RBZ sha del ledger (91e96d59…) no reproducible desde el src committeado (6a48095e…) y sin sha
   dentro de la evidencia. **Resuelto** (sha 960f8ac8… dentro de `metadata.rbz_sha256`, TestUp
   re-correrido contra ese RBZ).
4. Comentario duplicado en `dialog_controller.rb:415-421`. **Resuelto**.
5. Aritmética "16 tests" (eran 20). **Resuelto**.

## Verificación ejecutada por el revisor (round 1)

```bash
git diff origin/main...HEAD --stat / -- apps/sketchup-extension/src / test / docs
bundle exec rake verify          # 273+3 runs verde; RBZ 6a48095e… (determinista, ≠ 91e96d59… del ledger)
python3 - … host_smoke_F201_testup_ci.json   # 52/52 válido, 4/4 TC_MigrationSmoke
ruby -rjson …                    # Struct en el reporte → string basura en JSON (defecto 1)
grep -rniE boundary words src     # 0 hits
```
