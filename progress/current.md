# Sesión activa

**Feature:** F117 — catalogs_refactor_split
**Estado:** in_progress
**Inicio:** 2026-08-19

## Plan

1. `catalogStore.ts` (1198 L) → `stores/catalog/` un archivo por dominio (shared, materials, edges, hardware, ambient, optionGroups, entities, customers, media), mismo store zustand y API pública idéntica en `catalogStore.ts` (combinador + singleton).
2. `MaterialsCatalog.tsx` (1420) → `catalogs/materials/`: screen <450 + MaterialFormModal + MaterialExpandedDetail + EdgeQuickCreateModal. Unificar botones duplicados.
3. `AmbientMaterialsCatalog.tsx` (1310) → `catalogs/ambient/`: screen <450 + form + categorías + detail. Remover SURFACE_TYPE_LABEL muerto.
4. `HardwareCatalog.tsx` (769) → `catalogs/hardware/`: screen <400 + HardwareFormModal. Reset de preview3dOpen. Tests de comportamiento reemplazando grep-fuente.
5. Refactor mecánico: cero cambio funcional. Tests verdes antes/después, commits atómicos por paso.

## Resultados de Verificación

(pendiente)
