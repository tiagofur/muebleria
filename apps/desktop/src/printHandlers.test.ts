import { describe, expect, it, vi } from 'vitest';
import { createPrintRawHandler, type PrintRawDeps } from './printHandlers';

function deps(overrides: Partial<PrintRawDeps> = {}): PrintRawDeps {
  return {
    platform: 'darwin',
    execFile: vi.fn(async () => ({ stdout: 'request id is lp-42', stderr: '' })),
    mkdtemp: vi.fn(async () => '/tmp/muebles-zpl-xxx'),
    writeFile: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createPrintRawHandler', () => {
  it('darwin/linux: pipes the ZPL to lp -d printer -o raw via stdin', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const handler = createPrintRawHandler(deps({ execFile }));
    const result = await handler('Zebra-GK420', '^XA\n^XZ');
    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      'lp',
      ['-d', 'Zebra-GK420', '-o', 'raw', '-'],
      { input: '^XA\n^XZ' },
    );
  });

  it('win32: writes a temp file and copy /b to the printer', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const writeFile = vi.fn(async () => undefined);
    const unlink = vi.fn(async () => undefined);
    const rmdir = vi.fn(async () => undefined);
    const handler = createPrintRawHandler(
      deps({ platform: 'win32', execFile, writeFile, unlink, rmdir }),
    );
    const result = await handler('\\\\server\\zebra', '^XA^XZ');
    expect(result.ok).toBe(true);
    expect(writeFile).toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'copy', '/b', expect.stringContaining('labels.zpl'), '\\\\server\\zebra'],
      {},
    );
    expect(unlink).toHaveBeenCalled();
    expect(rmdir).toHaveBeenCalledWith('/tmp/muebles-zpl-xxx');
  });

  it('rejects an empty printer name or payload without spawning', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const handler = createPrintRawHandler(deps({ execFile }));
    expect((await handler('  ', '^XA')).ok).toBe(false);
    expect((await handler('Zebra', '  ')).ok).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects printer names with shell injection characters or leading dash', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const handler = createPrintRawHandler(deps({ execFile }));
    expect((await handler('Zebra & calc.exe', '^XA')).ok).toBe(false);
    expect((await handler('Zebra | calc.exe', '^XA')).ok).toBe(false);
    expect((await handler('Zebra; calc.exe', '^XA')).ok).toBe(false);
    expect((await handler('-o evil_option', '^XA')).ok).toBe(false);
    expect((await handler('Zebra"with"quotes', '^XA')).ok).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('surfaces lp errors and exec failures as { ok: false, error }', async () => {
    const failing = vi.fn(async () => {
      throw new Error('lp: unable to contact server');
    });
    const handler = createPrintRawHandler(deps({ execFile: failing }));
    const result = await handler('Zebra', '^XA');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unable to contact server');
  });
});
