# Judgment Day — Funcionalidad de Agregados (Sub-ensambles)

**Fecha:** 2026-08-11
**Scope:** Funcionalidad de *Agregados* (sub-ensambles insertables en muebles/estructuras).
**Referencias:**
- Plan original: `docs/agregados-subassemblies-plan.md` (2026-08-10)
- JD previo (3D/espacial, sin agregados en scope): `docs/judgment-day-wip-3d-2026-07-17.md`
- Commits recientes sobre el tema: `5bf9bc2`, `c64d1c4` (ambos de hoy 2026-08-11).

---

## 0. Resumen ejecutivo / Veredicto

La funcionalidad de **Agregados está sustancialmente construida y opera en el happy path**: el modelo de dominio es correcto, el agregado aporta piezas + herrajes al BOM, al despiece, al listado de herrajes y al costo de la cotización a través del mismo pipeline que estructuras y módulos (`resolveComposedModule` → `resolveBom`). La inserción por fórmula, con apilamiento N-unidades y espejado, funciona y está testeada.

**Pero hay tres bloques de problemas**, ordenados por impacto en el uso real que reporta el usuario:

1. **La "puerta de prueba" no se ve en el 3D del mueble.** Los dos bugs que la invisibilizaban se corrigieron **hoy** (`5bf9bc2` rotación 0 pisaba pose canónica; `c64d1c4` depth del sub-espacio caía a 18mm). Queda **un gap residual confirmado**: `structure3dPreview.ts:105` no pasa `agregados` a `defaultOptionChoicesForModule` → la puerta puede renderizarse con material fallback equivocado. Ver §2 y H-1.

2. **No existe vista 3D del agregado aislado.** Confirmado: ningún componente renderiza un agregado por sí solo. Es la **Fase 3** del plan maestro, aún sin implementar. El usuario arma el agregado "a ciegas" en el catálogo. Ver §4 y H-2.

3. **El agregado es invisible como concepto en cotización/despiece/exports.** Sus piezas y herrajes están y suman, pero **sin etiquetado de agrupación** (`[Cajón 1] Frente`, etc.) que el plan maestro (Fase 4) exigía. Tampoco hay rotación a nivel de instancia, ni UI para `optionOverrides`, ni mano de obra propia del agregado. Ver §5 y H-3..H-6.

Además hay **bugs de robustez en los bordes del ciclo de vida** (duplicar pierde agregados, el freeze de cotización ignora agregados, validación no los cubre, ids inválidos se silencian) — §6.

**Recomendación:** priorizar (a) cerrar el gap residual de la puerta en estructura (`H-1`, trivial), (b) construir la **vista 3D aislada del agregado** (`H-2`, bloqueador de usabilidad), y (c) decidir de producto si se incorpora **etiquetado de agrupación** (`H-3`) antes de confiar agregados en producción.

---

## 1. Qué es un Agregado (recordatorio del modelo)

Un `Agregado` (`packages/domain/src/types.ts:489-505`) es un **sub-ensamble reutilizable del catálogo**: definición con `externalDims?` de referencia, `components?: ModuleComponentInstance[]` y `hardwareLines?: HardwareLine[]`.

Una **inserción** es `ModuleAgregadoInstance` (`types.ts:511-536`): `agregadoId` + `quantity` + `position?` (x/yFormula) + `dimensions?` (width/height/depthFormula) + `layoutDirection?` (vertical|horizontal|none) + `gapMm?` + `mirrored?` + `optionOverrides?`.

Contenedores:
- `Catalog.agregados: readonly Agregado[]` (`types.ts:956`)
- `Structure.agregados: readonly ModuleAgregadoInstance[]` (`types.ts:353`)
- `Module.agregados: readonly ModuleAgregadoInstance[]` (`types.ts:299`)

En el BOM se concatenan ambos orígenes (`bom.ts:573-576`).

---

## 2. Queja del usuario #1 — "No veo la puerta-agregado en el 3D del mueble"

**Diagnóstico: era un bug real, con causas compuestas, casi todo corregido hoy.**

### 2.1 Causas ya corregidas (commits de hoy)

