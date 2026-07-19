/**
 * Module 3D preview modal — BOM from components + optional measure preset.
 * Uses unified Furniture3DViewer for camera controls, projection, wireframe, color mode.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module } from '@muebles/domain';
import { Modal } from '../../common';
import { Furniture3DViewer } from '../../common';
import {
  resolveModule3DPreview,
  type Module3DCatalogInput,
} from '../module3dPreview';

export type Module3DModalProps = {
  readonly open: boolean;
  readonly module: Module | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
};

export function Module3DModal({
  open,
  module,
  catalog,
  onClose,
}: Module3DModalProps): ReactNode {
  const [presetId, setPresetId] = useState<string>('');

  useEffect(() => {
    if (!module) {
      setPresetId('');
      return;
    }
    const first = module.presets?.[0]?.id ?? '';
    setPresetId(first);
  }, [module]);

  const preview = useMemo(() => {
    if (!module) return null;
    return resolveModule3DPreview(module, catalog, presetId || undefined);
  }, [module, catalog, presetId]);

  const title = module
    ? `Vista 3D — ${module.code} - ${module.name}`
    : 'Vista 3D';

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {module && preview ? (
        <div data-testid="module-3d-modal-body">
          {/* Preset selector (module-specific) */}
          {preview.presets.length > 0 ? (
            <div
              className="catalog-form__field"
              style={{ marginBottom: '0.75rem' }}
            >
              <label htmlFor="module-3d-preset">Medida (preset)</label>
              <select
                id="module-3d-preset"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                data-testid="module-3d-preset-select"
              >
                {preview.presets.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name?.trim()
                      ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth})`
                      : `${pr.width}×${pr.height}×${pr.depth} mm`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Error / empty states */}
          {preview.error ? (
            <p className="catalog-form__error" data-testid="module-3d-error">
              {preview.error}
            </p>
          ) : null}

          {preview.empty && !preview.error ? (
            <p className="catalog-empty" data-testid="module-3d-empty">
              Sin piezas para mostrar. Asigná una estructura con componentes o
              agregá componentes al mueble.
            </p>
          ) : null}

          {/* Unified 3D viewer with all controls */}
          {!preview.empty ? (
            <Furniture3DViewer
              parts={preview.parts}
              width={preview.width}
              height={preview.height}
              depth={preview.depth}
              testId="module-3d-viewer"
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}