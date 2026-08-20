/**
 * Navigation footer for ProjectPresentationMode.
 */

import type { ReactNode } from 'react';
import { WorkspaceTabs } from '../../../common/Tabs';

export interface PresentationNavFooterProps {
  readonly currentSlide: number;
  readonly totalSlides: number;
  readonly slideLabels: readonly string[];
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onSelectSlide: (index: number) => void;
}

export function PresentationNavFooter({
  currentSlide,
  totalSlides,
  slideLabels,
  onPrev,
  onNext,
  onSelectSlide,
}: PresentationNavFooterProps): ReactNode {
  return (
    <footer
      className="project-presentation__nav"
      role="navigation"
      aria-label="Navegación de diapositivas"
    >
      <button
        type="button"
        className="btn btn--ghost project-presentation__nav-btn"
        onClick={onPrev}
        disabled={currentSlide === 0}
        aria-label="Diapositiva anterior"
        data-testid="presentation-prev-slide"
      >
        ← Anterior
      </button>
      <div className="project-presentation__nav-tabs">
        <WorkspaceTabs
          tabs={slideLabels.map((label, i) => ({
            id: String(i),
            label: `${i + 1}. ${label}`,
          }))}
          activeTab={String(currentSlide)}
          onTabChange={(id) => onSelectSlide(Number(id))}
          ariaLabel="Diapositivas"
          idPrefix="presentation-slide"
          testIdPrefix="presentation-slide"
        />
      </div>
      <button
        type="button"
        className="btn btn--ghost project-presentation__nav-btn"
        onClick={onNext}
        disabled={currentSlide === totalSlides - 1}
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
        {slideLabels[currentSlide]} · {currentSlide + 1} / {totalSlides}
      </span>
    </footer>
  );
}
