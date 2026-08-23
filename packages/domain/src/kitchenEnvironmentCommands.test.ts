/**
 * F145/#311 — environment authoring commands: walls + openings.
 */

import { describe, expect, it } from 'vitest';
import {
  addOpening,
  addWall,
  MIN_OPENING_WIDTH_MM,
  MIN_WALL_LENGTH_MM,
  removeOpening,
  removeWall,
  ROOM_WALL_HEIGHT_MM,
  splitWallSegments,
  updateOpening,
  updateWall,
  wallInwardNormal,
  wallsOccludingCamera,
} from './kitchenEnvironmentCommands';
import {
  emptyKitchenLayout,
  ensureKitchenSpaces,
  addKitchenSpace,
  kitchenLayoutWarnings,
  resolveWallFrames,
} from './kitchenLayout';
import type { KitchenWall, ProjectKitchenLayout } from './types';

let seq = 0;
const newId = () => `id-${++seq}`;

function layoutWithWalls(
  walls: KitchenWall[],
  placements: ProjectKitchenLayout['placements'] = [],
): ProjectKitchenLayout {
  // Forma legacy (walls top-level, sin spaces) → ensureKitchenSpaces los envuelve
  // en el espacio default «Cocina».
  return ensureKitchenSpaces({
    walls,
    placements,
    spaces: undefined,
    activeSpaceId: undefined,
  } as ProjectKitchenLayout);
}

const WALL_A: KitchenWall = {
  id: 'w-a',
  name: 'Muro A',
  lengthMm: 3000,
  angleDeg: 0,
  originXMm: 0,
  originYMm: 0,
};

describe('addWall', () => {
  it('encadena desde el extremo del último muro girando +90°', () => {
    const layout = layoutWithWalls([WALL_A]);
    const res = addWall(layout, { lengthMm: 2500 }, newId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.walls).toHaveLength(2);
    const b = res.layout.walls[1]!;
    expect(b.angleDeg).toBe(90);
    expect(b.originXMm).toBe(3000);
    expect(b.originYMm).toBe(0);
    expect(b.lengthMm).toBe(2500);
    // Encadenado: el extremo de B sigue la dirección del ángulo.
    const frames = resolveWallFrames(res.layout.walls);
    expect(frames[1]!.endXMm).toBe(3000);
    expect(frames[1]!.endYMm).toBe(2500);
  });

  it('primer muro arranca en 0° y origen (0,0)', () => {
    const res = addWall(emptyKitchenLayout(), { lengthMm: 1800 }, newId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.walls[0]!.angleDeg).toBe(0);
    expect(res.layout.walls[0]!.originXMm).toBe(0);
  });

  it('rechaza largos inválidos con mensaje que enseña', () => {
    const res = addWall(layoutWithWalls([WALL_A]), { lengthMm: 50 }, newId);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain(`${MIN_WALL_LENGTH_MM} mm`);
  });

  it('escribe sólo en el espacio activo (multi-space safe)', () => {
    const base = layoutWithWalls([WALL_A]);
    const twoSpaces = addKitchenSpace(base, 'Baño', newId);
    // addKitchenSpace cambia al espacio nuevo (vacío).
    const res = addWall(twoSpaces, { lengthMm: 1200 }, newId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.walls).toHaveLength(1); // sólo el muro nuevo en Baño
    expect(res.layout.walls[0]!.lengthMm).toBe(1200);
    const cocina = res.layout.spaces!.find((s) => s.name === 'Cocina')!;
    expect(cocina.walls).toHaveLength(1); // Muro A intacto
    expect(cocina.walls[0]!.id).toBe('w-a');
  });
});

