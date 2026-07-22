# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-project` (F063 commiteada y pushed; PR pendiente)
- **META issue:** #156 Perfect App roadmap

## Estado Fase 0 (Perfect App Roadmap §5)

| ID | Feature | Estado |
|---|---|---|
| F057 | workspaceStore Zustand | ✅ done (sub-slice 1/4) — merged #157 |
| F062 | catalogStore | ✅ done (sub-slice 2/4) — merged #158 |
| F063 | projectStore (proyectos + items + templates + breakdown) | ✅ done (sub-slice 3/4) |
| F064 | uiStore + ToastProvider migration | ⏳ pending (próximo) |
| F058 | Partir ProjectsScreen (2793 L) en lista + detalle + exports | ⏳ pending |
| F059 | Abstraer EntityEditorLayout<Tab,Draft> común | ⏳ pending |
| F060 | Partir engine.ts (2108 L) por responsabilidad | ⏳ pending |
| F061 | Command pattern + undo/redo | ⏳ pending |

## Próximo slice recomendado

**F064 uiStore**: mueve toasts (migración de ToastProvider), exportBusy/errors,
createKeys, command palette. Después de F064, App.tsx debería quedar < 1000 L
y `workspaceRef` desaparece totalmente.

## Notas

- App.tsx en 1788 L (de 2880 original). Faltan ~800 L por migrar (F064).
- `workspaceRef` sigue existiendo (lo usa setWorkspace wrapper + 'Usar datos
  demo' + saveWorkshopSettings). Se elimina en F064.
- catalogStore + projectStore ya migrados; workspaceStore mantiene `workspace`
  pero solo para settings/schemaVersion (#13 recover).
