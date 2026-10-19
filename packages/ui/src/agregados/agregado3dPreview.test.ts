/**
 * Tests for resolveAgregado3DPreview — live 3D preview of an agregado draft.
 * Fase 3 (agregados-subassemblies-plan.md).
 */

import { describe, expect, it } from 'vitest';
import type { Component, Hardware } from '@granete/domain';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { DEFAULT_MODULE_FOOTPRINT_MM } from '../preview3d/project3dLayout';
import { resolveAgregado3DPreview } from './agregado3dPreview';
import { createEmptyAgregadoDraft, type AgregadoDraft } from './agregadoDraft';

const mockComponent: Component = {
  id: 'c-puerta',
  code: 'PRT-STD',
  name: 'Hoja de Puerta',
  placement: 'puerta',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 0,
    widthMm: 0,
    thicknessMm: 18,
    lengthFormula: 'H',
    widthFormula: 'W',
  },
  defaultEdges: [],
  optionRoles: ['PUERTA'],
  active: true,
};

const mockCatalogInput: Module3DCatalogInput = {
  modules: [],
  structures: [],
  components: [mockComponent],
  materials: [
    {
      id: 'mat-1',
      code: 'MDF18',
      name: 'MDF 18mm',
      widthMm: 1830,
      lengthMm: 2600,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
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
      optionIds: ['mat-1'],
    },
  ],
};

const jaladera: Hardware = {
  id: 'hw-jal-1',
  code: 'JAL-128',
  name: 'Jaladera Barra 128',
  unit: 'piece',
  costPerUnit: 12,
  active: true,
  previewShape: 'bar-pull',
  previewSizeMm: 128,
  previewProjectionMm: 32,
  previewColor: '#333333',
};

const tornilloCostOnly: Hardware = {
  id: 'hw-torn-1',
  code: 'TOR-4X30',
  name: 'Tornillo 4x30',
  unit: 'piece',
  costPerUnit: 0.5,
  active: true,
};

const catalogInputConHerrajes: Module3DCatalogInput = {
  ...mockCatalogInput,
  hardware: [jaladera, tornilloCostOnly],
};

function doorDraft(overrides?: Partial<AgregadoDraft>): AgregadoDraft {
  return {
    ...createEmptyAgregadoDraft(),
    code: 'PRT-1',
    name: 'Puerta Estándar',
    widthMm: 600,
    heightMm: 720,
    depthMm: 18,
    components: [
      { componentId: 'c-puerta', quantity: 1, placementOverride: 'puerta' },
    ],
    ...overrides,
  };
}

