# Implementación #650 — PR 6: perfil CADmatic 4 efectivo + adapter + descarga candidata

- Issue: #650. Sexto incremento: conectar el pipeline PTX documentado (#656/#657) al sistema real de machine outputs para CADmatic 4.
- Rama: `feat/650-cadmatic4-ptx-integration`. Base exacta: `origin/main@598253d322e68a08f76adebf8324fa96ec633f9c` (merge de PR #657, verificado). Single writer. Frente Cotización/Diseño (agente paralelo activo, rama docs/642) sin tocar; origin/main sin cambios que afecten este diff.
- Fecha: 2026-09-11. Estado: `IMPLEMENTED_PENDING_REVIEW`.

## Alcance implementado

```text
real CutPlan → selected immutable CAD4 candidate profile (ptx-cadmatic-4@r2)
→ ptxAdapter (ruteo por revisión exacta) → compilador documentado #657
→ validated PTX bytes → descarga existente #591 (unified/by-material/ZIP + manifest)
→ parser independiente → verifier semántico === []
```

### Archivos cambiados

- `packages/excel/src/machines/profiles.ts`:
  - `PTX_CADMATIC_4_CANDIDATE_PROFILE` — **r2**, revisión nueva e inmutable
    (r1 se conserva como constante histórica; digests verificados por test).
    Dimensiones efectivas con evidencia de implementación en repo:
    headerVersion '1', unit mm, ascii, crlf, decimalPlaces 2, headerOrigin 0,
    trimType 1, includeVectors false, supportsPositiveTrim false,
    supportedFunctions '0,1,2,3'. pendingEvidence = sólo lo que falta del
    RECEPTOR (fieldAvailability/recordOrdering/characterRestrictions/
    filenameConstraints). supportStatus NOT_TESTED (no se promueve por
    metadata). Receiver family CADmatic 4 vía CADLink con install
    FIELD_VERIFICATION_REQUIRED.
  - `PTX_COMPILER_REQUIRED_DIMENSIONS` — dimensiones que consume la ruta del
    compilador; ausente cualquiera → FIELD_FORMAT_EVIDENCE_REQUIRED.
- `packages/excel/src/machines/ptxAdapter.ts` — **v1.1.0** (digest
  b56de383…, descriptor actualizado y verificado por test):
  - Ruteo por revisión EXACTA (`profileUsesDocumentedPtxCompiler`):
    `ptx-cadmatic-4@r2` → `compileCutPlanToPtxDocument` + validate +
    `serializePtxDocumentBytes`; cualquier otra revisión (ptx-generic@r1) →
    serializer legacy **inalterado** (byte-identity con golden #348
    conservada; test intacto). El legacy no se elimina: otros consumers
    siguen dependiendo de él.
  - `resolvePtxCompilerRoute`: TODAS las opciones del perfil se consumen de
    verdad (headerVersion/headerOrigin/trimType/decimalPlaces/title fijo
    PTX_CANDIDATE_TITLE/includeVectors → compile; encoding/lineEnding →
    serializer; supportedFunctions → filtro post-compilación;
    supportsPositiveTrim debe ser false). Valor no implementado (utf-8, cr,
    dp 9, trim true, unit in…) → bloqueo `SERIALIZER_NOT_IMPLEMENTED` con
    causa específica. Perfil decorativo imposible.
  - **Preflight real**: `canSerialize` ejecuta la compilación (pura y
    determinista) con las opciones del perfil y mapea cada
    `PtxCompilationError` a `OPERATION_NOT_REPRESENTABLE` con el código
    exacto en el detail (missing_cut_program, nesting, trim_unsupported,
    phase_unsupported, thickness, identity_not_ascii,
    magnitude_not_representable, material, program_invalid…). Contrato
    `ready === true ⇒ serialize()` ejecuta: garantizado por construcción y
    probado por el contract test existente + tests nuevos (bloqueado ⇒
    serialize bloquea por la MISMA causa).
- `packages/excel/src/machines/outputSelectionResolver.ts`:
  - `KNOWN_OUTPUT_PROFILES` con r2 como revisión seleccionable de
    ptx-cadmatic-4 (r1 stale → PROFILE_DIGEST_MISMATCH accionable).
  - Probe de readiness ahora un plan **compilable** (trim 0, kerf 4,
    programa válido, identidades ASCII): necesario porque el preflight r2
    compila de verdad; la ruta legacy no inspecciona el plan y no cambia.
  - `generateSelectedCuttingOutput` SIN cambios de comportamiento: la
    selección r2 fluye por la ruta existente (unified/by-material, un
    BOARDS+PATTERNS por hoja ya garantizado por el compilador).
- `packages/excel/src/machines/machineOutputFixtures.ts`:
  `buildCad4CandidateCuttingJob()` — plan real de optimizeCutPlan sobre el
  input congelado del golden #657 (determinista, trim 0, programas validados).
- `packages/excel/src/index.ts` — exportaciones nuevas (perfil r2,
  dimensiones requeridas, ruteo, título candidato).
- `contracts/machineOutputCatalog.contract.json` +
  `backend-go/internal/domain/machineoutputselection.go` (+ tests Go que
  pineaban el tuple) — paridad actualizada: ptx-cadmatic-4@r2 (digest
  822221a6…) y granete-ptx@1.1.0 (digest b56de383…). Las selecciones viejas
  (r1 o adapter 1.0.0) quedan stale con mensaje accionable, sin retarget.
- `packages/ui/src/settings/MachineOutputSelectionSection.tsx` — label
  NOT_TESTED → "Candidato — no validado en máquina" (nunca
  Compatible/Validado/Production Ready).

### Descarga (sin botón paralelo)

La ruta EXISTENTE #591 queda conectada: selección de máquina/salida →
`generateSelectedCuttingOutput` → `downloadCuttingArtifactBundles`
(unified: descarga directa; by-material: ZIP con un .ptx por material,
fechas fijas, orden determinista). El manifest del artefacto conserva
provenance exacto (projectId/generatedAt/cutPlanId/cutPlanVersion),
profile r2, adapter 1.1.0 + digest, validationStatus NOT_TESTED,
compatibilityEvidence `notClaimed`, nonProductionValidationArtifact true y
sha256 del archivo — responde "¿qué CutProgram/perfil/adapter produjo este
PTX?" sin leer Project mutable. La identidad del programa fuente vive en el
propio PTX (JOBS.name = projectId estable; cutIds en COMMENT + tabla inversa
del compilador). `downloadCutPlanPtx` legacy sigue para el flujo SIN
selección configurada.

### Tests nuevos

- `ptxCad4CandidateRoute.test.ts` (21): ready⇒serialize con plan real;
  readback semántico verde vía adapter; bytes del adapter ≡ compilación
  directa con opciones del perfil; gobernanza real (decimalPlaces decide la
  frontera de representabilidad —dp insuficiente bloquea, dos suficientes
  dan bytes idénticos sin ceros de relleno—; headerVersion cambia HEADER;
  lineEnding aplicada; includeVectors toggle verificado por readback;
  opciones no implementadas bloquean con causa; supportedFunctions '0,1,2'
  bloquea un plan que requiere fase 3; dimensión ausente → evidencia
  faltante); 8 negativos con detail exacto (missing cutProgram del fixture
  legado, cnc-nesting, trims positivos, fase 4, espesor, identidad no ASCII,
  decimal no representable, programa inválido); descarga unified (manifest
  r2 + adapter 1.1.0 + hashes deterministas) y by-material (2 materiales, un
  bundle por material sin fugas); **golden end-to-end** (selección r2 →
  generateSelectedCuttingOutput → bytes descargados → parser → verifier
  === []); pins stale (r1 / adapter 1.0.0) bloquean sin retarget; legacy
  intacto (ptx-generic sin cutProgram sigue listo y emite INI histórico).
- `outputSelectionResolver.test.ts` (actualizados): r2 resuelve listo vía
  probe compilable; r1 stale sin sustitución; CADmatic 3/5 siguen
  bloqueados; target bloqueado sigue lanzando antes de aplicar modo.
- `profiles.test.ts` (actualizados): r2 en ALL_PROFILES (digest canónico),
  dimensiones exactas, pendingEvidence sólo de receptor.
- `apps/web/src/exportCutPlanPtx.test.ts` (+1): by-material con selección
  r2 → ZIP real con un .ptx documentado por material (HEADER, CSV, título
  candidato) y manifest exacto.

## Evidence (HEAD del commit de este reporte)

- `@granete/excel` 37 archivos / 299 tests (+3 skipped hardware preexistentes).
- Monorepo: domain 105/1407, storage 12/191, ui 160/1704, web 35/445,
  desktop 3/17, mobile 10/73 — todo verde.
- `pnpm typecheck` 7/7. `go test ./...` backend-go OK (domain + api +
  storage + application). `pnpm openapi:check` sin drift.
  `git diff --check` limpio.
- Golden #348 del legacy intacto (sha 544dcae5… verificado por test
  existente); golden #657 intacto.

## Limitaciones y estado de campo

- Estado NOT_TESTED / notClaimed en todos los niveles: nada certifica
  CADLink/CADmatic 4 ni habilita fabricación; sin CADLink real, sin .rlt,
  sin cinco cocinas, sin corte físico.
- El candidato r2 soporta trim=0 solamente (90..99 y head siguen
  deshabilitados); fase > 3 falla cerrado; VECTORS deshabilitados en el
  perfil por defecto (la ruta documentada no los requiere).
- ASCII+CRLF y headerVersion 1 son elecciones conservadoras de candidato
  documentadas, NO requisitos verificados del receptor.
- La integración con ProductionRelease exacta (release/design/bom
  provenance completo) depende del frente Cotización/Diseño: el manifest ya
  registra missingProvenance explícito cuando el flujo no puede aportarla.
