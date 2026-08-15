/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import userEvent from '@testing-library/user-event';
import type { ShowcasePhotoItem } from '@muebles/domain';
import { ProjectsPortfolioView } from './ProjectsPortfolioView';

const MOCK_PHOTOS: ShowcasePhotoItem[] = [
  {
    id: 'photo-1',
    projectId: 'proj-1',
    projectName: 'Cocina Isla Granito',
    customerName: 'Maria Lopez',
    stage: 'installed',
    url: '/api/media/p1.webp',
    thumbnailUrl: '/api/media/p1-thumb.webp',
    caption: 'Isla de 2.40m con desayunador',
    isShowcase: true,
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'photo-2',
    projectId: 'proj-2',
    projectName: 'Placard Melamina Nogal',
    customerName: 'Carlos Gomez',
    stage: 'survey',
    url: '/api/media/p2.webp',
    caption: 'Hueco de obra para embutir',
    isShowcase: false,
    createdAt: '2026-08-02T00:00:00Z',
  },
];

afterEach(() => cleanup());

describe('ProjectsPortfolioView', () => {
  it('renders photo cards with titles and badges', () => {
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);

    expect(screen.getByTestId('projects-portfolio-view')).toBeTruthy();
    expect(screen.getByText('Cocina Isla Granito')).toBeTruthy();
    expect(screen.getByText('Placard Melamina Nogal')).toBeTruthy();
    expect(screen.getByText('Maria Lopez', { exact: false })).toBeTruthy();
    expect(screen.getByText('Destacado', { exact: false })).toBeTruthy();
  });


  it('filters by showcase and search query', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);

    // Filter by showcase
    await user.click(screen.getByTestId('filter-showcase'));
    expect(screen.getByText('Cocina Isla Granito')).toBeTruthy();
    expect(screen.queryByText('Placard Melamina Nogal')).toBeNull();

    // Reset and search
    await user.click(screen.getByTestId('filter-all'));
    const searchInput = screen.getByRole('searchbox');
    await user.type(searchInput, 'placard');

    // Wait for debounced search
    await waitFor(() => {
      expect(screen.getByText('Placard Melamina Nogal')).toBeTruthy();
      expect(screen.queryByText('Cocina Isla Granito')).toBeNull();
    });
  });


  it('toggles presentation mode to hide customer names', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);

    expect(screen.queryByText('Maria Lopez', { exact: false })).toBeTruthy();

    await user.click(screen.getByTestId('portfolio-presentation-mode-toggle'));

    expect(screen.queryByText('Maria Lopez', { exact: false })).toBeNull();
  });

  it('opens and closes fullscreen lightbox with reference CTA', async () => {
    const user = userEvent.setup();
    const onUseRef = vi.fn();
    render(
      <ProjectsPortfolioView
        photos={MOCK_PHOTOS}
        onUseAsReference={onUseRef}
      />,
    );

    await user.click(screen.getByTestId('portfolio-card-photo-1'));

    expect(screen.getByTestId('portfolio-lightbox')).toBeTruthy();
    expect(screen.getAllByText('Isla de 2.40m con desayunador').length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByTestId('portfolio-use-reference-btn'));
    expect(onUseRef).toHaveBeenCalledWith('proj-1');
  });
});

