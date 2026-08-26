/**
 * Tests for StructureEditorAgregadosPanel component (Fase 2 UI).
 * @vitest-environment jsdom
 */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agregado } from '@granete/domain';
import { StructureEditorAgregadosPanel } from './components/StructureEditorAgregadosPanel';
import { emptyStructureDraft, type StructureDraft } from './structureDraft';

const mockAgregados: Agregado[] = [
  {
    id: 'agr-1',
    code: 'AGR-CAJON-3',
    name: 'Cuerpo de 3 Cajones',
    components: [],
  },
  {
    id: 'agr-2',
    code: 'AGR-PUERTA-IZQ',
    name: 'Puerta Izquierda con Bisagras',
    components: [],
  },
];

function TestHarness({
  initialDraft = emptyStructureDraft(),
  onDraftChange,
}: {
  readonly initialDraft?: StructureDraft;
  readonly onDraftChange?: (d: StructureDraft) => void;
}) {
  const [draft, setDraft] = useState<StructureDraft>(initialDraft);

  const handleSetDraft: React.Dispatch<React.SetStateAction<StructureDraft>> = (
    action,
  ) => {
    setDraft((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      if (onDraftChange) onDraftChange(next);
      return next;
    });
  };

  return (
    <StructureEditorAgregadosPanel
      draft={draft}
      setDraft={handleSetDraft}
      catalogAgregados={mockAgregados}
    />
  );
}

