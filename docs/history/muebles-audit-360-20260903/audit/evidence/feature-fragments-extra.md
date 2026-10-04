# Revisión semántica suplementaria F161–F203

28 features seleccionadas para complementar la matriz; no altera ledger ni declara COMPLETE. No nuevas ejecuciones.

## F161 — #346 Semantic metadata y round-trip SketchUp ↔ Granete

applyAuthoringEnvelope valida migration/schema, replay por fingerprint, base stale, completeness con tombstones y aplica sobre copia. Tests comprueban identidad estable, omisión sin delete y round-trip semántico. El state Map no es receipt durable ni prueba SketchUp real.

UNKNOWN / siguiente prueba: Ejecutar suite exacta y round-trip con build host pinneado, no confundir fixture TS con integración de dispositivo.

Evidencia: `packages/domain/src/sketchupAuthoringExchange.ts:69`, `packages/domain/src/sketchupAuthoringExchange.test.ts:176`, `packages/domain/src/sketchupAuthoringExchange.test.ts:225`

## F162 — #356 Parametric part relationships and joint-driven machining

deriveRelationshipMachining recorre relationships y hardware placements, conserva provenance y fingerprint. Rechaza kinds fuera de shelf-support; tests aíslan mover/quitar entrepaño y cambiar joinery. No es catálogo universal de uniones ni interacción nativa.

UNKNOWN / siguiente prueba: Validar catálogo concreto requerido por demo y movimiento en host conectado; máquina no evaluada.

Evidencia: `packages/domain/src/sketchupRelationshipMachining.ts:60`, `packages/domain/src/sketchupRelationshipMachining.test.ts:93`, `packages/domain/src/sketchupRelationshipMachining.test.ts:153`

## F163 — #347 Milestone minimum authoritative preflight

runManufacturingPreflight acumula issues y vacía hardware/machining si blocked; tests cubren colisión, out-of-bounds, profundidad y referencias faltantes. Presencia del gate no implica que todos los exports existentes lo consuman.

UNKNOWN / siguiente prueba: Trazar export demo hasta este gate; defectos de drilling legacy impiden extender ready del helper a DXF.

Evidencia: `packages/domain/src/sketchupPreflight.ts:266`, `packages/domain/src/sketchupPreflight.test.ts:36`, `packages/domain/src/sketchupPreflight.test.ts:81`

## F164 — #349 Smart Parametric Furniture Library MVP

instantiateFurniture valida contrato/parámetros antes de geometría; tests generan gabinete, múltiples entrepaños, closet y escritorio y llaman preflight explícitamente. Alcance de test no prueba disponibilidad de todos esos muebles en catálogo real del taller.

UNKNOWN / siguiente prueba: Ejecutar casos contra catálogo comercial seleccionado; confirmar caller aplica preflight antes de output físico.

Evidencia: `packages/domain/src/furnitureCompositionEngine.ts:213`, `packages/domain/src/sketchupParametricLibrary.test.ts:19`, `packages/domain/src/sketchupParametricLibrary.test.ts:113`

## F165 — #350 Sincronización de HardwarePlacement y mecanizado

repositionHardwarePlacement clona envelope, busca identidad exacta, actualiza offset/rotación/cara y recalcula preflight; éxito depende ready/warning. Tests comprueban aislación y solución de colisión. No existe demostración de herramienta interactiva por esta función.

UNKNOWN / siguiente prueba: Conectar y probar gesto real de mover herraje en host; capability/UI puede seguir deshabilitada.

Evidencia: `packages/domain/src/sketchupHardwareSync.ts:38`, `packages/domain/src/sketchupHardwareSync.test.ts:15`, `packages/domain/src/sketchupHardwareSync.test.ts:75`

## F166 — Login de taller, biblioteca remota y licencia en la extensión de SketchUp

