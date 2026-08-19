import { useState, useMemo, type ReactNode } from 'react';
import type { ShowcasePhotoItem, ProjectPhotoStage } from '@muebles/domain';
import {
  filterShowcasePhotos,
} from '@muebles/domain';
import {
  Eye,
  EyeOff,
  Star,
  Search,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  X,
  PlusCircle,
  ImageIcon,
} from 'lucide-react';
import { EmptyState, SearchInput, useDebouncedValue } from '../common';
import './projectsPortfolio.css';

export interface ProjectsPortfolioViewProps {
  readonly photos: readonly ShowcasePhotoItem[];
  /** Resolve relative URL paths (e.g. /api/media/...) with baseUrl or auth headers. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  /** Sales CTA: navigate to create a project or quote based on this reference. */
  readonly onUseAsReference?: (projectId: string) => void;
  readonly isLoading?: boolean;
}

const STAGE_NAMES: Record<ProjectPhotoStage, string> = {
  survey: 'Relevamiento',
  in_workshop: 'En Taller',
  installed: 'Instalado',
  delivery_receipt: 'Acta de Entrega',
};

export function ProjectsPortfolioView({
  photos,
  resolveImageUrl = (u) => u,
  onUseAsReference,
  isLoading = false,
}: ProjectsPortfolioViewProps): ReactNode {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [stageFilter, setStageFilter] = useState<ProjectPhotoStage | 'all'>('all');
  const [onlyShowcase, setOnlyShowcase] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  const filteredPhotos = useMemo(() => {
    return filterShowcasePhotos(photos, {
      query: debouncedQuery,
      stage: stageFilter,
      onlyShowcase,
    });
  }, [photos, debouncedQuery, stageFilter, onlyShowcase]);

  const activePhoto = selectedPhotoIndex !== null ? filteredPhotos[selectedPhotoIndex] : null;

  const handleNext = () => {
    if (selectedPhotoIndex === null) return;
    setSelectedPhotoIndex((selectedPhotoIndex + 1) % filteredPhotos.length);
  };

  const handlePrev = () => {
    if (selectedPhotoIndex === null) return;
    setSelectedPhotoIndex(
      (selectedPhotoIndex - 1 + filteredPhotos.length) % filteredPhotos.length,
    );
  };

  return (
    <div className="portfolio-view" data-testid="projects-portfolio-view">
      <div className="portfolio-controls">
        <div className="portfolio-filters" role="group" aria-label="Filtros de fotos">
          <button
            type="button"
            className={`portfolio-filter-btn ${
              stageFilter === 'all' && !onlyShowcase ? 'portfolio-filter-btn--active' : ''
            }`}
            onClick={() => {
              setStageFilter('all');
              setOnlyShowcase(false);
            }}
            data-testid="filter-all"
          >
            Todas ({photos.length})
          </button>
          <button
            type="button"
            className={`portfolio-filter-btn ${
              onlyShowcase ? 'portfolio-filter-btn--active' : ''
            }`}
            onClick={() => setOnlyShowcase(!onlyShowcase)}
            data-testid="filter-showcase"
          >
            <Star size={14} className={onlyShowcase ? 'portfolio-star portfolio-star--active' : 'portfolio-star'} />
            Destacadas ({photos.filter((p) => p.isShowcase).length})
          </button>
          <button
            type="button"
            className={`portfolio-filter-btn ${
              stageFilter === 'installed' ? 'portfolio-filter-btn--active' : ''
            }`}
            onClick={() => setStageFilter(stageFilter === 'installed' ? 'all' : 'installed')}
            data-testid="filter-installed"
          >
            Instaladas / Terminadas
          </button>
          <button
            type="button"
            className={`portfolio-filter-btn ${
              stageFilter === 'in_workshop' ? 'portfolio-filter-btn--active' : ''
            }`}
            onClick={() => setStageFilter(stageFilter === 'in_workshop' ? 'all' : 'in_workshop')}
            data-testid="filter-workshop"
          >
            En Taller
          </button>
          <button
            type="button"
            className={`portfolio-filter-btn ${
              stageFilter === 'survey' ? 'portfolio-filter-btn--active' : ''
            }`}
            onClick={() => setStageFilter(stageFilter === 'survey' ? 'all' : 'survey')}
            data-testid="filter-survey"
          >
            Relevamiento (Antes)
          </button>
        </div>

        <div style={{ minWidth: '240px' }}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por proyecto, acabado o detalle..."
            data-testid="portfolio-search-input"
          />
        </div>

        <button
          type="button"
          className={`portfolio-presentation-toggle ${
            isPresentationMode ? 'portfolio-presentation-toggle--active' : ''
          }`}
          onClick={() => setIsPresentationMode(!isPresentationMode)}
          title="Oculta nombres de clientes y datos privados para mostrar en tablet/showroom"
          data-testid="portfolio-presentation-mode-toggle"
        >
          {isPresentationMode ? (
            <>
              <EyeOff size={16} aria-hidden />
              <span>Modo Showroom / Cliente (Activo)</span>
            </>
          ) : (
            <>
              <Eye size={16} aria-hidden />
              <span>Modo Showroom / Cliente</span>
            </>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="portfolio-grid">
          <p className="text-secondary">Cargando portafolio comercial...</p>
        </div>
      ) : filteredPhotos.length === 0 ? (
        <EmptyState
          title="No hay fotos en el portafolio"
          description={
            query || stageFilter !== 'all' || onlyShowcase
              ? 'No se encontraron fotos que coincidan con los filtros seleccionados.'
              : 'Sube fotos en la pestaña "Fotos de Obra" de cualquier proyecto y márcalas con la estrella para destacarlas aquí.'
          }
          icon={ImageIcon}
          data-testid="portfolio-empty-state"
        />
      ) : (
        <div className="portfolio-grid" data-testid="portfolio-grid">
          {filteredPhotos.map((photo, idx) => {
            const imgUrl = resolveImageUrl(photo.thumbnailUrl || photo.url);
            return (
              <article
                key={photo.id}
                className="portfolio-card"
                onClick={() => setSelectedPhotoIndex(idx)}
                data-testid={`portfolio-card-${photo.id}`}
              >
                <div className="portfolio-card-media">
                  <img
                    src={imgUrl}
                    alt={photo.caption || photo.projectName}
                    className="portfolio-card-img"
                    loading="lazy"
                  />
                  <div className="portfolio-card-badges">
                    {photo.isShowcase ? (
                      <span className="portfolio-badge portfolio-badge--showcase">
                        <Star size={10} className="fill-white" /> Destacado
                      </span>
                    ) : null}
                    <span className="portfolio-badge">
                      {STAGE_NAMES[photo.stage] || photo.stage}
                    </span>
                  </div>
                </div>

                <div className="portfolio-card-body">
                  <h3 className="portfolio-card-title">{photo.projectName}</h3>
                  {!isPresentationMode && photo.customerName ? (
                    <p className="portfolio-card-meta">Cliente: {photo.customerName}</p>
                  ) : null}
                  {photo.caption ? (
                    <p className="portfolio-card-caption">{photo.caption}</p>
                  ) : (
                    <p className="portfolio-card-caption text-muted">
                      Proyecto finalizado e instalado
                    </p>
                  )}

                  <div className="portfolio-card-footer">
                    <span>
                      {new Date(photo.createdAt).toLocaleDateString('es-MX', {
                        year: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      title="Ver en pantalla completa"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPhotoIndex(idx);
                      }}
                    >
                      <Maximize2 size={14} /> Ampliar
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {activePhoto ? (
        <div
          className="portfolio-lightbox"
          role="dialog"
          aria-modal="true"
          data-testid="portfolio-lightbox"
        >
          <div className="portfolio-lightbox-header">
            <div>
              <h3 className="portfolio-lightbox-title">{activePhoto.projectName}</h3>
              {!isPresentationMode && activePhoto.customerName ? (
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                  Cliente: {activePhoto.customerName}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn--ghost text-white"
              onClick={() => setSelectedPhotoIndex(null)}
              data-testid="portfolio-lightbox-close"
              aria-label="Cerrar vista"
            >
              <X size={24} />
            </button>
          </div>

          <div className="portfolio-lightbox-content">
            {filteredPhotos.length > 1 ? (
              <button
                type="button"
                className="btn btn--ghost text-white"
                style={{ position: 'absolute', left: '1rem', zIndex: 10 }}
                onClick={handlePrev}
                aria-label="Foto anterior"
                data-testid="portfolio-lightbox-prev"
              >
                <ChevronLeft size={36} />
              </button>
            ) : null}

            <img
              src={resolveImageUrl(activePhoto.url)}
              alt={activePhoto.caption || activePhoto.projectName}
              className="portfolio-lightbox-img"
            />

            {filteredPhotos.length > 1 ? (
              <button
                type="button"
                className="btn btn--ghost text-white"
                style={{ position: 'absolute', right: '1rem', zIndex: 10 }}
                onClick={handleNext}
                aria-label="Foto siguiente"
                data-testid="portfolio-lightbox-next"
              >
                <ChevronRight size={36} />
              </button>
            ) : null}
          </div>

          <div className="portfolio-lightbox-footer">
            <div>
              <span className="portfolio-badge" style={{ marginBottom: '6px', display: 'inline-block' }}>
                {STAGE_NAMES[activePhoto.stage]}
              </span>
              <p className="portfolio-lightbox-caption">
                {activePhoto.caption || 'Foto del proyecto'}
              </p>
            </div>

            {onUseAsReference ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const pId = activePhoto.projectId;
                  setSelectedPhotoIndex(null);
                  onUseAsReference(pId);
                }}
                data-testid="portfolio-use-reference-btn"
              >
                <PlusCircle size={16} /> Cotizar diseño similar
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
