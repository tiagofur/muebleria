/**
 * ComponentEditorJoineryPanel tests (#875).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentEditorJoineryPanel } from './ComponentEditorJoineryPanel';
import { emptyComponentDraft, type ComponentDraft } from '../componentDraft';
import { DEFAULT_FACTORY_CONSTRUCTION_POLICY, type FactoryConstructionPolicy } from '@granete/domain';

afterEach(() => cleanup());

describe('ComponentEditorJoineryPanel (#875)', () => {
  it('renders with library provenance badge when no component or factory override exists', () => {
    const draft: ComponentDraft = {
      ...emptyComponentDraft(),
      placement: 'base',
    };
    const setDraft = vi.fn();

    render(
      <ComponentEditorJoineryPanel
        draft={draft}
        setDraft={setDraft}
        hidden={false}
        factoryPolicy={DEFAULT_FACTORY_CONSTRUCTION_POLICY}
      />,
    );

    const badge = screen.getByTestId('component-provenance-badge');
    expect(badge.textContent).toContain('Biblioteca (Estándar Granete)');
    expect(screen.queryByTestId('component-restore-inheritance-btn')).toBeNull();
  });

  it('renders with factory provenance badge when factory policy is customized but component is inherited', () => {
    const draft: ComponentDraft = {
      ...emptyComponentDraft(),
      placement: 'base',
    };
    const setDraft = vi.fn();
    const customFactoryPolicy: FactoryConstructionPolicy = {
      ...DEFAULT_FACTORY_CONSTRUCTION_POLICY,
      floorToSide: {
        ...DEFAULT_FACTORY_CONSTRUCTION_POLICY.floorToSide,
        provenance: 'factory',
      },
    };

    render(
      <ComponentEditorJoineryPanel
        draft={draft}
        setDraft={setDraft}
        hidden={false}
        factoryPolicy={customFactoryPolicy}
      />,
    );

    const badge = screen.getByTestId('component-provenance-badge');
    expect(badge.textContent).toContain('Fábrica (Overlay Activo)');
  });

  it('configures a local override, displays Componente badge, and allows restoring inheritance', async () => {
    const user = userEvent.setup();
    let currentDraft: ComponentDraft = {
      ...emptyComponentDraft(),
      code: 'PIEZA-PISO',
      placement: 'base',
      constructionOverride: {
        componentId: 'PIEZA-PISO',
        joinerySystemId: 'screw-only',
        stationsCount: 3,
        provenance: 'component',
      },
    };

    const setDraft = vi.fn((updater) => {
      if (typeof updater === 'function') {
        currentDraft = updater(currentDraft);
      }
    });

    const { rerender } = render(
      <ComponentEditorJoineryPanel
        draft={currentDraft}
        setDraft={setDraft}
        hidden={false}
      />,
    );

    const badge = screen.getByTestId('component-provenance-badge');
    expect(badge.textContent).toContain('Componente (Excepción)');

    const restoreBtn = screen.getByTestId('component-restore-inheritance-btn');
    expect(restoreBtn).toBeTruthy();

    await user.click(restoreBtn);

    expect(setDraft).toHaveBeenCalled();
    expect(currentDraft.constructionOverride).toBeUndefined();
  });

  it('toggles connection faces on and off', async () => {
    const user = userEvent.setup();
    let currentDraft: ComponentDraft = {
      ...emptyComponentDraft(),
      code: 'LATERAL-IZQ',
      placement: 'lateral_izquierdo',
      constructionOverride: {
        componentId: 'LATERAL-IZQ',
        connectionFaces: ['front'],
        provenance: 'component',
      },
    };

    const setDraft = vi.fn((updater) => {
      if (typeof updater === 'function') {
        currentDraft = updater(currentDraft);
      }
    });

    render(
      <ComponentEditorJoineryPanel
        draft={currentDraft}
        setDraft={setDraft}
        hidden={false}
      />,
    );

    // Front should be checked
    const frontCheck = screen.getByTestId('face-checkbox-front') as HTMLInputElement;
    expect(frontCheck.checked).toBe(true);

    // Back should be unchecked
    const backCheck = screen.getByTestId('face-checkbox-back') as HTMLInputElement;
    expect(backCheck.checked).toBe(false);

    // Toggle back on
    await user.click(backCheck);
    expect(setDraft).toHaveBeenCalled();
    expect(currentDraft.constructionOverride?.connectionFaces).toContain('back');
  });
});
