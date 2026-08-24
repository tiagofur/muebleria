# Sesión

**Features cerradas:** F150 — ui_card_click_open · F151 — ui_card_hover_actions
**Inicio:** 2026-08-23 · **Cierre:** 2026-08-23
**Reviews:** `progress/review_F150.md` · `progress/review_F151.md` (APPROVED)

## Resultado

Paridad del patrón de cards de línea completa con la referencia canónica del
dueño: **la card de /engineering (`eng-project-card`)**.

- **F150**: la card abre el detalle con click en su cuerpo (título stretched:
  foco, Enter/Espacio, aria-label) en Órdenes, Instalaciones y Embarques; sin
  botón "Abrir X". Botones de proceso y `tel:` no disparan la apertura.
- **F151**: la card descansa **limpia**; las acciones de proceso (Pack, Marcar
  en producción) se revelan en hover/focus-within, en tamaño compacto
  (`btn--small`, iconos 14px), siempre visibles en touch (`hover: none`).
  Hover de card alineado a ingeniería (`--border-strong` + `--shadow-md` +
  `--surface-hover`). `card-actions-reveal` vive en `common/cardOpen.css`.
- `design.md` §4.2 universaliza ambas reglas; §6.7/§6.7c/§6.7d actualizadas.

## Verificación (evidencia)

- `pnpm test` ui 1385 + web 306 verdes; `pnpm typecheck` 0 errores; guard de
  tokens/z-index del design system verde.
- Tests de comportamiento: apertura por teclado/mouse, no-apertura desde
  acciones internas, sin botón dedicado.
- Visual con auth (capturas /tmp/muebles-review/20-23 y 31-32): reposo limpio,
  hover con acciones compactas, navegación ida/vuelta en las 3 pantallas,
  click de cuerpo interceptado por el trigger estirado (actionability proof).

## Decisiones del dueño registradas

- La referencia visual de listas de línea completa es `eng-project-card`.
- Prefiere acciones reveladas en hover (card limpia) — recalibra el hallazgo
  de la auditoría sobre "acciones hover-only" en catálogos: el patrón ya era
  el buscado (con fallback touch); sólo falta el chevron de affordance.

## Siguientes pasos (backlog auditoría)

1. Bug routing `/modules/:id` deep-link/F5 (candidato F152).
2. Chevron de affordance en tablas expandibles de catálogo.
3. Estructuras: Desactivar/Eliminar al overflow "Más".
4. Continuar revisión: Estructuras, Componentes, catálogos, Clientes, Vitrina.
