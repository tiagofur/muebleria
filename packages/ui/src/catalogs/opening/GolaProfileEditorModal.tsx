/**
 * Catálogo › Perfiles de gola — editor v2 (#1534, ADR-0009 A2.1/§14.2/§14.6).
 * Replaces the #1526 modal: material/posiciones/descuento por posición con
 * sugerencia del fabricante, vista previa resuelta POR EL SERVIDOR
 * (previewOpeningProfile — React nunca calcula), dibujo esquemático de la
 * sección, efectos sobre el cuerpo en texto llano y piezas por rol
 * (#1526 selectors). Escribe SIEMPRE v2-shaped (material + posiciones +
 * descuentos; el bridge #1530 mantiene los campos coherentes).
 */

 import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Modal } from '../../common';
import { CatalogPicker, type CatalogPickerOption } from '../CatalogPicker';
import type { GraneteApiClient } from '@granete/storage';
import {
  formatMmInput,
  type OpeningProfileDraft,
  type OpeningProfileMemberDraft,
} from './openingProfileDraft';

/** The three workshop-facing materials (#1530): the chips. */
const MATERIAL_CHIPS: readonly {
  readonly value: NonNullable<OpeningProfileDraft['material']>;
  readonly label: string;
  readonly crossSection: 'L' | 'C' | 'flat';
  readonly testId: string;
}[] = [
  { value: 'aluminum', label: 'Aluminio — L', crossSection: 'L', testId: 'gola-material-l' },
  { value: 'aluminum', label: 'Aluminio — C', crossSection: 'C', testId: 'gola-material-c' },
  { value: 'melamine', label: 'Italiana (melamina)', crossSection: 'flat', testId: 'gola-material-italiana' },
];

/** Manufacturer/owner suggestion shown beside each discount (#1524/#1530). */
const SUGGESTIONS: Readonly<Record<string, number>> = {
  top: 40,
  between: 36,
};

const SECTION_LABEL: Readonly<Record<string, string>> = {
  L: 'L',
  C: 'C',
  flat: 'tira',
};

export interface GolaProfileEditorModalProps {
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
  readonly api: GraneteApiClient;
  readonly token: string | null;
  /** #1526 — the org's hardware, searchable by name or code. Null = not loaded. */
  readonly hardwareOptions?: readonly CatalogPickerOption[] | null;
  /** #1526 — the org's catalog components (panels). Null = not loaded. */
  readonly componentOptions?: readonly CatalogPickerOption[] | null;
}

/** The schematic section: declarative SVG from the DECLARED fields — a
 * drawing of the values, never a formula computation. */
export function GolaSectionDrawing({
  material,
  crossSection,
  heightMm,
  depthMm,
}: {
  readonly material: OpeningProfileDraft['material'];
  readonly crossSection: string;
  readonly heightMm: number;
  readonly depthMm: number;
}): ReactNode {
  const h = Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 60;
  const d = Number.isFinite(depthMm) && depthMm > 0 ? depthMm : 30;
  // Scale: 1 mm = 0.6px, box 140×90 with margins.
  const s = 0.6;
  const label = `Sección ${SECTION_LABEL[crossSection] ?? ''}: alto ${heightMm || '—'} × profundidad ${depthMm || '—'} mm`.trim();
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="gola-section-drawing"
      width={150}
      height={100}
      viewBox="0 0 150 100"
      style={{ border: '1px solid var(--border)', borderRadius: 6 }}
    >
      <g transform="translate(30, 12)">
        {material === 'melamine' ? (
          <>
            {/* Italian strip: full-depth vertical board with the 45° bevel
                hinted at the front edge. */}
            <rect x={0} y={0} width={d * s} height={h * s} fill="none" stroke="currentColor" strokeWidth={1.5} />
            <line x1={0} y1={0} x2={d * s * 0.45} y2={0} stroke="currentColor" strokeWidth={2.5} />
            <text x={d * s + 6} y={h * s / 2} fontSize={9} fill="currentColor">{`alto ${heightMm || '—'}`}</text>
            <text x={d * s / 2 - 14} y={h * s + 14} fontSize={9} fill="currentColor">{`prof. ${depthMm || '—'}`}</text>
          </>
        ) : crossSection === 'C' ? (
          <>
            {/* C channel: three strokes. */}
            <path
              d={`M ${d * s} 0 L 0 0 L 0 ${h * s} L ${d * s} ${h * s}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            <text x={d * s + 6} y={h * s / 2} fontSize={9} fill="currentColor">{`alto ${heightMm || '—'}`}</text>
            <text x={d * s / 2 - 14} y={h * s + 14} fontSize={9} fill="currentColor">{`prof. ${depthMm || '—'}`}</text>
          </>
        ) : (
          <>
            {/* L profile: vertical + horizontal strokes from the top-front
                corner. */}
            <path
              d={`M ${d * s} 0 L 0 0 L 0 ${h * s}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            <text x={d * s + 6} y={h * s / 2} fontSize={9} fill="currentColor">{`alto ${heightMm || '—'}`}</text>
            <text x={4} y={h * s + 14} fontSize={9} fill="currentColor">{`prof. ${depthMm || '—'}`}</text>
          </>
        )}
      </g>
    </svg>
  );
}

