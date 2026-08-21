/**
 * Tests for CNC Part Drilling Resolution Engine (F128).
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import {
  assertDrillingValid,
  deduplicateHoles,
  getFaceDimensions,
  resolvePartDrilling,
  validateDrillingHoles,
  type DrillingIssue,
} from './partDrillingResolver';
import { IDS, plantillaCatalog } from './__fixtures__/plantillaDemo';
import type { Hardware, HardwarePlacement, ResolvedBoardPart } from './types';

const hwCatalog = plantillaCatalog.hardware;

const testDoor: ResolvedBoardPart = {
  id: 'door-1',
  code: 'P-DOOR',
  description: 'Puerta gabinete',
  quantity: 1,
  lengthMm: 700,
  widthMm: 400,
  thicknessMm: 18,
  grain: 0,
  edges: [],
  optionRole: 'FRENTE',
  materialId: 'mat-1',
};

const testSide: ResolvedBoardPart = {
  id: 'side-1',
  code: 'P-SIDE',
  description: 'Lateral izquierdo',
  quantity: 1,
  lengthMm: 700,
  widthMm: 500,
  thicknessMm: 18,
  grain: 0,
  edges: [],
  optionRole: 'LATERAL',
  materialId: 'mat-1',
};

const testBottom: ResolvedBoardPart = {
  id: 'bottom-1',
  code: 'P-BOT',
  description: 'Piso módulo',
  quantity: 1,
  lengthMm: 600,
  widthMm: 500,
  thicknessMm: 18,
  grain: 0,
  edges: [],
  optionRole: 'BASE',
  materialId: 'mat-1',
};

describe('getFaceDimensions', () => {
  it('calcula correctamente dimensiones y profundidad máxima según cara', () => {
    const piece = { lengthMm: 700, widthMm: 400, thicknessMm: 18 };
    expect(getFaceDimensions('front', piece)).toEqual({ widthMm: 400, heightMm: 700, maxDepthMm: 18 });
    expect(getFaceDimensions('back', piece)).toEqual({ widthMm: 400, heightMm: 700, maxDepthMm: 18 });
    expect(getFaceDimensions('left', piece)).toEqual({ widthMm: 18, heightMm: 700, maxDepthMm: 400 });
    expect(getFaceDimensions('right', piece)).toEqual({ widthMm: 18, heightMm: 700, maxDepthMm: 400 });
    expect(getFaceDimensions('top', piece)).toEqual({ widthMm: 400, heightMm: 18, maxDepthMm: 700 });
    expect(getFaceDimensions('bottom', piece)).toEqual({ widthMm: 400, heightMm: 18, maxDepthMm: 700 });
  });
});

describe('resolvePartDrilling — Golden fixtures', () => {
  it('Golden 1: Resuelve bisagra de 35mm en puerta (taza + 2 pilotos por bisagra)', () => {
    const hingePlacements: HardwarePlacement[] = [
      {
        hardwareId: IDS.hwBisagra,
        anchorFace: 'back',
        relativePosition: { xMm: 22.5, yMm: 96 },
      },
      {
        hardwareId: IDS.hwBisagra,
        anchorFace: 'back',
        relativePosition: { xMm: 22.5, yMm: 604 },
      },
    ];

    const result = resolvePartDrilling({
      piece: testDoor,
      placements: hingePlacements,
      hardwareCatalog: hwCatalog,
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.issues).toHaveLength(0);
    expect(result.holes).toHaveLength(6);

    // Bisagra 1 (y=96): taza Ø35 + pilotos Ø5 en y=96-22.5=73.5 e y=96+22.5=118.5
    const h1Cup = result.holes.find((h) => h.face === 'back' && h.xMm === 22.5 && h.yMm === 96);
    expect(h1Cup).toBeDefined();
    expect(h1Cup?.diameterMm).toBe(35);
    expect(h1Cup?.depthMm).toBe(12.5);
    expect(h1Cup?.type).toBe('hinge');

    const h1Fix1 = result.holes.find((h) => h.face === 'back' && h.xMm === 22.5 && h.yMm === 73.5);
    expect(h1Fix1).toBeDefined();
    expect(h1Fix1?.diameterMm).toBe(5);
    expect(h1Fix1?.depthMm).toBe(10);
    expect(h1Fix1?.type).toBe('hinge');

    const h1Fix2 = result.holes.find((h) => h.face === 'back' && h.xMm === 22.5 && h.yMm === 118.5);
    expect(h1Fix2).toBeDefined();
    expect(h1Fix2?.diameterMm).toBe(5);
    expect(h1Fix2?.depthMm).toBe(10);

    // Bisagra 2 (y=604): taza Ø35 + pilotos Ø5 en y=581.5 e y=626.5
    const h2Cup = result.holes.find((h) => h.face === 'back' && h.xMm === 22.5 && h.yMm === 604);
    expect(h2Cup).toBeDefined();
    expect(h2Cup?.diameterMm).toBe(35);

    const h2Fix1 = result.holes.find((h) => h.face === 'back' && h.xMm === 22.5 && h.yMm === 581.5);
    expect(h2Fix1).toBeDefined();
    const h2Fix2 = result.holes.find((h) => h.face === 'back' && h.xMm === 22.5 && h.yMm === 626.5);
    expect(h2Fix2).toBeDefined();
  });

  it('Golden 2: Resuelve minifix juego (cazuela en piso, perno en lateral)', () => {
    // 1. En el lateral (perno):
    const sidePlacement: HardwarePlacement = {
      hardwareId: IDS.hwMinifix,
      anchorFace: 'right',
      relativePosition: { xMm: 9, yMm: 50 },
      partRole: 'bolt',
    };

    const sideResult = resolvePartDrilling({
      piece: testSide,
      placements: [sidePlacement],
      hardwareCatalog: hwCatalog,
    });

    expect(sideResult.fallbackUsed).toBe(false);
    expect(sideResult.issues).toHaveLength(0);
    expect(sideResult.holes).toHaveLength(1);
    expect(sideResult.holes[0]).toEqual({
      face: 'right',
      xMm: 9,
      yMm: 50,
      diameterMm: 5,
      depthMm: 12,
      type: 'minifix',
      description: 'Piloto perno',
    });

    // 2. En el piso (cazuela):
    const bottomPlacement: HardwarePlacement = {
      hardwareId: IDS.hwMinifix,
      anchorFace: 'top',
      relativePosition: { xMm: 34, yMm: 9 },
      partRole: 'cam',
    };

    const bottomResult = resolvePartDrilling({
      piece: testBottom,
      placements: [bottomPlacement],
      hardwareCatalog: hwCatalog,
    });

    expect(bottomResult.fallbackUsed).toBe(false);
    expect(bottomResult.issues).toHaveLength(0);
    expect(bottomResult.holes).toHaveLength(1);
    expect(bottomResult.holes[0]).toEqual({
      face: 'top',
      xMm: 34,
      yMm: 9,
      diameterMm: 15,
      depthMm: 13,
      type: 'minifix',
      description: 'Cazuela minifix',
    });
  });
});

describe('resolvePartDrilling — Reactividad y movilidad', () => {
  it('mover placement mueve todos los agujeros correspondientes', () => {
    const p1: HardwarePlacement = {
      hardwareId: IDS.hwBisagra,
      anchorFace: 'back',
      relativePosition: { xMm: 22.5, yMm: 96 },
    };
    const p2: HardwarePlacement = {
      hardwareId: IDS.hwBisagra,
      anchorFace: 'back',
      relativePosition: { xMm: 22.5, yMm: 150 }, // movido +54mm
    };

    const res1 = resolvePartDrilling({ piece: testDoor, placements: [p1], hardwareCatalog: hwCatalog });
    const res2 = resolvePartDrilling({ piece: testDoor, placements: [p2], hardwareCatalog: hwCatalog });

    const cup1 = res1.holes.find((h) => h.diameterMm === 35)!;
    const cup2 = res2.holes.find((h) => h.diameterMm === 35)!;
    expect(cup2.yMm - cup1.yMm).toBe(54);

    const fix1_1 = res1.holes.find((h) => h.yMm < cup1.yMm)!;
    const fix1_2 = res2.holes.find((h) => h.yMm < cup2.yMm)!;
    expect(fix1_2.yMm - fix1_1.yMm).toBe(54);
  });

  it('cambiar herraje adapta diámetros y profundidades de maquinado', () => {
    const pTaquete: HardwarePlacement = {
      hardwareId: IDS.hwTaquete,
      anchorFace: 'left',
      relativePosition: { xMm: 9, yMm: 50 },
    };
    const pTornillo: HardwarePlacement = {
      hardwareId: IDS.hwTornillo,
      anchorFace: 'left',
      relativePosition: { xMm: 9, yMm: 50 },
    };

    const resTaq = resolvePartDrilling({ piece: testSide, placements: [pTaquete], hardwareCatalog: hwCatalog });
    const resTor = resolvePartDrilling({ piece: testSide, placements: [pTornillo], hardwareCatalog: hwCatalog });

    expect(resTaq.holes[0]!.diameterMm).toBe(8);
    expect(resTaq.holes[0]!.depthMm).toBe(15);
    expect(resTaq.holes[0]!.type).toBe('dowel');

    expect(resTor.holes[0]!.diameterMm).toBe(3);
    expect(resTor.holes[0]!.depthMm).toBe(35);
    expect(resTor.holes[0]!.type).toBe('screw');
  });
});

describe('resolvePartDrilling — Fórmulas, rotación y cara opuesta', () => {
  it('evalúa fórmulas paramétricas en relativePosition (W, L, T)', () => {
    const placement: HardwarePlacement = {
      hardwareId: IDS.hwTaquete,
      anchorFace: 'front',
      relativePosition: {
        xMm: 0,
        yMm: 0,
        xFormula: 'W - 37',
        yFormula: 'L - 96',
      },
    };

    const result = resolvePartDrilling({
      piece: testDoor, // W=400, L=700
      placements: [placement],
      hardwareCatalog: hwCatalog,
    });

    expect(result.holes).toHaveLength(1);
    expect(result.holes[0]!.xMm).toBe(400 - 37); // 363
    expect(result.holes[0]!.yMm).toBe(700 - 96); // 604
  });

  it('aplica rotación 2D en el plano de la cara (rotationDeg.z)', () => {
    // Perfil con dos agujeros a offset (0, -20) y (0, 20)
    const customHw: Hardware = {
      id: 'hw-rot-test',
      code: 'ROT-TEST',
      name: 'Herraje rotación',
      unit: 'piece',
      costPerUnit: 10,
      active: true,
      machining: {
        parts: [
          {
            id: 'body',
            role: 'body',
            operations: [
              { id: 'op-1', kind: 'blind_hole', diameterMm: 5, depthMm: 10, xMm: 20, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      },
    };

    // Sin rotación: offset en X=+20, Y=0 -> (100+20, 100) = (120, 100)
    const pNoRot: HardwarePlacement = {
      hardwareId: 'hw-rot-test',
      anchorFace: 'front',
      relativePosition: { xMm: 100, yMm: 100 },
    };
    const resNoRot = resolvePartDrilling({
      piece: testDoor,
      placements: [pNoRot],
      hardwareCatalog: [customHw],
    });
    expect(resNoRot.holes[0]!.xMm).toBe(120);
    expect(resNoRot.holes[0]!.yMm).toBe(100);

    // Rotado 90° antihorario: (20, 0) rotado 90° -> (0, 20) -> (100, 120)
    const pRot90: HardwarePlacement = {
      hardwareId: 'hw-rot-test',
      anchorFace: 'front',
      relativePosition: { xMm: 100, yMm: 100 },
      rotationDeg: { z: 90 },
    };
    const resRot90 = resolvePartDrilling({
      piece: testDoor,
      placements: [pRot90],
      hardwareCatalog: [customHw],
    });
    expect(resRot90.holes[0]!.xMm).toBe(100);
    expect(resRot90.holes[0]!.yMm).toBe(120);
  });

  it('resuelve perforación en cara opuesta cuando face === "opposite"', () => {
    const oppHw: Hardware = {
      id: 'hw-opp-test',
      code: 'OPP-TEST',
      name: 'Herraje opuesto',
      unit: 'piece',
      costPerUnit: 5,
      active: true,
      machining: {
        parts: [
          {
            id: 'body',
            role: 'body',
            operations: [
              { id: 'op-opp', kind: 'blind_hole', diameterMm: 8, depthMm: 10, xMm: 0, yMm: 0, face: 'opposite' },
            ],
          },
        ],
      },
    };

    const placement: HardwarePlacement = {
      hardwareId: 'hw-opp-test',
      anchorFace: 'front',
      relativePosition: { xMm: 50, yMm: 50 },
    };

    const result = resolvePartDrilling({
      piece: testDoor,
      placements: [placement],
      hardwareCatalog: [oppHw],
    });

    expect(result.holes).toHaveLength(1);
    expect(result.holes[0]!.face).toBe('back');
    expect(result.holes[0]!.xMm).toBe(50);
    expect(result.holes[0]!.yMm).toBe(50);
  });

  it('resuelve profundidad de through_hole atravesando todo el espesor de la pieza', () => {
    const throughHw: Hardware = {
      id: 'hw-through',
      code: 'THR-TEST',
      name: 'Pasante test',
      unit: 'piece',
      costPerUnit: 1,
      active: true,
      machining: {
        parts: [
          {
            id: 'body',
            role: 'body',
            operations: [
              { id: 'op-through', kind: 'through_hole', diameterMm: 5, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      },
    };

    const placement: HardwarePlacement = {
      hardwareId: 'hw-through',
      anchorFace: 'front',
      relativePosition: { xMm: 50, yMm: 50 },
    };

    const result = resolvePartDrilling({
      piece: testDoor, // thickness 18
      placements: [placement],
      hardwareCatalog: [throughHw],
    });

    expect(result.holes[0]!.depthMm).toBe(18);
  });
});

describe('deduplicateHoles & Coincidencias', () => {
  it('deduplica perforaciones idénticas en la misma cara', () => {
    const holes = [
      { face: 'front' as const, xMm: 100, yMm: 100, diameterMm: 8, depthMm: 15, type: 'dowel' as const },
      { face: 'front' as const, xMm: 100.02, yMm: 99.98, diameterMm: 8, depthMm: 15, type: 'dowel' as const },
      { face: 'front' as const, xMm: 200, yMm: 100, diameterMm: 8, depthMm: 15, type: 'dowel' as const },
    ];

    const deduped = deduplicateHoles(holes);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.xMm).toBe(100);
    expect(deduped[1]!.xMm).toBe(200);
  });

  it('dos placements superpuestos no generan agujeros duplicados en el resultado', () => {
    const p1: HardwarePlacement = {
      hardwareId: IDS.hwTaquete,
      anchorFace: 'front',
      relativePosition: { xMm: 50, yMm: 50 },
    };
    const p2: HardwarePlacement = {
      hardwareId: IDS.hwTaquete,
      anchorFace: 'front',
      relativePosition: { xMm: 50, yMm: 50 },
    };

    const result = resolvePartDrilling({
      piece: testDoor,
      placements: [p1, p2],
      hardwareCatalog: hwCatalog,
    });

    expect(result.holes).toHaveLength(1);
  });
});

describe('Validaciones geométricas & assertDrillingValid', () => {
  it('detecta DEPTH_EXCEEDS_MATERIAL cuando la profundidad supera el espesor', () => {
    const deepHw: Hardware = {
      id: 'hw-deep',
      code: 'DEEP',
      name: 'Agujero profundo',
      unit: 'piece',
      costPerUnit: 1,
      active: true,
      machining: {
        parts: [
          {
            id: 'p',
            role: 'p',
            operations: [
              { id: 'op-1', kind: 'blind_hole', diameterMm: 8, depthMm: 25, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      },
    };

    const placement: HardwarePlacement = {
      hardwareId: 'hw-deep',
      anchorFace: 'front',
      relativePosition: { xMm: 50, yMm: 50 },
    };

    const result = resolvePartDrilling({
      piece: testDoor, // espesor 18mm, agujero de 25mm
      placements: [placement],
      hardwareCatalog: [deepHw],
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe('DEPTH_EXCEEDS_MATERIAL');
    expect(result.issues[0]!.message).toContain('supera el límite de 18 mm');

    expect(() => assertDrillingValid(result)).toThrow(ValidationError);
  });

  it('detecta HOLE_OUT_OF_BOUNDS si el centro o el perímetro queda fuera de la cara', () => {
    const hw: Hardware = {
      id: 'hw-edge',
      code: 'EDGE',
      name: 'Cerca del borde',
      unit: 'piece',
      costPerUnit: 1,
      active: true,
      machining: {
        parts: [
          {
            id: 'p',
            role: 'p',
            operations: [
              { id: 'op-1', kind: 'blind_hole', diameterMm: 35, depthMm: 12, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      },
    };

    // Cara front W=400, L=700. Agujero Ø35 con centro en x=10 -> radio 17.5 excede x=0 (llega a -7.5)
    const placementOutPerimeter: HardwarePlacement = {
      hardwareId: 'hw-edge',
      anchorFace: 'front',
      relativePosition: { xMm: 10, yMm: 100 },
    };

    const resPerimeter = resolvePartDrilling({
      piece: testDoor,
      placements: [placementOutPerimeter],
      hardwareCatalog: [hw],
    });

    expect(resPerimeter.issues).toHaveLength(1);
    expect(resPerimeter.issues[0]!.code).toBe('HOLE_OUT_OF_BOUNDS');

    // Centro fuera (x = -5)
    const placementOutCenter: HardwarePlacement = {
      hardwareId: 'hw-edge',
      anchorFace: 'front',
      relativePosition: { xMm: -5, yMm: 100 },
    };
    const resCenter = resolvePartDrilling({
      piece: testDoor,
      placements: [placementOutCenter],
      hardwareCatalog: [hw],
    });

    expect(resCenter.issues).toHaveLength(1);
    expect(resCenter.issues[0]!.code).toBe('HOLE_OUT_OF_BOUNDS');
  });

  it('detecta HOLE_COLLISION en la misma cara cuando dos agujeros se solapan', () => {
    // Dos agujeros Ø15 a 10mm de distancia (minDist = 15mm)
    const holes = [
      { face: 'front' as const, xMm: 100, yMm: 100, diameterMm: 15, depthMm: 12, type: 'minifix' as const, description: 'Minifix 1' },
      { face: 'front' as const, xMm: 110, yMm: 100, diameterMm: 15, depthMm: 12, type: 'minifix' as const, description: 'Minifix 2' },
    ];

    const issues = validateDrillingHoles(
      { lengthMm: 700, widthMm: 400, thicknessMm: 18 },
      holes,
    );

    const collision = issues.find((i) => i.code === 'HOLE_COLLISION');
    expect(collision).toBeDefined();
    expect(collision?.message).toContain('se solapan');
  });

  it('detecta HOLE_COLLISION en caras opuestas cuando las profundidades superan el espesor', () => {
    // Agujero en front (prof 12) y en back (prof 10) en la misma coordenada XY de un tablero de 18mm -> suma 22 > 18
    const holes = [
      { face: 'front' as const, xMm: 100, yMm: 100, diameterMm: 15, depthMm: 12, type: 'minifix' as const, description: 'Front hole' },
      { face: 'back' as const, xMm: 100, yMm: 100, diameterMm: 15, depthMm: 10, type: 'minifix' as const, description: 'Back hole' },
    ];

    const issues = validateDrillingHoles(
      { lengthMm: 700, widthMm: 400, thicknessMm: 18 },
      holes,
    );

    const collision = issues.find((i) => i.code === 'HOLE_COLLISION');
    expect(collision).toBeDefined();
    expect(collision?.message).toContain('Colisión interna de perforaciones en caras opuestas');
  });

  it('strict=true lanza ValidationError inmediatamente en resolvePartDrilling', () => {
    const badPlacement: HardwarePlacement = {
      hardwareId: IDS.hwTaquete,
      anchorFace: 'front',
      relativePosition: { xMm: -50, yMm: 50 },
    };

    expect(() =>
      resolvePartDrilling({
        piece: testDoor,
        placements: [badPlacement],
        hardwareCatalog: hwCatalog,
        strict: true,
      }),
    ).toThrow(ValidationError);
  });
});

describe('resolvePartDrilling — Fallback F074', () => {
  it('aplica heurísticas de F074 cuando no hay placements y marca fallbackUsed: true', () => {
    const result = resolvePartDrilling({
      piece: testDoor, // description 'Puerta gabinete'
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.holes.length).toBeGreaterThan(0);
    // Puerta genera 2 cazuelas de bisagra por heurística
    expect(result.holes.some((h) => h.type === 'hinge' && h.diameterMm === 35)).toBe(true);
  });

  it('soporta llamada posicional resolvePartDrilling(piece, placements, catalog)', () => {
    const placement: HardwarePlacement = {
      hardwareId: IDS.hwTaquete,
      anchorFace: 'front',
      relativePosition: { xMm: 100, yMm: 100 },
    };

    const result = resolvePartDrilling(testDoor, [placement], hwCatalog);
    expect(result.fallbackUsed).toBe(false);
    expect(result.holes).toHaveLength(1);
    expect(result.holes[0]!.xMm).toBe(100);
  });

  // Review F128: la heurística F074 respeta la convención de face-planes, así
  // que el fallback no debe emitir HOLE_OUT_OF_BOUNDS falsos en lateral/fondo.
  it('fallback lateral: agujeros de canto dentro de la pieza, sin issues', () => {
    const result = resolvePartDrilling({
      piece: { ...testDoor, description: 'Lateral izquierdo', lengthMm: 700, widthMm: 500 },
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.holes).toHaveLength(4);
    expect(result.holes.every((h) => h.face === 'top')).toBe(true);
    // Cara top: x a lo ancho (≤ 500), y a lo largo del espesor (≤ 18).
    expect(result.holes.every((h) => h.xMm >= 0 && h.xMm <= 500)).toBe(true);
    expect(result.holes.every((h) => h.yMm >= 0 && h.yMm <= 18)).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fallback fondo: pilotos de esquina dentro de la pieza, sin issues', () => {
    const result = resolvePartDrilling({
      piece: { ...testDoor, description: 'Fondo', lengthMm: 720, widthMm: 500, thicknessMm: 15 },
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.holes).toHaveLength(4);
    expect(result.holes.every((h) => h.face === 'front')).toBe(true);
    // Cara front: x a lo ancho (≤ 500), y a lo largo (≤ 720).
    expect(result.holes.every((h) => h.xMm >= 0 && h.xMm <= 500)).toBe(true);
    expect(result.holes.every((h) => h.yMm >= 0 && h.yMm <= 720)).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe('validateDrillingHoles — separación entre caras opuestas (review F128)', () => {
  const piece700 = {
    id: 'p-opp',
    code: 'P-OPP',
    description: 'Pieza opuestas',
    lengthMm: 700,
    widthMm: 500,
    thicknessMm: 18,
  };

  it('pines left/right enfrentados no colisionan (separación = ancho, no espesor)', () => {
    const issues = validateDrillingHoles(piece700, [
      { face: 'left', xMm: 9, yMm: 400, diameterMm: 5, depthMm: 10, type: 'shelf' },
      { face: 'right', xMm: 9, yMm: 400, diameterMm: 5, depthMm: 10, type: 'shelf' },
    ]);
    expect(issues).toHaveLength(0);
  });

  it('tarugos top/bottom enfrentados no colisionan (separación = largo)', () => {
    const issues = validateDrillingHoles(piece700, [
      { face: 'top', xMm: 100, yMm: 9, diameterMm: 8, depthMm: 30, type: 'dowel' },
      { face: 'bottom', xMm: 100, yMm: 9, diameterMm: 8, depthMm: 30, type: 'dowel' },
    ]);
    expect(issues).toHaveLength(0);
  });

  it('front/back enfrentados que atraviesan el espesor sí colisionan (control)', () => {
    const issues = validateDrillingHoles(piece700, [
      { face: 'front', xMm: 100, yMm: 100, diameterMm: 8, depthMm: 12, type: 'dowel' },
      { face: 'back', xMm: 100, yMm: 100, diameterMm: 5, depthMm: 10, type: 'screw' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('HOLE_COLLISION');
    expect(issues[0]!.context).toMatchObject({ separationMm: 18 });
  });

  it('fallback estante: sin issues falsas de colisión (regresión review)', () => {
    const result = resolvePartDrilling({
      piece: { ...testDoor, description: 'Estante', lengthMm: 800, widthMm: 400 },
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.holes).toHaveLength(2);
    expect(result.holes.every((h) => h.face === 'left' || h.face === 'right')).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe('DEFAULT_BOARD_THICKNESS_MM — default único de espesor (deuda F128)', () => {
  it('pieza sin espesor resuelve contra 18 en heurística y validación', () => {
    // Descriptor degenerado sin thicknessMm (el flujo BOM real siempre lo trae).
    const noThickness = {
      ...testDoor,
      description: 'Estante',
      lengthMm: 800,
      widthMm: 400,
      thicknessMm: undefined,
    } as unknown as ResolvedBoardPart;

    const result = resolvePartDrilling({ piece: noThickness });
    expect(result.fallbackUsed).toBe(true);
    // Pines centrados en el canto con T=18 → x = 9 (con el viejo ?? 15 sería 7).
    expect(result.holes.every((h) => h.xMm === 9)).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
