/**
 * Unified furniture 3D viewer with compact toolbar + advanced disclosure.
 * Requires WebGL (Three.js / React Three Fiber). No CSS fallback.
 * Fase 7 UI: primary chrome = projection · contornos · cámara; paint/X-ray advanced.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  ModuleScene3D,
  PartInspector,
  PartList,
  PaintModeField,
  MaterialSurfaceModeField,
  canUseWebGL,
  materialColorMap,
  materialTextureMap,
  DEFAULT_MATERIAL_SURFACE_MODE,
  DEFAULT_SCENE_LIGHTING_MODE,
  type BoardColorMode,
  type MaterialColorLookup,
  type MaterialSurfaceMode,
  type MaterialTextureLookup,
  type SceneLightingMode,
} from '../preview3d';
import type {
  Hardware,
  ResolvedBoardPart,
  ResolvedHardwarePlacement,
} from '@muebles/domain';
import '../preview3d/partInspector.css';
import './furniture3dViewer.css';

export type Furniture3DViewerProps = {
  /** Board parts to render (from domain preview resolution). */
  readonly parts: readonly ResolvedBoardPart[];
  /** Width in mm. */
  readonly width: number;
  /** Height/thickness in mm. */
  readonly height: number;
  /** Depth/length in mm. */
  readonly depth: number;
  /** Optional material color lookup (catalog materialId -> hex). */
  readonly materialColors?: MaterialColorLookup;
  /** Optional material texture lookup (catalog materialId -> media URL). */
  readonly materialTextures?: MaterialTextureLookup;
  /**
   * Resolve relative media URLs for TextureLoader (auth token / absolute origin).
   * Used when materialTextures is not pre-built.
   */
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  /** Catalog materials — used with resolveMediaUrl to build texture map. */
  readonly materialsForTextures?: readonly Pick<
    import('@muebles/domain').MaterialBoard,
    'id' | 'previewTextureUrl' | 'imageUrl'
  >[];
  /** Initial color mode. Default: 'material'. */
  readonly initialColorMode?: BoardColorMode;
  /** Initial projection mode. Default: 'perspective'. */
  readonly initialProjection?: 'perspective' | 'orthographic';
  /** Initial wireframe state. Default: false. */
  readonly initialWireframe?: boolean;
  /** Initial outline edges on all boards. Default: true. */
  readonly initialShowOutlines?: boolean;
  /** Optional CSS class. */
  readonly className?: string;
  /** Optional inline style. */
  readonly style?: CSSProperties;
  /** Test ID for the canvas wrapper. */
  readonly testId?: string;
  /** Hide the control bar entirely. Default: false. */
  readonly hideControls?: boolean;
  /**
   * Show part list + inspector chrome (click mesh or row).
   * Default true. Set false for compact embeds that only need the canvas.
   */
  readonly showPartInspector?: boolean;
  /** Optional hint under the paint-mode control. */
  readonly paintModeHint?: string;
  /** Initial surface look (color / grain / texture). Default: grain. */
  readonly initialSurfaceMode?: MaterialSurfaceMode;
  /**
   * Start with advanced (paint / wireframe) open. Default false.
   * Open automatically when initial wireframe is on.
   */
  readonly initialAdvancedOpen?: boolean;
  /** Scene lighting preset. Default: present. */
  readonly lightingMode?: SceneLightingMode;
  /**
   * When this token changes (and is > 0), force catalog-photo framing:
   * 3/4 isometric, texture surface, material paint, no X-ray, perspective.
   */
  readonly catalogPhotoViewToken?: number;
  /**
   * Parametric hardware placements (jaladeras) resolved to board-LOCAL mm
   * (Fase 2). Forwarded to ModuleScene3D → FurnitureScene3D so a single
   * module's handles render in the module editor 3D view. Optional/empty →
   * no handles (byte-identical to pre-Fase-2 scene).
   */
  readonly resolvedHardwarePlacements?: readonly ResolvedHardwarePlacement[];
  /**
   * Hardware catalog used to look up preview geometry/PBR for the resolved
   * placements. Optional: when omitted (or no placements), no handles render.
   */
  readonly hardwareCatalog?: readonly Hardware[];
};

