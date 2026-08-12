import { describe, expect, it } from 'vitest';
import {
  mirrorComponentPlacement,
  mirrorComponentInstance,
  resolveAgregadoInstance,
  calculateAgregadoSubspaceUnits,
} from './agregados';
import { resolveComposedModule, resolveBom } from './engine/bom';
import type { Agregado, Catalog, Module, ModuleAgregadoInstance, Structure } from './types';

describe('agregados domain helpers', () => {
  describe('mirrorComponentPlacement', () => {
    it('flips lateral_izquierdo <-> lateral_derecho', () => {
      expect(mirrorComponentPlacement('lateral_izquierdo')).toBe('lateral_derecho');
      expect(mirrorComponentPlacement('lateral_derecho')).toBe('lateral_izquierdo');
    });

    it('preserves symmetric placements', () => {
      expect(mirrorComponentPlacement('puerta')).toBe('puerta');
      expect(mirrorComponentPlacement('frontal')).toBe('frontal');
      expect(mirrorComponentPlacement('base')).toBe('base');
    });
  });

  describe('mirrorComponentInstance', () => {
    it('mirrors placement override and rotateY', () => {
      const original = {
        componentId: 'comp-puerta-izq',
        quantity: 1,
        placementOverride: 'lateral_izquierdo' as const,
        overrides: {
          rotateY: 90,
        },
      };

      const mirrored = mirrorComponentInstance(original);
      expect(mirrored.placementOverride).toBe('lateral_derecho');
      expect(mirrored.overrides?.rotateY).toBe(270);
    });
  });

  describe('calculateAgregadoSubspaceUnits', () => {
    it('calculates vertical stacking for N units with gap', () => {
      const units = calculateAgregadoSubspaceUnits(
        3,
        { width: 764, height: 600, depth: 550 },
        { x: 18, y: 0, z: 100 },
        'vertical',
        3,
      );

      expect(units).toHaveLength(3);
      // Available H = 600 - 2 * 3 = 594. Unit H = 198.
      expect(units[0]).toEqual({
        unitIndex: 0,
        x: 18,
        y: 0,
        z: 100,
        width: 764,
        height: 198,
        depth: 550,
      });
      expect(units[1]).toEqual({
        unitIndex: 1,
        x: 18,
        y: 0,
        z: 301, // 100 + 198 + 3
        width: 764,
        height: 198,
        depth: 550,
      });
      expect(units[2]).toEqual({
        unitIndex: 2,
        x: 18,
        y: 0,
        z: 502, // 301 + 198 + 3
        width: 764,
        height: 198,
        depth: 550,
      });
    });

    it('calculates horizontal stacking for N units with gap', () => {
      const units = calculateAgregadoSubspaceUnits(
        2,
        { width: 800, height: 700, depth: 500 },
        { x: 0, y: 0, z: 0 },
        'horizontal',
        4,
      );

      expect(units).toHaveLength(2);
      // Available W = 800 - 4 = 796. Unit W = 398.
      expect(units[0]).toEqual({
        unitIndex: 0,
        x: 0,
        y: 0,
        z: 0,
        width: 398,
        height: 700,
        depth: 500,
      });
      expect(units[1]).toEqual({
        unitIndex: 1,
        x: 402, // 0 + 398 + 4
        y: 0,
        z: 0,
        width: 398,
        height: 700,
        depth: 500,
      });
    });
  });

  describe('resolveAgregadoInstance', () => {
    const mockAgregado: Agregado = {
      id: 'agr-puerta-std',
      code: 'AGR-PTR-01',
      name: 'Puerta estándar izquierda con bisagras',
      components: [
        {
          componentId: 'comp-puerta',
          quantity: 1,
          placementOverride: 'lateral_izquierdo',
        },
      ],
      hardwareLines: [
        {
          id: 'hl-bisagra',
          quantity: 2,
          optionRole: 'BISAGRA',
          hardwareId: 'hw-bisagra-35mm',
        },
        {
          id: 'hl-jaladera',
          quantity: 1,
          optionRole: 'JALADERA',
          hardwareId: 'hw-jaladera-128',
        },
      ],
    };

    it('resolves normal (non-mirrored) agregado instance', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'agr-puerta-std',
        quantity: 2,
        mirrored: false,
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.components).toHaveLength(1);
      expect(resolved.components[0]?.quantity).toBe(2);
      expect(resolved.components[0]?.placementOverride).toBe('lateral_izquierdo');
      expect(resolved.hardwareLines).toHaveLength(2);
      expect(resolved.hardwareLines[0]?.quantity).toBe(4); // 2 * 2
      expect(resolved.hardwareLines[1]?.quantity).toBe(2); // 1 * 2
    });

    it('applies optionOverrides to hardware lines', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'agr-puerta-std',
        quantity: 1,
        optionOverrides: {
          JALADERA: 'hw-jaladera-gola-256',
        },
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.hardwareLines[1]?.hardwareId).toBe('hw-jaladera-gola-256');
    });

    it('resolves mirrored agregado instance', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'agr-puerta-std',
        quantity: 1,
        mirrored: true,
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.components[0]?.placementOverride).toBe('lateral_derecho');
    });

    it('returns empty lists for non-existent agregado', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'non-existent',
        quantity: 1,
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.components).toEqual([]);
      expect(resolved.hardwareLines).toEqual([]);
    });

    it('counts positioned hardware from placements (cost = position count)', () => {
      const agr: Agregado = {
        id: 'agr-positioned',
        code: 'AGR-POS',
        name: 'Puerta con jaladera posicionada',
        components: [
          {
            componentId: 'comp-puerta',
            quantity: 1,
            overrides: {
              hardwarePlacements: [
                {
                  hardwareId: 'hw-jaladera',
                  anchorFace: 'front',
                  relativePosition: { xMm: 38, yMm: 50 },
                },
                {
                  hardwareId: 'hw-jaladera',
                  anchorFace: 'front',
                  relativePosition: { xMm: 38, yMm: 100 },
                },
              ],
            },
          },
        ],
        hardwareLines: [],
      };
      const inst: ModuleAgregadoInstance = { agregadoId: 'agr-positioned', quantity: 1 };
      const resolved = resolveAgregadoInstance(inst, [agr]);
      // 2 placements of hw-jaladera → 1 derived line × 2.
      const jal = resolved.hardwareLines.find((h) => h.hardwareId === 'hw-jaladera');
      expect(jal).toBeTruthy();
      expect(jal!.quantity).toBe(2);
      expect(jal!.optionRole).toBe('POSITIONED');
    });

    it('dedups: bulk line for a positioned hardware is dropped (no double count)', () => {
      const agr: Agregado = {
        id: 'agr-dedup',
        code: 'AGR-DEDUP',
        name: 'Mixto',
        components: [
          {
            componentId: 'comp-puerta',
            quantity: 1,
            overrides: {
              hardwarePlacements: [
                {
                  hardwareId: 'hw-jaladera',
                  anchorFace: 'front',
                  relativePosition: { xMm: 38, yMm: 50 },
                },
              ],
            },
          },
        ],
        hardwareLines: [
          // hw-jaladera ALSO in bulk → dropped (positions win).
          { id: 'hl-jal', quantity: 5, optionRole: 'JALADERA', hardwareId: 'hw-jaladera' },
          // hw-tornillo NOT positioned → bulk stays.
          { id: 'hl-tor', quantity: 10, optionRole: 'TORNILLO', hardwareId: 'hw-tornillo' },
        ],
      };
      const inst: ModuleAgregadoInstance = { agregadoId: 'agr-dedup', quantity: 1 };
      const resolved = resolveAgregadoInstance(inst, [agr]);
      const jal = resolved.hardwareLines.filter((h) => h.hardwareId === 'hw-jaladera');
      expect(jal).toHaveLength(1);
      expect(jal[0]!.quantity).toBe(1); // placement-derived, not the bulk ×5
      expect(jal[0]!.optionRole).toBe('POSITIONED');
      const tor = resolved.hardwareLines.find((h) => h.hardwareId === 'hw-tornillo');
      expect(tor).toBeTruthy();
      expect(tor!.quantity).toBe(10);
    });

    it('scales placement count by instance quantity and component quantity', () => {
      const agr: Agregado = {
        id: 'agr-scaled',
        code: 'AGR-SCALED',
        name: 'Componente x2',
        components: [
          {
            componentId: 'comp-puerta',
            quantity: 2, // 2 copies within one unit, each with 1 placement
            overrides: {
              hardwarePlacements: [
                {
                  hardwareId: 'hw-bisagra',
                  anchorFace: 'front',
                  relativePosition: { xMm: 50, yMm: 50 },
                },
              ],
            },
          },
        ],
        hardwareLines: [],
      };
      // Instance quantity 3 → 3 agregado copies × 2 component copies × 1 placement = 6.
      const inst: ModuleAgregadoInstance = { agregadoId: 'agr-scaled', quantity: 3 };
      const resolved = resolveAgregadoInstance(inst, [agr]);
      const bis = resolved.hardwareLines.find((h) => h.hardwareId === 'hw-bisagra');
      expect(bis).toBeTruthy();
      expect(bis!.quantity).toBe(6);
    });
  });

  describe('calculateModuleBom with Agregados subspace', () => {
    it('evaluates component formulas against local subspace bounding box and offsets in 3D', () => {
      const catalog: Catalog = {
        materials: [
          {
            id: 'm1',
            code: 'M1',
            name: 'MDF 18',
            thicknessMm: 18,
            costPerM2: 100,
            widthMm: 1830,
            lengthMm: 2600,
            grainDefault: true,
            boardPrice: 1000,
            wastePercent: 10,
            active: true,
          },
        ],
        modules: [],
        structures: [],
        edges: [],
        hardware: [],
        components: [
          {
            id: 'c-frente',
            code: 'FRT-CAJ',
            name: 'Frente de cajón',
            placement: 'frente_cajon',
            geometry: {
              kind: 'rectangular_board',
              lengthMm: 0,
              widthMm: 0,
              thicknessMm: 18,
              lengthFormula: 'D',
              widthFormula: 'W - 4',
            },
            defaultEdges: [],
            optionRoles: ['PLACA'],
            active: true,
          },
        ],
        optionGroups: [
          {
            id: 'og-placa',
            code: 'PLACA',
            name: 'Material Placa',
            kind: 'board',
            required: true,
            optionIds: ['m1'],
          },
        ],
        agregados: [
          {
            id: 'agr-cajon',
            code: 'AGR-CAJ-01',
            name: 'Cuerpo de Cajón',
            components: [
              {
                componentId: 'c-frente',
                quantity: 1,
                placementOverride: 'frente_cajon',
                overrides: {
                  lengthFormula: 'H - 4', // Local drawer height minus 4mm
                  widthFormula: 'W - 4',  // Local drawer width minus 4mm
                },
              },
            ],
          },
        ],
      };

      const structure: Structure = {
        id: 'str-cajonera',
        code: 'STR-CAJ',
        name: 'Mueble Cajonera 800x600x500',
        components: [],
        agregados: [
          {
            agregadoId: 'agr-cajon',
            quantity: 3,
            layoutDirection: 'vertical',
            gapMm: 3,
            position: { xFormula: '18', yFormula: '0', zFormula: '100' },
            dimensions: { widthFormula: 'W - 36', heightFormula: '600', depthFormula: 'D' },
          },
        ],
      };

      const module: Module = {
        id: 'mod-cajonera',
        code: 'MOD-CAJ',
        name: 'Modulo Cajonera',
        structureId: 'str-cajonera',
        hardwareLines: [],
      };

      const bom = resolveComposedModule({
        structure,
        module,
        componentInstances: [],
        catalog,
        dims: { width: 800, height: 720, depth: 500 },
        optionChoices: { PLACA: 'm1' },
      });

      // 3 drawer fronts generated
      expect(bom.boardParts).toHaveLength(3);

      // Local subspace W = 800 - 36 = 764. Local subspace H = 600.
      // 3 vertical drawers with 3mm gap: unit H = (600 - 2*3)/3 = 198mm.
      // Unit 0 Z = 100, Unit 1 Z = 301, Unit 2 Z = 502.
      // Frente width = W_local - 4 = 764 - 4 = 760mm.
      // Frente length = H_local - 4 = 198 - 4 = 194mm.

      const p0 = bom.boardParts[0]!;
      expect(p0.widthMm).toBe(760);
      expect(p0.lengthMm).toBe(194);
      expect(p0.z).toBe(102); // spaceZ(100) + defaultPoseForPlacement.z(2)

      const p1 = bom.boardParts[1]!;
      expect(p1.widthMm).toBe(760);
      expect(p1.lengthMm).toBe(194);
      expect(p1.z).toBe(303); // spaceZ(301) + defaultPoseForPlacement.z(2)

      const p2 = bom.boardParts[2]!;
      expect(p2.widthMm).toBe(760);
      expect(p2.lengthMm).toBe(194);
      expect(p2.z).toBe(504); // spaceZ(502) + defaultPoseForPlacement.z(2)
    });

    it('places door component in Agregado at front (y = PD) and inherits FRENTE choice when depthFormula is empty', () => {
      const catalog: Catalog = {
        materials: [
          {
            id: 'm1',
            code: 'M1',
            name: 'Placa 18mm',
            widthMm: 2750,
            lengthMm: 1830,
            thicknessMm: 18,
            grainDefault: false,
            boardPrice: 100,
            wastePercent: 0,
            costPerM2: 20,
            active: true,
          },
        ],
        edges: [],
        hardware: [],
        optionGroups: [],
        modules: [],
        components: [
          {
            id: 'c-puerta',
            code: 'PUE',
            name: 'Hoja de Puerta',
            placement: 'puerta',
            geometry: {
              kind: 'rectangular_board',
              lengthMm: 700,
              widthMm: 600,
              thicknessMm: 18,
            },
            defaultEdges: [],
            optionRoles: ['PUERTA'],
            active: true,
          },
        ],
        agregados: [
          {
            id: 'agr-puerta',
            code: 'AGR-PUE',
            name: 'Puerta Sencilla',
            externalDims: { width: 600, height: 700, depth: 18 },
            components: [
              {
                componentId: 'c-puerta',
                quantity: 1,
              },
            ],
          },
        ],
      };

      const structure: Structure = {
        id: 'str-gab',
        code: 'STR-GAB',
        name: 'Mueble Gabinete',
        components: [],
        agregados: [
          {
            agregadoId: 'agr-puerta',
            quantity: 1,
          },
        ],
      };

      const bom = resolveComposedModule({
        structure,
        catalog,
        componentInstances: [],
        dims: { width: 600, height: 700, depth: 500 },
        optionChoices: { FRENTE: 'm1' },
      });

      expect(bom.boardParts).toHaveLength(1);
      const doorPart = bom.boardParts[0]!;
      expect(doorPart.y).toBe(500);
    });
  });

  describe('resolveBom end-to-end (path real del 3D del mueble)', () => {
    const catalog: Catalog = {
      materials: [
        {
          id: 'm1',
          code: 'M1',
          name: 'Placa 18',
          widthMm: 2750,
          lengthMm: 1830,
          thicknessMm: 18,
          grainDefault: false,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 20,
          active: true,
        },
      ],
      edges: [],
      hardware: [],
      optionGroups: [
        {
          id: 'og-puerta',
          code: 'PUERTA',
          name: 'Puerta',
          kind: 'board',
          required: true,
          optionIds: ['m1'],
        },
      ],
      modules: [],
      components: [
        {
          id: 'c-puerta',
          code: 'PUE',
          name: 'Hoja',
          placement: 'puerta',
          geometry: {
            kind: 'rectangular_board',
            lengthMm: 700,
            widthMm: 600,
            thicknessMm: 18,
          },
          defaultEdges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRoles: ['PUERTA'],
          active: true,
        },
      ],
      structures: [
        {
          id: 'str-gab',
          code: 'STR-GAB',
          name: 'Gabinete',
          externalDims: { width: 600, height: 700, depth: 500 },
          components: [],
          active: true,
        },
      ],
      agregados: [
        {
          id: 'agr-puerta',
          code: 'AGR-PUE',
          name: 'Puerta Sencilla',
          externalDims: { width: 600, height: 700, depth: 18 },
          components: [{ componentId: 'c-puerta', quantity: 1 }],
        },
      ],
    };

    it('módulo compuesto (con structureId) + agregado-puerta adjunto → la puerta aparece en boardParts al frente (y=PD)', () => {
      const module: Module = {
        id: 'mod-gab',
        code: 'MOD-GAB',
        name: 'Gabinete',
        externalDims: { width: 600, height: 700, depth: 500 },
        structureId: 'str-gab',
        components: [],
        agregados: [{ agregadoId: 'agr-puerta', quantity: 1 }],
        hardwareLines: [],
      };

      const bom = resolveBom(module, { PUERTA: 'm1' }, catalog);

      // La puerta del agregado debe llegar al BOM del mueble, posicionada al
      // frente (y = PD = profundidad del mueble).
      const door = bom.boardParts.find((p) => p.y === 500);
      expect(
        door,
        'la puerta del agregado debe llegar al BOM del mueble al frente (y=PD)',
      ).toBeTruthy();
      expect(door!.y).toBe(500);
    });

    it('módulo SIN structureId + agregado-puerta adjunto → R-4: la puerta se pierde silenciosamente', () => {
      const module: Module = {
        id: 'mod-bare',
        code: 'MOD-BARE',
        name: 'Bare',
        externalDims: { width: 600, height: 700, depth: 500 },
        // structureId omitido intencionalmente
        components: [],
        agregados: [{ agregadoId: 'agr-puerta', quantity: 1 }],
        hardwareLines: [],
      };

      const bom = resolveBom(module, { PUERTA: 'm1' }, catalog);

      // BUG R-4 (docs/judgment-day-agregados-2026-08-11.md): la rama
      // no-compuesta de resolveBom ignora module.agregados. Afirmación
      // documenta el comportamiento actual; invertir cuando se fixee R-4.
      expect(bom.boardParts).toHaveLength(0);
    });
  });
});

