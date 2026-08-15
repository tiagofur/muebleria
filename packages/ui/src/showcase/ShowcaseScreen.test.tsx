/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowcaseScreen } from './ShowcaseScreen';

describe('ShowcaseScreen', () => {
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
});
