/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project, WarrantyTicket, WorkshopAnalytics } from '@muebles/domain';
import { computeWorkshopAnalytics } from '@muebles/domain';
import { WorkshopAnalyticsPanel } from './WorkshopAnalyticsPanel';

afterEach(() => cleanup());

const NOW = new Date('2026-08-15T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const projects: Project[] = [
  {
    id: 'p1',
    name: 'Cocina A',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [],
    createdAt: iso(10),
    updatedAt: iso(6),
    priceSnapshot: {
      capturedAt: iso(6),
      breakdown: {
        materialsCost: 400,
        edgeTotal: 0,
        hardwareTotal: 0,
        directCost: 500,
        laborModular: 0,
        laborFixedCost: 0,
        marginFactor: 1.35,
        salePrice: 1000,
      },
    },
  },
  {
    id: 'p2',
    name: 'Closet B',
    customerId: 'c2',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'quoted',
    items: [],
    createdAt: iso(3),
    updatedAt: iso(3),
    priceSnapshot: {
      capturedAt: iso(3),
      breakdown: {
        materialsCost: 300,
        edgeTotal: 0,
        hardwareTotal: 0,
        directCost: 400,
        laborModular: 0,
        laborFixedCost: 0,
        marginFactor: 1.35,
        salePrice: 800,
      },
    },
  },
];

const tickets: WarrantyTicket[] = [
  {
    id: 't1',
    ticketNumber: 'G-001',
    projectId: 'p1',
    title: 'Frente rayado',
    description: '',
    category: 'damaged_part',
    priority: 'normal',
    status: 'open',
    refabricationPieces: [
      {
        pieceDescription: 'Frente',
        materialName: 'Meli 18',
        lengthMm: 1000,
        widthMm: 500,
        quantity: 2,
        grain: 0,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ],
    photos: [],
    createdAt: iso(5),
    updatedAt: iso(5),
  },
];

function analytics(period: 'all' | 30 = 'all'): WorkshopAnalytics {
  return computeWorkshopAnalytics(projects, tickets, { now: NOW, period });
}

describe('WorkshopAnalyticsPanel (F090)', () => {
  it('renders commercial conversion cards from domain analytics', () => {
    render(
      <WorkshopAnalyticsPanel
        analytics={analytics()}
        period="all"
        onPeriodChange={() => undefined}
      />,
    );

    expect(screen.getByTestId('dashboard-analytics')).toBeTruthy();
    // won 1, quoted 1 → 50%
    expect(screen.getByTestId('analytics-quote-won-rate').textContent).toContain(
      '50%',
    );
    // createdAt 10d ago → accepted 6d ago = 4 days
    expect(
      screen.getByTestId('analytics-avg-close-days').textContent,
    ).toContain('4.0');
    expect(screen.getByTestId('analytics-avg-ticket').textContent).toContain(
      '1,000.00',
    );
    expect(screen.getByTestId('analytics-open-pipeline').textContent).toContain(
      '1',
    );
  });

  it('renders funnel status bars and warranty blocks', () => {
    render(
      <WorkshopAnalyticsPanel
        analytics={analytics()}
        period="all"
        onPeriodChange={() => undefined}
      />,
    );

    expect(screen.getByTestId('analytics-funnel-quoted')).toBeTruthy();
    expect(screen.getByTestId('analytics-funnel-accepted')).toBeTruthy();
    expect(screen.getByTestId('analytics-warranty-total').textContent).toContain(
      '1',
    );
    expect(screen.getByTestId('analytics-warranty-board').textContent).toContain(
      '1.00 m²',
    );
    // Margin at risk: only p1 has a ticket → 1000 − 500 = 500
    expect(
      screen.getByTestId('analytics-warranty-margin').textContent,
    ).toContain('500.00');
    // Top piece from refabrication
    expect(screen.getByTestId('analytics-piece-Frente')).toBeTruthy();
    // Category bar for damaged_part
    expect(screen.getByTestId('analytics-category-damaged_part')).toBeTruthy();
  });

  it('switches the period via chips', async () => {
    const onPeriodChange = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkshopAnalyticsPanel
        analytics={analytics()}
        period="all"
        onPeriodChange={onPeriodChange}
      />,
    );
    await user.click(screen.getByTestId('analytics-period-30'));
    expect(onPeriodChange).toHaveBeenCalledWith(30);
  });

  it('shows the empty state for a period without activity', () => {
    render(
      <WorkshopAnalyticsPanel
        analytics={analytics(30)}
        period={30}
        onPeriodChange={() => undefined}
      />,
    );
    // p1/p2/t1 were created within 30d → data exists; force empty with 'all' vs 30 mismatch:
    // instead verify a truly empty analytics object
    const empty = computeWorkshopAnalytics([], [], { now: NOW });
    cleanup();
    render(
      <WorkshopAnalyticsPanel
        analytics={empty}
        period="all"
        onPeriodChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('analytics-empty')).toBeTruthy();
  });

  it('shows loading state', () => {
    render(
      <WorkshopAnalyticsPanel
        analytics={analytics()}
        period="all"
        onPeriodChange={() => undefined}
        loading
      />,
    );
    expect(screen.getByTestId('analytics-loading')).toBeTruthy();
  });
});
