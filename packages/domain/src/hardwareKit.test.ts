import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  accessoryKitMemberHardwareIds,
  DEFAULT_FIXED_OFFSET_MM,
  DEFAULT_MOVING_OFFSET_MM,
  HARDWARE_KIT_SLOTS,
  agregadoDeclaresKitViaVariant,
  defaultAgregadoCode,
  ensureAgregadoKitParts,
  isHardwareKitPart,
  planHardwareKit,
  syncAgregadoWithKitParts,
  validateHardwareKitInput,
  validateHardwareKitLink,
  KIT_TEMPLATE_DRAWER_HANDS_ID,
  planHardwareKitSystem,
  validateHardwareKitTemplate,
  type HardwareKitPlanInput,
  type HardwareKitSystemInput,
  type HardwareKitTemplate,
} from './hardwareKit';

const baseInput: HardwareKitPlanInput = {
  code: 'HER-CORR-TEL-50',
  name: 'Corredera Telescópica 500',
  kitCostPerUnit: 420,
  widthMm: 400,
  heightMm: 150,
  depthMm: 500,
  fixedOffsetMm: DEFAULT_FIXED_OFFSET_MM,
  movingOffsetMm: DEFAULT_MOVING_OFFSET_MM,
};

const noExisting = {
  hardwareCodes: new Set<string>(),
  agregadoCodes: new Set<string>(),
};

describe('planHardwareKit (#1416)', () => {
  it('#1512 S2b: la plantilla drawer-hands agrupa 4 slots en 2 filas con handsParts', () => {
    const plan = planHardwareKit(
      { ...baseInput, templateId: KIT_TEMPLATE_DRAWER_HANDS_ID },
      noExisting,
    );

    expect(plan.designs.map((d) => d.code)).toEqual([
      'HER-CORR-TEL-50-FIJ',
      'HER-CORR-TEL-50-MOV',
    ]);

    const fij = plan.designs[0]!;
    expect(fij.handsParts).toHaveLength(2);
    expect(fij.handsParts?.map((p) => p.hand)).toEqual(['left', 'right']);
    expect(fij.handsParts?.map((p) => p.memberId)).toEqual(['fixed_rail_left', 'fixed_rail_right']);
    expect(fij.handsParts?.map((p) => p.offsetMm)).toEqual([0, 0]); // #1613: sin defaults
    expect(fij.handsParts?.every((p) => p.membership === 'body')).toBe(true);

    const mov = plan.designs[1]!;
    expect(mov.handsParts?.map((p) => p.hand)).toEqual(['left', 'right']);
    expect(mov.handsParts?.map((p) => p.offsetMm)).toEqual([0, 0]); // #1613: sin defaults
    expect(mov.handsParts?.every((p) => p.membership === 'actor:drawer')).toBe(true);

    // El agregado es idéntico al drawer legacy (mismo motion/label).
    expect(plan.agregado.code).toBe('HER-CORR-TEL-50-CAJON');
    expect(plan.agregado.motion).toBe('translate');
  });

  it('#1512 S2b: los offsets legacy del input honran en la plantilla hands', () => {
    const plan = planHardwareKit(
      {
        ...baseInput,
        templateId: KIT_TEMPLATE_DRAWER_HANDS_ID,
        fixedOffsetMm: 12,
        movingOffsetMm: 40,
      },
      noExisting,
    );
    expect(plan.designs[0]!.handsParts?.map((p) => p.offsetMm)).toEqual([12, -12]);
    expect(plan.designs[1]!.handsParts?.map((p) => p.offsetMm)).toEqual([40, -40]);
  });

  it('#1512 S2b: la plantilla legacy drawer-slides sigue byte-idéntica (4 filas, sin handsParts)', () => {
    const plan = planHardwareKit(baseInput, noExisting);
    expect(plan.designs).toHaveLength(4);
    expect(plan.designs.every((d) => d.handsParts === undefined)).toBe(true);
  });

  it('deriva kit + 4 herrajes de diseño + agregado con códigos predecibles', () => {
    const plan = planHardwareKit(baseInput, noExisting);

    expect(plan.kit).toMatchObject({
      code: 'HER-CORR-TEL-50',
      unit: 'set',
      costPerUnit: 420,
      exists: false,
    });
    expect(plan.designs.map((d) => d.code)).toEqual([
      'HER-CORR-TEL-50-FIJ-I',
      'HER-CORR-TEL-50-FIJ-D',
      'HER-CORR-TEL-50-MOV-I',
      'HER-CORR-TEL-50-MOV-D',
    ]);
    expect(plan.agregado.code).toBe('HER-CORR-TEL-50-CAJON');
    expect(plan.agregado.motion).toBe('translate');
    expect(plan.blockedCode).toBeNull();
    expect(plan.designs.every((d) => !d.exists)).toBe(true);
  });

  it('ancla fijas y móviles con el offset con signo correcto por lado', () => {
    const plan = planHardwareKit(baseInput, noExisting);
    const byMember = new Map(plan.designs.map((d) => [d.memberId, d]));

    // #1613: sin defaults — offset 0 salvo que el registro lo declare.
    expect(byMember.get('fixed_rail_left')?.placement.x).toEqual({ ref: 'min', offsetMm: 0 });
    expect(byMember.get('fixed_rail_right')?.placement.x).toEqual({ ref: 'max', offsetMm: 0 });
    expect(byMember.get('moving_rail_left')?.placement.x).toEqual({ ref: 'min', offsetMm: 0 });
    expect(byMember.get('moving_rail_right')?.placement.x).toEqual({ ref: 'max', offsetMm: 0 });
    for (const d of plan.designs) {
      expect(d.placement.y).toEqual({ ref: 'min', offsetMm: 0 });
      expect(d.placement.z).toEqual({ ref: 'min', offsetMm: 0 });
    }
  });

  it('membresías fijo/móvil por miembro (#1376): body vs actor:drawer', () => {
    const plan = planHardwareKit(baseInput, noExisting);
    const byMember = new Map(plan.designs.map((d) => [d.memberId, d]));
    expect(byMember.get('fixed_rail_left')?.membership).toBe('body');
    expect(byMember.get('fixed_rail_right')?.membership).toBe('body');
    expect(byMember.get('moving_rail_left')?.membership).toBe('actor:drawer');
    expect(byMember.get('moving_rail_right')?.membership).toBe('actor:drawer');
  });

  it('marca herrajes existentes como reutilizados sin bloquear el plan', () => {
    const plan = planHardwareKit(baseInput, {
      hardwareCodes: new Set(['HER-CORR-TEL-50', 'HER-CORR-TEL-50-MOV-I']),
      agregadoCodes: new Set<string>(),
    });
    expect(plan.kit.exists).toBe(true);
    expect(plan.designs.find((d) => d.slot === 'moving_left')?.exists).toBe(true);
    expect(plan.designs.find((d) => d.slot === 'fixed_left')?.exists).toBe(false);
    expect(plan.blockedCode).toBeNull();
  });

  it('bloquea fail-closed si el agregado destino ya existe', () => {
    const plan = planHardwareKit(baseInput, {
      hardwareCodes: new Set<string>(),
      agregadoCodes: new Set(['HER-CORR-TEL-50-CAJON']),
    });
    expect(plan.blockedCode).toBe('HER-CORR-TEL-50-CAJON');
  });

  it('respeta un código de agregado explícito y lo valida contra colisiones', () => {
    const plan = planHardwareKit(
      { ...baseInput, agregadoCode: 'GRA-CAJ-TEL' },
      { hardwareCodes: new Set<string>(), agregadoCodes: new Set(['GRA-OTRO']) },
    );
    expect(plan.agregado.code).toBe('GRA-CAJ-TEL');
    expect(plan.blockedCode).toBeNull();

    const blocked = planHardwareKit(
      { ...baseInput, agregadoCode: 'GRA-OTRO' },
      { hardwareCodes: new Set<string>(), agregadoCodes: new Set(['GRA-OTRO']) },
    );
    expect(blocked.blockedCode).toBe('GRA-OTRO');
  });

  it('defaultAgregadoCode deriva del código del kit', () => {
    expect(defaultAgregadoCode('HER-X')).toBe('HER-X-CAJON');
  });

  it('HARDWARE_KIT_SLOTS expone los 4 slots con sufijos únicos', () => {
    expect(HARDWARE_KIT_SLOTS).toHaveLength(4);
    expect(new Set(HARDWARE_KIT_SLOTS.map((s) => s.suffix)).size).toBe(4);
    expect(new Set(HARDWARE_KIT_SLOTS.map((s) => s.memberId)).size).toBe(4);
  });
});

