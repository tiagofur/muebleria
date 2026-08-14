# Sesión — F087 Zócalo como terminación automática

- **Fecha:** 2026-08-14
- **Feature:** F087 — `zoclo_terminacion_automatica`
- **Estado:** Implementada y autoverificada (init.sh + typecheck verde). Pendiente de revisión.

## Qué se implementó

**Dominio (`packages/domain`):**
- `ProjectItem.baseMode?: ModuleBaseMode` — override por línea de cotización.
- `plinth.ts`: `defaultBaseModeForFurnitureType` (inferior/alto → plinth_board,
  superior → none), `BaseResolutionContext` + `resolveBaseModeWithContext` /
  `resolveBaseClearanceWithContext` (el modo efectivo del ítem decide si hay
  altura), `synthesizeBaseBoardPart` (pieza ZOCLO-AUTO, L=W, W=B, canto L1) y
  `synthesizeBaseHardwareLine` (ZOCLO_PERFIL ml / PATAS qty sugerida),
  `applyBaseTreatment` (skip-if-present: sin doble conteo con componentes
  ZOCLO propios) y `baseContextForItem` (modo del ítem + altura B del plano
  placement → layout).
- `engine/bom.ts`: `resolveBom` acepta `baseContext` opcional (6º param) y
  sintetiza la pieza/herraje que falte según el modo. `resolveComposedModule`
  recibe el contexto para el filtrado y la variable B.
- Motores alineados: pricing / cut / labels / exportIssues / assemblySheets
  pasan `baseContextForItem(project, item)`.
- Compatibilidad: módulos/ítems sin baseMode → 'none' → BOM idéntico (475
  tests previos siguen verdes; golden estable).

**Picker de opciones (`packages/ui`):**
- `optionGroupHelpers`: `selectableGroupCodesForModule` — grupos requeridos +
  opcionales cuyo rol está en uso, incluyendo los roles sintetizados por el
  baseMode (plinth_board→ZOCLO, plinth_strip→ZOCLO_PERFIL, legs→PATAS).
- `groupsForModuleItem` acepta `baseModeOverride` del ítem. El gate de precio
  sigue exigiendo solo los requeridos; el modal de alta valida solo
  requeridos.

**Proyectar (`ProjectSpatialStudio`):**
- Tarjeta "Zócalo (base del mueble)" en la pestaña props: tipo (4 modos en
  lenguaje de taller) + acabado contextual — material de tablero con
  "Igual que el frente" o perfil/patas **del catálogo del usuario**
  (aluminio/bronce/negro/… los crea él en Herrajes + Grupos). La altura sigue
  en la pestaña Posición (chips existentes), y ahora alimenta también el BOM.
- La lista "Acabados y herrajes" filtra los roles de base (viven en la
  tarjeta).
- Escena 3D: `FurnitureScene3D` recibe `baseMode`/`plinthMaterialId`/
  `plinthHardwareColor` por módulo. `PlinthMesh` reescrito: melamina con el
  material resuelto (vía materialColors), perfil como fleja metálica
  (metalness, color del herraje), patas como cilindros (suggestLegCount),
  none no dibuja nada. Adiós caja gris #2c2f34.
- `project3dPreview.ts`: resuelve el tratamiento por ítem (modo + material +
  color de herraje) y lo propaga a colocados, cola sin colocar y lineal.

**Creación automática:**
- `ProjectAddItemModal` escribe `baseMode` al crear: default del módulo →
  default por tipo de mueble. Bajos/despensas nuevos → zócalo melamina
  heredando el frente, sin tocar nada.
- Store/mappers/Go: `baseMode` persiste (projectStore, apiMappers con
  validación de valores, `ProjectItem.BaseMode` en Go + migración aditiva
  `000042_project_item_base_mode` y queries en `projects.go`).

## Verificación

- `pnpm test`: domain 484 (+9), storage 84 (+2), ui 760 (+5), web 232 — verde.
- `pnpm typecheck` monorepo verde. Go `go build` + `go test ./internal/storage` verde.
- Tests nuevos: síntesis/doble-conteo/contexto (plinthBom), grupos
  seleccionables (optionGroupHelpers), tarjeta y perfil del catálogo
  (studio), tratamiento de base 3D (project3dPreview), roundtrip/rechazo de
  base_mode (apiMappers).

## Notas de sesión

- Al iniciar había 16 archivos sin commitear de la sesión anterior (mesada
  pintable 3D, completa y verde). Commiteados aparte en `3103757` y pusheados.
- Bug encontrado y corregido durante la implementación:
  `resolveModuleBaseClearanceMm` miraba el modo del módulo aunque el ítem
  pidiera zócalo → ahora el modo efectivo (ítem → módulo) decide la altura.

## Pendiente / follow-ups

- Fase 3 (no bloqueante): tarjeta amigable en el editor de módulos
  (`ModuleEditorGeneralPanel`) reemplazando el select técnico; seed demo con
  más perfiles (bronce/negro) para mostrar variedad; drag-paint de material
  sobre el zócalo en el 3D (superficie `plinth` en paintMaterial).
- Textura del tablero en el zócalo 3D (hoy color del material; misma ruta
  que BoardMeshMaterial si se pide).
