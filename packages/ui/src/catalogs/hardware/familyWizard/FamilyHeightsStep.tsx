/**
 * Paso «Alturas» del asistente de familia de cajón (#1633 s2b): tabla
 * editable — etiqueta libre, altura interior mínima y precio del juego por
 * fila — con la plantilla Blum MERIVOBOX como punto de partida editable.
 */

import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { blumMerivoboxTemplate, newHeightRow, type FamilyHeightRow } from './familyWizardModel';

export function FamilyHeightsStep({
  rows,
  onChange,
}: {
  readonly rows: readonly FamilyHeightRow[];
  readonly onChange: (next: FamilyHeightRow[]) => void;
}): ReactNode {
  const tableRef = useRef<HTMLTableElement | null>(null);
  // Review #1636: la plantilla no pisa filas escritas sin confirmar.
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const templateBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeConfirm = (): void => {
    setConfirmTemplate(false);
    requestAnimationFrame(() => templateBtnRef.current?.focus());
  };
  const update = (idx: number, patch: Partial<FamilyHeightRow>) =>
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  // Tras reordenar, el foco vuelve al mismo control de la fila movida.
  const move = (idx: number, delta: -1 | 1, testId: string) => {
    const target = idx + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange(next);
    requestAnimationFrame(() => {
      tableRef.current?.querySelector<HTMLElement>(`[data-testid="${testId.replace(`-${idx}-`, `-${target}-`)}"]`)?.focus();
    });
  };
  const firstPrice = rows[0]?.price ?? '';

  return (
    <div className="family-heights">
      <figure className="family-heights__figure" aria-labelledby="family-heights-figure-caption">
        <svg viewBox="0 0 220 120" role="img" aria-hidden="true" className="family-heights__svg">
          {/* Hueco de la bahía (frente del mueble) */}
          <rect x="20" y="10" width="140" height="100" className="family-heights__svg-bay" />
          {/* Cajón: costado y trasera */}
          <rect x="34" y="62" width="112" height="44" className="family-heights__svg-drawer" />
          <rect x="34" y="70" width="112" height="36" className="family-heights__svg-back" />
          {/* Cota: altura interior mínima = hueco libre de la bahía */}
          <line x1="178" y1="10" x2="178" y2="110" className="family-heights__svg-dim" />
          <line x1="172" y1="10" x2="184" y2="10" className="family-heights__svg-dim" />
          <line x1="172" y1="110" x2="184" y2="110" className="family-heights__svg-dim" />
          <text x="190" y="64" className="family-heights__svg-text">KH</text>
          {/* Cota: altura de trasera */}
          <line x1="10" y1="70" x2="10" y2="106" className="family-heights__svg-dim" />
          <text x="0" y="66" className="family-heights__svg-text">T</text>
        </svg>
        <figcaption id="family-heights-figure-caption" className="catalog-form__hint">
          <strong>KH — altura interior mínima:</strong> el hueco libre que necesita la bahía (de
          tablero a tablero). <strong>T — altura de trasera</strong> (opcional, informativa).
        </figcaption>
      </figure>
      <p className="catalog-form__hint">
        Cada fila es una altura del modelo de cajón. La <strong>altura interior mínima</strong> es el
        hueco libre que necesita la bahía: con ella el mueble elige la altura automáticamente.
        Los nombres son libres («M», «C», «Alta 186»…).
      </p>
      <div className="family-heights__actions">
        <button
          type="button"
          className="btn btn--small"
          ref={templateBtnRef}
          onClick={() => (rows.length > 0 ? setConfirmTemplate(true) : onChange(blumMerivoboxTemplate()))}
          data-testid="family-heights-template"
        >
          Precargar plantilla Blum Merivobox (N · M · K · E)
        </button>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => onChange([...rows, newHeightRow()])}
          data-testid="family-heights-add"
        >
          Añadir altura
        </button>
      </div>
      {confirmTemplate ? (
        <div className="family-heights__confirm" role="alert" data-testid="family-heights-template-confirm">
          <span>
            La plantilla reemplaza las {rows.length} altura(s) que escribiste. ¿Seguir?
          </span>
          <button
            type="button"
            className="btn btn--small btn--danger"
            // El foco entra a la decisión y vuelve al botón de la plantilla.
            autoFocus
            onClick={() => {
              onChange(blumMerivoboxTemplate());
              closeConfirm();
            }}
            data-testid="family-heights-template-replace"
          >
            Reemplazar
          </button>
          <button type="button" className="btn btn--small btn--ghost" onClick={closeConfirm}>
            Conservar mis alturas
          </button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="family-heights__empty" data-testid="family-heights-empty">
          Todavía no hay alturas. Precargá la plantilla Blum y editala, o añadí la primera altura.
        </p>
      ) : (
        <table className="family-heights__table" ref={tableRef}>
          <thead>
            <tr>
              <th scope="col">Etiqueta</th>
              <th scope="col">Altura interior mínima (mm)</th>
              <th scope="col">Precio del juego</th>
              <th scope="col">Trasera (mm, opcional)</th>
              <th scope="col">
                <span className="visually-hidden">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const name = row.label.trim() || `${idx + 1}`;
              return (
                <tr key={row.key} data-testid={`family-height-${idx}`}>
                  <td data-label="Etiqueta">
                    <input
                      value={row.label}
                      onChange={(e) => update(idx, { label: e.target.value })}
                      maxLength={40}
                      aria-label={`Etiqueta de la altura ${idx + 1}`}
                      data-testid={`family-height-${idx}-label`}
                    />
                  </td>
                  <td data-label="Altura interior mínima (mm)">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={row.khMinMm}
                      onChange={(e) => update(idx, { khMinMm: e.target.value })}
                      aria-label={`Altura interior mínima de la altura ${name}`}
                      data-testid={`family-height-${idx}-kh`}
                    />
                  </td>
                  <td data-label="Precio del juego">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.price}
                      onChange={(e) => update(idx, { price: e.target.value })}
                      aria-label={`Precio del juego de la altura ${name}`}
                      data-testid={`family-height-${idx}-price`}
                    />
                  </td>
                  <td data-label="Trasera (mm, opcional)">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={row.backHeightMm ?? ''}
                      onChange={(e) => update(idx, { backHeightMm: e.target.value })}
                      aria-label={`Altura de trasera de la altura ${name}`}
                      data-testid={`family-height-${idx}-back`}
                    />
                  </td>
                  <td className="family-heights__row-actions">
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--icon"
                      onClick={() => move(idx, -1, `family-height-${idx}-up`)}
                      disabled={idx === 0}
                      aria-label={`Subir la altura ${name}`}
                      data-testid={`family-height-${idx}-up`}
                    >
                      <ArrowUp size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--icon"
                      onClick={() => move(idx, 1, `family-height-${idx}-down`)}
                      disabled={idx === rows.length - 1}
                      aria-label={`Bajar la altura ${name}`}
                      data-testid={`family-height-${idx}-down`}
                    >
                      <ArrowDown size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--ghost btn--icon"
                      onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                      aria-label={`Quitar la altura ${name}`}
                      data-testid={`family-height-${idx}-remove`}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > 1 ? (
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => onChange(rows.map((r) => ({ ...r, price: firstPrice })))}
          disabled={firstPrice.trim() === ''}
          data-testid="family-heights-apply-price"
        >
          Aplicar el precio de la primera altura a todas
        </button>
      ) : null}
    </div>
  );
}
