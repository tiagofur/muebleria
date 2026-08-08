/**
 * Materials (MaterialBoard) catalog ABM — list + search + chips + modal MD.
 * F027: material links default edge band by id; create-edge shortcut from form.
 * Fase 3 UI: grouped form (Identidad / Tablero y precio / Vista 3D collapsible).
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { EdgeBand, MaterialBoard } from '@muebles/domain';
import {
  isValidPreviewColor,
  normalizePreviewColor,
} from '@muebles/domain';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Pencil,
  Plus,
  SearchX,
} from 'lucide-react';
import {
  CatalogImage,
  EmptyState,
  formatMoneyDisplay,
  Modal,
  SearchInput,
  StatusChips,
  useDebouncedValue,
  useRoutableEntitySelection,
} from '../common';
import { consumeRequestCreateKey } from '../common/consumeRequestCreateKey';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
} from './catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from './CatalogTable';
import { CatalogPicker } from './CatalogPicker';
import type { EdgeDraft } from './EdgesCatalog';
import { extractDominantColorFromImageFile } from './extractDominantColor';
import {
  loadImageNaturalSize,
  suggestTextureTileMmFromImage,
} from './materialTextureTileSuggest';

import './catalogs.css';

export type MaterialDraft = {
  code: string;
  name: string;
  widthMm: number;
  lengthMm: number;
  thicknessMm: number;
  grainDefault: boolean;
  boardPrice: number;
  wastePercent: number;
  costPerM2: number;
  /** Linked EdgeBand id (never by name). Empty string = none. */
  defaultEdgeBandId: string;
  /** Relative media path (F040/F042). */
  imageUrl: string;
  /** #RRGGBB solid color for 3D / swatches. Empty = none. */
  previewColor: string;
  /** Optional texture media URL for 3D. Empty = none. */
  previewTextureUrl: string;
  /**
   * Real-world mm covered by one texture image across width (X / U).
   * 0 = default client tile.
   */
  previewTextureTileWidthMm: number;
  /**
   * Real-world mm covered by one texture image along length/veta (Y / V).
   * 0 = default client tile.
   */
  previewTextureTileLengthMm: number;
  /**
   * Optional 0..1 PBR roughness override for the 3D preview.
   * undefined = fall back to the lighting-mode value (0 is a valid value).
   */
  previewRoughness?: number;
  /** Optional 0..1 metalness (1 = metal, 0 = dielectric). undefined = fallback. */
  previewMetalness?: number;
  /** Optional 0..1 clearcoat (lacquer layer). undefined = fallback. */
  previewClearcoat?: number;
  notes: string;
};

/** Inputs the shell needs to compute costPerM2 (domain formula stays out of UI). */
export type MaterialCostInputs = {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly boardPrice: number;
  readonly wastePercent: number;
};

const emptyDraft = (): MaterialDraft => ({
  code: '',
  name: '',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 0,
  wastePercent: 0,
  costPerM2: 0,
  defaultEdgeBandId: '',
  imageUrl: '',
  previewColor: '',
  previewTextureUrl: '',
  previewTextureTileWidthMm: 0,
  previewTextureTileLengthMm: 0,
  notes: '',
});

function toDraft(item: MaterialBoard): MaterialDraft {
  return {
    code: item.code,
    name: item.name,
    widthMm: item.widthMm,
    lengthMm: item.lengthMm,
    thicknessMm: item.thicknessMm,
    grainDefault: item.grainDefault,
    boardPrice: item.boardPrice,
    wastePercent: item.wastePercent,
    costPerM2: item.costPerM2,
    defaultEdgeBandId: item.defaultEdgeBandId ?? '',
    imageUrl: item.imageUrl ?? '',
    previewColor: item.previewColor ?? '',
    previewTextureUrl: item.previewTextureUrl ?? '',
    previewTextureTileWidthMm: item.previewTextureTileWidthMm ?? 0,
    previewTextureTileLengthMm: item.previewTextureTileLengthMm ?? 0,
    previewRoughness: item.previewRoughness,
    previewMetalness: item.previewMetalness,
    previewClearcoat: item.previewClearcoat,
    notes: item.notes ?? '',
  };
}

const emptyEdgeDraft = (): EdgeDraft => ({
  code: '',
  name: '',
  thicknessMm: 0.5,
  costPerMl: 0,
  notes: '',
});

