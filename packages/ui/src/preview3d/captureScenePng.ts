/**
 * Capture a WebGL/canvas scene to PNG (catalog photo / presentation still).
 * Pure DOM helpers — no React. Requires preserveDrawingBuffer on the R3F Canvas.
 */

import { sanitizeFilename } from './exportModel';

export const CATALOG_PHOTO_PNG_MIME = 'image/png';

/**
 * Find the first canvas under a container (Furniture3DViewer viewport / modal body).
 */
export function findSceneCanvas(
  root: ParentNode | null | undefined,
): HTMLCanvasElement | null {
  if (!root || typeof (root as ParentNode).querySelector !== 'function') {
    return null;
  }
  return root.querySelector('canvas');
}

/**
 * Read PNG blob from a canvas. Rejects if empty or tainted canvas.
 */
export function canvasToPngBlob(
  canvas: HTMLCanvasElement,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          reject(new Error('No se pudo capturar la vista 3D (canvas vacío).'));
          return;
        }
        resolve(blob);
      }, CATALOG_PHOTO_PNG_MIME);
    } catch (err) {
      reject(
        err instanceof Error
          ? err
          : new Error('No se pudo capturar la vista 3D.'),
      );
    }
  });
}

/**
 * Build a File suitable for catalog media upload (F040).
 */
export function pngBlobToFile(blob: Blob, baseName: string): File {
  const safe = sanitizeFilename(baseName.trim() || 'mueble');
  const filename = `${safe}_3d.png`;
  return new File([blob], filename, { type: CATALOG_PHOTO_PNG_MIME });
}

/**
 * Capture PNG File from the first canvas under `root`.
 */
export async function captureScenePngFile(
  root: ParentNode | null | undefined,
  baseName: string,
): Promise<File> {
  const canvas = findSceneCanvas(root);
  if (!canvas) {
    throw new Error('No hay vista 3D para capturar.');
  }
  const blob = await canvasToPngBlob(canvas);
  return pngBlobToFile(blob, baseName);
}

/**
 * Trigger browser download of a PNG blob/file.
 */
export function downloadPngFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
