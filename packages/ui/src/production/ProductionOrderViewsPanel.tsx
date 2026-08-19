/**
 * Production hub — planta + 3D read-only (PROD-0.4).
 * No layout mutation; orbit/pan/zoom only via scene controls.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module, Project } from '@muebles/domain';
import { buildProductionElevations } from '@muebles/domain';
import { canUseWebGL } from '../preview3d/webglSupport';
import {
  DEFAULT_MATERIAL_SURFACE_MODE,
  materialColorMap,
  materialTextureMap,
  type BoardColorMode,
  type MaterialSurfaceMode,
} from '../preview3d/boardPartVisual';
import { resolveProject3DPreview } from '../preview3d/project3dPreview';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import { PresentationKitchenPlanSlide } from '../projects/components/PresentationKitchenPlanSlide';
import { PaintModeField } from '../preview3d/PaintModeField';
import { MaterialSurfaceModeField } from '../preview3d/MaterialSurfaceModeField';
import { ProductionElevationPreview } from './ProductionElevationPreview';
import {
  FurnitureScene3D,
} from '../preview3d/FurnitureScene3D';
import { PageHeader } from '../common';
import '../common/furniture3dViewer.css';

export type ProductionOrderViewsPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly catalog: Module3DCatalogInput;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  readonly onExportElevations?: () => void | Promise<void>;
  readonly exportBusy?: boolean;
};

export function ProductionOrderViewsPanel({
  project,
  modules,
  catalog,
  resolveMediaUrl,
  onExportElevations,
  exportBusy = false,
}: ProductionOrderViewsPanelProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');
  const [surfaceMode, setSurfaceMode] = useState<MaterialSurfaceMode>(
    DEFAULT_MATERIAL_SURFACE_MODE,
  );
  const [showOutlines, setShowOutlines] = useState(true);

  useEffect(() => {
    setUseR3f(canUseWebGL());
  }, []);

  const preview = useMemo(
    () => resolveProject3DPreview(project, catalog),
    [project, catalog],
  );

  const elevations = useMemo(
    () => buildProductionElevations(project, modules),
    [project, modules],
  );

  const sceneWalls = useMemo(
    () =>
      preview.walls.map((w) => ({
        id: w.id,
        originXMm: w.originXMm,
        originYMm: w.originYMm,
        endXMm: w.endXMm,
        endYMm: w.endYMm,
        heightMm: 2400,
        wallMaterialId: w.wallMaterialId,
      })),
    [preview.walls],
  );

  const ambientFloor = useMemo(() => {
    const id = project.kitchenLayout?.floorMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, project.kitchenLayout?.floorMaterialId]);

  const ambientWall = useMemo(() => {
    const id = project.kitchenLayout?.wallMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, project.kitchenLayout?.wallMaterialId]);

  const ambientCeiling = useMemo(() => {
    const id = project.kitchenLayout?.ceilingMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, project.kitchenLayout?.ceilingMaterialId]);

  const ambientCountertop = useMemo(() => {
    const id = project.kitchenLayout?.countertopMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, project.kitchenLayout?.countertopMaterialId]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );

  return (
    <div className="prod-vistas" data-testid="prod-hub-vistas">
      <PageHeader
        headingLevel={3}
        title="Vistas de producción"
        subtitle="Planta, elevaciones y vista 3D de la obra aceptada."
        primaryAction={
          onExportElevations ? (
            <button
              type="button"
              className="btn"
              disabled={exportBusy || elevations.walls.length === 0}
              onClick={() => {
                void onExportElevations();
              }}
              data-testid="prod-vistas-export-elevations"
              title={
                elevations.walls.length === 0
                  ? 'Sin muros en el layout'
                  : 'PDF multi-página de elevaciones'
              }
            >
              Descargar PDF elevaciones
            </button>
          ) : undefined
        }
      />
      <section
        className="prod-vistas__section"
        aria-label="Planta de cocina"
        data-testid="prod-vistas-planta"
      >
        <h4 className="prod-hub__section-title">Planta</h4>
        <p className="prod-vistas__hint">
          Solo lectura — códigos y posiciones de la obra aceptada. Sin edición
          de muros ni placements.
        </p>
        <PresentationKitchenPlanSlide project={project} modules={modules} />
      </section>

      <section
        className="prod-vistas__section"
        aria-label="Elevaciones por muro"
        data-testid="prod-vistas-elevaciones"
      >
        <h4 className="prod-hub__section-title">Elevaciones por muro</h4>
        <p className="prod-vistas__hint">
          Alzado frontal con códigos y anchos. Sin inventar posiciones para
          módulos sin colocar.
        </p>
        {elevations.walls.length === 0 ? (
          <p className="prod-hub__placeholder-body">
            No hay muros en el layout. Definí el plano en cotización (Proyectar)
            para generar elevaciones.
          </p>
        ) : (
          <div className="prod-vistas__elev-list">
            {elevations.walls.map((wall) => (
              <ProductionElevationPreview key={wall.wallId} wall={wall} />
            ))}
          </div>
        )}
        {elevations.unplaced.length > 0 ? (
          <p className="prod-vistas__hint" data-testid="prod-elev-unplaced">
            Sin colocar: {elevations.unplaced.map((u) => u.label).join(', ')}
          </p>
        ) : null}
        {elevations.freePlace.length > 0 ? (
          <p className="prod-vistas__hint" data-testid="prod-elev-free">
            Libre / isla (no en alzado de muro):{' '}
            {elevations.freePlace.map((u) => u.label).join(', ')}
          </p>
        ) : null}
      </section>

      <section
        className="prod-vistas__section prod-vistas__section--3d"
        aria-label="Vista 3D de la obra"
        data-testid="prod-vistas-3d"
      >
        <h4 className="prod-hub__section-title">Vista 3D</h4>
        <p className="prod-vistas__hint">
          Orbitá y hacé zoom para entender el armado. No hay herramientas de
          diseño ni arrastre de muebles.
        </p>

        {!preview.empty && preview.modules.length > 0 ? (
          <p className="prod-vistas__run-hint" data-testid="prod-vistas-3d-hint">
            {preview.layoutMode === 'kitchen'
              ? `Según plano (${preview.placedCount} colocad${
                  preview.placedCount === 1 ? 'a' : 'as'
                }${
                  preview.unplacedCount > 0
                    ? `, ${preview.unplacedCount} sin colocar al final`
                    : ''
                }).`
              : `Corrida lineal (${preview.modules.length} unidad${
                  preview.modules.length === 1 ? '' : 'es'
                }).`}
          </p>
        ) : null}

        <div className="viewer-3d-chrome">
          <label className="furniture-3d-viewer__check">
            <input
              type="checkbox"
              checked={showOutlines}
              onChange={(e) => setShowOutlines(e.target.checked)}
              data-testid="prod-vistas-outlines"
            />
            Contornos
          </label>
          <div className="catalog-form__field">
            <PaintModeField
              id="prod-vistas-paint-mode"
              value={colorMode}
              onChange={setColorMode}
              testId="prod-vistas-paint-mode"
            />
          </div>
          <div className="catalog-form__field">
            <MaterialSurfaceModeField
              id="prod-vistas-surface-mode"
              value={surfaceMode}
              onChange={setSurfaceMode}
              testId="prod-vistas-surface-mode"
              visible={colorMode === 'material'}
            />
          </div>
        </div>

        {preview.errors.length > 0 ? (
          <ul className="catalog-form__error" data-testid="prod-vistas-3d-errors">
            {preview.errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        ) : null}

        {preview.empty ? (
          <p className="catalog-empty" data-testid="prod-vistas-3d-empty">
            Sin piezas para mostrar en 3D. Revisá estructura y componentes de
            los muebles en ingeniería.
          </p>
        ) : useR3f ? (
          <div className="prod-vistas__scene" data-testid="prod-vistas-scene">
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
                showCountertop: m.showCountertop,
                showOuterGhost: true,
                resolvedHardwarePlacements: m.resolvedHardwarePlacements,
              }))}
              walls={sceneWalls}
              totalWidth={preview.totalWidth}
              totalHeight={preview.totalHeight}
              totalDepth={preview.totalDepth}
              showFloor
              testId="prod-scene-3d"
              colorMode={colorMode}
              materialColors={materialColors}
              materialTextures={materialTextures}
              surfaceMode={surfaceMode}
              showOutlines={showOutlines}
              hardwareCatalog={catalog.hardware}
              ambientFloor={ambientFloor}
              ambientWall={ambientWall}
              ambientCeiling={ambientCeiling}
              ambientCountertop={ambientCountertop}
              availableAmbientMaterials={catalog.ambientMaterials}
              showCeiling={project.kitchenLayout?.showCeiling}
            />
          </div>
        ) : (
          <p className="catalog-empty" data-testid="prod-vistas-webgl-required">
            WebGL no disponible en este navegador — la planta 2D sigue siendo
            usable arriba.
          </p>
        )}
      </section>

    </div>
  );
}
