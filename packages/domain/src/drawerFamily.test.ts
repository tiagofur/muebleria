import { describe, expect, it } from 'vitest';
import { drawerFamilies, summarizeDrawerFamily } from './drawerFamily';
import type { Agregado, Hardware, OptionGroup } from './types';

// #1633 s2c-2 — la vista de familia lee el catálogo: alturas con su juego,
// insertos como columnas por sufijo, default por altura y lo que falta.

const asset = { assetId: 'a', assetRevisionId: 'r' };
const hw = (h: Partial<Hardware> & Pick<Hardware, 'id' | 'code'>): Hardware =>
  ({ name: h.code, unit: 'piece', costPerUnit: 0, active: true, ...h }) as Hardware;

const hardware: Hardware[] = [
  hw({ id: 'kit-m', code: 'SYS-M', unit: 'set', costPerUnit: 420 }),
  hw({ id: 'kit-e', code: 'SYS-E', unit: 'set', costPerUnit: 0 }),
  hw({ id: 'm-fij', code: 'SYS-M-FIJ', kitHardwareId: 'kit-m', pieces: [{ anchor: 'left', asset }, { anchor: 'right', asset }] }),
  hw({ id: 'e-fij', code: 'SYS-E-FIJ', kitHardwareId: 'kit-e', pieces: [{ anchor: 'left', asset }, { anchor: 'right' }] }),
  hw({ id: 'e-gal', code: 'SYS-E-GAL', name: 'Sistema E — Galería', costPerUnit: 120, pieces: [{ anchor: 'left', asset }] }),
  hw({ id: 'e-box', code: 'SYS-E-BOX', name: 'Sistema E — Boxcap', costPerUnit: 0, pieces: [{ anchor: 'left' }] }),
  hw({ id: 'm-gal', code: 'SYS-M-GAL', name: 'Sistema M — Galería', costPerUnit: 100, active: false, pieces: [] }),
];
const optionGroups: OptionGroup[] = [
  { id: 'g-e', code: 'SYS_LATERAL_E', name: 'Insertos E', kind: 'hardware', required: false, optionIds: ['e-gal', 'e-box'], kitHardwareId: 'kit-e' } as OptionGroup,
  { id: 'g-m', code: 'SYS_LATERAL_M', name: 'Insertos M', kind: 'hardware', required: false, optionIds: ['m-gal'], kitHardwareId: 'kit-m' } as OptionGroup,
];
const family: Agregado = {
  id: 'agr', code: 'SYS-CAJON', name: 'Cajón Sistema', active: true,
  drawerSystem: { brand: 'Blum' },
  variantSets: [{ id: 'vs', dimension: 'height', variants: [
    { nominalDimensionMm: 108, hardwareId: 'kit-m', commercialKitHardwareId: 'kit-m' },
    { nominalDimensionMm: 209, hardwareId: 'kit-e', commercialKitHardwareId: 'kit-e', label: 'E' },
  ] }],
} as Agregado;

