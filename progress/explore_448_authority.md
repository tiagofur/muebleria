# Auditoría de autoridad para #448 — contrato OpenAPI generado

## Veredicto de inicio

#448 está autorizada para implementación. La rama activa
`feat/448-generated-openapi-contract` parte de `eb1165a`, el mismo commit que
`main` y `origin/main`; ese commit es el merge de PR #463. La prerequisite #447
está `CLOSED` desde `2026-08-28T23:45:47Z`.

Esta entrega es el primer slice runtime de Organization Foundation v2. No debe
convertirse en otra capa de DTOs paralelos: el spec versionado, sus artefactos
generados y los adapters mínimos de boundary deben quedar consumidos por las
superficies prioritarias dentro del mismo PR.

## Autoridades leídas

- `AGENTS.md` y `progress/current.md`.
- `docs/architecture/organization-foundation-v2.md`.
- ADR-0006 y ADR-0005.
- `docs/architecture.md`, `docs/conventions.md` y `docs/verification.md`.
- Issues #446, #448, #462 y #443 completas, incluidos comentarios.

Orden de autoridad ante conflicto:

1. código/tests para `implemented today`;
2. Organization Foundation v2 + ADR-0006 para el target;
3. ADR-0005 para el baseline multi-org aún vigente;
4. #448 para el slice de contrato;
5. #462 para los negative proofs que debe habilitar el gate;
6. #443 sólo como consumidor futuro del contrato de concurrencia del catálogo.

## Decisiones normativas para la implementación

| Área | Decisión obligatoria |
|---|---|
| Fuente de verdad | Un OpenAPI v1 versionado gobierna DTOs de Identity, Organization Access, Organizations, Platform y Sales Network. No se mantiene otro contrato manual equivalente. |
| Generación | Go y TypeScript se generan de la misma spec, se commitean y tienen un check reproducible que falla si regenerar produce diff. |
| Consumo real | Auth, Platform y las superficies Organization Foundation prioritarias usan los tipos/adapters generados; agregar YAML o código generado no consumido no satisface #448. |
| Boundary runtime | Todo JSON externo permanece no confiable hasta validarlo/decodificarlo. En TypeScript se elimina `res.json() as Type` en superficies migradas; en Go no se expone `map[string]interface{}` como DTO público nuevo. |
| Errores | Envelope estable con `code`, `message`, `fieldErrors`, `requestId`, `retryable` y `details`. La lógica usa `code`; `message` es presentación localizada y nunca selector de comportamiento. |
| Request ID | Cada request tiene identificador propagado en header, envelope de error y logging; un valor entrante sólo se acepta si pasa la política de formato/tamaño del servidor. |
| Concurrencia | Recursos mutables exponen `version` y ETag; writes sensibles requieren `If-Match`. Un stale write falla con conflicto tipado 409/412 y no muta estado. |
| Idempotencia | Creates/commands críticos requieren `Idempotency-Key`. Misma key + mismo command/payload reproduce el resultado; misma key + payload distinto devuelve `IDEMPOTENCY_CONFLICT`. Retención y alcance de la key quedan explícitos y testeados. |
| Transporte auth | El contrato distingue `web`, `mobile`, `sketchup` y `support`; no anticipa una política completa de refresh/MFA ni permite extender la sesión absoluta de 18 horas. |
| Arquitectura | Handlers parsean/autentican/mapean; application services conservan autoridad server-side para concurrencia e idempotencia. React no replica esas reglas. |
| Compatibilidad | Se preservan rutas y shapes actuales sólo cuando son correctos. La compatibilidad puede existir durante la rama/PR, pero al cerrar no queda fallback runtime silencioso ni DTO duplicado en una superficie migrada. |
| Seguridad | `organizationId` del payload nunca autoriza. El contrato tipado no sustituye middleware, capability, ownership, repository scope, RLS futuro ni negative tests. |

Los códigos mínimos requeridos por #448 son:

```text
MEMBERSHIP_NOT_FOUND
MEMBERSHIP_VERSION_CONFLICT
ROLE_NOT_ALLOWED
LAST_ADMIN
SEAT_LIMIT_REACHED
INVITATION_EXPIRED
INVITATION_ALREADY_USED
ORGANIZATION_PROVISIONING
RELATIONSHIP_NOT_ACTIVE
FACTORY_NOT_AUTHORIZED
CATALOG_VERSION_UNAVAILABLE
IDEMPOTENCY_CONFLICT
```

## Alcance de #448

### Incluido

