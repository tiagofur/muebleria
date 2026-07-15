# Sesión actual

- **Feature en curso:** ninguna
- **Último cierre:** F028 — grain_inherited_from_material (veta heredada del material)

## Bugfix — Grupos de opciones no persistían (UpdateOptionGroup)

Los grupos creados desde la UI (F007) aparecían tras crearlos pero **desaparecían
al refrescar**: nunca llegaban a la base de datos.

### Causa raíz
- El frontend usa upsert (`apiWorkspaceRepository.upsert`): prueba `PUT
  /option-groups/{id}` y solo cae a `POST` (crear) si recibe **404**.
- `UpdateOptionGroup` (`storage/materials.go`) usaba `tx.Exec` para el `UPDATE`,
  que no trata "0 filas afectadas" como error. Ante un id inexistente el backend
  respondía **200 OK** sin haber tocado la BD → el `POST` nunca se ejecutaba.
- Drift frente a `UpdateMaterialBoard`, `UpdateEdgeBand`, `UpdateHardware`, que sí
  detectan `pgx.ErrNoRows` y devuelven `"... not found"` → 404.

### Cambio aplicado
- `backend-go/internal/storage/materials.go` — `UpdateOptionGroup` ahora usa
  `RETURNING id` + `QueryRow().Scan()` y mapea `pgx.ErrNoRows` →
  `"option group not found"`. El handler (`handlers.go:662`) ya convertía ese
  mensaje a 404, así que el upsert del frontend cae al `POST` y persiste.

### Verificación
- `go build ./...` y `go vet ./internal/...` limpios.
- `go test ./...` → verde (api, auth, config, domain, engine).
- `storage` no tiene tests de paquete; el fix replica el patrón probado de los
  otros 3 updates de catálogo.

### Alcance
- No es feature nueva: F007 sigue `done` (su CRUD UI ya existía). Es un fix de
  persistencia que hace que ese "done" sea efectivamente cierto.
- No requiere migración SQL (esquiafoma de la tabla no cambia).
- **Nota ops (IMPORTANTE):** el backend ya **NO** provisiona el admin al arrancar.
  Rotar la credencial débil existente con:
  `cd backend-go && JWT_SECRET=<...> go run ./cmd/admin reset-password --email tiagofur@gmail.com`
  El server exige `JWT_SECRET` (≥ 32 bytes); sin él se niega a arrancar.

## F028 — Veta heredada del material (grain_inherited_from_material)

La veta ("puede girar") deja de preguntarse por pieza y se hereda siempre del
material (`material.grainDefault`) al resolver la cotización/export — mismo
patrón que `edgeBandId`.

### Cambios aplicados
- **TS domain:** `BoardPart` sin campo `grain`; `resolveBom` materializa
  `ResolvedBoardPart.grain = material.grainDefault ? 1 : 0`. `ProductionCutRow.grain`
  se mantiene (valor derivado para el export). `duplicate.cloneBoardPart` sin grain.
- **TS storage:** `apiMappers` sin grain en boardPart (borrado `grainFromApi`);
  `SCHEMA_VERSION` 1→2; nuevo `migrateWorkspace()` en `jsonFileStorage.ts` que
  limpia el `grain` stale de board_parts de workspaces v1; `apiWorkspaceRepository`
  usa `SCHEMA_VERSION` en vez de literal `1`.
- **UI:** editor de pieza sin select "Veta"; detalle de pieza muestra "veta según
  material"; `BoardPartDraft` sin grain; `App.tsx` mapeo draft→BoardPart sin grain.
- **Go:** `BoardPart` sin `Grain`; `materials.go` ahora persiste `grain_default`
  (drift corregido: la columna faltaba en SQL y todas las queries);
  `projects.go` sin grain en queries de board_parts.
- **Migración SQL:** `000005_grain_to_material.up.sql` —
  `ADD COLUMN material_boards.grain_default BOOLEAN NOT NULL DEFAULT false` +
  `DROP COLUMN board_parts.grain`.

### Verificación
- `pnpm -r typecheck` → 6/6 paquetes limpios.
- `pnpm -r test` → 357 tests TS verde (domain 72, storage 26, excel 14, ui 182,
  desktop 7, web 56). Golden `modGab01CutRows.json` sin cambios (mapeo consistente).
- `cd backend-go && go test ./...` → verde.

### Nota ops pendiente
- Aplicar migración `000005_grain_to_material.up.sql` a Postgres (junto con la
  `000004` aún pendiente de F027).


## Stack vivo

- Postgres Docker `muebles-postgres` :5445
- API Go :8080
- Auth → `APIWorkspaceRepository`; guest → localStorage

## Bloque de seguridad — cambios aplicados (issues #1–#6)

- **#1** `config.LoadConfig()` → `(Config, error)`, fail-closed si falta `JWT_SECRET` o < 32 bytes.
- **#2** Removido `storage/seed.go` (creds hardcodeadas). Nuevo `cmd/admin` CLI (`create` / `reset-password`, prompt sin eco).
- **#3** `CORSMiddleware(allowedOrigins)` — allowlist reflejada por-request, `Vary: Origin`, nunca `*`.
- **#5** `respondWithInternalError(w, err, op)` en los ~40 sitios 5xx; auth/admin middleware responden JSON (no más `http.Error` ni leak de parser JWT).
- **#6** `RateLimitMiddleware` (token bucket por IP, `golang.org/x/time/rate`) en `/api/auth/login` y `/register` → 429 + `Retry-After`.
- **#4** Falso positivo (`PasswordHash` ya tenía `json:"-"`); cerrado con test de no-regresión `domain/security_test.go`.
- Deps: `golang.org/x/time/rate`, `golang.org/x/term`.
- Nuevos tests: `config_test.go`, `middleware_test.go` (allowlist + ratelimit), `domain/security_test.go`, `cmd/admin/admin_test.go`. `go vet` + `go test ./...` verdes.
- Docs: `.env.example`, sección "Backend Go" + "Variables de entorno" en README.

## Issues abiertos (Judgment Day) restantes: #7–#20

