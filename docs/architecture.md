# Arquitectura — Contrato de calidad

> Los agentes revisores evalúan código contra este archivo.
> Si un criterio no está aquí, no es un requisito de arquitectura.
>
> **Actualizado 2026-08-28:** este contrato conserva la arquitectura original de
> paquetes, el Digital Thread Quote ↔ Project Furniture ↔ Design Revision ↔
> Production Release y añade Organization Foundation v2: identidad, membresías,
> RLS, relationships y ownership cross-org explícito.

---

## 1. Principios

1. **Dominio primero.** Los cálculos (BOM, costos, validaciones, routing, estados
   derivados) viven en `packages/domain` o en el backend autoritativo cuando el
   dato requiere seguridad, persistencia o concurrencia.
2. **UI no calcula dominio.** React presenta, compone y dispara commands.
3. **Adapters serializan; no inventan reglas.** Excel/DXF/PDF/QR convierten DTOs ya
   resueltos.
4. **Storage es un puerto.** Shells y UI consumen repositories/adapters, no detalles
   físicos de persistencia.
5. **Apps son shells delgados.** Web/Desktop/Mobile cablean plataforma y navegación.
6. **Una autoridad por concepto.** Evitar duplicar máquinas de estado, identidades o
   políticas sin contrato de paridad.
7. **Eventos para hechos.** Hitos operativos se registran de forma auditable; los
   dashboards derivan, no fabrican verdad.
8. **Revisión explícita.** Producción siempre debe responder qué revisión/BOM está
   ejecutando.
9. **Authoring no es manufacturing truth.** Proyectar y SketchUp capturan intención;
   Granete resuelve, valida y libera el resultado industrial.
10. **Project owns physical furniture identity.** `FurnitureInstance` es la identidad
    estable de una unidad física a través de cotización, diseño y manufactura.
    `QuoteLine`, `DesignRevisionItem`, entidades SketchUp y filas productivas la
    referencian; no la sustituyen.
11. **Historial comercial y diseño son inmutables al publicarse/aceptarse.** Los
    cambios crean nuevas revisiones; reconciliation detecta diferencias y nunca
    sincroniza silenciosamente.
12. **Release exacto.** `ProductionRelease` fija una `DesignRevision` y fingerprint/
    revisión de manufactura exactos; nunca consume `latest` implícitamente.
13. **Material antes que geometría.** En piezas de tablero, el `MaterialBoard`
    seleccionado determina el espesor efectivo antes de fórmulas, poses, anchors y
    AABB; el acabado se propaga por material-binding role.
14. **Identidad global; acceso por membresía.** `User` no es fábrica, tienda ni
    puesto. Roles, sectores y lifecycle de acceso pertenecen a `Membership`.
15. **`organization_id` no es autorización.** Middleware, application services,
    repositories scoped, PostgreSQL RLS y tests forman una defensa por capas.
16. **La colaboración cross-org usa relationships.** Un vendedor de tienda no recibe
    una membresía artificial en la fábrica; la autorización proviene de una
    `OrganizationRelationship` activa y capability-scoped.
17. **Ownership por contexto.** Venta, manufactura e instalación no comparten un
    mega-agregado mutable: `SalesQuote`, `ManufacturingOrder` e
    `InstallationOrder`/assignment tienen autoridad explícita.
18. **Commit de negocio y evidencia crítica juntos.** Mutaciones sensibles y su
    audit/outbox se confirman en la misma transacción.
19. **Contratos ejecutables entre capas.** OpenAPI generado, typed errors,
    version/ETag e idempotency reemplazan casts manuales y reglas por texto.
20. **Éxito honesto.** UI no anuncia éxito antes del commit autoritativo salvo una
    mutación optimista completa con rollback e idempotencia.

Fuentes normativas:

- principios 10–12:
  `docs/architecture/project-design-digital-thread.md` + ADR-0003;
