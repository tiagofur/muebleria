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

export function KitSystemInsertosFieldset({
  drafts,
  onChange,
  legend,
  hint,
  testIdPrefix,
}: {
  readonly drafts: readonly InsertoDraft[];
  readonly onChange: (next: InsertoDraft[]) => void;
  readonly legend: string;
  readonly hint: string;
  /** Prefijo de data-testid (estable para las pruebas de cada superficie). */
  readonly testIdPrefix: string;
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
                Offsets {side === 'left' ? 'izquierda' : 'derecha'} (mm)
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step="0.5"
                    aria-label={`Offset ${axis.toUpperCase()} ${side === 'left' ? 'izq' : 'der'} del inserto ${idx + 1}`}
                    placeholder={axis.toUpperCase()}
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
        onClick={() => onChange([...drafts, emptyInsertoDraft()])}
        data-testid={`${testIdPrefix}-add`}
      >
        Añadir inserto
      </button>
    </fieldset>
  );
}