describe('#1633 summarizeDrawerFamily', () => {
  const s = summarizeDrawerFamily(family, { hardware, optionGroups });

  it('alturas con etiqueta efectiva (108 legado = M), juego y selector', () => {
    expect(s.heights.map((h) => [h.label, h.khMinMm, h.kit?.code, h.selector?.code])).toEqual([
      ['M', 108, 'SYS-M', 'SYS_LATERAL_M'],
      ['E', 209, 'SYS-E', 'SYS_LATERAL_E'],
    ]);
    expect(s.brand).toBe('Blum');
  });

  it('insertos como columnas por sufijo, con etiqueta tomada del nombre', () => {
    expect(s.inserts).toEqual([
      { key: 'GAL', label: 'Galería' },
      { key: 'BOX', label: 'Boxcap' },
    ]);
    expect(s.cells[0]!.BOX).toBeUndefined(); // no aplica en M
    expect(s.cells[1]!.GAL).toMatchObject({ costPerUnit: 120, designMissing: false, isDefault: true });
    expect(s.cells[1]!.BOX).toMatchObject({ designMissing: true, isDefault: false });
  });

  it('el default salta las opciones inactivas; default «ninguno» no marca ninguna', () => {
    expect(s.cells[0]!.GAL).toMatchObject({ active: false, isDefault: false });
    const none = summarizeDrawerFamily(family, {
      hardware,
      optionGroups: optionGroups.map((g) => (g.id === 'g-e' ? ({ ...g, defaultChoice: 'none' } as OptionGroup) : g)),
    });
    expect(Object.values(none.cells[1]!).some((c) => c.isDefault)).toBe(false);
  });

  it('cuenta lo que falta: diseños (parte E-FIJ + Boxcap), precios (juego E + Boxcap); inactivos no cuentan', () => {
    expect(s.missing).toEqual({ kits: 0, designs: 2, prices: 2 });
    expect(s.complete).toBe(false);
  });

  it('un juego que no está en el catálogo cuenta como faltante', () => {
    const broken = summarizeDrawerFamily(
      { ...family, variantSets: [{ id: 'vs', dimension: 'height', variants: [{ nominalDimensionMm: 146, hardwareId: 'nope' }] }] } as Agregado,
      { hardware, optionGroups },
    );
    expect(broken.heights[0]).toMatchObject({ label: 'K', kit: null });
    expect(broken.missing.kits).toBe(1);
  });

  it('drawerFamilies: sólo familias activas (marcador o -CAJON legado)', () => {
    const list = drawerFamilies(
      [family, { id: 'p', code: 'PUERTA', name: 'Puerta' } as Agregado, { ...family, id: 'off', active: false }],
      { hardware, optionGroups },
    );
    expect(list.map((f) => f.agregadoId)).toEqual(['agr']);
  });

  it('review #1638: juego inactivo cuenta como faltante; etiqueta deducida marcada; disponible en y medidas', () => {
    const inactive = summarizeDrawerFamily(
      { ...family, externalDims: { width: 570, height: 209, depth: 530 } } as Agregado,
      {
        hardware: hardware.map((h) => (h.id === 'kit-m' ? { ...h, active: false } : h)),
        optionGroups: [
          ...optionGroups,
          { id: 'elig', code: 'SISTEMA_CAJON', name: 'Sistemas de cajón', kind: 'agregado', required: false, optionIds: ['agr'] } as OptionGroup,
        ],
      },
    );
    expect(inactive.heights[0]!.kit?.active).toBe(false);
    expect(inactive.missing.kits).toBe(1);
    expect(inactive.heights.map((h) => h.labelDerived)).toEqual([true, false]);
    expect(inactive.availableIn.map((g) => g.code)).toEqual(['SISTEMA_CAJON']);
    expect([inactive.guideWidthMm, inactive.guideDepthMm]).toEqual([570, 530]);
  });

  it('review #1638: insertos con código fuera del patrón se agrupan por nombre entre alturas', () => {
    const hw2: Hardware[] = [
      ...hardware,
      hw({ id: 'x-m', code: 'MBOX-M-GAL-IG', name: 'Galería', costPerUnit: 10, pieces: [{ anchor: 'left', asset }] }),
      hw({ id: 'x-e', code: 'MBOX-E-GAL-IG', name: 'Galería', costPerUnit: 10, pieces: [{ anchor: 'left', asset }] }),
    ];
    const groups: OptionGroup[] = [
      { ...optionGroups[0]!, optionIds: ['x-e'] } as OptionGroup,
      { ...optionGroups[1]!, optionIds: ['x-m'] } as OptionGroup,
    ];
    const s2 = summarizeDrawerFamily(family, { hardware: hw2, optionGroups: groups });
    expect(s2.inserts).toEqual([{ key: 'nombre:galería', label: 'Galería' }]);
    expect(s2.cells[0]!['nombre:galería']?.code).toBe('MBOX-M-GAL-IG');
    expect(s2.cells[1]!['nombre:galería']?.code).toBe('MBOX-E-GAL-IG');
  });
});
