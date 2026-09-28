/** @vitest-environment jsdom */
/**
 * #875 live section tests: the query re-keys on semantic intent, an old
 * design's response can never paint over a new one, and the panel states
 * (loading/success/error/retry) come straight from the query lifecycle.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AuthoringResolveResponseV1 } from '@granete/domain';

import { JoineryResolveSection, type JoineryResolveItem } from './JoineryResolveSection';

const item: JoineryResolveItem = {
  id: 'item-01',
  furnitureDefinitionId: 'def-01',
  parameters: { baseJointStations: 3 },
  materialChoices: { INTERIOR: 'mat-oak18' },
  displayName: 'Gabinete 600',
};

function acceptedResponseFor(relationshipId: string, stage: string): AuthoringResolveResponseV1 {
  return {
    schemaId: 'granete.sketchup-authoring-resolve.v1',
    schemaName: 'granete.sketchup-authoring-resolve',
    schemaVersion: '1.0',
    resolveContract: 'granete.sketchup-authoring-resolve.v1',
    responseMessageId: 'resolve-x',
    inReplyToMessageId: 'x',
    idempotencyKey: 'x',
    catalogRevision: 'rev-01',
    status: 'accepted',
    normalizedSnapshot: {
      parameters: {}, materialChoices: {}, components: [], relationships: [], hardwarePlacements: [],
    },
    resolved: {
      layout: {
        furnitureDefinitionId: 'def-01', definitionName: 'G', transformContract: 'granete.local-basis.v1',
        dimensionsMm: [600, 720, 560], components: [], hardware: [],
      },
      machining: {
        operations: [], derivedHardwarePlacements: [],
        manufacturingFingerprint: `sha256-${'a'.repeat(64)}`,
        joineryStatuses: [{
          relationshipId, kind: 'floor-side', stage,
          contacts: [
            { contactId: `${relationshipId}:side-left-01`, status: 'VALID', issueCodes: [] },
            { contactId: `${relationshipId}:side-right-01`, status: 'VALID', issueCodes: [] },
          ],
          stations: {
            status: 'PLANNED', issueCodes: [],
            stationCounts: [{ contactId: `${relationshipId}:side-left-01`, stationCount: 3 }],
            stationDistances: [{ contactId: `${relationshipId}:side-left-01`, distancesMm: [30, 261, 492] }],
          },
          blockers: ['TECHNICAL_PROFILE_REQUIRED'],
        }],
      },
      preflight: { scope: 'authoring-resolve-subset', status: 'clear', issues: [], preflightContract: 'granete.manufacturing-preflight.v1' },
    },
    issues: [],
  } as unknown as AuthoringResolveResponseV1;
}

/** Echo the envelope correlation so the fail-closed parse accepts the mock. */
function echoResolve(relationshipId: string, stage: string) {
  return vi.fn(async (_token: string, request: { messageId: string; idempotencyKey: string }) => {
    const response = acceptedResponseFor(relationshipId, stage);
    const correlated = {
      ...response,
      responseMessageId: `resolve-${request.messageId}`,
      inReplyToMessageId: request.messageId,
      idempotencyKey: request.idempotencyKey,
    } as AuthoringResolveResponseV1;
    return correlated;
  });
}

function renderSection(props: Partial<Parameters<typeof JoineryResolveSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const merged = {
    designId: 'design-01',
    catalogRevision: 'rev-01',
    items: [item],
    resolve: echoResolve('rel-floor-sides-01', 'TECHNICAL_PROFILE_REQUIRED'),
    token: 'token-01',
    ...props,
  } as Parameters<typeof JoineryResolveSection>[0];
  const view = render(
    <QueryClientProvider client={client}>
      <JoineryResolveSection {...merged} />
    </QueryClientProvider>,
  );
  return { view, resolve: merged.resolve as ReturnType<typeof vi.fn> };
}

describe('JoineryResolveSection', () => {
  it('renders the loading state and then the resolved backend statuses', async () => {
    const { resolve } = renderSection();
    expect(screen.getByTestId('joinery-loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('joinery-relationships')).toBeTruthy());
    const relationshipsText = screen.getByTestId('joinery-relationships').textContent ?? '';
    expect(relationshipsText).toContain('side-left-01: válido');
    expect(relationshipsText).toContain('side-right-01: válido');
    expect(screen.getByText(/Producción bloqueada/)).toBeTruthy();
    expect(screen.getByTestId('joinery-relationships').textContent ?? '').toContain('Perfil técnico requerido');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('shows the empty panel state when the backend reports no joinery', async () => {
    renderSection({
      resolve: vi.fn(async (_token: string, request: { messageId: string; idempotencyKey: string }) => {
        const response = acceptedResponseFor('rel-floor-sides-01', 'TECHNICAL_PROFILE_REQUIRED');
        (response.resolved as unknown as { machining: { joineryStatuses: unknown[] } }).machining.joineryStatuses = [];
        return { ...response, responseMessageId: `resolve-${request.messageId}`,
          inReplyToMessageId: request.messageId, idempotencyKey: request.idempotencyKey };
      }),
    });
    await waitFor(() => expect(screen.getByTestId('joinery-empty')).toBeTruthy());
  });

  it('shows a structured error with a retry path when the resolve fails', async () => {
    const { resolve } = renderSection({
      resolve: vi.fn(async (_t, _i, signal) => {
        // Abort-aware rejection mirroring the transport layer.
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        throw new Error('network down');
      }),
    });
    await waitFor(() => expect(screen.getByTestId('joinery-error')).toBeTruthy());
    expect(resolve).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  });

  it('never lets a slow design-A response paint over design B', async () => {
    let call = 0;
    const slowResolve = vi.fn(async (_token: string, request: { messageId: string; idempotencyKey: string }) => {
      const correlate = (relationshipId: string): AuthoringResolveResponseV1 => {
        const response = acceptedResponseFor(relationshipId, 'TECHNICAL_PROFILE_REQUIRED');
        return { ...response, responseMessageId: `resolve-${request.messageId}`,
          inReplyToMessageId: request.messageId, idempotencyKey: request.idempotencyKey };
      };
      call += 1;
      if (call === 1) {
        await new Promise((done) => setTimeout(done, 80));
        return correlate('rel-floor-sides-A');
      }
      return correlate('rel-floor-sides-B');
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      designId: 'design-A',
      catalogRevision: 'rev-01',
      items: [item],
      resolve: slowResolve,
      token: 'token-01',
    } as Parameters<typeof JoineryResolveSection>[0];
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <JoineryResolveSection {...props} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={client}>
        <JoineryResolveSection {...props} designId="design-B" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('rel-floor-sides-B')).toBeTruthy());
    // Design A resolves late — its statuses never appear.
    expect(screen.queryByText('rel-floor-sides-A')).toBeNull();
  });

  it('explains the missing catalog revision instead of resolving', () => {
    renderSection({ catalogRevision: null });
    expect(screen.getByTestId('joinery-resolve-no-revision')).toBeTruthy();
  });
});
