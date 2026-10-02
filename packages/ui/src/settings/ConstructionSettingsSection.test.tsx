/**
 * ConstructionSettingsSection tests (#875).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConstructionSettingsSection } from './ConstructionSettingsSection';
import { DEFAULT_FACTORY_CONSTRUCTION_POLICY, type FactoryConstructionPolicy } from '@granete/domain';
import type { LibraryReleaseSummary, LibraryOverlayConflictDetail } from '@granete/storage';

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
          version: 1,
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

  it('renders upstream update banner when hasUpstreamUpdate is true and triggers onRebase (#944)', async () => {
    const user = userEvent.setup();
    const onRebase = vi.fn();
    const mockLatest: LibraryReleaseSummary = {
      id: 'rel-2',
      libraryId: 'lib-std',
      version: '1.2.0',
      schemaVersion: 1,
      status: 'published',
      changelog: 'Nuevos ensambles reforzados',
      publishedAt: '2026-09-30T10:00:00Z',
      createdAt: '2026-09-30T10:00:00Z',
      updatedAt: '2026-09-30T10:00:00Z',
    };

    render(
      <ConstructionSettingsSection
        policy={DEFAULT_FACTORY_CONSTRUCTION_POLICY}
        activeOverlay={{
          id: 'overlay-1',
          organizationId: 'org-1',
          libraryId: 'lib-std',
          baseReleaseId: 'rel-1',
          status: 'active',
          overrides: {},
          customResourceIds: [],
          version: 1,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        hasUpstreamUpdate={true}
        latestRelease={mockLatest}
        onRebase={onRebase}
        onChange={vi.fn()}
      />,
    );

    const banner = screen.getByTestId('upstream-update-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Granete Estándar v1.2.0');
    expect(banner.textContent).toContain('Nuevos ensambles reforzados');

    const rebaseBtn = screen.getByTestId('rebase-library-btn');
    await user.click(rebaseBtn);
    expect(onRebase).toHaveBeenCalledWith('rel-2');
  });

  it('renders conflict resolution panel and triggers keep_custom or adopt_upstream (#944)', async () => {
    const user = userEvent.setup();
    const onResolveConflict = vi.fn();
    const mockConflict: LibraryOverlayConflictDetail = {
      id: 'conflict-xyz',
      overlayId: 'overlay-1',
      organizationId: 'org-1',
      oldBaseReleaseId: 'rel-1',
      newBaseReleaseId: 'rel-2',
      conflictType: 'same_field',
      path: 'joint.floorToSide.systemId',
      oldBaseValue: 'minifix-dowel',
      newBaseValue: 'dowel-only',
      customValue: 'screw-only',
      status: 'pending',
      resolutionAction: null,
      resolvedValue: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: '2026-09-30T12:00:00Z',
    };

    render(
      <ConstructionSettingsSection
        policy={DEFAULT_FACTORY_CONSTRUCTION_POLICY}
        activeOverlay={{
          id: 'overlay-1',
          organizationId: 'org-1',
          libraryId: 'lib-std',
          baseReleaseId: 'rel-1',
          status: 'rebase_conflict',
          overrides: {},
          customResourceIds: [],
          version: 1,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        conflicts={[mockConflict]}
        onResolveConflict={onResolveConflict}
        onChange={vi.fn()}
      />,
    );

    const panel = screen.getByTestId('rebase-conflicts-panel');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('joint.floorToSide.systemId');
    expect(panel.textContent).toContain('screw-only');
    expect(panel.textContent).toContain('dowel-only');

    const keepBtn = screen.getByTestId('btn-resolve-keep-conflict-xyz');
    await user.click(keepBtn);
    expect(onResolveConflict).toHaveBeenCalledWith('conflict-xyz', 'keep_custom');

    const adoptBtn = screen.getByTestId('btn-resolve-adopt-conflict-xyz');
    await user.click(adoptBtn);
    expect(onResolveConflict).toHaveBeenCalledWith('conflict-xyz', 'adopt_upstream');
  });

  it('renders releases history list with active badge and version switch buttons (#944)', async () => {
    const user = userEvent.setup();
    const onRebase = vi.fn();
    const releases: LibraryReleaseSummary[] = [
      {
        id: 'rel-2',
        libraryId: 'lib-std',
        version: '1.2.0',
        schemaVersion: 1,
        status: 'published',
        changelog: 'Versión actual',
        publishedAt: '2026-09-30T10:00:00Z',
        createdAt: '2026-09-30T10:00:00Z',
        updatedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: 'rel-1',
        libraryId: 'lib-std',
        version: '1.1.0',
        schemaVersion: 1,
        status: 'published',
        changelog: 'Versión anterior',
        publishedAt: '2026-09-15T10:00:00Z',
        createdAt: '2026-09-15T10:00:00Z',
        updatedAt: '2026-09-15T10:00:00Z',
      },
    ];

    render(
      <ConstructionSettingsSection
        policy={DEFAULT_FACTORY_CONSTRUCTION_POLICY}
        activeOverlay={{
          id: 'overlay-1',
          organizationId: 'org-1',
          libraryId: 'lib-std',
          baseReleaseId: 'rel-1',
          status: 'active',
          overrides: {},
          customResourceIds: [],
          version: 1,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        }}
        releases={releases}
        latestRelease={releases[0]}
        onRebase={onRebase}
        onChange={vi.fn()}
      />,
    );

    const historySection = screen.getByTestId('library-releases-history');
    expect(historySection).toBeTruthy();
    expect(historySection.textContent).toContain('v1.2.0');
    expect(historySection.textContent).toContain('v1.1.0');
    expect(screen.getByTestId('badge-active-1.1.0')).toBeTruthy();

    const switchBtn = screen.getByTestId('rebase-to-1.2.0-btn');
    await user.click(switchBtn);
    expect(onRebase).toHaveBeenCalledWith('rel-2');
  });
});
