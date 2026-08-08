/**
 * Module 3D preview modal — BOM from components + optional measure preset
 * and interactive board-finish (option group) pickers for material preview.
 * Slice 1: capture 3/4 textured still as catalog photo (imageUrl).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Module, OptionChoices } from '@muebles/domain';
import { Modal } from '../../common';
import { Furniture3DViewer } from '../../common';
import {
  captureScenePngFile,
  downloadPngFile,
  materialColorMap,
  materialTextureMap,
} from '../../preview3d';
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
  /**
   * Upload PNG as catalog media (F040). When set with onApplyCatalogImage,
   * "Usar como foto" persists to the module.
   */
  readonly onUploadImage?: (file: File) => Promise<string>;
  /**
   * Persist uploaded media URL as module.imageUrl (caller runs onUpdate).
   */
  readonly onApplyCatalogImage?: (
    moduleId: string,
    imageUrl: string,
  ) => void | Promise<void>;
  /** Hide mutate actions when read-only. Default true when upload/apply present. */
  readonly canMutate?: boolean;
};

function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = Math.max(count, 1);
    const step = () => {
      left -= 1;
      if (left <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function Module3DModal({
  open,
  module,
  catalog,
  onClose,
  resolveMediaUrl,
  onUploadImage,
  onApplyCatalogImage,
  canMutate = true,
}: Module3DModalProps): ReactNode {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [presetId, setPresetId] = useState<string>('');
  const [finishChoices, setFinishChoices] = useState<Record<string, string>>(
    {},
  );
  const [catalogPhotoViewToken, setCatalogPhotoViewToken] = useState(0);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (!module) {
      setPresetId('');
      setFinishChoices({});
      setCatalogPhotoViewToken(0);
      setCaptureMessage(null);
      setCaptureError(null);
      setCaptureBusy(false);
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
    setCaptureMessage(null);
    setCaptureError(null);
    // Default open framing: catalog 3/4 presentation view.
    setCatalogPhotoViewToken((t) => t + 1);
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

  const canSaveAsCatalogPhoto = Boolean(
    canMutate && onUploadImage && onApplyCatalogImage && module,
  );

  const handleCatalogPhoto = useCallback(async () => {
    if (!module || captureBusy) return;
    setCaptureBusy(true);
    setCaptureError(null);
    setCaptureMessage(null);
    try {
      // Force 3/4 + texture + catalog product shot (no axes/outlines/ghost),
      // then wait for frames so camera/materials settle before capture.
      setCatalogPhotoViewToken((t) => t + 1);
      await waitFrames(4);
      await delay(420);

      const baseName = `${module.code}-${module.name}`;
      const file = await captureScenePngFile(bodyRef.current, baseName);

      if (canSaveAsCatalogPhoto && onUploadImage && onApplyCatalogImage) {
        const url = await onUploadImage(file);
        await onApplyCatalogImage(module.id, url);
        setCaptureMessage('Foto del mueble actualizada desde la vista 3D.');
      } else {
        downloadPngFile(file);
        setCaptureMessage('Imagen PNG descargada (vista 3D).');
      }
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? err.message
          : 'No se pudo generar la imagen 3D.',
      );
    } finally {
      setCaptureBusy(false);
    }
  }, [
    module,
    captureBusy,
    canSaveAsCatalogPhoto,
    onUploadImage,
    onApplyCatalogImage,
  ]);

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
          ref={bodyRef}
          className="viewer-3d-modal-body"
          data-testid="module-3d-modal-body"
        >
          <div className="viewer-3d-chrome">
            {preview.presets.length > 0 ? (
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
            ) : null}

            {!preview.empty ? (
              <div className="viewer-3d-chrome__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    void handleCatalogPhoto();
                  }}
                  disabled={captureBusy}
                  data-testid="module-3d-catalog-photo"
                  title={
                    canSaveAsCatalogPhoto
                      ? 'Captura 3/4 limpia (textura, sin ejes ni contornos) y la guarda como foto de vitrina'
                      : 'Descarga un PNG de la vista 3/4 limpia (textura, sin ejes ni contornos)'
                  }
                >
                  {captureBusy
                    ? 'Generando…'
                    : canSaveAsCatalogPhoto
                      ? 'Usar como foto del mueble'
                      : 'Descargar imagen 3D'}
                </button>
              </div>
            ) : null}
          </div>

          {captureMessage ? (
            <p
              className="module-editor__hint"
              data-testid="module-3d-catalog-photo-ok"
              role="status"
            >
              {captureMessage}
            </p>
          ) : null}
          {captureError ? (
            <p
              className="catalog-form__error"
              data-testid="module-3d-catalog-photo-error"
              role="alert"
            >
              {captureError}
            </p>
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
              lightingMode="catalog"
              initialSurfaceMode="texture"
              initialShowOutlines={false}
              catalogPhotoViewToken={catalogPhotoViewToken}
              paintModeHint="Los selectores de acabado de arriba eligen el material de cada grupo. Este control solo cambia cómo se colorea la vista. La foto de vitrina se captura sin contornos ni ejes."
              testId="module-3d-viewer"
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
