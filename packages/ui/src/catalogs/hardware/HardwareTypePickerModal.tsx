/**
 * #1596 alcance 1: el alta empieza por el tipo de ítem — un único «Nuevo»
 * pregunta qué se da de alta y cada tipo abre sólo lo que necesita
 * (decisión 1: cuatro tipos; lo especial se crea según necesidad). El tipo
 * «Juego» ofrece sus dos variantes internas (sistema por alturas / juego
 * simple); «Inserto» pide el juego al que queda añadido (alcance 3).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { isHardwareKitPart, type Hardware } from '@granete/domain';
import { Box, Layers, Package, Puzzle } from 'lucide-react';
import { Modal } from '../../common';

export type HardwareCreateType = 'piece' | 'pair' | 'kit' | 'inserto';

export interface HardwareTypePickerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Catálogo para la lista de juegos (destino del inserto). */
  readonly hardware: readonly Hardware[];
  readonly onStart: (
    type: HardwareCreateType,
    opts?: {
      readonly insertoKitId?: string;
      /** Variante interna del tipo Juego (no es un quinto tipo). */
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
    help: 'Dos piezas que vienen espejadas: galería, BOXCOVER, BOXCAP. Precio del par, un SKP por lado.',
    icon: <Layers size={18} strokeWidth={1.5} aria-hidden />,
  },
  {
    type: 'kit',
    title: 'Juego',
    help: 'Un sistema de cajones por alturas (N/M/K/E) o un juego simple (bisagras del mueble).',
    icon: <Package size={18} strokeWidth={1.5} aria-hidden />,
  },
  {
    type: 'inserto',
    title: 'Inserto para un juego',
    help: 'Accesorio de un juego existente (p. ej. lateral superior del cajón E); queda en su selector.',
    icon: <Puzzle size={18} strokeWidth={1.5} aria-hidden />,
  },
];

export function HardwareTypePickerModal({
  open,
  onClose,
  hardware,
  onStart,
}: HardwareTypePickerModalProps): ReactNode {
  const [kitExpanded, setKitExpanded] = useState(false);
  const [insertoKitId, setInsertoKitId] = useState('');

  // Juegos disponibles como destino del inserto: kits activos que no son
  // partes de otro juego (#1436).
  const kitOptions = useMemo(
    () =>
      hardware.filter(
        (h) => h.active && h.unit === 'set' && !isHardwareKitPart(h),
      ),
    [hardware],
  );

  const pick = (type: HardwareCreateType) => {
    if (type === 'kit' && !kitExpanded) {
      setKitExpanded(true);
      return;
    }
    onStart(type, type === 'inserto' ? { insertoKitId: insertoKitId || undefined } : undefined);
  };

  const close = () => {
    setKitExpanded(false);
    setInsertoKitId('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="¿Qué querés dar de alta?"
      size="sm"
      dataTestId="hardware-type-picker"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TYPES.map((t) => (
          <div key={t.type}>
            <button
              type="button"
              className="btn"
              style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => pick(t.type)}
              aria-expanded={t.type === 'kit' ? kitExpanded : undefined}
              data-testid={`hardware-type-pick-${t.type}`}
            >
              {t.icon}
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <strong>{t.title}</strong>
                <span style={{ fontWeight: 400, fontSize: '0.85em' }}>{t.help}</span>
              </span>
            </button>
            {t.type === 'kit' && kitExpanded ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, marginLeft: 16 }}>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => onStart('kit', { variant: 'system' })}
                  data-testid="hardware-type-pick-kit-system"
                >
                  Sistema por alturas (N/M/K/E + insertos)
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => onStart('kit', { variant: 'simple' })}
                  data-testid="hardware-type-pick-kit-simple"
                >
                  Juego simple (un solo herraje múltiple)
                </button>
              </div>
            ) : null}
            {t.type === 'inserto' ? (
              <div style={{ marginTop: 4, marginLeft: 16 }}>
                <label className="catalog-form__field">
                  <span className="catalog-form__label">Juego al que queda añadido</span>
                  <select
                    value={insertoKitId}
                    onChange={(e) => setInsertoKitId(e.target.value)}
                    data-testid="hardware-type-inserto-kit"
                  >
                    <option value="">Elegir juego…</option>
                    {kitOptions.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.code} — {k.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={!insertoKitId}
                  onClick={() => pick('inserto')}
                  data-testid="hardware-type-inserto-go"
                >
                  Continuar
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}
