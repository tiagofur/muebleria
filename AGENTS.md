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

### SketchUp como producto integrado

> **Granete for SketchUp no es un plugin aislado ni un motor industrial paralelo.**
> SketchUp posee autoría e interacción; Granete posee identidad, catálogo,
> manufacturing truth, revisiones, release y outputs; React posee administración,
> visibilidad y workflows empresariales explícitos.

Antes de tocar una integración SketchUp↔Go↔React lee
`docs/architecture/sketchup-backend-web-integration-excellence.md` y #465.

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
| SketchUp Excellence | `docs/architecture/sketchup-plugin-excellence.md` + `docs/sketchup-excellence-execution-plan.md` |
| SketchUp ↔ Backend ↔ React | `docs/architecture/sketchup-backend-web-integration-excellence.md` |
| Interacciones de autoría SketchUp | `docs/architecture/sketchup-authoring-interaction-contract.md` |
| Contrato SketchUp/manufactura | `docs/sketchup-manufacturing-contract.md` + ADR-0001 |
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

Para SketchUp/integración:

- #465 y `sketchup-backend-web-integration-excellence.md` definen el programa actual;
- #384 conserva ownership de FurnitureInstance/DesignRevision/Release;
- #496 define la API generada; no crear DTOs paralelos;
- #498 define el runtime host compartido; no crear coordinadores por feature;
- #396 es el tracker React con #500–#502 y #499;
- #290 conserva contexto/historia, no un dependency graph competidor.

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
4. revisa la GitHub issue, comentarios y hard prerequisites;
5. confirma que la base/branch de la issue no pisa un programa P0;
6. no tomes automáticamente el `pending` de menor ID si contradice prioridad vigente;
7. no marques otra feature `in_progress` mientras F199/#458 siga activa salvo coordinación explícita.

### Si la issue toca Users, Memberships, Organizations, Auth o Sales Network

Lee obligatoriamente:

1. `docs/architecture/organization-foundation-v2.md`;
2. ADR-0006;
3. #446 y la child issue exacta;
4. ADR-0005 para baseline histórico;
5. #462 para los proofs que debe conservar.

No empieces una child issue antes de su hard prerequisite salvo discovery puro.

### Si toca SketchUp, catálogo de muebles, Design o integración React

Lee obligatoriamente:

1. `docs/architecture/sketchup-backend-web-integration-excellence.md`;
2. #465 y la issue exacta;
3. #496 para API/schema generada;
4. #498 para host interaction/mutation si toca el plugin;
5. #384 + ADR-0003 si toca Project/FurnitureInstance/Design/revisiones/release;
6. #396/#499–#503 si toca la superficie React correspondiente;
7. `apps/sketchup-extension/AGENTS.md` si modifica la extensión.

Antes de Gate A sólo se permite persistencia existente o trabajo que no cree una
nueva familia de negocio. No inventes `SketchUpProject`, IDs locales productivos ni
un shadow Design store.

### Si crea una tabla persistente

Antes de migration:

- confirma que Gate A permite iniciar esa familia;
- clasifica `tenant-owned | explicitly shared | platform-global | ledger`;
- registra RLS policy e índices desde la primera migration;
- añade fresh + upgrade fixture;
- añade direct-SQL test bajo runtime app role;
- usa generated API contract, idempotency/concurrency y durable audit.

---

## 3. Mapa del repositorio

