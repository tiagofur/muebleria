import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/hardwareDesignParts.contract.json';
import {
  attachHardwareDesignParts,
  resolveAgregadoAssembly,
} from './agregadoAssembly';
import type { Hardware } from './types';

describe('hardware design parts Go/TS parity (#1417)', () => {
  it('adjunta las partes del herraje al miembro y deja monolítico intacto', () => {
    const agregado = fixture.agregado as unknown as Parameters<
      typeof resolveAgregadoAssembly
    >[0];
    const hardware = fixture.hardware as unknown as Hardware[];
    const resolved = resolveAgregadoAssembly(agregado, fixture.params);
    const out = attachHardwareDesignParts(resolved, hardware);

    expect(out.rigidMembers).toHaveLength(fixture.expectedMembers.length);

    for (const expected of fixture.expectedMembers as readonly {
      memberId: string;
      expectedDesignParts: readonly {
        componentName: string;
        actorMembership: string;
        finishKey?: string;
        label?: string;
      }[] | null;
    }[]) {
      const member = out.rigidMembers.find((m) => m.memberId === expected.memberId);
      expect(member).toBeDefined();
      if (expected.expectedDesignParts === null) {
        expect(member?.designParts).toBeUndefined();
      } else {
        expect(member?.designParts).toEqual(expected.expectedDesignParts);
      }
    }
  });
});
