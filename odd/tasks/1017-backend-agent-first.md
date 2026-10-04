# ODD — #1017 Backend agent-first refactor (moves mecánicos, fases A–G)

**Estado:** IMPLEMENTED_PENDING_REVIEW (fases A–G; A MERGEADA, B–G en PRs apilados)
**Lane:** Delegated Direct (sustancial, multi-archivo). Un writer: GLM (ZCode).
**Issue:** #1017 (`status:approved`, 2026-10-03, autorización del owner en sesión).
**Plan rector:** `docs/backend-agent-first-refactor-plan-2026-09-27.md` (§4 fases, §5 métricas, §6 no-goals, §8 verificación).
**Metodología:** `docs/agent-first-methodology.md` (P1–P8; §8.1 extracción al tocar, aquí elevada a programa completo).

## Resultado observable

Los cinco monolitos/cuellos de botella de `backend-go` quedan partidos en archivos
pequeños por dominio con moves mecánicos (cero cambio de comportamiento), y existe
`backend-go/AGENTS.md` como mapa de navegación dominio → dueño → prueba focal.
Métricas §5 contra la baseline de abajo.

## Baseline congelada (2026-10-03, main @ 4941f945)

| Archivo | Líneas (2026-10-03) | Plan 09-27 |
| --- | --- | --- |
| `internal/api/handlers.go` | 2.916 | 2.867 |
| `internal/api/store.go` | 596 (290 métodos) | 536 |
| `internal/api/routes.go` | 904 | 860 |
| `internal/api/handlers_test.go` | 4.735 (stub espejo) | 4.375 |
| `internal/domain/types.go` | 1.153 | 1.082 |
| `internal/storage/projects.go` | 2.506 | 2.481 |
| `internal/storage/hardware_assets.go` | 1.909 | 1.909 |
| `internal/storage/designs.go` | 1.999 | 1.764 |
| `internal/storage/organizations.go` | 1.482 | 1.482 |
| `internal/storage/seed.go` | 1.162 | 1.026 |

## Alcance, exclusión y coordinación

- Fases A–G del plan; PR apilado por fase (`feat/1017-backend-af-<fase>` sobre el anterior).
- No-goals §6 íntegros; sin tocar `openapi/generated`, contratos, migraciones, `cmd/`.
- **CNC #1005 K4 en vuelo** (worktree `muebles-worktrees/1005-kdt-field-kit`, rama
  `feat/1005-kdt-field-kit-k4` @ 4941f945, hoy sólo `packages/excel` + `docs/machines`).
  Este refactor no toca esa superficie; antes de publicar cada PR se re-verifica su rama
  y si K4 expande a archivos `backend-go` tocados por una fase pendiente, esa fase se
  re-secuencia tras su merge.

## Verificación por nivel

- **V0 por commit:** `gofmt -l .` limpio, `go vet ./...`, `go build ./...` — moves verificados por compilación.
- **V1 por commit:** `go test ./internal/api/... ./internal/domain/...` (sin DB, stubStore); nombres de tests intactos.
- **V1 por fase con storage:** `scripts/backend-test.sh` con PostgreSQL desechable (`GRANETE_TEST_DATABASE=1`, roles split; contrato `test-database-isolation.md`).
- **V2:** No aplica como gate del refactor (no hay comportamiento nuevo ni frontera nueva); CI completa + shards de storage existentes son el gate por PR. Cualquier señal de drift de contratos = BLOCKED.

## Evidencia por fase (se actualiza por PR)

| Fase | PR | Contenido | V0/V1 | Estado |
| --- | --- | --- | --- | --- |
| A | #1018 **MERGEADA** (main @ c72313b5) | server/http_respond/dto_user/audit fuera de handlers.go (2.916→2.596) | build+vet+test ×4 commits | ✅ |
| B | #1023 | Store 329 métodos → 16 sub-interfaces + stub espejo (handlers_test 4.735→2.218) | build+vet+test ×2; 329=329; 68 tests intactos | ✅ |
| C | #1024 | RegisterRoutes → raíz 257 + 15 registradores/12 archivos; **309/309 rutas idénticas** (el check atrapó login caída) | build+vet+test; diff de patrones = vacío | ✅ |
| D | #1028 | handlers.go DELETED → auth/catalog/projects/modules/workspace + tests por dominio (68 intactos); guard audit re-apuntado | build+vet+test ×2 | ✅ |
| E | (este stack) | storage: projects/designs/organizations/hardware_assets partidos en 13 archivos | build+vet+**suite completa con PG desechable PASS (storage 502s, pilotreadiness 196s, 0 fallos)** | ✅ |
| F | (este stack) | domain/types.go 1.153 → 6 archivos por agregado | build+vet+test | ✅ |
| G | (este stack) | backend-go/AGENTS.md + métricas + este ODD | — | ✅ |

## Métricas §5 — después (2026-10-04, rama af-f)

| Métrica | Baseline 2026-10-03 | Después | Objetivo |
| --- | --- | --- | --- |
| handlers.go | 2.916 | **0 (eliminado)** | ≤~800 ✅ |
| handlers_test.go | 4.735 | 1.978 (struct stub + helpers + suite Ownership mixta) | eliminado como monolito ✅ |
| store.go | 596 (329 métodos) | 32 (raíz composición, 16 sub-interfaces ≤~180 c/u) | ≤~500 ✅ |
| RegisterRoutes | 904 (1 función, 309 rutas) | 257 raíz+helpers; 15 registradores ≤~150 | ✅ |
| storage >1.000 | 5 archivos | 2, ambas declaradas: hardware_assets.go 1.430 (single-domain ciclo de vida), projects.go 1.246 (single-domain, excepción en commit) + seed.go 1.162 (no-goal del plan) | ~0 ⚠️ documentado |
| domain/types.go | 1.153 | **0 (eliminado)** → 6 archivos ≤362 | ≤~500 ✅ |
| Comportamiento | — | rutas 309/309 idénticas; tests 68 intactos; OpenAPI sin tocar; suite PG PASS | cero diffs ✅ |

## Estrategia de entrega

PRs apilados; `Refs #1017 + Delivery: partial` en cada PR de fase; el último (G)
puede ser `Closes #1017 + Delivery: complete` si toda la aceptación queda demostrada.
Sin merge propio; review fresca por fase (GLM↔Gemini u owner).
