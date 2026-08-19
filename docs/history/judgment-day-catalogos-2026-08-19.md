# Judgment Day — CATÁLOGOS

**Fecha:** 2026-08-19
**Scope:** Sección completa de catálogos: Materiales, Cantos, Herrajes, Acabados (Ambient), Grupos de opciones, Categorías + stores y persistencia (TS storage, backend-go, seeds). Módulos/Estructuras/Componentes/Agregados solo por encima (tienen su propio ciclo).
**Método:** 3 exploraciones exhaustivas (UI, herrajes 3D, persistencia) + verificación manual de los hallazgos graves contra el código. `./init.sh` verde al momento de la auditoría.
**Features registradas al cierre:** F116 (bugfixes críticos), F117 (refactor de archivos grandes).

---

## 0. Resumen ejecutivo / Veredicto

Los catálogos **funcionan en el happy path local (guest)**, pero tienen **dos familias de problemas serios**:

1. **Pérdida de datos silenciosa en modo API/backend** (F116): el flujo optimista del `catalogStore` + el upsert que traga 409 + tipos Go/SQL incompatibles con los defaults de la UI hacen que varias operaciones muestren "✓ guardado" y **desaparezcan al refrescar**. Es el tipo de bug que destruye la confianza del usuario en la herramienta.

2. **El sistema de herrajes 3D está a medio contar** (F116/F117): las 7 geometrías paramétricas default funcionan y las capas por componente (F080) **sí funcionan end-to-end** — pero el tracker las marca CONGELADO (documentación mentirosa), el formulario **no permite editar dimensiones** (todo herraje creado por UI queda en geometría default hardcodeada), **no existe importación de diseños** (ni tipos ni loader ni UI), el gizmo de placement (F070) es código muerto nunca montado, y el seed del backend **no carga preview_shape** → los herrajes demo son invisibles en 3D cuando se usa backend-go.

Además: validación de unicidad solo en pantallas (no en store ni API pre-check), integridad referencial sin advertencias al desactivar, y archivos UI muy por encima del presupuesto (~400–600 L) que motivan F117.

**Recomendación de prioridad:** F116 antes que F117 — no vale refactorizar sobre código que pierde datos. F080/F069/F070: actualizar trackers para reflejar realidad y decidir si se completan (inputs de dimensiones + montar gizmo) o se degradan honestamente.

---

## 1. Mapa de la sección CATÁLOGOS

| Pantalla | Archivo | Líneas | Estado |
|---|---|---|---|
| Materiales | `packages/ui/src/catalogs/MaterialsCatalog.tsx` | 1420 | Funcional, monolito (form inline ~530 L) |
| Cantos | `packages/ui/src/catalogs/EdgesCatalog.tsx` | 475 | Funcional, dentro de presupuesto |
| Herrajes | `packages/ui/src/catalogs/HardwareCatalog.tsx` | 769 | Funcional con gaps (ver §2) |
| Acabados (Ambient) | `packages/ui/src/catalogs/AmbientMaterialsCatalog.tsx` | 1310 | Funcional, monolito, sin deep-link |
| Grupos de opciones | `packages/ui/src/optionGroups/OptionGroupsScreen.tsx` | 598 | Funcional |
| Store | `apps/web/src/stores/catalogStore.ts` | 1198 | 30+ acciones, validación insuficiente |
| 3D herrajes | `packages/ui/src/preview3d/HardwareMesh.tsx` | 519 | 7 formas + fallbacks |
| Placement | `packages/domain/src/hardwarePlacement.ts` | ~300 | Resolver sólido y testeado |

Nota: "Acabados" del sidebar (`AppShell.tsx:292`) **es** `AmbientMaterialsCatalog` — materiales visuales de ambiente que NUNCA entran al BOM (F086). No confundir con acabados de herrajes (`hardwareFinishes.ts`, presets en código).

---

## 2. Las tres dudas de Herrajes — veredicto

### 2.1 "Geometrías default aparecen" → ✅ Sí, y es lo ÚNICO que aparece si creás por UI