export function Furniture3DViewer({
  parts,
  width,
  height,
  depth,
  materialColors,
  materialTextures,
  resolveMediaUrl,
  materialsForTextures,
  initialColorMode = 'material',
  initialProjection = 'perspective',
  initialWireframe = false,
  initialShowOutlines = true,
  className,
  style,
  testId = 'furniture-3d-viewer',
  hideControls = false,
  showPartInspector = true,
  paintModeHint,
  initialSurfaceMode = DEFAULT_MATERIAL_SURFACE_MODE,
  initialAdvancedOpen,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  catalogPhotoViewToken = 0,
  resolvedHardwarePlacements,
  hardwareCatalog,
}: Furniture3DViewerProps): ReactNode {
  const webglAvailable = useMemo(() => canUseWebGL(), []);
  const [colorMode, setColorMode] = useState<BoardColorMode>(initialColorMode);
  const [surfaceMode, setSurfaceMode] =
    useState<MaterialSurfaceMode>(initialSurfaceMode);
  const [projection, setProjection] = useState<'perspective' | 'orthographic'>(
    initialProjection,
  );
  const [showWireframe, setShowWireframe] = useState(initialWireframe);
  const [showOutlines, setShowOutlines] = useState(initialShowOutlines);
  const [advancedOpen, setAdvancedOpen] = useState(
    initialAdvancedOpen ?? initialWireframe,
  );
  const [cameraView, setCameraView] = useState<{
    readonly type: 'front' | 'top' | 'side' | 'isometric';
    readonly ts: number;
  } | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isolateSelected, setIsolateSelected] = useState(false);
  /**
   * Product-still clean mode (slice 2): no axes, no outer ghost, catalog
   * lighting, outlines off. Activated by catalogPhotoViewToken.
   */
  const [productShotClean, setProductShotClean] = useState(
    catalogPhotoViewToken > 0,
  );

  useEffect(() => {
    if (!catalogPhotoViewToken) return;
    setCameraView({ type: 'isometric', ts: Date.now() });
    setSurfaceMode('texture');
    setColorMode('material');
    setShowWireframe(false);
    setShowOutlines(false);
    setProjection('perspective');
    setIsolateSelected(false);
    setSelectedPartId(null);
    setProductShotClean(true);
  }, [catalogPhotoViewToken]);

  const effectiveLightingMode: SceneLightingMode = productShotClean
    ? 'catalog'
    : lightingMode;

  const materialColorsMemo = useMemo(
    () => materialColors ?? materialColorMap([]),
    [materialColors],
  );
  const materialTexturesMemo = useMemo(() => {
    if (materialTextures) return materialTextures;
    if (materialsForTextures) {
      return materialTextureMap(materialsForTextures, resolveMediaUrl);
    }
    return materialTextureMap([]);
  }, [materialTextures, materialsForTextures, resolveMediaUrl]);

  const selectedPart = useMemo(
    () => parts.find((p) => p.id === selectedPartId) ?? null,
    [parts, selectedPartId],
  );

  useEffect(() => {
    if (selectedPartId && !parts.some((p) => p.id === selectedPartId)) {
      setSelectedPartId(null);
    }
  }, [parts, selectedPartId]);

  const showControls = !hideControls;
  const rootClass = ['furniture-3d-viewer', className].filter(Boolean).join(' ');

  const advancedSummary = [
    colorMode === 'material' ? 'Acabados' : 'Roles taller',
    showWireframe ? 'Rayos X' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (!webglAvailable) {
    return (
      <div
        className={`${rootClass} furniture-3d-viewer--no-webgl`}
        data-testid={`${testId}-no-webgl`}
        style={style}
      >
        <h4>WebGL no disponible</h4>
        <p>
          El visor 3D requiere WebGL (Three.js / React Three Fiber).
          <br />
          Verificá que tu navegador lo soporte y no esté bloqueado por
          extensiones/CSP.
        </p>
        <details>
          <summary>Detalles técnicos</summary>
          <pre>
            {`canUseWebGL() returned: ${webglAvailable}
Common causes:
- WebGL disabled in browser settings
- Browser extension blocking canvas.getContext('webgl')
- Content Security Policy (CSP) blocking WebGL
- Hardware acceleration disabled
- Running in headless/CI environment without GPU`}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className={rootClass} style={style} data-testid={testId}>
      {showControls ? (
        <>
          <div
            className="furniture-3d-viewer__toolbar"
            data-testid={`${testId}-controls`}
          >
            <div className="furniture-3d-viewer__toolbar-cluster">
              <div className="furniture-3d-viewer__field">
                <label
                  className="furniture-3d-viewer__field-label"
                  htmlFor={`${testId}-projection`}
                >
                  Proyección
                </label>
                <select
                  id={`${testId}-projection`}
                  className="furniture-3d-viewer__select"
                  value={projection}
                  onChange={(e) =>
                    setProjection(
                      e.target.value as 'perspective' | 'orthographic',
                    )
                  }
                  data-testid={`${testId}-projection-select`}
                >
                  <option value="perspective">Perspectiva</option>
                  <option value="orthographic">Ortogonal</option>
                </select>
              </div>

              <label className="furniture-3d-viewer__check">
                <input
                  type="checkbox"
                  id={`${testId}-outlines`}
                  checked={showOutlines}
                  onChange={(e) => setShowOutlines(e.target.checked)}
                  data-testid={`${testId}-outlines-checkbox`}
                />
                Contornos
              </label>
            </div>

            <div
              className="furniture-3d-viewer__camera"
              role="group"
              aria-label="Vista de cámara"
            >
              <span className="furniture-3d-viewer__camera-label">Cámara</span>
              <button
                type="button"
                className="btn btn--small"
                onClick={() =>
                  setCameraView({ type: 'front', ts: Date.now() })
                }
                data-testid={`${testId}-camera-front`}
              >
                Frente
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setCameraView({ type: 'top', ts: Date.now() })}
                data-testid={`${testId}-camera-top`}
              >
                Planta
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setCameraView({ type: 'side', ts: Date.now() })}
                data-testid={`${testId}-camera-side`}
              >
                Lateral
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() =>
                  setCameraView({ type: 'isometric', ts: Date.now() })
                }
                data-testid={`${testId}-camera-isometric`}
              >
                3/4
              </button>
            </div>
          </div>

          <div
            className="furniture-3d-viewer__advanced"
            data-testid={`${testId}-advanced`}
          >
            <button
              type="button"
              className="furniture-3d-viewer__advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
              data-testid={`${testId}-advanced-toggle`}
            >
              {advancedOpen ? (
                <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
              ) : (
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
              )}
              Acabados y vista avanzada
              <span className="furniture-3d-viewer__advanced-summary">
                {advancedSummary}
              </span>
            </button>
            {advancedOpen ? (
              <div
                className="furniture-3d-viewer__advanced-body"
                data-testid={`${testId}-advanced-body`}
              >
                <label className="furniture-3d-viewer__check">
                  <input
                    type="checkbox"
                    id={`${testId}-wireframe`}
                    checked={showWireframe}
                    onChange={(e) => setShowWireframe(e.target.checked)}
                    data-testid={`${testId}-wireframe-checkbox`}
                  />
                  Rayos X (ver interior)
                </label>
                <PaintModeField
                  id={`${testId}-color-mode`}
                  value={colorMode}
                  onChange={setColorMode}
                  testId={`${testId}-color-mode`}
                  hint={paintModeHint}
                />
                <MaterialSurfaceModeField
                  id={`${testId}-surface-mode`}
                  value={surfaceMode}
                  onChange={setSurfaceMode}
                  testId={`${testId}-surface-mode`}
                  visible={colorMode === 'material'}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div
        className={
          showPartInspector
            ? 'furniture-3d-viewer__body furniture-3d-viewer__body--with-inspector'
            : 'furniture-3d-viewer__body'
        }
        data-testid={`${testId}-viewport`}
      >
        <div className="furniture-3d-viewer__scene">
          <ModuleScene3D
            parts={parts}
            width={width}
            height={height}
            depth={depth}
            colorMode={colorMode}
            materialColors={materialColorsMemo}
            materialTextures={materialTexturesMemo}
            surfaceMode={surfaceMode}
            cameraView={cameraView}
            cameraType={projection}
            showWireframe={showWireframe}
            showOutlines={showOutlines}
            selectedPartId={showPartInspector ? selectedPartId : null}
            onSelectPart={
              showPartInspector ? setSelectedPartId : undefined
            }
            isolateSelected={showPartInspector && isolateSelected}
            lightingMode={effectiveLightingMode}
            showAxes={!productShotClean}
            showOuterGhost={!productShotClean}
            resolvedHardwarePlacements={resolvedHardwarePlacements}
            hardwareCatalog={hardwareCatalog}
          />
        </div>
        {showPartInspector ? (
          <aside
            className="furniture-3d-viewer__aside"
            aria-label="Inspector de piezas"
            data-testid={`${testId}-inspector-aside`}
          >
            <PartList
              parts={parts}
              selectedPartId={selectedPartId}
              onSelectPart={setSelectedPartId}
              testId={`${testId}-part-list`}
            />
            <PartInspector
              part={selectedPart}
              onClear={() => setSelectedPartId(null)}
              isolateSelected={isolateSelected}
              onIsolateChange={setIsolateSelected}
              testId={`${testId}-part-inspector`}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** Export material maps for consumers that need to build their own lookup. */
export { materialColorMap, materialTextureMap } from '../preview3d';
export type { BoardColorMode, MaterialColorLookup } from '../preview3d';
export type { ResolvedBoardPart } from '@muebles/domain';
