/**
 * Asistente «Nuevo sistema de cajones» (#1546 M4 S1): un solo flujo que
 * genera TODO el sistema MERIVOBOX — un kit multi-diseño por altura incluida
 * (con su par de SKPs por mano), los herrajes accesorios del cajón E
 * (galería/boxcap/boxcover con piezas por ancla) y UN agregado con variantes
 * de altura cuyo sync materializa por bahía. El plan es autoridad: el store
 * lo re-deriva contra el catálogo real antes de persistir.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  HARDWARE_KIT_SYSTEM_HEIGHTS,
  planHardwareKitSystem,
  type HardwareKitSystemInput,
  type HardwareKitSystemPlan,
  type HardwareKitResult,
  type HardwareVisualAssetBinding,
} from '@granete/domain';
import { Modal } from '../../common';
import { uploadKitWizardDesigns, useKitWizardRun, type KitWizardRunTask } from './useKitWizardRun';

export type SystemFileBuckets = Record<string, File>;

export interface HardwareKitSystemWizardModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (req: import('@granete/domain').HardwareKitSystemCreateRequest) => Promise<import('@granete/domain').HardwareKitResult>;
  readonly existingHardwareCodes?: ReadonlySet<string>;
  readonly existingAgregadoCodes?: ReadonlySet<string>;
  /** #1596 decisión 9: grupos kind:agregado para la elegibilidad del ensamble. */
  readonly eligibilityGroups?: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  /**
   * Sube un SKP y devuelve el binding exacto (identifiers). Opcional: sin
   * servicio de recursos en la sesión igual se puede crear el sistema, sólo
   * sin subir diseños (#1552 — antes reventaba con TypeError).
   */
  readonly uploadDesign?: (
    file: File,
    displayName: string,
  ) => Promise<HardwareVisualAssetBinding>;
}

