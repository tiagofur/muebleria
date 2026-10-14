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
import { Modal } from '../../common';
import type {
  OpeningCrossSectionDraft,
  OpeningGripTypeDraft,
  OpeningNotchAtDraft,
  OpeningProfileDraft,
} from './openingProfileDraft';

const GRIP_LABELS: readonly { readonly value: OpeningGripTypeDraft; readonly label: string }[] = [
  { value: 'gola', label: 'Gola (perfil integrado)' },
  { value: 'handle', label: 'Jaladera (tirador)' },
  { value: 'bottom_reveal', label: 'Rebase inferior' },
  { value: 'none', label: 'Sin grip' },
];

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
}: OpeningProfileFormModalProps): ReactNode {
  const verified = draft.datasheetStatus === 'verified';
  const derivedPreview = Number(draft.profileDepthMm);

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
        {error ? <p className="catalog-form__error">{error}</p> : null}

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

        <div className="catalog-form__row">
          <label className="catalog-form__field">
            <span>Tipo de agarre</span>
            <select
              value={draft.gripType}
              onChange={(e) => setDraft((current) => ({ ...current, gripType: e.target.value as OpeningGripTypeDraft }))}
              data-testid="opening-profile-grip-select"
            >
              {GRIP_LABELS.map((grip) => (
                <option key={grip.value} value={grip.value}>{grip.label}</option>
              ))}
            </select>
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
              <label key={key} className="settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              Verificada exige las cuatro medidas y su origen auditable; sin eso el perfil no participa en authoring.
            </small>
          </label>
          <div className="catalog-form__row">
            {numberField('opening-profile-front-reduction', 'Descuento frontal (mm)', draft.frontReductionMm,
              (value) => setDraft((current) => ({ ...current, frontReductionMm: value })), undefined,
              'opening-profile-front-reduction')}
            {numberField('opening-profile-clearance', 'Holgura de agarre (mm)', draft.gripClearanceMm,
              (value) => setDraft((current) => ({ ...current, gripClearanceMm: value })), undefined,
              'opening-profile-clearance')}
          </div>
          <div className="catalog-form__row">
            {numberField('opening-profile-height', 'Alto del perfil (mm)', draft.profileHeightMm,
              (value) => setDraft((current) => ({ ...current, profileHeightMm: value })), 'Decimal de ficha (8006: 56.5).',
              'opening-profile-height')}
            {numberField('opening-profile-depth', 'Profundidad del perfil (mm)', draft.profileDepthMm,
              (value) => setDraft((current) => ({ ...current, profileDepthMm: value })), 'Decimal de ficha (8006: 27.2).',
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

          <label className="settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

          <label className="settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
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
                <label className="settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                      ? ` (${Number(draft.profileDepthMm)} mm)`
                      : ' (faltan los mm de la ficha)'}
                  </span>
                </label>
                <label className="settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        </fieldset>

        <p className="catalog-form__hint" data-testid="opening-profile-bom-note">
          Los herrajes del perfil (perfil, soportes, tapas) viajan como referencias del catálogo y se
          gestionan con el equipo Granete: quedan intactos al editar la ficha.
        </p>
      </form>
    </Modal>
  );
}
