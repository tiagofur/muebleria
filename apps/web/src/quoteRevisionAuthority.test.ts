import { describe, expect, it } from 'vitest';
import type { QuoteRevisionDetail } from '@granete/storage';
import { selectCommercialQuoteRevision } from './quoteRevisionAuthority';

function revision(revisionNumber: number, status: QuoteRevisionDetail['status']): QuoteRevisionDetail {
  return {
    id: `00000000-0000-4000-8000-${String(revisionNumber).padStart(12, '0')}`,
    projectId: '10000000-0000-4000-8000-000000000001',
    revisionNumber,
    status,
    sourceType: 'manual',
    createdAt: '2026-09-10T12:00:00Z',
    items: [],
  };
}

describe('selectCommercialQuoteRevision', () => {
  it('selects the accepted revision instead of a newer draft', () => {
    expect(
      selectCommercialQuoteRevision([
        revision(1, 'superseded'),
        revision(2, 'accepted'),
        revision(3, 'draft'),
      ])?.revisionNumber,
    ).toBe(2);
  });

  it('selects the newest exact revision when none is accepted', () => {
    expect(
      selectCommercialQuoteRevision([revision(2, 'draft'), revision(1, 'published')])
        ?.revisionNumber,
    ).toBe(2);
  });
});
