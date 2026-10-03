import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  type OutputCompatibilityProfile,
} from '@granete/domain';
import { buildFixtureMachiningJob } from './machineOutputFixtures';
import { KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR, KDT_POSTPROCESSOR_ADAPTER, serializePerPiece } from './kdtAdapter';
import {
  KDT_FLEXDRILL_1200_PROFILE,
  KDT_FLEXDRILL_1200_PROFILE_R1,
  KDT_REQUIRED_DIMENSIONS,
} from './profiles';
import { canonicalJson, sha256Hex } from './digest';

describe('KDT_POSTPROCESSOR_ADAPTER (serializer K2, #1005)', () => {
  it('r2 + fixture convención-canon: ready=true y serialize produce bytes KDTPanelFormat', async () => {
    const job = buildFixtureMachiningJob();
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(job, KDT_FLEXDRILL_1200_PROFILE);
    expect(readiness.ready).toBe(true);
    const bytes = KDT_POSTPROCESSOR_ADAPTER.serialize(job, KDT_FLEXDRILL_1200_PROFILE);
    const xml = new TextDecoder().decode(bytes);
    expect(xml.startsWith('<KDTPanelFormat>')).toBe(true);
    expect(xml).toContain('<TypeName>Horizontal Hole</TypeName>');
    // Identidad byte-estable del camino completo job → programa único.
    expect(await sha256Hex(bytes)).toBe(
      '07645adceccc4f5ab10c56e448158c77e3a945acd5dd65271b9db7a61b87e745',
    );
  });

  it('serializePerPiece es la API real por pieza/cara y coincide con serialize a un programa', () => {
    const job = buildFixtureMachiningJob();
    const artifacts = serializePerPiece(job, KDT_FLEXDRILL_1200_PROFILE);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.pieceCode).toBe('fixture-module-m.fixture-panel-001');
    expect(artifacts[0]!.machiningFace).toBe('back');
    expect(new TextDecoder().decode(artifacts[0]!.bytes)).toContain('<KDTPanelFormat>');
    const multiPiece = {
      ...job,
      drilling: {
        ...job.drilling,
        totalPiecesCount: 2,
        totalHolesCount: 12,
        patterns: [job.drilling.patterns[0]!, { ...job.drilling.patterns[0]!, pieceCode: 'MOD-1-P02' }],
      },
    };
    expect(serializePerPiece(multiPiece, KDT_FLEXDRILL_1200_PROFILE)).toHaveLength(2);
  });

  it('ready=false con PROGRAM_GRANULARITY_UNSUPPORTED en trabajos multi-programa (serialize nunca concatena)', () => {
    const job = buildFixtureMachiningJob();
    const multiPiece = {
      ...job,
      drilling: {
        ...job.drilling,
        totalPiecesCount: 2,
        totalHolesCount: 12,
        patterns: [job.drilling.patterns[0]!, { ...job.drilling.patterns[0]!, pieceCode: 'MOD-1-P02' }],
      },
    };
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(multiPiece, KDT_FLEXDRILL_1200_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'PROGRAM_GRANULARITY_UNSUPPORTED' }),
    );
    expect(() => KDT_POSTPROCESSOR_ADAPTER.serialize(multiPiece, KDT_FLEXDRILL_1200_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('r1 histórica sigue bloqueada por evidencia (8 dimensiones) — nunca retarget', () => {
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(
      buildFixtureMachiningJob(),
      KDT_FLEXDRILL_1200_PROFILE_R1,
    );
    expect(readiness.ready).toBe(false);
    expect(
      readiness.reasons.filter((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED').length,
    ).toBe(KDT_REQUIRED_DIMENSIONS.length);
  });

  it('JOB_DATA_INVALID: agujero fuera del marco de su cara bloquea sin archivo', () => {
    const job = buildFixtureMachiningJob();
    const broken = {
      ...job,
      drilling: {
        ...job.drilling,
        patterns: [
          {
            ...job.drilling.patterns[0]!,
            holes: [
              ...job.drilling.patterns[0]!.holes.slice(0, -1),
              // Convención violada: left lleva espesor en xMm, 300 > 18.
              { face: 'left' as const, xMm: 300, yMm: 100, diameterMm: 8, depthMm: 34, type: 'minifix' as const },
            ],
          },
        ],
      },
    };
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(broken, KDT_FLEXDRILL_1200_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'JOB_DATA_INVALID' }),
    );
    expect(() => serializePerPiece(broken, KDT_FLEXDRILL_1200_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('family mismatch en el perfil bloquea (checkFormatFamily)', () => {
    const wrongFamily: OutputCompatibilityProfile = {
      ...KDT_FLEXDRILL_1200_PROFILE,
      formatFamily: 'mpr',
    };
    const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(
      buildFixtureMachiningJob(),
      wrongFamily,
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'FORMAT_FAMILY_MISMATCH' }),
    );
  });

  it('implementation digest matches its canonical descriptor', async () => {
    expect(await sha256Hex(canonicalJson(KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      KDT_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
  });
});
