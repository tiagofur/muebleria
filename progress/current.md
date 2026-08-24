# Sesión

**Feature en curso:** F161 — sketchup_semantic_metadata_roundtrip (issue #346)
**Inicio:** 2026-08-24
**Estado:** in_progress — slice 1 (contrato ejecutable TS) implementado; pendiente review
**Rama:** `feat/346-semantic-metadata-roundtrip`
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Decisión de namespace

El schema nace `granete.sketchup-authoring.v1` (rename #366). El issue #346 y el
contract decían `muebles.*`; nada se publicó bajo ese ID → no se debe migración.
Contrato doc actualizado con nota explícita.

## Slice 1 entregado (packages/domain)

- `sketchupAuthoringSchema.ts` — tipos v1 + fingerprint canónico + rounding de transporte.
- `sketchupAuthoringValidation.ts` — validación estructural/semántica → `ContractIssue[]`
  (schema identity, units/frames, transforms, catálogo, anchors, tombstones, duplicados).
- `sketchupAuthoringExchange.ts` — apply atómico full-snapshot-with-tombstones:
  idempotencia por key+fingerprint, base stale → conflict, omisión → conflicto,
  STABLE_ID_REUSE, response correlacionada, snapshot read-only, round-trip helper.
- `sketchupAuthoringMigrations.ts` — registry fail-closed (v1: sin migrations).
- `__fixtures__/sketchupAuthoringCabinet.ts` — cabinet canónico del contract §13
  (2 entrepaños compartiendo definition, bisagra manual, catálogo).
- 18 tests: identity/idempotencia/atomicity/tombstones/reuse/golden round-trip/issues/fingerprint.

## Pendiente

- Review del slice (implementer listo).
- Slices siguientes: transport endpoint (server authority + persistencia),
  extensión Ruby exportando el envelope desde metadata SketchUp, resolvedFeedback
  read-only render, migration real cuando exista v2.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
