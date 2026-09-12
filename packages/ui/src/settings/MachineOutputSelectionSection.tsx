/**
 * Machine output selection section (#591 / WEB-MFG-2): the Engineering
 * settings card that pins the exact machine/profile/adapter tuple used for
 * NORMAL generation. Presentational — server validates the tuple, the
 * export-layer resolver computes readiness; this component never infers
 * compatibility and never claims VALIDATED.
 */

import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    setMachineId(record?.selection.machineProfileId ?? '');
    setSelectedProfileKey(
      exactPersistedProfile
        ? profileKey(exactPersistedProfile)
        : record
          ? persistedProfileKey(record)
          : '',
    );
  }, [record, exactPersistedProfile]);

  const machine = machines.find((m) => m.machineProfileId === machineId);
  const profile = profiles.find((candidate) => profileKey(candidate) === selectedProfileKey);
  const adapter = profile
    ? catalog.adapters.find((a) => a.producedFormatFamily === profile.formatFamily)
    : undefined;

  const tuple: MachineOutputSelection | null =
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
      : null;

  const configured = resolved?.status === 'CONFIGURED' ? resolved : null;
  const stale = Boolean(
    configured?.readiness.reasons.some((reason) => reason.code === 'PROFILE_DIGEST_MISMATCH'),
  );
  const supportStatus = configured?.supportStatus ?? profile?.supportStatus ?? 'NOT_TESTED';
  const ready = configured?.readiness.ready ?? false;
  const blockerMessage = configured && !ready
    ? machineOutputBlockerMessageEs(configured.readiness.reasons)
    : null;

  const handleSave = async () => {
    if (!tuple) {
      setError('Elegí una máquina y un perfil de salida.');
      return;
    }
    setError(null);
    try {
      await onSave(operation, tuple, record?.version ?? 0);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo guardar la configuración de salida.',
      );
    }
  };

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
        disabled={saving || !tuple}
        data-testid={`machine-output-${operation}-save`}
      >
        {savedFlash ? '✓ Guardado' : 'Guardar configuración'}
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