- principio 13:
  `docs/architecture/material-aware-furniture-resolution.md`;
- principios 14–20:
  `docs/architecture/organization-foundation-v2.md` + ADR-0006.

---

## 2. Estructura de paquetes

```text
packages/
  domain/     → tipos, motor de resolución, cálculos, validaciones puras
  ui/         → componentes React compartidos
  excel/      → Excel/PDF/DXF/labels y otros outputs
  storage/    → puertos/repositorios/mappers/clientes generados
apps/
  web/        → shell React + Vite
  desktop/    → shell Electron
  mobile/     → shell React Native + Expo
backend-go/   → API, application services, auth, Postgres, enforcement autoritativo
```

Los nombres de paquete no tienen que coincidir 1:1 con los bounded contexts. El
ownership conceptual sí debe ser explícito.

El backend no debe convertirse en handlers que llaman directamente queries sin
frontera de negocio. Para commands sensibles se usa:

```text
HTTP Handler
  → Application Service / Command
    → Domain Policy
      → Transaction / Repository
        → Audit/Outbox
```

---

## 3. Bounded contexts del producto

### Identity

Propietario de:

- identidad global `User`;
- credenciales, recovery, verificación de email;
- account status;
- sessions/devices;
- MFA/step-up;
- `platform_admin`.

No es propietario de roles, sectores, cartera o tipo de organización.

### Organization Access

Propietario de:

- `Membership`;
- roles múltiples y capabilities efectivas;
- membership lifecycle `active | suspended | left`;
- sectores organization-scoped;
- `Invitation` y acceptance;
- last-admin invariant;
- seats y offboarding;
- revocación de sessions por membership.

Un administrador de taller administra membresías, no identidades globales.

### Organizations

Propietario de:

- `Organization` y tipo;
- lifecycle `provisioning | active | suspended | offboarding | terminated |
  provisioning_failed`;
- licencia y entitlements;
- provisioning/readiness;
- settings y namespaces de media;
- suspensión, reactivación, export y terminación.

Una organización no pasa a `active` hasta completar admin bootstrap, settings,
entitlements, catálogo strategy, policies y readiness.

### Sales Network

Propietario de:

- `OrganizationRelationship`;
- relationship status, capabilities, terms, territory y vigencia;
- `CatalogPublication`, subscription y store overlays;
- wholesale/retail price policies;
- handoff cross-org;
- projections comerciales compartidas;
- ownership/asignación de instalación.

Una relationship concede sólo actions nombradas. No abre el tenant contrario.

### Sales

Propietario de:

- customer/prospect;
- opportunity/quote;
- `QuoteRevision` y snapshot comercial;
- commercial status;
- retail pricing/discount approval;
- ownership comercial.

No es propietario de identidad física ni execution física. `QuoteLine.quantity` es
agrupación comercial y puede mapear a múltiples `FurnitureInstance`.

En Red de Ventas, Sales fija `CatalogPublication` y price-policy versions usadas;
no consume FactoryCost.

### Projects

Propietario transversal de:

- Project/Job;
- identidad estable `FurnitureInstance`;
- `Design` y lifecycle de diseños del proyecto;
- lifecycle events;
- coordinación de versions/revisions;
- approvals;
- change orders;
- archivos/timeline;
- stage derivado.

No crear una identidad paralela tipo `ProjectFurniture`: reutilizar
`FurnitureInstance`.

Projects no convierte `Project` en el owner de permisos globales de ventas,
manufactura e instalación. Los contextos cross-org lo referencian con autoridad
acotada.

### Design / Authoring

Responsabilidad conceptual compartida por clientes de autoría, con persistencia de
revisiones coordinada por Projects:

- working copy en el cliente;
- `DesignRevision` publicada e inmutable;
- `DesignRevisionItem` como snapshot semántico por `FurnitureInstance`;
- transform/room/parameter/material intent;
- preview + artifact metadata;
- semantic manifest.

