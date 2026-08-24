# Review — feature F154

**Veredicto:** APPROVED

**Rama:** `feat/f154-row-expand-affordance` (pusheada, commit `ea85a6d`)

## Alcance revisado

- `packages/ui/src/catalogs/CatalogTable.tsx` — columna expander condicional.
- `packages/ui/src/catalogs/catalogs.css` — estilos `__expander*` con tokens.
- `packages/ui/src/catalogs/CatalogTable.test.tsx` — 7 tests de comportamiento.
- `docs/design.md` — §3.7 (icono nuevo) + §6.4 (spec affordance).
- `feature_list.json` / `progress/current.md` — ledger.

Diff atómico, una feature, sin trabajo ajeno. El cambio vive en el componente
compartido, por lo que Materiales, Cantos, Herrajes, Acabados, Grupos y
Clientes heredan el affordance sin tocar sus pantallas.

## Checkpoints

- C1: [x] Harness completo; verificación directa (`pnpm test` exit 0,
  `pnpm typecheck` 0 errores) por el guardrail OC-001 conocido de init.sh.
- C2: [x] Una feature `in_progress` (F154); current.md con sesión y evidencia.
- C3: [x] Presentación pura en `packages/ui`; sin lógica de dominio, sin
  dependencias nuevas (lucide-react ya existía), sin `console.log`.
- C4: [x] Suite 3.048 verde (ui 1.401, incluye los 7 tests nuevos);
  verificación de UI por comportamiento + a11y + visual real (no source grep).
- C5: [x] Sin untracked sospechosos; cierre en commit gated en esta
  aprobación.

## Diseño UI/UX (docs/design.md §8 — DoD)

- D1: [x] Sólo tokens: `--text-muted/secondary`, `--transition-colors`,
  `--transition-transform`; sin hex ni px sueltos (el `padding-right: 0` es
  reset, no espaciado).
- D2: [x] Patrón tabla-expand (§4.2.1/§6.4) respetado — implementa
  exactamente lo que §4.2 (F150) sanciona: "la fila abre; su affordance es el
  chevron".
- D3: [x] N/A — sin modales nuevos.
- D4: [x] N/A — sin toasts nuevos.
- D5: [x] Lucide `ChevronRight` 16px `strokeWidth={1.5}`; fila nueva en la
  tabla de iconos §3.7 (regla cumplida).
- D6: [x] Rotación con `--transition-transform` envuelta en
  `prefers-reduced-motion: no-preference`; con reduced motion el chevron
  cambia de dirección sin animación (feedback conservado, sin desplazamiento).
- D7: [x] Gate §8: estados de control (la fila ya tenía hover/focus-visible/
  teclado; el chevron suma estados de color ligados a la fila); tokens; a11y;
  motion; screenshot review a 1280 (reposo + expandido, con zoom) y smoke
  responsive 390px (scroll-x + fade, sin overflow de página, chevrons
  visibles y alineados). 768px no se capturó: el breakpoint tablet sólo
  hereda el mismo scrollport; riesgo residual nulo.
- D8: [x] Copy «Detalle» sentence case (§7); a11y §4.8: chevron `aria-hidden`
  (la fila es el control), `aria-expanded` true/false por fila, cabecera con
  label accesible, contraste muted 5.18:1 sobre card (§4.8 tabla medida).

## Notas de revisión

1. El gating `onRowClick && renderExpandedDetail` es correcto: sin
   `renderExpandedDetail` el chevron prometería una expansión que no existe.
2. `aria-expanded` en `tr` es válido (rol `row` lo soporta, patrón treegrid) y
   no rompe el árbol: verificado en el snapshot ARIA (el chevron no aparece,
   la cabecera «Detalle» sí).
3. Los tests de pantalla existentes no asumen índices de celda — suite
   existente intacta (102 tests de la familia en verde).

## Cambios requeridos

Ninguno.
