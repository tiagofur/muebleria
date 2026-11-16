/**
 * Asistente «Nueva familia de cajón» (#1546 M4 → #1633 s2b): en pasos —
 * Identidad → Alturas → Insertos → Diseños 3D → Resumen — genera la familia
 * completa: un juego multi-diseño por altura (etiqueta libre, altura interior
 * mínima y precio propios), los insertos de cada altura con su selector y UN
 * ensamble con variantes de altura marcado como familia de cajón. El plan del
 * dominio es autoridad: el store lo re-deriva contra el catálogo real antes de
 * persistir. UX Brief: issue #1633.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  planHardwareKitSystem,
  type HardwareKitSystemInput,
  type HardwareKitSystemPlan,
  type HardwareKitResult,
  type HardwareVisualAssetBinding,
} from '@granete/domain';
import { Modal } from '../../common';
import {
  emptyInsertoDraft,
  insertoDraftsToAccessories,
  KitSystemInsertosFieldset,
  type InsertoDraft,
} from './KitSystemInsertosFieldset';
import { uploadKitWizardDesigns, useKitWizardRun, type KitWizardRunTask } from './useKitWizardRun';
import { FamilyWizardSteps } from './familyWizard/FamilyWizardSteps';
import { FamilyHeightsStep } from './familyWizard/FamilyHeightsStep';
import {
  FamilyDesignsStep,
  insertDesignFileKey,
  kitDesignFileKey,
  sideLabel,
} from './familyWizard/FamilyDesignsStep';
import {
  FAMILY_WIZARD_STEPS,
  heightRowsProblem,
  heightRowsToInput,
  identityProblem,
  insertHasHeight,
  insertsProblem,
  insertsWithoutHeights,
  parseMm,
  type FamilyHeightRow,
  type FamilyIdentity,
  type FamilyWizardStep,
} from './familyWizard/familyWizardModel';
import './familyWizard/familyWizard.css';

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
   * servicio de recursos en la sesión igual se puede crear la familia, sólo
   * sin subir diseños (#1552 — antes reventaba con TypeError).
   */
  readonly uploadDesign?: (
    file: File,
    displayName: string,
  ) => Promise<HardwareVisualAssetBinding>;
}

const EMPTY_IDENTITY: FamilyIdentity = { code: '', name: '', brand: '', line: '', widthMm: '570', depthMm: '530' };

