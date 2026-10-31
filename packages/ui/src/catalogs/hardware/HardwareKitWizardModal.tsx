/**
 * «Juego de herraje» wizard (#1416) — ONE screen to author a complete hardware
 * kit: commercial kit + four design-only parts (with optional SKP designs) +
 * drawer agregado whose recipe wires everything (min/max anchors, body vs
 * actor:drawer memberships, translate motion, kit as the only purchase).
 *
 * The plan preview comes from the pure domain planner; persistence authority
 * stays server-side (the store re-derives the plan against real catalog state
 * and the existing POST validations apply fail-closed). Reuse is by code:
 * re-running the wizard over an existing kit never duplicates records.
 */

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import type {
  Hardware,
  HardwareKitCreateRequest,
  HardwareKitPlan,
  HardwareKitResult,
} from '@granete/domain';
import {
  DEFAULT_FIXED_OFFSET_MM,
  DEFAULT_MOVING_OFFSET_MM,
  HARDWARE_KIT_TEMPLATES,
  hardwareKitTemplateById,
  planHardwareKit,
} from '@granete/domain';
import { Modal } from '../../common';
import { uploadHardwareAssetBinding, type HardwareAssetService, type WorkshopKitTemplateRow } from '@granete/storage';

export interface HardwareKitWizardModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly hardware: readonly Hardware[];
  readonly agregadoCodes: readonly string[];
  readonly onCreateKit: (req: HardwareKitCreateRequest) => Promise<HardwareKitResult>;
  readonly assetService?: HardwareAssetService;
  /** Plantillas del taller (#1422 slice 2): se suman a las embebidas. */
  readonly customTemplates?: readonly WorkshopKitTemplateRow[];
  /** Abre el editor de plantillas del taller (cuando la sesión puede guardar). */
  readonly onEditTemplates?: () => void;
}

type WizardPhase = 'form' | 'running' | 'done';

