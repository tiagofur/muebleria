# Sesión actual — F059 EntityEditorLayout (último slice de Fase 0)

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `wip/perfect-app-fase-0-editor-layout` (basada en `main`, sin cambios)
- **META issue:** #156 Perfect App roadmap
- **Feature:** F059 — phase0_entity_editor_layout (última feature de Fase 0)

## Contexto

F059 abstrae el patrón común de edición de ModulesScreen (1273 L), StructuresScreen (780 L) y ComponentsScreen (569 L) en un componente `EntityEditorLayout<Tab, Draft>` genérico.

Los 3 comparten: state (modalOpen, editingId, initialDraft, confirmDiscard, editorTab, error, search, status), hooks (useDraftSession, useRoutableEntitySelection), y flujo (lista → detalle → editor con tabs).

El agente de extracción timed out (timeout 10min). Working tree limpio — sin cambios.

## Plan para próxima sesión

1. Leer los 3 screens para mapear el patrón exacto (state + handlers + JSX structure).
2. Crear `packages/ui/src/common/EntityEditorLayout.tsx` genérico.
3. Aplicar al screen más simple primero (ComponentsScreen 569 L), verificar tests.
4. Aplicar a StructuresScreen, verificar.
5. Aplicar a ModulesScreen (el más complejo), verificar.
6. Objetivos: Modules < 600, Structures < 500, Components < 400.

## Estado Fase 0 — solo F059 pendiente

| ID | Feature | Estado |
|---|---|---|
| F057-F064 | 4 stores Zustand | ✅ merged |
| F058 (a+b+c) | Partir ProjectsScreen | ✅ merged |
| F060 | Partir engine.ts | ✅ merged |
| F061 | Command pattern + undo/redo | ✅ merged |
| **F059** | **EntityEditorLayout común** | **⏳ pendiente (este)** |

## Después de F059 → Fase 1: Board-first editor

Fase 0 cierra con F059. Fase 1 es el corazón del roadmap Perfect App:
canvas con tablas manipulables, panel props contextual, snapping, costo en vivo.
