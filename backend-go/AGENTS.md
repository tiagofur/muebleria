# backend-go — Mapa de navegación agent-first

**Léeme cuando** vayas a tocar cualquiera de las soluciones Go (`internal/api`,
`internal/storage`, `internal/domain`, `internal/auth`, `internal/application`,
`cmd/`). Este archivo es el mapa de entrada: te dice el dueño de cada dominio,
la prueba focal y qué leer según el tipo de trabajo. No duplica invariantes:
las de la raíz (`AGENTS.md` del repo) aplican todas aquí.

## Arranque mínimo

1. La issue aprobada manda; este mapa solo te lleva al dueño.
2. `python3 scripts/factory_preflight.py` (read-only, no autoriza nada).
3. Lee solo los archivos dueños de tu dominio (tabla de abajo) y su prueba focal.
4. Compila/testea con los comandos de §Verificación — verde por commit en
   refactors; ningún PASS sin la infraestructura real que la aceptación exija.

## Mapa dominio → dueño → prueba focal

Cada dominio tiene **un** archivo de rutas, **un** dueño de handlers, **un**
sub-interface de Store (`store_<dominio>.go` + su stub `stub_<dominio>_test.go`)
y storage por dominio (`internal/storage/<dominio>.go`). Los endpoints exactos
de cada dominio viven en su `routes_<dominio>.go` — greppalos ahí, no hay
catálogo duplicado a mano. Los DTOs del contrato vivo están generados en
`internal/api/openapi/generated/` (nunca editar a mano; ver §Invariantes).

| Dominio | Rutas | Handlers | Store | Storage | Prueba focal |
| --- | --- | --- | --- | --- | --- |
| Auth/sesiones (SEC-1/2/6/7) | `routes_auth.go` | `auth_session_handlers.go`, `server.go`, `dto_user.go`, `audit.go` | `AuthStore` | `auth*.go`, `session_registry*` | `login_org_test.go`, `session_registry_test.go`, `mfa_test.go` |
| Platform/orgs/soporte | `routes_platform.go` | `platform.go` | `OrgStore` | `organizations.go`, `support_sessions.go`, `security_audit.go` | `platform_test.go`, `organization_lifecycle_test.go` |
| Org team/invitaciones | `routes_org.go` | `orgteam.go` | `OrgStore` | `org_team.go`, `memberships.go` | `orgteam_capabilities_test.go` |
| Biblioteca/librerías mfg | `routes_library.go` | `manufacturing_library*.go`, `overlay_handlers.go` | `ManufacturingLibraryStore` | `manufacturing_library*.go`, `library_overlay*` | `manufacturing_library_test.go`, `overlay_handlers_test.go` |
| Catálogo comercial | `routes_catalog.go` | `catalog_handlers.go`, `hardware_assets.go` (api) | `CatalogStore`, `HardwareAssetStore` | `catalog_full.go`, `hardware_assets.go`, `hardware_asset_*` | `hardware_assets_test.go`, `media_test.go` |
| Módulos/paramétrica | `routes_catalog.go` | `modules_handlers.go` | `ModuleStore` | `modules.go` | `module_concurrency_test.go`, `furniture_test.go` |
| Proyectos/cotizaciones | `routes_projects.go` | `projects_handlers.go` | `ProjectStore`, `FurnitureStore` | `projects.go`, `project_items` (en projects.go), `quote_line_furniture_instances.go` | `projects_handlers_test.go` |
| Diseño/working copy | `routes_design.go` | `designs.go`, `design_publish*.go` (api) | `DesignStore`, `DesignAuthoringStore` | `designs.go`, `design_revisions.go`, `design_working_copy.go` | `designs_test.go`, `working_copy_contract_test.go` |
| Comercial (quotes) | `routes_commercial.go` | `quote*.go` (api) | `QuoteReleaseStore` | `quote*.go`, `reconciliation` | `quote_lifecycle_test.go`, `quote_requote_test.go` |
| Releases/ingeniería | `routes_production.go` | `production_release*.go` (api) | `QuoteReleaseStore` | `production_release*.go` | `production_release_test.go`, `production_release_authority_test.go` |
| Planta (piso/ejecución/MP/calidad/instalación/costing/survey) | `routes_production.go` (`registerManufacturingRoutes`) | `partExecutions.go`, `materialPlanning*`, `jobCosting.go`, etc. | `ProductionActivityStore`, `OperationsStore` | `part_executions*`, `material_planning*`, … | `partExecutions_test.go`, `materialPlanningQuality_test.go`, `jobCosting_test.go` |
| Compras/almacén/CRM | `routes_operations.go` | `photos.go`, `internal_messages*`, `warranties*`, `purchaseOrders*`, `stock*` | `OperationsStore`, `ProjectWorkflowStore` | archivos homónimos | `purchaseOrders_test.go`, `stock_test.go`, `warranties_test.go` |
| Utilidades (plantillas/settings/seed/media) | `routes_workspace.go`, `routes_media.go` | `workspace_handlers.go`, `media*.go` | `SeedSettingsStore` | `workshop_settings*`, `media*`, `seed.go` | `workspace_handlers_test.go`, `media_test.go` |

