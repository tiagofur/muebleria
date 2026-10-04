# ODD — #1005 CNC-KDT (salida nativa KDTPanelFormat XML, KDT Flexdrill 1200)

- **Issue**: tiagofur/muebleria#1005 (`status:approved`, autorización del owner
  2026-10-03 «empezamos con la KDT», en sesión; issue fileada el mismo día).
- **Lane**: Delegated Direct (multi-slice K1→K4, riesgo de taller). Un escritor.
- **Base**: K1 MERGEADO d32b86a3 (PR #1006). K2 MERGEADO 09a0332a (PR
  #1007, 2026-10-03). Rama K3 `feat/1005-kdt-generation-k3` desde 09a0332a,
  mismo worktree.
- **Estado**: K1/K2 MERGEADOS. K3 IMPLEMENTED_PENDING_REVIEW (K4 pendiente).

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

## K2 — Serializer + lector (implementado, pendiente de review)

- **Librería `machines/kdt/`**: `document.ts` (modelo), `format.ts` (writer
  byte-fiel al corpus: UTF-8 sin BOM, CRLF, 2-space, sin declaración XML,
  ≤2 decimales con preflight fail-closed, AUTHOR comment Granete),
  `transform.ts` (política Granete→KDT documentada e INVERTIBLE: ejes de
  tablero de hardwarePlacement, caras como proyecciones axis-aligned,
  rotaciones propias front-up {X=z, Y=w−x, Z=−y} y back-up {X=z, Y=x, Z=+y},
  cuadrantes por orientación, programas por pieza/cara estilo "Face A/B" de
  Promob, AlignmentFace = canto X=0 r1), `parse.ts` (lector INDEPENDIENTE
  del writer: TypeNo 1/2 tipados, 3/5/6/7 estructurales, TypeNo desconocido
  registrado nunca dropeado, rechaza BOM y LF).
- **Adapter granete-kdt@0.2.0** (digest b9b824c7…): `serializePerPiece` es
  la API real por pieza/cara; el `serialize` de la interfaz sólo acepta
  trabajos de UN programa y bloquea con el código nuevo
  `PROGRAM_GRANULARITY_UNSUPPORTED` (nunca concatena ni inventa contenedor).
  `JOB_DATA_INVALID` (código neutro nuevo) para datos fuera del marco de su
  cara o thicknessMm ausente.
- **Perfil kdt-flexdrill-1200@r2** (digest d11d92c3…): dimensiones
  evidenciadas como implementación de repo (clase ptx-generic r1):
  fileExtension xml, utf-8, crlf, 2 decimales, mm, coordinateConvention
  granete-front-up-r1, operationTypeNos 1,2, alignmentFacePolicy
  granete-quadrant-2-r1. pendingEvidence = preguntas abiertas del receptor
  (filenameConstraints + §15). supportStatus sigue NOT_TESTED (r1 queda
  como constante histórica; pins viejos → stale blocker, sin retarget).
- **Catálogo**: perfil r2 + adapter 0.2.0 `serializerImplemented: true`
  (contrato JSON + espejo Go + tuple Go test). Resolver registra r2.
- **Dominio**: `PartDrillingPattern.thicknessMm?` (opcional, el generador
  lo llena; el adapter falla cerrada sin él) + 2 códigos de bloqueo neutros.

## Hallazgos K2 (datos reales)

1. **El fixture de machining violaba la convención canónica de caras**
   (edge holes con xMm=300 sobre espesor 18; dowel xMm=550 sobre ancho 400).
   Corregido a la convención; los tests nuevos la hacen ejecutable.
2. **La regla "Z1 ≈ PanelThickness/2" del spec §6.2 NO es universal**:
   BA42011A.xml trae Z1=7.5 con T=15.5 (desviación 0.25 del centro). El
   censo codifica el invariante real (0 < Z1 < T; >90% centrado) y la
   corrección del doc de #903 queda propuesta como follow-up (fuera del
   alcance K2 por la issue).
3. El censo de 417 muestras confirma el spec: TypeNo 4 jamás observado,
   TypeNo 5 exactamente una vez (EN72268A, Radius 85), cuadrante↔canto
   coherente en todo el corpus.

## Verificación K2 (observada, rama feat/1005-kdt-serializer-k2)

- `pnpm typecheck` 7/7 · excel 670 passed (writer byte-golden 07645adc…,
  round-trip 6 caras × 2 orientaciones, golden BA11025A con valores §7,
  Circle estructural EN72268A, censo 417) · `pnpm test` workspace PASS ·
  `go test ./internal/domain/ ./internal/api/` ok (paridad r2 incluida).
- NOT_RUN local (CI los corre): browser gate, TestUp, PostgreSQL gates —
  sin superficie (export-layer TS + catálogo; el flujo E2E de generación
  multi-programa es K3).

## K3 — Integración end-to-end (implementado, pendiente de review)