Application usa DeviceProvider y RemoteCatalogProvider principal con StaticCatalogProvider de fallback. Por tanto AC histórico email/password + token de 30 días + licencia por usuario no describe runtime actual; SEC-6 y licencia org lo sustituyeron.

UNKNOWN / siguiente prueba: Smoke de dispositivo enrolado contra build exacto; fallback no debe presentarse como catálogo remoto autoritativo.

Evidencia: `apps/sketchup-extension/src/granete_for_sketchup/application.rb:20`, `backend-go/internal/api/authoring_resolve.go:68`

## F168 — #347 Manufacturing preflight autoritativo — Definition of Done completo

Gate deriva requirements y marca REVISION_STALE; override solo degrada MACHINE_CAPABILITY_UNSUPPORTED/REVISION_STALE, no colisiones. Tests negativos capability/version/constraint soportan lógica local. Input server-policy no demuestra durable audit real por sí mismo.

UNKNOWN / siguiente prueba: Proof de caller server, persistencia audit y perfil/adaptador/version exactos con readback de máquina.

Evidencia: `packages/domain/src/sketchupPreflight.ts:232`, `packages/domain/src/sketchupPreflight.ts:455`, `packages/domain/src/sketchupPreflight.test.ts:205`

## F169 — #325 Multi-org core — organizations, memberships, invitations, auditoría de seguridad y scoping del schema

Migraciones080–084 introducen org/membership/scope; metadata final confirma roles en memberships y organization_id. Defaults transitorios y active del AC fueron reemplazados por088/lifecycle; no deben restaurarse.

UNKNOWN / siguiente prueba: No reejecutado downgrade del chain histórico; consultar pruebas existentes para cada transición exacta.

Evidencia: `backend-go/db/migration/000080_multi_org_core.up.sql:1`, `backend-go/db/migration/000088_drop_org_defaults.up.sql:1`, `backend-go/internal/storage/multi_org_migration_test.go:157`

## F170 — #325 Auth con contexto de organización — JWT v2, select-org, middleware OrgContext y scoping ruta por ruta

Middleware reconsulta status canónico de membership/org y roles; storage no depende de users.role. JWT v2 / extensión de 30 días de AC son históricos ante registry y DeviceProvider actuales.

UNKNOWN / siguiente prueba: Smoke actual de CLI y device de este baseline; no asumir semántica token antiguo a partir de ledger.

Evidencia: `backend-go/internal/api/middleware.go:236`, `backend-go/internal/storage/organizations.go:232`, `backend-go/internal/api/middleware_test.go:613`

## F171 — #325 Tests de aislamiento cross-org y paridad de roles múltiples

Tests fuente verifican customers/projects/catalog/settings y directorio por organización; fixtures TS ejercitan unión. Son pruebas concretas no sólo claims de middleware.

UNKNOWN / siguiente prueba: Correlacionar cada endpoint adicional con prueba propia; no generalizar todos los265 endpoints desde cinco familias.

Evidencia: `backend-go/internal/storage/multi_org_isolation_test.go:61`, `backend-go/internal/storage/multi_org_isolation_test.go:194`, `packages/domain/src/rbacUnion.test.ts:30`

## F172 — #326 Administración — consola de plataforma, equipo del taller, invitaciones auditables y sesión de soporte

Provisioning y Team tienen commands, bootstrap explícito, audit y soporte separado; AC desactivar usuarios mezcla términos históricos con membership lifecycle moderno. Cancelación step-up con falso success en Team permanece hallazgo independiente.

UNKNOWN / siguiente prueba: UX completa de roles/revoke/offboard con cancelación y fracaso real; no declarar éxito administrativo por toast.

Evidencia: `backend-go/internal/api/organization_lifecycle.go:23`, `backend-go/internal/application/organizations.go:168`, `backend-go/internal/api/orgteam_capabilities_test.go:247`

## F174 — Deployment VPS de producción + distribución del plugin SketchUp a talleres piloto

