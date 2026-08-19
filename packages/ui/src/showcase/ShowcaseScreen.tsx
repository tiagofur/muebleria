import { useState, type ReactNode } from 'react';
import type { Module, ModuleCategory, ShowcasePhotoItem } from '@muebles/domain';
import { Sparkles, Boxes, Store } from 'lucide-react';
import { PageHeader, PageToolbar } from '../common';
import { ModuleShowcase } from '../modules/ModuleShowcase';
import { ProjectsPortfolioView } from './ProjectsPortfolioView';

export interface ShowcaseScreenProps {
  readonly photos: readonly ShowcasePhotoItem[];
  readonly modules: readonly Module[];
  readonly categories?: readonly ModuleCategory[];
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  readonly onUseModuleInQuote?: (moduleId: string) => void;
  readonly onUseProjectAsReference?: (projectId: string) => void;
  readonly isLoadingPhotos?: boolean;
}

export function ShowcaseScreen({
  photos,
  modules,
  categories = [],
  resolveImageUrl = (u) => u,
  onUseModuleInQuote,
  onUseProjectAsReference,
  isLoadingPhotos = false,
}: ShowcaseScreenProps): ReactNode {
  const [activeTab, setActiveTab] = useState<'portfolio' | 'modules'>('portfolio');

  return (
    <div className="showcase-screen" data-testid="showcase-screen">
      <PageHeader
        title="Vitrina"
        subtitle="Catálogo visual para cotizar: obras terminadas y plantillas de muebles."
        icon={<Store size={16} strokeWidth={1.5} />}
      />

      <PageToolbar
        ariaLabel="Vistas de la vitrina"
        tabs={
          <nav
            className="tab-bar__inner"
            role="tablist"
            aria-label="Vistas de la Vitrina Comercial"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'portfolio'}
              className={
                activeTab === 'portfolio'
                  ? 'tab-btn tab-btn--active'
                  : 'tab-btn'
              }
              onClick={() => setActiveTab('portfolio')}
              data-testid="showcase-tab-portfolio"
            >
              <Sparkles size={16} aria-hidden />
              Portafolio de Obras ({photos.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'modules'}
              className={
                activeTab === 'modules'
                  ? 'tab-btn tab-btn--active'
                  : 'tab-btn'
              }
              onClick={() => setActiveTab('modules')}
              data-testid="showcase-tab-modules"
            >
              <Boxes size={16} aria-hidden />
              Catálogo de Módulos ({modules.length})
            </button>
          </nav>
        }
      />

      <div className="showcase-screen-body">
        {activeTab === 'portfolio' ? (
          <ProjectsPortfolioView
            photos={photos}
            resolveImageUrl={resolveImageUrl}
            onUseAsReference={onUseProjectAsReference}
            isLoading={isLoadingPhotos}
          />
        ) : (
          <ModuleShowcase
            modules={modules}
            categories={categories}
            resolveImageUrl={resolveImageUrl}
            onUseInQuote={onUseModuleInQuote}
          />
        )}
      </div>
    </div>
  );
}
