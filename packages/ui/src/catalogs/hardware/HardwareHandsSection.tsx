/**
 * Manos (par D/I) de un herraje multi-diseño (#1512 M3 S2): binding de un
 * asset por lado con el MISMO selector de recursos del visualAsset global
 * (HardwareAssetSelectorModal). Una mano sin asset propio cae al visualAsset
 * global en el resolve — la UI lo dice para que nunca sea una sorpresa.
 */

import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { HardwareHand, HardwareHands } from '@granete/domain';
import { Layers } from 'lucide-react';
import type { HardwareAssetService } from '@granete/storage';
import type { HardwareDraft } from './hardwareDraft';
import { HardwareAssetSelectorModal } from './HardwareAssetSelectorModal';

const HAND_LABELS: Record<'left' | 'right', string> = {
  left: 'Izquierda',
  right: 'Derecha',
};

function assetLabel(hand?: HardwareHand): string {
  const asset = hand?.asset;
  if (!asset || !asset.assetId) return 'Sin asset propio (usa el global)';
  return asset.assetRevisionId
    ? `Revisión ${asset.assetRevisionId.slice(0, 8)}…`
    : 'Asset vinculado';
}

export function HardwareHandsSection({
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
  const [sectionOpen, setSectionOpen] = useState(Boolean(draft.hands));
  const [pickingHand, setPickingHand] = useState<'left' | 'right' | null>(null);

  const setHand = (side: 'left' | 'right', hand: HardwareHand | undefined) => {
    setDraft((prev) => {
      const base = prev.hands ?? {};
      const nextHands: HardwareHands =
        side === 'left' ? { ...base, left: hand } : { ...base, right: hand };
      const cleaned: HardwareHands = {
        ...(nextHands.left?.asset ? { left: nextHands.left } : {}),
        ...(nextHands.right?.asset ? { right: nextHands.right } : {}),
      };
      return {
        ...prev,
        hands: cleaned.left || cleaned.right ? cleaned : undefined,
      };
    });
  };

  return (
    <fieldset className="catalog-form__section" data-testid="hardware-form-hands">
      <legend className="catalog-form__section-title">Manos (par D/I)</legend>
      <p className="catalog-form__hint">
        Un herraje con manos dibuja su SKP por lado: un solo registro en vez de
        filas duplicadas izquierda/derecha. La mano sin asset propio usa el
        asset global de la vista 3D.
      </p>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => setSectionOpen((v) => !v)}
        aria-expanded={sectionOpen}
        data-testid="hardware-hands-toggle"
      >
        <Layers size={14} strokeWidth={1.5} aria-hidden />
        {sectionOpen ? 'Ocultar manos' : 'Configurar manos'}
      </button>
      {sectionOpen ? (
        <div className="catalog-hw-part" data-testid="hardware-hands-rows">
          {(['left', 'right'] as const).map((side) => {
            const hand = draft.hands?.[side];
            return (
              <div className="catalog-hw-part__row" key={side} data-testid={`hardware-hand-${side}`}>
                <div className="catalog-hw-part__identity">
                  <strong className="catalog-hw-part__title">{HAND_LABELS[side]}</strong>
                  <span className="catalog-hw-part__meta">{assetLabel(hand)}</span>
                </div>
                {canMutate && assetService ? (
                  <div className="catalog-hw-part__actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setPickingHand(side)}
                      data-testid={`hardware-hand-${side}-bind`}
                    >
                      {hand?.asset ? 'Cambiar' : 'Vincular asset'}
                    </button>
                    {hand?.asset ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => setHand(side, undefined)}
                        data-testid={`hardware-hand-${side}-clear`}
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
        open={pickingHand !== null}
        onClose={() => setPickingHand(null)}
        assetService={assetService}
        canMutate={canMutate}
        currentBinding={pickingHand ? draft.hands?.[pickingHand]?.asset ?? null : null}
        onSelect={(binding) => {
          if (pickingHand) {
            setHand(pickingHand, { asset: binding });
          }
          setPickingHand(null);
        }}
      />
    </fieldset>
  );
}