| Commit | Archivo:línea | Qué rompía | Fix |
|---|---|---|---|
| `5bf9bc2` | `bom.ts` (rotación) | Un componente de catálogo con `rotateX=0` (default de DB) pisaba la pose canónica del placement → puerta acostada (0°) en el piso en vez de parada (90°). | `0` se respeta como "unset" y se hereda `defaultPoseForPlacement`. |
| `c64d1c4` | `bom.ts:613-616` | El depth del sub-espacio del agregado caía a `agregado.externalDims.depth` (18mm = espesor de la hoja) → `defaultPoseForPlacement('puerta', {PD:18})` devolvía `y:18` → puerta al fondo/dentro del mueble, invisible. | Ahora siempre usa `PD` (profundidad real del mueble). Test nuevo `agregados.test.ts:324-404` afirma `doorPart.y === 500`. |
| `c64d1c4` | `plinth.ts:90-96` | La puerta no heredaba material del `FRENTE`. | `resolveBoardOptionChoiceId` hereda `FRENTE` para roles `PUERTA`/`PUERTA_*`/`FRENTE_CAJON`. |

### 2.2 Gap residual CONFIRMADO → ✅ RESUELTO en esta sesión (2026-08-11)

**`packages/ui/src/structures/structure3dPreview.ts:105`** llamaba a `defaultOptionChoicesForModule` con solo **3 argumentos**:

```ts
const defaults = defaultOptionChoicesForModule(
  { components: draft.components, hardwareLines: [] },
  catalogInput.optionGroups,
  catalogInput.components,
  // ❌ FALTA 5º arg: catalogInput.agregados
);
```

El commit `c64d1c4` añadió un 5º parámetro `catalogAgregados` a esa función y actualizó `module3dPreview.ts:118` y `project3dPreview.ts:146`, pero **no** este call site (ni, a verificar, `Structure3DModal.tsx:49`). Sin ese arg, `usedOptionRolesForModule` no recoge roles `PUERTA`/`FRENTE_CAJON` provenientes de agregados de la estructura → la puerta puede renderizarse descolorida o con `materials[0]` como fallback (`structure3dPreview.ts:143`).

**Acción:** pasar `catalogInput.agregados` (y, si corresponde, el array de `draft.agregados` en el ModuleRolesSource). Verificar `Structure3DModal.tsx:49` y `App.tsx:211` por el mismo patrón.

**✅ FIX APLICADO (H-1):** se pasaron `catalogAgregados` (+ `catalogStructures` donde faltaba) y el campo `agregados` en el `ModuleRolesSource` en los **4 call sites faltantes** de `defaultOptionChoicesForModule`, más los **2 call sites** de `boardFinishPickerGroupsForModule` (mismo patrón, para que el usuario pueda cambiar el acabado de la puerta-agregado, no solo verla):
- `packages/ui/src/structures/structure3dPreview.ts:105`
- `packages/ui/src/structures/components/Structure3DModal.tsx:49,62`
- `packages/ui/src/modules/components/Module3DModal.tsx:112,127`
- `apps/web/src/App.tsx:211`

Verificación: `pnpm typecheck` ✅ (6 workspaces), `pnpm test` ✅ (domain 443, ui 711, web 232, excel 33, storage 78, desktop 9).

**Follow-up detectado (R-13):** `requiredGroupCodesForModule` (`moduleHelpers.ts`) **no** recibe `catalogAgregados` en su firma, así que no considera "requeridos" los grupos de opción provenientes de agregados (ej. un grupo `PUERTA` sin default válido no bloquearía el preview de costo). Mismo bug subyacente, pero distinto efecto (afecta *cuándo* se bloquea el preview, no el material de la puerta). Pendiente de decisión: ¿extender la firma o dejarlo?

### 2.3 Verificaciones a hacer en runtime (si la puerta sigue sin verse)

1. Confirmar que el build corriendo **incluye HEAD** (`5bf9bc2` + `c64d1c4` son de hoy).
2. Confirmar que la puerta está **adjunta** a `module.agregados` o `structure.agregados` (no solo creada en el catálogo). `resolveAgregadoInstance` (`agregados.ts:70`) retorna `{components:[], hardwareLines:[]}` **silenciosamente** si no la encuentra.
3. Confirmar que el componente de la puerta tiene `placement: 'puerta'` (o `frente_cajon`) y `optionRoles: ['PUERTA']` — de eso depende entrar al `case 'puerta'` (`spatialPlacement.ts:103`) y heredar `FRENTE`.

---

