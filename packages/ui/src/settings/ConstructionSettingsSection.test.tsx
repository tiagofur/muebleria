/**
 * ConstructionSettingsSection tests (#875).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConstructionSettingsSection } from './ConstructionSettingsSection';
import { DEFAULT_FACTORY_CONSTRUCTION_POLICY, type FactoryConstructionPolicy } from '@granete/domain';

afterEach(() => cleanup());

describe('ConstructionSettingsSection (#875)', () => {
  it('renders default factory policy with Granete Standard provenance badges', () => {
    const onChange = vi.fn();
    render(
      <ConstructionSettingsSection
        policy={DEFAULT_FACTORY_CONSTRUCTION_POLICY}
        activeOverlay={null}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('settings-section-construction')).toBeTruthy();
    expect(screen.getByTestId('overlay-active-badge').textContent).toContain('Estándar Granete (Heredado)');
    expect(screen.getByTestId('floor-provenance-badge').textContent).toBe('Estándar');
    expect(screen.getByTestId('top-provenance-badge').textContent).toBe('Estándar');
    expect(screen.getByTestId('shelf-provenance-badge').textContent).toBe('Estándar');
    expect(screen.getByTestId('back-provenance-badge').textContent).toBe('Estándar');

    // No restore button when already standard
    expect(screen.queryByTestId('restore-floor-inheritance')).toBeNull();
  });

  it('allows changing floor joinery system and stations count', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConstructionSettingsSection
        policy={DEFAULT_FACTORY_CONSTRUCTION_POLICY}
        activeOverlay={null}
        onChange={onChange}
      />,
    );

    const systemSelect = screen.getByTestId('floor-system-select');
    await user.selectOptions(systemSelect, 'screw-only');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        floorToSide: expect.objectContaining({
          systemId: 'screw-only',
          provenance: 'factory',
        }),
      }),
    );
  });

  it('renders restore inheritance button when customized and triggers restore', async () => {
    const user = userEvent.setup();
    const customizedPolicy: FactoryConstructionPolicy = {
      ...DEFAULT_FACTORY_CONSTRUCTION_POLICY,
      floorToSide: {
        ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
        systemId: 'screw-only',
        stationsCount: 4,
        provenance: 'factory',
      },
    };

    const onChange = vi.fn();
    render(
      <ConstructionSettingsSection
        policy={customizedPolicy}
        activeOverlay={{
          id: '11111111-1111-1111-1111-111111111111',
          organizationId: '22222222-2222-2222-2222-222222222222',
          libraryId: '00000000-0000-0000-0000-000000000001',
          baseReleaseId: '33333333-3333-3333-3333-333333333333',
          status: 'active',
          overrides: {},
          customResourceIds: [],
          createdAt: '2026-09-30T12:00:00Z',
          updatedAt: '2026-09-30T12:00:00Z',
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('floor-provenance-badge').textContent).toBe('Fábrica');
    const restoreBtn = screen.getByTestId('restore-floor-inheritance');
    expect(restoreBtn).toBeTruthy();

    await user.click(restoreBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        floorToSide: expect.objectContaining({
          provenance: 'library',
        }),
      }),
    );
  });

  it('displays validation alert when policy values violate constraints', () => {
    const invalidPolicy: FactoryConstructionPolicy = {
      ...DEFAULT_FACTORY_CONSTRUCTION_POLICY,
      floorToSide: {
        ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
        stationsCount: 0, // Invalid: < 1
        startMarginMm: 5, // Invalid: < 10
      },
    };

    render(
      <ConstructionSettingsSection
        policy={invalidPolicy}
        activeOverlay={null}
        onChange={vi.fn()}
      />,
    );

    const alert = screen.getByTestId('construction-validation-alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('floorToSide: stationsCount');
    expect(alert.textContent).toContain('floorToSide: startMarginMm');
  });
});
