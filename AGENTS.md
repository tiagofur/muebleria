# AGENTS.md — Mapa de navegación

> Punto de entrada para cualquier agente. Es un mapa, no un manual. Lee sólo lo
> necesario y respeta las fuentes canónicas actuales.

---

## 0. Proyecto en una mirada

**Granete** es una plataforma operativa vertical para carpinterías y fabricantes de
muebles pequeños/medianos. Conecta venta, diseño/ingeniería, BOM, materiales,
producción, logística, instalación, postventa y rentabilidad real por obra.

También soporta organizaciones múltiples: fábricas, tiendas, distribuidores y,
como target de #446, partners de instalación/servicio conectados mediante
relationships explícitas.

### Prioridad P0 vigente — Organization Foundation v2

Antes de ampliar nuevas familias persistentes de negocio, Granete debe cerrar
Usuarios, Multi-Taller, RLS, Organization lifecycle y Team mediante **Gate A** de
#462. Red de Ventas queda operable únicamente después de **Gate B**.

- Meta y orden: #446.
- Contrato: `docs/architecture/organization-foundation-v2.md`.
- Decisión: `docs/adr/0006-membership-lifecycle-and-organization-relationships.md`.

Discovery/documentación de otros programas puede continuar. No crear schema/API de una
nueva familia persistente antes de Gate A, incluyendo DT-1 #385.

### Posicionamiento de Proyectar

> **Granete no es “Promob barato”.** Proyectar debe ser una experiencia 3D de nivel
> profesional para nuestro nicho modular y diferenciarse por facilidad + continuidad
> diseño→producción→operación, no por copiar toda la amplitud de un CAD histórico.

Antes de tocar Proyectar, lee `docs/proyectar-3d-north-star.md`.

### Regla física cerrada

> **Corte, CNC y Enchape trabajan piezas. Armado es el punto de convergencia y desde
> su salida se siguen muebles/unidades/bultos.**

No profundices features de producción sin leer `docs/production-flow-v2.md`.

---

## 1. Fuentes canónicas

| Concern | Autoridad |
|---|---|
| Producto actual | `docs/prd-v2.md` |
| Organization Foundation v2 | `docs/architecture/organization-foundation-v2.md` + `docs/adr/0006-membership-lifecycle-and-organization-relationships.md` |
| Baseline multi-organización | `docs/adr/0005-multi-organization-tenancy.md` |
| Red de Ventas / distribución | `docs/multi-organization-distribution-model.md` |
| Posicionamiento competitivo Proyectar | `docs/proyectar-3d-competitive-position.md` |
| UX/North Star Proyectar 3D | `docs/proyectar-3d-north-star.md` |
| Performance budget Proyectar | `docs/proyectar-3d-performance.md` |
| Benchmark de usabilidad Proyectar | `docs/proyectar-3d-usability-benchmark.md` |
| Roadmap Proyectar 3D | `docs/proyectar-3d-roadmap-vnext.md` |
| Baseline MVP histórico | `docs/history/prd.md` |
| Plan de consolidación | `docs/operational-core-v1.md` |
| Producción pieza→mueble | `docs/production-flow-v2.md` |
| Lifecycle/eventos | `docs/project-lifecycle.md` |
| Arquitectura/boundaries | `docs/architecture.md` |
| Digital Thread Project Furniture/Design | `docs/architecture/project-design-digital-thread.md` + ADR-0003 |
| Biblioteca Paramétrica Universal | `docs/architecture/parametric-furniture-library.md` |
| ADR Biblioteca Paramétrica | `docs/adr/0002-parametric-furniture-library-architecture.md` |
| Motor de muebles inteligentes | `docs/architecture/smart-furniture-engine.md` |
| Espesor efectivo/material role | `docs/architecture/material-aware-furniture-resolution.md` |
| Modelo nativo SketchUp | `docs/architecture/sketchup-native-entity-model.md` + ADR-0004 |
| Modelo de dominio semántico | `docs/architecture/domain-model.md` |
| Biblioteca de assets 3D | `docs/architecture/3d-asset-library.md` |
| Features de manufactura semánticas | `docs/architecture/manufacturing-feature-model.md` |
| Machine profiles & adapters | `docs/architecture/machine-profiles-and-adapters.md` |
| Modelo de Interacción SketchUp | `docs/architecture/sketchup-interaction-model.md` |
| Selector Visual de Catálogo | `docs/architecture/catalog-option-selector.md` |
| UX visual | `docs/design.md` |
| UX operacional | `docs/operational-ux.md` |
| Roadmap comercial | `docs/roadmap-comercial-v2.md` |
| Reconciliación docs↔código | `docs/documentation-sync-2026-08-21.md` |
| Convenciones | `docs/conventions.md` |
| Verificación | `docs/verification.md` |
| Pilot readiness multi-org | `docs/pilot-readiness.md` + #462 |
| Rutas | `apps/web/src/routes.ts` → `NAV_PATHS` |
| Permisos | `packages/domain/src/rbac.ts` + contracts + enforcement backend |
| Implementación actual | código + tests |
| Ledger/historia | `feature_list.json` |
| Backlog operativo | GitHub issues |

