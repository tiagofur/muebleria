# #450 — Invitation-first identity and membership lifecycle

## Estado

F193 está `in_progress` sobre `b4f8e7e`. Los prerrequisitos #448 y #449 están
mergeados. Esta entrega reemplaza el onboarding global por invitaciones y mantiene
fuera de alcance last-admin, seats, offboarding y sectores avanzados de #451.

## Baseline verificado

| Área | Estado en `main` | Cambio requerido |
|---|---|---|
| User | `active BOOLEAN`; email exacto | `account_status`, email normalizado, verificación y último login |
| Membership | `active BOOLEAN`; mutaciones por `userId` | lifecycle explícito y API por `membershipId` |
| Invitation | timestamps implícitos; sin resend | status, metadata, rotación y comandos versionados |
| Acceptance | compensación de usuario y selector multi-org | una transacción y sesión directa a la organización invitante |
| Registro | `/auth/register` y estado React todavía publicados | eliminación completa; acceso B2B sólo por invitación |
| Team | mezcla account/membership booleanos | read model separado y estados históricos honestos |
| RLS | 000094 + lookup exacto del hash | lock estrecho, inventario/grants reconciliados y pruebas negativas |

La migración nueva es `000095`; no se modifica la migración aplicada 000094.

## Decisiones del slice

1. La normalización canónica es `lower(trim(email))`; PostgreSQL conserva la
   garantía final de unicidad y la migración aborta si encuentra colisiones.
2. `email_verified_at` no se inventa durante backfill. La ausencia de proveedor
   SMTP impide afirmar delivery/opened; esos estados no se fabrican.
3. Una invitación nueva puede reactivar `suspended`. Una membership `left` sólo
   vuelve a `active` mediante una nueva invitación explícita y deja auditoría.
4. Resend rota el hash dentro de la misma transacción. Sólo el raw token nuevo se
   devuelve una vez; tokens previos no se guardan en claro ni se registran.
5. Aceptación bloquea la invitación exacta antes de crear o buscar el User. User,
   Membership, Invitation y audit requerido confirman juntos mediante el runner
   e idempotencia de F192/F191.
6. La sesión de aceptación queda siempre scoped a la organización invitante; no
   pasa por el selector aunque existan otras memberships.
7. Los controles legacy de sectores bajo `/api/admin/users/*` se retiran de Team
   en este slice. La migración completa de sectores a `membershipId` pertenece a
   #451; los datos históricos no se eliminan.
8. Cambios de roles/status de membership combinan `If-Match` e
   `Idempotency-Key`: el primero evita sobrescribir una versión stale y el
   segundo hace replayable la mutación junto con su auditoría requerida.
9. La autoridad global de cuenta permanece en Platform mediante un command
   idempotente con razón obligatoria. Team sólo cambia roles y status de la
   membership identificada por `membershipId`.

## Frontera PostgreSQL de aceptación

`000095` instala una única función pública estrecha de aceptación:

- recibe exclusivamente el hash del token;
- bloquea la invitación exacta con `FOR UPDATE`;
- usa `SECURITY DEFINER` con `search_path` fijo y grant `EXECUTE` mínimo;
- no devuelve ni lista hashes;
- permite clasificar honestamente token vigente, rotado, expirado, revocado o
  consumido;
- después serializa por `normalized_email`, establece tenant/actor local y
  muta User, Membership, Invitation y auditoría en la transacción idempotente.

La unicidad final de identidad vive en PostgreSQL. Una colisión histórica de
email normalizado aborta el upgrade completo; nunca fusiona cuentas.

## Legacy que debe desaparecer

- `POST /api/auth/register`, `HandleRegister`, DTOs, cliente, estado y pantalla.
- `GET|PUT|DELETE /api/admin/users/*` usados por Team.
- `RejectUser`, `DeleteOrphanInvitedUser` como compensación y mutaciones globales
  de memberships por `userId`.
- `/org/members/{userId}/roles` y `/org/members/{userId}/active`.
- `account_active`, `membership_active`, `users.active` y `memberships.active`
  como autoridades runtime.
- aceptación multi-org que responde `selection_required`.

