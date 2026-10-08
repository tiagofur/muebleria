/**
 * OpeningSettingsSection (#1134) — the factory's opening capabilities for
 * NEW authoring: which grip systems the factory offers (jaladera / gola /
 * rebase inferior), which one is preselected, which gola profiles it curates
 * and the per-furniture-type restrictions. Available ≠ valid: disabling a
 * system hides/blocks NEW selection only — existing designs keep resolving
 * against their pinned release, and this section says so.
 *
 * The overlay carries NO dimensions: profile geometry lives in the
 * OpeningProfile catalog; this section never edits millimetres.
 */
import type { ReactNode } from 'react';
import { Factory } from 'lucide-react';
import {
  availableOpeningSystems,
  type FurnitureTypeKey,
  type OpeningCapabilities,
  type OpeningGripSystem,
  type OpeningPlacementKey,
} from '@granete/domain';

export interface OpeningSettingsSectionProps {
  readonly capabilities: OpeningCapabilities;
  /** False = the overlay carries no `opening.capabilities` decision yet —
   * what the section shows are the LIBRARY defaults, not a factory choice. */
  readonly decided: boolean;
  readonly onChange: (next: OpeningCapabilities) => void;
  readonly onSave: () => void | Promise<unknown>;
  readonly saving?: boolean;
  readonly disabled?: boolean;
  readonly error?: string | null;
}

const SYSTEM_LABELS: readonly { readonly id: OpeningGripSystem; readonly label: string; readonly description: string }[] = [
  { id: 'handle', label: 'Jaladera', description: 'Tirador o perilla montado en el frente (baseline).' },
  { id: 'gola', label: 'Gola (perfil integrado)', description: 'Perfil continuo que crea el agarre: modifica cuerpo, frentes y BOM.' },
  { id: 'bottom_overhang', label: 'Rebase inferior', description: 'El frente rebasa el gabinete por abajo para agarrar por debajo (espera evidencia de campo).' },
];

const TYPE_LABELS: readonly { readonly id: FurnitureTypeKey; readonly label: string }[] = [
  { id: 'inferior', label: 'Inferiores' },
  { id: 'superior', label: 'Superiores (alacenas)' },
  { id: 'alto', label: 'Altos' },
];

const PLACEMENTS: readonly OpeningPlacementKey[] = ['top', 'between', 'bottom'];

const PLACEMENT_LABELS: Record<OpeningPlacementKey, string> = {
  top: 'Superior',
  between: 'Entre frentes',
  bottom: 'Inferior',
};