/** Parseo estricto: lo inválido es NaN y el planner lo rechaza con mensaje. */
const num = (v: string): number => {
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

export function HardwareKitSystemWizardModal({
  open,
  onClose,
  onSubmit,
  uploadDesign,
  existingHardwareCodes,
  existingAgregadoCodes,
  eligibilityGroups = [],
}: HardwareKitSystemWizardModalProps): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [widthMm, setWidthMm] = useState('570');
  const [depthMm, setDepthMm] = useState('530');
  const [heights, setHeights] = useState<Record<string, boolean>>(
    () => Object.fromEntries(HARDWARE_KIT_SYSTEM_HEIGHTS.map((h) => [h.code, h.include])),
  );
  // Insertos del E con la forma COMPLETA (#1596: nada a medias): nombre +
  // «Al abrir» (default: viaja con el cajón) + offsets explícitos por lado.
  const [accessories, setAccessories] = useState<
    { name: string; actor: 'body' | 'actor:drawer' | 'actor:door'; offsets: { left: { x: string; y: string; z: string }; right: { x: string; y: string; z: string } } }[]
  >([]);
  // #1596 decisión 9: elegibilidad del ensamble — grupo existente, grupo
  // nuevo (default SISTEMA_CAJON) u omisión confirmada.
  const [eligibilityMode, setEligibilityMode] = useState<'new' | 'existing' | 'skip'>('new');
  const [eligibilityGroupId, setEligibilityGroupId] = useState('');
  const [skipEligibilityConfirmed, setSkipEligibilityConfirmed] = useState(false);

  // Review S2: si el grupo canónico ya existe, preseleccionarlo — crear otro
  // con el mismo código daría 409 en el primer intento.
  useEffect(() => {
    if (!open || eligibilityMode !== 'new') return;
    const canonical = eligibilityGroups.find((g) => g.code === 'SISTEMA_CAJON');
    if (canonical) {
      setEligibilityMode('existing');
      setEligibilityGroupId(canonical.id);
    }
    // Sólo al abrir el asistente: la elección del usuario manda después.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [files, setFiles] = useState<SystemFileBuckets>({});
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  // Reset de los campos propios del asistente; la máquina de fases la resetea
  // el hook (#1552: antes el modal quedaba en «done» para siempre).
  const resetForm = useCallback(() => {
    setCode('');
    setName('');
    setPrice('');
    setWidthMm('570');
    setDepthMm('530');
    setHeights(Object.fromEntries(HARDWARE_KIT_SYSTEM_HEIGHTS.map((h) => [h.code, h.include])));
    setAccessories([]);
    setEligibilityMode('new');
    setEligibilityGroupId('');
    setSkipEligibilityConfirmed(false);
    setFiles({});
    for (const input of Object.values(fileInputsRef.current)) {
      if (input) input.value = '';
    }
  }, []);

  // Máquina compartida con el wizard de kit: cierre en vuelo guardado y
  // reabrir tras «Listo» muestra el formulario limpio, no el resultado viejo.
  const wizard = useKitWizardRun<HardwareKitResult>({ open, onClose, resetForm });

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
        .map((a) => {
          const offsetOf = (side: 'left' | 'right') => ({
            x: Number(a.offsets[side].x) || 0,
            y: Number(a.offsets[side].y) || 0,
            z: Number(a.offsets[side].z) || 0,
          });
          return {
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
            // #1596: offsets explícitos y «Al abrir» declarado — nunca el
            // default invisible del motor ni la inferencia por nombre.
            pieceOffsets: { left: offsetOf('left'), right: offsetOf('right') },
            actorMembership: a.actor,
          };
        })
        .filter((a) => a.suffix !== ''),
    };
  }, [code, name, price, widthMm, depthMm, heights, accessories]);

  // Plan + su problema visible (#1552): los rechazos del planner (cero
  // alturas, medidas, accesorios duplicados) se muestran con role="alert"
  // en vez de borrar la vista previa en silencio. Sin plan no hay submit.
  const planned = useMemo<{ plan: HardwareKitSystemPlan | null; problem: string | null }>(() => {
    if (!systemInput) return { plan: null, problem: null };
    // Dos accesorios con el mismo sufijo generan el mismo código → 409 crudo
    // del servidor; se detecta acá con mensaje amable.
    const suffixCounts = new Map<string, number>();
    for (const acc of systemInput.accessoriesE ?? []) {
      suffixCounts.set(acc.suffix, (suffixCounts.get(acc.suffix) ?? 0) + 1);
    }
    const duplicated = [...suffixCounts.entries()].find(([, count]) => count > 1);
    if (duplicated) {
      return {
        plan: null,
        problem: `Dos accesorios generarían el mismo código (…-${duplicated[0]}): renombrá uno para diferenciarlos.`,
      };
    }
    try {
      return {
        plan: planHardwareKitSystem(systemInput, {
          hardwareCodes: existingHardwareCodes ?? new Set(),
          agregadoCodes: existingAgregadoCodes ?? new Set(),
        }),
        problem: null,
      };
    } catch (err) {
      return {
        plan: null,
        problem:
          err instanceof Error ? err.message : 'El plan no se pudo generar con estos datos.',
      };
    }
  }, [systemInput, existingHardwareCodes, existingAgregadoCodes]);
  const plan = planned.plan;

  const fileKey = (kitCode: string, hand: string, partCode: string): string =>
    `${kitCode}:${hand}:${partCode}`;
  const accFileKey = (accCode: string, anchor: string): string => `${accCode}:${anchor}`;

  const submit = async (): Promise<void> => {
    if (!systemInput || !plan || wizard.running) return;
    if (plan.blockedCode) {
      wizard.setError(`Ya existe un ensamble con el código «${plan.blockedCode}». Cambiá el código del sistema.`);
      return;
    }
    // Subidas pendientes como lista plana: kits por mano + accesorios por ancla.
    const handLabel = (hand: string): string =>
      hand === 'left' ? 'izq' : hand === 'right' ? 'der' : 'centro';
    const tasks: KitWizardRunTask[] = [];
    for (const kit of plan.kits) {
      for (const design of kit.designs) {
        if (!design.handsParts) continue;
        for (const part of design.handsParts) {
          const file = files[fileKey(kit.code, part.hand, design.code)];
          if (!file) continue;
          tasks.push({
            key: fileKey(kit.code, part.hand, design.code),
            file,
            label: `${design.name} — ${handLabel(part.hand)}`,
            displayName: design.name,
          });
        }
      }
    }
    for (const acc of plan.accessories) {
      for (const anchor of acc.anchors) {
        const file = files[accFileKey(acc.code, anchor)];
        if (!file) continue;
        tasks.push({
          key: accFileKey(acc.code, anchor),
          file,
          label: `${acc.name} — ${handLabel(anchor)}`,
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
      // Con uploadDesign ausente la lista de tareas es vacía (guard de
      // arriba): cero subidas, el sistema se crea sin diseños.
      const designs =
        tasks.length > 0 && uploadDesign
          ? await uploadKitWizardDesigns(tasks, uploadDesign, wizard.setProgress)
          : {};
      wizard.setProgress('Creando el sistema…');
      // #1596 decisión 9: la elegibilidad viaja en el MISMO request
      // transaccional; omitir exige confirmar el aviso.
      const eligibilityGroup =
        eligibilityMode === 'skip'
          ? undefined
          : eligibilityMode === 'existing' && eligibilityGroupId
            ? { existingGroupId: eligibilityGroupId }
            : { id: crypto.randomUUID(), code: 'SISTEMA_CAJON', name: 'Sistemas de cajón' };
      const created = await onSubmit({
        input: systemInput,
        designs,
        ...(eligibilityGroup ? { eligibilityGroup } : {}),
      });
      wizard.complete(created);
    } catch (err) {
      wizard.fail(err, 'No se pudo crear el sistema.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={wizard.handleClose}
      title="Nuevo sistema de cajones"
      size="lg"
      dataTestId="hardware-system-wizard-modal"
    >
      {wizard.phase === 'done' && wizard.result ? (
        <div data-testid="hardware-system-wizard-result">
          <p className="catalog-form__section-title">✓ Sistema creado</p>
          <p>
            Filas generadas:{' '}
            {wizard.result.createdCodes.length > 0
              ? wizard.result.createdCodes.join(', ')
              : '—'}
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
          {planned.problem ? (
            <p
              className="catalog-form__error"
              role="alert"
              data-testid="hardware-system-wizard-plan-error"
            >
              {planned.problem}
            </p>
          ) : null}
          {wizard.error ? (
            <p
              className="catalog-form__error"
              role="alert"
              data-testid="hardware-system-wizard-error"
            >
              {wizard.error}
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
              min={0}
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
              min={0}
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
              min={0}
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

                    <fieldset className="catalog-form__section" data-testid="hardware-system-wizard-designs">
            <legend className="catalog-form__section-title">Diseños 3D (opcionales)</legend>
            <p className="catalog-form__hint">
              Un archivo por pieza (.skp). Las piezas sin diseño se ven con la
              representación genérica y podés subir el diseño después desde su
              ficha. Los costados de cada altura nacen en su posición
              canónica Blum: 10 mm el fijo, 35 mm el móvil, medidos del ancho
              del cajón.
            </p>
            {plan?.kits.map((kit) =>
              kit.designs.map((design) =>
                (design.handsParts ?? []).map((part) => {
                  const key = fileKey(kit.code, part.hand, design.code);
                  const slotId = `system-file-${kit.code}-${part.hand}-${design.code}`
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-');
                  const handLabel = part.hand === 'left' ? 'izq' : part.hand === 'right' ? 'der' : 'centro';
                  return (
                    <div className="catalog-form__field" key={key}>
                      <label htmlFor={slotId}>
                        {kit.code} · {design.name.includes('—') ? design.name.split('—')[1]!.trim() : design.name} ({handLabel})
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
                        disabled={design.exists}
                        data-testid={`hardware-system-wizard-file-${key}`}
                      />
                    </div>
                  );
                }),
              ),
            )}
            {plan?.accessories.map((acc) =>
              acc.anchors.map((anchor) => {
                const key = accFileKey(acc.code, anchor);
                const slotId = `system-file-${acc.code}-${anchor}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                const handLabel = anchor === 'left' ? 'izq' : anchor === 'right' ? 'der' : 'centro';
                return (
                  <div className="catalog-form__field" key={key}>
                    <label htmlFor={slotId}>
                      {acc.code} ({handLabel})
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
                      disabled={acc.exists}
                      data-testid={`hardware-system-wizard-file-${key}`}
                    />
                  </div>
                );
              }),
            )}
          </fieldset>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Insertos del cajón E</legend>
            <p className="catalog-form__hint">
              Cada inserto (galería, boxcap, boxcover…) nace como un par con su SKP por
              lado, su posición y su «Al abrir»; queda como opción del selector del cajón E.
            </p>
            {accessories.map((acc, idx) => (
              <div
                key={idx}
                style={{ border: '1px solid var(--border-subtle, #ddd)', borderRadius: 6, padding: 8, marginBottom: 8 }}
                data-testid={`hardware-system-accessory-${idx}`}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
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
                    className="btn btn--small btn--ghost"
                    onClick={() => setAccessories((prev) => prev.filter((_, i) => i !== idx))}
                    data-testid={`hardware-system-accessory-${idx}-remove`}
                  >
                    Quitar
                  </button>
                </div>
                <label className="catalog-form__field">
                  <span>Al abrir</span>
                  <select
                    value={acc.actor}
                    onChange={(e) =>
                      setAccessories((prev) =>
                        prev.map((a, i) =>
                          i === idx ? { ...a, actor: e.target.value as typeof a.actor } : a,
                        ),
                      )
                    }
                    data-testid={`hardware-system-accessory-${idx}-actor`}
                  >
                    <option value="actor:drawer">Viaja con el cajón al abrir</option>
                    <option value="body">Fija al mueble (no se mueve)</option>
                    <option value="actor:door">Viaja con la puerta al abrir</option>
                  </select>
                </label>
                {(['left', 'right'] as const).map((side) => (
                  <div key={side} style={{ marginBottom: 4 }}>
                    <span className="catalog-form__label">
                      Offsets {side === 'left' ? 'izquierda' : 'derecha'} (mm)
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['x', 'y', 'z'] as const).map((axis) => (
                        <input
                          key={axis}
                          type="number"
                          step="0.5"
                          aria-label={`Offset ${axis.toUpperCase()} ${side === 'left' ? 'izq' : 'der'} del inserto ${idx + 1}`}
                          placeholder={axis.toUpperCase()}
                          value={acc.offsets[side][axis]}
                          onChange={(e) =>
                            setAccessories((prev) =>
                              prev.map((a, i) =>
                                i === idx
                                  ? {
                                      ...a,
                                      offsets: {
                                        ...a.offsets,
                                        [side]: { ...a.offsets[side], [axis]: e.target.value },
                                      },
                                    }
                                  : a,
                              ),
                            )
                          }
                          data-testid={`hardware-system-accessory-${idx}-${side}-${axis}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() =>
                setAccessories((prev) => [
                  ...prev,
                  {
                    name: '',
                    actor: 'actor:drawer',
                    offsets: {
                      left: { x: '', y: '', z: '' },
                      right: { x: '', y: '', z: '' },
                    },
                  },
                ])
              }
              data-testid="hardware-system-accessory-add"
            >
              Añadir inserto
            </button>
          </fieldset>

          <fieldset className="catalog-form__section" data-testid="hardware-system-eligibility">
            <legend className="catalog-form__section-title">Elegibilidad del sistema</legend>
            <p className="catalog-form__hint">
              Dónde queda elegible el ensamble del sistema: los módulos lo eligen por
              ese grupo. Sin elegibilidad, el sistema existe pero ningún módulo puede
              montarlo.
            </p>
            <label className="catalog-form__field">
              <span>Grupo de sistemas de cajón</span>
              <select
                value={eligibilityMode === 'existing' ? eligibilityGroupId : ''}
                onChange={(e) => {
                  // Review S4: elegir un grupo limpia la omisión confirmada.
                  setSkipEligibilityConfirmed(false);
                  if (e.target.value) {
                    setEligibilityMode('existing');
                    setEligibilityGroupId(e.target.value);
                  } else {
                    setEligibilityMode('new');
                    setEligibilityGroupId('');
                  }
                }}
                data-testid="hardware-system-eligibility-select"
              >
                <option value="">Crear grupo nuevo «SISTEMA_CAJON»</option>
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
                checked={skipEligibilityConfirmed}
                onChange={(e) => {
                  setSkipEligibilityConfirmed(e.target.checked);
                  if (e.target.checked) setEligibilityMode('skip');
                  else setEligibilityMode('new');
                }}
                data-testid="hardware-system-eligibility-skip"
              />
              <span>Sin elegibilidad ahora — ningún módulo podrá elegir este sistema</span>
            </label>
          </fieldset>


          {plan ? (
            <div className="catalog-hw-wizard__preview" data-testid="hardware-system-wizard-preview">
              <p className="catalog-form__section-title">Se va a crear</p>
              <p>
                {plan.kits.length} juego(s): {plan.kits.map((k) => k.code).join(', ')}
                {plan.accessories.length > 0
                  ? ` + ${plan.accessories.length} inserto(s): ${plan.accessories
                      .map((a) => a.code)
                      .join(', ')}`
                  : ''}{' '}
                + ensamble <strong>{plan.agregado.code}</strong> con variantes de altura (
                {plan.agregado.variants.map((v) => v.heightCode).join('/')})
                {plan.accessoryGroup ? ` + selector ${plan.accessoryGroup.code}` : ''}
                {eligibilityMode === 'skip'
                  ? ' · sin elegibilidad (ningún módulo podrá elegirlo)'
                  : eligibilityMode === 'existing' && eligibilityGroupId
                    ? ` · elegible en el grupo elegido`
                    : ' · elegible en el grupo nuevo SISTEMA_CAJON'}
                .
              </p>
              {plan.blockedCode ? (
                <p
                  className="catalog-form__error"
                  role="alert"
                  data-testid="hardware-system-wizard-blocked"
                >
                  El ensamble «{plan.blockedCode}» ya existe: cambiá el código del sistema.
                </p>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!systemInput || !plan || plan.blockedCode !== null || wizard.running}
              data-testid="hardware-system-wizard-submit"
            >
              {wizard.phase === 'running' ? (wizard.progress ?? 'Creando…') : 'Crear sistema'}
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
