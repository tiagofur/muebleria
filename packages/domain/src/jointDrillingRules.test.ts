/**
 * Parametric joint drilling rules (F129) — unit + golden sobre el gabete demo.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOINT_DRILLING_RULES,
  deriveJointHardwarePlacements,
  hingePositions,
  jointFastenerPositions,
  type JointPart,
} from './jointDrillingRules';
import { resolveBom } from './engine/bom';
import { resolvePartDrilling } from './partDrillingResolver';
import { IDS, plantillaChoices, plantillaCatalogWithModules } from './__fixtures__/plantillaDemo';
import type { Hardware, ResolvedBoardPart } from './types';

const hardwareCatalog: readonly Hardware[] = plantillaCatalogWithModules.hardware;

function part(over: Partial<JointPart> & { id: string }): JointPart {
  return {
    description: 'pieza',
    quantity: 1,
    lengthMm: 720,
    widthMm: 560,
    grain: 0,
    edges: [],
    optionRole: 'INTERIOR',
    materialId: 'm1',
    thicknessMm: 18,
    ...over,
  } as JointPart;
}

describe('jointFastenerPositions', () => {
  it('span corto: sólo extremos sin intermedios', () => {
    expect(jointFastenerPositions(560, 50, 512, 32)).toEqual([50, 510]);
  });

  it('span largo: inserta intermedios snapped a la grilla 32', () => {
    expect(jointFastenerPositions(1200, 50, 512, 32)).toEqual([50, 416, 768, 1150]);
  });

  it('span mínimo: una sola posición centrada', () => {
    expect(jointFastenerPositions(120, 50, 512, 32)).toEqual([64]);
  });
});

describe('hingePositions', () => {
  it('puerta ≤ 800: 2 bisagras en los extremos', () => {
    expect(hingePositions(717, 100, 32)).toEqual([100, 617]);
  });

  it('puerta 1400: 3 bisagras con centro snapped', () => {
    expect(hingePositions(1400, 100, 32)).toEqual([100, 704, 1300]);
  });
});

describe('deriveJointHardwarePlacements — unidades', () => {
  it('sin herraje con ese código, la unión no aporta placements', () => {
    const out = deriveJointHardwarePlacements({
      parts: [
        part({ id: 'lat-1', componentPlacement: 'lateral_izquierdo' }),
        part({ id: 'piso-1', componentPlacement: 'base' }),
      ],
      hardware: [],
    });
    expect(out).toHaveLength(0);
  });

  it('override de reglas se respeta (endMargin custom, sin taquetes)', () => {
    const out = deriveJointHardwarePlacements({
      parts: [
        part({ id: 'lat-1', componentPlacement: 'lateral_izquierdo' }),
        part({ id: 'piso-1', componentPlacement: 'base' }),
      ],
      hardware: hardwareCatalog,
      rules: {
        ...DEFAULT_JOINT_DRILLING_RULES,
        sideToFloor: { endMarginMm: 80, withDowels: false },
      },
    });
    const cam = out.filter((p) => p.partId === 'lat-1' && p.partRole === 'cam');
    expect(cam.map((p) => p.relativePosition.xMm).sort((a, b) => a - b)).toEqual([80, 480]);
    expect(out.some((p) => p.hardwareId === IDS.hwTaquete)).toBe(false);
  });
});

describe('deriveJointHardwarePlacements — golden gabete demo (300×720×590)', () => {
  const module = plantillaCatalogWithModules.modules.find((m) => m.id === IDS.modGab)!;
  const bom = resolveBom(module, plantillaChoices, plantillaCatalogWithModules);
  const parts = bom.boardParts as readonly JointPart[];
  const placements = deriveJointHardwarePlacements({
    parts,
    hardware: hardwareCatalog,
  });

  it('el BOM expone componentPlacement en las piezas compuestas', () => {
    const placements2 = new Set(parts.map((p) => p.componentPlacement));
    expect(placements2.has('lateral_izquierdo')).toBe(true);
    expect(placements2.has('base')).toBe(true);
    expect(placements2.has('trasera')).toBe(true);
    expect(placements2.has('puerta')).toBe(true);
  });

  it('golden: posiciones minifix/dowel/bisagra del gabete', () => {
    const byJoint = (j: string) => placements.filter((p) => p.joint === j);
    const byPart = (id: string) => placements.filter((p) => p.partId === id);

    // Uniones piso: 1 piso × 2 caras (top/bottom) × 2 minifix + taquetes
    const floor = byJoint('side-to-floor');
    const piso = parts.find((p) => p.componentPlacement === 'base')!;
    const bolts = floor.filter((p) => p.partRole === 'bolt' && p.partId === piso.id);
    expect(bolts).toHaveLength(4); // 2 posiciones × 2 caras
    const depth = piso.widthMm;
    expect(bolts.map((p) => p.relativePosition.xMm).sort((a, b) => a - b)).toEqual(
      [50, 50, depth - 50, depth - 50],
    );

    // Cámaras en ambos costados (quantity 2 → 2 piezas)
    const laterals = parts.filter((p) => p.componentPlacement === 'lateral_izquierdo');
    expect(laterals).toHaveLength(2);
    for (const lat of laterals) {
      const cams = byPart(lat.id).filter((p) => p.partRole === 'cam');
      expect(cams.map((p) => p.relativePosition.xMm).sort((a, b) => a - b)).toEqual(
        [50, depth - 50],
      );
      // v = espesor RESUELTO del piso / 2 (el material Arauco del demo es 15mm)
      expect(cams.every((p) => p.relativePosition.yMm === piso.thicknessMm / 2)).toBe(true);
      expect(cams.every((p) => p.anchorFace === 'front')).toBe(true);
    }

    // Bisagras: puerta 717 → 2 tazas; placas en ambos costados a D−37
    const door = parts.find((p) => p.componentPlacement === 'puerta')!;
    const doorLen = door.lengthMm;
    const cups = byPart(door.id).filter((p) => p.joint === 'door-hinge' && p.partRole === 'cup');
    expect(cups.map((p) => p.relativePosition.yMm).sort((a, b) => a - b)).toEqual([
      100,
      doorLen - 100,
    ]);
    expect(cups.every((p) => p.anchorFace === 'back' && p.relativePosition.xMm === 22.5)).toBe(true);

    for (const lat of laterals) {
      const plates = byPart(lat.id).filter((p) => p.joint === 'door-hinge');
      expect(plates).toHaveLength(2);
      expect(plates.every((p) => p.relativePosition.xMm === lat.widthMm - 37)).toBe(true);
    }

    // Respaldo: pasantes Ø3 en el perímetro de la cara interna. Ancho ~267 →
    // 2 posiciones X (borde sup+inf = 4); alto 720 → 1 intermedio snapped 352
    // (bordes izq+der = 2). Total 6, todos pasantes (derivedMachining).
    const back = parts.find((p) => p.componentPlacement === 'trasera')!;
    const screws = byPart(back.id).filter((p) => p.joint === 'back-panel');
    expect(screws).toHaveLength(6);
    expect(screws.every((p) => p.anchorFace === 'front')).toBe(true);
    expect(screws.every((p) => p.derivedMachining !== undefined)).toBe(true);
    const mid = screws.filter((p) => p.relativePosition.yMm === 352);
    expect(mid).toHaveLength(2);
    expect(mid.every((p) => p.relativePosition.xMm === 16 || p.relativePosition.xMm === back.widthMm - 16)).toBe(true);
  });

  it('los placements derivados resuelven sin issues en el motor F128', () => {
    // Integración F129→F128: cada pieza con sus placements derivados debe
    // validar limpia (dedupe incluido) contra el resolver.
    for (const piece of parts as readonly ResolvedBoardPart[]) {
      const own = placements.filter((p) => p.partId === piece.id);
      if (own.length === 0) continue;
      const result = resolvePartDrilling({
        piece,
        placements: own,
        hardwareCatalog,
      });
      expect(result.fallbackUsed).toBe(false);
      expect(
        result.issues,
        `${piece.description}: ${result.issues.map((i) => i.message).join(' | ')}`,
      ).toHaveLength(0);
    }
  });
});
