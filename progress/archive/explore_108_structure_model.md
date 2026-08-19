# Explore #108 — Modelado de Estructuras y Componentes

> Generado por subagente explorer (read-only), volcado por el leader.

## 1. Tipos TS (`packages/domain/src/types.ts`)

- `Structure` — `types.ts:215-228`. Campos: `id, code, name, externalDims?, presets?, components?, notes?, active?`. **Ningún campo de versión.**
- `Component` — `types.ts:259-276`. Campos: `id, code, name, placement, geometry, defaultEdges, perforations?, optionRoles, notes?, active, xFormula?, ... rotateX/Y/Z`. **Sin versión.**
- `ModuleComponentInstance` — `types.ts:278-296`. Referencia por `componentId` suelto + `quantity` + overrides. **No guarda versión del componente referenciado.**
- `Module` — `types.ts:178-200`. Línea 185: `readonly structureId?: string;` — referencia por **ID suelto**.
- `ProjectItem` — `types.ts:300-310`. Solo `moduleId, quantity, optionChoices, measurePresetId?`. **No referencia estructura directamente ni guarda snapshot.**
- `Workspace.schemaVersion` — `types.ts:453`. Versión del SCHEMA del workspace entero, no de estructuras.
- `QuotePriceSnapshot` — `types.ts:515-522` y `Project.priceSnapshot` línea 413. Solo congela **precios**, no estructura/componentes.

## 2. Backend Go

- `Structure` — `types.go:209-222`: `ID, Code, Name, WidthMm, HeightMm, DepthMm, Components, Presets, Notes, Active, CreatedAt, UpdatedAt`. **Sin versión.**
- `Component` — `types.go:264-287`. Sin versión.
- `Module.StructureID` — `types.go:184` (referencia por ID; `""` = módulo plano legacy).
- `ProjectItem` — `types.go:289-296`: sin snapshot ni versionId.
- `Project.PriceSnapshot *QuotePriceSnapshot` — `types.go:318`. Solo precios.
- Búsqueda `version|snapshot|revision` en `types.go` → solo `PriceSnapshot`. **0 campos de versión en estructuras/componentes.**

### Migrations (`backend-go/db/migration/`)

- `000014_structures.up.sql:4-15` — tabla `structures` sin columna de versión.
- `000016_components.up.sql:5-20` — tabla `components` sin versión.
- `000017_structure_components.up.sql:3-10` — puente N:M sin versión.
- `000019_module_structure_composition.up.sql:9` — `modules.structure_id UUID REFERENCES structures(id) ON DELETE SET NULL`. El `ON DELETE SET NULL` es prueba directa de que **no hay snapshot**.

## 3. Cómo se referencia estructura desde proyecto/quote

Cadena: `Project → ProjectItem.moduleId → Module.structureId → Structure.id → Structure.components[].componentId → Component.id`.

Todas las referencias son **por ID suelto / FK viva** (no snapshot, no nombre).

## 4. ¿Qué pasa hoy si se edita una estructura? → MUTACIÓN EN VIVO

- `backend-go/internal/domain/engine/resolve.go:17-44`: el motor re-expande la estructura viva del catálogo en cada resolución.
- La única protección existente es `QuotePriceSnapshot` (solo precios).

**Conclusión para #108:** editar/borrar Structure o Component muta en silencio TODOS los proyectos y cotizaciones (abiertos o cerrados) porque:
(a) no existe campo de versión;
(b) referencias por FK/ID vivos;
(c) engine re-resuelve en cada llamado;
(d) `QuotePriceSnapshot` solo congela precios, no geometría.
