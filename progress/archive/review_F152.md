# Review — feature F152

**Veredicto:** APPROVED

**Rama:** `feat/f152-modules-deep-link` (push: 5b8d686)

## Checkpoints

- C1: [x] Harness completo (AGENTS.md, init.sh, feature_list.json,
  progress/current.md, CHECKPOINTS.md, docs, skills). Tests verdes.
- C2: [x] Una sola feature `in_progress` (F152, ahora `done`). Tests de la
  feature pasan en `pnpm test` (31/31 en ModulesScreen.test.tsx).
  `progress/current.md` describe la sesión activa.
- C3: [x] Cambio 100% en `packages/ui` (hook de estado UI). Sin dominio, sin
  fs, sin fórmulas de costo. Reutiliza el hook compartido existente
  (`useRoutableEntitySelection`) — cero superficie nueva inventada.
- C4: [x] Verificación real: `pnpm test` 3048 tests verdes (domain 1035,
  storage 155, excel 89, ui 1391, mobile 45, desktop 17, web 306);
  `pnpm typecheck` 0 errores. Además verificación de comportamiento en
  navegador real (5 flujos, ver abajo). No toca export/storage/motor de
  dominio → no aplica golden/fixture.
- C5: [x] Sin archivos sin trackear sospechosos. Entrada en
  `progress/history.md` agregada. Estado `done` en `feature_list.json`.
  `progress/current.md` cerrado en plantilla limpia.

## Diseño UI/UX

Cambio de routing/estado, sin superficie visual nueva.

- D1: [x] N/A — no se agregan colores/espaciados/sombras/radios.
- D2: [x] Alinea ModulesScreen al patrón canónico §4.2 lista→detalle con
  deep link `/section/:id` (mismo contrato que structures/components/
  customers/catálogos vía `useRoutableEntitySelection`).
- D3–D6: [x] N/A — sin modales/toasts/iconos/animaciones nuevos.
- D7: [x] Gate §8: comportamiento y navegación verificados en navegador real,
  no sólo source grep.
- D8: [x] Sin copy nuevo. Interacción por teclado intacta (los tests
  existentes de tabs/roving y apertura siguen verdes).

## Evidencia de comportamiento (navegador, guest + demo, :5199)

Pre-fix (reproducido):
1. `goto /modules/mod-gab-01` + reload → rebota a `/modules` (lista).
2. detalle → Editar → Volver → URL queda `/modules/mod-gab-01/edit` con
   editor cerrado.

Post-fix (verificado):
1. Deep-link `/modules/mod-gab-01` → detalle visible, URL estable.
2. F5 en el detalle → detalle sobrevive con nombre correcto.
3. detalle → Editar → Volver → `/modules`, editor cerrado.
4. F5 en `/modules/mod-gab-01/edit` → editor abre; Volver → `/modules`.
5. Regresión in-app: card → `/modules/mod-gab-01`; Volver a la lista →
   `/modules`.

## Notas

- El síntoma 1 tenía causa doble: efecto de mount que notificaba
  `onSelectionChange(null)` (la shell navegaba a la lista) + guard de refs
  (`lastOpenModuleIdRef` inicializado al valor de mount) que impedía sembrar
  la selección desde la URL. Ambos efectos se eliminan al migrar al hook
  canónico.
- El síntoma 2 (URL pegada en /edit) era el costo oculto del comportamiento
  bespoke de mantener la selección durante la edición: `onEditorClose(restoreId)`
  usaba `onSelectionChange`, que la shell bloquea en rutas `/edit`
  (`isEntityEditPath`). Con selección null durante edición, el cierre cae al
  branch `onRequestEdit(null)` — mismo contrato que structures.
- PR #342 (ProjectsScreen echo loop) es un síntoma hermano en otra screen;
  sin solapamiento de archivos con F152.
- Diff atómico: 2 archivos de código/test de modules + ledger + progreso.
  Sin mezcla de features ajenas.
