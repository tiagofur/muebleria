import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBom } from './engine/bom';
import type { Agregado, Catalog, Hardware, Module, Structure } from './types';
import type { ProductVariant } from './agregadoAssembly';

// #1493 slice 3: paridad TS↔Go de la cotización del kit por bahía. Autoridad
// numérica única: contracts/fixtures/variantKitQuoteParity.contract.json —
// ambos lados CONSTRUYEN la receta desde el JSON (patrón del pilot canónico).
// El espejo Go vive en backend-go/internal/domain/engine/variant_kit_quote_parity_test.go.

interface VariantKitQuoteFixture {
  heights: { code: string; nominalDimensionMm: number; hardwareId: string; kitHardwareId: string }[];
  module: { widthMm: number; heightMm: number; depthMm: number; bottomFraction: number; topCount: number };
  expectedKitLines: { instanceId: string; unitIndex: number; hardwareId: string; quantity: number }[];
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/variantKitQuoteParity.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as VariantKitQuoteFixture;

expect(f.heights).toHaveLength(4);

const buildAgregado = (withVariantKits: boolean): Agregado =>
  ({
    id: withVariantKits ? 'agr-mbox-alturas' : 'agr-mbox-legacy',
    code: withVariantKits ? 'MERIVOBOX-ALTURAS' : 'MERIVOBOX-LEGACY',
    name: withVariantKits ? 'MERIVOBOX por altura' : 'MERIVOBOX legacy',
    active: true,
    ...(!withVariantKits ? { commercialKitHardwareId: 'kit-mbox-m' } : {}),
    variantSets: [
      {
        id: 'height-variants',
        dimension: 'height',
        variants: f.heights.map(
          (h): ProductVariant => ({
            nominalDimensionMm: h.nominalDimensionMm,
            hardwareId: h.hardwareId,
            ...(withVariantKits ? { commercialKitHardwareId: h.kitHardwareId } : {}),
          }),
        ),
      },
    ],
    rigidMembers: (['min', 'max'] as const).map((ref, i) => ({
      memberId: `side-${i === 0 ? 'left' : 'right'}`,
      role: `drawer_side_${i === 0 ? 'left' : 'right'}`,
      source: {
        kind: withVariantKits ? 'variant' : 'fixed',
        ...(withVariantKits
          ? { variant: { variantSetId: 'height-variants' } }
          : { fixed: { hardwareId: 'hw-mbox-m' } }),
      },
      placement: { x: { ref, offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
      bomRole: 'included_in_kit',
    })),
    components: [],
    hardwareLines: [],
  }) as unknown as Agregado;

const hardware: Hardware[] = f.heights.flatMap((h) => [
  { id: h.hardwareId, code: h.hardwareId, name: h.hardwareId, unit: 'piece', costPerUnit: 100, active: true },
  { id: h.kitHardwareId, code: h.kitHardwareId, name: h.kitHardwareId, unit: 'set', costPerUnit: 200, active: true },
]) as unknown as Hardware[];

const structure: Structure = {
  id: 'st-base',
  code: 'ST-BASE',
  name: 'Cuerpo',
  components: [],
  agregados: [],
  active: true,
} as unknown as Structure;

const module: Module = {
  id: 'mod-cajonera',
  code: 'CAJONERA-3',
  name: 'Cajonera 3 cajones',
  structureId: 'st-base',
  externalDims: { width: f.module.widthMm, height: f.module.heightMm, depth: f.module.depthMm },
  agregados: [
    { id: 'inst-bajo', agregadoId: 'agr-mbox-alturas', quantity: 1, dimensions: { heightFormula: `PH * ${f.module.bottomFraction}` } },
    {
      id: 'inst-alto',
      agregadoId: 'agr-mbox-alturas',
      quantity: f.module.topCount,
      layoutDirection: 'vertical',
      position: { zFormula: `PH * ${f.module.bottomFraction}` },
      dimensions: { heightFormula: `PH * ${f.module.bottomFraction}` },
    },
    { id: 'inst-legacy', agregadoId: 'agr-mbox-legacy', quantity: 1 },
  ],
  hardwareLines: [],
} as unknown as Module;

const catalog = {
  structures: [structure],
  agregados: [buildAgregado(true), buildAgregado(false)],
  hardware,
  components: [],
  materials: [],
  edges: [],
  optionGroups: [],
} as unknown as Catalog;

describe('#1493 slice 3 — cotización del kit por bahía (paridad con Go)', () => {
  it('cajonera 3 cajones ½+¼+¼: 1×kit-E + 2×kit-M y cero líneas para la receta legacy', () => {
    const bom = resolveBom(module, {}, catalog);
    const kitLines = bom.hardwareLines.filter((line) => line.optionRole === 'COMMERCIAL_KIT');

    expect(kitLines).toHaveLength(f.expectedKitLines.length);
    f.expectedKitLines.forEach((want, i) => {
      const got = kitLines[i]!;
      expect(got.id).toBe(`kit-agr-${want.instanceId}-u${want.unitIndex}`);
      expect(got.hardwareId).toBe(want.hardwareId);
      expect(got.quantity).toBe(want.quantity);
    });
    // La receta legacy (kit a nivel agregado) NO aporta líneas de kit.
    expect(kitLines.every((line) => !line.id.startsWith('kit-agr-inst-legacy'))).toBe(true);
  });
});