`Design` es agnóstico al cliente. No crear `SketchUpProject` como aggregate
empresarial.

### Survey

Propietario de:

- levantamientos;
- espacios/medidas de campo;
- evidencias/fotos;
- verificación de medidas.

### Engineering

Propietario de:

- estructuras/componentes/agregados;
- resolved BOM;
- production revision/release;
- manufacturing fingerprint;
- machining/perforaciones;
- authoritative manufacturing preflight;
- documentación técnica;
- cut-plan inputs.

### Procurement

Propietario de:

- suppliers;
- material requirements;
- purchase orders;
- receipts;
- need-by dates.

### Inventory

Propietario de:

- stock ledger;
- on-hand;
- reservations;
- available/incoming;
- allocations/movements.

### Production

Propietario de:

- work queues;
- piece execution antes de Armado;
- module/unit execution desde Armado;
- station events;
- QC/rework;
- work centers/actividad/tiempos cuando aplique.

### Logistics

Propietario de:

- packages;
- staging;
- loads;
- shipments.

### Installation

Propietario de:

- installation jobs/visits;
- crews;
- field issues;
- punch list;
- sign-off/closeout.

El workflow operativo de #303 permanece único. Sales Network define qué
organización está asignada y qué data grant purpose-scoped recibe; no crea otro
ledger de visitas/punch.

### Costing

Propietario de:

- cost baseline;
- actual material/labor/other costs;
- variance;
- job profitability.

FactoryCost no se expone a una tienda para calcular retail.

### After Sales

Propietario de:

- warranty tickets;
- service visits;
- warranty refabrication linkage.

---

## 4. Flujos de datos principales

### 4.1 Taller/fábrica integrada

```text
Sales / QuoteRevision
      ↓ references
Project + FurnitureInstance identities
      ↓ represented by
Design + immutable DesignRevision
      ↓ reconciliation / approval
Resolved BOM + Manufacturing Fingerprint
      ↓
Production Release pinned to exact DesignRevision
      ↓
 ┌───────────────┬─────────────────┐
 ↓               ↓                 ↓
Requirements     Production Docs   Cost Baseline
 ↓               ↓
Reservations     Part Execution
 ↓               ↓
PO/Receipts      Unit Execution
 ↓               ↓
Materials Ready  Logistics
                 ↓
              Installation
                 ↓
               Closeout
                 ↓
               Warranty
```

Quote-first y design-first convergen al mismo `Project`/`FurnitureInstance`, no a
dos modelos de identidad distintos.

### 4.2 Red de Ventas

```text
Store SalesQuote / immutable QuoteRevision
      ↓ pinned relationship + catalog + price + furniture refs
SubmitQuoteToFactory (idempotent command)
      ↓
Factory-owned ManufacturingOrder
      ↓ factory review / clarification / accept / schedule
Exact DesignRevision + ProductionRelease
      ↓
Manufacturing execution
      ↓ commercial status projection to Store
InstallationOrder assigned to Factory / Store / Partner
      ↓ references existing InstallationJob
Visits → Issues → Punch → Sign-off
```

Reglas:

- seller de tienda no necesita membership en fábrica;
- generic Project PUT no realiza el handoff;
- recibir/aceptar ManufacturingOrder no crea `ProductionRelease` automáticamente;
- catálogo/precio/diseño no usan `latest` implícito;
- Store recibe projection comercial, no BOM/costos/CNC internos.

---

## 5. Regla física de producción

Fuente detallada: `docs/production-flow-v2.md`.

### Antes de Armado

Corte, CNC y Enchape trabajan **piezas físicas**.

### Desde Armado

Armado, QC, Empaque, Carga e Instalación trabajan **muebles/unidades/bultos**.

No profundizar CNC/enchape usando únicamente `ProjectItem.floorStatus` como verdad
física. No hacer que el nuevo `ManufacturingOrder` duplique part/unit execution:
debe vincular el workflow productivo existente.

