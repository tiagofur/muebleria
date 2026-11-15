/**
 * Insertos de un sistema de cajones (#1596 → #1625): galería, BOXCAP,
 * BOXCOVER… Cada uno nace como un par con su «Al abrir» y desfases
 * explícitos por lado, y entra al selector del juego. Lo usan el asistente
 * «Nuevo sistema de cajones» y el modal «Añadir altura» — una sola forma.
 */

import type { ReactNode } from 'react';
import type { HardwareKitSystemAccessory } from '@granete/domain';

export type InsertoActor = 'body' | 'actor:drawer' | 'actor:door';

export interface InsertoDraft {
  readonly name: string;
  readonly actor: InsertoActor;
  /** #1633: etiquetas de las alturas donde se ofrece (asistente de familia). */
  readonly heights?: readonly string[];
  /** #1633: precio por pieza (texto del input; vacío = 0). */
  readonly price?: string;
  readonly offsets: {
    readonly left: { readonly x: string; readonly y: string; readonly z: string };
    readonly right: { readonly x: string; readonly y: string; readonly z: string };
  };
}

export function emptyInsertoDraft(): InsertoDraft {
  return {
    name: '',
    actor: 'actor:drawer',
    offsets: { left: { x: '', y: '', z: '' }, right: { x: '', y: '', z: '' } },
  };
}

