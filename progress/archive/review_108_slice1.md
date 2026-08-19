# Review — issue #108, Slice 1 (versionado de estructuras)

Commit: `f8c13cb` (rama `feat/structures-versioning-108`)
Alcance confirmado vía `git show --stat HEAD`: solo `packages/domain/**` + `progress/impl_108_slice1.md`. Ningún archivo fuera de `packages/domain` (apps/web, packages/ui, backend-go, storage) entra en este commit. Los archivos sucios en el working tree (`apps/web/src/App.tsx`, varios `packages/ui/**`) NO pertenecen a este commit.

**Veredicto:** APPROVED (con 2 MINOR/NIT opcionales)

## Tests

```
$ pnpm --filter @muebles/domain test
Test Files  19 passed (19)
     Tests  199 passed (199)
```
Incluye `src/structures/versioning.test.ts` (14 casos) y el test de no-regresión nuevo en `engine.test.ts` (#108 — closed quote keeps rev-1 BOM after structure edit to rev 2).

## Criterios

### 1. Boundary (PASS)
`packages/domain/src/structures/versioning.ts:15-21` solo importa `type { ... } from '../types'` y `{ ResolutionError } from '../errors'`. Sin react/electron/fs/xlsx en ningún archivo del commit (`grep` confirmativo). Cumple `docs/architecture.md` tabla de boundaries.

### 2. Inmutabilidad (PASS)
- Tipos `readonly` en `packages/domain/src/types.ts:236-253` (`StructureRevision` todo readonly) y campos `readonly revision?` / `readonly history?` en `Structure` (`types.ts:233-244`), `readonly structureRevisionPin?` en `ProjectItem` (`types.ts:339-344`).
- Helpers no mutan: `bumpStructureRevision` (`versioning.ts:69-75`) construye nuevo objeto con spread; `captureProjectItemStructurePins` (`versioning.ts:205-211`) hace `{ ...item, structureRevisionPin }` y deja los items originales intactos (verificado por test línea 273). `resolveStructureRevision` no toca `structure`. Cumple `docs/conventions.md` §"Tipos: inmutabilidad".

### 3. Naming (PASS)
Interfaces PascalCase (`StructureRevision`, `ResolvedStructureRevision`), funciones camelCase (`bumpStructureRevision`, `resolveStructureForPin`, `captureProjectItemStructurePins`), constante `DEFAULT_STRUCTURE_REVISION` (`versioning.ts:24`). Archivo `versioning.ts` es `camelCase`. Cumple `docs/conventions.md` tabla de nombres.

### 4. Errores (PASS)
`resolveStructureRevision` lanza `ResolutionError` (subclase de `DomainError`) con contexto rico para pin desconocido (`versioning.ts:139-149`): `{ structureId, structureCode, pin, currentRevision, availableRevisions, field }`. No hay stack crudo ni strings sueltos. El test (`versioning.test.ts:170-183`) verifica el contexto. Cumple `docs/architecture.md` §"Errores en el dominio".

### 5. Paridad futura Go (PASS)
La lógica usa solo: comparación de números, `Array.find`, spread de objetos, `Map` para indexar, sort numérico. Todo es trivialmente portable a Go (structs, slices, maps). Sin `any`, sin `Proxy`, sin `Symbol`, sin trick TS mágico. El backend Go ya existe en `backend-go/internal/domain/engine/resolve.go` y los tipos viven en `backend-go/internal/domain/types.go`, así que Slice 2 tiene dónde aterrizar. La firma `resolveStructureRevision(structure, pin) ResolvedStructureRevision` es 1:1 portable.

### 6. Semántica del plan (PASS)
- `resolveStructureRevision(pin)` lanza `ResolutionError` para pines desconocidos con contexto — `versioning.ts:134-150`. PASS.
- `bumpStructureRevision` prependea snapshot newest-first — `versioning.ts:74` (`[snapshot, ...(current.history ?? [])]`). Verificado por test `versioning.test.ts:74-92` (history[0] = rev 2, history[1] = rev 1). PASS.
- `captureProjectItemStructurePins` deja sin cambios items sin estructura (`versioning.ts:206-209`: `if (!module?.structureId) return item; if (!structure) return item;`). Verificado por test línea 270-271. PASS.

### 7. Comportamiento al reabrir (PASS — juicio favorable)
Al reabrir (`closed → draft`), `transitionProjectStatus` (`engine.ts:1348-1355`) elimina `priceSnapshot` pero **conserva** los `structureRevisionPin` (comentario JSDoc `engine.ts:1322-1327` lo justifica explícitamente).

**Juicio:** es razonable y consistente con el modelo de auditoría. El `priceSnapshot` se recalcula al cerrar (es un freeze de precios instantáneo), así que borrarlo al reabrir es correcto. Pero los pins apuntan a revisiones históricas de estructuras que pueden haber sido editadas — si se borraran, una cotización reabierta pasaría a resolver contra la revisión live, perdiendo el historial de "con qué revisión se cotizó originalmente". Conservarlos permite re-resolver la revisión exacta hasta el próximo cierre. Además, el branch `closed → closed` con snapshot existente preserva los pins (`engine.ts:1358-1360`), evitando reescribirlos. Semántica coherente.

### 8. Tests (PASS)
14 casos nuevos cubren: bump 1→2, reporte oldRevision, snapshot intacto en history[0], segunda edición rev 3 con history.length 2 newest-first, ignora draft smuggle de id/revision/history, legacy undefined → 1, pin undefined → actual, pin actual → actual, pin en history → frozen verbatim, pin desconocido → ResolutionError con contexto completo, `resolveStructureForPin` reifica, snapshot solo captura BOM-relevante, `structureRevision` normaliza, `captureProjectItemStructurePins` pega + deja no-aplicables + sobrescribe stale. El no-regresión en `engine.test.ts:867-956` valida el flujo completo (cerrar en rev 1, editar a rev 2 con 3× componentes, BOM cerrado sigue en 1 pieza, draft ve 3, breakdown congelado no cambia). Happy path + edge cases cubiertos.

### 9. Sin scope creep (PASS)
`git show --stat HEAD` lista exactamente: `engine.test.ts`, `engine.ts`, `exportIssues.ts`, `index.ts`, `structures/versioning.test.ts`, `structures/versioning.ts`, `types.ts`, `progress/impl_108_slice1.md`. Todo bajo `packages/domain/` salvo el `.md` de progreso. Confirmado limpio.

### 10. `revision` opcional — decisión del implementer (PASS — justificación válida)
El plan pedía `revision` requerido. El implementer lo hizo opcional argumentando que `apps/web/src/App.tsx:220 draftToStructure()` y >10 literales `Structure` en tests/fixtures dejarían de compilar si fuera requerido, y no se permite tocar `apps/web` source en Slice 1 (`progress/impl_108_slice1.md` §"Decisiones de diseño #1").

**Juicio:** la justificación es válida y está documentada. La opcionalidad no debilita el modelo: los helpers `structureRevision()` y `bumpStructureRevision()` normalizan `undefined → DEFAULT_STRUCTURE_REVISION (1)` en todos los puntos de entrada, así que la semántica es idéntica para el caller. Los tests verifican el path legacy (`versioning.test.ts:111-122`, `220-225`). Es un compromiso razonable para mantener el boundary del Slice; Slice 2 puede endurecer el tipo cuando actualice los callers. No es un hack — es una cláusula de escape del plan bien aplicada.

## Checkpoints (CHECKPOINTS.md)

- C1: N/A (no aplica a un slice de feature; el harness base ya existe).
- C2: [x] Sin feature `in_progress` extraña introducida; tests pasan.
- C3: [x] `packages/domain` sin imports prohibidos; errores son `ResolutionError` (`DomainError` subclass); sin `console.log` de debug.
- C4: [x] `pnpm --filter @muebles/domain test` 199/199 verde. No toca export directo (sólo pasa pin a `resolveBom` ya cubierto); no toca storage.
- C5: [x] Sin archivos sin trackear sospechosos en `packages/domain`. (Archivos sucios en `apps/web`/`packages/ui` en el working tree NO pertenecen a este commit.)

## Issues encontrados

### MINOR — Indentación rota en `exportIssues.ts` introducida por este commit
`packages/domain/src/exportIssues.ts:172-173` quedó con 4 espacios extra:

```
171:   // Resolve BOM only when local structure/options look complete (VAL-06, refs, edges).
172:     if (issues.length === before) {        ← 4 espacios de más
173:     try {                                   ← indentación inconsistente
```

El diff de HEAD muestra `+    if (issues.length === before) {` (4 espacios) reemplazando `-    if (issues.length === before) {` (2 espacios). Esto ya está en el commit, no es del working tree. `prettier --check` marca el archivo. Viola `docs/conventions.md` §"Formato: Prettier con config por defecto (2 espacios)". No rompe funcionalidad (es whitespace dentro de un bloque), pero empeora la homogeneidad que la convención exige.

**Qué cambiar:** restaurar la indentación a 2 espacios en líneas 172-181 (correr `prettier --write src/exportIssues.ts` o des-indentar manualmente el bloque). Notar que Prettier no está wired en `init.sh`/CI, por eso slipped — pero el revisor exige la convención igual.

### NIT (opcional) — Warnings de Prettier en otros archivos del commit
`prettier --check` también marca `versioning.ts`, `engine.ts`, `types.ts`, `index.ts`, `versioning.test.ts`, `engine.test.ts`. Sin embargo, estos archivos tienen código mezclado (líneas preexistentes + líneas nuevas), y al no estar Prettier wired en CI no es posible atribuir todos los warnings a este commit. Solo el de `exportIssues.ts` es claramente introducido por el diff. Recomendado ejecutar `prettier --write` sobre los archivos tocados antes de mergear, pero no bloquea.

## Notas positivas

- El comentario JSDoc en `engine.ts:1319-1327` y los comentarios in situ (`engine.ts:1343-1344`, `1349`) explican el *por qué* de las decisiones no obvias (auditoría al reabrir), cumpliendo `docs/conventions.md` §"Comentarios".
- El patrón espeja limpiamente `QuotePriceSnapshot` + `captureQuoteSnapshot`, manteniendo coherencia con el código existente (reducción de sorpresa).
- El test de no-regresión es robusto: valida tanto el BOM como el breakdown congelado antes/después de editar la estructura.
- La función `captureProjectItemStructurePins` indexa por Map en vez de `find` anidado — O(n+m) en vez de O(n·m).
