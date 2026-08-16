import { describe, expect, it } from 'vitest';
import {
  moduleLabelQrPayload,
  moduleLabelQrPayloadUrl,
  parsePieceLabelScan,
  pieceLabelQrPayload,
  pieceLabelQrPayloadUrl,
  unwrapPieceLabelQrUrl,
} from './pieceLabelQr';

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

describe('moduleLabelQrPayload (Module / Package QR)', () => {
  it('encodes module and package identifiers as compact JSON', () => {
    const raw = moduleLabelQrPayload({
      projectId: 'proj-10',
      itemId: 'item-20',
      factoryCode: 'GAB-01-L2',
      moduleCode: 'GAB-01',
      moduleName: 'Bajo Fregadero',
      packageIndex: 3,
      totalPackages: 8,
      unitIndex: 2,
      unitQuantity: 2,
      widthMm: 800,
      heightMm: 850,
      depthMm: 600,
      revision: '1',
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.v).toBe(2);
    expect(parsed.k).toBe('mod');
    expect(parsed.projectId).toBe('proj-10');
    expect(parsed.itemId).toBe('item-20');
    expect(parsed.fc).toBe('GAB-01-L2');
    expect(parsed.mod).toBe('GAB-01');
    expect(parsed.name).toBe('Bajo Fregadero');
    expect(parsed.bulto).toBe(3);
    expect(parsed.tot).toBe(8);
    expect(parsed.uIdx).toBe(2);
    expect(parsed.uQty).toBe(2);
    expect(parsed.dims).toEqual([800, 850, 600]);
    expect(parsed.rev).toBe('1');
  });

  it('supports deep link URLs with moduleLabelQrPayloadUrl', () => {
    const fields = {
      projectId: 'p1',
      itemId: 'i1',
      factoryCode: 'GAB-01',
      moduleCode: 'GAB-01',
      moduleName: 'Gabinete',
      packageIndex: 1,
      totalPackages: 4,
    };
    const url = moduleLabelQrPayloadUrl(fields);
    expect(url.startsWith('muebles://scan#')).toBe(true);

    const parsed = parsePieceLabelScan(url);
    expect(parsed).toEqual({
      kind: 'modulePayload',
      version: 2,
      target: 'module',
      fields: {
        projectId: 'p1',
        itemId: 'i1',
        factoryCode: 'GAB-01',
        moduleCode: 'GAB-01',
        moduleName: 'Gabinete',
        packageIndex: 1,
        totalPackages: 4,
        unitIndex: 1,
        unitQuantity: 1,
        widthMm: null,
        heightMm: null,
        depthMm: null,
        revision: undefined,
      },
    });
  });
});

describe('parsePieceLabelScan (F089 + Module QR)', () => {
  it('round-trips a v2 piece payload', () => {
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
      target: 'piece',
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

  it('round-trips a module / package payload', () => {
    const raw = moduleLabelQrPayload({
      projectId: 'proj-1',
      itemId: 'item-1',
      factoryCode: 'ALAC-01-L1',
      moduleCode: 'ALAC-01',
      moduleName: 'Alacena 2P',
      packageIndex: 2,
      totalPackages: 5,
      unitIndex: 1,
      unitQuantity: 1,
      widthMm: 800,
      heightMm: 720,
      depthMm: 350,
      revision: '4',
    });
    const parsed = parsePieceLabelScan(raw);
    expect(parsed).toEqual({
      kind: 'modulePayload',
      version: 2,
      target: 'module',
      fields: {
        projectId: 'proj-1',
        itemId: 'item-1',
        factoryCode: 'ALAC-01-L1',
        moduleCode: 'ALAC-01',
        moduleName: 'Alacena 2P',
        packageIndex: 2,
        totalPackages: 5,
        unitIndex: 1,
        unitQuantity: 1,
        widthMm: 800,
        heightMm: 720,
        depthMm: 350,
        revision: '4',
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

describe('pieceLabelQrPayloadUrl / unwrapPieceLabelQrUrl (F091 deep links)', () => {
  const fields = {
    projectId: 'proj-1',
    moduleCode: 'MOD-GAB-01',
    partCode: 'P03',
    description: 'Costado',
    materialCode: 'TAB-1',
    lengthMm: 720,
    widthMm: 560,
  };

  it('wraps the same JSON v2 in the custom scheme by default', () => {
    const url = pieceLabelQrPayloadUrl(fields);
    expect(url.startsWith('muebles://scan#')).toBe(true);
    const inner = unwrapPieceLabelQrUrl(url);
    expect(inner).toBe(pieceLabelQrPayload(fields));
  });

  it('emits https://<host>/scan# when a host is provided', () => {
    const url = pieceLabelQrPayloadUrl(fields, { host: 'taller.midominio.com' });
    expect(url.startsWith('https://taller.midominio.com/scan#')).toBe(true);
    // host is sanitized: scheme prefixes and trailing slashes are stripped
    const sloppy = pieceLabelQrPayloadUrl(fields, {
      host: 'https://taller.midominio.com/',
    });
    expect(sloppy).toBe(url);
  });

  it('parsePieceLabelScan accepts BOTH forms identically', () => {
    const fromJson = parsePieceLabelScan(pieceLabelQrPayload(fields));
    const fromScheme = parsePieceLabelScan(pieceLabelQrPayloadUrl(fields));
    const fromHttps = parsePieceLabelScan(
      pieceLabelQrPayloadUrl(fields, { host: 'taller.example.com' }),
    );
    expect(fromScheme).toEqual(fromJson);
    expect(fromHttps).toEqual(fromJson);
    expect(fromJson?.kind).toBe('payload');
  });

  it('pre-F091 plain JSON payloads still parse identically (no reprint needed)', () => {
    const legacy = pieceLabelQrPayload(fields);
    const parsed = parsePieceLabelScan(legacy);
    expect(parsed).toMatchObject({ kind: 'payload', version: 2 });
    expect(parsed && parsed.kind === 'payload' && parsed.fields.moduleCode).toBe(
      'MOD-GAB-01',
    );
  });

  it('URL with garbage fragment falls back to plainCode, not a crash', () => {
    expect(unwrapPieceLabelQrUrl('muebles://scan#%ZZ-broken')).toBe('%ZZ-broken');
    const parsed = parsePieceLabelScan('muebles://scan#%ZZ-broken');
    expect(parsed).toEqual({ kind: 'plainCode', code: 'muebles://scan#%ZZ-broken' });
  });

  it('URL without fragment and non-QR URLs return null/plainCode safely', () => {
    expect(unwrapPieceLabelQrUrl('muebles://scan')).toBeNull();
    expect(unwrapPieceLabelQrUrl('https://example.com/other#x')).toBe('x'); // forma válida, contenido ajeno
    expect(unwrapPieceLabelQrUrl('GAB-01')).toBeNull();
    // A non-label fragment degrades to plainCode of the whole URL
    const parsed = parsePieceLabelScan('muebles://scan#hello');
    expect(parsed?.kind).toBe('plainCode');
  });
});
