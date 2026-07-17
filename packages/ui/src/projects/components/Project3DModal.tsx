/**
 * Project / quote 3D modal — linear kitchen run of line items.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module, Project, ProjectItem } from '@muebles/domain';
import { Modal, Part3DViewer } from '../../common';
import {
  FurnitureScene3D,
  canUseWebGL,
  materialColorMap,
  type BoardColorMode,
} from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';

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
  readonly forceCssViewer?: boolean;
};

export function Project3DModal({
  open,
  project,
  catalog,
  onClose,
  focus = null,
  forceCssViewer = false,
}: Project3DModalProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');

  useEffect(() => {
    if (!open) return;
    setUseR3f(!forceCssViewer && canUseWebGL());
  }, [open, forceCssViewer]);

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

  const title = !project
    ? 'Vista 3D'
    : focus
      ? `Vista 3D — ${focus.module.code} - ${focus.module.name}`
      : `Vista 3D cotización — ${project.name}`;

  const cssFallback =
    preview && preview.modules.length === 1
      ? preview.modules[0]
      : preview?.modules.find((m) => m.parts.length > 0) ?? null;

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {project && preview ? (
        <div data-testid="project-3d-modal-body">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '0.75rem',
              alignItems: 'flex-end',
            }}
          >
            {!focus && preview.modules.length > 1 ? (
              <p
                className="catalog-empty"
                style={{ margin: 0, flex: '1 1 100%' }}
                data-testid="project-3d-run-hint"
              >
                Vista en línea de la cotización ({preview.modules.length}{' '}
                unidades). Colocación en L/isla llega en un siguiente paso.
              </p>
            ) : null}
            <div className="catalog-form__field" style={{ marginBottom: 0 }}>
              <label htmlFor="project-3d-color-mode">Colores</label>
              <select
                id="project-3d-color-mode"
                value={colorMode}
                onChange={(e) =>
                  setColorMode(e.target.value as BoardColorMode)
                }
                data-testid="project-3d-color-mode"
              >
                <option value="material">Material (rápido)</option>
                <option value="role">Por rol (taller)</option>
              </select>
            </div>
          </div>

          {preview.errors.length > 0 ? (
            <ul
              className="catalog-form__error"
              data-testid="project-3d-errors"
              style={{ listStyle: 'disc', paddingLeft: '1.25rem' }}
            >
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
                showOuterGhost: true,
              }))}
              totalWidth={preview.totalWidth}
              totalHeight={preview.totalHeight}
              totalDepth={preview.totalDepth}
              showFloor
              testId="project-scene-3d"
              colorMode={colorMode}
              materialColors={materialColors}
            />
          ) : preview.modules.length > 1 ? (
            <p
              className="catalog-empty"
              data-testid="project-3d-webgl-required"
            >
              La corrida multi-módulo necesita WebGL. Activá la aceleración
              gráfica o abrí un solo mueble para la vista simple.
            </p>
          ) : cssFallback ? (
            <Part3DViewer
              parts={cssFallback.parts}
              width={cssFallback.width}
              height={cssFallback.height}
              depth={cssFallback.depth}
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
