/**
 * #1596 alcance 10: añadir una altura FALTANTE a un sistema ya creado
 * (decisión 8). Sólo las alturas que el ensamble aún no tiene; el juego de
 * la altura nueva usa la MISMA estructura drawer-hands del sistema (SKP por
 * mano, subir o dejar pendiente) y la variante entra al ensamble por la vía
 * de edición existente. Si el ensamble no está en ningún grupo
 * kind:agregado, el paso de elegibilidad aparece acá también (decisión 9).
 * #1625: al añadir la E se declaran también sus insertos (misma forma que el
 * asistente) y todo se guarda en una transacción del servidor.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  effectiveVariantLabel,
  HARDWARE_KIT_SYSTEM_HEIGHTS,
  KIT_TEMPLATE_DRAWER_HANDS_ID,
  planHardwareKit,
  type Agregado,
} from '@granete/domain';
import type { HardwareKitSystemAccessory, HardwareVisualAssetBinding } from '@granete/domain';
import { Modal } from '../../common';
import { uploadKitWizardDesigns, useKitWizardRun, type KitWizardRunTask } from './useKitWizardRun';
import {
  duplicatedInsertoSuffix,
  insertoDraftsToAccessories,
  KitSystemInsertosFieldset,
  type InsertoDraft,
} from './KitSystemInsertosFieldset';

export interface HardwareSystemHeightAddModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Ensamble del sistema (code *-CAJON, variant set height). */
  readonly agregado: Agregado;
  /** Grupos kind:agregado existentes para la elegibilidad (si falta). */
  readonly eligibilityGroups?: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
  /** true si el ensamble ya es miembro de algún grupo kind:agregado. */
  readonly hasEligibilityGroup: boolean;
  readonly uploadDesign?: (
    file: File,
    displayName: string,
  ) => Promise<HardwareVisualAssetBinding>;
  readonly onSubmit: (req: {
    readonly agregadoId: string;
    readonly heightCode: 'N' | 'M' | 'K' | 'E';
    readonly kitCostPerUnit: number;
    readonly widthMm: number;
    readonly depthMm: number;
    readonly designs?: Record<string, HardwareVisualAssetBinding>;
    readonly eligibilityGroup?: {
      readonly existingGroupId?: string;
      readonly id?: string;
      readonly code?: string;
      readonly name?: string;
    };
    /** #1625: insertos de la altura E (uploads con clave `${código}:${ancla}`). */
    readonly insertos?: readonly HardwareKitSystemAccessory[];
  }) => Promise<unknown>;
}

