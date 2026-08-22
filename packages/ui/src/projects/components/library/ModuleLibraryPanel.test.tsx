/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { Module, ModuleCategory } from '@muebles/domain';
import { ModuleLibraryPanel, moduleDefaultDims } from './ModuleLibraryPanel';
import { useLibraryCollections } from './useLibraryFavorites';

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null =>
      Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
});

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const categories: readonly ModuleCategory[] = [
  { id: 'cat-cocina', name: 'Cocina', sortOrder: 1 },
  { id: 'cat-bajos', name: 'Bajos', parentId: 'cat-cocina', sortOrder: 1 },
  { id: 'cat-bano', name: 'Baño', sortOrder: 2 },
];

const modBajo: Module = {
  id: 'm-bajo',
  code: 'MOD-BM-600',
  name: 'Bajo mesada 600',
  categoryId: 'cat-bajos',
  hardwareLines: [],
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ],
} as Module;

const modVanitory: Module = {
  id: 'm-van',
  code: 'MOD-VAN-500',
  name: 'Vanitory 500',
  categoryId: 'cat-bano',
  hardwareLines: [],
  externalDims: { width: 500, height: 800, depth: 450 },
} as Module;

const modSinCat: Module = {
  id: 'm-gen',
  code: 'MOD-GEN',
  name: 'Mueble genérico',
  hardwareLines: [],
} as Module;

const modules = [modBajo, modVanitory, modSinCat];

function Harness(props: Partial<Parameters<typeof ModuleLibraryPanel>[0]>) {
  const collections = useLibraryCollections();
  return (
    <ModuleLibraryPanel
      modules={modules}
      categories={categories}
      canEdit
      collections={collections}
      onInsert={vi.fn()}
      onCardDragStart={vi.fn()}
      onCardDragEnd={vi.fn()}
      {...props}
    />
  );
}

describe('moduleDefaultDims', () => {
  it('prefiere el preset default, luego externalDims, luego 600×720×560', () => {
    expect(moduleDefaultDims(modBajo)).toEqual({
      width: 600,
      height: 720,
      depth: 560,
    });
    expect(moduleDefaultDims(modVanitory)).toEqual({
      width: 500,
      height: 800,
      depth: 450,
    });
    expect(moduleDefaultDims(modSinCat)).toEqual({
      width: 600,
      height: 720,
      depth: 560,
    });
  });
});

describe('ModuleLibraryPanel', () => {
  it('renderiza todas las tarjetas agrupadas por categoría', () => {
    render(<Harness />);
    expect(screen.getByTestId('module-library-card-m-bajo')).toBeTruthy();
    expect(screen.getByTestId('module-library-card-m-van')).toBeTruthy();
    expect(screen.getByTestId('module-library-card-m-gen')).toBeTruthy();
    expect(screen.getByTestId('module-library-group-Cocina › Bajos')).toBeTruthy();
    expect(screen.getByTestId('module-library-group-Baño')).toBeTruthy();
    expect(screen.getByTestId('module-library-group-Sin categoría')).toBeTruthy();
  });

  it('filtra por búsqueda tolerante (acentos, código)', () => {
    render(<Harness />);
    const search = screen.getByLabelText('Buscar muebles en la biblioteca');
    fireEvent.change(search, { target: { value: 'vanitory' } });
    expect(screen.getByTestId('module-library-card-m-van')).toBeTruthy();
    expect(screen.queryByTestId('module-library-card-m-bajo')).toBeNull();
  });

  it('filtra por chip L1 y muestra chips L2 + breadcrumb', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('module-library-chip-cat-cocina'));
    expect(screen.getByTestId('module-library-chip-cat-bajos')).toBeTruthy();
    expect(screen.queryByTestId('module-library-card-m-van')).toBeNull();
    expect(screen.getByTestId('module-library-card-m-bajo')).toBeTruthy();

    fireEvent.click(screen.getByTestId('module-library-chip-cat-bajos'));
    expect(screen.getByTestId('module-library-breadcrumb').textContent).toBe(
      'Cocina › Bajos',
    );
  });

  it('chip Todas limpia el filtro de categoría', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('module-library-chip-cat-cocina'));
    fireEvent.click(screen.getByTestId('module-library-chip-all'));
    expect(screen.getByTestId('module-library-card-m-van')).toBeTruthy();
    expect(screen.queryByTestId('module-library-breadcrumb')).toBeNull();
  });

  it('click en tarjeta notifica onInsert; drag start notifica dims y MIME', () => {
    const onInsert = vi.fn();
    const onCardDragStart = vi.fn();
    render(<Harness onInsert={onInsert} onCardDragStart={onCardDragStart} />);
    fireEvent.click(screen.getByTestId('module-library-card-m-bajo'));
    expect(onInsert).toHaveBeenCalledWith('m-bajo');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(screen.getByTestId('module-library-card-m-bajo'), {
      dataTransfer,
    });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-muebles-library',
      expect.any(String),
    );
    expect(onCardDragStart).toHaveBeenCalledWith(
      'm-bajo',
      { width: 600, height: 720, depth: 560 },
    );
  });

  it('toggle de favorito agrega la tarjeta a la sección Favoritos', () => {
    render(<Harness />);
    expect(screen.queryByTestId('module-library-favorites')).toBeNull();
    fireEvent.click(screen.getAllByTestId('module-library-fav-m-bajo')[0]!);
    const favorites = screen.getByTestId('module-library-favorites');
    expect(favorites).toBeTruthy();
    // La tarjeta aparece en Favoritos y en su grupo de catálogo.
    const cards = screen.getAllByTestId('module-library-card-m-bajo');
    expect(cards).toHaveLength(2);
    expect(favorites.contains(cards[0]!)).toBe(true);
  });

  it('muestra estado vacío útil cuando el catálogo no tiene muebles', () => {
    render(<Harness modules={[]} />);
    expect(screen.getByText(/No hay muebles en el catálogo/)).toBeTruthy();
  });

  it('muestra sin resultados para búsqueda sin matches', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Buscar muebles en la biblioteca'), {
      target: { value: 'inexistente-xyz' },
    });
    expect(screen.getByText(/Sin resultados/)).toBeTruthy();
  });

  it('canEdit=false deshabilita drag pero mantiene click informativo', () => {
    const onCardDragStart = vi.fn();
    render(<Harness canEdit={false} onCardDragStart={onCardDragStart} />);
    const card = screen.getByTestId('module-library-card-m-bajo') as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('false');
  });
});
