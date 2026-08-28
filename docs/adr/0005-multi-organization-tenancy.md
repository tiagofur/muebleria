# ADR-0005 — Multi-Organization Tenancy (row-level) con membresías multi-rol y soporte de plataforma auditado

- **Status:** Accepted; extended by ADR-0006
- **Date:** 2026-08-26
- **Decision owners:** Product + Engineering
- **Tracking:** [#325](https://github.com/tiagofur/muebleria/issues/325),
  [#326](https://github.com/tiagofur/muebleria/issues/326),
  [#327](https://github.com/tiagofur/muebleria/issues/327)
- **Extiende:** `docs/multi-organization-distribution-model.md`
- **Extensión vigente:** `docs/adr/0006-membership-lifecycle-and-organization-relationships.md`
- **Contrato canónico vigente:** `docs/architecture/organization-foundation-v2.md`

## Estado de esta decisión

ADR-0005 conserva la autoridad histórica y arquitectónica sobre estas decisiones:

- base PostgreSQL compartida con tenancy por fila;
- `Organization` + `Membership` + `User`;
- roles múltiples por membresía;
- licencia por organización;
- `platform_admin` separado del acceso de negocio;
- sesiones de soporte scoped y auditadas;
- `organization_id` obligatorio en las tablas de negocio;
- catálogos con ownership explícito por organización para el MVP inicial.

ADR-0006 no revierte esas decisiones. Las completa después del review del MVP
multi-organización y pasa a ser la autoridad más reciente para:

- lifecycle explícito de `User`, `Membership`, `Invitation` y `Organization`;
- onboarding B2B invitation-first;
- invariante transaccional de último administrador;
- PostgreSQL RLS obligatorio dentro del Foundation Gate;
- aprovisionamiento idempotente y atómico;
- `OrganizationRelationship` como autoridad de colaboración;
- catálogo publicado/versionado y pricing partner;
- separación `SalesQuote` / `ManufacturingOrder` / `InstallationOrder`;
- contratos OpenAPI generados, sesiones revocables y auditoría durable.

Cuando este ADR use vocabulario del MVP como `active BOOLEAN`, catálogo clonado
o `parent_organization_id`, debe leerse como descripción de la primera
implementación, no como límite del modelo objetivo.

## Decisión original

> **Granete pasa de single-workshop a multi-organización con tenancy row-level:
> una base compartida, `organization_id` en las tablas de negocio, membresías con
> roles múltiples por usuario, un `platform_admin` con acceso de soporte auditado
> por organización, y catálogos con ownership por taller.**

## 1. Tenancy row-level

Se evaluaron tres alternativas:

1. una base por taller;
2. un schema por taller;
3. filas compartidas con `organization_id`.

Se eligió **row-level tenancy en una base compartida** porque los pilotos y la
escala objetivo inicial no justifican operar N bases o N schemas, y porque este
modelo permite evolucionar a subdominios, redes comerciales y soporte central
sin cambiar la topología de datos.

La columna por sí sola nunca fue considerada autorización. El baseline se
implementó con:

1. organización activa inyectada por middleware en todo request de negocio;
2. storage Go que lee/escribe con ese scope;
3. tokens sin organización fail-closed;
4. 404 cross-org para no confirmar existencia;
5. tests de aislamiento con PostgreSQL real;
6. eliminación de DEFAULTs transicionales de `organization_id`.

### Extensión ADR-0006: RLS deja de ser posterior

En la versión original, PostgreSQL RLS quedó diferido como hardening para una
escala posterior. El review que originó #446 cambió esa prioridad: RLS debe
estar activo **antes de crear nuevas familias persistentes de negocio**.

El target vigente añade:

```sql
SET LOCAL app.organization_id = '<uuid>';
SET LOCAL app.user_id = '<uuid>';
```

por transacción, junto con `ENABLE/FORCE ROW LEVEL SECURITY`, policies por
clase de tabla y un rol de runtime sin ownership ni `BYPASSRLS`.

Go authorization, queries scoped y tests siguen siendo obligatorios. RLS es una
segunda barrera independiente contra una omisión futura en un repository.

## 2. Modelo de identidad y membresías

El modelo base permanece:

```text
Organization
    |
Membership  UNIQUE(user_id, organization_id)
    |
User
```

Principios vigentes:

- prohibido `user.companyId`, `user.isFactory` o `user.isStore`;
- un usuario puede pertenecer a varias organizaciones;
- roles viven en `memberships.roles[]`;
- permisos efectivos son la unión de capacidades de esos roles;
- licencia pertenece a la organización;
- `platform_admin` no es un rol de membresía.

Las columnas legacy `users.role`, `users.license_plan` y
`users.license_expires_at` fueron retiradas en la migración 000090.

### Extensión ADR-0006: lifecycle separado

El MVP usó booleanos `users.active` y `memberships.active`. El target vigente
separa explícitamente:

```text
User.account_status      active | disabled
Membership.status        active | suspended | left
Invitation.status        pending | delivered | opened | accepted | expired | revoked
```

Un administrador de taller administra la membresía, no elimina o aprueba una
identidad global. La aceptación de invitación crea/reactiva exactamente una
membresía y entra a esa organización. El bridge que aprobaba usuarios en
`InitialOrganizationID` debe desaparecer.

Toda organización activa conserva al menos una membresía activa con rol
`admin`; cambios concurrentes pasan por un mismo gate transaccional.

## 3. Roles múltiples y capacidades

Los ocho roles canónicos continúan definidos por `contracts/roles.json`. Una
membresía puede contener varios roles porque en talleres pequeños una persona
puede vender, diseñar y participar en producción.

La semántica de unión permanece, pero ADR-0006 añade dos restricciones:

- administrar personas requiere capabilities explícitas; no basta con ocultar
  controles en React;
- nadie puede otorgar roles fuera del subconjunto que está autorizado a
  administrar.

Roles y sectores son organization-scoped. Un sector de producción en Factory A
no viaja con el mismo usuario a Store B.

## 4. Licencia y entitlements por organización

La licencia pertenece al taller, no a la persona. Esto permanece vigente para
web, mobile y SketchUp.

ADR-0006 amplía la licencia con entitlements verificables server-side, por
ejemplo:

- máximo de miembros activos;
- máximo de partners;
- asientos SketchUp;
- acceso a manufactura;
- acceso a Red de Ventas;
- auditoría avanzada.

La UI puede mostrar consumo, pero no es el enforcement.

## 5. Catálogo con ownership por organización

El MVP eligió clonar el catálogo base al crear una organización. Esa decisión
permitió que cada fila tuviera un owner y evitó una resolución runtime
`base + overrides` incompleta.

Para talleres independientes, la copia continúa siendo un bootstrap válido.
Para una **Red de Ventas**, ADR-0006 reemplaza el clone divergente como autoridad
permanente por:

```text
Factory Catalog
  → immutable CatalogPublication
    → StoreCatalogSubscription
      → Store commercial overlays
```

Las publicaciones y precios usados por una cotización se fijan por versión.
Los overlays de tienda no pueden mutar BOM, machining o manufacturing truth.
La persistencia per-entity dentro de un catálogo sigue coordinada por #443;
la publicación cross-org pertenece a #454.

## 6. Platform admin y soporte

`users.platform_admin` permite administrar la plataforma, no leer datos de
negocio de todos los talleres.

Para entrar a una organización se usa una sesión de soporte:

- organización exacta;
- razón obligatoria;
- expiración corta;
- banner persistente;
- actor real preservado;
- validación de la sesión en cada request;
- terminación por logout, expiry o suspensión de la organización.

ADR-0006 añade MFA/step-up obligatorio para iniciar soporte, sesiones server-side
revocables y auditoría durable. Soporte no es un bypass de RLS ni de la relación
entre organizaciones.

## 7. Tokens y sesiones

El baseline definió JWT v2 con:

```text
sub, email, client, ver, org_id, roles[], platform_admin, support?
```

Los access tokens viajan por `Authorization: Bearer`, lo que conserva
compatibilidad con web, mobile, SketchUp y futuros subdominios.

### Extensión ADR-0006: transporte y lifetime por cliente

La afirmación anterior no exige guardar un bearer token de larga vida en
`localStorage` ni prohíbe una cookie protegida para una credencial de refresh.
El target vigente separa credenciales por cliente y usa sesiones revocables.

La decisión de #441/#445 permanece:

```text
absoluteSessionExpiresAt = issuedAt + 18h
```

Una rotación técnica nunca vuelve la sesión sliding o indefinida. Web, mobile,
SketchUp y soporte no intercambian sus token types.

Los JWT de sesión dejan de aceptarse en query string para media; se usan URLs
firmadas o tokens resource-scoped de corta duración.

## 8. Organización y Red de Ventas

El MVP añadió `parent_organization_id` para que una fábrica creara tiendas o
distribuidores conectados. Fue suficiente para probar:

- creación de una organización hija;
- bootstrap del creador como admin;
- clonación de catálogo;
- cambio de organización e invitación del equipo.

ADR-0006 establece que ese parent link no es el modelo contractual final.
La autoridad pasa a `OrganizationRelationship`, con:

- source/target;
- tipo de relación;
- status;
- capabilities;
- términos y vigencia;
- políticas de catálogo/precio/territorio;
- version y auditoría.

Un vendedor de tienda actúa mediante su membresía en la tienda y la relación
activa. No necesita pertenecer también a la fábrica.

## 9. Ownership comercial, manufacturero e instalación

ADR-0005/#327 introdujeron `sales_organization_id` y
`manufacturing_organization_id`, redacción de payload manufacturero y 404 en
subrecursos internos. Esas defensas siguen siendo valiosas durante la migración.

El target de ADR-0006 evita depender para siempre de una blacklist de campos en
un mega-agregado:

```text
SalesQuote / QuoteRevision       sales organization
ManufacturingOrder              manufacturing organization
InstallationOrder assignment    assigned service organization
```

Los objetos pueden referenciar el mismo `Project`, `FurnitureInstance` y
`DesignRevision` definidos por #384, pero cada contexto conserva su autoridad.
El submit tienda→fábrica es un command idempotente; el generic Project PUT no
reasigna fabricante ni simula un handoff.

## 10. Auditoría de seguridad

La tabla append-only introducida en el MVP permanece. ADR-0006 cambia la
garantía de escritura:

- telemetría no crítica puede ser best-effort;
- mutaciones críticas de identity/membership/organization/relationship/session,
  catálogo/precio y órdenes deben confirmar audit/outbox en la misma
  transacción.

El read model es tipado, paginado y humano. No se serializan passwords, JWTs,
refresh secrets, raw invitation tokens o payloads completos de clientes.

## 11. Estrategia de migración original y extensión

El programa original creó organizations/memberships/invitations/audit, hizo
backfill de la instalación single-workshop, agregó `organization_id`, migró
settings/media y retiró las columnas legacy de User. Ese trabajo permanece como
baseline y no se reabre.

Organization Foundation v2 añade una secuencia posterior:

1. contrato canónico/OpenAPI e inventario;
2. tenant transaction runner + RLS + eliminación del fallback runtime;
3. membership/invitation lifecycle invitation-first;
4. last admin, offboarding, seats y session revocation;
5. organization lifecycle/provisioning;
6. Team/Platform React tenant-safe;
7. Foundation Gate A;
8. relationships, publications y partner pricing;
9. ManufacturingOrder e InstallationOrder assignment;
10. Network Gate B.

Compatibilidad tiene una issue y criterio de eliminación. No se conserva un
fallback silencioso “por si acaso”.

## 12. Consecuencias

### Positivas

- se conserva una sola base operable para pilotos y crecimiento inicial;
- memberships y licencias siguen modelando correctamente a talleres pequeños;
- el platform admin da soporte sin obtener acceso global de negocio;
- RLS reduce el blast radius de un bug de repository;
- el onboarding y offboarding dejan de depender de identidades globales;
- la Red de Ventas puede crecer a múltiples fábricas, tiendas e instaladores;
- catálogo, precios y órdenes quedan versionados y explicables;
- nuevas tablas empiezan con el tenant contract correcto.

### Costos y riesgos

- RLS y transacciones explícitas requieren revisar queries, roles e índices;
- los endpoints de aprobación/team legacy deben migrarse y retirarse;
- catálogos clonados requieren reconciliación, no overwrite automático;
- separar ownership cross-org exige adapters temporales alrededor de Project;
- Gate A retrasa deliberadamente nuevas tablas del Digital Thread.

Se aceptan estos costos porque corregirlos después de crear FurnitureInstance,
DesignRevision, publicaciones y órdenes sería más costoso y riesgoso.

## 13. Verificación vigente

La decisión se considera operable sólo con los gates ejecutables de #462:

- PostgreSQL real, migrations fresh + upgrade fixture;
- API y SQL directo bajo app role/RLS;
- invitaciones, memberships, last-admin y provisioning bajo concurrencia/fallos;
- switch tenant en browser;
- seller de tienda sin membership en fábrica;
- pinning de catálogo/precio/revisión;
- visibilidad store/factory/installer;
- outbox retry sin duplicados;
- guard contra rutas y fallbacks legacy.

Un gate sin DB, RLS o browser requerido falla; nunca se omite en verde.
