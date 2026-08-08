/**
 * Structure 3D preview modal — read-only view of a structure as resolved board
 * parts, with board-finish pickers for material preview (same as Module3DModal).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OptionChoices, Structure } from '@muebles/domain';
import { Modal, Furniture3DViewer } from '../../common';
import { materialColorMap, materialPhysicalMap, materialTextureMap } from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import {
  boardFinishPickerGroupsForModule,
  defaultOptionChoicesForModule,
} from '../../modules/moduleHelpers';
import { BoardFinishPickers } from '../../modules/components/BoardFinishPickers';
import { resolveStructure3DPreview } from '../structure3dPreview';
import { structureToDraft } from '../structureDraft';

export type Structure3DModalProps = {
  readonly open: boolean;
  readonly structure: Structure | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
  /** Auth-aware media URL resolver for TextureLoader. */
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

export function Structure3DModal({
  open,
  structure,
  catalog,
  onClose,
  resolveMediaUrl,
}: Structure3DModalProps): ReactNode {
  const [presetId, setPresetId] = useState<string>('');
  const [finishChoices, setFinishChoices] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (!structure) {
      setPresetId('');
      setFinishChoices({});
      return;
    }
    const first = structure.presets?.[0]?.id ?? '';
    setPresetId(first);
    setFinishChoices(
      defaultOptionChoicesForModule(
        {
          components: structure.components,
          hardwareLines: [],
        },
        catalog.optionGroups,
        catalog.components,
      ),
    );
  }, [structure, catalog.optionGroups, catalog.components]);

  const finishGroups = useMemo(() => {
    if (!structure) return [];
    return boardFinishPickerGroupsForModule(
      {
        components: structure.components,
        hardwareLines: [],
      },
      catalog.optionGroups,
      catalog.materials,
      catalog.components,
    );
  }, [structure, catalog]);

  const preview = useMemo(() => {
    if (!structure) return null;
    const override: OptionChoices | null =
      Object.keys(finishChoices).length > 0 ? finishChoices : null;
    return resolveStructure3DPreview(
      structureToDraft(structure),
      catalog,
      presetId || undefined,
      override,
    );
  }, [structure, catalog, presetId, finishChoices]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );
  const materialPhysical = useMemo(
    () => materialPhysicalMap(catalog.materials),
    [catalog.materials],
  );

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
        <div
          className="viewer-3d-modal-body"
          data-testid="structure-3d-modal-body"
        >
          {preview.presets.length > 0 ? (
            <div className="viewer-3d-chrome">
              <div className="catalog-form__field">
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
            testId="structure-3d-finishes"
          />

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
              materialColors={materialColors}
              materialTextures={materialTextures}
              materialPhysical={materialPhysical}
              paintModeHint="Los selectores de acabado de arriba eligen el material de cada grupo. Este control solo cambia cómo se colorea la vista."
              testId="structure-3d-viewer"
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