### Regla de conflicto

Si un documento histórico contradice una fuente v2 y el código moderno:

1. verifica la fuente ejecutable;
2. distingue **implemented today** de **target**;
3. no reviertas código moderno sólo para coincidir con texto viejo;
4. registra/corrige la discrepancia.

Para Organization Foundation:

- ADR-0005 conserva la decisión de tenancy row-level, memberships, licencias y
  support sessions;
- ADR-0006 es la autoridad más reciente para lifecycle, RLS, provisioning,
  relationships, publicación, orders y sesiones endurecidas;
- #446 define el orden y #462 los gates ejecutables.

Para Proyectar, el North Star define intención futura y código/tests lo implementado.

---

## 2. Antes de empezar

```bash
./init.sh
```

Luego:

1. lee `progress/current.md`;
2. identifica la feature activa;
3. lee docs canónicos del área;
4. revisa la GitHub issue y sus hard prerequisites;
5. confirma que la base/branch de la issue no pisa un programa P0;
6. no tomes automáticamente el `pending` de menor id si contradice prioridad vigente.

### Si la issue toca Users, Memberships, Organizations, Auth o Sales Network

Lee obligatoriamente:

1. `docs/architecture/organization-foundation-v2.md`;
2. ADR-0006;
3. #446 y la child issue exacta;
4. ADR-0005 para baseline histórico;
5. #462 para los proofs que debe conservar.

No empieces una child issue antes de su hard prerequisite salvo discovery puro.

### Si crea una tabla persistente

Antes de migration:

- clasifica `tenant-owned | explicitly shared | platform-global | ledger`;
- registra RLS policy e índices desde la primera migration;
- añade fresh + upgrade fixture;
- añade direct-SQL test bajo runtime app role;
- usa generated API contract y durable audit cuando corresponda.

---

## 3. Mapa del repositorio

```text
apps/
  web/          shell React/Vite
  desktop/      Electron
  mobile/       React Native/Expo
packages/
  domain/       lógica pura, BOM, optimizer, workflows puros
  ui/           React compartido
  excel/        XLSX/PDF/DXF/labels
  storage/      repositories/mappers/generated API client
backend-go/     API + application services + Postgres + auth + enforcement
docs/           contratos de producto/arquitectura/UX
progress/       sesión/evidencia histórica
feature_list.json  ledger de implementación
```

### Bounded contexts conceptuales

```text
Identity
Organization Access
Organizations
Sales Network
Sales
Projects
Design / Authoring
Survey
Engineering
Procurement
Inventory
Production
Logistics
Installation
Costing
After Sales
```

Lee `docs/architecture.md` antes de inventar ownership nuevo.

---

## 4. Reglas duras

- **Una feature activa a la vez** salvo coordinación explícita del programa.
- **No `done` sin evidencia.** Ver `docs/verification.md`.
- **No inventar métricas.** `actual | estimated | forecast | proxy | missing`.
- **No usar `createdAt` como sustituto silencioso de un evento real.**
- **No mezclar account, membership, organization, commercial, project, design,
  order y execution state.**