const num = (v: string): number => {
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

export function HardwareSystemHeightAddModal({
  open,
  onClose,
  agregado,
  eligibilityGroups = [],
  hasEligibilityGroup,
  uploadDesign,
  onSubmit,
}: HardwareSystemHeightAddModalProps): ReactNode {
  const systemCode = agregado.code.replace(/-CAJON$/, '');
  // #1633: una altura existe si coincide su medida O su etiqueta (dato, o
  // la letra deducida en variantes previas sin etiqueta).
  const existingHeights = useMemo(() => {
    const variants = (agregado.variantSets ?? [])
      .filter((vs) => vs.dimension === 'height')
      .flatMap((vs) => vs.variants);
    return {
      nominals: new Set(variants.map((v) => v.nominalDimensionMm)),
      labels: new Set(variants.map((v) => effectiveVariantLabel(v).toLowerCase()).filter(Boolean)),
    };
  }, [agregado]);
  const missing = HARDWARE_KIT_SYSTEM_HEIGHTS.filter(
    (h) => !existingHeights.nominals.has(h.khMinMm) && !existingHeights.labels.has(h.code.toLowerCase()),
  );

  const [heightCode, setHeightCode] = useState<string>('');
  const [cost, setCost] = useState('0');
  const [widthMm, setWidthMm] = useState(String(agregado.externalDims?.width ?? ''));
  const [depthMm, setDepthMm] = useState(String(agregado.externalDims?.depth ?? ''));
  const [files, setFiles] = useState<Record<string, File>>({});
  const [eligibilityMode, setEligibilityMode] = useState<'new' | 'existing' | 'skip'>('new');
  const [eligibilityExistingId, setEligibilityExistingId] = useState('');
  const [skipConfirmed, setSkipConfirmed] = useState(false);
  const [insertoDrafts, setInsertoDrafts] = useState<InsertoDraft[]>([]);
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const height = HARDWARE_KIT_SYSTEM_HEIGHTS.find((h) => h.code === heightCode);
  const kitCode = height ? `${systemCode}-${height.code}` : '';
  // #1625: los insertos aplican a la E (igual que el asistente del sistema).
  const insertos = height?.code === 'E' ? insertoDraftsToAccessories(insertoDrafts) : [];
  const insertoCode = (suffix: string): string => `${kitCode}-${suffix}`;
  const duplicatedSuffix = duplicatedInsertoSuffix(insertos);

  // La estructura drawer-hands de la altura nueva (misma del sistema).
  const planned = useMemo(() => {
    if (!height || !Number.isFinite(num(widthMm)) || !Number.isFinite(num(depthMm))) return null;
    try {
      return planHardwareKit(
        {
          code: kitCode,
          name: `${systemCode} ${height.code}`,
          kitCostPerUnit: num(cost) || 0,
          widthMm: num(widthMm),
          heightMm: height.khMinMm,
          depthMm: num(depthMm),
          templateId: KIT_TEMPLATE_DRAWER_HANDS_ID,
        },
        { hardwareCodes: new Set(), agregadoCodes: new Set() },
      );
    } catch {
      return null;
    }
  }, [height, kitCode, systemCode, cost, widthMm, depthMm]);

  const wizard = useKitWizardRun<unknown>({
    open,
    onClose,
    resetForm: () => {
      setHeightCode('');
      setCost('0');
      setWidthMm(String(agregado.externalDims?.width ?? ''));
      setDepthMm(String(agregado.externalDims?.depth ?? ''));
      setFiles({});
      setEligibilityMode('new');
      setEligibilityExistingId('');
      setSkipConfirmed(false);
      setInsertoDrafts([]);
      for (const input of Object.values(fileInputsRef.current)) {
        if (input) input.value = '';
      }
    },
  });

  const fileKey = (hand: string, partCode: string): string => `${kitCode}:${hand}:${partCode}`;

  const submit = async (): Promise<void> => {
    if (!height || !planned || wizard.running || duplicatedSuffix) return;
    const tasks: KitWizardRunTask[] = [];
    for (const design of planned.designs) {
      for (const part of design.handsParts ?? []) {
        const key = fileKey(part.hand, design.code);
        const file = files[key];
        if (!file) continue;
        tasks.push({
          key,
          file,
          label: `${design.name} — ${part.hand === 'left' ? 'izq' : 'der'}`,
          displayName: design.name,
        });
      }
    }
    for (const acc of insertos) {
      for (const anchor of acc.anchors) {
        const key = `${insertoCode(acc.suffix)}:${anchor}`;
        const file = files[key];
        if (!file) continue;
        tasks.push({
          key,
          file,
          label: `${acc.name} — ${anchor === 'left' ? 'izq' : anchor === 'right' ? 'der' : 'centro'}`,
          displayName: acc.name,
        });
      }
    }
    if (tasks.length > 0 && !uploadDesign) {
      wizard.setError('El servicio de recursos 3D no está disponible en esta sesión; quitá los archivos SKP o reintentá más tarde.');
      return;
    }
    wizard.begin();
    try {
      const designs =
        tasks.length > 0 && uploadDesign
          ? await uploadKitWizardDesigns(tasks, uploadDesign, wizard.setProgress)
          : undefined;
      wizard.setProgress('Añadiendo la altura…');
      const eligibilityGroup =
        hasEligibilityGroup || eligibilityMode === 'skip'
          ? undefined
          : eligibilityMode === 'existing'
            ? { existingGroupId: eligibilityExistingId }
              : {
                  id: crypto.randomUUID(),
                  code: 'SISTEMA_CAJON',
                  name: 'Sistemas de cajón',
                };
      await onSubmit({
        agregadoId: agregado.id,
        heightCode: height.code,
        kitCostPerUnit: num(cost) || 0,
        widthMm: num(widthMm),
        depthMm: num(depthMm),
        ...(designs ? { designs } : {}),
        ...(eligibilityGroup ? { eligibilityGroup } : {}),
        ...(insertos.length > 0 ? { insertos } : {}),
      });
      wizard.complete(undefined);
    } catch (err) {
      wizard.fail(err, 'No se pudo añadir la altura.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={wizard.handleClose}
      title={`Añadir altura — sistema ${systemCode}`}
      size="md"
      dataTestId="hardware-system-height-modal"
    >
      {wizard.phase === 'done' ? (
        <div data-testid="hardware-system-height-done">
          <p className="catalog-form__section-title">✓ Altura añadida</p>
          <p>
            El juego <strong>{kitCode}</strong> quedó disponible y la variante entró al
            ensamble {agregado.code}.
          </p>
          <button type="button" className="btn btn--primary" onClick={wizard.handleClose}>
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
          {wizard.error ? (
            <p className="catalog-form__error" role="alert" data-testid="hardware-system-height-error">
              {wizard.error}
            </p>
          ) : null}
          <div className="catalog-form__field">
            <label htmlFor="sys-height-select">Altura a añadir</label>
            <select
              id="sys-height-select"
              value={heightCode}
              onChange={(e) => setHeightCode(e.target.value)}
              required
              data-testid="hardware-system-height-select"
            >
              <option value="">Elegir…</option>
              {missing.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.labelEs}
                </option>
              ))}
            </select>
            {missing.length === 0 ? (
              <p className="catalog-form__hint">El sistema ya tiene las cuatro alturas.</p>
            ) : null}
          </div>
          <div className="catalog-form__row">
            <label className="catalog-form__field">
              <span>Costo por juego</span>
              <input
                type="number"
                min={0}
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                data-testid="hardware-system-height-cost"
              />
            </label>
            <label className="catalog-form__field">
              <span>Ancho (W mm)</span>
              <input
                type="number"
                min={0}
                value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)}
                data-testid="hardware-system-height-width"
              />
            </label>
            <label className="catalog-form__field">
              <span>Fondo (D mm)</span>
              <input
                type="number"
                min={0}
                value={depthMm}
                onChange={(e) => setDepthMm(e.target.value)}
                data-testid="hardware-system-height-depth"
              />
            </label>
          </div>

          {planned ? (
            <fieldset className="catalog-form__section" data-testid="hardware-system-height-designs">
              <legend className="catalog-form__section-title">Diseños 3D (opcionales)</legend>
              <p className="catalog-form__hint">
                Un archivo por mano del costado (.skp). Lo que queda sin diseño se ve con
                la representación genérica y se sube después desde su ficha. Los costados
                nacen sin desfase (0 mm): si tu diseño no está dibujado en su posición
                final, ajustá el desfase de cada lado en la ficha de la pieza, sección
                «Diseño — un SKP por lado».
              </p>
              {planned.designs.map((design) =>
                (design.handsParts ?? []).map((part) => {
                  const key = fileKey(part.hand, design.code);
                  const slotId = `sys-height-file-${part.hand}-${design.code}`
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-');
                  const handLabel = part.hand === 'left' ? 'izq' : part.hand === 'right' ? 'der' : 'centro';
                  return (
                    <div className="catalog-form__field" key={key}>
                      <label htmlFor={slotId}>
                        {design.name.includes('—') ? design.name.split('—')[1]!.trim() : design.name} ({handLabel})
                      </label>
                      <input
                        id={slotId}
                        type="file"
                        accept=".skp,.glb"
                        ref={(el) => {
                          fileInputsRef.current[key] = el;
                        }}
                        onChange={(e) =>
                          setFiles((prev) => {
                            const next = { ...prev };
                            if (e.target.files?.[0]) next[key] = e.target.files[0];
                            else delete next[key];
                            return next;
                          })
                        }
                        data-testid={`hardware-system-height-file-${key}`}
                      />
                    </div>
                  );
                }),
              )}
            </fieldset>
          ) : null}

          {height?.code === 'E' ? (
            <>
              <KitSystemInsertosFieldset
                drafts={insertoDrafts}
                onChange={setInsertoDrafts}
                legend="Insertos del cajón E (opcional)"
                hint="Galería, boxcap, boxcover… Cada uno queda como opción del selector del juego E; el cajón E lleva el primero por defecto. Podés añadirlos después desde la ficha del juego."
                testIdPrefix="hardware-system-height-inserto"
              />
              {duplicatedSuffix ? (
                <p className="catalog-form__error" role="alert" data-testid="hardware-system-height-inserto-duplicated">
                  Dos insertos generarían el mismo código (…-{duplicatedSuffix}): renombrá uno para diferenciarlos.
                </p>
              ) : null}
              {insertos.length > 0 ? (
                <fieldset className="catalog-form__section" data-testid="hardware-system-height-inserto-designs">
                  <legend className="catalog-form__section-title">Diseños 3D de los insertos (opcionales)</legend>
                  {insertos.map((acc) =>
                    acc.anchors.map((anchor) => {
                      const key = `${insertoCode(acc.suffix)}:${anchor}`;
                      const slotId = `sys-height-inserto-${key}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                      return (
                        <div className="catalog-form__field" key={key}>
                          <label htmlFor={slotId}>
                            {insertoCode(acc.suffix)} ({anchor === 'left' ? 'izq' : anchor === 'right' ? 'der' : 'centro'})
                          </label>
                          <input
                            id={slotId}
                            type="file"
                            accept=".skp,.glb"
                            ref={(el) => {
                              fileInputsRef.current[key] = el;
                            }}
                            onChange={(e) =>
                              setFiles((prev) => {
                                const next = { ...prev };
                                if (e.target.files?.[0]) next[key] = e.target.files[0];
                                else delete next[key];
                                return next;
                              })
                            }
                            data-testid={`hardware-system-height-file-${key}`}
                          />
                        </div>
                      );
                    }),
                  )}
                </fieldset>
              ) : null}
            </>
          ) : null}

          {!hasEligibilityGroup ? (
            <fieldset className="catalog-form__section" data-testid="hardware-system-height-eligibility">
              <legend className="catalog-form__section-title">Elegibilidad</legend>
              <p className="catalog-form__hint">
                El ensamble {agregado.code} todavía no está en ningún grupo de sistemas:
                ningún módulo puede elegirlo. Elegí dónde dejarlo disponible.
              </p>
              <label className="catalog-form__field">
                <span>Grupo de sistemas de cajón</span>
                <select
                  value={eligibilityMode === 'existing' ? eligibilityExistingId : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setEligibilityMode('existing');
                      setEligibilityExistingId(e.target.value);
                    } else {
                      setEligibilityMode('new');
                      setEligibilityExistingId('');
                    }
                  }}
                  data-testid="hardware-system-height-eligibility-select"
                >
                  <option value="">Crear grupo nuevo «Sistemas de cajón»</option>
                  {eligibilityGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={skipConfirmed}
                  onChange={(e) => {
                    setSkipConfirmed(e.target.checked);
                    if (e.target.checked) setEligibilityMode('skip');
                    else setEligibilityMode('new');
                  }}
                  data-testid="hardware-system-height-eligibility-skip"
                />
                <span>Sin elegibilidad ahora — ningún módulo podrá elegir este sistema</span>
              </label>
            </fieldset>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!height || !planned || wizard.running || duplicatedSuffix !== null}
              data-testid="hardware-system-height-submit"
            >
              {wizard.phase === 'running' ? (wizard.progress ?? 'Añadiendo…') : 'Añadir altura'}
            </button>
            <button type="button" className="btn" onClick={wizard.handleClose}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
