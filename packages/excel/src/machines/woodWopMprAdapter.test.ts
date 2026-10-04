import { describe, expect, it } from 'vitest';
import { AdapterSerializationBlocked } from '@granete/domain';
import { buildFixtureMachiningJob } from './machineOutputFixtures';
import {
  MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR,
  serializeMprPerPiece,
  WOODWOP_MPR_POSTPROCESSOR_ADAPTER,
} from './woodWopMprAdapter';
import {
  MPR_REQUIRED_DIMENSIONS,
  MPR_WOODWOP_PROFILE,
  MPR_WOODWOP_PROFILE_R1,
} from './profiles';
import { canonicalJson, sha256Hex } from './digest';

describe('WOODWOP_MPR_POSTPROCESSOR_ADAPTER (serializer B2, #879)', () => {
  it('r2 + fixture convención-canon: ready=true y serialize produce bytes MPR', async () => {
    const job = buildFixtureMachiningJob();
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, MPR_WOODWOP_PROFILE);
    expect(readiness.ready).toBe(true);
    const bytes = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.serialize(job, MPR_WOODWOP_PROFILE);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('[H\r\n')).toBe(true);
    expect(text).toContain('<102 \\BohrVert\\');
    expect(text).toContain('<103 \\BohrHoriz\\');
    expect(text.endsWith('!\r\n')).toBe(true);
    // Identidad byte-estable del camino completo job → programa único.
    expect(await sha256Hex(bytes)).toBe(
      '65913586fccd4b698741fdb0f8f2a9fbbe3194858b48bfc30dda3302a5124dcd',
    );
  });

  it('serializeMprPerPiece es la API real por pieza/cara; multi-programa nunca pasa por serialize', () => {
    const job = buildFixtureMachiningJob();
    const artifacts = serializeMprPerPiece(job, MPR_WOODWOP_PROFILE);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.pieceCode).toBe('fixture-module-m.fixture-panel-001');
    expect(artifacts[0]!.machiningFace).toBe('back');
    const multiPiece = {
      ...job,
      drilling: {
        ...job.drilling,
        totalPiecesCount: 2,
        totalHolesCount: 12,
        patterns: [job.drilling.patterns[0]!, { ...job.drilling.patterns[0]!, pieceCode: 'MOD-1-P02' }],
      },
    };
    expect(serializeMprPerPiece(multiPiece, MPR_WOODWOP_PROFILE)).toHaveLength(2);
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(multiPiece, MPR_WOODWOP_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'PROGRAM_GRANULARITY_UNSUPPORTED' }),
    );
    expect(() => WOODWOP_MPR_POSTPROCESSOR_ADAPTER.serialize(multiPiece, MPR_WOODWOP_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('r1 histórica sigue bloqueada por evidencia (8 dimensiones) — nunca retarget', () => {
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(
      buildFixtureMachiningJob(),
      MPR_WOODWOP_PROFILE_R1,
    );
    expect(readiness.ready).toBe(false);
    expect(
      readiness.reasons.filter((r) => r.code === 'FIELD_FORMAT_EVIDENCE_REQUIRED').length,
    ).toBe(MPR_REQUIRED_DIMENSIONS.length);
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
              { face: 'left' as const, xMm: 300, yMm: 100, diameterMm: 8, depthMm: 34, type: 'minifix' as const },
            ],
          },
        ],
      },
    };
    const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(broken, MPR_WOODWOP_PROFILE);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContainEqual(
      expect.objectContaining({ code: 'JOB_DATA_INVALID' }),
    );
    expect(() => serializeMprPerPiece(broken, MPR_WOODWOP_PROFILE)).toThrow(
      AdapterSerializationBlocked,
    );
  });

  it('implementation digest matches its canonical descriptor', async () => {
    expect(await sha256Hex(canonicalJson(MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      WOODWOP_MPR_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
  });
});
