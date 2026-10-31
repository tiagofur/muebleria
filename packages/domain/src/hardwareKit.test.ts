import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_FIXED_OFFSET_MM,
  DEFAULT_MOVING_OFFSET_MM,
  HARDWARE_KIT_SLOTS,
  defaultAgregadoCode,
  planHardwareKit,
  validateHardwareKitInput,
  validateHardwareKitLink,
  validateHardwareKitTemplate,
  type HardwareKitPlanInput,
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

    expect(byMember.get('fixed_rail_left')?.placement.x).toEqual({ ref: 'min', offsetMm: 10 });
    expect(byMember.get('fixed_rail_right')?.placement.x).toEqual({ ref: 'max', offsetMm: -10 });
    expect(byMember.get('moving_rail_left')?.placement.x).toEqual({ ref: 'min', offsetMm: 35 });
    expect(byMember.get('moving_rail_right')?.placement.x).toEqual({ ref: 'max', offsetMm: -35 });
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
});
