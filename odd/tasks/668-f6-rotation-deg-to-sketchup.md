# 668 F6 — HardwarePlacement.rotationDeg survives to the SketchUp localTransform

Issue: #668 — [P1][AS3D-2] SketchUp: jaladera SKP real con descarga, montaje y diagnóstico completo (defecto F6, fix focal autorizado por encargo humano)
Base: origin/main @ 7430182975be989e14b422422c265c49f7922578
Branch: fix/668-f6-rotation-deg
Status: in progress

## Scope

- Aplicar `HardwarePlacement.rotationDeg` (Euler per-axis `{x,y,z}` en frame del board)
  en `resolveHardwareToWorld` con paridad exacta con el renderer Web:
  `B = R_euler(Rx·Ry·Rz, convención three.js 'XYZ' == eulerXyzMatrix) · Q_normal`
  donde `Q_normal` = shortest-arc +Y→normal (TS `normalOrientationQuaternion`).
  Espacio canónico del MountFrame (mount_frame.rb): `+X longitudinal, +Y in-plane,
  +Z outward normal` → basis X = eje del grip (primitive X Web), basis Z = eje
  outward (primitive +Y Web), basis Y = cross(Z, X) (diestra, det +1).
- Conservar `rotationDeg` en el camino authoring/manual: wire
  `authoringPlacementWire` → `engine.AuthoringManualPlacement` → reconstrucción
  del `domain.HardwarePlacement` en layout.go, con validación de finitud.
  Nombre/tipo REAL existente (`rotationDeg` per-axis objeto, igual que
  `domain.HardwarePlacement.RotationDeg`); NO el escalar de
  `HardwarePlacementIntent` (otro contrato, snapshot de diseño).
- TS resolve v1 (`sketchupAuthoringResolve.ts`): dejar de rechazar
  `rotationDeg` en placements; validar finitud (handedness sigue rechazado).
- Tests Go RED→GREEN: front 0°/90°, jaladera de cajón horizontal, cara top,
  board rotado, authoring manual path, MountFrame no-identidad (passthrough +
  composición numérica en Ruby).
- Tests Ruby focalizados: layout_contract bases distintas → transforms
  distintas; AssetLoader `T_placement × inverse(T_mountFrame)` con base rotada
  (scale 1, det +1, sin shear). Ruby NO recalcula el ángulo.
- Bump explícitamente autorizado para pruebas: plugin `v0.1.2`, sus literales
  existentes de UI/tests/documentación, RBZ nuevo e instalación local en
  SketchUp. No publicación de release, merge ni cambio de PR.

## Exclusions

No hardcode de `if handle rotate 90`, no rotación compensatoria en Ruby, no
cambios a MountFrame/normalización, no AABB para inferir orientación, no cambio
de modelo de coordenadas, no PTX/CNC/cotización, no #670, no cierre de #668, no
merge, no labels de aprobación.

## Root cause (Paso 1 confirmado)

1. `rotationDeg` existe: `domain/types.go:523` (Go) y `types.ts:675` (TS);
   authoring Web → `ComponentInstanceOverrides.HardwarePlacements` (JSONB).
2. Web lo aplica: `HardwareMesh.tsx` — group exterior `rotation=[rad(x),rad(y),rad(z)]`
   (Euler 'XYZ' three.js) + group interior `quaternion=setFromUnitVectors(+Y,normal)`;
   bar-pull grip a lo largo del X primitivo.
3. Se pierde en: (a) `engine/layout.go resolveHardwareToWorld` —
   `u=orthogonalVector(normalRender)` arbitrario, nunca lee `hp.RotationDeg`
   (afecta camino por defecto Y manual); (b) camino manual además antes:
   `AuthoringManualPlacement`/wire sin campo (TS resolve v1 lo rechaza) y
   reconstrucción layout.go:375 sin copiarlo.
4. Ruby recibe `localTransform.basis` ya sin rotación; compone
   `Geom::Transformation.axes(facePoint, basis)` × `inverse(T_mountFrame)`;
   nunca recalcula ángulo (sin cambios de lógica Ruby).

## Tasks

- [x] T1 — Confirm root-cause chain (Go/TS/Ruby/wire) and audit the inherited candidate. Route: delegated read-only mapping (4-file rule). The candidate implements the required Go/manual/TS transport; the shared contract fixture still lacks an observed `rotationDeg` case.
- [x] T2 — Correct the JSON Schema shape to match the existing Go/TS/Ruby sparse per-axis `rotationDeg` contract. Route: delegated writer correction round 1/1. Schema now accepts zero to three known numeric axes and rejects unknown axes; focused schema test passed.
- [x] T3 — Repair Ruby parser regression found by CI. Route: delegated writer correction. Commit `1a5d7a4e` qualifies `AuthoringSnapshotValues.valid_offsets?`; Ruby CI matrix passed on that head. Foundation Gate A was derivative.
- [x] T4 — R1: regenerated the Go-authored shared authoring-resolve fixture. Only scenario `19-manual-handle-rotation-deg` changed, at the expected resolved hardware proxy translation/dimensions; focused golden + rotation Go PASS.
- [x] T5 — R2: TS request validation now fails closed for unknown `rotationDeg` axes; `{w:90}` returns `HARDWARE_PLACEMENT_INVALID`. Focused TS PASS.
- [x] T6 — R3: added Ruby regression proving prepared nonidentity MountFrame composes with a rotated placement basis as `T_placement × inverse(T_mountFrame)`, rigidly. With provisioned Ruby 3.2 bundle, `bundle exec rake verify` PASS: 890 runs, 6058 assertions, 0 failures/errors.
- [x] T7 — Bumped plugin to `v0.1.2` across its authoritative constant and existing UI/test/docs literals. Built/verified RBZ SHA-256 `b42a84cbd03db9736ca6852896d270c6bb8a12756d7252a5010d8e9c50bc3c91` and installed it into SketchUp 2026 Plugins; backup at `/tmp/granete_for_sketchup-pre-0.1.2-20260921082104`. No desktop/TestUp run yet.
- [ ] T8 — Re-freeze and verify the corrected candidate, update PR #809 body with observed results, and wait current-head CI. `factory_preflight --require-clean` remains blocked by unrelated untracked paths; distinguish Ruby CI from SketchUp desktop evidence.
- [x] T9 — Continued the same PR #809 only; no new PR, merge, or issue closure.

Delivery strategy: single-pr. Forecast: under 400 authored diff lines excluding generated fixture reformatting. TDD mode: unknown (no configured mode found during current resume); use the existing RED regression evidence in the inherited candidate and ordinary focused checks for any remaining regression.

## Evidence

- Preflight: `factory_preflight.py` → PREFLIGHT_OK_NOT_VERIFIED (main, dirty sólo
  por untracked de tareas previas: PROMPT-codex-781.md, docs/ptx-example/,
  progress/host_smoke_*).
- Issue #668: open, status:approved, remains open after draft PR #809; the F6 finding is recorded at `#issuecomment-5755564860`.
- Candidate commits: `c36384b5a10b4bbb9954d0dd676f81b9acb70c56` and `2dd7d8005f20598ce0c85ac249603d20f5aec743`.
