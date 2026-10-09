/**
 * #1138 — caso C de punta a punta en el dominio: la regla respaldada
 * (`opening.bottom-overhang`) habilita la resolución; el cuerpo no cambia;
 * los frentes del borde inferior extienden exactamente la regla; sin BOM de
 * jaladera/gola; y el gate de familias (`byFurnitureType`) rige la selección.
 * El golden compartido (openingFrontResolution.contract.json) pinea los
 * números; aquí viven los invariantes de aceptancia transversales.
 */
import { describe, expect, it } from 'vitest';
import {
  parseOpeningOverhangRule,
  resolveOpeningFrontLayout,
  resolveOpeningBOM,
  validateOpeningConfiguration,
  type OpeningCapabilities,
} from './index';
import type { OpeningIntent } from './openingFront';

const RULE = parseOpeningOverhangRule({
  'opening.bottom-overhang': { version: 1, overhangMm: 40 },
});
if (!RULE.ok || !RULE.rule) throw new Error('fixture de regla inválido');
const overhangMm = RULE.rule.overhangMm;

const caseCIntent: OpeningIntent = {
  positioning: 'bottom_overhang',
  layout: {
    direction: 'vertical',
    zones: [{ id: 'puerta', access: 'hinged', ratio: 1 }],
  },
  grips: [],
};

const caseC = (overhang?: number) =>
  resolveOpeningFrontLayout(caseCIntent, 600, 720, {
    profiles: [],
    ...(overhang !== undefined ? { overhangMm: overhang } : {}),
  });

describe('#1138 caso C — aceptancia transversal', () => {
  it('sin regla respaldada el bloqueo veraz se mantiene (sin default)', () => {
    expect(caseC()).toMatchObject({
      ok: false,
      errorCode: 'OPENING_OVERHANG_EVIDENCE_PENDING',
    });
  });

  it('una regla malformada es entrada incompatible, nunca un silencio', () => {
    expect(caseC(0)).toMatchObject({ ok: false, errorCode: 'OPENING_LAYOUT_INVALID' });
    expect(caseC(40.5)).toMatchObject({ ok: false, errorCode: 'OPENING_LAYOUT_INVALID' });
  });

  it('con regla respaldada resuelve: frente extendido, cuerpo intacto', () => {
    const result = caseC(overhangMm);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // El CUERPO: la resolución v1 divide la altura del cuerpo sin tocarla.
    expect(result.layout.resolution.availableFrontHeightMm).toBe(720);
    expect(result.layout.resolution.zones).toEqual([
      { id: 'puerta', heightMm: 720, offsetFromStartMm: 0 },
    ]);
    // El FRENTE: aumenta exactamente la regla, declarada y auditable.
    expect(result.layout.fronts[0]).toMatchObject({
      zoneId: 'puerta',
      heightMm: 720 + overhangMm,
      overhangMm,
      grips: [],
    });
  });

  it('la matemática del cuerpo es idéntica a la del mismo layout en overlay', () => {
    const overlay = resolveOpeningFrontLayout(
      { ...caseCIntent, positioning: 'overlay' },
      600,
      720,
      { profiles: [] },
    );
    const withRule = caseC(overhangMm);
    if (!overlay.ok || !withRule.ok) throw new Error('fixtures inválidos');
    expect(withRule.layout.resolution).toEqual(overlay.layout.resolution);
  });

  it('sin hardware de grip no hay BOM de jaladera/gola', () => {
    const result = caseC(overhangMm);
    if (!result.ok) throw new Error('fixture inválido');
    const bom = resolveOpeningBOM(result.layout, 564, { leftEnd: 'exposed', rightEnd: 'exposed' }, []);
    expect(bom.ok).toBe(true);
    if (!bom.ok) return;
    expect(bom.lines).toEqual([]);
  });

  it('el gate de familias rige la selección del caso C', () => {
    const capabilities: OpeningCapabilities = {
      version: 1,
      grips: { bottom_overhang: { enabled: true } },
      byFurnitureType: {
        superior: { grips: { bottom_overhang: { placements: ['bottom'] } } },
      },
    };
    const selection = {
      system: 'bottom_overhang',
      furnitureType: 'superior',
      placements: ['bottom'] as const,
    };
    // Con regla: la selección pasa el gate (la restricción de familia rige).
    expect(
      validateOpeningConfiguration(selection, capabilities, [], RULE.rule),
    ).toEqual({ state: 'valid' });
    // Una posición fuera de la familia declarada sigue restringida.
    expect(
      validateOpeningConfiguration(
        { ...selection, placements: ['top'] },
        capabilities,
        [],
        RULE.rule,
      ),
    ).toEqual({ state: 'invalid', reason: 'OPENING_PLACEMENT_RESTRICTED' });
    // Sin regla respaldada: blocked veraz aunque la familia permita.
    expect(validateOpeningConfiguration(selection, capabilities, [])).toEqual({
      state: 'blocked',
      reason: 'OPENING_OVERHANG_EVIDENCE_PENDING',
    });
  });
});