- **No producción física contra revisión stale** sin override auditado.
- **UI no calcula dominio.**
- **Server authority** para seguridad, sessions, concurrencia, tenant scope, stock,
  lifecycle, provisioning, relationships, orders y workflow persistente.
- **Si una regla vive en TS y Go**, usar contract fixture de paridad.
- **API Organization Foundation generada:** no crear DTO manual paralelo ni decidir
  por substring de mensaje.
- **Tenant ID no autoriza:** middleware + capability + ownership/relationship +
  repository + RLS + tests.
- **Runtime DB role sin `BYPASSRLS`** y sin ownership de tablas protegidas.
- **Tenant context con `SET LOCAL` dentro de transaction**; nunca contaminar pool.
- **No InitialOrganization fallback runtime.**
- **Invitation-first:** admin de taller administra memberships, no global users.
- **Último admin transaccional:** ninguna UI check aislada cuenta como solución.
- **Organization provisioning completo:** nunca 201 active con step fallido.
- **Cross-org por OrganizationRelationship:** no memberships artificiales en la
  contraparte.
- **SalesQuote, ManufacturingOrder e Installation assignment con ownership
  explícito:** generic Project PUT no es handoff.
- **Audit crítico durable:** business mutation + audit/outbox en la misma transaction.
- **Idempotency/If-Match** en commands sensibles.
- **React server state tenant-keyed:** no mostrar datos A tras switch a B.
- **No fallback silencioso** de API nueva a legacy.
- **Session absoluta 18h:** refresh técnico no la extiende.
- **Material antes que geometría:** resolver `MaterialBoard` y espesor efectivo
  antes de formulas/poses/AABB.
- **SketchUp host nativo:** managed furniture/parts son
  `Sketchup::ComponentInstance`; business IDs nunca derivan de GUID,
  `persistent_id`, nombre o geometría.
- **Código/identificadores en inglés; copy UI en español.**
- **pnpm only** para monorepo JS.
- **No `.env` en git.**
- **No SQL destructivo** sin confirmación y backup.
- **Migraciones/arranque sin datos de negocio:** seed demo siempre explícito.
- **No `git stash` como depósito.** Commit/push en rama.
- **No mezclar trabajo no relacionado en commits.**
- **Antes de cerrar: push y readback.**

---

## 5. Reglas UI/UX

Antes de tocar UI:

1. lee `docs/design.md`;
2. si es screen operativa, lee `docs/operational-ux.md`;
3. si toca Proyectar, lee el North Star;
4. si toca Team/Platform/Network, lee Organization Foundation v2;
5. identifica la unidad correcta: identity, membership, organization,
   relationship, quote, order, pieza, mueble, bulto o visita;
6. usa tokens, no hex/spacing/patterns inventados;
7. una primary action por contexto;
8. blockers explican cómo resolverse;
9. acciones sensibles dejan feedback persistente/auditable.

### Team y organizaciones

- mostrar account status y membership status por separado;
- suspended permanece visible/reactivable;
- roles muestran permissions preview;
- last-admin abre transfer flow, no toast genérico;
- invitation muestra estado/expiry/resend/revoke honestos;
- provisioning/sync/conflict/error no se presentan como empty;
- success sólo tras commit autoritativo;
- switch organization invalida todo server state del tenant previo.

### Red de Ventas

- relationship/capabilities/terms son visibles;
- catálogo muestra publication/version/diff;
- precio distingue FactoryCost, wholesale y retail;
- seller elige sólo factories autorizadas;
- Store ve commercial status, no floor/BOM/cost internals;
- installation reutiliza #303 y respeta assigned organization;
- KPI aplica Data Truth Contract.

### Proyectar 3D

El modelo mental canónico es:

```text
Biblioteca persistente → Canvas 3D → Inspector contextual
```

Reglas:

- buscar/insertar materiales y muebles sin saltos innecesarios;
- lenguaje de usuario sobre nombres internos;
- selección principal por mueble y drill-down cuando corresponde;
- drag/placement con preview/snap/feedback y alternativa precisa por mm;
- interacción relevante undoable;
- no clonar skin/layout de Promob;
- sí reutilizar patrones universales útiles;
- no exponer world coordinates/quaternions como flujo normal;
- no sacrificar performance por chrome/rerenders;
- design→BOM/precio/release permanece conectado.

