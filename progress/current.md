# Sesión

**Feature en curso:** F152 — modules_deep_link_routing
**Inicio:** 2026-08-23 · **Estado:** in_progress

## Bug (reproducido en navegador, guest + demo)

Dos síntomas, misma causa (`useModulesScreenState` con selección bespoke en
vez del hook canónico `useRoutableEntitySelection`):

1. **F5/deep-link en `/modules/:id` rebota a `/modules`**: el efecto de mount
   notifica `onSelectionChange(null)` → la shell navega a la lista; y el guard
   de refs (`lastOpenModuleIdRef` inicializado al valor de mount) impide
   sembrar `selectedId` desde la URL.
2. **Cerrar editor in-app desde `/modules/:id/edit` deja la URL pegada en
   `/edit` con el editor cerrado** (F5 ahí lo reabre): `onEditorClose(restoreId)`
   usa `onSelectionChange`, que la shell bloquea en rutas `/edit`
   (`isEntityEditPath`); sólo el flujo F5-directo (restoreId null) salía bien
   por casualidad vía `onRequestEdit(null)`.

Evidencia (dev server :5199, guest):
- goto `/modules/mod-gab-01` + reload → URL `/modules`, lista visible.
- detalle → Editar → Volver → URL `/modules/mod-gab-01/edit`, editor cerrado.

## Plan

- Migrar selección de `useModulesScreenState` a `useRoutableEntitySelection`
  (seed en mount, sync URL→estado sin notificar, drop-stale) — paridad con
  structures/components/customers/catálogos.
- El cierre del editor queda alineado a structures: durante `/edit` la
  selección es null → `onEditorClose(null)` → `onRequestEdit(null)` sale de la
  ruta `/edit`.
- Tests de comportamiento en `ModulesScreen.test.tsx`: deep-link en mount,
  sync URL→selección, cierre de editor sale de /edit.
- Verificar `pnpm test` + `pnpm typecheck` + navegador (los 3 flujos).

## Decisiones

- Paridad con el patrón canónico en vez de conservar el comportamiento bespoke
  (mantener selección durante /edit): es exactamente lo que causa el síntoma 2
  y ninguna otra screen lo hace.