describe('validateHardwareKitInput (#1416)', () => {
  it('rechaza código, nombre y precio inválidos', () => {
    expect(() => validateHardwareKitInput({ ...baseInput, code: '  ' })).toThrow('código');
    expect(() => validateHardwareKitInput({ ...baseInput, name: '' })).toThrow('nombre');
    expect(() => validateHardwareKitInput({ ...baseInput, kitCostPerUnit: -1 })).toThrow('precio');
    expect(() => validateHardwareKitInput({ ...baseInput, kitCostPerUnit: Number.NaN })).toThrow(
      'precio',
    );
  });

  it('rechaza dimensiones y offsets inválidos', () => {
    expect(() => validateHardwareKitInput({ ...baseInput, widthMm: 0 })).toThrow('ancho');
    expect(() => validateHardwareKitInput({ ...baseInput, depthMm: -5 })).toThrow('profundidad');
    expect(() =>
      validateHardwareKitInput({ ...baseInput, fixedOffsetMm: Number.POSITIVE_INFINITY }),
    ).toThrow('offset');
  });

  it('acepta la entrada base sin lanzar', () => {
    expect(() => validateHardwareKitInput(baseInput)).not.toThrow();
  });
});

describe('validateHardwareKitLink (#1422 slice 1)', () => {
  const catalog = [
    { id: 'kit-1', code: 'KIT-1', kitHardwareId: undefined },
    { id: 'parte-1', code: 'KIT-1-FIJ-I', kitHardwareId: 'kit-1' },
    { id: 'libre', code: 'LIBRE', kitHardwareId: undefined },
  ];

  it('acepta un link válido a un kit existente que no es parte', () => {
    expect(() => validateHardwareKitLink('nueva-parte', 'kit-1', catalog)).not.toThrow();
  });

  it('rechaza kit inexistente, self y kit-que-es-parte', () => {
    expect(() => validateHardwareKitLink('nueva', 'desconocido', catalog)).toThrow(
      'no existe en este taller',
    );
    expect(() => validateHardwareKitLink('kit-1', 'kit-1', catalog)).toThrow(
      'parte de sí mismo',
    );
    expect(() => validateHardwareKitLink('nueva', 'parte-1', catalog)).toThrow(
      'no puede ser parte de otro',
    );
  });
});