describe('updateWall', () => {
  it('edita largo y nombre', () => {
    const res = updateWall(layoutWithWalls([WALL_A]), 'w-a', {
      lengthMm: 4000,
      name: 'Muro largo',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.walls[0]!.lengthMm).toBe(4000);
    expect(res.layout.walls[0]!.name).toBe('Muro largo');
  });

  it('rechaza acortar por debajo de un hueco existente', () => {
    const layout = layoutWithWalls([
      { ...WALL_A, openings: [{ id: 'o1', kind: 'window', offsetMm: 2500, widthMm: 400 }] },
    ]);
    const res = updateWall(layout, 'w-a', { lengthMm: 2600 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('wall-shrunk-below-openings');
    expect(res.message).toContain('fuera del muro');
  });
});

describe('removeWall', () => {
  it('elimina el muro, descoloca sus muebles y reporta el conteo', () => {
    const layout: ProjectKitchenLayout = {
      ...layoutWithWalls([WALL_A]),
      placements: [
        { itemId: 'it1', instanceIndex: 0, wallId: 'w-a', offsetMm: 0, elevation: 'floor' },
        { itemId: 'it1', instanceIndex: 1, wallId: 'w-a', offsetMm: 700, elevation: 'floor' },
      ],
    };
    const res = removeWall(layout, 'w-a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.walls).toHaveLength(0);
    expect(res.layout.placements).toHaveLength(0);
    expect(res.unplacedCount).toBe(2);
  });

  it('conserva las islas libres aunque compartan wallId', () => {
    const layout: ProjectKitchenLayout = {
      ...layoutWithWalls([WALL_A]),
      placements: [
        {
          itemId: 'it1', instanceIndex: 0, wallId: 'w-a', offsetMm: 0,
          elevation: 'floor', mode: 'free', freeXMm: 800, freeYMm: 900,
        },
      ],
    };
    const res = removeWall(layout, 'w-a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.placements).toHaveLength(1);
    // Sin conteo que enseñar: la key no viaja.
    expect(res.unplacedCount).toBeUndefined();
  });
});

describe('addOpening / updateOpening / removeOpening', () => {
  it('aplica defaults por tipo (ventana 1200/900)', () => {
    const res = addOpening(
      layoutWithWalls([WALL_A]),
      'w-a',
      { kind: 'window', offsetMm: 1000, widthMm: 1200 },
      newId,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const o = res.layout.walls[0]!.openings![0]!;
    expect(o.heightMm).toBe(1200);
    expect(o.sillMm).toBe(900);
  });

  it('rechaza hueco que no entra en el muro', () => {
    const res = addOpening(
      layoutWithWalls([WALL_A]),
      'w-a',
      { kind: 'door', offsetMm: 2500, widthMm: 900 },
      newId,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('opening-out-of-wall');
    expect(res.message).toContain('no entra');
  });

  it('rechaza solape con otro hueco enseñando dónde está el otro', () => {
    const layout = layoutWithWalls([
      { ...WALL_A, openings: [{ id: 'o1', kind: 'window', offsetMm: 1000, widthMm: 1000 }] },
    ]);
    const res = addOpening(
      layout,
      'w-a',
      { kind: 'door', offsetMm: 1800, widthMm: 900 },
      newId,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('opening-overlap');
    expect(res.message).toContain('Ventana');
  });

  it('rechaza altura que supera el muro', () => {
    const res = addOpening(
      layoutWithWalls([WALL_A]),
      'w-a',
      { kind: 'window', offsetMm: 0, widthMm: 800, heightMm: 2000, sillMm: 900 },
      newId,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('opening-out-of-height');
  });

  it('editar valida contra pares pero no contra sí mismo', () => {
    const layout = layoutWithWalls([
      {
        ...WALL_A,
        openings: [
          { id: 'o1', kind: 'window', offsetMm: 0, widthMm: 800 },
          { id: 'o2', kind: 'window', offsetMm: 1500, widthMm: 800 },
        ],
      },
    ]);
    const ok = updateOpening(layout, 'w-a', 'o2', { offsetMm: 900 });
    expect(ok.ok).toBe(true);
    const clash = updateOpening(layout, 'w-a', 'o2', { offsetMm: 400 });
    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.reason).toBe('opening-overlap');
  });

  it('cambiar el tipo re-resuelve defaults coherentes', () => {
    const layout = layoutWithWalls([
      { ...WALL_A, openings: [{ id: 'o1', kind: 'pass', offsetMm: 0, widthMm: 800, heightMm: 900, sillMm: 1050 }] },
    ]);
    const res = updateOpening(layout, 'w-a', 'o1', { kind: 'door' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const o = res.layout.walls[0]!.openings![0]!;
    expect(o.kind).toBe('door');
    expect(o.sillMm).toBe(1050); // conserva el explícito
  });

  it('remove elimina el hueco y la key openings cuando queda vacío', () => {
    const layout = layoutWithWalls([
      { ...WALL_A, openings: [{ id: 'o1', kind: 'door', offsetMm: 0, widthMm: 900 }] },
    ]);
    const res = removeOpening(layout, 'w-a', 'o1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.layout.walls[0]!.openings).toBeUndefined();
  });

  it('rechaza ancho menor al mínimo', () => {
    const res = addOpening(
      layoutWithWalls([WALL_A]),
      'w-a',
      { kind: 'pass', offsetMm: 0, widthMm: 40 },
      newId,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain(`${MIN_OPENING_WIDTH_MM} mm`);
  });
});

describe('splitWallSegments', () => {
  it('muro sin huecos = un segmento de altura completa', () => {
    const segs = splitWallSegments(WALL_A);
    expect(segs).toEqual([
      { startMm: 0, lengthMm: 3000, zBottomMm: 0, zTopMm: ROOM_WALL_HEIGHT_MM },
    ]);
  });

  it('ventana produce antepecho, dintel y tramos sólidos laterales', () => {
    const wall: KitchenWall = {
      ...WALL_A,
      openings: [{ id: 'o1', kind: 'window', offsetMm: 1000, widthMm: 1000, heightMm: 1200, sillMm: 900 }],
    };
    const segs = splitWallSegments(wall);
    expect(segs).toEqual([
      { startMm: 0, lengthMm: 1000, zBottomMm: 0, zTopMm: 2400 },
      { startMm: 1000, lengthMm: 1000, zBottomMm: 0, zTopMm: 900 },
      { startMm: 1000, lengthMm: 1000, zBottomMm: 2100, zTopMm: 2400 },
      { startMm: 2000, lengthMm: 1000, zBottomMm: 0, zTopMm: 2400 },
    ]);
  });

  it('puerta a piso no genera antepecho', () => {
    const wall: KitchenWall = {
      ...WALL_A,
      openings: [{ id: 'o1', kind: 'door', offsetMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 }],
    };
    const segs = splitWallSegments(wall);
    expect(segs).toEqual([
      { startMm: 0, lengthMm: 900, zBottomMm: 2100, zTopMm: 2400 },
      { startMm: 900, lengthMm: 2100, zBottomMm: 0, zTopMm: 2400 },
    ]);
  });

  it('huecos contiguos no duplican tramos', () => {
    const wall: KitchenWall = {
      ...WALL_A,
      openings: [
        { id: 'o1', kind: 'door', offsetMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
        { id: 'o2', kind: 'window', offsetMm: 900, widthMm: 800, heightMm: 1200, sillMm: 900 },
      ],
    };
    const segs = splitWallSegments(wall);
    // 0–900: dintel puerta. 900–1700: antepecho + dintel ventana. 1700–3000: sólido.
    expect(segs).toEqual([
      { startMm: 0, lengthMm: 900, zBottomMm: 2100, zTopMm: 2400 },
      { startMm: 900, lengthMm: 800, zBottomMm: 0, zTopMm: 900 },
      { startMm: 900, lengthMm: 800, zBottomMm: 2100, zTopMm: 2400 },
      { startMm: 1700, lengthMm: 1300, zBottomMm: 0, zTopMm: 2400 },
    ]);
  });

  it('hueco que excede el muro se recorta sin segmentos negativos', () => {
    const wall: KitchenWall = {
      ...WALL_A,
      openings: [{ id: 'o1', kind: 'pass', offsetMm: 2900, widthMm: 500, heightMm: 900, sillMm: 1050 }],
    };
    const segs = splitWallSegments(wall);
    expect(segs.every((s) => s.lengthMm > 0 && s.zTopMm > s.zBottomMm)).toBe(true);
    // Tramo sólido completo hasta el borde + antepecho y dintel del hueco recortado.
    expect(segs[0]).toEqual({ startMm: 0, lengthMm: 2900, zBottomMm: 0, zTopMm: 2400 });
    expect(segs[segs.length - 1]).toEqual({
      startMm: 2900, lengthMm: 100, zBottomMm: 1950, zTopMm: 2400,
    });
  });
});

describe('wallsOccludingCamera', () => {
  const walls = resolveWallFrames([
    WALL_A, // +X en y=0, interior hacia +Y
    { id: 'w-b', name: 'Muro B', lengthMm: 2500, angleDeg: 90, originXMm: 3000, originYMm: 0 },
  ]);

  it('muro sur visible desde el norte (vista frontal)', () => {
    const hidden = wallsOccludingCamera(walls, 1500, 5000);
    expect(hidden.has('w-a')).toBe(false);
  });

  it('muro este oculto cuando la cámara está al este de su plano', () => {
    const hidden = wallsOccludingCamera(walls, 6000, 1250);
    expect(hidden.has('w-b')).toBe(true);
    expect(hidden.has('w-a')).toBe(false);
  });

  it('normal interior apunta a la habitación en la L por defecto', () => {
    const n0 = wallInwardNormal(0);
    expect(Math.abs(n0.x)).toBeLessThan(1e-9);
    expect(n0.y).toBeCloseTo(1, 9);
    const n90 = wallInwardNormal(90);
    expect(n90.x).toBeCloseTo(-1, 9);
    expect(Math.abs(n90.y)).toBeLessThan(1e-9);
  });
});

describe('kitchenLayoutWarnings — huecos', () => {
  const items = [{ id: 'it1', moduleId: 'm1', quantity: 1, optionChoices: {} }];
  const footprints = [{ itemId: 'it1', instanceIndex: 0, width: 600, height: 720, depth: 580 }];

  it('avisa cuando un mueble tapa un hueco', () => {
    const layout: ProjectKitchenLayout = {
      ...layoutWithWalls([
        { ...WALL_A, openings: [{ id: 'o1', kind: 'window', offsetMm: 0, widthMm: 1000 }] },
      ]),
      placements: [
        { itemId: 'it1', instanceIndex: 0, wallId: 'w-a', offsetMm: 200, elevation: 'floor' },
      ],
    };
    const warnings = kitchenLayoutWarnings(layout, items, footprints);
    expect(warnings.some((w) => w.includes('tapa la ventana'))).toBe(true);
  });

  it('sin aviso cuando el mueble no toca el hueco', () => {
    const layout: ProjectKitchenLayout = {
      ...layoutWithWalls([
        { ...WALL_A, openings: [{ id: 'o1', kind: 'door', offsetMm: 0, widthMm: 900 }] },
      ]),
      placements: [
        { itemId: 'it1', instanceIndex: 0, wallId: 'w-a', offsetMm: 1500, elevation: 'floor' },
      ],
    };
    const warnings = kitchenLayoutWarnings(layout, items, footprints);
    expect(warnings.some((w) => w.includes('tapa'))).toBe(false);
  });

  it('avisa cuando el hueco sobresale del muro', () => {
    const layout = layoutWithWalls([
      { ...WALL_A, openings: [{ id: 'o1', kind: 'window', offsetMm: 2600, widthMm: 800 }] },
    ]);
    const warnings = kitchenLayoutWarnings(layout, items, []);
    expect(warnings.some((w) => w.includes('sobresale'))).toBe(true);
  });
});
