# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0` (F057 commiteada y pushed; PR pendiente de merge)
- **META issue:** #156 Perfect App roadmap
- **Última feature cerrada:** F057 — phase0_workspace_store → `progress/close_F057.md`

## Estado Fase 0 (Perfect App Roadmap §5)

| ID | Feature | Estado |
|---|---|---|
| F057 | workspaceStore Zustand | ✅ done (sub-slice 1/4) |
| F062 | catalogStore (catálogos + módulos + estructuras + componentes + customers) | ⏳ pending (próximo) |
| F063 | projectStore (proyectos + items + templates + breakdown) | ⏳ pending |
| F064 | uiStore + ToastProvider migration | ⏳ pending |
| F058 | Partir ProjectsScreen (2793 L) en lista + detalle + exports | ⏳ pending |
| F059 | Abstraer EntityEditorLayout<Tab,Draft> común | ⏳ pending |
| F060 | Partir engine.ts (2108 L) por responsabilidad | ⏳ pending |
| F061 | Command pattern + undo/redo | ⏳ pending |

## Próximo slice recomendado

**F062 catalogStore**: mueve ~30 handlers de mutación de catálogo desde App.tsx
al store, elimina `patchCatalog` wrapper y reduce el uso de `workspaceRef` para
catálogo. Sienta la base para que F063 migre los handlers de proyecto.

## Notas

- App.tsx está en 2810 L (de 2880 pre-F057). Bajará fuerte en F062/F063/F064.
- Los snapshots de Playwright (`tests/visual/baseline.spec.ts-snapshots/`)
  están untracked en main (issue preexistente, no de F057).