describe('isHardwareKitPart (#1506 kit opaco)', () => {
  it('una parte de kit (kitHardwareId) es parte; el kit, un herraje suelto y undefined no', () => {
    expect(isHardwareKitPart({ kitHardwareId: 'kit-1' })).toBe(true);
    expect(isHardwareKitPart({ kitHardwareId: undefined })).toBe(false);
    expect(isHardwareKitPart({})).toBe(false);
  });
});

describe('plantillas de juego (#1422 slice 2)', () => {
  it('plantilla bisagra: 2 partes (copa body / brazo actor:door), agregado Puerta con rotate', () => {
    const plan = planHardwareKit(
      { ...baseInput, code: 'BIS-1', name: 'Bisagra 110', templateId: 'hinge' },
      noExisting,
    );
    expect(plan.designs.map((d) => d.code)).toEqual(['BIS-1-COPA', 'BIS-1-BRAZO']);
    expect(plan.designs.map((d) => d.membership)).toEqual(['body', 'actor:door']);
    expect(plan.agregado.name).toBe('Puerta Bisagra 110');
    expect(plan.agregado.motion).toBe('rotate_left');
    expect(plan.agregado.code).toBe('BIS-1-PUERTA');
  });

  it('plantilla jaladera: 1 pieza sin motion', () => {
    const plan = planHardwareKit(
      { ...baseInput, code: 'JAL-1', name: 'Jaladera', templateId: 'handle' },
      noExisting,
    );
    expect(plan.designs).toHaveLength(1);
    expect(plan.agregado.motion).toBe('none');
    expect(plan.agregado.code).toBe('JAL-1-FRENTE');
  });

  it('plantilla desconocida falla cerrado', () => {
    expect(() =>
      validateHardwareKitInput({ ...baseInput, templateId: 'levantadza-mágica' }),
    ).toThrow('Plantilla de juego desconocida');
  });

  it('#1512 S2b: plantillas del taller rechazan partGroups/hand (built-in only, v1)', () => {
    const base = { id: 'custom-x', labelEs: 'Custom', motion: 'none' as const, agregadoLabelEs: 'Frente' };
    const slot = {
      slot: 'p1',
      memberId: 'p1',
      suffix: '-P1',
      labelEs: 'P1',
      role: 'handle',
      membership: 'body',
      anchorXRef: 'min' as const,
      offsetSign: 1 as const,
      defaultOffsetMm: 0,
    };
    const withPartGroups = validateHardwareKitTemplate({
      ...base,
      partGroups: [{ group: 'g', codeSuffix: '-G', labelEs: 'Grupo' }],
      slots: [slot],
    });
    expect(withPartGroups.some((i) => i.path === 'partGroups')).toBe(true);

    const withHand = validateHardwareKitTemplate({
      ...base,
      slots: [{ ...slot, hand: 'left', partGroup: 'g' }],
    });
    expect(withHand.some((i) => i.path.endsWith('.hand'))).toBe(true);
  });

  it('el cajón sigue honrando los offsets legacy del input (#1416 compat)', () => {
    const plan = planHardwareKit(
      { ...baseInput, fixedOffsetMm: 22, movingOffsetMm: 44 },
      noExisting,
    );
    const byMember = new Map(plan.designs.map((d) => [d.memberId, d]));
    expect(byMember.get('fixed_rail_left')?.placement.x).toEqual({ ref: 'min', offsetMm: 22 });
    expect(byMember.get('moving_rail_right')?.placement.x).toEqual({ ref: 'max', offsetMm: -44 });
  });
});

