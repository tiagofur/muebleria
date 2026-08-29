# Auditoría web, storage y CI para #448

## Resultado ejecutivo

La migración no puede limitarse a generar tipos: hoy las superficies prioritarias
usan `fetch` y DTOs manuales en cinco lugares distintos, y existen desajustes reales
que TypeScript no detecta. El slice debe introducir un cliente común validado en
runtime y hacer que Auth, Team y Platform lo consuman en este mismo PR. No existe
actualmente tooling OpenAPI ni un gate de drift en CI.

También hay dos diferencias respecto de los nombres sugeridos en la tarea:
`packages/storage/src/api.ts` y `packages/storage/src/workspaceApi.ts` no existen.
La implementación equivalente actual es
`packages/storage/src/apiWorkspaceRepository.ts`; los mappers están en
`packages/storage/src/apiMappers.ts`.

## Drift comprobado

| Superficie | Cliente actual | Backend real | Consecuencia |
|---|---|---|---|
| Platform users | `PlatformUserRow.memberships[]` espera `organization_name` y `organization_slug` en `packages/ui/src/platform/PlatformScreen.tsx` | `MembershipDTO` en `backend-go/internal/api/handlers.go` emite `organization: { id, name, slug, type, license }` | búsqueda y nombres de talleres usan propiedades inexistentes; no hay test de Platform que lo detecte |
| Platform audit | `SecurityAuditEventRow` espera `ip_address` y `metadata` | `ListSecurityAuditEvents` en `backend-go/internal/storage/organizations.go` emite `ip` y `details` | IP aparece como `—`; detalle aparece vacío |
| Platform audit details | UI tipa `metadata` como objeto | storage escanea `details` como `[]byte` y lo pone en `map[string]interface{}` | al serializar el mapa, `details` puede convertirse en string base64 en vez de objeto JSON; el contrato público no está tipado |
| Team members | `UserRow` exige `id` y `created_at`, con `user_id` opcional | `OrgTeamMember` emite `user_id` y `member_since` | la pantalla sólo funciona porque usa `user_id || id`; el tipo no representa la respuesta real |
| Membership status | `UsersScreen` interpreta `active` como estado del miembro | `ListOrgTeam` filtra `m.active` y devuelve `u.active` | membresías suspendidas desaparecen y `active` representa cuenta global, no membership; el contrato debe nombrar ambas dimensiones sin inventar lifecycle ya no implementado |
| Invitation lifecycle | `OrgInvitationRow` sólo conoce fechas y deriva “Pendiente/Vencida” en el navegador | backend devuelve accepted/revoked/expiry timestamps, sin status explícito | el frontend reconstruye estado parcial y lista invitaciones aceptadas/revocadas como “pendientes” |

## Inventario de boundaries manuales

### Platform

- `packages/ui/src/platform/PlatformScreen.tsx`
  - Declara manualmente `OrganizationRow`, `PlatformUserRow` y
    `SecurityAuditEventRow`.
  - `loadOrganizations`, `loadUsers`, `loadAudit`, `handleCreateOrg`,
    `handleUpdateOrg` y `handleStartSupportSession` hacen `fetch` directo.
  - Contiene siete conversiones de `res.json()` con `as`.
  - Los errores de mutación esperan `{ error?: string }`; no hay `code`,
    `requestId`, `fieldErrors`, `retryable` ni `details`.
  - `loadAudit` ignora status no-OK y excepciones, convirtiendo un fallo parcial
    en lista previa/vacía.
  - No envía `If-Match` ni `Idempotency-Key`; crea organizaciones y sesiones de
    soporte sin protección de doble envío.

### Team

- `packages/ui/src/users/UsersScreen.tsx`
  - Declara `UserRow` y `OrgInvitationRow`; contiene cinco casts directos de
    `res.json()`.
  - `load()` prueba `/org/team` y, ante cualquier fallo, llama silenciosamente
    `/admin/users`. Es el fallback legacy expresamente prohibido por ADR-0006.
  - La carga de invitaciones ignora toda falla y la presenta como complemento
    ausente; no distingue partial failure de empty.
  - `saveMultiRoles` muestra `body.error`; las demás mutaciones deciden casi
    sólo por `res.ok` y texto genérico. 403/409/412 no tienen UX diferenciada.
  - `approve` y `reject` siguen llamando `/admin/users/*`; esas operaciones son
    bridge legacy de account approval, no commands de membership.
  - Roles y activación se hacen con `PUT` sin `If-Match`; invitación create sin
    `Idempotency-Key`.
- `packages/ui/src/users/SectorAssignment.tsx`
  - Hace fetch directo a `/admin/users/{id}/sectors` y castea el JSON.
  - Mantiene otra implementación de headers/errores fuera del cliente común.

