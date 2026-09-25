import { GraneteApiClient } from '@granete/storage';
import { authenticatedApiFetch, isGraneteApiUrl, WebSessionTransitionError } from './webAuthClient';
import type { CredentialSnapshot } from './webAuthRuntime';

/**
 * Bind a generated API client to the credential that created its query.
 * The generated client supplies string URLs and RequestInit; unsupported
 * Request objects fail closed rather than losing headers, body or signal.
 */
export function createWebGeneratedApiClient(
  baseUrl: string,
  token: string,
  intendedCredential: CredentialSnapshot | null,
): GraneteApiClient {
  if (intendedCredential === null || token !== intendedCredential.accessToken) {
    throw new WebSessionTransitionError('El bearer no pertenece a la sesión capturada');
  }
  const pageUrl = globalThis.location?.href ?? 'http://localhost';
  const base = new URL(baseUrl, pageUrl);
  return new GraneteApiClient(baseUrl, (input, init) => {
    if (typeof input !== 'string') {
      throw new TypeError('Generated API fetch requires a string URL');
    }
    const target = new URL(input, pageUrl);
    if (
      !isGraneteApiUrl(target.href) ||
      target.origin !== base.origin ||
      (target.pathname !== base.pathname && !target.pathname.startsWith(`${base.pathname}/`))
    ) {
      throw new WebSessionTransitionError('La request no pertenece al API autorizado');
    }
    return authenticatedApiFetch(target.href, init, intendedCredential);
  });
}
