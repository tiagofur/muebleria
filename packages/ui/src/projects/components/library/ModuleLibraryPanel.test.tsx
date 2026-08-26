/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { Module, ModuleCategory } from '@granete/domain';
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
  { id: 'cat-cajones', name: 'Cajones', parentId: 'cat-bajos', sortOrder: 1 },
  { id: 'cat-bano', name: 'Baño', sortOrder: 2 },
];

const modBajo: Module = {
  id: 'm-bajo',
  code: 'MOD-BM-600',
  name: 'Bajo mesada 600',
  categoryId: 'cat-cajones',
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
  it('renders one catalog result list without duplicate collection shelves', () => {
    render(<Harness />);
    expect(screen.getByTestId('module-library-results')).toBeTruthy();
    expect(screen.getAllByTestId('module-library-card-m-bajo')).toHaveLength(1);
    expect(screen.getByTestId('module-library-result-count').textContent).toBe('3 de 3');
  });

  it('navigates categories level by level using cascading comboboxes', () => {
    render(<Harness />);
    // Nivel 1: select de categorías principales presente; selects de niveles profundos aún no visibles.
    expect(screen.getByTestId('module-library-select-l1')).toBeTruthy();
    expect(screen.queryByTestId('module-library-select-l2')).toBeNull();

    fireEvent.change(screen.getByTestId('module-library-select-l1'), {
      target: { value: 'cat-cocina' },
    });
    // Nivel 2 aparece con los hijos de Cocina.
    expect(screen.getByTestId('module-library-select-l2')).toBeTruthy();
    expect(screen.queryByTestId('module-library-select-l3')).toBeNull();

    fireEvent.change(screen.getByTestId('module-library-select-l2'), {
      target: { value: 'cat-bajos' },
    });
    // Nivel 3 (Cajones) aparece — profundidad arbitraria. El filtro de nivel
    // incluye descendientes: m-bajo (en Cajones) ya es visible desde Bajos.
    expect(screen.getByTestId('module-library-select-l3')).toBeTruthy();
    expect(screen.getByTestId('module-library-card-m-bajo')).toBeTruthy();
    expect(screen.queryByTestId('module-library-card-m-van')).toBeNull();

    fireEvent.change(screen.getByTestId('module-library-select-l3'), {
      target: { value: 'cat-cajones' },
    });
    expect(screen.getByTestId('module-library-card-m-bajo')).toBeTruthy();
  });

  it('selecting Todas las categorías at level 1 clears the category path', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('module-library-select-l1'), {
      target: { value: 'cat-cocina' },
    });
    fireEvent.change(screen.getByTestId('module-library-select-l2'), {
      target: { value: 'cat-bajos' },
    });
    fireEvent.change(screen.getByTestId('module-library-select-l1'), {
      target: { value: '' },
    });
    expect(screen.queryByTestId('module-library-select-l2')).toBeNull();
    expect(screen.getByTestId('module-library-card-m-van')).toBeTruthy();
  });

  it('searches inside the active category level by default', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('module-library-select-l1'), {
      target: { value: 'cat-cocina' },
    });
    fireEvent.change(screen.getByTestId('module-library-select-l2'), {
      target: { value: 'cat-bajos' },
    });
    fireEvent.change(screen.getByTestId('module-library-select-l3'), {
      target: { value: 'cat-cajones' },
    });
    fireEvent.change(screen.getByLabelText('Buscar muebles en la biblioteca'), {
      target: { value: 'bajo' },
    });
    expect(screen.getByTestId('module-library-card-m-bajo')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Buscar muebles en la biblioteca'), {
      target: { value: 'vanitory' },
    });
    expect(screen.queryByTestId('module-library-card-m-van')).toBeNull();
    expect(screen.getByText(/No hay muebles que coincidan/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todo el catálogo' }));
    expect(screen.getByTestId('module-library-card-m-van')).toBeTruthy();
  });

  it('uses collection scopes as a single, non-duplicated result list', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('module-library-fav-m-bajo'));
    fireEvent.click(screen.getByTestId('module-library-scope-favorites'));
    expect(screen.getAllByTestId('module-library-card-m-bajo')).toHaveLength(1);
    expect(screen.getByTestId('module-library-result-count').textContent).toBe('1 de 1');
    // Niveles de categoría no aplican a colecciones.
    expect(screen.queryByTestId('module-library-select-l1')).toBeNull();
  });

  it('persists scope, path and query when the library remounts during studio work', () => {
    const view = render(<Harness />);
    fireEvent.change(screen.getByTestId('module-library-select-l1'), {
      target: { value: 'cat-cocina' },
    });
    fireEvent.change(screen.getByTestId('module-library-select-l2'), {
      target: { value: 'cat-bajos' },
    });
    fireEvent.change(screen.getByTestId('module-library-select-l3'), {
      target: { value: 'cat-cajones' },
    });
    fireEvent.change(screen.getByLabelText('Buscar muebles en la biblioteca'), {
      target: { value: 'bajo' },
    });
    view.unmount();
    render(<Harness />);
    expect(
      (screen.getByTestId('module-library-select-l3') as HTMLSelectElement).value,
    ).toBe('cat-cajones');
    expect(
      (screen.getByLabelText('Buscar muebles en la biblioteca') as HTMLInputElement).value,
    ).toBe('bajo');
  });

  it('sanitizes stale persisted paths that no longer match the category tree', () => {
    globalThis.localStorage.setItem(
      'muebles.proyectar.library.navigation.v1',
      JSON.stringify({
        scope: 'catalog',
        path: ['cat-cocina', 'cat-inexistente'],
        search: '',
      }),
    );
    render(<Harness />);
    // cat-inexistente se descarta; la ruta queda en Cocina (nivel 1 activo).
    expect((screen.getByTestId('module-library-select-l1') as HTMLSelectElement).value).toBe(
      'cat-cocina',
    );
    expect(screen.queryByTestId('module-library-select-l3')).toBeNull();
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

  it('muestra estado vacío útil cuando el catálogo no tiene muebles', () => {
    render(<Harness modules={[]} />);
    expect(screen.getByText(/No hay muebles en el catálogo/)).toBeTruthy();
  });

  it('canEdit=false deshabilita drag pero mantiene click informativo', () => {
    const onCardDragStart = vi.fn();
    render(<Harness canEdit={false} onCardDragStart={onCardDragStart} />);
    const card = screen.getByTestId('module-library-card-m-bajo') as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('false');
  });
});
