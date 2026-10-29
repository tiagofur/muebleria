import { describe, expect, it } from 'vitest';

import {
  type HardwareDesignPart,
  isValidActorMembership,
  validateHardwareDesignParts,
} from './hardwareDesignParts';

describe('validateHardwareDesignParts (#1417)', () => {
  it('acepta partes válidas con membresía body/actor y finishKey opcional', () => {
    const parts: readonly HardwareDesignPart[] = [
      { componentName: 'riel_fijo', actorMembership: 'body', label: 'Riel fijo' },
      { componentName: 'riel_movil', actorMembership: 'actor:drawer', finishKey: 'body' },
    ];
    expect(() => validateHardwareDesignParts(parts)).not.toThrow();
  });

  it('rechaza componentName vacío o duplicado', () => {
    expect(() =>
      validateHardwareDesignParts([{ componentName: '  ', actorMembership: 'body' }]),
    ).toThrow('non-empty componentName');
    expect(() =>
      validateHardwareDesignParts([
        { componentName: 'riel', actorMembership: 'body' },
        { componentName: 'riel', actorMembership: 'actor:drawer' },
      ]),
    ).toThrow('more than once');
  });

  it('rechaza membresía inválida con el vocabulario #1376 (vacío, actor sin id, custom)', () => {
    for (const bad of [undefined, '', 'no-es-actor', 'actor:', 'actor: con espacio']) {
      expect(() =>
        validateHardwareDesignParts([
          { componentName: 'riel', actorMembership: bad as string },
        ]),
      ).toThrow(/invalid actorMembership/);
    }
  });

  it('rechaza finishKey/label vacíos cuando están presentes', () => {
    expect(() =>
      validateHardwareDesignParts([{ componentName: 'riel', actorMembership: 'body', finishKey: '' }]),
    ).toThrow('finishKey');
    expect(() =>
      validateHardwareDesignParts([{ componentName: 'riel', actorMembership: 'body', label: '  ' }]),
    ).toThrow('label');
  });

  it('undefined pasa (herraje monolítico legacy)', () => {
    expect(() => validateHardwareDesignParts(undefined)).not.toThrow();
  });

  it('isValidActorMembership cubre el vocabulario exacto', () => {
    expect(isValidActorMembership('body')).toBe(true);
    expect(isValidActorMembership('actor:drawer')).toBe(true);
    expect(isValidActorMembership('')).toBe(false);
    expect(isValidActorMembership('actor:')).toBe(false);
    expect(isValidActorMembership('cuerpo')).toBe(false);
  });
});