export function HardwareKitSystemWizardModal({
  open,
  onClose,
  onSubmit,
  uploadDesign,
  existingHardwareCodes,
  existingAgregadoCodes,
  eligibilityGroups = [],
}: HardwareKitSystemWizardModalProps): ReactNode {
  const [step, setStep] = useState<FamilyWizardStep>(0);
  const [identity, setIdentity] = useState<FamilyIdentity>(EMPTY_IDENTITY);
  const [heightRows, setHeightRows] = useState<FamilyHeightRow[]>([]);
  // Insertos con la forma COMPLETA (#1596: nada a medias) + «Aplica en» y
  // precio (#1633): un herraje por (inserto × altura).
  const [inserts, setInserts] = useState<InsertoDraft[]>([]);
  // #1633: por altura (etiqueta en minúsculas), qué monta el mueble si no
  // elige inserto: la primera opción (default) o ninguno.
  const [insertDefaults, setInsertDefaults] = useState<Record<string, 'first_active' | 'none'>>({});
  // Escape/Cancelar con cambios pide confirmación (el borrador se conserva).
  const [confirmClose, setConfirmClose] = useState(false);
  // #1596 decisión 9: dónde queda disponible el ensamble — grupo existente,
  // grupo nuevo (default SISTEMA_CAJON) u omisión confirmada.
  const [eligibilityMode, setEligibilityMode] = useState<'new' | 'existing' | 'skip'>('new');
  const [eligibilityGroupId, setEligibilityGroupId] = useState('');
  const [skipEligibilityConfirmed, setSkipEligibilityConfirmed] = useState(false);
  const [files, setFiles] = useState<SystemFileBuckets>({});
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const stepTitleRef = useRef<HTMLHeadingElement | null>(null);
  const problemRef = useRef<HTMLParagraphElement | null>(null);
  const movedStep = useRef(false);
  // Pasos donde el usuario ya intentó avanzar: el problema local se muestra
  // recién entonces (no se recibe a nadie con un error antes de escribir).
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(new Set());

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

  // Al cambiar de paso el foco va al título del paso (lector de pantalla y
  // teclado parten del contenido nuevo, no del botón que ya no está).
  useEffect(() => {
    if (movedStep.current) stepTitleRef.current?.focus();
    movedStep.current = false;
  }, [step]);
  const goTo = (next: FamilyWizardStep): void => {
    movedStep.current = true;
    setStep(next);
  };

  // Reset de los campos propios; la máquina de fases la resetea el hook
  // (#1552: antes el modal quedaba en «done» para siempre).
  const resetForm = useCallback(() => {
    setStep(0);
    setAttempted(new Set());
    setIdentity(EMPTY_IDENTITY);
    setHeightRows([]);
    setInserts([]);
    setInsertDefaults({});
    setConfirmClose(false);
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

  const heightLabels = useMemo(
    () => heightRows.map((r) => r.label.trim()).filter(Boolean),
    [heightRows],
  );
  // Review #1636 P1: al renombrar o quitar una altura, los insertos sueltan
  // la etiqueta que ya no existe (no queda una casilla invisible imposible
  // de desmarcar que el plan rechaza).
  useEffect(() => {
    const available = new Set(heightLabels.map((l) => l.toLowerCase()));
    setInserts((prev) => {
      let changed = false;
      const next = prev.map((d) => {
        const kept = (d.heights ?? []).filter((h) => available.has(h.toLowerCase()));
        if (kept.length === (d.heights ?? []).length) return d;
        changed = true;
        return { ...d, heights: kept };
      });
      return changed ? next : prev;
    });
  }, [heightLabels]);
  const problems = useMemo<readonly (string | null)[]>(
    () => [identityProblem(identity), heightRowsProblem(heightRows), insertsProblem(inserts, heightLabels), null, null],
    [identity, heightRows, inserts, heightLabels],
  );
  const localReachable = problems.map((_, i) => problems.slice(0, i).every((p) => p === null));

  const systemInput = useMemo<HardwareKitSystemInput | null>(() => {
    if (problems[0] !== null) return null;
    return {
      code: identity.code.trim(),
      name: identity.name.trim(),
      kitCostPerUnit: 0,
      widthMm: parseMm(identity.widthMm),
      depthMm: parseMm(identity.depthMm),
      ...(identity.brand.trim() ? { brand: identity.brand.trim() } : {}),
      ...(identity.line.trim() ? { line: identity.line.trim() } : {}),
      heights: heightRowsToInput(heightRows, insertDefaults),
      // #1633: un inserto sin alturas es una advertencia y no se crea.
      accessories: insertoDraftsToAccessories(inserts.filter((d) => insertHasHeight(d, heightLabels))),
    };
  }, [problems, identity, heightRows, inserts, insertDefaults, heightLabels]);

  // Plan + su problema visible (#1552): los rechazos del planner se muestran
  // con role="alert"; sin plan no hay envío.
  const planned = useMemo<{ plan: HardwareKitSystemPlan | null; problem: string | null }>(() => {
    if (!systemInput || problems[1] !== null) return { plan: null, problem: null };
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
        problem: err instanceof Error ? err.message : 'El plan no se pudo generar con estos datos.',
      };
    }
  }, [systemInput, problems, existingHardwareCodes, existingAgregadoCodes]);
  const plan = planned.plan;
  // Rechazo del planner atribuible a las ALTURAS (plan sin insertos): frena
  // la salida de Alturas. El del plan completo frena desde Insertos — así un
  // problema de insertos nunca encierra al usuario en Alturas.
  const heightsPlanProblem = useMemo<string | null>(() => {
    if (!systemInput || problems[1] !== null) return null;
    try {
      planHardwareKitSystem(
        { ...systemInput, accessories: [] },
        { hardwareCodes: existingHardwareCodes ?? new Set(), agregadoCodes: existingAgregadoCodes ?? new Set() },
      );
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Las alturas no generan un plan válido.';
    }
  }, [systemInput, problems, existingHardwareCodes, existingAgregadoCodes]);
  const planProblemAt = (i: number): string | null =>
    i === 1 ? heightsPlanProblem : i >= 2 ? planned.problem : null;
  const reachable = localReachable.map(
    (ok, i) => ok && (i < 2 || heightsPlanProblem === null) && (i < 3 || planned.problem === null),
  );
  const complete = problems.map((p, i) => p === null && planProblemAt(i) === null);

  // Un solo mensaje por paso: el problema local del paso actual; si no hay,
  // el del plan (a partir de Alturas, que es donde nace el plan).
  const stepProblem =
    problems[step] !== null ? (attempted.has(step) ? problems[step] : null) : planProblemAt(step);

  const advance = (): void => {
    if (problems[step] !== null || planProblemAt(step) !== null) {
      setAttempted((prev) => new Set(prev).add(step));
      requestAnimationFrame(() => problemRef.current?.focus());
      return;
    }
    goTo((step + 1) as FamilyWizardStep);
  };

  const setFile = (key: string, file: File | null): void =>
    setFiles((prev) => {
      const next = { ...prev };
      if (file) next[key] = file;
      else delete next[key];
      return next;
    });

  const submit = async (): Promise<void> => {
    if (!systemInput || !plan || wizard.running) return;
    if (plan.blockedCode) {
      wizard.setError(`Ya existe un ensamble con el código «${plan.blockedCode}». Cambiá el código de la familia.`);
      return;
    }
    // Subidas pendientes como lista plana: juegos por lado + insertos por ancla.
    const tasks: KitWizardRunTask[] = [];
    for (const kit of plan.kits) {
      for (const design of kit.designs) {
        for (const part of design.handsParts ?? []) {
          const key = kitDesignFileKey(kit.code, part.hand, design.code);
          const file = files[key];
          if (!file) continue;
          tasks.push({ key, file, label: `${design.name} — ${sideLabel(part.hand)}`, displayName: design.name });
        }
      }
    }
    for (const acc of plan.accessories) {
      for (const anchor of acc.anchors) {
        const key = insertDesignFileKey(acc.code, anchor);
        const file = files[key];
        if (!file) continue;
        tasks.push({ key, file, label: `${acc.name} — ${sideLabel(anchor)}`, displayName: acc.name });
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
          : {};
      wizard.setProgress('Creando la familia…');
      // #1596 decisión 9: la disponibilidad viaja en el MISMO request
      // transaccional; omitirla exige confirmar el aviso.
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
      wizard.fail(err, 'No se pudo crear la familia.');
    }
  };

  const dirty =
    identity.code.trim() !== '' ||
    identity.name.trim() !== '' ||
    identity.brand.trim() !== '' ||
    identity.line.trim() !== '' ||
    heightRows.length > 0 ||
    inserts.length > 0;
  const requestClose = (): void => {
    if (wizard.phase === 'done' || wizard.running || !dirty) {
      wizard.handleClose();
      return;
    }
    setConfirmClose(true);
  };
  const withoutHeights = insertsWithoutHeights(inserts, heightLabels);
  const heightsWithInserts = heightLabels.filter((l) =>
    inserts.some((d) => d.name.trim() && (d.heights ?? []).some((h) => h.toLowerCase() === l.toLowerCase())),
  );

  const isLast = step === FAMILY_WIZARD_STEPS.length - 1;
  const canSubmit = !!systemInput && !!plan && plan.blockedCode === null && !wizard.running;

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Nueva familia de cajón"
      size="lg"
      dataTestId="hardware-system-wizard-modal"
    >
      {wizard.phase === 'done' && wizard.result ? (
        <div data-testid="hardware-system-wizard-result">
          <p className="catalog-form__section-title">✓ Familia creada</p>
          <p>
            Registros creados:{' '}
            {wizard.result.createdCodes.length > 0 ? wizard.result.createdCodes.join(', ') : '—'}
          </p>
          <button type="button" className="btn btn--primary" onClick={wizard.handleClose}>
            Listo
          </button>
        </div>
      ) : (
        <form
          className="catalog-form"
          // Los mensajes del asistente son la validación (enseñan qué falta);
          // la nativa del navegador bloquearía el envío sin explicarlo.
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) void submit();
            else advance();
          }}
        >
          {confirmClose ? (
            <div className="family-wizard__confirm" role="alert" data-testid="family-wizard-close-confirm">
              <span>Tenés cambios sin crear. Si cerrás, el borrador se conserva al volver a abrir.</span>
              <button
                type="button"
                className="btn btn--small"
                autoFocus
                onClick={() => setConfirmClose(false)}
                data-testid="family-wizard-close-keep"
              >
                Seguir editando
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => {
                  setConfirmClose(false);
                  wizard.handleClose();
                }}
                data-testid="family-wizard-close-confirm-close"
              >
                Cerrar
              </button>
            </div>
          ) : null}
          <FamilyWizardSteps current={step} reachable={reachable} complete={complete} onSelect={goTo} />
          <h3 className="family-wizard__step-title" tabIndex={-1} ref={stepTitleRef} data-testid="family-wizard-title">
            {FAMILY_WIZARD_STEPS[step]}
          </h3>

          {stepProblem ? (
            <p
              className="catalog-form__error"
              role="alert"
              tabIndex={-1}
              ref={problemRef}
              data-testid="hardware-system-wizard-plan-error"
            >
              {stepProblem}
            </p>
          ) : null}
          {wizard.error ? (
            <p className="catalog-form__error" role="alert" data-testid="hardware-system-wizard-error">
              {wizard.error}
            </p>
          ) : null}

          {step === 0 ? (
            <>
              {/* #1643: campos pares a dos columnas — el paso Identidad deja
                  de ser una columna larga con vacío a la derecha. */}
              <div className="catalog-form__row">
                <div className="catalog-form__field">
                  <label htmlFor="system-code">Código de la familia</label>
                  <input
                    id="system-code"
                    value={identity.code}
                    onChange={(e) => setIdentity((p) => ({ ...p, code: e.target.value }))}
                    placeholder="Ej: MBOX-IRIDIUM"
                    autoComplete="off"
                    data-testid="hardware-system-wizard-code"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="system-name">Nombre</label>
                  <input
                    id="system-name"
                    value={identity.name}
                    onChange={(e) => setIdentity((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Ej: Merivobox Iridium"
                    data-testid="hardware-system-wizard-name"
                  />
                </div>
              </div>
              <div className="catalog-form__row">
                <div className="catalog-form__field">
                  <label htmlFor="system-brand">Marca (opcional)</label>
                  <input
                    id="system-brand"
                    value={identity.brand}
                    onChange={(e) => setIdentity((p) => ({ ...p, brand: e.target.value }))}
                    placeholder="Ej: Blum, Hettich, Häfele"
                    maxLength={80}
                    data-testid="hardware-system-wizard-brand"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="system-line">Línea (opcional)</label>
                  <input
                    id="system-line"
                    value={identity.line}
                    onChange={(e) => setIdentity((p) => ({ ...p, line: e.target.value }))}
                    placeholder="Ej: Merivobox, Legrabox"
                    maxLength={80}
                    data-testid="hardware-system-wizard-line"
                  />
                </div>
              </div>
              <div className="catalog-form__row">
                <div className="catalog-form__field">
                  <label htmlFor="system-width">Ancho de la guía (mm)</label>
                  <input
                    id="system-width"
                    type="number"
                    min={0}
                    value={identity.widthMm}
                    onChange={(e) => setIdentity((p) => ({ ...p, widthMm: e.target.value }))}
                    data-testid="hardware-system-wizard-width"
                  />
                </div>
                <div className="catalog-form__field">
                  <label htmlFor="system-depth">Fondo de la guía (mm)</label>
                  <input
                    id="system-depth"
                    type="number"
                    min={0}
                    value={identity.depthMm}
                    onChange={(e) => setIdentity((p) => ({ ...p, depthMm: e.target.value }))}
                    data-testid="hardware-system-wizard-depth"
                  />
                </div>
              </div>
            </>
          ) : null}

          {step === 1 ? <FamilyHeightsStep rows={heightRows} onChange={setHeightRows} /> : null}

          {step === 2 ? (
            <KitSystemInsertosFieldset
              drafts={inserts}
              onChange={setInserts}
              legend="Insertos de la familia"
              hint="Galería, boxcap, boxcover… Marcá en qué alturas se ofrece cada uno: cada altura tiene su propia pieza y su selector. El primero de cada altura es el que se usa por defecto (ordená con Subir/Bajar). Sin insertos, la familia igual se crea."
              testIdPrefix="hardware-system-accessory"
              heightOptions={heightLabels}
              newDraft={() => ({
                ...emptyInsertoDraft(),
                // Preselecciona la altura más alta (donde suelen ir los insertos).
                heights: heightLabels.length > 0 ? [heightLabels[heightLabels.length - 1]!] : [],
                price: '',
              })}
            />
          ) : null}
          {step === 2 && withoutHeights.length > 0 ? (
            <p className="family-insert__warning" role="status" data-testid="family-inserts-without-heights">
              {withoutHeights.map((n) => `«${n}»`).join(', ')} no se ofrece{withoutHeights.length > 1 ? 'n' : ''} en
              ninguna altura: no se va a crear. Marcá al menos una altura para incluirlo.
            </p>
          ) : null}
          {step === 2 && heightsWithInserts.length > 0 ? (
            <fieldset className="catalog-form__section" data-testid="family-insert-defaults">
              <legend className="catalog-form__section-title">Si el mueble no elige un inserto</legend>
              {heightsWithInserts.map((label) => (
                <label key={label} className="catalog-form__field">
                  <span>Altura {label}</span>
                  <select
                    value={insertDefaults[label.toLowerCase()] ?? 'first_active'}
                    onChange={(e) =>
                      setInsertDefaults((prev) => ({
                        ...prev,
                        [label.toLowerCase()]: e.target.value as 'first_active' | 'none',
                      }))
                    }
                    data-testid={`family-insert-default-${label}`}
                  >
                    <option value="first_active">Se usa el primero de la lista</option>
                    <option value="none">Sin inserto</option>
                  </select>
                </label>
              ))}
            </fieldset>
          ) : null}

          {step === 3 ? (
            <FamilyDesignsStep plan={plan} files={files} setFile={setFile} fileInputsRef={fileInputsRef} />
          ) : null}

          {step === 4 ? (
            <>
              <fieldset className="catalog-form__section" data-testid="hardware-system-eligibility">
                <legend className="catalog-form__section-title">Disponible en</legend>
                <p className="catalog-form__hint">
                  Los muebles eligen el cajón dentro de este grupo. Sin grupo, la familia existe pero
                  ningún mueble puede usarla.
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
                    <option value="">Crear grupo nuevo «Sistemas de cajón»</option>
                    {eligibilityGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="family-insert__chip">
                  <input
                    type="checkbox"
                    checked={skipEligibilityConfirmed}
                    onChange={(e) => {
                      setSkipEligibilityConfirmed(e.target.checked);
                      setEligibilityMode(e.target.checked ? 'skip' : 'new');
                    }}
                    data-testid="hardware-system-eligibility-skip"
                  />
                  <span>Todavía no — ningún mueble podrá usar esta familia</span>
                </label>
              </fieldset>

              {plan ? (
                <div className="catalog-hw-wizard__preview" data-testid="hardware-system-wizard-preview">
                  <p className="catalog-form__section-title">Se va a crear</p>
                  <ul className="family-summary__list">
                    <li>
                      {plan.kits.length} juego(s): {plan.kits.map((k) => `${k.code} (${k.heightCode})`).join(', ')}
                    </li>
                    {plan.accessories.length > 0 ? (
                      <li>
                        {plan.accessories.length} inserto(s): {plan.accessories.map((a) => a.code).join(', ')}
                      </li>
                    ) : null}
                    {plan.accessoryGroups.length > 0 ? (
                      <li>
                        Selector de insertos en:{' '}
                        {plan.accessoryGroups
                          .map((g) => `${g.name.replace(/^Insertos /, '')}${g.defaultChoice === 'none' ? ' (sin inserto por defecto)' : ''}`)
                          .join(', ')}
                      </li>
                    ) : null}
                    <li>
                      Ensamble <strong>{plan.agregado.code}</strong> con alturas{' '}
                      {plan.agregado.variants.map((v) => v.label).join(' / ')}
                    </li>
                    <li>
                      {eligibilityMode === 'skip'
                        ? 'Sin grupo: ningún mueble podrá usarla todavía'
                        : eligibilityMode === 'existing' && eligibilityGroupId
                          ? 'Disponible en el grupo elegido'
                          : 'Disponible en el grupo nuevo «Sistemas de cajón»'}
                    </li>
                  </ul>
                  {plan.blockedCode ? (
                    <p className="catalog-form__error" role="alert" data-testid="hardware-system-wizard-blocked">
                      El ensamble «{plan.blockedCode}» ya existe: cambiá el código de la familia.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="family-wizard__footer">
            <button type="button" className="btn btn--ghost" onClick={requestClose}>
              Cancelar
            </button>
            <div className="family-wizard__footer-end">
              {step > 0 ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => goTo((step - 1) as FamilyWizardStep)}
                  disabled={wizard.running}
                  data-testid="family-wizard-back"
                >
                  Atrás
                </button>
              ) : null}
              {isLast ? (
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={!canSubmit}
                  data-testid="hardware-system-wizard-submit"
                >
                  {wizard.phase === 'running' ? (wizard.progress ?? 'Creando…') : 'Crear familia'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={wizard.running}
                  data-testid="family-wizard-next"
                >
                  Siguiente
                </button>
              )}
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
