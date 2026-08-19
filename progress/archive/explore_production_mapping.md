# Mapa de implementación — Producción v2 (2026-08-18)

## Veredicto de alcance

El plan aprobado es coherente con el modelo de la app: las transiciones de piso siguen siendo por ítem y auditadas, mientras que la unidad de trabajo y visualización pasa a ser la obra. No debe mover lógica de agregación a React ni mezclar diseño/ingeniería con ejecución de fábrica.

**Hallazgo importante:** la primera parte de Fase 1 ya está presente en el árbol actual aunque el roadmap la liste como pendiente:

- `ProductionEdgeTotal` ya expone `pieces` y `sides`; `computeProductionTotals()` los suma por fila y cantidad.
- `EdgeBand` ya expone `previewColor?: string` en TypeScript.

Por lo tanto, el primer slice pendiente real de `F095` es el claim **obra × estación**. Antes de tocar el board se debe verificar/parchear también su paridad Go/API/mappers/catalog form, porque los dos tipos TS por sí solos no garantizan persistencia ni swatch real.

## Fuente de producto y límites

- `docs/roadmap-screens/03-fabrica.md` — especificación canónica de Producción v2.
  - Corte: materiales por acabado con m², piezas, planchas y surtido.
  - Encintado: ML, espesor, piezas, lados y swatch.
  - Armado/Embalaje: ítems agrupados por obra.
  - Claim por obra×estación; batch conserva avances individuales auditados.
- `docs/roadmap-screens/00-overview.md` — establece que documentos se generan en Ingeniería y fábrica sólo ejecuta; Embarques/Instalaciones quedan en pantallas separadas.
- `docs/production-module.md` §8 D9/D10 — decisión de claim y board por obra (referenciada por la spec).
- `feature_list.json` — `F095` está `in_progress`; no iniciar otra feature ni alterar su estado desde esta exploración.

## Mapa de dominio

| Símbolo / archivo | Estado actual | Impacto v2 |
|---|---|---|
| `packages/domain/src/productionTotals.ts` — `ProductionEdgeTotal`, `computeProductionTotals` | Ya incluye `ml`, `pieces`, `sides`, espesor y agrupación por canto. `sides` es flags L1/L2/W1/W2 × cantidad. | Fuente directa del bloque Encintado. Añadir tests de regresión si faltan: CodeGraph no encontró cobertura específica del total. |
| `packages/domain/src/types.ts` — `EdgeBand` | Ya incluye `previewColor?: string`, con contrato `#RGB`/`#RRGGBB`. | Fuente del swatch; revisar serialización TS↔API/Go y formulario de Cantos antes de declarar completa esta parte. |
| `packages/domain/src/boardSheetEstimate.ts` — `estimateBoardSheets` | Estimación de planchas ya utilizada en App, export PDF, optimización y total del proyecto; tiene tests. | Reutilizar para cada total material de la obra; no recalcular en UI. |
| `packages/domain/src/productionSectors.ts` — `itemsWaitingForSector`, `floorStatusForSector`, `PIPELINE_SECTORS` | Define el queue por estación y los estados destino. `itemsWaitingForSector(project, sector)` es el filtro correcto. | Agrupar su resultado por obra; botones por ítem/batch delegan al callback existente. |
| `packages/domain/src/purchasing.ts` — `pickingKey` | Key estable `projectId × material`; `ProjectPickingState` se obtiene por repositorio. | Conectar estados existentes al bloque Corte y Encintado, sin storage/backend nuevo. |
| `packages/domain/src/rbac.ts` — `roleCanAdvanceStation` | Autoriza avance por estado destino y sector asignado. | Mantener como gate de avance; claim requiere su gate backend equivalente. |

## Mapa backend y almacenamiento

| Archivo / símbolo | Estado actual | Cambio necesario |
|---|---|---|
| `backend-go/internal/domain/productionActivity.go` — `ProductionActivity`, sectores | Sistema de actividad/claim/finish/daño existe, con sectores alineados a TS. | Hacer `ItemID` nullable/vacío para claim de obra, y definir campos de módulo/estado que pueden quedar vacíos en dicho claim. |
| `backend-go/internal/api/productionActivity.go` — `claimRequest`, `HandleProductionClaim`, `advanceItemOnActivityFinish` | Request requiere `item_id`; claim valida sector, acceso de operador, actividad activa por sector y proyecto/ítem. Finish hoy puede avanzar el ítem asociado. | Aceptar `project_id + sector` sin `item_id`; mantener validación de proyecto, RBAC y anti-duplicado. Finish de claim de obra debe **no** invocar avance de ítem implícito: la UI hace el batch explícito confirmado, como exige la spec. |
| `backend-go/internal/storage/production_activity.go` | INSERT/SELECT/scan usan `item_id`, `module_code`, `module_name`, `status_before` como columnas de actividad. | Migración aditiva `item_id` nullable (y campos relacionados si tienen NOT NULL); ajustar INSERT y scan para `NULL`/vacío. Actualizar todas las queries y pruebas de store. |
| `backend-go/internal/api/routes.go` | `POST /api/production/activity/claim` ya está registrado. | Misma ruta, payload aditivo; no crear endpoint paralelo. |
| `packages/storage/src/apiWorkspaceRepository.ts` — `claimProductionActivity`, `finishProductionActivity`, `getProductionActiveJobs` | Cliente existe pero `claimProductionActivity` tipa `itemId` como obligatorio y no tiene callers. | `itemId?: string`, respuesta admite datos de obra sin módulo/ítem; exponer/query de claims activos para las cards. |
| `packages/storage/src/apiWorkspaceRepository.ts` y `localStorageWorkspaceRepository.ts` — `listPickingStates` | Picking ya persiste y el API mapper ya existe. | Sólo wiring de lectura al contenedor de la pantalla. |