## 3. Estado por capa — Dominio + BOM/Cotización/Despiece/Herrajes

**Integración correcta y verificada.** No hay camino paralelo; el agregado reusa el pipeline canónico.

| Flujo | Función | ¿Recorre agregados? | Evidencia |
|---|---|---|---|
| BOM (composición) | `resolveComposedModule` | ✅ Sí | `bom.ts:569-681` (itera `[...structure.agregados, ...module.agregados]`) |
| BOM (entrada) | `resolveBom` | ✅ Sí (rama compuesta) | `bom.ts:770-779` |
| Despiece / Optimizer | `generateCutRows` | ✅ Sí (vía `bom.boardParts`) | `cut.ts:109,137` |
| Listado de herrajes | `generateHardwareList` | ✅ Sí (vía `bom.hardwareLines`) | `labels.ts:281,306` |
| Costo / cotización | `calcLiveProjectBreakdown` | ✅ Sí (boardParts + hardwareLines) | `pricing.ts:263-272` |
| Hojas de armado | `assemblySheets` | ✅ Sí | `assemblySheets.ts:127-142` |
| Export Optimizer/CSV/PDF | writers | ✅ (serializan sin recalcular) | `packages/excel/src/*` |

**Repeticiones (N unidades):** correctas. Doble multiplicación — `calculateAgregadoSubspaceUnits` reparte N unidades (`agregados.ts:117`); el `ProjectItem.quantity` multiplica otra vez en cut/labels/pricing. Fórmula efectiva: `unidadesAgregado × cantidadPieza × item.quantity`. No hay doble conteo (en el BOM se pasa `quantity:1` por unidad en `bom.ts:652`).

**Fórmulas con contexto del padre:** correctas. El sub-espacio se evalúa contra `W/H/D` del padre (`bom.ts:587`); las piezas hijas se evalúan contra el sub-espacio local (`bom.ts:662-668`, con `geomDims` local en `bom.ts:406`). Permite `widthFormula: 'W - 4'` en un frente de cajón resolviendo contra el ancho **del cajón**.

---

## 4. Queja del usuario #2 — "No tengo vista 3D dentro del agregado"

**CONFIRMADO → ✅ RESUELTO en esta sesión (2026-08-11) con vista 3D embebida live en el editor.**

Antes: ningún componente renderizaba un agregado por sí solo. El agregado **sí** se renderizaba, pero solo desde la Vista 3D del **padre** (mueble/estructura/proyecto). El flujo era: guardar → salir → ir al mueble → agregarlo → abrir Vista 3D.

### ✅ Fix aplicado (H-2): panel 3D sticky live en el tab Piezas del editor

Patrón canónico replicado de `StructureEditorComponentsPanel` (3D sticky en editor, `design.md:735`). **Sin tocar el dominio**: se clona el truco de `resolveStructure3DPreview` (construir una `Structure` sintética con dims = `externalDims` del agregado y llamar `resolveComposedModule`).

Archivos nuevos:
- `packages/ui/src/agregados/agregado3dPreview.ts` — `resolveAgregado3DPreview(draft, catalogInput)` devuelve `{parts, width, height, depth, optionChoices, error, empty}`. Las piezas se pasan como `componentInstances` (NO `structure.components`) para que los **overrides de fórmula del usuario** (L/W/X/Y/Z) se apliquen y el preview sea **live**.
- `packages/ui/src/agregados/editor/AgregadoEditorPreview3D.tsx` — sub-componente del panel 3D sticky (`useMemo` sobre draft → `Furniture3DViewer`).

Archivos editados:
- `packages/ui/src/agregados/editor/AgregadoEditorForm.tsx` — tab Piezas restructurado a grid 2-col (`agregado-editor__components-layout`) con lista + panel 3D; suma props `catalogInput` + `resolveImageUrl`; **elimina los inline styles** que violaban `design.md:802`.
- `packages/ui/src/agregados/agregados.css` — clases layout grid + sticky 3D + variantes item-row (tokens only, breakpoint 900px).
- `packages/ui/src/agregados/AgregadosScreen.tsx` — suma props `optionGroups`/`catalogMaterials`/`catalogEdges`/`resolveImageUrl`, arma `catalogInput` con `useMemo`, lo pasa al form.
- `apps/web/src/App.tsx` — propaga los 4 props al `<AgregadosScreen>`.

