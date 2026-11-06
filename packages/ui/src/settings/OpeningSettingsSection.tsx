/**
 * OpeningSettingsSection (#1134) — the factory's opening capabilities for
 * NEW authoring: which grip systems the factory offers (jaladera / gola /
 * rebase inferior), which one is preselected, which gola profiles it curates
 * and the per-furniture-type restrictions. Available ≠ valid: disabling a
 * system hides/blocks NEW selection only — existing designs keep resolving
 * against their pinned release, and this section says so.
 *
 * The capabilities blob carries NO dimensions: profile geometry lives in the
 * OpeningProfile catalog. The one millimetre value here is the bottom
 * overhang (#1525), saved in its own `opening.bottom-overhang` key in the
 * same overlay write.
 *
 * #1525: the per-furniture-type restrictions and the «preselected» system
 * have no consumer today (the design opening write never sends the furniture
 * type and no client reads `default`), so they are not rendered. Saving keeps
 * whatever the overlay already stores for them; the grip-style model of
 * #1531 replaces them.
 */
import type { ReactNode } from 'react';
import { Factory } from 'lucide-react';
import {
  type OpeningCapabilities,
  type OpeningGolaSectionKey,
  type OpeningGripSystem,
} from '@granete/domain';

/** #1329 — the catalog projection the standard mark needs: enough to name
 * each curated profile and group it by its own section. */
export interface OpeningStandardProfileOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly crossSection: string | null;
  readonly active: boolean;
  readonly datasheetStatus: string;
}

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
  /** The org's opening profiles (#1329): names the curated ids and drives
   * the per-section standard radios. Null/absent = catalog not loaded — the
   * curation list falls back to raw ids (today's behavior). */
  readonly profiles?: readonly OpeningStandardProfileOption[] | null;
  /** #1525 — the bottom-overhang millimetres as typed ('' = none declared). */
  readonly overhangMm?: string;
  readonly onOverhangChange?: (value: string) => void;
}

const SYSTEM_LABELS: readonly { readonly id: OpeningGripSystem; readonly label: string; readonly description: string }[] = [
  { id: 'handle', label: 'Jaladera', description: 'Tirador o perilla montado en el frente.' },
  { id: 'gola', label: 'Gola', description: 'Perfil continuo que forma el agarre. Cambia el cuerpo, los frentes y la lista de materiales.' },
  { id: 'bottom_overhang', label: 'Rebase inferior', description: 'La puerta baja unos milímetros por debajo del mueble para tomarla por abajo. Se usa en alacenas.' },
];

const GOLA_SECTION_LABELS: Record<OpeningGolaSectionKey, string> = {
  L: 'L',
  C: 'C',
  J: 'J',
  flat: 'Plana',
};