### Auth/session

- `apps/web/src/session.ts`
  - Mantiene a mano `AuthUser`, `OrgSummary`, `MembershipChoice`,
    `SupportInfo` y `LoginSuccess`.
  - `loginRequest`, `selectOrgRequest`, `meRequest` y `endSupportRequest`
    implementan cada uno su boundary; `meRequest` hace cast ciego del body.
  - `parseAuthResponse` valida sólo una parte: castea el objeto raíz, acepta
    organization/membership por checks mínimos y convierte IDs faltantes a `''`.
    No valida nested license, organization, membership roles ni client/session
    kind.
  - `readErrorMessage` prioriza `{ error }`/`{ message }`; la UI no puede decidir
    por código estable. Login además decide mensajes por 401/403 y Register por
    409, sin envelope común.
  - No hay cliente de refresh en web pese a existir `/auth/refresh`; el contrato
    actual tampoco distingue claramente web/mobile/SketchUp/support en el DTO.
- `apps/web/src/SessionGate.tsx` sólo orquesta estados. Es buen consumidor para
  los errores tipados y para invitation acceptance, pero actualmente recibe
  strings desde `workspaceStore`.
- `apps/web/src/OrgPicker.tsx` consume el DTO manual `MembershipChoice` y no
  guarda server state; debe cambiar al tipo generado, no duplicarlo.
- `apps/web/src/stores/workspaceStore.ts`
  - Centraliza sesión, pero aún castea JSON en assignable owners/media y conserva
    fallbacks por regex de mensaje (`/401|unauthorized/i`).
  - `selectOrg` sí vacía `workspace` y `assignableOwners` y rekeyea
    `authUserSeq`, lo que evita reusar el token anterior. Sin embargo no existe
    un cache server-state tenant-keyed general; catalog/project stores dependen
    de resets/effects.
  - `hydrateSessionInfo` silencia cualquier error como best-effort, incluida una
    respuesta inválida.
  - `loadAssignableOwners` cae al usuario actual ante fallo del endpoint; es
    otro fallback runtime que puede presentar datos incompletos como válidos.
  - `resolveMediaUrl` agrega el bearer JWT como query param, deuda explícita de
    #460 y fuera del cambio de shapes de #448.

### Storage

- `packages/storage/src/apiWorkspaceRepository.ts` es el cliente HTTP general
  actual (2.577 líneas). Contiene al menos 36 casts de respuestas JSON, mensajes
  construidos desde status/texto y varios 404→empty.
- `isConflict` acepta 409 o busca regex localizado/legacy en el body de un 400.
  Esa función es una prueba concreta de comportamiento por texto y debe dejar de
  ser el mecanismo de las superficies migradas.
- `upsert` intenta PUT y luego POST por 404/405, transport error o incluso 500
  cuyo body contenga `not found|no rows`. Esta compatibilidad no debe copiarse al
  nuevo cliente Organization Foundation.
- `packages/storage/src/apiMappers.ts` es un mapper manual grande (4.026 líneas)
  con coerciones tolerantes (`str`, `num`, `bool`) y múltiples casts. Puede
  seguir sirviendo dominios legacy no migrados, pero no debe ser el runtime
  validator de Auth/Team/Platform ni albergar DTOs OpenAPI paralelos.

## HTTP transversal actual

- `respondWithError` en `backend-go/internal/api/handlers.go` sólo emite
  `{ "error": message }`.
- No hay middleware de request ID ni headers `X-Request-ID` en respuesta.
- No hay contrato reusable `If-Match`/ETag para Organization Foundation ni
  middleware de `Idempotency-Key`. Sólo se encontraron ETags aislados en la
  biblioteca de muebles.
- `CORSMiddleware` en `backend-go/internal/api/middleware.go` sólo permite
  `Content-Type, Authorization`. Un browser no podrá enviar `If-Match`,
  `Idempotency-Key` o `X-Request-ID` hasta ampliar la allowlist; también debe
  exponer `ETag` y `X-Request-ID` si el cliente los lee.
- `apps/web/src/auth401.ts` intercepta globalmente 401 de rutas no-auth y hace
  logout una vez por token. Esto se debe preservar al centralizar el cliente;
  Auth continúa tratando su propio 401. Hoy no hay policy común para 403, 409 o
  412.
- Los handlers Team/Platform escriben audit con `s.audit`, que es best-effort.
  La durabilidad transaccional pertenece a #461, pero el contrato generado debe
  tipar el read model y no perpetuar `map[string]interface{}`.

## Superficies prioritarias para migrar en #448

1. **Plumbing común en `@granete/storage`:** transporte con bearer opcional,
   request ID, parsing JSON, validación runtime, `ApiError` tipado, manejo de
   401/403/409/412, ETag/If-Match e Idempotency-Key.