---

## 6. Reglas de boundary

| Paquete | Puede importar | No puede importar |
|---|---|---|
| `domain` | stdlib TS y módulos internos domain | react, electron, fs, xlsx |
| `ui` | domain, react | electron, fs, xlsx; fórmulas de negocio |
| `excel` | libs de serialización + DTOs/domain types | react, electron; lógica de workflow |
| `storage` | IO permitido + domain types/generated client | decisiones UI o dominio |
| `apps/*` | paquetes anteriores | lógica de dominio nueva inline |
| backend handlers | application services + DTO mapping | queries/decisiones dispersas ad hoc |
| application services | policies + repositories + transaction runner | presentation concerns |

### Authoring clients externos

Para Granete for SketchUp rige:

> **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**

La extensión puede capturar interaction state, transforms, parameters, stable IDs y
semantic metadata. Debe conservar `furnitureInstanceId`. No puede usar
`persistent_id`, posición, definition name o geometry hash como business identity.

La extensión no implementa BOM, drilling rules, nesting, kerf, stale/release gates ni
postprocessing. Granete valida el
[`SketchUp Manufacturing Contract`](sketchup-manufacturing-contract.md) y conserva
la autoridad descrita en ADR-0001.

El binding Project/Design, versionado de `.skp`, semantic manifest, duplicate
identity handling y reconciliation se rigen por Project Design Digital Thread y
ADR-0003.

Un machine adapter serializa DTOs resueltos y capabilities declaradas; no inventa
reglas de ingeniería.

---

## 7. Autoridad TypeScript vs Go

### Server authoritative

Preferentemente Go/backend para:

- auth, sessions, permissions y capabilities efectivas;
- organization/membership/relationship lifecycle;
- last-admin, seats, offboarding y provisioning;
- tenant transaction context y RLS integration;
- creation/duplication cross-client de `FurnitureInstance`;
- revision numbering/concurrency;
- publish/finalize de revisiones, catálogo y price books;
- idempotency, ETag/If-Match y command state machines;
- quote→ManufacturingOrder/Installation assignment;
- stock/reservations/PO/receipts;
- auditoría/outbox;
- execution física multiusuario;
- job costing persistente;
- gates imposibles de saltar desde otro cliente.

### TypeScript domain authoritative/interactivo

Preferentemente TypeScript para:

- editor y resolución interactiva;
- geometría/layout;
- BOM preview;
- optimización/cut plan;
- machining calculations puras;
- reconciliation/fingerprint pure logic sin seguridad/concurrencia;
- preparación de DTOs/export;
- validaciones puras reutilizables;
- presentation derivations que conservan Data Truth Contract.

### Lógica duplicada

Cuando una regla deba existir en ambos lados:

> usar contract fixtures compartidos y fallar CI si TS y Go divergen.

No declarar paridad sólo por inspección manual. OpenAPI generado cubre el shape de
transporte; fixtures cubren semántica de dominio duplicada.

---

## 8. Multi-organización, RLS y transacciones

Fuentes: ADR-0005, ADR-0006 y
`docs/architecture/organization-foundation-v2.md`.

### 8.1 Contexto de actor

El backend construye el actor desde credenciales revalidadas:

```text
userId
sessionId
membershipId
organizationId
roles[]
capabilities[]
supportSessionId?
platformAdmin
```

IDs enviados en el body se validan contra ese contexto; nunca crean autoridad.

### 8.2 Capas de aislamiento

Toda ruta de negocio usa:

1. auth/session válida;
2. membership/organization live;
3. capability/RBAC;
4. resource ownership/relationship policy;
5. repository scoped;
6. PostgreSQL RLS;
7. pruebas API y SQL directo.

Cross-org responde 404 cuando la existencia es sensible.

### 8.3 Clasificación de tablas

Cada tabla es:

```text
tenant-owned
explicitly shared
platform-global
append-only ledger/audit
```