Tests nuevos:
- `packages/ui/src/agregados/agregado3dPreview.test.ts` (4 tests): pieza contra dims locales, overrides aplicados (live), empty sin piezas, default footprint con dims 0.
- `packages/ui/src/agregados/editor/AgregadoEditorForm.test.tsx` (3 tests): panel 3D aparece con catalogInput, se omite sin él (degradación), no aparece en otros tabs.

Verificación: `pnpm typecheck` ✅ (6 workspaces), `pnpm test` ✅ (718 en ui, 232 en web, todos verdes).

**Alcance V1 (transparente):** piezas del agregado (tableros) con materiales por defecto, re-resolución live. **No incluido (follow-up):** herrajes como geometrías 3D (requiere `resolveAgregadoHardwarePlacements` paralela) y texturas reales (el patrón structures tampoco las carga en el editor embebido). Ambos documentados como próxima iteración.

---

## 5. Estado por capa — UI

### 5.1 Lo que EXISTE (completo)

- **CRUD de catálogo de Agregados** (`packages/ui/src/agregados/`): `AgregadosScreen`, `AgregadoListView`, `AgregadoDetailView`, `AgregadoEditorForm` con 3 tabs (General / Piezas / Herrajes), wiring al store (`apps/web/src/stores/catalogStore.ts:930-952`).
- **Panel de inserción en mueble/estructura** (`packages/ui/src/structures/components/StructureEditorAgregadosPanel.tsx`): selección desde catálogo, **dimensiones del hueco como fórmulas** (W/H/D), **posición 3D como fórmulas** (X/Y/Z), cantidad N, dirección de apilamiento, `gapMm`, `mirrored`, etiqueta. Montado en `StructureEditorForm.tsx:198` y `ModuleEditorForm.tsx:403`.
- **Fórmulas con contexto del padre** + leyenda inline de variables (`FormulaLegend` L42-79: `W`, `H`, `D`, `B`).
- **Editor de overrides por pieza** (`InstanceOverridesEditor`): fórmulas L/W/X/Y/Z + rotación X/Y/Z.
- **Render 3D del agregado dentro del padre** (mueble/estructura/proyecto) con part-id prefixing anti-colisión (`project3dPreview.ts:209-239`).

### 5.2 Lo que FALTA / es parcial