/** True when the draft already has 3D preview overrides (open advanced on edit). */
function hasPreview3dConfig(d: MaterialDraft): boolean {
  return Boolean(
    d.previewColor.trim() ||
      d.previewTextureUrl.trim() ||
      d.previewTextureTileWidthMm > 0 ||
      d.previewTextureTileLengthMm > 0 ||
      d.previewRoughness != null ||
      d.previewMetalness != null ||
      d.previewClearcoat != null,
  );
}

/**
 * Clamp a PBR scalar to [0,1]. undefined / NaN / ±Infinity → undefined (so the
 * preview falls back to the lighting-mode value). 0 is preserved (valid value).
 */
function clampPbr(v: number | undefined): number | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  return Math.min(1, Math.max(0, v));
}

/**
 * Finish presets (decision D2: UI-only — they just set the three numbers).
 * Ordered: roughness / metalness / clearcoat.
 */
const PBR_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
}> = [
  { id: 'mate', label: 'Mate', roughness: 0.9, metalness: 0, clearcoat: 0 },
  { id: 'satinado', label: 'Satinado', roughness: 0.55, metalness: 0, clearcoat: 0.25 },
  { id: 'brillante', label: 'Brillante', roughness: 0.25, metalness: 0, clearcoat: 0.7 },
  { id: 'metalico', label: 'Metálico', roughness: 0.35, metalness: 1, clearcoat: 0 },
];

