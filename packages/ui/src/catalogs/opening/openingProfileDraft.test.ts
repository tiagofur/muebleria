/**
 * #1325 — draft round-trip for the opening profile form: entity → draft →
 * write body, pinning the #1317 derivation contract (the depth reduction
 * declared WITHOUT a value travels as effect-only, never as a typed
 * constant) and the notch/derived/explícito conversions.
 */
import { describe, expect, it } from 'vitest';
import {
  bodyModifiersOfDraft,
  emptyOpeningProfileDraft,
  suggestOpeningProfileId,
  toOpeningProfileDraft,
  type OpeningProfileRowLike,
} from './openingProfileDraft';

const v7Row: OpeningProfileRowLike = {
  id: 'profile.gola-l.8006',
  code: 'GOLA-L-8006',
  name: 'Gola L Cymisa 8006',
  gripType: 'gola',
  crossSection: 'L',
  placements: ['top'],
  datasheetStatus: 'verified',
  frontReductionMm: 38,
  gripClearanceMm: 2,
  doorReductionMm: null,
  profileHeightMm: 56.5,
  profileDepthMm: 27.2,
  geometryOrigin: 'docs/fichas/perfil_gola_l_ficha_tecnica.pdf',
  bodyModifiers: [
    { role: 'lateral', notch_height_mm: 56.5, notch_depth_mm: 27.2, notch_at: 'top_front' },
    { role: 'horizontal', effect: 'depth_reduction' },
  ],
  bomMembers: { profile: { hardware_id: 'hw-8006', rule: 'interior_width' } },
};

describe('toOpeningProfileDraft', () => {
  it('round-trips the live v7 profile (notch + derived reduction)', () => {
    const draft = toOpeningProfileDraft(v7Row);
    expect(draft.notchEnabled).toBe(true);
    expect(draft.notchHeightMm).toBe('56.5');
    expect(draft.notchDepthMm).toBe('27.2');
    expect(draft.notchAt).toBe('top_front');
    expect(draft.depthReductionEnabled).toBe(true);
    // #1317: the v7 profile declares the effect WITHOUT a value.
    expect(draft.depthReductionDerived).toBe(true);
    expect(draft.depthReductionMm).toBe('');
    expect(draft.members.map((m) => m.key)).toEqual(['profile']);
    const profileMember = draft.members.find((m) => m.key === 'profile');
    expect(profileMember?.kind).toBe('hardware');
    expect(profileMember?.rule).toBe('interior_width');
  });

  it('recognizes an explicit reduction value', () => {
    const draft = toOpeningProfileDraft({
      ...v7Row,
      bodyModifiers: [{ role: 'horizontal', effect: 'depth_reduction', depth_reduction_mm: 30 }],
    });
    expect(draft.depthReductionEnabled).toBe(true);
    expect(draft.depthReductionDerived).toBe(false);
    expect(draft.depthReductionMm).toBe('30');
  });
});

describe('bodyModifiersOfDraft', () => {
  it('emits nothing when no effect is enabled', () => {
    expect(bodyModifiersOfDraft(emptyOpeningProfileDraft())).toEqual([]);
  });

  it('emits the derived reduction as effect-only (never a typed constant)', () => {
    const modifiers = bodyModifiersOfDraft({
      ...emptyOpeningProfileDraft(),
      depthReductionEnabled: true,
      depthReductionDerived: true,
      profileDepthMm: '27.2',
    });
    expect(modifiers).toEqual([{ role: 'horizontal', effect: 'depth_reduction' }]);
  });

  it('emits the explicit reduction value when chosen', () => {
    const modifiers = bodyModifiersOfDraft({
      ...emptyOpeningProfileDraft(),
      depthReductionEnabled: true,
      depthReductionDerived: false,
      depthReductionMm: '30',
    });
    expect(modifiers).toEqual([
      { role: 'horizontal', effect: 'depth_reduction', depth_reduction_mm: 30 },
    ]);
  });

  it('emits the complete notch declaration', () => {
    const modifiers = bodyModifiersOfDraft({
      ...emptyOpeningProfileDraft(),
      notchEnabled: true,
      notchHeightMm: '56.5',
      notchDepthMm: '27.2',
      notchAt: 'top_front',
    });
    expect(modifiers).toEqual([
      { role: 'lateral', notch_height_mm: 56.5, notch_depth_mm: 27.2, notch_at: 'top_front' },
    ]);
  });
});

