/**
 * Modal to pick a catalog component instance for a module draft.
 */

import type { ReactNode } from 'react';
import type { Component } from '@muebles/domain';
import { Modal } from '../../common';

export type ModuleComponentAdderModalProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly componentSearch: string;
  readonly onSearchChange: (value: string) => void;
  readonly filteredComponents: readonly Component[];
  readonly newCompId: string;
  readonly onSelect: (id: string) => void;
  readonly newCompQty: number;
  readonly onQtyChange: (qty: number) => void;
  readonly onConfirm: () => void;
};

export function ModuleComponentAdderModal({
  open,
  onClose,
  componentSearch,
  onSearchChange,
  filteredComponents,
  newCompId,
  onSelect,
  newCompQty,
  onQtyChange,
  onConfirm,
}: ModuleComponentAdderModalProps): ReactNode {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar componente"
      size="sm"
      data-testid="component-adder-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!newCompId}
            onClick={onConfirm}
            data-testid="confirm-add-component"
          >
            Agregar
          </button>
        </>
      }
    >
      <div className="catalog-form">
        <div className="catalog-form__field">
          <label htmlFor="comp-adder-search">Buscar componente</label>
          <input
            id="comp-adder-search"
            value={componentSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por código o nombre…"
            autoFocus
            data-testid="comp-adder-search"
          />
        </div>

        {filteredComponents.length === 0 ? (
          <p className="catalog-empty" style={{ fontStyle: 'italic' }}>
            {componentSearch
              ? 'Sin resultados'
              : 'No hay componentes activos en el catálogo.'}
          </p>
        ) : (
          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '0.75rem',
            }}
            data-testid="comp-adder-list"
          >
            {filteredComponents.map((comp) => (
              <label
                key={comp.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  background:
                    newCompId === comp.id
                      ? 'color-mix(in srgb, var(--primary) 10%, transparent)'
                      : undefined,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <input
                  type="radio"
                  name="comp-adder-radio"
                  checked={newCompId === comp.id}
                  onChange={() => onSelect(comp.id)}
                  data-testid={`comp-radio-${comp.code}`}
                />
                <div>
                  <span
                    className="font-mono"
                    style={{ fontSize: 'var(--text-xs)' }}
                  >
                    {comp.code}
                  </span>
                  <span
                    style={{
                      fontSize: 'var(--text-sm)',
                      marginLeft: '0.5rem',
                    }}
                  >
                    {comp.name}
                  </span>
                  <span
                    className="text-muted"
                    style={{
                      fontSize: 'var(--text-xs)',
                      marginLeft: '0.5rem',
                    }}
                  >
                    {comp.optionRoles.join(', ')}
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}

        {newCompId ? (
          <div className="catalog-form__field">
            <label htmlFor="comp-adder-qty">Cantidad</label>
            <input
              id="comp-adder-qty"
              type="number"
              min={1}
              step={1}
              value={newCompQty}
              onChange={(e) =>
                onQtyChange(Math.max(1, Number(e.target.value)))
              }
              data-testid="comp-adder-qty"
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
