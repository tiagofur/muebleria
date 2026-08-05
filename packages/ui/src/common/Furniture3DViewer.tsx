/**
 * Unified furniture 3D viewer with camera controls, projection toggle, wireframe,
 * color mode, and part inspector (click mesh / list → highlight + dims).
 * Requires WebGL (Three.js / React Three Fiber). No CSS fallback.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ModuleScene3D,
  PartInspector,
  PartList,
  canUseWebGL,
  materialColorMap,
  type BoardColorMode,
  type MaterialColorLookup,
} from '../preview3d';
import type { ResolvedBoardPart } from '@muebles/domain';
import '../preview3d/partInspector.css';

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
  /** Initial color mode. Default: 'material'. */
  readonly initialColorMode?: BoardColorMode;
  /** Initial projection mode. Default: 'perspective'. */
  readonly initialProjection?: 'perspective' | 'orthographic';
  /** Initial wireframe state. Default: false. */
  readonly initialWireframe?: boolean;
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
};

export function Furniture3DViewer({
  parts,
  width,
  height,
  depth,
  materialColors,
  initialColorMode = 'material',
  initialProjection = 'perspective',
  initialWireframe = false,
  className,
  style,
  testId = 'furniture-3d-viewer',
  hideControls = false,
  showPartInspector = true,
}: Furniture3DViewerProps): ReactNode {
  const webglAvailable = useMemo(() => canUseWebGL(), []);
  const [colorMode, setColorMode] = useState<BoardColorMode>(initialColorMode);
  const [projection, setProjection] = useState<'perspective' | 'orthographic'>(initialProjection);
  const [showWireframe, setShowWireframe] = useState(initialWireframe);
  const [cameraView, setCameraView] = useState<{
    readonly type: 'front' | 'top' | 'side' | 'isometric';
    readonly ts: number;
  } | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [isolateSelected, setIsolateSelected] = useState(false);

  const materialColorsMemo = useMemo(
    () => materialColors ?? materialColorMap([]),
    [materialColors],
  );

  const selectedPart = useMemo(
    () => parts.find((p) => p.id === selectedPartId) ?? null,
    [parts, selectedPartId],
  );

  // Drop selection if the part disappears (draft/BOM change).
  useEffect(() => {
    if (selectedPartId && !parts.some((p) => p.id === selectedPartId)) {
      setSelectedPartId(null);
    }
  }, [parts, selectedPartId]);

  const showControls = !hideControls;

  if (!webglAvailable) {
    return (
      <div
        className={className}
        data-testid={`${testId}-no-webgl`}
        style={{
          ...style,
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--error-50)',
          border: '1px solid var(--error-500)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--error-700)',
        }}
      >
        <h4 style={{ margin: '0 0 0.5rem' }}>⚠️ WebGL no disponible</h4>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
          El visor 3D requiere WebGL (Three.js / React Three Fiber).<br />
          Verificá que tu navegador lo soporte y no esté bloqueado por extensiones/CSP.
        </p>
        <details style={{ marginTop: '1rem', textAlign: 'left', fontSize: 'var(--text-xs)' }}>
          <summary>Detalles técnicos</summary>
          <pre style={{ marginTop: '0.5rem', overflow: 'auto' }}>
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
    <div
      className={className}
      style={style}
      data-testid={testId}
    >
      {showControls && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          data-testid={`${testId}-controls`}
        >
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Projection selector */}
            <div className="catalog-form__field" style={{ marginBottom: 0 }}>
              <label
                htmlFor={`${testId}-projection`}
                style={{ marginRight: '0.5rem', fontWeight: '500' }}
              >
                Proyección:
              </label>
              <select
                id={`${testId}-projection`}
                value={projection}
                onChange={(e) => setProjection(e.target.value as 'perspective' | 'orthographic')}
                style={{
                  padding: '0.375rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-input, #fff)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
                data-testid={`${testId}-projection-select`}
              >
                <option value="perspective">Perspectiva (3D)</option>
                <option value="orthographic">Ortogonal (2D Plano)</option>
              </select>
            </div>

            {/* Wireframe toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                id={`${testId}-wireframe`}
                checked={showWireframe}
                onChange={(e) => setShowWireframe(e.target.checked)}
                style={{
                  cursor: 'pointer',
                  width: '1.1rem',
                  height: '1.1rem',
                }}
                data-testid={`${testId}-wireframe-checkbox`}
              />
              <label
                htmlFor={`${testId}-wireframe`}
                style={{
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: 'var(--text-sm, 0.875rem)',
                }}
              >
                Rayos X (Ver interior)
              </label>
            </div>
          </div>

          {/* Camera view buttons */}
          <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
            <span
              style={{
                fontSize: 'var(--text-xs, 0.75rem)',
                color: 'var(--text-muted)',
                marginRight: '0.25rem',
              }}
            >
              Cámara:
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: 'var(--text-xs, 0.75rem)',
                minWidth: 'unset',
              }}
              onClick={() => setCameraView({ type: 'front', ts: Date.now() })}
              data-testid={`${testId}-camera-front`}
            >
              Frente
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: 'var(--text-xs, 0.75rem)',
                minWidth: 'unset',
              }}
              onClick={() => setCameraView({ type: 'top', ts: Date.now() })}
              data-testid={`${testId}-camera-top`}
            >
              Planta
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: 'var(--text-xs, 0.75rem)',
                minWidth: 'unset',
              }}
              onClick={() => setCameraView({ type: 'side', ts: Date.now() })}
              data-testid={`${testId}-camera-side`}
            >
              Lateral
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: 'var(--text-xs, 0.75rem)',
                minWidth: 'unset',
              }}
              onClick={() => setCameraView({ type: 'isometric', ts: Date.now() })}
              data-testid={`${testId}-camera-isometric`}
            >
              Perspectiva
            </button>
          </div>
        </div>
      )}

      {/* Color mode selector */}
      {!hideControls && (
        <div
          className="catalog-form__field"
          style={{ marginBottom: '1rem' }}
          data-testid={`${testId}-color-mode-field`}
        >
          <label htmlFor={`${testId}-color-mode`}>Colores</label>
          <select
            id={`${testId}-color-mode`}
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as BoardColorMode)}
            data-testid={`${testId}-color-mode-select`}
          >
            <option value="material">Material (color/veta)</option>
            <option value="role">Por rol (taller)</option>
          </select>
        </div>
      )}

      {/* 3D canvas + optional part list / inspector */}
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
            cameraView={cameraView}
            cameraType={projection}
            showWireframe={showWireframe}
            selectedPartId={showPartInspector ? selectedPartId : null}
            onSelectPart={
              showPartInspector ? setSelectedPartId : undefined
            }
            isolateSelected={showPartInspector && isolateSelected}
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

/** Export materialColorMap for consumers that need to build their own lookup. */
export { materialColorMap } from '../preview3d';
export type { BoardColorMode, MaterialColorLookup } from '../preview3d';
export type { ResolvedBoardPart } from '@muebles/domain';