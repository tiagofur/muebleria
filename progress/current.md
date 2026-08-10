# Sesión — Roadmap Comercial v2 + F066 Inspector colapsable

- **Branch:** `feat/F066-inspector-colapsable` (desde main)
- **Fecha:** 2026-08-10
- **Scope:** Planeamiento estratégico (roadmap comercial) + primera feature F066

## Contexto de la sesión

Sesión de planeamiento estratégico + arranque de implementación. El usuario
quiere llevar el producto a "opción a Promob para fábricas chicas de LatAm".
Se decidió NO migrar a C#/nativo, mantener el stack React/R3F/Go/Electron, y
priorizar Proyectar + herrajes 3D + producción de corte + empaquetado Windows.

## Hecho — Planeamiento

- `docs/roadmap-comercial-v2.md` (nuevo): única fuente de verdad, consolida
  4 roadmaps solapados. Decisiones D1-D4, Fases A-D + Congelada.
- `docs/prd.md §17`: reescrito, referencia al roadmap comercial.
- `feature_list.json`: +17 features F065-F081 (60→77 total).
- GitHub: 17 issues #277-#293 + 5 milestones (Fase A-E). Issues #254-#256
  reasignados a Fase C.
- Commits en main: `9675c2e` (planeamiento) + push.
- WIP hardware-3d preservado en rama feat (`9dbc1d7`) + push.

## Hecho — F066 Inspector 3D colapsable (#278, Fase A)

- `useInspectorSectionState.ts` (nuevo): hook SSR-safe con persistencia en
  localStorage. Default: 4 secciones abiertas + advanced cerrada.
- `useInspectorSectionState.test.ts` (nuevo): 8 tests (default, toggle,
  setOpen, persistencia, rehidratación, merge defaults, corrupt JSON, no-op).
- `PartInspector.tsx`: rediseñado en 5 secciones colapsables
  (Dimensiones/Material/Herrajes/Acabado/Avanzado) con sub-componentes
  CollapsibleSection + FieldGrid. Placeholders en Herrajes/Acabado para F069/F070.
- `partInspector.css`: estilos de sección colapsable con tokens del repo
  (ChevronDown/Right, aria-expanded, hover/focus, surface-input body).
- `PartInspector.test.tsx`: 8 tests (existentes adaptados + nuevos: 5 headers,
  toggle, advanced collapsed default, placeholders, persistencia remount).

### Decisión de testing
El test existente hacía `getByTestId('part-inspector-role')` asumiendo que
role estaba visible. Con F066, role vive en sección "Avanzado" que arranca
cerrada por defecto. Se adaptó el test para abrir la sección antes del assert
— no es romper el test, es reflejar el nuevo comportamiento intencional
(advanced = datos técnicos, cierra por defecto).

## Validación

- `pnpm --filter @muebles/ui test`: 634/634 ✓
- `pnpm typecheck`: 6 workspaces ✓
- `./init.sh`: entorno + tests + typecheck verde completo ✓

## Siguiente

- Commit F066 + push + cerrar issue #278
- Próxima feature Fase A: F065 (drag-drop mejorado) o F067 (paleta materiales)
