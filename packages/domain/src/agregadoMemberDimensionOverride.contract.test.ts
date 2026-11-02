/**
 * #1460 F2 — paridad compartida TS↔Go del override de dimensiones por miembro
 * rígido. El MISMO fixture lo consume el engine Go
 * (agregado_member_dimension_override_contract_test.go): el merge override↔
 * catálogo, el entorno de la fórmula (PW/PH/PD + HW/HH/HD de catálogo) y la
 * exposición de resolvedDimensions (sólo con override) resuelven idéntico en
 * ambos runtimes — incluido el caso legacy sin override, byte-idéntico.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveAgregadoAssembly,
  type AgregadoAssemblyInput,
  type AssemblyResolutionParams,
} from './agregadoAssembly';

interface OverrideFixture {
  readonly schemaId: string;
  readonly params: { readonly widthMm: number; readonly depthMm: number; readonly heightMm: number };
  readonly hardwareDimensions: Record<
    string,
    { readonly widthMm: number; readonly heightMm: number; readonly depthMm: number }
  >;
  readonly agregado: AgregadoAssemblyInput;
  readonly expected: Record<
    string,
    {
      readonly translationMm: readonly [number, number, number];
      readonly resolvedDimensions: {
        readonly widthMm: number;
        readonly heightMm: number;
        readonly depthMm: number;
      } | null;
    }
  >;
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/agregadoMemberDimensionOverride.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as OverrideFixture;

describe('agregado member dimension override — shared TS↔Go contract (#1460 F2)', () => {
  it('resuelve coords y dimensiones efectivas idénticas al fixture compartido', () => {
    expect(fixture.schemaId).toBe('granete.agregado-member-dimension-override.v1');
    const params: AssemblyResolutionParams = {
      widthMm: fixture.params.widthMm,
      depthMm: fixture.params.depthMm,
      heightMm: fixture.params.heightMm,
      hardwareDimensions: fixture.hardwareDimensions,
    };
    const resolved = resolveAgregadoAssembly(fixture.agregado, params);

    for (const [memberId, want] of Object.entries(fixture.expected)) {
      const member = resolved.rigidMembers.find((m) => m.memberId === memberId);
      expect(member, `member ${memberId} resolved`).toBeTruthy();
      expect(member!.localTransform.translationMm, `${memberId} translationMm`).toEqual([
        want.translationMm[0],
        want.translationMm[1],
        want.translationMm[2],
      ]);
      if (want.resolvedDimensions === null) {
        // Legacy: sin override el payload NO lleva resolvedDimensions.
        expect(member!.resolvedDimensions, `${memberId} resolvedDimensions absent`).toBeUndefined();
      } else {
        expect(member!.resolvedDimensions, `${memberId} resolvedDimensions`).toEqual(
          want.resolvedDimensions,
        );
      }
    }
  });
});
