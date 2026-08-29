# Auditoría backend — #448 Generated OpenAPI contract

Fecha: 2026-08-28
Rama observada: `feat/448-generated-openapi-contract`
Alcance: auditoría de rutas, DTOs, errores HTTP, auth/sesiones, concurrencia,
idempotencia, auditoría, tests y CI. No se modificó runtime.

## Resumen ejecutivo

El backend no tiene OpenAPI ni tooling de generación. Las superficies de
Organization Foundation están registradas a mano en `net/http.ServeMux`, usan
DTOs Go manuales y varias respuestas públicas se construyen con
`map[string]interface{}`. El error público actual es únicamente
`{"error":"mensaje"}`; no existe `code`, `fieldErrors`, `requestId`,
`retryable` ni `details` tipados.

Tampoco hay middleware de request ID, soporte reutilizable de `If-Match`, ni
persistencia/semántica para `Idempotency-Key`. La única ETag real del backend es
de caché de lectura del catálogo remoto de SketchUp; no protege mutaciones. Las
tablas `organizations`, `memberships` e `invitations` no tienen `version`.

La migración debe ser vertical: spec -> código generado Go/TS -> adapters/handlers
reales -> cliente común -> screens consumidoras -> drift check. Agregar sólo el
YAML o tipos no usados no cerraría #448.

## 1. Paths y operaciones reales

Autoridad de routing: `backend-go/internal/api/routes.go`, función
`RegisterRoutes`.

### Auth y sesión

| Método y path real | Handler | Contrato actual |
|---|---|---|
| `POST /api/auth/register` | `HandleRegister` | `RegisterRequest`; respuesta `map[string]string` |
| `POST /api/auth/login` | `HandleLogin` | `LoginRequest` -> `LoginResponse` |
| `POST /api/auth/refresh` | `HandleRefresh` | sin request body -> `LoginResponse` |
| `POST /api/auth/select-org` | `HandleSelectOrg` | request struct anónimo `{organization_id}` -> `LoginResponse` |
| `GET /api/auth/me` | `HandleMe` | respuesta dinámica `map[string]interface{}` |
| `POST /api/auth/accept-invitation` | `HandleAcceptInvitation` | request struct anónimo -> `LoginResponse` |

`LoginResponse`, `PublicUserDTO`, `LicenseDTO`, `OrgSummaryDTO` y
`MembershipDTO` están definidos manualmente en
`backend-go/internal/api/handlers.go`. `MembershipDTO` devuelve una
`organization` anidada; no emite `organization_name` ni `organization_slug`.
`HandleMe` vuelve a construir otra projection manual y opcionalmente agrega
`support` como mapa.

`backend-go/internal/auth/auth.go` distingue hoy sólo token web vacío,
`sketchup-extension` y support mediante claims. No existe enum de transport
generado para `web | mobile | sketchup | support`. `HandleRefresh` genera un JWT
nuevo con `now + 18h`, por lo que hoy el refresh es sliding; el contrato canónico
exige preservar un absolute expiry de 18h. La implementación completa de esa
política pertenece a #460, pero #448 debe evitar un DTO ambiguo que la impida.

### Organization Access

| Método y path real | Handler | Respuesta pública actual |
|---|---|---|
| `GET /api/org/team` | `HandleOrgTeam` | `[]storage.OrgTeamMember` |
| `PUT /api/org/members/{userId}/roles` | `HandleOrgMemberRoles` | mapa `{roles}` |
| `PUT /api/org/members/{userId}/active` | `HandleOrgMemberActive` | mapa `{active}` |
| `GET /api/org/invitations` | `HandleOrgListInvitations` | `[]storage.Invitation` |
| `POST /api/org/invitations` | `HandleOrgCreateInvitation` | `map[string]interface{}` con token one-shot |
| `DELETE /api/org/invitations/{id}` | `HandleOrgRevokeInvitation` | mapa `{message}` |

Los handlers y autorización están en `backend-go/internal/api/orgteam.go`.
Los DTOs públicos `OrgTeamMember`, `Invitation` y `OpenInvitation` viven en
`backend-go/internal/storage/organizations.go`, mezclando persistence y
presentation. Los requests son structs anónimos. No hay ETag ni `If-Match`.

Brechas de dominio que deben reflejarse honestamente en el spec, sin fingir que
ya están implementadas: `Membership` sólo tiene `active bool`; `ListOrgTeam`
filtra `m.active`, por lo que no lista suspended/left; no hay `status`, `version`
ni last-admin gate. Esas implementaciones pertenecen a #450/#451, pero sus
futuros schemas/errores deben nacer en el contrato de #448.