describe('plantillas del taller editables (#1422 slice 2 — fixture compartido TS↔Go)', () => {
  interface FixtureCase {
    readonly case: string;
    readonly template: HardwareKitTemplate;
    readonly expectedIssueCodes?: readonly string[];
    readonly expectedPaths?: readonly string[];
  }
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, '../../../contracts/kitTemplateValidation.contract.json'), 'utf8'),
  ) as {
    readonly schema: string;
    readonly validTemplates: readonly FixtureCase[];
    readonly invalidTemplates: readonly FixtureCase[];
  };

  it('acepta las plantillas válidas del contrato compartido', () => {
    expect(fixture.schema).toBe('granete.kit-template-validation.v1');
    for (const testCase of fixture.validTemplates) {
      expect(validateHardwareKitTemplate(testCase.template), testCase.case).toEqual([]);
    }
  });

  it('rechaza los casos inválidos del contrato compartido con el código y campo exactos', () => {
    expect(fixture.invalidTemplates.length).toBeGreaterThan(0);
    for (const testCase of fixture.invalidTemplates) {
      const issues = validateHardwareKitTemplate(testCase.template);
      const paths = new Set(issues.map((i) => i.path));
      for (const expected of testCase.expectedPaths ?? []) {
        expect(paths.has(expected), `${testCase.case}: ${[...paths].join(', ')}`).toBe(true);
      }
      for (const issue of issues) {
        expect(issue.code).toBe('KIT_TEMPLATE_INVALID');
        expect(issue.severity).toBe('error');
      }
    }
  });

  it('planHardwareKit arma el plan desde una plantilla del taller', () => {
    const custom = fixture.validTemplates[0]!.template;
    const plan = planHardwareKit(
      { ...baseInput, code: 'BIS-TALLER', name: 'Bisagra Taller', templateId: custom.id },
      noExisting,
      [custom],
    );
    expect(plan.designs.map((d) => d.code)).toEqual(['BIS-TALLER-COPA', 'BIS-TALLER-BRAZO']);
    expect(plan.designs.map((d) => d.membership)).toEqual(['body', 'actor:door']);
    expect(plan.agregado.motion).toBe('rotate_left');
    expect(plan.agregado.name).toBe('Puerta Bisagra Taller');
  });

  it('la plantilla del taller usa el defaultOffsetMm del slot (los offsets legacy son sólo del cajón)', () => {
    const custom = fixture.validTemplates[0]!.template;
    const plan = planHardwareKit(
      { ...baseInput, fixedOffsetMm: 99, movingOffsetMm: 99, templateId: custom.id },
      noExisting,
      [custom],
    );
    const byMember = new Map(plan.designs.map((d) => [d.memberId, d]));
    expect(byMember.get('hinge_cup')?.placement.x).toEqual({ ref: 'min', offsetMm: 0 });
    expect(byMember.get('hinge_arm')?.placement.x).toEqual({ ref: 'center', offsetMm: -24 });
  });

  it('una plantilla del taller inválida falla cerrado ANTES de planear', () => {
    const broken = fixture.invalidTemplates.find((c) => c.case === 'unknown-membership')!.template;
    expect(() =>
      planHardwareKit(
        { ...baseInput, templateId: broken.id },
        noExisting,
        [broken],
      ),
    ).toThrow(/membership/);
  });

  it('campos ausentes del wire quedan inválidos (sin coerción a "undefined" — espejo del gemelo Go)', () => {
    const wire = {
      id: 't-wire',
      labelEs: 'X',
      agregadoLabelEs: 'Puerta',
      motion: 'none',
      slots: [{ suffix: '-A', membership: 'body', anchorXRef: 'min', offsetSign: 1, defaultOffsetMm: 0 }],
    } as unknown as HardwareKitTemplate;
    const issues = validateHardwareKitTemplate(wire);
    const paths = issues.map((i) => i.path);
    expect(paths).toContain('slots[0].slot');
    expect(paths).toContain('slots[0].memberId');
    expect(paths).toContain('slots[0].role');
  });

  it('un id de plantilla del taller sin lista custom sigue fallando cerrado', () => {
    const custom = fixture.validTemplates[0]!.template;
    expect(() =>
      validateHardwareKitInput({ ...baseInput, templateId: custom.id }),
    ).toThrow('Plantilla de juego desconocida');
  });

  describe('syncAgregadoWithKitParts (#1435)', () => {
    it('#1512: una parte multi-diseño (hands) expande a DOS miembros con mano y anclaje por lado', () => {
      const agregado = {
        id: 'agr-hands',
        code: 'AGR-CAJON-M',
        commercialKitHardwareId: 'kit-1',
        rigidMembers: [],
      };
      const kitParts = [
        {
          id: 'hw-perfil',
          code: 'MBOX-IGM-M',
          name: 'Perfil MERIVOBOX M',
          pieces: [
            { anchor: 'left' as const, asset: { assetId: 'a1', assetRevisionId: 'r1' } },
            { anchor: 'right' as const, asset: { assetId: 'a2', assetRevisionId: 'r2' } },
          ],
        },
      ];

      const synced = syncAgregadoWithKitParts(agregado, kitParts);
      expect(synced.rigidMembers).toHaveLength(2);

      const left = synced.rigidMembers[0];
      expect(left.memberId).toBe('part_mbox_igm_m_left');
      expect(left.hand).toBe('left');
      expect(left.placement.x.ref).toBe('min');
      expect(left.placement.x.offsetMm).toBe(0); // #1613: sin defaults — offset del registro

      const right = synced.rigidMembers[1];
      expect(right.memberId).toBe('part_mbox_igm_m_right');
      expect(right.hand).toBe('right');
      expect(right.placement.x.ref).toBe('max');
      expect(right.placement.x.offsetMm).toBe(0); // #1613: sin defaults — offset del registro
    });

    it('#1512: una parte legacy (sin hands) sigue creando UN miembro byte-idéntico', () => {
      const agregado = { id: 'agr-l', code: 'AGR-CAJON', rigidMembers: [] };
      const kitParts = [{ id: 'hw-fij-i', code: 'KIT-FIJ-I', name: 'Guía Fija Izq' }];
      const synced = syncAgregadoWithKitParts(agregado, kitParts);
      expect(synced.rigidMembers).toHaveLength(1);
      expect(synced.rigidMembers[0].memberId).toBe('part_kit_fij_i');
      expect(synced.rigidMembers[0].hand).toBeUndefined();
    });

    it('agrega slots inferidos para piezas nuevas y preserva las existentes', () => {
      const initialAgregado = {
        id: 'agr-1',
        code: 'AGR-CAJON',
        commercialKitHardwareId: 'kit-1',
        rigidMembers: [
          {
            memberId: 'existing_fij_i',
            role: 'slide',
            source: { kind: 'fixed', fixed: { hardwareId: 'hw-fij-i' } },
            placement: { x: { ref: 'min', offsetMm: 10 } },
            bomRole: 'included_in_kit',
            actorMembership: 'body',
          },
        ],
      };

      const kitParts = [
        { id: 'hw-fij-i', code: 'KIT-FIJ-I', name: 'Guía Fija Izq' },
        { id: 'hw-mov-d', code: 'KIT-MOV-D', name: 'Corredera Móvil Der', previewShape: 'slide' },
      ];

      const synced = syncAgregadoWithKitParts(initialAgregado, kitParts);
      expect(synced.rigidMembers).toHaveLength(2);
      expect(synced.rigidMembers[0].memberId).toBe('existing_fij_i');

      const added = synced.rigidMembers[1];
      expect(added.source.fixed.hardwareId).toBe('hw-mov-d');
      expect(added.placement.x.ref).toBe('max'); // Inferido de '-D'
      expect(added.placement.x.offsetMm).toBe(0); // #1613: sin defaults — offset del registro (0 si ausente)
      expect(added.actorMembership).toBe('actor:drawer'); // Inferido de '-MOV'
    });

    it('remueve de la receta miembros de partes que ya no están vinculadas al kit', () => {
      const initialAgregado = {
        id: 'agr-1',
        code: 'AGR-CAJON',
        commercialKitHardwareId: 'kit-1',
        rigidMembers: [
          {
            memberId: 'part_old',
            role: 'slide',
            source: { kind: 'fixed', fixed: { hardwareId: 'hw-removed' } },
            placement: { x: { ref: 'min', offsetMm: 10 } },
            bomRole: 'included_in_kit',
            actorMembership: 'body',
          },
        ],
      };

      const synced = syncAgregadoWithKitParts(initialAgregado, []);
      expect(synced.rigidMembers).toHaveLength(0);
    });
  });
});

