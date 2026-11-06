/**
 * Create/edit opening profile modal (#1325): identity + the verified
 * datasheet block + the DECLARED body effects. The depth reduction may
 * declare no value — the form shows what the engine will derive
 * («deriva de la ficha: 27.2») instead of a bare input (#1317). BOM members
 * travel read-only in v1: they are preserved untouched on edit.
 */

import {
  useId,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../common';
import { CatalogPicker, type CatalogPickerOption } from '../CatalogPicker';
import {
  HARDWARE_MEMBER_ROLES,
  defaultsForHardwareRole,
  emptyMemberDraft,
  isHardwareMemberRole,
  formatMmInput,
  type OpeningBevelAtDraft,
  type OpeningCrossSectionDraft,
  type OpeningGripTypeDraft,
  type OpeningNotchAtDraft,
  type OpeningProfileDraft,
  type OpeningProfileMemberDraft,
} from './openingProfileDraft';

const GRIP_LABELS: readonly { readonly value: OpeningGripTypeDraft; readonly label: string }[] = [
  { value: 'gola', label: 'Gola (perfil integrado)' },
  { value: 'handle', label: 'Jaladera (tirador)' },
  { value: 'bottom_reveal', label: 'Rebase inferior' },
  { value: 'none', label: 'Sin grip' },
];

// #1526: the engine reads hardware members ONLY by these exact keys
// (OpeningMembersFromFrozenPin). The role select replaces the free key so a
// member can never be silently ignored.
const ROLE_LABELS: Readonly<Record<string, string>> = {
  profile: 'Perfil',
  supports: 'Soportes',
  endCaps: 'Tapas',
};

const SECTION_LABELS: readonly { readonly value: OpeningCrossSectionDraft; readonly label: string }[] = [
  { value: 'L', label: 'L' },
  { value: 'C', label: 'C' },
  { value: 'J', label: 'J' },
  { value: 'flat', label: 'Plano' },
];

const NOTCH_AT_LABELS: readonly { readonly value: OpeningNotchAtDraft; readonly label: string }[] = [
  { value: 'top_front', label: 'Frente superior' },
  { value: 'bottom_front', label: 'Frente inferior' },
  { value: 'front_boundary', label: 'Frontera entre zonas' },
];

const BEVEL_AT_LABELS: readonly { readonly value: OpeningBevelAtDraft; readonly label: string }[] = [
  { value: 'top_front', label: 'Borde superior de la puerta' },
  { value: 'bottom_front', label: 'Borde inferior de la puerta' },
];

export interface OpeningProfileFormModalProps {
  /** K4 #1032: saved identity of the edited item, shown in the title. */
  readonly identity?: { readonly code: string; readonly name: string };
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: OpeningProfileDraft;
  readonly setDraft: Dispatch<SetStateAction<OpeningProfileDraft>>;
  readonly error: string | null;
  readonly canMutate: boolean;
  readonly saving?: boolean;
  readonly onSubmit: (e: FormEvent) => void;
  readonly onClose: () => void;
  /** #1526 — the org's hardware, searchable by name or code (SKU). Null =
   * not loaded: the reference falls back to a plain text field. */
  readonly hardwareOptions?: readonly CatalogPickerOption[] | null;
  /** #1526 — the org's catalog components (panels), same fallback rule. */
  readonly componentOptions?: readonly CatalogPickerOption[] | null;
}

function numberField(
  id: string,
  label: string,
  value: string,
  onChange: (value: string) => void,
  hint?: string,
  testId?: string,
): ReactNode {
  return (
    <label className="catalog-form__field">
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
      {hint ? <small className="catalog-form__hint">{hint}</small> : null}
    </label>
  );
}

export function OpeningProfileFormModal({
  open,
  editingId,
  formId,
  draft,
  setDraft,
  error,
  saving = false,
  onSubmit,
  onClose,
  identity,
  hardwareOptions = null,
  componentOptions = null,
}: OpeningProfileFormModalProps): ReactNode {
  const verified = draft.datasheetStatus === 'verified';
  const derivedPreview = Number(draft.profileDepthMm);

  const setMember = (index: number, patch: Partial<OpeningProfileMemberDraft>) => {
    setDraft((current) => ({
      ...current,
      members: current.members.map((member, i) => (i === index ? { ...member, ...patch } : member)),
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        identity
          ? `Editar perfil de apertura — ${identity.code} · ${identity.name}`
          : 'Nuevo perfil de apertura'
      }
      size="md"
      dataTestId="opening-profile-form-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            form={formId}
            disabled={saving}
            data-testid="opening-profile-form-submit-btn"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={formId} className="catalog-form" onSubmit={onSubmit}>
        {error ? <p className="catalog-form__error" role="alert">{error}</p> : null}

        {editingId == null ? (
          <label className="catalog-form__field">
            <span>Identificador</span>
            <input
              value={draft.id}
              onChange={(e) => setDraft((current) => ({ ...current, id: e.target.value }))}
              placeholder="profile.gola-l-8006"
              maxLength={64}
              data-testid="opening-profile-id-input"
              required
            />
            <small className="catalog-form__hint">
              Nombre estable del perfil (los diseños lo referencian). Sugerencia: el código en minúsculas.
            </small>
          </label>
        ) : null}

        <label className="catalog-form__field">
          <span>Código</span>
          <input
            value={draft.code}
            onChange={(e) => setDraft((current) => ({ ...current, code: e.target.value }))}
            placeholder="GOLA-L-8006"
            maxLength={64}
            data-testid="opening-profile-code-input"
            required
          />
        </label>

        <label className="catalog-form__field">
          <span>Nombre</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
            placeholder="Gola L Cymisa 8006"
            maxLength={120}
            data-testid="opening-profile-name-input"
            required
          />
        </label>

        <label className="catalog-form__field">
          <span>Fabricante</span>
          <input
            value={draft.manufacturer}
            onChange={(e) => setDraft((current) => ({ ...current, manufacturer: e.target.value }))}
            placeholder="SCILM"
            maxLength={120}
            data-testid="opening-profile-manufacturer-input"
          />
          <small className="catalog-form__hint">
            Informativo: distingue dos perfiles iguales de fabricantes distintos en el picker. El código sigue siendo la identidad.
          </small>
        </label>

        <div className="catalog-form__row">
          <label className="catalog-form__field">
            <span>Tipo de agarre</span>
            <select
              value={draft.gripType}
              onChange={(e) => setDraft((current) => ({ ...current, gripType: e.target.value as OpeningGripTypeDraft }))}
              disabled={draft.gripType !== 'gola'}
              data-testid="opening-profile-grip-select"
            >
              {GRIP_LABELS.filter((grip) => grip.value === 'gola' || grip.value === draft.gripType).map((grip) => (
                <option key={grip.value} value={grip.value}>{grip.label}</option>
              ))}
            </select>
            {draft.gripType !== 'gola' ? (
              <small className="catalog-form__hint" data-testid="opening-profile-grip-legacy">
                Jaladera, rebase y «sin grip» ya no son perfiles: se eligen en Ajustes › Apertura. Este perfil se
                conserva como está.
              </small>
            ) : null}
          </label>
          {draft.gripType === 'gola' ? (
            <label className="catalog-form__field catalog-form__field--narrow">
              <span>Sección</span>
              <select
                value={draft.crossSection}
                onChange={(e) => setDraft((current) => ({ ...current, crossSection: e.target.value as OpeningCrossSectionDraft }))}
                data-testid="opening-profile-section-select"
              >
                {SECTION_LABELS.map((section) => (
                  <option key={section.value} value={section.value}>{section.label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <fieldset className="catalog-form__fieldset" data-testid="opening-profile-placements">
          <legend>Fronteras compatibles</legend>
          <div className="catalog-form__row">
            {(
              [
                ['top', 'Superior', 'top'],
                ['between', 'Intermedia', 'between'],
                ['bottom', 'Inferior', 'bottom'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="catalog-form__check">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.checked }))}
                  data-testid={`opening-profile-placement-${key}`}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="catalog-form__fieldset" data-testid="opening-profile-datasheet">
          <legend>Ficha técnica</legend>
          <label className="catalog-form__field">
            <span>Estado</span>
            <select
              value={draft.datasheetStatus}
              onChange={(e) => setDraft((current) => ({ ...current, datasheetStatus: e.target.value as 'pending' | 'verified' }))}
              data-testid="opening-profile-status-select"
            >
              <option value="pending">Pendiente de ficha</option>
              <option value="verified">Verificada</option>
            </select>
            <small className="catalog-form__hint">
              Verificada exige alto, profundidad, un descuento de puerta y el origen de los valores. Sin eso el perfil no
              se puede usar en SketchUp.
            </small>
          </label>
          {numberField('opening-profile-door-reduction', 'Descuento de puerta (mm)', draft.doorReductionMm,
            (value) => setDraft((current) => ({ ...current, doorReductionMm: value })),
            'Cuánto baja la puerta para crear el agarre (H − descuento). Gola metálico: 30 a 40 mm hasta confirmación SCILM. Vacío = usa el par de ficha (frontal + holgura).',
            'opening-profile-door-reduction')}
          <div className="catalog-form__row">
            {numberField('opening-profile-height', 'Alto del perfil (mm)', draft.profileHeightMm,
              (value) => setDraft((current) => ({ ...current, profileHeightMm: value })), 'Valor de la ficha del fabricante (8006: 56.5).',
              'opening-profile-height')}
            {numberField('opening-profile-depth', 'Profundidad del perfil (mm)', draft.profileDepthMm,
              (value) => setDraft((current) => ({ ...current, profileDepthMm: value })), 'Valor de la ficha del fabricante (8006: 27.2).',
              'opening-profile-depth')}
          </div>
          {verified ? (
            <label className="catalog-form__field">
              <span>Origen auditable</span>
              <input
                value={draft.geometryOrigin}
                onChange={(e) => setDraft((current) => ({ ...current, geometryOrigin: e.target.value }))}
                placeholder="Ficha del proveedor (archivo + página)"
                maxLength={200}
                data-testid="opening-profile-origin-input"
              />
            </label>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__fieldset" data-testid="opening-profile-modifiers">
          <legend>Efectos sobre el cuerpo</legend>

          <label className="catalog-form__check">
            <input
              type="checkbox"
              checked={draft.notchEnabled}
              onChange={(e) => setDraft((current) => ({ ...current, notchEnabled: e.target.checked }))}
              data-testid="opening-profile-notch-toggle"
            />
            <span>
              <strong>Muesca en costados</strong> — el paso por donde corre el perfil
            </span>
          </label>
          {draft.notchEnabled ? (
            <div className="catalog-form__row">
              {numberField('opening-profile-notch-height', 'Alto (mm)', draft.notchHeightMm,
                (value) => setDraft((current) => ({ ...current, notchHeightMm: value })), undefined,
                'opening-profile-notch-height')}
              {numberField('opening-profile-notch-depth', 'Profundidad (mm)', draft.notchDepthMm,
                (value) => setDraft((current) => ({ ...current, notchDepthMm: value })), undefined,
                'opening-profile-notch-depth')}
              <label className="catalog-form__field">
                <span>Posición</span>
                <select
                  value={draft.notchAt}
                  onChange={(e) => setDraft((current) => ({ ...current, notchAt: e.target.value as OpeningNotchAtDraft }))}
                  data-testid="opening-profile-notch-at"
                >
                  {NOTCH_AT_LABELS.map((at) => (
                    <option key={at.value} value={at.value}>{at.label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <label className="catalog-form__check">
            <input
              type="checkbox"
              checked={draft.depthReductionEnabled}
              onChange={(e) => setDraft((current) => ({ ...current, depthReductionEnabled: e.target.checked }))}
              data-testid="opening-profile-reduction-toggle"
            />
            <span>
              <strong>Descuento de profundidad</strong> — el panel horizontal deja libre la banda del perfil
            </span>
          </label>
          {draft.depthReductionEnabled ? (
            <>
              <div className="catalog-form__row" role="radiogroup" aria-label="Fuente del descuento">
                <label className="catalog-form__check">
                  <input
                    type="radio"
                    name="opening-profile-reduction-source"
                    checked={draft.depthReductionDerived}
                    onChange={() => setDraft((current) => ({ ...current, depthReductionDerived: true }))}
                    data-testid="opening-profile-reduction-derived"
                  />
                  <span>
                    Deriva de la ficha
                    {Number.isFinite(derivedPreview) && derivedPreview > 0
                      ? ` (${formatMmInput(derivedPreview)} mm)`
                      : ' (faltan los mm de la ficha)'}
                  </span>
                </label>
                <label className="catalog-form__check">
                  <input
                    type="radio"
                    name="opening-profile-reduction-source"
                    checked={!draft.depthReductionDerived}
                    onChange={() => setDraft((current) => ({ ...current, depthReductionDerived: false }))}
                    data-testid="opening-profile-reduction-explicit"
                  />
                  <span>Valor explícito (mm)</span>
                </label>
              </div>
              {!draft.depthReductionDerived
                ? numberField('opening-profile-reduction-mm', 'Descuento (mm)', draft.depthReductionMm,
                  (value) => setDraft((current) => ({ ...current, depthReductionMm: value })), undefined,
                  'opening-profile-reduction-mm')
                : null}
            </>
          ) : null}

          <label className="catalog-form__check">
            <input
              type="checkbox"
              checked={draft.bevelEnabled}
              onChange={(e) => setDraft((current) => ({ ...current, bevelEnabled: e.target.checked }))}
              data-testid="opening-profile-bevel-toggle"
            />
            <span>
              <strong>Bisel 45° en la puerta</strong> — el corte del agarre del gola italiano
            </span>
          </label>
          {draft.bevelEnabled ? (
            <div className="catalog-form__row">
              {numberField('opening-profile-bevel-size', 'Tamaño (mm)', draft.bevelSizeMm,
                (value) => setDraft((current) => ({ ...current, bevelSizeMm: value })), undefined,
                'opening-profile-bevel-size')}
              <label className="catalog-form__field">
                <span>Posición</span>
                <select
                  value={draft.bevelAt}
                  onChange={(e) => setDraft((current) => ({ ...current, bevelAt: e.target.value as OpeningBevelAtDraft }))}
                  data-testid="opening-profile-bevel-at"
                >
                  {BEVEL_AT_LABELS.map((at) => (
                    <option key={at.value} value={at.value}>{at.label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__fieldset" data-testid="opening-profile-members-editor">
          <legend>Elementos del perfil (herrajes o componentes)</legend>
          {draft.members.length === 0 ? (
            <p className="catalog-form__hint">
              Los elementos que la apertura agrega al mueble: un herraje del catálogo (perfil, soportes)
              o un componente panel (la tira del gola italiano, que viaja al despiece con el
              material de la puerta).
            </p>
          ) : null}
          {draft.members.map((member, index) => {
            const legacyKey = member.kind === 'hardware' && member.key !== '' && !isHardwareMemberRole(member.key);
            const refOptions = member.kind === 'component' ? componentOptions : hardwareOptions;
            const refLabel = member.kind === 'component' ? 'Componente' : 'Herraje';
            return (
              <div className="catalog-form__member" key={`member-${index}`} data-testid="opening-profile-member-row">
                <div className="catalog-form__row">
                  <label className="catalog-form__field">
                    <span>Tipo</span>
                    <select
                      value={member.kind}
                      onChange={(e) => {
                        const kind = e.target.value as OpeningProfileMemberDraft['kind'];
                        setMember(index, kind === 'component'
                          ? { kind, key: member.key === '' || isHardwareMemberRole(member.key) ? 'tira' : member.key }
                          : { kind, key: '', ...defaultsForHardwareRole('') });
                      }}
                      data-testid="opening-profile-member-kind"
                    >
                      <option value="hardware">Herraje</option>
                      <option value="component">Componente (panel)</option>
                    </select>
                  </label>
                  {member.kind === 'hardware' ? (
                    <label className="catalog-form__field">
                      <span>Rol</span>
                      <select
                        value={member.key}
                        onChange={(e) => setMember(index, { key: e.target.value, ...defaultsForHardwareRole(e.target.value) })}
                        data-testid="opening-profile-member-role"
                      >
                        <option value="">Elegir…</option>
                        {HARDWARE_MEMBER_ROLES.map((role) => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                        {legacyKey ? (
                          <option value={member.key}>{`${member.key} (clave anterior: el motor no la usa)`}</option>
                        ) : null}
                      </select>
                    </label>
                  ) : (
                    <label className="catalog-form__field catalog-form__field--narrow">
                      <span>Clave</span>
                      <input
                        value={member.key}
                        onChange={(e) => setMember(index, { key: e.target.value })}
                        placeholder="tira"
                        maxLength={32}
                        data-testid="opening-profile-member-key"
                      />
                    </label>
                  )}
                  <label className="catalog-form__field">
                    <span>Regla</span>
                    <select
                      value={member.rule}
                      onChange={(e) => setMember(index, { rule: e.target.value })}
                      data-testid="opening-profile-member-rule"
                    >
                      <option value="interior_width">Ancho interior</option>
                      <option value="per_length">Por largo (cada N mm)</option>
                      <option value="per_exposed_end">Por punta expuesta</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost btn--danger"
                    aria-label={`Quitar elemento ${index + 1}`}
                    onClick={() => setDraft((current) => ({ ...current, members: current.members.filter((_, i) => i !== index) }))}
                    data-testid="opening-profile-member-remove"
                  >
                    <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
                {legacyKey ? (
                  <p className="catalog-form__hint" role="note" data-testid="opening-profile-member-legacy">
                    La clave «{member.key}» no es un rol que el motor lea. Elige Perfil, Soportes o Tapas para que se coloque y entre a la lista de materiales.
                  </p>
                ) : null}
                <div className="catalog-form__row">
                  {refOptions ? (
                    <CatalogPicker
                      id={`opening-profile-member-ref-${index}`}
                      label={refLabel}
                      items={refOptions}
                      value={member.kind === 'component' ? member.componentId : member.hardwareId}
                      onChange={(id) => setMember(index, member.kind === 'component' ? { componentId: id } : { hardwareId: id })}
                      placeholder={member.kind === 'component' ? 'Buscar componente…' : 'Buscar herraje por nombre o código…'}
                      searchPlaceholder="Nombre o código"
                      className="catalog-form__field"
                      data-testid="opening-profile-member-picker"
                    />
                  ) : (
                    <label className="catalog-form__field">
                      <span>{member.kind === 'component' ? 'Componente (id)' : 'Herraje (id)'}</span>
                      <input
                        value={member.kind === 'component' ? member.componentId : member.hardwareId}
                        onChange={(e) =>
                          setMember(index, member.kind === 'component'
                            ? { componentId: e.target.value }
                            : { hardwareId: e.target.value })
                        }
                        maxLength={64}
                        data-testid="opening-profile-member-ref"
                      />
                    </label>
                  )}
                  {member.rule === 'per_length' ? (
                    <label className="catalog-form__field catalog-form__field--narrow">
                      <span>Cada (mm)</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={member.spacingMm}
                        onChange={(e) => setMember(index, { spacingMm: e.target.value })}
                        placeholder="600"
                        data-testid="opening-profile-member-spacing"
                      />
                    </label>
                  ) : null}
                </div>
                <fieldset className="catalog-form__fieldset catalog-form__fieldset--inline" data-testid="opening-profile-member-dims">
                  <legend>Medidas de la pieza (mm)</legend>
                  <div className="catalog-form__row">
                    {(['Largo', 'Profundo', 'Alto'] as const).map((axis, axisIndex) => (
                      <label key={axis} className="catalog-form__field catalog-form__field--narrow">
                        <span>{axis}</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={member.dims[axisIndex]}
                          onChange={(e) => {
                            const dims = [...member.dims] as [string, string, string];
                            dims[axisIndex] = e.target.value;
                            setMember(index, { dims });
                          }}
                          data-testid={`opening-profile-member-dim-${axisIndex}`}
                        />
                      </label>
                    ))}
                  </div>
                  <small className="catalog-form__hint">Sin medidas, la pieza no se dibuja en el mueble.</small>
                </fieldset>
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setDraft((current) => ({ ...current, members: [...current.members, emptyMemberDraft()] }))}
            data-testid="opening-profile-member-add"
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Agregar elemento
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
