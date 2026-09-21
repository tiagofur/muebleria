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
- [x] T2 — Add the minimal shared-contract regression and complete/adjust scoped tests. Route: delegated writer (multi-file rule). Added fixture scenario `19-manual-handle-rotation-deg`, Go/TS/Ruby consumer proofs, and canonical JSON Schema `rotationDeg` object plus malformed-field proof. Observed: focused Go/TS and schema tests pass; Ruby focused tests remain blocked by missing bundled gems.
- [ ] T3 — Freeze and verify the scoped candidate. Route: delegated independent verifier (native assessment unavailable; treated high risk). Checks: affected Go/TS/Ruby tests, `git diff --check`, impact plan, and final factory preflight; real host remains NOT_RUN unless actually observed.
- [ ] T4 — Create one Conventional Commit, report F6 in #668, and open one partial PR (`Refs #668` / `Delivery: partial`) without merge. Route: parent publication readback.

Delivery strategy: single-pr. Forecast: under 400 authored diff lines excluding generated fixture reformatting. TDD mode: unknown (no configured mode found during current resume); use the existing RED regression evidence in the inherited candidate and ordinary focused checks for any remaining regression.

## Evidence

- Preflight: `factory_preflight.py` → PREFLIGHT_OK_NOT_VERIFIED (main, dirty sólo
  por untracked de tareas previas: PROMPT-codex-781.md, docs/ptx-example/,
  progress/host_smoke_*).
- Issue #668: open, status:approved, sin assignees, sin PRs abiertos que la
  referencien; comentario de reconciliación 2026-09-16 documenta F1–F5 y estado.
