/**
 * Piezas de diseño de un herraje multi-diseño (#1518 F1, evolución del par
 * D/I de #1512): una fila por ancla (izquierda/derecha/centro) con su asset
 * exacto y sus offsets x/y/z interpretados DESDE su lado — izq no se mueve,
 * der se mueve con el ancho, centro se mueve la mitad. El ancla sin asset
 * propio cae al asset global de la vista 3D (la UI lo declara).
 */

import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { HardwarePiece, HardwarePieceOffset } from '@granete/domain';
import { Layers } from 'lucide-react';
import type { HardwareAssetService } from '@granete/storage';
import type { HardwareDraft } from './hardwareDraft';
import { HardwareAssetSelectorModal } from './HardwareAssetSelectorModal';

const ANCHORS: readonly ('left' | 'right' | 'center')[] = ['left', 'right', 'center'];

const ANCHOR_LABELS: Record<'left' | 'right' | 'center', { label: string; hint: string }> = {
  left: { label: 'Izquierda', hint: 'anclada al borde izquierdo — no se mueve con el ancho' },
  right: { label: 'Derecha', hint: 'anclada al borde derecho — se mueve con el ancho' },
  center: { label: 'Centro', hint: 'anclada al centro — se mueve la mitad del ancho' },
};

function assetLabel(piece?: HardwarePiece): string {
  const asset = piece?.asset;
  if (!asset || !asset.assetId) return 'Sin asset propio (usa el global)';
  return asset.assetRevisionId
    ? `Revisión ${asset.assetRevisionId.slice(0, 8)}…`
    : 'Asset vinculado';
}

const numOrEmpty = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '' : String(v);

export function HardwarePiecesSection({
  draft,
  setDraft,
  canMutate,
  assetService,
}: {
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
  readonly canMutate: boolean;
  readonly assetService?: HardwareAssetService;
}): ReactNode {
  const hasPieces = Boolean(draft.pieces && draft.pieces.length > 0);
  const [sectionOpen, setSectionOpen] = useState(hasPieces);
  const [pickingAnchor, setPickingAnchor] = useState<'left' | 'right' | 'center' | null>(null);

  const pieceOf = (anchor: 'left' | 'right' | 'center'): HardwarePiece | undefined =>
    draft.pieces?.find((pc) => pc.anchor === anchor);

  const setPiece = (anchor: 'left' | 'right' | 'center', piece: HardwarePiece | undefined) => {
    setDraft((prev) => {
      const rest = (prev.pieces ?? []).filter((pc) => pc.anchor !== anchor);
      const next =
        piece && (piece.asset || piece.offsetMm)
          ? [...rest, piece].sort(
              (a, b) => ANCHORS.indexOf(a.anchor) - ANCHORS.indexOf(b.anchor),
            )
          : rest;
      return { ...prev, pieces: next.length > 0 ? next : undefined };
    });
  };

  const setOffset = (anchor: 'left' | 'right' | 'center', axis: 'x' | 'y' | 'z', raw: string) => {
    const piece = pieceOf(anchor);
    if (!piece) return; // offsets requieren pieza presente (asset u offsets previos)
    const value = raw.trim() === '' ? undefined : Number(raw);
    if (value !== undefined && !Number.isFinite(value)) return;
    const prevOff = piece.offsetMm ?? { x: 0, y: 0, z: 0 };
    const offsetMm: HardwarePieceOffset = { ...prevOff, [axis]: value ?? 0 };
    setPiece(anchor, { ...piece, offsetMm });
  };

  return (
    <fieldset className="catalog-form__section" data-testid="hardware-form-pieces">
      <legend className="catalog-form__section-title">
        Piezas de diseño{hasPieces ? ` · ${draft.pieces!.length}` : ''}
      </legend>
      <p className="catalog-form__hint">
        Un herraje con piezas dibuja un SKP por lado: un solo registro en vez de filas
        duplicadas. Cada pieza declara su ancla y sus offsets x/y/z medidos DESDE su lado.
      </p>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => setSectionOpen((v) => !v)}
        aria-expanded={sectionOpen}
        data-testid="hardware-pieces-toggle"
      >
        <Layers size={14} strokeWidth={1.5} aria-hidden />
        {sectionOpen ? 'Ocultar piezas' : 'Configurar piezas'}
      </button>
      {sectionOpen ? (
        <div className="catalog-hw-part" data-testid="hardware-pieces-rows">
          {ANCHORS.map((anchor) => {
            const piece = pieceOf(anchor);
            const meta = ANCHOR_LABELS[anchor];
            return (
              <div className="catalog-hw-part__row" key={anchor} data-testid={`hardware-piece-${anchor}`}>
                <div className="catalog-hw-part__identity">
                  <strong className="catalog-hw-part__title">{meta.label}</strong>
                  <span className="catalog-hw-part__meta">
                    {assetLabel(piece)} · {meta.hint}
                  </span>
                  {piece ? (
                    <div
                      className="agregado-editor__item-fields agregado-editor__item-fields--grid"
                      style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
                    >
                      {(['x', 'y', 'z'] as const).map((axis) => (
                        <label key={axis} className="catalog-form__field">
                          <span className="catalog-form__label">Offset {axis.toUpperCase()} (mm)</span>
                          <input
                            type="number"
                            step="0.5"
                            value={numOrEmpty(piece.offsetMm?.[axis] ?? 0)}
                            onChange={(e) => setOffset(anchor, axis, e.target.value)}
                            data-testid={`hardware-piece-${anchor}-offset-${axis}`}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
                {canMutate && assetService ? (
                  <div className="catalog-hw-part__actions">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => setPickingAnchor(anchor)}
                      data-testid={`hardware-piece-${anchor}-bind`}
                    >
                      {piece?.asset ? 'Cambiar' : 'Vincular asset'}
                    </button>
                    {piece ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => setPiece(anchor, undefined)}
                        data-testid={`hardware-piece-${anchor}-clear`}
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <HardwareAssetSelectorModal
        open={pickingAnchor !== null}
        onClose={() => setPickingAnchor(null)}
        assetService={assetService}
        canMutate={canMutate}
        currentBinding={pickingAnchor ? pieceOf(pickingAnchor)?.asset ?? null : null}
        onSelect={(binding) => {
          if (pickingAnchor) {
            const prev = pieceOf(pickingAnchor);
            setPiece(pickingAnchor, { anchor: pickingAnchor, asset: binding, offsetMm: prev?.offsetMm });
          }
          setPickingAnchor(null);
        }}
      />
    </fieldset>
  );
}
