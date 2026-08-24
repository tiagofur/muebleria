# Sesión

**Feature en curso:** F154 — table_expand_chevron_affordance
**Inicio:** 2026-08-24
**Rama:** `feat/f154-row-expand-affordance`

## Plan

1. Chevron de affordance en `CatalogTable` (componente compartido por
   Materiales, Cantos, Herrajes, Acabados, Grupos y Clientes).
2. CSS con tokens: muted → secondary en hover, rotación 90° con
   `--transition-transform` bajo `prefers-reduced-motion: no-preference`.
3. A11y: `aria-expanded` en la fila, chevron `aria-hidden`.
4. Tests de comportamiento del componente.
5. design.md §3.7 (icono nuevo) + §6.4 (affordance).
6. Verificación visual en navegador + suite + typecheck.

## Contexto

Hallazgo P1 #1 de `progress/ui-parity-audit-2026-08-23.md`: la fila expande
inline pero nada lo anuncia (sin chevron, sin "Ver"); el usuario no puede
predecir qué hará el click. design.md §4.2 (F150) ya sanciona el lenguaje:
"la fila abre; su affordance es el chevron" — sólo falta implementarlo.

## Estado

- [x] Implementación
- [x] Tests
- [x] Docs
- [x] Verificación (suite + visual)
- [ ] Review

## Verificación (evidencia)

- `pnpm test` 3.048 tests verdes (ui 1.401 — incluye 7 tests nuevos de
  CatalogTable: chevron por fila expandible, aria-hidden, aria-expanded
  true/false por fila, data-expanded en el chevron, ausencia sin
  renderExpandedDetail, click intacto, label accesible «Detalle» en cabecera);
  `pnpm typecheck` 0 errores.
- Visual en navegador (dev :5199, guest, seed demo):
  - Materiales reposo: chevron muted apuntando a la derecha en cada fila,
    alineado verticalmente, primera columna estrecha, layout intacto.
  - Materiales expandido (click en TAB-ARA-BLA): chevron de la fila rota 90°
    hacia abajo, las demás filas siguen a la derecha, panel de detalle
    desplegado, sin glitches.
  - Clientes: 2 filas con chevron (mismo componente compartido).
- design.md actualizado: §3.7 fila de icono nueva (`ChevronRight` expandir
  fila) + §6.4 spec del affordance.

## Archivos

- `packages/ui/src/catalogs/CatalogTable.tsx` — columna expander condicional
  (onRowClick && renderExpandedDetail), aria-expanded en la fila, chevron
  ChevronRight 16px aria-hidden, colSpan actualizado.
- `packages/ui/src/catalogs/catalogs.css` — `__expander*` con tokens; rotación
  90° bajo `prefers-reduced-motion: no-preference`; muted→secondary en
  hover/focus-within/expanded de la fila.
- `packages/ui/src/catalogs/CatalogTable.test.tsx` — 7 tests de comportamiento.
- `docs/design.md` — §3.7 + §6.4.
- `feature_list.json` — F154.
