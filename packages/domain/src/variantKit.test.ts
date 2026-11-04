import { describe, expect, it } from 'vitest';
import {
  effectiveKitHardwareId,
  resolveAgregadoAssembly,
  selectAgregadoVariants,
  validateAgregadoAssemblyDefinition,
  type AgregadoAssemblyInput,
  type AgregadoRigidMember,
  type ProductVariant,
} from './agregadoAssembly';

// #1493: kit comercial por variante. Una altura Blum MERIVOBOX N/M/K/E es un
// kit distinto (la E cacerolera lleva galería), así que la variante puede
// declarar su propio commercialKitHardwareId y el resolve lo usa en el BOM.
// Paridad Go: backend-go/internal/domain/engine/variant_kit_test.go.

const HEIGHT_VARIANTS: ReadonlyArray<Required<Pick<ProductVariant, 'nominalDimensionMm' | 'hardwareId'>>> = [
  { nominalDimensionMm: 85.5, hardwareId: 'hw-mbox-n' },
  { nominalDimensionMm: 108.0, hardwareId: 'hw-mbox-m' },
  { nominalDimensionMm: 146.0, hardwareId: 'hw-mbox-k' },
  { nominalDimensionMm: 209.0, hardwareId: 'hw-mbox-e' },
];

function heightKitFixture(
  agregadoKitId: string | undefined,
  variantKits: Record<number, string>,
): AgregadoAssemblyInput {
  const variants = HEIGHT_VARIANTS.map((v) => ({
    ...v,
    ...(variantKits[v.nominalDimensionMm] ? { commercialKitHardwareId: variantKits[v.nominalDimensionMm] } : {}),
  }));

  const member = (memberId: string, role: string, xRef: 'min' | 'max'): AgregadoRigidMember => ({
    memberId,
    role,
    source: { kind: 'variant', variant: { variantSetId: 'height-variants' } },
    placement: {
      x: { ref: xRef, offsetMm: 0 },
      y: { ref: 'min', offsetMm: 0 },
      z: { ref: 'min', offsetMm: 0 },
    },
    bomRole: 'included_in_kit',
  });

  return {
    id: 'agr-merivobox-alturas',
    ...(agregadoKitId ? { commercialKitHardwareId: agregadoKitId } : {}),
    variantSets: [{ id: 'height-variants', dimension: 'height', variants }],
    rigidMembers: [member('side-left', 'drawer_side_left', 'min'), member('side-right', 'drawer_side_right', 'max')],
    components: [
      {
        componentId: 'comp-back',
        quantity: 1,
        overrides: {
          widthRule: { source: 'assembly_width', offsetMm: -58 },
          // Trasera Blum real: KH mín − 25 (60.5/83/121/184).
          lengthRule: { source: 'selected_variant', variantSetId: 'height-variants', offsetMm: -25 },
          placementRule: {
            x: { ref: 'min', offsetMm: 29 },
            y: { ref: 'max', offsetMm: -16 },
            z: { ref: 'min', offsetMm: 32 },
          },
        },
      },
    ],
  };
}

const ALL_KITS = { 85.5: 'kit-mbox-n', 108: 'kit-mbox-m', 146: 'kit-mbox-k', 209: 'kit-mbox-e' };

