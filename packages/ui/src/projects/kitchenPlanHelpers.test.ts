import { describe, expect, it } from 'vitest';
import {
  resolvePlacement2D,
  resolvePlanBounds,
} from './kitchenPlanHelpers';

describe('kitchenPlanHelpers — resolvePlacement2D', () => {
  it('positions cabinet on 0° top wall (+X) extending downwards (+Y) into room', () => {
    const wall = {
      originXMm: 0,
      originYMm: 0,
      angleDeg: 0,
      lengthMm: 3000,
    };
    const res = resolvePlacement2D({
      placement: {
        itemId: 'item-1',
        instanceIndex: 0,
        wallId: 'w1',
        offsetMm: 200,
        elevation: 'floor',
      },
      wallFrame: wall,
      widthMm: 600,
      depthMm: 560,
      label: 'Bajo mesada',
    });

    expect(res).not.toBeNull();
    expect(res!.yawDeg).toBe(0);
    expect(res!.boxMm).toEqual({
      minX: 200,
      maxX: 800,
      minY: 0,
      maxY: 560,
    });
    // Front face faces +Y (downwards)
    expect(res!.frontFaceMm).toEqual({
      x1: 200,
      y1: 560,
      x2: 800,
      y2: 560,
    });
  });

  it('positions cabinet on 90° right wall (+Y) extending to the left (-X) into room', () => {
    const wall = {
      originXMm: 3000,
      originYMm: 0,
      angleDeg: 90,
      lengthMm: 2500,
    };
    const res = resolvePlacement2D({
      placement: {
        itemId: 'item-1',
        instanceIndex: 0,
        wallId: 'w2',
        offsetMm: 300,
        elevation: 'floor',
      },
      wallFrame: wall,
      widthMm: 600,
      depthMm: 560,
    });

    expect(res).not.toBeNull();
    expect(res!.yawDeg).toBe(90);
    expect(res!.boxMm).toEqual({
      minX: 2440, // 3000 - 560
      maxX: 3000,
      minY: 300,
      maxY: 900,
    });
    // Front face faces -X (left edge)
    expect(res!.frontFaceMm).toEqual({
      x1: 2440,
      y1: 300,
      x2: 2440,
      y2: 900,
    });
  });

  it('positions cabinet on 180° bottom wall (-X) extending upwards (-Y) into room', () => {
    const wall = {
      originXMm: 3000,
      originYMm: 2500,
      angleDeg: 180,
      lengthMm: 3000,
    };
    const res = resolvePlacement2D({
      placement: {
        itemId: 'item-1',
        instanceIndex: 0,
        wallId: 'w3',
        offsetMm: 100,
        elevation: 'floor',
      },
      wallFrame: wall,
      widthMm: 600,
      depthMm: 560,
    });

    expect(res).not.toBeNull();
    expect(res!.yawDeg).toBe(180);
    expect(res!.boxMm).toEqual({
      minX: 2300, // 3000 - 100 - 600
      maxX: 2900, // 3000 - 100
      minY: 1940, // 2500 - 560
      maxY: 2500,
    });
    // Front face faces -Y (top edge)
    expect(res!.frontFaceMm).toEqual({
      x1: 2300,
      y1: 1940,
      x2: 2900,
      y2: 1940,
    });
  });

  it('positions cabinet on 270° left wall (-Y) extending to the right (+X) into room', () => {
    const wall = {
      originXMm: 0,
      originYMm: 2500,
      angleDeg: 270,
      lengthMm: 2500,
    };
    const res = resolvePlacement2D({
      placement: {
        itemId: 'item-1',
        instanceIndex: 0,
        wallId: 'w4',
        offsetMm: 100,
        elevation: 'wall',
      },
      wallFrame: wall,
      widthMm: 600,
      depthMm: 320, // alacena shallower depth
    });

    expect(res).not.toBeNull();
    expect(res!.yawDeg).toBe(270);
    expect(res!.elevation).toBe('wall');
    expect(res!.boxMm).toEqual({
      minX: 0,
      maxX: 320,
      minY: 1800, // 2400 - 600
      maxY: 2400, // 2500 - 100
    });
    // Front face faces +X (right edge)
    expect(res!.frontFaceMm).toEqual({
      x1: 320,
      y1: 1800,
      x2: 320,
      y2: 2400,
    });
  });

  it('positions free island placements with custom yaw', () => {
    const res = resolvePlacement2D({
      placement: {
        itemId: 'item-island',
        instanceIndex: 0,
        mode: 'free',
        freeXMm: 1200,
        freeYMm: 1000,
        freeYawDeg: 90,
      },
      widthMm: 1200,
      depthMm: 800,
      label: 'Isla Central',
    });

    expect(res).not.toBeNull();
    expect(res!.isFree).toBe(true);
    expect(res!.yawDeg).toBe(90);
    expect(res!.boxMm).toEqual({
      minX: 400, // 1200 - 800
      maxX: 1200,
      minY: 1000,
      maxY: 2200, // 1000 + 1200
    });
    expect(res!.frontFaceMm).toEqual({
      x1: 400,
      y1: 1000,
      x2: 400,
      y2: 2200,
    });
  });

  it('classifies furnitureType alto as despensa with distinct category and theme', () => {
    const wall = {
      originXMm: 0,
      originYMm: 0,
      angleDeg: 0,
      lengthMm: 3000,
    };
    const res = resolvePlacement2D({
      placement: {
        itemId: 'item-despensa',
        instanceIndex: 0,
        wallId: 'w1',
        offsetMm: 0,
        elevation: 'floor',
      },
      wallFrame: wall,
      widthMm: 600,
      depthMm: 600,
      heightMm: 2100,
      furnitureType: 'alto',
      label: 'Torre Despensa',
    });

    expect(res).not.toBeNull();
    expect(res!.category).toBe('alto');
    expect(res!.furnitureType).toBe('alto');
  });
});

describe('kitchenPlanHelpers — resolvePlanBounds', () => {
  it('encloses walls and placements safely', () => {
    const bounds = resolvePlanBounds({
      wallFrames: [
        { originXMm: 0, originYMm: 0, endXMm: 3000, endYMm: 0 },
      ],
      placements: [
        {
          itemId: 'it1',
          instanceIndex: 0,
          label: 'Test',
          shortCode: 'T1',
          elevation: 'floor',
          category: 'base',
          isFree: false,
          widthMm: 600,
          depthMm: 560,
          heightMm: 720,
          originXMm: 100,
          originYMm: 0,
          yawDeg: 0,
          boxMm: { minX: 100, maxX: 700, minY: 0, maxY: 560 },
          frontFaceMm: { x1: 100, y1: 560, x2: 700, y2: 560 },
        },
      ],
    });

    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBe(3000);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(1000); // respects minDimensionMm
    expect(bounds.widthMm).toBe(3000);
    expect(bounds.heightMm).toBe(1000);
  });
});
