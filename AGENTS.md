# AGENTS.md — Mapa de navegación

> Punto de entrada para cualquier agente. Es un mapa, no un manual. Lee sólo lo
> necesario y respeta las fuentes canónicas actuales.

---

## 0. Proyecto en una mirada

**Granete** es una plataforma operativa vertical para carpinterías y fabricantes de
muebles pequeños/medianos. Conecta venta, diseño/ingeniería, BOM, materiales,
producción, logística, instalación, postventa y, como objetivo del Operational Core,
la rentabilidad real por obra.

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
| Biblioteca Paramétrica Universal | `docs/architecture/parametric-furniture-library.md` |
| ADR Biblioteca Paramétrica | `docs/adr/0002-parametric-furniture-library-architecture.md` |
| Motor de muebles inteligentes (umbrella) | `docs/architecture/smart-furniture-engine.md` |
| Espesor efectivo y propagación por material role | `docs/architecture/material-aware-furniture-resolution.md` |
| Modelo nativo de entidades SketchUp | `docs/architecture/sketchup-native-entity-model.md` + `docs/adr/0004-sketchup-native-component-entity-model.md` |
| Modelo de dominio semántico | `docs/architecture/domain-model.md` |
| Biblioteca de assets 3D | `docs/architecture/3d-asset-library.md` |
| Features de manufactura semánticas | `docs/architecture/manufacturing-feature-model.md` |
| Machine profiles & adapters | `docs/architecture/machine-profiles-and-adapters.md` |
| Modelo de Interacción SketchUp | `docs/architecture/sketchup-interaction-model.md` |
| Selector Visual de Opciones de Catálogo | `docs/architecture/catalog-option-selector.md` |
| UX visual | `docs/design.md` |
| UX operacional | `docs/operational-ux.md` |
| Roadmap comercial | `docs/roadmap-comercial-v2.md` |
| Reconciliación docs↔código | `docs/documentation-sync-2026-08-21.md` |
| Convenciones | `docs/conventions.md` |
| Verificación | `docs/verification.md` |
| Rutas | `apps/web/src/routes.ts` → `NAV_PATHS` |
| Permisos | `packages/domain/src/rbac.ts` + enforcement backend |
| Implementación actual | código + tests |
| Ledger/historia | `feature_list.json` |
| Backlog operativo | GitHub issues |

### Regla de conflicto

Si un documento histórico contradice una fuente v2 y el código moderno:

1. verifica la fuente ejecutable;
2. distingue **implemented today** de **target**;
3. no reviertas código moderno sólo para coincidir con un texto viejo;
4. registra/corrige la discrepancia.

Para Proyectar, si una spec vieja contradice el North Star, el North Star define la
intención futura y el código/tests siguen definiendo lo implementado hoy.

---

## 2. Antes de empezar

```bash
./init.sh
```

Luego:

1. lee `progress/current.md`;
2. identifica la feature activa;
3. lee docs canónicos del área;
4. revisa GitHub issue si existe;
5. no tomes automáticamente el `pending` de menor id si contradice la prioridad
   vigente del roadmap/Operational Core o existe una sesión activa.

> **Deuda conocida:** `init.sh` tiene un fallo de guardrail documentado en
> `docs/verification.md` / OC-001. Hasta corregirlo, revisa también la salida real de
> install/tests y no asumas que exit 0 prueba todo.

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
  storage/      repositories/mappers
backend-go/     API + Postgres + auth + enforcement servidor
docs/           contratos de producto/arquitectura/UX
progress/       sesión/evidencia histórica
feature_list.json  ledger de implementación
```

### Bounded contexts conceptuales

```text
Sales
Projects
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

- **Una feature activa a la vez** salvo coordinación explícita.
- **No `done` sin evidencia.** Ver `docs/verification.md`.
- **No inventar métricas.** `actual | estimated | forecast | proxy | missing`.
- **No usar `createdAt` como sustituto silencioso de un evento real.**
- **No mezclar estados comerciales, stage y execution física.**
- **No producción física contra revisión stale** sin override auditado.
- **UI no calcula dominio.**
- **Server authority para seguridad/concurrencia/stock/workflow persistente** cuando
  aplique; TS para dominio interactivo/puro según `docs/architecture.md`.
- **Si una regla vive en TS y Go**, planear contract fixture de paridad.
- **Material antes que geometría:** para tableros, resolver `MaterialBoard` y `T`
  antes de fórmulas/poses; ver
  `docs/architecture/material-aware-furniture-resolution.md`.