export interface MaterialsCatalogProps {
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly onCreate: (draft: MaterialDraft) => void;
  readonly onUpdate: (id: string, draft: MaterialDraft) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  /** Creates an edge band and returns its new id (for linking as default). */
  readonly onCreateEdge: (draft: EdgeDraft) => string;
  /**
   * Domain formula injected by the shell (architecture.md: UI does not calculate).
   * Used for live preview and to fill draft.costPerM2 on save.
   */
  readonly getCostPerM2: (input: MaterialCostInputs) => number;
  /** URL handoff: `/materials/:id` expands that row. */
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /**
   * Increment from shell to open create modal (Dashboard getting-started).
   * 0 / undefined = no request.
   */
  readonly requestCreateKey?: number;
  /** F035: hide ABM when false (read-only list). */
  readonly canMutate?: boolean;
  /** F039: hide unit costs for vendedor. */
  readonly showCosts?: boolean;
  /** F042: upload catalog image; returns relative media URL. */
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function MaterialsCatalog({
  materials,
  edges,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  onCreateEdge,
  getCostPerM2,
  openEntityId = null,
  onSelectionChange,
  requestCreateKey = 0,
  canMutate = true,
  showCosts = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
}: MaterialsCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const materialIds = useMemo(() => materials.map((m) => m.id), [materials]);
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId,
      onSelectionChange,
      knownIds: materialIds,
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MaterialDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [edgeCreateOpen, setEdgeCreateOpen] = useState(false);
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft>(emptyEdgeDraft);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [tileSuggestBusy, setTileSuggestBusy] = useState(false);
  const [tileSuggestMsg, setTileSuggestMsg] = useState<string | null>(null);
  /** Progressive disclosure: color / texture / tile mm (Fase 3 UI). */
  const [preview3dOpen, setPreview3dOpen] = useState(false);

  const rows = useMemo(
    () =>
      filterCatalogItems(materials, {
        status,
        query: debouncedSearch,
      }),
    [materials, status, debouncedSearch],
  );

  const activeEdges = useMemo(
    () => edges.filter((e) => e.active),
    [edges],
  );

  const edgeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of edges) {
      map.set(e.id, e.name);
    }
    return map;
  }, [edges]);

  const textureImagePath =
    draft.previewTextureUrl.trim() || draft.imageUrl.trim() || '';

  const suggestTilesFromImage = async () => {
    setTileSuggestMsg(null);
    if (!textureImagePath) {
      setTileSuggestMsg(
        'Cargá una foto del material (o activá “Usar foto como textura 3D”) antes de sugerir medidas.',
      );
      return;
    }
    const url = resolveImageUrl(textureImagePath);
    if (!url) {
      setTileSuggestMsg('No se pudo resolver la URL de la imagen.');
      return;
    }
    setTileSuggestBusy(true);
    try {
      const { widthPx, heightPx } = await loadImageNaturalSize(url);
      const suggested = suggestTextureTileMmFromImage({
        imageWidthPx: widthPx,
        imageHeightPx: heightPx,
        boardWidthMm: draft.widthMm,
        boardLengthMm: draft.lengthMm,
        baseWidthMm:
          draft.previewTextureTileWidthMm > 0
            ? draft.previewTextureTileWidthMm
            : undefined,
      });
      setDraft((prev) => ({
        ...prev,
        previewTextureTileWidthMm: suggested.tileWidthMm,
        previewTextureTileLengthMm: suggested.tileLengthMm,
      }));
      setTileSuggestMsg(
        suggested.mode === 'board'
          ? `Base desde el tablero: ${suggested.tileWidthMm} × ${suggested.tileLengthMm} mm (foto ≈ cara completa). Ajustá si es un recorte.`
          : `Base por proporción de la imagen (${widthPx}×${heightPx} px): ${suggested.tileWidthMm} × ${suggested.tileLengthMm} mm. Ajustá si no calza en 3D.`,
      );
    } catch {
      setTileSuggestMsg(
        'No se pudo leer la imagen. Verificá que la foto cargue bien en el catálogo.',
      );
    } finally {
      setTileSuggestBusy(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setTileSuggestMsg(null);
    setTileSuggestBusy(false);
    setPreview3dOpen(false);
    setError(null);
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setPreview3dOpen(false);
    setTileSuggestMsg(null);
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
    setModalOpen(true);
  };

  // Consume once per key bump so remount with the same key does not re-open
  // create (JD R4-W sticky create — same pattern as ModulesScreen).
  useEffect(() => {
    if (!consumeRequestCreateKey('materials', requestCreateKey)) return;
    startCreate();
    // Intentionally only when shell bumps the key (Dashboard handoff).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate is stable enough per bump
  }, [requestCreateKey]);

  const startEdit = (item: MaterialBoard) => {
    const next = toDraft(item);
    setEditingId(item.id);
    setDraft(next);
    setError(null);
    setPreview3dOpen(hasPreview3dConfig(next));
    setTileSuggestMsg(null);
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
    setModalOpen(true);
  };

  const openCreateEdge = () => {
    const name = draft.name.trim();
    const code = draft.code.trim();
    setEdgeDraft({
      code: code ? `CAN-${code.replace(/^TAB-?/i, '')}` : '',
      name: name || '',
      thicknessMm: 0.5,
      costPerMl: 0,
      notes: '',
    });
    setEdgeError(null);
    setEdgeCreateOpen(true);
  };

  const submitCreateEdge = () => {
    const codeErr = validateUniqueCode(edgeDraft.code, edges);
    if (codeErr) {
      setEdgeError(codeErr);
      return;
    }
    const nameErr = validateRequiredName(edgeDraft.name);
    if (nameErr) {
      setEdgeError(nameErr);
      return;
    }
    const numErr =
      validateNonNegativeNumber(edgeDraft.thicknessMm, 'Espesor canto (mm)') ??
      validateNonNegativeNumber(edgeDraft.costPerMl, 'Costo / ML');
    if (numErr) {
      setEdgeError(numErr);
      return;
    }
    const newId = onCreateEdge(edgeDraft);
    setDraft((d) => ({ ...d, defaultEdgeBandId: newId }));
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
  };

  const toggleExpand = (item: MaterialBoard) => {
    toggleSelectedId(item.id);
  };

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(
      draft.code,
      materials,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    const colorTrim = draft.previewColor.trim();
    if (colorTrim && !isValidPreviewColor(colorTrim)) {
      return 'Color de vista previa inválido. Usá #RGB o #RRGGBB, o dejalo vacío.';
    }
    return (
      validateNonNegativeNumber(draft.widthMm, 'Ancho (mm)') ??
      validateNonNegativeNumber(draft.lengthMm, 'Largo (mm)') ??
      validateNonNegativeNumber(draft.thicknessMm, 'Espesor (mm)') ??
      validateNonNegativeNumber(draft.boardPrice, 'Precio del tablero') ??
      validateNonNegativeNumber(draft.wastePercent, 'Merma (%)')
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    const calculatedCost = getCostPerM2({
      widthMm: draft.widthMm,
      lengthMm: draft.lengthMm,
      boardPrice: draft.boardPrice,
      wastePercent: draft.wastePercent,
    });
    const normalizedColor = normalizePreviewColor(draft.previewColor);
    const finalDraft = {
      ...draft,
      costPerM2: calculatedCost,
      previewColor: normalizedColor ?? '',
      previewTextureUrl: draft.previewTextureUrl.trim(),
      previewTextureTileWidthMm:
        draft.previewTextureTileWidthMm > 0
          ? draft.previewTextureTileWidthMm
          : 0,
      previewTextureTileLengthMm:
        draft.previewTextureTileLengthMm > 0
          ? draft.previewTextureTileLengthMm
          : 0,
      previewRoughness: clampPbr(draft.previewRoughness),
      previewMetalness: clampPbr(draft.previewMetalness),
      previewClearcoat: clampPbr(draft.previewClearcoat),
    };

    if (editingId) {
      onUpdate(editingId, finalDraft);
    } else {
      onCreate(finalDraft);
    }
    closeModal();
  };

  const columns: CatalogColumn<MaterialBoard>[] = useMemo(
    () => [
      {
        key: 'image',
        header: 'Foto',
        render: (r) => (
          <CatalogImage
            src={resolveImageUrl(r.imageUrl)}
            alt={r.name}
            size="sm"
          />
        ),
      },
      {
        key: 'previewColor',
        header: 'Color',
        render: (r) =>
          r.previewColor ? (
            <svg
              className="material-color-swatch"
              width={20}
              height={20}
              viewBox="0 0 20 20"
              aria-label={r.previewColor}
              data-testid={`material-swatch-${r.id}`}
            >
              <rect
                x={0}
                y={0}
                width={20}
                height={20}
                rx={4}
                fill={r.previewColor}
              />
            </svg>
          ) : (
            <span className="catalog-form__hint">—</span>
          ),
      },
      {
        key: 'code',
        header: 'Código',
        render: (r) => (
          <span className="catalog-row-detail__value--mono">{r.code}</span>
        ),
      },
      { key: 'name', header: 'Nombre', render: (r) => r.name },
      {
        key: 'thickness',
        header: 'Espesor (mm)',
        render: (r) => r.thicknessMm,
      },
      {
        key: 'dimensions',
        header: 'Medidas (mm)',
        render: (r) => `${r.lengthMm} × ${r.widthMm}`,
      },
      {
        key: 'boardPrice',
        header: 'Precio Hoja',
        render: (r) => formatMoneyDisplay(r.boardPrice),
      },
      {
        key: 'waste',
        header: 'Merma (%)',
        render: (r) => `${r.wastePercent}%`,
      },
      {
        key: 'cost',
        header: 'Costo/m²',
        render: (r) => formatMoneyDisplay(r.costPerM2),
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [resolveImageUrl],
  );
  const visibleColumns = useMemo(
    () =>
      showCosts
        ? columns
        : columns.filter(
            (c) => c.key !== 'boardPrice' && c.key !== 'waste' && c.key !== 'cost',
          ),
    [columns, showCosts],
  );

  const isTrulyEmpty = materials.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section className="catalog-page" aria-label="Catálogo de materiales">
      <div className="catalog-page__header">
        <div>
          <h2 className="catalog-page__title">Materiales</h2>
          <p className="page-header__subtitle">
            Tableros del catálogo (melamina, MDF, etc.)
          </p>
        </div>
        <div className="catalog-page__toolbar">
          {canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo material
            </button>
          ) : null}
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar materiales…"
            aria-label="Buscar materiales"
          />
          <StatusChips value={status} onChange={setStatus} />
        </div>
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={Layers}
            title="No hay materiales"
            description="Agregá el primer tablero del catálogo o cargá la semilla del workspace."
            actionLabel="Agregar material"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="Sin resultados"
            description="No hay materiales que coincidan con la búsqueda o el filtro."
            actionLabel="Limpiar filtros"
            onAction={() => {
              setSearch('');
              setStatus('active');
            }}
          />
        ) : (
          <CatalogTable
            columns={visibleColumns}
            rows={rows}
            expandedId={expandedId}
            isInactive={(r) => !r.active}
            onRowClick={toggleExpand}
            renderExpandedDetail={(row) => (
              <>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Foto</span>
                  <CatalogImage
                    src={resolveImageUrl(row.imageUrl)}
                    alt={row.name}
                    size="md"
                  />
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Código</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    {row.code}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Nombre</span>
                  <span className="catalog-row-detail__value">{row.name}</span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Espesor</span>
                  <span className="catalog-row-detail__value">
                    {row.thicknessMm} mm
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Medidas (Largo × Ancho)</span>
                  <span className="catalog-row-detail__value">
                    {row.lengthMm} mm × {row.widthMm} mm
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Veta por defecto</span>
                  <span className="catalog-row-detail__value">
                    {row.grainDefault ? 'Sí' : 'No'}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Cintilla default</span>
                  <span className="catalog-row-detail__value">
                    {row.defaultEdgeBandId
                      ? (edgeNameById.get(row.defaultEdgeBandId) ??
                        row.defaultEdgeBandId)
                      : '—'}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Precio Tablero</span>
                  <span className="catalog-row-detail__value">
                    {formatMoneyDisplay(row.boardPrice)}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Merma</span>
                  <span className="catalog-row-detail__value">
                    {row.wastePercent}%
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Costo / m² (con merma)</span>
                  <span className="catalog-row-detail__value">
                    {formatMoneyDisplay(row.costPerM2)}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Estado</span>
                  <span className="catalog-row-detail__value">
                    <ActiveBadge active={row.active} />
                  </span>
                </div>
                {row.notes ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Notas</span>
                    <span className="catalog-row-detail__value">{row.notes}</span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => startEdit(row)}
                  >
                    <Pencil size={14} strokeWidth={1.5} aria-hidden />
                    Editar
                  </button>
                  {row.active ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => onDeactivate(row.id)}
                    >
                      <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                      Desactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => onReactivate(row.id)}
                    >
                      <Eye size={14} strokeWidth={1.5} aria-hidden />
                      Reactivar
                    </button>
                  )}
                </div>
              </>
            )}
            getRowActions={(row) => (
              <>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  aria-label={`Editar ${row.code}`}
                  onClick={() => startEdit(row)}
                >
                  <Pencil size={14} strokeWidth={1.5} aria-hidden />
                  Editar
                </button>
                {row.active ? (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost btn--danger"
                    aria-label={`Desactivar ${row.code}`}
                    onClick={() => onDeactivate(row.id)}
                  >
                    <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                    Desactivar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    aria-label={`Reactivar ${row.code}`}
                    onClick={() => onReactivate(row.id)}
                  >
                    <Eye size={14} strokeWidth={1.5} aria-hidden />
                    Reactivar
                  </button>
                )}
              </>
            )}
          />
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar material' : 'Nuevo material'}
        size="md"
        dataTestId="material-form-modal"
        footer={
          <>
            <button type="button" className="btn" onClick={closeModal}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" form={formId}>
              Guardar
            </button>
          </>
        }
      >
        <form id={formId} className="catalog-form" onSubmit={handleSubmit}>
          {error ? <p className="catalog-form__error">{error}</p> : null}

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Identidad</legend>
            <div className="catalog-form__field">
              <label htmlFor="mat-code">Código</label>
              <input
                id="mat-code"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                autoComplete="off"
                required
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="mat-name">Nombre</label>
              <input
                id="mat-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </div>
            <div
              className="catalog-form__field"
              data-testid="material-image-field"
            >
              <label htmlFor="mat-image">Foto</label>
              <div className="catalog-form__image-row">
                <CatalogImage
                  src={resolveImageUrl(draft.imageUrl || undefined)}
                  alt={draft.name || 'Material'}
                  size="md"
                />
                {canMutate && onUploadImage ? (
                  <input
                    id="mat-image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void (async () => {
                        try {
                          const url = await onUploadImage(file);
                          let previewColor: string | undefined;
                          try {
                            previewColor =
                              await extractDominantColorFromImageFile(file);
                          } catch {
                            /* color is optional */
                          }
                          setDraft((prev) => ({
                            ...prev,
                            imageUrl: url,
                            ...(previewColor && !prev.previewColor.trim()
                              ? { previewColor }
                              : {}),
                          }));
                          if (previewColor) setPreview3dOpen(true);
                        } catch {
                          /* shell toasts */
                        }
                      })();
                      e.target.value = '';
                    }}
                  />
                ) : (
                  <p className="catalog-form__hint">
                    {draft.imageUrl ? 'Foto cargada' : 'Sin foto'}
                  </p>
                )}
              </div>
              <p className="catalog-form__hint">
                Opcional. El color y la textura 3D se ajustan en «Vista 3D y
                textura».
              </p>
            </div>
          </fieldset>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">
              Tablero y precio
            </legend>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="mat-thickness">Espesor (mm)</label>
                <input
                  id="mat-thickness"
                  type="number"
                  min={0}
                  step="any"
                  value={draft.thicknessMm}
                  onChange={(e) =>
                    setDraft({ ...draft, thicknessMm: Number(e.target.value) })
                  }
                  required
                />
              </div>
              <div className="catalog-form__field catalog-form__row-check catalog-form__field--grow">
                <input
                  id="mat-grain"
                  type="checkbox"
                  checked={draft.grainDefault}
                  onChange={(e) =>
                    setDraft({ ...draft, grainDefault: e.target.checked })
                  }
                />
                <label htmlFor="mat-grain">Veta por defecto</label>
              </div>
            </div>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="mat-width">Ancho del tablero (mm)</label>
                <input
                  id="mat-width"
                  type="number"
                  min={1}
                  value={draft.widthMm}
                  onChange={(e) =>
                    setDraft({ ...draft, widthMm: Number(e.target.value) })
                  }
                  required
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="mat-length">Largo del tablero (mm)</label>
                <input
                  id="mat-length"
                  type="number"
                  min={1}
                  value={draft.lengthMm}
                  onChange={(e) =>
                    setDraft({ ...draft, lengthMm: Number(e.target.value) })
                  }
                  required
                />
              </div>
            </div>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="mat-price">Precio del tablero ($)</label>
                <input
                  id="mat-price"
                  type="number"
                  min={0}
                  step="any"
                  value={draft.boardPrice}
                  onChange={(e) =>
                    setDraft({ ...draft, boardPrice: Number(e.target.value) })
                  }
                  required
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="mat-waste">Merma (%)</label>
                <input
                  id="mat-waste"
                  type="number"
                  min={0}
                  step="any"
                  value={draft.wastePercent}
                  onChange={(e) =>
                    setDraft({ ...draft, wastePercent: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="catalog-form__field">
              <label>Costo / m² calculado (con merma)</label>
              <div className="catalog-form__calculated-value">
                {formatMoneyDisplay(
                  getCostPerM2({
                    widthMm: draft.widthMm,
                    lengthMm: draft.lengthMm,
                    boardPrice: draft.boardPrice,
                    wastePercent: draft.wastePercent,
                  }),
                )}
              </div>
            </div>
            <div className="catalog-form__field">
              <div className="catalog-form__inline-actions">
                <CatalogPicker
                  id="mat-default-edge"
                  className="catalog-picker--grow"
                  label="Cintilla por defecto"
                  placeholder="— Sin cintilla —"
                  searchPlaceholder="Buscar cintilla…"
                  value={draft.defaultEdgeBandId}
                  onChange={(defaultEdgeBandId) =>
                    setDraft({ ...draft, defaultEdgeBandId })
                  }
                  items={activeEdges.map((e) => ({
                    id: e.id,
                    code: e.code,
                    name: e.name,
                    active: e.active,
                    subtitle: `${e.thicknessMm} mm`,
                  }))}
                  data-testid="material-edge-picker"
                />
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={openCreateEdge}
                >
                  <Plus size={14} strokeWidth={1.5} aria-hidden />
                  Crear cintilla
                </button>
              </div>
              <p className="catalog-form__hint">
                Link por id. Se usa cuando la pieza tiene cantos y la cotización
                no elige un grupo EDGE.
              </p>
            </div>
            <div className="catalog-form__field">
              <label htmlFor="mat-notes">Notas</label>
              <textarea
                id="mat-notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </fieldset>

          <div className="catalog-form__disclosure" data-testid="material-preview-3d">
            <button
              type="button"
              className="catalog-form__disclosure-header"
              aria-expanded={preview3dOpen}
              onClick={() => setPreview3dOpen((o) => !o)}
              data-testid="material-preview-3d-toggle"
            >
              {preview3dOpen ? (
                <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
              ) : (
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
              )}
              <span className="catalog-form__disclosure-title">
                Vista 3D y textura
              </span>
              <span className="catalog-form__disclosure-summary">
                {hasPreview3dConfig(draft)
                  ? 'Configurado'
                  : 'Opcional — color, foto y escala'}
              </span>
            </button>
            {preview3dOpen ? (
              <div
                className="catalog-form__disclosure-body"
                data-testid="material-preview-3d-body"
              >
                <div
                  className="catalog-form__field"
                  data-testid="material-preview-color-field"
                >
                  <label htmlFor="mat-preview-color">Color de vista previa</label>
                  <div className="material-preview-color-row">
                    <input
                      id="mat-preview-color-picker"
                      type="color"
                      className="material-preview-color-picker"
                      value={
                        /^#([0-9a-fA-F]{6})$/.test(draft.previewColor)
                          ? draft.previewColor
                          : '#D4C4A8'
                      }
                      onChange={(e) =>
                        setDraft({ ...draft, previewColor: e.target.value })
                      }
                      aria-label="Selector de color"
                      data-testid="material-preview-color-picker"
                    />
                    <input
                      id="mat-preview-color"
                      className="material-preview-color-hex"
                      value={draft.previewColor}
                      onChange={(e) =>
                        setDraft({ ...draft, previewColor: e.target.value })
                      }
                      placeholder="#F5F5F0"
                      autoComplete="off"
                      data-testid="material-preview-color-input"
                    />
                  </div>
                  <p className="catalog-form__hint">
                    Color sólido para el 3D (#RRGGBB). Vacío = color genérico.
                  </p>
                </div>
                <div className="catalog-form__field catalog-form__row-check">
                  <input
                    id="mat-use-photo-texture"
                    type="checkbox"
                    checked={Boolean(
                      draft.previewTextureUrl &&
                        draft.imageUrl &&
                        draft.previewTextureUrl === draft.imageUrl,
                    )}
                    disabled={!draft.imageUrl}
                    onChange={(e) => {
                      if (e.target.checked && draft.imageUrl) {
                        setDraft({
                          ...draft,
                          previewTextureUrl: draft.imageUrl,
                        });
                      } else {
                        setDraft({ ...draft, previewTextureUrl: '' });
                      }
                    }}
                    data-testid="material-use-photo-texture"
                  />
                  <label htmlFor="mat-use-photo-texture">
                    Usar foto como textura 3D
                  </label>
                </div>
                <p className="catalog-form__hint">
                  Con textura se muestra la foto en las caras. Sin textura, si hay
                  veta se dibuja veta procedural sobre el color.
                </p>
                <div className="catalog-form__field-row">
                  <div className="catalog-form__field catalog-form__field--grow">
                    <label htmlFor="mat-tex-tile-w">
                      Muestra textura X — ancho (mm)
                    </label>
                    <input
                      id="mat-tex-tile-w"
                      type="number"
                      min={0}
                      step="1"
                      value={draft.previewTextureTileWidthMm || ''}
                      placeholder="280"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          previewTextureTileWidthMm:
                            Number(e.target.value) || 0,
                        })
                      }
                      data-testid="material-texture-tile-width"
                    />
                  </div>
                  <div className="catalog-form__field catalog-form__field--grow">
                    <label htmlFor="mat-tex-tile-l">
                      Muestra textura Y — largo/veta (mm)
                    </label>
                    <input
                      id="mat-tex-tile-l"
                      type="number"
                      min={0}
                      step="1"
                      value={draft.previewTextureTileLengthMm || ''}
                      placeholder="280"
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          previewTextureTileLengthMm:
                            Number(e.target.value) || 0,
                        })
                      }
                      data-testid="material-texture-tile-length"
                    />
                  </div>
                </div>
                <div className="catalog-form__inline-actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={
                      tileSuggestBusy || !textureImagePath || !canMutate
                    }
                    onClick={() => {
                      void suggestTilesFromImage();
                    }}
                    data-testid="material-texture-tile-suggest"
                  >
                    {tileSuggestBusy
                      ? 'Leyendo imagen…'
                      : 'Sugerir medidas desde la imagen'}
                  </button>
                </div>
                {tileSuggestMsg ? (
                  <p
                    className="catalog-form__hint"
                    data-testid="material-texture-tile-suggest-msg"
                  >
                    {tileSuggestMsg}
                  </p>
                ) : null}
                <p className="catalog-form__hint">
                  Tamaño real de una imagen completa de textura (mm). Vacío =
                  280 mm. Más mm = textura más grande en la pieza.
                </p>
                <div
                  className="catalog-form__field"
                  data-testid="material-pbr-field"
                >
                  <label>Acabado PBR (3D)</label>
                  <div
                    className="catalog-form__inline-actions"
                    role="group"
                    aria-label="Acabados predefinidos"
                  >
                    {PBR_PRESETS.map((preset) => {
                      const active =
                        draft.previewRoughness === preset.roughness &&
                        draft.previewMetalness === preset.metalness &&
                        draft.previewClearcoat === preset.clearcoat;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={`btn btn--small${active ? ' btn--active' : ''}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              previewRoughness: preset.roughness,
                              previewMetalness: preset.metalness,
                              previewClearcoat: preset.clearcoat,
                            })
                          }
                          aria-pressed={active}
                          data-testid={`material-pbr-preset-${preset.id}`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="catalog-form__field-row">
                    <div className="catalog-form__field catalog-form__field--grow">
                      <label htmlFor="mat-pbr-roughness">Rugosidad (3D)</label>
                      <input
                        id="mat-pbr-roughness"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={draft.previewRoughness ?? ''}
                        placeholder="0–1"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            previewRoughness:
                              e.target.value === ''
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                        data-testid="material-pbr-roughness"
                      />
                    </div>
                    <div className="catalog-form__field catalog-form__field--grow">
                      <label htmlFor="mat-pbr-metalness">
                        Metalicidad (3D)
                      </label>
                      <input
                        id="mat-pbr-metalness"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={draft.previewMetalness ?? ''}
                        placeholder="0–1"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            previewMetalness:
                              e.target.value === ''
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                        data-testid="material-pbr-metalness"
                      />
                    </div>
                    <div className="catalog-form__field catalog-form__field--grow">
                      <label htmlFor="mat-pbr-clearcoat">Barniz (3D)</label>
                      <input
                        id="mat-pbr-clearcoat"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={draft.previewClearcoat ?? ''}
                        placeholder="0–1"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            previewClearcoat:
                              e.target.value === ''
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                        data-testid="material-pbr-clearcoat"
                      />
                    </div>
                  </div>
                  <p className="catalog-form__hint">
                    Rugosidad, metalicidad y barniz para el render 3D (0–1).
                    Vacío = valor por modo de luz. Metálico = acero; Barniz =
                    lacado brillante.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </form>
      </Modal>

      {/* Sibling modal (not nested inside the material form) */}
      <Modal
        open={edgeCreateOpen}
        onClose={() => {
          setEdgeCreateOpen(false);
          setEdgeError(null);
        }}
        title="Nueva cintilla"
        size="sm"
        dataTestId="material-edge-create-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEdgeCreateOpen(false);
                setEdgeError(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={submitCreateEdge}
              data-testid="material-edge-create-submit"
            >
              Crear y vincular
            </button>
          </>
        }
      >
        {edgeError ? (
          <p className="catalog-form__error">{edgeError}</p>
        ) : null}
        <div className="catalog-form">
          <div className="catalog-form__field">
            <label htmlFor="mat-edge-code">Código canto</label>
            <input
              id="mat-edge-code"
              value={edgeDraft.code}
              onChange={(e) =>
                setEdgeDraft({ ...edgeDraft, code: e.target.value })
              }
              autoComplete="off"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-edge-name">Nombre canto</label>
            <input
              id="mat-edge-name"
              value={edgeDraft.name}
              onChange={(e) =>
                setEdgeDraft({ ...edgeDraft, name: e.target.value })
              }
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-edge-thk">Espesor (mm)</label>
            <input
              id="mat-edge-thk"
              type="number"
              min={0}
              step="any"
              value={edgeDraft.thicknessMm}
              onChange={(e) =>
                setEdgeDraft({
                  ...edgeDraft,
                  thicknessMm: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-edge-cost">Costo / ML</label>
            <input
              id="mat-edge-cost"
              type="number"
              min={0}
              step="any"
              value={edgeDraft.costPerMl}
              onChange={(e) =>
                setEdgeDraft({
                  ...edgeDraft,
                  costPerMl: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      </Modal>
    </section>
  );
}
