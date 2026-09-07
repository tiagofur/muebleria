import { describe, expect, it } from 'vitest';
import {
  canonicalProfileData,
  CLIENT_A_BHX050_PROFILE,
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
} from './profiles';
import { sha256Hex } from './digest';

const ALL_PROFILES = [
  PTX_GENERIC_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  SAW_HOMAG_PROFILE,
  MPR_WOODWOP_PROFILE,
];

describe('machine output profiles', () => {
  it('recorded digests match the canonical profile data (revision integrity)', async () => {
    for (const profile of ALL_PROFILES) {
      const digest = await sha256Hex(canonicalProfileData(profile));
      expect(digest, `${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`).toBe(
        profile.digest,
      );
    }
  });

  it('ptx-generic carries exactly the audited repo serializer dimensions', () => {
    expect(PTX_GENERIC_PROFILE.dimensions).toEqual({
      fileExtension: 'ptx',
      encoding: 'ascii',
      lineEnding: 'crlf',
      decimalPlaces: 1,
      headerVersion: '1.14',
      unit: 'mm',
    });
    expect(PTX_GENERIC_PROFILE.pendingEvidence).toEqual([]);
  });

  it('CADmatic profiles declare zero evidenced dimensions and pending evidence', () => {
    for (const profile of [PTX_CADMATIC_3_PROFILE, PTX_CADMATIC_4_PROFILE, PTX_CADMATIC_5_PROFILE]) {
      expect(profile.dimensions).toEqual({});
      expect(profile.pendingEvidence).toContain('encoding');
      expect(profile.pendingEvidence).toContain('recordOrdering');
      expect(profile.targetSoftware?.provenance).toBe('FIELD_VERIFICATION_REQUIRED');
      expect(profile.supportStatus).toBe('NOT_TESTED');
    }
  });

  it('SAW and MPR profiles declare zero evidenced dimensions', () => {
    expect(SAW_HOMAG_PROFILE.dimensions).toEqual({});
    expect(SAW_HOMAG_PROFILE.pendingEvidence.length).toBeGreaterThan(0);
    expect(MPR_WOODWOP_PROFILE.dimensions).toEqual({});
    expect(MPR_WOODWOP_PROFILE.pendingEvidence).toContain('macroSyntax');
  });

  it('every profile starts NOT_TESTED — no validation claim from data', () => {
    for (const profile of ALL_PROFILES) {
      expect(profile.supportStatus).toBe('NOT_TESTED');
    }
  });

  it('client machine profiles declare zero capabilities (unknown blocks, never passes)', () => {
    expect(CLIENT_A_HPP250_PROFILE.supported).toEqual([]);
    expect(CLIENT_A_BHX050_PROFILE.supported).toEqual([]);
    expect(CLIENT_A_HPP250_PROFILE.identity.model).toBe('HPP 250');
    expect(CLIENT_A_BHX050_PROFILE.identity.model).toBe('BHX 050');
    expect(CLIENT_A_HPP250_PROFILE.identity.provenance).toBe('OWNER_CONFIRMED');
  });
});
