/**
 * Client-facing presentation mode for a quote (#136).
 * Fullscreen: name, commercial list, sale total, 3D — no costs/exports.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  Customer,
  Module,
  Project,
  ProjectItem,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveModuleMeasurePreset,
} from '@muebles/domain';
import { Camera, Link2, Palette, Ruler, X } from 'lucide-react';
import { formatMoneyDisplay } from '../../common';
import {
  FurnitureScene3D,
  canUseWebGL,
  materialColorMap,
  type BoardColorMode,
} from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';

export type ProjectPresentationModeProps = {
  readonly open: boolean;
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly customers: readonly Customer[];
  readonly catalog: Module3DCatalogInput;
  /** Sale total only — never costs. */
  readonly salePrice: number | null;
  readonly onClose: () => void;
};

function lineLabel(
  item: ProjectItem,
  modules: readonly Module[],
): { title: string; measures: string } {
  const mod = modules.find((m) => m.id === item.moduleId);
  const title = mod ? `${mod.code} — ${mod.name}` : 'Mueble';
  let measures = '';
  if (mod) {
    try {
      const preset = resolveModuleMeasurePreset(
        mod,
        item.measurePresetId?.trim() ||
          defaultMeasurePresetId(mod) ||
          undefined,
      );
      if (preset) {
        measures = `${preset.width} × ${preset.height} × ${preset.depth} mm`;
      } else if (mod.externalDims) {
        measures = `${mod.externalDims.width} × ${mod.externalDims.height} × ${mod.externalDims.depth} mm`;
      }
    } catch {
      if (mod.externalDims) {
        measures = `${mod.externalDims.width} × ${mod.externalDims.height} × ${mod.externalDims.depth} mm`;
      }
    }
  }
  return { title, measures };
}