// #1493: sync aditivo para recetas que ligan el kit vía VARIANTE (una altura
// Blum MERIVOBOX N/M/K/E = un kit). La propiedad que justifica la función:
// con kits múltiples, el sync de un kit NUNCA puede borrar las partes de otro.
describe('ensureAgregadoKitParts (#1493, sync aditivo por variante)', () => {
  const parteGaleriaE = {
    id: 'hw-galeria-e',
    code: 'KIT-MBX-E-GALERIA',
    name: 'Galería cacerolera E',
    previewShape: 'part',
    designParts: [
      { componentName: 'galeria', actorMembership: 'body', label: 'pos:min:20:0:0' },
    ],
  };
  const parteM = {
    id: 'hw-parte-m',
    code: 'KIT-MBX-M-PARTE',
    name: 'Parte kit M',
    designParts: [
      { componentName: 'parte', actorMembership: 'body', label: 'pos:max:12:0:4' },
    ],
  };

  const recetaMultiKit = {
    id: 'agr-merivobox-alturas',
    code: 'MERIVOBOX-ALTURAS',
    rigidMembers: [
      // Miembro de variante (source variant, sin hardware fijo): intocable.
      {
        memberId: 'side-left',
        role: 'drawer_side_left',
        source: { kind: 'variant', variant: { variantSetId: 'height-variants' } },
        placement: { x: { ref: 'min', offsetMm: 0 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
        bomRole: 'included_in_kit',
      },
      // Miembro fijo de OTRO kit (kit-E): la galería.
      {
        memberId: 'part_kit_mbx_e_galeria',
        role: 'part',
        source: { kind: 'fixed', fixed: { hardwareId: 'hw-galeria-e' } },
        placement: { x: { ref: 'min', offsetMm: 20 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 0 } },
        bomRole: 'included_in_kit',
        actorMembership: 'body',
      },
    ],
  };

  it('AÑADE las partes faltantes del kit como included_in_kit', () => {
    const synced = ensureAgregadoKitParts(recetaMultiKit, [parteM]);
    const added = synced.rigidMembers.find(
      (m: any) => m.source?.fixed?.hardwareId === 'hw-parte-m',
    );
    expect(added).toBeDefined();
    expect(added.bomRole).toBe('included_in_kit');
    expect(added.memberId).toBe('part_kit_mbx_m_parte');
  });

  it('REFRESCA colocación y actor de los miembros que ya referencian partes de este kit', () => {
    const galeriaActualizada = {
      ...parteGaleriaE,
      designParts: [
        { componentName: 'galeria', actorMembership: 'actor:drawer', label: 'pos:min:44:2:8' },
      ],
    };
    const synced = ensureAgregadoKitParts(recetaMultiKit, [galeriaActualizada]);
    const galeria = synced.rigidMembers.find(
      (m: any) => m.source?.fixed?.hardwareId === 'hw-galeria-e',
    );
    expect(galeria.placement.x.offsetMm).toBe(44);
    expect(galeria.placement.y.offsetMm).toBe(2);
    expect(galeria.placement.z.offsetMm).toBe(8);
    expect(galeria.actorMembership).toBe('actor:drawer');
    expect(synced.rigidMembers).toHaveLength(2); // sin duplicados
  });

  it('NUNCA remueve: el sync de un kit conserva los miembros de OTRO kit', () => {
    // Sync con las partes del kit-M: la galería del kit-E DEBE sobrevivir.
    const synced = ensureAgregadoKitParts(recetaMultiKit, [parteM]);
    const galeria = synced.rigidMembers.find(
      (m: any) => m.source?.fixed?.hardwareId === 'hw-galeria-e',
    );
    expect(galeria).toBeDefined();
    // Y el miembro de variante también.
    const variante = synced.rigidMembers.find(
      (m: any) => m.source?.kind === 'variant',
    );
    expect(variante).toBeDefined();
    expect(synced.rigidMembers).toHaveLength(3); // variante + galería + parte-M
  });

  it('miembro cuyo hardware ya no es parte de ESTE kit no se toca (no destruye)', () => {
    const synced = ensureAgregadoKitParts(recetaMultiKit, [parteM]);
    const galeria = synced.rigidMembers.find(
      (m: any) => m.source?.fixed?.hardwareId === 'hw-galeria-e',
    );
    expect(galeria?.placement?.x?.offsetMm).toBe(20); // sin cambios de parte ajena
  });
});

describe('agregadoDeclaresKitViaVariant (#1493)', () => {
  const receta = {
    variantSets: [
      {
        id: 'height-variants',
        dimension: 'height',
        variants: [
          { nominalDimensionMm: 85.5, hardwareId: 'hw-mbox-n', commercialKitHardwareId: 'kit-mbox-n' },
          { nominalDimensionMm: 108, hardwareId: 'hw-mbox-m' },
        ],
      },
    ],
  };

  it('detecta el kit declarado en una variante', () => {
    expect(agregadoDeclaresKitViaVariant(receta, 'kit-mbox-n')).toBe(true);
  });

  it('false cuando el kit no está declarado o el id es vacío/whitespace', () => {
    expect(agregadoDeclaresKitViaVariant(receta, 'kit-mbox-m')).toBe(false);
    expect(agregadoDeclaresKitViaVariant(receta, 'kit-otro')).toBe(false);
    expect(agregadoDeclaresKitViaVariant(receta, '')).toBe(false);
    expect(agregadoDeclaresKitViaVariant(receta, '   ')).toBe(false);
    expect(agregadoDeclaresKitViaVariant({}, 'kit-mbox-n')).toBe(false);
  });
});

describe('#1518 regresión: pos: label no aplasta piezas multi-diseño (sync TS)', () => {
  it('syncAgregadoWithKitParts: parte con pieces + label pos:min conserva el ancla por pieza', () => {
    const agregado = {
      id: 'agr-reg',
      code: 'AGR-REG',
      commercialKitHardwareId: 'kit-m',
      rigidMembers: [
        {
          memberId: 'part_mbox_igm_m_left',
          role: 'slide',
          source: { kind: 'fixed', fixed: { hardwareId: 'hw-perfil-m' } },
          placement: { x: { ref: 'min', offsetMm: 8 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 100 } },
          bomRole: 'included_in_kit',
          actorMembership: 'body',
          hand: 'left',
        },
        {
          memberId: 'part_mbox_igm_m_right',
          role: 'slide',
          source: { kind: 'fixed', fixed: { hardwareId: 'hw-perfil-m' } },
          placement: { x: { ref: 'max', offsetMm: -12 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 100 } },
          bomRole: 'included_in_kit',
          actorMembership: 'body',
          hand: 'right',
        },
      ],
    };
    const kitParts = [
      {
        id: 'hw-perfil-m',
        code: 'MBOX-IGM-M',
        name: 'Perfil MERIVOBOX M',
        // El label del editor de posición (el que antes colapsaba ambos lados a min).
        designParts: [{ componentName: 'MBOX-IGM-M', actorMembership: 'body', label: 'pos:min:10:0:0' }],
        pieces: [{ anchor: 'left' as const }, { anchor: 'right' as const }],
      },
    ];

    const synced = syncAgregadoWithKitParts(agregado, kitParts);
    expect(synced.rigidMembers).toHaveLength(2);
    const left = synced.rigidMembers.find((m: any) => m.hand === 'left');
    const right = synced.rigidMembers.find((m: any) => m.hand === 'right');
    expect(left.placement.x).toEqual({ ref: 'min', offsetMm: 8 });
    expect(right.placement.x).toEqual({ ref: 'max', offsetMm: -12 });
  });

  it('ensureAgregadoKitParts: misma regla para recetas por variante', () => {
    const agregado = {
      id: 'agr-reg2',
      code: 'AGR-REG2',
      rigidMembers: [
        {
          memberId: 'part_mbox_igm_m_right',
          role: 'slide',
          source: { kind: 'fixed', fixed: { hardwareId: 'hw-perfil-m' } },
          placement: { x: { ref: 'max', offsetMm: -12 }, y: { ref: 'min', offsetMm: 0 }, z: { ref: 'min', offsetMm: 100 } },
          bomRole: 'included_in_kit',
          actorMembership: 'body',
          hand: 'right',
        },
      ],
    };
    const kitParts = [
      {
        id: 'hw-perfil-m',
        code: 'MBOX-IGM-M',
        name: 'Perfil MERIVOBOX M',
        designParts: [{ componentName: 'MBOX-IGM-M', actorMembership: 'body', label: 'pos:min:10:0:0' }],
        pieces: [{ anchor: 'left' as const }, { anchor: 'right' as const }],
      },
    ];

    const synced = ensureAgregadoKitParts(agregado, kitParts);
    const right = synced.rigidMembers.find((m: any) => m.hand === 'right');
    expect(right.placement.x).toEqual({ ref: 'max', offsetMm: -12 });
    // La pieza left faltante se agrega desde el catálogo (expansión por pieza).
    const left = synced.rigidMembers.find((m: any) => m.hand === 'left');
    expect(left).toBeDefined();
    expect(left.placement.x.ref).toBe('min');
  });
});

describe('planHardwareKitSystem (#1546 M4 — sistema generador)', () => {
  const systemInput: HardwareKitSystemInput = {
    code: 'MBOX-IRIDIUN',
    name: 'Merivobox Iridium',
    kitCostPerUnit: 420,
    widthMm: 570,
    depthMm: 530,
    heights: [
      { code: 'N', labelEs: 'N', khMinMm: 85.5, include: false },
      { code: 'M', labelEs: 'M', khMinMm: 108, include: true },
      { code: 'K', labelEs: 'K', khMinMm: 146, include: false },
      { code: 'E', labelEs: 'E', khMinMm: 209, include: true },
    ],
    accessoriesE: [
      { suffix: 'GALERIA', name: 'Galería Gris Iridium', anchors: ['left', 'right'] },
    ],
  };

  it('genera un kit multi-diseño POR ALTURA con códigos systemCode-ALTURA', () => {
    const plan = planHardwareKitSystem(systemInput, noExisting);
    expect(plan.kits.map((k) => k.code)).toEqual(['MBOX-IRIDIUN-M', 'MBOX-IRIDIUN-E']);
    // Cada kit lleva la estructura drawer-hands: FIJ y MOV con piezas por ancla.
    for (const kit of plan.kits) {
      const fij = kit.designs.find((d) => d.code.endsWith('-FIJ'));
      const mov = kit.designs.find((d) => d.code.endsWith('-MOV'));
      expect(fij?.handsParts?.map((p) => p.hand)).toEqual(['left', 'right']);
      expect(mov?.handsParts?.map((p) => p.hand)).toEqual(['left', 'right']);
    }
  });

  it('el agregado del sistema usa variantes de altura y NO lleva miembros de kit fijos', () => {
    const plan = planHardwareKitSystem(systemInput, noExisting);
    expect(plan.agregado.code).toBe('MBOX-IRIDIUN-CAJON');
    expect(plan.agregado.variants).toEqual([
      { heightCode: 'M', khMinMm: 108, kitCode: 'MBOX-IRIDIUN-M' },
      { heightCode: 'E', khMinMm: 209, kitCode: 'MBOX-IRIDIUN-E' },
    ]);
    // El sync por bahía materializa las partes del kit efectivo (paridad #1493):
    // el plan no genera miembros fijos de ningún kit.
  });

  it('el grupo de accesorios se vincula al kit E con los herrajes accesorios como opciones', () => {
    const plan = planHardwareKitSystem(systemInput, noExisting);
    expect(plan.accessoryGroup).toEqual({
      code: 'MBOX-IRIDIUN_LATERAL_E',
      name: 'Lateral superior E',
      required: false,
      kitCode: 'MBOX-IRIDIUN-E',
      optionIds: ['MBOX-IRIDIUN-E-GALERIA'],
    });
    expect(plan.accessories[0]).toMatchObject({
      code: 'MBOX-IRIDIUN-E-GALERIA',
      anchors: ['left', 'right'],
      exists: false,
    });
  });

  it('sin E incluida no genera accesorios ni grupo', () => {
    const plan = planHardwareKitSystem(
      { ...systemInput, heights: systemInput.heights.map((h) => (h.code === 'E' ? { ...h, include: false } : h)) },
      noExisting,
    );
    expect(plan.accessories).toEqual([]);
    expect(plan.accessoryGroup).toBeNull();
    expect(plan.kits.map((k) => k.code)).toEqual(['MBOX-IRIDIUN-M']);
  });

  it('fail-closed: sin alturas incluidas o código vacío', () => {
    expect(() =>
      planHardwareKitSystem(
        { ...systemInput, heights: systemInput.heights.map((h) => ({ ...h, include: false })) },
        noExisting,
      ),
    ).toThrow('Incluí al menos una altura');
    expect(() => planHardwareKitSystem({ ...systemInput, code: '  ' }, noExisting)).toThrow(
      'El código del sistema no puede estar vacío',
    );
  });

  it('blockedCode refleja un agregado existente con el código del sistema', () => {
    const plan = planHardwareKitSystem(systemInput, {
      hardwareCodes: new Set(),
      agregadoCodes: new Set(['MBOX-IRIDIUN-CAJON']),
    });
    expect(plan.blockedCode).toBe('MBOX-IRIDIUN-CAJON');
  });
});

// #1613 — las piezas miembros de un grupo accesorio linkeado al kit
// (Galería/Boxcap/Boxcover) son elecciones consumibles: el sync de guardado
// web NUNCA las materializa como partes fijas (espejo del test Go
// TestSyncExcludesAccessoryGroupMembers_1613 y del repro resolve-level
// TestInsertoDupRepro_1613). Sin la exclusión, una edición de parte del kit
// re-envenena la receta (patrón rev 12 del owner).
describe('#1613 — exclusión de miembros de grupos accesorios en el sync', () => {
  const kitE = 'kit-e-gray';
  const galId = 'hw-gal-ig';
  const fijId = 'hw-fij-e';
  const movId = 'hw-mov-e';

  const gal = { id: galId, code: 'MBOX-E-GAL-IG', name: 'Galería', active: true, kitHardwareId: kitE, pieces: [{ anchor: 'left' as const }, { anchor: 'right' as const }] };
  const fij = { id: fijId, code: 'MBOX-GRAY-E-FIJ', name: 'Perfil fijo E', active: true, kitHardwareId: kitE, pieces: [{ anchor: 'left' as const }, { anchor: 'right' as const }] };
  const mov = { id: movId, code: 'MBOX-GRAY-E-MOV', name: 'Perfil móvil E', active: true, kitHardwareId: kitE, pieces: [{ anchor: 'left' as const }, { anchor: 'right' as const }] };
  const hardware = [gal, fij, mov];
  const optionGroups = [
    { kind: 'hardware', kitHardwareId: kitE, optionIds: [galId] },
    { kind: 'hardware', kitHardwareId: 'otro-kit', optionIds: ['hw-otro'] },
  ];

  it('accessoryKitMemberHardwareIds indexa sólo miembros de grupos linkeados al kit', () => {
    const ids = accessoryKitMemberHardwareIds(hardware, optionGroups, kitE);
    expect(ids.has(galId)).toBe(true);
    expect(ids.has(fijId)).toBe(false);
    expect(ids.has(movId)).toBe(false);
    // Kit sin grupos linkeados: vacío.
    expect(accessoryKitMemberHardwareIds(hardware, optionGroups, 'kit-m-gray').size).toBe(0);
    // La pieza inexistente en el catálogo no entra (guard de hardware).
    expect(
      accessoryKitMemberHardwareIds(hardware, [{ kind: 'hardware', kitHardwareId: kitE, optionIds: ['hw-fantasma'] }], kitE).has('hw-fantasma'),
    ).toBe(false);
  });

  it('ensureAgregadoKitParts omite el miembro-exclusión (sólo FIJ/MOV × mano)', () => {
    const got = ensureAgregadoKitParts({ id: 'agr-x', code: 'AGR-X', rigidMembers: [] }, hardware, accessoryKitMemberHardwareIds(hardware, optionGroups, kitE));
    const hwIds = got.rigidMembers.map((m: { source?: { fixed?: { hardwareId?: string } } }) => m.source?.fixed?.hardwareId);
    expect(hwIds.filter((id: string) => id === fijId).length).toBe(2);
    expect(hwIds.filter((id: string) => id === movId).length).toBe(2);
    expect(hwIds).not.toContain(galId);
  });

  it('syncAgregadoWithKitParts purga el miembro-exclusión ya persistido y no lo re-agrega', () => {
    const poisoned = {
      id: 'agr-x',
      code: 'AGR-X',
      commercialKitHardwareId: kitE,
      rigidMembers: [
        { memberId: 'gal-l', source: { kind: 'fixed', fixed: { hardwareId: galId } }, hand: 'left', placement: { x: { ref: 'min' }, y: { ref: 'min' }, z: { ref: 'min' } } },
        { memberId: 'fij-l', source: { kind: 'fixed', fixed: { hardwareId: fijId } }, hand: 'left', placement: { x: { ref: 'min' }, y: { ref: 'min' }, z: { ref: 'min' } } },
      ],
    };
    const got = syncAgregadoWithKitParts(poisoned, hardware, accessoryKitMemberHardwareIds(hardware, optionGroups, kitE));
    const hwIds = got.rigidMembers.map((m: { source?: { fixed?: { hardwareId?: string } } }) => m.source?.fixed?.hardwareId);
    expect(hwIds).not.toContain(galId);
    expect(hwIds).toContain(fijId);
  });
});
