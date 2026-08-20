# Sesión activa

**Feature:** F117 — catalogs_refactor_split
**Estado:** Done
**Fecha:** 2026-08-19

## Objetivo

Partir los archivos grandes de catálogos en archivos menores (clean code + menor contexto de lectura para agentes), sin cambio funcional.

## Qué se hizo (4 commits atómicos)

### 1. `catalogStore.ts` 1198 → 122 L (commit 2a9cbd8)
`stores/catalog/`: `shared.ts` (tipos + infra patch/saveAndToast/patchSaved/hardDeleteOnAuth), `materialPreview.ts`, `materials.ts`, `edges.ts`, `hardware.ts`, `ambient.ts`, `optionGroups.ts`, `entities.ts` (categorías+módulos+estructuras+componentes+agregados), `customers.ts`, `media.ts`. `catalogStore.ts` queda como combinador + singleton con **API pública idéntica** (cero cambios en consumers).

### 2. `MaterialsCatalog.tsx` 1420 → 5 archivos (commit a407cee)
`catalogs/materials/`: screen (558) + `MaterialFormModal` (600) + `EdgeQuickCreateModal` (177) + `MaterialExpandedDetail` (101) + `materialDraft.ts` (131). **Botones de acción duplicados unificados** (solo row hover).

### 3. `AmbientMaterialsCatalog.tsx` 1310 → 5 archivos
`catalogs/ambient/`: screen (547) + `AmbientMaterialFormModal` (375) + `AmbientCategoryModals` (280) + `AmbientCategoryTree` (150) + `ambientMaterialDraft.ts` (59). **Removido `SURFACE_TYPE_LABEL` muerto**.

### 4. `HardwareCatalog.tsx` 769 → 3 archivos
`catalogs/hardware/`: screen (367) + `HardwareFormModal` (374) + `hardwareDraft.ts` (91). **`preview3dOpen` ahora se resetea por sesión** (se abre solo si el ítem editado tiene forma). **Tests grep-fuente reemplazados por behavior tests** (render + flujos: create, duplicate-code error, disclosure auto-open, preset binding, per-part finishes F080).

## Resultados de Verificación

- `pnpm test`: domain 659 · storage 124 · excel 72 · **ui 1124** · web 275 · mobile 36 · desktop 17 — todos verdes.
- `pnpm typecheck`: 7/7 workspaces sin errores.
- `./init.sh`: **100% verde**.
- Tests de fuente actualizados a las nuevas rutas (App.test, designSystemShell, catalogListPrimitives, pageChromeRollout).

## Notas

- Todos los barrels (`catalogs/index.ts`, `packages/ui/src/index.ts`) mantienen los mismos exports — consumers sin cambios.
- Deuda conocida fuera de scope: `App.tsx` 4101 L (merece su propio judgment day de shells).
