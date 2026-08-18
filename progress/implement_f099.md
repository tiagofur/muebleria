# F099 — Polish final del módulo Producción

## Alcance

Cierre UI/UX posterior a F095–F098. Sin cambios de dominio, persistencia ni backend.

## Auditoría y decisiones

- Se leyó el critique previo `2026-08-18T14-35-54Z__packages-ui-src-production.md` (22/40): F095–F098 ya resolvieron sus P1 de board por obra, claims, dashboard honesto, surtido e instalaciones.
- El hallazgo restante de drift sistémico estaba en `ProductionManagerDashboard`: implementaba colores, gradientes, sombras, radios, botones y transición de layout propios, fuera del design system. Causa raíz: implementación one-off previa en vez de reutilizar tokens y `.btn` compartido.
- Se alineó el dashboard al patrón de Producción/Embarques/Instalaciones: superficies, jerarquía, estados semánticos, responsive phone y foco con tokens.
- Se eliminó el botón `Configurar` sin callback: una acción primaria sin comportamiento es un callejón sin salida, no una feature.

## Cambios

- `packages/ui/src/production/productionManagerDashboard.css`
  - Reemplazo completo del chrome aislado por tokens del design system y componentes BEM existentes.
  - Sin colores/gradientes/sombras/radios hardcodeados; no se anima `width` de progreso.
  - Estados hover/focus, motion reducido, reflujo mobile y contenidos largos cubiertos.
- `packages/ui/src/production/ProductionManagerDashboard.tsx`
  - Error recuperable anunciado con `role=alert` + `Reintentar`.
  - Estado de carga anunciado con `role=status`.
  - Toggle de métricas y filtros de sector exponen `aria-pressed`.
  - Progreso semántico con `role=progressbar` y valores ARIA.
  - Iconos decorativos declarados `aria-hidden`.
- `packages/ui/src/production/ProductionManagerDashboard.test.tsx`
  - Tests para selección accesible de toggle/filtro y error recuperable.
- `feature_list.json`
  - F099 creada como única feature `in_progress`.

## Verificación

- `pnpm --filter @muebles/ui exec vitest run src/production/ProductionManagerDashboard.test.tsx` ✅ (5 tests)
- `pnpm typecheck` ✅
- `./init.sh` ✅ (incluye suite monorepo completa; 965 UI tests, con warnings preexistentes de jsdom/Three.js sin fallo)
- `git diff --check` ✅
- `node .agents/skills/impeccable/scripts/detect.mjs --json packages/ui/src/production/ProductionManagerDashboard.tsx packages/ui/src/production/productionManagerDashboard.css` ✅ (0 hallazgos)

## Critique posterior

- Snapshot: `.impeccable/critique/2026-08-18T16-57-38Z__packages-ui-src-production.md`
- Score: **35/40** (previo 22/40), P0=0, P1=0.
- Independencia de evaluación: degradada; no hay superficie de browser disponible en esta sesión y la revisión de código queda pendiente de revisor independiente.
- Pendientes deliberados: rollback auditado de avance individual (P2) y recorrido visual autenticado a 390px/768px/desktop (P2).

## Estado

## Correcciones posteriores a review_f099

- Se corrigieron todos los iconos de `ProductionManagerDashboard.tsx`: ahora declaran `strokeWidth={1.5}` y `aria-hidden` cuando acompañan texto o estado ya anunciado por la UI.
- Se añadió una regresión focal que comprueba el contrato para cada SVG del dashboard; falló contra el valor por defecto de Lucide (`2`) antes de la corrección y pasa con el valor del sistema (`1.5`).

## Verificación posterior

- `pnpm --filter @muebles/ui exec vitest run src/production/ProductionManagerDashboard.test.tsx` ✅ (6 tests)
- `pnpm typecheck` ✅
- `./init.sh` ✅ (domain 632, UI 966, web 257, desktop 17, mobile 36)
- `git diff --check` ✅

Implementación corregida lista para nueva revisión independiente. F099 permanece `in_progress` hasta veredicto APPROVED.

## Cierre

- Review independiente: `APPROVED` en `progress/review_f099.md`.
- F099 marcada `done`; resumen trasladado a `progress/history.md`.
- Commit y push: pendientes de registrar tras finalizar la entrega atómica.
