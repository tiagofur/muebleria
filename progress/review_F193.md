# Revisión independiente — F193 / Issue #450

**PR:** #480

**Rama:** `feat/450-invitation-membership-lifecycle`

**Base auditada:** `origin/main@b4f8e7eaaea99fa0515085b46a8f2038858c57ae`

**Head auditado:** `d38ad3d099a52af08f92a6124d80a0c1fdee4078`

**Veredicto:** `CHANGES_REQUESTED`

## Resumen

La implementación cubre correctamente la mayor parte del lifecycle explícito: la migración 000095 pasa fresh, upgrade desde 000094, colisiones, rollback seguro/reapply y rechazo de rollback con pérdida; User, Membership e Invitation quedan separados; el registro/aprobación global y los callers runtime legacy fueron retirados; OpenAPI generado, clientes, React, auditoría durable, receipts cifrados, RLS y el pilot gate pasan.

No se puede aprobar porque faltan pruebas ejecutables exigidas por #450 para la aceptación idempotente/reactivación y para el aislamiento SQL directo de las tablas del lifecycle. Además, la autoridad UI sigue describiendo el flujo global eliminado y las pantallas modificadas no presentan el gate completo de diseño requerido.

F193 permanece `in_progress`. No se modificó código de implementación ni se hizo merge.

## Hallazgos obligatorios

### P1 — La aceptación no prueba replay idempotente ni reactivación de membership

La prueba concurrente actual llama directamente a storage y espera un éxito más `ErrInvitationAlreadyUsed`; no atraviesa `POST /api/auth/invitations:accept`, su middleware de idempotencia, el receipt cifrado ni el replay de la sesión (`backend-go/tests/pilotreadiness/invitation_lifecycle_test.go:21-67`). La prueba de identidad existente acepta secuencialmente en otra organización (`backend-go/tests/pilotreadiness/membership_test.go:32-42`), pero no repite la misma request con la misma `Idempotency-Key`.

El runtime sí contiene la rama que reactiva una membership `suspended|left` y emite `membership_reactivated` (`backend-go/internal/storage/organizations.go:747-775`), pero no existe una prueba de aceptación que suspenda o marque `left`, invite otra vez y demuestre que se conserva el mismo `membership_id`, se limpia el metadata incompatible, queda una sola membership y se escribe un solo audit durable. La búsqueda de pruebas de `invitations:accept` sólo encontró happy paths, estados de token y errores; las pruebas de `Idempotency-Replayed` son genéricas o de revoke, no del comando accept.

**Cambio requerido:** agregar pruebas PostgreSQL/HTTP para aceptación de identidad nueva, existente y reactivación, incluyendo replay con la misma key y aceptación concurrente. Deben demostrar respuesta/sesión estable, una sola identidad/membership, transición accepted única y un solo par de eventos `invitation_accepted` + `membership_created|reactivated`, sin secretos en receipt/audit.

### P1 — Falta negative proof SQL directo para memberships e invitations

El pilot prueba aislamiento de lifecycle por API (`backend-go/tests/pilotreadiness/invitation_lifecycle_test.go:173-215`) y la suite RLS directa prueba CRUD/upsert cross-org sobre `customers` (`backend-go/internal/storage/tenant_rls_test.go:140-197`). La migración verifica que las policies de `users`, `memberships` e `invitations` existen y están inventariadas, pero no ejecuta SELECT/UPDATE/DELETE/UPSERT cross-org sobre memberships/invitations usando el runtime role.

Esto no satisface el negative proof solicitado para #450 ni el estándar de #462: presencia de policy no sustituye enforcement ejecutado sobre las tablas nuevas.

**Cambio requerido:** agregar pruebas SQL directas con `granete_app`, transacción y tenant context que demuestren aislamiento bidireccional de memberships e invitations, incluyendo lectura sin filtro y mutaciones/upserts contra una fila extranjera. Deben fallar si el role tiene `BYPASSRLS`, ownership indebido o grants excesivos.

### P1 — `docs/design.md` conserva la semántica global que el PR elimina

La fuente canónica de Usuarios todavía prescribe modales de estaciones, “Pendientes de aprobación”, columna estación y acciones Aprobar/Rechazar/Desactivar (`docs/design.md:1136-1145`). Eso contradice Issue #450, ADR-0006 y el propio diff, que elimina el registro/aprobación global y la superficie de estaciones basada en User.

**Cambio requerido:** actualizar §6.11 para describir Team por `membershipId`, estados account/membership separados, invitaciones con estados honestos y acciones resend/revoke; dejar explícito que administración avanzada/estaciones por membership pertenece a #451 si continúa fuera de alcance.

### P1 — No está demostrado el gate de UI para las pantallas modificadas

`docs/design.md:1220-1237` exige el gate completo para toda pantalla modificada. El PR no aporta screenshot review ni smoke verificable a 390/768/1280. Además, los iconos nuevos de resend/revoke omiten el `strokeWidth={1.5}` obligatorio (`packages/ui/src/users/UsersScreen.tsx:365-370`) y `AcceptInvitationScreen` conserva valores `px` inline e iconos Lucide sin el stroke canónico (`packages/ui/src/auth/AcceptInvitationScreen.tsx:68-84`, `104-114`, `128-142`, `170-184`).

