# Sesión actual

- **Carpenter canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-catalog` (F062 commiteada y pushed; PR pendiente)
- **META issue:** #156 Perfect App roadmap

## Estado Fase 0 (Perfect App Roadmap §5)

| ID | Feature | Estado |
|---|---|---|
| F057 | workspaceStore Zustand | ✅ done (sub-slice 1/4) |
| F062 | catalogStore (catálogos + módulos + estructuras + componentes + customers) | ✅ done (sub-slice 2/4) |
| F063 | projectStore (proyectos + items + templates + breakdown) | ⏳ pending (próximo) |
| F064 | uiStore + ToastProvider migration | ⏳ pending |
| F058 | Partir ProjectsScreen (2793 L) en lista + detalle + exports | ⏳ pending |
| F059 | Abstraer EntityEditorLayout<Tab,Draft> común | ⏳ pending |
| F060 | Partir engine.ts (2108 L) por responsabilidad | ⏳ pending |
| F061 | Command pattern + undo/redo | ⏳ pending |

## Próximo slice recomendado

**F063 projectStore**: mueve ~20 handlers de proyecto (createProject,
updateProject, addProjectItem, saveAsTemplate, etc.) + el useEffect de backend
breakdown. App.tsx baja de 2261 → ~1200 L. Tras F063, `workspaceRef`
desaparece totalmente.

## Notas

- App.tsx en 2261 L (de 2880 original). Faltan ~1660 L por migrar (F063 + F064).
- `workspaceRef` sigue existiendo para projects (hasta F063).
- catalogStore posee el catálogo; workspaceStore ya no.
- Los snapshots de Playwright siguen untracked en main (issue preexistente).
