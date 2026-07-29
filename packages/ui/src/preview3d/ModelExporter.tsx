/**
 * R3F component that exports the scene to 3D model formats (#199).
 * Must be rendered inside a Canvas to access the Three.js scene via useThree().
 *
 * Usage from outside the Canvas: set `exportFormat` prop to trigger an export.
 * The component resets exportFormat to null after export completes.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import type { Object3D } from 'three';
import type { ModelFormat } from './exportModel';

import {
  downloadBlob,
  getExportMimeType,
  getExportExtension,
  sanitizeFilename,
} from './exportModel';

export type { ModelFormat } from './exportModel';


export type ModelExporterProps = {
  /**
   * Set to a ModelFormat to trigger export. The component resets this to null
   * after export completes. Use via useState in the parent component.
   */
  readonly exportFormat: ModelFormat | null;
  /** Reset callback — parent should call setExportFormat(null). */
  readonly onExportComplete: () => void;
  /** Project name used as the base filename. */
  readonly projectName: string;
};

async function exportGLTF(
  scene: Object3D,
  projectName: string,
  binary: boolean,
): Promise<void> {
  const { GLTFExporter } = await import(
    'three/examples/jsm/exporters/GLTFExporter.js'
  );
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary });

  const format: ModelFormat = binary ? 'glb' : 'gltf';
  const ext = getExportExtension(format);
  const mime = getExportMimeType(format);
  const filename = `${sanitizeFilename(projectName)}.${ext}`;

  if (binary) {
    downloadBlob(result as ArrayBuffer, filename, mime);
  } else {
    downloadBlob(
      JSON.stringify(result, null, 2),
      filename,
      mime,
    );
  }
}

async function exportOBJ(
  scene: Object3D,
  projectName: string,
): Promise<void> {
  const { OBJExporter } = await import(
    'three/examples/jsm/exporters/OBJExporter.js'
  );
  const exporter = new OBJExporter();
  const result = exporter.parse(scene);
  const filename = `${sanitizeFilename(projectName)}.obj`;
  downloadBlob(result, filename, getExportMimeType('obj'));
}

async function exportSTL(
  scene: Object3D,
  projectName: string,
): Promise<void> {
  const { STLExporter } = await import(
    'three/examples/jsm/exporters/STLExporter.js'
  );
  const exporter = new STLExporter();
  const result = exporter.parse(scene, { binary: true });
  const filename = `${sanitizeFilename(projectName)}.stl`;
  // STLExporter binary parse returns DataView (extends ArrayBufferView)
  downloadBlob(result, filename, getExportMimeType('stl'));
}

export function ModelExporter({
  exportFormat,
  onExportComplete,
  projectName,
}: ModelExporterProps): ReactNode {
  const { scene } = useThree();
  const busyRef = useRef(false);

  useEffect(() => {
    if (!exportFormat || busyRef.current) return;

    busyRef.current = true;
    const run = async () => {
      try {
        switch (exportFormat) {
          case 'gltf':
            await exportGLTF(scene, projectName, false);
            break;
          case 'glb':
            await exportGLTF(scene, projectName, true);
            break;
          case 'obj':
            await exportOBJ(scene, projectName);
            break;
          case 'stl':
            await exportSTL(scene, projectName);
            break;
        }
      } catch (err) {
        console.error('[ModelExporter] Export failed:', err);
      } finally {
        busyRef.current = false;
        onExportComplete();
      }
    };

    run();
  }, [exportFormat, scene, projectName, onExportComplete]);

  return null;
}
