// Configurable base URL: Android emulator uses 10.0.2.2, iOS simulator uses localhost or physical device IP
let currentBaseUrl = 'http://localhost:8080';

export function setApiBaseUrl(url: string) {
  currentBaseUrl = url.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return currentBaseUrl;
}
