// @vitest-environment jsdom
/**
 * BoardMesh — keyed rendering of repeated hardware placements (#813).
 *
 * jsdom has no WebGL, so the R3F <mesh>/<group> subtree renders as inert JSX
 * (same convention as HardwareMesh.test.tsx; drei <Edges>/useTexture stay out
 * of these cases because they require a real Canvas). React still reconciles
 * the children list and validates keys, which is exactly the contract under
 * test: two placements of the SAME hardware on ONE board (e.g. two hinges of
 * one model on a door) must render as distinct children. componentInstanceId
 * is the board part id by construction, and HardwarePlacement has no
 * per-entry id, so the array index is the only discriminator.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hardware, ResolvedHardwarePlacement } from '@granete/domain';
import { BoardMesh } from './BoardMesh';
import type { BoardPartVisual } from './boardPartVisual';

const PART_ID = 'agr-demo-u0c-puerta-copy-0';

const hinge: Hardware = {
  id: 'hw-hinge',
  code: 'HW-HINGE',
  name: 'Bisagra',
  unit: 'piece',
  costPerUnit: 0,
  active: true,
  previewShape: 'hinge',
  previewSizeMm: 96,
  previewProjectionMm: 25,
  previewColor: '#888888',
  previewMetalness: 0.9,
  previewRoughness: 0.25,
};

const visual: BoardPartVisual = {
  id: PART_ID,
  description: 'Puerta',
  optionRole: 'door',
  materialId: 'mat-mdf',
  size: [596, 18, 720],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  color: '#cccccc',
  grain: 0,
};

function placement(over: Partial<ResolvedHardwarePlacement>): ResolvedHardwarePlacement {
  return {
    componentInstanceId: PART_ID,
    hardwareId: hinge.id,
    localPosition: [100, 18, 150],
    localNormal: [0, 1, 0],
    standoffMm: 25,
    scale: 1,
    rotationDeg: { x: 0, y: 0, z: 0 },
    ...over,
  };
}

const twoHingePlacements: readonly ResolvedHardwarePlacement[] = [
  placement({ localPosition: [100, 18, 150] }),
  placement({ localPosition: [100, 18, 570] }),
];

const hardwareCatalog = new Map<string, Hardware>([[hinge.id, hinge]]);

function duplicateKeyErrors(): string[] {
  return vi.mocked(console.error).mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.includes('Encountered two children with the same key'));
}

describe('BoardMesh — repeated hardware placements on one board (#813)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders two placements of the same hardware without duplicate React keys', () => {
    vi.spyOn(console, 'error');
    const { container } = render(
      <BoardMesh
        visual={visual}
        hardwarePlacements={twoHingePlacements}
        hardwareCatalog={hardwareCatalog}
      />,
    );

    expect(duplicateKeyErrors()).toEqual([]);
    expect(
      container.querySelectorAll('[data-testid="hardware-mesh-group"]'),
    ).toHaveLength(2);
  });

  it('keeps keys stable across re-renders of the same placements', () => {
    vi.spyOn(console, 'error');
    const { container, rerender } = render(
      <BoardMesh
        visual={visual}
        hardwarePlacements={twoHingePlacements}
        hardwareCatalog={hardwareCatalog}
      />,
    );
    rerender(
      <BoardMesh
        visual={visual}
        hardwarePlacements={twoHingePlacements}
        hardwareCatalog={hardwareCatalog}
        dimmed
      />,
    );

    expect(duplicateKeyErrors()).toEqual([]);
    expect(
      container.querySelectorAll('[data-testid="hardware-mesh-group"]'),
    ).toHaveLength(2);
  });

  it('reports a distinct selection id per repeated placement', () => {
    vi.spyOn(console, 'error');
    const onSelectHardwareId = vi.fn();
    const { container } = render(
      <BoardMesh
        visual={visual}
        hardwarePlacements={twoHingePlacements}
        hardwareCatalog={hardwareCatalog}
        onSelectHardwareId={onSelectHardwareId}
      />,
    );

    const groups = container.querySelectorAll('[data-testid="hardware-mesh-group"]');
    fireEvent.click(groups[0]!);
    fireEvent.click(groups[1]!);

    expect(onSelectHardwareId).toHaveBeenCalledTimes(2);
    const [first, second] = onSelectHardwareId.mock.calls.map((call) => call[0]);
    expect(first).not.toBe(second);
    expect(first!.startsWith(`${PART_ID}:${hinge.id}:`)).toBe(true);
    expect(second!.startsWith(`${PART_ID}:${hinge.id}:`)).toBe(true);
  });
});