## Mapa UI y wiring

| Archivo / símbolo | Estado actual | Cambio v2 |
|---|---|---|
| `packages/ui/src/production/FabricScreen.tsx` | v1: tabs con lista plana de filas; por cada obra crea una fila por ítem. Tiene toggle Cola/Métricas y roving tabs. | Extraer derivación pura `fabricProjectCards()` y card por obra; conservar tabs, RBAC, toggle y callbacks. Recibir datos preparados (cut rows/totals, sheets, picking, colors, claims) desde shell. |
| `packages/ui/src/production/FabricScreen.test.tsx` | Pruebas existentes del v1. | Reemplazar/expandir por agrupación, contenidos por estación, batch, claims y estados empty. |
| `apps/web/src/App.tsx` — `AppContent` | Renderiza FabricScreen y ya es caller de `computeProductionTotals`/`estimateBoardSheets`; también concentra repositorio, proyectos, clientes, sesión y callbacks. | Preparar DTOs por proyecto, cargar picking/claims y pasar callbacks claim/finish/batch. Evitar formulas en FabricScreen. Puede requerir extraer adaptador/selector para no inflar App. |
| `packages/ui/src/production/EmbarquesScreen.tsx` | Patrón probado `ship-board`: deriva cards por obra, header/card/section/list y delega `onAdvance`. | Referencia de estructura visual/comportamental; reutilizar CSS/patrón, no copiar lógica de carga. |
| `packages/ui/src/production/InstalacionesScreen.tsx` | Igual patrón `ship-board`; actualmente sólo recibe `customerLabelFor` (nombre). | Extra posterior: sustituir/enriquecer prop con contacto/dirección de Customer; se puede hacer aislado tras F095. |
| `packages/ui/src/production/ProductionManagerDashboard.tsx` | Dashboard consume `getProductionDashboard`/`getProductionActiveJobs`; `ActiveJob` aún presupone `itemId` y `moduleCode`. | Ajustar tipos y copy para claims de obra y hacer métricas honestas una vez existan claims; es un slice posterior, no mezclarlo con claim. |

## Dependencias y orden seguro

1. **F095.a — Claim obra×estación (primer slice recomendado).** Backend Go + migración aditiva + API storage client + pruebas Go/TS. Mantener el UI sin cambios; probar create/duplicate/finish y que finish de claim de obra no avance un ítem silenciosamente.
2. **F095.b — Contrato de métricas completado.** Confirmar paridad Go/API/mappers/catalog form de `previewColor`; añadir tests a `computeProductionTotals` de `pieces/sides` y a la serialización. Es pequeño y aislable si se descubre una brecha.
3. **F095.c — FabricScreen board por obra.** Shape/craft primero; después DTO selector en App y presentación UI, usando dominio existente. Implementar batch como N llamadas de avance, no endpoint de salto.
4. **F096 (nuevo o existente) — Dashboard honesto + Instalaciones contacto.** Después de claims para que las métricas sean reales; contacto/dirección puede vivir como feature aislada de UI/wiring.
5. **Cierre — polish + critique.** Sólo tras slices funcionales y tests verdes.

## Riesgos / decisiones que deben quedar explícitas antes de código

- Un claim de obra necesita una regla de unicidad: al menos por `project_id + sector + operador?` para evitar que doble click cree claims duplicados. La spec permite múltiples operarios; por eso no imponer exclusividad global obra×estación sin una decisión adicional. Mostrar lista de claims activos.
- `finishProductionActivity` hoy representa trabajo de ítem. Para claim de obra, no debe usar `advanceItemOnActivityFinish`; el batch debe invocar la transición normal por cada item para conservar `FloorStatusEvent` y scoping.
- Las cantidades actuales son número de `ProjectItem`, no necesariamente unidades físicas: la UI del board debe distinguir "N módulos/ítems" de `item.quantity` y el batch debe avanzar ítems, no multiplicar llamadas por cantidad.
- La spec llama al estado de picking "despachado"; usar los labels/estados de `ProjectPickingState`, no strings visuales inventados.
- No reutilizar el board de Embarques para cortar/encintar a costa de ocultar la densidad de métricas: reutilizar sólo su patrón estructural/CSS cuando encaje.

## Evidencia de CodeGraph

Índice inicializado en `.codegraph/` y actualizado: 799 archivos, 12.273 nodos, 43.860 relaciones. Consultas realizadas para `ProductionEdgeTotal`, `EdgeBand`, `computeProductionTotals`, `estimateBoardSheets`, `FabricScreen`, `ProductionActivity`, claim endpoint, picking y ship-board.
