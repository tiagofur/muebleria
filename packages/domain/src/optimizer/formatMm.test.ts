import { describe, expect, it } from 'vitest';
import { formatMm } from './formatMm';

describe('formatMm (presentación de milímetros, #650 PR #655 R2)', () => {
  it('conserva decimales útiles sin forzar .0', () => {
    expect(formatMm(280)).toBe('280');
    expect(formatMm(100.1)).toBe('100.1');
    expect(formatMm(100.5)).toBe('100.5');
    expect(formatMm(3.2)).toBe('3.2');
    expect(formatMm(333.3)).toBe('333.3');
    expect(formatMm(0)).toBe('0');
  });

  it('elimina ruido IEEE-754 no significativo', () => {
    expect(formatMm(0.1 + 0.2)).toBe('0.3');
    expect(formatMm(2430.0000000000005)).toBe('2430');
    expect(formatMm(333.29999999999995)).toBe('333.3');
    expect(formatMm(996.7000000000001)).toBe('996.7');
  });

  it('máximo de decimales explícito (3): redondeo de presentación, no de fabricación', () => {
    // El valor estructurado nunca pasa por aquí; sólo el texto visible.
    expect(formatMm(333.3333)).toBe('333.333');
    expect(formatMm(100.1234)).toBe('100.123');
  });
});
