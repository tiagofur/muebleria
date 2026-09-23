# 826 Material choices seeding must intersect the definition's consumable roles

Issue: #826 — fix(authoring): material choices se siembran sin intersección con roles consumibles por la definición
Base de desarrollo: origin/main @ 8c78eac9 (coordinado con PR #825 fix/821-catalog-option-kinds)
Base de PR #829 en R1: 48465805
Branch: fix/826-material-choice-consumable-seeding
Status: alcance #826 implementado en R1 (e8c95026); PR #829 con size:exception autorizado, pendiente de revisión independiente y merge humano

## Review R1 (2026-09-22, sobre fba32e85) — RED→GREEN→REFACTOR

- **Caso 2 (herraje fijo)**: guard corregido — el skip de convergencia pasa
  de "consumed vacío" a "BOM sin demanda" (sin partes Y sin hardware). Un
  módulo sólo-herraje-ID-fijo (cero roles consumidos, demanda válida) ahora
  converge; BOM byte-idéntico. Tests: engine
  (`TestIntersectConvergesWhenOnlyFixedHardwareConsumes`,
  `TestIntersectKeepsChoicesWhenBOMHasNoDemand`) + storage PG/RLS hasta el
  gate (`TestReleaseGate_HardwareOnlyModuleSurplusChoicesConverge` →
  `EvaluateDesignRevisionPreflight` READY, sin release_snapshot_resolution).
  RED confirmado en ambos niveles antes del cambio. Trap del fixture: el
  routing requiere medidas válidas aunque el módulo sea fijo (declarar
  width/height/depth en el módulo).
- **Caso 1 (base-treatment)**: se MANTIENE el conservadurismo (no dropear
  ZOCLO/ZOCLO_PERFIL/PATAS) — dropearlos desincroniza pricing (base context
  del proyecto) del authoring. Test pineado documenta que el gate estricto
  puede rechazarlos (preexistente). Decisión de producto documentada en la
  issue #826 (límite conocido): alinear el resolve de release con el
  `PricingContext.BaseMode` congelado se sigue por separado en #830 (semántica #727).
- Refactor: `resolveUnitConsumption` único interno; guard por demanda.
- Issue #826 aceptación reescrita a converge-at-write con el límite conocido.

## Outcome

Las superficies server cubiertas convergen elecciones sobrantes al escribir
según los roles consumibles de la unidad; un BOM con demanda de herraje fijo
y cero roles seleccionables también converge. El snapshot inicial quote-first
permanece verbatim por #620 y los roles ZOCLO/ZOCLO_PERFIL/PATAS se conservan
por la discrepancia de autoridad de base documentada en #830. El gate de
release sigue siendo el backstop fail-closed; este PR no garantiza que esos
roles base pasen el release bajo el modo por defecto del módulo.

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
  nunca se dropean (consumo depende del base context del pricing); un BOM sin
  demanda (sin partes ni herrajes) no toca nada. Un set consumido vacío con
  demanda de herraje fijo sí elimina elecciones sobrantes.

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
La autoridad del modo de base congelado y la liberación de esos roles quedan
fuera de #826 y se siguen en #830.

## Verification

- V0: build+vet limpios; gofmt. (preflight --require-clean antes del PR)
- V1 engine: paridad helper↔gate, BOM-neutralidad (resolve lenient pre/post),
  skip unresolvable, ZOCLO nunca dropeado. VERDE.
- V1 storage (PG real, per-fixture DBs + RLS): converge 6-roles→{INTERIOR,
  ZOCLO}; requote desde Q1 envenenado congela {BODY} y el working queda
  convergido; reconcile llena sólo INTERIOR; los 3 contratos rotos por el
  reject/híbrido vuelven a VERDE (#620, preflight-parity, projection).
- Suites de código y CI: VERDE en e8c95026 (R1). La publicación de esta
  corrección documental creará un nuevo HEAD que requiere lectura de CI
  exact-head antes de afirmar que sigue verde.
- R1 adicional: tests engine de herraje fijo y BOM sin demanda, más test
  storage con PostgreSQL/RLS: `EvaluateDesignRevisionPreflight` READY.
  Eso no ejecuta el recorrido completo de `CreateProductionRelease`.
- V2: no hay cambios de cliente/contrato y el CI incluye checks generales
  de navegador. El recorrido real navegador → SketchUp instalado →
  `CreateProductionRelease` sigue NOT_TESTED en este cierre; esos checks y
  las suites server no lo sustituyen.

## Tasks

- [x] Helper engine + tests paridad
- [x] Converge-at-write en working copy
- [x] Intersección design-first + requote (quote-first verbatim)
- [x] Reconcile fill-only consumible
- [x] Tests storage (converge/requote legacy/reconcile) + contratos restaurados
- [x] Suite completa + verify_affected + preflight --require-clean (backend full, openapi drift, factory scripts, typecheck, pnpm test, rake verify)
- [x] Alcance #826 aclarado en PR #829; límite de base vinculado a #830.
- [x] Estrategia de entrega: PR único #829 con size:exception autorizado por
  el maintainer; sin cadena de PRs.
- [x] Ruta de este cierre: delegated direct, corrección documental acotada,
  sin cambio de comportamiento.

## Next step

Revisar el CI exact-head tras publicar este documento; después corresponde
la revisión independiente y el merge humano de PR #829. Ninguno de esos
pasos se realizó en este cierre documental.
