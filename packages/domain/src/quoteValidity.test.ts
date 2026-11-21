import { describe, expect, it } from 'vitest';
import {
  formatQuoteValidityDate,
  isoDateInTimeZone,
  quoteValidityDocumentLabelEs,
  quoteValidityInfo,
  quoteValidityLabelEs,
} from './quoteValidity';
import { DEFAULT_QUOTE_VALIDITY_DAYS, DEFAULT_WORKSHOP_TIME_ZONE, resolveWorkshopSettings } from './workshopSettings';

describe('quoteValidityInfo (#1648)', () => {
  const today = '2026-11-20';
  it('sin vigencia (borrador o legado) es "none", no "vigente"', () => {
    expect(quoteValidityInfo({}, today).status).toBe('none');
    expect(quoteValidityInfo({ validUntil: null }, today).status).toBe('none');
    expect(quoteValidityLabelEs(quoteValidityInfo({}, today))).toBe('Sin vigencia registrada');
  });
  it('vale todo el día de validUntil y vence al día siguiente', () => {
    expect(quoteValidityInfo({ validUntil: '2026-11-20' }, today)).toMatchObject({ status: 'expiring_soon', daysLeft: 0 });
    expect(quoteValidityInfo({ validUntil: '2026-11-19' }, today)).toMatchObject({ status: 'expired', daysLeft: -1 });
    expect(quoteValidityInfo({ validUntil: '2026-11-23' }, today).status).toBe('expiring_soon');
    expect(quoteValidityInfo({ validUntil: '2026-11-24' }, today).status).toBe('valid');
  });
  it('etiquetas en español con fecha dd/mm/aaaa', () => {
    expect(quoteValidityLabelEs(quoteValidityInfo({ validUntil: '2026-11-17' }, today))).toBe('Vencida el 17/11/2026 (hace 3 días)');
    expect(quoteValidityLabelEs(quoteValidityInfo({ validUntil: '2026-11-20' }, today))).toBe('Vigente hasta hoy (20/11/2026)');
    expect(quoteValidityLabelEs(quoteValidityInfo({ validUntil: '2026-11-21' }, today))).toBe('Vigente hasta mañana (21/11/2026)');
    expect(quoteValidityLabelEs(quoteValidityInfo({ validUntil: '2026-12-05' }, today))).toBe('Vigente hasta el 05/12/2026 (faltan 15 días)');
    expect(quoteValidityDocumentLabelEs('2026-12-05')).toBe('Válida hasta el 05/12/2026');
    expect(quoteValidityDocumentLabelEs(undefined)).toBeUndefined();
    expect(formatQuoteValidityDate('2026-01-02')).toBe('02/01/2026');
  });
  it('días de vigencia del taller: 1..365, por defecto 15 (paridad con Go)', () => {
    expect(resolveWorkshopSettings({}).quoteValidityDays).toBe(DEFAULT_QUOTE_VALIDITY_DAYS);
    expect(resolveWorkshopSettings({ quoteValidityDays: 30 }).quoteValidityDays).toBe(30);
    expect(resolveWorkshopSettings({ quoteValidityDays: 0 }).quoteValidityDays).toBe(15);
    expect(resolveWorkshopSettings({ quoteValidityDays: 400 }).quoteValidityDays).toBe(15);
    expect(resolveWorkshopSettings({ quoteValidityDays: 7.5 }).quoteValidityDays).toBe(15);
  });
  it('el "hoy" es el día calendario del taller, no el día UTC', () => {
    // 2026-11-21T02:00Z: ya es 21 en UTC pero en Ciudad de México sigue siendo 20.
    const at = new Date('2026-11-21T02:00:00Z');
    expect(isoDateInTimeZone(at, 'America/Mexico_City')).toBe('2026-11-20');
    expect(isoDateInTimeZone(at, 'UTC')).toBe('2026-11-21');
    expect(resolveWorkshopSettings({}).timeZone).toBe(DEFAULT_WORKSHOP_TIME_ZONE);
    expect(resolveWorkshopSettings({ timeZone: 'America/Montevideo' }).timeZone).toBe('America/Montevideo');
    expect(resolveWorkshopSettings({ timeZone: 'Mars/Olympus' }).timeZone).toBe(DEFAULT_WORKSHOP_TIME_ZONE);
  });
});
