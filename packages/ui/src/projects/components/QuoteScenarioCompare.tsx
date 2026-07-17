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
}: QuoteScenarioCompareProps): ReactNode {
  const materialGroups = useMemo(
    () =>
      optionGroups.filter(
        (g) =>
          g.kind === 'board' ||
          g.code === 'FRENTE' ||
          g.code === 'INTERIOR' ||
          g.code === 'FONDO',
      ),
    [optionGroups],
  );

  const [role, setRole] = useState(materialGroups[0]?.code ?? '');
  const [choiceB, setChoiceB] = useState('');

  const group = materialGroups.find((g) => g.code === role);
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

  if (materialGroups.length === 0 || project.items.length === 0) {
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
        Probá otro material o frente sin tocar la cotización. Aplicar B guarda
        el cambio en todos los muebles (solo borrador).
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
            {materialGroups.map((g) => (
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