Toda migration nueva registra clase, policy e índices. CI falla si una tabla tenant
no tiene policy inventory.

### 8.4 Tenant transaction runner

Los commands establecen contexto con `SET LOCAL` dentro de la transacción. El rol
runtime:

- no posee tablas protegidas;
- no tiene `BYPASSRLS`;
- no desactiva RLS;
- es diferente del rol de migración.

El contexto no puede sobrevivir a rollback/commit ni contaminar otra request del
pool.

### 8.5 Recursos compartidos

Un recurso sales/manufacturing/installation shared nombra las organizaciones y/o
relationship exactas. No se habilita mediante un bypass global. Support usa un
contexto scoped de una sola organización y conserva el actor real.

### 8.6 InitialOrganizationID

No se usa como fallback runtime. Sólo puede existir en migrations/fixtures/tooling
explícito. Un path de negocio sin scope falla loud.

---

## 9. API, errores, concurrencia e idempotencia

### OpenAPI

Los DTOs de Identity, Organization Access, Organizations, Platform y Sales Network
se generan desde OpenAPI. React no usa `res.json() as Type` como prueba de contrato.

### Error envelope

```json
{
  "code": "LAST_ADMIN",
  "message": "La organización debe conservar al menos un administrador activo.",
  "fieldErrors": {},
  "requestId": "req_...",
  "retryable": false,
  "details": {}
}
```

La UI decide por `code`, no por substring del mensaje localizado.

### Optimistic concurrency

Recursos mutables exponen version/ETag. Writes usan `If-Match` o el equivalente
canónico. Stale write devuelve 409/412 estructurado; nunca sobrescribe.

### Idempotency

Creates/commands críticos usan `Idempotency-Key`. Misma key y mismo command devuelve
el mismo resultado. Misma key con payload diferente falla `IDEMPOTENCY_CONFLICT`.

### Commands

Acciones sensibles usan endpoints/servicios explícitos:

```text
ChangeMembershipRoles
SuspendMembership
TransferOrganizationAdmin
ProvisionOrganization
SuspendOrganization
ProposeRelationship
PublishCatalog
PublishPriceBook
SubmitQuoteToFactory
AcceptManufacturingOrder
AssignInstallationOrganization
```

No esconder transitions en un `PUT` genérico del aggregate completo.

---

## 10. Eventos, audit y estados

### Hechos de dominio

Persistir eventos append-only para acciones relevantes. Digital Thread debe poder
auditar, cuando se implemente:

- `furniture_instance_created` / `duplicated` / `removed`;
- `design_created`;
- `design_revision_published` / `approved`;
- `production_release_created`.

Organization Foundation añade, entre otros:

- invitation lifecycle;
- membership role/status/admin transfer/offboarding;
- organization provisioning/lifecycle/license;
- relationship/policy lifecycle;
- catalog/price publication;
- quote submission/order decision;
- installation assignment;
- session/MFA/support lifecycle.

### Audit durable

Para mutaciones críticas:

```text
BEGIN
business mutation
audit/outbox record
COMMIT
```

Best-effort se reserva a telemetría no crítica. Audit no reemplaza
`project_events`, floor events ni `stock_movements`.

### Estados derivados

`ProjectStage`, KPIs y summaries derivan de fuentes reales cuando sea posible.
No guardar otro mutable status si una comparación de revisiones/eventos lo resuelve.

### No mezclar

Mantener dimensiones separadas:

- account status;
- membership status;
- organization/relationship status;
- commercial status;
- quote/order state;
- Project stage;
- design/reconciliation state;
- ProductionRelease;
- part execution;
- module/unit execution;
- quality/installation sub-workflows.

No crear un enum “super status”.

---

## 11. Data Truth Contract

Todo dato agregado es:

```text
actual
estimated
forecast
proxy
```

La capa que calcula conserva esa semántica o devuelve `null` cuando no puede afirmar
un valor real.

Prohibido:

- multiplicar módulos por una constante y presentarlo como piezas reales;
- usar `createdAt` como fecha de anticipo/almacén sin etiquetarlo;
- convertir un endpoint fallido en KPI cero;
- presentar provisioning/sync fallido como lista vacía;
- inventar SLA/capacidad/comisión para llenar un dashboard.

---

## 12. Exports

Los adapters de salida serializan una revisión coherente.

Todo output físico relevante identifica, directa o indirectamente:

- project/job;
- `designRevisionId` cuando proviene de diseño aprobado;
- manufacturing/production revision;
- BOM fingerprint;
- pieza/unidad cuando corresponda;
- organization/ManufacturingOrder cuando el origen es cross-org.

Un pack no mezcla documentos de revisiones distintas. Una tienda no recibe un pack
manufacturero por poseer la cotización comercial.

---

## 13. Seguridad

### DTOs públicos y visibilidad

Nunca serializar entidades internas por comodidad. Cada actor recibe una projection
allowlisted. Hiding fields en React no es autorización.

Store no recibe FactoryCost, suppliers, stock, BOM/CNC internos, job costing ni notas
de producción. Assigned installer recibe sólo customer/site/design data necesaria
para su job.

### Sesiones y tokens

- absolute session lifetime permanece 18h según #441/#445;
- refresh/rotation técnica no lo vuelve sliding;
- web/mobile/SketchUp/support usan token types distintos;
- sessions son revocables por membership/organization;
- soporte exige razón, scope, actor real y MFA/step-up;
- validar algoritmo exacto, issuer, audience, version y session id;
- media no acepta un JWT de sesión genérico por query: usa URL/token
  resource-scoped o fetch autenticado.

### RBAC/capabilities

Aplicar least privilege. React usa capabilities para UX, Go decide. Managers sólo
administran el subconjunto permitido; nadie se autoeleva por payload.

### Last administrator

Toda organización active conserva un admin membership active. Role change,
suspension, leave y lifecycle comparten un gate transaccional race-safe.

### Trusted proxy/rate limiting

Sólo proxies configurados aportan forwarding headers. Sensitive endpoints tienen
rate limit y abuse metrics por claves apropiadas; no confiar sólo en IP in-memory
para despliegues multi-instance.

### Supply chain

CI incorpora según el programa:

- dependency review/OSV;
- `govulncheck`;
- static security analysis;
- CodeQL;
- container scan;
- secret scanning;
- SBOM/provenance cuando aplique.

---

## 14. Arquitectura cliente-servidor y estado React

El sistema multiusuario actual usa:

1. generated API client / repositories;
2. backend Go;
3. PostgreSQL relacional + RLS;
4. sesiones scoped;
5. object/file storage para media/artefactos;
6. outbox/workers donde una operación externa lo requiera.

### React server state

Remote state se keyea por tenant:

```text
['organization', organizationId, 'memberships', filters]
['organization', organizationId, 'relationships', filters]
['organization', organizationId, 'orders', filters]
```

TanStack Query o equivalente gestiona server state. Zustand queda para session,
local UI y editor drafts; no es la autoridad de listas remotas.

Switch de organización:

- considera drafts sin guardar;
- cambia scope de sesión;
- elimina/aisla caches, stores y media URLs del tenant previo;
- recalcula roles/capabilities/routes;
- sigue una política explícita entre tabs;
- nunca mezcla silenciosamente datos A y B.

### Estados honestos

UI distingue loading, stale, partial failure, empty, no-results, permission denied,
provisioning, suspended, conflict y offline. Falla de `/org/team` no llama un
fallback legacy. Success sólo después del resultado canónico.

### Artefactos 3D

`.skp`, previews y binarios viven en file/object storage con metadata relacional.
El archivo no es la única verdad de dominio.

---

## 15. Errores de dominio y operacionales

