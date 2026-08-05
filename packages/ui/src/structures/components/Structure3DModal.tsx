/**
 * Structure 3D preview modal — read-only view of a structure as resolved board
 * parts, without opening the editor. Mirrors Module3DModal: preset selector,
 * error/empty states, and the unified Furniture3DViewer.
 *
 * Resolution reuses resolveStructure3DPreview (the same helper the editor's 3D
 * tab uses) via structureToDraft, so the read-only view never drifts from the
 * editor's geometry.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Structure } from '@muebles/domain';
import { Modal, Furniture3DViewer } from '../../common';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveStructure3DPreview } from '../structure3dPreview';
import { structureToDraft } from '../structureDraft';

export type Structure3DModalProps = {
  readonly open: boolean;
  readonly structure: Structure | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
};

export function Structure3DModal({
  open,
  structure,
  catalog,
  onClose,
}: Structure3DModalProps): ReactNode {
  const [presetId, setPresetId] = useState<string>('');

  useEffect(() => {
    if (!structure) {
      setPresetId('');
      return;
    }
    const first = structure.presets?.[0]?.id ?? '';
    setPresetId(first);
  }, [structure]);

  const preview = useMemo(() => {
    if (!structure) return null;
    return resolveStructure3DPreview(
      structureToDraft(structure),
      catalog,
      presetId || undefined,
    );
  }, [structure, catalog, presetId]);

  const title = structure
    ? `Vista 3D — ${structure.code} - ${structure.name}`
    : 'Vista 3D';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="fullscreen"
      dataTestId="structure-3d-modal"
    >
      {structure && preview ? (
        <div data-testid="structure-3d-modal-body">
          {preview.presets.length > 0 ? (
            <div className="catalog-form__field" style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="structure-3d-preset">Medida (preset)</label>
              <select
                id="structure-3d-preset"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                data-testid="structure-3d-preset-select"
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

          {preview.error ? (
            <p className="catalog-form__error" data-testid="structure-3d-error">
              {preview.error}
            </p>
          ) : null}

          {preview.empty && !preview.error ? (
            <p className="catalog-empty" data-testid="structure-3d-empty">
              Sin piezas para mostrar. Asigná componentes a la estructura para
              verla en 3D.
            </p>
          ) : null}

          {!preview.empty ? (
            <Furniture3DViewer
              parts={preview.parts}
              width={preview.width}
              height={preview.height}
              depth={preview.depth}
              testId="structure-3d-viewer"
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
