import { describe, expect, it, vi } from 'vitest';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
} from '@muebles/domain/fixtures';
import type { Project } from '@muebles/domain';
import { createSeedWorkspace } from '@muebles/storage/seed';
import {
  buildOptimizerExport,
  deliverExcelFile,
  downloadOptimizerXlsx,
  optimizerFileName,
} from './exportOptimizer';

describe('optimizerFileName', () => {
  it('builds optimizer-{name}.xlsx with safe characters', () => {
    expect(optimizerFileName('Mobiliario Residencial')).toBe(
      'optimizer-Mobiliario-Residencial.xlsx',
    );
    expect(optimizerFileName('  a/b:c  ')).toBe('optimizer-abc.xlsx');
    expect(optimizerFileName('   ')).toBe('optimizer-proyecto.xlsx');
  });
});

describe('buildOptimizerExport', () => {
  it('builds non-empty xlsx for plantilla project', async () => {
    const result = await buildOptimizerExport(
      plantillaProject,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    expect(result.fileName).toMatch(/^optimizer-.*\.xlsx$/);
  });

  it('returns issues when required options missing', async () => {
    const project: Project = {
      ...plantillaProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: {},
        },
      ],
    };
    const result = await buildOptimizerExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.field === 'optionChoices')).toBe(true);
  });

  it('returns VAL-05 when project has no items', async () => {
    const project: Project = { ...plantillaProject, items: [] };
    const result = await buildOptimizerExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.field).toBe('boardParts');
  });

  it('gab-only with complete choices exports', async () => {
    const project: Project = {
      id: 'p',
      name: 'Demo Gab',
      customerId: 'C',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: plantillaChoices,
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const result = await buildOptimizerExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
  });

  it('F011: seed demo project exports Optimizer xlsx without issues', async () => {
    const seed = createSeedWorkspace();
    const demo = seed.projects.find((p) => p.name === 'Demo plantilla');
    expect(demo).toBeDefined();
    const result = await buildOptimizerExport(demo!, seed.catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    expect(result.fileName).toMatch(/optimizer-Demo-plantilla\.xlsx/i);
  });
});

describe('downloadOptimizerXlsx', () => {
  it('creates blob URL and clicks anchor with file name', () => {
    const click = vi.fn();
    const revoke = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const anchor = {
      href: '',
      download: '',
      rel: '',
      click,
    } as unknown as HTMLAnchorElement;

    downloadOptimizerXlsx(new Uint8Array([1, 2, 3]), 'optimizer-demo.xlsx', {
      createObjectURL,
      revokeObjectURL: revoke,
      createElement: () => anchor,
      appendChild,
      removeChild,
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('optimizer-demo.xlsx');
    expect(anchor.href).toBe('blob:mock-url');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revoke).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('deliverExcelFile (EXP-06 / EXP-07)', () => {
  it('uses Electron save dialog when electronAPI is injected', async () => {
    const writeExcelFile = vi.fn(async () => undefined);
    const showSaveDialog = vi.fn(async () => '/tmp/out.xlsx');
    const status = await deliverExcelFile(
      new Uint8Array([9, 8, 7]),
      'optimizer-demo.xlsx',
      undefined,
      { showSaveDialog, writeExcelFile },
    );
    expect(status).toBe('saved');
    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: 'optimizer-demo.xlsx',
    });
    expect(writeExcelFile).toHaveBeenCalledOnce();
    const [, buffer] = writeExcelFile.mock.calls[0]!;
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('returns cancelled when save dialog is aborted', async () => {
    const status = await deliverExcelFile(
      new Uint8Array([1]),
      'x.xlsx',
      undefined,
      {
        showSaveDialog: async () => undefined,
        writeExcelFile: async () => undefined,
      },
    );
    expect(status).toBe('cancelled');
  });

  it('falls back to browser download without electronAPI', async () => {
    const click = vi.fn();
    const anchor = {
      href: '',
      download: '',
      rel: '',
      click,
    } as unknown as HTMLAnchorElement;
    const status = await deliverExcelFile(
      new Uint8Array([1, 2]),
      'optimizer-web.xlsx',
      {
        createObjectURL: () => 'blob:x',
        revokeObjectURL: () => undefined,
        createElement: () => anchor,
        appendChild: () => undefined,
        removeChild: () => undefined,
      },
      undefined,
    );
    expect(status).toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
  });
});
