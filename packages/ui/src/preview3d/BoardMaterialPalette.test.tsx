/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { MaterialBoard, MaterialCategory } from '@granete/domain';
import { BoardMaterialPalette } from './BoardMaterialPalette';

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
      status={null}
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

  it('cards son drag-only: no son botones y el drag lleva el MIME de tablero', () => {
    const onCardDragStart = vi.fn();
    render(<Harness onCardDragStart={onCardDragStart} />);

    const card = screen.getByTestId('board-palette-card-mat-ara');
    // Drag-only: la tarjeta no es un botón — se aplica arrastrando al canvas.
    expect(card.tagName).toBe('DIV');
    expect(card.getAttribute('draggable')).toBe('true');
    expect(card.getAttribute('aria-label')).toContain('arrastrar sobre un mueble');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-muebles-board-paint',
      expect.any(String),
    );
    expect(onCardDragStart).toHaveBeenCalledWith('mat-ara');
  });

  it('scope del drop sin gate de selección — el drop siempre aporta el mueble', () => {
    render(<Harness />);
    const scope = screen.getByTestId('board-palette-scope') as HTMLSelectElement;
    for (const option of Array.from(scope.options)) {
      expect(option.disabled).toBe(false);
      expect(option.textContent).not.toMatch(/sin selección/);
    }
  });

  it('estado vacío con catálogo de tableros vacío', () => {
    render(<Harness materials={[]} />);
    expect(screen.getByText(/No hay tableros activos/)).toBeTruthy();
  });
});