PTX/máquinas (receiver adapters) y export de packs viven fuera de este mapa
dominial: `internal/api` (endpoints), `packages/excel` (adapters) y los docs de
`docs/machines/`. Consúltalos solo si tu issue los nombra.

## Presupuestos y reglas de estructura

- ~500 líneas soft por archivo de producción (fuera de `generated/`); un
  dominio = un handler + un storage. Excepciones vigentes: `engine/layout.go`,
  `engine/authoring_*.go` (motor puro, un solo dominio cada uno),
  `storage/projects.go` (1.246, single-domain: sus helpers de ítems están
  entretejidos con las transacciones), `storage/seed.go` (no-goal del plan
  #1017) y `api/hardware_assets.go`.
- **Lo nuevo no entra a monolitos**: una función/handler/ruta nueva nace
  directamente en el archivo dueño de su dominio.
- **Extracción al tocar** (regla ratificada 2026-09-29, `docs/agent-first-methodology.md`
  §8.1): si tu diff toca un bloque de un archivo sobre presupuesto, ese bloque
  emigra a su archivo dueño — máx. una extracción por PR, commit separado
  `refactor(<dominio>): extraer <cosa> de <monolito>`, verde por commit.
- Headers de contrato: todo archivo nuevo abre con 1-3 líneas (qué expone,
  quién lo consume).
- Moves mecánicos o nada: sin cambios de firmas/rutas/payloads/mensajes
  disfrazados de refactor; las mejoras de lógica son otra issue.

## Verificación (proporcional, un comando por nivel)

```bash
# Por commit (rápido, sin DB):
cd backend-go && gofmt -l internal/ && go vet ./... && go build ./... && go test ./internal/api/ ./internal/domain/...
# Por fase / cuando tocas storage (PostgreSQL desechable, NUNCA la DB persistente):
bash scripts/backend-test.sh ./...
# Impacto conservador antes de publicar:
python3 scripts/verify_affected.py --base origin/main --plan
```

`internal/api` testea con stub (`stub_<dominio>_test.go`) sin DB. La suite de
`internal/storage` exige PostgreSQL real en contenedor desechable
(`GRANETE_TEST_DATABASE=1`); infra ausente = `BLOCKED`/`NOT_RUN`, jamás PASS.

## Invariantes que aquí no se relajan

Server authority, RLS/roles split, audit/outbox con la mutación, APIs/DTOs
generados, fixtures de paridad TS↔Go, sesiones Web≠SketchUp, releases
inmutables sin `latest` implícito, DB de test desechable — todo eso vive en
`AGENTS.md` de la raíz y aplica literal a este árbol. Al tocar cualquiera de
esas áreas, su lectura obligatoria de la raíz (Users/Auth → ADR-0005/0006;
librerías → ADR-0008; project/design → ADR-0003; test DB →
`docs/architecture/test-database-isolation.md`) es previa al primer edit.
