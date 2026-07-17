/**
 * Module 3D preview modal — BOM from components + optional measure preset.
 * Prefers React Three Fiber; falls back to CSS Part3DViewer without WebGL.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module } from '@muebles/domain';
import { Modal, Part3DViewer } from '../../common';
import {
  ModuleScene3D,
  canUseWebGL,
  materialColorMap,
  type BoardColorMode,
} from '../../preview3d';
import {
  resolveModule3DPreview,
  type Module3DCatalogInput,
} from '../module3dPreview';

export type Module3DModalProps = {
  readonly open: boolean;
  readonly module: Module | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
  /** Force CSS viewer (tests / low-end). Default: WebGL when available. */
  readonly forceCssViewer?: boolean;
};

export function Module3DModal({
  open,
  module,
  catalog,
  onClose,
  forceCssViewer = false,
}: Module3DModalProps): ReactNode {
  const [presetId, setPresetId] = useState<string>('');
  const [useR3f, setUseR3f] = useState(false);
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');

  useEffect(() => {
    if (!module) {
      setPresetId('');
      return;
    }
    const first = module.presets?.[0]?.id ?? '';
    setPresetId(first);
  }, [module]);

  useEffect(() => {
    if (!open) return;
    setUseR3f(!forceCssViewer && canUseWebGL());
  }, [open, forceCssViewer]);

  const preview = useMemo(() => {
    if (!module) return null;
    return resolveModule3DPreview(module, catalog, presetId || undefined);
  }, [module, catalog, presetId]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );

  const title = module
    ? `Vista 3D — ${module.code} - ${module.name}`
    : 'Vista 3D';

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {module && preview ? (
        <div data-testid="module-3d-modal-body">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '0.75rem',
              alignItems: 'flex-end',
            }}
          >
            {preview.presets.length > 0 ? (
              <div className="catalog-form__field" style={{ marginBottom: 0 }}>
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
            <div className="catalog-form__field" style={{ marginBottom: 0 }}>
              <label htmlFor="module-3d-color-mode">Colores</label>
              <select
                id="module-3d-color-mode"
                value={colorMode}
                onChange={(e) =>
                  setColorMode(e.target.value as BoardColorMode)
                }
                data-testid="module-3d-color-mode"
              >
                <option value="material">Material (rápido)</option>
                <option value="role">Por rol (taller)</option>
              </select>
            </div>
          </div>

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

          {!preview.empty ? (
            useR3f ? (
              <ModuleScene3D
                parts={preview.parts}
                width={preview.width}
                height={preview.height}
                depth={preview.depth}
                colorMode={colorMode}
                materialColors={materialColors}
              />
            ) : (
              <Part3DViewer
                parts={preview.parts}
                width={preview.width}
                height={preview.height}
                depth={preview.depth}
              />
            )
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
