// @vitest-environment jsdom
/**
 * ActiveBadge tests — single status-badge vocabulary (design.md §5.2, F111).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActiveBadge } from './CatalogTable';

describe('ActiveBadge (status-badge vocabulary, §5.2)', () => {
  afterEach(cleanup);

  it('renders active state with status-badge--active, dot and label', () => {
    render(<ActiveBadge active={true} />);
    const badge = screen.getByText('Activo');
    expect(badge.className).toContain('status-badge--active');
    expect(badge.querySelector('.status-badge__dot')).not.toBeNull();
  });

  it('renders inactive state with status-badge--inactive, dot and label', () => {
    render(<ActiveBadge active={false} />);
    const badge = screen.getByText('Inactivo');
    expect(badge.className).toContain('status-badge--inactive');
    expect(badge.querySelector('.status-badge__dot')).not.toBeNull();
  });

  it('does not use the legacy catalog-badge family', () => {
    const { container } = render(<ActiveBadge active={true} />);
    expect(container.querySelector('.catalog-badge')).toBeNull();
    expect(container.querySelector('.status-badge--active')).not.toBeNull();
  });
});
