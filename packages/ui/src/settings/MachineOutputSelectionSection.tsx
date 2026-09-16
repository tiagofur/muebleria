/**
 * Machine output selection section (#591 / WEB-MFG-2): the Engineering
 * settings card that pins the exact machine/profile/adapter tuple used for
 * NORMAL generation. Presentational — server validates the tuple, the
 * export-layer resolver computes readiness; this component never infers
 * compatibility and never claims VALIDATED.
 *
 * A complete selection that differs from the persisted record auto-saves
 * (debounced): leaving the screen must never drop a chosen tuple.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MachineOutputSelection,
  MachineOutputSelectionRecord,
  ManufacturingOperation,
  ResolvedManufacturingOutputTarget,
} from '@granete/domain';
import { machineOutputBlockerMessageEs } from '@granete/domain';
import './settings.css';

export interface MachineOutputCatalogView {
  readonly formatFamilyOperations: Record<string, readonly string[]>;
  readonly machines: readonly {
    machineProfileId: string;
    machineProfileRevisionId: string;
    manufacturerFamily: string;
    model: string;
    role: string;
    operations: readonly string[];
    supportStatus: string;
    provenance: string;
  }[];
  readonly outputProfiles: readonly {
    outputCompatibilityProfileId: string;
    revisionId: string;
    formatFamily: string;
    supportStatus: string;
    digest: string;
  }[];
  readonly adapters: readonly {
    postprocessorAdapterId: string;
    adapterVersion: string;
    implementationDigest: string;
    producedFormatFamily: string;
    serializerImplemented: boolean;
  }[];
}

export interface MachineOutputConfigProps {
  /** Null while the read model failed to load — the section stays visible. */
  readonly catalog: MachineOutputCatalogView | null;
  readonly loadError?: string | null;
  readonly onRetry?: () => void;
  readonly selections: Partial<
    Record<ManufacturingOperation, MachineOutputSelectionRecord | undefined>
  >;
  readonly resolved: Partial<
    Record<ManufacturingOperation, ResolvedManufacturingOutputTarget | undefined>
  >;
  readonly onSave: (
    operation: ManufacturingOperation,
    selection: MachineOutputSelection,
    expectedVersion: number,
  ) => Promise<void>;
  readonly saving?: boolean;
}

const OPERATION_LABELS: Record<ManufacturingOperation, string> = {
  cutting: 'Corte',
  machining: 'CNC / mecanizado',
};

function profileHumanLabel(profileId: string, family: string): string {
  if (profileId === 'ptx-generic') return 'PTX (dialecto Granete)';
  if (profileId.startsWith('ptx-cadmatic-')) return `PTX · CADmatic ${profileId.slice(-1)}`;
  if (profileId === 'saw-homag') return `SAW (HOMAG) · ${family.toUpperCase()}`;
  if (profileId === 'mpr-woodwop') return 'MPR · woodWOP';
  return `${profileId} (${family})`;
}

function profileKey(profile: MachineOutputCatalogView['outputProfiles'][number]): string {
  return `${profile.outputCompatibilityProfileId}@${profile.revisionId}#${profile.digest}`;
}

function persistedProfileKey(record: MachineOutputSelectionRecord): string {
  const selection = record.selection;
  return `historical:${selection.outputCompatibilityProfileId}@${selection.outputCompatibilityProfileRevisionId}#${selection.outputCompatibilityProfileDigest ?? 'unpinned'}`;
}

function sameMachineOutputSelection(
  a: MachineOutputSelection,
  b: MachineOutputSelection,
): boolean {
  return (
    a.operation === b.operation &&
    a.machineProfileId === b.machineProfileId &&
    a.machineProfileRevisionId === b.machineProfileRevisionId &&
    a.outputCompatibilityProfileId === b.outputCompatibilityProfileId &&
    a.outputCompatibilityProfileRevisionId === b.outputCompatibilityProfileRevisionId &&
    a.outputCompatibilityProfileDigest === b.outputCompatibilityProfileDigest &&
    a.postprocessorAdapterId === b.postprocessorAdapterId &&
    a.postprocessorAdapterVersion === b.postprocessorAdapterVersion &&
    a.postprocessorImplementationDigest === b.postprocessorImplementationDigest
  );
}

