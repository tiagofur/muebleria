# ODD — #1019 Paridad UX de la pantalla de Componentes

- **Lane:** Delegated Direct (multi-slice, multi-file; recovery valioso).
- **Writer:** GLM (ZCode), sesión 2026-10-04. Un escritor, rama aislada por slice.
- **Base:** `origin/main` @ 4941f945 (incluye #1009 completo mergeado).
  Aprobación: owner en sesión («vamos» al plan recomendado; Duplicar sin
  Eliminar por contrato de pieza compartida; issue madre #1019).

## Outcome

La pantalla de Componentes queda paritada con los patrones aprobados: contrato
de guardado (C1), diagrama de cantos accesible (C2), Duplicar (C3), tab
Construcción dentro del sistema (C4), tipografía runtime al estándar (C5).

## Scope (del issue — no ampliar)

Fuera de alcance (issue #1019): Eliminar (decisión no-eliminar), validación de
fórmula al tipear, corrección de código de pieza existente, «N usos», h3-en-
button transversal, Enter prematuro, atajos, ruta de edición.

## Checks / evidencia

- Verificación base: typecheck workspace, vitest de packages/ui + domain +
  apps/web (toca store en C3). Tests con promesa diferida en C1 (patrón S3).
- Browser proof de la pantalla completa al cierre + re-corrida
  `$impeccable critique` (baseline 26/40) — aceptación transversal.
- PRs apilados con labels `type:feature` desde el inicio (lección #1010:
  sin label el check Publication metadata falla).

## Task log

- [x] Issue #1019 fileada (labels high/frontend/type:feature/status:approved).
- [x] Preflight PREFLIGHT_OK_NOT_VERIFIED (dirty = untracked preexistente);
      sin conflicto de writer (abierto: #1018 backend, lane distinto).
- [x] C1 → PR (rama `feat/1019-componentes-ux-c1`). Réplica del S3 #1009:
  props `void | Promise<void>`, submit que espera antes de cerrar,
  saving/saveFailed, Guardar «Guardando…» disabled + Cancelar bloqueado,
  banner `component-editor-save-error` en ComponentEditorForm + CSS. Test
  existente R4-C1 ajustado al contrato async (flush con act — el comportamiento
  nuevo es correcto, el test asentaba sync). Evidencia: ui 2098/2098,
  typecheck 7/7; 2 tests nuevos con promesa diferida (fallo mantiene draft +
  banner; éxito cierra al resolver).
- [x] C2 → PR #1022 (`feat/1019-componentes-ux-c2`). Foco visible por
  engrosamiento+recoloreo del trazo (el drop-shadow 0 0 0 no pintaba nada y
  usaba sintaxis box-shadow inválida), hit stroke invisible de 30 unidades
  (~40px) con hover por adyacencia, ausente cuando disabled. Tests: 2 nuevos,
  components 58/58.
- [x] C3 → PR (`feat/1019-componentes-ux-c3`). `duplicateComponent` en
  domain/duplicate.ts (id/código `-COPY`, nombre «(copia)», perforaciones con
  ids frescos), store action (patrón duplicateAgregado), prop onDuplicate en
  ComponentsScreen/ShellView/AppContent, menú «Más ▾» con Duplicar en
  ComponentDetailView. Sin Eliminar (decisión de contrato del issue).
  Evidencia: domain 1771/1771, ui 2102/2102, web 581/581, typecheck 7/7.
- [x] C4 → PR #1026 (`feat/1019-componentes-ux-c4`). Badge de procedencia
  como chip dot+texto sobre tokens reales (sin emojis ni hex fallbacks),
  botones `btn--small` reales, hints a `catalog-form__hint`, estilos a
  components.css (`component-joinery__*`), verbo del panel «Fijar excepción
  en fábrica» (ya no compite con el Guardar del chrome). 4 aserciones de test
  actualizadas al copy aprobado; components 60/60.
- [x] C5 → PR #1027 (`feat/1019-componentes-ux-c5`). Hints de frase completa
  a `--text-sm`, dt y total-label al piso de 12px, title del workspace a
  `--text-lg` (§3.1), intro de cantos `max-width: 72ch`, regla duplicada de
  placement-hint consolidada. ui 2102/2102.
- [x] Browser proof (rama C5 servida por el vite dev local, modo invitado):
  lista de componentes OK; detalle con «Más ▾» → Duplicar creó
  `COM-PUE-01-COPY — Puerta (copia)` (C3 ✓); tab Construcción con badge
  «Biblioteca · estándar Granete» sin emojis, regex-checked (C4 ✓); tab
  Cantos con las reglas nuevas vivas en el stylesheet
  (`edge:focus-visible { stroke brand-600, width 18 }` + hit stroke 30)
  y el DOM recibe foco en los bordes (C2 ✓ — el paseo con Tab es una
  limitación de simulación del IAB, documentada); intro de cantos con
  medida acotada visible en screenshot (C5 ✓). C1 cubierto por tests con
  promesa diferida (el guardado local es demasiado rápido para observar el
  busy en vivo). Restante post-merge: re-corrida `$impeccable critique`
  sobre main (baseline 26/40).
