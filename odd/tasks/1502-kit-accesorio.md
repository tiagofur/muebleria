# odd/tasks/1502-kit-accesorio.md

- Issue: #1502 (Kit accesorio elegible: grupos de opción vinculados a un herraje)
- Estado: IMPLEMENTED_PENDING_REVIEW · Escritor único: sesión ZCode 2026-11-05
- Base: origin/main `6ec6ecc8` · Rama: `feat/1502-kit-accesorio` · Worktree: `muebles-worktrees/1502-kit-accesorio` (checkout principal ocupado — no tocar)
- Alcance autorizado: S1 (motor+contrato) + S2 (UI). S3 (verificación en vivo con datos del owner) queda EXPLÍCITA — Delivery: partial.

## Decisiones de diseño (fijadas por la issue + lectura de código)

1. **Semántica fail-closed**: la bahía que monta kit K con grupo vinculado requerido
   y sin elección SÍ dibuja el cajón, NO dibuja el accesorio, y emite (a) un
   rejection `accessory_choice_required` por bahía (mismo mecanismo visible de
   #1493 slice 2) y (b) un ContractIssue `ACCESSORY_CHOICE_REQUIRED`
   (severity error) en ValidationIssues del authoring resolve → status
   `blocked` CON layout presente (el usuario ve el dibujo y elige). Sin
   elección y grupo OPCIONAL → nada, byte-idéntico al legacy.
2. **Cotización sigue al dibujo**: el accesorio se cotiza sii se dibuja
   (elección válida). Required-sin-elección no inventa demanda (misma doctrina
   #1493 slice 3). Línea: `commercial_kit` con ID `kit-acc-<inst>-u<n>-<grupo>`;
   NO participa del dedupe contra bulk del kit principal (demanda adicional).
3. **Ensamble accesorio separado**: `AssemblyInstanceID = "<bahía>-acc-<grupo>"`
   — independiente del SKP del cajón (el grupo de apertura #1464 no cambia).
   En Go va ANTES del ensamble principal del array; TS igual.
4. **Guard misma-kit**: `validateOptionGroupKitParts` (#1436) ya prohíbe CUALQUIER
   parte de kit como miembro de grupo hardware → el caso "parte del MISMO kit del
   grupo" queda cubierto por el guard más fuerte; fijado con test
   (`TestHandleOptionGroupsPostRejectsSameKitPartMember`), sin código redundante.
5. **Elección inválida** (no es miembro activo): rejection `resolve_failed` con
   detail nombrando el accesorio (vocabulario existente; no se inventan códigos).
6. **Materialización**: reutiliza `syncAgregadoRigidMembersFromCatalog` con el
   kit accesorio elegido (partes con placement desde `DesignParts[0].Label`,
   actorMembership — helper `kitPartMember` extraído, output idéntico);
   accesorio monolítico (sin partes) = un miembro con su asset propio.
   TS espeja con `ensureAgregadoKitParts` sobre receta sintética.
7. **Whitelists**: `ACCESSORY_CHOICE_REQUIRED` en schema enum + TS list + Ruby
   whitelist EN ESTE PR (lección #1501); emisor Go en authoring_resolve.go
   (`accessoryChoiceContractIssues` mapeando rejections). El resolve TS es
   validador (no resuelve layouts) → TS registra el código (exigido por
   `expect(issueCode.enum).toEqual(...)`) y el rechazo TS espeja el reason en
   `agregadoAssembly.ts`.
8. **EXTENSION_VERSION bump** 0.1.102 → 0.1.103: la whitelist Ruby vive bajo
   `apps/sketchup-extension/src/` (empaquetada). Rubocop exigía re-empaquetar
   el bloque OPENING a 2 tokens/línea (ModuleLength 101/100 → 91).
9. **Defaults**: `defaultOptionChoicesForModule` y `defaultChoicesForNewItem`
   NUNCA siembran grupos con kit_hardware_id — la elección de accesorio es
   explícita; el alta (ProjectAddItemModal) exige el requerido antes de insertar.

## Tareas

- [x] Mapa de evidencia (2 Explorers + lecturas directas Go/TS/contracts)
- [x] S1 Go: migración 000176, struct, storage, validación (`OPTION_GROUP_KIT_LINK_INVALID`), workshopOptionGroup (+kitHardwareId → re-pin de revisionId, esperado)
- [x] S1 Go: accessory_kit.go (materialización + cotización por bahía) + authoring resolve ACCESSORY_CHOICE_REQUIRED
- [x] Whitelists ×3 + bump + paridad de códigos verde
- [x] Fixture de paridad `contracts/fixtures/accessoryKitParity.contract.json` + tests Go (7) + tests TS (6)
- [x] S1 TS: types/agregadoAssembly/bom/apiMappers espejo
- [x] S2 UI: descubrimiento (`kitAccessoryGroupCodes` en optionGroupHelpers, usado por moduleRolePickers), threading en alta/ítems/studio/breakdown, editor con kit asociado, copy del rechazo
- [x] Suites locales del candidato congelado (ver abajo)

## Verificación (candidato congelado)

- **V0 estructural**: gofmt limpio en archivos nuevos (drift preexistente en
  main no tocado); `pnpm tsc --noEmit` limpio en domain/ui/storage/web;
  rubocop 0 ofensas en los 2 archivos Ruby tocados;
  `scripts/ci_extension_version.py` PASS 0.1.102→0.1.103.
- **V1 funcional (PASS)**:
  - `go test ./internal/domain/... ./internal/api/... ./internal/storage/...` ok
    (incluye 7 tests accesorio nuevos + paridad de códigos #1501 +
    TestAccessoryKit*: paridad, legacy byte-idéntico, opcional sin elección,
    requerido sin elección→blocked, monolítico, elección inválida, dedupe bulk).
  - `pnpm vitest run` packages/domain (2146 ✓, incluye accessoryKitParity 6/6),
    packages/storage (280 ✓), packages/ui (2439 ✓, incluye descubrimiento #1502),
    apps/web (612 ✓).
  - `rake unit` plugin: 1495 runs, 0 failures (incluye paridad Ruby de whitelists).
  - Migración 000176 up verificada en postgres:16 desechable (columna
    `kit_hardware_id` presente tras el up — ver corrección B1).
- **V2 operacional: NOT_RUN** — S3 en vivo (owner): herrajes accesorios con SKP
  propio, grupo vinculado a MBOX-IRIDIUN-E, release nueva, prueba SketchUp.
  Requiere migración 000176 aplicada + release > 0.3.48.

## Review independiente (un revisor, decisión del owner para esta cadena)

- Ronda 1 (HEAD b3297b4e): BLOCKED con 2 blockers → 1 ronda de corrección
  consolidada (commit 9ae7df4b):
  - **B1 (P0)**: el up de 000176 llevaba una línea `DROP COLUMN` pegada del
    down — la columna se autoeliminaba (feature muerta + API option_groups
    caído en DB fresca/actualizada). El "storage ok" del escritor era vacuo:
    la suite hace skip sin DATABASE_URL. Fix verificado en postgres:16.
  - **B2 (P1)**: `dimension: 'height'` sin `as const` en el test nuevo →
    tsc --noEmit de packages/ui rojo en HEAD (vitest/esbuild no typechequea).
- Sugerencias aplicadas/en PR: P2 (ensanchamiento agrego-aware del gate del
  alta) documentado en el body del PR. P3 (asimetrías de trim Go↔TS) fuera de
  alcance — datos normalizados server-side.
- Re-review del fix: APPROVED del candidato 9ae7df4b (replay 000176 en
  postgres:16 + tsc ui re-verificados por el revisor).
- Ronda CI 1 (HEAD 8b95111b, docs-only sobre 9ae7df4b): Storage shard 2/4 rojo
  — `TestGetFullCatalogRejectsDirectSQLInvalidParameterDefinitions` con
  `column "kit_hardware_id" does not exist`: el test pinnea el schema con
  `identityApplyThrough(pool, 175)` y su comentario propio exige re-pin cuando
  el catálogo empieza a requerir columnas nuevas (trigger exacto de #1502).
  Fix (commit ef23b5e9): re-pin 175→176 en el único sitio de lectura; los
  otros 3 pins del archivo son de escritura de módulos. Reproducido en local
  con el runner canónico aislado (postgres efímero + roles): PASS. Los otros
  2 checks rojos (Go Backend Tests / Foundation Gate A) eran agregadores del
  shard. Re-validación del revisor + CI nueva en ef23b5e9.

## Entrega

- PR a main: `Refs #1502` / `Delivery: partial` / label `type:feature` (S3 en vivo pendiente — el owner cierra la issue tras su prueba).
- Riesgo: la proyección workshopOptionGroup con campo nuevo re-fija el
  revisionId del catálogo al publicar (esperado y documentado en la issue).
