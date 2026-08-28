# Implement F106 — Page Chrome Rollout III: Producción, Almacén y Config

**Fecha:** 2026-08-19 · **Feature:** `page_chrome_rollout_production_config`

## Qué se hizo

Migración al esqueleto único (`PageHeader`, §4.1a) de las 7 pantallas restantes:

| Pantalla | Archivo | Chip | Notas |
|---|---|---|---|
| Dashboard de Producción | `production/ProductionManagerDashboard.tsx` | BarChart3 | Actualizar/Ver Métricas como secundarias `.btn`; sin primaria |
| Producción (estaciones) | `production/FabricScreen.tsx` | Factory | toggle Cola/Métricas + total en `contextualControls` |
| Embarques | `production/EmbarquesScreen.tsx` | Truck | stat «bultos por cargar» en `contextualControls` |
| Instalaciones | `production/InstalacionesScreen.tsx` | Hammer | stats para instalar/instalados en `contextualControls` |
| Almacén | `purchasing/PurchasingScreen.tsx` | Warehouse | badge proyectos activos en `contextualControls` |
| Ajustes | `settings/SettingsScreen.tsx` | Settings | sin acciones; icono inline del título retirado |
| Usuarios | `users/UsersScreen.tsx` | ShieldCheck | badge pendientes al subtítulo; recargar con **aria-label** nuevo; icon-only «Asignar sectores» y el botón deshabilitado de rol ganan `aria-label` (§4.8) |

CSS retirado (uso TSX verificado en cero):
- `pageHeader.css`: alias de `fabric__*`, `ship-board__*`, `pm-dashboard__*`,
  `purch-landing__*`, `eng-landing__*`, `dashboard__*`, `catalog-page__header/
  __title/__toolbar/__subtitle`, `portfolio-header` y `module-showcase__lead`.
  Quedan vivos sólo `.prod-queue__*` (hub de Órdenes, excepción §4.1a) y
  `.catalog-page__filters` (Users).
- `settings.css` `.settings-title-icon`; `productionManagerDashboard.css`
  title-row/title-icon/header-actions (+ media queries); `production.css`
  `.fabric__title-icon`, `.fabric__header-actions` (+mobile), `.ship-board__title-icon`,
  `.ship-board__header-actions` (+mobile header).

## Tests

- Nuevos: `production/pageChromeProductionConfig.test.tsx` (7) — header
  compartido por pantalla, sin primarias espurias, contextualControls presentes
  (stats/total/badge), aria-label de «Recargar usuarios».
- Regresiones: suites de production/purchasing/settings/users verdes.

## Verificación

- UI **1020/1020** (113 archivos) · `pnpm typecheck` verde · `./init.sh` verde ·
  detector Impeccable 0 hallazgos.
- Smoke (IAB, invitado): `/settings` con header y sin overflow a 1280 y 390.
  Rutas de producción/usuarios redirigen o vacían para guest (RBAC) — cubiertas
  por los tests unitarios; `/users` como guest renderiza main vacío (deuda
  conocida de deep-links sin permiso, §6.7, pre-existente y fuera de scope).

## Fuera de scope

- Hub de Órdenes (chrome propio §4.1a).
- Tabs locales (F109), overlays (F110), badges/stats/touch (F111).
- Redirect de deep-links sin permiso (deuda RBAC separada).
- WIP ajeno `processStage.{ts,test.ts}` no tocado.
