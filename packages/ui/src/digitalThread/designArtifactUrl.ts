/**
 * Resolves a server-authorized DesignRevision artifact URL without widening its scope.
 */

const DESIGN_ARTIFACT_PATH_PREFIX = '/api/design-artifacts/';

export class UnsupportedDesignArtifactUrlError extends Error {
  constructor() {
    super('Unsupported Design artifact URL');
    this.name = 'UnsupportedDesignArtifactUrlError';
  }
}

export function resolveDesignArtifactUrl(apiBaseUrl: string, grantUrl: string): string {
  let apiBase: URL;
  try {
    apiBase = new URL(apiBaseUrl);
  } catch {
    throw new UnsupportedDesignArtifactUrlError();
  }

  if (
    (apiBase.protocol !== 'http:' && apiBase.protocol !== 'https:') ||
    apiBase.username !== '' ||
    apiBase.password !== '' ||
    apiBase.search !== '' ||
    apiBase.hash !== ''
  ) {
    throw new UnsupportedDesignArtifactUrlError();
  }

  if (!grantUrl.startsWith('/') && !grantUrl.startsWith(`${apiBase.origin}/`)) {
    throw new UnsupportedDesignArtifactUrlError();
  }

  let resolved: URL;
  try {
    resolved = new URL(grantUrl, apiBase.origin);
  } catch {
    throw new UnsupportedDesignArtifactUrlError();
  }

  if (
    resolved.origin !== apiBase.origin ||
    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
    resolved.username !== '' ||
    resolved.password !== '' ||
    !resolved.pathname.startsWith(DESIGN_ARTIFACT_PATH_PREFIX)
  ) {
    throw new UnsupportedDesignArtifactUrlError();
  }

  return resolved.toString();
}
