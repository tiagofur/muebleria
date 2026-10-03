# ODD — #1009 Paridad UX de la pantalla de Agregados

- **Lane:** Delegated Direct (multi-slice, multi-file; recovery valioso).
- **Writer:** GLM (ZCode), sesión 2026-10-03. Un escritor, rama aislada por slice.
- **Base:** `origin/main` @ e997d68e. Aprobación: owner en sesión (top 5 en orden,
  identidad en `EntityEditorLayout`, issue madre #1009 con checklist).

## Outcome

La pantalla de Agregados (`packages/ui/src/agregados`, ruta `/add-ons`) queda
paritada con los patrones de Muebles (`packages/ui/src/modules`) en los 5 slices
del issue #1009, con sus criterios de aceptación y verificación proporcional.

## Scope (del issue — no ampliar)

- S1 [P0]: confirmación de Eliminar (ConfirmDialog compartido), Eliminar al menú
  «Más ▾» (patrón `DropdownMenu` de `ModuleDetailView`), error de backend visible.
- S2 [P1]: identidad del ítem en el header del editor — prop `draftName` en
  `EntityEditorLayout` + sentence case; los 4 editores heredan.
- S3 [P1]: contrato de Guardar — busy/disabled + banner stale + error de servidor.
- S4 [P2]: «Rol de opción» select gobernado por `optionGroups`.
- S5 [P2]: `onDuplicate` + picker de componentes con búsqueda.

Fuera de alcance (issue): costo de agregados, ruta `/edit`, id en capa UI,
preview 3D fidelidad, a11y puntual, borrador zombi.

## Checks / evidencia

- Verificación base: typecheck pnpm (7 paquetes), vitest de `packages/ui`,
  lint de lo tocado. `verify_affected.py --plan` antes de la suite elegida.
- S1 hallazgo de store: `hardDeleteOnAuth` ya toastea fallos de servidor
  (`apps/web/src/stores/catalog/shared.ts:473-491`) — el hueco real es el
  contrato de UI; sin cambios en store salvo hallazgo nuevo en S1.
- Browser proof de la pantalla + re-corrida `$impeccable critique` al cierre
  de los 5 slices (aceptación transversal del issue).

## Delivery strategy

PRs apilados, uno por slice, contra #1009 con `Refs #1009 + Delivery: partial`
mientras queden slices; el último puede ser `Closes #1009 + Delivery: complete`
si la aceptación completa (incl. browser proof) está verde. Merge humano.

## Task log

- [x] Protocolo: preflight PREFLIGHT_OK_NOT_VERIFIED (tree dirty preexistente:
      `.agents/tasks/`, `.github/workflows/cleanup-actions.yml` — no míos);
      sin otro writer (PRs abiertos: #1008 dominio SketchUp, ajeno).
- [x] S1 → PR 1 (rama `feat/1009-agregados-ux-s1`). Eliminar detrás de
  «Más ▾» (DropdownMenu, patrón ModuleDetailView F155) + ConfirmDialog
  compartido a nivel pantalla con código+nombre+consecuencia; borrar el
  agregado en detalle vuelve a la lista. Store sin cambios: los fallos de
  servidor ya toastean (`shared.ts:473-491`). Evidencia: vitest agregados
  28/28, suite ui 2084/2084 (184 files), typecheck workspace 7/7.
- [x] S2 → PR 2 (rama `feat/1009-agregados-ux-s2`, apilada sobre S1).
  `draftName` en `EntityEditorLayout` (header del editor: «Editar <entidad> —
  <nombre guardado>» + código **guardado** estable, no el draft vivo); los 4
  editores (Muebles/Estructuras/Componentes/Agregados) pasan código+nombre
  guardados; sentence case en Agregados («Nuevo agregado»). Tests: header
  estable mientras se edita el código (agregados), título con nombre
  (ModulesScreen test actualizado), creación sin identidad. Evidencia: suite
  ui 2086/2086, typecheck 7/7.
- [x] S3 → PR 3 (rama `feat/1009-agregados-ux-s3`, apilada sobre S2). El save
  ahora se espera ANTES de cerrar el editor (paridad #497): rechazo mantiene
  el editor abierto con el draft intacto + banner «No se pudo guardar…»
  (`agregado-editor-save-error`); Guardar busy/disabled «Guardando…» y
  Cancelar bloqueado durante el vuelo; props onCreate/onUpdate ahora
  `void | Promise<void>` (el store ya devolvía la promesa de saveAndToast —
  el bug era el submit fire-and-forget). Nota de alcance: agregados no lleva
  token de versión/If-Match (contrato #497 de Module solamente), así que no
  existe VERSION_CONFLICT acá; el banner es el genérico de fallo de guardado.
  Evidencia: suite ui 2089/2089, typecheck 7/7; tests con promesa diferida
  (fallo y éxito). Trampa hallada: el draft persiste en sessionStorage entre
  tests → afterEach limpia storage.
- [x] S4 → PR 4 (rama `feat/1009-agregados-ux-s4`, apilada sobre S3). El rol
  de opción de herrajes pasa de texto libre a select gobernado por
  `optionGroupsForHardware` (patrón ModuleEditorHardwarePanel); valor guardado
  fuera de catálogo se muestra como «(guardado)» sin reescribirlo; degradación
  a texto libre sin grupos; `addHardwareLine` defaultea al primer rol del
  catálogo en vez del hardcodeado «HERRAJE». Evidencia: suite ui 2093/2093,
  typecheck 7/7; 4 tests nuevos (select sólo con grupos hardware-kind,
  valor guardado preservado, propagación al draft, fallback input).
- [ ] S5 → PR 5 (apilado)
