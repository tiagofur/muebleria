# ADR-0005 — Multi-Organization Tenancy (row-level) con membresías multi-rol y soporte de plataforma auditado

- **Status:** Accepted
- **Date:** 2026-08-26
- **Decision owners:** Product + Engineering
- **Tracking:** [#325](https://github.com/tiagofur/muebleria/issues/325),
  [#326](https://github.com/tiagofur/muebleria/issues/326),
  [#327](https://github.com/tiagofur/muebleria/issues/327)
- **Extiende:** `docs/multi-organization-distribution-model.md`

## Decisión

> **Granete pasa de single-workshop a multi-organización con tenancy row-level:
> una base compartida, `organization_id` en las tablas de negocio, membresías con
> roles múltiples por usuario, un `platform_admin` con acceso de soporte auditado
> por organización, y catálogos clonados por taller.**

### 1. Tenancy row-level (base compartida + `organization_id`)

Elección entre: DB por taller, schema por taller, o filas compartidas con
`organization_id`. Se decide **filas compartidas**:

- los pilotos (2–5 talleres) y el objetivo a 12 meses (15–30) no justifican la
  carga operativa de N bases o N schemas (migraciones y pools por tenant);
- es el mismo modelo interno de monday.com / ServiceTitan: el subdominio o la
  marca por tenant es una capa de presentación, el aislamiento vive en el dato;

**"tenant_id no es autorización".** La columna sola no protege nada. El
aislamiento lo garantiza:

1. scope de organización inyectado por middleware en **todo** request autenticado;
2. storage que siempre filtra/escribe con ese scope (revisión ruta por ruta);
3. tests de aislamiento cross-org obligatorios en CI (taller A jamás lee ni
   escribe datos de taller B: 404, no 403 que confirme existencia).

**Fail-closed desde el hardening #327:** los tokens sin organización (staff de
plataforma entre sesiones, usuarios a mitad de la selección) sólo alcanzan la
consola `/api/platform/*` y `/api/auth/*`; toda ruta de negocio los rechaza y
no heredan roles del `users.role` deprecado. Los DEFAULT transicionales de
`organization_id` a la org inicial se eliminaron (migración 000088): un INSERT
sin scope falla loud. El fallback a la org inicial queda reservado a tooling
directo de storage (CLI/migraciones/tests).

**RLS de Postgres queda como hardening posterior** (issue separado, antes de
superar ~10 organizaciones activas): `SET app.organization_id` por transacción +
políticas por tabla como defensa en profundidad contra bugs de la capa Go.

### 2. Modelo de identidad

```
Organization (id, slug, type, license_plan, active)
     |
Membership (org_id, user_id, roles[], active)   UNIQUE(user_id, org_id)
     |
User (id, email, ..., platform_admin)
```

- **Prohibido** `user.companyId` / `user.isFactory` / `user.isStore` (ya establecido
  por el doc de distribución). Un usuario pertenece a N organizaciones vía membresías.
- `users.role` actual queda deprecado: la fuente de verdad pasa a ser
  `memberships.roles`. La migración backfill crea una membresía por usuario existente
  con su rol actual.
- **Roles múltiples por membresía** (`roles TEXT[]`): permisos = unión de
  capacidades. Resuelve al "hace todo" de carpinterías chicas (una persona =
  vendedor + ingeniero + producción) sin desarmar la matriz RBAC: las funciones
  `roleCanX(role)` pasan a `rolesCanX(roles[])` con semántica de unión, espejadas
  TS ↔ Go vía `contracts/roles.json`. Combinaciones sensibles (p. ej. vendedor +
  rol con vista de costos) son asignación explícita del admin del taller y el
  flag `workshop_settings.vendedor_can_view_costs` sigue mandando.
- Los roles operativos siguen siendo los 8 canónicos (OC-004). El
  `OrganizationRole` conceptual del doc de distribución (owner/admin/sales_manager/
  sales/designer/production_manager/installer) **no** crea roles nuevos: se mapea
  sobre los existentes (ver tabla en el doc de distribución).

### 3. Licencia por organización

`license_plan`/`license_expires_at` se mudan de `users` a `organizations`: el
taller paga, no la persona. El gate de la extensión SketchUp verifica la licencia
de la organización del token. La migración copia la licencia de los usuarios
existentes a la organización inicial.

### 4. Catálogo base clonado por taller

Al crear una organización se **clona** el catálogo base de la plataforma
(tableros, herrajes, módulos, estructuras, componentes, categorías, acabados) en
filas propias con `organization_id`. Todas las filas de catálogo quedan con
dueño — no hay resolución "base + añadidos" en runtime. El catálogo base de la
plataforma es plantilla; una herramienta futura de "publicar cambios base"
sincronizará cuando exista necesidad real. `workshop_settings` pasa de singleton
a una fila por organización.

### 5. Super admin de plataforma y "entrar a taller"

- `users.platform_admin BOOLEAN`: acceso a la consola de plataforma
  (organizaciones, licencias, usuarios, auditoría, invitaciones). **No ve datos
  de negocio de ningún taller** desde la consola.
- **Sesión de soporte**: `POST /api/platform/organizations/{id}/support-session`
  con razón obligatoria emite un token corto (1–2 h) con contexto
  `support.org_id` + rol efectivo `admin` de ese taller. No suplanta a un usuario
  real: toda escritura registra al platform_admin como actor real. La UI muestra
  banner persistente mientras dure. Eventos `support_session_started/ended` en la
  auditoría de seguridad. Termina con logout explícito o expiración.
- Patrón estándar de la industria: token corto scoped + banner visible + audit
  completo + razón obligatoria; nunca re-usar el token normal del admin.

### 6. Tokens y expansión estilo monday.com

- JWT v2 con `{sub, email, client, ver, org_id, roles[], platform_admin,
  support?}`. El bump de `ver` invalida tokens previos (re-login documentado).
- Auth siempre por header `Authorization: Bearer` (web/mobile/extensión), nunca
  cookies por dominio. **Por qué:** habilita agregar subdominio por taller
  (`taller.granete.app`) después como pura capa de routing (DNS wildcard + TLS +
  regla en el proxy), sin migraciones ni rework de auth.
- `organizations.slug` UNIQUE URL-safe reservado desde el día 1; login acepta
  `?org=slug` como pre-selección. Branding por org y SSO por org: post-piloto.

### 7. Auditoría de seguridad (nueva)

Tabla append-only `security_audit_events` con eventos mínimos: login
success/fail, invitación creada/aceptada/revocada, cambio de roles/membresía,
organización creada/suspendida, sesión de soporte start/end, cambios de licencia.
Requisito de #326 ("invitations and memberships are auditable") y condición para
exponer múltiples talleres en producción.

## Estrategia de migración

Principios: aditivo, backfill conservador, sin SQL destructivo, rollback
documentado (`docs/verification.md` §11).

1. **Crear** `organizations`, `memberships`, `invitations`,
   `security_audit_events` (sin tocar flujos existentes).
2. **Backfill org inicial**: crear la organización #1 ("Taller inicial") y
   asignarle TODAS las filas existentes de negocio (`organization_id` nullable →
   backfill → `NOT NULL`). No inventa hechos: la deployment actual ES un solo
   taller; la membresía de cada usuario preserva su rol vigente.
3. `workshop_settings` singleton → fila por organización (migración de `id=1`).
4. Media particionada: `MEDIA_DIR/<org_id>/` (script de migración de archivos).
5. **Desactivar** lecturas de `users.role` en favor de memberships (columna se
   retira en migración posterior, no en la misma). ✅ Cumplido: sin lectores
   ni escritores desde F176/F177, las columnas `users.role` /
   `users.license_plan` / `users.license_expires_at` se eliminaron en la
   migración 000090; los roles viajan en `memberships.roles` (claims `roles[]`
   del token + `roles` hermano en las respuestas de auth) y la licencia es de
   la organización.

Los tokens vigentes se invalidan una única vez con el bump de versión del JWT.

## Consecuencias

- **Positivo:** pilotos aislados en un solo VPS; el dueño (platform_admin) da
  soporte real con trazabilidad; crecimiento a red fábrica↔tienda (#327) y a
  subdominios sin rediseño; multi-rol sin romper RBAC.
- **Negativo/riesgos:** revisión exhaustiva de queries (toda ruta debe scoping);
  tokens vigentes requieren re-login; RLS pospuesto exige disciplina de tests de
  aislamiento hasta llegar; clonar catálogo duplica filas (aceptable a esta
  escala).
