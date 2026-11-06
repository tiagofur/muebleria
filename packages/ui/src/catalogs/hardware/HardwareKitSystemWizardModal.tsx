/**
 * Asistente «Nuevo sistema de cajones» (#1546 M4 S1): un solo flujo que
 * genera TODO el sistema MERIVOBOX — un kit multi-diseño por altura incluida
 * (con su par de SKPs por mano), los herrajes accesorios del cajón E
 * (galería/boxcap/boxcover con piezas por ancla) y UN agregado con variantes
 * de altura cuyo sync materializa por bahía. El plan es autoridad: el store
 * lo re-deriva contra el catálogo real antes de persistir.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  HARDWARE_KIT_SYSTEM_HEIGHTS,
  planHardwareKitSystem,
  type HardwareKitSystemInput,
  type HardwareKitSystemPlan,
  type HardwareVisualAssetBinding,
} from '@granete/domain';
import { Modal } from '../../common';

export type SystemFileBuckets = Record<string, File>;

export interface HardwareKitSystemWizardModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (req: import('@granete/domain').HardwareKitSystemCreateRequest) => Promise<import('@granete/domain').HardwareKitResult>;
  readonly existingHardwareCodes?: ReadonlySet<string>;
  readonly existingAgregadoCodes?: ReadonlySet<string>;
  /** Sube un SKP y devuelve el binding exacto (identifiers). */
  readonly uploadDesign: (
    file: File,
    displayName: string,
  ) => Promise<HardwareVisualAssetBinding>;
}

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function HardwareKitSystemWizardModal({
  open,
  onClose,
  onSubmit,
  uploadDesign,
  existingHardwareCodes,
  existingAgregadoCodes,
}: HardwareKitSystemWizardModalProps): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [widthMm, setWidthMm] = useState('570');
  const [depthMm, setDepthMm] = useState('530');
  const [heights, setHeights] = useState<Record<string, boolean>>(
    () => Object.fromEntries(HARDWARE_KIT_SYSTEM_HEIGHTS.map((h) => [h.code, h.include])),
  );
  // Accesorios del E: nombre + anclas fijo L/R (el par D/I del lateral).
  const [accessories, setAccessories] = useState<{ name: string }[]>([]);
  const [files, setFiles] = useState<SystemFileBuckets>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form');
  const [result, setResult] = useState<{ createdCodes: readonly string[] } | null>(null);

  const systemInput = useMemo<HardwareKitSystemInput | null>(() => {
    const c = code.trim();
    const n = name.trim();
    if (!c || !n) return null;
    return {
      code: c,
      name: n,
      kitCostPerUnit: num(price),
      widthMm: num(widthMm),
      depthMm: num(depthMm),
      heights: HARDWARE_KIT_SYSTEM_HEIGHTS.map((h) => ({
        code: h.code,
        labelEs: h.labelEs,
        khMinMm: h.khMinMm,
        include: heights[h.code] ?? false,
      })),
      accessoriesE: accessories
        .filter((a) => a.name.trim())
        .map((a) => ({
          suffix: a.name
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 24),
          name: a.name.trim(),
          anchors: ['left', 'right'] as const,
        }))
        .filter((a) => a.suffix !== ''),
    };
  }, [code, name, price, widthMm, depthMm, heights, accessories]);

  const plan: HardwareKitSystemPlan | null = useMemo(() => {
    if (!systemInput) return null;
    try {
      return planHardwareKitSystem(systemInput, {
        hardwareCodes: existingHardwareCodes ?? new Set(),
        agregadoCodes: existingAgregadoCodes ?? new Set(),
      });
    } catch {
      return null;
    }
  }, [systemInput, existingHardwareCodes, existingAgregadoCodes]);

  const fileKey = (kitCode: string, hand: string, partCode: string): string =>
    `${kitCode}:${hand}:${partCode}`;
  const accFileKey = (accCode: string, anchor: string): string => `${accCode}:${anchor}`;

  const submit = async (): Promise<void> => {
    if (!systemInput || !plan) return;
    if (plan.blockedCode) {
      setError(`Ya existe un ensamble con el código «${plan.blockedCode}». Cambiá el código del sistema.`);
      return;
    }
    setPhase('running');
    try {
      const designs: Record<string, HardwareVisualAssetBinding> = {};
      for (const kit of plan.kits) {
        for (const design of kit.designs) {
          if (!design.handsParts) continue;
          for (const part of design.handsParts) {
            const file = files[fileKey(kit.code, part.hand, design.code)];
            if (!file) continue;
            setProgress(`Subiendo ${design.name} — ${part.hand === 'left' ? 'izq' : 'der'}…`);
            designs[fileKey(kit.code, part.hand, design.code)] = await uploadDesign(
              file,
              design.name,
            );
          }
        }
      }
      for (const acc of plan.accessories) {
        for (const anchor of acc.anchors) {
          const file = files[accFileKey(acc.code, anchor)];
          if (!file) continue;
          setProgress(`Subiendo ${acc.name} — ${anchor === 'left' ? 'izq' : 'der'}…`);
          designs[accFileKey(acc.code, anchor)] = await uploadDesign(file, acc.name);
        }
      }
      setProgress('Creando el sistema…');
      const created = await onSubmit({ input: systemInput, designs });
      setResult(created);
      setPhase('done');
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el sistema.');
      setPhase('form');
      setProgress(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo sistema de cajones"
      size="lg"
      dataTestId="hardware-system-wizard-modal"
    >
      {phase === 'done' && result ? (
        <div data-testid="hardware-system-wizard-result">
          <p className="catalog-form__section-title">✓ Sistema creado</p>
          <p>
            Filas generadas:{' '}
            {result.createdCodes.length > 0 ? result.createdCodes.join(', ') : '—'}
          </p>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Listo
          </button>
        </div>
      ) : (
        <form
          className="catalog-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error ? (
            <p className="catalog-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="catalog-form__field">
            <label htmlFor="system-code">Código del sistema</label>
            <input
              id="system-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ej: MBOX-IRIDIUN"
              autoComplete="off"
              required
              data-testid="hardware-system-wizard-code"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="system-name">Nombre</label>
            <input
              id="system-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Merivobox Iridium"
              required
              data-testid="hardware-system-wizard-name"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="system-price">Costo por juego</label>
            <input
              id="system-price"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              data-testid="hardware-system-wizard-price"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="system-width">Ancho (W mm)</label>
            <input
              id="system-width"
              type="number"
              value={widthMm}
              onChange={(e) => setWidthMm(e.target.value)}
              data-testid="hardware-system-wizard-width"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="system-depth">Fondo (D mm)</label>
            <input
              id="system-depth"
              type="number"
              value={depthMm}
              onChange={(e) => setDepthMm(e.target.value)}
              data-testid="hardware-system-wizard-depth"
            />
          </div>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Alturas del sistema</legend>
            {HARDWARE_KIT_SYSTEM_HEIGHTS.map((h) => (
              <label
                key={h.code}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                data-testid={`hardware-system-height-${h.code}`}
              >
                <input
                  type="checkbox"
                  checked={heights[h.code] ?? false}
                  onChange={(e) => setHeights((prev) => ({ ...prev, [h.code]: e.target.checked }))}
                />
                <span>{h.labelEs}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Accesorios del cajón E</legend>
            <p className="catalog-form__hint">
              Cada accesorio se genera como un herraje con par de piezas (izq/der) y
              queda como opción del grupo del cajón E.
            </p>
            {accessories.map((acc, idx) => (
              <div
                key={idx}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}
                data-testid={`hardware-system-accessory-${idx}`}
              >
                <input
                  value={acc.name}
                  onChange={(e) =>
                    setAccessories((prev) =>
                      prev.map((a, i) => (i === idx ? { ...a, name: e.target.value } : a)),
                    )
                  }
                  placeholder="Ej: Galería Gris Iridium"
                  data-testid={`hardware-system-accessory-${idx}-name`}
                />
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => setAccessories((prev) => prev.filter((_, i) => i !== idx))}
                  data-testid={`hardware-system-accessory-${idx}-remove`}
                >
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setAccessories((prev) => [...prev, { name: '' }])}
              data-testid="hardware-system-accessory-add"
            >
              Añadir accesorio
            </button>
          </fieldset>

          {plan ? (
            <div className="catalog-hw-wizard__preview" data-testid="hardware-system-wizard-preview">
              <p className="catalog-form__section-title">Se va a crear</p>
              <p>
                {plan.kits.length} juego(s): {plan.kits.map((k) => k.code).join(', ')}
                {plan.accessories.length > 0
                  ? ` + ${plan.accessories.length} accesorio(s): ${plan.accessories
                      .map((a) => a.code)
                      .join(', ')}`
                  : ''}{' '}
                + ensamble <strong>{plan.agregado.code}</strong> con variantes de altura (
                {plan.agregado.variants.map((v) => v.heightCode).join('/')})
                {plan.accessoryGroup ? ` + grupo ${plan.accessoryGroup.code}` : ''}.
              </p>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!systemInput || !plan || plan.blockedCode !== null || phase === 'running'}
              data-testid="hardware-system-wizard-submit"
            >
              {phase === 'running' ? (progress ?? 'Creando…') : 'Crear sistema'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