- `Hardware.previewShape` soporta 7 formas: `knob`, `bar-pull`, `cup-pull`, `hinge`, `slide`, `rail`, `leg` (`packages/domain/src/types.ts:145`). Las 7 se renderizan en `HardwareMesh.tsx:501-515` con fallbacks hardcodeados (`HardwareMesh.tsx:86-101`): jaladera 96 mm, corredera 500 mm, pata 120 mm, bisaga copa 35 mm, etc.
- Shape desconocida/vacía → **no renderiza nada** (guard en `resolveHardwareGeometry` y `resolveHardwarePlacement`; VH-09). No inventa geometría.
- **GAP real**: el formulario de herrajes **no tiene inputs** para `previewSizeMm`, `previewDiameterMm`, `previewProjectionMm`. Los campos existen en el draft (`HardwareCatalog.tsx:58-60`), persisten (`catalogStore.ts:246-250`) y el seed los usa (`plantillaDemo.ts:167-232`: bisagra 35 mm, jaladera 128×12…) — pero **solo seed/import puede setearlos**. Un herraje creado desde la UI siempre renderiza con la geometría default, sin forma de ajustarla. Tampoco hay inputs para roughness/metalness/clearcoat crudos (solo presets).

### 2.2 "No sé si diseños importados funcionan" → ❌ No existen. Ni a medias: no hay nada

- **No hay ningún loader** de geometría en todo el repo (grep: cero `GLTFLoader`/`OBJLoader`/`STLLoader`/`useLoader`). GLTF/OBJ/STL existen **solo como exportadores** (`ModelExporter.tsx`, botones en `ProjectPresentationMode.tsx:855`).
- El tipo `Hardware` **no tiene campo** para modelo/mesh/geometría importada (`modelUrl` no existe). El renderer está cableado a las 7 formas paramétricas.
- Los únicos "imports" del repo son DXF de muros de cocina (`planImport.ts`) y CSV de nesting — ajenos a herrajes.
- Si "diseños importados" era una expectativa de producto, **hoy es cero**: ni tipos, ni UI, ni loader. Hay que decidir si entra al roadmap o se declara fuera de scope.

### 2.3 "No sé si los materiales por capas funcionan" → ✅ Sí funcionan — pero el tracker miente

- **F080 (capas de acabado por componente) está IMPLEMENTADO y operativo end-to-end**, aunque `feature_list.json` lo marca `pending [CONGELADO]` y `docs/roadmap-comercial-v2.md:40,136` dice congelado. Commit `951631f` (2026-08-15) lo implementó. **El tracker y el roadmap están desactualizados, no el código.**
- Flujo completo: `partFinishes: Partial<Record<'body'|'base'|'grip', HardwareFinishId>>` en `Hardware` (`types.ts:176-178`) → selects por parte en el catálogo (`HardwareCatalog.tsx:721-761`, aparecen según `hardwarePartRolesForShape`: bar-pull→grip+base, knob/hinge/slide/leg→body+base…) → persistencia TS (`apiMappers.ts:293-331`) y Go (migración `000046`, `materials.go`) → render por sub-mesh en `HardwareMesh` (`mats.body/base/grip`).
- Limitaciones reales: solo los **5 presets fijos** (`HARDWARE_FINISHES`: cromo, negro mate, bronce, cepillado, oro — `hardwareFinishes.ts:30-71`), sin color custom por parte; `grip` solo tiene efecto visual en `bar-pull` (las demás formas no leen `mats.grip`); sin backfill necesario (NULL = acabado global, correcto).

### 2.4 Extras encontrados en herrajes (no preguntados, pero graves)

- **`HardwarePlacementGizmo.tsx` (F070) es código muerto**: exportado pero montado en ninguna parte. `HardwareMesh.onSelect/onChangePlacement` no los pasa ningún caller. Los inputs de placement del `PartInspector.tsx:266-316` existen pero su único call site no los cablea → **inalcanzables en la app**. El único camino vivo para autorizar placements es `HardwarePlacementsEditor.tsx` (editor de módulo/agregado).
- **Seed divergente TS vs Go**: el seed TS carga `previewShape` para bisagra/jaladera/pata/corredera demo (`plantillaDemo.ts:167-232`); el seed Go inserta los mismos códigos **sin `preview_shape`** (`backend-go/internal/storage/seed.go:129-151` y `:477-502`) → con backend-go, los herrajes demo no se ven en 3D (cost-only).
- **F069 aceptación ≠ implementación**: prometía tabla `hardware_finishes` + `HardwareFinish[]` en la entidad + selector en el inspector 3D. Realidad: presets en código, escalares PBR en la entidad, selector en el catálogo. El "Acabado" del inspector es placeholder literal (`PartInspector.tsx:236-241, 323-336`).
- `preview3dOpen` nunca se resetea al cerrar/reabrir el modal (`HardwareCatalog.tsx:165-220`) — el disclosure queda abierto entre ediciones.
- Tests de `HardwareCatalog` son **grep del código fuente** (`readFileSync` + `toContain`) — no testean comportamiento y se romperán con el refactor.

