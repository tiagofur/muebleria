# Sesión

**Feature en curso:** F186 — RENDERER NATIVO SKETCHUP (#415 / SU-ENT-2)
(COMPLETADA; review round 2 APPROVED en `progress/review_F186.md`; ver
`progress/history.md`)
**Cerrados con evidencia (ledger done):** F169–F185 (PRs #419/#424/#427/#428/#431/#432/#433)
**Rama:** `feat/415-native-component-renderer` (desde origin/main post-#433)
**Inicio:** 2026-08-27
**Contexto:** programa #413 (SketchUp native entity model). Prerequisites
verificados mergeados: #418 docs+ADR-0004 (PR #420), #414 transform local→
furniture autoritativo + parser Ruby (PR #433, F185). Este slice reemplaza el
renderer final Group/AABB por la jerarquía nativa y desbloquea #416/#417/#404.

## Problema

`FurnitureBuilder` materializaba muebles como `Group` + Groups hijos con
cajas pre-horneadas AABB world (`transform.translationMm` = min corner).
Suficiente como MVP visual, pero sin ejes locales estables, sin semántica
definition/instance, sin aislamiento entre unidades, sin selección nativa de
pieza ni Outliner significativo — y sin identidad de authoring-definition en
metadata.

## Diseño entregado

1. **Jerarquía nativa (ADR-0004 §1–2):** mueble =
   `Sketchup::ComponentInstance` top-level con `ComponentDefinition` generada
   y aislada por FurnitureInstance (`Granete · Mueble · {nombre} · {inst}`);
   cada tablero/herraje = ComponentInstance anidado cuya definición porta la
   caja LOCAL en origen `[0,width]×[0,thickness]×[0,length]` (convención
   engine X=width/Y=thickness/Z=length) y cuyo transform es EXACTAMENTE
   `Geom::Transformation.axes(translationMm, basis.x/y/z)` del contrato #414.
   Cero bakeo de world AABB, cero escala no-uniforme, cero tabla
   slot/role→rotación (negative proofs lo clavan).
2. **Update/rebuild:** reutiliza la instancia top-level existente (identidad +
   world transform intactas), `definition.entities.clear!`, re-render dentro
   de la misma definición y cleanup scoped post-commit: sólo definiciones con
   prefijo `Granete · Parte/Herraje ·` y cero instancias vivas se remueven
   (`definitions.remove`; jamás `purge_unused`). Legacy Group como target ⇒
   fail closed con puntero a #416.
3. **Atomicidad:** una sola operación SketchUp por insert/rebuild; abort en
   cualquier fallo (los stubs de test implementan journal de rollback para
   verificar que no queda jerarquía/definición parcial); metadata se escribe
   sólo después de la jerarquía válida; el builder rechaza bodies crudos
   (`ArgumentError`: sólo `Library::NativeLayout` parseado).
4. **Identidad (#346/#415):** el layout Go ahora publica
   `components[].componentDefinitionId` (`{idPrefix}{componentId}`, p.ej.
   `st-comp-side` para `st-comp-side-copy-0`; compartido por todas las copias
   de un componente, estable entre rebuilds; legacy boards: id propio). El
   parser Ruby (`layout_contract.rb`: `LayoutBoardTransform` con
   identity/material/aabb agrupados, `LayoutHardwarePlacement`,
   `NativeLayout` con hardware+dims, `ContractCoercions`/`BasisValidation`/
   `HardwareContractParsing` extraídos para los budgets de lint) preserva
   verbatim `componentDefinitionId`/`catalogComponentId` (opcional, namespace
   separado) + material passthrough. Metadata de child:
   `componentInstanceId` + `componentDefinitionId` + `furnitureInstanceRef`
   + slot/role/materialBindingRole (+ hostComponentInstanceId en herrajes).
   GUID/persistent_id/nombre de host NUNCA son identidad (negative proof:
   el JSON de metadata no contiene ningún GUID de definición).
5. **Selección:** observer resuelve furniture top-level / child semántico y
   expone `furnitureInstanceId` + `componentDefinitionId` desde metadata
   (rename-safe). Controller consume `resolved_native_layout` (fail-safe ante
   contrato ausente/desconocido; sin fallback AABB).
6. **Herrajes:** AssetLoader devuelve la instancia creada (dentro de la
   definición del mueble) y el builder le ata metadata Granete; fallback
   generado también es ComponentInstance nativo con color/preview.
7. **Path genérico offline:** misma jerarquía nativa con base identidad por
   construcción (laterales/estantes/puertas autorados localmente).
8. **Host validation:** `test/testup/TC_NativeEntitySmoke.rb` (10 tests:
   entity types, bounds locales, transform lateral exacto, move/rotate sin
   reescribir children, aislamiento FI-A/FI-B, rename, GUID, contrato espejo
   fail-closed, abort real del host) + fixture
   `test/fixtures/native_layout.json` (= golden del resolver). README
   documenta la suite. **Ejecución en host real: PENDIENTE** — requiere
   instalar RBZ + TestUp 2.5.4 y correr SketchUp GUI (esta sesión no puede
   lanzar GUI ni simular evidencia; convención: registrar como no disponible,
   nunca simular pass).

## Evidencia

- `bundle exec rake verify` (syntax+lint+unit+boundary+RBZ): OK — 159 runs /
  2217 assertions, RBZ sha256 `245785d0…` (tras fixes de review).
- Tests nuevos `native_entity_renderer_test.rb` (matriz obligatoria +
  negative proofs, golden-driven) y `furniture_builder_test.rb` reescrito
  (native), `persistence_roundtrip/selection_observer/dialog_controller/
  application` adaptados. Boundary ownership (vocabulario manufacturing)
  sigue verde.
- `go test ./...` backend-go: OK (incl. `TestLayoutComponentDefinitionIdentity`
  — defId compartido por 3 copias quantity, ≠ instanceId — y golden
  regenerado con el campo).
- `pnpm typecheck` + `pnpm test`: OK (sin cambios TS; no-regresión).
- Host smoke real: PENDIENTE (ver arriba).

## Review round 1 (progress/review_F186.md) — CHANGES_REQUESTED → atendido

- **H1 trabajo sin commit:** se commit/push al cierre de esta ronda.
- **H2 fail-closed legacy no host-accurate:** en el host real `Group` también
  responde a `#definition`, así que `respond_to?(:definition)` dejaba pasar
  Groups legacy como híbridos. Fix: guard por TIPO (`is_a?(::Sketchup::
  ComponentInstance)`); stubs ahora modelan `Sketchup::ComponentInstance`/
  `Sketchup::Group` como bases de `ComponentInstanceStub`/`GroupStub` y
  `GroupStub#definition` existe (host-faithful). Test unitario reforzado
  (responde a definition y ES Group, aún así rechazado; sin operación
  iniciada) + caso real agregado a `TC_NativeEntitySmoke`.
- **H3 doc contradictoria:** `sketchup-interaction-model.md` §3.1/§3.3/§6.2/§7/
  §17/§22-2 actualizados: renderer nativo es CURRENT post-#415, Group es
  legacy (#416/#397).
- **H4 defID legacy sin cobertura:** documentado en `legacyBoardStack` (cada
  pieza flat ES su definición single-instance ⇒ defID == id es el intento) +
  aserción en `TestResolveFurnitureLayoutLegacyModuleStacksAllPieces`.

## Hallazgo lateral (fuera de alcance)

Entradas duplicadas del mismo componente (dos `ComponentInstance` de catálogo
apuntando al mismo `ComponentID`) generan `componentInstanceId` colisionantes
(`-copy-0` dos veces) — paridad TS↔Go (`bom.ts:498` idéntico), preexistente,
no introducido por #415. **Registrado como issue #434.**

## No-goals respetados (issue #415)

- Migración legacy Group (#416): sólo fail-closed con puntero.
- OpenCutList (#417): no tocado.
- Material rebuild (#404): sólo wiring mínimo (controller consume layout
  parseado; sin re-resolve en Ruby).
- Digital Thread #385+: no tocado (instanceRef compat se mantiene).
