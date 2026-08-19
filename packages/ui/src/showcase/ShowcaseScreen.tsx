import { useState, type ReactNode } from 'react';
import type { Module, ModuleCategory, ShowcasePhotoItem } from '@muebles/domain';
import { Sparkles, Boxes, Store } from 'lucide-react';
import { PageHeader, PageToolbar } from '../common';
import { WorkspaceTabs } from '../common/Tabs';
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
          <WorkspaceTabs
            tabs={[
              {
                id: 'portfolio' as const,
                label: 'Portafolio de Obras',
                count: photos.length,
                icon: <Sparkles size={16} aria-hidden />,
              },
              {
                id: 'modules' as const,
                label: 'Catálogo de Módulos',
                count: modules.length,
                icon: <Boxes size={16} aria-hidden />,
              },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            ariaLabel="Vistas de la Vitrina Comercial"
            idPrefix="showcase"
            testIdPrefix="showcase"
          />
        }
      />

      <div
        className="showcase-screen-body"
        role="tabpanel"
        id={`showcase-panel-${activeTab}`}
        aria-labelledby={`showcase-tab-${activeTab}`}
      >
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
