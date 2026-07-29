/**
 * 3D model export utility — triggers browser download from Three.js scene data.
 */

export type ModelFormat = 'gltf' | 'glb' | 'obj' | 'stl';

const FORMAT_CONFIG: Record<ModelFormat, { ext: string; mime: string }> = {
  gltf: { ext: 'gltf', mime: 'application/json' },
  glb: { ext: 'glb', mime: 'model/gltf-binary' },
  obj: { ext: 'obj', mime: 'text/plain' },
  stl: { ext: 'stl', mime: 'application/octet-stream' },
};

export function downloadBlob(
  data: string | ArrayBuffer | ArrayBufferView | Blob,
  filename: string,
  mimeType: string,
): void {
  const blob =
    data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function getExportMimeType(format: ModelFormat): string {
  return FORMAT_CONFIG[format].mime;
}

export function getExportExtension(format: ModelFormat): string {
  return FORMAT_CONFIG[format].ext;
}

/**
 * Sanitize a project name for use as a filename.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}
