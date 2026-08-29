# Segunda revisión independiente — F194 / Issue #450

**PR:** #480

**Rama:** `feat/450-invitation-membership-lifecycle`

**Base auditada:** `origin/main@ac7577c20441936615edfab116073dcc93e279ec`

**Head de implementación auditado:** `c633054831760bf37f71fb9f31e961a14e4ce119`

**Veredicto anterior:** `CHANGES_REQUESTED` sobre `d38ad3d099a52af08f92a6124d80a0c1fdee4078`

**Veredicto nuevo:** `APPROVED`

## Resumen

La segunda revisión auditó de cero el diff completo de PR #480 y reejecutó la
evidencia crítica contra PostgreSQL real, el router Go, el cliente generado y
Chromium. Los cuatro P1 del primer veredicto quedaron cerrados con pruebas
ejecutables; no se detectaron nuevos bloqueantes ni cambios ajenos al lifecycle.

El fix de `backend-go/internal/storage/idempotency.go:141-165` restaura el actor y
la organización originales del receipt antes de liberar el savepoint y completar
la fila RLS. La aceptación pública puede cambiar el contexto a la identidad y
organización invitadas sin perder la autoridad sobre el receipt anónimo; replay,
concurrencia y persistencia cifrada pasan sobre HTTP/PostgreSQL real.

El rebase quedó reconciliado correctamente: `origin/main` ya reserva F193 para
#476 y Issue #450 usa F194 de forma única en ledger, progreso, review y evidencia
visual. F194 puede cerrarse como `done`. No se modificó código de implementación
ni se hizo merge.

## Cierre de los cuatro P1 previos

### 1. Aceptación HTTP/PostgreSQL, replay, concurrencia y secretos — CERRADO

- `backend-go/tests/pilotreadiness/invitation_acceptance_http_test.go:31-55`
  demuestra aceptación de identidad nueva y replay exacto con la misma
  `Idempotency-Key`: mismo body/sesión y `Idempotency-Replayed: true`.
- `backend-go/tests/pilotreadiness/invitation_acceptance_http_test.go:57-81`
  reutiliza una identidad existente, conserva su membership original y crea
  sólo la membership de la organización invitante.
- `backend-go/tests/pilotreadiness/invitation_acceptance_http_test.go:83-127`
  cubre `suspended` y `left`: conserva `membership_id`, limpia metadata
  incompatible, reemplaza roles y deja una sola fila activa.
- `backend-go/tests/pilotreadiness/invitation_acceptance_http_test.go:129-177`
  dispara dos commands HTTP concurrentes con keys distintas y prueba un único
  éxito, un `INVITATION_ALREADY_USED` y un único consumo.
- `backend-go/tests/pilotreadiness/invitation_acceptance_http_test.go:223-283`
  valida sesión directa a la organización invitante, cardinalidad 1/1,
  invitation `accepted` versión 2, exactamente un evento
  `invitation_accepted` más `membership_created|reactivated`, receipt cifrado
  `gcm1:` y ausencia de token, password, email y JWT en audit/receipts.
- El pilot gate ejecutó verdes los casos new/existing, reactivación
  suspended/left, replay, concurrencia, token rotado, expirado, revocado,
  password legacy y cross-org.

### 2. Negative proofs SQL directos y privilegios — CERRADO

- `backend-go/internal/storage/identity_lifecycle_migration_test.go:146-275`
  ejecuta, bajo el login role que hereda `granete_app`, SELECT sin filtro y
  UPDATE/DELETE/UPSERT foreign bidireccionales para `memberships` e
  `invitations`; verifica después que las cuatro víctimas quedan inmutables.
- `backend-go/internal/storage/identity_lifecycle_migration_test.go:277-345`
  rechaza transitivamente superuser/BYPASSRLS/CREATEROLE/CREATEDB/replication,
  ownership de tablas protegidas, grants runtime excesivos y CRUD público; exige
  `ENABLE` + `FORCE RLS`.
- La suite focal y `scripts/pilot-gate.sh --fresh-container` pasaron sin skips.

### 3. Autoridad de diseño para Team — CERRADO

- `docs/design.md:1136-1162` define `Membership`/`membershipId` como unidad
  canónica, separa account status de membership status, elimina “pendiente de
  aprobación” global, documenta lifecycle y acciones honestas de Invitation y
  reserva administración avanzada/estaciones por membership para #451.
- El texto coincide con Issue #450, Organization Foundation v2 y ADR-0006; no
  reintroduce mutaciones globales por `userId`.

### 4. Gate UI, teclado/foco, Lucide/tokens y responsive — CERRADO

- `packages/ui/src/auth/AcceptInvitationScreen.tsx:46-48,71-179` mueve el foco al
  error, relaciona hints/errores, expone loading/disabled y usa sólo Lucide con
  `strokeWidth={1.5}`.
- `packages/ui/src/users/UsersScreen.tsx:249-469` usa `PageHeader`, filtros y
  tabla tenant-scoped; acciones, iconos y mutaciones se basan en
  `membership_id`/Invitation.
- `packages/ui/src/auth/AcceptInvitationScreen.test.tsx:52-118` y
  `packages/ui/src/users/UsersScreen.test.tsx:139-155` prueban foco de error,
  teclado, loading, trap de foco, Escape y retorno al trigger.
- El detector Impeccable devolvió `[]` en los siete TSX/CSS modificados del
  alcance. No encontró hex, estilos inline o literales visuales nuevos.
