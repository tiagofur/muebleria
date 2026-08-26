/**
 * Agregado 3D preview modal — read-only view of a sub-assembly in 3D,
 * with board-finish pickers for material preview (mirrors Structure3DModal / Module3DModal).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Agregado, OptionChoices } from '@granete/domain';
import { Modal, Furniture3DViewer } from '../../common';
import { materialColorMap, materialTextureMap } from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import {
  boardFinishPickerGroupsForModule,
  defaultOptionChoicesForModule,
} from '../../modules/moduleHelpers';
import { BoardFinishPickers } from '../../modules/components/BoardFinishPickers';
import { resolveAgregado3DPreview } from '../agregado3dPreview';
import { agregadoToDraft } from '../agregadoDraft';

export type Agregado3DModalProps = {
  readonly open: boolean;
  readonly agregado: Agregado | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
  /** Auth-aware media URL resolver for TextureLoader. */
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

export function Agregado3DModal({
  open,
  agregado,
  catalog,
  onClose,
  resolveMediaUrl,
}: Agregado3DModalProps): ReactNode {
  const [finishChoices, setFinishChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!agregado) {
      setFinishChoices({});
      return;
    }
    setFinishChoices(
      defaultOptionChoicesForModule(
        {
          components: agregado.components,
          hardwareLines: agregado.hardwareLines,
        },
        catalog.optionGroups,
        catalog.components,
        catalog.structures,
        catalog.agregados,
      ),
    );
  }, [agregado, catalog]);

  const finishGroups = useMemo(() => {
    if (!agregado) return [];
    return boardFinishPickerGroupsForModule(
      {
        components: agregado.components,
        hardwareLines: agregado.hardwareLines,
      },
      catalog.optionGroups,
      catalog.materials,
      catalog.components,
      catalog.structures,
      catalog.agregados,
    );
  }, [agregado, catalog]);

  const preview = useMemo(() => {
    if (!agregado) return null;
    const override: OptionChoices | null =
      Object.keys(finishChoices).length > 0 ? finishChoices : null;
    return resolveAgregado3DPreview(
      agregadoToDraft(agregado),
      catalog,
      override,
    );
  }, [agregado, catalog, finishChoices]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );

  const title = agregado
    ? `Vista 3D — ${agregado.code} - ${agregado.name}`
    : 'Vista 3D';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="fullscreen"
      dataTestId="agregado-3d-modal"
    >
      {agregado && preview ? (
        <div
          className="viewer-3d-modal-body"
          data-testid="agregado-3d-modal-body"
        >
          <BoardFinishPickers
            groups={finishGroups}
            choices={finishChoices}
            onChange={(groupCode, materialId) => {
              setFinishChoices((prev) => ({
                ...prev,
                [groupCode]: materialId,
              }));
            }}
            testId="agregado-3d-finishes"
          />

          {preview.error ? (
            <p className="catalog-form__error" data-testid="agregado-3d-error">
              {preview.error}
            </p>
          ) : null}

          {preview.empty && !preview.error ? (
            <p className="catalog-empty" data-testid="agregado-3d-empty">
              Sin piezas para mostrar en este agregado.
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
              testId="agregado-3d-viewer"
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