---

## 3. Bugs por severidad (verificados)

### CRÍTICOS — pérdida de datos silenciosa

| # | Bug | Dónde | Mecánica |
|---|---|---|---|
| C1 | **PBR de materiales nunca persiste** | `catalogStore.ts:344-393` (`createMaterial`), `:395-464` (`updateMaterial`); form los edita en `MaterialsCatalog.tsx:444-466` + presets `:1194-1253` | El draft trae `previewRoughness/Metalness/Clearcoat`, el objeto `MaterialBoard` construido en el store **nunca los copia** (update los conserva por `...m`). Editar PBR de un material en la UI no tiene efecto. |
| C2 | **409 tragado = "✓ creado" y desaparece** | `apiWorkspaceRepository.ts:399-413` (`isConflict` → tratar POST 409 como éxito) + validación de unicidad solo-activos en pantallas | Camino real: desactivás un material, creás otro con el mismo código (la UI lo permite porque valida solo entre activos) → SQL `UNIQUE(code)` rechaza → 409 → upsert lo trata como éxito → toast "✓ creado" → al refrescar no existe. También renombrar edge/hardware a código duplicado (PUT 409 ignorado silenciosamente). |
| C3 | **Cantos de 0.5 mm rompen contra el backend** | TS default `0.5` (`EdgesCatalog.tsx:41`) y seed `0.5`/`0` (`plantillaDemo.ts:146,162`) vs Go `ThicknessMm int` (`types.go:136`) + SQL `CHECK (thickness_mm > 0)` (`000001:53`) | En modo API: crear canto con default 0.5 → Go no decodifica float a int → error opaco; 0 viola el CHECK. El canto existe solo en memoria y se pierde al refrescar. Go seed usa 1 (divergencia silenciosa de valores). |
| C4 | **`deleteAgregado` no llama al backend** | `catalogStore.ts:1026-1032` | Sin `hardDeleteOnAuth` (todos los demás deletes lo tienen) y `saveCatalog` es upsert-only → en modo auth el agregado **reaparece al refrescar**. Agravado: el endpoint Go `DELETE /catalog/agregados/{id}` solo desactiva y el list los devuelve igual. |
| C5 | **`previewColor` inválido sobrevive al "normalize"** | `catalogStore.ts:366+378` (y `:436+441`) | Doble asignación: primero `previewColor: draft.previewColor?.trim()`, luego spread condicional con el valor normalizado. Si `normalizePreviewColor` rechaza (retorna undefined), el spread es `{}` y **queda el string crudo inválido** en el catálogo. |
| C6 | **Guest localStorage sin migraciones** | `localStorageWorkspaceRepository.ts:45-58` vs `jsonFileStorage.ts:126-136` | `migrateWorkspace` (schemaVersion 1→2→3) solo corre en JSON file storage. Un workspace guest viejo conserva grain stale por pieza y structures sin revision (#108 pinning roto). |
| C7 | **Patch optimista sin rollback + éxito cantado antes de guardar** | `catalogStore.ts:273-294` (`patch`), toasts inmediatos en `createEdge` (`:497`), `createHardware` (`:557`), `updateEdge` (`:520`), `createModule` (`:889`), option groups/categories/structures/components | Si el save falla, la UI muestra el cambio + toast de éxito hasta el refrescar. Inconsistente: `createMaterial`/ambient sí esperan el save. |

### ALTOS — funciones que no cumplen lo declarado

| # | Bug | Dónde |
|---|---|---|
| A1 | Material PUT sin mapeo duplicate-key → 500 en vez de 409 (edges `handlers.go:806` y hardware `:910` sí lo mapean) | `backend-go/internal/api/handlers.go:449-456` |
| A2 | Delete de módulo: FK `project_items.module_id` sin ON DELETE (RESTRICT) → 500 después de que el FE ya lo borró localmente | `backend-go/internal/storage/projects.go:1439-1447`, `catalogStore.ts:900-910` |
| A3 | `ensurePlinthCatalog` pisa ediciones del usuario de HER-ZOC-* con `ON CONFLICT DO UPDATE`; upsert de edges **reescribe la PK** (`SET id = EXCLUDED.id`) y puede romper `default_edge_band_id` | `backend-go/internal/storage/seed.go:101, :486-497` |
| A4 | Seed Go sin `preview_shape` en herrajes demo ni `previewColor` en materiales → 3D demo empobrecido en modo backend | `seed.go:121-151` |
| A5 | Validación de unicidad solo en pantallas; el store confía en drafts; guest acepta duplicados silenciosos. Regla inconsistente: materiales/edges/hardware/ambient validan entre **activos**, option groups entre **todos** | `catalogStore.ts` (sin checks), `optionGroupHelpers.ts:125-151` |
| A6 | Desactivar material/canto/herraje referenciado por módulos: sin warning ni bloqueo; `defaultEdgeBandId` colgante se muestra como id crudo (`MaterialsCatalog.tsx:673-676`); `optionIds` stale muestran id crudo (`OptionGroupsScreen.tsx:387,589`). (Al menos `resolveBom` falla con error tipado, no NaN — `bom.ts:104-268`) | toda la sección |
| A7 | AmbientMaterialsCatalog sin deep-link aunque `finishes` está en `ENTITY_SECTIONS` (`routes.ts:126`): usa `setExpandedId` local, App no le pasa `openEntityId` | `App.tsx:3690-3794`, `AmbientMaterialsCatalog.tsx:292` |
| A8 | `surfaceType` feature a medias: en draft/persistencia/dominio (resolver de escenas lo usa, `types.ts:751-766`) pero **sin input** en el form; `SURFACE_TYPE_LABEL` definido y nunca usado; Go no valida el valor y FE coalesce unknown→`floor` | `AmbientMaterialsCatalog.tsx:68,99,111-115`, `apiMappers.ts:183-189` |
| A9 | Trackers mentirosos: F080 shipped pero marked CONGELADO/pending; F069 aceptación no coincide con implementación; F070 gizmo nunca montado | `feature_list.json`, `docs/roadmap-comercial-v2.md` |

### MEDIOS

- `packageSize` <= 0 / no finito se descarta en silencio en el store (`catalogStore.ts:542-544, 562-564`); sin validación en el form.
- Validación JS permite width/length = 0 mientras el input HTML tiene `min={1}` (`MaterialsCatalog.tsx:406-426` vs `:913,927`).
- Botones de acción duplicados en MaterialsCatalog (expanded detail `:709-737` + hover row `:740-773`).
- Ciclo de vida inconsistente: materiales/edges/hardware/ambient sin delete ni duplicate ni import/export (solo deactivate); option groups hard-delete sin deactivate; components sin delete.
- Cada mutación re-PUTea **todo el catálogo** (`saveCatalog`, `apiWorkspaceRepository.ts:423-534`): O(N) por edición, last-write-wins entre sesiones, y un save guest in-flight al hacer login puede empujar el catálogo seed local encima del server.
- Guest: `saveWorkspace` traga errores incl. quota excedida (`localStorageWorkspaceRepository.ts:60-67`).
- Agregado JSONB scan `_ = json.Unmarshal` traga errores (`storage/agregados.go:156-163`).
- Sin FK en `option_group_members.entity_id` ni `project_item_choices.choice_entity_id` (solo SQL directo puede colgar ids; resolución falla loud).
- Seed solo se aplica con workspace vacío (nunca refresca — razonable, pero implica que seeds mejoradas no llegan a usuarios existentes).
- Go seed no corre al boot (solo CLI admin / `POST /api/seed`).

---

## 4. Auditoría por pantalla (síntesis funcional)

### MaterialsCatalog (1420 L) — OK funcional, bugs C1/C5, monolito
CRUD completo (create/update/deactivate/reactivate) + alta rápida de cintilla vinculada por id (F027) + upload de imagen con extracción de color dominante + sugerencia de tile de textura + presets PBR (que no persisten — C1) + costos ocultos por rol (F039) + RBAC mutate (admin/ingeniero). `costPerM2` computado por fórmula de dominio inyectada (issue #14, correcto). Validaciones: código único entre activos, no-negativos, hex. **Falta**: re-validar `defaultEdgeBandId` al guardar, warning de referencias al desactivar, deduplicar botones.

### EdgesCatalog (475 L) — OK funcional, bug C3
CRUD + previewColor para 3D. Sin imagen, sin duplicate. **Falta**: thickness fraccional (0.4/0.8 mm son estándar de la industria — hoy el modelo TS lo soporta, Go/SQL no).

### HardwareCatalog (769 L) — gaps §2
CRUD + shape select + preset de acabado + per-part finishes (F080) + upload. **Falta**: inputs de dimensiones, validación previewColor, reset `preview3dOpen`, tests de comportamiento.

### AmbientMaterialsCatalog (1310 L) — OK funcional, A7/A8
CRUD materiales ambiente + categorías 3 niveles (árbol con conteos, bloqueo de 4º nivel, delete con confirm que limpia FKs). Nada de esto entra al BOM (correcto por diseño F086). **Falta**: deep-link, input surfaceType, limpiar muertos.

### OptionGroupsScreen (598 L) — OK funcional
CRUD + hard delete con **warning** de uso (cuenta roles vía `collectModuleOptionRoles`, que ya resuelve como el BOM — bien). Kind switch pueue members correctamente. **Falta**: guard real (hoy solo advierte), prune de optionIds al desactivar miembros.

### catalogStore (1198 L) — corazón del problema
30+ acciones; la matemática (costPerM2, clamp PBR) y la limpieza de FKs viven acá (bien), pero **ninguna validación de entrada** (código/nombre/unicidad) — todo depende de que la pantalla la haga. Persistencia optimista sin rollback (C7). Ver tabla completa de acciones en la sesión de auditoría.

### RBAC — correcto
`roleCanMutateCatalog` = admin|ingeniero (`rbac.ts:62-64`); guest bypass para mutar; nav de lectura para ventas; costos gateados por `roleCanViewCosts` (COST-01/02). Sin hallazgos.

---

## 5. Plan de refactor (F117) — dividir para leer menos

Presupuesto `docs/conventions.md`: screens ~400–600 L. Targets:

| Archivo | Hoy | Propuesta |
|---|---|---|
| `MaterialsCatalog.tsx` | 1420 | → `catalogs/materials/` : `MaterialsCatalog.tsx` (<450, lista+filtros) + `MaterialFormModal.tsx` (form ~530 L) + `MaterialExpandedDetail.tsx` + `EdgeQuickCreateModal.tsx` + `MaterialPreviewFields.tsx` (color/textura/PBR) |
| `AmbientMaterialsCatalog.tsx` | 1310 | → `catalogs/ambient/` : screen (<450) + `AmbientMaterialFormModal.tsx` + `AmbientCategoryTree.tsx` + `AmbientCategoryModals.tsx` + `AmbientExpandedDetail.tsx` |
| `HardwareCatalog.tsx` | 769 | → `catalogs/hardware/` : screen (<400) + `HardwareFormModal.tsx` (+ inputs de dimensiones si F116 los agrega) + `HardwarePreview3DFields.tsx` |
| `catalogStore.ts` | 1198 | → `apps/web/src/stores/catalog/` : un archivo por dominio (`materials.ts`, `edges.ts`, `hardware.ts`, `ambient.ts`, `optionGroups.ts`, `entities.ts` — modules/structures/components/agregados, `customers.ts`) combinados en un único store zustand (sin cambiar la API pública de `useCatalogStore`, cero cambios en consumers) |
| `HardwareCatalog.test.tsx` | grep | → behavior tests (render + flow), no `toContain` del fuente |

`EdgesCatalog` (475) y `OptionGroupsScreen` (598) quedan como están. Regla: refactor **sin cambio de comportamiento** — los bugfixes van primero/separado (F116), tests verdes antes y después.

Fuera de scope de este JD pero registrado: `App.tsx` volvió a **4101 L** (F064 prometía <600) — la deuda se regeneró; merece su propio judgment day de shells/wiring.

---

## 6. Registro

- **F116** `catalogs_critical_bugfixes` — C1..C7 + A1..A4 (pérdida de datos + paridad seed). Prioridad alta.
- **F117** `catalogs_refactor_split` — split mecánico + behavior tests. Después de F116.
- Actualizar `feature_list.json` F080 → done (ya shipped), nota en F069/F070 sobre divergencia con lo implementado.
- Próximos judgment days sugeridos: Cotizaciones/Proyectos, Producción, Proyectar 3D.
