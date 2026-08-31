# Review — feature F201 (#416: migración legacy Group → ComponentInstance nativo)

**Veredicto:** CHANGES_REQUESTED

Rama `feat/416-legacy-group-migration` (1 commit `ee5bb63d` sobre `origin/main` @ `dc37bbd3`),
todo pushed, working tree limpio, sin mezcla de trabajo ajeno (los cambios backend/contracts del
diff contra `main` local provienen de `origin/main`; la base real del PR es `dc37bbd3`).

La arquitectura general es correcta y adhiere a `sketchup-native-entity-model.md` §19 (pipeline,
5 prohibiciones) y §5 (identidad), y a `sketchup-plugin-excellence.md` §18: scanner por metadata
namespaced, pre-flight autoritativo fuera de operación, una operación por lote, borrado sólo tras
validación, abort total, provenance validado fail-closed. Los defectos encontrados están en el
puente UI y en la integridad de la evidencia, no en el pipeline de migración.

## Checkpoints

- C1: [x] Archivos base y docs/skills presentes (el gate aplicable de la extensión es
  `bundle exec rake verify`, ejecutado verde por el revisor).
- C2: [x] F201 `done` en `feature_list.json` con tests que pasan; ninguna feature `in_progress`;
  `progress/current.md` en plantilla limpia ("Sin feature activa").
- C3: [x] Feature 100% en `apps/sketchup-extension`; sin cambios de dominio/TS/Go; boundary test
  verde; sin vocabulario de manufactura en src nuevo (grep + `test/boundary/ownership_test.rb`).
- C4: [ ] `bundle exec rake verify` verde (273 + 3 runs, 0 fallos) PERO la evidencia TestUp del
  ledger cita un RBZ sha que no es reproducible desde el src committeado (ver cambio requerido 3).
- C5: [x] Tree limpio, todo pushed, `progress/history.md` con entrada de la sesión, ledger
  actualizado.

## Siete puntos de sospecha (verificados en código)

1. **¿La fuente legacy se borra siempre tras validar el reemplazo y en la misma operación?** SÍ.
   `migrator.rb`: `build_migrated_furniture` (que termina en `validate_migrated_replacement`,
   que raisea si el reemplazo no es ComponentInstance / sin componentes / identidad no sobrevivió /
   sin marker) y recién después `erase_entities`, ambos dentro de la única operación abierta.
   Pinned por `test_source_is_never_erased_before_its_replacement_validates` y
   `test_in_operation_failure_aborts_the_whole_batch_leaving_sources_intact` (unit, journal del
   stub) y por `test_successful_migration…` + `test_single_undo_reverts…` (host real).
2. **¿Ningún camino inventa identidad ni matchea por nombre/geometría?** SÍ, limpio. `instanceRef`
   se lee exclusivamente de `existing_metadata['identity']` (`build_migrated_furniture` raisea
   `ArgumentError` si falta); el scanner clasifica sólo por diccionario namespaced + clase de
   entidad; `furnitureInstanceId` no se escribe en ningún path (host smoke lo aserta
   `assert_nil`). Negative proofs: `test_rename_does_not_change_classification` y
   `test_identity_does_not_follow_the_legacy_display_name`.
3. **¿El abort in-op revierte todo y el reporte nunca dice éxito total con restantes?** SÍ en
   sustancia. Stub: `abort_undo_frame` revierte el journal (tests restauran los 2 Groups); host:
   un `editUndo:` restaura el Group con identidad intacta. `allMigrated = committed &&
   requires_review.empty?` y `migratedCount = 0` en abort. **PERO** el payload del reporte está
   roto para ítems requires_review detectados por el scanner (ver cambio requerido 1): el
   resultado llega degradado al diálogo.
4. **¿Metadata::Store valida provenance fail-closed y el marker sobrevive ediciones?** SÍ.
   `validate_provenance` raisea sobre fuente desconocida o `markerVersion != 1`; metadata ilegible
   → taxonomía `corrupt-metadata`/unsupported (nunca entra al batch). El marker sobrevive ediciones
   posteriores porque `write_furniture` parte de `json_copy(existing_metadata)` y sólo la migración
   setea `provenance` (pinned por `test_provenance_survives_a_later_native_edit`).
5. **¿La auto-oferta no spamea ni se abre tras migración exitosa (AC8)?** SÍ, aceptable.
   `offer_migration_if_legacy` (en `rebind_model`, app observer adjunto sólo tras abrir el panel
   principal): abre sólo si el scan encuentra legacy, no reabre si el review ya está abierto
   (`migration_review_controller.open?`), fall-silent con log. Tras migración exitosa no quedan
   Groups → save/reopen quiet (probado en host: `test_save_and_reopen_does_not_re_prompt`).
   Nota menor no bloqueante: no hay supresión persistente tras "Más tarde" — re-ofrece al
   re-activar un modelo aún legacy; conviene documentarlo como comportamiento intencional.
6. **¿Palabras prohibidas del boundary ausentes en src?** SÍ. Grep de
   bom/nesting/kerf/productionrelease/readiness/reconcil/postprocessor en `migration/`,
   `migration_review_controller.rb` y `migration_review.html`: cero hits; `rake verify` corre el
   boundary test verde. Reutiliza `find_definition` + `resolved_native_layout` sin resolución
   paralela.
7. **¿El checklist 11 puntos coincide con el código?** SÍ, ítems 1–7 y 10–11 verificados contra
   archivos concretos. Dos deslices de documentación: el ítem 8/9 dice "16 tests nuevos" pero son
   20 (scanner 7 + migrator 9 + provenance 4), y el comentario del módulo `MigrationBridge` está
   duplicado (ver cambios requeridos 4 y 5).

