/**
 * Client-facing presentation mode for a quote (#136).
 * 4 slides: Resumen → Planta → Opciones → Vista 3D.
 * Client chrome by default; workshop tools behind "Modo taller".
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Customer,
  Module,
  OptionGroup,
  Project,
  ProjectItem,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  ensureKitchenSpaces,
  projectScopedToProductionSpace,
  resolveModuleMeasurePreset,
} from '@muebles/domain';
import {
  Box,
  Camera,
  Download,
  Keyboard,
  Link2,
  Palette,
  Ruler,
  Settings2,
  X,
} from 'lucide-react';
import { EmptyState, formatMoneyDisplay } from '../../common';
import {
  canUseWebGL,
  materialColorMap,
  materialTextureMap,
  DEFAULT_MATERIAL_SURFACE_MODE,
  type BoardColorMode,
  type MaterialSurfaceMode,
  type ModelFormat,
} from '../../preview3d';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import { buildPresentationShareUrl } from '../projectHelpers';
import { PresentationKitchenPlanSlide } from './PresentationKitchenPlanSlide';
import { PresentationOptionsSlide } from './PresentationOptionsSlide';

// Lazy-load the heavy R3F scene
const FurnitureScene3D = lazy(() =>
  import('../../preview3d').then((m) => ({ default: m.FurnitureScene3D })),
);

import { resolveProject3DPreview } from '../../preview3d/project3dPreview';

const TOTAL_SLIDES = 4;

export type ProjectPresentationModeProps = {
  readonly open: boolean;
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly customers: readonly Customer[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalog: Module3DCatalogInput;
  /** Sale total only — never costs. */
  readonly salePrice: number | null;
  readonly workshopName?: string;
  readonly onClose: () => void;
  readonly onGoToProyectar?: () => void;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
  /** Leave presentation and open Proyectar (empty plan / 3D CTA). */
  readonly onGoToProyectar?: () => void;
  /**
   * When true (default), open on Vista 3D if the project has a renderable scene.
   */
  readonly prefer3dHero?: boolean;
};

