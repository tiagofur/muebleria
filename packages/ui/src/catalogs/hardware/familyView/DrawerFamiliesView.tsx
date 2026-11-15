/**
 * Vista «Familias de cajón» (#1633 s2c-2, UX Brief): cada familia es una
 * card con su estado (completa / qué le falta); el detalle inline muestra la
 * matriz Alturas × Insertos con el estado de cada celda (precio, diseño,
 * por defecto). Lectura: editar abre la ficha del juego; «Añadir altura»
 * reusa el flujo transaccional existente.
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Box, Check, CircleAlert, Star } from 'lucide-react';
import type { DrawerFamilySummary } from '@granete/domain';
import { EmptyState } from '../../../common';
import './drawerFamiliesView.css';

const money = (n: number): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

/** Qué le falta a la familia, en palabras de taller (vacío = completa). */
export function familyMissingText(f: DrawerFamilySummary): string {
  const parts: string[] = [];
  if (f.heights.length === 0) parts.push('sin alturas');
  if (f.missing.kits > 0) parts.push(`${f.missing.kits} juego(s) inexistente(s)`);
  if (f.missing.designs > 0) parts.push(`${f.missing.designs} diseño(s)`);
  if (f.missing.prices > 0) parts.push(`${f.missing.prices} precio(s)`);
  return parts.join(', ');
}

function StatusChip({ family }: { readonly family: DrawerFamilySummary }): ReactNode {
  const missing = familyMissingText(family);
  return missing ? (
    <span className="drawer-family__status drawer-family__status--missing" data-testid={`drawer-family-status-${family.code}`}>
      <CircleAlert size={14} aria-hidden /> Le falta: {missing}
    </span>
  ) : (
    <span className="drawer-family__status drawer-family__status--complete" data-testid={`drawer-family-status-${family.code}`}>
      <Check size={14} aria-hidden /> Completa
    </span>
  );
}

