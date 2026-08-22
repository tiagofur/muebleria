import { describe, expect, it } from 'vitest';
import {
  planBoxForModule,
  resolveDragGuide,
} from './dragGuides';

describe('resolveDragGuide', () => {
  const dragged = { minX: 620, maxX: 1220, minY: 0, maxY: 580 };

  it('marca el gap al vecino de la derecha', () => {
    const guide = resolveDragGuide(dragged, [
      { minX: 1240, maxX: 1840, minY: 0, maxY: 580 },
    ]);
    expect(guide).toEqual({
      kind: 'x',
      fromX: 1220,
      toX: 1240,
      atY: 290,
      gapMm: 20,
    });
  });

  it('marca el gap al vecino de la izquierda', () => {
    const guide = resolveDragGuide(dragged, [
      { minX: 0, maxX: 600, minY: 0, maxY: 580 },
    ]);
    expect(guide).toMatchObject({ kind: 'x', fromX: 600, toX: 620, gapMm: 20 });
  });

  it('el extremo del muro (par sintético de ancho 0) funciona igual', () => {
    const nearStart = { minX: 100, maxX: 680, minY: 0, maxY: 580 };
    const atStart = { minX: 0, maxX: 0, minY: 0, maxY: 580 };
    const guide = resolveDragGuide(nearStart, [atStart]);
    expect(guide).toMatchObject({ kind: 'x', gapMm: 100, fromX: 0, toX: 100 });
  });

  it('gap mayor al rango visible no dibuja guía', () => {
    const atStart = { minX: 0, maxX: 0, minY: 0, maxY: 580 };
    expect(resolveDragGuide(dragged, [atStart])).toBeNull();
  });

  it('ignora pares lejanos y devuelve null', () => {
    expect(
      resolveDragGuide(dragged, [
        { minX: 2000, maxX: 2600, minY: 0, maxY: 580 },
      ]),
    ).toBeNull();
  });

  it('ignora pares en otra banda de profundidad (otro muro)', () => {
    expect(
      resolveDragGuide(dragged, [
        { minX: 1240, maxX: 1840, minY: 2000, maxY: 2580 },
      ]),
    ).toBeNull();
  });

  it('elige el gap más chico entre varios candidatos', () => {
    const guide = resolveDragGuide(dragged, [
      { minX: 1500, maxX: 2100, minY: 0, maxY: 580 },
      { minX: 1250, maxX: 1850, minY: 0, maxY: 580 },
    ]);
    expect(guide).toMatchObject({ fromX: 1220, toX: 1250, gapMm: 30 });
  });

  it('gap en profundidad (eje Y) para islas', () => {
    const guide = resolveDragGuide(
      { minX: 0, maxX: 600, minY: 620, maxY: 1200 },
      [{ minX: 0, maxX: 600, minY: 0, maxY: 600 }],
    );
    expect(guide).toMatchObject({ kind: 'y', fromY: 600, toY: 620, gapMm: 20 });
  });
});

describe('planBoxForModule', () => {
  it('yaw 0 crece en +X/+Y', () => {
    expect(
      planBoxForModule({ originX: 100, originY: 200, width: 600, depth: 580 }),
    ).toEqual({ minX: 100, maxX: 700, minY: 200, maxY: 780 });
  });

  it('yaw 90 rota el footprint', () => {
    expect(
      planBoxForModule({
        originX: 1000,
        originY: 200,
        width: 600,
        depth: 580,
        yawDeg: 90,
      }),
    ).toEqual({ minX: 420, maxX: 1000, minY: 200, maxY: 800 });
  });
});
