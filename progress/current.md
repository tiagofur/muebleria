# Sesión — Components catalog critique + Judgment Day

- **Branch:** `feat/quote-projectar-ux-bridge`
- **Scope:** Critique + JD + fixes Componentes (lista/detalle/crear/editar)

## Hecho

- Critique 24/40 Acceptable
- JD Rounds 1–5
- **JUDGMENT: APPROVED** (R5 ambos jueces CLEAN)

### Fixes clave
- C1–C8: draft wipe, perforations, fórmulas, confirm desactivar, rot 0, 3D tab, placement filter, dims+fórmulas
- Session: `seedEditorDraftFromBaseline` + `setDraftLocal` en forceClose (no sticky empty)
- `consumeRequestCreateKey` modules/materials/projects
- geometrySummary fórmulas en lista/detalle; edges con preview dims

### Tests
- Suites components/modules/common relacionadas verdes

## Siguiente

- Commit/push cuando el usuario pida
- Opcional: polish UX restante del critique (score 24→mejor) vía `$impeccable polish`

---

# Sesión — Fase 2 visible hardware · PR2 (frontend bridge + renderer)

- **Branch:** `feat/add-visible-hardware` (NO pushed, per instrucción)
- **Scope:** WU3 (project3dPreview bridge) + WU4 (HardwareMesh renderer). PR1
  (domain) ya hecho; PR3 (backend-go) pendiente. No toqué `packages/domain`
  ni `backend-go`.

## Hecho

- **WU3** (commit `caadf55` `feat(preview3d): resolve hardware placements in
  the preview bridge`): `project3dPreview.ts` suma `resolvedHardwarePlacements`
  aditivo a `ProjectModule3DInstance`; resuelve vía `resolveHardwarePlacement`
  (PR1) por componente con `overrides.hardwarePlacements`, linkeando al board
  part por id `${componentId}-copy-${i}`. `parts` byte-idéntico sin placements
  (VH-04); Optimizer/cut intacto (VH-08); cost-only/missing → filtrado (VH-09).
  +5 tests en `project3dPreview.test.ts`.
- **WU4** (commit próximo `feat(preview3d): render parametric hardware meshes
  in the 3D scene`): nuevo `HardwareMesh.tsx` (KnobMesh/BarPullMesh/CupPullMesh)
  + helpers puros (pose, quaternion +Y→normal, geometry). Montado como child
  del `<group>` del board en `FurnitureScene3D` (local frame = resolver frame,
  sin offset). Material `meshPhysicalMaterial` vía `boardPhysicalResponse`
  directo. Thread de `resolvedHardwarePlacements` + `hardwareCatalog` en los 4
  call sites (Project3DModal, ProjectSpatialStudio, ProjectPresentationMode,
  ProductionOrderViewsPanel). +19 tests en `HardwareMesh.test.tsx`.

## Board-local-frame finding (CRÍTICO)

El `<group>` del board (`FurnitureScene3D.tsx:258`) se posiciona en
`visual.position` (min-corner) y su `<mesh>` lleva `position={[w/2,t/2,l/2]}`
para recentrar el `boxGeometry` centrado. ⇒ El local frame del group es
**[0,W]×[0,T]×[0,L]** — coincide EXACTO con el contrato del resolver. El
HardwareMesh se monta como child de ese `<group>` (sibling del `<mesh>`) **SIN
offset adicional**. `localPosition` del resolver cae exacto en la cara.

## Verificación

- `pnpm typecheck` (monorepo) → 6/6 Done.
- `pnpm test` → domain 418, ui 645, web 232, desktop 9 — todo verde, sin
  regresiones. Bridge no-regression test (VH-04) es la clave.

## ⚠️ MANUAL CHECK OWED (jsdom no tiene WebGL)

La renderización R3F de HardwareMesh **no se puede verificar en jsdom** (sin
WebGL, convención del repo — igual que BoardMeshMaterial/AmbientMeshes). La
geometry/pose pura está cubierta por tests; los pixels NO.

Pasos manuales:
1. `pnpm --filter @muebles/web dev`
2. Abrir un proyecto con un módulo cuyo componente (puerta/frente_cajon)
   tenga `overrides.hardwarePlacements` apuntando a un hardware con
   `previewShape: 'knob'` (+ `previewDiameterMm`, `previewProjectionMm`).
3. Abrir la vista 3D (Project3DModal o ProjectSpatialStudio).

Qué mirar:
- La perilla está sobre la **cara frontal** de la puerta (no hundida en el
  tablero, ni flotando separada). Proyecta hacia afuera (+Y) por
  `previewProjectionMm`.
- Swap a un hardware sin `previewShape` → la perilla desaparece (VH-09).
- Bar-pull: la barra horizontal perpendicular al normal, con exactamente 2
  soportes (D3).
- Material respeta `previewMetalness`/`previewRoughness`/`previewClearcoat`
  (metal brillante vs plástico mate).

Si la perilla está hundida o flotando, el offset del local frame está mal
(no debería, dado el finding arriba) — revisar `hardwarePlacementPosition`.
