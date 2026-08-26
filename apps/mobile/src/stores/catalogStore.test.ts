import { describe, it, expect, beforeEach } from 'vitest';
import { useCatalogStore } from './catalogStore';
import { seedCatalogExpandedLatAm } from '@granete/domain';

describe('catalogStore Mobile (Fase 3)', () => {
  beforeEach(() => {
    useCatalogStore.setState({
      searchQuery: '',
      selectedCategory: null,
      activeTab: 'modules',
    });
  });

  it('inicializa con catálogos enriquecidos de LatAm', () => {
    const state = useCatalogStore.getState();
    expect(state.materials.length).toBeGreaterThan(0);
    expect(state.edgeBands.length).toBeGreaterThan(0);
    expect(state.hardware.length).toBeGreaterThan(0);
    expect(state.modules.length).toBeGreaterThan(0);
    expect(state.customers.length).toBeGreaterThan(0);
  });

  it('filtra módulos por búsqueda de texto y categoría', () => {
    const store = useCatalogStore.getState();
    const firstMod = seedCatalogExpandedLatAm.modules[0];

    // Search query with code or name part
    store.setSearchQuery(firstMod.code.slice(0, 3));
    const filtered = useCatalogStore.getState().getFilteredModules();
    expect(filtered.length).toBeGreaterThan(0);

    // Category filter
    const cat = firstMod.furnitureType || firstMod.categoryId;
    if (cat) {
      store.setSearchQuery('');
      store.setSelectedCategory(cat);
      const byCategory = useCatalogStore.getState().getFilteredModules();
      expect(byCategory.length).toBeGreaterThan(0);
      for (const mod of byCategory) {
        expect(mod.furnitureType || mod.categoryId).toBe(cat);
      }
    }
  });

  it('filtra tableros y herrajes por texto', () => {
    const store = useCatalogStore.getState();
    const firstMat = seedCatalogExpandedLatAm.materials[0];

    store.setSearchQuery(firstMat.code.slice(0, 3));
    const mats = store.getFilteredMaterials();
    expect(mats.length).toBeGreaterThan(0);
  });

  it('obtiene clientes activos con búsqueda reactiva', () => {
    const store = useCatalogStore.getState();
    const allCustomers = store.getCustomers();
    expect(allCustomers.length).toBeGreaterThan(0);

    store.setSearchQuery(allCustomers[0].name.slice(0, 4));
    const searched = useCatalogStore.getState().getCustomers();
    expect(searched.length).toBeGreaterThan(0);
    expect(searched[0].name).toContain(allCustomers[0].name.slice(0, 4));
  });
});