Docker/Caddy/runbooks presentes y smoke estructural root pasa. Suite backup round-trip usa base scratch; no equivale restaurar despliegue real. Operations audit registra toolchain drift y restore que tolera errores.

UNKNOWN / siguiente prueba: Build imágenes y deploy/restore en VPS limpio con dominio/TLS reales; no ejecutados en esta auditoría.

Evidencia: `docker-compose.prod.yml:1`, `scripts/smoke-deploy.sh:1`, `backend-go/tests/pilotreadiness/backup_test.go:31`

## F175 — Hardening #325/#326/#327 — enforcement server-side de ownership, fail-closed org-less y redacción sales/manufactura

manufacturingOnly devuelve notfound fuera de organización fabricante. Tests comprueban create con org ajena y update que conserva ownership/manufacturing. UPDATE actual excluye reasignación org. Esto no resuelve OP-01/02 del contenido editable por fabricante.

UNKNOWN / siguiente prueba: Ejercitar mezcla sales/manufacturing real y generic PUT sensible; no confundir redacción cross-org con autoridad de release.

Evidencia: `backend-go/internal/api/ownership.go:151`, `backend-go/internal/api/projectOwnership_test.go:201`, `backend-go/internal/storage/projects.go:1157`

## F176 — Segunda ola de hardening multi-org — paridad RBAC, retiro del puente users.role y red de ventas de fábrica (#326)

Domain tests pinnean roles por factory/store/dealer y unión; usuarios ya no llevan licencia/rol global. parent_organization_id existe, pero red basada en relaciones/capabilities sigue programa Gate B y no se puede inferir operabilidad comercial completa.

UNKNOWN / siguiente prueba: Validar caso network vigente bajo ADR0006 / Gate B, no promocionar antigua tab como red completa.

Evidencia: `packages/domain/src/organization.test.ts:34`, `packages/domain/src/organization.test.ts:64`, `backend-go/db/migration/000089_connected_orgs.up.sql:1`

## F177 — Cierre de deudas multi-org — DROP de users.role/license_* (000090) y pulidos UX

Migration090 elimina role/license_plan/license_expires_at y metadata final confirma ausencia. Lectura membership une org/status/roles actuales; sectores luego migraron a membership_sectors.

UNKNOWN / siguiente prueba: No repetir grep histórico como claim exhaustivo; confirmar serialización de clientes legacy cuando corresponda.

Evidencia: `backend-go/db/migration/000090_drop_deprecated_user_columns.up.sql:5`, `backend-go/internal/storage/organizations.go:164`, `backend-go/db/migration/000097_membership_sectors.up.sql:62`

## F178 — Fixes del re-review de #325/#326/#327 — consola plataforma, CLI post-000090, gate de manufactura y regresiones FE

TestUpdateOrganization modifica nombre y comprueba roundtrip de status; API prueba manufacturingOnly y redacción subprocesses. CLI seed actual scoping por organización y owner vía membership. No demuestra manualmente todos los nueve fixes UI históricos.

UNKNOWN / siguiente prueba: Smoke CLI set-license/admin y UI manufacturing multi-rol en entorno exacto; sin depender de ledger.

Evidencia: `backend-go/internal/storage/multi_org_isolation_test.go:301`, `backend-go/internal/api/projectOwnership_test.go:247`, `backend-go/internal/api/projectOwnership_test.go:319`, `backend-go/cmd/admin/main.go:393`

## F179 — Suite de Pilot Readiness multi-org — gate automatizado de coexistencia sin fuga de datos

Suite tiene pruebas crossorg bidireccional, clone independence y pg_dump/restore. Gate root ejecutado PASS en DB dedicada, sin skips; separar ese gate de operación productiva real.

UNKNOWN / siguiente prueba: Restore VPS operativo y carga/roles representativos aún no demostrados.

Evidencia: `backend-go/tests/pilotreadiness/crossorg_test.go:21`, `backend-go/tests/pilotreadiness/catalog_test.go:12`, `backend-go/tests/pilotreadiness/backup_test.go:31`