function machineOutputSelectionKey(selection: MachineOutputSelection): string {
  return [
    selection.operation,
    selection.machineProfileId,
    selection.machineProfileRevisionId,
    selection.outputCompatibilityProfileId,
    selection.outputCompatibilityProfileRevisionId,
    selection.outputCompatibilityProfileDigest ?? 'unpinned',
    selection.postprocessorAdapterId,
    selection.postprocessorAdapterVersion,
    selection.postprocessorImplementationDigest,
  ].join('|');
}

/** Debounce before the auto-save PUT: lets rapid dropdown changes settle. */
const AUTO_SAVE_DEBOUNCE_MS = 600;

const SUPPORT_LABELS: Record<string, string> = {
  // NOT_TESTED is deliberately explicit: serializing a candidate never
  // promotes a compatibility claim — the workshop reads "candidate, not
  // validated on the machine", never "compatible/validado".
  NOT_TESTED: 'Candidato — no validado en máquina',
  PARTIAL: 'Parcial',
  VALIDATED: 'Validado',
  UNSUPPORTED: 'No soportado',
};

function MachineOutputOperationCard({
  operation,
  catalog,
  record,
  resolved,
  onSave,
  saving,
}: {
  operation: ManufacturingOperation;
  catalog: MachineOutputCatalogView;
  record?: MachineOutputSelectionRecord;
  resolved?: ResolvedManufacturingOutputTarget;
  onSave: MachineOutputConfigProps['onSave'];
  saving?: boolean;
}) {
  const machines = catalog.machines.filter((m) => m.operations.includes(operation));
  const families = Object.entries(catalog.formatFamilyOperations)
    .filter(([, ops]) => ops.includes(operation))
    .map(([family]) => family);
  const profiles = catalog.outputProfiles.filter((p) => families.includes(p.formatFamily));

  const [machineId, setMachineId] = useState(record?.selection.machineProfileId ?? '');
  const exactPersistedProfile = record
    ? profiles.find(
        (profile) =>
          profile.outputCompatibilityProfileId === record.selection.outputCompatibilityProfileId &&
          profile.revisionId === record.selection.outputCompatibilityProfileRevisionId &&
          profile.digest === record.selection.outputCompatibilityProfileDigest,
      )
    : undefined;
  const [selectedProfileKey, setSelectedProfileKey] = useState(
    exactPersistedProfile
      ? profileKey(exactPersistedProfile)
      : record
        ? persistedProfileKey(record)
        : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [savingNow, setSavingNow] = useState(false);
  const savingRef = useRef(false);

  const machine = machines.find((m) => m.machineProfileId === machineId);
  const profile = profiles.find((candidate) => profileKey(candidate) === selectedProfileKey);
  const adapter = profile
    ? catalog.adapters.find((a) => a.producedFormatFamily === profile.formatFamily)
    : undefined;

  const tuple = useMemo<MachineOutputSelection | null>(
    () =>
      machine && profile && adapter
        ? {
            operation,
            machineProfileId: machine.machineProfileId,
            machineProfileRevisionId: machine.machineProfileRevisionId,
            outputCompatibilityProfileId: profile.outputCompatibilityProfileId,
            outputCompatibilityProfileRevisionId: profile.revisionId,
            outputCompatibilityProfileDigest: profile.digest,
            postprocessorAdapterId: adapter.postprocessorAdapterId,
            postprocessorAdapterVersion: adapter.adapterVersion,
            postprocessorImplementationDigest: adapter.implementationDigest,
          }
        : null,
    [operation, machine, profile, adapter],
  );
  // Dirty = a complete tuple the server has not confirmed yet. Historical
  // pins (profile outside the catalog) never produce a tuple, so they stay
  // explicit re-selections by design.
  const dirty = useMemo(
    () => Boolean(tuple && (!record || !sameMachineOutputSelection(tuple, record.selection))),
    [tuple, record],
  );

  useEffect(() => {
    // While the user holds unsaved local changes, their selection wins over
    // incoming record refreshes; syncing here would clobber what they chose.
    if (dirty) return;
    setMachineId(record?.selection.machineProfileId ?? '');
    setSelectedProfileKey(
      exactPersistedProfile
        ? profileKey(exactPersistedProfile)
        : record
          ? persistedProfileKey(record)
          : '',
    );
  }, [record, exactPersistedProfile, dirty]);

  const configured = resolved?.status === 'CONFIGURED' ? resolved : null;
  const stale = Boolean(
    configured?.readiness.reasons.some((reason) => reason.code === 'PROFILE_DIGEST_MISMATCH'),
  );
  const supportStatus = configured?.supportStatus ?? profile?.supportStatus ?? 'NOT_TESTED';
  const ready = configured?.readiness.ready ?? false;
  const blockerMessage = configured && !ready
    ? machineOutputBlockerMessageEs(configured.readiness.reasons)
    : null;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // One save attempt per settled tuple: the explicit button and the debounced
  // auto-save share this so a click right after a change never double-PUTs.
  const attemptedTupleKeyRef = useRef<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const handleSave = async () => {
    if (!tuple) {
      setError('Elegí una máquina y un perfil de salida.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingNow(true);
    setError(null);
    try {
      await onSaveRef.current(operation, tuple, record?.version ?? 0);
      attemptedTupleKeyRef.current = machineOutputSelectionKey(tuple);
      setSavedFlash(true);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      attemptedTupleKeyRef.current = machineOutputSelectionKey(tuple);
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo guardar la configuración de salida.',
      );
    } finally {
      savingRef.current = false;
      setSavingNow(false);
    }
  };
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // Auto-save: the user's mental model is "elegí máquina y perfil → quedó
  // guardado". Fires once per settled tuple; failures stay inline for an
  // explicit retry and never loop.
  useEffect(() => {
    if (!dirty || !tuple) return;
    if (attemptedTupleKeyRef.current === machineOutputSelectionKey(tuple)) return;
    const timer = window.setTimeout(() => {
      if (!savingRef.current) void handleSaveRef.current();
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, tuple]);

  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

  return (
    <section className="machine-output-card" data-testid={`machine-output-${operation}`}>
      <h4>{OPERATION_LABELS[operation]}</h4>
      <div className="machine-output-row">
        <label>
          Máquina
          <select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            data-testid={`machine-output-${operation}-machine`}
          >
            <option value="">— Sin configurar —</option>
            {machines.map((m) => (
              <option key={m.machineProfileId} value={m.machineProfileId}>
                {m.manufacturerFamily} {m.model}
              </option>
            ))}
          </select>
        </label>
        <label>
          Software / perfil de salida
          <select
            value={selectedProfileKey}
            onChange={(e) => setSelectedProfileKey(e.target.value)}
            data-testid={`machine-output-${operation}-profile`}
          >
            <option value="">— Sin configurar —</option>
            {record && !exactPersistedProfile ? (
              <option value={persistedProfileKey(record)} disabled>
                {record.selection.outputCompatibilityProfileId}@{record.selection.outputCompatibilityProfileRevisionId} · desactualizada
              </option>
            ) : null}
            {profiles.map((p) => (
              <option key={profileKey(p)} value={profileKey(p)}>
                {profileHumanLabel(p.outputCompatibilityProfileId, p.formatFamily)} · {p.revisionId}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="machine-output-autosave" data-testid={`machine-output-${operation}-autosave`}>
        {savingNow
          ? 'Guardando…'
          : dirty
            ? 'Sin guardar — se guarda solo al completar máquina y perfil.'
            : 'La combinación elegida queda guardada para este taller.'}
      </p>
      {profile && adapter ? (
        <dl className="machine-output-meta">
          <div>
            <dt>Salida</dt>
            <dd>{profile.formatFamily.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Adapter</dt>
            <dd>
              {adapter.postprocessorAdapterId} · {adapter.adapterVersion}
            </dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd data-testid={`machine-output-${operation}-status`}>
              {SUPPORT_LABELS[supportStatus] ?? supportStatus}
            </dd>
          </div>
          <div>
            <dt>Generación</dt>
            <dd data-testid={`machine-output-${operation}-readiness`}>
              {stale
                ? 'Desactualizada'
                : configured && !ready
                  ? 'Bloqueado'
                  : record
                    ? 'Configurada'
                    : '—'}
            </dd>
          </div>
        </dl>
      ) : record && stale ? (
        <dl className="machine-output-meta">
          <div>
            <dt>Perfil guardado</dt>
            <dd>{record.selection.outputCompatibilityProfileId}@{record.selection.outputCompatibilityProfileRevisionId}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd data-testid={`machine-output-${operation}-status`}>Desactualizada</dd>
          </div>
          <div>
            <dt>Versión vigente</dt>
            <dd>
              {profiles.find((candidate) =>
                candidate.outputCompatibilityProfileId === record.selection.outputCompatibilityProfileId,
              )?.revisionId ?? 'No disponible'}
            </dd>
          </div>
        </dl>
      ) : null}
      {blockerMessage ? (
        <p className="machine-output-blocked" role="alert" data-testid={`machine-output-${operation}-blocked`}>
          {blockerMessage}
        </p>
      ) : null}
      {stale ? (
        <p className="machine-output-intro">
          Seleccioná explícitamente la versión vigente y guardá para actualizar este pin.
        </p>
      ) : null}
      {record ? (
        <details className="machine-output-tech">
          <summary>Detalle técnico</summary>
          <ul>
            <li>machine: {record.selection.machineProfileId}@{record.selection.machineProfileRevisionId}</li>
            <li>profile: {record.selection.outputCompatibilityProfileId}@{record.selection.outputCompatibilityProfileRevisionId}</li>
            <li>profile digest: {record.selection.outputCompatibilityProfileDigest ?? 'histórico sin pin'}</li>
            <li>adapter: {record.selection.postprocessorAdapterId}@{record.selection.postprocessorAdapterVersion}</li>
            <li>adapter digest: {record.selection.postprocessorImplementationDigest}</li>
            {configured?.readiness.reasons.map((reason) => (
              <li key={`${reason.code}:${reason.detail}`}>blocker: {reason.code}</li>
            ))}
            <li>versión: {record.version}</li>
          </ul>
        </details>
      ) : null}
      {error ? <p className="machine-output-error" role="alert">{error}</p> : null}
      <button
        type="button"
        className="btn-primary"
        onClick={handleSave}
        disabled={saving || savingNow || !tuple}
        data-testid={`machine-output-${operation}-save`}
      >
        {savingNow ? 'Guardando…' : savedFlash ? '✓ Guardado' : 'Guardar configuración'}
      </button>
    </section>
  );
}

export function MachineOutputSelectionSection(props: MachineOutputConfigProps): React.ReactNode {
  const operations = useMemo<ManufacturingOperation[]>(
    () => ['cutting', 'machining'],
    [],
  );
  return (
    <div className="machine-output-section">
      <p className="machine-output-intro">
        La generación normal usa exactamente esta combinación elegida por operación. Los
        paquetes de validación de campo pueden evaluar varios formatos; la producción nunca
        genera candidatos en bulk ni sustituye un perfil bloqueado.
      </p>
      {props.loadError ? (
        <div
          className="machine-output-blocked"
          role="alert"
          data-testid="machine-output-load-error"
        >
          <p style={{ margin: 0 }}>{props.loadError}</p>
          {props.onRetry ? (
            <button
              type="button"
              onClick={props.onRetry}
              data-testid="machine-output-retry"
              style={{ marginTop: 8 }}
            >
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}
      {(() => {
        const catalog = props.catalog;
        if (!catalog) {
          return !props.loadError ? (
            <p className="machine-output-intro">Cargando configuración de salida…</p>
          ) : null;
        }
        return operations.map((operation) => (
          <MachineOutputOperationCard
            key={operation}
            operation={operation}
            catalog={catalog}
              record={props.selections[operation]}
              resolved={props.resolved[operation]}
            onSave={props.onSave}
            saving={props.saving}
          />
        ));
      })()}
    </div>
  );
}
