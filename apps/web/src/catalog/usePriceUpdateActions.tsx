/**
 * #1651 — wires «Actualizar precios» into the materials, edges and hardware
 * catalogs and the price history into the material detail. Only authenticated
 * sessions with catalog authority get them. After an apply the workspace is
 * reloaded so the catalog (and its concurrency versions) reflect the server.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Percent } from 'lucide-react';
import type { CategoryNode } from '@granete/domain';
import { guessPriceListColumns, parseLocaleNumber, parsePriceListFile } from '@granete/excel';
import type { PriceResourceKind } from '@granete/storage';
import { BulkPriceUpdateDialog, PriceHistoryPanel, type PriceListReader } from '@granete/ui';
import { sessionScopeKey, type SessionScope } from '../shared/query/sessionScope';

const reader: PriceListReader = {
  read: async (file) => parsePriceListFile(file.name, await file.arrayBuffer()),
  parseNumber: parseLocaleNumber,
  guessColumns: guessPriceListColumns,
};

interface ButtonProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly kind: PriceResourceKind;
  readonly kindLabel: string;
  readonly priceUnitLabel: string;
  readonly categories?: readonly CategoryNode[];
  readonly groups?: readonly string[];
  readonly groupLabel?: string;
  readonly onApplied: (applied: number) => void | Promise<void>;
}

function PriceUpdateButton(props: ButtonProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--ghost" data-testid={`btn-bulk-prices-${props.kind}`} onClick={() => setOpen(true)}>
        <Percent size={16} strokeWidth={1.5} aria-hidden />
        Actualizar precios
      </button>
      {open ? (
        <BulkPriceUpdateDialog
          open
          onClose={() => setOpen(false)}
          baseUrl={props.baseUrl}
          token={props.token}
          kind={props.kind}
          kindLabel={props.kindLabel}
          priceUnitLabel={props.priceUnitLabel}
          categories={props.categories}
          groups={props.groups}
          groupLabel={props.groupLabel}
          reader={reader}
          onApplied={props.onApplied}
        />
      ) : null}
    </>
  );
}

function uniqueSorted(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
}

export interface PriceUpdateActionsInput {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly authToken: string | null;
  readonly sessionScope: SessionScope | null;
  readonly materialCategories: readonly CategoryNode[];
  readonly hardwareCategories: readonly CategoryNode[];
  readonly materials: readonly { readonly manufacturer?: string }[];
  readonly hardware: readonly { readonly brand?: string }[];
  readonly onApplied: (applied: number) => void | Promise<void>;
}

export interface PriceUpdateActions {
  readonly materialsAction?: ReactNode;
  readonly edgesAction?: ReactNode;
  readonly hardwareAction?: ReactNode;
  readonly renderMaterialPriceHistory?: (materialId: string) => ReactNode;
}

export function usePriceUpdateActions(input: PriceUpdateActionsInput): PriceUpdateActions {
  const { enabled, baseUrl, authToken, sessionScope, materialCategories, hardwareCategories, materials, hardware, onApplied } = input;
  const manufacturers = useMemo(() => uniqueSorted(materials.map((m) => m.manufacturer)), [materials]);
  const brands = useMemo(() => uniqueSorted(hardware.map((h) => h.brand)), [hardware]);
  return useMemo<PriceUpdateActions>(() => {
    if (!enabled || !authToken || !sessionScope) return {};
    const scope = sessionScopeKey(sessionScope);
    const common = { baseUrl, token: authToken, onApplied };
    return {
      materialsAction: (
        <PriceUpdateButton
          {...common}
          kind="material"
          kindLabel="materiales"
          priceUnitLabel="precio por tablero"
          categories={materialCategories}
          groups={manufacturers}
          groupLabel="Fabricante"
        />
      ),
      edgesAction: <PriceUpdateButton {...common} kind="edge" kindLabel="cantos" priceUnitLabel="precio por metro lineal" />,
      hardwareAction: (
        <PriceUpdateButton
          {...common}
          kind="hardware"
          kindLabel="herrajes"
          priceUnitLabel="precio por unidad"
          categories={hardwareCategories}
          groups={brands}
          groupLabel="Marca"
        />
      ),
      renderMaterialPriceHistory: (materialId: string) => (
        <PriceHistoryPanel
          baseUrl={baseUrl}
          token={authToken}
          kind="material"
          resourceId={materialId}
          queryKey={['catalog-price-history', ...scope, 'material', materialId]}
        />
      ),
    };
  }, [enabled, authToken, sessionScope, baseUrl, onApplied, materialCategories, hardwareCategories, manufacturers, brands]);
}
