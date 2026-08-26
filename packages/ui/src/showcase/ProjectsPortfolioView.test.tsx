/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import userEvent from '@testing-library/user-event';
import type { ShowcasePhotoItem } from '@granete/domain';
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

  /* ── FullscreenDialog migration (F110) ───────────────── */

  it('lightbox is a dialog named after the project (aria-labelledby)', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);
    await user.click(screen.getByTestId('portfolio-card-photo-1'));

    const dialog = screen.getByTestId('portfolio-lightbox');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const titleEl = dialog.ownerDocument.getElementById(labelledBy!);
    expect(titleEl?.textContent).toContain('Cocina Isla Granito');
  });

  it('Escape closes the lightbox and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);
    const trigger = screen.getAllByRole('button', { name: 'Ampliar' })[0]!;
    await user.click(trigger);
    expect(screen.getByTestId('portfolio-lightbox')).toBeTruthy();

    // FullscreenDialog listens on document.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('portfolio-lightbox')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('close button is labeled for screen readers', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);
    await user.click(screen.getByTestId('portfolio-card-photo-1'));
    expect(
      screen.getByTestId('portfolio-lightbox-close').getAttribute('aria-label'),
    ).toBe('Cerrar vista');
  });

  it('arrow keys navigate photos without leaving the lightbox', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);
    await user.click(screen.getByTestId('portfolio-card-photo-1'));
    expect(screen.getAllByText('Isla de 2.40m con desayunador').length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getAllByText('Hueco de obra para embutir').length).toBeGreaterThan(0);
    expect(screen.getByTestId('portfolio-lightbox')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getAllByText('Isla de 2.40m con desayunador').length).toBeGreaterThan(0);
  });

  it('Tab is trapped inside the lightbox (cycles, does not escape)', async () => {
    const user = userEvent.setup();
    render(<ProjectsPortfolioView photos={MOCK_PHOTOS} />);
    await user.click(screen.getByTestId('portfolio-card-photo-1'));

    const dialog = screen.getByTestId('portfolio-lightbox');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button'),
    ).filter((b) => !b.hasAttribute('disabled'));
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