## F180 — Política cero datos-demo en migraciones/arranque — seed explícito y pineado

TestMigrations_NoBusinessData lista explícita de tablas y falla si hay rows tras migrar; seed CLI es explícito y scoped. Claim descriptivo init nunca escribe DB es incorrecto como regla operacional: init ejecuta tests que migran/escriben bases de prueba.

UNKNOWN / siguiente prueba: Mantener DB dedicada al ejecutar init; no afirmar servidor compartido intacto. Test no cubre automáticamente tabla futura no listada.

Evidencia: `backend-go/internal/storage/migrations_no_seed_test.go:17`, `backend-go/cmd/admin/main.go:393`, `init.sh:1`

## F181 — cmd/admin clean-demo-data — limpieza segura del catálogo demo + seed no destructivo

CleanDemoData inicia transacción con rollback diferido y reporta referencias; runSeed identifica org y backfillea owners scoped sin truncate global. Dry-run describe efecto dentro de transacción, no necesariamente bajo rol SQL read-only.

UNKNOWN / siguiente prueba: No ejecutar limpieza real durante auditoría; validar lista seed/clean contra datos propios antes de apply.

Evidencia: `backend-go/internal/storage/clean_demo.go:57`, `backend-go/internal/storage/clean_demo_test.go:15`, `backend-go/cmd/admin/main.go:393`

## F182 — Aislamiento cross-org de las familias restantes + guardrails de reconciliación de issues

Migration091 incluye organization_id en ambas PKs; upsert actual usa conflict target scoped. Tests familias cubren stock/picking/templates/ambient/mutators. Esa corrección no hace atómico picking+stock multi-request.

UNKNOWN / siguiente prueba: Separar regresión tenancy de defecto transaccional actual; revisar reconciliación GitHub workflow sin inferir que issues fueron cerradas.

Evidencia: `backend-go/db/migration/000091_org_scoped_stock_picking_pk.up.sql:8`, `backend-go/internal/storage/projectPicking.go:42`, `backend-go/internal/storage/multi_org_isolation_families_test.go:305`

## F188 — Cambio de material: re-resolución y rebuild nativo atómico en SketchUp (#404 / MT-3)

update_furniture rechaza Group y material change sin NativeLayout, aísla shared definition con make_unique, rebuild dentro de operación con abort. Parámetro sin cambio material puede seguir fallback; no extender gate material a toda edición.

UNKNOWN / siguiente prueba: Repetir host material BODY/FRONT real con IDs/world transform/undo y falla de resolve; no ejecutado aquí.

Evidencia: `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:446`, `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:461`, `apps/sketchup-extension/test/testup/TC_NativeValidationSmoke.rb:147`

## F189 — Paridad TS ↔ Go ↔ SketchUp para espesor y propagación de materiales (#405 / MT-4)

Fixture material-aware y pruebas nativas contienen cambio FRONT y aislamiento FI-A/FI-B; helper de rebuild preserva metadata tras render. Root no abrió modelo de usuario para repetir operación.

UNKNOWN / siguiente prueba: Reejecutar fixture contractual TS/Go/Ruby exacto y host build pinneado; evidencia histórica no prueba esta instalación.

Evidencia: `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:446`, `apps/sketchup-extension/test/testup/TC_NativeValidationSmoke.rb:75`, `apps/sketchup-extension/test/testup/TC_NativeValidationSmoke.rb:147`

## F190 — Validación real SketchUp nativo + interoperabilidad OpenCutList (#417 / SU-ENT-4)

TestUp fuente contiene jerarquía nativa, espesor por rol, transforms rígidos e independencia de instancias. Documento OCL es interoperabilidad acotada, no autoridad BOM ni CNC. Ninguna assertion fue corrida en host actual por esta subtarea.