`InitialOrganizationID` puede permanecer sólo en migrations, fixtures y tooling
administrativo explícito; ningún path HTTP de onboarding puede usarlo.

## Orden de implementación

1. Migración 000095, modelos y repositories.
2. OpenAPI generado y comandos backend.
3. Login/acceptance/Team/Platform y eliminación de legacy.
4. Pruebas focused, fresh/upgrade/rollback, RLS y pilot gate.
5. Documentación, evidencia, push y CI.

## Verificación obligatoria

- `pnpm openapi:generate && pnpm openapi:check`
- `pnpm typecheck && pnpm test`
- `GOCACHE=/tmp/muebleria-go-cache go test ./... -count=1`
- race tests de auth/storage/API/pilot readiness
- `scripts/pilot-gate.sh --fresh-container`
- fresh, upgrade desde 000094 y rollback/reapply seguro
- guard que rechace rutas, DTOs y callers legacy
- `git diff --check`

## Scope reservado

#451 conserva last-admin, capabilities delegadas, seats, offboarding, sectores por
membership y revocación avanzada de sesiones. #458 conserva el workspace final de
Organization en React. #460 y #461 conservan sesiones avanzadas y outbox completo.

## Implementación resultante

- `User` usa `account_status=active|disabled`, email normalizado único,
  `email_verified_at` y `last_login_at`; los booleans legacy fueron retirados.
- `Membership` usa `active|suspended|left`, metadata de lifecycle, versión e ID
  público propio. Team no muta identidades globales.
- `Invitation` usa los seis estados canónicos, una invitación abierta por
  organización/email, token CSPRNG almacenado sólo como hash y rotación con
  historial de hashes anteriores.
- La aceptación exacta bloquea la invitación, serializa por email normalizado y
  confirma identidad, membership, consumo y auditoría en una transacción.
- Las respuestas sensibles de create/resend/accept se sellan con AES-GCM antes
  de guardar el receipt idempotente; el replay autorizado conserva la respuesta
  exacta sin persistir el token o la sesión en claro.
- Login, aceptación, Team y Platform consumen el cliente generado. Registro
  público y `/api/admin/users/*` dejaron de tener rutas o callers productivos.

## Evidencia local

| Comando | Resultado |
|---|---|
| `PATH="$HOME/.rbenv/shims:$PATH" ./init.sh` | PASS: TypeScript, Go y gate Ruby/RBZ completos |
| `pnpm install --frozen-lockfile` | PASS; lockfile sin cambios |
| `pnpm openapi:generate && pnpm openapi:check` | PASS; generated files current y legacy negative proofs |
| `pnpm typecheck` | PASS en 7 workspaces |
| `pnpm test` | PASS: 307 archivos, 3260 tests |
| `GOCACHE=/tmp/muebleria-go-cache go test ./... -count=1` | PASS en todos los paquetes, incluyendo PostgreSQL migration/storage y pilot readiness |
| `GOCACHE=/tmp/muebleria-go-cache go test -race ./internal/auth ./internal/storage ./internal/api ./tests/pilotreadiness -count=1` | PASS; también detectó y permitió corregir un header map compartido en replay concurrente |
| `scripts/pilot-gate.sh --fresh-container` | PASS con PostgreSQL 16 efímero, RLS directo, migrations 000001–000095 y cero skips de gate |
| `git diff --check` | PASS |

Pruebas nuevas cubren fresh/upgrade/colisión/rollback, SECURITY DEFINER exacto,
receipt sensible cifrado, stale/replay, accepts concurrentes, token rotado,
auditoría de fallo sanitizada, expiración persistida tras rollback del command,
aislamiento cross-org de comandos lifecycle, contraseña legacy existente,
autoridad Platform y `last_login_at` sólo tras autenticación exitosa.

## Estado de revisión y entrega

Receipt-driven review mode está `off`, decidido por `clone_local`. No se ejecutó
reviewer ni existe veredicto: `progress/review_F193.md` registra
`disabled/unmanaged` y F193 permanece `in_progress`. La entrega supera 400 líneas
y la estrategia de PR requiere decisión del maintainer antes de publicar.
