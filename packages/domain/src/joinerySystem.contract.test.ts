/**
 * #1052 slice 2 / #1219 — paridad compartida TS del contrato de la escalera
 * del sistema de unión. El MISMO fixture lo consume el engine Go
 * (joinery_system_contract_test.go): precedencia relación > componente >
 * fábrica > default y el gate de caras declaradas.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connectionFaceViolatesCapacity,
  effectiveJoinerySystem,
} from './joinerySystem';

interface LadderCase {
  readonly name: string;
  readonly relationshipSystemId: string;
  readonly componentSystemId: string;
  readonly factorySystemId: string;
  readonly kindDefault: string;
  readonly expected: string;
}

interface FaceGateCase {
  readonly name: string;
  readonly declaredFaces: readonly string[];
  readonly anchorFace: string;
  readonly expectedViolation: boolean;
}

interface Fixture {
  readonly schema: number;
  readonly ladderCases: readonly LadderCase[];
  readonly faceGateCases: readonly FaceGateCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/joinerySystemResolution.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('contracts/joinerySystemResolution.contract.json (#1052 slice 2 / #1219)', () => {
  it('is schema 1 with both case families', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.ladderCases.length).toBeGreaterThan(0);
    expect(fixture.faceGateCases.length).toBeGreaterThan(0);
  });

  it.each(fixture.ladderCases.map((c) => [c.name, c] as const))(
    'ladder: %s',
    (_name, testCase) => {
      expect(
        effectiveJoinerySystem(
          testCase.relationshipSystemId,
          testCase.componentSystemId,
          testCase.factorySystemId,
          testCase.kindDefault,
        ),
      ).toBe(testCase.expected);
    },
  );

  it.each(fixture.faceGateCases.map((c) => [c.name, c] as const))(
    'face gate: %s',
    (_name, testCase) => {
      expect(
        connectionFaceViolatesCapacity(testCase.declaredFaces, testCase.anchorFace),
      ).toBe(testCase.expectedViolation);
    },
  );
});
