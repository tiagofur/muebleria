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
- [ ] C2 → PR (apilado)
- [ ] C3 → PR (apilado)
- [ ] C4 → PR (apilado)
- [ ] C5 → PR (apilado)
- [ ] Browser proof + re-critique
