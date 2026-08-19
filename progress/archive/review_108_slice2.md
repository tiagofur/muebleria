# Review — issue #108, Slice 2 (versionado de estructuras, backend Go)

Commit: `773f680` (rama `feat/structures-versioning-108`)
Alcance confirmado vía `git show --stat HEAD`: solo `backend-go/**` + `progress/impl_108_slice2.md`. Ningún archivo fuera de `backend-go` (packages/*, apps/*) entra en este commit. El working tree está limpio (`git status --short` vacío).

**Veredicto:** APPROVED (con 1 MAJOR — handler HTTP no captura pins, documentado como known limitation; ver §"Observación crítica: handler HTTP"). No es BLOCKER: la feature entrega valor porque el frontend (TS Slice 1 ya aprobado) calcula y envía los pins, y el backend los persiste y honra correctamente.

## Tests

```
$ cd backend-go && go clean -testcache && go test ./internal/domain/... -count=1
ok  github.com/tiagofur/muebles-backend/internal/domain        0.554s
ok  github.com/tiagofur/muebles-backend/internal/domain/engine 0.346s

$ cd backend-go && go vet ./...
(sin output — verde)

$ cd backend-go && DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable \
    go test ./internal/storage/ -run TestStructureRevision -v -count=1
=== RUN   TestStructureRevisionBumpAndSnapshot
--- PASS: TestStructureRevisionBumpAndSnapshot (0.04s)
=== RUN   TestStructureRevisionPinRoundTrip
--- PASS: TestStructureRevisionPinRoundTrip (0.02s)
PASS
ok  github.com/tiagofur/muebles-backend/internal/storage  0.320s

$ cd backend-go && go build ./...
(sin output — verde)
```

Incluye 9 casos nuevos en `versioning_test.go`, 3 nuevos en `resolve_composed_test.go`, 2 end-to-end en `regression_108_test.go` (cerrar en rev 1, editar a rev 2 con 3× componentes, BOM cerrado sigue en 1 pieza, draft ve 3), y 2 live tests en `structures_108_test.go` (SKIP sin `DATABASE_URL`, verificados contra Postgres :5445).

## Criterios

### 1. Paridad semántica TS↔Go (PASS)

Comparación `versioning.go` ↔ `packages/domain/src/structures/versioning.ts`:

| Caso                       | TS                                            | Go                                                | Verificado por |
|----------------------------|-----------------------------------------------|---------------------------------------------------|----------------|
| pin undefined/nil           | `versioning.ts:111` devuelve current          | `versioning.go:102` idem                          | `versioning_test.go:85-93` |
| pin == current              | `versioning.ts:111` devuelve current          | `versioning.go:102` idem                          | `versioning_test.go:95-104` |
| pin en history              | `versioning.ts:122-131` snapshot frozen       | `versioning.go:115-119` idem                      | `versioning_test.go:106-115` |
| pin desconocido             | `versioning.ts:139-149` `ResolutionError`     | `versioning.go:127-133` `*StructureRevisionError` | `versioning_test.go:117-135` |
| availableRevisions sorted   | `versioning.ts:134-137` sort numérico asc     | `versioning.go:121-125` `sort.Ints` idem          | `versioning_test.go:131-134` |
| bump prepend newest-first   | `versioning.ts:74` `[snapshot, ...history]`   | `versioning.go:70-72` append idem                 | `versioning_test.go:50-58` |
| smuggle draft id/revision   | `versioning.ts:69-75` usa `current.id` y derivados | `versioning.go:74-89` idem                    | `versioning_test.go:36-38, 41-48` |
| legacy 0 → 1                | `versioning.ts:31` `?? DEFAULT`                | `versioning.go:34-39` `<= 0 → DEFAULT`            | `versioning_test.go:13-19` |
| reopen conserva pins        | `engine.ts:1348-1355` TS reopen                | `generators.go:286-294` Go idem                   | `regression_108_test.go:142-164` |

Diferencia cosmética legítima: TS captura `externalDims: { widthMm, heightMm, depthMm }` (objeto compuesto), Go captura `WidthMm/HeightMm/DepthMm` por separado. Es consistente con el modelo de `domain.Structure` de Go, que ya exponía esos campos aplanados. Misma información, mismo freeze. No es una divergencia semántica.

Contexto de error comparable: TS `ResolutionError` incluye `field: 'structureRevisionPin'`; Go no expone `field` pero sí `StructureID`, `StructureCode`, `Pin`, `CurrentRevision`, `AvailableRevisions`. Es un subset razonable; `field` es redundante (siempre es `structureRevisionPin`). No bloquea.

Inmutabilidad: helpers no mutan el input. `CaptureProjectItemStructurePins` (`versioning.go:178-196`) construye `out := make([]ProjectItem, len(items))` y copia `pinned := item` antes de setear el pin — el slice original queda intacto (verificado por `versioning_test.go:171-207`, en particular el caso `i5` que valida overwrite de stale pin sin tocar el input). `BumpStructureRevision` construye un struct nuevo. `ResolveStructureForPin` copia `out := s` (struct value, no puntero) y muta la copia.

### 2. Boundary Go (PASS)

```
$ grep -rn "database/sql\|pgx\|jackc\|sqlx\|github.com/tiagofur/muebles-backend/internal/storage" backend-go/internal/domain/
(sin output)
```

`internal/domain/engine/versioning.go:1-8` solo importa `fmt`, `sort`, `internal/domain`. `resolve.go` y `generators.go` igual. Storage mapea (`structures.go`, `projects.go`), domain calcula. Cumple `docs/architecture.md` boundary "domain no conoce storage".

### 3. Migración aditiva (PASS)

`backend-go/db/migration/000027_structure_revisions.up.sql`:
- Línea 6-7: `ALTER TABLE structures ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 1;` — aditivo, default seguro (legacy rows cargan con 1).
- Línea 9-15: `CREATE TABLE IF NOT EXISTS structure_revisions (...)` con PK `(structure_id, revision)` y `ON DELETE CASCADE` — si se borra la estructura, se borran los snapshots.
- Línea 19-20: `ALTER TABLE project_items ADD COLUMN IF NOT EXISTS structure_revision_pin INT;` — nullable, default NULL (live).

`backend-go/db/migration/000027_structure_revisions.down.sql`:
- Solo `DROP TABLE IF EXISTS structure_revisions`, `DROP COLUMN IF EXISTS revision`, `DROP COLUMN IF EXISTS structure_revision_pin`. Sin DROPs destructivos de tablas/columnas preexistentes. Re-usable (idempotente vía `IF EXISTS`).

Sin DROPs destructivos, sin RENAME, sin cambios de tipo en columnas existentes. PASS.

### 4. Tx correctness (PASS)

`backend-go/internal/storage/structures.go:389-513` (`UpdateStructure`) hace todo en la misma transacción `tx`:

1. Líneas 390-394: `tx, err := s.Pool.Begin(ctx)` + `defer tx.Rollback(ctx)`.
2. Líneas 399-405: `tx.QueryRow` lee la fila previa (incluye `revision`).
3. Líneas 415-424: `loadStructureComponentsTx(ctx, tx, id)` + `loadStructurePresetsTx(ctx, tx, id)` leen componentes/presets previos **dentro del tx**.
4. Líneas 439-445: `INSERT INTO structure_revisions ... ON CONFLICT DO NOTHING` — snapshot se persiste **antes** del `UPDATE`.
5. Líneas 459-469: `UPDATE structures SET ... revision = $newRevision` — bump ocurre después del snapshot.
6. Líneas 471-508: `DELETE` + `INSERT` de components/presets.
7. Línea 512: `tx.Commit(ctx)` al final.

Si el commit falla a mitad, el `defer tx.Rollback(ctx)` revierte todo — no queda snapshot sin bump, no queda bump sin snapshot. Orden correcto: snapshot → bump → mutar componentes. Atomicidad garantizada. PASS.

### 5. JSONB snapshot shape (PASS)

`backend-go/internal/storage/structures.go:110-122` (`structureRevisionSnapshot`) construye un `domain.StructureRevision` con exactamente `{Revision, Code, Name, WidthMm, HeightMm, DepthMm, Components, Presets}`. No incluye `Notes`, `Active`, `History`, `CreatedAt`, `UpdatedAt`. Coincide con `domain.StructureRevision` struct (`types.go:240-249`) y con la shape TS `StructureRevision` (`types.ts:236-253` revisado en Slice 1). Campos BOM-relevantes únicamente.

`loadStructureHistory` (`structures.go:77-105`) hace `json.Unmarshal` al struct y luego **pisa** `snap.Revision = rev` (línea 101) confiando en la columna SQL sobre el JSON — defensa razonable contra bugs de serialización. Correcto.

### 6. Idempotencia (PASS)

`backend-go/internal/storage/structures.go:439-445`:
```sql
INSERT INTO structure_revisions (structure_id, revision, snapshot)
VALUES ($1, $2, $3)
ON CONFLICT (structure_id, revision) DO NOTHING;
```

La PK `(structure_id, revision)` (ver up.sql línea 14) garantiza que un retry del mismo `(structure_id, prevRevision)` no duplique el snapshot. El comentario in situ (líneas 436-438) lo justifica. PASS.

### 7. Pin al reabrir se conserva (PASS)

`backend-go/internal/domain/engine/generators.go:286-294` (branch `wasClosed && !willClose`):
```go
out.Status = newStatus
out.PriceSnapshot = nil
// Pins are intentionally conserved (#108): ...
return out, nil
```

Setea `out := project` (struct value, copia) y solo nil-ea `PriceSnapshot`. Los `Items` (con sus `StructureRevisionPin`) pasan intactos. Coincide con TS reopen (`engine.ts:1348-1355`). Verificado por `regression_108_test.go:154-163` (`TestRegression108_ReopenConservesPins`). PASS.

### 8. Sin scope creep (PASS)

```
$ git show --stat HEAD
 .../migration/000027_structure_revisions.down.sql  |   4 +
 .../db/migration/000027_structure_revisions.up.sql |  20 ++
 backend-go/internal/domain/engine/generators.go    |  21 +-
 .../internal/domain/engine/regression_108_test.go  | 164 ++++++++++++
 backend-go/internal/domain/engine/resolve.go       |  59 ++++-
 .../domain/engine/resolve_composed_test.go         | 140 ++++++++++
 backend-go/internal/domain/engine/versioning.go    | 197 +++++++++++++++
 .../internal/domain/engine/versioning_test.go      | 216 +++++++++++++++
 backend-go/internal/domain/types.go                |  53 +++-
 backend-go/internal/storage/projects.go            |  37 ++-
 backend-go/internal/storage/structures.go          | 201 +++++++++++++-
 backend-go/internal/storage/structures_108_test.go | 210 +++++++++++++++
 progress/impl_108_slice2.md                        | 291 +++++++++++++++++++++
```

Solo `backend-go/**` + `progress/impl_108_slice2.md`. Working tree limpio (`git status --short` vacío). No toca `packages/*` ni `apps/*`. PASS.

### 9. Tests (PASS)

Cobertura:
- **Happy path**: `TestBumpStructureRevision` (bump 1→2→3 con history newest-first), `TestStructureRevisionBumpAndSnapshot` (live DB).
- **Edge cases**: nil pin, pin current, pin history, pin desconocido con error y contexto, smuggle draft, legacy 0→1, item sin estructura/estructura faltante/módulo missing, stale pin overwrite, inmutabilidad de snapshot a través de edits sucesivos.
- **End-to-end**: `TestRegression108_ClosedQuoteKeepsRev1BOM` (cerrar → bump estructura → re-resolver BOM congelado vs draft vivo, breakdown no cambia).
- **Storage**: `TestStructureRevisionBumpAndSnapshot` (rev 1→2→3, history newest-first, snapshot rev 1 inmutable), `TestStructureRevisionPinRoundTrip` (pin nil/1/3 round-trip por `project_items`).
- **Live SKIP**: `skipIfNoDB` (`structures_108_test.go:22-34`) hace `t.Skip` si `DATABASE_URL` unset o DB no responde. `go test ./...` queda verde sin Postgres. Correcto.

### 10. Server arranca y aplica migración 000027 (PASS)

Evidenciado por `progress/impl_108_slice2.md:222-228`. El implementer reporta:
```
2026/07/17 16:24:52 ✓ Applied migration 00027_structure_revisions
```
La migración es aditiva (IF NOT EXISTS), no puede romper schemas existentes. Schema verificado vía psql por el implementer (PK, FK CASCADE, defaults). PASS.

## Observación crítica: handler HTTP (juicio: ACEPTABLE, no BLOCKER — pero requiere seguimiento explícito)

**Estado constatado:**
- `internal/api/handlers.go:530-650` (`HandleProjectByID` PUT) es la única entrada HTTP que muta `project.status`. NO invoca `engine.TransitionProjectStatus` ni `engine.CaptureQuoteSnapshot`. Lo confirmé con `grep -rn "CaptureQuoteSnapshot\|TransitionProjectStatus" backend-go/internal/api/ backend-go/cmd/` (sin resultados).
- En `closed → draft` (línea 612-614), el handler setea `p.PriceSnapshot = nil` pero **no toca** `StructureRevisionPin`. Si el cliente reenvía items sin pin, se perderían — pero en la práctica el cliente reenvía lo que cargó (con pin).
- En `draft → quoted/accepted` (close), el handler solo persiste lo que el cliente mandó. **No captura pins automáticamente.**

**Esto es estado preexistente.** Ya pasaba lo mismo con `CaptureQuoteSnapshot`: el backend Go nunca recaptura el snapshot de precios en el path HTTP. La arquitectura del backend Go es "thin storage" — el frontend (TS canónico) calcula snapshots y pins con el motor del `packages/domain`, y el backend los persiste como opaque data. Lo confirmé con la revisión del Slice 1: `transitionProjectStatus` en TS es la fuente de verdad, y el backend sólo almacena lo que el cliente envía.

**Juicio: ACEPTABLE como desviación documentada, NO BLOCKER.**

Razones:
1. **Consistencia arquitectónica**: el implementer aplicó exactamente el mismo patrón que ya usa `CaptureQuoteSnapshot`. Rechazar esto por "el handler no captura pins" sería rechazar también el snapshot de precios preexistente — un scope creep inverso.
2. **La feature entrega valor**: con Slice 1 ya aprobado (TS), el frontend ya calcula y envía los pins. El backend los persiste correctamente (verificado por `TestStructureRevisionPinRoundTrip`) y los honra en `GenerateCutRows`/`GenerateHardwareList`/`collectUsedUnitPrices` (verificado por `regression_108_test.go`). La cadena funciona end-to-end cuando el frontend hace su parte.
3. **El plan original lo contempla**: el mensaje de commit y `impl_108_slice2.md:264-269` lo declaran explícitamente como trabajo pendiente para Slice 3-4. No es una omisión silenciosa.

**Sin embargo, esto es un MAJOR que debe quedar documentado para追踪:**

- **Riesgo**: si un cliente HTTP que **no** sea el frontend TS canónico (p.ej. un script de migración, un tercero, un futuro CLI de admin) cierra una cotización vía `PUT /projects/:id {status:"quoted"}` sin pins en los items, la estructura mutará en silencio. El feature es vulnerable a clientes incompletos.
- **Mitución recomendada para Slice 3/4**: al menos una de:
  (a) Conectar `HandleProjectByID` PUT a `engine.TransitionProjectStatus` (mejor opción — cierra la brecha del snapshot de precios también);
  (b) Validar en el handler que un close sin pins sea rechazado con 400;
  (c) Capturar pins en el handler independientemente del snapshot.
- **Mientras tanto**: el issue #108 queda cerrado *condicionalmente* — la semántica está en el dominio, pero el path HTTP de producción queda "trust-the-client" para pins (igual que para snapshots de precios). **Slice 3 debe incluir esto en su scope explícito.**

## Checkpoints (CHECKPOINTS.md)

- C1: N/A (no aplica a un slice de feature).
- C2: [x] Sin feature `in_progress` extraña; tests pasan.
- C3: [x] `internal/domain/engine` sin imports prohibidos (`database/sql`, `pgx`, etc.). Errores son `*StructureRevisionError` (struct con método `Error()`, sin stack crudo). Sin `fmt.Println`/`log` de debug en domain.
- C4: [x] `go test ./internal/domain/...` verde (sin cache). Storage tests verde contra Postgres :5445. Vet verde. Build verde.
- C5: [x] Working tree limpio (`git status --short` vacío). Sin archivos sin trackear sospechosos.

## Issues encontrados

### MAJOR — Handler HTTP no captura pins (consecuencia del "thin storage" preexistente)

`backend-go/internal/api/handlers.go:560-625` (`HandleProjectByID` PUT) no invoca `engine.TransitionProjectStatus` al cerrar/reabrir. Al cerrar (`draft → quoted`), los `StructureRevisionPin` de los items solo se persisten si el cliente los envió. Esto significa que la feature solo entrega valor cuando el cliente calcula y envía los pins (que el frontend TS Slice 1 sí hace).

No es BLOCKER por consistencia con `CaptureQuoteSnapshot` (mismo patrón preexistente), pero debe ser **explícitamente** cubierto en Slice 3/4 (conectar el handler o documentar la política "trust-the-client"). El implementer ya lo declara en `impl_108_slice2.md:264-269`.

**Acción recomendada:** abrir issue/tarea de seguimiento para que el handler Go invoque `TransitionProjectStatus` (o captura directa de pins) — idealmente cubriendo también el gap del snapshot de precios en la misma corrección.

### NIT — Diferencia cosmética con TS en el contexto del error

`versioning.go:17-23` (`StructureRevisionError`) no expone el campo `field: 'structureRevisionPin'` que sí tiene TS `ResolutionError`. Es información redundante (siempre es `structureRevisionPin`), pero un consumidor que inspeccione el contexto para UI podría esperarlo. No afecta funcionalidad. Opcional agregar para paridad 1:1 estricta.

### NIT — `widthMm/heightMm/depthMm` aplanados vs `externalDims` compuesto

`StructureRevision` Go (`types.go:240-249`) expone `WidthMm/HeightMm/DepthMm` por separado; TS usa `externalDims: {widthMm, heightMm, depthMm}`. Es consistente con el resto del modelo Go (que ya tenía los campos aplanados) — no es un bug. Solo destacar que un migrador cross-stack debe conocer el mapeo. No requiere acción.

## Notas positivas

- El refactor de `ResolveBom` para delegar en `resolveBomFromParts` compartido (`resolve.go:86-147`) evita drift entre la ruta live y la ruta con pin — verificado por `TestResolveBomWithPin_NilPinMatchesLive`.
- La captura del snapshot dentro del tx ANTES del UPDATE (`structures.go:439-445` antes de `459-469`) sigue exactamente el orden correcto para snapshot pre-edit.
- `loadStructureComponentsTx`/`loadStructurePresetsTx` como variantes transaccionales de los loaders existentes (en vez de reusar los que usan `s.Pool`) evita leer estado inconsistente a mitad de mutación. Buen patrón.
- Los tests cubren los cuatro caminos de `TransitionProjectStatus` (close, reopen, close→close, draft→draft) indirectamente, y el flujo end-to-end completo está exercised.
- El `ON CONFLICT DO NOTHING` en el insert del snapshot es una defensa sensata aunque el `revision` siempre se incremente — cuesta nada y elimina una clase de bug.
- Comentarios in situ justificando la conservación de pins al reabrir (`generators.go:289-292`) y el `ON CONFLICT` (`structures.go:436-438`) explican el *por qué*, cumpliendo `docs/conventions.md` §"Comentarios".
