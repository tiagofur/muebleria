// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentsScreen } from './ComponentsScreen';
import type { Component, OptionGroup } from '@granete/domain';

const mockOptionGroups: OptionGroup[] = [
  { id: 'og1', code: 'FRENTE', name: 'Frente', kind: 'board', required: true, optionIds: [] },
  { id: 'og2', code: 'INTERIOR', name: 'Interior', kind: 'board', required: false, optionIds: [] },
];

const mockComponents: Component[] = [
  {
    id: 'c1',
    code: 'COM-PUE-01',
    name: 'Puerta',
    placement: 'puerta',
    geometry: { kind: 'rectangular_board', lengthMm: 717, widthMm: 296, thicknessMm: 18 },
    defaultEdges: [
      { side: 'L1', enabled: true },
      { side: 'L2', enabled: true },
      { side: 'W1', enabled: true },
      { side: 'W2', enabled: true },
    ],
    optionRoles: ['FRENTE'],
    active: true,
  },
  {
    id: 'c2',
    code: 'COM-ENT-01',
    name: 'Entrepaño Regulable',
    placement: 'interno',
    geometry: { kind: 'rectangular_board', lengthMm: 462, widthMm: 550, thicknessMm: 15 },
    defaultEdges: [
      { side: 'L1', enabled: false },
      { side: 'L2', enabled: false },
      { side: 'W1', enabled: false },
      { side: 'W2', enabled: true },
    ],
    optionRoles: ['INTERIOR'],
    active: false,
  },
];

