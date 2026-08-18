# F095 — Implementación lista para revisión

## Alcance implementado

- `ProductionEdgeTotal` ahora incluye `pieces` y `sides`; el dominio suma cantidad de piezas y lados marcados por cantidad, manteniendo ML como antes.
- `EdgeBand.previewColor` se propaga extremo a extremo: tipo TS, mapper HTTP, modelo Go, queries/insert/update, migración aditiva `000058` y formulario de Cantos con selector/hex validado y normalizado.
- Los claims de Producción aceptan `item_id` omitido: se persiste como `NULL`, representa obra × estación y se muestra en los jobs activos con campos de pieza/módulo vacíos.
- La exclusividad se limita al mismo operador + obra + estación + alcance (ítem o proyecto); varios operadores pueden reclamar la misma obra/estación. Finalizar un claim de obra no mueve ítems ni genera eventos de piso.
- El puerto y cliente HTTP TS hacen `itemId` y la respuesta `itemId/moduleCode` opcionales.

## Pruebas añadidas

- Dominio: piezas y lados por canto.
- Storage TS: round-trip de `preview_color`.
- UI: normalización de color de canto al guardar.
- API Go: claim obra×estación, múltiples operadores, dedupe del mismo operador y finish sin avance de piso.

## Verificación ejecutada

- `pnpm --filter @muebles/domain test` — 632 tests OK.
- `pnpm --filter @muebles/storage test` — 115 tests OK.
- `pnpm --filter @muebles/ui test -- EdgesCatalog.test.tsx` — 949 tests OK (el script ejecuta la suite UI completa).
- `pnpm typecheck` — OK.
- `pnpm test` — OK (web 257; suite monorepo verde).
- `cd backend-go && go test ./internal/api ./internal/domain ./internal/storage` — OK.
- `cd backend-go && go build ./...` — OK.
- `cd backend-go && go vet ./internal/api ./internal/domain ./internal/storage` — OK.
- `git diff --check` — OK.

## Cierre

- Revisión aprobada: `progress/review_f095.md`.
- F095 se marcó `done` en `feature_list.json`.

## Correcciones solicitadas por revisión

- El contrato de jobs activos ahora admite claims por obra: `itemId` y `moduleCode` son opcionales en `WorkspaceRepository`, el cliente HTTP y el tipo `ActiveJob` del dashboard.
- El cliente HTTP mapea explícitamente la respuesta snake_case de `claimProductionActivity`; para un claim obra × estación sin `item_id`/`module_code` devuelve ambos campos como `undefined`.
- Se añadió cobertura del cliente para una respuesta de claim por obra sin pieza ni módulo.
- Se ejecutó `gofmt` sobre todos los archivos Go modificados por F095; `gofmt -d` ya no produce salida.

## Verificación posterior a correcciones

- `pnpm --filter @muebles/storage test -- apiWorkspaceRepository.test.ts` — 116 tests OK.
- `pnpm --filter @muebles/storage typecheck` — OK.
- `pnpm --filter @muebles/ui typecheck` — OK.
- `cd backend-go && go test ./internal/api ./internal/domain ./internal/storage` — OK.
- `cd backend-go && go vet ./internal/api ./internal/domain ./internal/storage` — OK.
- `cd backend-go && go build ./...` — OK.
- `gofmt -d` sobre los Go tocados — sin salida.
- `git diff --check` — OK.


## Entrega

- Rama: `codex/f095-production-claims`.
- Commit convencional y push a `origin` realizados al cerrar la feature.
