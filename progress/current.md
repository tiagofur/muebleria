# Sesión activa

- **Cambio en curso (sin feature del backlog): taxonomía de URLs completa.**
  - Regla: URL = nombre de la pantalla en inglés, kebab-case, plano (sin
    nesting). URLs renombradas en `apps/web/src/routes.ts`:
    - Órdenes `/orders` (antes `/production`); Producción (piso)
      `/production` (antes `/factory`); dashboards planos
      `/production-dashboard` y `/sales-dashboard`.
    - Cotizaciones `/quotes` (antes `/projects`); Estado de Planta
      `/plant-board`; Almacén `/warehouse` (antes `/purchasing`);
      Acabados `/finishes` (antes `/ambient-materials`); Agregados
      `/add-ons` (antes `/agregados`).
    - Deep link de orden: `/orders/:projectId/:tab`.
  - IDs internos (`AppNavId`) alineados con las URLs (misma pasada):
    `projects→quotes`, `production→orders`, `fabric→production`,
    `embarques→shipments`, `instalaciones→installations`,
    `purchasing→warehouse`, `ambientMaterials→finishes`,
    `agregados→addOns`. Renombrados en `packages/domain/rbac.ts`,
    `packages/ui/shell/AppShell.tsx` y `apps/web` (routes + App + tests).
    OJO: ids de dominio tipo `catalog.agregados`,
    `project.production.revision`, tabs de editor ('agregados') y roles
    ('produccion') NO se tocaron — son datos/roles, no navegación.
    Funciones `roleCanAccess*Nav` conservan nombres históricos.
  - Tests: `routes.test.ts` actualizado a la nueva taxonomía.
  - Aparte: se actualizaron tests de nav (`appShell.test.ts`,
    `index.test.ts`) al reorder VENTAS→PRODUCCIÓN ya presente sin commitear
    en `AppShell.tsx`.
  - `pnpm test` y `pnpm typecheck` verdes.
- **Último cierre:** F099 — Polish final del módulo Producción (APPROVED, 2026-08-18).
- **Próximo pendiente por id:** F077 — prep_venta_pricing_landing.
