/**
 * #1648 (part 2) — quote validity. A published QuoteRevision carries the
 * server-frozen `validUntil` (YYYY-MM-DD, factory default days from the
 * publication). An expired quote is NOT blocked: accepting it requires an
 * explicit, audited acknowledgement (owner decision: warn, never block).
 * Drafts and revisions published before #1648 have no validity — honestly
 * absent ('none'), never derived from createdAt/publishedAt.
 */

/** Days ahead that count as "vence pronto" (warn before it expires). */
export const QUOTE_EXPIRING_SOON_DAYS = 3;

export type QuoteValidityStatus = 'none' | 'valid' | 'expiring_soon' | 'expired';

export interface QuoteValidityInfo {
  readonly status: QuoteValidityStatus;
  readonly validUntil?: string;
  /** Days left until validUntil inclusive (0 = last day; negative = expired). */
  readonly daysLeft?: number;
}

function dayNumber(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/**
 * Validity of a quote revision on a given day (`today` YYYY-MM-DD). The quote
 * holds through the whole `validUntil` day; it is expired from the next day.
 */
export function quoteValidityInfo(
  revision: { readonly validUntil?: string | null },
  today: string,
): QuoteValidityInfo {
  const validUntil = revision.validUntil || undefined;
  if (!validUntil) return { status: 'none' };
  const due = dayNumber(validUntil);
  const now = dayNumber(today);
  if (due === null || now === null) return { status: 'none' };
  const daysLeft = due - now;
  if (daysLeft < 0) return { status: 'expired', validUntil, daysLeft };
  if (daysLeft <= QUOTE_EXPIRING_SOON_DAYS) return { status: 'expiring_soon', validUntil, daysLeft };
  return { status: 'valid', validUntil, daysLeft };
}

/**
 * Calendar day (YYYY-MM-DD) of an instant in a given IANA zone — the factory's
 * "today", the same day the server uses to freeze and expire validity.
 */
export function isoDateInTimeZone(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const y = at.getFullYear();
    return `${y}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  }
}

/** dd/mm/aaaa for a YYYY-MM-DD date, without timezone drift. */
export function formatQuoteValidityDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

/** Short Spanish copy for screens. */
export function quoteValidityLabelEs(info: QuoteValidityInfo): string {
  if (info.status === 'none' || !info.validUntil || info.daysLeft === undefined) {
    return 'Sin vigencia registrada';
  }
  const date = formatQuoteValidityDate(info.validUntil);
  if (info.status === 'expired') {
    const late = -info.daysLeft;
    return `Vencida el ${date} (hace ${late} día${late === 1 ? '' : 's'})`;
  }
  if (info.daysLeft === 0) return `Vigente hasta hoy (${date})`;
  if (info.daysLeft === 1) return `Vigente hasta mañana (${date})`;
  return `Vigente hasta el ${date} (faltan ${info.daysLeft} días)`;
}

/** Document line for the client-facing PDF/XLSX. */
export function quoteValidityDocumentLabelEs(validUntil?: string | null): string | undefined {
  return validUntil ? `Válida hasta el ${formatQuoteValidityDate(validUntil)}` : undefined;
}
