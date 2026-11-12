/**
 * Diseño del herraje (#1518 F1 → rework #1596): una fila por lado
 * (izquierda/derecha, centro sólo si ya existe) con SU diseño — subir o
 * elegir en el mismo lugar — y sus offsets X/Y/Z SIEMPRE visibles: lo
 * mostrado es lo que se guarda (#1596 alcance 5; el default 10/35 del motor
 * se materializa al editar un herraje legacy, nunca queda invisible).
 * «Copiar al otro lado» es explícito (decisión 3: nunca espejo automático).
 * «Al abrir» (decisión 4) se guarda en la declaración que el motor ya lee
 * (DesignParts[0].actorMembership vía kitPieceMember).
 */

import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { HardwarePiece, HardwarePieceOffset } from '@granete/domain';
import { defaultPieceOffsetMm } from '@granete/domain';
import { Copy, Layers } from 'lucide-react';
import type { HardwareAssetService } from '@granete/storage';
import type { HardwareVisualAssetBinding } from '@granete/domain';
import type { HardwareDraft, HardwareItemType } from './hardwareDraft';
import { HardwareAssetSelectorModal } from './HardwareAssetSelectorModal';
import { HardwareAssetUploadModal } from './HardwareAssetUploadModal';

const BASE_ANCHORS: readonly ('left' | 'right')[] = ['left', 'right'];
const ALL_ANCHORS: readonly ('left' | 'right' | 'center')[] = ['left', 'right', 'center'];

const ANCHOR_LABELS: Record<'left' | 'right' | 'center', { label: string; hint: string }> = {
  left: { label: 'Izquierda', hint: 'anclada al borde izquierdo — no se mueve con el ancho' },
  right: { label: 'Derecha', hint: 'anclada al borde derecho — se mueve con el ancho' },
  center: { label: 'Centro', hint: 'anclada al centro — se mueve la mitad del ancho' },
};

/** #1596 decisión 4: el control visible de «Al abrir» (vocabulario del motor). */
export const PIECE_ACTOR_OPTIONS = [
  { value: 'body', label: 'Fija al mueble (no se mueve)' },
  { value: 'actor:drawer', label: 'Viaja con el cajón al abrir' },
  { value: 'actor:door', label: 'Viaja con la puerta al abrir' },
] as const;

function assetLabel(piece?: HardwarePiece): string {
  const asset = piece?.asset;
  if (!asset || !asset.assetId) return 'Sin diseño (queda pendiente)';
  return asset.assetRevisionId
    ? `Revisión ${asset.assetRevisionId.slice(0, 8)}…`
    : 'Asset vinculado';
}