describe('#1327 slice 3 — bisel 45° de la puerta (gola italiano)', () => {
  it('lee el bisel declarado por API y lo preserva en el draft', () => {
    const draft = toOpeningProfileDraft({
      ...v7Row,
      bodyModifiers: [...v7Row.bodyModifiers, { role: 'door', bevel_angle_deg: 45, bevel_size_mm: 18, bevel_at: 'top_front' }],
    });
    expect(draft.bevelEnabled).toBe(true);
    expect(draft.bevelSizeMm).toBe('18');
    expect(draft.bevelAt).toBe('top_front');
  });

  it('el write body reconstruye el bisel completo sin perder los otros efectos', () => {
    const draft = toOpeningProfileDraft({
      ...v7Row,
      bodyModifiers: [...v7Row.bodyModifiers, { role: 'door', bevel_angle_deg: 45, bevel_size_mm: 18, bevel_at: 'top_front' }],
    });
    expect(bodyModifiersOfDraft(draft)).toEqual([
      { role: 'lateral', notch_height_mm: 56.5, notch_depth_mm: 27.2, notch_at: 'top_front' },
      { role: 'horizontal', effect: 'depth_reduction' },
      { role: 'door', bevel_angle_deg: 45, bevel_size_mm: 18, bevel_at: 'top_front' },
    ]);
  });

  it('emite el bisel declarado desde cero con el ángulo constante 45', () => {
    const modifiers = bodyModifiersOfDraft({
      ...emptyOpeningProfileDraft(),
      bevelEnabled: true,
      bevelSizeMm: '18',
      bevelAt: 'bottom_front',
    });
    expect(modifiers).toEqual([
      { role: 'door', bevel_angle_deg: 45, bevel_size_mm: 18, bevel_at: 'bottom_front' },
    ]);
  });

  it('un perfil sin bisel no emite ninguno', () => {
    const draft = toOpeningProfileDraft(v7Row);
    expect(draft.bevelEnabled).toBe(false);
    expect(bodyModifiersOfDraft(draft)).toEqual([
      { role: 'lateral', notch_height_mm: 56.5, notch_depth_mm: 27.2, notch_at: 'top_front' },
      { role: 'horizontal', effect: 'depth_reduction' },
    ]);
  });
});

describe('#1316 — descuento de puerta como un solo número', () => {
  it('el par de ficha legacy (38+2) se prefill como 40 en el draft', () => {
    const draft = toOpeningProfileDraft(v7Row);
    expect(draft.doorReductionMm).toBe('40');
  });

  it('el descuento declarado gana al par', () => {
    const draft = toOpeningProfileDraft({ ...v7Row, doorReductionMm: 32 });
    expect(draft.doorReductionMm).toBe('32');
  });

  it('el write body lleva door_reduction_mm y el par intacto como documentación', async () => {
    const { openingProfileWriteBody } = await import('./OpeningProfilesCatalog');
    const draft = { ...toOpeningProfileDraft(v7Row), doorReductionMm: '32' };
    const body = openingProfileWriteBody(draft) as unknown as Record<string, unknown>;
    expect(body.door_reduction_mm).toBe(32);
    expect(body.front_reduction_mm).toBe(38);
    expect(body.grip_clearance_mm).toBe(2);
  });
});

describe('#1327 — miembro tipo componente (tira del gola italiano)', () => {
  const tiraRow = {
    ...v7Row,
    bomMembers: {
      profile: { hardware_id: 'hw-8006', rule: 'interior_width' },
      tira: { hardware_id: '', component_id: 'comp-tira-gola-it', rule: 'interior_width', unit: 'piece' },
    },
  };

  it('el member componente se lee con kind component y su referencia', () => {
    const draft = toOpeningProfileDraft(tiraRow);
    const tira = draft.members.find((m) => m.key === 'tira');
    expect(tira?.kind).toBe('component');
    expect(tira?.componentId).toBe('comp-tira-gola-it');
    const profile = draft.members.find((m) => m.key === 'profile');
    expect(profile?.kind).toBe('hardware');
  });

  it('el write body reconstruye el mapa con component_id y sin perder el herraje', async () => {
    const { openingProfileWriteBody } = await import('./OpeningProfilesCatalog');
    const body = openingProfileWriteBody({ ...toOpeningProfileDraft(tiraRow), doorReductionMm: '35' }) as unknown as Record<string, Record<string, unknown>>;
    expect(body.bom_members).toEqual({
      profile: expect.objectContaining({ hardware_id: 'hw-8006' }),
      tira: expect.objectContaining({ component_id: 'comp-tira-gola-it', rule: 'interior_width', unit: 'piece' }),
    });
    // hardware_id stays as the required contract key, EMPTY for component members.
    expect((body.bom_members as Record<string, unknown>).tira).toHaveProperty('hardware_id', '');
    expect(body.door_reduction_mm).toBe(35);
  });
});

describe('suggestOpeningProfileId', () => {
  it('slugs the code into the profile.<kebab> convention', () => {
    expect(suggestOpeningProfileId('GOLA-L-8006')).toBe('profile.gola-l-8006');
    expect(suggestOpeningProfileId('  perfil cymisa 900 ')).toBe('profile.perfil-cymisa-900');
    expect(suggestOpeningProfileId('///')).toBe('');
  });
});
