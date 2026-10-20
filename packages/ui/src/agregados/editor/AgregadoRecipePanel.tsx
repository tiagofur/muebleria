/**
 * #1369 — pestaña «Receta» del editor de agregado: vista READ-ONLY de la
 * receta guardada (miembros, sets de variantes, kit, compatibilidad). La
 * edición de la receta no existe por diseño; el cambio se hace con
 * «Simular cambio» (dry-run + apply atómico). La simulación siempre corre
 * contra la revisión guardada, nunca contra el borrador.
 */

import { Box, FlaskConical, Ruler as RulerIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Agregado, Hardware } from '@granete/domain';

export type AgregadoRecipePanelProps = {
  /** La entidad guardada cuya receta se muestra (no el borrador). */
  readonly saved: Agregado | null;
  readonly catalogHardware: readonly Hardware[];
  readonly onSimulateChange?: () => void;
  readonly testId?: string;
};

function kitLabel(
  kitId: string | undefined,
  catalog: readonly Hardware[],
): string {
  if (!kitId) return 'Sin kit comercial';
  const h = catalog.find((x) => x.id === kitId);
  return h ? `${h.code ?? kitId} — ${h.name ?? ''}`.trim() : kitId;
}

function sourceLabel(member: { readonly source: { readonly kind: string; readonly variant?: { readonly variantSetId: string }; readonly fixed?: { readonly hardwareId: string } } }): string {
  if (member.source.kind === 'variant' && member.source.variant) {
    return `Variante · set ${member.source.variant.variantSetId}`;
  }
  return 'Fijo';
}

function Row({
  icon: Icon,
  primary,
  secondary,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly primary: string;
  readonly secondary: string;
  readonly testId?: string;
}): ReactNode {
  return (
    <li className="agregado-recipe__row" data-testid={testId}>
      <Icon size={14} strokeWidth={1.5} aria-hidden />
      <div>
        <span className="agregado-recipe__row-primary">{primary}</span>
        <span className="agregado-recipe__row-secondary">{secondary}</span>
      </div>
    </li>
  );
}

export function AgregadoRecipePanel({
  saved,
  catalogHardware,
  onSimulateChange,
  testId = 'agregado-tab-recipe',
}: AgregadoRecipePanelProps): ReactNode {
  if (!saved) {
    return (
      <div
        className="agregado-editor__panel"
        id="agregado-editor-panel-recipe"
        role="tabpanel"
        aria-labelledby="agregado-editor-tab-recipe"
        data-testid={testId}
      >
        <p className="catalog-empty">Guardá el agregado para ver su receta.</p>
      </div>
    );
  }

  const members = saved.rigidMembers ?? [];
  const sets = saved.variantSets ?? [];

  return (
    <div
      className="agregado-editor__panel agregado-recipe"
      id="agregado-editor-panel-recipe"
      role="tabpanel"
      aria-labelledby="agregado-editor-tab-recipe"
      data-testid={testId}
    >
      <div className="agregado-editor__panel-header">
        <h4 className="module-editor__section-title">Receta guardada</h4>
        {onSimulateChange ? (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onSimulateChange}
            data-testid="agregado-editor-recipe-simulate"
          >
            <FlaskConical size={14} strokeWidth={1.5} aria-hidden />
            Simular cambio
          </button>
        ) : null}
      </div>

      <section className="agregado-recipe__section" aria-label="Miembros">
        <h5>Miembros ({members.length})</h5>
        {members.length === 0 ? (
          <p className="catalog-empty">La receta no declara miembros.</p>
        ) : (
          <ul>
            {members.map((m) => (
              <Row
                key={m.memberId}
                icon={Box}
                primary={`${m.memberId}${m.role ? ` · ${m.role}` : ''}`}
                secondary={`${sourceLabel(m)} · ${
                  m.bomRole === 'included_in_kit' ? 'Incluido en el juego' : 'Línea separada'
                }`}
                testId={`${testId}-member-${m.memberId}`}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="agregado-recipe__section" aria-label="Sets de variantes">
        <h5>Sets de variantes ({sets.length})</h5>
        {sets.length === 0 ? (
          <p className="catalog-empty">Sin sets de variantes.</p>
        ) : (
          <ul>
            {sets.map((set) => (
              <Row
                key={set.id}
                icon={RulerIcon}
                primary={`${set.id} · ${set.dimension}`}
                secondary={set.variants.map((v) => `${v.nominalDimensionMm} mm (${v.hardwareId})`).join(' · ')}
                testId={`${testId}-set-${set.id}`}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="agregado-recipe__section" aria-label="Consumo comercial">
        <h5>Consumo comercial</h5>
        <ul>
          <Row icon={Box} primary="Kit comercial" secondary={kitLabel(saved.commercialKitHardwareId, catalogHardware)} testId={`${testId}-kit`} />
          {(saved.compatibilityRules ?? []).map((rule) => (
            <Row
              key={rule.variantSetId}
              icon={RulerIcon}
              primary={`Set ${rule.variantSetId}`}
              secondary={`holgura ${rule.clearanceMm} mm · estrategia ${rule.selectionStrategy}`}
              testId={`${testId}-rule-${rule.variantSetId}`}
            />
          ))}
        </ul>
      </section>

      <p className="agregado-recipe__hint">
        La receta es un dato versionado del catálogo. Para cambiar familia, SKU o
        variante usá Simular cambio.
      </p>
    </div>
  );
}
