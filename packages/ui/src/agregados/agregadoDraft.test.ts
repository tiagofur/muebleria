/**
 * #1412 — la receta viaja en el borrador: guardar desde el form general ya no
 * puede escribir una revisión sin receta (la habría borrado).
 */

import { describe, expect, it } from 'vitest';
import type { Agregado } from '@granete/domain';
import {
  agregadoToDraft,
  createEmptyAgregadoDraft,
  draftToAgregado,
  isAgregadoDraft,
} from './agregadoDraft';

const member = {
  memberId: 'guia-izq',
  role: 'side_left',
  source: { kind: 'fixed' as const, fixed: { hardwareId: 'hw-1' } },
  placement: {
    x: { ref: 'min' as const, offsetMm: 0 },
    y: { ref: 'min' as const, offsetMm: 0 },
    z: { ref: 'min' as const, offsetMm: 0 },
  },
  bomRole: 'included_in_kit' as const,
  actorMembership: 'body',
};

const agregadoConReceta: Agregado = {
  id: 'agr-1',
  code: 'CAJ-TEL',
  name: 'Cajón Corredera',
  externalDims: { width: 400, height: 150, depth: 500 },
  components: [],
  hardwareLines: [],
  commercialKitHardwareId: 'hw-kit',
  rigidMembers: [member],
  variantSets: [
    {
      id: 'set-fondo',
      dimension: 'depth',
      variants: [{ nominalDimensionMm: 500, hardwareId: 'hw-1' }],
    },
  ],
  compatibilityRules: [
    { variantSetId: 'set-fondo', clearanceMm: 20, selectionStrategy: 'max_fitting' },
  ],
};

describe('agregadoDraft recipe round-trip (#1412)', () => {
  it('carga la receta en el borrador y la preserva al guardar', () => {
    const draft = agregadoToDraft(agregadoConReceta);
    expect(draft.rigidMembers).toHaveLength(1);
    expect(draft.variantSets).toHaveLength(1);
    expect(draft.compatibilityRules).toHaveLength(1);
    expect(draft.commercialKitHardwareId).toBe('hw-kit');

    const back = draftToAgregado('agr-1', draft);
    expect(back.rigidMembers).toEqual([member]);
    expect(back.variantSets).toEqual(agregadoConReceta.variantSets);
    expect(back.compatibilityRules).toEqual(agregadoConReceta.compatibilityRules);
    expect(back.commercialKitHardwareId).toBe('hw-kit');
  });

  it('un agregado sin receta guarda sin campos de receta (payload legacy intacto)', () => {
    const draft = agregadoToDraft({ ...agregadoConReceta, rigidMembers: undefined, variantSets: undefined, compatibilityRules: undefined, commercialKitHardwareId: null as unknown as undefined });
    const back = draftToAgregado('agr-1', draft);
    expect(back.rigidMembers).toBeUndefined();
    expect(back.variantSets).toBeUndefined();
    expect(back.compatibilityRules).toBeUndefined();
    expect(back.commercialKitHardwareId).toBeUndefined();
  });

  it('isAgregadoDraft acepta drafts persistidos viejos (sin claves de receta) y nuevos', () => {
    expect(isAgregadoDraft(createEmptyAgregadoDraft())).toBe(true);
    // Draft persistido antes de #1412: sin las claves nuevas.
    const legacy = JSON.parse(JSON.stringify(createEmptyAgregadoDraft()));
    delete legacy.rigidMembers;
    delete legacy.variantSets;
    delete legacy.compatibilityRules;
    expect(isAgregadoDraft(legacy)).toBe(true);
    expect(isAgregadoDraft(agregadoToDraft(agregadoConReceta))).toBe(true);
    expect(isAgregadoDraft({ ...createEmptyAgregadoDraft(), rigidMembers: 'no' })).toBe(false);
  });

  it('draftToAgregado normaliza claves de receta ausentes en vez de fallar (draft viejo restaurado)', () => {
    const legacy = JSON.parse(JSON.stringify(createEmptyAgregadoDraft()));
    legacy.code = 'VIEJO';
    delete legacy.rigidMembers;
    delete legacy.variantSets;
    delete legacy.compatibilityRules;

    expect(() => draftToAgregado('agr-legado', legacy as never)).not.toThrow();
    const back = draftToAgregado('agr-legado', legacy as never);
    expect(back.rigidMembers).toBeUndefined();
    expect(back.variantSets).toBeUndefined();
    expect(back.compatibilityRules).toBeUndefined();
    expect(back.code).toBe('VIEJO');
  });
});

describe('isAgregadoDraft acepta los campos vivos de la receta (#1460)', () => {
  it('un miembro con offsetFormula valida fresco y persistido (antes F5 reseteaba el borrador)', () => {
    const memberConFormula = {
      ...member,
      placement: {
        x: { ref: 'center' as const, offsetMm: 0, offsetFormula: 'PW/2' },
        y: { ref: 'min' as const, offsetMm: 0 },
        z: { ref: 'min' as const, offsetMm: 0, offsetFormula: 'PH - 37' },
      },
    };
    const draft = agregadoToDraft({
      ...agregadoConReceta,
      rigidMembers: [memberConFormula],
    });
    expect(isAgregadoDraft(draft)).toBe(true);
    // Round-trip sessionStorage: lo que se persiste debe revalidar igual.
    expect(isAgregadoDraft(JSON.parse(JSON.stringify(draft)))).toBe(true);

    const back = draftToAgregado('agr-1', draft);
    expect(back.rigidMembers?.[0]?.placement.x.offsetFormula).toBe('PW/2');
  });

  it('un placement F2 (optionRole, xRef/yRef, hwAnchor) valida dentro del borrador', () => {
    const draft = agregadoToDraft(agregadoConReceta);
    draft.components = [
      {
        componentId: 'comp-frente',
        quantity: 1,
        overrides: {
          hardwarePlacements: [
            {
              optionRole: 'TIRADOR',
              anchorFace: 'front',
              relativePosition: { xMm: 0, yMm: 18, xRef: 'center', yRef: 'max' },
              hwAnchor: 'center',
            },
          ],
        },
      },
    ];
    expect(isAgregadoDraft(draft)).toBe(true);
    expect(isAgregadoDraft(JSON.parse(JSON.stringify(draft)))).toBe(true);
  });
});
