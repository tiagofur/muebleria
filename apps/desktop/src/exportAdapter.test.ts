import { describe, expect, it, vi } from 'vitest';
import { createExcelIpcHandlers } from './ipcHandlers';
import { exportOptimizerDesktop } from './exportAdapter';
import { getElectronAPI } from './electronApi';

describe('exportOptimizerDesktop', () => {
  it('writes file when dialog returns a path', async () => {
    let written: ArrayBuffer | undefined;
    const writeExcelFile = vi.fn(
      async (_path: string, buffer: ArrayBuffer) => {
        written = buffer;
      },
    );
    const showSaveDialog = vi.fn(async () => '/tmp/optimizer-demo.xlsx');

    const status = await exportOptimizerDesktop(
      new Uint8Array([80, 75]),
      'optimizer-demo.xlsx',
      { showSaveDialog, writeExcelFile },
    );

    expect(status).toBe('saved');
    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: 'optimizer-demo.xlsx',
    });
    expect(writeExcelFile).toHaveBeenCalledOnce();
    expect(written).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(written!)[0]).toBe(80);
  });

  it('returns cancelled when dialog is dismissed', async () => {
    const writeExcelFile = vi.fn(async () => undefined);
    const status = await exportOptimizerDesktop(
      new Uint8Array([1]),
      'optimizer-x.xlsx',
      {
        showSaveDialog: async () => undefined,
        writeExcelFile,
      },
    );
    expect(status).toBe('cancelled');
    expect(writeExcelFile).not.toHaveBeenCalled();
  });
});

describe('createExcelIpcHandlers', () => {
  it('maps dialog cancel to undefined path', async () => {
    const api = createExcelIpcHandlers({
      showSaveDialog: async () => ({ canceled: true }),
      writeFile: async () => undefined,
    });
    await expect(
      api.showSaveDialog({ defaultPath: 'a.xlsx' }),
    ).resolves.toBeUndefined();
  });

  it('returns chosen path and writes buffer bytes', async () => {
    const writeFile = vi.fn(async () => undefined);
    const api = createExcelIpcHandlers({
      showSaveDialog: async (opts) => {
        expect(opts.filters[0]?.extensions).toContain('xlsx');
        return { canceled: false, filePath: '/out/file.xlsx' };
      },
      writeFile,
    });

    await expect(
      api.showSaveDialog({ defaultPath: 'file.xlsx' }),
    ).resolves.toBe('/out/file.xlsx');

    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await api.writeExcelFile('/out/file.xlsx', bytes);
    expect(writeFile).toHaveBeenCalledWith(
      '/out/file.xlsx',
      expect.any(Uint8Array),
    );
  });
});

describe('getElectronAPI', () => {
  it('reads window.electronAPI when present', () => {
    const api = {
      showSaveDialog: async () => undefined,
      writeExcelFile: async () => undefined,
    };
    expect(getElectronAPI({ electronAPI: api })).toBe(api);
    expect(getElectronAPI({})).toBeUndefined();
  });
});
