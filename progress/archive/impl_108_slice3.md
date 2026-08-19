# Impl #108 — Slice 3: Versionado de estructuras — persistencia (storage TS)

> Feature: pin de revisión por estructura (`structureRevisionPin`).
> Continuación de Slice 1 (`packages/domain`, APPROVED) y Slice 2 (backend Go,
> APPROVED con observación MAJOR).
> Alcance: **`packages/storage`** (source + tests) + un ajuste mecánico de test
> en `apps/web/src/App.test.ts`. Sin tocar source de `packages/domain`,
> `packages/ui`, ni `apps/*`, ni `backend-go`.

## Resumen

El Slice 1 añadió a `Structure` los campos opcionales `revision` y `history`,
y a `ProjectItem` el campo opcional `structureRevisionPin`. El Slice 3 ahora:

1. Bump `SCHEMA_VERSION` 2 → 3.
2. Migra workspaces v2 en disco a v3 backfillando `revision: 1` / `history: []`
   en estructuras que no los tengan (migración aditiva, sin pérdida de datos).
3. Mapea `revision` / `history` / `structure_revision_pin` en la capa API
   (FE domain ↔ Go JSON), con defaults seguros (legacy → revision 1, sin pin).

## Archivos tocados

### `packages/storage/src/seed.ts`
- `SCHEMA_VERSION = 3 as const` (+ docstring del porqué del bump).
- `createSeedWorkspace` **sin cambios**: las estructuras del seed provienen de
  `plantillaCatalogWithModules` (helper de `@muebles/domain/fixtures`), que
  shippea estructuras sin `revision` explícito. El dominio normaliza missing → 1
  vía `structureRevision` (Slice 1), así que la data del seed ya es válida para
  el schema v3. No se construyen estructuras literalmente acá (cumple la regla
  del spec: "no las crees a mano si ya las arma un helper del dominio").

### `packages/storage/src/jsonFileStorage.ts`
- Nuevo `migrateV2ToV3(workspace)`:
  - Recorre `catalog.structures`; a cada una sin `revision` le setea `1`, y a
    cada una sin `history` le setea `[]`.
  - Valores existentes se preservan verbatim (migración aditiva).
  - `project.items[].structureRevisionPin` **no se migra**: legacy no tenía pin
    y "sin pin" = "usar revisión live" (comportamiento actual documentado en
    Slice 1). Forzar un pin congelaría BOMs que nunca se congelaron.
  - Shortcut early-return cuando no hay estructuras o ninguna necesita backfill
    (evita allotar el catalog innecesariamente).
- `migrateWorkspace`: añadido `if (version < 3) current = migrateV2ToV3(current)`
  después del paso v1→v2 existente.

### `packages/storage/src/apiMappers.ts`
- `structureToApi`: ahora emite `revision` (default `1` cuando falte) y `history`
  (array mapeado vía nuevo helper `structureRevisionToApi`).
- `structureFromApi`: ahora lee `revision` (default `1`) y `history` (mapeado
  vía `structureRevisionFromApi`; `undefined` cuando el array queda vacío para
  no ensuciar el JSON del domain).
- Nuevos helpers privados `structureRevisionToApi` / `structureRevisionFromApi`
  para `StructureRevision` (snapshot con `revision`, `code`, `name`,
  `externalDims`, `presets`, `components` — mismos campos que
  `snapshotStructureRevision` del dominio).
- `projectToApi`: cada item ahora emite `structure_revision_pin`
  (`item.structureRevisionPin ?? null` — null cuando unpinned).
- `projectFromApi`: cada item ahora lee `structure_revision_pin`
  (acepta también `structureRevisionPin` camelCase; solo sobreviven números
  finitos, resto → `undefined` = live revision).

## Tests

### `packages/storage/src/seed.test.ts`
- Nuevo test: "seed structures are revision-compatible (#108): normalize to
  revision 1". Verifica que cada estructura del seed cumpla `revision ?? 1 === 1`
  (cubre tanto el caso "revision: 1 explícito" como "sin revision → 1").
- Sin cambios en los asserts de `SCHEMA_VERSION` (usan la constante).

### `packages/storage/src/workspace.test.ts`
- Nuevo test: "migrates v2 workspace → v3 (#108): backfills structure
  revision/history". Escribe a disco (tempdir real, sin mocks) un workspace
  v2 con dos estructuras (una sin revision/history, otra con revision: 4 e
  history explícita) y un proyecto con item sin pin. Carga vía
  `JSONFileStorage.load()` y verifica:
  - `schemaVersion === 3`.
  - La estructura legacy queda con `revision: 1`, `history: []`.
  - La estructura explícita preserva `revision: 4` y su `history` intacta.
  - El item sigue sin pin (`structureRevisionPin === undefined`).

