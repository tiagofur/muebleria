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
    expect(parsed.v).toBe(1);
    expect(parsed.projectId).toBe('proj-1');
    expect(parsed.module).toBe('MOD-GAB-01');
    expect(parsed.part).toBe('LAT');
    expect(parsed.material).toBe('TAB-1');
    expect(parsed.L).toBe(720);
    expect(parsed.W).toBe(560);
  });
});
