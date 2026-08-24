# Review — feature F151

**Veredicto:** APPROVED

## Checkpoints

- C1: [x] Verificación directa `pnpm test` (ui 1385 + web 306 verdes; typecheck 0).
- C2: [x] F151 in_progress → done; `progress/current.md` actualizado.
- C3: [x] Sólo presentación en `packages/ui`.
- C4: [x] Tests de comportamiento de F150 siguen verdes (Pack no abre, trigger abre).

## Diseño UI/UX

- D1: [x] Sólo tokens (`cardOpen.css`: duraciones, `--z-base`, superficies,
  sombras; guard `designSystem.test.ts` verde).
- D2: [x] Patrón alineado a la referencia canónica del dueño
  (`eng-project-card`): card limpia en reposo, acciones reveladas en
  hover/focus-within, `btn--small` + iconos 14px, fallback `hover: none`.
- D3–D4: [x] N/A (sin modales/toasts).
- D5: [x] Iconos Lucide 14px en botones small (mismo criterio que ingeniería).
- D6: [x] Transición de opacidad con token + `prefers-reduced-motion`.
- D7: [x] DoD §8: estados completos; teclado (focus-within revela acciones);
  una primaria (Pack compacta).
- D8: [x] A11y preservada: acciones alcanzables por Tab (focus-within), sin
  dependencia del mouse en touch.

## Evidencia visual (auth, capturas 31/32)

- Reposo: card limpia — sin botones; título/meta/badge/precio.
- Hover: Pack + Marcar en producción visibles y compactos (~26px); borde
  fuerte + sombra + superficie hover; cursor pointer.

## Nota

- `card-open-host:hover` pasa de `--border-brand` a `--border-strong`
  (alineación con eng-project-card que el dueño definió como referencia);
  design.md §4.2 actualizado en consecuencia (F150/F151).
- Las tablas de catálogo ya implementaban reveal+touch fallback — sin cambios;
  hallazgo previo de la auditoría recalibrado según preferencia del dueño.