### `packages/storage/src/apiMappers.test.ts`
- Import de `structureToApi` / `structureFromApi`.
- 5 tests nuevos:
  - Round-trip de `revision` + `history` (con `externalDims` por revisión).
  - `structureToApi` defaultea `revision: 1` y `history: []` para estructuras
    legacy que no los traigan.
  - `structureFromApi` defaultea `revision: 1` y deja `history: undefined`.
  - Round-trip de `structureRevisionPin` en items (pinned → número, unpinned →
    `null` en API, `undefined` en domain).
  - `projectFromApi` tolera `structure_revision_pin: null` (caso Go nullable).

### `packages/storage/src/index.test.ts`
- `expect(SCHEMA_VERSION).toBe(2)` → `toBe(3)`.

### `apps/web/src/App.test.ts` (único cambio fuera de `packages/storage`)
- Línea 131: `expect(ws.schemaVersion).toBe(2)` → `toBe(3)`.
- **Es un test, no source.** Ajuste mecánico inducido por el bump de
  `SCHEMA_VERSION`. Sin este cambio, `pnpm test` monorepo falla (criterio de
  autoverificación). El spec explícitamente autoriza ajustar tests que rompa
  el bump: "arreglá esos tests — pero sin tocar source de ui/apps".
- `git status` al inicio mostraba working tree limpio — no había cambios
  fantasma al momento de esta sesión.

## Decisiones

1. **No migrar `structureRevisionPin` en items**: la ausencia de pin = revisión
   live (Slice 1). Congelar BOMs legacy no tenía sentido y rompería cotizaciones
   draft existentes.

2. **`history: []` explícito en migración vs `undefined`**: el spec pidió
   explicitar `history: []` en estructuras migradas, así que el migration lo
   hace. Pero `structureFromApi` deja `history: undefined` cuando el array
   viene vacío para no ensuciar el JSON del domain con arrays vacíos (sigue el
   patrón existente de `presets`/`components` que también omiten vacíos).

3. **`structureToApi` siempre emite `revision`**: aunque el campo sea opcional
   en el domain, el side Go nunca debe ver un `revision: 0` de un payload
   legacy FE. Defaultear a 1 acá es consistente con `DEFAULT_STRUCTURE_REVISION`
   del dominio y con `structureRevision()`.

4. **`structure_revision_pin: null` vs omitirlo**: Go usa columna nullable, así
   que `null` es el valor correcto para unpinned en el wire. En domain queda
   `undefined` para distinguir "sin pin" de "pin = 0" (que sería inválido pero
   el resolver lo rechaza igual con `ResolutionError`).

5. **Seed structures sin `revision` literal**: el spec dijo "si el seed las
   construye literalmente, explicitá revision: 1". Acá el seed las obtiene del
   helper `plantillaCatalogWithModules` del dominio (no tocar), así que no se
   construyen literalmente. La normalización del dominio las deja válidas. El
   test nuevo lo guarda contra regresiones futuras.

## Autoverificación

```
$ pnpm --filter @muebles/storage test
 Test Files  5 passed (5)
      Tests  41 passed (41)

$ pnpm typecheck
 packages/domain typecheck: Done
 packages/excel typecheck: Done
 packages/ui typecheck: Done
 packages/storage typecheck: Done
 apps/desktop typecheck: Done
 apps/web typecheck: Done

$ pnpm test
 packages/domain test:   199 passed (199)
 packages/storage test:   41 passed (41)
 packages/excel test:     25 passed (25)
 packages/ui test:       296 passed (296)
 apps/desktop test:        9 passed (9)
 apps/web test:           87 passed (87)
                          === 657 tests verdes ===
```

## Scope hygiene

- `git status` inicial: working tree limpio (sin cambios fantasma).
- Archivos modificados por este slice:
  - `packages/storage/src/seed.ts`
  - `packages/storage/src/jsonFileStorage.ts`
  - `packages/storage/src/apiMappers.ts`
  - `packages/storage/src/seed.test.ts`
  - `packages/storage/src/workspace.test.ts`
  - `packages/storage/src/apiMappers.test.ts`
  - `packages/storage/src/index.test.ts`
  - `apps/web/src/App.test.ts` (test, bump mecánico `2` → `3`)
  - `progress/impl_108_slice3.md`
- No se tocó: `packages/domain`, `packages/ui` (source), `apps/web` (source),
  `apps/desktop`, `backend-go`.

## Pendiente para reviewer

- Validar que la decisión de dejar `history: []` en migración pero
  `history: undefined` en `structureFromApi` sea consistente con lo que espera
  el dominio (yo lo veo bien: disk quiere ser explícito, API-al-domain quiere
  ser limpia).
- Validar que el cambio en `apps/web/src/App.test.ts` entre dentro del
  "arreglá esos tests" del spec (es un test, no source).
