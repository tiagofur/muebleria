# Review — feature F144

**Veredicto:** APPROVED

**Feature:** proyectar_precision_dims_undo (#310 P3D-1b, meta #308 etapa E4)
**Rama:** `feat/f144-precision-dims` (apilada sobre `feat/f143-multiselect-align`, PR #331 abierto)
**SDD:** https://github.com/tiagofur/muebleria/issues/310#issuecomment-5383131745

## Checkpoints

- C1: [x] Harness completo; `pnpm test` + `pnpm typecheck` exit 0; smoke WebGL 3/3.
- C2: [x] Una sola feature `in_progress`→`done`; tests asociados pasan; current.md describe la sesión.
- C3: [x] Boundaries respetados: `itemDims.ts`/`kitchenPrecisionCommands.ts` sin react/fs/xlsx;
  errores de dominio como `ResolutionError`/issues tipados (no strings sueltos);
  UI no calcula dominio (nudge/snap via comandos/resolver de domain); sin console.log.
- C4: [x] Verificación real: domain 995 (dom) · ui 1.316 · storage 153 · excel 89 · web 301 ·
  mobile 45 · desktop 17 = 2.916 tests; engine cubierto por `customDims.test.ts`
  (partes paramétricas cambian con override + rechazo no-paramétrico + fingerprint);
  smoke real WebGL con screenshot revisado (`test-results/proyectar-precision.png`).
- C5: [x] Sin archivos sospechosos; history.md con entrada F144; ledger done; current.md cierre.

## Diseño UI/UX

- D1: [x] Sólo tokens (CSS nuevo usa `--space-*`, `--radius-md`, `--danger-600`,
  `color-mix` con vars; sin hex hardcodeados).
- D2: [x] Patrones existentes del studio (toolbar flotante, campos del inspector,
  barra contextual sólo con selección — §27 anti-scope).
- D3: [x] Popover `role="dialog"` con aria-label; **Esc cierra el popover antes que
  ninguna otra cosa** (precedencia: ghost > modal > popover > detalle > selección > cerrar).
- D4: [x] Sin toasts nuevos; feedback vía `commandStatus` (aria-live) existente.
- D5: [x] Iconos Lucide `Focus` y `Ruler` con `strokeWidth 1.5`, documentados en §3.7.
- D6: [x] Sin animaciones nuevas.
- D7: [x] Gate §8: estados vacío/disabled con razón (a medida no paramétrico enseña),
  inputs con label + testid, teclado (flechas/F/Ctrl+Z) con precedencia documentada.
- D8: [x] Copy español sentence-case ("A medida (mm)", "Paso nudge (mm)");
  números formateados; significado no sólo por color (error con texto `role="alert"`).

## Hallazgos encontrados y CORREGIDOS durante la review

1. **Undo no borraba `customDims`**: `applyHistoryEntry` sólo ponía la clave cuando
   el snapshot la tenía → deshacer "a medida" dejaba la medida vieja. Fix: `customDims`
   siempre explícito en el restore (clave `undefined` = ausente). Test: jsdom
   "a medida: commitea W validado… y undo la restaura".
2. **Flechas con foco en tabs**: el roving tabindex (`useRovingTabList`) navega tabs con
   ←/→ y el nudge de window también disparaba → doble acción. Fix: precedencia
   `arrowsOwnedByWidget` (flechas dentro de `[role="tablist"]` pertenecen al widget).
   Detectado en smoke real (el foco quedaba en el tab tras click).
3. **Popover Precisión no cerraba con Esc**: la precedencia de Esc lo salteaba y
   cerraba selección/studio. Fix: Esc cierra el popover primero.
4. **`moduleAcceptsCustomDims(selectedModule!)`** crasheaba con módulo indefinido
   (ítem cuyo módulo no está en `modules`). Fix: guard `selectedModule && …`.

## Notas de alcance (deuda explícita, no bloqueantes)

- Per-instance dims no modelado (la medida es de la línea; partir el ítem sería
  otra feature) — documentado en SDD y cierre.
- Paridad TS/Go del `dimsOverride` (contract fixtures) → #313 (P3D-7, siguiente etapa).
- `projectDrilling` sigue asumiendo mismo-módulo=mismo-geometry para PRESETS
  distintos (pre-existente); customDims sí se separa por clave compuesta.