function parseNumber(value: string): number {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

export function HardwareKitWizardModal({
  open,
  onClose,
  hardware,
  agregadoCodes,
  onCreateKit,
  assetService,
  customTemplates = [],
  onEditTemplates,
}: HardwareKitWizardModalProps): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [width, setWidth] = useState('400');
  const [height, setHeight] = useState('150');
  const [depth, setDepth] = useState('500');
  const [fixedOffset, setFixedOffset] = useState(String(DEFAULT_FIXED_OFFSET_MM));
  const [movingOffset, setMovingOffset] = useState(String(DEFAULT_MOVING_OFFSET_MM));
  const [agregadoCode, setAgregadoCode] = useState('');
  const [templateId, setTemplateId] = useState('drawer-slides');
  const template = useMemo(
    () => hardwareKitTemplateById(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [phase, setPhase] = useState<WizardPhase>('form');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HardwareKitResult | null>(null);
  const filesResetRef = useRef<Record<string, HTMLInputElement | null>>({});

  const existing = useMemo(
    () => ({
      hardwareCodes: new Set(hardware.map((h) => h.code)),
      agregadoCodes: new Set(agregadoCodes),
    }),
    [hardware, agregadoCodes],
  );

  // Best-effort plan for the live preview: incomplete numbers simply blank
  // the preview; strict validation runs on submit (and again in the store).
  const preview: HardwareKitPlan | null = useMemo(() => {
    if (!code.trim() || !name.trim()) return null;
    const w = parseNumber(width);
    const h = parseNumber(height);
    const d = parseNumber(depth);
    const fo = parseNumber(fixedOffset);
    const mo = parseNumber(movingOffset);
    const p = parseNumber(price);
    if (![w, h, d, fo, mo, p].every(Number.isFinite)) return null;
    try {
      return planHardwareKit(
        {
          code,
          name,
          kitCostPerUnit: p,
          widthMm: w,
          heightMm: h,
          depthMm: d,
          fixedOffsetMm: fo,
          movingOffsetMm: mo,
          ...(agregadoCode.trim() ? { agregadoCode } : {}),
          templateId,
        },
        existing,
        customTemplates,
      );
    } catch {
      return null;
    }
  }, [code, name, price, width, height, depth, fixedOffset, movingOffset, agregadoCode, templateId, existing, customTemplates]);

  const running = phase === 'running';

  const slotTestId = (slot: string): string => slot.replaceAll('_', '-');

  const resetAfterDone = () => {
    setCode('');
    setName('');
    setPrice('');
    setWidth('400');
    setHeight('150');
    setDepth('500');
    setFixedOffset(String(DEFAULT_FIXED_OFFSET_MM));
    setMovingOffset(String(DEFAULT_MOVING_OFFSET_MM));
    setAgregadoCode('');
    setTemplateId('drawer-slides');
    setFiles({});
    for (const input of Object.values(filesResetRef.current)) {
      if (input) input.value = '';
    }
    setPhase('form');
    setProgress(null);
    setError(null);
    setResult(null);
  };

  const handleClose = () => {
    if (running) return; // Sin cancelación en vuelo (#1416 v1): los botones quedan deshabilitados.
    if (phase === 'done') resetAfterDone();
    onClose();
  };

  const onFileChange = (slot: string) => (e: ChangeEvent<HTMLInputElement>) => {
    setFiles((prev) => ({ ...prev, [slot]: e.target.files?.[0] ?? null }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (running) return;
    setError(null);

    const w = parseNumber(width);
    const h = parseNumber(height);
    const d = parseNumber(depth);
    const fo = parseNumber(fixedOffset);
    const mo = parseNumber(movingOffset);
    const p = parseNumber(price);
    const input = {
      code,
      name,
      kitCostPerUnit: p,
      widthMm: w,
      heightMm: h,
      depthMm: d,
      fixedOffsetMm: fo,
      movingOffsetMm: mo,
      ...(agregadoCode.trim() ? { agregadoCode } : {}),
      templateId,
    };
    try {
      // Strict validation happens inside the planner; surface its message.
      const plan = planHardwareKit(input, existing, customTemplates);
      if (plan.blockedCode) {
        setError(
          `Ya existe un ensamble con el código «${plan.blockedCode}». Cambiá el código del ensamble para continuar.`,
        );
        return;
      }
      const withFiles = plan.designs.filter(
        (design) => !design.exists && files[design.slot],
      );
      if (withFiles.length > 0 && !assetService) {
        setError('El servicio de recursos 3D no está disponible en esta sesión; quitá los archivos SKP o reintentá más tarde.');
        return;
      }

      setPhase('running');
      const designs: NonNullable<HardwareKitCreateRequest['designs']> = {};
      for (const design of withFiles) {
        const slotLabel =
          template.slots.find((s) => s.slot === design.slot)?.labelEs ?? design.slot;
        setProgress(`Subiendo diseño: ${slotLabel}…`);
        const file = files[design.slot];
        if (!file) continue;
        designs[design.slot] = await uploadHardwareAssetBinding(assetService!, {
          file,
          displayName: design.name,
        });
      }

      setProgress('Creando el juego y su ensamble…');
      const created = await onCreateKit({ input, designs });
      setResult(created);
      setPhase('done');
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el juego.');
      setPhase('form');
      setProgress(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Juego de herraje"
      size="md"
      dataTestId="hardware-kit-wizard"
      footer={
        phase === 'done' ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleClose}
            data-testid="hardware-kit-wizard-close"
          >
            Listo
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              onClick={handleClose}
              disabled={running}
              data-testid="hardware-kit-wizard-cancel"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form="hardware-kit-wizard-form"
              disabled={running || Boolean(preview?.blockedCode)}
              data-testid="hardware-kit-wizard-submit"
            >
              {running ? 'Creando…' : 'Crear juego'}
            </button>
          </>
        )
      }
    >
      {phase === 'done' && result ? (
        <div data-testid="hardware-kit-wizard-result" className="catalog-form">
          <p role="status">
            Juego creado. Ensamble <strong>{result.agregadoCode}</strong> con las
            piezas de diseño y su kit comercial.
          </p>
          {result.createdCodes.length > 0 ? (
            <p>
              <strong>Creados:</strong> {result.createdCodes.join(', ')}
            </p>
          ) : null}
          {result.reusedCodes.length > 0 ? (
            <p>
              <strong>Reutilizados:</strong> {result.reusedCodes.join(', ')}
            </p>
          ) : null}
          <p className="catalog-form__hint">
            Los diseños quedaron como herrajes «solo diseño»: se dibujan y abren, y la
            compra se hace entera por el kit (1 juego). Podés editarlos después desde
            este mismo catálogo.
          </p>
        </div>
      ) : (
        <form
          id="hardware-kit-wizard-form"
          className="catalog-form"
          onSubmit={handleSubmit}
          data-testid="hardware-kit-wizard-form"
        >
          {error ? (
            <p className="catalog-form__error" role="alert" data-testid="hardware-kit-wizard-error">
              {error}
            </p>
          ) : null}
          {progress ? (
            <p role="status" data-testid="hardware-kit-wizard-progress">
              {progress}
            </p>
          ) : null}

          <fieldset className="catalog-form__section" data-testid="hardware-kit-wizard-identity">
            <legend className="catalog-form__section-title">Juego comercial</legend>
            <div className="catalog-form__field">
              <label htmlFor="kit-code">Código del juego</label>
              <input
                id="kit-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                required
                data-testid="hardware-kit-wizard-code"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kit-name">Nombre</label>
              <input
                id="kit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="hardware-kit-wizard-name"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kit-price">Precio por juego</label>
              <input
                id="kit-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                required
                data-testid="hardware-kit-wizard-price"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kit-agregado-code">Código del ensamble (opcional)</label>
              <input
                id="kit-agregado-code"
                value={agregadoCode}
                onChange={(e) => setAgregadoCode(e.target.value)}
                placeholder={
                  code.trim()
                    ? template.agregadoLabelEs === 'Cajón'
                      ? `${code.trim()}-CAJON`
                      : `${code.trim()}-${template.agregadoLabelEs.toUpperCase()}`
                    : 'Se deriva del tipo de juego'
                }
                autoComplete="off"
                data-testid="hardware-kit-wizard-agregado-code"
              />
            </div>
          </fieldset>

          <fieldset className="catalog-form__section" data-testid="hardware-kit-wizard-template">
            <legend className="catalog-form__section-title">Tipo de juego</legend>
            <div className="catalog-form__field">
              <label htmlFor="kit-template">Plantilla</label>
              <select
                id="kit-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                data-testid="hardware-kit-wizard-template-select"
              >
                {HARDWARE_KIT_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.labelEs}
                  </option>
                ))}
                {customTemplates.length > 0 ? (
                  <optgroup label="Del taller">
                    {customTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.labelEs}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {onEditTemplates ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={onEditTemplates}
                  data-testid="hardware-kit-wizard-manage-templates"
                >
                  Plantillas del taller…
                </button>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="catalog-form__section" data-testid="hardware-kit-wizard-dims">
            <legend className="catalog-form__section-title">Ensamble de referencia</legend>
            <div className="catalog-form__field">
              <label htmlFor="kit-width">Ancho (mm)</label>
              <input
                id="kit-width"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                inputMode="numeric"
                data-testid="hardware-kit-wizard-width"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kit-height">Alto (mm)</label>
              <input
                id="kit-height"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                inputMode="numeric"
                data-testid="hardware-kit-wizard-height"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kit-depth">Profundidad (mm)</label>
              <input
                id="kit-depth"
                value={depth}
                onChange={(e) => setDepth(e.target.value)}
                inputMode="numeric"
                data-testid="hardware-kit-wizard-depth"
              />
            </div>
            {templateId === 'drawer-slides' ? (
            <>
            <div className="catalog-form__field">
              <label htmlFor="kit-fixed-offset">Separación de guías fijas (mm)</label>
              <input
                id="kit-fixed-offset"
                value={fixedOffset}
                onChange={(e) => setFixedOffset(e.target.value)}
                inputMode="numeric"
                data-testid="hardware-kit-wizard-fixed-offset"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="kit-moving-offset">Separación de correderas móviles (mm)</label>
              <input
                id="kit-moving-offset"
                value={movingOffset}
                onChange={(e) => setMovingOffset(e.target.value)}
                inputMode="numeric"
                data-testid="hardware-kit-wizard-moving-offset"
              />
            </div>
            </>
            ) : null}
          </fieldset>

          <fieldset className="catalog-form__section" data-testid="hardware-kit-wizard-designs">
            <legend className="catalog-form__section-title">Diseños 3D (opcionales)</legend>
            <p className="catalog-form__hint">
              Un archivo por pieza (.skp). Las piezas sin diseño se ven con la
              representación genérica y podés subir el diseño después desde su
              ficha.
            </p>
            {template.slots.map((slot) => {
              const planSlot = preview?.designs.find((d) => d.slot === slot.slot);
              return (
                <div className="catalog-form__field" key={slot.slot}>
                  <label htmlFor={`kit-file-${slotTestId(slot.slot)}`}>{slot.labelEs}</label>
                  <input
                    id={`kit-file-${slotTestId(slot.slot)}`}
                    type="file"
                    accept=".skp,.glb"
                    onChange={onFileChange(slot.slot)}
                    disabled={planSlot?.exists}
                    data-testid={`hardware-kit-wizard-file-${slotTestId(slot.slot)}`}
                    ref={(el) => {
                      filesResetRef.current[slot.slot] = el;
                    }}
                  />
                  {planSlot?.exists ? (
                    <span className="catalog-form__hint">
                      Ya existe «{planSlot.code}» — se reutiliza tal cual.
                    </span>
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          {preview ? (
            <div
              className="catalog-form__section"
              data-testid="hardware-kit-wizard-preview"
              aria-live="polite"
            >
              <p className="catalog-form__section-title">Se va a crear</p>
              <ul>
                <li>
                  Kit <strong>{preview.kit.code}</strong> (1 juego
                  {preview.kit.exists ? ' — ya existe, se reutiliza' : ''}) +{' '}
                  {template.agregadoLabelEs.toLowerCase()}{' '}
                  <strong>{preview.agregado.code}</strong> con{' '}
                  {preview.designs.length}{' '}
                  {preview.designs.length === 1 ? 'pieza' : 'piezas'}:{' '}
                  {preview.designs.map((d) => d.code).join(', ')}.
                </li>
              </ul>
              {preview.blockedCode ? (
                <p className="catalog-form__error" role="alert">
                  El ensamble «{preview.blockedCode}» ya existe: cambiale el código
                  arriba.
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
