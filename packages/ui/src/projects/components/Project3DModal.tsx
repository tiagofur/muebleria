/**
 * Project / quote 3D modal — linear kitchen run of line items.
 * Uses FurnitureScene3D (R3F) only. No CSS fallback.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module, Project, ProjectItem } from '@muebles/domain';
import { Modal } from '../../common';
import {
  FurnitureScene3D,
  PaintModeField,
  MaterialSurfaceModeField,
  canUseWebGL,
  materialColorMap,
  materialTextureMap,
  DEFAULT_MATERIAL_SURFACE_MODE,
  type BoardColorMode,
  type MaterialSurfaceMode,
} from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';
import '../../common/furniture3dViewer.css';

export type Project3DModalProps = {
  readonly open: boolean;
  readonly project: Project | null;
  readonly catalog: Module3DCatalogInput;
  readonly onClose: () => void;
  /**
   * When set with its module, preview only that line (still uses project choices).
   * When null, preview the whole quote run.
   */
  readonly focus?: { item: ProjectItem; module: Module } | null;
  /** Auth-aware media URL resolver for TextureLoader. */
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

export function Project3DModal({
  open,
  project,
  catalog,
  onClose,
  focus = null,
  resolveMediaUrl,
}: Project3DModalProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');
  const [surfaceMode, setSurfaceMode] = useState<MaterialSurfaceMode>(
    DEFAULT_MATERIAL_SURFACE_MODE,
  );
  const [showOutlines, setShowOutlines] = useState(true);

  useEffect(() => {
    if (!open) return;
    setUseR3f(canUseWebGL());
  }, [open]);

  const preview = useMemo(() => {
    if (!project) return null;
    return resolveProject3DPreview(project, catalog, {
      itemId: focus?.item.id,
    });
  }, [project, catalog, focus?.item.id]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );

  const title = !project
    ? 'Vista 3D'
    : focus
      ? `Vista 3D — ${focus.module.code} - ${focus.module.name}`
      : `Vista 3D cotización — ${project.name}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="fullscreen"
      dataTestId="project-3d-modal"
    >
      {project && preview ? (
        <div
          className="viewer-3d-modal-body"
          data-testid="project-3d-modal-body"
        >
          {!focus && preview.modules.length > 0 ? (
            <p className="catalog-empty" data-testid="project-3d-run-hint">
              {preview.layoutMode === 'kitchen'
                ? `Según plano de cocina (${preview.placedCount} colocad${preview.placedCount === 1 ? 'a' : 'as'}${
                    preview.unplacedCount > 0
                      ? `, ${preview.unplacedCount} sin colocar al final`
                      : ''
                  }).`
                : `Vista en línea de la cotización (${preview.modules.length} unidad${
                    preview.modules.length === 1 ? '' : 'es'
                  }). Abrí «Plan de cocina» en Herramientas para armar L/U.`}
            </p>
          ) : null}

          <div className="viewer-3d-chrome">
            <label className="furniture-3d-viewer__check">
              <input
                type="checkbox"
                checked={showOutlines}
                onChange={(e) => setShowOutlines(e.target.checked)}
                data-testid="project-3d-outlines-checkbox"
              />
              Contornos
            </label>
            <div className="catalog-form__field">
              <PaintModeField
                id="project-3d-color-mode"
                value={colorMode}
                onChange={setColorMode}
                testId="project-3d-color-mode"
                hint="Los acabados (blanco, maderado…) vienen de las opciones de cada línea de la cotización. Acá solo elegís cómo se pintan: material real o colores por rol de taller."
              />
            </div>
            <div className="catalog-form__field">
              <MaterialSurfaceModeField
                id="project-3d-surface-mode"
                value={surfaceMode}
                onChange={setSurfaceMode}
                testId="project-3d-surface-mode"
                visible={colorMode === 'material'}
              />
            </div>
          </div>

          {preview.errors.length > 0 ? (
            <ul className="catalog-form__error" data-testid="project-3d-errors">
              {preview.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : null}

          {preview.empty ? (
            <p className="catalog-empty" data-testid="project-3d-empty">
              Sin piezas para mostrar. Revisá que los muebles tengan estructura
              y componentes.
            </p>
          ) : useR3f ? (
            <FurnitureScene3D
              modules={preview.modules.map((m) => ({
                key: m.instanceKey,
                parts: m.parts,
                width: m.width,
                height: m.height,
                depth: m.depth,
                originX: m.originX,
                originY: m.originY,
                originZ: m.originZ,
                yawDeg: m.yawDeg,
                baseClearanceMm: m.baseClearanceMm,
                showOuterGhost: true,
              }))}
              totalWidth={preview.totalWidth}
              totalHeight={preview.totalHeight}
              totalDepth={preview.totalDepth}
              showFloor
              testId="project-scene-3d"
              colorMode={colorMode}
              materialColors={materialColors}
              materialTextures={materialTextures}
              surfaceMode={surfaceMode}
              showOutlines={showOutlines}
            />
          ) : (
            <div
              className="catalog-empty"
              style={{
                padding: '2rem',
                textAlign: 'center',
                background: 'var(--surface-hover)',
                border: '1px solid var(--error-500)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--error-700)',
              }}
              data-testid="project-3d-webgl-required"
            >
              <h4>⚠️ WebGL requerido</h4>
              <p>
                La vista 3D de la cotización completa necesita WebGL
                (Three.js / React Three Fiber).
              </p>
              <ul style={{ textAlign: 'left', maxWidth: '400px', margin: '1rem auto' }}>
                <li>Verificá que el navegador tenga WebGL habilitado</li>
                <li>En Firefox: <code>about:config</code> → <code>webgl.disabled = false</code></li>
                <li>En Chrome/Edge: <code>chrome://flags</code> → buscá "WebGL"</li>
                <li>Algunas extensiones de privacidad/seguridad bloquean <code>canvas.getContext('webgl')</code></li>
                <li>CSP estricta puede impedir canvas 3D</li>
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}