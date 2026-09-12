/**
 * Resolves a server-authorized HardwareAsset revision grant URL without widening scope or duplicating /api prefixes (#667 M2).
 */

const HARDWARE_ASSET_FILE_PATH_PREFIX = '/api/hardware-assets/files/';

export class UnsupportedHardwareAssetUrlError extends Error {
  constructor(message = 'Unsupported hardware asset URL') {
    super(message);
    this.name = 'UnsupportedHardwareAssetUrlError';
  }
}

export function resolveHardwareAssetFileUrl(apiBaseUrl: string, grantUrl: string): string {
  let apiBase: URL;
  try {
    apiBase = new URL(apiBaseUrl);
  } catch {
    throw new UnsupportedHardwareAssetUrlError('Invalid base URL');
  }

  if (
    (apiBase.protocol !== 'http:' && apiBase.protocol !== 'https:') ||
    apiBase.username !== '' ||
    apiBase.password !== '' ||
    apiBase.search !== '' ||
    apiBase.hash !== ''
  ) {
    throw new UnsupportedHardwareAssetUrlError('Base URL must be http(s) without credentials, query, or hash');
  }

  if (!grantUrl.startsWith('/') && !grantUrl.startsWith(`${apiBase.origin}/`)) {
    throw new UnsupportedHardwareAssetUrlError('Grant URL must be an absolute path or match the base URL origin');
  }

  let resolved: URL;
  try {
    resolved = new URL(grantUrl, apiBase.origin);
  } catch {
    throw new UnsupportedHardwareAssetUrlError('Malformed grant URL');
  }

  if (
    resolved.origin !== apiBase.origin ||
    (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') ||
    resolved.username !== '' ||
    resolved.password !== '' ||
    !resolved.pathname.startsWith(HARDWARE_ASSET_FILE_PATH_PREFIX)
  ) {
    throw new UnsupportedHardwareAssetUrlError('Resolved URL must stay within the hardware assets media namespace');
  }

  return resolved.toString();
}