export function GolaProfileEditorModal({
  identity,
  open,
  editingId,
  formId,
  draft,
  setDraft,
  error,
  canMutate,
  saving = false,
  onSubmit,
  onClose,
  api,
  token,
  hardwareOptions = null,
  componentOptions = null,
}: GolaProfileEditorModalProps): ReactNode {
  const material = draft.material;
  const isItalian = material === 'melamine';
  const [previewLines, setPreviewLines] = useState<readonly { readonly key: string; readonly preview: string }[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refreshPreview = useCallback(async () => {
    if (!token) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await api.previewOpeningProfile(token, {
        heightMm: 720,
        positions: [...(draft.top ? ['top' as const] : []), ...(draft.between ? ['between' as const] : [])],
        frontDiscountTopMm: draft.frontDiscountTopMm !== '' ? Number(draft.frontDiscountTopMm) : undefined,
        frontDiscountBetweenMm: draft.frontDiscountBetweenMm !== '' ? Number(draft.frontDiscountBetweenMm) : undefined,
      });
      const previews = (response.previews ?? []) as readonly { readonly key: string; readonly preview: string }[];
      setPreviewLines(previews);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'La vista previa no pudo resolverse.');
    } finally {
      setPreviewLoading(false);
    }
    // The preview re-resolves on open and on DISCRETE changes (position
    // switches or discounts) — identity/origin typing never triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token, open, draft.top, draft.between, draft.frontDiscountTopMm, draft.frontDiscountBetweenMm, draft.profileHeightMm]);

  useEffect(() => {
    if (!open) return;
    void refreshPreview();
  }, [refreshPreview]);

  const set = (patch: Partial<OpeningProfileDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const setRow = (patch: Partial<OpeningProfileDraft>) => set(patch);

  const chooseMaterial = (chip: (typeof MATERIAL_CHIPS)[number]) => {
    const depth = Number(draft.profileDepthMm);
    const italianDefaults = chip.value === 'melamine'
      ? {
          // The Italian preset (#1524): both positions + the body effects
          // pre-filled with the workshop defaults, ALL editable.
          top: true,
          between: true,
          frontDiscountTopMm: draft.frontDiscountTopMm !== '' ? draft.frontDiscountTopMm : '36',
          frontDiscountBetweenMm: draft.frontDiscountBetweenMm !== '' ? draft.frontDiscountBetweenMm : '36',
          depthReductionEnabled: true,
          depthReductionDerived: true,
          notchEnabled: true,
          notchHeightMm: draft.notchHeightMm !== '' ? draft.notchHeightMm : '70',
          notchDepthSource: 'strip_thickness' as const,
          notchClearanceMm: draft.notchClearanceMm !== '' ? draft.notchClearanceMm : '1',
          bevelEnabled: true,
          bevelAt: 'top_front' as const,
          bevelSizeMm:
            draft.bevelSizeMm !== ''
              ? draft.bevelSizeMm
              : Number.isFinite(depth) && depth > 2
                ? formatMmInput(depth - 2)
                : '',
        }
      : {};
    setDraft((current) => ({
      ...current,
      material: chip.value,
      crossSection: chip.crossSection,
      gripType: 'gola',
      ...italianDefaults,
    }));
  };

  const togglePosition = (position: 'top' | 'between', checked: boolean) =>
    setDraft((current) => ({ ...current, [position]: checked }));

  const discountRow = (
    position: 'top' | 'between',
    label: string,
    value: string,
  ): ReactNode => {
    const suggestion = SUGGESTIONS[position];
    const testId = position === 'top' ? 'gola-discount-top' : 'gola-discount-between';
    return (
      <div>
        <label className="catalog-form__field">
          <span>Descuento del frente — {label}</span>
          <input
            type="number"
            min="0"
            step="any"
            value={value}
            data-testid={testId}
            onChange={(e) => setRow({ [position === 'top' ? 'frontDiscountTopMm' : 'frontDiscountBetweenMm']: e.target.value } as Partial<OpeningProfileDraft>)}
          />
        </label>
        <button
          type="button"
          className="btn btn--small"
          data-testid={`gola-discount-suggest-${position}`}
          onClick={() =>
            setRow(
              position === 'top'
                ? { frontDiscountTopMm: String(suggestion) }
                : { frontDiscountBetweenMm: String(suggestion) },
            )
          }
        >
          sugerencia: {suggestion}
        </button>
      </div>
    );
  };

  // Strip member: present iff material is melamine.
  const ensureStrip = () => {
    const strip = draft.members.find((m) => m.key === 'strip');
    if (strip) return;
    setDraft((current) => ({
      ...current,
      members: [
        ...current.members,
        {
          key: 'strip',
          kind: 'component' as const,
          hardwareId: '',
          componentId: '',
          rule: 'interior_width',
          unit: 'piece',
          spacingMm: '',
          dims: ['', '', ''] as [string, string, string],
          heightMm: '70',
        },
      ],
    }));
  };
  const dropStrip = () =>
    setDraft((current) => ({ ...current, members: current.members.filter((m) => m.key !== 'strip') }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={identity ? `Editar perfil: ${identity.code} — ${identity.name}` : 'Nuevo perfil de gola'}
      size="lg"
      dataTestId="gola-profile-editor"
    >
      <form id={formId} onSubmit={onSubmit}>
        {error ? (
          <p role="alert" data-testid="gola-profile-error" className="catalog-form__hint" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Identidad</legend>
          <label className="catalog-form__field">
            <span>Código</span>
            <input
              value={draft.code}
              maxLength={80}
              required
              data-testid="gola-profile-code"
              onChange={(e) => set({ code: e.target.value })}
            />
          </label>
          <label className="catalog-form__field">
            <span>Nombre</span>
            <input
              value={draft.name}
              maxLength={120}
              required
              data-testid="gola-profile-name"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="catalog-form__field">
            <span>Fabricante</span>
            <input
              value={draft.manufacturer}
              maxLength={80}
              data-testid="gola-profile-manufacturer"
              onChange={(e) => set({ manufacturer: e.target.value })}
            />
          </label>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Material</legend>
          <div role="radiogroup" aria-label="Material del perfil" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MATERIAL_CHIPS.map((chip) => {
              const selected =
                material === chip.value &&
                (chip.value !== 'aluminum' || draft.crossSection === chip.crossSection);
              return (
                <label
                  key={chip.label}
                  style={{
                    border: selected ? '2px solid var(--border)' : '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <input
                    type="radio"
                    name="gola-material"
                    role="radio"
                    checked={selected}
                    disabled={saving}
                    data-testid={chip.testId}
                    onChange={() => chooseMaterial(chip)}
                  />
                  {chip.label}
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                role="switch"
                checked={draft.top}
                disabled={saving}
                data-testid="gola-position-top"
                onChange={(e) => togglePosition('top', e.target.checked)}
              />
              Superior
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                role="switch"
                checked={draft.between}
                disabled={saving}
                data-testid="gola-position-between"
                onChange={(e) => togglePosition('between', e.target.checked)}
              />
              Entre frentes
            </label>
          </div>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Dimensiones</legend>
          <label className="catalog-form__field">
            <span>Alto del perfil (mm)</span>
            <input
              type="number"
              min="0"
              step="any"
              value={draft.profileHeightMm}
              data-testid="gola-profile-height"
              onChange={(e) => set({ profileHeightMm: e.target.value })}
            />
          </label>
          <label className="catalog-form__field">
            <span>Profundidad (mm)</span>
            <input
              type="number"
              min="0"
              step="any"
              value={draft.profileDepthMm}
              data-testid="gola-profile-depth"
              onChange={(e) => set({ profileDepthMm: e.target.value })}
            />
          </label>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Descuento del frente</legend>
          {draft.top ? discountRow('top', 'Superior', draft.frontDiscountTopMm) : null}
          {draft.between ? discountRow('between', 'Entre frentes', draft.frontDiscountBetweenMm) : null}
          {!draft.top && !draft.between ? (
            <p className="catalog-form__hint">Marcá al menos una posición para declarar el descuento.</p>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Vista previa y sección</legend>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <GolaSectionDrawing
              material={material}
              crossSection={draft.crossSection}
              heightMm={Number(draft.profileHeightMm)}
              depthMm={Number(draft.profileDepthMm)}
            />
            <div data-testid="gola-profile-preview" style={{ flex: 1, minWidth: 220 }}>
              {previewLoading ? (
                <p className="catalog-form__hint" aria-busy="true">Resolviendo vista previa…</p>
              ) : (
                (previewLines ?? []).map((line) => (
                  <p key={line.key} data-testid={`gola-profile-preview-${line.key}`}>
                    {line.preview}
                  </p>
                ))
              )}
              {previewError ? <p role="alert" style={{ color: 'var(--danger)' }}>{previewError}</p> : null}
              <button
                type="button"
                className="btn btn--small"
                data-testid="gola-profile-preview-refresh"
                disabled={saving || previewLoading}
                onClick={() => void refreshPreview()}
              >
                Actualizar vista previa
              </button>
            </div>
          </div>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Efectos sobre el cuerpo</legend>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={draft.depthReductionEnabled}
              disabled={saving}
              data-testid="gola-effect-depth"
              onChange={(e) => set({ depthReductionEnabled: e.target.checked, depthReductionDerived: true })}
            />
            Acortar el techo o mover el manguete frontal (usa la profundidad)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={draft.notchEnabled}
              disabled={saving}
              data-testid="gola-effect-notch"
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) {
                  // Melamine (tira italiana): the depth FOLLOWS the strip
                  // thickness + clearance. Aluminum: explicit depth.
                  const italian = material === 'melamine';
                  set({
                    notchEnabled: true,
                    notchHeightMm: draft.notchHeightMm !== '' ? draft.notchHeightMm : italian ? '70' : '',
                    notchDepthSource: italian ? 'strip_thickness' : '',
                    notchClearanceMm: italian && draft.notchClearanceMm !== '' ? draft.notchClearanceMm : '1',
                  });
                } else {
                  set({ notchEnabled: false, notchDepthSource: '' });
                }
              }}
            />
            Muesca en costados
          </label>
          {draft.notchEnabled ? (
            <div style={{ margin: '0 0 8px 24px' }}>
              <label className="catalog-form__field">
                <span>Alto de la muesca (mm)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.notchHeightMm}
                  data-testid="gola-notch-height"
                  onChange={(e) => set({ notchHeightMm: e.target.value })}
                />
              </label>
              {draft.notchDepthSource === 'strip_thickness' ? (
                <label className="catalog-form__field">
                  <span>Holgura de la muesca (mm)</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={draft.notchClearanceMm}
                    data-testid="gola-notch-clearance"
                    onChange={(e) => set({ notchClearanceMm: e.target.value })}
                  />
                </label>
              ) : (
                <label className="catalog-form__field">
                  <span>Profundidad de la muesca (mm)</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={draft.notchDepthMm}
                    data-testid="gola-notch-depth"
                    onChange={(e) => set({ notchDepthMm: e.target.value })}
                  />
                </label>
              )}
            </div>
          ) : null}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={draft.bevelEnabled}
              disabled={saving}
              data-testid="gola-effect-bevel"
              onChange={(e) => {
                const checked = e.target.checked;
                const depth = Number(draft.profileDepthMm);
                if (checked) {
                  set({
                    bevelEnabled: true,
                    bevelAt: 'top_front',
                    bevelSizeMm:
                      draft.bevelSizeMm !== ''
                        ? draft.bevelSizeMm
                        : Number.isFinite(depth) && depth > 2
                          ? formatMmInput(depth - 2)
                          : '',
                  });
                } else {
                  set({ bevelEnabled: false });
                }
              }}
            />
            Bisel 45° en la puerta (mm)
          </label>
          {draft.bevelEnabled ? (
            <label className="catalog-form__field" style={{ margin: '0 0 8px 24px' }}>
              <span>Tamaño del bisel (mm)</span>
              <input
                type="number"
                min="0"
                step="any"
                value={draft.bevelSizeMm}
                data-testid="gola-bevel-size"
                onChange={(e) => set({ bevelSizeMm: e.target.value })}
              />
            </label>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Piezas</legend>
          <CatalogPicker
            label="Perfil"
            data-testid="gola-part-profile"
            items={hardwareOptions ?? []}
            value={draft.members.find((m) => m.key === 'profile')?.hardwareId ?? ''}
            onChange={(id) =>
              setDraft((current) => ({
                ...current,
                members: upsertMember(current.members, 'profile', 'hardware', id, (m: OpeningProfileMemberDraft) => ({
                  ...m,
                  rule: 'interior_width',
                  unit: 'meter',
                })),
              }))
            }
          />
          <CatalogPicker
            label="Soportes"
            data-testid="gola-part-supports"
            items={hardwareOptions ?? []}
            value={draft.members.find((m) => m.key === 'supports')?.hardwareId ?? ''}
            onChange={(id) =>
              setDraft((current) => ({
                ...current,
                members: upsertMember(current.members, 'supports', 'hardware', id, (m: OpeningProfileMemberDraft) => ({
                  ...m,
                  rule: 'per_length',
                  unit: 'piece',
                })),
              }))
            }
          />
          {draft.members.find((m) => m.key === 'supports')?.hardwareId ? (
            <label className="catalog-form__field">
              <span>Soportes cada (mm)</span>
              <input
                type="number"
                min="0"
                step="any"
                value={draft.members.find((m) => m.key === 'supports')?.spacingMm ?? ''}
                data-testid="gola-part-supports-spacing"
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    members: current.members.map((m) => (m.key === 'supports' ? { ...m, spacingMm: e.target.value } : m)),
                  }))
                }
              />
            </label>
          ) : null}
          <CatalogPicker
            label="Tapas"
            data-testid="gola-part-endcaps"
            items={hardwareOptions ?? []}
            value={draft.members.find((m) => m.key === 'endCaps')?.hardwareId ?? ''}
            onChange={(id) =>
              setDraft((current) => ({
                ...current,
                members: upsertMember(current.members, 'endCaps', 'hardware', id, (m: OpeningProfileMemberDraft) => ({
                  ...m,
                  rule: 'per_exposed_end',
                  unit: 'piece',
                })),
              }))
            }
          />
          {isItalian ? (
            <>
              <CatalogPicker
                label="Tira (componente)"
                data-testid="gola-part-strip"
                items={componentOptions ?? []}
                value={draft.members.find((m) => m.key === 'strip')?.componentId ?? ''}
                onChange={(id) => {
                  ensureStrip();
                  setDraft((current) => ({
                    ...current,
                    members: current.members.map((m) => (m.key === 'strip' ? { ...m, kind: 'component', componentId: id } : m)),
                  }));
                }}
              />
              <label className="catalog-form__field">
                <span>Alto de la tira (mm)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={draft.members.find((m) => m.key === 'strip')?.heightMm ?? '70'}
                  data-testid="gola-part-strip-height"
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      members: current.members.map((m) => (m.key === 'strip' ? { ...m, heightMm: e.target.value } : m)),
                    }))
                  }
                />
              </label>
            </>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Origen</legend>
          <label className="catalog-form__field">
            <span>Origen de los valores (opcional)</span>
            <input
              value={draft.geometryOrigin}
              maxLength={200}
              data-testid="gola-profile-origin"
              onChange={(e) => set({ geometryOrigin: e.target.value })}
            />
          </label>
        </fieldset>

        <div className="catalog-form__actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving} data-testid="gola-profile-cancel">
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving} data-testid="gola-profile-save">
            {saving ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function upsertMember(
  members: readonly OpeningProfileMemberDraft[],
  key: string,
  kind: 'hardware' | 'component',
  id: string,
  patch: (base: OpeningProfileMemberDraft) => Partial<OpeningProfileMemberDraft>,
): readonly OpeningProfileMemberDraft[] {
  const existing = members.find((m) => m.key === key);
  if (existing) {
    return members.map((m) =>
      m.key === key
        ? { ...m, kind, ...(kind === 'hardware' ? { hardwareId: id } : { componentId: id }), ...patch(m) }
        : m,
    );
  }
  return [
    ...members,
    {
      key,
      kind,
      hardwareId: kind === 'hardware' ? id : '',
      componentId: kind === 'component' ? id : '',
      rule: 'interior_width',
      unit: 'piece',
      spacingMm: '',
      dims: ['', '', ''] as [string, string, string],
      heightMm: '',
      ...patch({ key, kind } as OpeningProfileMemberDraft),
    },
  ];
}