/** Sufijo del código del inserto, derivado de su nombre (A-Z0-9, guiones). */
export function insertoSuffix(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

/**
 * Borradores → accesorios del plan: sólo los que tienen nombre utilizable,
 * con desfases explícitos (vacío = 0) y «Al abrir» declarado — nunca el
 * default invisible del motor ni la inferencia por nombre.
 */
export function insertoDraftsToAccessories(drafts: readonly InsertoDraft[]): HardwareKitSystemAccessory[] {
  return drafts
    .filter((d) => d.name.trim())
    .map((d) => {
      const offsetOf = (side: 'left' | 'right') => ({
        x: Number(d.offsets[side].x) || 0,
        y: Number(d.offsets[side].y) || 0,
        z: Number(d.offsets[side].z) || 0,
      });
      return {
        suffix: insertoSuffix(d.name),
        name: d.name.trim(),
        anchors: ['left', 'right'] as const,
        pieceOffsets: { left: offsetOf('left'), right: offsetOf('right') },
        actorMembership: d.actor,
        ...(d.heights ? { heights: [...d.heights] } : {}),
        ...(d.price !== undefined ? { costPerUnit: d.price.trim() === '' ? 0 : Number(d.price) } : {}),
      };
    })
    .filter((a) => a.suffix !== '');
}

/** Sufijo repetido entre los accesorios (generarían el mismo código), o null. */
export function duplicatedInsertoSuffix(accessories: readonly HardwareKitSystemAccessory[]): string | null {
  const seen = new Set<string>();
  for (const a of accessories) {
    if (seen.has(a.suffix)) return a.suffix;
    seen.add(a.suffix);
  }
  return null;
}

/** #1633: cotas en palabras de taller, nunca X/Y/Z. */
const AXIS_LABEL = { x: 'Ancho', y: 'Fondo', z: 'Alto' } as const;

export function KitSystemInsertosFieldset({
  drafts,
  onChange,
  legend,
  hint,
  testIdPrefix,
  heightOptions,
  newDraft = emptyInsertoDraft,
}: {
  readonly drafts: readonly InsertoDraft[];
  readonly onChange: (next: InsertoDraft[]) => void;
  readonly legend: string;
  readonly hint: string;
  /** Prefijo de data-testid (estable para las pruebas de cada superficie). */
  readonly testIdPrefix: string;
  /**
   * #1633: alturas de la familia. Presente ⇒ cada inserto muestra «Aplica
   * en» (una casilla por altura) y su precio; ausente ⇒ forma de una altura
   * («Añadir altura»).
   */
  readonly heightOptions?: readonly string[];
  readonly newDraft?: () => InsertoDraft;
}): ReactNode {
  const update = (idx: number, patch: (d: InsertoDraft) => InsertoDraft) =>
    onChange(drafts.map((d, i) => (i === idx ? patch(d) : d)));
  return (
    <fieldset className="catalog-form__section">
      <legend className="catalog-form__section-title">{legend}</legend>
      <p className="catalog-form__hint">{hint}</p>
      {drafts.map((acc, idx) => (
        <div
          key={idx}
          style={{ border: '1px solid var(--border-subtle, #ddd)', borderRadius: 6, padding: 8, marginBottom: 8 }}
          data-testid={`${testIdPrefix}-${idx}`}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <input
              value={acc.name}
              onChange={(e) => update(idx, (d) => ({ ...d, name: e.target.value }))}
              placeholder="Ej: Galería Gris Iridium"
              aria-label={`Nombre del inserto ${idx + 1}`}
              data-testid={`${testIdPrefix}-${idx}-name`}
            />
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => onChange(drafts.filter((_, i) => i !== idx))}
              data-testid={`${testIdPrefix}-${idx}-remove`}
            >
              Quitar
            </button>
          </div>
          {heightOptions ? (
            <>
              <fieldset className="family-insert__heights" data-testid={`${testIdPrefix}-${idx}-heights`}>
                <legend className="catalog-form__label">Aplica en</legend>
                {heightOptions.length === 0 ? (
                  <span className="catalog-form__hint">Primero definí las alturas de la familia.</span>
                ) : (
                  heightOptions.map((label) => {
                    const checked = (acc.heights ?? []).some((h) => h.toLowerCase() === label.toLowerCase());
                    return (
                      <label key={label} className="family-insert__chip">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            update(idx, (d) => {
                              const rest = (d.heights ?? []).filter((h) => h.toLowerCase() !== label.toLowerCase());
                              return { ...d, heights: e.target.checked ? [...rest, label] : rest };
                            })
                          }
                          data-testid={`${testIdPrefix}-${idx}-height-${label}`}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })
                )}
              </fieldset>
              <label className="catalog-form__field">
                <span>Precio por pieza</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={acc.price ?? ''}
                  onChange={(e) => update(idx, (d) => ({ ...d, price: e.target.value }))}
                  placeholder="0"
                  data-testid={`${testIdPrefix}-${idx}-price`}
                />
              </label>
            </>
          ) : null}
          <label className="catalog-form__field">
            <span>Al abrir</span>
            <select
              value={acc.actor}
              onChange={(e) => update(idx, (d) => ({ ...d, actor: e.target.value as InsertoActor }))}
              data-testid={`${testIdPrefix}-${idx}-actor`}
            >
              <option value="actor:drawer">Viaja con el cajón al abrir</option>
              <option value="body">Fija al mueble (no se mueve)</option>
              <option value="actor:door">Viaja con la puerta al abrir</option>
            </select>
          </label>
          {(['left', 'right'] as const).map((side) => (
            <div key={side} style={{ marginBottom: 4 }}>
              <span className="catalog-form__label">
                Desfase lado {side === 'left' ? 'izquierdo' : 'derecho'} (mm)
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step="0.5"
                    aria-label={`Desfase ${AXIS_LABEL[axis]} ${side === 'left' ? 'izq' : 'der'} del inserto ${idx + 1}`}
                    placeholder={AXIS_LABEL[axis]}
                    value={acc.offsets[side][axis]}
                    onChange={(e) =>
                      update(idx, (d) => ({
                        ...d,
                        offsets: { ...d.offsets, [side]: { ...d.offsets[side], [axis]: e.target.value } },
                      }))
                    }
                    data-testid={`${testIdPrefix}-${idx}-${side}-${axis}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => onChange([...drafts, newDraft()])}
        data-testid={`${testIdPrefix}-add`}
      >
        Añadir inserto
      </button>
    </fieldset>
  );
}
