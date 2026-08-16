import { describe, expect, it } from 'vitest';
import { parsePieceLabelScan, pieceLabelQrPayload } from './pieceLabelQr';

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

describe('parsePieceLabelScan (F089)', () => {
  it('round-trips a v2 payload', () => {
    const raw = pieceLabelQrPayload({
      projectId: 'proj-1',
      moduleCode: 'MOD-GAB-01',
      partCode: 'P03',
      description: 'Costado',
      materialCode: 'TAB-1',
      lengthMm: 720,
      widthMm: 560,
      quantity: 2,
      edgeSides: 'L1+W2',
      edgeCode: 'CANT-ABS-BLA',
      revision: '3',
    });
    const parsed = parsePieceLabelScan(raw);
    expect(parsed).toEqual({
      kind: 'payload',
      version: 2,
      fields: {
        projectId: 'proj-1',
        moduleCode: 'MOD-GAB-01',
        partCode: 'P03',
        description: 'Costado',
        materialCode: 'TAB-1',
        lengthMm: 720,
        widthMm: 560,
        quantity: 2,
        edgeSides: 'L1+W2',
        edgeCode: 'CANT-ABS-BLA',
        revision: '3',
      },
    });
  });

  it('parses a legacy v1 payload from an old label (no v2 fields)', () => {
    const raw = JSON.stringify({
      v: 1,
      projectId: 'proj-1',
      module: 'MOD-CAJ-01',
      part: '',
      desc: 'Frente',
      material: 'TAB-2',
      L: 596,
      W: 396,
    });
    const parsed = parsePieceLabelScan(raw);
    expect(parsed?.kind).toBe('payload');
    if (parsed?.kind === 'payload') {
      expect(parsed.version).toBe(1);
      expect(parsed.fields.moduleCode).toBe('MOD-CAJ-01');
      expect(parsed.fields.lengthMm).toBe(596);
      expect(parsed.fields.quantity).toBeUndefined();
      expect(parsed.fields.edgeSides).toBeUndefined();
    }
  });

  it('treats a payload without v as legacy v1', () => {
    const raw = JSON.stringify({
      projectId: 'proj-1',
      module: 'MOD-CAJ-01',
      desc: 'Frente',
      material: 'TAB-2',
      L: 596,
      W: 396,
    });
    const parsed = parsePieceLabelScan(raw);
    expect(parsed?.kind).toBe('payload');
    if (parsed?.kind === 'payload') expect(parsed.version).toBe(1);
  });

  it('returns plainCode for factory codes and module names', () => {
    expect(parsePieceLabelScan('GAB-01-L2')).toEqual({
      kind: 'plainCode',
      code: 'GAB-01-L2',
    });
    expect(parsePieceLabelScan('  alacena norte  ')).toEqual({
      kind: 'plainCode',
      code: 'alacena norte',
    });
  });

  it('falls back to plainCode when the QR JSON is broken', () => {
    const parsed = parsePieceLabelScan('{"v":2,"module":"GAB');
    expect(parsed).toEqual({ kind: 'plainCode', code: '{"v":2,"module":"GAB' });
  });

  it('returns null for blank input or JSON without module', () => {
    expect(parsePieceLabelScan('   ')).toBeNull();
    expect(parsePieceLabelScan('{"v":2,"desc":"sin modulo"}')).toBeNull();
    expect(parsePieceLabelScan('[1,2,3]')).toEqual({
      kind: 'plainCode',
      code: '[1,2,3]',
    });
  });

  it('coerces invalid numbers and blanks safely', () => {
    const parsed = parsePieceLabelScan(
      JSON.stringify({ v: 2, module: 'GAB-01', L: 'x', W: -3, qty: 0 }),
    );
    expect(parsed?.kind).toBe('payload');
    if (parsed?.kind === 'payload') {
      expect(parsed.fields.lengthMm).toBe(0);
      expect(parsed.fields.widthMm).toBe(0);
      expect(parsed.fields.quantity).toBe(1);
      expect(parsed.fields.projectId).toBe('');
    }
  });
});