export function OpeningSettingsSection({
  capabilities,
  decided,
  onChange,
  onSave,
  saving = false,
  disabled = false,
  error = null,
}: OpeningSettingsSectionProps): ReactNode {
  const offered = availableOpeningSystems(capabilities);
  const defaultSystem = (Object.keys(capabilities.grips) as OpeningGripSystem[]).find(
    (system) => capabilities.grips[system]?.default,
  );

  const updateSystem = (system: OpeningGripSystem, patch: Partial<NonNullable<OpeningCapabilities['grips'][OpeningGripSystem]>>) => {
    const grips = { ...capabilities.grips };
    const current = grips[system] ?? { enabled: false, default: false };
    const next = { ...current, ...patch };
    // Dropping the default off a disabled system keeps exactly ≤1 default.
    if (!next.enabled) {
      next.default = false;
    }
    grips[system] = next;
    onChange({ ...capabilities, version: 1, grips });
  };

  const setDefaultSystem = (system: OpeningGripSystem) => {
    const grips = { ...capabilities.grips };
    for (const key of Object.keys(grips) as OpeningGripSystem[]) {
      const current = grips[key];
      if (!current) continue;
      grips[key] = { ...current, default: key === system };
    }
    onChange({ ...capabilities, version: 1, grips });
  };

  const updateTypeGrip = (
    type: FurnitureTypeKey,
    system: OpeningGripSystem,
    patch: { placements?: readonly OpeningPlacementKey[]; default?: boolean },
  ) => {
    const byType = { ...(capabilities.byFurnitureType ?? {}) };
    const typeCaps = { ...(byType[type] ?? { grips: {} }) };
    const grips = { ...(typeCaps.grips ?? {}) };
    const current = grips[system] ?? {};
    const next = { ...current, ...patch };
    if (!next.placements?.length && next.default === undefined) {
      delete grips[system];
    } else {
      grips[system] = next;
    }
    typeCaps.grips = grips;
    byType[type] = typeCaps;
    onChange({ ...capabilities, version: 1, byFurnitureType: byType });
  };

  return (
    <section className="settings-section" data-testid="settings-section-opening">
      <h3>
        <Factory size={16} aria-hidden /> Apertura — qué ofrece la fábrica
      </h3>
      <p className="settings-hint">
        {decided
          ? 'Decisión de fábrica activa: gobierna qué sistemas puede elegir una autoría NUEVA.'
          : 'Sin decisión de fábrica todavía: se muestran los valores heredados de la biblioteca.'}{' '}
        Deshabilitar un sistema no toca los diseños existentes — siguen resolviendo contra su biblioteca fijada.
      </p>

      <div className="settings-grid" data-testid="opening-systems">
        {SYSTEM_LABELS.map(({ id, label, description }) => {
          const capability = capabilities.grips[id] ?? { enabled: false, default: false };
          return (
            <div key={id} className="catalog-card" data-testid={`opening-system-${id}`}>
              <div className="catalog-form__field">
                <label>
                  <input
                    type="checkbox"
                    checked={capability.enabled}
                    onChange={(e) => updateSystem(id, { enabled: e.target.checked })}
                    disabled={disabled || saving}
                    data-testid={`opening-system-${id}-enabled`}
                  />{' '}
                  {label} {offered.includes(id) ? '' : '(no disponible para nueva autoría)'}
                </label>
                <p className="settings-hint" style={{ margin: 0 }}>{description}</p>
              </div>
              <div className="catalog-form__field">
                <label>
                  <input
                    type="radio"
                    name="opening-default-system"
                    checked={defaultSystem === id}
                    disabled={disabled || saving || !capability.enabled}
                    onChange={() => setDefaultSystem(id)}
                    data-testid={`opening-system-${id}-default`}
                  />{' '}
                  Sistema preseleccionado
                </label>
              </div>
              {id === 'gola' && (
                <div className="catalog-form__field" data-testid="opening-gola-profiles">
                  <label>Perfiles curados</label>
                  {capability.profiles?.length ? (
                    <ul className="settings-hint" style={{ margin: 0 }}>
                      {capability.profiles.map((profileId) => (
                        <li key={profileId}>{profileId}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="settings-hint" style={{ margin: 0 }}>
                      Sin curaduría todavía: la gola se ofrece, pero los perfiles exactos se eligen del catálogo
                      (los pendientes de ficha bloquean su selección).
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h4>Restricciones por tipo de mueble</h4>
      <table data-testid="opening-by-furniture-type">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Sistema</th>
            <th>Posiciones permitidas</th>
            <th>Default del tipo</th>
          </tr>
        </thead>
        <tbody>
          {TYPE_LABELS.map(({ id: type, label }) =>
            SYSTEM_LABELS.filter(({ id: system }) => capabilities.grips[system]?.enabled).map(({ id: system, label: systemLabel }) => {
              const grip = capabilities.byFurnitureType?.[type]?.grips?.[system];
              return (
                <tr key={`${type}-${system}`} data-testid={`opening-type-${type}-${system}`}>
                  <td>{label}</td>
                  <td>{systemLabel}</td>
                  <td>
                    {PLACEMENTS.map((placement) => {
                      const checked = grip?.placements?.includes(placement) ?? false;
                      return (
                        <label key={placement} style={{ marginRight: 12 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled || saving}
                            data-testid={`opening-type-${type}-${system}-${placement}`}
                            onChange={(e) => {
                              const next = new Set(grip?.placements ?? []);
                              if (e.target.checked) {
                                next.add(placement);
                              } else {
                                next.delete(placement);
                              }
                              updateTypeGrip(type, system, { placements: [...next] });
                            }}
                          />{' '}
                          {PLACEMENT_LABELS[placement]}
                        </label>
                      );
                    })}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={grip?.default === true}
                      disabled={disabled || saving}
                      data-testid={`opening-type-${type}-${system}-default`}
                      onChange={(e) => updateTypeGrip(type, system, { default: e.target.checked })}
                    />
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>

      {error ? (
        <p className="settings-hint" role="alert" data-testid="opening-capabilities-error">
          {error}
        </p>
      ) : null}

      <div className="catalog-form__field">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={disabled || saving}
          data-testid="opening-capabilities-save"
        >
          {saving ? 'Guardando…' : 'Guardar capacidades de apertura'}
        </button>
      </div>
    </section>
  );
}