Quality targets: North Star. Roadmap: `docs/proyectar-3d-roadmap-vnext.md`.
Meta: #308.

### Producción

- Cut/CNC/Edge → pieza/lote.
- Assembly/QC → mueble/unidad.
- Packaging/Shipping → unidad/bulto.
- Installation → visita + unidad + ambiente.

---

## 6. Roadmap y feature governance

### Fuentes

- prioridad/narrativa: `docs/roadmap-comercial-v2.md`;
- detalle operativo: `docs/operational-core-v1.md`;
- Organization Foundation P0: #446;
- Gates ejecutables: #462;
- Proyectar: `docs/proyectar-3d-roadmap-vnext.md`;
- Digital Thread: #384;
- trabajo futuro: GitHub issues;
- ledger: `feature_list.json`.

### Prioridad actual

1. #447 documentación/ADR;
2. #448 generated API contract;
3. #449 RLS + #450 lifecycle + foundation #461;
4. #451 team safety;
5. #452 organization provisioning;
6. #458 Web Organization;
7. critical #460/#461;
8. #462 Gate A;
9. #453–#459 Sales Network;
10. #462 Gate B.

#443 puede avanzar después de #448 coordinado con #449 porque es catalog-local.
Digital Thread discovery puede continuar; schema/API #385 espera Gate A.

### Después de Foundation Gate A

Operational Core y Digital Thread pueden continuar sobre una base tenant probada.
Proyectar puede avanzar por slices de alto impacto cuando no rompe los cimientos.
No saltar prerequisites para “avanzar más rápido”: eso crea una segunda migración.

---

## 7. Documentos históricos

No borrar por estar viejos; conservar reasoning, pero no usarlos como autoridad cuando
fueron superseded.

Ejemplos:

- `docs/history/prd.md`;
- `docs/history/production-module.md`;
- `docs/history/app-excellence.md`;
- specs históricas de Proyectar que contradigan North Star;
- `docs/history/*`;
- `progress/archive/*`.

ADR-0005 no es histórico descartado: sigue siendo baseline y está extendida por
ADR-0006. Lee ambas.

---

## 8. Verificación mínima

Según feature:

```bash
pnpm test
pnpm typecheck
# + go test si backend
# + smoke/golden específico
```

Para exports físicos: golden/fixture.  
Para workflow: transición permitida + rechazada + auth + audit.  
Para dashboards: semántica de verdad de datos.  
Para UI: comportamiento y a11y, no sólo source grep.  
Para Proyectar: WebGL/drag real y profiling cuando toca hot path.

### Organization Foundation

Toda child issue prueba, según aplique:

- happy path;
- denial/least privilege;
- cross-org API + direct SQL;
- stale version;
- retry/idempotency;
- transaction race;
- failure injection/rollback;
- audit/outbox;
- fresh migration + upgrade fixture;
- browser tenant switch/error UX.

Gate A y Gate B de #462 son obligatorios. En gate mode:

- PostgreSQL/RLS/router/browser/outbox requeridos;
- no `t.Skip` por dependencia ausente;
- falta de infraestructura hace fallar, nunca verde falso;
- artifacts diagnósticos no contienen secrets/PII.

---

## 9. Roles de agente

| Rol | Archivo |
|---|---|
| Orquestador | `.agents/skills/leader/SKILL.md` |
| Implementador | `.agents/skills/implementer/SKILL.md` |
| Revisor | `.agents/skills/reviewer/SKILL.md` |
| UI craft | `.agents/skills/impeccable/SKILL.md` |

Si no se indica rol, actúa como implementador.

---

## 10. Cómo evoluciona este mapa

Si detectas contradicción:

1. corrige la fuente de verdad apropiada;
2. actualiza este mapa sólo si cambia qué debe leer un agente;
3. registra la discrepancia en la documentación canónica;
4. distingue implemented today de target;
5. no conviertas AGENTS.md en el PRD: debe seguir navegable.
