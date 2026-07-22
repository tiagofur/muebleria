# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch activa:** `wip/perfect-app-fase-0-ui` (F064 commiteada y pushed; PR pendiente)
- **META issue:** #156 Perfect App roadmap

## Estado Fase 0 (Perfect App Roadmap §5)

### Sub-slice 0.1 (4 stores Zustand) — ✅ COMPLETO

| ID | Feature | Estado |
|---|---|---|
| F057 | workspaceStore | ✅ merged #157 |
| F062 | catalogStore | ✅ merged #158 |
| F063 | projectStore | ✅ merged #159 |
| F064 | uiStore + ToastProvider | ✅ done (PR pendiente) |

### Resto de Fase 0

| ID | Feature | Estado |
|---|---|---|
| F058 | Partir ProjectsScreen (2793 L) en lista + detalle + exports | ⏳ pending (próximo) |
| F059 | Abstraer EntityEditorLayout<Tab,Draft> común | ⏳ pending |
| F060 | Partir engine.ts (2108 L) por responsabilidad | ⏳ pending |
| F061 | Command pattern + undo/redo | ⏳ pending |

## Próximo slice recomendado

**F058 — Partir ProjectsScreen**: separa la screen más grande (2793 L) en
lista + detalle + exports panel. Lleva App.tsx finalmente < 1000 L. `workspaceRef`
desaparece totalmente.

## Notas

- App.tsx en 1796 L (de 2880 original). F058 reduce más.
- 4 stores Zustand completos: workspaceStore, catalogStore, projectStore, uiStore.
- ToastProvider eliminado de packages/ui; renderer en apps/web.
- Snapshots Playwright ahora tracked en main.
