/**
 * Hardware Profile contract fixture parity (#912) — same file the Go domain
 * test consumes: contracts/hardwareProfile.contract.json.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  isBoardFace,
  validateComponentSideAssignment,
  validateHardwareProfile,
  type ComponentSideAssignment,
  type HardwareProfile,
} from './hardwareProfile';

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'contracts');

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object');
  return value as Record<string, unknown>;
};

const fixture = record(
  JSON.parse(readFileSync(join(CONTRACTS, 'hardwareProfile.contract.json'), 'utf8')) as unknown,
);

describe('hardwareProfile contract fixture', () => {
  const profiles = (fixture.profiles as unknown[]) as unknown as HardwareProfile[];
  const assignments = (fixture.assignments as unknown[]) as unknown as ComponentSideAssignment[];

  test('validates every shared fixture profile and assignment', () => {
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      expect(validateHardwareProfile(profile), profile.code).toEqual([]);
    }
    for (const assignment of assignments) {
      expect(validateComponentSideAssignment(assignment), assignment.side).toEqual([]);
    }
  });

  test('rejects every shared fail-closed case with the expected paths', () => {
    const cases = fixture.invalidProfiles as unknown[];
    expect(cases.length).toBeGreaterThan(0);
    for (const value of cases) {
      const testCase = record(value);
      const issues = validateHardwareProfile(testCase.profile as HardwareProfile);
      const paths = new Set(issues.map((issue) => issue.path));
      const codes = new Set(issues.map((issue) => issue.code));
      for (const expected of testCase.expectedIssueCodes as string[]) {
        expect(codes.has(expected), String(testCase.case)).toBe(true);
      }
      for (const expected of testCase.expectedPaths as string[]) {
        expect(paths.has(expected), String(testCase.case)).toBe(true);
      }
      for (const issue of issues) {
        expect(issue.severity).toBe('error');
      }
    }
  });

  test('rejects shared invalid assignments', () => {
    const cases = fixture.invalidAssignments as unknown[];
    expect(cases.length).toBeGreaterThan(0);
    for (const value of cases) {
      const testCase = record(value);
      const issues = validateComponentSideAssignment(testCase.assignment as ComponentSideAssignment);
      const paths = issues.map((issue) => issue.path);
      for (const expected of testCase.expectedPaths as string[]) {
        expect(paths.some((path) => path.endsWith(expected)), String(testCase.case)).toBe(true);
      }
    }
  });

  test('pins the six-face side vocabulary without aliases', () => {
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      expect(isBoardFace(face)).toBe(true);
    }
    for (const notFace of ['L1', 'W1', 'base', 'interno', 'lateral_izquierdo', '']) {
      expect(isBoardFace(notFace as string)).toBe(false);
    }
  });
});
