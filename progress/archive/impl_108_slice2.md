# Impl #108 — Slice 2: Versionado de estructuras (backend Go)

> Feature: pin de revisión por estructura en el backend Go (#108 Slice 2).
> Mecanismo definido en `progress/impl_108_slice1.md` (TS canónico) y
> `progress/explore_108_structure_model.md`. Paridad semántica TS↔Go.
> Alcance: **solo `backend-go/`**. Sin tocar `packages/*` ni `apps/*`.

## Resumen

Cada `Structure` en el backend Go ahora es versionada: editarla (`UpdateStructure`
en storage) hace **bump** de `revision` (1→2→…) y persiste un **snapshot
inmutable** de los campos BOM-relevantes en la tabla nueva
`structure_revisions`. Al cerrar una cotización (`TransitionProjectStatus`
draft→quoted/accepted/produced), cada `ProjectItem` captura
`StructureRevisionPin *int` apuntando a la revisión actual. El motor
(`ResolveBomWithPin`) re-resuelve usando la estructura *pinneada* — o la actual
si no hay pin. Pines desconocidos lanzan `*StructureRevisionError` con contexto.
Reabrir conserva los pins (auditoría), igual que TS.

## Archivos tocados

### Migraciones (NUEVAS)
- `backend-go/db/migration/000027_structure_revisions.up.sql:1` —
  `ALTER TABLE structures ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS structure_revisions (structure_id, revision, snapshot JSONB, created_at)`,
  `ALTER TABLE project_items ADD COLUMN IF NOT EXISTS structure_revision_pin INT`.
- `backend-go/db/migration/000027_structure_revisions.down.sql:1` — reverso
  aditivo (`DROP TABLE IF EXISTS`, `DROP COLUMN IF EXISTS`). Sin `DROP` de
  columnas o tablas preexistentes.

### Domain (`backend-go/internal/domain/types.go`)
- `Structure` (`types.go:209`): añadidos `Revision int` (default 0 →
  normalizado a 1 por helpers) y `History []StructureRevision`.
- `StructureRevision` struct NUEVO (`types.go:235`): snapshot inmutable
  `{ Revision, Code, Name, WidthMm, HeightMm, DepthMm, Components, Presets }`
  (campos BOM-relevantes — notes/active/history fuera, igual que TS).
- `ProjectItem` (`types.go:307`): añadido `StructureRevisionPin *int`
  (nullable; nil = live).

### Engine (`backend-go/internal/domain/engine/`)
- `versioning.go` (NUEVO, ~210 líneas):
  - `DefaultStructureRevision = 1`
  - `StructureRevisionError` struct (mirrors TS `ResolutionError` context:
    `StructureID, StructureCode, Pin, CurrentRevision, AvailableRevisions`).
  - `StructureRevisionNumber(s)` — normaliza 0 → 1.
  - `SnapshotStructureRevision(s)` — construye snapshot BOM-relevante.
  - `BumpStructureRevision(current, nextDraft)` → snapshot prependeado
    newest-first; revision = oldRevision+1; ignora draft smuggle de
    id/revision/history.
  - `ResolveStructureRevision(s, *pin)` → `StructureRevision` o
    `*StructureRevisionError` (nil o ==current → actual; en history → frozen;
    desconocido → error con contexto + availableRevisions sorted).
  - `ResolveStructureForPin(s, *pin)` → `Structure` reificada shape-complete
    lista para `expandComposedModuleParts`.
  - `CaptureProjectItemStructurePins(items, catalog)` → items con pin pegado
    (nil para módulos sin estructura o estructura faltante; sobrescribe pins
    stale).
- `resolve.go`:
  - `ResolveBom` (líneas ~13-51): refactorizado a delegar en
    `resolveBomFromParts` compartido; `expandComposedModuleParts` ahora recibe
    pin nil (backward-compatible).
  - `ResolveBomWithPin(module, choices, catalog, measurePresetID, *pin)`
    (NUEVO, líneas ~61-81): variante #108-aware. Llama a
    `ResolveStructureForPin` antes de expandir componentes.
  - `resolveBomFromParts` (NUEVO, líneas ~86-150): material/edge/hardware
    resolution compartida por ambas entradas para evitar drift.
  - `expandComposedModuleParts` (líneas ~155-187): recibe `structureRevisionPin
    *int`; reifica estructura vía `ResolveStructureForPin` (lanza
    `*StructureRevisionError` para pin desconocido).
- `generators.go`:
  - 3 call sites ahora pasan `item.StructureRevisionPin` vía
    `ResolveBomWithPin`: `GenerateCutRows` (línea 52),
    `GenerateHardwareList` (línea 136), `collectUsedUnitPrices` (línea 200).
  - `TransitionProjectStatus` (líneas ~270-320):
    - draft→closed: además de adjuntar `priceSnapshot`, llama
      `CaptureProjectItemStructurePins(out.Items, catalog)`.
    - closed→draft (reopen): **conserva pins** (comentario justifica: auditoría
      de la revisión cerrada; se reescriben al volver a cerrar).
    - closed→closed: no re-freezea pins (mantiene los existentes, igual que TS).

### Storage (`backend-go/internal/storage/`)
- `structures.go`:
  - `loadStructureHistory(ctx, structureID)` (NUEVO, ~líneas 80-110): carga
    snapshots desde `structure_revisions` ordenados newest-first (DESC).
  - `structureRevisionSnapshot(rev, st)` (NUEVO): serializa
    `StructureRevision` a JSON para el snapshot.
  - `loadStructureComponentsTx` / `loadStructurePresetsTx` (NUEVOS): variantes
    transaccionales para leer el estado anterior dentro del tx de
    `UpdateStructure`.
  - `ListStructures` (~línea 113) y `GetStructureByID` (~línea 160): SELECT
    ahora trae `revision`; cargan `History` vía `loadStructureHistory`.
  - `UpdateStructure` (líneas ~190-300, **rewrite**): dentro del mismo tx,
    (1) lee la fila + componentes + presets anteriores; (2) serializa snapshot
    y lo INSERTA en `structure_revisions` con `ON CONFLICT DO NOTHING` (defensa
    idempotente); (3) UPDATE `structures` SET `revision = oldRevision+1`; (4)
    DELETE+INSERT de `structure_components` / `structure_presets` como antes.
    Escribe `st.Revision = newRevision` para que el caller vea el bump.
- `projects.go`:
  - `loadProjectItems` (línea 438): SELECT trae `structure_revision_pin`;
    mapea a `*int`.
  - `replaceProjectItemsTx` (línea 488): INSERT pasa
    `structure_revision_pin` (vía helper `structurePinArg`).
  - `AddProjectItem` (línea 695): INSERT pasa `structure_revision_pin`.
  - `structurePinArg(*int)` (NUEVO): convierte nil → SQL NULL.

### Tests
- `backend-go/internal/domain/engine/versioning_test.go` (NUEVO, 9 casos):
  normalización legacy, bump 1→2 / 2→3 con history newest-first / ignora
  smuggle, resolveStructureRevision (nil pin, pin current, pin history, pin
  desconocido → error con contexto y `availableRevisions` sorted), reify,
  captureProjectItemStructurePins (pega + deja no-aplicables + sobrescribe
  stale).
- `backend-go/internal/domain/engine/resolve_composed_test.go` (3 tests
  nuevos):
  - `TestResolveBomWithPin_HistoricalRevision` — fixture con estructura rev 2
    (1 costado) y snapshot rev 1 (3 costados); pin en rev 1 → BOM con 3 partes.
  - `TestResolveBomWithPin_UnknownPinErrors` — pin 99 produce
    `*StructureRevisionError` con contexto.
  - `TestResolveBomWithPin_NilPinMatchesLive` — pin nil idéntico a `ResolveBom`.
- `backend-go/internal/domain/engine/regression_108_test.go` (NUEVO, 2 tests):
  - `TestRegression108_ClosedQuoteKeepsRev1BOM` — fixture compuesto end-to-end.
    Cerrar proyecto pega pin rev 1 + freeze. Editar estructura a rev 2 (1→3
    costados). Re-resolver BOM del cerrado → sigue 1 costado (pin freeze);
    draft sin pin → ve 3 costados; breakdown congelado no cambia.
  - `TestRegression108_ReopenConservesPins` — reopen borra `priceSnapshot`
    pero conserva `structureRevisionPin` (auditoría).
- `backend-go/internal/storage/structures_108_test.go` (NUEVO, 2 tests de
  integración contra Postgres, SKIP si no hay `DATABASE_URL`):
  - `TestStructureRevisionBumpAndSnapshot` — crea estructura (rev 1), edita
    (rev 2 con qty 3, rev 3 con qty 5); verifica bump + 2 snapshots en
    `structure_revisions` newest-first + inmutabilidad del snapshot rev 1.
  - `TestStructureRevisionPinRoundTrip` — items con pin nil / 1 / 3
    round-tripean por `project_items.structure_revision_pin`.

## Decisiones de diseño no triviales

### 1. `ResolveBomWithPin` como función nueva (no cambiar firma variadic de `ResolveBom`)
`ResolveBom` ya era variadic en `measurePresetID ...string`. Go no permite un
parámetro opcional después de uno variadic. Opciones eran (a) wrapper nuevo, o
(b) struct de options. **Elegí wrapper nuevo** `ResolveBomWithPin(...)` para
preservar 100% de los callers existentes (incluyendo tests de
`resolve_composed_test.go` y `generators_test.go` que usan `ResolveBom` con
4 args) y exponer explícitamente el parámetro #108. `ResolveBom` ahora delega
en `resolveBomFromParts` (compartido), y `ResolveBomWithPin` también. Las dos
rutas no pueden derivar — verificado por `TestResolveBomWithPin_NilPinMatchesLive`.

### 2. `TransitionProjectStatus` es el análogo Go del TS `transitionProjectStatus`
Es el helper de dominio que captura snapshot + pins al cerrar. Como en TS, se
testeó pero **no es invocado por el handler HTTP de producción** — el handler
`HandleProjects` (líneas 580-625) maneja su propia lógica de reopen/produced y
manipula `PriceSnapshot` directamente (sin recálculo desde el catálogo). Esto
es **estado preexistente** (Slice 1 review confirmó la misma arquitectura para
`CaptureQuoteSnapshot`). Conectar el handler de producción a `TransitionProjectStatus`
(o capturar pins en el handler directo) es **trabajo de integración fuera de
este slice** — el plan pide replicar la semántica TS en el dominio Go, y los
tests cubren el flujo completo a través del helper.

### 3. `UpdateStructure` captura snapshot **antes** de mutar
El snapshot debe reflejar el estado previo. Dentro del tx:
1. `SELECT` fila previa + `loadStructureComponentsTx` + `loadStructurePresetsTx`.
2. `INSERT INTO structure_revisions` con `ON CONFLICT DO NOTHING` (defensa).
3. `UPDATE structures SET revision = $newRevision, ...`.
4. `DELETE` + `INSERT` de components/presets.

Esto garantiza atomicidad y que el snapshot sea exactamente el estado pre-edit.

### 4. `structure_revisions.snapshot` es JSONB con la shape de `StructureRevision`
Al cargar (`loadStructureHistory`), `json.Unmarshal` al struct Go y **pisamos**
`Revision` con la columna (`snap.Revision = rev`) para confiar en la fuente de
verdad SQL y no en el JSON (defensa contra bugs de serialización).

### 5. `revision == 0` tratado como `DefaultStructureRevision` (1)
Mismo patrón que TS (`revision?: number` normalizado a 1). Filas legacy (la
mayoría, creadas antes de #108) tienen `revision = 1` por el `DEFAULT 1` de la
migración — nunca llegan a 0 en disco. El guard de `StructureRevisionNumber`
trata `0` como 1 por defensividad.

### 6. Pins al reabrir se conservan (igual que TS)
Al reabrir (`closed → draft`) se elimina `priceSnapshot` pero **no** los pins.
El `priceSnapshot` se recalcula al cerrar (freeze instantáneo de precios), así
que borrarlo al reabrir es correcto. Los pins son auditoría: permiten
re-resolver la revisión exacta hasta el próximo cierre. Comentario in situ en
`generators.go` lo justifica.

### 7. Tests de storage son live integration tests (SKIP sin DB)
El paquete `internal/storage` no tenía tests previos (no hay infraestructura
de TestMain/pgtest). Añadí tests que se SKIPean cuando `DATABASE_URL` no está
o la DB no responde, para que `go test ./...` quede verde en cualquier entorno.
Localmente (docker compose Postgres en :5445) ambos tests pasan — verificado.

## Autoverificación

```
$ cd backend-go && go build ./...
(sin output — verde)

$ cd backend-go && go vet ./...
(sin output — verde)

$ cd backend-go && go test ./...
ok      github.com/tiagofur/muebles-backend/cmd/admin
?       github.com/tiagofur/muebles-backend/cmd/server    [no test files]
ok      github.com/tiagofur/muebles-backend/db
ok      github.com/tiagofur/muebles-backend/internal/api
ok      github.com/tiagofur/muebles-backend/internal/auth
ok      github.com/tiagofur/muebles-backend/internal/config
ok      github.com/tiagofur/muebles-backend/internal/domain
ok      github.com/tiagofur/muebles-backend/internal/domain/engine
ok      github.com/tiagofur/muebles-backend/internal/storage   (2 tests SKIP)

$ cd backend-go && DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable \
    go test ./internal/storage/ -run TestStructureRevision -v
=== RUN   TestStructureRevisionBumpAndSnapshot
--- PASS: TestStructureRevisionBumpAndSnapshot (0.04s)
=== RUN   TestStructureRevisionPinRoundTrip
--- PASS: TestStructureRevisionPinRoundTrip (0.02s)
PASS
ok      github.com/tiagofur/muebles-backend/internal/storage
```

### Server arrancó ✓
```
$ cd backend-go && ./dev.sh
2026/07/17 16:24:52 Starting Muebles Backend Server...
2026/07/17 16:24:52 ✓ Database connection established successfully
2026/07/17 16:24:52 ✓ Applied migration 00027_structure_revisions
2026/07/17 16:24:52 Listening and serving HTTP on port 8080
```
(El `HTTP server ListenAndServe error: ... address already in use` final es
porque había otro server escuchando en :8080; la inicialización + migraciones
completaron OK — ese es el gate.)

### Schema verificado vía psql (docker exec muebles-postgres)
- `structure_revisions` con PK `(structure_id, revision)`, `snapshot JSONB`,
  FK `ON DELETE CASCADE`.
- `structures.revision INT DEFAULT 1`.
- `project_items.structure_revision_pin INT` (nullable).

## Paridad semántica con TS Slice 1 (verificada caso por caso)

| Caso                  | TS (`versioning.ts`)                          | Go (`versioning.go`)                          |
|-----------------------|-----------------------------------------------|-----------------------------------------------|
| pin undefined/nil     | devuelve current                              | `ResolveStructureRevision(s, nil)` → current  |
| pin == current        | devuelve current                              | idem                                          |
| pin en history        | devuelve snapshot frozen verbatim             | idem                                          |
| pin desconocido       | `ResolutionError` con contexto + available    | `*StructureRevisionError` con mismo contexto  |
| bump                  | history[0] = snapshot previo, newest-first    | idem (prepend en slice)                       |
| smuggle draft id/rev  | ignorado                                      | idem (construye struct nueva)                 |
| legacy undefined      | normaliza a 1                                 | `Revision <= 0` → 1                           |
| capturePins           | deja sin cambios items sin estructura         | idem                                          |
| reopen                | conserva pins                                 | idem                                          |

Los tests cubren cada caso: `versioning_test.go` (9 casos) +
`resolve_composed_test.go` (3 tests pin) + `regression_108_test.go` (2 tests
end-to-end) + `structures_108_test.go` (2 tests storage live).

## Desviaciones del plan

1. **`ResolveBomWithPin` como función separada en vez de 5º parámetro
   opcional**: Go no permite parámetro posicional después de variadic, y la
   firma pública de `ResolveBom(...measurePresetID string)` debía preservarse.
   El wrapper expone el pin explícitamente; `ResolveBom` sigue siendo la ruta
   live (sin pin). No cambia semántica — verified por test.
2. **El handler HTTP de producción no captura pins**: `TransitionProjectStatus`
   sí lo hace (test end-to-end cubre el flujo), pero el handler
   `HandleProjects` no la invoca hoy (igual que con `CaptureQuoteSnapshot` —
   estado preexistente). Conectar el handler (o capturar pins directamente ahí)
   es integración de Slice 3-4. El plan pide replicar la semántica TS en el
   dominio Go, lo cual está hecho y testeado.
3. **`structures.revision` default en disco es 1 (no 0)**: la migración usa
   `DEFAULT 1`, así que las filas legacy cargan con `revision=1` directamente.
   El guard en `StructureRevisionNumber` trata `0` como 1 por defensividad
   (structs Go construidos a mano sin pasar por la DB), pero el path normal
   nunca ve 0.
4. **Tests de storage son live integration tests SKIP-eables**: el paquete
   `internal/storage` no tenía tests. Añadí los dos que pide el plan con guard
   de `DATABASE_URL` para que `go test ./...` siga verde en CI sin Postgres.
   Localmente ambos pasan.

Ninguna desviación cambia la semántica especificada en el plan.

## Sin scope creep

Confirmado vía `git status`:
- Cambios source limitados a `backend-go/internal/domain/{types.go,engine/*}`
  y `backend-go/internal/storage/{structures.go,projects.go}`.
- Archivos sucios en `apps/web/src/App.tsx` y `packages/ui/src/preview3d/*`
  **preexistían** antes de este slice (ver `review_108_slice1.md`: "Los
  archivos sucios en el working tree (`apps/web/src/App.tsx`, varios
  `packages/ui/**`) NO pertenecen a este commit"). No los toqué.
- Ningún cambio a `packages/*` o `apps/*` source.