type PresentationFlash = {
  readonly kind: 'success' | 'error' | 'info';
  readonly message: string;
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
  optionGroups,
  catalog,
  salePrice,
  workshopName,
  onClose,
  resolveMediaUrl,
  onGoToProyectar,
  prefer3dHero = true,
}: ProjectPresentationModeProps): ReactNode {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [useR3f, setUseR3f] = useState(false);
  /** Workshop tools (explode, roles, measure, export) — off for client pitch. */
  const [workshopTools, setWorkshopTools] = useState(false);
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [colorMode, setColorMode] = useState<BoardColorMode>('material');
  const [surfaceMode, setSurfaceMode] = useState<MaterialSurfaceMode>(
    DEFAULT_MATERIAL_SURFACE_MODE,
  );
  const [showOutlines, setShowOutlines] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [exportFormat, setExportFormat] = useState<ModelFormat | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [flash, setFlash] = useState<PresentationFlash | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Selected KitchenSpace for planta + 3D (multi-ambiente). */
  const [presentationSpaceId, setPresentationSpaceId] = useState<
    string | undefined
  >(undefined);
  const touchStartX = useRef<number | null>(null);

  const showFlash = useCallback((kind: PresentationFlash['kind'], message: string) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlash({ kind, message });
    flashTimerRef.current = setTimeout(() => {
      setFlash(null);
      flashTimerRef.current = null;
    }, 3500);
  }, []);

  const goNext = useCallback(() => {
    setCurrentSlide((s) => Math.min(s + 1, TOTAL_SLIDES - 1));
  }, []);

  const goPrev = useCallback(() => {
    setCurrentSlide((s) => Math.max(s - 1, 0));
  }, []);

  useEffect(() => {
    if (!open) return;
    setUseR3f(canUseWebGL());
    setWorkshopTools(false);
    setExplodeFactor(0);
    setColorMode('material');
    setSurfaceMode(DEFAULT_MATERIAL_SURFACE_MODE);
    setShowOutlines(false);
    setMeasureMode(false);
    setExportFormat(null);
    setExportMenuOpen(false);
    setShowShortcuts(false);
    setFlash(null);
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setCurrentSlide(0);
    // Default ambient: active space when multi-ambiente.
    if (project.kitchenLayout) {
      const ensured = ensureKitchenSpaces(project.kitchenLayout);
      setPresentationSpaceId(ensured.activeSpaceId ?? ensured.spaces?.[0]?.id);
    } else {
      setPresentationSpaceId(undefined);
    }
  }, [open, project.kitchenLayout]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const setClientMode = useCallback(() => {
    setWorkshopTools(false);
    setExplodeFactor(0);
    setColorMode('material');
    setShowOutlines(false);
    setMeasureMode(false);
    setExportFormat(null);
    setExportMenuOpen(false);
  }, []);

  const toggleWorkshopTools = useCallback(() => {
    setWorkshopTools((on) => {
      if (on) {
        // Leaving workshop → reset client-safe defaults.
        setExplodeFactor(0);
        setColorMode('material');
        setShowOutlines(false);
        setMeasureMode(false);
        setExportFormat(null);
        setExportMenuOpen(false);
        return false;
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // ? toggles shortcuts overlay
      if (e.key === '?' || e.key === '¿') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      // Escape closes overlay first, then presentation
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
        } else {
          onClose();
        }
        return;
      }
      // Suppress navigation while overlay is open
      if (showShortcuts) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, goNext, goPrev, showShortcuts]);

  const customerName =
    customers.find((c) => c.id === project.customerId)?.name ?? '';

  /**
   * Multi-ambiente: planta and 3D share the same selected space so the
   * client sees one ambient at a time (coordinate systems stay coherent).
   * Single-space / legacy: full project.
   */
  const presentationProject = useMemo((): Project => {
    const layout = project.kitchenLayout;
    if (!layout || !presentationSpaceId) return project;
    const ensured = ensureKitchenSpaces(layout);
    const spaces = ensured.spaces ?? [];
    if (spaces.length < 2) return project;
    if (!spaces.some((s) => s.id === presentationSpaceId)) return project;
    return projectScopedToProductionSpace(project, presentationSpaceId);
  }, [project, presentationSpaceId]);

  const presentationSpaces = useMemo(() => {
    if (!project.kitchenLayout) return [] as { id: string; name: string }[];
    const spaces = ensureKitchenSpaces(project.kitchenLayout).spaces ?? [];
    if (spaces.length < 2) return [];
    return spaces.map((s) => ({
      id: s.id,
      name: s.name?.trim() || 'Ambiente',
    }));
  }, [project.kitchenLayout]);

  const multiSpacePresentation = presentationSpaces.length > 1;

  const preview = useMemo(
    () => resolveProject3DPreview(presentationProject, catalog),
    [presentationProject, catalog],
  );

  // Sales hero: jump to Vista 3D when the scene has content.
  useEffect(() => {
    if (!open || !prefer3dHero) return;
    if (!preview.empty) {
      setCurrentSlide(3);
    }
  }, [open, prefer3dHero, preview.empty, project.id]);

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
  const materialTextures = useMemo(
    () => materialTextureMap(catalog.materials, resolveMediaUrl),
    [catalog.materials, resolveMediaUrl],
  );

  const handleCapturePng = () => {
    const container = document.querySelector(
      '[data-testid="project-presentation-mode"]',
    );
    const canvas = container?.querySelector('canvas');
    if (!canvas) {
      showFlash(
        'error',
        'No hay vista 3D para capturar. Abrí la diapositiva Vista 3D y esperá a que cargue.',
      );
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl || dataUrl === 'data:,') {
        showFlash(
          'error',
          'La captura salió vacía. Probá de nuevo o usá la captura del sistema.',
        );
        return;
      }
      const link = document.createElement('a');
      link.download = `${project.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}_3d.png`;
      link.href = dataUrl;
      link.click();
      showFlash('success', 'Captura PNG guardada.');
    } catch {
      showFlash(
        'error',
        'No se pudo capturar la vista 3D. El navegador puede bloquear WebGL o falta preserveDrawingBuffer.',
      );
    }
  };

  const [linkCopied, setLinkCopied] = useState(false);

  const handleShareLink = async () => {
    const url = buildPresentationShareUrl(project.id);
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      showFlash('success', 'Link de presentación copiado.');
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt('Copiá este link:', url);
      showFlash('info', 'Copiá el link desde el cuadro de diálogo.');
    }
  };

  // Touch handlers for swipe navigation (skip if originated from 3D viewer)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return;
      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartX.current = null;
        return;
      }
      // Skip swipe if touch started inside the 3D viewer canvas
      const target = e.target as HTMLElement;
      if (target?.closest?.('.project-presentation__viewer canvas')) {
        touchStartX.current = null;
        return;
      }
      const dx = touch.clientX - touchStartX.current;
      touchStartX.current = null;
      if (Math.abs(dx) < 50) return; // threshold
      if (dx < 0) goNext();
      else goPrev();
    },
    [goNext, goPrev],
  );

  // Dispatch resize event when switching to 3D slide so R3F canvas recalculates
  useEffect(() => {
    if (currentSlide === 3 && useR3f) {
      // Small delay to let the slide become visible before resize
      const id = requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
      return () => cancelAnimationFrame(id);
    }
  }, [currentSlide, useR3f]);

  if (!open) return null;

  const slideLabels = ['Resumen', 'Planta', 'Opciones', 'Vista 3D'];


  return (
    <div
      className="project-presentation"
      data-testid="project-presentation-mode"
      role="dialog"
      aria-modal="true"
      aria-label={`Presentación: ${project.name}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <header className="project-presentation__header">
        <div>
          {workshopName ? (
            <p className="project-presentation__workshop-name">
              {workshopName}
            </p>
          ) : null}
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

      {multiSpacePresentation ? (
        <div
          className="project-presentation__space-tabs"
          role="tablist"
          aria-label="Ambiente en presentación"
          data-testid="presentation-space-tabs"
        >
          {presentationSpaces.map((s) => {
            const active = s.id === presentationSpaceId;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? 'project-presentation__space-tab project-presentation__space-tab--active'
                    : 'project-presentation__space-tab'
                }
                onClick={() => setPresentationSpaceId(s.id)}
                data-testid={`presentation-space-tab-${s.id}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className="project-presentation__slides"
        data-testid="presentation-slides"
      >
        {/* Slide 0: Resumen */}
        <div
          className={`project-presentation__slide${
            currentSlide === 0 ? ' project-presentation__slide--active' : ''
          }`}
          aria-hidden={currentSlide !== 0}
          data-testid="presentation-slide-0"
        >
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
            {!preview.empty ? (
              <div className="project-presentation__hero-cta">
                <p className="project-presentation__hint project-presentation__hint--flush">
                  La cotización tiene vista 3D lista para mostrar al cliente.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setCurrentSlide(3)}
                  data-testid="presentation-goto-3d"
                >
                  Ver vista 3D
                </button>
              </div>
            ) : null}
          </section>
        </div>

        {/* Slide 1: Planta 2D */}
        <div
          className={`project-presentation__slide${
            currentSlide === 1 ? ' project-presentation__slide--active' : ''
          }`}
          aria-hidden={currentSlide !== 1}
          data-testid="presentation-slide-1"
        >
          <section
            className="project-presentation__plan"
            aria-label="Planta"
          >
            <h2 className="project-presentation__section-title">Planta</h2>
            <PresentationKitchenPlanSlide
              project={project}
              modules={modules}
              selectedSpaceId={presentationSpaceId}
              onSelectedSpaceIdChange={setPresentationSpaceId}
              onGoToProyectar={onGoToProyectar}
            />
          </section>
        </div>

        {/* Slide 2: Opciones */}
        <div
          className={`project-presentation__slide${
            currentSlide === 2 ? ' project-presentation__slide--active' : ''
          }`}
          aria-hidden={currentSlide !== 2}
          data-testid="presentation-slide-2"
        >
          <section
            className="project-presentation__options"
            aria-label="Opciones seleccionadas"
          >
            <PresentationOptionsSlide
              project={project}
              modules={modules}
              optionGroups={optionGroups}
              catalog={{
                materials: catalog.materials,
                edges: catalog.edges,
                hardware: catalog.hardware,
              }}
              resolveMediaUrl={resolveMediaUrl}
            />
          </section>
        </div>

        {/* Slide 3: Vista 3D */}
        <div
          className={`project-presentation__slide project-presentation__slide--viewer${
            currentSlide === 3 ? ' project-presentation__slide--active' : ''
          }`}
          aria-hidden={currentSlide !== 3}
          data-testid="presentation-slide-3"
        >
          <section
            className="project-presentation__viewer"
            aria-label="Vista 3D"
          >
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
                  modules={explodedModules.map((m) => ({
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
                  }))}
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
        </div>
      </div>

      {flash ? (
        <div
          className={`project-presentation__flash project-presentation__flash--${flash.kind}`}
          role="status"
          aria-live="polite"
          data-testid="presentation-flash"
        >
          {flash.message}
        </div>
      ) : null}

      {/* Slide navigation footer */}
      <footer
        className="project-presentation__nav"
        role="navigation"
        aria-label="Navegación de diapositivas"
      >
        <button
          type="button"
          className="btn btn--ghost project-presentation__nav-btn"
          onClick={goPrev}
          disabled={currentSlide === 0}
          aria-label="Diapositiva anterior"
          data-testid="presentation-prev-slide"
        >
          ← Anterior
        </button>
        <div
          className="project-presentation__nav-tabs"
          role="tablist"
          aria-label="Diapositivas"
        >
          {slideLabels.map((label, i) => {
            const active = currentSlide === i;
            return (
              <button
                key={i}
                type="button"
                className={
                  active
                    ? 'project-presentation__nav-tab project-presentation__nav-tab--active'
                    : 'project-presentation__nav-tab'
                }
                onClick={() => setCurrentSlide(i)}
                role="tab"
                aria-selected={active}
                aria-label={`${label} (diapositiva ${i + 1} de ${TOTAL_SLIDES})`}
                data-testid={`presentation-slide-tab-${i}`}
              >
                <span className="project-presentation__nav-tab-index" aria-hidden>
                  {i + 1}
                </span>
                <span className="project-presentation__nav-tab-label">{label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn--ghost project-presentation__nav-btn"
          onClick={goNext}
          disabled={currentSlide === TOTAL_SLIDES - 1}
          aria-label="Siguiente diapositiva"
          data-testid="presentation-next-slide"
        >
          Siguiente →
        </button>
        <span
          className="project-presentation__nav-counter"
          aria-live="polite"
          data-testid="presentation-nav-status"
        >
          {slideLabels[currentSlide]} · {currentSlide + 1} / {TOTAL_SLIDES}
        </span>
      </footer>
      {/* Keyboard shortcuts overlay */}
      {showShortcuts ? (
        <div
          className="project-presentation__shortcuts-overlay"
          role="dialog"
          aria-label="Atajos de teclado"
          data-testid="presentation-shortcuts-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowShortcuts(false); }}
        >
          <div className="project-presentation__shortcuts-card">
            <div className="project-presentation__shortcuts-header">
              <Keyboard size={18} strokeWidth={1.5} aria-hidden />
              <span>Atajos de teclado</span>
              <button
                type="button"
                className="btn btn--ghost project-presentation__shortcuts-close"
                onClick={() => setShowShortcuts(false)}
                aria-label="Cerrar ayuda"
              >
                <X size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            <ul className="project-presentation__shortcuts-list">
              <li>
                <kbd>→</kbd> <kbd>←</kbd> Navegar diapositivas
              </li>
              <li>
                <kbd>?</kbd> Mostrar / ocultar esta ayuda
              </li>
              <li>
                <kbd>Esc</kbd> Salir de la presentación
              </li>
              <li>Deslizá izquierda / derecha para cambiar diapositiva</li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