| # | Gap | Severidad | Evidencia |
|---|---|---|---|
| G-1 | **Sin preview 3D en el editor de Agregado** (queja #2 del usuario) | 🔴 Bloqueador | §4 |
| G-2 | **Sin rotación a nivel de instancia** al posicionar el agregado en el mueble. El tipo `ModuleAgregadoInstance` no tiene campo `rotation`; solo `mirrored`. La rotación solo es por pieza interna. | 🟠 Alta | `types.ts:511-536` |
| G-3 | **Sin UI para `optionOverrides`** por instancia (cambiar herraje/rol solo para una instancia concreta). El dominio lo permite (`agregados.ts:88-91`) pero el panel no lo expone. | 🟠 Alta | `StructureEditorAgregadosPanel.tsx` (sin campo) vs `types.ts:535` (campo existe) |
| G-4 | **Sin desglose/etiquetado de agregados** en cotización, despiece, listado de herrajes ni exports. El agregado está fundido, no es visible como concepto. | 🟠 Alta (producto) | §5.3 / H-3 |
| G-5 | **Sin validación de fórmulas en tiempo de edición.** El usuario escribe fórmulas sin feedback hasta resolver BOM/3D. | 🟡 Media | `StructureEditorAgregadosPanel.tsx` |
| G-6 | **Asimetría de medidas:** las dimensiones del agregado en catálogo son numéricas fijas (`AgregadoEditorForm.tsx:193-245`), mientras que el hueco al insertarlo es fórmula. Puede confundir. | 🟡 Baja | — |

### 5.3 El agregado es invisible como concepto en cotización/despiece/exports

Las piezas y herrajes del agregado **están** en el BOM y **suman**, pero:
- `ProductionOrderDespiecePanel.tsx`, `PartInspector.tsx`, `ProjectDetailView.tsx` **no mencionan "agregado"** — la pieza aparece como board part más del mueble.
- `exportProductionPack.ts`, `exportCommercialQuote.ts`, `exportCommercialQuotePdf.ts` **no mencionan agregados** — exportan vía el BOM ya expandido, sin agrupación.
- El plan maestro (Fase 4, `agregados-subassemblies-plan.md:91`) exigía explícitamente: *"Despiece acumulado en el BOM del proyecto con etiquetas de agrupación (ej: `[Cajón 1] Frente`, `[Cajón 1] Lateral Izq`)"*. **No implementado.**
- `CostPreviewPanel` muestra totales Materiales/Cantos/Herrajes/Costo — los aportes del agregado quedan fundidos, **sin desglose**.

---

## 6. Bugs de robustez (bordes del ciclo de vida)

| ID | Bug | Severidad | Evidencia |
|---|---|---|---|
| R-1 | **`duplicateModule` pierde los agregados del módulo.** Copia `components` y `hardwareLines` pero NO `module.agregados`. Duplicar un módulo con agregados → copia arranca sin agregados, silenciosamente. | 🔴 Alta | `packages/domain/src/duplicate.ts:93-125` |
| R-2 | **El freeze de cotización ignora los agregados.** `StructureRevision` declara `agregados?` pero `snapshotStructureRevision` nunca lo captura; `reifyResolvedStructure` hace `...structure` (vivos). Una cotización cerrada con `structureRevisionPin` cuya estructura luego cambió agregados se re-resuelve con los **vivos**, no los congelados. | 🔴 Alta (auditoría) | `packages/domain/src/structures/versioning.ts:39-173`; `types.ts:381` |
| R-3 | **Validación no cubre agregados.** `validateModule`/`validateStructure` no chequean `agregados`; `validateStructure:236` exige `components.length > 0`, lo que **rechazaría una estructura compuesta solo por agregados** (caso válido: body con puertas/cajones y ningún componente directo). No hay `validateAgregado`. | 🟠 Alta | `packages/domain/src/engine/validate.ts:163-283` |
| R-4 | **Módulo sin `structureId` silencia sus agregados.** Rama no-compuesta de `resolveBom` deja `allParts=[]` e ignora `module.agregados`. Bug latente: si se adjuntan agregados a un módulo "fijo"/legacy, desaparecen sin warning. | 🟠 Alta | `packages/domain/src/engine/bom.ts:802-828` |
| R-5 | **`agregadoId` inexistente se resuelve vacío sin error.** `resolveAgregadoInstance` retorna `[]` y `resolveComposedModule` hace `continue`. Un typo → BOM incompleto silencioso. Compuesto con R-3 (sin validación) → puede pasar desapercibido. | 🟡 Media | `agregados.ts:70-73`, `bom.ts:583-584` |
| R-6 | **Posible colisión de `id` en hardware de agregados con N>1.** `resolveAgregadoInstance` arma `id: \`${h.id}-agr-${instance.agregadoId}\`` **sin `unitIndex`** → con `quantity=3` se generan 3 `HardwareLine` con el mismo id. Consumers que keyeen por id pueden colapsar/duplicar. | 🟡 Media | `agregados.ts:95` |
| R-7 | **`cloneComponentInstance` pierde overrides espaciales.** Copia `edges/notes/lengthFormula/widthFormula` pero pierde `xFormula/yFormula/zFormula/rotateX-Y-Z/hardwarePlacements`. Impacta agregados (sus `ModuleComponentInstance` usan overrides espaciales). Se manifestaría al arreglar R-1. | 🟡 Media | `duplicate.ts:60-76` |
| R-8 | **`optionOverrides` solo aplica a hardware, no a componentes.** No se puede elegir otro material para la puerta de un agregado desde la instancia. Confirmar si es por diseño. | 🟡 Media (producto) | `agregados.ts:87-92` |
| R-9 | **`layoutDirection` limitado** a vertical(+Z)/horizontal(+X); sin eje Y/profundidad ni grid. Mirror solo invierte `rotateY` + placements laterales; no voltea posición X ni rotateX/Z. | 🟡 Baja | `agregados.ts:117-171` |
| R-10 | **Sin mano de obra de agregado.** El tipo `Agregado` no modela `baseLaborCost`. La cotización solo suma `module.baseLaborCost` (`pricing.ts:274`). Un cajón con corredera o una puerta con bisagras no aportan MO propia. | 🟡 Media (producto) | `types.ts:489-505` |
| R-11 | **Sin tests end-to-end de costo/herrajes de agregados.** `agregados.test.ts` cubre unidad + boardParts, pero no `resolveBom.hardwareLines`, ni `calcProjectBreakdown`, ni `generateHardwareList` con agregados. Un refactor descuidado rompería sin fallar tests. | 🟠 Alta (regresión) | — |
| R-12 | **Fixtures sin agregados.** `__fixtures__/plantillaDemo.ts` no los incluye. No hay test de integración (cotización real con cajones). | 🟡 Media | — |

---

## 7. Contraste con la intención del plan maestro

| Fase del plan (`agregados-subassemblies-plan.md`) | Estado | Notas |
|---|---|---|
| **Fase 1** — Motor paramétrico (sub-espacios, apilamiento, fórmulas locales) | ✅ Hecho | `resolveAgregadoInstance`, `calculateAgregadoSubspaceUnits`, `expandComponentInstances` con `geomDims` local. Tests en `agregados.test.ts`. |
| **Fase 2** — Formulario UI (pestaña Agregados, selector, parametrización, mirror) | ✅ Hecho | `StructureEditorAgregadosPanel.tsx`. Faltan `optionOverrides` (G-3) y rotación de instancia (G-2), que el plan no exigía explícitamente. |
| **Fase 3** — Visualización 3D interactiva (vista del agregado, agrupación seleccionable, inspector 3D) | ⚠️ Parcial | Render del agregado dentro del padre ✅. **Vista 3D aislada ❌.** Agrupación/selección de sub-ensamble ❌. Inspector 3D ❌. |
| **Fase 4** — Cotización/Export con etiquetas de agrupación + persistencia | ⚠️ Parcial | Aporte al BOM/despiece/costo ✅. **Etiquetas `[Cajón 1] Frente` ❌.** Persistencia storage/backend: a auditar (fuera de este JD). |

---

## 8. Recomendaciones / Roadmap de remediación

### Trabajo inmediato (cierra las quejas del usuario)

1. **H-1 (trivial):** pasar `catalogInput.agregados` a `defaultOptionChoicesForModule` en `structure3dPreview.ts:105` (+ revisar `Structure3DModal.tsx:49`, `App.tsx:211`). Cierra el gap residual de la puerta invisible en estructura.
2. **H-2 (bloqueador de usabilidad):** construir **vista 3D aislada del agregado**. Patrón: `resolveModule3DPreview` + `ModuleScene3D` evaluando contra `W_local/H_local/D_local`. Agregar tab "Vista 3D" a `AgregadoEditorForm`.

### Robustez antes de producción

3. **R-1, R-2, R-3:** duplicar módulo (pierde agregados), versionado de estructura (ignora agregados) y validación (no los cubre). Son los que más fácil rompen datos en silencio.
4. **R-4, R-5:** defender módulo sin `structureId` + error explícito ante `agregadoId` inexistente.
5. **R-11:** tests end-to-end (BOM hardwareLines + pricing + hardware list con agregados).

### Decisiones de producto

6. **H-3 / G-4:** ¿incorporamos etiquetado de agrupación (`[Cajón 1] Frente`) en despiece y exports? El plan lo exigía; hoy el agregado es invisible como concepto.
7. **G-2 / G-3:** ¿agregamos rotación a nivel de instancia y UI para `optionOverrides`?
8. **R-10:** ¿modelamos mano de obra propia del agregado?

---

## 9. Cómo demostrar que cada fix funciona

- **H-1:** abrir Vista 3D de una estructura con una puerta-agregado → la puerta aparece con el material correcto del `FRENTE` (no `materials[0]`).
- **H-2:** en el editor de catálogo de un agregado, tab "Vista 3D" muestra el sub-ensamble aislado, con sus piezas/herrajes en sus coordenadas locales.
- **R-1:** duplicar un módulo con agregados → la copia conserva las inserciones.
- **R-2:** cerrar una cotización con `structureRevisionPin`, editar la estructura viva (quitar un cajón), reabrir → la cotización sigue mostrando el cajón congelado.
- **R-3:** crear una estructura solo con agregados (sin componentes) → valida sin error.
- **R-4:** adjuntar agregados a un módulo sin `structureId` → error explícito (no silencio).
- **R-11:** `pnpm test` verde con los nuevos tests end-to-end.

Ver `docs/verification.md` para niveles de verificación generales.
