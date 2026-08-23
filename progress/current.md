# Sesión

**Feature cerrada:** F146 — proyectar_design_bom_price_contracts (#313 P3D-7,
meta #308) **+ recuperación del trabajo huérfano de F142 (#309 P3D-0b)**
**Inicio:** 2026-08-23 · **Cierre:** 2026-08-23
**Review:** APPROVED — `progress/review_F146.md` (incluye sección de recuperación)

## Incidente detectado y resuelto: PRs apilados mergeados a su rama base

Dos PRs se cerraron "verdes" en GitHub **sin tocar main**:

- **PR #330 (F142)**: base `feat/f141-proyectar-library`, mergeado 2h después
  de que esa rama ya hubiera ido a main (#329). Todo el código F142 (dock de
  materiales Ambiente|Tableros, backend de categorías con migración 000077,
  BoardMaterialPalette, paintMaterial) quedó huérfano. main sólo tenía la
  entrada del ledger (restaurada a mano en b34c8d8) **sin el código** — la
  sesión F145-env lo interpretaba como pérdida sólo de ledger.
- **PR #333 (F146, entonces F145)**: base `feat/f144-precision-dims`, mergeado
  13 segundos después de que #332 ya hubiera ido a main. Fixture compartido +
  suites contract TS/Go + customDims backend (migración 000078) huérfanos.

`progress/current.md` de la sesión anterior decía #313 "pospuesto" porque su
árbol local (rama de #334) nunca vio el trabajo de #333.

## Recuperación

- **Rama `recover/f142-materials-dock`** (base main): cherry-pick
  `5617311..e530c0c` (F142 + v2 + v3 + docs). Conflictos resueltos conservando
  la evolución F143–F145 de main (import union, `moduleSelected` =
  multiselección ∪ hover de pintura, mocks unificados, describe F142 al final
  del test). Un conflicto semántico: `setSelectedKey` → `setSelection({keys,
  anchor})` (commit propio).
- **Rama `feat/f146-contracts-p3d7`** (apilada): cherry-pick `b1e5c68`
  renumerado **F145→F146** (colisión con #311 environment_multispace en el
  ledger de main); descripción corrige "migración 000077"→000078; review
  renombrado a `review_F146.md`; comentarios de código renumerados.
- Completitud verificada: archivos propios **idénticos** a las ramas huérfanas
  (diff vacío; para F146, idénticos salvo el sed F145→F146). 0 markers de
  conflicto en el repo.

## Verificación (evidencia)

- `go vet` limpio; `go test -count=1 ./...` 8 paquetes OK (storage contra
  Postgres real; migraciones 000077+000078 aplicadas).
- `pnpm test` 2.982 OK (domain 1.031 · storage 155 · excel 89 · ui 1.344 ·
  mobile 45 · desktop 17 · web 301); `pnpm typecheck` OK.
- Contract tras renumeración: TS `designBomPriceContract` 6/6 +
  `domainBoundaryGuard` 2/2; Go `TestDesignBomPriceContract` 4 escenarios +
  3 unitarios `ResolveBomWithDims` — verdes.
- Review APPROVED (R1–R8) en `progress/review_F146.md`.

## Siguiente etapa

#312 (P3D-6) performance → #314 (P3D-8) benchmark. El issue #313 queda
cerrado al mergear los PRs de recuperación.