### Platform y organizaciones

| Método y path real | Handler | Contrato actual |
|---|---|---|
| `GET /api/platform/organizations` | `HandlePlatformListOrganizations` | `[]PlatformOrgDTO` |
| `POST /api/platform/organizations` | `HandlePlatformCreateOrganization` | request anónimo -> `PlatformOrgDTO` |
| `PATCH /api/platform/organizations/{id}` | `HandlePlatformUpdateOrganization` | `map[string]json.RawMessage` -> `PlatformOrgDTO` |
| `GET /api/platform/organizations/{id}/audit` | `HandlePlatformOrgAudit` | `[]map[string]interface{}` |
| `GET /api/platform/users` | `HandlePlatformUsers` | row local con `PublicUserDTO` + `[]MembershipDTO` |
| `POST /api/platform/organizations/{id}/support-session` | `HandlePlatformStartSupportSession` | `map[string]interface{}` |
| `DELETE /api/platform/support-sessions/{sessionId}` | `HandlePlatformEndSupportSession` | mapa `{ended}` |

`PlatformOrgDTO` y `toPlatformOrgDTO` viven manualmente en
`backend-go/internal/api/platform.go`. `domain.Organization` y
`domain.Membership` están en `backend-go/internal/domain/organization.go` y
todavía representan el baseline con `active bool`; no tienen lifecycle ni
`version`.

`HandlePlatformCreateOrganization` inserta una organización `active=true` y
después clona catálogo en otra operación. Un fallo del clone puede dejar una
organización activa parcial. #452 debe corregir provisioning/atomicidad, pero
el spec de #448 debe modelar estados y respuestas de provisioning sin presentar
esta ruta actual como el target final.

### Sales network

El único runtime actual es:

- `GET|POST /api/factory/organizations` -> `factory.go`;
- `organizations.parent_organization_id` de migración 000089;
- clon de catálogo y memberships del creador.

No existen todavía endpoints de `OrganizationRelationship`, publication,
pricing u orders. El OpenAPI puede definir schemas/componentes y paths futuros
con ownership claro, pero no se deben registrar handlers placeholder que
devuelvan éxito. Sus implementaciones pertenecen a #453-#457/#459.

## 2. Errores y response plumbing

### Implementación actual

- `respondWithError` y `respondWithJSON` están en
  `backend-go/internal/api/handlers.go`.
- `respondWithError` siempre serializa `map[string]string{"error": message}`.
- `respondWithInternalError` registra `op`/`error` con `slog`, pero no request ID.
- `decodeJSONBody` limita a 1 MiB, pero no usa `DisallowUnknownFields`, no
  comprueba un segundo valor JSON y devuelve sólo mensajes genéricos.
- `backend-go/internal/api/errors.go` sólo reconoce duplicate/FK por SQLSTATE y,
  como fallback, por substring del error. No hay error de aplicación tipado.
- Algunos handlers aún clasifican todo error de repository como 404
  (`UpdateMembershipRolesByOrg`, `SetMembershipActive`) o responden por texto.

No existe ningún uso de `X-Request-ID`, `requestId` o trace ID en backend, storage
o CI. Tampoco existe recovery middleware común que garantice el envelope.

### Contrato requerido

Crear un único `ApiError` público generado con:

```text
code, message, fieldErrors, requestId, retryable, details
```

