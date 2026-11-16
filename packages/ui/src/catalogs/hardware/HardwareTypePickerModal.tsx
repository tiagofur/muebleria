/**
 * #1641: el alta empieza por el tipo de ítem — TRES tipos. El inserto dejó
 * de ser un alta global (decisión owner 2026-11-16): nace dentro de su juego
 * (ficha → «Insertos del juego» → «Añadir inserto», asistente de familia
 * paso «Insertos», o «Añadir altura») porque su vínculo vive en el grupo del
 * juego y no en el herraje. El tipo «Juego» ofrece sus dos variantes
 * internas (sistema por alturas / juego simple) como sub-paso revelado.
 */

import { useRef, useState, type ReactNode } from 'react';
import { Box, Check, FlipHorizontal2, Package } from 'lucide-react';
import { Modal } from '../../common';

export type HardwareCreateType = 'piece' | 'pair' | 'kit' | 'inserto';

export interface HardwareTypePickerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onStart: (
    type: HardwareCreateType,
    opts?: {
      /** Variante interna del tipo Juego (no es un cuarto tipo). */
      readonly variant?: 'system' | 'simple';
    },
  ) => void;
}

const TYPES: readonly {
  readonly type: HardwareCreateType;
  readonly title: string;
  readonly help: string;
  readonly icon: ReactNode;
}[] = [
  {
    type: 'piece',
    title: 'Pieza',
    help: 'Una bisagra, una corredera, un tirador.',
    icon: <Box size={18} strokeWidth={1.5} aria-hidden />,
  },
  {
    type: 'pair',
    title: 'Par izquierda/derecha',
    help: 'Dos piezas espejadas: galería, BOXCOVER, BOXCAP. Precio del par, un SKP por lado.',
    icon: <FlipHorizontal2 size={18} strokeWidth={1.5} aria-hidden />,
  },
  {
    type: 'kit',
    title: 'Juego',
    help: 'Varios herrajes que se venden y montan juntos.',
    icon: <Package size={18} strokeWidth={1.5} aria-hidden />,
  },
];

export function HardwareTypePickerModal({
  open,
  onClose,
  onStart,
}: HardwareTypePickerModalProps): ReactNode {
  const [kitExpanded, setKitExpanded] = useState(false);
  // Navegación por flechas entre tarjetas (roving tabindex); las sub-opciones
  // del juego entran al orden natural de tabulación cuando se revelan.
  const cardRefs = useRef<readonly HTMLButtonElement[]>([]);

  const pick = (type: HardwareCreateType) => {
    if (type === 'kit' && !kitExpanded) {
      setKitExpanded(true);
      return;
    }
    onStart(type);
  };

  const close = () => {
    setKitExpanded(false);
    onClose();
  };

  const onCardKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    const target = cardRefs.current[(next + TYPES.length) % TYPES.length];
    target?.focus();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="¿Qué querés dar de alta?"
      size="sm"
      dataTestId="hardware-type-picker"
    >
      <div className="catalog-type-picker" role="group" aria-label="Tipo de ítem">
        {TYPES.map((t, i) => (
          <div key={t.type}>
            <button
              type="button"
              ref={(el) => {
                if (el) cardRefs.current[i] = el;
              }}
              className={
                t.type === 'kit' && kitExpanded
                  ? 'catalog-type-card catalog-type-card--active'
                  : 'catalog-type-card'
              }
              onClick={() => pick(t.type)}
              onKeyDown={(e) => onCardKeyDown(e, i)}
              aria-expanded={t.type === 'kit' ? kitExpanded : undefined}
              data-testid={`hardware-type-pick-${t.type}`}
            >
              <span className="catalog-type-card__icon" aria-hidden>
                {t.icon}
              </span>
              <span className="catalog-type-card__body">
                <span className="catalog-type-card__title">{t.title}</span>
                <span className="catalog-type-card__help">{t.help}</span>
              </span>
              {t.type === 'kit' && kitExpanded ? (
                <span className="catalog-type-card__check" aria-hidden>
                  <Check size={16} strokeWidth={2} />
                </span>
              ) : null}
            </button>
            {t.type === 'kit' && kitExpanded ? (
              <div className="catalog-type-sub">
                <button
                  type="button"
                  className="catalog-type-sub__option"
                  onClick={() => onStart('kit', { variant: 'system' })}
                  data-testid="hardware-type-pick-kit-system"
                >
                  <span className="catalog-type-sub__title">Sistema de cajones por alturas</span>
                  <span className="catalog-type-sub__help">
                    Una familia con alturas libres (N/M/K/E…) e insertos por altura.
                  </span>
                </button>
                <button
                  type="button"
                  className="catalog-type-sub__option"
                  onClick={() => onStart('kit', { variant: 'simple' })}
                  data-testid="hardware-type-pick-kit-simple"
                >
                  <span className="catalog-type-sub__title">Juego simple</span>
                  <span className="catalog-type-sub__help">
                    Un solo herraje en cantidad (p. ej. las bisagras del mueble).
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="catalog-type-picker__foot">
        Los insertos no se dan de alta solos: se añaden dentro de su juego (ficha del
        juego → «Insertos del juego») o al crear una familia / altura.
      </p>
    </Modal>
  );
}