export function OpeningSettingsSection({
  capabilities,
  decided,
  onChange,
  onSave,
  saving = false,
  disabled = false,
  error = null,
  profiles = null,
  overhangMm = '',
  onOverhangChange,
}: OpeningSettingsSectionProps): ReactNode {

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


  // #1329: one standard per (gola) section — marking another profile of the
  // same section replaces the mark; clearing the last one omits the key so
  // the overlay serializes the truthful absence.
  const setStandardProfile = (section: OpeningGolaSectionKey, profileId: string | null) => {
    const grips = { ...capabilities.grips };
    const current = grips.gola ?? { enabled: false, default: false };
    const standards: Partial<Record<OpeningGolaSectionKey, string>> = { ...(current.standardProfiles ?? {}) };
    if (profileId === null) {
      delete standards[section];
    } else {
      standards[section] = profileId;
    }
    const next = { ...current };
    if (Object.keys(standards).length > 0) {
      next.standardProfiles = standards;
    } else {
      delete next.standardProfiles;
    }
    grips.gola = next;
    onChange({ ...capabilities, version: 1, grips });
  };


  return (
    <section className="settings-section" data-testid="settings-section-opening">
      <h3>
        <Factory size={16} aria-hidden /> Apertura — qué ofrece el taller
      </h3>
      <p className="settings-hint">
        {decided
          ? 'Estos son los sistemas de agarre que se pueden elegir en SketchUp.'
          : 'Todavía no guardaste esta configuración: se muestran los valores iniciales de Granete.'}{' '}
        Dejar de ofrecer un sistema no cambia los muebles que ya lo usan.
      </p>

      <div className="settings-grid" data-testid="opening-systems">
        {SYSTEM_LABELS.map(({ id, label, description }) => {
          const capability = capabilities.grips[id] ?? { enabled: false, default: false };
          return (
            <div key={id} className="catalog-card" data-testid={`opening-system-${id}`}>
              <div className="catalog-form__field">
                <h4 style={{ margin: 0 }} id={`opening-system-${id}-title`}>{label}</h4>
                <p className="settings-hint" style={{ margin: 0 }}>{description}</p>
                <label>
                  <input
                    type="checkbox"
                    checked={capability.enabled}
                    onChange={(e) => updateSystem(id, { enabled: e.target.checked })}
                    disabled={disabled || saving}
                    aria-describedby={`opening-system-${id}-title`}
                    data-testid={`opening-system-${id}-enabled`}
                  />{' '}
                  Ofrecer en SketchUp
                </label>
              </div>
              {id === 'gola' && (
                <div className="catalog-form__field" data-testid="opening-gola-profiles">
                  <label>Perfiles que se ofrecen y estándar por sección</label>
                  {capability.profiles?.length ? (
                    <>
                      <ul className="settings-hint" style={{ margin: 0, listStyle: 'none', padding: 0 }}>
                        {capability.profiles.map((profileId) => {
                          const option = profiles?.find((p) => p.id === profileId) ?? null;
                          const section = (option?.crossSection as OpeningGolaSectionKey | undefined) ?? null;
                          const isStandard = section != null && capability.standardProfiles?.[section] === profileId;
                          return (
                            <li
                              key={profileId}
                              data-testid={`opening-gola-profile-${profileId}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: 0 }}
                            >
                              <span>
                                {option
                                  ? `${option.code} — ${option.name}${option.manufacturer ? ` (${option.manufacturer})` : ''}${option.active ? '' : ' · desactivado'}`
                                  : profileId}
                              </span>
                              {section != null && option?.active ? (
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="radio"
                                    name={`opening-standard-${section}`}
                                    checked={isStandard}
                                    disabled={disabled || saving || !capability.enabled}
                                    onChange={() => setStandardProfile(section, profileId)}
                                    data-testid={`opening-standard-${section}-${profileId}`}
                                  />{' '}
                                  Estándar {GOLA_SECTION_LABELS[section]}
                                </label>
                              ) : null}
                              {isStandard ? (
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  disabled={disabled || saving}
                                  onClick={() => setStandardProfile(section, null)}
                                  data-testid={`opening-standard-clear-${section}`}
                                >
                                  Quitar estándar
                                </button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {/* #1329 fail-closed honesty: a standard pointing at a
                       * deactivated/removed profile is NO standard for the
                       * consumers — never an invented fallback. */}
                      {Object.entries(capability.standardProfiles ?? {})
                        .filter(([, standardId]) => {
                          if (profiles == null) return false;
                          const option = profiles.find((p) => p.id === standardId) ?? null;
                          return option == null || !option.active;
                        })
                        .map(([section]) => (
                          <p
                            key={section}
                            className="settings-hint"
                            role="note"
                            data-testid={`opening-standard-dead-${section}`}
                            style={{ margin: 0 }}
                          >
                            El estándar de la sección {GOLA_SECTION_LABELS[section as OpeningGolaSectionKey] ?? section} apunta
                            a un perfil desactivado o eliminado: se lee como SIN estándar hasta que marques otro.
                          </p>
                        ))}
                    </>
                  ) : (
                    <p className="settings-hint" style={{ margin: 0 }}>
                      Todavía no elegiste perfiles: en SketchUp aparecen todos los perfiles de gola con la ficha
                      completa.
                    </p>
                  )}
                </div>
              )}
              {id === 'bottom_overhang' && (
                <div className="catalog-form__field" data-testid="opening-overhang">
                  <label htmlFor="opening-overhang-mm">¿Cuántos mm baja la puerta por debajo del mueble?</label>
                  <input
                    id="opening-overhang-mm"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={overhangMm}
                    placeholder="20"
                    disabled={disabled || saving || !onOverhangChange}
                    onChange={(e) => onOverhangChange?.(e.target.value)}
                    aria-describedby="opening-overhang-hint"
                    data-testid="opening-overhang-mm"
                  />
                  <p id="opening-overhang-hint" className="settings-hint" style={{ margin: 0 }} data-testid="opening-overhang-hint">
                    {overhangMm.trim() === ''
                      ? 'Sin milímetros, el rebase queda bloqueado en SketchUp. Lo común es 10 o 20 mm.'
                      : 'Número entero en milímetros. Lo común es 10 o 20 mm.'}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>


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
          {saving ? 'Guardando…' : 'Guardar apertura'}
        </button>
      </div>
    </section>
  );
}
