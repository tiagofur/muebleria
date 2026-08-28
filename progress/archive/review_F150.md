# Review — feature F150

**Veredicto:** APPROVED (gate visual pendiente de sesión auth del dueño — ver nota)

## Checkpoints

- C1: [x] Archivos base presentes; verificación corrida directamente con `pnpm test` (deuda OC-001 de init.sh documentada).
- C2: [x] Una sola feature in_progress (F150); suite verde; `progress/current.md` describe la sesión.
- C3: [x] Sólo presentación en `packages/ui` (sin fórmulas de costo, sin fs, sin console.log).
- C4: [x] `pnpm test` completo verde (3017+ tests, 24 archivos web incluidos) + `pnpm typecheck` 0 errores.

## Diseño UI/UX

- D1: [x] Sólo tokens en `cardOpen.css` (guard `designSystem.test.ts` verde; z-index con `var(--z-base)`).
- D2: [x] Patrón correcto: §4.2 regla universal de apertura documentada; §6.7/§6.7c/§6.7d actualizadas (sin contradicciones con specs viejas).
- D3: [x] N/A modales (no se tocan).
- D4: [x] N/A toasts.
- D5: [x] Sin iconos nuevos; se eliminaron import muertos (ArrowRight).
- D6: [x] Transiciones con tokens de duración, mismo patrón que `entityCard.css` (color/borde/sombra; sin transform).
- D7: [x] DoD §8: estados de control completos en el trigger (hover/pressed/focus-visible; disabled n/a); una primaria por card (Pack); copy aria-label "Abrir <contexto> <obra>".
- D8: [x] A11y: trigger = button real (foco, Enter/Espacio testeado); tel: y Pack no disparan apertura (testeado); sin HTML anidado inválido (stretched ::after, no button-in-button).

## Verificación pendiente (no bloquea el código)

- **Screenshot review §6 con sesión auth**: las 3 pantallas (Órdenes cola,
  Instalaciones, Embarques) requieren backend/credenciales. El dueño proveerá
  acceso; hasta entonces F150 permanece `in_progress` y no se marca `done`
  ("no done sin evidencia"). Comportamiento y a11y ya están cubiertos por
  tests (22 en producción + guards).

## Hallazgos corregidos durante la review

1. `z-index: 1` literal → `var(--z-base)` (guard F111 lo detectó).
2. Hover divergente del lenguaje de cards (border-strong) → alineado a
   `entity-card` (border-brand + shadow-md + surface-hover).
3. Falta de pressed en el trigger → `:active` oscurece un paso (brand-700).
