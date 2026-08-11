/**
 * Tests for StructureEditorAgregadosPanel component (Fase 2 UI).
 * @vitest-environment jsdom
 */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agregado } from '@muebles/domain';
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
});
