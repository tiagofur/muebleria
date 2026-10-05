/**
 * Engineering workspace state of the App shell (#500/#501/#502 WEB-DT routes,
 * #738 release pin, #781/#739/#793 release/occurrences/demand/labels
 * contexts, factory construction policy, hardware profiles, component side
 * assignments, #465 engineering state and #1031 release commands; extracted
 * from ShellView by R5). The body moved verbatim — the caller passes the
 * shell plumbing; location/navigation are read by the hook.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ComponentConstructionOverride,
  manufacturingLabelProjectionFromDemand,
  releaseAuthorityOf,
  type ManufacturingLabelProjection,
  type Project,
} from '@granete/domain';
import {
  ptxPartLabelsFromManufacturingProjection,
  type PtxPartLabelData,
} from '@granete/excel';
import {
  engineeringCuttingDemandQueryKey,
  useEngineeringCuttingDemand,
} from '../engineeringCuttingDemand';
import {
  engineeringReleaseQueryKey,
  useEngineeringReleaseContext,
} from '../engineeringReleaseContext';
import {
  engineeringStateQueryKey,
  useEngineeringState,
} from '../engineeringState';
import { useComponentSideAssignments } from '../useComponentSideAssignments';
import { useFactoryConstructionPolicy } from '../useFactoryConstructionPolicy';
import { useHardwareProfiles } from '../useHardwareProfiles';
import {
  useProjectWorkshopOccurrences,
  workshopOccurrenceQueryKey,
} from '../workshopOccurrenceContext';
import { captureDeferredNavigationIntent, runDeferredNavigationGuarded } from '../deferredNavigation';
import { useWorkspaceStore } from '../stores';
import { useQuoteRevisionAuthority } from '../quoteRevisionAuthority';
import type { SessionScope } from '../shared/query/sessionScope';
import { sessionScopeKey } from '../shared/query/sessionScope';
import {
  engineeringProjectPath,
  projectDesignsFromPath,
  projectFurnitureFromPath,
  projectReconciliationFromPath,
} from '../routes';
import { DEFAULT_API_BASE, type SessionMode } from '../session';
import {
  projectReconciliationQueryKeys,
  type AppNavId,
  type EngineeringReleaseStateEvidence,
} from '@granete/ui';

export function useEngineeringShellState({
  navId,
  session,
  authToken,
  sessionScope,
  projects,
  routeEngineeringProjectId,
  routeEngineeringReleaseId,
  routeComponentEditId,
  routeProductionOrderId,
  selectedProjectId,
  refreshWorkspace,
}: {
  readonly navId: AppNavId;
  readonly session: SessionMode;
  readonly authToken: string | null;
  readonly sessionScope: SessionScope | null;
  readonly projects: readonly Project[];
  readonly routeEngineeringProjectId: string | null;
  readonly routeEngineeringReleaseId: string | null;
  readonly routeComponentEditId: string | null;
  readonly routeProductionOrderId: string | null;
  readonly selectedProjectId: string | null;
  readonly refreshWorkspace: () => Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const projectFurnitureRoute = useMemo(
    () => projectFurnitureFromPath(location.pathname, location.search),
    [location.pathname, location.search],
  );

  // WEB-DT-2 (#501): the Project Designs & Revisions workspace route pins
  // its exact design and revision context in the URL query string.
  const projectDesignsRoute = useMemo(
    () => projectDesignsFromPath(location.pathname, location.search),
    [location.pathname, location.search],
  );

  // WEB-DT-3 (#502): the reconciliation/approval/release workspace route
  // pins its exact QuoteRevision + DesignRevision context in the URL query
  // string. Role hints only — the server stays the command authority.
  const projectReconciliationRoute = useMemo(
    () => projectReconciliationFromPath(location.pathname, location.search),
    [location.pathname, location.search],
  );

  // #738 — the Engineering workspace route pins its exact ProductionRelease
  // context (`?release=`). Entering a canonical obra without an explicit
  // release pins the server-resolved authority in the URL ONCE (replace, not
  // push): the exact context survives reloads and a newer release never
  // retargets an open screen silently.
  useEffect(() => {
    if (navId !== 'engineering' || !routeEngineeringProjectId || routeEngineeringReleaseId) {
      return;
    }
    const project = projects.find((p) => p.id === routeEngineeringProjectId);
    const authority = project ? releaseAuthorityOf(project) : undefined;
    if (authority?.source !== 'canonical') return;
    const target = engineeringProjectPath(routeEngineeringProjectId, {
      releaseId: authority.releaseId,
    });
    if (location.pathname + location.search !== target) {
      navigate(target, { replace: true });
    }
  }, [
    navId,
    routeEngineeringProjectId,
    routeEngineeringReleaseId,
    projects,
    location.pathname,
    location.search,
    navigate,
  ]);
  const engineeringReleaseContext = useEngineeringReleaseContext({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    projectId: routeEngineeringProjectId,
    releaseId: routeEngineeringReleaseId,
    queryKey: engineeringReleaseQueryKey(
      sessionScope ? sessionScopeKey(sessionScope) : ['no-session'],
      routeEngineeringProjectId ?? 'no-project',
      routeEngineeringReleaseId ?? 'no-release',
    ),
  });
  // #781 — the project's frozen manufacturing occurrence authority of the
  // EXACT release. Only fetched when the engineering release context is
  // ready (same project/release scope). Never falls back to "latest".
  const projectWorkshopOccurrences = useProjectWorkshopOccurrences({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    projectId:
      engineeringReleaseContext.kind === 'ready' && routeEngineeringProjectId
        ? routeEngineeringProjectId
        : null,
    releaseId:
      engineeringReleaseContext.kind === 'ready' ? routeEngineeringReleaseId : null,
    queryKey: workshopOccurrenceQueryKey(
      sessionScope ? sessionScopeKey(sessionScope) : ['no-session'],
      routeEngineeringProjectId ?? 'none',
      routeEngineeringReleaseId ?? 'none',
    ),
  });
  // #739 — frozen cutting demand of the SAME pinned release (fetched only
  // once the release context is verified: same project/release scope, same
  // session keying, no cross-context leakage).
  const engineeringDemandContext = useEngineeringCuttingDemand({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    projectId:
      engineeringReleaseContext.kind === 'ready' && routeEngineeringProjectId
        ? routeEngineeringProjectId
        : null,
    releaseId: routeEngineeringReleaseId,
    queryKey: engineeringCuttingDemandQueryKey(
      sessionScope ? sessionScopeKey(sessionScope) : ['no-session'],
      routeEngineeringProjectId ?? 'no-project',
      routeEngineeringReleaseId ?? 'no-release',
    ),
  });
  // #793 — neutral frozen label projection of the SAME verified demand
  // (occurrence ordinals, module context via the same catalog engineering
  // inputs the rows use) plus its export-layer mapping, precomputed once so
  // the optimización panel's readiness reflects the SAME labeled-job gate the
  // serialization route enforces. No CNC machining authority is available
  // web-side yet — fields without authority stay empty instead of being
  // invented; real machining truth wiring belongs to the field-result
  // follow-up (#348).
  //
  // Dependency discipline: the demand CONTEXT object is rebuilt every render,
  // so the memo keys on the underlying react-query `demand` reference
  // (referentially stable while unchanged) — keying on the context itself
  // would recompute every render and re-trigger the partLabels effect in a
  // loop.
  const engDemandReady =
    engineeringDemandContext.kind === 'ready' ? engineeringDemandContext.demand : undefined;
  const engManufacturingLabels = useMemo<ManufacturingLabelProjection | undefined>(() => {
    if (!engDemandReady) return undefined;
    try {
      return manufacturingLabelProjectionFromDemand(engDemandReady);
    } catch {
      return undefined;
    }
  }, [engDemandReady]);
  const [engPartLabels, setEngPartLabels] = useState<readonly PtxPartLabelData[] | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!engManufacturingLabels) {
      setEngPartLabels(undefined);
      return;
    }
    let cancelled = false;
    ptxPartLabelsFromManufacturingProjection(engManufacturingLabels).then(
      (labels) => {
        if (!cancelled) setEngPartLabels(labels);
      },
      () => {
        if (!cancelled) setEngPartLabels(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [engManufacturingLabels]);
  // #740 — durable per-release Engineering state of the SAME pinned release:
  // the exact-release evidence the workspace status chip and the EXPLICIT
  // start/complete commands consume. Reading it never writes.
  const engineeringStateKey = engineeringStateQueryKey(
    sessionScope ? sessionScopeKey(sessionScope) : ['no-session'],
    routeEngineeringProjectId ?? 'no-project',
    routeEngineeringReleaseId ?? 'no-release',
  );
  // #875: Factory construction and joinery policy overlay
  const factoryConstructionPolicy = useFactoryConstructionPolicy({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    enabled: navId === 'settings' || navId === 'components',
  });

  // #875 slice 3: a component's station exception lives in the factory overlay
  // (never in the component entity) — merge the entry into the policy and save
  // through the same governed overlay path as Config.
  const saveComponentConstructionException = useCallback(
    async (componentId: string | null, override: ComponentConstructionOverride | null) => {
      if (!componentId) return;
      const policy = factoryConstructionPolicy.policy;
      const nextOverrides: Record<string, ComponentConstructionOverride> = {
        ...(policy.componentOverrides ?? {}),
      };
      const hasStationScalars =
        override !== null &&
        (override.stationsCount !== undefined ||
          override.startMarginMm !== undefined ||
          override.endMarginMm !== undefined);
      if (override !== null && hasStationScalars) {
        nextOverrides[componentId] = override;
      } else {
        delete nextOverrides[componentId];
      }
      await factoryConstructionPolicy.savePolicy({
        ...policy,
        componentOverrides:
          Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
      });
    },
    [factoryConstructionPolicy],
  );
  // #914: hardware profiles catalog data (org-scoped, If-Match writes).
  const hardwareProfiles = useHardwareProfiles(
    DEFAULT_API_BASE,
    session === 'auth' ? authToken : null,
    navId === 'hardwareProfiles',
  );
  // #915: profiles for the component editor's per-face pickers + the
  // editing component's assignments (editor id comes from the route).
  const hardwareProfilesForPicker = useHardwareProfiles(
    DEFAULT_API_BASE,
    session === 'auth' ? authToken : null,
    navId === 'components',
  );
  const editingComponentId =
    navId === 'components' && routeComponentEditId && routeComponentEditId !== 'new'
      ? routeComponentEditId
      : null;
  const componentSideAssignments = useComponentSideAssignments(
    DEFAULT_API_BASE,
    session === 'auth' ? authToken : null,
    editingComponentId,
    navId === 'components',
  );

  const engineeringStateContext = useEngineeringState({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    projectId: routeEngineeringProjectId,
    releaseId: routeEngineeringReleaseId,
    queryKey: engineeringStateKey,
  });
  // #768 — durable Engineering state of the ORDER project's canonical
  // authority, for the production hub's "Preparación para fabricar"
  // stepper. Same exact-release read the engineering workspace uses;
  // reading never writes. Canonical authority only — legacy obras keep the
  // pre-#768 presentation (no invented flow).
  const orderEngineeringReleaseId = useMemo(() => {
    if (!routeProductionOrderId) return null;
    const project = projects.find((p) => p.id === routeProductionOrderId);
    const authority = project ? releaseAuthorityOf(project) : undefined;
    return authority?.source === 'canonical' ? authority.releaseId : null;
  }, [projects, routeProductionOrderId]);
  const orderEngineeringStateContext = useEngineeringState({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    projectId: routeProductionOrderId,
    releaseId: orderEngineeringReleaseId,
    queryKey: engineeringStateQueryKey(
      sessionScope ? sessionScopeKey(sessionScope) : ['no-session'],
      routeProductionOrderId ?? 'no-project',
      orderEngineeringReleaseId ?? 'no-release',
    ),
  });
  const orderEngineeringState: EngineeringReleaseStateEvidence | undefined =
    !orderEngineeringReleaseId
      ? undefined
      : orderEngineeringStateContext.kind === 'loading'
        ? { status: 'loading' }
        : orderEngineeringStateContext.kind === 'error'
          ? { status: 'error' }
          : orderEngineeringStateContext.kind === 'ready'
            ? { status: 'ready', phase: orderEngineeringStateContext.state.phase }
            : undefined;
  // #740 — explicit user commands against the exact pinned release. Only
  // these callbacks write engineering state; refresh + invalidation keep the
  // chip, the queue and the dashboard on the durable truth. A rejected
  // command surfaces its honest message (version conflict, permissions…).
  const engineeringQueryClient = useQueryClient();
  const [engineeringCommandBusy, setEngineeringCommandBusy] = useState(false);
  const [engineeringCommandError, setEngineeringCommandError] = useState<string | null>(null);
  const runReleaseEngineeringCommand = useCallback(
    async (run: () => Promise<unknown>) => {
      if (!authToken || !routeEngineeringProjectId || !routeEngineeringReleaseId) return;
      setEngineeringCommandBusy(true);
      setEngineeringCommandError(null);
      try {
        await run();
        await engineeringQueryClient.invalidateQueries({ queryKey: engineeringStateKey });
        await refreshWorkspace();
      } catch (err) {
        setEngineeringCommandError(
          err instanceof Error
            ? err.message
            : 'No se pudo actualizar el estado de Ingeniería',
        );
      } finally {
        setEngineeringCommandBusy(false);
      }
    },
    [
      authToken,
      routeEngineeringProjectId,
      routeEngineeringReleaseId,
      engineeringQueryClient,
      engineeringStateKey,
      refreshWorkspace,
    ],
  );
  // #738 review — "Abrir Ingeniería" refreshes the read model and THEN
  // navigates. The deferred navigation is guarded: if the user moved to
  // another route/project, switched organization or the session ended while
  // the refresh was in flight, the late completion must NOT drag them back
  // to the abandoned intent. It still navigates when the refresh REJECTED
  // (the workspace fetches its own context) — only with the intent current.
  const openInEngineeringGuarded = (projectId: string, releaseId: string) => {
    const scopeAtStart = useWorkspaceStore.getState().sessionScope;
    runDeferredNavigationGuarded({
      projectId,
      releaseId,
      start: captureDeferredNavigationIntent({
        scopeKey: scopeAtStart
          ? JSON.stringify(sessionScopeKey(scopeAtStart))
          : null,
        path: window.location.pathname + window.location.search,
      }),
      deps: {
        refreshWorkspace,
        navigate,
        live: () => {
          const liveState = useWorkspaceStore.getState();
          const liveScope = liveState.sessionScope;
          return {
            scopeKey: liveScope ? JSON.stringify(sessionScopeKey(liveScope)) : null,
            path: window.location.pathname + window.location.search,
            sessionActive: liveState.session !== null,
          };
        },
        target: (id, release) => engineeringProjectPath(id, { releaseId: release }),
      },
    });
  };
  const {
    authority: quoteAuthority,
    revisions: quoteRevisions,
  } = useQuoteRevisionAuthority({
    baseUrl: DEFAULT_API_BASE,
    token: session === 'auth' ? authToken : null,
    projectId: selectedProjectId,
    queryKey: projectReconciliationQueryKeys(
      sessionScope ? sessionScopeKey(sessionScope) : ['no-session'],
      selectedProjectId ?? 'no-project',
    ).quoteAuthority,
  });

  return {
    componentSideAssignments,
    editingComponentId,
    engManufacturingLabels,
    engPartLabels,
    engineeringCommandBusy,
    engineeringCommandError,
    engineeringDemandContext,
    engineeringReleaseContext,
    engineeringStateContext,
    factoryConstructionPolicy,
    hardwareProfiles,
    hardwareProfilesForPicker,
    openInEngineeringGuarded,
    orderEngineeringState,
    projectDesignsRoute,
    projectFurnitureRoute,
    projectReconciliationRoute,
    projectWorkshopOccurrences,
    quoteAuthority,
    quoteRevisions,
    runReleaseEngineeringCommand,
    saveComponentConstructionException,
  };
}