describe('StructureEditorAgregadosPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders empty message when no agregados are attached', () => {
    render(<TestHarness />);
    expect(screen.getByTestId('structure-agregados-empty').textContent).toContain(
      'No hay agregados',
    );
  });

  it('allows selecting an agregado and adding it to draft', () => {
    let currentDraft = emptyStructureDraft();
    render(
      <TestHarness
        onDraftChange={(d) => {
          currentDraft = d;
        }}
      />,
    );

    const select = screen.getByTestId('structure-agregado-select');
    fireEvent.change(select, { target: { value: 'agr-1' } });

    const addBtn = screen.getByTestId('structure-add-agregado-btn');
    fireEvent.click(addBtn);

    expect(currentDraft.agregados).toHaveLength(1);
    expect(currentDraft.agregados[0]!.agregadoId).toBe('agr-1');
    expect(currentDraft.agregados[0]!.name).toBe('Cuerpo de 3 Cajones');
    expect(screen.getByTestId('structure-agregado-item-0')).toBeDefined();
  });

  it('allows updating fields and removing an agregado', () => {
    let currentDraft: StructureDraft = {
      ...emptyStructureDraft(),
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-1',
          name: 'Cajonera Principal',
          quantity: 3,
          layoutDirection: 'vertical',
          gapMm: 3,
          position: { zFormula: '100' },
          dimensions: { widthFormula: 'W - 36', heightFormula: '600' },
          mirrored: false,
        },
      ],
    };

    render(
      <TestHarness
        initialDraft={currentDraft}
        onDraftChange={(d) => {
          currentDraft = d;
        }}
      />,
    );

    // Update quantity
    const qtyInput = screen.getByTestId('structure-agr-0-qty');
    fireEvent.change(qtyInput, { target: { value: '4' } });
    expect(currentDraft.agregados[0]!.quantity).toBe(4);

    // Update X, Y, Z formulas
    const posXInput = screen.getByTestId('structure-agr-0-pos-x');
    fireEvent.change(posXInput, { target: { value: '18' } });
    expect(currentDraft.agregados[0]!.position?.xFormula).toBe('18');

    const posYInput = screen.getByTestId('structure-agr-0-pos-y');
    fireEvent.change(posYInput, { target: { value: '0' } });
    expect(currentDraft.agregados[0]!.position?.yFormula).toBe('0');

    const posZInput = screen.getByTestId('structure-agr-0-pos-z');
    fireEvent.change(posZInput, { target: { value: 'B + 20' } });
    expect(currentDraft.agregados[0]!.position?.zFormula).toBe('B + 20');

    // Update Depth formula
    const dimDInput = screen.getByTestId('structure-agr-0-dim-d');
    fireEvent.change(dimDInput, { target: { value: 'D - 18' } });
    expect(currentDraft.agregados[0]!.dimensions?.depthFormula).toBe('D - 18');

    // Remove: soft-delete requires two clicks (first=enter confirm, second=execute)
    const removeBtn = screen.getByTestId('structure-remove-agregado-0');
    fireEvent.click(removeBtn);
    // After first click: card is in pending-remove state, draft unchanged
    expect(currentDraft.agregados).toHaveLength(1);
    // Second click confirms removal
    fireEvent.click(removeBtn);
    expect(currentDraft.agregados).toHaveLength(0);
  });

  it('renders optionOverrides dropdowns and updates draft optionOverrides on select', () => {
    const catalogAgregadosWithRole: Agregado[] = [
      {
        id: 'agr-door',
        code: 'AGR-PUERTA',
        name: 'Puerta con Jaladera',
        hardwareLines: [
          {
            id: 'hl-1',
            hardwareId: 'jal-std',
            optionRole: 'JALADERA',
            quantity: 1,
          },
        ],
      },
    ];

    const catalogHardware = [
      { id: 'jal-1', code: 'JAL-GOLA-256', name: 'Jaladera Gola 256mm', category: 'jaladera' as const, unit: 'piece' as const, costPerUnit: 50, active: true },
      { id: 'jal-2', code: 'JAL-PERFIL-128', name: 'Jaladera Perfil 128mm', category: 'jaladera' as const, unit: 'piece' as const, costPerUnit: 40, active: true },
    ];

    const optionGroups = [
      { id: 'og-1', code: 'JALADERA', name: 'Jaladeras de Puerta', kind: 'hardware' as const, required: true, optionIds: ['jal-1', 'jal-2'] },
    ];

    let currentDraft: StructureDraft = {
      ...emptyStructureDraft(),
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-door',
          name: 'Puerta Principal',
          quantity: 1,
          optionOverrides: { JALADERA: 'jal-1' },
        },
      ],
    };

    render(
      <StructureEditorAgregadosPanel
        draft={currentDraft}
        setDraft={(action) => {
          currentDraft = typeof action === 'function' ? action(currentDraft) : action;
        }}
        catalogAgregados={catalogAgregadosWithRole}
        catalogHardware={catalogHardware}
        optionGroups={optionGroups}
      />,
    );

    const overrideSelect = screen.getByTestId('structure-agr-0-override-JALADERA') as HTMLSelectElement;
    expect(overrideSelect.value).toBe('jal-1');

    fireEvent.change(overrideSelect, { target: { value: 'jal-2' } });
    expect(currentDraft.agregados[0]!.optionOverrides?.['JALADERA']).toBe('jal-2');

    // Select default empty value -> removes override key
    fireEvent.change(overrideSelect, { target: { value: '' } });
    expect(currentDraft.agregados[0]!.optionOverrides).toBeUndefined();
  });

  it('collapses multiple agregados by default and displays compact summary chips', () => {
    const multipleDraft: StructureDraft = {
      ...emptyStructureDraft(),
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-1',
          name: 'Cajón Superior',
          quantity: 2,
          layoutDirection: 'vertical',
          gapMm: 3,
          position: { xFormula: '18', yFormula: '0', zFormula: '100' },
          dimensions: { widthFormula: 'W - 36', heightFormula: '200', depthFormula: 'D - 50' },
          mirrored: false,
        },
        {
          id: 'inst-2',
          agregadoId: 'agr-2',
          name: 'Puerta Lateral',
          quantity: 1,
          layoutDirection: 'none',
          gapMm: 0,
          position: { xFormula: '0', yFormula: '0', zFormula: '0' },
          dimensions: { widthFormula: 'W/2', heightFormula: 'H', depthFormula: '18' },
          mirrored: true,
          optionOverrides: { BISAGRA: 'bis-1' },
        },
      ],
    };

    render(
      <StructureEditorAgregadosPanel
        draft={multipleDraft}
        setDraft={vi.fn()}
        catalogAgregados={mockAgregados}
      />,
    );

    // Toolbar shows count and actions
    expect(screen.getByTestId('structure-agregados-toolbar')).toBeDefined();
    expect(screen.getByText('2 agregados')).toBeDefined();

    // Both cards start collapsed -> bodies are not rendered
    expect(screen.queryByTestId('structure-agr-body-0')).toBeNull();
    expect(screen.queryByTestId('structure-agr-body-1')).toBeNull();

    // Summaries are visible
    const summary0 = screen.getByTestId('structure-agr-summary-0');
    expect(summary0.textContent).toContain('W - 36 × 200 × D - 50');
    expect(summary0.textContent).toContain('(18, 0, 100)');
    expect(summary0.textContent).toContain('Cant: 2 (vertical)');

    const summary1 = screen.getByTestId('structure-agr-summary-1');
    expect(summary1.textContent).toContain('Espejado');
    expect(summary1.textContent).toContain('1 override');
  });

  it('toggles expand/collapse when clicking card header, and supports expand/collapse all', () => {
    const multipleDraft: StructureDraft = {
      ...emptyStructureDraft(),
      agregados: [
        {
          id: 'inst-1',
          agregadoId: 'agr-1',
          name: 'Cajón Superior',
          quantity: 1,
        },
        {
          id: 'inst-2',
          agregadoId: 'agr-2',
          name: 'Puerta Lateral',
          quantity: 1,
        },
      ],
    };

    render(
      <StructureEditorAgregadosPanel
        draft={multipleDraft}
        setDraft={vi.fn()}
        catalogAgregados={mockAgregados}
      />,
    );

    // Initially collapsed
    expect(screen.queryByTestId('structure-agr-body-0')).toBeNull();
    expect(screen.queryByTestId('structure-agr-body-1')).toBeNull();

    // Click toggle on item 0 -> expands item 0 only
    fireEvent.click(screen.getByTestId('structure-agregado-toggle-0'));
    expect(screen.getByTestId('structure-agr-body-0')).toBeDefined();
    expect(screen.queryByTestId('structure-agr-body-1')).toBeNull();

    // Click toggle on item 0 again -> collapses item 0
    fireEvent.click(screen.getByTestId('structure-agregado-toggle-0'));
    expect(screen.queryByTestId('structure-agr-body-0')).toBeNull();

    // Expand all button
    fireEvent.click(screen.getByTestId('structure-agregados-expand-all'));
    expect(screen.getByTestId('structure-agr-body-0')).toBeDefined();
    expect(screen.getByTestId('structure-agr-body-1')).toBeDefined();

    // Collapse all button
    fireEvent.click(screen.getByTestId('structure-agregados-collapse-all'));
    expect(screen.queryByTestId('structure-agr-body-0')).toBeNull();
    expect(screen.queryByTestId('structure-agr-body-1')).toBeNull();
  });

  it('renders with accessible tabpanel role and default idPrefix', () => {
    render(<TestHarness />);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toBeDefined();
    expect(panel.getAttribute('id')).toBe('structure-editor-panel-agregados');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'structure-editor-tab-agregados',
    );
    expect(panel.getAttribute('hidden')).toBeNull();
  });

  it('renders with custom idPrefix and respects hidden prop', () => {
    render(
      <StructureEditorAgregadosPanel
        draft={emptyStructureDraft()}
        setDraft={vi.fn()}
        catalogAgregados={mockAgregados}
        idPrefix="module-editor"
        hidden={true}
      />,
    );
    const panel = screen.getByTestId('structure-editor-agregados-panel');
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('id')).toBe('module-editor-panel-agregados');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'module-editor-tab-agregados',
    );
    expect(panel.getAttribute('hidden')).not.toBeNull();
  });
});