export function HardwarePiecesSection({
  draft,
  setDraft,
  canMutate,
  assetService,
  itemType,
}: {
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
  readonly canMutate: boolean;
  readonly assetService?: HardwareAssetService;
  /** #1596: tipo del alta — par/inserto abren la sección fija sin toggle. */
  readonly itemType?: HardwareItemType;
}): ReactNode {
  const isPairLike = itemType === 'pair' || itemType === 'inserto';
  const hasPieces = Boolean(draft.pieces && draft.pieces.length > 0);
  const [sectionOpen, setSectionOpen] = useState(hasPieces);
  const [pickingAnchor, setPickingAnchor] = useState<'left' | 'right' | 'center' | null>(null);
  const [uploadingAnchor, setUploadingAnchor] = useState<'left' | 'right' | 'center' | null>(null);

  // #1596 alcance 5: al abrir un PAR/INSERTO, ambos lados existen desde ya
  // con offsets explícitos. Un herraje legacy sin offsetMm materializa el
  // default que el motor le estaba aplicando en silencio (10/35 mm) — se
  // muestra, y si se guarda, queda guardado.
  useEffect(() => {
    if (!isPairLike) return;
    setDraft((prev) => {
      const legacy = { code: prev.code, name: prev.name, designParts: prev.designParts };
      let changed = false;
      const pieces: HardwarePiece[] = [...(prev.pieces ?? [])];
      for (const anchor of BASE_ANCHORS) {
        const idx = pieces.findIndex((pc) => pc.anchor === anchor);
        if (idx === -1) {
          pieces.push({ anchor, offsetMm: { x: 0, y: 0, z: 0 } });
          changed = true;
        } else {
          const current = pieces[idx]!;
          if (!current.offsetMm) {
            pieces[idx] = { ...current, offsetMm: defaultPieceOffsetMm(legacy, anchor) };
            changed = true;
          }
        }
      }
      const needsActor = (prev.designParts ?? []).length === 0;
      const designParts = needsActor
        ? [
            {
              componentName: prev.code.trim() || 'par',
              actorMembership: prev.itemType === 'inserto' ? 'actor:drawer' : 'body',
              label: '',
              finishKey: '',
            },
          ]
        : prev.designParts;
      return changed || needsActor
        ? {
            ...prev,
            pieces: pieces.sort(
              (a, b) => ALL_ANCHORS.indexOf(a.anchor) - ALL_ANCHORS.indexOf(b.anchor),
            ),
            designParts,
          }
        : prev;
    });
    // Sólo al montar/cambiar de tipo: los valores materializados no se
    // re-escriben con cada edición del usuario (lo editado manda).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPairLike]);

  // El centro sólo aparece si ya existe (datos legacy; el alta no lo crea).
  const anchors: readonly ('left' | 'right' | 'center')[] = isPairLike
    ? [
        ...BASE_ANCHORS,
        ...((draft.pieces ?? []).some((pc) => pc.anchor === 'center') ? (['center'] as const) : []),
      ]
    : ALL_ANCHORS;

  const pieceOf = (anchor: 'left' | 'right' | 'center'): HardwarePiece | undefined =>
    draft.pieces?.find((pc) => pc.anchor === anchor);

  const setPiece = (anchor: 'left' | 'right' | 'center', piece: HardwarePiece | undefined) => {
    setDraft((prev) => {
      const rest = (prev.pieces ?? []).filter((pc) => pc.anchor !== anchor);
      const next =
        piece && (piece.asset || piece.offsetMm)
          ? [...rest, piece].sort(
              (a, b) => ALL_ANCHORS.indexOf(a.anchor) - ALL_ANCHORS.indexOf(b.anchor),
            )
          : rest;
      return { ...prev, pieces: next.length > 0 ? next : undefined };
    });
  };

  const setOffset = (anchor: 'left' | 'right' | 'center', axis: 'x' | 'y' | 'z', raw: string) => {
    const value = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(value)) return;
    const prevPiece = pieceOf(anchor);
    const prevOff: HardwarePieceOffset = prevPiece?.offsetMm ?? { x: 0, y: 0, z: 0 };
    setPiece(anchor, {
      ...(prevPiece ?? { anchor }),
      offsetMm: { ...prevOff, [axis]: value },
    });
  };

  /** #1596 decisión 3: copiar offsets al otro lado SÓLO al pulsarlo. */
  const copyToOtherSide = (anchor: 'left' | 'right' | 'center') => {
    const other = anchor === 'left' ? 'right' : anchor === 'right' ? 'left' : null;
    if (!other) return;
    const source = pieceOf(anchor);
    const offset = source?.offsetMm ?? { x: 0, y: 0, z: 0 };
    setPiece(other, { ...(pieceOf(other) ?? { anchor: other }), offsetMm: { ...offset } });
  };

  const actorValue =
    draft.designParts?.find((dp) => dp.componentName.trim() !== '')?.actorMembership ?? 'body';

  const setActor = (membership: string) => {
    setDraft((prev) => {
      const rows = prev.designParts ?? [];
      const designParts =
        rows.length > 0
          ? rows.map((dp, i) => (i === 0 ? { ...dp, actorMembership: membership } : dp))
          : [
              {
                componentName: prev.code.trim() || 'par',
                actorMembership: membership,
                label: '',
                finishKey: '',
              },
            ];
      return { ...prev, designParts };
    });
  };

  return (
    <fieldset className="catalog-form__section" data-testid="hardware-form-pieces">
      <legend className="catalog-form__section-title">
        Diseño — un SKP por lado{hasPieces ? ` · ${draft.pieces!.length}` : ''}
      </legend>
      <p className="catalog-form__hint">
        Cada lado con su modelo y su posición, medidos desde su borde. Dibujá en 0,0,0 y
        posicioná con los offsets: lo que ves es lo que se guarda.
      </p>
      {isPairLike ? (
        <label className="catalog-form__field" data-testid="hardware-pieces-actor">
          <span className="catalog-form__label">Al abrir</span>
          <select
            value={actorValue}
            onChange={(e) => setActor(e.target.value)}
            data-testid="hardware-pieces-actor-select"
          >
            {PIECE_ACTOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
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
      )}
      {isPairLike || sectionOpen ? (
        <div className="catalog-hw-part" data-testid="hardware-pieces-rows">
          {anchors.map((anchor) => {
            const piece = pieceOf(anchor);
            const meta = ANCHOR_LABELS[anchor];
            const hasAsset = Boolean(piece?.asset?.assetId);
            const canCopy = anchor === 'left' || anchor === 'right';
            return (
              <div className="catalog-hw-part__row" key={anchor} data-testid={`hardware-piece-${anchor}`}>
                <div className="catalog-hw-part__identity">
                  <strong className="catalog-hw-part__title">
                    {meta.label}
                    {!hasAsset ? (
                      <span className="catalog-badge catalog-badge--part" style={{ marginLeft: 8 }}>
                        diseño pendiente
                      </span>
                    ) : null}
                  </strong>
                  <span className="catalog-hw-part__meta">
                    {assetLabel(piece)} · {meta.hint}
                  </span>
                  {/* #1596: en par/inserto los offsets SIEMPRE están (el
                      par nace con ambos lados); en edición genérica sólo
                      cuando la pieza existe (comportamiento #1518 intacto). */}
                  {isPairLike || piece ? (
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
                            value={piece?.offsetMm?.[axis] ?? 0}
                            onChange={(e) => setOffset(anchor, axis, e.target.value)}
                            data-testid={`hardware-piece-${anchor}-offset-${axis}`}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
                {canMutate && assetService ? (
                  <div className="catalog-hw-part__actions" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setUploadingAnchor(anchor)}
                        data-testid={`hardware-piece-${anchor}-upload`}
                      >
                        {hasAsset ? 'Cambiar diseño' : 'Subir diseño'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setPickingAnchor(anchor)}
                        data-testid={`hardware-piece-${anchor}-bind`}
                      >
                        Elegir existente
                      </button>
                    </div>
                    {hasAsset ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() =>
                          setPiece(anchor, {
                            anchor,
                            offsetMm: piece?.offsetMm ?? { x: 0, y: 0, z: 0 },
                          })
                        }
                        data-testid={`hardware-piece-${anchor}-clear`}
                      >
                        Quitar diseño
                      </button>
                    ) : null}
                    {canCopy ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => copyToOtherSide(anchor)}
                        title="Copia los offsets X/Y/Z de este lado al otro — sólo al pulsarlo"
                        data-testid={`hardware-piece-${anchor}-copy`}
                      >
                        <Copy size={12} strokeWidth={1.5} aria-hidden />
                        Copiar al otro lado
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
        onSelect={(binding: HardwareVisualAssetBinding) => {
          if (pickingAnchor) {
            const prev = pieceOf(pickingAnchor);
            setPiece(pickingAnchor, {
              anchor: pickingAnchor,
              asset: binding,
              offsetMm: prev?.offsetMm ?? { x: 0, y: 0, z: 0 },
            });
          }
          setPickingAnchor(null);
        }}
      />

      <HardwareAssetUploadModal
        open={uploadingAnchor !== null}
        onClose={() => setUploadingAnchor(null)}
        assetService={assetService}
        onSuccess={(binding) => {
          if (uploadingAnchor) {
            const prev = pieceOf(uploadingAnchor);
            setPiece(uploadingAnchor, {
              anchor: uploadingAnchor,
              asset: binding,
              offsetMm: prev?.offsetMm ?? { x: 0, y: 0, z: 0 },
            });
          }
          setUploadingAnchor(null);
        }}
      />
    </fieldset>
  );
}
