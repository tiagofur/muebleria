# Sesión

**Features cerradas:** F154 — table_expand_chevron_affordance · F155 — structures_overflow_destructive_actions
**Inicio:** 2026-08-24 · **Cierre:** 2026-08-24
**Reviews:** `progress/review_F154.md` (APPROVED) · `progress/review_F155.md` (APPROVED)
**Rama:** `feat/f154-row-expand-affordance` (pusheada — ambas features viajan en el PR #359 por decisión del dueño, con commits y reviews separados)

## F154 — Resultado

Hallazgo P1 #1 de la auditoría de paridad UI resuelto: las tablas expandibles
de catálogo ahora anuncian que la fila abre. `CatalogTable` (Materiales,
Cantos, Herrajes, Acabados, Grupos, Clientes) antepone columna estrecha con
chevron: derecha en reposo, rota 90° al expandir (`--transition-transform`
bajo prefers-reduced-motion), muted→secondary en hover/focus de fila,
aria-hidden + `aria-expanded` en la fila + cabecera accesible «Detalle».

## F155 — Resultado

Hallazgo P2 #4 resuelto: el chrome del detalle de Estructuras agrupa ahora
las destructivas en el overflow "Más" (§4.1a.2), con la misma gramática que
el detalle de Muebles — paridad exacta con `ModuleDetailView`:
Vista 3D · Editar (única primaria) · Más (Desactivar/Reactivar según estado +
Eliminar). Mismos handlers y confirmaciones. Fix colateral: el Modal de
confirmación de delete recibía `data-testid` crudo en vez de la prop
`dataTestId` del componente (atributo muerto) — corregido.

## Verificación (evidencia)

- `pnpm test` 3.052 verdes (ui 1.405: 7 tests F154 + 4 tests F155 — chrome
  sin destructivas visibles, Desactivar/Eliminar en el menú con los mismos
  handlers, confirmación destructiva tras Eliminar, Reactivar para
  inactivas, sin canMutate no hay Más ni Editar); `pnpm typecheck` 0 errores.
- Visual en navegador (guest, seed demo):
  - F154: Materiales reposo/expandido con zoom, Clientes hereda, 390px sin
    overflow (más arriba en la sesión).
  - F155: detalle `struct-gab-01` — chrome Lista · Vista 3D · Editar · Más;
    menú abierto muestra Desactivar + Eliminar; sin destructivas sueltas ni
    glitches (verificación programática + captura).

## Siguientes pasos (backlog auditoría)

1. Continuar revisión: Componentes, catálogos, Clientes, Vitrina (con datos).
2. Headings múltiples en Librería (P2 #3) y "Sin foto" en nombre accesible
   (P3 #5) por pantalla.
