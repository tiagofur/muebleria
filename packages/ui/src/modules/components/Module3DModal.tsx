/**
 * Module 3D preview modal — BOM from components + optional measure preset
 * and interactive board-finish (option group) pickers for material preview.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module, OptionChoices } from '@muebles/domain';
import { Modal } from '../../common';
import { Furniture3DViewer } from '../../common';
import { materialColorMap, materialTextureMap } from '../../preview3d';
import {
  resolveModule3DPreview,
  type Module3DCatalogInput,
} from '../module3dPreview';
import {
  boardFinishPickerGroupsForModule,
  defaultOptionChoicesForModule,
} from '../moduleHelpers';
import { BoardFinishPickers } from './BoardFinishPickers';

export type Module3DModalProps = {
  readonly open: boolean;
  readonly module: Module | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
  /** Auth-aware media URL resolver for TextureLoader. */
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

export function Module3DModal({
  open,
  module,
  catalog,
  onClose,
  resolveMediaUrl,
}: Module3DModalProps): ReactNode {
  const [presetId, setPresetId] = useState<string>('');
  const [finishChoices, setFinishChoices] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (!module) {
      setPresetId('');
      setFinishChoices({});
      return;
    }
    const first = module.presets?.[0]?.id ?? '';
    setPresetId(first);
    setFinishChoices(
      defaultOptionChoicesForModule(
        module,
        catalog.optionGroups,
        catalog.components,
        catalog.structures,
      ),
    );
  }, [module, catalog.optionGroups, catalog.components, catalog.structures]);

  const finishGroups = useMemo(() => {
    if (!module) return [];
    return boardFinishPickerGroupsForModule(
      module,
      catalog.optionGroups,
      catalog.materials,
      catalog.components,
      catalog.structures,
    );
  }, [module, catalog]);

  const preview = useMemo(() => {
    if (!module) return null;
    const override: OptionChoices | null =
      Object.keys(finishChoices).length > 0 ? finishChoices : null;
    return resolveModule3DPreview(
      module,
      catalog,
      presetId || undefined,
      override,
    );
  }, [module, catalog, presetId, finishChoices]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );

  const title = module
    ? `Vista 3D — ${module.code} - ${module.name}`
    : 'Vista 3D';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="fullscreen"
      dataTestId="module-3d-modal"
    >
      {module && preview ? (
        <div
          className="viewer-3d-modal-body"
          data-testid="module-3d-modal-body"
        >
          {preview.presets.length > 0 ? (
            <div className="viewer-3d-chrome">
              <div className="catalog-form__field">
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
            </div>
          ) : null}

          <BoardFinishPickers
            groups={finishGroups}
            choices={finishChoices}
            onChange={(groupCode, materialId) => {
              setFinishChoices((prev) => ({
                ...prev,
                [groupCode]: materialId,
              }));
            }}
            testId="module-3d-finishes"
          />

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
            <Furniture3DViewer
              parts={preview.parts}
              width={preview.width}
              height={preview.height}
              depth={preview.depth}
              materialColors={materialColors}
              materialTextures={materialTextures}
              paintModeHint="Los selectores de acabado de arriba eligen el material de cada grupo. Este control solo cambia cómo se colorea la vista."
              testId="module-3d-viewer"
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
