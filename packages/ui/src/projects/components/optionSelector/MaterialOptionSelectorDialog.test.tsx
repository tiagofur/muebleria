/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MaterialBoard, MaterialCategory, OptionGroup } from '@granete/domain';
import { MaterialOptionSelectorDialog } from './MaterialOptionSelectorDialog';

afterEach(() => {
  cleanup();
});

const materialCategories: readonly MaterialCategory[] = [
  { id: 'mc-melamina', name: 'Melaminas', sortOrder: 1 },
  { id: 'mc-blancos', name: 'Blancos', parentId: 'mc-melamina', sortOrder: 1 },
  { id: 'mc-maderas', name: 'Maderas', sortOrder: 2 },
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
  active: true,
};

const matRoble: MaterialBoard = {
  ...matArauco,
  id: 'mat-rob',
  code: 'TAB-ROB-01',
  name: 'Roble Natural',
  categoryId: 'mc-maderas',
  thicknessMm: 18,
  grainDefault: true,
};

const matSinDatos: MaterialBoard = {
  ...matArauco,
  id: 'mat-sin',
  code: 'TAB-SIN',
  name: 'Tablero Sin Datos',
  categoryId: undefined,
  thicknessMm: 0,
  manufacturer: undefined,
};

const group: OptionGroup = {
  id: 'og-1',
  code: 'FRENTE',
  name: 'Frentes',
  kind: 'board',
  required: true,
  optionIds: ['mat-ara', 'mat-rob', 'mat-sin'],
};

function renderDialog(overrides?: Partial<Parameters<typeof MaterialOptionSelectorDialog>[0]>) {
  const onApply = vi.fn();
  const onInherit = vi.fn();
  const onClose = vi.fn();
  const props = {
    open: true,
    group,
    materials: [matArauco, matRoble, matSinDatos],
    materialCategories,
    currentValue: 'mat-rob',
    currentIsOverride: true,
    canEdit: true,
    onApply,
    onInherit,
    onClose,
    ...overrides,
  };
  render(<MaterialOptionSelectorDialog {...props} />);
  return { onApply, onInherit, onClose };
}