export function ProjectPresentationMode({
  open,
  project,
  modules,
  customers,
  catalog,
  salePrice,
  onClose,
}: ProjectPresentationModeProps): ReactNode {
  const [useR3f, setUseR3f] = useState(false);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');
  const [measureMode, setMeasureMode] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUseR3f(canUseWebGL());
    setExplodeFactor(0);
    setColorMode('material');
    setMeasureMode(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const customerName =
    customers.find((c) => c.id === project.customerId)?.name ?? '';

  const preview = useMemo(
    () => resolveProject3DPreview(project, catalog),
    [project, catalog],
  );

  // Apply explode factor: scale each part's position away from module center.
  const explodedModules = useMemo(() => {
    if (explodeFactor <= 0) return preview.modules;
    return preview.modules.map((mod) => {
      const cx = mod.width / 2;
      const cy = mod.height / 2;
      const cz = mod.depth / 2;
      return {
        ...mod,
        parts: mod.parts.map((part) => {
          const dx = (part.x ?? 0) - cx;
          const dy = (part.y ?? 0) - cy;
          const dz = (part.z ?? 0) - cz;
          return {
            ...part,
            x: (part.x ?? 0) + dx * explodeFactor,
            y: (part.y ?? 0) + dy * explodeFactor,
            z: (part.z ?? 0) + dz * explodeFactor,
          };
        }),
      };
    });
  }, [preview.modules, explodeFactor]);

  const materialColors = useMemo(
    () => materialColorMap(catalog.materials),
    [catalog.materials],
  );

  const handleCapturePng = () => {
    const container = document.querySelector('[data-testid="project-presentation-mode"]');
    if (!container) return;
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_3d.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      // WebGL canvas may need preserveDrawingBuffer — fallback silently.
    }
  };

  const [linkCopied, setLinkCopied] = useState(false);

  const handleShareLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?present=${project.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback: select prompt.
      window.prompt('Copiá este link:', url);
    }
  };

  if (!open) return null;

  return (
    <div
      className="project-presentation"
      data-testid="project-presentation-mode"
      role="dialog"
      aria-modal="true"
      aria-label={`Presentación: ${project.name}`}
    >
      <header className="project-presentation__header">
        <div>
          <p className="project-presentation__kicker">Cotización</p>
          <h1 className="project-presentation__title">{project.name}</h1>
          {customerName ? (
            <p className="project-presentation__customer">{customerName}</p>
          ) : null}
        </div>
        <div className="project-presentation__total-block">
          <span className="project-presentation__total-label">Total</span>
          <span
            className="project-presentation__total-value"
            data-testid="project-presentation-total"
          >
            {salePrice == null
              ? '—'
              : formatMoneyDisplay(salePrice, { currency: project.currency })}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--ghost project-presentation__close"
          onClick={onClose}
          data-testid="project-presentation-close"
          aria-label="Salir de presentación"
        >
          <X size={20} strokeWidth={1.5} aria-hidden />
          Salir
        </button>
      </header>

      <div className="project-presentation__body">
        <section
          className="project-presentation__list"
          aria-label="Muebles"
        >
          <h2 className="project-presentation__section-title">Muebles</h2>
          <ul className="project-presentation__items">
            {project.items.map((item) => {
              const { title, measures } = lineLabel(item, modules);
              return (
                <li key={item.id} className="project-presentation__item">
                  <span className="project-presentation__item-qty">
                    {item.quantity}×
                  </span>
                  <span>
                    <span className="project-presentation__item-title">
                      {title}
                    </span>
                    {measures ? (
                      <span className="project-presentation__item-measures">
                        {measures}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {project.kitchenLayout && project.kitchenLayout.walls.length > 0 ? (
            <p className="project-presentation__hint">
              Plano de cocina: {project.kitchenLayout.walls.length} muro
              {project.kitchenLayout.walls.length === 1 ? '' : 's'} ·{' '}
              {project.kitchenLayout.placements.length} colocación
              {project.kitchenLayout.placements.length === 1 ? '' : 'es'}
            </p>
          ) : null}
        </section>

        <section
          className="project-presentation__viewer"
          aria-label="Vista 3D"
        >
          {useR3f && !preview.empty ? (
            <div className="project-presentation__controls" role="toolbar" aria-label="Controles de vista 3D">
              <div className="project-presentation__control-group">
                <label htmlFor="explode-slider" className="project-presentation__control-label">
                  Vista explosionada
                </label>
                <input
                  id="explode-slider"
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={explodeFactor}
                  onChange={(e) => setExplodeFactor(Number(e.target.value))}
                  className="project-presentation__slider"
                  data-testid="presentation-explode-slider"
                  aria-valuemin={0}
                  aria-valuemax={3}
                  aria-valuenow={explodeFactor}
                  aria-valuetext={`${explodeFactor.toFixed(1)} de factor de explosión`}
                />
              </div>
              <div className="project-presentation__control-group" role="group" aria-label="Modo de color">
                <Palette size={16} strokeWidth={1.5} aria-hidden />
                <button
                  type="button"
                  className={colorMode === 'material' ? 'btn btn--small btn--primary' : 'btn btn--small'}
                  onClick={() => setColorMode('material')}
                  data-testid="presentation-color-material"
                  aria-pressed={colorMode === 'material'}
                  aria-label="Colorear por material"
                >
                  Por material
                </button>
                <button
                  type="button"
                  className={colorMode === 'role' ? 'btn btn--small btn--primary' : 'btn btn--small'}
                  onClick={() => setColorMode('role')}
                  data-testid="presentation-color-role"
                  aria-pressed={colorMode === 'role'}
                  aria-label="Colorear por función"
                >
                  Por función
                </button>
                <button
                  type="button"
                  className={`btn btn--small${measureMode ? ' btn--primary' : ''}`}
                  onClick={() => setMeasureMode((v) => !v)}
                  data-testid="presentation-toggle-measure"
                  aria-pressed={measureMode}
                  aria-label={measureMode ? 'Desactivar herramienta de medición' : 'Activar herramienta de medición'}
                >
                  <Ruler size={14} strokeWidth={1.5} aria-hidden />
                  Medir
                </button>
                <button
                  type="button"
                  className="btn btn--small"
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
                  aria-label={linkCopied ? 'Link copiado al portapapeles' : 'Copiar link de presentación'}
                  aria-live="polite"
                >
                  <Link2 size={14} strokeWidth={1.5} aria-hidden />
                  {linkCopied ? '¡Copiado!' : 'Compartir'}
                </button>
              </div>
            </div>
          ) : null}
          {preview.empty ? (
            <p className="catalog-empty">Sin vista 3D disponible.</p>
          ) : useR3f ? (
            <FurnitureScene3D
              modules={explodedModules.map((m) => ({
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
              testId="presentation-scene-3d"
              colorMode={colorMode}
              materialColors={materialColors}
              measurementMode={measureMode}
            />
          ) : (
            <div
              className="catalog-empty"
              style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
                backgroundColor: 'var(--surface-card)',
                border: '1px solid var(--danger-500)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--danger-700)',
              }}
              data-testid="presentation-webgl-required"
            >
              <h4>⚠️ WebGL requerido</h4>
              <p>
                La vista 3D necesita WebGL (Three.js / React Three Fiber).
                Verificá que tu navegador lo soporte y no esté bloqueado.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
