/**
 * Machine-output selection state for the export/machine panels (#691, #1005
 * K3; extracted from AppContent by R5 #1066). Owns the scoped read-model
 * load, the cutting/machining selection resolution, the Optimización target
 * summaries and the server-authoritative save/refresh. The body moved
 * verbatim from AppContent — the caller only passes session identity and
 * repository access.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  machineOutputBlockerMessageEs,
  type CutPlan,
  type MachineOutputSelection,
  type MachineOutputSelectionRecord,
  type ManufacturingOperation,
  type ResolvedManufacturingOutputTarget,
} from '@granete/domain';
import {
  evaluateSelectedCuttingOutputReadiness,
  resolveManufacturingOutputTarget,
} from '@granete/excel';
import type { APIWorkspaceRepository, WorkspaceRepository } from '@granete/storage';
import type { CuttingOutputTargetView } from '@granete/ui';
import { sessionScopeKey } from '../shared/query/sessionScope';
import type { SessionMode } from '../session';
import { useWorkspaceStore } from '../stores';
import {
  forCurrentMachineOutputScope,
  isCurrentMachineOutputRequest,
  type CuttingOutputSelectionState,
} from './cuttingOutputAuthority';

export function useMachineOutputSelections({
  session,
  authToken,
  authUserSeq,
  getRepository,
}: {
  readonly session: SessionMode;
  readonly authToken: string | null;
  readonly authUserSeq: number;
  readonly getRepository: () => WorkspaceRepository;
}) {
  const sessionScope = useWorkspaceStore((st) => st.sessionScope);
  const machineOutputScopeKey = useMemo(
    () =>
      session === 'guest'
        ? 'guest'
        : sessionScope
          ? JSON.stringify(sessionScopeKey(sessionScope))
          : null,
    [session, sessionScope],
  );
  // #691 — preserve request truth. A successful empty response is the ONLY
  // state that can authorize the historical legacy PTX path.
  const [machineOutputRequestState, setMachineOutputRequestState] = useState<
    | { readonly status: 'loading'; readonly scopeKey: string | null }
    | { readonly status: 'error'; readonly scopeKey: string; readonly error: string }
    | {
        readonly status: 'loaded';
        readonly scopeKey: string;
        readonly model:
          | Awaited<ReturnType<APIWorkspaceRepository['getMachineOutputSelections']>>
          | null;
      }
  >({ status: 'loading', scopeKey: null });
  const [machineOutputReloadKey, setMachineOutputReloadKey] = useState(0);
  useEffect(() => {
    if (session === 'guest') {
      setMachineOutputRequestState({ status: 'loaded', scopeKey: 'guest', model: null });
      return;
    }
    if (!authToken || !machineOutputScopeKey) {
      setMachineOutputRequestState({ status: 'loading', scopeKey: machineOutputScopeKey });
      return;
    }
    const requestedScopeKey = machineOutputScopeKey;
    let cancelled = false;
    const repository = getRepository();
    if (typeof repository.getMachineOutputSelections !== 'function') {
      setMachineOutputRequestState({
        status: 'error',
        scopeKey: requestedScopeKey,
        error: 'La configuración de salida de máquina requiere modo servidor.',
      });
      return;
    }
    setMachineOutputRequestState({ status: 'loading', scopeKey: requestedScopeKey });
    const requestIsCurrent = (): boolean => {
      if (cancelled) return false;
      const current = useWorkspaceStore.getState();
      const currentScope = current.sessionScope;
      return Boolean(
        current.session === 'auth' &&
        currentScope !== null &&
        isCurrentMachineOutputRequest(
          requestedScopeKey,
          JSON.stringify(sessionScopeKey(currentScope)),
        )
      );
    };
    repository
      .getMachineOutputSelections()
      .then((model) => {
        if (requestIsCurrent()) {
          setMachineOutputRequestState({
            status: 'loaded',
            scopeKey: requestedScopeKey,
            model,
          });
        }
      })
      .catch(() => {
        if (requestIsCurrent()) {
          setMachineOutputRequestState({
            status: 'error',
            scopeKey: requestedScopeKey,
            error:
              'No se pudo cargar la configuración de salida de máquina. Verificá tu conexión o permisos y reintentá.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    session,
    authToken,
    getRepository,
    authUserSeq,
    machineOutputReloadKey,
    machineOutputScopeKey,
  ]);
  const refreshMachineOutput = useCallback(() => {
    setMachineOutputReloadKey((key) => key + 1);
  }, []);
  // Scope mismatch is loading immediately during render. Waiting for the
  // effect cleanup would leave one render where org A could govern org B.
  const currentMachineOutputRequestState =
    machineOutputRequestState.scopeKey === machineOutputScopeKey
      ? machineOutputRequestState
      : ({ status: 'loading', scopeKey: machineOutputScopeKey } as const);
  const machineOutputReadModel =
    currentMachineOutputRequestState.status === 'loaded'
      ? currentMachineOutputRequestState.model
      : null;
  const machineOutputLoadError =
    currentMachineOutputRequestState.status === 'error'
      ? currentMachineOutputRequestState.error
      : null;
  const machineOutputSelections = useMemo(() => {
    const map: Partial<
      Record<'cutting' | 'machining', MachineOutputSelectionRecord | undefined>
    > = {};
    for (const entry of machineOutputReadModel?.selections ?? []) {
      map[entry.selection.selection.operation] = entry.selection;
    }
    return map;
  }, [machineOutputReadModel]);
  const machineOutputResolved = useMemo(() => {
    const map: Partial<
      Record<'cutting' | 'machining', ResolvedManufacturingOutputTarget | undefined>
    > = {};
    for (const operation of ['cutting', 'machining'] as const) {
      const record = machineOutputSelections[operation];
      map[operation] = resolveManufacturingOutputTarget(
        record?.selection,
        operation,
      );
    }
    return map;
  }, [machineOutputSelections]);
  const cuttingOutputSelectionState = useMemo<CuttingOutputSelectionState>(() => {
    let state: CuttingOutputSelectionState;
    if (currentMachineOutputRequestState.status === 'loading') {
      state = {
        status: 'loading',
        scopeKey: currentMachineOutputRequestState.scopeKey,
      };
    } else if (currentMachineOutputRequestState.status === 'error') {
      state = {
        status: 'error',
        scopeKey: currentMachineOutputRequestState.scopeKey,
        error: currentMachineOutputRequestState.error,
      };
    } else {
      const record = machineOutputSelections.cutting;
      const resolved = machineOutputResolved.cutting;
      if (!record) {
        state = { status: 'empty', scopeKey: currentMachineOutputRequestState.scopeKey };
      } else if (
        resolved?.status === 'CONFIGURED' &&
        resolved.readiness.ready
      ) {
        state = {
          status: 'configured',
          scopeKey: currentMachineOutputRequestState.scopeKey,
          selection: record.selection,
        };
      } else {
        state = {
          status: 'blocked',
          scopeKey: currentMachineOutputRequestState.scopeKey,
          selection: record.selection,
          reason:
            resolved?.status === 'CONFIGURED'
              ? machineOutputBlockerMessageEs(resolved.readiness.reasons)
              : 'La selección de salida de corte no coincide con el catálogo vigente.',
        };
      }
    }
    return forCurrentMachineOutputScope(state, machineOutputScopeKey);
  }, [
    currentMachineOutputRequestState,
    machineOutputSelections,
    machineOutputResolved,
    machineOutputScopeKey,
  ]);
  // #1005 K3 — machining twin of the cutting state: same scoped truth,
  // keyed on the machining record. No legacy route exists for machining.
  const machiningOutputSelectionState = useMemo<CuttingOutputSelectionState>(() => {
    let state: CuttingOutputSelectionState;
    if (currentMachineOutputRequestState.status === 'loading') {
      state = {
        status: 'loading',
        scopeKey: currentMachineOutputRequestState.scopeKey,
      };
    } else if (currentMachineOutputRequestState.status === 'error') {
      state = {
        status: 'error',
        scopeKey: currentMachineOutputRequestState.scopeKey,
        error: currentMachineOutputRequestState.error,
      };
    } else {
      const record = machineOutputSelections.machining;
      const resolved = machineOutputResolved.machining;
      if (!record) {
        state = { status: 'empty', scopeKey: currentMachineOutputRequestState.scopeKey };
      } else if (
        resolved?.status === 'CONFIGURED' &&
        resolved.readiness.ready
      ) {
        state = {
          status: 'configured',
          scopeKey: currentMachineOutputRequestState.scopeKey,
          selection: record.selection,
        };
      } else {
        state = {
          status: 'blocked',
          scopeKey: currentMachineOutputRequestState.scopeKey,
          selection: record.selection,
          reason:
            resolved?.status === 'CONFIGURED'
              ? machineOutputBlockerMessageEs(resolved.readiness.reasons)
              : 'La selección de salida de mecanizado no coincide con el catálogo vigente.',
        };
      }
    }
    return forCurrentMachineOutputScope(state, machineOutputScopeKey);
  }, [
    currentMachineOutputRequestState,
    machineOutputSelections,
    machineOutputResolved,
    machineOutputScopeKey,
  ]);
  // Optimización: display summary of the #591 cutting target. Everything is
  // derived from the authoritative resolver + catalog — the panel only
  // presents it and never infers compatibility.
  const cuttingOutputTarget = useMemo<CuttingOutputTargetView | null>(() => {
    if (cuttingOutputSelectionState.status === 'empty') return null;
    if (cuttingOutputSelectionState.status === 'loading') {
      return {
        status: 'loading',
        machineLabel: 'Salida de máquina',
        formatLabel: 'PTX',
        profileLabel: 'Cargando configuración…',
        ready: false,
        blockerMessage: 'Esperá a que termine de cargar la configuración.',
      };
    }
    if (cuttingOutputSelectionState.status === 'error') {
      return {
        status: 'error',
        machineLabel: 'Salida de máquina',
        formatLabel: 'PTX',
        profileLabel: 'Configuración no disponible',
        ready: false,
        blockerMessage: cuttingOutputSelectionState.error,
      };
    }
    const resolved = machineOutputResolved.cutting;
    if (!resolved || resolved.status !== 'CONFIGURED') {
      return {
        status: 'configured-blocked',
        machineLabel: 'Salida de máquina',
        formatLabel: 'PTX',
        profileLabel: 'Configuración bloqueada',
        ready: false,
        blockerMessage:
          cuttingOutputSelectionState.status === 'blocked'
            ? cuttingOutputSelectionState.reason
            : 'La salida configurada no está disponible.',
      };
    }
    const profile = machineOutputReadModel?.catalog?.outputProfiles.find(
      (p) =>
        p.outputCompatibilityProfileId ===
        resolved.selection.outputCompatibilityProfileId,
    );
    return {
      status:
        cuttingOutputSelectionState.status === 'blocked'
          ? 'stale'
          : 'configured-ready',
      machineLabel: resolved.machineLabel,
      formatLabel: (profile?.formatFamily ?? 'ptx').toUpperCase(),
      profileLabel: resolved.profileLabel,
      ready: cuttingOutputSelectionState.status === 'configured',
      blockerMessage:
        cuttingOutputSelectionState.status === 'blocked'
          ? cuttingOutputSelectionState.reason
          : '',
      blockerCode:
        resolved.readiness.reasons[0]?.code,
      recoveryHint:
        cuttingOutputSelectionState.status === 'blocked'
          ? 'Volvé a seleccionar la versión vigente en Ajustes → Ingeniería.'
          : undefined,
    };
  }, [cuttingOutputSelectionState, machineOutputResolved, machineOutputReadModel]);

  // #1005 K3 — machining target summary for the Optimización panel (same
  // view contract as cutting; format label comes from the catalog family).
  const machiningOutputTarget = useMemo<CuttingOutputTargetView | null>(() => {
    if (machiningOutputSelectionState.status === 'empty') return null;
    if (machiningOutputSelectionState.status === 'loading') {
      return {
        status: 'loading',
        machineLabel: 'Salida de mecanizado',
        formatLabel: 'KDT',
        profileLabel: 'Cargando configuración…',
        ready: false,
        blockerMessage: 'Esperá a que termine de cargar la configuración.',
      };
    }
    if (machiningOutputSelectionState.status === 'error') {
      return {
        status: 'error',
        machineLabel: 'Salida de mecanizado',
        formatLabel: 'KDT',
        profileLabel: 'Configuración no disponible',
        ready: false,
        blockerMessage: machiningOutputSelectionState.error,
      };
    }
    const resolved = machineOutputResolved.machining;
    if (!resolved || resolved.status !== 'CONFIGURED') {
      return {
        status: 'configured-blocked',
        machineLabel: 'Salida de mecanizado',
        formatLabel: 'KDT',
        profileLabel: 'Configuración bloqueada',
        ready: false,
        blockerMessage:
          machiningOutputSelectionState.status === 'blocked'
            ? machiningOutputSelectionState.reason
            : 'La salida configurada no está disponible.',
      };
    }
    const profile = machineOutputReadModel?.catalog?.outputProfiles.find(
      (p) =>
        p.outputCompatibilityProfileId ===
        resolved.selection.outputCompatibilityProfileId,
    );
    return {
      status:
        machiningOutputSelectionState.status === 'blocked'
          ? 'stale'
          : 'configured-ready',
      machineLabel: resolved.machineLabel,
      formatLabel: (profile?.formatFamily ?? 'kdt').toUpperCase(),
      profileLabel: resolved.profileLabel,
      ready: machiningOutputSelectionState.status === 'configured',
      blockerMessage:
        machiningOutputSelectionState.status === 'blocked'
          ? machiningOutputSelectionState.reason
          : '',
      blockerCode:
        resolved.readiness.reasons[0]?.code,
      recoveryHint:
        machiningOutputSelectionState.status === 'blocked'
          ? 'Volvé a seleccionar la versión vigente en Ajustes → Ingeniería.'
          : undefined,
    };
  }, [machiningOutputSelectionState, machineOutputResolved, machineOutputReadModel]);

  const resolveCuttingOutputTargetForPlan = useCallback(
    (
      cutPlan: CutPlan,
      labels?: Parameters<typeof evaluateSelectedCuttingOutputReadiness>[2],
    ): CuttingOutputTargetView | null => {
      if (!cuttingOutputTarget || cuttingOutputSelectionState.status !== 'configured') {
        return cuttingOutputTarget;
      }
      const evaluated = evaluateSelectedCuttingOutputReadiness(
        cutPlan,
        cuttingOutputSelectionState.selection,
        labels,
      );
      if (evaluated.status !== 'CONFIGURED') return cuttingOutputTarget;
      const exactProfile = machineOutputReadModel?.catalog?.outputProfiles.find(
        (profile) =>
          profile.outputCompatibilityProfileId ===
            evaluated.selection.outputCompatibilityProfileId &&
          profile.revisionId === evaluated.selection.outputCompatibilityProfileRevisionId &&
          profile.digest === evaluated.selection.outputCompatibilityProfileDigest,
      );
      const reason = evaluated.readiness.reasons[0];
      return {
        machineLabel: evaluated.machineLabel,
        formatLabel: (exactProfile?.formatFamily ?? 'ptx').toUpperCase(),
        profileLabel: evaluated.profileLabel,
        status: evaluated.readiness.ready ? 'configured-ready' : 'configured-blocked',
        ready: evaluated.readiness.ready,
        blockerMessage: machineOutputBlockerMessageEs(evaluated.readiness.reasons),
        blockerCode: reason?.code,
        recoveryHint: reason?.code.startsWith('ptx_compile.')
          ? 'Corregí o regenerá el plan de corte y volvé a verificarlo.'
          : 'Revisá Ajustes → Ingeniería antes de descargar.',
      };
    },
    [
      cuttingOutputSelectionState,
    machiningOutputSelectionState,
      cuttingOutputTarget,
      machineOutputReadModel,
    ],
  );
  const saveMachineOutputSelection = useCallback(
    async (
      operation: ManufacturingOperation,
      selection: MachineOutputSelection,
      expectedVersion: number,
    ) => {
      const repository = getRepository();
      if (typeof repository.saveMachineOutputSelection !== 'function') {
        throw new Error('La configuración de salida de máquina requiere modo servidor.');
      }
      // Server-authoritative: after saving, refetch the whole read model —
      // never fabricate labels/blockers locally. Also on failure: a 409 must
      // leave the freshest record/version available for the retry.
      const requestedScopeKey = machineOutputScopeKey;
      try {
        await repository.saveMachineOutputSelection(operation, selection, expectedVersion);
      } finally {
        const currentScope = useWorkspaceStore.getState().sessionScope;
        const currentScopeKey = currentScope
          ? JSON.stringify(sessionScopeKey(currentScope))
          : session === 'guest'
            ? 'guest'
            : null;
        if (
          requestedScopeKey !== null &&
          isCurrentMachineOutputRequest(requestedScopeKey, currentScopeKey)
        ) {
          refreshMachineOutput();
        }
      }
    },
    [getRepository, refreshMachineOutput, machineOutputScopeKey, session],
  );

  return {
    refreshMachineOutput,
    machineOutputReadModel,
    machineOutputLoadError,
    machineOutputSelections,
    machineOutputResolved,
    cuttingOutputSelectionState,
    machiningOutputSelectionState,
    cuttingOutputTarget,
    machiningOutputTarget,
    resolveCuttingOutputTargetForPlan,
    saveMachineOutputSelection,
  };
}
