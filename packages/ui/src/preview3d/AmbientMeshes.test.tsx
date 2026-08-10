/**
 * @vitest-environment jsdom
 *
 * Ambient 3D meshes + FurnitureScene3D ambient wiring.
 * Spec #4149 (Ambient Scene Rendering), design #4151 (3D Scene Design).
 *
 * jsdom has NO WebGL, so R3F <Canvas>/<mesh> rendering cannot be exercised
 * here. This mirrors the repo convention: every caller mocks the preview3d
 * viewer in jsdom (e.g. ProjectSpatialStudio.test.tsx mocks `../../preview3d`,
 * Module3DModal.test.tsx mocks Furniture3DViewer), and FurnitureScene3D itself
 * is never rendered in jsdom anywhere. BoardMeshMaterial.tsx (the sibling R3F
 * material component) follows the same split: its pure logic lives in
 * boardPartVisual.ts (jsdom-tested) and the R3F rendering is not jsdom-tested.
 *
 * Following that pattern, the ambient acceptance criteria are expressed as a
 * PURE decision layer consumed by FurnitureScene3D, which we test directly:
 *  (a) `planAmbientScene` — the FurnitureScene3D wiring decision (catalog
 *      gating, backward-compat defaults, ceiling default-off, room-box gating);
 *  (b) pure material resolution (resolveFloorColor / resolveWallColor / PBR) —
 *      proves the color/PBR each mesh applies;
 *  (c) smoke checks that all five mesh components are exported React components.
 *
 * Actual WebGL pixel rendering is verified via the runtime harness (apps/web
 * Vite dev, Project 3D preview) — see Work Unit Evidence.
 */
import { describe, expect, it } from 'vitest';
import type { AmbientMaterial } from '@muebles/domain';
import {
  BaseboardMesh,
  BackWallMesh,
  CeilingMesh,
  FloorAmbientMesh,
  WallAmbientMesh,
  PAINT_HOVER_COLOR,
  PAINT_HOVER_OPACITY,
  planAmbientScene,
  resolveFloorColor,
  resolveFloorPhysical,
  resolveWallColor,
  resolveWallPhysical,
} from './AmbientMeshes';

const floorMat: AmbientMaterial = {
  id: 'floor-1',
  code: 'CERAMIC',
  name: 'Cerámica blanca',
  active: true,
  surfaceType: 'floor',
  previewColor: '#eeeeee',
  previewTextureUrl: '/api/media/ceramic.png',
  previewTextureTileWidthMm: 400,
  previewTextureTileLengthMm: 400,
  previewRoughness: 0.3,
  previewMetalness: 0.1,
  previewClearcoat: 0.2,
};

const wallMat: AmbientMaterial = {
  id: 'wall-1',
  code: 'PORCELAIN',
  name: 'Porcelanato',
  active: true,
  surfaceType: 'wall',
  previewColor: '#d8d2c8',
  previewTextureUrl: '/api/media/porcelain.png',
  previewTextureTileWidthMm: 300,
  previewTextureTileLengthMm: 600,
};

// ---------------------------------------------------------------------------
// planAmbientScene — the FurnitureScene3D ambient wiring decision.
// This IS the spec acceptance criteria (catalog gating, backward-compat,
// ceiling default-off, room-box gating) expressed as a pure function.
// ---------------------------------------------------------------------------

