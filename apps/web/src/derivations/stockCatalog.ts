/**
 * Pure derivation of the stock-panel catalog (F119): labels for tracked
 * materials, picker options grouped by kind, code→id maps and inventory
 * prices — computed from the workspace catalog.
 */

import type { Catalog, StockMaterialKind } from '@granete/domain';

export interface StockCatalogView {
  readonly labels: Record<string, string>;
  readonly options: ReadonlyArray<{
    kind: StockMaterialKind;
    items: ReadonlyArray<{ id: string; label: string }>;
  }>;
  readonly materialIdByCode: Record<string, string>;
  readonly edgeIdByCode: Record<string, string>;
  readonly prices: Record<string, number>;
  /** `${kind}:${materialId}` → unit label (OC-054 evidence table). */
  readonly units: Record<string, string>;
}

const EMPTY: StockCatalogView = {
  labels: {},
  options: [],
  materialIdByCode: {},
  edgeIdByCode: {},
  prices: {},
  units: {},
};

export function buildStockCatalog(catalog: Catalog | null): StockCatalogView {
  if (!catalog) return EMPTY;

  const labels: Record<string, string> = {};
  const materialIdByCode: Record<string, string> = {};
  const edgeIdByCode: Record<string, string> = {};
  const prices: Record<string, number> = {};
  const units: Record<string, string> = {};
  const options: Array<{
    kind: StockMaterialKind;
    items: Array<{ id: string; label: string }>;
  }> = [
    {
      kind: 'herrajes',
      items: catalog.hardware.map((h) => {
        labels[`herrajes:${h.id}`] = h.name;
        // Valor de inventario: precio unitario del herraje (pieza/juego/metro).
        prices[`herrajes:${h.id}`] = h.costPerUnit;
      units[`herrajes:${h.id}`] = h.unit;
        return { id: h.id, label: h.code ? `${h.name} (${h.code})` : h.name };
      }),
    },
    {
      kind: 'tableros',
      items: catalog.materials.map((m) => {
        labels[`tableros:${m.id}`] = m.name;
        materialIdByCode[m.code] = m.id;
        // Valor de inventario: precio por plancha (boardPrice).
        prices[`tableros:${m.id}`] = m.boardPrice;
      units[`tableros:${m.id}`] = 'plancha';
        return { id: m.id, label: m.code ? `${m.name} (${m.code})` : m.name };
      }),
    },
    {
      kind: 'cintillas',
      items: catalog.edges.map((e) => {
        labels[`cintillas:${e.id}`] = e.name;
        edgeIdByCode[e.code] = e.id;
        // Valor de inventario: costo por metro lineal (costPerMl).
        prices[`cintillas:${e.id}`] = e.costPerMl;
      units[`cintillas:${e.id}`] = 'ml';
        return { id: e.id, label: e.code ? `${e.name} (${e.code})` : e.name };
      }),
    },
  ];
  return { labels, options, materialIdByCode, edgeIdByCode, prices, units };
}
