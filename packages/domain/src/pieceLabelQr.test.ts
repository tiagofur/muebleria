import { describe, expect, it } from 'vitest';
import { pieceLabelQrPayload } from './pieceLabelQr';

describe('pieceLabelQrPayload', () => {
  it('encodes project and part identifiers as JSON', () => {
    const raw = pieceLabelQrPayload({
      projectId: 'proj-1',
      moduleCode: 'MOD-GAB-01',
      partCode: 'LAT',
      description: 'Costado',
      materialCode: 'TAB-1',
      lengthMm: 720,
      widthMm: 560,
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.v).toBe(2);
    expect(parsed.projectId).toBe('proj-1');
    expect(parsed.module).toBe('MOD-GAB-01');
    expect(parsed.part).toBe('LAT');
    expect(parsed.material).toBe('TAB-1');
    expect(parsed.L).toBe(720);
    expect(parsed.W).toBe(560);
    // v2 defaults — same QR shape for every caller.
    expect(parsed.qty).toBe(1);
    expect(parsed.edges).toBe('');
    expect(parsed.edge).toBe('');
    expect(parsed.rev).toBe('');
  });

  it('v2 carries quantity, edge sides, edge band code and revision', () => {
    const raw = pieceLabelQrPayload({
      projectId: 'proj-1',
      moduleCode: 'MOD-GAB-01',
      partCode: 'LAT',
      description: 'Costado',
      materialCode: 'TAB-1',
      lengthMm: 720,
      widthMm: 560,
      quantity: 3,
      edgeSides: 'L1+W2',
      edgeCode: 'CANT-ABS-BLA',
      revision: '2',
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.qty).toBe(3);
    expect(parsed.edges).toBe('L1+W2');
    expect(parsed.edge).toBe('CANT-ABS-BLA');
    expect(parsed.rev).toBe('2');
  });
});