y un error interno tipado que mapee status + code sin inspeccionar texto. Deben
existir como mínimo los codes de #448: `MEMBERSHIP_NOT_FOUND`,
`MEMBERSHIP_VERSION_CONFLICT`, `ROLE_NOT_ALLOWED`, `LAST_ADMIN`,
`SEAT_LIMIT_REACHED`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_USED`,
`ORGANIZATION_PROVISIONING`, `RELATIONSHIP_NOT_ACTIVE`,
`FACTORY_NOT_AUTHORIZED`, `CATALOG_VERSION_UNAVAILABLE` e
`IDEMPOTENCY_CONFLICT`.

Agregar middleware temprano que acepte sólo request IDs válidos o genere uno,
lo coloque en context, emita `X-Request-ID`, lo incluya en todos los errores y
lo pase a logs/audit. CORS actualmente permite únicamente
`Content-Type, Authorization`; debe incluir `X-Request-ID`, `If-Match` e
`Idempotency-Key` y exponer `X-Request-ID`, `ETag` y `Idempotency-Replayed` si
ese header se adopta.

## 3. Concurrencia y ETag

No hay helper de precondiciones ni uso de `If-Match` para writes. Las tablas
core creadas por `000080_multi_org_core.up.sql` no tienen `version`.
`UpdateOrganization`, `UpdateMembershipRolesByOrg`, `SetMembershipActive` y
revoke de invitación actualizan sin expected version, por lo que un write stale
sobrescribe silenciosamente.

La única ETag existente está en `backend-go/internal/api/furniture.go` para
`GET /api/furniture/definitions`: ETag content-derived + `If-None-Match` -> 304.
Es caché de lectura, no optimistic concurrency. No debe confundirse con el
contrato reusable que consumirá #443.

Recomendación sin fallback:

1. Parser/formatter único para ETags fuertes de versión.
2. Responses mutables emiten `ETag` y body `version` coherentes.
3. Writes sensibles requieren `If-Match`; ausencia -> `428`, mismatch -> `412`
   o el status canónico elegido, siempre con code tipado. No aceptar un body
   version paralelo como vía silenciosa.
4. Repository hace `UPDATE ... WHERE id=? AND version=?` y aumenta `version` en
   la misma statement; `RowsAffected=0` distingue missing vs stale con lectura
   scoped.
5. Tests prueban exact match, missing header, malformed tag y stale write sin
   mutación.

La persistencia `version` de Membership/Invitation/Organization puede requerir
migración coordinada con sus owner issues; si #448 migra ya los writes
prioritarios, debe hacerlo de verdad. Un helper no usado no satisface el
negative proof de stale overwrite.

## 4. Idempotencia

No hay lectura de `Idempotency-Key`, tabla de receipts, fingerprint de payload,
retention ni replay de response. Comentarios de "idempotent" en seed, events o
support logout describen comportamientos locales distintos; no implementan el
contrato HTTP de #448.

Recomendación reusable:

- key obligatoria en critical create/command y validada por formato/longitud;
- scope por actor/organization + operation, no global a secas;
- fingerprint determinista de method/path/canonical payload;
- receipt con estado `in_progress|completed`, status, headers relevantes,
  response body y expiración/retention documentada;
- misma key + mismo fingerprint replays exactamente el resultado y marca el
  replay; misma key + fingerprint distinto devuelve 409
  `IDEMPOTENCY_CONFLICT`; concurrent duplicate espera/resuelve el mismo receipt;
- business mutation + receipt se confirman en la misma transacción cuando la
  operación es DB-only.

Para cerrar #448 debe existir al menos un endpoint prioritario migrado y tests
de replay/mismatch/concurrencia. La invitación create/accept es el candidato más
directo; organization provisioning debe adoptar el mismo componente cuando
aterrice #452.

## 5. Security audit events

Schema actual: `backend-go/db/migration/000080_multi_org_core.up.sql`, tabla
`security_audit_events(id, event_type, actor_user_id, target_user_id,
organization_id, ip, details, created_at)`.

Implementación: `SecurityAuditEvent`, `InsertSecurityAuditEvent` y
`ListSecurityAuditEvents` en `backend-go/internal/storage/organizations.go`.

Brechas:

- `Server.audit` en `handlers.go` es explícitamente best-effort y usa una
  operación aparte; no es transaccional con la mutación;
- no registra request ID;
- el read model es `[]map[string]interface{}`;
- `details jsonb` se escanea como `[]byte`, así que JSON lo serializa en base64.
  `backend-go/tests/pilotreadiness/platform_test.go` documenta y tolera este
  comportamiento, confirmando el drift; el contrato objetivo debe devolver
  `details` como objeto JSON tipado, no como base64;
- servidor usa `ip`/`details`; los consumidores legacy que esperen
  `ip_address`/`metadata` están desalineados.

#461 es dueña de durabilidad/outbox. #448 sí debe fijar y usar la projection
HTTP generada real (`ip`, `details`, requestId/correlation según spec) para que
Platform renderice el shape emitido sin adapters inventados.

## 6. Tests existentes y huecos

Cobertura útil actual:

- `backend-go/internal/api/login_org_test.go`: multi-membership, org hint,
  select-org, foreign org y audit de login fallido.
- `backend-go/internal/api/middleware_test.go`: CORS, live membership roles,
  membership/org revocation y support session.
- `backend-go/internal/api/handlers_test.go`: uniform 401 en login y helpers
  generales; no contiene suite completa de Platform/Org Team.
- `backend-go/tests/pilotreadiness/membership_test.go`: `/auth/me`, team,
  membership active/roles y tenant switching con PostgreSQL real.
- `backend-go/tests/pilotreadiness/platform_test.go`: organizations, support
  session y audit; hoy codifica la tolerancia a `details` base64.
- `backend-go/tests/pilotreadiness/crossorg_test.go`: team isolation.
- `backend-go/internal/storage/multi_org_migration_test.go`: fresh/upgrade del
  baseline multi-org.

Huecos específicos de #448:

- ningún golden/round-trip OpenAPI vs handlers/client;
- ningún test de generation drift;
- ningún invalid-response runtime validation test;
- ningún test de `ApiError.code` ni prohibición de lógica por message;
- ningún request ID propagation test;
- ningún `If-Match` mutation/stale test;
- ningún idempotency replay, payload mismatch o concurrent duplicate test;
- no hay guard que prohíba `map[string]interface{}` como response público en
  las surfaces migradas;
- no hay test que falle si Platform espera propiedades distintas a Go.

## 7. CI y tooling actual

`.github/workflows/ci.yml` tiene:

1. ledger/harness validation;
2. pnpm install + typecheck + tests;
3. Ruby extension verify;
4. Go `go test -v ./...` con PostgreSQL 16 real.

No hay job/step OpenAPI. `package.json`, `packages/storage/package.json` y
`backend-go/go.mod` no declaran generadores OpenAPI. No existe spec, generated
directory, `go:generate`, Make target ni script de drift.

El gate recomendado debe ejecutar una generación determinista desde checkout
limpio y luego fallar si `git diff --exit-code` detecta outputs no commiteados.
Además debe validar el spec y ejecutar tests de contrato/runtime. Los binarios y
versiones de generator deben pinnearse; no descargar `latest` implícito.

## 8. Recomendación de migración vertical para #448

1. Crear `contracts/openapi/granete-api.v1.yaml` y README con política de
   versionado, error codes, ETag/If-Match, idempotency retention/replay y auth
   client kinds.
2. Generar modelos/server types Go en
   `backend-go/internal/api/openapi/generated`; mantener adapters explícitos
   entre domain/storage y transport, sin mover reglas de dominio al generated.
3. Generar types + cliente TS en
   `packages/storage/src/openapi/generated`; construir un único `apiClient.ts`
   para auth, request ID, error status/codes, parsing y runtime validation.
4. Implementar plumbing común Go (`errors`, request ID, preconditions,
   idempotency) y hacerlo pasar por el router real.
5. Migrar verticalmente auth login/me/select-org/accept-invitation,
   team/invitations, Platform users/organizations/audit/support sessions. En
   esas rutas, requests/responses usan generated types o adapters typed; retirar
   mapas públicos y DTOs manuales duplicados.
6. Corregir Platform audit para emitir `details` JSON object y Platform users
   para consumir exactamente `organization` anidada generada.
7. Migrar consumers React al cliente común y borrar fetch/casts/fallbacks de
   esas surfaces en el mismo PR. No conservar ruta legacy al fallar la nueva.
8. Añadir contract tests de los negative proofs y CI drift. Ejecutar Go con DB,
   storage tests, typecheck/tests TS y el gate completo.

### Boundary de compatibilidad

Preservar paths y casing JSON actuales sólo donde son correctos y están
consumidos. Un alias puede existir dentro de un adapter de migración durante el
PR, pero al cierre no deben coexistir dos shapes ni un fallback runtime. Para
campos ya drifted (`organization` vs flat names, `ip/details` vs
`ip_address/metadata`) elegir el shape OpenAPI, actualizar producer y consumer
juntos y eliminar el alternativo.

## Hallazgos críticos para el implementador

1. `packages/storage/src/api.ts` y `packages/storage/src/workspaceApi.ts`
   mencionados en el prompt no existen en este checkout. El cliente HTTP real
   general es `packages/storage/src/apiWorkspaceRepository.ts`; los mappers
   manuales están en `packages/storage/src/apiMappers.ts`.
2. `AcceptInvitationTx` sí hace invitation + membership atómico, pero la
   creación del nuevo `User` ocurre antes, fuera de esa transacción, con cleanup
   best-effort. No confundir esto con idempotencia HTTP completa.
3. `HandlePlatformCreateOrganization` puede persistir active antes de clone; el
   contrato no debe legitimar el success parcial.
4. CORS bloquearía desde browser los headers nuevos hasta actualizar
   `CORSMiddleware`.
5. Audit `details` base64 está probado como comportamiento actual; hay que
   cambiar test y consumer al objeto generado, no perpetuarlo en OpenAPI.
6. `furniture.go` demuestra ETag de caché de lectura, no el contract de
   optimistic concurrency de #448/#443.
