# Sesión

**Feature en curso:** F189 — PARIDAD TS ↔ GO ↔ SKETCHUP PARA ESPESOR Y PROPAGACIÓN DE MATERIALES (#405 / MT-4)
**Rama:** `test/405-material-parity-suite`
**Inicio:** 2026-08-28

## Plan

1. Definir un fixture contractual único con nominales distintos de 16/18/6.
2. Consumirlo desde regresiones TypeScript y Go BOM/layout.
3. Consumirlo desde SketchUp para escenarios A–D, rebuild y rollback.
4. Ejecutar gates enfocados y registrar evidencia antes de revisión.

## Implementación

- `contracts/materialThicknessParity.contract.json` es la autoridad compartida
  para nominales, materiales y escenarios A–D.
- TypeScript y Go consumen el mismo JSON y prueban BOM, layout, fórmulas,
  placement, agregado, hardware, fallo y negative proof contra el nominal.
- SketchUp consume el JSON para A/B y el round-trip C/D: cuatro FRONT,
  material/dimensiones resueltas, herraje 578→576, identity/transform,
  roles no afectados y rollback sin operación parcial.

## Evidencia local

- `packages/domain`: 91 archivos / 1152 tests verdes + typecheck verde.
- `backend-go/internal/domain/engine`: paquete completo verde; regresiones #405
  enfocadas verdes, incluido FRONT 18→16 before/after en BOM y layout.
- `apps/sketchup-extension`: 164 unit tests / 1578 assertions verdes;
  `material_rebuild_test.rb` 7 tests / 196 assertions y RuboCop verdes.
- `feature_list.json`: 185 features, sólo F189 en `in_progress`.

**Estado:** implementación lista para revisión; F189 permanece `in_progress`
hasta veredicto del reviewer.

## Corrección de review

- Ronda 1: `CHANGES_REQUESTED` porque Go no ejecutaba el escenario C del
  contrato.
- Se agregó comparación before/after en Go para BOM y layout: cuatro FRONT
  afectados, BODY/BACK invariantes, dimensiones exteriores estables, identidad
  de host y herraje 578→576.
- Gate enfocado posterior: `go test ./internal/domain/engine -run
  'MaterialThicknessParity' -count=1` verde.
