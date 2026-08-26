/**
 * Production hub — planta + 3D read-only (PROD-0.4).
 * No layout mutation; orbit/pan/zoom only via scene controls.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Module, Project } from '@granete/domain';
import {
  buildProductionElevations,
  groupProductionElevationsBySpace,
  listProductionSpaceOptions,
  projectScopedToProductionSpace,
  unplacedItemIdsForProduction,
} from '@granete/domain';
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
import { ProductionIslandPreview } from './ProductionIslandPreview';
import {
  FurnitureScene3D,
} from '../preview3d/FurnitureScene3D';
import { PageHeader } from '../common';
import { WorkspaceTabs } from '../common/Tabs';
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

  // #256: kitchenLayout top-level only mirrors the ACTIVE space, while
  // project.items carries the whole obra — resolving 3D against it mixes walls
  // of one ambiente with a ghost linear tail of the others. With "Toda la
  // obra", the panel owns ambient tabs and resolves planta + 3D per space via
  // the domain scope filter (the hub filter already narrows a single space).
  const spaceOptions = useMemo(
    () => listProductionSpaceOptions(project),
    [project],
  );
  const [viewsSpaceId, setViewsSpaceId] = useState<string | null>(null);
  const activeSpaceId = useMemo((): string | undefined => {
    if (spaceOptions.length === 0) return undefined;
    const layoutActive = project.kitchenLayout?.activeSpaceId;
    return (
      spaceOptions.find((s) => s.id === viewsSpaceId)?.id ??
      spaceOptions.find((s) => s.id === layoutActive)?.id ??
      spaceOptions[0]!.id
    );
  }, [spaceOptions, viewsSpaceId, project.kitchenLayout?.activeSpaceId]);
  const activeSpaceName = activeSpaceId
    ? spaceOptions.find((s) => s.id === activeSpaceId)?.name
    : undefined;

  const previewProject = useMemo(
    () =>
      activeSpaceId
        ? projectScopedToProductionSpace(project, activeSpaceId)
        : project,
    [project, activeSpaceId],
  );

  const preview = useMemo(
    () => resolveProject3DPreview(previewProject, catalog),
    [previewProject, catalog],
  );

  // Per-space scoping hides truly-unplaced items from every 3D view; surface
  // the obra-wide count explicitly instead of rendering a ghost tail (#256).
  const unplacedAnywhereCount = useMemo(
    () => (activeSpaceId ? unplacedItemIdsForProduction(project).size : 0),
    [activeSpaceId, project],
  );

  const elevations = useMemo(
    () => buildProductionElevations(project, modules),
    [project, modules],
  );

  // #254: elevaciones e islas agrupadas por ambiente cuando la obra es
  // multi-ambiente (mono-ambiente renderiza plano, sin headings extra).
  const elevationGroups = useMemo(
    () => groupProductionElevationsBySpace(elevations),
    [elevations],
  );
  const groupedElevations = elevationGroups.length > 1;
  const wallGroups = useMemo(
    () =>
      groupedElevations
        ? elevationGroups.filter((g) => g.walls.length > 0)
        : [],
    [groupedElevations, elevationGroups],
  );
  const islandGroups = useMemo(
    () =>
      groupedElevations
        ? elevationGroups.filter((g) => g.islands.length > 0)
        : [],
    [groupedElevations, elevationGroups],
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
        secondaryActions={
          onExportElevations ? (
            <button
              type="button"
              className="btn"
              disabled={
                exportBusy ||
                (elevations.walls.length === 0 && elevations.islands.length === 0)
              }
              onClick={() => {
                void onExportElevations();
              }}
              data-testid="prod-vistas-export-elevations"
              title={
                elevations.walls.length === 0 && elevations.islands.length === 0
                  ? 'Sin muros ni islas en el layout'
                  : 'PDF multi-página de elevaciones y fichas de isla'
              }
            >
              Descargar PDF elevaciones
            </button>
          ) : undefined
        }
      />
      {activeSpaceId ? (
        <WorkspaceTabs
          tabs={spaceOptions.map((s) => ({ id: s.id, label: s.name }))}
          activeTab={activeSpaceId}
          onTabChange={setViewsSpaceId}
          ariaLabel="Ambiente de las vistas de producción"
          idPrefix="prod-vistas-space"
          testIdPrefix="prod-vistas-space"
        />
      ) : null}
      <div
        className="prod-vistas__content"
        role={activeSpaceId ? 'tabpanel' : undefined}
        id={
          activeSpaceId ? `prod-vistas-space-panel-${activeSpaceId}` : undefined
        }
        aria-labelledby={
          activeSpaceId
            ? `prod-vistas-space-tab-${activeSpaceId}`
            : undefined
        }
      >
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
        <PresentationKitchenPlanSlide
          project={project}
          modules={modules}
          selectedSpaceId={activeSpaceId}
          onSelectedSpaceIdChange={
            activeSpaceId ? setViewsSpaceId : undefined
          }
        />
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
        ) : groupedElevations ? (
          <div className="prod-vistas__elev-groups" data-testid="prod-elev-groups">
            {wallGroups.map((group) => (
              <div
                key={group.spaceId}
                className="prod-vistas__elev-group"
                data-testid={`prod-elev-group-${group.spaceId}`}
              >
                <h5 className="prod-vistas__group-title">{group.spaceName}</h5>
                <div className="prod-vistas__elev-list">
                  {group.walls.map((wall) => (
                    <ProductionElevationPreview key={wall.wallId} wall={wall} />
                  ))}
                </div>
              </div>
            ))}
          </div>
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
      </section>

      {elevations.islands.length > 0 ? (
        <section
          className="prod-vistas__section"
          aria-label="Fichas de islas"
          data-testid="prod-vistas-islands"
        >
          <h4 className="prod-hub__section-title">Islas (libres)</h4>
          <p className="prod-vistas__hint">
            Ubicación libre en planta — no se proyectan en alzados de muro. Cada
            isla tiene su ficha con medidas y posición.
          </p>
          {groupedElevations ? (
            <div className="prod-vistas__elev-groups" data-testid="prod-island-groups">
              {islandGroups.map((group) => (
                <div
                  key={group.spaceId}
                  className="prod-vistas__elev-group"
                  data-testid={`prod-island-group-${group.spaceId}`}
                >
                  <h5 className="prod-vistas__group-title">{group.spaceName}</h5>
                  <div className="prod-vistas__island-list">
                    {group.islands.map((island) => (
                      <ProductionIslandPreview
                        key={`${island.spaceId}-${island.itemId}-${island.instanceIndex}`}
                        island={island}
                        showSpace={false}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="prod-vistas__island-list">
              {elevations.islands.map((island) => (
                <ProductionIslandPreview
                  key={`${island.spaceId}-${island.itemId}-${island.instanceIndex}`}
                  island={island}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

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
              ? `Según plano${
                  activeSpaceName ? ` de ${activeSpaceName}` : ''
                } (${preview.placedCount} colocad${
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

        {unplacedAnywhereCount > 0 ? (
          <p className="prod-vistas__hint" data-testid="prod-vistas-3d-unplaced">
            {unplacedAnywhereCount} unidad
            {unplacedAnywhereCount === 1 ? '' : 'es'} de la cotización sin
            colocar en ninguna planta — no aparecen en esta vista 3D.
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

    </div>
  );
}
