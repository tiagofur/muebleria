# ODD — #1005 CNC-KDT (salida nativa KDTPanelFormat XML, KDT Flexdrill 1200)

- **Issue**: tiagofur/muebleria#1005 (`status:approved`, autorización del owner
  2026-10-03 «empezamos con la KDT», en sesión; issue fileada el mismo día).
- **Lane**: Delegated Direct (multi-slice K1→K4, riesgo de taller). Un escritor.
- **Base**: `origin/main` @ `e997d68e` (post #1001). Rama
  `feat/1005-kdt-registration-k1`, worktree
  `../muebles-worktrees/1005-kdt-registration`.
- **Estado**: K1 IMPLEMENTED_PENDING_REVIEW (K2/K3/K4 pendientes).

## Hechos verificados (2026-10-03, base e997d68e)

1. **La serialización de máquina es client-side TS** (`packages/excel`);
   Go sólo persiste/valida la selección y sirve el snapshot congelado.
   Cadena PTX: adapter (`machines/ptxAdapter.ts`) → compiler → serializer;
   el input es el job resuelto neutral (`ResolvedCuttingJob` /
   `ResolvedMachiningJob` de `@granete/domain`), nunca BOM re-derivado.
2. **El snapshot congelado ya existe** (#995 K1 mergeado):
   `GET /projects/{id}/production-releases/{releaseId}/manufacturing-snapshot`
   (`production_release.go:468`, guard `RoleCanReleaseProduction`, 404
   `release_snapshot_unavailable` para schema-v1, sin fallback).
3. **Patrón de familia sin serializer**: `sawAdapter.ts` /
   `woodWopMprAdapter.ts` — descriptor canónico + digest SHA-256 sobre
   `canonicalJson`, readiness con `SERIALIZER_NOT_IMPLEMENTED` +
   `FIELD_FORMAT_EVIDENCE_REQUIRED` por dimensión; catálogo compartido
   `contracts/machineOutputCatalog.contract.json` espejado byte-semántico en
   `backend-go/internal/domain/machineoutputselection.go` (paridad por test
   en ambos lados) y enum en `contracts/openapi/granete-api.v1.yaml`.
4. **El formato KDT está estudiado**: `docs/machines/kdt-xml-format.md`
   (PANEL + CAD, TypeNo 1-7, cuadrantes, AlignmentFace, §14 mapeo hardware,
   §15 preguntas abiertas) + 417 XML reales sanitizados en
   `docs/machines/client-b/samples/` (#903, docs-only).
5. Break real encontrado por typecheck: `apps/web/src/exportCutPlanPtx.ts`
   duplicaba la unión `ArtifactKind` — corregido reusando la del dominio
   (la duplicación habría vuelto a romperse con cada familia nueva).

## Diseño K1 (implementado)

- Familia `kdt` registrada fail-closed en las tres superficies:
  `OutputFormatFamily`/`ArtifactKind` (+`'kdt'`), catálogo
  (`formatFamilyOperations.kdt = ["machining"]`, máquina
  `client-b-machine-c-kdt-flexdrill1200@r1`, perfil `kdt-flexdrill-1200@r1`
  con digest `6a3015f7…`, adapter `granete-kdt@0.1.0` con digest `401c9fc8…`
  y `serializerImplemented:false`), enum OpenAPI + clientes regenerados.
- `KDT_FLEXDRILL_1200_PROFILE` r1: **cero dimensiones evidenciadas** — el
  spec documenta la sintaxis, pero publicar los valores evidenciados es el
  trabajo de K2 (revisión nueva, nunca edición in-place). `pendingEvidence`
  nombra las 6 preguntas abiertas del spec (§15) además de las 8 dimensiones
  requeridas.
- `kdtAdapter.ts`: stub fail-closed espejo de MPR — hoy el modelo resuelto
  sólo alcanza TypeNo 1 (front/back) y TypeNo 2 (cantos); 3/6/7 quedan
  `OPERATION_NOT_REPRESENTABLE` hasta que el modelo transporte ranuras/routing.
- Resolver + UI: perfil seleccionable en settings, label
  `KDT XML · Flexdrill 1200`; la generación queda bloqueada con razón exacta
  (TS y Go). Go: `TestKdtSelectionValidatesButStaysBlockedOnSerializer`
  prueba tupla válida + blocker único + rechazo de kdt sobre cutting y de
  digest stale.

## Verificación K1 (observada)

- `pnpm typecheck` 7/7 (el break del punto 5 surgió aquí y se corrigió).
- `pnpm --filter @granete/excel test`: 656 passed (incluye nuevos
  `kdtAdapter.test.ts`, paridad KDT del catálogo, contrato de adapters).
- `pnpm test` workspace: PASS (recursivo + databaseIsolation).
- `go test ./internal/domain/ ./internal/api/`: ok (paridad catálogo incluida).
- `pnpm openapi:generate` + `openapi:check`: sin drift.
- NOT_RUN (infraestructura no tocada, CI la corre): browser gate, TestUp,
  PostgreSQL gates — sin superficie: cambio es catálogo/export-layer TS/Go.

## Aceptación K1 (de la issue)

- [x] KDT01: family/perfil/adapter con digest canónico; paridad
      TS↔Go↔OpenAPI verde; selección válida persiste, inválida falla cerrada
      en ambos lados.
- [x] KDT02 (nivel bloqueo estructural): cero archivos y
      `SERIALIZER_NOT_IMPLEMENTED` (Go blockers + readiness TS; el flujo E2E
      de descarga de machining no existe aún — se completa en K3).

## Restante

- **K2**: serializer + lector offline (round-trip, goldens vs 417 muestras),
  preguntas abiertas resueltas con fuente o `pendingEvidence`, flip
  `serializerImplemented` con revisión/digest nuevos.
- **K3**: integración end-to-end (pack + manifest + flujo export/UI), browser proof.
- **K4**: readback en máquina real client-b + sign-off (coordinación owner,
  evidence pack estilo #348). `NOT_TESTED` hasta entonces.

## Fuera de alcance

Igual que la issue: validación física sin coordinación del taller, otros
modelos KDT, G-code universal, retiro F074/J6 de #995.
