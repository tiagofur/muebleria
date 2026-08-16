import { create } from 'zustand';
import {
  type MaterialBoard,
  type EdgeBand,
  type Hardware,
  type Module,
  type Customer,
  type OptionGroup,
  seedCatalogExpandedLatAm,
} from '@muebles/domain';

export type CatalogTab = 'materials' | 'edgeBands' | 'hardware' | 'modules';

const DEMO_CUSTOMERS: Customer[] = [
  {
    id: 'cust-1',
    name: 'Roberto Pérez',
    phone: '+54 9 11 4567-8901',
    email: 'roberto.perez@ejemplo.com',
    address: 'Av. Libertador 2450 4B, CABA',
    notes: 'DNI: 28.450.123',
    active: true,
  },
  {
    id: 'cust-2',
    name: 'Estudio Arq. Gómez & Asoc.',
    phone: '+54 9 11 5678-1234',
    email: 'contacto@estudiogomez.com.ar',
    address: 'Calle Gorriti 5800, Palermo',
    notes: 'CUIT: 30-71234567-9',
    active: true,
  },
  {
    id: 'cust-3',
    name: 'Mariana López',
    phone: '+54 9 11 6789-9876',
    email: 'mariana.lopez@gmail.com',
    address: 'Barrio Santa Bárbara, Lote 142, Tigre',
    notes: 'DNI: 34.890.567',
    active: true,
  },
];

export interface CatalogState {
  materials: readonly MaterialBoard[];
  edgeBands: readonly EdgeBand[];
  hardware: readonly Hardware[];
  modules: readonly Module[];
  customers: Customer[];
  optionGroups: readonly OptionGroup[];
  searchQuery: string;
  selectedCategory: string | null;
  activeTab: CatalogTab;

  // Actions
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (cat: string | null) => void;
  setActiveTab: (tab: CatalogTab) => void;

  getFilteredMaterials: () => readonly MaterialBoard[];
  getFilteredEdgeBands: () => readonly EdgeBand[];
  getFilteredHardware: () => readonly Hardware[];
  getFilteredModules: () => readonly Module[];
  getCustomers: () => Customer[];
  getModuleById: (id: string) => Module | undefined;
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  materials: seedCatalogExpandedLatAm.materials,
  edgeBands: seedCatalogExpandedLatAm.edges,
  hardware: seedCatalogExpandedLatAm.hardware,
  modules: seedCatalogExpandedLatAm.modules,
  customers: DEMO_CUSTOMERS,
  optionGroups: seedCatalogExpandedLatAm.optionGroups,
  searchQuery: '',
  selectedCategory: null,
  activeTab: 'modules',

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  setActiveTab: (tab) => set({ activeTab: tab, selectedCategory: null }),

  getFilteredMaterials: () => {
    const { materials, searchQuery } = get();
    const q = searchQuery.toLowerCase().trim();
    if (!q) return materials.filter((m) => m.active);
    return materials.filter(
      (m) =>
        m.active &&
        (m.name.toLowerCase().includes(q) ||
          m.code.toLowerCase().includes(q) ||
          (m.previewColor && m.previewColor.toLowerCase().includes(q)) ||
          (m.notes && m.notes.toLowerCase().includes(q)))
    );
  },

  getFilteredEdgeBands: () => {
    const { edgeBands, searchQuery } = get();
    const q = searchQuery.toLowerCase().trim();
    if (!q) return edgeBands.filter((e) => e.active);
    return edgeBands.filter(
      (e) =>
        e.active &&
        (e.name.toLowerCase().includes(q) ||
          e.code.toLowerCase().includes(q) ||
          (e.notes && e.notes.toLowerCase().includes(q)))
    );
  },

  getFilteredHardware: () => {
    const { hardware, searchQuery } = get();
    const q = searchQuery.toLowerCase().trim();
    if (!q) return hardware.filter((h) => h.active);
    return hardware.filter(
      (h) =>
        h.active &&
        (h.name.toLowerCase().includes(q) ||
          h.code.toLowerCase().includes(q) ||
          (h.notes && h.notes.toLowerCase().includes(q)))
    );
  },

  getFilteredModules: () => {
    const { modules, searchQuery, selectedCategory } = get();
    const q = searchQuery.toLowerCase().trim();

    return modules.filter((m) => {
      if (
        selectedCategory &&
        m.furnitureType !== selectedCategory &&
        m.categoryId !== selectedCategory
      ) {
        return false;
      }
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        (m.furnitureType && m.furnitureType.toLowerCase().includes(q))
      );
    });
  },

  getCustomers: () => {
    const { customers, searchQuery } = get();
    const q = searchQuery.toLowerCase().trim();
    if (!q) return customers.filter((c) => c.active);
    return customers.filter(
      (c) =>
        c.active &&
        (c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)) ||
          (c.address && c.address.toLowerCase().includes(q)))
    );
  },

  getModuleById: (id: string) => {
    return get().modules.find((m) => m.id === id);
  },
}));
