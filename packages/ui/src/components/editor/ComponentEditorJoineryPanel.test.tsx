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
    expect(badge.textContent).toContain('Biblioteca · estándar Granete');
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
    expect(badge.textContent).toContain('Fábrica · excepción de taller');
  });

  it('a dirty local override shows the unsaved hint and the explicit exception save', async () => {
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
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ComponentEditorJoineryPanel
        draft={currentDraft}
        setDraft={setDraft}
        hidden={false}
        constructionException={{
          componentId: 'comp-piso-1',
          canMutate: true,
          stored: null,
          saving: false,
          error: null,
          onSave,
        }}
      />,
    );

    // Server truth: nothing stored for this component yet — the badge stays
    // inherited and the dirty state asks for the explicit save.
    const badge = screen.getByTestId('component-provenance-badge');
    expect(badge.textContent).toContain('Biblioteca · estándar Granete');
    expect(screen.getByTestId('component-save-exception-btn')).toBeTruthy();

    await user.click(screen.getByTestId('component-save-exception-btn'));

    // The overlay entry carries ONLY the station scalars the engine consumes.
    expect(onSave).toHaveBeenCalledWith({
      componentId: 'comp-piso-1',
      stationsCount: 3,
      startMarginMm: undefined,
      endMarginMm: undefined,
      provenance: 'component',
    });
  });

  it('a stored exception shows the Componente badge; restore clears draft and persists null', async () => {
    const user = userEvent.setup();
    let currentDraft: ComponentDraft = {
      ...emptyComponentDraft(),
      code: 'PIEZA-PISO',
      placement: 'base',
      constructionOverride: {
        componentId: 'comp-piso-1',
        stationsCount: 2,
        provenance: 'component',
      },
    };

    const setDraft = vi.fn((updater) => {
      if (typeof updater === 'function') {
        currentDraft = updater(currentDraft);
      }
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <ComponentEditorJoineryPanel
        draft={currentDraft}
        setDraft={setDraft}
        hidden={false}
        constructionException={{
          componentId: 'comp-piso-1',
          canMutate: true,
          stored: { componentId: 'comp-piso-1', stationsCount: 2, provenance: 'component' },
          saving: false,
          error: null,
          onSave,
        }}
      />,
    );

    const badge = screen.getByTestId('component-provenance-badge');
    expect(badge.textContent).toContain('Componente · excepción');

    await user.click(screen.getByTestId('component-restore-inheritance-btn'));

    expect(onSave).toHaveBeenCalledWith(null);
    expect(currentDraft.constructionOverride).toBeUndefined();

    // After the restore lands, the stored value is gone: the badge returns to
    // the factory provenance.
    rerender(
      <ComponentEditorJoineryPanel
        draft={currentDraft}
        setDraft={setDraft}
        hidden={false}
        constructionException={{
          componentId: 'comp-piso-1',
          canMutate: true,
          stored: null,
          saving: false,
          error: null,
          onSave,
        }}
      />,
    );
    expect(screen.getByTestId('component-provenance-badge').textContent).toContain(
      'Biblioteca · estándar Granete',
    );
    expect(screen.queryByTestId('component-save-exception-btn')).toBeNull();
  });

  it('without a saved component id the exception save is not offered', () => {
    const draft: ComponentDraft = {
      ...emptyComponentDraft(),
      placement: 'base',
      constructionOverride: { componentId: 'x', stationsCount: 3, provenance: 'component' },
    };
    const onSave = vi.fn();

    render(
      <ComponentEditorJoineryPanel
        draft={draft}
        setDraft={vi.fn()}
        hidden={false}
        constructionException={{
          componentId: null,
          canMutate: true,
          stored: null,
          saving: false,
          error: null,
          onSave,
        }}
      />,
    );

    expect(screen.queryByTestId('component-save-exception-btn')).toBeNull();
    expect(screen.getByText(/sin guardar/i)).toBeTruthy();
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
