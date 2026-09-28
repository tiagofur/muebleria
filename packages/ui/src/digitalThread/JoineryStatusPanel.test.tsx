/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { JoineryRelationshipStatus } from '@granete/domain';

import {
  JoineryStatusPanel,
  joineryDiagnosticsModel,
  shortContactLabel,
} from './JoineryStatusPanel';

const floorSideStatus = (): JoineryRelationshipStatus => ({
  relationshipId: 'rel-floor-sides-01',
  kind: 'floor-side',
  stage: 'TECHNICAL_PROFILE_REQUIRED',
  contacts: [
    { contactId: 'rel-floor-sides-01:side-left-01', status: 'VALID', issueCodes: [] },
    { contactId: 'rel-floor-sides-01:side-right-01', status: 'VALID', issueCodes: [] },
  ],
  stations: {
    status: 'PLANNED', issueCodes: [],
    stationCounts: [
      { contactId: 'rel-floor-sides-01:side-left-01', stationCount: 3 },
      { contactId: 'rel-floor-sides-01:side-right-01', stationCount: 3 },
    ],
    stationDistances: [
      { contactId: 'rel-floor-sides-01:side-left-01', distancesMm: [30, 261, 492] },
      { contactId: 'rel-floor-sides-01:side-right-01', distancesMm: [30, 252, 474] },
    ],
  },
  blockers: ['TECHNICAL_PROFILE_REQUIRED'],
});

describe('joineryDiagnosticsModel', () => {
  it('projects backend states verbatim with Spanish labels', () => {
    const [diagnostic] = joineryDiagnosticsModel([floorSideStatus()], new Map([['rel-floor-sides-01', 0]]));
    expect(diagnostic?.stageLabel).toBe('Perfil técnico requerido');
    expect(diagnostic?.contacts.map((contact) => [shortContactLabel(contact.contactId), contact.valid]))
      .toEqual([['side-left-01', true], ['side-right-01', true]]);
    expect(diagnostic?.stationsPlanned).toBe(true);
    expect(diagnostic?.stationSummary).toBe('3 · 3');
    expect(diagnostic?.operationsCount).toBe(0);
    expect(diagnostic?.profileRequired).toBe(true);
    expect(diagnostic?.productionReady).toBe(false);
  });

  it('keeps invalid contacts and unsupported relationships distinguishable', () => {
    const invalid = { ...floorSideStatus(), stage: 'CONTACT_INVALID' as const,
      contacts: [{ contactId: 'rel-floor-sides-01:side-left-01', status: 'INVALID' as const, issueCodes: ['CONTACT_FACE_REQUIRED'] }],
      stations: { status: 'NOT_PLANNED' as const, issueCodes: [], stationCounts: [], stationDistances: [] },
      blockers: ['CONTACT_FACE_REQUIRED'] } satisfies JoineryRelationshipStatus;
    const unsupported = { ...floorSideStatus(), relationshipId: 'rel-x', kind: 'mystery',
      stage: 'RELATIONSHIP_UNSUPPORTED' as const, contacts: [],
      stations: { status: 'NOT_PLANNED' as const, issueCodes: [], stationCounts: [], stationDistances: [] },
      blockers: ['RELATIONSHIP_INVALID'] } satisfies JoineryRelationshipStatus;
    const model = joineryDiagnosticsModel([invalid, unsupported], new Map());
    expect(model[0]?.stageLabel).toBe('Contacto inválido');
    expect(model[0]?.contacts[0]?.valid).toBe(false);
    expect(model[0]?.stationsPlanned).toBe(false);
    expect(model[1]?.stageLabel).toBe('Relación no soportada');
    expect(model[1]?.stationSummary).toBe('—');
  });
});

describe('JoineryStatusPanel', () => {
  afterEach(cleanup);

  it('renders the canonical floor-side diagnostic end to end', () => {
    render(<JoineryStatusPanel joineryStatuses={[floorSideStatus()]} />);
    expect(screen.getByText('Construcción y uniones')).toBeDefined();
    expect(screen.getByText(/Perfil técnico requerido/)).toBeDefined();
    expect(screen.getByText(/side-left-01: válido/)).toBeDefined();
    expect(screen.getByText(/side-right-01: válido/)).toBeDefined();
    expect(screen.getByText(/Estaciones: 3 · 3 · Operaciones: 0 \(pendientes de perfil técnico\)/)).toBeDefined();
    expect(screen.getByText(/Perfil técnico: requerido/)).toBeDefined();
    expect(screen.getByText(/Producción bloqueada/)).toBeDefined();
    expect(screen.getByText('TECHNICAL_PROFILE_REQUIRED')).toBeDefined();
  });

  it('shows loading, error with retry, null and empty states distinctly', () => {
    const { rerender } = render(<JoineryStatusPanel joineryStatuses={null} loading />);
    expect(screen.getByTestId('joinery-loading').textContent).toBe('Resolviendo…');
    rerender(<JoineryStatusPanel joineryStatuses={null} error onRetry={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toContain('No se pudo resolver');
    expect(screen.getByText('Reintentar')).toBeDefined();
    rerender(<JoineryStatusPanel joineryStatuses={null} />);
    expect(screen.getByText(/Seleccioná un mueble/)).toBeDefined();
    rerender(<JoineryStatusPanel joineryStatuses={[]} />);
    expect(screen.getByTestId('joinery-empty')).toBeDefined();
  });
});
