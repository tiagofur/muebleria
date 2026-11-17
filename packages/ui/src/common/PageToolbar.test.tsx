/**
 * @vitest-environment jsdom
 *
 * #1643: el slot `lead` es ADITIVO — sin lead el DOM es idéntico al de la
 * base (los otros catálogos no lo pasan); con lead se renderiza antes que
 * búsqueda/filtros para que la decisión primaria encabece la fila.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageToolbar } from './PageToolbar';

afterEach(cleanup);

describe('PageToolbar — slot lead (#1643)', () => {
  it('sin lead: search → filters → tabs en el orden histórico', () => {
    render(
      <PageToolbar
        ariaLabel="toolbar"
        search={<span data-testid="s" />}
        filters={<span data-testid="f" />}
        tabs={<span data-testid="t" />}
      />,
    );
    const order = [...screen.getByTestId('page-toolbar').children].map(
      (el) => el.className,
    );
    expect(order).toEqual([
      'page-toolbar__search',
      'page-toolbar__filters',
      'page-toolbar__tabs',
    ]);
  });

  it('con lead: encabeza la fila antes que la búsqueda', () => {
    render(
      <PageToolbar
        ariaLabel="toolbar"
        lead={<span data-testid="l" />}
        search={<span data-testid="s" />}
      />,
    );
    const bar = screen.getByTestId('page-toolbar');
    expect(bar.firstElementChild?.className).toBe('page-toolbar__lead');
    expect(
      bar
        .querySelector('.page-toolbar__lead')!
        .compareDocumentPosition(bar.querySelector('.page-toolbar__search')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
