# Impl #108 — Slice 1: Versionado de estructuras (dominio TS)

> Feature: pin de revisión por estructura (`structureRevisionPin`).
> Mecanismo definido en `progress/explore_108_tests_conventions.md`.
> Alcance: **solo `packages/domain`**. Sin tocar backend-go, storage, ui, apps/ source.

## Resumen

Cada `Structure` ahora es versionada: editarla crea una nueva `revision` y
empuja un snapshot inmutable de la revisión anterior a `history`. Al cerrar
una cotización, se pega `structureRevisionPin` en cada `ProjectItem`, y
`resolveBom` re-resuelve usando la revisión pinneada (o la actual si no hay
pin). Patrón análogo a `QuotePriceSnapshot` + `captureQuoteSnapshot`.

## Archivos tocados

### `packages/domain/src/types.ts`
- Nuevo `StructureRevision` (snapshot inmutable: `revision`, `code`, `name`,
  `externalDims`, `presets`, `components` — solo campos relevantes para BOM).
- `Structure`: añadidos `revision?: number` y `history?: readonly StructureRevision[]`
  (**opcionales** — ver decisión de diseño abajo).
- `ProjectItem`: añadido `structureRevisionPin?: number`.

### `packages/domain/src/structures/versioning.ts` (NUEVO, 200 líneas)
- `DEFAULT_STRUCTURE_REVISION = 1`
- `structureRevision(s)` — normaliza `undefined` → 1 (legacy data).
- `snapshotStructureRevision(s)` — construye el snapshot BOM-relevante.
- `bumpStructureRevision(current, nextDraft)` → `{ structure, oldRevision }`.
  Prependea el snapshot al `history` (newest-first). Ignora cualquier intento
  del draft de inyectar `id`/`revision`/`history` propios.
- `resolveStructureRevision(s, pin?)` → `ResolvedStructureRevision`. Lanza
  `ResolutionError` con contexto `{ structureId, structureCode, pin,
  currentRevision, availableRevisions, field }` para pines desconocidos.
- `resolveStructureForPin(s, pin?)` → `Structure` reificada lista para
  `resolveComposedModule`/`resolveBom`.
- `captureProjectItemStructurePins(items, catalog)` → items con pin pegado;
  deja sin cambios items sin estructura o con estructura faltante.

### `packages/domain/src/engine.ts`
- Import: `{ captureProjectItemStructurePins, resolveStructureForPin }`.
- `resolveBom` (líneas ~899): **nuevo parámetro opcional
  `structureRevisionPin?: number`** al final. Después de hallar la estructura
  por id, la reificamos con `resolveStructureForPin(found, structureRevisionPin)`
  (lanza `ResolutionError` para pin desconocido). Firma pública compatible
  hacia atrás: los callers que no pasan pin siguen funcionando.
- 5 callers internos (`calcLiveProjectBreakdown`, `collectUsedUnitPrices`,
  `generateCutRows`, `generatePieceLabels`, `generateProjectMaterialSummary`)
  ahora pasan `item.structureRevisionPin` como 5º arg.
- `transitionProjectStatus` (líneas ~1316):
  - draft → closed: llama `captureProjectItemStructurePins` al cerrar.
  - closed → draft (reopen): **conserva los pins** (comentario explica por qué:
    auditoría de la revisión cerrada; se reescriben al volver a cerrar).
  - closed → closed: mantiene snapshot y pins existentes (no re-freeze).

### `packages/domain/src/exportIssues.ts`
- 2 calls a `resolveBom` ahora pasan `item.structureRevisionPin`.

### `packages/domain/src/index.ts`
- Reexporta `StructureRevision` (type) y toda la API de versioning
  (`DEFAULT_STRUCTURE_REVISION`, `bumpStructureRevision`,
  `captureProjectItemStructurePins`, `resolveStructureForPin`,
  `resolveStructureRevision`, `snapshotStructureRevision`,
  `structureRevision`, `ResolvedStructureRevision`).

### Tests
- `packages/domain/src/structures/versioning.test.ts` (NUEVO, 14 casos):
  bump incrementa 1→2 / reporta oldRevision / snapshot intacto en history[0] /
  segunda edición → rev 3 con history.length 2 newest-first / ignora draft
  smuggle de id-revision-history / trata legacy undefined como 1 / pin
  undefined → actual / pin actual → actual / pin en history → frozen verbatim /
  pin desconocido → ResolutionError con contexto completo /
  resolveStructureForPin reifica / snapshot solo captura BOM-relevante /
  structureRevision normaliza / captureProjectItemStructurePins pega correcto +
  deja no-aplicables + sobrescribe stale.
- `packages/domain/src/engine.test.ts`: 1 test de no-regresión en el
  `describe` de snapshot — cotización cerrada con pin en rev 1, editar
  estructura a rev 2 (componentes 1×→3×), re-resolver → BOM sigue siendo 1
  pieza (rev 1); draft sin pin ve 3 piezas; breakdown cerrado no cambia.

