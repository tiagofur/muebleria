/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowcaseScreen } from './ShowcaseScreen';

describe('ShowcaseScreen', () => {
  afterEach(cleanup);

  it('switches between Portfolio and Modules tabs', async () => {
    const user = userEvent.setup();
    render(
      <ShowcaseScreen
        photos={[]}
        modules={[]}
      />,
    );

    expect(screen.getByTestId('showcase-screen')).toBeTruthy();
    expect(screen.getByTestId('showcase-tab-portfolio')).toBeTruthy();
    expect(screen.getByTestId('showcase-tab-modules')).toBeTruthy();

    // Starts on portfolio
    expect(screen.getByTestId('projects-portfolio-view')).toBeTruthy();

    // Switch to modules
    await user.click(screen.getByTestId('showcase-tab-modules'));
    expect(screen.queryByTestId('projects-portfolio-view')).toBeNull();
  });

  it('tabs follow the shared tablist contract (roles, linkage, roving arrows)', async () => {
    const user = userEvent.setup();
    render(
      <ShowcaseScreen
        photos={[]}
        modules={[]}
      />,
    );

    const tablist = screen.getByTestId('showcase-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.getAttribute('aria-label')).toBe(
      'Vistas de la Vitrina Comercial',
    );

    const portfolioTab = screen.getByTestId('showcase-tab-portfolio');
    const modulesTab = screen.getByTestId('showcase-tab-modules');
    expect(portfolioTab.getAttribute('role')).toBe('tab');
    expect(portfolioTab.getAttribute('aria-selected')).toBe('true');
    expect(portfolioTab.getAttribute('tabIndex')).toBe('0');
    expect(modulesTab.getAttribute('tabIndex')).toBe('-1');

    // Panel linkage: aria-controls ↔ tabpanel id ↔ aria-labelledby
    expect(portfolioTab.getAttribute('aria-controls')).toBe(
      'showcase-panel-portfolio',
    );
    const panel = document.getElementById('showcase-panel-portfolio');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(
      'showcase-tab-portfolio',
    );

    // Roving arrows move selection with focus
    await user.keyboard('{Tab}');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(modulesTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(modulesTab);
    const modulesPanel = document.getElementById('showcase-panel-modules');
    expect(modulesPanel?.getAttribute('aria-labelledby')).toBe(
      'showcase-tab-modules',
    );
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(portfolioTab.getAttribute('aria-selected')).toBe('true');
  });
});