describe('MaterialOptionSelectorDialog', () => {
  it('renderiza la ventana con las 5 zonas y el rol activo', () => {
    renderDialog();
    expect(screen.getByTestId('mat-selector-dialog')).toBeTruthy();
    expect(screen.getByText('Catálogo de Acabados')).toBeTruthy();
    expect(screen.getByText('Frentes')).toBeTruthy();
    expect(screen.getByTestId('mat-selector-search')).toBeTruthy();
    expect(screen.getByTestId('mat-selector-col-1')).toBeTruthy();
  });

  it('muestra solo los materiales del grupo curado (regla anti ComboBox)', () => {
    renderDialog({
      materials: [matArauco],
    });
    expect(screen.getByTestId('mat-selector-card-mat-ara')).toBeTruthy();
    expect(screen.queryByTestId('mat-selector-card-mat-rob')).toBeNull();
  });

  it('preselecciona el material efectivo y muestra la ficha con datos honestos', () => {
    // currentValue navega a la rama del material actual (auto-locate).
    renderDialog();
    const card = screen.getByTestId('mat-selector-card-mat-rob');
    expect(card.getAttribute('aria-selected')).toBe('true');
    // thicknessMm 0 y fabricante ausente se muestran como faltantes, no inventados.
    fireEvent.click(screen.getByText('Catálogo Completo'));
    fireEvent.click(screen.getByTestId('mat-selector-card-mat-sin'));
    expect(screen.getByText('Sin fabricante')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('filtra por búsqueda tolerante sobre nombre, código y fabricante', () => {
    renderDialog({ currentValue: undefined });
    fireEvent.change(screen.getByTestId('mat-selector-search'), {
      target: { value: 'roble' },
    });
    expect(screen.getByTestId('mat-selector-card-mat-rob')).toBeTruthy();
    expect(screen.queryByTestId('mat-selector-card-mat-ara')).toBeNull();
    fireEvent.change(screen.getByTestId('mat-selector-search'), {
      target: { value: 'arauco' },
    });
    expect(screen.getByTestId('mat-selector-card-mat-ara')).toBeTruthy();
  });

  it('filtra por rama de categoría con conteos por columna', () => {
    renderDialog({ currentValue: undefined });
    fireEvent.click(screen.getByText('Maderas'));
    expect(screen.getByTestId('mat-selector-card-mat-rob')).toBeTruthy();
    expect(screen.queryByTestId('mat-selector-card-mat-ara')).toBeNull();
    // Columna 2 aparece para la rama con profundidad (Melaminas › Blancos).
    fireEvent.click(screen.getByText('Melaminas'));
    expect(screen.getByTestId('mat-selector-col-2')).toBeTruthy();
    fireEvent.click(screen.getByText('Blancos'));
    expect(screen.getByTestId('mat-selector-card-mat-ara')).toBeTruthy();
  });

  it('aplica con scope mueble y cierra', () => {
    const { onApply, onClose } = renderDialog({ currentValue: undefined });
    fireEvent.click(screen.getByTestId('mat-selector-card-mat-ara'));
    fireEvent.click(screen.getByTestId('mat-selector-apply'));
    expect(onApply).toHaveBeenCalledWith('mat-ara', 'furniture');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('aplica con scope default de obra cuando se elige ese alcance', () => {
    const { onApply } = renderDialog({ currentValue: undefined });
    fireEvent.click(screen.getByTestId('mat-selector-scope-project'));
    fireEvent.click(screen.getByTestId('mat-selector-card-mat-ara'));
    fireEvent.click(screen.getByTestId('mat-selector-apply'));
    expect(onApply).toHaveBeenCalledWith('mat-ara', 'project');
  });

  it('deshabilita aplicar sin candidato y con canEdit false', () => {
    const { rerender } = render(
      <MaterialOptionSelectorDialog
        open
        group={group}
        materials={[matArauco]}
        materialCategories={materialCategories}
        currentValue={undefined}
        currentIsOverride={false}
        canEdit={false}
        onApply={vi.fn()}
        onInherit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('mat-selector-apply') as HTMLButtonElement).disabled,
    ).toBe(true);
    rerender(
      <MaterialOptionSelectorDialog
        open
        group={group}
        materials={[]}
        materialCategories={materialCategories}
        currentValue={undefined}
        currentIsOverride={false}
        canEdit
        onApply={vi.fn()}
        onInherit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('mat-selector-apply') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('doble click en una card aplica directo con el scope activo', () => {
    const { onApply } = renderDialog({ currentValue: undefined });
    fireEvent.click(screen.getByTestId('mat-selector-scope-project'));
    fireEvent.doubleClick(screen.getByTestId('mat-selector-card-mat-ara'));
    expect(onApply).toHaveBeenCalledWith('mat-ara', 'project');
  });

  it('Esc cierra y Enter aplica el candidato', () => {
    const { onApply, onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith('mat-rob', 'furniture');
  });

  it('hereda el default de obra sólo cuando hay override del ítem', () => {
    const { onInherit } = renderDialog({ currentIsOverride: true });
    fireEvent.click(screen.getByTestId('mat-selector-inherit'));
    expect(onInherit).toHaveBeenCalledTimes(1);
  });

  it('oculta la herencia cuando el valor no es override del ítem', () => {
    renderDialog({ currentIsOverride: false });
    expect(screen.queryByTestId('mat-selector-inherit')).toBeNull();
  });

  it('empty state propio para rol sin materiales (no culpa a la búsqueda)', () => {
    renderDialog({ materials: [] });
    expect(
      screen.getByText('Este rol no tiene materiales asignados'),
    ).toBeTruthy();
  });

  it('empty state de búsqueda cuando el filtro no encuentra nada', () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('mat-selector-search'), {
      target: { value: 'zzz-inexistente' },
    });
    expect(screen.getByText('No se encontraron acabados')).toBeTruthy();
  });

  it('colapsa las columnas cuando el taller no configuró categorías', () => {
    renderDialog({ materialCategories: [] });
    expect(screen.queryByTestId('mat-selector-col-1')).toBeNull();
    expect(screen.getByTestId('mat-selector-card-mat-ara')).toBeTruthy();
  });

  it('no renderiza nada cerrado o sin grupo', () => {
    const { container } = render(
      <MaterialOptionSelectorDialog
        open={false}
        group={group}
        materials={[matArauco]}
        materialCategories={materialCategories}
        currentValue={undefined}
        currentIsOverride={false}
        canEdit
        onApply={vi.fn()}
        onInherit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