- **SketchUp host nativo:** muebles gestionados y piezas físicas gestionadas se
  materializan como `Sketchup::ComponentInstance`; Granete IDs nunca se derivan de
  GUID/`persistent_id`/nombre de SketchUp. Ruby aplica geometría local + transform
  resueltos; no infiere orientación por role/AABB ni usa scale para dimensiones
  productivas. Ver `docs/architecture/sketchup-native-entity-model.md`.
- **Código/identificadores en inglés; copy UI en español**.
- **pnpm only** para monorepo JS.
- **No `.env` en git.**
- **No SQL destructivo** sin confirmación explícita y backup apropiado.
- **No `git stash` como depósito.** Commit/push en rama.
- **No mezclar trabajo no relacionado en commits.**
- **Antes de cerrar: push.**

---

## 5. Reglas UI/UX

Antes de tocar UI:

1. lee `docs/design.md`;
2. si es screen operativa, lee también `docs/operational-ux.md`;
3. si toca Proyectar/3D/editor, lee **obligatoriamente** `docs/proyectar-3d-north-star.md`;
4. identifica la unidad de trabajo correcta: proyecto, pieza, mueble, bulto o visita;
5. usa tokens; no hex/spacing/patterns inventados;
6. una primary action por contexto;
7. blockers deben explicar cómo resolverse;
8. acciones físicas deben dejar feedback persistente/auditable.

### Proyectar 3D

El modelo mental canónico es:

```text
Biblioteca persistente → Canvas 3D → Inspector contextual
```

Reglas:

- buscar/insertar materiales y muebles sin saltos innecesarios fuera del editor;
- lenguaje de usuario/taller sobre nombres internos de geometría/domain;
- selección principal por mueble; drill-down a agregado/pieza/herraje cuando la intención lo pide;
- drag/placement con preview/snap/feedback y alternativa precisa por mm;
- toda interacción relevante undoable;
- no clonar skin/layout de Promob;
- sí reutilizar patrones de interacción universales que hagan el job más fácil;
- no exponer world coordinates/quaternions como flujo normal;
- no sacrificar performance del canvas por chrome o rerenders evitables;
- design→BOM/precio/release debe permanecer conectado.

Quality targets y benchmark: `docs/proyectar-3d-north-star.md`.
Roadmap implementable: `docs/proyectar-3d-roadmap-vnext.md`.
Meta GitHub: #308.

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
- Proyectar: `docs/proyectar-3d-roadmap-vnext.md`;
- trabajo futuro: GitHub issues;
- ledger de implementación: `feature_list.json`.

### Después de F128

La prioridad por defecto sigue protegiendo Operational Core:

1. guardrails/data truth;
2. lifecycle/release;
3. producción pieza→mueble;
4. MRP/QC;
5. instalación/closeout;
6. job costing;
7. UX transversal/pilotos.

Pero Proyectar puede avanzar por slices de alto impacto en paralelo cuando no rompe esos
cimientos. Meta #308 y roadmap vNext definen el orden específico del editor.

F129–F131 no desplazan automáticamente este orden salvo decisión explícita o necesidad
de taller piloto.

---

## 7. Documentos históricos

No borrar por “estar viejos”; conservar reasoning, pero no usarlos como autoridad actual
cuando fueron superseded.

Ejemplos:

- `docs/history/prd.md` — baseline MVP;
- `docs/history/production-module.md` — baseline del workspace producción previo al nesting/CNC moderno;
- `docs/history/app-excellence.md`;
- specs/planes históricos de Proyectar que contradigan el North Star actual;
- `docs/history/*`;
- `progress/archive/*`.

Consulta `docs/documentation-sync-2026-08-21.md` para divergencias conocidas.

---

## 8. Verificación mínima

Según feature:

```bash
pnpm test
pnpm typecheck
# + go test si backend
# + smoke/golden específico
```

CI remoto debe convertirse en autoridad adicional mediante OC-002.

Para exports físicos: golden/fixture.  
Para workflow: transición permitida + rechazada + auth + audit.  
Para dashboards: probar semántica de verdad de datos.  
Para UI: comportamiento y a11y, no sólo source grep.  
Para Proyectar: smoke real WebGL/drag cuando toca interacción 3D; profiling cuando toca hot path.

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
3. agrega la discrepancia a la auditoría/documentación canónica si afecta futuras
   sesiones;
4. no conviertas AGENTS.md en el PRD: debe seguir siendo corto y navegable.
