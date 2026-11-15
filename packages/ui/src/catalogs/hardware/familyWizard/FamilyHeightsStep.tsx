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
      <p className="catalog-form__hint">
        Cada fila es una altura del modelo de cajón. La <strong>altura interior mínima</strong> es el
        hueco libre que necesita la bahía: con ella el mueble elige la altura automáticamente.
        Los nombres son libres («M», «C», «Alta 186»…).
      </p>
      <div className="family-heights__actions">
        <button
          type="button"
          className="btn btn--small"
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
        <div className="family-heights__confirm" role="alertdialog" aria-label="Reemplazar alturas" data-testid="family-heights-template-confirm">
          <span>
            La plantilla reemplaza las {rows.length} altura(s) que escribiste. ¿Seguir?
          </span>
          <button
            type="button"
            className="btn btn--small btn--danger"
            onClick={() => {
              onChange(blumMerivoboxTemplate());
              setConfirmTemplate(false);
            }}
            data-testid="family-heights-template-replace"
          >
            Reemplazar
          </button>
          <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirmTemplate(false)}>
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