Funciones puras lanzan `DomainError`/subtipos o resultados estructurados cuando el
flujo necesita varios issues. UI muestra mensaje localizado, nunca stack traces.

Errores persistentes (QC, shortage, field issue, stale revision, conflict de
membership/relationship/order) no viven sólo como toast: se convierten en trabajo,
blocker o typed result.

Una working copy cuyo `baseRevisionId` ya no coincide falla cerrado con conflicto
explícito; nunca overwrite silencioso. Lo mismo aplica a membership, organization,
relationship, publication y price policy stale.

---

## 16. Fuentes ejecutables y canónicas

- rutas: `apps/web/src/routes.ts` (`NAV_PATHS`);
- RBAC/capabilities: `packages/domain/src/rbac.ts`, contracts y enforcement Go;
- lógica pura: `packages/domain`;
- almacenamiento/server: `backend-go`;
- API Organization Foundation: OpenAPI generado por #448 cuando se implemente;
- UX: `docs/design.md` + `docs/operational-ux.md`;
- producto: `docs/prd-v2.md`;
- plan: `docs/operational-core-v1.md`;
- Organization Foundation:
  `docs/architecture/organization-foundation-v2.md` + ADR-0006;
- tenancy baseline: ADR-0005;
- distribución: `docs/multi-organization-distribution-model.md`;
- gates: #462 + `docs/pilot-readiness.md` cuando se amplíe;
- programa SketchUp: `docs/sketchup-granete-strategy.md`;
- boundary SketchUp/Granete: ADR-0001;
- selector visual de opciones: `docs/architecture/catalog-option-selector.md`;
- material-aware resolution:
  `docs/architecture/material-aware-furniture-resolution.md`;
- furniture semantics: `docs/architecture/domain-model.md`;
- Digital Thread: `docs/architecture/project-design-digital-thread.md` + ADR-0003.

---

## 17. Qué NO hacer

- no calcular costos/requirements/workflow en React;
- no hardcodear materiales en módulos cuando deben ser roles/opciones;
- no mezclar herrajes en outputs de corte;
- no escribir workspace parcialmente;
- no añadir dependencias a `domain` sin necesidad;
- no crear un status global para tapar ownership incorrecto;
- no inventar KPIs;
- no ejecutar producción contra revisión stale sin override;
- no duplicar reglas TS/Go sin fixtures;
- no mover BOM/drilling/preflight/postprocessing a Ruby/SketchUp;
- no usar `QuoteLine`, `DesignRevisionItem`, SketchUp IDs o geometría como identidad física;
- no crear `ProjectFurniture` si duplica `FurnitureInstance`;
- no sobrescribir `DesignRevision` publicada ni `QuoteRevision` aceptada;
- no sincronizar Quote ↔ Design silenciosamente;
- no liberar `latest design`;
- no usar `user.companyId`, `user.isFactory` o roles globales;
- no tratar public register como solicitud al taller inicial;
- no ocultar fallas de API mediante fallback legacy;
- no dejar organización active con provisioning incompleto;
- no proteger último admin sólo en UI o con check pre-transacción;
- no usar tenant/body IDs como autorización;
- no usar rol DB runtime con `BYPASSRLS`;
- no establecer tenant context fuera de una transacción pool-safe;
- no autorizar fábrica obligando a cada seller a ser miembro de ella;
- no usar clone overwrite mutable como publicación de catálogo;
- no mezclar FactoryCost, wholesale y retail en un solo `marginFactor`;
- no resolver catálogo/precio/diseño/release aceptado desde `latest`;
- no usar generic Project PUT como submit cross-org;
- no restringir instalación para siempre al manufacturer si existe assignment autorizado;
- no mantener DTOs Go/React paralelos con casts ciegos;
- no usar best-effort audit para mutaciones críticas;
- no mostrar success antes del commit;
- no declarar readiness con un gate que omite DB, RLS, outbox o browser;
- no construir un ERP financiero completo ni CAD libre dentro de este core.