```text
apps/
  web/                 shell React/Vite
  sketchup-extension/  extensión Ruby + HtmlDialog + TestUp
  desktop/             Electron
  mobile/              React Native/Expo
packages/
  domain/              lógica pura, BOM, optimizer, workflows puros
  ui/                  React compartido
  excel/               XLSX/PDF/DXF/labels
  storage/             repositories/mappers/generated API client
backend-go/            API + application services + Postgres + auth + enforcement
contracts/             OpenAPI, JSON Schemas y fixtures compartidos
docs/                  contratos de producto/arquitectura/UX
progress/              sesión/evidencia histórica
feature_list.json      ledger de implementación
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
- **UI no calcula dominio.** React no recrea resolve, reconciliation, preflight ni machine compatibility.
- **Server authority** para seguridad, sessions, concurrencia, tenant scope, stock,
  lifecycle, provisioning, relationships, orders y workflow persistente.
- **Si una regla vive en TS y Go**, usar contract fixture de paridad.
- **API generada:** Organization Foundation y furniture/authoring/Design consumen
  OpenAPI/JSON Schema generado (#448/#496); no DTO manual paralelo ni comportamiento
  por substring de mensaje.
- **Web y SketchUp comparten contratos, no credenciales.**
- **Pairing #499:** grant one-time/short-lived/exact-scope; nunca web JWT en custom URI/query.
- **Host runtime #498:** #466–#471 reutilizan un coordinador de mutation/rollback/undo;
  no transport/store/error/degraded model por feature.
- **Resolve antes de mutar:** no borrar geometría válida ni escribir metadata antes
  de resultado autoritativo compatible.
- **Late response no aplica** sobre una selección/comando más nuevo.
- **Identity exacta:** FurnitureInstance, component occurrence, hardware placement,
  DesignRevision y Release nunca derivan de nombre/GUID/geometry/array index.
- **Revision exacta:** approval/release/artifacts nunca usan `latest` implícito.
- **Browser no parsea `.skp`** como fuente semántica de DesignRevision.
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
- **Idempotency/If-Match/baseRevision** en commands sensibles.
- **React server state session/tenant-keyed:** no mostrar datos A tras switch a B;
  una nueva sesión genera una raíz de caché distinta sin incluir secretos.
- **No fallback silencioso** de API nueva a legacy.
- **Session absoluta 18h:** refresh técnico no la extiende.
- **Material antes que geometría:** resolver `MaterialBoard` y espesor efectivo
  antes de formulas/poses/AABB.
- **SketchUp host nativo:** managed furniture/parts son
  `Sketchup::ComponentInstance`; business IDs nunca derivan de GUID,
  `persistent_id`, nombre o geometría.
- **Machine evidence exacta:** marca/modelo no implica compatibilidad; profile,
  adapter, software version, readback y evidence pack deben coincidir.
- **Diagnóstico #504 privacy-first:** sin token, cookies, pairing code, paths privados,
  datos de cliente, geometría, BOM ni machining por default; no upload automático.
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
4. si toca SketchUp/Digital Thread, lee el contrato de integración cross-surface;
5. si toca Team/Platform/Network, lee Organization Foundation v2;
6. identifica la unidad correcta: identity, membership, organization,
   relationship, quote, physical furniture, design revision, pieza, mueble,
   bulto o visita;
7. usa tokens, no hex/spacing/patterns inventados;
8. una primary action por contexto;
9. blockers explican cómo resolverse;
10. acciones sensibles dejan feedback persistente/auditable.

### Team y organizaciones

- mostrar account status y membership status por separado;
- suspended permanece visible/reactivable;
- roles muestran permissions preview;
- last-admin abre transfer flow, no toast genérico;
- invitation muestra estado/expiry/resend/revoke honestos;
- provisioning/sync/conflict/error no se presentan como empty;
- success sólo tras commit autoritativo;
- switch organization invalida todo server state del tenant/session previo.

### SketchUp y Digital Thread Web

- SketchUp: selección semántica, viewport, precise input, snap, overlay y undo;
- React: catálogo, physical units, revisiones, reconciliation, approval/release,
  machine/evidence/artifacts;
- Go/domain: identidad, resolve, preflight, revisions, reconciliation y output;
- loading, stale, offline, incompatible, blocked y success son estados distintos;
- Project Furniture qty > 1 muestra unidades físicas distintas;
- vistas históricas permanecen pinneadas a la revisión seleccionada;
- `Abrir en SketchUp` usa #499 y distingue initiated de confirmed;
- React no intenta navegación de viewport: ofrece handoff exacto al plugin;
- SketchUp no administra MachineProfiles/postprocessors;
- published DesignRevision/accepted QuoteRevision no se editan in-place.

### Red de Ventas

- relationship/capabilities/terms son visibles;
- catálogo muestra publication/version/diff;
- precio distingue FactoryCost, wholesale y retail;
- seller elige sólo factories autorizadas;
- Store ve commercial status, no floor/BOM/cost/CNC internals;
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
- SketchUp Excellence/integración: #465;
- Proyectar: `docs/proyectar-3d-roadmap-vnext.md`;
- Digital Thread: #384 y Web tracker #396;
- trabajo futuro: GitHub issues;
- ledger: `feature_list.json`.

### Prioridad actual verificada

1. **F199/#458** — tracker #493 y slices como #494;
2. completar Web Organization/session-scope y cerrar #458;
3. critical portions de #460/#461;
4. ejecutar **Gate A #462**;
5. después de Gate A, #453–#459/Gate B y #385+ Digital Thread avanzan por sus
   dependency graphs, sin absorber ownership entre programas.

Cuando la política de una sola feature activa permita iniciar otro runtime slice:

```text
#496 generated furniture API
+ #498 shared SketchUp host runtime
→ #466/#467/#468 professional authoring loop
→ #497 React typed parameter/binding editor
```

Después de Gate A:

```text
#385 → #386/#387
→ #500 Project Furniture Web
→ #388/#499/#389
→ #390/#391/#392
→ #501 revisions/artifacts Web
→ #393/#394/#395
→ #502 reconciliation/release Web
→ #397/#398
```

Machine/commercial path:

```text
#348 → #351 → #352/#353 → #503 → #354 → #355
```

Discovery/documentación puede continuar sin marcar una segunda feature activa. No saltes
prerequisites para “avanzar más rápido”: eso crea contratos, migrations y UX paralelos.

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

#290 conserva contexto e historia del programa SketchUp, pero #465/#384/#446/#354/#355
definen la ejecución actual.

---

## 8. Verificación mínima

Según feature:

```bash
pnpm openapi:check
pnpm test
pnpm typecheck
# + go test ./... si backend/domain
# + scripts/pilot-gate.sh cuando aplique
# + smoke/golden específico
# + TestUp real cuando dependa del host
# + browser E2E con Go/PostgreSQL real cuando aplique
# + machine/software import-readback para claims físicos
```

Para exports físicos: golden/fixture + evidencia exacta cuando sea claim real.  
Para workflow: transición permitida + rechazada + auth + audit.  
Para dashboards: semántica de verdad de datos.  
Para UI: comportamiento y a11y, no sólo source grep.  
Para Proyectar: WebGL/drag real y profiling cuando toca hot path.  
Para SketchUp: HtmlDialog/viewport, rollback/undo/save-reopen y TestUp real.  
Para integración: generated contract + backend + React/Ruby consumidor, no mocks aislados.

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

### SketchUp / Digital Thread / machine output

Cada issue declara las capas aplicables:

```text
[ ] domain
[ ] Go API/storage/RLS
[ ] generated OpenAPI/JSON Schema
[ ] React UI/server state
[ ] Ruby adapter/host
[ ] HtmlDialog/interaction
[ ] shared parity/golden
[ ] real-host TestUp
[ ] browser + real PostgreSQL E2E
[ ] real machine/software readback
[ ] docs/ledger/readback
```

Una capa requerida no puede quedar `skipped` y contarse como green. Un helper de dominio no
prueba una interacción real de SketchUp y un componente React con mocks no prueba integración.

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