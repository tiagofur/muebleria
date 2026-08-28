# Implement F105 — Page Chrome Rollout II: Ventas y Trabajo

**Fecha:** 2026-08-19 · **Feature:** `page_chrome_rollout_sales_work`

## Qué se hizo

Migración al esqueleto único (`PageHeader`/`PageToolbar`, §4.1a) de las
pantallas de Ventas y Trabajo:

| Pantalla | Archivo | Chip | Particularidades |
|---|---|---|---|
| Inicio | `dashboard/Dashboard.tsx` | LayoutDashboard | primaria condicional (ghost cuando el checklist la posee); quick actions «Ver vitrina»/«Nuevo mueble» como secundarias `.btn` base |
| Dashboard de Ventas | `sales/SalesDashboard.tsx` | TrendingUp | pipeline total en `contextualControls`; badge de vendedor en el subtítulo; `VendedorFilter` a `PageToolbar.filters` |
| Clientes | `customers/CustomersScreen.tsx` | Users | toolbar search + chips (mismo patrón que catálogos) |
| Vitrina | `showcase/ShowcaseScreen.tsx` | Store | **reestructura**: el header lo posee la pantalla; los tabs (Portafolio/Catálogo) pasan a `PageToolbar.tabs`; `ModuleShowcase` queda como contenido del tab con su toolbar de búsqueda/chips y sin título propio; `ProjectsPortfolioView` retira su h2/subtítulo y conserva el toggle Showroom como fila contextual |
| Estado de Planta | `production/PlantBoardScreen.tsx` | KanbanSquare | read-only sin primaria; icono alineado al mapa §6.7b (antes Factory local) |

Correcciones de contrato:
- Título «Vitrina de muebles» → «Vitrina» (§4.1b: título = label de nav).
- Gramática de acciones en Inicio verificada en vivo: una sola primaria
  sólida; quick action secundaria (el «doble primaria» del critique era una
  lectura errónea del análisis visual — el código ya cumplía §6.1).

CSS retirado (huérfano verificado):
- `dashboard.css`: `.dashboard__title-icon` (chip compartido lo reemplaza).
- `production.css`: `.plant-board__title-icon`.
- `moduleShowcase.css`: header/header-text/lead/search (queda `__filters`).
- `projectsPortfolio.css`: portfolio-title/-icon (toggle queda en fila contextual).
- `pageHeader.css`: alias podados de sales-dashboard__*, plant-board__*,
  module-showcase__* y portfolio-title/subtitle (sin uso TSX). Se conservan
  los que aún consume ProductionManagerDashboard/F106 (dashboard__*) y
  settings/users (catalog-page__*).

## Tests

- Nuevos: `sales/pageChromeSalesWork.test.tsx` (5) — header compartido por
  pantalla, primaria única de Inicio, demotion a ghost en workspace vacío,
  toolbar de Vitrina con tabs + búsqueda del tab, PlantBoard sin primaria.
- Actualizados: `ModuleShowcase.test.tsx` (sin título en tab; búsqueda
  presente), assertions previas del título de Vitrina.

## Verificación

- UI **1013/1013** (112 archivos) · `pnpm typecheck` verde · `./init.sh`
  verde completo · detector Impeccable 0 hallazgos.
- Smoke (IAB, invitado): `/`, `/customers`, `/plant-board`, `/showcase` con
  header+toolbar correctos y **sin overflow** a 1280 y 390 (estilos
  computados). Screenshots de Inicio/Clientes/Planta analizados visualmente
  (chip, una primaria, layout limpio); captura de Vitrina post-reestructura
  bloqueada por el runtime IAB (evidencia computada en su lugar, mismo
  precedente F101/F102).

## Fuera de scope

- Tabs locales → WorkspaceTabs/WorkflowTabs (F109: tab-btn de Vitrina,
  presentation, spatial studio).
- ProductionManagerDashboard/Settings/Users/Fabric/etc. (F106).
- Overlays de Vitrina (lightbox/presentation → F110).
- WIP ajeno `processStage.{ts,test.ts}` no tocado.
