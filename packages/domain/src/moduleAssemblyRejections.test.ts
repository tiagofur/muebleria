import { describe, expect, it } from 'vitest';
import {
  resolveModuleAgregadoAssemblies,
  resolveModuleAgregadoAssembliesDetailed,
  type AgregadoAssemblyInput,
} from './agregadoAssembly';
import type { Agregado, Hardware, Module } from './types';

// #1493 slice 2: paridad TS del guard de rechazos — el preview NUNCA omite un
// cajón en silencio ni rompe por una bahía: cada unidad sin ensamble queda en
// `rejections` con la razón exacta (espejo del wire contract Go).

const heightVariants = [
  { nominalDimensionMm: 85.5, hardwareId: 'hw-mbox-n', commercialKitHardwareId: 'kit-mbox-n' },
  { nominalDimensionMm: 108, hardwareId: 'hw-mbox-m', commercialKitHardwareId: 'kit-mbox-m' },
  { nominalDimensionMm: 146, hardwareId: 'hw-mbox-k', commercialKitHardwareId: 'kit-mbox-k' },
  { nominalDimensionMm: 209, hardwareId: 'hw-mbox-e', commercialKitHardwareId: 'kit-mbox-e' },
];

const heightAgregado = {
  id: 'agr-merivobox-alturas',
  code: 'MERIVOBOX-ALTURAS',
  name: 'MERIVOBOX por altura',
  variantSets: [{ id: 'height-variants', dimension: 'height', variants: heightVariants }],
  rigidMembers: (['min', 'max'] as const).map((ref, i) => ({
    memberId: `side-${i === 0 ? 'left' : 'right'}`,
    role: `drawer_side_${i === 0 ? 'left' : 'right'}`,
    source: { kind: 'variant', variant: { variantSetId: 'height-variants' } },
    placement: { x: { ref, offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
    bomRole: 'included_in_kit',
  })),
  components: [
    {
      componentId: 'comp-back',
      quantity: 1,
      overrides: {
        widthRule: { source: 'assembly_width', offsetMm: -58 },
        lengthRule: { source: 'selected_variant', variantSetId: 'height-variants', offsetMm: -25 },
      },
    },
  ],
} as unknown as Agregado;

const catalog = {
  agregados: [heightAgregado],
  hardware: heightVariants.map((v) => ({
    id: v.hardwareId,
    code: v.hardwareId,
    name: v.hardwareId,
    unit: 'piece',
    costPerUnit: 1,
    active: true,
  })) as unknown as Hardware[],
  // R8/R9: el espesor fabricado sale del componente del catálogo o del
  // material enlazado — sin fallback duro (el canonical pilot lo demuestra).
  components: [
    {
      id: 'comp-back',
      code: 'COMP-BACK',
      name: 'Trasera MERIVOBOX',
      geometry: { kind: 'rectangular_board', thicknessMm: 16 },
      active: true,
    },
  ] as never,
  materials: [],
};

const moduleWithBays = (bays: { id: string; z: string; h: string }[]) =>
  ({
    id: 'mod-rechazos',
    code: 'RECHAZOS',
    name: 'Módulo de rechazos',
    hardwareLines: [],
    agregados: bays.map((b) => ({
      id: b.id,
      agregadoId: 'agr-merivobox-alturas',
      quantity: 1,
      position: { xFormula: '0', yFormula: '0', zFormula: b.z },
      dimensions: { heightFormula: b.h },
    })),
  }) as unknown as Module;

describe('#1493 slice 2 — rechazos explícitos del resolver de módulo (paridad Go)', () => {
  it('bahía insuficiente: rechazo variant_not_found con nominales, ensamble omitido, SIN throw', () => {
    const { assemblies, rejections } = resolveModuleAgregadoAssembliesDetailed(
      moduleWithBays([{ id: 'inst-bajo', z: '0', h: '60' }]),
      { width: 600, height: 60, depth: 500 },
      catalog,
      { optionChoices: {} },
    );
    expect(assemblies).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    const rej = rejections[0]!;
    expect(rej.reason).toBe('variant_not_found');
    expect(rej.variantSetId).toBe('height-variants');
    expect(rej.assemblyInstanceId).toBe('inst-bajo');
    expect(rej.agregadoCode).toBe('MERIVOBOX-ALTURAS');
    expect(rej.bayHeightMm).toBe(60);
    expect(rej.fittingNominals).toEqual([85.5, 108, 146, 209]);
    // El wrapper compatible expone el mismo comportamiento sin throw.
    expect(resolveModuleAgregadoAssemblies(
      moduleWithBays([{ id: 'inst-bajo', z: '0', h: '60' }]),
      { width: 600, height: 60, depth: 500 },
      catalog,
      { optionChoices: {} },
    )).toHaveLength(0);
  });

  it('bahía válida: ensamble con selectedVariants y cero rechazos', () => {
    const { assemblies, rejections } = resolveModuleAgregadoAssembliesDetailed(
      moduleWithBays([{ id: 'inst-ok', z: '0', h: '280' }]),
      { width: 600, height: 280, depth: 500 },
      catalog,
      { optionChoices: {} },
    );
    expect(rejections).toHaveLength(0);
    expect(assemblies).toHaveLength(1);
    const svs = assemblies[0]!.resolvedAssembly!.selectedVariants;
    expect(svs).toHaveLength(1);
    expect(svs[0]!.nominalDimensionMm).toBe(209);
    expect(svs[0]!.hardwareId).toBe('hw-mbox-e');
  });

  it('mezcla en un módulo: 3 ensambles (E+M+M) y 1 rechazo en el MISMO resultado', () => {
    const { assemblies, rejections } = resolveModuleAgregadoAssembliesDetailed(
      moduleWithBays([
        { id: 'inst-bajo', z: '0', h: '280' },
        { id: 'inst-medio', z: '280', h: '140' },
        { id: 'inst-imposible', z: '420', h: '60' },
        { id: 'inst-alto', z: '480', h: '120' },
      ]),
      { width: 600, height: 560, depth: 500 },
      catalog,
      { optionChoices: {} },
    );
    // 280→E, 140→M, 60→rechazo, 120→M.
    expect(assemblies).toHaveLength(3);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.assemblyInstanceId).toBe('inst-imposible');
    expect(rejections[0]!.reason).toBe('variant_not_found');
  });

  it('receta inválida: rechazo definition_invalid una vez por instancia', () => {
    const broken = {
      ...heightAgregado,
      rigidMembers: [
        ...(heightAgregado as unknown as AgregadoAssemblyInput).rigidMembers!,
        {
          memberId: 'roto',
          role: 'roto',
          source: { kind: 'fixed', fixed: { hardwareId: '' } },
          placement: { x: { ref: 'min', offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
          bomRole: 'included_in_kit',
        },
      ],
    } as unknown as Agregado;
    const { assemblies, rejections } = resolveModuleAgregadoAssembliesDetailed(
      moduleWithBays([{ id: 'inst-rota', z: '0', h: '280' }]),
      { width: 600, height: 280, depth: 500 },
      { ...catalog, agregados: [broken] },
      { optionChoices: {} },
    );
    expect(assemblies).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.reason).toBe('definition_invalid');
  });
});