- **Generación por pieza** (excel): `generateSelectedMachiningOutput`
  resuelve la tupla exacta y produce UN bundle por pieza/cara —
  `serializePerPiece` es dueño de gates y serialización;
  `generateMachineArtifactFromBytes` arma artifact+manifest por programa
  (delivery `by-piece` nueva con code/face, nombres industriales
  `K<hex12>.xml` deterministas, provenance congelado del caller). Sólo la
  familia per-piece-capable genera; otras → `SERIALIZER_NOT_IMPLEMENTED`
  sin fallback. Probe de settings filtra `PROGRAM_GRANULARITY_UNSUPPORTED`
  para familias per-piece → la tarjeta KDT lee **Configurada**.
- **Web fail-closed**: `handleExportMachiningKdt` exige el snapshot
  congelado de una liberación canónica (sin authority, fetch failure o join
  mismatch ⇒ error duro, cero archivos — nunca heurísticas F074 a una
  máquina). Estado de selección de mecanizado = gemelo del de corte, sin
  ruta legacy. `composeFrozenDrilling` ahora lleva thicknessMm (el resolver
  lo tenía en scope y no lo emitía).
- **UI**: tarjeta "Programas KDT (Flexdrill 1200)" + botón
  `prod-opt-export-kdt` en Optimización (mismo contexto de liberación que
  PTX), deshabilitado hasta target listo; descarga = un ZIP determinista
  con XML + manifest por pieza.
- **Browser proof**: `machine-output-selection.spec.ts` — la selección KDT
  en settings queda guardada y lee Configurada sin blocker (server truth +
  reload). El E2E completo del botón requiere la siembra de liberación con
  perforaciones (escala de engineering-cutting-demand) — queda para el
  smoke de campo K4, que es la validación definitiva.
- Verificación: typecheck 7/7 · excel 682 · web 581 · Go domain ok ·
  openapi sin drift.

## Restante

- **K4**: readback en máquina real client-b + sign-off (coordinación owner,
  evidence pack estilo #348). `NOT_TESTED` hasta entonces. Incluye decidir
  filenameConstraints con la instalación (los nombres K<hex12> son el
  candidato conservador).
- Browser E2E completo del botón (liberación con perforaciones sembradas) —
  opcional antes de K4, obligatorio para claim de compatibilidad.
- Follow-up doc: corregir §6.2 del spec (#903) con el contraejemplo Z1.

## Fuera de alcance

Igual que la issue: validación física sin coordinación del taller, otros
modelos KDT, G-code universal, retiro F074/J6 de #995.

## K4 — Kit de validación de campo (implementado; sesión física pendiente del owner)

- **Estado**: K1/K2/K3 MERGEADOS. K4 en dos mitades: el kit de campo
  (código+docs, ESTE PR) y la sesión física en la Flexdrill 1200 del
  client-b, coordinada por el owner — `NOT_TESTED` permanece hasta
  entonces; nada se promueve por metadata.
- **Fixture congelado** `fixture-kdt-field-001`
  (`machines/kdt/fieldFixture.ts`): 2 piezas sintéticas (600×400×18), 12
  agujeros, 3 programas (Face A / Face B / sólo-cantos) cubriendo TypeNo 1
  desde ambas caras, TypeNo 2 en los cuatro cuadrantes y Z1 centrado.
  Identidad sintética, timestamps fijos: bytes y manifests deterministas.
- **Expectativas a mano** (`KDT_FIELD_EXPECTATIONS`): la tabla
  valor-por-valor que el operador verifica en la máquina — y que los tests
  confrontan contra la salida real del pipeline (atrapó un error mío de
  cómputo Y1 en P02 antes de llegar al taller: exactamente su propósito).
- **Hashes pinned** (`KDT_FIELD_PROGRAM_SHA256`) + paridad doc↔código por
  test: `expected-values.md` cita los 3 sha256 y CI falla si el doc y el
  fixture divergen (patrón 670-E: evidence head == code).
- **Protocolo de campo** (`docs/machines/client-b/k4-field-validation/`):
  README (pre-sesión, import I1-I7 sin corte productivo, clasificación
  blocker/warning/unsupported, salida NOT_TESTED→VALIDATED/PARTIAL/
  UNSUPPORTED, captura de las preguntas abiertas §15, sanitización),
  `expected-values.md` (tablas por programa + hashes) y
  `operator-checklist.md` (acta imprimible con sign-off).
- Cross-link desde `docs/machines/client-b/README.md`.
- **Incidente de entorno**: el worktree `1005-kdt-registration` se encontró
  destruido (sin .git, vaciado) al arrancar K4 — los dos archivos nuevos
  del fixture sobrevivieron y se recuperaron; todo lo demás estaba
  mergeado. El nuevo worktree es `1005-kdt-field-kit`. Sin pérdida.
- Verificación: excel 686 (4 nuevos: 3 programas exactos, valor-por-valor,
  determinismo de hashes, paridad doc) · typecheck 7/7.
- **Restante**: ejecutar la sesión (owner + taller), acta firmada, y el PR
  de resultados que actualice dossier/matriz/perfil si corresponde.
