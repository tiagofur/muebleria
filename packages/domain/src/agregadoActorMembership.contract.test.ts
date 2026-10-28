import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/agregadoActorMembership.contract.json';
import { resolveAgregadoAssembly } from './agregadoAssembly';
import type { Agregado } from './types';

describe('agregado actor membership Go/TS parity (#1376)', () => {
  it('resolves actor membership on rigid members and groups fixed vs moving', () => {
    const agregado = fixture.agregado as unknown as Agregado;
    const resolved = resolveAgregadoAssembly(agregado, fixture.params);

    expect(resolved.rigidMembers).toHaveLength(fixture.expectedMembers.length);

    for (const expected of fixture.expectedMembers) {
      const member = resolved.rigidMembers.find((m) => m.memberId === expected.memberId);
      expect(member).toBeDefined();
      expect(member?.actorMembership ?? '').toBe(expected.actorMembership);
      const isMoving =
        member?.actorMembership !== undefined &&
        member.actorMembership !== '' &&
        member.actorMembership !== 'body';
      expect(isMoving).toBe(expected.isMoving);
    }
  });
});
