/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_PHOTO_PNG_MIME,
  canvasToPngBlob,
  captureScenePngFile,
  findSceneCanvas,
  pngBlobToFile,
} from './captureScenePng';

describe('findSceneCanvas', () => {
  it('returns null for missing root', () => {
    expect(findSceneCanvas(null)).toBeNull();
    expect(findSceneCanvas(undefined)).toBeNull();
  });

  it('finds the first canvas under root', () => {
    const root = document.createElement('div');
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);
    expect(findSceneCanvas(root)).toBe(canvas);
  });
});

describe('pngBlobToFile', () => {
  it('sanitizes basename and sets png mime', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: CATALOG_PHOTO_PNG_MIME,
    });
    const file = pngBlobToFile(blob, 'Mod A / Cocina');
    expect(file.name).toBe('Mod_A___Cocina_3d.png');
    expect(file.type).toBe(CATALOG_PHOTO_PNG_MIME);
  });

  it('falls back when basename empty', () => {
    const blob = new Blob([new Uint8Array([9])], {
      type: CATALOG_PHOTO_PNG_MIME,
    });
    expect(pngBlobToFile(blob, '  ').name).toBe('mueble_3d.png');
  });
});

describe('canvasToPngBlob', () => {
  it('resolves blob from toBlob', async () => {
    const canvas = document.createElement('canvas');
    const payload = new Blob([new Uint8Array([10, 20])], {
      type: CATALOG_PHOTO_PNG_MIME,
    });
    canvas.toBlob = ((cb: BlobCallback) => {
      cb(payload);
    }) as typeof canvas.toBlob;

    const blob = await canvasToPngBlob(canvas);
    expect(blob).toBe(payload);
  });

  it('rejects when toBlob returns empty', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = ((cb: BlobCallback) => {
      cb(null);
    }) as typeof canvas.toBlob;

    await expect(canvasToPngBlob(canvas)).rejects.toThrow(/vacío/i);
  });
});

describe('captureScenePngFile', () => {
  it('throws when no canvas', async () => {
    const root = document.createElement('div');
    await expect(captureScenePngFile(root, 'x')).rejects.toThrow(
      /No hay vista 3D/,
    );
  });

  it('returns File from canvas under root', async () => {
    const root = document.createElement('div');
    const canvas = document.createElement('canvas');
    const payload = new Blob([new Uint8Array([7, 8, 9])], {
      type: CATALOG_PHOTO_PNG_MIME,
    });
    canvas.toBlob = ((cb: BlobCallback) => {
      cb(payload);
    }) as typeof canvas.toBlob;
    root.appendChild(canvas);

    const file = await captureScenePngFile(root, 'BASE-600');
    expect(file.name).toBe('BASE-600_3d.png');
    expect(file.size).toBe(3);
  });
});

describe('downloadPngFile side-effect free unit path', () => {
  it('export exists for modal wiring', async () => {
    const { downloadPngFile } = await import('./captureScenePng');
    expect(typeof downloadPngFile).toBe('function');
    // smoke: does not throw with stub URL APIs
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation(
      (n) => n,
    );
    const remove = vi.spyOn(document.body, 'removeChild').mockImplementation(
      (n) => n,
    );
    // patch createElement for anchor only
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = click;
      }
      return el;
    });

    downloadPngFile(
      new File([new Uint8Array([1])], 't_3d.png', {
        type: CATALOG_PHOTO_PNG_MIME,
      }),
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    append.mockRestore();
    remove.mockRestore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
