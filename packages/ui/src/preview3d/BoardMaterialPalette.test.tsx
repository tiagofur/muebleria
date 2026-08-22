/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { MaterialBoard, MaterialCategory } from '@muebles/domain';
import {
  BoardMaterialPalette,
  BOARD_APPLY_SCOPES,
} from './BoardMaterialPalette';

afterEach(() => {
  cleanup();
});

const materialCategories: readonly MaterialCategory[] = [
  { id: 'mc-melamina', name: 'Melamina', sortOrder: 1 },
  { id: 'mc-blancos', name: 'Blancos', parentId: 'mc-melamina', sortOrder: 1 },
];

const matArauco: MaterialBoard = {
  id: 'mat-ara',
  code: 'TAB-ARA-BLA',
  name: 'Arauco Blanco',
  manufacturer: 'Arauco',
  categoryId: 'mc-blancos',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 714,
  wastePercent: 0,
  costPerM2: 160,
  previewColor: '#F5F5F0',
  active: true,
};

const matMasisa: MaterialBoard = {
  id: 'mat-mas',
  code: 'TAB-MDF-3',
  name: 'MDF 3mm',
  manufacturer: 'Masisa',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 3,
  grainDefault: false,
  boardPrice: 334,
  wastePercent: 0,
  costPerM2: 75,
  active: true,
};

const matLegacy: MaterialBoard = {
  id: 'mat-old',
  code: 'TAB-OLD',
  name: 'Sin Fabricante Legacy',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 18,
  grainDefault: false,
  boardPrice: 100,
  wastePercent: 0,
  costPerM2: 25,
  active: true,
};

const materials = [matArauco, matMasisa, matLegacy];

function Harness(
  props: Partial<Parameters<typeof BoardMaterialPalette>[0]>,
): React.ReactNode {
  return (
    <BoardMaterialPalette
      materials={materials}
      materialCategories={materialCategories}
      canEdit
      scope="fronts"
      onScopeChange={vi.fn()}
      hasSelection
      status={null}
      onApply={vi.fn()}
      onCardDragStart={vi.fn()}
      onCardDragEnd={vi.fn()}
      {...props}
    />
  );
}

describe('BoardMaterialPalette', () => {
  it('fabricante chips agrupan por valor con (sin definir) al final', () => {
    render(<Harness />);
    expect(screen.getByTestId('board-palette-mfr-arauco')).toBeTruthy();
    expect(screen.getByTestId('board-palette-mfr-masisa')).toBeTruthy();
    expect(screen.getByTestId('board-palette-mfr-sin-definir')).toBeTruthy();
    expect(screen.getByTestId('board-palette-count').textContent).toBe('3 de 3');
  });

  it('filtra por fabricante', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('board-palette-mfr-arauco'));
    expect(screen.getByTestId('board-palette-card-mat-ara')).toBeTruthy();
    expect(screen.queryByTestId('board-palette-card-mat-mas')).toBeNull();
  });

  it('cascada de subgrupos por nivel como la Biblioteca', () => {
    render(<Harness />);
    expect(screen.queryByTestId('board-palette-chip-mc-blancos')).toBeNull();
    fireEvent.click(screen.getByTestId('board-palette-chip-mc-melamina'));
    expect(screen.getByTestId('board-palette-chip-mc-blancos')).toBeTruthy();
    fireEvent.click(screen.getByTestId('board-palette-chip-mc-blancos'));
    expect(screen.getByTestId('board-palette-card-mat-ara')).toBeTruthy();
    expect(screen.queryByTestId('board-palette-card-mat-mas')).toBeNull();
  });

  it('búsqueda tolerante por nombre/código/fabricante', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('board-palette-search'), {
      target: { value: 'mdf' },
    });
    expect(screen.getByTestId('board-palette-card-mat-mas')).toBeTruthy();
    expect(screen.queryByTestId('board-palette-card-mat-ara')).toBeNull();
  });

  it('click aplica y drag lleva el MIME de tablero; sin selección deshabilita scopes de mueble', () => {
    const onApply = vi.fn();
    const onCardDragStart = vi.fn();
    const { rerender } = render(
      <Harness onApply={onApply} onCardDragStart={onCardDragStart} />,
    );
    fireEvent.click(screen.getByTestId('board-palette-card-mat-ara'));
    expect(onApply).toHaveBeenCalledWith('mat-ara');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(screen.getByTestId('board-palette-card-mat-ara'), {
      dataTransfer,
    });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-muebles-board-paint',
      expect.any(String),
    );
    expect(onCardDragStart).toHaveBeenCalledWith('mat-ara');

    rerender(
      <Harness
        onApply={onApply}
        onCardDragStart={onCardDragStart}
        hasSelection={false}
      />,
    );
    const scope = screen.getByTestId('board-palette-scope') as HTMLSelectElement;
    const fronts = BOARD_APPLY_SCOPES.find((s) => s.id === 'fronts')!;
    const option = Array.from(scope.options).find(
      (o) => o.value === fronts.id,
    )!;
    expect(option.disabled).toBe(true);
    const project = Array.from(scope.options).find((o) => o.value === 'project')!;
    expect(project.disabled).toBe(false);
  });

  it('estado vacío con catálogo de tableros vacío', () => {
    render(<Harness materials={[]} />);
    expect(screen.getByText(/No hay tableros activos/)).toBeTruthy();
  });
});
