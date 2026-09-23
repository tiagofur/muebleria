# 826 Material choices seeding must intersect the definition's consumable roles

Issue: #826 — fix(authoring): material choices se siembran sin intersección con roles consumibles por la definición
Base: origin/main @ 8c78eac9 (coordinado con PR #825 fix/821-catalog-option-kinds)
Branch: fix/826-material-choice-consumable-seeding
Status: implemented, V1 verification in progress

## Outcome

Ninguna superficie server persiste material choices con roles que la
definición física de la unidad no consume. El gate de release sigue siendo el
backstop, no el primer detector.

## Proven root chain (2026-09-22, DB local + repro engine)

1. `buildInitialQuoteCommercialSnapshot` aplica
   `engine.EffectiveOptionChoices` (defaults de proyecto completos) sin filtro.
2. `DisplayMaterialChoices` sirve el congelado verbatim (#821/#822, correcto).
3. SketchUp compone display+overlay y `UpdateDesignWorkingCopy` persistía sin
   validación de consumibilidad. Error terminal: `release unit choice JALADERA
   is not consumed by the resolved definition`.

## Design decisions (human, 2026-09-22)

- Boundary inicial "rechazar fail-closed" REVISED a **converge-at-write**
  tras evidencia de tests: el reject rompía tres contratos aprobados
  (#620 ride-along quote-first, #727 preflight-parity PUT-debe-pasar,
  projection tolerante a roles extra). El PUT del working copy intersecta
  entrante; el release gate queda como ÚNICO fail-closed.
- Un segundo writer introdujo un híbrido (reject fuente-SketchUp + flag true
  en quote-first) que re-rompía los mismos tres contratos; humano decidió
  "converge puro" y este writer revirtió esas ediciones (sin commit previo).
- Quote-first initial snapshot queda VERBATIM (#620); design-first quote y
  requote intersectan (legacy healing). Reconcile fill-only consumible.
- Conservadurismo del engine: roles base-treatment (ZOCLO/ZOCLO_PERFIL/PATAS)
  nunca se dropean (consumo depende del base context del pricing); consumed
  set VACÍO (definición degenerada) no toca nada (el gate bloquea por demanda
  cero; dropear fabricaría deltas comerciales).

## Scope (implemented)

- Engine `material_choice_consumption.go`: `ConsumedOptionRoles` (extraída de
  `validateReleaseUnitChoices` — fuente única gate↔siembra),
  `ResolveConsumedOptionRoles` (resolve lenient `resolveReleaseUnitOpt`),
  `IntersectConsumedOptionChoices` (BOM-neutral, conservadora).
- Storage: converge en `UpdateDesignWorkingCopy` (lazy catalog); intersección
  en `buildInitialQuoteCommercialSnapshot(…, intersectConsumable)` (design-first
  true / quote-first false) y en `buildRequoteCommercialSnapshot`; filtro en
  `ReconcileDesignWorkingMaterials` (quoted fill-only consumible).

## Exclusions

Stages 2-4 del plan de herrajes; espejo TS exacto de consumibilidad; cambios
al gate de release; display congelado (intacto, #821 R1/R2); ningún contrato
OpenAPI/fixture cambia (no se introdujo error code nuevo tras la revisión).

## Verification

- V0: build+vet limpios; gofmt. (preflight --require-clean antes del PR)
- V1 engine: paridad helper↔gate, BOM-neutralidad (resolve lenient pre/post),
  skip unresolvable, ZOCLO nunca dropeado. VERDE.
- V1 storage (PG real, per-fixture DBs + RLS): converge 6-roles→{INTERIOR,
  ZOCLO}; requote desde Q1 envenenado congela {BODY} y el working queda
  convergido; reconcile llena sólo INTERIOR; los 3 contratos rotos por el
  reject/híbrido vuelven a VERDE (#620, preflight-parity, projection).
- Suite completa storage+domain+engine+api: en curso.
- V2: sin cambios de cliente/contrato → cubierto por suites; host SketchUp
  sin cambios (cliente intacto).

## Tasks

- [x] Helper engine + tests paridad
- [x] Converge-at-write en working copy
- [x] Intersección design-first + requote (quote-first verbatim)
- [x] Reconcile fill-only consumible
- [x] Tests storage (converge/requote legacy/reconcile) + contratos restaurados
- [ ] Suite completa + verify_affected + preflight --require-clean
- [ ] PR (Closes #826 + Delivery: complete)
