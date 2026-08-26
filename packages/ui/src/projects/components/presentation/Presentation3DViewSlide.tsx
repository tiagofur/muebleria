/**
 * Slide 3 (Vista 3D) for ProjectPresentationMode.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import type { AmbientMaterial, Project } from '@granete/domain';
import {
  Box,
  Camera,
  Download,
  Link2,
  Palette,
  Ruler,
  Settings2,
} from 'lucide-react';
import { EmptyState } from '../../../common';
import type {
  BoardColorMode,
  MaterialSurfaceMode,
  MaterialTextureEntry,
  ModelFormat,
} from '../../../preview3d';
import type { Project3DPreviewResult, ProjectModule3DInstance } from '../../../preview3d/project3dPreview';
import type { Module3DCatalogInput } from '../../../modules/module3dPreview';

// Lazy-load the heavy R3F scene
const FurnitureScene3D = lazy(() =>
  import('../../../preview3d').then((m) => ({ default: m.FurnitureScene3D })),
);

export interface Presentation3DViewSlideProps {
  readonly project: Project;
  readonly presentationProject: Project;
  readonly catalog: Module3DCatalogInput;
  readonly preview: Project3DPreviewResult;
  readonly useR3f: boolean;
  readonly surfaceMode: MaterialSurfaceMode;
  readonly setSurfaceMode: (mode: MaterialSurfaceMode) => void;
  readonly colorMode: BoardColorMode;
  readonly setColorMode: (mode: BoardColorMode) => void;
  readonly workshopTools: boolean;
  readonly toggleWorkshopTools: () => void;
  readonly explodeFactor: number;
  readonly setExplodeFactor: (factor: number) => void;
  readonly showOutlines: boolean;
  readonly setShowOutlines: (show: boolean) => void;
  readonly measureMode: boolean;
  readonly setMeasureMode: (mode: boolean | ((v: boolean) => boolean)) => void;
  readonly exportMenuOpen: boolean;
  readonly setExportMenuOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  readonly exportFormat: ModelFormat | null;
  readonly setExportFormat: (fmt: ModelFormat | null) => void;
  readonly handleCapturePng: () => void;
  readonly handleShareLink: () => void;
  readonly linkCopied: boolean;
  readonly setClientMode: () => void;
  readonly onGoToProyectar?: () => void;
  readonly explodedModules: readonly ProjectModule3DInstance[];
  readonly sceneWalls: {
    readonly id: string;
    readonly originXMm: number;
    readonly originYMm: number;
    readonly endXMm: number;
    readonly endYMm: number;
    readonly heightMm: number;
    readonly wallMaterialId?: string;
  }[];
  readonly ambientFloor?: AmbientMaterial;
  readonly ambientWall?: AmbientMaterial;
  readonly ambientCeiling?: AmbientMaterial;
  readonly ambientCountertop?: AmbientMaterial;
  readonly materialColors: Readonly<Record<string, string | undefined>>;
  readonly materialTextures: Readonly<Record<string, MaterialTextureEntry | undefined>>;
}

export function Presentation3DViewSlide({
  project,
  presentationProject,
  catalog,
  preview,
  useR3f,
  surfaceMode,
  setSurfaceMode,
  colorMode,
  setColorMode,
  workshopTools,
  toggleWorkshopTools,
  explodeFactor,
  setExplodeFactor,
  showOutlines,
  setShowOutlines,
  measureMode,
  setMeasureMode,
  exportMenuOpen,
  setExportMenuOpen,
  exportFormat,
  setExportFormat,
  handleCapturePng,
  handleShareLink,
  linkCopied,
  setClientMode,
  onGoToProyectar,
  explodedModules,
  sceneWalls,
  ambientFloor,
  ambientWall,
  ambientCeiling,
  ambientCountertop,
  materialColors,
  materialTextures,
}: Presentation3DViewSlideProps): ReactNode {
  return (
    <section className="project-presentation__viewer" aria-label="Vista 3D">
      {useR3f && !preview.empty ? (
        <div
          className="project-presentation__controls"
          role="toolbar"
          aria-label="Controles de vista 3D"
          data-testid="presentation-client-toolbar"
        >
          {/* Client actions — always visible */}
          <div
            className="project-presentation__control-group"
            role="group"
            aria-label="Acciones para el cliente"
          >
            <select
              value={surfaceMode}
              onChange={(e) =>
                setSurfaceMode(e.target.value as MaterialSurfaceMode)
              }
              className="project-presentation__surface-select"
              data-testid="presentation-surface-mode"
              aria-label="Vista del acabado"
              title="Solo color, color con veta, o textura foto"
              disabled={colorMode !== 'material'}
            >
              <option value="color">Solo color</option>
              <option value="grain">Color + veta</option>
              <option value="texture">Textura</option>
            </select>
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={handleCapturePng}
              data-testid="presentation-capture-png"
              aria-label="Guardar captura PNG de la vista 3D"
            >
              <Camera size={14} strokeWidth={1.5} aria-hidden />
              Captura
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={handleShareLink}
              data-testid="presentation-share-link"
              aria-label={
                linkCopied
                  ? 'Link copiado al portapapeles'
                  : 'Copiar link de presentación'
              }
              aria-live="polite"
            >
              <Link2 size={14} strokeWidth={1.5} aria-hidden />
              {linkCopied ? '¡Copiado!' : 'Compartir'}
            </button>
            <button
              type="button"
              className={
                workshopTools
                  ? 'btn btn--small btn--primary'
                  : 'btn btn--small btn--ghost'
              }
              onClick={toggleWorkshopTools}
              data-testid="presentation-workshop-toggle"
              aria-pressed={workshopTools}
              aria-label={
                workshopTools
                  ? 'Salir del modo taller'
                  : 'Abrir herramientas de taller'
              }
              title="Herramientas técnicas del taller (no visibles al cliente por defecto)"
            >
              <Settings2 size={14} strokeWidth={1.5} aria-hidden />
              {workshopTools ? 'Salir taller' : 'Modo taller'}
            </button>
          </div>

          {/* Workshop tools — opt-in only */}
          {workshopTools ? (
            <div
              className="project-presentation__workshop-panel"
              data-testid="presentation-workshop-panel"
            >
              <div className="project-presentation__control-group">
                <label
                  htmlFor="explode-slider"
                  className="project-presentation__control-label"
                >
                  Vista explosionada
                </label>
                <input
                  id="explode-slider"
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={explodeFactor}
                  onChange={(e) =>
                    setExplodeFactor(Number(e.target.value))
                  }
                  className="project-presentation__slider"
                  data-testid="presentation-explode-slider"
                  aria-valuemin={0}
                  aria-valuemax={3}
                  aria-valuenow={explodeFactor}
                  aria-valuetext={`${explodeFactor.toFixed(1)} de factor de explosión`}
                />
              </div>
              <div
                className="project-presentation__control-group"
                role="group"
                aria-label="Cómo se pinta la vista 3D"
              >
                <Palette size={16} strokeWidth={1.5} aria-hidden />
                <button
                  type="button"
                  className={
                    colorMode === 'material'
                      ? 'btn btn--small btn--primary'
                      : 'btn btn--small'
                  }
                  onClick={() => setColorMode('material')}
                  data-testid="presentation-color-material"
                  aria-pressed={colorMode === 'material'}
                  aria-label="Pintar con acabados del material"
                >
                  Acabados
                </button>
                <button
                  type="button"
                  className={
                    colorMode === 'role'
                      ? 'btn btn--small btn--primary'
                      : 'btn btn--small'
                  }
                  onClick={() => setColorMode('role')}
                  data-testid="presentation-color-role"
                  aria-pressed={colorMode === 'role'}
                  aria-label="Pintar solo por rol de pieza (taller)"
                  title="Tintes fijos por INTERIOR/FRENTE — no muestra el material real"
                >
                  Roles taller
                </button>
                <label className="project-presentation__check">
                  <input
                    type="checkbox"
                    checked={showOutlines}
                    onChange={(e) => setShowOutlines(e.target.checked)}
                    data-testid="presentation-outlines-checkbox"
                  />
                  <span>Contornos</span>
                </label>
                <button
                  type="button"
                  className={`btn btn--small${measureMode ? ' btn--primary' : ''}`}
                  onClick={() => setMeasureMode((v) => !v)}
                  data-testid="presentation-toggle-measure"
                  aria-pressed={measureMode}
                  aria-label={
                    measureMode
                      ? 'Desactivar herramienta de medición'
                      : 'Activar herramienta de medición'
                  }
                >
                  <Ruler size={14} strokeWidth={1.5} aria-hidden />
                  Medir
                </button>
                <div className="project-presentation__export-wrap">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setExportMenuOpen((v) => !v)}
                    data-testid="presentation-export-toggle"
                    aria-expanded={exportMenuOpen}
                    aria-haspopup="menu"
                    aria-label="Exportar modelo 3D"
                  >
                    <Download size={14} strokeWidth={1.5} aria-hidden />
                    Exportar
                  </button>
                  {exportMenuOpen ? (
                    <div
                      className="project-presentation__export-menu"
                      role="menu"
                      aria-label="Formatos de exportación"
                    >
                      {(['glb', 'obj', 'stl'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          className="project-presentation__export-menu-item"
                          role="menuitem"
                          data-testid={`presentation-export-${fmt}`}
                          onClick={() => {
                            setExportFormat(fmt);
                            setExportMenuOpen(false);
                          }}
                        >
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={setClientMode}
                  data-testid="presentation-client-mode"
                >
                  Volver a cliente
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {preview.empty ? (
        <div
          className="project-presentation__empty-wrap"
          data-testid="presentation-3d-empty"
        >
          <EmptyState
            icon={Box}
            title="Sin vista 3D disponible"
            description="Colocá muebles en la planta (Proyectar) o agregá ítems a la cotización para ver el render."
            actionLabel={onGoToProyectar ? 'Ir a Proyectar' : undefined}
            onAction={onGoToProyectar}
          />
        </div>
      ) : useR3f ? (
        <Suspense
          fallback={
            <div className="module-scene-3d__loading" role="status">
              <div className="module-scene-3d__loading-spinner" />
              <p className="module-scene-3d__loading-text">
                Cargando escena 3D…
              </p>
            </div>
          }
        >
          <FurnitureScene3D
            className="module-scene-3d--fill"
            modules={explodedModules.map((m: ProjectModule3DInstance) => ({
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
            testId="presentation-scene-3d"
            colorMode={colorMode}
            materialColors={materialColors}
            materialTextures={materialTextures}
            surfaceMode={surfaceMode}
            showOutlines={showOutlines}
            measurementMode={measureMode}
            exportFormat={exportFormat}
            onExportComplete={() => setExportFormat(null)}
            exportProjectName={project.name}
            hardwareCatalog={catalog.hardware}
            ambientFloor={ambientFloor}
            ambientWall={ambientWall}
            ambientCeiling={ambientCeiling}
            ambientCountertop={ambientCountertop}
            availableAmbientMaterials={catalog.ambientMaterials}
            showCeiling={presentationProject?.kitchenLayout?.showCeiling}
          />
        </Suspense>
      ) : (
        <div
          className="project-presentation__webgl-required"
          data-testid="presentation-webgl-required"
        >
          <h4>WebGL requerido</h4>
          <p>
            La vista 3D necesita WebGL (Three.js / React Three Fiber).
            Verificá que tu navegador lo soporte y no esté bloqueado.
          </p>
        </div>
      )}
    </section>
  );
}