describe('#1493 kit comercial por variante', () => {
  it('la variante seleccionada aporta el kit del BOM y la trasera KH−25', () => {
    const fixture = heightKitFixture(undefined, ALL_KITS);
    const cases = [
      { spaceMm: 85.5, wantKit: 'kit-mbox-n', wantBack: 60.5 },
      { spaceMm: 108, wantKit: 'kit-mbox-m', wantBack: 83 },
      { spaceMm: 146, wantKit: 'kit-mbox-k', wantBack: 121 },
      { spaceMm: 209, wantKit: 'kit-mbox-e', wantBack: 184 },
    ];
    for (const tc of cases) {
      const res = resolveAgregadoAssembly(fixture, { widthMm: 570, depthMm: 530, heightMm: tc.spaceMm });
      expect(res.commercialKitHardwareId).toBe(tc.wantKit);
      const kitRows = res.bomItems.filter((i) => i.role === 'commercial_kit');
      expect(kitRows).toHaveLength(1);
      expect(kitRows[0]!.hardwareId).toBe(tc.wantKit);
      const back = res.fabricatedComponents.find((c) => c.componentId === 'comp-back')!;
      expect(back.lengthMm).toBeCloseTo(tc.wantBack, 6);
    }
  });

  it('max_fitting elige la altura más alta que cabe y falla cerrado si nada cabe', () => {
    const fixture = heightKitFixture(undefined, ALL_KITS);
    const res = resolveAgregadoAssembly(fixture, { widthMm: 570, depthMm: 530, heightMm: 200 });
    expect(res.selectedVariants[0]!.nominalDimensionMm).toBe(146);
    expect(() =>
      resolveAgregadoAssembly(fixture, { widthMm: 570, depthMm: 530, heightMm: 85 }),
    ).toThrow(/cannot accommodate available nominals/);
  });

  it('fallback al kit del agregado cuando la variante no declara (legacy idéntico)', () => {
    const legacy = heightKitFixture('kit-mbox-m', {});
    const res = resolveAgregadoAssembly(legacy, { widthMm: 570, depthMm: 530, heightMm: 300 });
    expect(res.commercialKitHardwareId).toBe('kit-mbox-m');
    expect(res.bomItems.filter((i) => i.role === 'commercial_kit').map((i) => i.hardwareId)).toEqual(['kit-mbox-m']);
  });

  it('dos kits declarados entre las variantes seleccionadas es ambiguo y falla cerrado', () => {
    const ambiguous: AgregadoAssemblyInput = {
      ...heightKitFixture(undefined, { 85.5: 'kit-mbox-agr', 108: 'kit-mbox-agr', 146: 'kit-mbox-agr', 209: 'kit-mbox-agr' }),
      variantSets: [
        ...heightKitFixture(undefined, { 85.5: 'kit-mbox-agr', 108: 'kit-mbox-agr', 146: 'kit-mbox-agr', 209: 'kit-mbox-agr' }).variantSets!,
        {
          id: 'width-variants',
          dimension: 'width',
          variants: [{ nominalDimensionMm: 500, hardwareId: 'hw-mbox-w500', commercialKitHardwareId: 'kit-mbox-otro' }],
        },
      ],
    };
    expect(() =>
      resolveAgregadoAssembly(ambiguous, { widthMm: 570, depthMm: 530, heightMm: 300 }),
    ).toThrow(/ambiguous commercial kit/);
    expect(() =>
      resolveAgregadoAssembly(ambiguous, { widthMm: 570, depthMm: 530, heightMm: 300 }),
    ).toThrow(/kit-mbox-agr.*kit-mbox-otro|kit-mbox-otro.*kit-mbox-agr/);
  });

  it('included_in_kit sin kit efectivo falla cerrado en resolve', () => {
    const partial = heightKitFixture(undefined, { 85.5: 'kit-mbox-n' });
    expect(() => resolveAgregadoAssembly(partial, { widthMm: 570, depthMm: 530, heightMm: 300 })).toThrow(
      /no effective commercial kit is declared/,
    );
  });
});

describe('#1493 validación de definición', () => {
  it('included_in_kit es válido con kits de variante aunque el agregado no declare', () => {
    const agg = heightKitFixture(undefined, ALL_KITS);
    expect(() => validateAgregadoAssemblyDefinition(agg)).not.toThrow();
  });

  it('sin kit en ningún nivel la definición sigue rechazando included_in_kit', () => {
    const agg = heightKitFixture(undefined, {});
    expect(() => validateAgregadoAssemblyDefinition(agg)).toThrow(/included_in_kit.*invalid/);
  });

  it('commercialKitHardwareId de variante whitespace-only se rechaza', () => {
    const agg: AgregadoAssemblyInput = {
      ...heightKitFixture('kit-mbox-m', {}),
      variantSets: [
        {
          id: 'height-variants',
          dimension: 'height',
          variants: HEIGHT_VARIANTS.map((v) => ({
            ...v,
            ...(v.nominalDimensionMm === 85.5 ? { commercialKitHardwareId: '   ' } : {}),
          })),
        },
      ],
    };
    expect(() => validateAgregadoAssemblyDefinition(agg)).toThrow(/commercialKitHardwareId cannot be whitespace/);
  });
});

describe('#1493 effectiveKitHardwareId', () => {
  const agg = heightKitFixture('kit-mbox-agr', { 85.5: 'kit-mbox-n', 209: 'kit-mbox-e' });

  it('kit declarado en la variante seleccionada gana', () => {
    const kit = effectiveKitHardwareId(agg, [
      { variantSetId: 'height-variants', hardwareId: 'hw-mbox-n', nominalDimensionMm: 85.5 },
    ]);
    expect(kit).toBe('kit-mbox-n');
  });

  it('variante seleccionada sin declaración cae al kit del agregado', () => {
    const kit = effectiveKitHardwareId(agg, [
      { variantSetId: 'height-variants', hardwareId: 'hw-mbox-k', nominalDimensionMm: 146 },
    ]);
    expect(kit).toBe('kit-mbox-agr');
  });

  it('kit de variante NO seleccionada se ignora', () => {
    const kit = effectiveKitHardwareId(agg, [
      { variantSetId: 'height-variants', hardwareId: 'hw-mbox-m', nominalDimensionMm: 108 },
    ]);
    expect(kit).toBe('kit-mbox-agr');
  });

  it('selectAgregadoVariants expone la selección por bahía para el layout', () => {
    const selected = selectAgregadoVariants(heightKitFixture(undefined, ALL_KITS), {
      widthMm: 570,
      depthMm: 530,
      heightMm: 200,
    });
    expect(selected).toEqual([
      { variantSetId: 'height-variants', hardwareId: 'hw-mbox-k', nominalDimensionMm: 146 },
    ]);
  });
});
