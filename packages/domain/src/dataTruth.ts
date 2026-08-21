/**
 * Data Truth Contract (OC-006 / prd-v2.md §Data Truth).
 *
 * Every dashboard KPI, metric, or summary declares its data provenance:
 * - `actual`: Real verified measurement (e.g. calculated from real resolved BOM, physical scans, logged events).
 * - `estimated`: Engineering approximation (e.g. calculated standard run rates).
 * - `forecast`: Statistical or predictive projection (e.g. expected completion date).
 * - `proxy`: Heuristic fallback when real data is unavailable (must be explicitly labeled and never presented as fact).
 * - `missing`: Data is unknown or not yet available.
 */

export type DataTruthOrigin = 'actual' | 'estimated' | 'forecast' | 'proxy' | 'missing';

export interface DataTruthMetric<T = number> {
  readonly value: T;
  readonly origin: DataTruthOrigin;
  readonly note?: string;
}

export const DATA_TRUTH_ORIGIN_LABELS_ES: Readonly<Record<DataTruthOrigin, string>> = {
  actual: 'Real',
  estimated: 'Estimado',
  forecast: 'Proyectado',
  proxy: 'Aproximado (proxy)',
  missing: 'Sin datos',
};
