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
      <p className="catalog-form__hint scenario-compare__hint--no-top">
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
            className="project-scenario-compare__results scenario-compare__results"
            data-testid="scenario-results"
          >
            <div>
              <p className="catalog-form__hint scenario-compare__label">
                Escenario A (actual)
              </p>
              <p
                className="scenario-compare__price"
                data-testid="scenario-sale-a"
              >
                {formatMoneyDisplay(result.saleA, { currency })}
              </p>
            </div>
            <div>
              <p className="catalog-form__hint scenario-compare__label">
                Escenario B
              </p>
              <p
                className="scenario-compare__price"
                data-testid="scenario-sale-b"
              >
                {formatMoneyDisplay(result.saleB, { currency })}
              </p>
            </div>
            <div>
              <p className="catalog-form__hint scenario-compare__label">
                Diferencia (B − A)
              </p>
              <p
                className={`scenario-compare__delta${
                  result.delta > 0
                    ? ' scenario-compare__delta--positive'
                    : result.delta < 0
                      ? ' scenario-compare__delta--negative'
                      : ''
                }`}
                data-testid="scenario-delta"
              >
                {result.delta > 0 ? '+' : ''}
                {formatMoneyDisplay(result.delta, { currency })}
              </p>
            </div>
          </div>

          <div className="scenario-compare__toggle">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setShowBreakdown((v) => !v)}
              data-testid="toggle-scenario-breakdown"
            >
              {showBreakdown ? 'Ocultar desglose comparativo' : 'Ver desglose comparativo de costos'}
            </button>
          </div>

          {showBreakdown && result.breakdownA && result.breakdownB ? (
            <div
              className="scenario-compare__breakdown"
              data-testid="scenario-breakdown-table"
            >
              <table className="scenario-compare__table">
                <thead>
                  <tr className="scenario-compare__th-row">
                    <th className="scenario-compare__cell">Componente</th>
                    <th className="scenario-compare__cell--right">A (Actual)</th>
                    <th className="scenario-compare__cell--right">B (Propuesto)</th>
                    <th className="scenario-compare__cell--right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="scenario-compare__cell">Tableros / Placas</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownA.materialsCost, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.materialsCost, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.materialsCost - result.breakdownA.materialsCost, { currency })}</td>
                  </tr>
                  <tr>
                    <td className="scenario-compare__cell">Tapacantos</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownA.edgeTotal, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.edgeTotal, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.edgeTotal - result.breakdownA.edgeTotal, { currency })}</td>
                  </tr>
                  <tr>
                    <td className="scenario-compare__cell">Herrajes</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownA.hardwareTotal, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.hardwareTotal, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.hardwareTotal - result.breakdownA.hardwareTotal, { currency })}</td>
                  </tr>
                  <tr>
                    <td className="scenario-compare__cell">Mano de obra</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownA.laborModular, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.laborModular, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.laborModular - result.breakdownA.laborModular, { currency })}</td>
                  </tr>
                  <tr className="scenario-compare__total-row">
                    <td className="scenario-compare__cell">Total Venta</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownA.salePrice, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.salePrice, { currency })}</td>
                    <td className="scenario-compare__cell--right">{formatMoneyDisplay(result.breakdownB.salePrice - result.breakdownA.salePrice, { currency })}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      {result && result.ok && choiceB ? (
        <div className="scenario-compare__actions">
          {canApply ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onApplyB(role, choiceB)}
              data-testid="scenario-apply-b"
            >
              Aplicar B a la cotización
            </button>
          ) : null}
          {canDuplicate && onDuplicateWithB ? (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => onDuplicateWithB(role, choiceB)}
              data-testid="scenario-duplicate-b"
            >
              Duplicar cotización con B
            </button>
          ) : null}
          {onExportScenarioPdf ? (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => onExportScenarioPdf(role, choiceB)}
              data-testid="scenario-export-pdf"
            >
              Descargar PDF Comparativo A/B
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--small"
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
