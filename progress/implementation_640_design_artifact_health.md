# Issue #640 — Authoritative availability and integrity for DesignRevision artifacts

- Estado: `IMPLEMENTED_PENDING_REVIEW`.
- Base exacta: `origin/main@fde538a839a7b882657fafbfe41bbdd1cf91fbee` (post-merge #636/#638/#646).
- Rama: `feat/640-design-artifact-health`. Single writer: GLM. Sin merge ni cierre.

## Problema

La metadata de `design_revision_artifacts` prueba que una revisión fue
publicada, no que los bytes referenciados sigan existiendo o coincidiendo.
`getArtifactAvailability` clasificaba disponibilidad desde la presencia de
metadata y el formatter de digest aceptaba `sha256:` duplicando el prefijo
canónico (`sha256:sha256-…`).

## Autoridad existente (trazada antes de editar)

- Metadata: `domain.DesignRevisionArtifact` → `design_revision_artifacts`
  (migration 000114; CHECK `^sha256-[0-9a-f]{64}$`; trigger de inmutabilidad;
  RLS explicitly-shared `app_can_access_project`).
- Storage: filesystem `MediaDir/<orgID>/<storageKey>`; clave server-generated
  `designs/publish/{sessionID}/{kind}-{sha6}{ext}`; lector en la capa API
  (`designArtifactStoragePath` + `os.Open`).
- Grants: `POST .../artifacts/{kind}:authorize` → media token firmado ≤3 min
  → `GET /api/design-artifacts/{key}` (misma mecánica #636, intacta).

## Entrega

1. **Dominio puro** (`backend-go/internal/domain/design_artifact_health.go`):
   `DesignArtifactHealthStatus` (`available|missing|integrity_mismatch`),
   `ClassifyDesignArtifactHealth` (available exige bytes + size + digest
   exactos; digest no canónico → fail-closed `integrity_mismatch`),
   `ErrArtifactBytesMissing` / `ErrArtifactBytesIntegrityMismatch`,
   `IsValidCanonicalArtifactSHA256`.
2. **Verificador API** (`backend-go/internal/api/design_artifact_health.go`):
   una sola pasada streaming SHA-256 por artefacto con short-circuit por size;
   ilegible/no encontrado → `missing`; nunca muta metadata; sin cache ni
   segundo store (correctness first, costo documentado).
3. **Read model**: `GET .../artifacts` y el revision detail (`GET
   .../revisions/{id}`) emiten `health: {status, checked_at}` por artefacto;
   finalize también. Storage keys nunca salen del server.
4. **Autorización fail-closed**: authorize verifica salud DESPUÉS de resolver
   la revisión bajo el tenant del llamador y ANTES de mintear el grant:
   `ARTIFACT_MISSING` / `ARTIFACT_INTEGRITY_MISMATCH` (409 tipado). Caller
   cruzado sigue recibiendo 404 neutral: el estado de bytes no es oracle.
   MediaDir sin configurar → fail-closed typed (nunca grant sin storage
   observable).
5. **OpenAPI** (`contracts/openapi/granete-api.v1.yaml`): schemas
   `DesignArtifactHealth(Status)`, `health` required en
   `DesignRevisionArtifact`, códigos `ARTIFACT_MISSING` /
   `ARTIFACT_INTEGRITY_MISMATCH`, 409 documentado en authorize. Go/TS
   regenerados; `pnpm openapi:check` sin drift.
6. **React** (`ProjectDesignsScreen` + `designHistory`): estados honestos por
   artefacto (Disponible / Bytes no disponibles / Integridad comprometida /
   Estado no informado), acceso deshabilitado para no-available, preview
   missing/mismatch SIN round-trip de autorización y SIN colapsar en "sin
   vista previa", error de request con Reintentar, recovery que nombra
   publicar nueva revisión (continuación ejecutable: `Abrir en SketchUp`),
   digest canónico un-solo-prefijo + digest completo copiable con label
   accesible en detalles técnicos.

## Decisiones

- La verificación vive en la capa API (única dueña de `MediaDir`); el dominio
  queda puro y testeable. No se tocó el token de media (claim-set ver-pinned
  compartido con catálogo — would be R3): la ventana TOCTOU entre authorize
  saludable y GET queda acotada por el TTL ≤3 min del grant, documentada, y
  el GET ya 404a bytes ausentes.
- `processing`/`failed` NO se agregaron: no existe lifecycle persistido de
  post-publicación que los avale (sólo se usan estados con verdad observable).
- E2E usa fixtures deterministas propios (los artefactos que el spec sube) y
  restaura los bytes en `finally` para no contaminar otros specs del gate.

## Evidencia

- Go: `go test ./... -count=1` verde (11 packages, incl. storage sobre
  PostgreSQL real); focus: domain classifier matrix 8/8, API health
  healthy/missing/tampered-digest/tampered-size/unresolved-404/unconfigured
  sobre filesystem real.
- OpenAPI: `pnpm openapi:check` PASS.
- UI: `ProjectDesignsScreen.test.tsx` 39/39 + `designHistory.test.ts` 18/18
  (estados healthy/missing/mismatch/loading/request-failed/retry, disabled,
  digest once, copy accessible, pairing recovery).
- Browser: `scripts/organization-browser-gate.sh tests/organization/project-designs.spec.ts`
  PASS 2/2 sobre Chromium+Go+PostgreSQL efímero — escenario A (available +
  grant real + bytes no vacíos ya probado en seed), B (bytes borrados →
  `missing` + 409 `ARTIFACT_MISSING` + UI honesta + metadata sin regenerar) y
  C (bytes alterados → `integrity_mismatch` + 409 `ARTIFACT_INTEGRITY_MISMATCH`
  + UI + digest original intacto).
- `git diff --check` limpio.

## Delta

- Producción: ~420 líneas (domain 105, api verifier+handlers ~110, React ~190,
  css ~30, docs excluidas del conteo de código).
- Generado: OpenAPI Go/TS regenerado.
- Tests: ~600 líneas (domain 3 casos matriz, API 5 suites, UI 6 casos nuevos +
  formatter/health units, E2E 1 spec con 3 escenarios).