## Decisiones de diseño no triviales

### 1. `revision` y `history` son **opcionales** en el tipo (no requeridos)

El plan prefería requerido + actualizar fixtures. **No fue viable** sin tocar
source fuera de scope:
- `apps/web/src/App.tsx:220 draftToStructure()` construye `Structure` desde un
  draft del editor y **no** se permite tocar `apps/web` source. Si `revision`
  fuera requerido, este archivo (y los editores UI) dejarían de compilar.
- Hay >10 literales `Structure` en tests/fixtures (plantillaDemo,
  engine.test.ts, optionChoices.test.ts, exportIssues.test.ts,
  StructuresScreen.test.tsx, module3dPreview.test.ts, project3dPreview.test.ts,
  App.tsx, etc.).

Solución: `revision?: number` + `history?: readonly StructureRevision[]`,
normalizados a `1`/`[]` dentro de las helpers (`structureRevision`,
`bumpStructureRevision`). Semántica idéntica para el caller; legacy data
tratada como rev 1. Cumple la cláusula de escape explícita del plan.

### 2. Pin al `resolveBom` vía parámetro opcional (no wrapper nuevo)

El `resolveBom` original no recibe el `item` — solo `(module, optionChoices,
catalog, measurePresetId)`. Opciones eran:
- (a) cambiar firma pública para recibir `item` — rompe los 2 callers en
  `packages/ui` (module3dPreview, project3dPreview) que no tienen item.
- (b) crear un wrapper `resolveBomForItem(item, ...)` — más superficie.
- **(c) añadir `structureRevisionPin?: number` como 5º parámetro opcional**
  (elegida). Mínimo cambio, firma pública compatible, los callers que no
  tienen pin (UI preview) siguen funcionando sin modificación. Los 5 callers
  internos del dominio + 2 de exportIssues pasan `item.structureRevisionPin`.

### 3. `resolveStructureRevision` devuelve `ResolvedStructureRevision` + helper `resolveStructureForPin`

`resolveBom` necesita alimentar `resolveComposedModule({ structure, ... })` que
espera un `Structure` completo. Para no romper ese contrato, expongo dos capas:
- `resolveStructureRevision(s, pin)` → DTO lean con solo los campos resueltos
  (lo que pide el plan textualmente).
- `resolveStructureForPin(s, pin)` → `Structure` completa reificada (para
  `resolveBom`). Internamente llama al anterior + `reifyResolvedStructure`.

### 4. Pins se conservan al reabrir (draft)

Al reabrir (`closed → draft`) se elimina `priceSnapshot` pero **no** los pins.
Razón: el snapshot de precios se recalcula al cerrar, pero los pins son
historia de auditoría — permiten re-resolver exactamente la revisión que tenía
la cotización cuando se cerró, incluso después de reabrir. Se reescriben en el
siguiente cierre. Comentario in situ lo justifica.

### 5. No se tocaron backend-go / storage / ui source

Como pide el alcance. El mirror Go de `resolveStructureRevision` y el wiring
de `bumpStructureRevision` en la edit-flow UI son Slices 2–4. Los tests
existentes de ui/web que referencian `Structure` siguen pasando sin cambio
gracias a la opcionalidad de `revision`.

## Autoverificación

```
$ pnpm --filter @muebles/domain exec tsc --noEmit
(sin output — verde)

$ pnpm typecheck   # monorepo completo
packages/domain    Done
packages/storage   Done
packages/excel     Done
packages/ui        Done
apps/desktop       Done
apps/web           Done

$ pnpm test        # monorepo completo
packages/domain    19 files / 199 tests   (verde; +14 versioning +1 regression)
packages/storage    5 files /  34 tests   (verde)
packages/excel      6 files /  25 tests   (verde)
packages/ui        37 files / 296 tests   (verde)
apps/desktop        2 files /   9 tests   (verde)
apps/web           10 files /  87 tests   (verde)
```

Sin cambios a source de `packages/ui`, `packages/storage`, `backend-go`,
`apps/*`. Sin cambios a fixtures compartidos (`plantillaDemo.ts`) — la
opcionalidad de `revision` los dejó compatibles.

## Desviaciones del plan

1. **`revision` opcional en vez de requerido** (ver decisión #1 arriba) —
   forzada por la restricción de no tocar `apps/web` source.
2. **`resolveStructureRevision` devuelve además `resolveStructureForPin`**
   (helper extra) para integrar limpiamente con `resolveComposedModule` sin
   cambiar su contrato.
3. **Parámetro opcional en `resolveBom`** en vez de pasar el `item` completo
   — menor superficie de rotura, firma pública estable.

Ninguna desviación cambia la semántica especificada en el plan.
