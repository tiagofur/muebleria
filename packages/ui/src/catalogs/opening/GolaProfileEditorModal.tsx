/**
 * Catálogo › Perfiles de gola — editor v2 (#1534, ADR-0009 A2.1/§14.2/§14.6).
 * Replaces the #1526 modal: material/posiciones/descuento por posición con
 * la sugerencia del SERVIDOR (GET /catalog/opening-profiles/suggestions —
 * React nunca inventa los valores de fábrica), vista previa resuelta POR EL
 * SERVIDOR (previewOpeningProfile), dibujo esquemático de la sección,
 * efectos sobre el cuerpo en texto llano y piezas por rol (#1526 selectors).
 * Escribe SIEMPRE v2-shaped (material + posiciones + descuentos; el bridge
 * #1530 mantiene los campos coherentes).
 */

import {
  useCallback,
  useEffect,
  useRef,
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
  datasheetPendingReasons,
  datasheetStatusOfDraft,
  emptyMemberDraft,
  formatMmInput,
  isKnownMemberRole,
  STRIP_MEMBER_ROLE,
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

const SECTION_LABEL: Readonly<Record<string, string>> = {
  L: 'L',
  C: 'C',
  flat: 'tira',
};

/** Wire shape of one server suggestion (#1530): a starting point per
 * material, in the profile-write vocabulary. React never hardcodes the
 * manufacturer numbers — the server is their only source. */
interface GolaProfileSuggestionWire {
  readonly key: string;
  readonly label: string;
  readonly source: string;
  readonly manufacturer?: string;
  readonly material: string;
  readonly cross_section_shape: string;
  readonly positions: readonly string[];
  readonly front_discount_top_mm?: number | null;
  readonly front_discount_between_mm?: number | null;
  readonly body_modifiers: readonly {
    readonly role: string;
    readonly effect?: string;
    readonly depth_reduction_mm?: number | null;
    readonly notch_height_mm?: number | null;
    readonly notch_depth_source?: string | null;
    readonly notch_clearance_mm?: number | null;
    readonly bevel_angle_deg?: number | null;
    readonly bevel_size_mm?: number | null;
    readonly bevel_at?: string | null;
  }[];
  readonly bom_members: Readonly<Record<string, { readonly height_mm?: number | null }>>;
}

function suggestionForChip(
  suggestions: readonly GolaProfileSuggestionWire[],
  chip: (typeof MATERIAL_CHIPS)[number],
): GolaProfileSuggestionWire | null {
  return (
    suggestions.find(
      (s) => s.material === chip.value && s.cross_section_shape === chip.crossSection,
    ) ?? null
  );
}

/** The schematic section: declarative SVG from the DECLARED fields — a
 * drawing of the values, never a formula computation. */
export function GolaSectionDrawing({
  material,
  crossSection,
  heightMm,
  depthMm,
  topDiscountMm,
}: {
  readonly material: OpeningProfileDraft['material'];
  readonly crossSection: string;
  readonly heightMm: number;
  readonly depthMm: number;
  /** Declared top discount — drawn as the door annotation, never computed. */
  readonly topDiscountMm: string;
}): ReactNode {
  const h = Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 60;
  const d = Number.isFinite(depthMm) && depthMm > 0 ? depthMm : 30;
  // Scale: 1 mm = 0.6px, box 150×100 with margins.
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
      className="gola-editor__drawing"
    >
      <g transform="translate(30, 12)">
        {material === 'melamine' ? (
          <>
            {/* Italian strip: full-depth vertical board with the 45° bevel
                hinted at the front edge. */}
            <rect x={0} y={0} width={d * s} height={h * s} fill="none" stroke="currentColor" strokeWidth={1.5} />
            <line x1={0} y1={0} x2={d * s * 0.45} y2={0} stroke="currentColor" strokeWidth={2.5} />
            <text className="gola-editor__drawing-label" x={d * s + 6} y={h * s / 2} fill="currentColor">{`alto ${heightMm || '—'}`}</text>
            <text className="gola-editor__drawing-label" x={d * s / 2 - 14} y={h * s + 14} fill="currentColor">{`prof. ${depthMm || '—'}`}</text>
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
            <text className="gola-editor__drawing-label" x={d * s + 6} y={h * s / 2} fill="currentColor">{`alto ${heightMm || '—'}`}</text>
            <text className="gola-editor__drawing-label" x={d * s / 2 - 14} y={h * s + 14} fill="currentColor">{`prof. ${depthMm || '—'}`}</text>
          </>
        ) : (
          <>
            {/* L profile: vertical + horizontal strokes from the top-front
                corner; the declared discount rides as the door annotation
                (H − descuento), a labeled fact — never a computed cut. */}
            <path
              d={`M ${d * s} 0 L 0 0 L 0 ${h * s}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            <text className="gola-editor__drawing-label" x={d * s + 6} y={h * s / 2} fill="currentColor">{`alto ${heightMm || '—'}`}</text>
            <text className="gola-editor__drawing-label" x={4} y={h * s + 14} fill="currentColor">{`prof. ${depthMm || '—'}`}</text>
          </>
        )}
        {topDiscountMm !== '' ? (
          <text
            className="gola-editor__drawing-label"
            data-testid="gola-drawing-discount"
            x={0}
            y={-4}
            fill="currentColor"
          >
            {`puerta H − ${topDiscountMm}`}
          </text>
        ) : null}
      </g>
    </svg>
  );
}

/** Where a save error anchors: the section the workshop fixes, per the brief
 * («el mensaje exacto de la API junto al campo que falla»). */
function sectionForMessage(message: string): string | null {
  const lowered = message.toLowerCase();
  if (lowered.includes('muesca') || lowered.includes('bisel')) return 'efectos';
  if (lowered.includes('herraje') || lowered.includes('componente') || lowered.includes('tira') ||
      lowered.includes('soportes') || lowered.includes('rol') || lowered.includes('spacing')) return 'piezas';
  if (lowered.includes('descuento')) return 'descuento';
  if (lowered.includes('material') || lowered.includes('italiana') || lowered.includes('melamina') ||
      lowered.includes('aluminio') || lowered.includes('posición')) return 'material';
  if (lowered.includes('alto') || lowered.includes('profundidad')) return 'dimensiones';
  if (lowered.includes('origen')) return 'origen';
  if (lowered.includes('código') || lowered.includes('nombre')) return 'identidad';
  return null;
}

export interface GolaProfileEditorModalProps {
  readonly identity?: { readonly code: string; readonly name: string };
  readonly open: boolean;
  readonly editingId: string | null;
  readonly formId: string;
  readonly draft: OpeningProfileDraft;
  readonly setDraft: Dispatch<SetStateAction<OpeningProfileDraft>>;
  readonly error: string | null;
  /** #1534 r1 — the SAVED profile's per-position use rule served by the
   * API: the editor shows the server truth next to the discount fields
   * (disponible ≠ válido), the same strings the list's Uso column carries. */
  readonly savedUsage?: Readonly<Record<string, { readonly usable?: boolean; readonly message?: string | null }>> | null;
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

export function GolaProfileEditorModal({
  identity,
  open,
  editingId,
  formId,
  draft,
  setDraft,
  error,
  savedUsage = null,
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
  const previewEpoch = useRef(0);
  // Server suggestions (#1530): the manufacturer/owner defaults. Null until
  // the first fetch lands; the editor applies them fill-only-empty.
  const [suggestions, setSuggestions] = useState<readonly GolaProfileSuggestionWire[] | null>(null);
  const suggestionsEpoch = useRef(0);
  // True while the bevel size holds (or awaits) the server-derived value —
  // a depth change may refresh it; a manual edit flips it off forever.
  const bevelDerived = useRef(false);
  // The chip the user chose last: a late suggestions fetch may only apply
  // its preset while its chip is STILL the user's choice (r2: a stale
  // response must never revert the form to an older chip).
  const lastChip = useRef<string | null>(null);
  const depthDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh editor session: the editor stays mounted across opens, so the
  // previous session's derived-bevel marker and chip choice must not leak
  // into this one (a hand-typed size is never silently rewritten).
  useEffect(() => {
    if (!open) return;
    bevelDerived.current = false;
    lastChip.current = null;
  }, [open]);

  const refreshPreview = useCallback(async () => {
    if (!token) return;
    const epoch = ++previewEpoch.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await api.previewOpeningProfile(token, {
        heightMm: 720,
        positions: [...(draft.top ? ['top' as const] : []), ...(draft.between ? ['between' as const] : [])],
        frontDiscountTopMm: draft.frontDiscountTopMm !== '' ? Number(draft.frontDiscountTopMm) : null,
        frontDiscountBetweenMm: draft.frontDiscountBetweenMm !== '' ? Number(draft.frontDiscountBetweenMm) : null,
      });
      if (epoch !== previewEpoch.current) return; // a newer request won
      setPreviewLines((response.previews ?? []) as readonly { readonly key: string; readonly preview: string }[]);
    } catch (err) {
      if (epoch !== previewEpoch.current) return;
      setPreviewError(err instanceof Error ? err.message : 'La vista previa no pudo resolverse.');
    } finally {
      if (epoch === previewEpoch.current) setPreviewLoading(false);
    }
    // The preview re-resolves on open and on DISCRETE changes (position
    // switches or discounts) — identity/origin typing never triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token, open, draft.top, draft.between, draft.frontDiscountTopMm, draft.frontDiscountBetweenMm]);

  useEffect(() => {
    if (!open) return;
    void refreshPreview();
  }, [refreshPreview]);

  const fetchSuggestions = useCallback(
    async (depthMm: number | null): Promise<readonly GolaProfileSuggestionWire[] | null> => {
      if (!token) return null;
      const epoch = ++suggestionsEpoch.current;
      const query = depthMm != null && Number.isFinite(depthMm) && depthMm > 0
        ? `?profile_depth_mm=${depthMm}`
        : '';
      try {
        const list = await api.request<readonly GolaProfileSuggestionWire[]>(
          'GET', `/catalog/opening-profiles/suggestions${query}`, { token, arrayOf: 'GolaProfileSuggestion' },
        );
        if (epoch !== suggestionsEpoch.current) return null;
        setSuggestions(list); // any landed list serves the «sugerencia» buttons
        return list;
      } catch {
        // Suggestions are a convenience, never a gate: a failed fetch leaves
        // the fields empty and the workshop types its values.
        return null;
      }
    },
    [api, token],
  );

  useEffect(() => {
    if (!open || suggestions !== null) return;
    void fetchSuggestions(null).then((list) => { if (list) setSuggestions(list); });
  }, [open, suggestions, fetchSuggestions]);

  useEffect(() => () => {
    if (depthDebounce.current) clearTimeout(depthDebounce.current);
  }, []);

  const set = (patch: Partial<OpeningProfileDraft>) => setDraft((current) => ({ ...current, ...patch }));

  /** Applies one server preset to the draft: positions follow the preset
   * (the chip IS the preset choice); values fill ONLY empty fields — typed
   * numbers are never overwritten. Switching away from the italiana drops
   * the strip and the strip-following notch state (nothing unsavable stays
   * behind). */
  const applyPreset = (chip: (typeof MATERIAL_CHIPS)[number], suggestion: GolaProfileSuggestionWire | null) => {
    setDraft((current) => {
      const body = suggestion?.body_modifiers ?? [];
      const notch = body.find((m) => m.notch_height_mm != null || m.notch_depth_source != null) ?? null;
      const reduction = body.find((m) => m.effect === 'depth_reduction' || m.depth_reduction_mm !== undefined) ?? null;
      const bevel = body.find((m) => m.bevel_angle_deg != null || m.bevel_size_mm !== undefined || m.bevel_at != null) ?? null;
      const stripPreset = suggestion?.bom_members?.[STRIP_MEMBER_ROLE];
      const wantsStrip = stripPreset != null && suggestion?.material === 'melamine';

      // Strip: preset-owned presence — dropped when the preset has none.
      let members = current.members;
      if (!wantsStrip) {
        members = members.filter((m) => m.key !== STRIP_MEMBER_ROLE);
      } else if (!members.some((m) => m.key === STRIP_MEMBER_ROLE)) {
        members = [
          ...members,
          {
            ...emptyMemberDraft(),
            key: STRIP_MEMBER_ROLE,
            kind: 'component',
            rule: 'interior_width',
            unit: 'piece',
            heightMm: stripPreset.height_mm != null ? formatMmInput(stripPreset.height_mm) : '',
          },
        ];
      }

      // Effects follow the preset; values fill only empty fields. An
      // aluminum preset carries no notch/bevel: they turn OFF and the
      // strip-following source resets (the tira is italiana-only).
      const nextNotchEnabled = notch != null;
      const nextNotchSource = notch?.notch_depth_source === 'strip_thickness' ? 'strip_thickness' as const : '';
      const bevelSize = bevel?.bevel_size_mm != null ? formatMmInput(bevel.bevel_size_mm) : '';
      bevelDerived.current = bevel != null;

      return {
        ...current,
        material: chip.value,
        crossSection: chip.crossSection,
        gripType: 'gola',
        top: suggestion ? suggestion.positions.includes('top') : current.top,
        between: suggestion ? suggestion.positions.includes('between') : current.between,
        manufacturer: current.manufacturer !== '' ? current.manufacturer : suggestion?.manufacturer ?? '',
        frontDiscountTopMm:
          current.frontDiscountTopMm !== ''
            ? current.frontDiscountTopMm
            : suggestion?.front_discount_top_mm != null ? String(suggestion.front_discount_top_mm) : '',
        frontDiscountBetweenMm:
          current.frontDiscountBetweenMm !== ''
            ? current.frontDiscountBetweenMm
            : suggestion?.front_discount_between_mm != null ? String(suggestion.front_discount_between_mm) : '',
        depthReductionEnabled: reduction != null,
        depthReductionDerived: reduction == null || reduction.depth_reduction_mm == null,
        notchEnabled: nextNotchEnabled,
        notchHeightMm: current.notchHeightMm !== '' ? current.notchHeightMm : notch?.notch_height_mm != null ? formatMmInput(notch.notch_height_mm) : '',
        notchDepthSource: nextNotchSource,
        notchClearanceMm: current.notchClearanceMm !== '' ? current.notchClearanceMm : notch?.notch_clearance_mm != null ? formatMmInput(notch.notch_clearance_mm) : '',
        bevelEnabled: bevel != null,
        bevelAt: (bevel?.bevel_at as OpeningProfileDraft['bevelAt']) ?? 'top_front',
        bevelSizeMm: current.bevelSizeMm !== '' ? current.bevelSizeMm : bevelSize,
        members,
      };
    });
  };

  const chooseMaterial = (chip: (typeof MATERIAL_CHIPS)[number]) => {
    const depth = Number(draft.profileDepthMm);
    lastChip.current = chip.testId;
    const suggestion = suggestions ? suggestionForChip(suggestions, chip) : null;
    applyPreset(chip, suggestion);
    // The italiana preset is depth-aware (the bevel = profundidad − 2 is
    // the SERVER's derivation, asked with profile_depth_mm): re-ask with the
    // declared depth — the second apply is idempotent and fill-only-empty.
    // An unloaded list also fetches here so the chip always lands served.
    const needsFresh = chip.value === 'melamine' || suggestion == null;
    if (needsFresh) {
      void fetchSuggestions(depth > 0 ? depth : null).then((list) => {
        // Apply only while this chip is STILL the user's choice.
        if (list == null || lastChip.current !== chip.testId) return;
        const fresh = suggestionForChip(list, chip);
        if (fresh != null) applyPreset(chip, fresh);
      });
    }
  };

  const onDepthInput = (value: string) => {
    set({ profileDepthMm: value });
    if (material !== 'melamine' || !draft.bevelEnabled || !bevelDerived.current) return;
    if (depthDebounce.current) clearTimeout(depthDebounce.current);
    depthDebounce.current = setTimeout(() => {
      const depth = Number(value);
      if (!(depth > 0)) return;
      void fetchSuggestions(depth).then((list) => {
        const fresh = list ? suggestionForChip(list, MATERIAL_CHIPS[2]!) : null;
        const size = fresh?.body_modifiers.find((m) => m.bevel_size_mm != null)?.bevel_size_mm;
        if (size != null && bevelDerived.current) set({ bevelSizeMm: formatMmInput(size) });
      });
    }, 350);
  };

  const togglePosition = (position: 'top' | 'between', checked: boolean) =>
    setDraft((current) => ({ ...current, [position]: checked }));

  const toggleEffect = (patch: Partial<OpeningProfileDraft>) => set(patch);

  const upsertMember = (key: string, kind: 'hardware' | 'component', id: string, patch: Partial<OpeningProfileMemberDraft>) =>
    setDraft((current) => {
      const existing = current.members.find((m) => m.key === key);
      if (existing) {
        return {
          ...current,
          members: current.members.map((m) =>
            m.key === key
              ? { ...m, kind, ...(kind === 'hardware' ? { hardwareId: id } : { componentId: id }), ...patch }
              : m,
          ),
        };
      }
      return {
        ...current,
        members: [
          ...current.members,
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
            ...patch,
          },
        ],
      };
    });

  const supportsMember = draft.members.find((m) => m.key === 'supports');
  const stripMember = draft.members.find((m) => m.key === STRIP_MEMBER_ROLE);
  const unknownMembers = draft.members.filter((m) => !isKnownMemberRole(m.key));

  const errorSection = error ? sectionForMessage(error) : null;
  const sectionAlert = (section: string): ReactNode =>
    error && errorSection === section ? (
      <p role="alert" id="gola-profile-error" data-testid="gola-profile-error" className="gola-editor__alert">
        {error}
      </p>
    ) : null;

  const fichaPending = datasheetStatusOfDraft(draft) === 'pending';
  const pendingReasons = fichaPending ? datasheetPendingReasons(draft) : [];

  const discountRow = (position: 'top' | 'between', label: string, value: string): ReactNode => {
    const testId = position === 'top' ? 'gola-discount-top' : 'gola-discount-between';
    const chip = MATERIAL_CHIPS.find((c) => c.value === material && c.crossSection === draft.crossSection) ?? null;
    const suggestion = suggestions && chip ? suggestionForChip(suggestions, chip) : null;
    const suggested = position === 'top' ? suggestion?.front_discount_top_mm : suggestion?.front_discount_between_mm;
    return (
      <div className="gola-editor__discount">
        <label className="catalog-form__field">
          <span>Descuento del frente — {label}</span>
          <input
            type="number"
            min="0"
            step="any"
            value={value}
            data-testid={testId}
            aria-describedby={errorSection === 'descuento' ? 'gola-profile-error' : undefined}
            onChange={(e) => set(position === 'top' ? { frontDiscountTopMm: e.target.value } : { frontDiscountBetweenMm: e.target.value })}
          />
        </label>
        {suggested != null ? (
          <button
            type="button"
            className="btn btn--small"
            id={`gola-discount-suggest-${position}`}
            data-testid={`gola-discount-suggest-${position}`}
            onClick={() => set(position === 'top' ? { frontDiscountTopMm: String(suggested) } : { frontDiscountBetweenMm: String(suggested) })}
          >
            sugerencia: {suggested}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={identity ? `Editar perfil: ${identity.code} — ${identity.name}` : 'Nuevo perfil de gola'}
      size="lg"
      dataTestId="gola-profile-editor"
    >
      <form id={formId} onSubmit={onSubmit}>
        {error && errorSection === null ? (
          <p role="alert" id="gola-profile-error" data-testid="gola-profile-error" className="gola-editor__alert">
            {error}
          </p>
        ) : null}

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Identidad</legend>
          {sectionAlert('identidad')}
          <label className="catalog-form__field">
            <span>Código</span>
            <input value={draft.code} maxLength={80} required data-testid="gola-profile-code" onChange={(e) => set({ code: e.target.value })} />
          </label>
          <label className="catalog-form__field">
            <span>Nombre</span>
            <input value={draft.name} maxLength={120} required data-testid="gola-profile-name" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="catalog-form__field">
            <span>Fabricante</span>
            <input value={draft.manufacturer} maxLength={80} data-testid="gola-profile-manufacturer" onChange={(e) => set({ manufacturer: e.target.value })} />
          </label>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Material</legend>
          {sectionAlert('material')}
          <div role="radiogroup" aria-label="Material del perfil" className="gola-editor__chips">
            {MATERIAL_CHIPS.map((chip) => {
              const selected = material === chip.value && (chip.value !== 'aluminum' || draft.crossSection === chip.crossSection);
              return (
                <label key={chip.testId} className={`gola-editor__chip${selected ? ' gola-editor__chip--selected' : ''}`}>
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
          <div className="gola-editor__positions">
            <label className="gola-editor__switch">
              <input type="checkbox" role="switch" checked={draft.top} disabled={saving} data-testid="gola-position-top" onChange={(e) => togglePosition('top', e.target.checked)} />
              Superior
            </label>
            <label className="gola-editor__switch">
              <input type="checkbox" role="switch" checked={draft.between} disabled={saving} data-testid="gola-position-between" onChange={(e) => togglePosition('between', e.target.checked)} />
              Entre frentes
            </label>
          </div>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Dimensiones</legend>
          {sectionAlert('dimensiones')}
          <label className="catalog-form__field">
            <span>Alto del perfil (mm)</span>
            <input type="number" min="0" step="any" value={draft.profileHeightMm} data-testid="gola-profile-height" onChange={(e) => set({ profileHeightMm: e.target.value })} />
          </label>
          <label className="catalog-form__field">
            <span>Profundidad (mm)</span>
            <input type="number" min="0" step="any" value={draft.profileDepthMm} data-testid="gola-profile-depth" onChange={(e) => onDepthInput(e.target.value)} />
          </label>
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Descuento del frente</legend>
          {sectionAlert('descuento')}
          {draft.top ? discountRow('top', 'Superior', draft.frontDiscountTopMm) : null}
          {draft.between ? discountRow('between', 'Entre frentes', draft.frontDiscountBetweenMm) : null}
          {!draft.top && !draft.between ? (
            <p className="catalog-form__hint">Marcá al menos una posición para declarar el descuento.</p>
          ) : null}
          {savedUsage && (draft.top || draft.between) ? (
            <div data-testid="gola-profile-saved-usage" className="gola-editor__uso-list">
              <span className="catalog-form__hint">Estado guardado:</span>
              {(['top', 'between'] as const).map((position) => {
                if (!(position === 'top' ? draft.top : draft.between)) return null;
                const verdict = savedUsage[position];
                if (!verdict) return null; // toggled on in-flight — the preview reports it
                const label = position === 'top' ? 'superior' : 'entre frentes';
                return (
                  <span key={position} className="gola-editor__uso-line">
                    {verdict.usable === true ? `${label}: OK` : verdict.message ?? `${label}: no utilizable`}
                  </span>
                );
              })}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Vista previa y sección</legend>
          <div className="gola-editor__preview">
            <GolaSectionDrawing
              material={material}
              crossSection={draft.crossSection}
              heightMm={Number(draft.profileHeightMm)}
              depthMm={Number(draft.profileDepthMm)}
              topDiscountMm={draft.top ? draft.frontDiscountTopMm : ''}
            />
            <div data-testid="gola-profile-preview" className="gola-editor__preview-lines">
              {previewLoading ? (
                <p className="catalog-form__hint" aria-busy="true">Resolviendo vista previa…</p>
              ) : (
                previewLines.map((line, index) => (
                  <p key={`${line.key}-${index}`} data-testid={`gola-profile-preview-${line.key}-${index}`}>
                    {line.preview}
                  </p>
                ))
              )}
              {previewError ? <p role="alert" className="gola-editor__alert">{previewError}</p> : null}
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
          {sectionAlert('efectos')}
          <label className="gola-editor__effect">
            <input
              type="checkbox"
              checked={draft.depthReductionEnabled}
              disabled={saving}
              data-testid="gola-effect-depth"
              onChange={(e) => toggleEffect({ depthReductionEnabled: e.target.checked, depthReductionDerived: true })}
            />
            Acortar el techo o mover el manguete frontal (usa la profundidad)
          </label>
          <label className="gola-editor__effect">
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
                  toggleEffect({
                    notchEnabled: true,
                    notchHeightMm: draft.notchHeightMm !== '' ? draft.notchHeightMm : italian ? '70' : '',
                    notchDepthSource: italian ? 'strip_thickness' : '',
                    notchClearanceMm: italian && draft.notchClearanceMm !== '' ? draft.notchClearanceMm : '1',
                  });
                } else {
                  toggleEffect({ notchEnabled: false, notchDepthSource: '' });
                }
              }}
            />
            Muesca en costados
          </label>
          {draft.notchEnabled ? (
            <div className="gola-editor__effect-detail">
              <label className="catalog-form__field">
                <span>Alto de la muesca (mm)</span>
                <input type="number" min="0" step="any" value={draft.notchHeightMm} data-testid="gola-notch-height" onChange={(e) => set({ notchHeightMm: e.target.value })} />
              </label>
              {draft.notchDepthSource === 'strip_thickness' ? (
                <label className="catalog-form__field">
                  <span>Holgura de la muesca (mm)</span>
                  <input type="number" min="0" step="any" value={draft.notchClearanceMm} data-testid="gola-notch-clearance" onChange={(e) => set({ notchClearanceMm: e.target.value })} />
                </label>
              ) : (
                <label className="catalog-form__field">
                  <span>Profundidad de la muesca (mm)</span>
                  <input type="number" min="0" step="any" value={draft.notchDepthMm} data-testid="gola-notch-depth" onChange={(e) => set({ notchDepthMm: e.target.value })} />
                </label>
              )}
            </div>
          ) : null}
          <label className="gola-editor__effect">
            <input
              type="checkbox"
              checked={draft.bevelEnabled}
              disabled={saving}
              data-testid="gola-effect-bevel"
              onChange={(e) => {
                if (e.target.checked) {
                  // The CHOICE is the user's: enable synchronously — a stale
                  // size in the draft must never dead-lock the checkbox (r2
                  // MAJOR). The size itself comes from the server suggestion
                  // (depth − 2) only while EMPTY; the depth input asks the
                  // server again for an empty, derived size (never a React
                  // constant, never a rewrite of a typed value).
                  set({ bevelEnabled: true, bevelAt: 'top_front' });
                  if (draft.bevelSizeMm === '') {
                    bevelDerived.current = true;
                    void fetchSuggestions(Number(draft.profileDepthMm) > 0 ? Number(draft.profileDepthMm) : null).then((list) => {
                      const fresh = list ? suggestionForChip(list, MATERIAL_CHIPS[2]!) : null;
                      const size = fresh?.body_modifiers.find((m) => m.bevel_size_mm != null)?.bevel_size_mm;
                      if (size != null && bevelDerived.current) {
                        setDraft((current) =>
                          current.bevelSizeMm !== '' ? current : { ...current, bevelSizeMm: formatMmInput(size) },
                        );
                      }
                    });
                  }
                } else {
                  bevelDerived.current = false;
                  toggleEffect({ bevelEnabled: false });
                }
              }}
            />
            Bisel 45° en la puerta (mm)
          </label>
          {draft.bevelEnabled ? (
            <label className="catalog-form__field gola-editor__effect-detail">
              <span>Tamaño del bisel (mm)</span>
              <input type="number" min="0" step="any" value={draft.bevelSizeMm} data-testid="gola-bevel-size" onChange={(e) => { bevelDerived.current = false; set({ bevelSizeMm: e.target.value }); }} />
            </label>
          ) : null}
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Piezas</legend>
          {sectionAlert('piezas')}
          <CatalogPicker
            label="Perfil"
            data-testid="gola-part-profile"
            items={hardwareOptions ?? []}
            value={draft.members.find((m) => m.key === 'profile')?.hardwareId ?? ''}
            disabled={saving}
            onChange={(id) => upsertMember('profile', 'hardware', id, { rule: 'interior_width', unit: 'meter' })}
          />
          <CatalogPicker
            label="Soportes"
            data-testid="gola-part-supports"
            items={hardwareOptions ?? []}
            value={supportsMember?.hardwareId ?? ''}
            disabled={saving}
            onChange={(id) => upsertMember('supports', 'hardware', id, { rule: 'per_length', unit: 'piece' })}
          />
          {supportsMember?.hardwareId ? (
            <>
              <label className="catalog-form__field">
                <span>Soportes cada (mm)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={supportsMember.spacingMm}
                  disabled={saving}
                  data-testid="gola-part-supports-spacing"
                  aria-describedby={errorSection === 'piezas' ? 'gola-profile-error' : undefined}
                  onChange={(e) => setDraft((current) => ({ ...current, members: current.members.map((m) => (m.key === 'supports' ? { ...m, spacingMm: e.target.value } : m)) }))}
                />
              </label>
              <div className="gola-editor__part-dims">
                {(['largo', 'profundo', 'alto'] as const).map((axis, index) => (
                  <label key={axis} className="catalog-form__field">
                    <span>{`Medida ${axis} (mm)`}</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={supportsMember.dims[index] ?? ''}
                      data-testid={`gola-part-supports-dim-${index}`}
                      onChange={(e) =>
                        setDraft((current) => ({
                          ...current,
                          members: current.members.map((m) => {
                            if (m.key !== 'supports') return m;
                            const dims = [...m.dims] as [string, string, string];
                            dims[index] = e.target.value;
                            return { ...m, dims };
                          }),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          ) : null}
          <CatalogPicker
            label="Tapas"
            data-testid="gola-part-endcaps"
            items={hardwareOptions ?? []}
            value={draft.members.find((m) => m.key === 'endCaps')?.hardwareId ?? ''}
            disabled={saving}
            onChange={(id) => upsertMember('endCaps', 'hardware', id, { rule: 'per_exposed_end', unit: 'piece' })}
          />
          {isItalian ? (
            <>
              <CatalogPicker
                label="Tira (componente)"
                data-testid="gola-part-strip"
                items={componentOptions ?? []}
                value={stripMember?.componentId ?? ''}
                disabled={saving}
                onChange={(id) => {
                  upsertMember(STRIP_MEMBER_ROLE, 'component', id, { rule: 'interior_width', unit: 'piece', heightMm: stripMember?.heightMm ?? '70' });
                }}
              />
              <label className="catalog-form__field">
                <span>Alto de la tira (mm)</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={stripMember?.heightMm ?? '70'}
                  disabled={saving}
                  data-testid="gola-part-strip-height"
                  onChange={(e) => setDraft((current) => ({ ...current, members: current.members.map((m) => (m.key === STRIP_MEMBER_ROLE ? { ...m, heightMm: e.target.value } : m)) }))}
                />
              </label>
            </>
          ) : null}
          {unknownMembers.map((member) => (
            <p key={member.key} className="gola-editor__unknown-member" data-testid={`gola-unknown-member-${member.key}`}>
              Esta pieza declara el rol «{member.key}», que este editor no reconoce (viene de una versión anterior). Al guardar se quita: el catálogo ya no acepta ese rol.
            </p>
          ))}
        </fieldset>

        <fieldset className="catalog-form__section" disabled={saving}>
          <legend className="catalog-form__section-title">Origen</legend>
          {sectionAlert('origen')}
          <label className="catalog-form__field">
            <span>Origen de los valores (opcional)</span>
            <input value={draft.geometryOrigin} maxLength={200} data-testid="gola-profile-origin-input" onChange={(e) => set({ geometryOrigin: e.target.value })} />
          </label>
          <p className="gola-editor__ficha-line" data-testid="gola-profile-ficha">
            {fichaPending
              ? `Ficha: pendiente — para autorizar aperturas faltan ${pendingReasons.join(', ')}.`
              : 'Ficha: verificada — el perfil puede autorizar aperturas.'}
          </p>
        </fieldset>

        <div className="catalog-form__actions">
          <button type="button" className="btn" onClick={() => { if (!saving) onClose(); }} disabled={saving} data-testid="gola-profile-cancel">
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
