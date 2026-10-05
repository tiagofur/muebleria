/**
 * Hook del workspace de autoría de la biblioteca (#1102 Slice A).
 *
 * Expone al rol bibliotecario (platform admin) el estado del ciclo de
 * biblioteca: el release publicado vigente del Granete Standard y los
 * borradores abiertos. Los edits de Catálogos siguen fluyendo por
 * catalogStore hacia el estado de autoría sin cambios; este hook sólo
 * identifica contra qué release en draft se está componiendo la próxima
 * versión — publicar sigue siendo el paso deliberado separado (#955).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  GraneteApiClient,
  GraneteApiError,
  type LibraryReleaseSummary,
  type StandardDraftDiffReport,
  type StandardDraftValidationReport,
} from '@granete/storage';

export interface UseStandardLibraryWorkspaceOptions {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly enabled?: boolean;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parseVersionParts(version: string): [number, number, number] | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersionParts(
  a: [number, number, number],
  b: [number, number, number],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

// Sugerencia de próxima versión: patch+1 sobre el máximo existente entre
// releases publicados y borradores. Es sólo una sugerencia de UI — el
// bibliotecario puede escribir otra y el servidor valida unicidad (409).
export function suggestNextLibraryVersion(
  releases: ReadonlyArray<Pick<LibraryReleaseSummary, 'version'>>,
): string {
  let best: [number, number, number] | null = null;
  for (const release of releases) {
    const parts = parseVersionParts(release.version);
    if (!parts) continue;
    if (!best || compareVersionParts(parts, best) > 0) best = parts;
  }
  if (!best) return '0.1.0';
  return `${best[0]}.${best[1]}.${best[2] + 1}`;
}

export function useStandardLibraryWorkspace({
  baseUrl,
  token,
  enabled = true,
}: UseStandardLibraryWorkspaceOptions) {
  const [publishedReleases, setPublishedReleases] = useState<
    ReadonlyArray<LibraryReleaseSummary>
  >([]);
  const [draftReleases, setDraftReleases] = useState<
    ReadonlyArray<LibraryReleaseSummary>
  >([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #1102 Slice B: the "probar borrador" report — keyed by the draft it
  // validated so a newer draft never shows a stale verdict.
  const [validation, setValidation] = useState<{
    draftId: string;
    report: StandardDraftValidationReport;
  } | null>(null);
  const [validating, setValidating] = useState(false);
  // #1102 Slice C: the publish-confirmation diff and the publish transition.
  const [diff, setDiff] = useState<{
    draftId: string;
    report: StandardDraftDiffReport;
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const fetchState = useCallback(
    async (client: GraneteApiClient, authToken: string) => {
      const [current, published, drafts] = await Promise.all([
        client.getStandardCurrentRelease(authToken).catch(() => null),
        client.getStandardReleases(authToken).catch(() => []),
        client.getStandardLibraryDraftReleases(authToken),
      ]);
      setPublishedReleases(published);
      setDraftReleases(drafts);
      return { current, published, drafts };
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    const client = new GraneteApiClient(baseUrl);
    setLoading(true);
    setError(null);
    fetchState(client, token)
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        // El 403 del listado de drafts significa que la sesión ya no es de
        // plataforma (o el flag de UI quedó stale): estado de error distinto,
        // nunca una lista vacía que parezca "no hay borrador".
        setError(
          err instanceof GraneteApiError && err.status === 403
            ? 'Tu sesión ya no tiene autoridad de plataforma; recargá para sincronizar.'
            : 'No se pudo cargar el estado del workspace de biblioteca.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, enabled, fetchState]);

  const currentPublished = publishedReleases[0] ?? null;
  // El workspace compone contra el borrador más reciente; C listará todos.
  const currentDraft = draftReleases[0] ?? null;
  const suggestedVersion = suggestNextLibraryVersion([
    ...publishedReleases,
    ...draftReleases,
  ]);
  const currentValidation =
    validation && currentDraft && validation.draftId === currentDraft.id
      ? validation.report
      : null;

  const openDraft = useCallback(async (): Promise<LibraryReleaseSummary | null> => {
    if (!token) return null;
    const client = new GraneteApiClient(baseUrl);
    setOpening(true);
    setError(null);
    try {
      const version = suggestNextLibraryVersion([
        ...publishedReleases,
        ...draftReleases,
      ]);
      const created = await client.createStandardLibraryRelease(token, {
        version,
      });
      await fetchState(client, token);
      return created;
    } catch (err: unknown) {
      setError(
        err instanceof GraneteApiError && err.status === 409
          ? 'Ya existe un release con esa versión; recargá e intentá de nuevo.'
          : 'No se pudo abrir el borrador de la biblioteca.',
      );
      return null;
    } finally {
      setOpening(false);
    }
  }, [baseUrl, token, publishedReleases, draftReleases, fetchState]);

  // #1102 Slice B: read-only pre-publish validation — the exact compile the
  // publisher would run plus a batch resolve of every furniture definition.
  const validateDraft = useCallback(async (): Promise<StandardDraftValidationReport | null> => {
    if (!token || !currentDraft) return null;
    const client = new GraneteApiClient(baseUrl);
    setValidating(true);
    setError(null);
    try {
      const report = await client.validateStandardLibraryDraft(
        token,
        currentDraft.id,
      );
      setValidation({ draftId: currentDraft.id, report });
      return report;
    } catch (err: unknown) {
      setError(
        err instanceof GraneteApiError && err.status === 409
          ? 'El borrador ya no está en draft; recargá el workspace.'
          : 'No se pudo probar el borrador de la biblioteca.',
      );
      return null;
    } finally {
      setValidating(false);
    }
  }, [baseUrl, token, currentDraft]);

  // #1102 Slice C: the publish-confirmation diff, keyed to the draft like the
  // validation report. 422 means the draft does not compile — the honest
  // answer the confirm dialog must show instead of a diff.
  const requestDiff = useCallback(async (): Promise<StandardDraftDiffReport | null> => {
    if (!token || !currentDraft) return null;
    const client = new GraneteApiClient(baseUrl);
    setDiffLoading(true);
    setError(null);
    try {
      const report = await client.getStandardLibraryDraftDiff(
        token,
        currentDraft.id,
      );
      setDiff({ draftId: currentDraft.id, report });
      return report;
    } catch (err: unknown) {
      setDiff(null);
      setError(
        err instanceof GraneteApiError && err.status === 422
          ? `El borrador no compila: ${err.message}`
          : 'No se pudo calcular el diff del borrador.',
      );
      return null;
    } finally {
      setDiffLoading(false);
    }
  }, [baseUrl, token, currentDraft]);

  // #1102 Slice C: the only state transition of the cycle — compile and
  // publish atomically (#955). Success refreshes the workspace: the draft
  // leaves the drafts list and joins the published history.
  const publishDraft = useCallback(async (): Promise<boolean> => {
    if (!token || !currentDraft) return false;
    const client = new GraneteApiClient(baseUrl);
    setPublishing(true);
    setError(null);
    try {
      await client.publishStandardLibraryRelease(token, currentDraft.id);
      setDiff(null);
      await fetchState(client, token);
      return true;
    } catch (err: unknown) {
      const status = err instanceof GraneteApiError ? err.status : 0;
      setError(
        status === 409
          ? 'El borrador ya no está en draft; recargá el workspace.'
          : status === 422
            ? `La compilación falló y no se publicó nada: ${err instanceof GraneteApiError ? err.message : 'entrada inválida'}`
            : 'No se pudo publicar la biblioteca; el release vigente sigue intacto.',
      );
      return false;
    } finally {
      setPublishing(false);
    }
  }, [baseUrl, token, currentDraft, fetchState]);

  return {
    currentPublished,
    publishedReleases,
    currentDraft,
    draftReleases,
    suggestedVersion,
    loading,
    opening,
    error,
    openDraft,
    validating,
    currentValidation,
    validateDraft,
    diffLoading,
    currentDiff: diff && currentDraft && diff.draftId === currentDraft.id ? diff.report : null,
    requestDiff,
    publishing,
    publishDraft,
  };
}