- `tests/visual/identity-lifecycle.spec.ts:3-126` pasó 6/6 en Chromium a
  390/768/1280 para Team y aceptación, comprobó no-overflow y escribió seis
  screenshots en `test-results/f194-ui-gate/`. Las seis capturas fueron
  inspeccionadas; el responsive conserva jerarquía, controles y scroll interno
  de tabla sin overflow de página.

## Matriz completa de aceptación #450

- [x] Account status y membership status son autoridades distintas en DB, Go,
  OpenAPI y React.
- [x] El directorio devuelve memberships `active|suspended|left` sin confundir
  el estado global de User.
- [x] Aceptación new/existing es atómica, idempotente y concurrency-safe.
- [x] Aceptar entra directamente a la organización invitante aun con múltiples
  memberships.
- [x] Un admin de taller no aprueba, elimina, deshabilita ni reactiva un User
  global.
- [x] `InitialOrganizationID` no participa en onboarding runtime; sus usos
  residuales están limitados a bootstrap CLI/tooling y fixtures.
- [x] Resend rota el token e invalida el anterior.
- [x] Pending/delivered/opened/accepted/expired/revoked y token rotado se
  presentan y responden de forma diferenciada.
- [x] `/auth/register` y los bridges/callers productivos
  `/api/admin/users/{id}/approve|role|delete` fueron retirados.
- [x] Hay pruebas new/existing/multi-org/expired/revoked/replay/concurrent,
  cross-org API y SQL directo.

## Evidencia ejecutada en esta segunda revisión

| Verificación | Resultado |
|---|---|
| SHA/base/branch/readback inicial | PASS: head remoto `c633054831760bf37f71fb9f31e961a14e4ce119`, base `ac7577c20441936615edfab116073dcc93e279ec`, PR abierto/CLEAN, local limpio y sin commits sin push |
| Seis checks remotos iniciales | PASS: Go, TypeScript, harness y SketchUp macOS/Ubuntu/Windows |
| `./init.sh` con Ruby 3.2.11 de rbenv | PASS: TS, Go, Ruby/RuboCop/RBZ; 201 unit + 3 boundary, 0 fallos/skips |
| `pnpm openapi:check` | PASS: generados actuales y operation-drift negative proofs |
| `pnpm typecheck` | PASS: 7 workspaces |
| `pnpm test` / suite UI completa | PASS: incluye UI 147 files / 1451 tests y web 26 files / 326 tests |
| `go test -race -p 1 ./internal/auth ./internal/storage ./internal/api ./tests/pilotreadiness -count=1` con PostgreSQL efímero | PASS; pilotreadiness race aislado PASS en 97.203s |
| `go test ./internal/storage -run '^TestIdentityLifecycle(Migration\|RLS)_' -count=1 -v` | PASS: fresh, upgrade, constraints, colisión, lock, RLS A↔B, privileges, rollback/reapply y fail-closed |
| `scripts/pilot-gate.sh --fresh-container` | PASS: PostgreSQL 16 efímero, migrations 000001→000095, RLS directo, router real, backup/restore y lifecycle completo |
| Gate Impeccable | PASS: detector `[]` en alcance UI |
| Playwright F194 | PASS: 6/6 a 390/768/1280 con screenshots y no-overflow |
| `git diff --check origin/main...HEAD` | PASS |

Una corrida race del pilot contra la base local compartida en `localhost:5445`
se descartó porque la fixture perdió su base efímera durante el arranque. La
misma suite se reejecutó de forma aislada contra un contenedor PostgreSQL nuevo
y pasó completa con race; no se atribuye el incidente al PR.

## Diseño UI/UX

- D1: [x] Tokens del design system en el alcance modificado; detector sin hallazgos.
- D2: [x] Patrón canónico Team por Membership y aceptación pre-shell.
- D3: [x] Modales usan `Modal` con trap, Escape y retorno de foco probado.
- D4: [x] Loading/error/empty/no-results y feedback persistente cubiertos o justificados.
- D5: [x] Sólo Lucide con `strokeWidth={1.5}` en los iconos modificados.
- D6: [x] No se añadieron animaciones fuera del sistema; reduced motion compartido se conserva.
- D7: [x] Gate `docs/design.md` §8 ejecutado, incluidos 6 screenshots responsive.
- D8: [x] Copy, teclado, labels, aria y foco cumplen §4.8/§7 en el alcance.

## Checkpoints

- C1: [x] Harness completo; `./init.sh` termina con exit code 0 usando Ruby canónico.
- C2: [x] F194 era la única feature `in_progress`; ledger y progreso quedan coherentes al cierre.
- C3: [x] UI presenta; lifecycle, auth, concurrencia, tenant scope y auditoría permanecen server-authoritative.
- C4: [x] Evidencia ejecutable completa en TS, Go/race, PostgreSQL/RLS, OpenAPI, pilot y navegador real.
- C5: [x] Sólo se modifican artefactos de revisión/cierre; se exige commit, push, CI remoto y readback antes de entregar.

## Scope y decisión final

El diff auditado contiene 85 archivos, 5023 inserciones y 2863 eliminaciones. La
excepción de tamaño documentada es válida porque migration, OpenAPI generado,
Go/storage, clientes y UI forman un contrato atómico. La eliminación de
SectorAssignment acompaña el retiro del bridge legacy por `userId`; su reemplazo
avanzado pertenece a #451. No hay atribución de IA, commits no convencionales,
secretos productivos ni trabajo ajeno detectable.

**APPROVED.** F194 queda habilitada para `done`. Este veredicto no hace merge;
el commit de revisión debe pasar los seis checks remotos y verificarse por
readback antes de entregar.
