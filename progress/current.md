# Sesión — F087 Zócalo como terminación automática

- **Fecha:** 2026-08-14
- **Feature:** F087 — `zoclo_terminacion_automatica`
- **Estado:** Implementada + pulido Fase 3. init.sh + typecheck + Go verde. Pendiente de revisión.

## Qué se implementó (F087 núcleo)

**Dominio:** `ProjectItem.baseMode` (override por línea), `BaseResolutionContext`
+ resolvedores con contexto (el modo efectivo del ítem decide la altura B),
síntesis automática en `resolveBom` (pieza ZOCLO-AUTO con L=W/W=B/canto L1,
herraje ZOCLO_PERFIL en ml, PATAS con cantidad sugerida — skip-if-present),
`defaultBaseModeForFurnitureType` (inferior/alto → melamina, superior → none)
y `baseContextForItem` (modo del ítem + B del plano placement→layout).
Motores pricing/cut/labels/exportIssues/assemblySheets pasan el contexto.
Compatibilidad golden: sin baseMode el BOM no cambia.

**Picker:** `selectableGroupCodesForModule` — grupos requeridos + opcionales
cuyo rol está en uso (incluidos los sintetizados por baseMode). El gate de
precio sigue exigiendo solo requeridos.

**Proyectar:** tarjeta "Zócalo (base del mueble)" en la pestaña props (tipo +
acabado contextual; el perfil/patas salen del catálogo del usuario). Altura
en Posición (chips existentes, ahora alimenta el BOM). 3D: `PlinthMesh` por
modo — melamina con material resuelto, perfil metálico con color del herraje,
patas visibles, none sin mesh (adiós caja gris #2c2f34). `project3dPreview`
propaga el tratamiento a colocados/cola/lineal.

**Creación automática:** el modal de alta escribe `baseMode`
(módulo → tipo). Store local + apiMappers (validación) + Go
(`ProjectItem.BaseMode`, migración aditiva 000042, queries en projects.go).

## Pulido Fase 3 (esta tanda)

1. **Editor de módulos amigable** (`ModuleEditorGeneralPanel`):
   - Label "Zócalo: ¿cómo apoya en el piso?" con 4 opciones en lenguaje de
     taller; primera opción "Automático según tipo de mueble" (recomendado).
   - Hints contextuales por modo, sin jerga de roles: melamina → "la pieza se
     genera sola al cotizar"; perfil → "se factura por ml, el acabado sale de
     tu catálogo de herrajes"; patas → "cantidad sugerida según ancho".
   - Semántica del default: sin baseMode = automático al cotizar. Re-guardar
     un módulo con 'none' explícito lo pasa a automático (deseado).
2. **Seed con acabados de perfil variados** (patrón catalog-driven):
   - `plantillaDemo.ts`: HER-ZOC-ALU (natural #c0c5cb) + HER-ZOC-BRO (bronce
     #8d6e42) + HER-ZOC-NEG (negro #2c2f34) con `previewColor`, en el grupo
     ZOCLO_PERFIL. Fluye al primer arranque vía plantillaCatalogWithModules →
     seedCatalogExpandedLatAm.
   - Go: seed inicial y `ensurePlinthCatalog` (upsert en bases existentes)
     con los 3 perfiles + preview_color (NULLIF para no pisar con '').
3. **Click en el zócalo 3D selecciona el mueble** — ya funciona: los meshes
   del PlinthMesh son hijos del grupo del módulo, cuyo onClick los captura.
   Tocar el zócalo → inspector con la tarjeta Zócalo.

## Drag-paint del zócalo — decisión documentada (NO hecho)

Arrastrar un material de la paleta sobre el zócalo cruza dos catálogos: la
MaterialPalette de Proyectar lista **materiales ambiente** (Acabados), pero el
zócalo de melamina consume un **MaterialBoard** vía choice ZOCLO (el BOM
necesita espesor/canto/costo). Hacerlo bien requiere o (a) una sección de
materiales de tablero en la paleta de Proyectar, o (b) un puente
acabado→tablero declarativo. No se parchea con un cast de ids.

## Verificación

- `pnpm test`: domain 484 (+9), storage 84 (+2), ui 760 (+5), web 232,
  desktop 9 — verde.
- `pnpm typecheck` monorepo verde. Go `go build` + `go test ./internal/...` verde.
- Tests de ModulesScreen (baseMode + B por testid) y engine golden intactos.

## Notas de sesión

- Al iniciar había 16 archivos sin commitear de la sesión anterior (mesada
  pintable 3D, completa y verde). Commiteados aparte en `3103757` y pusheados.
- Bug corregido durante la implementación: `resolveModuleBaseClearanceMm`
  miraba el modo del módulo aunque el ítem pidiera zócalo → ahora el modo
  efectivo (ítem → módulo) decide la altura.

## Pendiente / follow-ups

- Drag-paint del zócalo (ver decisión arriba — requiere definir el puente
  acabado→tablero o paleta de tableros).
- Textura del tablero en el zócalo 3D (hoy color del material).

## Guía de uso (post-F087)

- `docs/guia-de-uso.md`: manual de usuario final de toda la app (roles,
  sesión, catálogo en orden de armado, cotizar, Proyectar, producción,
  vitrina, administración, tips) con **sección dedicada a zócalos** (§8):
  automático al cotizar, tarjeta en el inspector, cómo registrar acabados de
  perfil propios (paso a paso Herrajes + Grupos) y qué pasa detrás
  (síntesis, ml, patas, precedencia de altura). Etiquetas verificadas contra
  la UI real (tabs "Muebles/Materiales/Ambiente", inspector "Mueble/Posición",
  botón "Proyectar").
- Referenciada desde `AGENTS.md` (mapa de docs) y `README.md`.

## Fix post-feedback — preview de costo bloqueado al elegir zócalo (F087)

Reporte del usuario: al poner baseMode "perfil" el preview se bloqueaba
listando ZOCLO_PERFIL; con melamina listaba INTERIOR (grupo que sí tiene).

Causas (3):

1. `moduleHelpers.usedOptionRolesForModule` es un colector de roles duplicado
   que no conocía los roles sintetizados por baseMode → los defaults del
   preview nunca llenaban ZOCLO/ZOCLO_PERFIL/PATAS → el breakdown explotaba.
   Fix: baseMode→rol (constantes de dominio) en el colector; el preview y el
   3D llenan el primer miembro del grupo como default.
2. El catch de `computeModuleCostPreview` devolvía `missingGroups: required`
   (TODOS los requeridos) en vez de los realmente sin elección → señalaba
   grupos sanos (el "INTERIOR" del reporte). Fix: lista honesta = grupos
   usados (requeridos u opcionales) sin default.
3. El error de dominio se descartaba en silencio. Fix: `previewError`
   plumbeado App → ModulesScreen → ModuleEditorForm/DetailView →
   CostPreviewPanel, que ahora muestra el mensaje real.

Tests: defaults de roles de base (moduleHelpers), panel con error honesto
(CostPreviewPanel.test). Suites: ui 763, web 232, resto intacto; typecheck
monorepo verde.

## Fix 2 post-feedback — "Elegí un preset de medida" en el preview

Segundo reporte del usuario: con los defaults de zócalo ya resueltos, el
preview avanzó hasta chocar con el gate de presets comerciales — el proyecto
sintético del preview no llevaba measurePresetId y MOD-GAB-01 define presets
(resolveModuleMeasurePreset exige selección). Antes este error estaba
enmascarado por el gate de grupos.

Fix: el ítem sintético usa `defaultMeasurePresetId(module)` (primer preset),
igual que el flujo de alta de ítems. `computeModuleCostPreview` exportada
para tests.

Tests (apps/web/src/modulePreview.test.ts): preset default desbloquea el
preview; plinth_strip calcula y factura 0.6 m × 18 = 10.8; grupo sin
miembros → blocked con lista honesta (ZOCLO_PERFIL sí, INTERIOR no).
Suites: web 235, init.sh verde.
