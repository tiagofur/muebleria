# ODD — #1386 Bindings de parámetros sobre instancias de AGREGADO + poses por copia

Issue: #1386 (`status:approved`). Lane: Delegated Direct — este artifact es la
memoria de ejecución. Slice 1 (motor + paridad + contratos) en este PR;
slice 2 (editor + E2E browser) y verificación en vivo continúan en la issue.

Base: `main 6bf80944`. Rama: `feat/1386-agregado-bindings`. Writer único.

## Decisión de diseño

La issue dejaba abierta la pregunta «poses por copia»: (a) fórmulas con i/N o
(b) plan de ocurrencias autoriado. Sin respuesta del owner en la pregunta
formulada, se ejecuta la opción recomendada **(a)**, simétrica a #1383 slice 1:

- Las fórmulas de `Position` (X/Y/Z) de la instancia de agregado se evalúan
  **por unidad** con `I` (índice de copia) y `N` (cantidad) en el entorno.
- Regla de composición, fail-closed y sin cambio implícito: si alguna fórmula
  de posición usa `i` o `N`, las N unidades son de **tamaño completo**
  (sub-espacio entero) y se posicionan por fórmula — sin split de
  `layout_direction`/`gap` (evita doble distribución). Si ninguna la usa, el
  comportamiento de hoy queda bit a bit (pose base una vez + split del
  sub-espacio).
- `resolve.go` (BOM) replica la misma regla para que dims de unidad e ids de
  pieza (`agr-<id>...u<idx>-`) coincidan entre BOM, layout y machining.
- `Dimensions` (tamaño del sub-espacio) NO recibe i/N (no fue pedido; el split
  vertical/horizontal existente ya reparte tamaño).

## Contrato nuevo

- Kinds versionados: `agregadoQuantity` (number integer) y `agregadoCondition`
  (boolean), apuntando por `binding.agregadoId` a `module.Agregados[i]`.
  Valor 0 / false elimina las instancias (misma semántica que
  `componentQuantity`/`componentCondition`).
- Validación: `agregadoId` requerido para los kinds nuevos; `dimension` y
  `relationship` prohibidos; los kinds de componente/estructura rechazan
  `agregadoId` (fail-closed, sin campos ignorados).
- `ValidateModuleFurnitureParameterConsumers`: exige exactamente 1 entrada
  directa (y 1 total con estructura) del `agregadoId`.
- `ApplyEvaluatedAgregadoBindings`: espejo de la de componentes; llamada en
  `ResolveAuthoringLayout` y en el path de release (con el guard
  safe-integer que ya exige componentQuantity).

## Superficie de edición

- Go: `domain/furniture_parameters.go` (constantes, campo `agregadoId`,
  validación, consumers), `engine/component_bindings.go` (apply),
  `engine/authoring_resolve.go` + `engine/release_unit.go` (call sites),
  `engine/layout.go` (`formulaUsesCopyIndex` + unidades por fórmula),
  `engine/resolve.go` (espejo BOM de la regla).
- TS: `smartFurnitureDomain.ts` (union de kinds + `agregadoId`),
  `furnitureParameters.ts` (`BINDING_FIELDS` + validación espejo),
  `engine/componentBindings.ts` (apply espejo), `engine/bom.ts` (unidades por
  fórmula espejo), `agregadoAssembly.ts` (espejo de la regla en la proyección
  3D de ensamblados — incorporado en la corrección del review ronda 1 para que
  Project3D/SpatialStudio/producción no apilen copias que BOM y layout
  distribuyen).
- Contratos: `contracts/agregadoBindings.contract.json` (fixture nueva) y
  `contracts/openapi/granete-api.v1.yaml` (enum + `agregadoId`) con
  regeneración de clientes.
- Tests: Go contract + unit (poses por fórmula no apiladas, consumers
  ambiguos, apply), TS contract + unit.

## Fuera de alcance (queda declarado en la issue)

- Editor web: selector de destino componente|agregado + «Probar resolución» +
  E2E browser (slice 2).
- Migración del caso real del owner y verificación en vivo.
- i/N en fórmulas de `Dimensions`; parámetros por instancia de agregado;
  repetir el AGREGADO completo del mueble.

## Verificación

- V0: `scripts/check_openapi_drift.py` + regeneración de clientes sin drift.
- V1: `go test ./internal/domain/...` (engine + domain) y vitest de
  `packages/domain` verdes sobre el candidato congelado.
- V2 (slice 2): browser gate del editor y verificación en vivo del owner.