**Cambio requerido:** ejecutar y registrar el gate §8 sobre Team y aceptación, corregir los hallazgos del detector en el alcance modificado, verificar teclado/foco/estados, y adjuntar evidencia de screenshot + no-overflow en los tres viewports.

## Matriz de aceptación de #450

- [x] Account status y membership status separados en DB, Go, OpenAPI y React.
- [x] Directorio incluye memberships activas/suspendidas/left sin mezclar `user.active`.
- [ ] Aceptación new/existing atómica **e idempotente**: atomicidad y paths existen; falta replay ejecutable específico del comando.
- [x] Aceptación entrega sesión scoped a la organización invitante aun con múltiples memberships.
- [x] Un admin de taller no aprueba, elimina ni deshabilita globalmente un User.
- [x] `InitialOrganizationID` no participa en onboarding runtime.
- [x] Resend invalida el token previo.
- [x] Estados pending/delivered/opened/expired/revoked/accepted/rotated se distinguen en API/UI y pruebas de token.
- [x] Rutas/storage/callers legacy de aprobación global y registro público fueron retirados.
- [ ] Cobertura completa new/existing/multi-org/expired/revoked/replay/concurrent/cross-org: faltan replay accept, reactivación y SQL directo lifecycle.

## Evidencia ejecutada

| Verificación | Resultado |
|---|---|
| `./init.sh` con Ruby 3.2.11 de rbenv | PASS; TypeScript, Go y Ruby/RBZ completos |
| `pnpm openapi:check` | PASS; generated files sin drift y negative proofs de operaciones |
| `pnpm typecheck` | PASS; 7 workspaces |
| `pnpm test` | PASS; incluye web 26 files / 326 tests |
| `go test ./... -count=1` | PASS |
| `go test -race -p 1 ./internal/auth ./internal/storage ./internal/api ./tests/pilotreadiness -count=1` | PASS |
| `go test ./internal/storage -run '^TestIdentityLifecycleMigration_' -count=1 -v` | PASS: fresh, upgrade 000094→000095, colisión atómica, lock/grants, rollback/reapply y rollback fail-closed |
| `scripts/pilot-gate.sh --fresh-container` | PASS; PostgreSQL efímero aplica 000001→000095 y pilot readiness completo |
| `git diff --check origin/main...HEAD` | PASS |

La primera ejecución race con varios paquetes en paralelo fue descartada porque las fixtures comparten el nombre de base pilot y colisionaron durante migraciones (`tuple concurrently updated`). La ejecución válida y serial con `-p 1` pasó completa; no se atribuye ese error al PR.

## Migración, seguridad y datos sensibles

- Migration 000095: evidencia ejecutable PASS para fresh, upgrade, constraints, backfill, email normalizado/collision, RLS inventory y rollback seguro.
- Lock exacto de token: función SECURITY DEFINER con grant al runtime role y sin EXECUTE público, cubierta por prueba.
- Auditoría: mutación y eventos success comparten transacción; fallos replayables se registran tras rollback a savepoint.
- Idempotency: create/resend/accept usan receipts sensibles cifrados; suites de storage pasan y no se observaron raw tokens/passwords/emails en audit de fallo.
- Legacy: no quedan rutas productivas `/auth/register` ni `/api/admin/users/{id}/approve|role|delete`; los usos residuales de `InitialOrganizationID` están limitados a bootstrap/tests/herramientas, no onboarding runtime.

## Scope, commits, push y CI remoto

- Diff auditado: 81 archivos, 3950 inserciones y 2733 eliminaciones. El `size:exception` está documentado y la amplitud corresponde al contrato atómico DB→OpenAPI→Go→React.
- No se detectaron cambios ajenos al lifecycle; la eliminación de SectorAssignment acompaña el retiro del bridge legacy por `userId` y la continuación por membership queda para #451.
- Commits del head auditado son convencionales y no contienen `Co-Authored-By` ni atribución de IA.
- Antes de esta revisión, local HEAD y `origin/feat/450-invitation-membership-lifecycle` coincidían en `d38ad3d`.
- CI remoto para `d38ad3d`: seis checks PASS (Go, TypeScript, harness y SketchUp en macOS/Ubuntu/Windows); PR abierto, no draft, merge state CLEAN.

## Checkpoints

- C1 Alcance: PASS con `size:exception` atómico documentado.
- C2 Convenciones: PASS en código/commits; falla el gate UI detallado arriba.
- C3 Arquitectura: PASS en separación de autoridades y límites runtime.
- C4 Tests: FAIL por pruebas de aceptación/replay/reactivación y SQL directo faltantes.
- C5 Ledger/progreso: PASS para veredicto negativo; F193 permanece `in_progress`.
- C6 Seguridad: FAIL de evidencia completa hasta ejecutar el negative proof SQL lifecycle; no se detectó una filtración concreta.
- C7 Contrato generado: PASS.
- C8 Remoto: PASS para el head auditado; el commit de este reporte debe volver a pasar CI antes de entrega.

## Condición de nueva revisión

Resolver los cuatro P1, ejecutar nuevamente todas las suites de esta matriz, mantener F193 `in_progress` y solicitar una nueva revisión independiente sobre el nuevo head remoto.
