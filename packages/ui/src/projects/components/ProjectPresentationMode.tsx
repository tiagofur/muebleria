/**
 * Client-facing presentation mode for a quote (#136).
 * 4 slides: Resumen → Planta → Opciones → Vista 3D.
 * Client chrome by default; workshop tools behind "Modo taller".
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Customer,
  Module,
  OptionGroup,
  Project,
} from '@muebles/domain';
import {
  ensureKitchenSpaces,
  projectScopedToProductionSpace,
} from '@muebles/domain';
import { FullscreenDialog } from '../../common';
import { WorkspaceTabs } from '../../common/Tabs';
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
import { PresentationHeader } from './presentation/PresentationHeader';
import { PresentationSummarySlide } from './presentation/PresentationSummarySlide';
import { Presentation3DViewSlide } from './presentation/Presentation3DViewSlide';
import { PresentationNavFooter } from './presentation/PresentationNavFooter';
import { PresentationShortcutsModal } from './presentation/PresentationShortcutsModal';
import { resolveProject3DPreview } from '../../preview3d/project3dPreview';

const TOTAL_SLIDES = 4;
const SLIDE_LABELS = ['Resumen', 'Planta', 'Opciones', 'Vista 3D'] as const;

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
      if (e.key === '?' || e.key === '¿') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        if (showShortcuts) {
          setShowShortcuts(false);
        } else {
          onClose();
        }
        return;
      }
      if (showShortcuts) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="tablist"]')) return;
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

  useEffect(() => {
    if (!open || !prefer3dHero) return;
    if (!preview.empty) {
      setCurrentSlide(3);
    }
  }, [open, prefer3dHero, preview.empty, project.id]);

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

  const sceneWalls = useMemo(
    () =>
      (preview?.walls ?? []).map((w) => ({
        id: w.id,
        originXMm: w.originXMm,
        originYMm: w.originYMm,
        endXMm: w.endXMm,
        endYMm: w.endYMm,
        heightMm: 2400,
        wallMaterialId: w.wallMaterialId,
      })),
    [preview?.walls],
  );

  const ambientFloor = useMemo(() => {
    const id = presentationProject?.kitchenLayout?.floorMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, presentationProject?.kitchenLayout?.floorMaterialId]);

  const ambientWall = useMemo(() => {
    const id = presentationProject?.kitchenLayout?.wallMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, presentationProject?.kitchenLayout?.wallMaterialId]);

  const ambientCeiling = useMemo(() => {
    const id = presentationProject?.kitchenLayout?.ceilingMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, presentationProject?.kitchenLayout?.ceilingMaterialId]);

  const ambientCountertop = useMemo(() => {
    const id = presentationProject?.kitchenLayout?.countertopMaterialId;
    if (!id) return undefined;
    return catalog.ambientMaterials?.find((m) => m.id === id);
  }, [catalog.ambientMaterials, presentationProject?.kitchenLayout?.countertopMaterialId]);

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
      const target = e.target as HTMLElement;
      if (target?.closest?.('.project-presentation__viewer canvas')) {
        touchStartX.current = null;
        return;
      }
      const dx = touch.clientX - touchStartX.current;
      touchStartX.current = null;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) goNext();
      else goPrev();
    },
    [goNext, goPrev],
  );

  useEffect(() => {
    if (currentSlide === 3 && useR3f) {
      const id = requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
      return () => cancelAnimationFrame(id);
    }
  }, [currentSlide, useR3f]);

  if (!open) return null;

  return (
    <FullscreenDialog
      open={open}
      onClose={onClose}
      title={`Presentación: ${project.name}`}
      escapeEnabled={false}
      dataTestId="project-presentation-mode"
    >
      <div
        className="project-presentation"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <PresentationHeader
          workshopName={workshopName}
          projectName={project.name}
          customerName={customerName}
          salePrice={salePrice}
          currency={project.currency}
          onClose={onClose}
        />

        {multiSpacePresentation ? (
          <div className="project-presentation__space-tabs">
            <WorkspaceTabs
              tabs={presentationSpaces.map((s) => ({ id: s.id, label: s.name }))}
              activeTab={presentationSpaceId ?? presentationSpaces[0]!.id}
              onTabChange={setPresentationSpaceId}
              ariaLabel="Ambiente en presentación"
              idPrefix="presentation-space"
              testIdPrefix="presentation-space"
            />
          </div>
        ) : null}

        <div
          className="project-presentation__slides"
          data-testid="presentation-slides"
          role={multiSpacePresentation ? 'tabpanel' : undefined}
          id={
            multiSpacePresentation
              ? `presentation-space-panel-${presentationSpaceId ?? presentationSpaces[0]!.id}`
              : undefined
          }
          aria-labelledby={
            multiSpacePresentation
              ? `presentation-space-tab-${presentationSpaceId ?? presentationSpaces[0]!.id}`
              : undefined
          }
        >
          {/* Slide 0: Resumen */}
          <div
            className={`project-presentation__slide${
              currentSlide === 0 ? ' project-presentation__slide--active' : ''
            }`}
            aria-hidden={currentSlide !== 0}
            data-testid="presentation-slide-0"
            role={currentSlide === 0 ? 'tabpanel' : undefined}
            id={currentSlide === 0 ? 'presentation-slide-panel-0' : undefined}
            aria-labelledby={currentSlide === 0 ? 'presentation-slide-tab-0' : undefined}
          >
            <PresentationSummarySlide
              project={project}
              modules={modules}
              has3dScene={!preview.empty}
              onGoTo3D={() => setCurrentSlide(3)}
            />
          </div>

          {/* Slide 1: Planta 2D */}
          <div
            className={`project-presentation__slide${
              currentSlide === 1 ? ' project-presentation__slide--active' : ''
            }`}
            aria-hidden={currentSlide !== 1}
            data-testid="presentation-slide-1"
            role={currentSlide === 1 ? 'tabpanel' : undefined}
            id={currentSlide === 1 ? 'presentation-slide-panel-1' : undefined}
            aria-labelledby={currentSlide === 1 ? 'presentation-slide-tab-1' : undefined}
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
            role={currentSlide === 2 ? 'tabpanel' : undefined}
            id={currentSlide === 2 ? 'presentation-slide-panel-2' : undefined}
            aria-labelledby={currentSlide === 2 ? 'presentation-slide-tab-2' : undefined}
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
            role={currentSlide === 3 ? 'tabpanel' : undefined}
            id={currentSlide === 3 ? 'presentation-slide-panel-3' : undefined}
            aria-labelledby={currentSlide === 3 ? 'presentation-slide-tab-3' : undefined}
          >
            <Presentation3DViewSlide
              project={project}
              presentationProject={presentationProject}
              catalog={catalog}
              preview={preview}
              useR3f={useR3f}
              surfaceMode={surfaceMode}
              setSurfaceMode={setSurfaceMode}
              colorMode={colorMode}
              setColorMode={setColorMode}
              workshopTools={workshopTools}
              toggleWorkshopTools={toggleWorkshopTools}
              explodeFactor={explodeFactor}
              setExplodeFactor={setExplodeFactor}
              showOutlines={showOutlines}
              setShowOutlines={setShowOutlines}
              measureMode={measureMode}
              setMeasureMode={setMeasureMode}
              exportMenuOpen={exportMenuOpen}
              setExportMenuOpen={setExportMenuOpen}
              exportFormat={exportFormat}
              setExportFormat={setExportFormat}
              handleCapturePng={handleCapturePng}
              handleShareLink={handleShareLink}
              linkCopied={linkCopied}
              setClientMode={setClientMode}
              onGoToProyectar={onGoToProyectar}
              explodedModules={explodedModules}
              sceneWalls={sceneWalls}
              ambientFloor={ambientFloor}
              ambientWall={ambientWall}
              ambientCeiling={ambientCeiling}
              ambientCountertop={ambientCountertop}
              materialColors={materialColors}
              materialTextures={materialTextures}
            />
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

        <PresentationNavFooter
          currentSlide={currentSlide}
          totalSlides={TOTAL_SLIDES}
          slideLabels={SLIDE_LABELS}
          onPrev={goPrev}
          onNext={goNext}
          onSelectSlide={setCurrentSlide}
        />

        <PresentationShortcutsModal
          open={showShortcuts}
          onClose={() => setShowShortcuts(false)}
        />
      </div>
    </FullscreenDialog>
  );
}
