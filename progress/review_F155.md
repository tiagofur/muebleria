# Review — feature F155

**Veredicto:** APPROVED

**Rama:** `feat/f154-row-expand-affordance` (commit de F155; viaja en el
PR #359 junto a F154 por decisión explícita del dueño — commits y reviews
separados por feature)

## Alcance revisado

- `packages/ui/src/structures/components/StructureDetailView.tsx` —
  Desactivar/Reactivar/Eliminar movidos a `moreItems` + `DropdownMenu`.
- `packages/ui/src/structures/StructuresScreen.tsx` — fix colateral: el Modal
  de confirmación usaba `data-testid` (atributo crudo) en vez de la prop
  `dataTestId` del componente — atributo muerto; corregido.
- `packages/ui/src/structures/StructuresScreen.test.tsx` — 4 tests de
  comportamiento.
- `docs/design.md` §6.8 — chrome actualizado.
- `feature_list.json` / `progress/current.md`.

## Checkpoints

- C1: [x] Verificación directa: `pnpm test` exit 0 (3.052), typecheck 0.
- C2: [x] Una feature `in_progress` por vez (F155 arrancó tras cerrar F154);
  current.md con ambas sesiones y evidencia.
- C3: [x] Presentación pura en packages/ui; sin lógica de dominio.
- C4: [x] Tests de comportamiento reales: chrome sin destructivas visibles,
  ítems del menú con los mismos handlers, confirmación destructiva tras
  Eliminar, Reactivar para inactivas, gating sin canMutate.
- C5: [x] Push en el cierre; sin untracked.

## Diseño UI/UX (docs/design.md §8 — DoD)

- D1: [x] N/A — sin CSS nuevo; se reusan clases existentes (`btn`,
  DropdownMenu).
- D2: [x] Patrón correcto: §4.1a.2 (destructivas → overflowActions) y
  gramática idéntica a ModuleDetailView (la referencia canónica del audit);
  spec §6.8 actualizada.
- D3: [x] N/A — el Modal usado es el común (focus trap/Esc/retorno de foco
  por contrato existente).
- D4: [x] N/A — sin toasts nuevos.
- D5: [x] Iconos Lucide existentes (`EyeOff`/`Eye`/`Trash2` ya en tabla §3.7;
  `MoreHorizontal` preexistente en Muebles/Cotizaciones — no es icono nuevo
  en la app).
- D6: [x] N/A — sin animaciones nuevas.
- D7: [x] Gate §8: una primaria (Editar); acciones infrecuentes/destructivas
  al overflow accesible; verificación visual real (chrome + menú abierto +
  asserts programáticos de ausencia de destructivas sueltas); responsive N/A
  (chrome existente, sin cambios de layout).
- D8: [x] Copy existente (sentence case, verbo+objeto); a11y por contrato del
  DropdownMenu (`aria-haspopup`, `role=menu/menuitem`, Escape, foco al
  trigger).

## Notas de revisión

1. El gating `canMutate && handler` en `moreItems` duplica el gating de
   StructuresScreen — defensivo correcto para uso directo del componente.
2. La estructura inactiva muestra Reactivar (no Desactivar) — cubierto por
   test.
3. Fix del `dataTestId` del modal es trabajo de la feature (el flujo de
   delete es parte del cambio), no mezcla ajena.

## Cambios requeridos

Ninguno.