## Cambios requeridos

1. **`Migration::Migrator` serializa `ScannedEntity` (Struct) en el reporte** —
   `src/granete_for_sketchup/migration/migrator.rb`: `requires_review =
   scan_result.requires_review + demoted` mezcla Structs (ítems requires_review detectados por el
   scanner, p.ej. `missing-furniture-definition-id`) con hashes (demoted).
   `MigrationReviewController#handle_migrate` → `execute_bridge` → `JSON.generate` convierte cada
   Struct en el string `"#<struct ScannedEntity entity=#<Sketchup::Group:0x…>, …>"`. Consecuencias:
   (a) el payload del diálogo arrastra referencias del host; (b) en `renderResult` esos ítems
   renderizan como "Mueble sin nombre / sin ref" **sin motivo**, degradando exactamente el AC
   "identidad faltante queda expuesta para #397" y el reporte honesto por ítem. Repro: modelo con
   1 ready + 1 legacy sin `furnitureDefinitionId` → Actualizar compatibles. Fix: mapear
   `scan_result.requires_review` con `review_item` (u otro mapper a hash) antes de armar el
   report, y agregar un test de regresión que haga `JSON.generate(report)` y verifique que cada
   entrada de `requiresReview` es un hash con `reason`/`instanceRef`.
2. **Sin tests del bridge ni del JS de migración** — `MigrationBridge` (auto-oferta en
   `rebind_model`, `handle_migration_review`, `run_legacy_migration` con re-scan fresco al click)
   no tiene cobertura en `test/unit/dialog_controller_test.rb` (que sí cubre los demás bridges),
   y `resources/migration_review.html` no tiene test en el Node harness (`test/js/` cubre
   inspector y material-selector). `apps/sketchup-extension/AGENTS.md` (HtmlDialog architecture)
   exige callbacks testeables vía Node harness donde sean host-independent. Pedir: test de
   auto-oferta (abre sólo con legacy; no reabre si ya abierto; quiet tras migración exitosa) y un
   test JS mínimo de `initMigrationReview`/`migrationResult` (parcial nunca se viste de éxito;
   abort no cambia nada). Este es el test que habría atrapado el defecto 1.
3. **La evidencia host no corresponde al artefacto final** — el ledger (`feature_list.json`, F201)
   declara "RBZ sha 91e96d59e2468bb8…" junto al TestUp 52/52, pero el build determinista del src
   committeado produce `6a48095e6efaf9cd94dac74bdbe74124ec445cee4180a21495fd8a01b85a4875`
   (verificado dos veces por el revisor, con y sin `SOURCE_DATE_EPOCH`), y
   `progress/host_smoke_F201_testup_ci.*` no registra el sha del RBZ efectivamente probado. El
   stdout muestra el run host a las 07:47 y el commit a las 07:48: algo de `src/` cambió después
   de generar el RBZ probado (p.ej. el comentario duplicado del punto 4). Regla del AGENTS de la
   extensión: "record RBZ SHA/version with host evidence". Pedir: reinstalar el RBZ construido
   desde el src final, re-correr `TC_MigrationSmoke`, actualizar la evidencia y el sha del ledger
   (o adjuntar el sha real de la evidencia).
4. **Comentario duplicado** — `src/granete_for_sketchup/ui/dialog_controller.rb:415-421`: el
   bloque "Migration review wiring (#416)…" aparece dos veces con redacción distinta. Eliminar uno.
5. **Aritmética del checklist** — `progress/review_F201.md` ítem 8/9: "16 tests nuevos
   (scanner 7, migrator 9, provenance 4)" son 20. Corregir al actualizar el archivo.

## Diseño UI/UX (no aplica gate React/design.md §8 — es HtmlDialog de la extensión)

- Tokens propios consistentes con `dialog.html` (mismo vocabulario de color/spacing/radius),
  una primary action por contexto, `textContent` para todo dato dinámico (sin innerHTML con
  input), `:focus-visible` en botones, copy español rioplatense. Aceptable para el estándar de
  la extensión, sujeto al test JS del punto 2.

## Verificación ejecutada por el revisor

```bash
git -C /Users/tiagofur/dev/carpinteria/muebles-416 diff origin/main...HEAD --stat   # base real dc37bbd3
git -C /Users/tiagofur/dev/carpinteria/muebles-416 log origin/main..HEAD --oneline # 1 commit, pushed
cd /Users/tiagofur/dev/carpinteria/muebles-416/apps/sketchup-extension && eval "$(rbenv init - bash)"
bundle exec rake verify
# → 273 runs, 2520 assertions, 0 failures, 0 errors, 0 skips + boundary 3 runs, 1181 assertions
#   + RBZ verificado (sha256 6a48095e6efaf9cd94dac74bdbe74124ec445cee4180a21495fd8a01b85a4875)
SOURCE_DATE_EPOCH=<commit-ts> bundle exec rake package && shasum -a 256 dist/granete_for_sketchup.rbz
# → 6a48095e… (determinista; ≠ 91e96d59… declarado en el ledger)
python3 - … progress/host_smoke_F201_testup_ci.json
# → JSON válido; statistics {total:52, failures:0, errors:0, passes:52};
#   4/4 TC_MigrationSmoke#* en passes (migración exitosa, undo único, fallo-preserva-fuente, save/reopen)
ruby -rjson … # prueba de serialización: Struct ScannedEntity en el report → string basura en JSON
grep -rniE '\b(bom|nesting|kerf|productionrelease|readiness|reconcil|postprocessor)\b' src nuevo → 0 hits
```

No se relanzó SketchUp ni el smoke de host (regla de esta revisión); la evidencia existente fue
validada estructuralmente, con la salvedad del punto 3.
