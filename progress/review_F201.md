# F201 — Migración segura de entidades legacy Group → ComponentInstance nativo (#416 / SU-ENT-3)

Fecha: 2026-08-31 · Rama: `feat/416-legacy-group-migration` (worktree `../muebles-416`, base `origin/main` @ dc37bbd3) · Status: done (pendiente review)

## Qué se implementó

- **Scanner** (`migration/scanner.rb`): clasifica entidades top-level en las 4 taxonomías del issue por metadata namespaced (`com.granete.sketchup_extension` / `bootstrap_intent.v1`); sub-estados ready/requires_review con motivo. Legacy y nativo comparten dictionary/kind — el discriminador es la clase de entidad (Group vs ComponentInstance), nunca el nombre.
- **Migrator** (`migration/migrator.rb`): pre-flight autoritativo FUERA de toda operación (`find_definition` + `resolved_native_layout`, sin fallback genérico); UNA operación por lote (política elegida por el owner); por ítem: construir nativo → validar → recién entonces borrar la fuente; excepción in-op → `abort_operation` total (modelo vuelve a 100% legacy); reporte honesto con `allMigrated` falso ante cualquier restante.
- **Builder** (`furniture_builder.rb`): `LegacyMigrationBuild` (módulo extraído para respetar ClassLength) con `build_migrated_furniture` — instancia con `legacy_group.transformation` (world transform preservado), `existing_metadata` preserva instanceRef/projectRef/materialChoices verbatim, gate `validate_migrated_replacement`.
- **Provenance**: `MetadataWriter.write_furniture(..., migrated_from: 'legacy-group')` → envelope `provenance.representationMigration {from, markerVersion}`; `Metadata::Store` valida el shape (fontes conocidas, versión exacta). El marker sobrevive ediciones posteriores (json_copy).
- **Review UI**: `MigrationReviewController` + `migration_review.html` (tokens del design system, copy español rioplatense) — conteos según mockup del issue, tabla por ítem con estado+motivo, [Actualizar compatibles (N)] / [Más tarde], resumen post-batch honesto (parcial/abort nunca se visten de éxito). Menú **Granete → Migrar modelos anteriores…** + auto-oferta no bloqueante al abrir (`rebind_model` → `offer_migration_if_legacy`). Copy del inspector y `LEGACY_REPRESENTATION_ERROR` actualizados al nuevo flujo.

## Checklist 11 puntos (AGENTS extensión)

1. Entidad: mueble managed top-level Group legacy → ComponentInstance nativo + hijos.
2. ID estable: `identity.instanceRef` verbatim; `furnitureDefinitionId`; sin `furnitureInstanceId` inventado (hasta #397).
3. Authoring intent preservado; jerarquía = vista re-resuelta; cero manufactura en Ruby.
4. Autoridad: `GET /furniture/definitions/{id}/layout` (`granete.local-basis.v1`).
5. Reutilizado: FurnitureBuilder, Metadata::Store, resolved_native_layout, AppModelObserver, patrón OptionSelectorController.
6. Fallo: resolve-fail pre-op (fuente intacta); in-op → abort total; nunca borrar antes de validar.
7. Undo: UNA operación por lote (decisión del owner, documentada en el issue).
8/9. Tests: 16 tests nuevos (scanner 7, migrator 9, provenance 4) con las 5 negative proofs del issue.
10. Host evidence: TC_MigrationSmoke en SketchUp 2026.2 macOS real (abajo).
11. Gate A/#384: sin dependencia — 100% plugin/Ruby.

## Verificación

- `bundle exec rake verify` verde: syntax + rubocop + unit (273 runs / 2520 assertions) + boundary + RBZ determinista (sha 91e96d59…).
- **TestUp 2.5.4 en host real** (SketchUp 2026.2 macOS, RBZ instalado): suite completa 52 tests — `TC_MigrationSmoke`: migración exitosa (identidad+transform+marker, 25 assertions), **un solo `editUndo:` revierte el lote completo y restaura el Group con su identidad**, fallo de resolve preserva fuente, save/reopen sin re-prompt. Evidencia: `progress/host_smoke_F201_testup_ci.json`.
- Sin cambios backend/TS (jobs de CI correspondientes intactos).

## Decisiones y límites documentados

- **Política de undo**: una operación por lote — elegida por el owner (AskUserQuestion) durante la planeación.
- **Legacy anidado en contenedores de usuario**: fuera de alcance V1 (el scanner clasifica top-level, igual que el ownership scan del resolver); documentado en el scanner.
- **Offline**: sin resolve no hay migración (el ítem queda en requiere revisión) — nunca fallback genérico que reemplace geometría autoritativa por geometría adivinada.
- `instanceRef` no reconciliado permanece como compatibilidad hasta #397 (nunca se promueve a identidad de servidor).