describe('resolveAgregado3DPreview', () => {
  it('resolves the agregado pieces against its own local dims', () => {
    const res = resolveAgregado3DPreview(doorDraft(), mockCatalogInput);

    expect(res.error).toBeNull();
    expect(res.empty).toBe(false);
    expect(res.parts).toHaveLength(1);
    expect(res.width).toBe(600);
    expect(res.height).toBe(720);
    expect(res.depth).toBe(18);

    // Piece resolves its length/width from local H/W of the agregado.
    expect(res.parts[0]!.lengthMm).toBe(720);
    expect(res.parts[0]!.widthMm).toBe(600);
  });

  it('honors per-piece formula overrides (live edit)', () => {
    const draft = doorDraft({
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          placementOverride: 'puerta',
          overrides: { lengthFormula: 'H - 10' },
        },
      ],
    });

    const res = resolveAgregado3DPreview(draft, mockCatalogInput);

    expect(res.error).toBeNull();
    expect(res.parts[0]!.lengthMm).toBe(710);
  });

  it('reports empty when the agregado has no pieces', () => {
    const res = resolveAgregado3DPreview(
      doorDraft({ components: [] }),
      mockCatalogInput,
    );

    expect(res.empty).toBe(true);
    expect(res.parts).toHaveLength(0);
    expect(res.error).toBeNull();
  });

  it('falls back to the default footprint when draft dims are zero', () => {
    const res = resolveAgregado3DPreview(
      doorDraft({ widthMm: 0, heightMm: 0, depthMm: 0 }),
      mockCatalogInput,
    );

    expect(res.width).toBe(DEFAULT_MODULE_FOOTPRINT_MM.width);
    expect(res.height).toBe(DEFAULT_MODULE_FOOTPRINT_MM.height);
    expect(res.depth).toBe(DEFAULT_MODULE_FOOTPRINT_MM.depth);
  });

  it('resolves per-piece hardware placements linked to their board part', () => {
    const draft = doorDraft({
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          placementOverride: 'puerta',
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-jal-1',
                anchorFace: 'front',
                relativePosition: { xMm: 300, yMm: 360 },
              },
            ],
          },
        },
      ],
    });

    const res = resolveAgregado3DPreview(draft, catalogInputConHerrajes);

    expect(res.error).toBeNull();
    expect(res.parts).toHaveLength(1);
    expect(res.resolvedHardwarePlacements).toHaveLength(1);

    const placement = res.resolvedHardwarePlacements[0]!;
    // Links to the door part produced by the draft component (Go `mod-`
    // namespace, #995 K3-parity).
    expect(placement.componentInstanceId).toBe('mod-c-puerta-copy-0');
    expect(placement.hardwareId).toBe('hw-jal-1');
    // Front face: +Y normal, standoff = previewProjectionMm.
    expect(placement.localNormal).toEqual([0, 1, 0]);
    expect(placement.standoffMm).toBe(32);
    // Board-local mm: X along the width, Y on the 18mm face, Z along the length.
    expect(placement.localPosition).toEqual([300, 18, 360]);
  });

  it('renders nothing for cost-only or missing placement hardware (VH-09)', () => {
    const draftWith = (hardwareId: string) =>
      doorDraft({
        components: [
          {
            componentId: 'c-puerta',
            quantity: 1,
            placementOverride: 'puerta',
            overrides: {
              hardwarePlacements: [
                {
                  hardwareId,
                  anchorFace: 'front',
                  relativePosition: { xMm: 300, yMm: 360 },
                },
              ],
            },
          },
        ],
      });

    const costOnly = resolveAgregado3DPreview(
      draftWith('hw-torn-1'),
      catalogInputConHerrajes,
    );
    expect(costOnly.error).toBeNull();
    expect(costOnly.parts).toHaveLength(1);
    expect(costOnly.resolvedHardwarePlacements).toEqual([]);

    const missing = resolveAgregado3DPreview(
      draftWith('hw-inexistente'),
      catalogInputConHerrajes,
    );
    expect(missing.error).toBeNull();
    expect(missing.resolvedHardwarePlacements).toEqual([]);
  });

  it('returns empty placements when no piece carries them', () => {
    const res = resolveAgregado3DPreview(doorDraft(), catalogInputConHerrajes);

    expect(res.error).toBeNull();
    expect(res.resolvedHardwarePlacements).toEqual([]);
  });

  it('returns empty assemblies when no catalog agregado id is passed (#669)', () => {
    const res = resolveAgregado3DPreview(doorDraft(), catalogInputConHerrajes);

    expect(res.error).toBeNull();
    expect(res.assemblies).toEqual([]);
  });

  it('returns empty assemblies when the id is unknown or has no recipe (#669)', () => {
    const unknown = resolveAgregado3DPreview(doorDraft(), catalogInputConHerrajes, null, 'agr-inexistente');
    expect(unknown.error).toBeNull();
    expect(unknown.assemblies).toEqual([]);
    expect(unknown.parts).toHaveLength(1);

    const noRecipe = resolveAgregado3DPreview(
      doorDraft(),
      { ...mockCatalogInput, agregados: [{ id: 'agr-sin-receta', code: 'SR', name: 'Sin receta' }] },
      null,
      'agr-sin-receta',
    );
    expect(noRecipe.error).toBeNull();
    expect(noRecipe.assemblies).toEqual([]);
  });

  it('projects the catalog agregado recipe with visual pins and GLB (#669)', () => {
    const catalogWithRecipe: Module3DCatalogInput = {
      ...catalogInputConHerrajes,
      agregados: [
        {
          id: 'agr-cajon',
          code: 'CAJ',
          name: 'Cajón',
          commercialKitHardwareId: 'hw-kit-1',
          rigidMembers: [
            {
              memberId: 'lateral-izq',
              role: 'side_left',
              source: { kind: 'fixed', fixed: { hardwareId: 'hw-jal-1' } },
              placement: {
                x: { ref: 'min', offsetMm: 0 },
                y: { ref: 'min', offsetMm: 0 },
                z: { ref: 'min', offsetMm: 0 },
              },
              bomRole: 'included_in_kit',
            },
          ],
        },
      ],
      hardware: [
        {
          ...jaladera,
          visualAsset: {
            assetId: 'ast-jal-1',
            assetRevisionId: 'rev-skp-1',
            representation: 'skp',
            sha256: 's'.repeat(64),
            validationState: 'validated',
            glb: {
              revisionId: 'rev-glb-1',
              sha256: 'g'.repeat(64),
              sourceRevisionId: 'rev-skp-1',
              sourceUnits: 'm',
              upAxis: 'y',
            },
            mountFrame: {
              originMm: [25, 30, 15],
              basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
            },
          },
        },
        tornilloCostOnly,
      ],
    };

    const res = resolveAgregado3DPreview(doorDraft(), catalogWithRecipe, null, 'agr-cajon');

    expect(res.error).toBeNull();
    expect(res.assemblies).toHaveLength(1);
    const assembly = res.assemblies[0]!;
    expect(assembly.agregadoId).toBe('agr-cajon');
    expect(assembly.isHistorical).toBe(false);
    expect(assembly.placement.originMm).toEqual([0, 0, 0]);
    expect(assembly.rigidMembers).toHaveLength(1);
    const member = assembly.rigidMembers[0]!;
    expect(member.memberId).toBe('lateral-izq');
    expect(member.hardwareId).toBe('hw-jal-1');
    // Visual pins from the catalog lookup (#668 authority).
    expect(member.assetId).toBe('ast-jal-1');
    expect(member.assetRevisionId).toBe('rev-skp-1');
    expect(member.renderStatus).toBe('exact');
    // GLB co-representation for the web consumer.
    expect(member.glb?.revisionId).toBe('rev-glb-1');
    expect(member.glb?.sha256).toBe('g'.repeat(64));
    expect(member.glb?.sourceUnits).toBe('m');
    expect(member.glb?.upAxis).toBe('y');
  });

  it('keeps pieces and reports an honest diagnostic when the recipe fails (#669)', () => {
    const catalogWithBadRecipe: Module3DCatalogInput = {
      ...mockCatalogInput,
      agregados: [
        {
          id: 'agr-roto',
          code: 'RTO',
          name: 'Roto',
          rigidMembers: [
            {
              memberId: 'm1',
              role: 'side',
              source: { kind: 'variant', variant: { variantSetId: 'vs-ghost' } },
              placement: {
                x: { ref: 'min', offsetMm: 0 },
                y: { ref: 'min', offsetMm: 0 },
                z: { ref: 'min', offsetMm: 0 },
              },
              bomRole: 'included_in_kit',
            },
          ],
        },
      ],
    };

    const res = resolveAgregado3DPreview(doorDraft(), catalogWithBadRecipe, null, 'agr-roto');

    expect(res.parts).toHaveLength(1);
    expect(res.assemblies).toEqual([]);
    expect(res.error).toMatch(/No se pudo proyectar el ensamble/);
  });

  // Regression (#669 browser gate): the agregado preview projected fabricated
  // boards WITHOUT the R3 thickness/material authority the module path applies,
  // so AssemblyMesh threw at render time and the whole 3D view died with
  // "Error al renderizar la vista 3D". Both paths now share the enrichment.
  describe('fabricated boards carry authoritative thickness before projection (R3)', () => {
    const fondoComponent: Component = {
      id: 'c-fondo',
      code: 'FND',
      name: 'Fondo de cajón',
      placement: 'base',
      geometry: { kind: 'rectangular_board', lengthMm: 500, widthMm: 500, thicknessMm: 15 },
      defaultEdges: [],
      optionRoles: ['INTERIOR'],
      active: true,
    };
    const recipeWithBoard = (componentId: string) => ({
      id: 'agr-cajon-fondo',
      code: 'CAJF',
      name: 'Cajón con fondo',
      commercialKitHardwareId: 'hw-kit-1',
      rigidMembers: [
        {
          memberId: 'lateral-izq',
          role: 'side_left',
          source: { kind: 'fixed' as const, fixed: { hardwareId: 'hw-jal-1' } },
          placement: {
            x: { ref: 'min' as const, offsetMm: 0 },
            y: { ref: 'min' as const, offsetMm: 0 },
            z: { ref: 'min' as const, offsetMm: 0 },
          },
          bomRole: 'included_in_kit' as const,
        },
      ],
      components: [
        {
          componentId,
          quantity: 1,
          overrides: {
            widthRule: { source: 'assembly_width' as const, offsetMm: -35 },
            lengthRule: { source: 'assembly_depth' as const, offsetMm: -10 },
            placementRule: {
              x: { ref: 'min' as const, offsetMm: 17.5 },
              y: { ref: 'min' as const, offsetMm: 5 },
              z: { ref: 'min' as const, offsetMm: 15 },
            },
          },
        },
      ],
    });

    it('takes thickness and material from the bound board material when the role has a choice', () => {
      const catalog: Module3DCatalogInput = {
        ...catalogInputConHerrajes,
        components: [mockComponent, fondoComponent],
        materials: [
          ...mockCatalogInput.materials,
          {
            id: 'mat-int-16',
            code: 'MEL16',
            name: 'Melamina 16',
            widthMm: 1830,
            lengthMm: 2600,
            thicknessMm: 16,
            grainDefault: true,
            boardPrice: 80,
            wastePercent: 10,
            costPerM2: 15,
            active: true,
          },
        ],
        optionGroups: [
          ...mockCatalogInput.optionGroups,
          {
            id: 'og-interior',
            code: 'INTERIOR',
            name: 'Interior',
            kind: 'board',
            required: true,
            optionIds: ['mat-int-16'],
          },
        ],
        agregados: [recipeWithBoard('c-fondo')],
      };

      const res = resolveAgregado3DPreview(
        doorDraft(),
        catalog,
        { INTERIOR: 'mat-int-16' },
        'agr-cajon-fondo',
      );

      expect(res.error).toBeNull();
      expect(res.assemblies).toHaveLength(1);
      const [fondo] = res.assemblies[0]!.fabricatedComponents;
      expect(fondo?.componentId).toBe('c-fondo');
      expect(fondo?.thicknessMm).toBe(16);
      expect(fondo?.materialId).toBe('mat-int-16');
    });

    it('falls back to the component geometry thickness when no material is bound', () => {
      const catalog: Module3DCatalogInput = {
        ...catalogInputConHerrajes,
        components: [mockComponent, fondoComponent],
        agregados: [recipeWithBoard('c-fondo')],
      };

      const res = resolveAgregado3DPreview(doorDraft(), catalog, null, 'agr-cajon-fondo');

      expect(res.error).toBeNull();
      const [fondo] = res.assemblies[0]!.fabricatedComponents;
      expect(fondo?.thicknessMm).toBe(15);
    });

    it('reports an honest diagnostic instead of a render crash when no thickness authority exists', () => {
      const catalog: Module3DCatalogInput = {
        ...catalogInputConHerrajes,
        agregados: [recipeWithBoard('c-fantasma')],
      };

      const res = resolveAgregado3DPreview(doorDraft(), catalog, null, 'agr-cajon-fondo');

      expect(res.parts).toHaveLength(1);
      expect(res.assemblies).toEqual([]);
      expect(res.error).toMatch(/thicknessMm not found for fabricated component 'c-fantasma'/);
    });
  });
});

describe('resolveAgregado3DPreview hardware-only recipe (#669 review note)', () => {
  it('counts assemblies as content: a rigid-members-only recipe is not empty', () => {
    const catalogWithRecipe: Module3DCatalogInput = {
      ...catalogInputConHerrajes,
      agregados: [
        {
          id: 'agr-kit',
          code: 'KIT',
          name: 'Kit sólo herraje',
          commercialKitHardwareId: 'hw-kit-1',
          rigidMembers: [
            {
              memberId: 'jaladera',
              role: 'pull',
              source: { kind: 'fixed', fixed: { hardwareId: 'hw-jal-1' } },
              placement: {
                x: { ref: 'center', offsetMm: 0 },
                y: { ref: 'min', offsetMm: 0 },
                z: { ref: 'center', offsetMm: 0 },
              },
              bomRole: 'included_in_kit',
            },
          ],
        },
      ],
    };
    const res = resolveAgregado3DPreview(
      doorDraft({ components: [] }),
      catalogWithRecipe,
      null,
      'agr-kit',
    );

    expect(res.error).toBeNull();
    expect(res.parts).toHaveLength(0);
    expect(res.assemblies).toHaveLength(1);
    expect(res.empty).toBe(false);
  });
});
