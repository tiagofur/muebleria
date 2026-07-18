# Explore #108 — Flujo de edición y selección de estructuras

> Generado por subagente explorer (read-only), volcado por el leader.

## 1. Pantalla de EDICIÓN de estructuras

- Principal: `packages/ui/src/structures/StructuresScreen.tsx:58` (listado + modal editor "lg").
- Modal editor: `StructuresScreen.tsx:260` abre `<Modal size="lg">` con `StructureEditorForm`. Draft desde `structureToDraft(item)` (`:187`).
- Pestañas: `packages/ui/src/structures/structureDraft.ts:10` — `general | presets | components`.
- Submit `StructuresScreen.tsx:194` valida y llama `onUpdate(editingId, draft)` o `onCreate(draft)` y cierra el modal (`:229`). **Sin confirmación intermedia.**
- Confirmación SÓLO existe para borrado (`StructuresScreen.tsx:318`).
- Wiring apps/web: `App.tsx:2583` monta `<StructuresScreen>` con `onCreate={createStructure}`, `onUpdate={updateStructure}` (`:2587-2588`).

**¿Guarda directo al repo? SÍ, sin confirmación.**
- `updateStructure` (`App.tsx:1447`) → `patchCatalog(...)` reemplaza in-place + toast `'✓ Cambios guardados'`.
- `patchCatalog` (`App.tsx:825-842`) → `setWorkspace(next)` y `repository.saveCatalog(nextCatalog)` fire-and-forget. Sin diálogo guardar/cancelar.

## 2. Selección de estructura desde mueble/quote

- `packages/ui/src/modules/components/ModuleEditorStructurePanel.tsx:17` — pestaña "Estructura (cuerpo)" del editor de módulos.
- Picker `<select>` simple (`:40-69`) con `<option value={s.id}>`. Lista `structures.filter((s) => s.active !== false)`.
- Cita (`:34-37`): *"El cuerpo se arma en Ingeniería → Estructuras (solo componentes). Acá elegís cuál usa este mueble y la medida base."*
- Al elegir, setea `structureId: sid` (`:46-57`) y copia `externalDims` a la medida base. **No copia componentes al módulo** — queda por referencia.
- `selectedStructure` se lee en vivo: `structures.find((s) => s.id === draft.structureId)` (`ModulesScreen.tsx:222`).

## 3. Cómo se persiste la referencia (ID suelto vs snapshot)

**ID suelto. No existe snapshot de estructura en ningún nivel.**

- TS: `Module.structureId` (`types.ts:185`); `engine.ts:910-923` (`resolveBom`) resuelve con `catalog.structures?.find(...)` y lanza `ResolutionError('Structure not found')` si falta.
- Storage TS: `apiMappers.ts:258` mapea `structure_id: m.structureId ?? ''`; `:274-287` lee de vuelta como `structureId`. Solo ID.
- Backend Go: `backend-go/internal/storage/structures.go:255` (`UpdateStructure`) hace UPDATE de `structures` y **DELETE + re-INSERT** de `structure_components` y `structure_presets` (`:285-322`). Reemplazo destructivo in-place.
- `QuotePriceSnapshot` (`types.ts:515`) captura solo `breakdown + *CostPer...`. `captureQuoteSnapshot` (`engine.ts:1288-1300`) congela **precios**, no estructura.

## 4. Flujos duplicar / clonar / snapshot

- **No existe "duplicar estructura".** Botón "Duplicar" en Projects y Módulos, NO en StructuresScreen.
- `duplicateModule` (`packages/domain/src/duplicate.ts:85`) preserva `structureId: module.structureId` (`:95`) — reusa MISMA estructura, no clona.
- `duplicateProject` (`duplicate.ts:131`) copia items con mismo `moduleId`, **sin priceSnapshot** (`:130`).
- Snapshot de precios solo al cerrar cotización: `transitionProjectStatus` (`engine.ts:1308`) adjunta `priceSnapshot` al pasar a `quoted/accepted/produced`, lo elimina al reabrir a draft (`:1325-1331`).

## 5. Puntos donde hoy se ROMPE la cotización cerrada si la estructura muta

1. **Estructura eliminada/de baja:** `resolveBom` (`engine.ts:910-916`) lanza `ResolutionError('Structure not found')` aunque el proyecto estuviera cerrado. Snapshot no respalda estructura.
2. **Estructura editada (cambian componentes/cantidades):** `UpdateStructure` (`structures.go:285-322`) DELETE+INSERT de `structure_components`. Al reabrir/exportar, BOM se recompone desde estructura viva (`engine.ts:907-923`) → cotización cambia composición aunque `priceSnapshot.breakdown` siga congelado. **Inconsistencia precios/BOM.**
3. **Presets de medida eliminados:** `structure_presets` se borra y recrea en cada update (`structures.go:285`). Si `ProjectItem.measurePresetId` apuntaba a uno borrado, `resolveModuleMeasurePreset` falla.
4. **`defaultOptionChoicesForModule`** (`moduleHelpers.ts:333`) y preview 3D (`module3dPreview.ts:73`, `project3dPreview.ts:75`) leen componentes en vivo. Editar estructura altera opciones default y render de cotizaciones existentes.
5. **`duplicateModule` reusa mismo `structureId`** (`duplicate.ts:95`): mutación posterior afecta a todos los duplicados. Sin aislamiento por versión.
6. **`patchCatalog` (App.tsx:825) guarda sin confirmación ni noción de referenciadores:** muta catálogo compartido impactando todo proyecto que la referencie.

## Archivos clave (absolutos)

- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/structures/StructuresScreen.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/structures/structureDraft.ts`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/structures/components/StructureEditorForm.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/packages/ui/src/modules/components/ModuleEditorStructurePanel.tsx`
- `/Users/tiagofur/dev/carpinteria/muebles/apps/web/src/App.tsx` (líneas 825, 1438-1455, 2583-2588)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/storage/src/apiMappers.ts` (líneas 258, 274-287)
- `/Users/tiagofur/dev/carpinteria/muebles/backend-go/internal/storage/structures.go` (UpdateStructure:255-326)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/engine.ts` (resolveBom:899-923, captureQuoteSnapshot:1288, transitionProjectStatus:1308)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/types.ts` (QuotePriceSnapshot:515)
- `/Users/tiagofur/dev/carpinteria/muebles/packages/domain/src/duplicate.ts` (duplicateModule:85)