UNKNOWN / siguiente prueba: Host limpio con build exacto, versión OCL y resultado reproducido; no usar 968 assertions históricas como ejecución actual.

Evidencia: `apps/sketchup-extension/test/testup/TC_NativeValidationSmoke.rb:48`, `apps/sketchup-extension/test/testup/TC_NativeValidationSmoke.rb:125`, `apps/sketchup-extension/test/testup/TC_OpenCutListInteropSmoke.rb:1`

## F195 — Contrato versionado de resolve de autoría rica para mutaciones semánticas SketchUp (#477)

POST handler valida método/auth/licencia de organización y envelope; respuesta layout/machining versionada no persiste Design. API disponible no prueba caller nativo usando el camino rico: inserción/edición base siguen layout GET según auditoría SketchUp.

UNKNOWN / siguiente prueba: Conectar primeros comandos host de relación/herraje y comprobar contrato+rollback real, no basta test de parser.

Evidencia: `backend-go/internal/api/authoring_resolve.go:40`, `backend-go/internal/api/authoring_resolve_test.go:1`, `packages/domain/src/sketchupAuthoringResolve.contract.test.ts:1`

## F197 — Lifecycle explícito y provisioning atómico de organizaciones (#452)

OrganizationService valida bootstrap/entitlements, usa WithinTenantTx para org/settings/membership/catalog/audit y readiness. Tests PostgreSQL prueban failure rollback y slug concurrency; esquema canónico sustituye active bool.

UNKNOWN / siguiente prueba: No inferir todos los flujos UI por gate backend; cancelación step-up Platform/Team debe conservar feedback honesto.

Evidencia: `backend-go/internal/application/organizations.go:168`, `backend-go/internal/storage/gate_a_provisioning_test.go:18`, `backend-go/internal/storage/organization_lifecycle_migration_test.go:607`

## F200 — Paridad Go del tratamiento de base: ZOCLO-AUTO y effective base context (#442)

Go resuelve modo/altura con contexto y define ZOCLO-AUTO; test consume mismo fixture plinthBaseParity y almacenamiento hardware quantity soporta 0.6. Metadata final double precision confirma tipo, no precio/volumen de proyecto real.

UNKNOWN / siguiente prueba: Recalcular demo real con patas/zócalo seleccionado y comparar BOM/export; no ejecutar contra catálogo genérico equivocado.

Evidencia: `backend-go/internal/domain/engine/base_treatment.go:102`, `backend-go/internal/domain/engine/plinthBaseParityContract_test.go:391`, `backend-go/internal/storage/hardware_line_quantity_test.go:15`

## F201 — Migración segura de entidades legacy Group a ComponentInstance nativo (#416 / SU-ENT-3)

Migrator pre-resuelve cada item antes de operación, conserva no resueltos como review y hace un batch con rollback ante fallo interno. Tests afirman que fuente no se borra antes de validar replacement y rename no cambia identidad.

UNKNOWN / siguiente prueba: TestUp limpio success/failure/save-reopen/undo; no migrar modelo activo del usuario durante auditoría.

Evidencia: `apps/sketchup-extension/src/granete_for_sketchup/migration/migrator.rb:40`, `apps/sketchup-extension/test/unit/migration/migrator_test.rb:244`, `apps/sketchup-extension/test/testup/TC_MigrationSmoke.rb:1`

## F203 — Executable Foundation Gate A (#462)

Script exige infraestructura, rechaza SKIP, ejecuta OpenAPI/typecheck/tests/smoke/pilot fresh/browser. Root posee CI exact SHA Foundation green y componentes locales pilot + 17 tests browser PASS, no inventar wrapper local completo si no se ejecutó.

UNKNOWN / siguiente prueba: Gate B y #460/#461 completos quedan separados; conservar evidencia exacta CI vs ejecución local.

Evidencia: `scripts/foundation-gate-a.sh:17`, `scripts/foundation-gate-a.sh:23`, `scripts/foundation-gate-a.sh:39`