function FamilyDetail({
  family,
  onBack,
  onOpenHardware,
  onAddHeight,
}: {
  readonly family: DrawerFamilySummary;
  readonly onBack: () => void;
  readonly onOpenHardware: (hardwareId: string) => void;
  readonly onAddHeight?: () => void;
}): ReactNode {
  return (
    <section className="drawer-family__detail" aria-labelledby="drawer-family-detail-title" data-testid="drawer-family-detail">
      <div className="drawer-family__detail-header">
        <button type="button" className="btn btn--ghost btn--small" onClick={onBack} data-testid="drawer-family-back">
          <ArrowLeft size={14} aria-hidden /> Familias
        </button>
        <div className="drawer-family__detail-title-row">
          <div>
            <h3 id="drawer-family-detail-title" className="drawer-family__title">{family.name}</h3>
            <p className="drawer-family__meta">
              {[family.brand, family.line, family.code].filter(Boolean).join(' · ')}
            </p>
          </div>
          {onAddHeight ? (
            <button type="button" className="btn" onClick={onAddHeight} data-testid="drawer-family-add-height">
              Añadir altura
            </button>
          ) : null}
        </div>
        <StatusChip family={family} />
      </div>

      <div className="drawer-family__matrix-wrap">
        <table className="drawer-family__matrix" data-testid="drawer-family-matrix">
          <caption className="visually-hidden">Alturas e insertos de {family.name}</caption>
          <thead>
            <tr>
              <th scope="col">Altura</th>
              <th scope="col">Juego</th>
              {family.inserts.map((ins) => (
                <th scope="col" key={ins.key}>{ins.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {family.heights.map((h, i) => (
              <tr key={`${h.label}-${i}`} data-testid={`drawer-family-row-${h.label}`}>
                <th scope="row">
                  <span className="drawer-family__height-label">{h.label}</span>
                  <span className="drawer-family__height-mm">{h.khMinMm} mm</span>
                </th>
                <td>
                  {h.kit ? (
                    <div className="drawer-family__cell">
                      <button
                        type="button"
                        className="drawer-family__link"
                        onClick={() => onOpenHardware(h.kit!.id)}
                        aria-label={`Abrir el juego ${h.kit.code}`}
                      >
                        {h.kit.code}
                      </button>
                      <span className={h.kit.costPerUnit > 0 ? '' : 'drawer-family__warn'}>
                        {h.kit.costPerUnit > 0 ? money(h.kit.costPerUnit) : 'Falta precio'}
                      </span>
                      {h.kit.designsMissing > 0 ? (
                        <span className="drawer-family__warn">Faltan {h.kit.designsMissing} diseño(s)</span>
                      ) : (
                        <span className="drawer-family__ok"><Check size={12} aria-hidden /> Diseños</span>
                      )}
                    </div>
                  ) : (
                    <span className="drawer-family__warn">Juego inexistente</span>
                  )}
                </td>
                {family.inserts.map((ins) => {
                  const cell = family.cells[i]?.[ins.key];
                  if (!cell) {
                    return (
                      <td key={ins.key} className="drawer-family__na">
                        <span aria-hidden>—</span>
                        <span className="visually-hidden">No aplica</span>
                      </td>
                    );
                  }
                  return (
                    <td key={ins.key}>
                      <div className="drawer-family__cell" data-testid={`drawer-family-cell-${h.label}-${ins.key}`}>
                        <button
                          type="button"
                          className="drawer-family__link"
                          onClick={() => onOpenHardware(cell.hardwareId)}
                          aria-label={`Abrir el inserto ${cell.code}`}
                        >
                          {cell.active ? 'Disponible' : 'Inactivo'}
                        </button>
                        {cell.isDefault ? (
                          <span className="drawer-family__default"><Star size={12} aria-hidden /> Por defecto</span>
                        ) : null}
                        {cell.active ? (
                          <>
                            <span className={cell.costPerUnit > 0 ? '' : 'drawer-family__warn'}>
                              {cell.costPerUnit > 0 ? money(cell.costPerUnit) : 'Falta precio'}
                            </span>
                            {cell.designMissing ? <span className="drawer-family__warn">Falta diseño</span> : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {family.inserts.length === 0 ? (
        <p className="catalog-form__hint" data-testid="drawer-family-no-inserts">
          Esta familia no tiene insertos. Se añaden desde «Añadir altura» o desde la ficha de cada juego.
        </p>
      ) : null}
    </section>
  );
}

export function DrawerFamiliesView({
  families,
  onOpenHardware,
  onAddHeight,
  onCreateFamily,
}: {
  readonly families: readonly DrawerFamilySummary[];
  readonly onOpenHardware: (hardwareId: string) => void;
  /** Ausente sin permiso de edición: la acción se oculta. */
  readonly onAddHeight?: (agregadoId: string) => void;
  readonly onCreateFamily?: () => void;
}): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = families.find((f) => f.agregadoId === selectedId) ?? null;

  if (selected) {
    return (
      <FamilyDetail
        family={selected}
        onBack={() => setSelectedId(null)}
        onOpenHardware={onOpenHardware}
        onAddHeight={onAddHeight ? () => onAddHeight(selected.agregadoId) : undefined}
      />
    );
  }

  if (families.length === 0) {
    return (
      <EmptyState
        icon={Box}
        title="Todavía no hay familias de cajón"
        description="Una familia reúne las alturas de un modelo de cajón (Blum Merivobox, Legrabox, Hettich…) con sus insertos y precios. El asistente trae la plantilla Blum para empezar."
        actionLabel={onCreateFamily ? 'Nueva familia de cajón' : undefined}
        onAction={onCreateFamily}
        actionTestId="drawer-families-create"
      />
    );
  }

  return (
    <ul className="drawer-family__list" data-testid="drawer-families-list">
      {families.map((f) => (
        <li key={f.agregadoId} className="entity-card card-open-host drawer-family__card" data-testid={`drawer-family-card-${f.code}`}>
          <h3 className="drawer-family__title">
            <button
              type="button"
              className="card-open drawer-family__open"
              onClick={() => setSelectedId(f.agregadoId)}
              aria-label={`Ver la familia ${f.name}`}
            >
              {f.name}
            </button>
          </h3>
          <p className="drawer-family__meta">{[f.brand, f.line, f.code].filter(Boolean).join(' · ')}</p>
          <p className="drawer-family__counts">
            {f.heights.length} altura(s): {f.heights.map((h) => h.label).join(' / ') || '—'} · {f.inserts.length} inserto(s)
          </p>
          <StatusChip family={f} />
        </li>
      ))}
    </ul>
  );
}