- spec OpenAPI versionado y documentación de generación/migración;
- tipos/DTOs generados Go y cliente/types generados TypeScript;
- adapters compartidos para auth, request ID, parsing y errores tipados;
- contratos reusables de ETag/`If-Match` e `Idempotency-Key`;
- tests de contrato y CI anti-drift;
- migración real de auth/login/me/select-org/refresh/sesión según rutas
  existentes verificadas;
- migración real de Platform users/audit al shape emitido por Go;
- migración de Organization Foundation prioritaria: memberships/team,
  invitations y organizations/platform actualmente implementadas;
- shapes autoritativos para relationships y Sales Network sin fingir endpoints
  runtime que pertenecen a issues futuras;
- eliminación de casts ciegos, decisión por substring y DTOs manuales duplicados
  en las superficies migradas.

### Excluido

- RLS y tenant transaction runner (#449);
- lifecycle invitation-first y cambios de schema de Membership/Invitation (#450);
- last-admin, offboarding, seats y sectores (#451);
- provisioning/lifecycle completo de Organization (#452);
- Relationship persistida y autorización cross-org (#453);
- CatalogPublication/subscription (#454), pricing (#455), ManufacturingOrder
  (#456) e Installation assignment (#457);
- migración integral de server state/session/Team/Platform UX (#458);
- política completa de refresh, MFA, media y sesiones revocables (#460);
- audit/outbox durable (#461);
- persistencia per-entity del catálogo (#443).

No implementar esos dominios dentro de #448. Sí dejarles componentes OpenAPI y
primitivas reusables donde #448 es la autoridad explícita.

## Acceptance verificable para la feature

- [ ] Existe un único OpenAPI v1 versionado y válido para las superficies
  acordadas.
- [ ] Un comando determinista genera Go + TypeScript; CI ejecuta generación y
  falla ante diff no commiteado.
- [ ] El backend y el cliente compilan usando artefactos generados, no copias
  manuales equivalentes.
- [ ] Login/me/select-org/refresh y las respuestas migradas se prueban contra el
  shape real del spec.
- [ ] Platform users consume el shape real de memberships/organization y audit
  consume los nombres reales de IP/details definidos por la spec.
- [ ] JSON inválido en el boundary TS se rechaza; ningún `res.json() as ...`
  permanece en superficies migradas.
- [ ] Ninguna respuesta pública nueva/migrada de Organization Foundation usa
  `map[string]interface{}` como contrato.
- [ ] Todo error HTTP migrado usa el envelope tipado y conserva `requestId`;
  tests fallan si el comportamiento se decide por texto localizado.
- [ ] Tests de ETag/`If-Match` prueban parseo válido/inválido, stale conflict y
  ausencia de overwrite.
- [ ] Tests de idempotencia prueban replay idéntico y conflicto por payload
  distinto, con scope y retención documentados.
- [ ] El cliente común centraliza auth header, request ID, parsing y tratamiento
  tipado de 401/403/409/412.
- [ ] #443 consume estas primitivas por referencia y no introduce una variante
  catalog-only ni publication scope.
- [ ] No queda fallback temporal runtime en las superficies cerradas por el PR.
- [ ] `pnpm test`, `pnpm typecheck`, suite storage/web afectada, `go test ./...`,
  drift check y CI remoto están verdes antes de marcar `done`.

## Negative proofs heredados por Gate A

La implementación debe dejar pruebas que fallen si:

1. React espera un campo no emitido por Go;
2. un payload inválido pasa por cast;
3. la misma idempotency key acepta payloads diferentes;
4. un `If-Match` stale sobrescribe el recurso;
5. una pantalla elige comportamiento sensible por substring de `message`;
6. se reintroduce un DTO manual incompatible en una superficie migrada;
7. falla una API nueva y el cliente cae silenciosamente a legacy.

## Ledger

Auditoría programática de `feature_list.json` en el snapshot inicial:

```text
features: 186
done: 181
pending: 5
in_progress: 0
max ID: F190
siguiente ID disponible: F191
```

Por lo tanto, #448 debe registrarse como **F191**, exactamente una vez, con
estado inicial `in_progress`. Debe referenciar #446, #448,
`docs/architecture/organization-foundation-v2.md` y ADR-0006; tags mínimos:
`api`, `backend-go`, `web`, `contracts`, `security`. Sólo pasa a `done` con la
acceptance anterior y verificaciones verdes. Si otro proceso asigna F191 antes
de escribir el ledger, se debe recalcular el máximo en ese instante y no
hardcodear este resultado de auditoría.

## Coordinación futura con #443

#443 no redefine ETag, stale errors ni idempotencia. Después de mergear #448,
el catálogo debe aplicar este mismo contrato a writes por entidad, mantener
`organizationId` en ownership/cache keys y usar BroadcastChannel sólo como hint
de refetch. Publication/subscription permanece exclusivamente en #454.