describe('planAmbientScene — FurnitureScene3D ambient wiring', () => {
  it('enables ambient floor/wall + room box in present mode (spec: room box in present)', () => {
    const plan = planAmbientScene({
      lightMode: 'present',
      ambientFloor: floorMat,
      ambientWall: wallMat,
      showCeiling: true,
      showFloor: true,
    });
    expect(plan.ambientFloor).toBe(true);
    expect(plan.ambientWall).toBe(true);
    expect(plan.roomBox).toBe(true);
    expect(plan.ceiling).toBe(true);
  });

  it('excludes ALL ambient + room box in catalog mode (spec: catalog excludes ambient)', () => {
    const plan = planAmbientScene({
      lightMode: 'catalog',
      ambientFloor: floorMat,
      ambientWall: wallMat,
      showCeiling: true,
      showFloor: true,
    });
    expect(plan.ambientFloor).toBe(false);
    expect(plan.ambientWall).toBe(false);
    expect(plan.roomBox).toBe(false);
    expect(plan.ceiling).toBe(false);
    // ContactShadows is omitted entirely in catalog (today's behavior).
    expect(plan.contactShadow).toBeNull();
  });

  it('ceiling defaults OFF when showCeiling absent even with ambient (spec: ceiling default off)', () => {
    const plan = planAmbientScene({
      lightMode: 'present',
      ambientFloor: floorMat,
      showFloor: true,
    });
    expect(plan.roomBox).toBe(true);
    expect(plan.ceiling).toBe(false);
  });

  it('renders nothing ambient when no ambient material is passed (backward-compat)', () => {
    const plan = planAmbientScene({ lightMode: 'present', showFloor: true });
    expect(plan.ambientFloor).toBe(false);
    expect(plan.ambientWall).toBe(false);
    expect(plan.roomBox).toBe(false);
    expect(plan.ceiling).toBe(false);
  });

  it('enables ambient in workshop and soft modes too (not catalog-only gating)', () => {
    for (const mode of ['workshop', 'soft'] as const) {
      const plan = planAmbientScene({
        lightMode: mode,
        ambientFloor: floorMat,
        showFloor: true,
      });
      expect(plan.ambientFloor).toBe(true);
      expect(plan.roomBox).toBe(true);
    }
  });

  it('suppresses ambient floor when showFloor is false (module inspect path)', () => {
    const plan = planAmbientScene({
      lightMode: 'present',
      ambientFloor: floorMat,
      showFloor: false,
    });
    expect(plan.ambientFloor).toBe(false);
  });

  it('enables room box from wall-only ambient (back wall + baseboards without floor)', () => {
    const plan = planAmbientScene({
      lightMode: 'present',
      ambientWall: wallMat,
    });
    expect(plan.ambientFloor).toBe(false);
    expect(plan.ambientWall).toBe(true);
    expect(plan.roomBox).toBe(true);
  });

  // --- ContactShadows tuning (spec: ContactShadows tuning) ---

  it('tunes ContactShadows for a light floor (opacity reduced vs default 0.32)', () => {
    const plan = planAmbientScene({
      lightMode: 'present',
      ambientFloor: floorMat, // previewColor #eeeeee → light band
      showFloor: true,
    });
    expect(plan.contactShadow).not.toBeNull();
    expect(plan.contactShadow!.opacity).toBeLessThan(0.32);
  });

  it('keeps ContactShadows at the default 0.32 with NO ambient floor (backward-compat)', () => {
    const plan = planAmbientScene({ lightMode: 'present', showFloor: true });
    expect(plan.contactShadow).toEqual({ opacity: 0.32, color: '#000000' });
  });

  it('omits ContactShadows in catalog mode regardless of ambient floor', () => {
    const plan = planAmbientScene({
      lightMode: 'catalog',
      ambientFloor: floorMat,
      showFloor: true,
    });
    expect(plan.contactShadow).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Material resolution — proves the color/PBR each mesh applies, with the
// backward-compat defaults baked in (spec MODIFIED: no-regression).
// ---------------------------------------------------------------------------

describe('resolveFloorColor', () => {
  it('uses the material previewColor when provided', () => {
    expect(resolveFloorColor(floorMat)).toBe('#eeeeee');
  });

  it('falls back to the hardcoded #2a2d31 when no material (backward-compat)', () => {
    expect(resolveFloorColor(undefined)).toBe('#2a2d31');
  });

  it('falls back to #2a2d31 when material has no previewColor', () => {
    expect(
      resolveFloorColor({ ...floorMat, previewColor: undefined }),
    ).toBe('#2a2d31');
  });
});

describe('resolveWallColor', () => {
  it('uses the material previewColor when provided', () => {
    expect(resolveWallColor(wallMat)).toBe('#d8d2c8');
  });

  it('falls back to the hardcoded #8b9098 when no material (backward-compat)', () => {
    expect(resolveWallColor(undefined)).toBe('#8b9098');
  });
});

describe('resolveFloorPhysical', () => {
  it('uses explicit preview PBR overrides when the material defines them', () => {
    const phys = resolveFloorPhysical(floorMat, 'present');
    expect(phys.roughness).toBe(0.3);
    expect(phys.metalness).toBe(0.1);
    expect(phys.clearcoat).toBe(0.2);
  });

  it('falls back to mode-adaptive board PBR when material is absent (backward-compat)', () => {
    const phys = resolveFloorPhysical(undefined, 'present');
    // Solid-color present defaults from boardPhysicalResponse.
    expect(phys.roughness).toBeCloseTo(0.44, 5);
    expect(phys.metalness).toBeCloseTo(0.04, 5);
    expect(phys.clearcoat).toBeCloseTo(0.28, 5);
  });

  it('uses partial overrides and falls back for the rest', () => {
    const phys = resolveFloorPhysical(
      { ...floorMat, previewRoughness: 0.5, previewMetalness: undefined, previewClearcoat: undefined },
      'present',
    );
    expect(phys.roughness).toBe(0.5);
    // metalness/clearcoat fall back to the textured-present base (hasMap true).
    expect(phys.metalness).toBeCloseTo(0.03, 5);
    expect(phys.clearcoat).toBeCloseTo(0.15, 5);
  });
});

describe('resolveWallPhysical', () => {
  it('mirrors floor physical resolution', () => {
    expect(resolveWallPhysical(wallMat, 'present').roughness).toBeCloseTo(
      0.52,
      5,
    );
    expect(resolveWallPhysical(undefined, 'present').roughness).toBeCloseTo(
      0.44,
      5,
    );
  });
});

// ---------------------------------------------------------------------------
// Mesh component exports — smoke checks (R3F rendering needs WebGL; the repo
// convention is to mock the viewer in jsdom, never rendering <Canvas>).
// ---------------------------------------------------------------------------

describe('ambient mesh components are exported React components', () => {
  it('exports FloorAmbientMesh', () => {
    expect(typeof FloorAmbientMesh).toBe('function');
  });
  it('exports WallAmbientMesh', () => {
    expect(typeof WallAmbientMesh).toBe('function');
  });
  it('exports BackWallMesh', () => {
    expect(typeof BackWallMesh).toBe('function');
  });
  it('exports CeilingMesh', () => {
    expect(typeof CeilingMesh).toBe('function');
  });
  it('exports BaseboardMesh', () => {
    expect(typeof BaseboardMesh).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Paint hover overlay constants (F067). The actual overlay rendering happens
// inside the R3F <mesh> (not jsdom-testable); we verify the exported constants
// that drive the overlay color/opacity so the visual contract is locked.
// ---------------------------------------------------------------------------

describe('paint hover overlay constants (F067)', () => {
  it('exports PAINT_HOVER_COLOR as a green hex', () => {
    expect(PAINT_HOVER_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
    expect(PAINT_HOVER_COLOR).toBe('#4ade80');
  });

  it('exports PAINT_HOVER_OPACITY between 0 and 1', () => {
    expect(PAINT_HOVER_OPACITY).toBeGreaterThan(0);
    expect(PAINT_HOVER_OPACITY).toBeLessThanOrEqual(1);
  });
});