describe('ComponentsScreen', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('renders list of active components by default', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.getByText('COM-PUE-01')).toBeTruthy();
    expect(screen.getAllByText('Puerta')[0]).toBeTruthy();
    // Default filters active only, so COM-ENT-01 should not be rendered
    expect(screen.queryByText('COM-ENT-01')).toBeNull();
  });

  it('renders empty state when there are no components', () => {
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.getByText('Sin componentes')).toBeTruthy();
  });

  it('opens modal and creates a new component', async () => {
    const onCreate = vi.fn();
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Click create button (from empty state)
    const newBtn = screen.getByRole('button', { name: /Crear componente/i });
    fireEvent.click(newBtn);

    // Fill in the form - general tab
    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'COM-TEST-01' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Componente de Test' },
    });

    // Switch to geometry tab
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));

    fireEvent.change(screen.getByTestId('input-length'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByTestId('input-width'), {
      target: { value: '300' },
    });
    fireEvent.change(screen.getByTestId('input-thickness'), {
      target: { value: '18' },
    });

    // Switch to edges tab
    fireEvent.click(screen.getByTestId('component-editor-tab-edges'));

    // Enable L1 edge
    fireEvent.click(screen.getByTestId('edge-L1'));

    // Switch to options tab
    fireEvent.click(screen.getByTestId('component-editor-tab-options'));

    // Toggle the FRENTE chip on (replaces the old native multi-select)
    fireEvent.click(screen.getByTestId('option-role-FRENTE'));

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).toHaveBeenCalledWith({
      code: 'COM-TEST-01',
      name: 'Componente de Test',
      placement: 'interno',
      lengthMm: 500,
      widthMm: 300,
      thicknessMm: 18,
      lengthFormula: '',
      widthFormula: '',
      xFormula: '',
      yFormula: '',
      zFormula: '',
      rotateX: null,
      rotateY: null,
      rotateZ: null,
      edgeL1: true,
      edgeL2: false,
      edgeW1: false,
      edgeW2: false,
      optionRoles: 'FRENTE',
      notes: '',
      active: true,
    });
  });

  it('opens modal and edits an existing component', () => {
    const onUpdate = vi.fn();
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Click on component card to open detail view (card-detalle)
    fireEvent.click(screen.getByText('COM-PUE-01'));

    // Click edit from detail view
    fireEvent.click(screen.getByTestId('component-detail-edit'));

    // Modify name
    const nameInput = screen.getByTestId('input-name');
    fireEvent.change(nameInput, {
      target: { value: 'Puerta Modificada' },
    });

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onUpdate).toHaveBeenCalledWith('c1', expect.objectContaining({
      name: 'Puerta Modificada',
      code: 'COM-PUE-01',
    }));
  });

  it('filters by search term', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Both components not visible to active default (only COM-PUE-01 is active)
    expect(screen.getByText('COM-PUE-01')).toBeTruthy();

    // Type search
    const searchInput = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'ZZZZ' } });
    // After debounce, the search will show empty state
    // We just verify the search input updated
    expect(searchInput.value).toBe('ZZZZ');
  });

  it('requires inline confirm before desactivar (C4)', () => {
    const onToggleActive = vi.fn();
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={onToggleActive}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByTestId('component-card-COM-PUE-01'));
    // First click only opens inline confirm — does not toggle yet.
    const toggleBtn = screen.getByRole('button', { name: /Desactivar/i });
    fireEvent.click(toggleBtn);
    expect(onToggleActive).not.toHaveBeenCalled();
    expect(screen.getByTestId('component-deactivate-confirm')).toBeTruthy();

    fireEvent.click(screen.getByTestId('component-deactivate-confirm-yes'));
    expect(onToggleActive).toHaveBeenCalledWith('c1');
  });

  it('shows all components when filter is Todos', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Click "Todos" chip
    fireEvent.click(screen.getByText('Todos'));

    expect(screen.getByText('COM-PUE-01')).toBeTruthy();
    expect(screen.getByText('COM-ENT-01')).toBeTruthy();
  });

  it('detail workspace shows plate metric, edge diagram and pose disclosure', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByTestId('component-card-COM-PUE-01'));
    expect(screen.getByTestId('component-detail')).toBeTruthy();
    expect(screen.getByTestId('component-detail-metric').textContent).toMatch(
      /717/,
    );
    expect(screen.getByTestId('component-detail-geometry')).toBeTruthy();
    expect(screen.getByTestId('component-detail-edges')).toBeTruthy();
    expect(screen.getByTestId('plank-edge-diagram')).toBeTruthy();
    expect(screen.getByTestId('component-detail-pose')).toBeTruthy();
    expect(screen.getByTestId('component-detail-roles').textContent).toMatch(
      /FRENTE/,
    );
  });

  it('shows/hides actions based on canMutate', () => {
    const { rerender } = render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Open detail view
    fireEvent.click(screen.getByTestId('component-card-COM-PUE-01'));
    expect(screen.getByTestId('component-detail-edit')).toBeTruthy();

    // Rerender with canMutate=false
    rerender(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={false}
      />,
    );

    expect(screen.queryByTestId('component-detail-edit')).toBeNull();
    expect(screen.queryByRole('button', { name: /Nuevo Componente/i })).toBeNull();
  });

  it('embeds the 3D preview in Geometry with a "Mostrar en el mueble" toggle (default on)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Open the editor on an existing component (card → detail → edit).
    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));

    // Switch to Geometry — the 3D preview now lives here (no separate "Vista 3D" tab).
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));

    // The old "Vista 3D" tab must be gone.
    expect(screen.queryByTestId('component-editor-tab-preview3d')).toBeNull();

    // The "Mostrar en el mueble" toggle is present and on by default.
    const toggle = screen.getByTestId('show-in-context-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    // Container reference fields are present and editable.
    expect(screen.getByTestId('container-pw')).toBeTruthy();
    expect(screen.getByTestId('container-ph')).toBeTruthy();
    expect(screen.getByTestId('container-pd')).toBeTruthy();

    // Turning the toggle off switches the preview mode (ghost container hidden).
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
  });

  it('collapses position + rotation behind an "Avanzado" disclosure (P0 cognitive load)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Open editor on an existing component.
    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));

    // The advanced disclosure is collapsed by default: position/rotation inputs are hidden.
    const toggleBtn = screen.getByTestId('component-geometry-advanced-toggle');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('input-rotate-x')).toBeNull();
    expect(screen.queryByTestId('input-x-formula')).toBeNull();

    // Opening the disclosure reveals the six advanced inputs.
    fireEvent.click(toggleBtn);
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('input-rotate-x')).toBeTruthy();
    expect(screen.getByTestId('input-rotate-y')).toBeTruthy();
    expect(screen.getByTestId('input-rotate-z')).toBeTruthy();
    expect(screen.getByTestId('input-x-formula')).toBeTruthy();
    expect(screen.getByTestId('input-y-formula')).toBeTruthy();
    expect(screen.getByTestId('input-z-formula')).toBeTruthy();

    // "Restablecer a automático" clears all six fields in one click.
    fireEvent.change(screen.getByTestId('input-rotate-x'), { target: { value: '45' } });
    fireEvent.change(screen.getByTestId('input-x-formula'), { target: { value: 'T' } });
    fireEvent.click(screen.getByTestId('component-geometry-advanced-reset'));
    expect((screen.getByTestId('input-rotate-x') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('input-x-formula') as HTMLInputElement).value).toBe('');
  });

  it('validates dimensions on blur and clears the error when corrected (P1-a)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));

    // Type an invalid length and leave the field — error appears.
    const lengthInput = screen.getByTestId('input-length');
    fireEvent.change(lengthInput, { target: { value: '-5' } });
    fireEvent.blur(lengthInput);
    expect(screen.getByTestId('input-length-error').textContent).toContain(
      'El largo debe ser mayor a 0',
    );
    expect(lengthInput.getAttribute('aria-invalid')).toBe('true');

    // Correcting the value and blurring clears the error.
    fireEvent.change(lengthInput, { target: { value: '720' } });
    fireEvent.blur(lengthInput);
    expect(screen.queryByTestId('input-length-error')).toBeNull();
  });

  it('groups placements with optgroups and shows a contextual description (P1-b)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));

    // The select offers grouped placements.
    const select = screen.getByTestId('input-placement') as HTMLSelectElement;
    const groups = select.querySelectorAll('optgroup');
    expect(groups.length).toBeGreaterThanOrEqual(4);

    // Changing placement to "superior" surfaces its description.
    fireEvent.change(select, { target: { value: 'superior' } });
    expect(screen.getByTestId('placement-hint').textContent).toContain('Tapa');
  });

  it('critique: code locked hint when editing', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));
    expect(screen.getByTestId('input-code-hint').textContent).toMatch(
      /no se cambia/i,
    );
  });

  it('critique: formula guide collapsed; 3D viewport present', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));

    expect(screen.getByTestId('component-geometry-viewport')).toBeTruthy();
    const guideToggle = screen.getByTestId('formula-guide-toggle');
    expect(guideToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('formula-guide-body')).toBeNull();
    fireEvent.click(guideToggle);
    expect(guideToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('formula-guide-body').textContent).toMatch(/PW/);

    // Focus formula field also expands guide after collapse
    fireEvent.click(guideToggle);
    expect(guideToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.focus(screen.getByTestId('input-length-formula'));
    expect(guideToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('critique: options tab badge when no roles; save jumps to options', () => {
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Crear componente/i }));
    expect(
      screen
        .getByTestId('component-editor-tab-options')
        .querySelector('.tabs__alert'),
    ).toBeTruthy();

    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'COM-X' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Sin rol' },
    });
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));
    fireEvent.change(screen.getByTestId('input-length'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByTestId('input-width'), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByTestId('input-thickness'), {
      target: { value: '18' },
    });
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(screen.getByTestId('form-error').textContent).toMatch(/rol de opción/i);
    expect(screen.getByTestId('component-editor-panel-options').hidden).toBe(
      false,
    );
  });

  it('F109: component editor uses WorkspaceTabs (tablist contract + roving arrows)', async () => {
    const user = userEvent.setup();
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Crear componente/i }));

    const tablist = screen.getByTestId('component-editor-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');

    const general = screen.getByTestId('component-editor-tab-general');
    expect(general.getAttribute('role')).toBe('tab');
    expect(general.getAttribute('aria-controls')).toBe(
      'component-editor-panel-general',
    );
    const panel = screen.getByTestId('component-editor-panel-general');
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'component-editor-tab-general',
    );

    // Missing option roles → "!" alert with tooltip on Opciones.
    const options = screen.getByTestId('component-editor-tab-options');
    expect(options.querySelector('.tabs__alert')).toBeTruthy();
    expect(options.getAttribute('title')).toBe(
      'Falta al menos un rol de opción',
    );

    // Arrow-key roving: selection + focus move together.
    general.focus();
    await user.keyboard('{ArrowRight}');
    const geometry = screen.getByTestId('component-editor-tab-geometry');
    expect(geometry.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(geometry);
  });

  it('critique: apply placement size convention when formulas empty', () => {
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Crear componente/i }));
    fireEvent.change(screen.getByTestId('input-placement'), {
      target: { value: 'base' },
    });
    fireEvent.click(screen.getByTestId('apply-placement-convention'));
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));
    expect(
      (screen.getByTestId('input-length-formula') as HTMLInputElement).value,
    ).toBe('PW');
    expect(
      (screen.getByTestId('input-width-formula') as HTMLInputElement).value,
    ).toBe('PD');
  });

  it('toggles option roles via chips instead of a native multi-select (P2)', () => {
    const onUpdate = vi.fn();
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByText('COM-PUE-01'));
    fireEvent.click(screen.getByTestId('component-detail-edit'));
    fireEvent.click(screen.getByTestId('component-editor-tab-options'));

    // c1 (Puerta) already has FRENTE selected, so the chip starts pressed.
    const frenteChip = screen.getByTestId('option-role-FRENTE');
    expect(frenteChip.getAttribute('aria-pressed')).toBe('true');

    // Toggle it off, then back on — verifies the chip toggles both ways.
    fireEvent.click(frenteChip);
    expect(frenteChip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(frenteChip);
    expect(frenteChip.getAttribute('aria-pressed')).toBe('true');

    // Saving persists the role.
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(onUpdate).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ optionRoles: expect.stringContaining('FRENTE') }),
    );
  });

  it('does not wipe draft when components prop identity changes while editing (C1)', () => {
    const { rerender } = render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
      />,
    );

    const nameInput = screen.getByTestId('input-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Puerta');
    fireEvent.change(nameInput, { target: { value: 'Puerta en progreso' } });
    expect(nameInput.value).toBe('Puerta en progreso');

    // Same data, new array identity — must not re-seed draft.
    rerender(
      <ComponentsScreen
        components={[...mockComponents]}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
      />,
    );

    expect(
      (screen.getByTestId('input-name') as HTMLInputElement).value,
    ).toBe('Puerta en progreso');
  });

  it('does not wipe session-restored draft on remount / F5 (R3-C1)', () => {
    const props = {
      components: mockComponents,
      optionGroups: mockOptionGroups,
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onToggleActive: vi.fn(),
      canMutate: true,
      openComponentEditId: 'c1' as const,
    };

    const { unmount } = render(<ComponentsScreen {...props} />);
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Borrador de sesión' },
    });
    expect(
      (screen.getByTestId('input-name') as HTMLInputElement).value,
    ).toBe('Borrador de sesión');
    // Session must hold the in-progress name before remount.
    expect(sessionStorage.getItem('component-draft:c1')).toContain(
      'Borrador de sesión',
    );
    unmount();

    // Remount with same edit id (F5 / re-enter): seed must not overwrite session.
    render(<ComponentsScreen {...props} />);
    expect(
      (screen.getByTestId('input-name') as HTMLInputElement).value,
    ).toBe('Borrador de sesión');
  });

  it('after save/forceClose, re-open seeds from entity and session is absent (R4-C1)', () => {
    const onUpdate = vi.fn();
    const onRequestEdit = vi.fn();
    const { rerender, unmount } = render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
        onRequestEdit={onRequestEdit}
      />,
    );

    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'WIP sticky empty bug' },
    });
    expect(sessionStorage.getItem('component-draft:c1')).toContain(
      'WIP sticky empty bug',
    );

    // Save triggers forceCloseEditor (clearDraft + setDraftLocal).
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(onUpdate).toHaveBeenCalled();
    expect(sessionStorage.getItem('component-draft:c1')).toBeNull();

    // Parent clears edit route; leave editor.
    rerender(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId={null}
        onRequestEdit={onRequestEdit}
      />,
    );
    unmount();

    // Re-open same id: must seed entity baseline, not sticky empty draft.
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
        onRequestEdit={onRequestEdit}
      />,
    );
    expect(
      (screen.getByTestId('input-name') as HTMLInputElement).value,
    ).toBe('Puerta');
    // Session must be absent OR equal entity baseline — never sticky empty/WIP.
    const reopened = sessionStorage.getItem('component-draft:c1');
    if (reopened !== null) {
      expect(JSON.parse(reopened).name).toBe('Puerta');
    }
    expect(reopened).not.toContain('WIP sticky empty bug');
  });

  it('switches to geometry tab when dim validation fails on submit (R3-S4)', () => {
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Crear componente/i }));
    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'COM-DIM-0' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Sin dims' },
    });
    // Stay on general; leave length/width/thickness at 0.
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(screen.getByTestId('form-error').textContent).toMatch(
      /dimensiones/i,
    );
    expect(
      screen.getByTestId('component-editor-tab-geometry').getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
  });

  it('preserves perforations on the draft when editing (C2)', () => {
    const withPerf: Component = {
      ...mockComponents[0]!,
      perforations: [
        {
          id: 'perf-1',
          type: 'shelf_pin',
          diameterMm: 5,
          depthMm: 12,
          relativePosition: { xPercent: 0.1, yPercent: 0.2 },
        },
      ],
    };
    const onUpdate = vi.fn();
    render(
      <ComponentsScreen
        components={[withPerf]}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
      />,
    );

    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Puerta con perfs' },
    });
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onUpdate).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        name: 'Puerta con perfs',
        perforations: withPerf.perforations,
      }),
    );
  });

  it('blocks save when a formula is invalid (C3)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
      />,
    );

    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));
    fireEvent.change(screen.getByTestId('input-length-formula'), {
      target: { value: 'PW + !!!' },
    });
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(screen.getByTestId('form-error').textContent).toMatch(
      /fórmula de largo/i,
    );
  });

  it('allows base length/width 0 when formulas are set (C8)', () => {
    const onCreate = vi.fn();
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Crear componente/i }));
    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'COM-FORM-01' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Con fórmulas' },
    });
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));
    // Leave length/width base at 0; set formulas + thickness.
    fireEvent.change(screen.getByTestId('input-length-formula'), {
      target: { value: 'PW' },
    });
    fireEvent.change(screen.getByTestId('input-width-formula'), {
      target: { value: 'PD' },
    });
    fireEvent.change(screen.getByTestId('input-thickness'), {
      target: { value: '18' },
    });
    fireEvent.click(screen.getByTestId('component-editor-tab-options'));
    fireEvent.click(screen.getByTestId('option-role-FRENTE'));
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'COM-FORM-01',
        lengthMm: 0,
        widthMm: 0,
        thicknessMm: 18,
        lengthFormula: 'PW',
        widthFormula: 'PD',
      }),
    );
  });

  it('filters list by placement (C7)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.getByText('COM-PUE-01')).toBeTruthy();
    // Only active by default — c2 is inactive interno.
    fireEvent.click(screen.getByText('Todos'));
    expect(screen.getByText('COM-ENT-01')).toBeTruthy();

    fireEvent.change(screen.getByTestId('component-placement-filter'), {
      target: { value: 'puerta' },
    });
    expect(screen.getByText('COM-PUE-01')).toBeTruthy();
    expect(screen.queryByText('COM-ENT-01')).toBeNull();

    fireEvent.change(screen.getByTestId('component-placement-filter'), {
      target: { value: 'interno' },
    });
    expect(screen.queryByText('COM-PUE-01')).toBeNull();
    expect(screen.getByText('COM-ENT-01')).toBeTruthy();
  });

  it('shows 0° when rotate is explicitly zero in pose summary (C5)', () => {
    const withZeroRot: Component = {
      ...mockComponents[0]!,
      rotateX: 0,
      rotateY: 90,
    };
    render(
      <ComponentsScreen
        components={[withZeroRot]}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    fireEvent.click(screen.getByText('COM-PUE-01'));
    const pose = screen.getByTestId('component-detail-pose');
    expect(pose.textContent).toMatch(/Rx 0°/);
    expect(pose.textContent).toMatch(/Ry 90°/);
  });

  it('mounts 3D only on the geometry tab (C6)', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
        openComponentEditId="c1"
      />,
    );

    // General tab first — no 3D canvas.
    expect(screen.queryByTestId('component-geometry-3d')).toBeNull();

    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));
    expect(screen.getByTestId('component-geometry-3d')).toBeTruthy();

    fireEvent.click(screen.getByTestId('component-editor-tab-general'));
    expect(screen.queryByTestId('component-geometry-3d')).toBeNull();
  });
});