2. **Auth:** login, me, select-org, refresh, accept-invitation y support session.
   `session.ts`, `SessionGate`, `OrgPicker` y `workspaceStore` deben consumir
   tipos/validators generados sin DTO manual paralelo.
3. **Team:** list members, roles/status commands e invitations. Eliminar el
   fallback `/org/team`→`/admin/users`; no presentar fallo de invitations como
   empty. La aprobación global legacy no debe disfrazarse como Team nuevo.
4. **Platform:** organizations, users, audit y support sessions. Migrar primero
   porque contiene los dos drifts verificables pedidos por la issue.
5. **Storage legacy:** no es realista ni necesario migrar las 2.577 líneas de
   `APIWorkspaceRepository` para cerrar #448; sí hay que impedir que las nuevas
   Organization Foundation surfaces vuelvan a entrar allí como `fetch` manual.

El OpenAPI puede declarar contratos futuros de relationships/network como
componentes y paths dueños claramente marcados, pero no se deben crear llamadas
runtime ni respuestas falsas antes de #453–#459.

## CI y tooling

- `package.json` sólo tiene build/test/typecheck/smokes; ningún script OpenAPI.
- `packages/storage/package.json` sólo depende de `@granete/domain`; no contiene
  generador ni validator runtime.
- `backend-go/go.mod` no contiene un generador OpenAPI.
- `.github/workflows/ci.yml` valida ledger, ejecuta TypeScript, Ruby y Go con
  PostgreSQL, pero no valida spec ni regeneración.
- No se encontraron archivos OpenAPI/Swagger ni scripts de generación.

Gate mínimo recomendado:

1. validar sintaxis y referencias del spec;
2. generar Go y TypeScript determinísticamente;
3. ejecutar format/typecheck/tests;
4. `git diff --exit-code` sobre directorios generated;
5. un test de router/contract que serialice respuestas Go prioritarias y las
   valide contra el schema, no sólo snapshots TS.

El código generado debe commitearse y llevar banner “generated; do not edit”.
La versión del generador debe quedar fijada; no usar una instalación global no
reproducible.

## Pruebas necesarias

### Contrato y runtime validation

- Platform users: fixture real Go con `membership.organization.name/slug`; el
  cliente lo renderiza y falla si reaparecen `organization_name/slug`.
- Platform audit: `ip` y `details` tipados; `details` debe ser objeto JSON y no
  bytes/base64; actor/target/org pueden ser null.
- Team list: respuesta con `user_id`, account status y membership status
  distintos; no aceptar shape legacy por cast.
- Auth: reject token/user/organization/membership nested inválidos; cubrir
  selección con múltiples organizaciones y support session.
- Negative proof: cada boundary rechaza un campo requerido ausente o tipo
  incorrecto antes de mutar store/UI.

### Error/client behavior

- Envelope válido conserva `code`, `fieldErrors`, `requestId`, `retryable` y
  `details`; body inválido/non-JSON produce un `ApiError` seguro con el mismo
  request ID del header.
- 401 business dispara una sola expiración por token; 401 de login no dispara
  logout global.
- 403 no se interpreta como sesión expirada; 409 idempotency y 412 precondition
  llegan con códigos distintos y accesibles por `error.code`.
- Team/Platform prueban decisiones sensibles por `code`, nunca por `message`.
- No hay fetch a `/admin/users` cuando `/org/team` falla.

### Concurrencia e idempotencia

- GET mutable expone `ETag`; command/update envía exactamente `If-Match`.
- stale `If-Match` devuelve 412/envelope tipado y no muta el recurso.
- same idempotency key + same request devuelve mismo status/body/ETag;
  same key + payload distinto devuelve `IDEMPOTENCY_CONFLICT` y no ejecuta dos
  veces.
- ausencia/formato inválido de headers críticos produce error tipado.
- CORS preflight admite y expone los headers nuevos.

### Estado y UX

- Organization switch invalida workspace y toda lista remota del tenant previo
  antes de renderizar el nuevo tenant.
- Team distingue loading/empty/partial invitation failure/403/conflict.
- Platform audit conserva error y retry en vez de silenciarlo.
- Mutaciones anuncian éxito sólo después de respuesta autoritativa; conflicto
  conserva formulario/datos para reintento.

## Límites de este slice

- No migrar todos los endpoints operativos/catálogo del monorepo.
- No implementar RLS (#449), lifecycle completo (#450–#452), durable outbox
  (#461) ni refresh/MFA final (#460).
- Sí dejar contratos reutilizables y consumidores reales, sin fallback temporal
  en Auth/Team/Platform al cerrar #448.
