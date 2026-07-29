/**
 * Temporary A/B option comparison for a quote (#137).
 * Scenario B is not persisted until "Aplicar B".
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  Catalog,
  OptionGroup,
  Project,
} from '@muebles/domain';
import {
  compareRoleScenario,
  type ScenarioCompareResult,
} from '@muebles/domain';
import { formatMoneyDisplay } from '../../common';
import { optionsForGroup } from '../projectHelpers';

export type QuoteScenarioCompareProps = {
  readonly project: Project;
  readonly catalog: Pick<
    Catalog,
    'materials' | 'edges' | 'hardware' | 'optionGroups' | 'modules'
  >;
  readonly optionGroups: readonly OptionGroup[];
  readonly canApply: boolean;
  readonly canDuplicate?: boolean;
  readonly currency: string;
  readonly onApplyB: (role: string, choiceId: string) => void;
  readonly onDuplicateWithB?: (role: string, choiceId: string) => void;
  readonly onExportScenarioPdf?: (role: string, choiceId: string) => void;
};

export function QuoteScenarioCompare({
  project,
  catalog,
  optionGroups,
  canApply,
  canDuplicate = false,
  currency,
  onApplyB,
  onDuplicateWithB,
  onExportScenarioPdf,
}: QuoteScenarioCompareProps): ReactNode {
  const allGroups = useMemo(
    () =>
      optionGroups.filter(
        (g) =>
          g.kind === 'board' ||
          g.kind === 'hardware' ||
          g.code === 'FRENTE' ||
          g.code === 'INTERIOR' ||
          g.code === 'FONDO' ||
          g.code === 'BISAGRA' ||
          g.code === 'CORREDERA' ||
          g.code === 'JALADERA',
      ),
    [optionGroups],
  );

  const [role, setRole] = useState(allGroups[0]?.code ?? '');
  const [choiceB, setChoiceB] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);

  const group = allGroups.find((g) => g.code === role);
  const options = group
    ? optionsForGroup(group, {
        materials: catalog.materials,
        edges: catalog.edges,
        hardware: catalog.hardware,
      })
    : [];

  const result = useMemo(():
    | ScenarioCompareResult
    | { ok: false; message: string }
    | null => {
    if (!role || !choiceB) return null;
    return compareRoleScenario(
      project,
      catalog as Catalog,
      role,
      choiceB,
    );
  }, [project, catalog, role, choiceB]);

  if (allGroups.length === 0 || project.items.length === 0) {
    return null;
  }

  return (
    <div
      className="project-detail__section"
      data-testid="quote-scenario-compare"
    >
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">Comparar escenario B</h3>
      </div>
      <p className="catalog-form__hint" style={{ marginTop: 0 }}>
        Probá otro material o herraje sin alterar la cotización actual. Podés comparar
        costos, descargar el PDF para el cliente o aplicar B.
      </p>

      <div className="module-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor="scenario-role">Grupo de opción</label>
          <select
            id="scenario-role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setChoiceB('');
            }}
            data-testid="scenario-role"
          >
            {allGroups.map((g) => (
              <option key={g.id} value={g.code}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
        </div>
        <div className="catalog-form__field">
          <label htmlFor="scenario-choice-b">Opción escenario B</label>
          <select
            id="scenario-choice-b"
            value={choiceB}
            onChange={(e) => setChoiceB(e.target.value)}
            data-testid="scenario-choice-b"
          >
            <option value="">Elegí una opción…</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name} — {opt.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {result && !result.ok ? (
        <p className="catalog-form__error" data-testid="scenario-error">
          {result.message}
        </p>
      ) : null}

      {result && result.ok ? (
        <>
          <div
            className="project-scenario-compare__results"
            data-testid="scenario-results"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '0.75rem',
              marginTop: '0.75rem',
            }}
          >
            <div>
              <p className="catalog-form__hint" style={{ margin: 0 }}>
                Escenario A (actual)
              </p>
              <p
                style={{ margin: '0.25rem 0 0', fontWeight: 600 }}
                data-testid="scenario-sale-a"
              >
                {formatMoneyDisplay(result.saleA, { currency })}
              </p>
            </div>
            <div>
              <p className="catalog-form__hint" style={{ margin: 0 }}>
                Escenario B
              </p>
              <p
                style={{ margin: '0.25rem 0 0', fontWeight: 600 }}
                data-testid="scenario-sale-b"
              >
                {formatMoneyDisplay(result.saleB, { currency })}
              </p>
            </div>
            <div>
              <p className="catalog-form__hint" style={{ margin: 0 }}>
                Diferencia (B − A)
              </p>
              <p
                style={{
                  margin: '0.25rem 0 0',
                  fontWeight: 700,
                  color:
                    result.delta > 0
                      ? 'var(--danger, #b91c1c)'
                      : result.delta < 0
                        ? 'var(--success, #15803d)'
                        : undefined,
                }}
                data-testid="scenario-delta"
              >
                {result.delta > 0 ? '+' : ''}
                {formatMoneyDisplay(result.delta, { currency })}
              </p>
            </div>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowBreakdown((v) => !v)}
              data-testid="toggle-scenario-breakdown"
            >
              {showBreakdown ? 'Ocultar desglose comparativo' : 'Ver desglose comparativo de costos'}
            </button>
          </div>

          {showBreakdown && result.breakdownA && result.breakdownB ? (
            <div
              style={{
                marginTop: '0.5rem',
                padding: '0.75rem',
                backgroundColor: 'var(--surface-subtle, #f8fafc)',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle, #e2e8f0)',
                fontSize: '0.85rem',
              }}
              data-testid="scenario-breakdown-table"
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                    <th style={{ padding: '4px' }}>Componente</th>
                    <th style={{ padding: '4px', textAlign: 'right' }}>A (Actual)</th>
                    <th style={{ padding: '4px', textAlign: 'right' }}>B (Propuesto)</th>
                    <th style={{ padding: '4px', textAlign: 'right' }}>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px' }}>Tableros / Placas</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownA.boardCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.boardCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.boardCost - result.breakdownA.boardCost, { currency })}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>Tapacantos</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownA.edgeCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.edgeCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.edgeCost - result.breakdownA.edgeCost, { currency })}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>Herrajes</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownA.hardwareCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.hardwareCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.hardwareCost - result.breakdownA.hardwareCost, { currency })}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>Mano de obra</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownA.laborCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.laborCost, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.laborCost - result.breakdownA.laborCost, { currency })}</td>
                  </tr>
                  <tr style={{ fontWeight: 600, borderTop: '1px dashed #cbd5e1' }}>
                    <td style={{ padding: '4px' }}>Total Venta</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownA.salePrice, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.salePrice, { currency })}</td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>{formatMoneyDisplay(result.breakdownB.salePrice - result.breakdownA.salePrice, { currency })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      {result && result.ok && choiceB ? (
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginTop: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          {canApply ? (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => onApplyB(role, choiceB)}
              data-testid="scenario-apply-b"
            >
              Aplicar B a la cotización
            </button>
          ) : null}
          {canDuplicate && onDuplicateWithB ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => onDuplicateWithB(role, choiceB)}
              data-testid="scenario-duplicate-b"
            >
              Duplicar cotización con B
            </button>
          ) : null}
          {onExportScenarioPdf ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => onExportScenarioPdf(role, choiceB)}
              data-testid="scenario-export-pdf"
            >
              Descargar PDF Comparativo A/B
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setChoiceB('')}
            data-testid="scenario-discard-b"
          >
            Descartar B
          </button>
        </div>
      ) : null}
    </div>
  );
}
