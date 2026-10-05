import { describe, expect, it } from 'vitest';
import { GraneteApiError } from '@granete/storage';
import { loginErrorMessage } from './session';

function apiError(status: number): GraneteApiError {
  return new GraneteApiError(status, {
    code: 'BAD_REQUEST',
    message: 'backend raw message',
    fieldErrors: {},
    requestId: 'req-1',
    retryable: false,
    details: {},
  });
}

// #1108: cada clase de fallo de login tiene su copy operable — un 5xx o un
// rate-limit no se reportan como "problema de conexión", y el 403 (cuenta sin
// taller asignado) no filtra el message crudo del backend.
describe('loginErrorMessage', () => {
  it('maps invalid credentials', () => {
    expect(loginErrorMessage(apiError(401))).toBe('Email o contraseña incorrectos');
  });

  it('maps account without workshop assignment', () => {
    expect(loginErrorMessage(apiError(403))).toBe('Todavía no tenés un taller asignado. Pedile al administrador que te invite o te asigne uno.');
  });

  it('maps rate limiting', () => {
    expect(loginErrorMessage(apiError(429))).toBe('Demasiados intentos. Esperá un momento y probá de nuevo.');
  });

  it('maps server errors without blaming the connection', () => {
    expect(loginErrorMessage(apiError(500))).toBe('El servidor no respondió correctamente. Probá de nuevo en un momento.');
    expect(loginErrorMessage(apiError(503))).toBe('El servidor no respondió correctamente. Probá de nuevo en un momento.');
  });

  it('maps untyped API errors to a neutral retry copy', () => {
    expect(loginErrorMessage(apiError(400))).toBe('No se pudo iniciar sesión. Probá de nuevo en un momento.');
  });

  it('keeps the connection copy for real network failures', () => {
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toBe('No se pudo conectar con el servidor. Revisá tu conexión.');
    expect(loginErrorMessage(new Error('fetch no disponible'))).toBe('No se pudo conectar con el servidor. Revisá tu conexión.');
  });
});
