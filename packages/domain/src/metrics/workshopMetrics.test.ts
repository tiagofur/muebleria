import { describe, expect, it } from 'vitest';
import type { Project, WarrantyTicket } from '../types';
import {
  computeCommercialFunnel,
  computeWarrantyAnalytics,
  computeWorkshopAnalytics,
  withinAnalyticsPeriod,
} from './workshopMetrics';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

type ProjectOverrides = Partial<Project> & { id: string };

function project(over: ProjectOverrides): Project {
  return {
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [],
    createdAt: iso(10),
    updatedAt: iso(10),
    ...over,
  };
}

type TicketOverrides = Partial<WarrantyTicket> & { id: string };

function ticket(over: TicketOverrides): WarrantyTicket {
  return {
    ticketNumber: 'G-001',
    projectId: 'p1',
    title: 'Reclamo',
    description: '',
    category: 'damaged_part',
    priority: 'normal',
    status: 'open',
    refabricationPieces: [],
    photos: [],
    createdAt: iso(5),
    updatedAt: iso(5),
    ...over,
  };
}

describe('withinAnalyticsPeriod (F090)', () => {
  it('includes by window and all-inclusive mode', () => {
    expect(withinAnalyticsPeriod(iso(10), NOW, 30)).toBe(true);
    expect(withinAnalyticsPeriod(iso(40), NOW, 30)).toBe(false);
    expect(withinAnalyticsPeriod(iso(4000), NOW, 'all')).toBe(true);
    expect(withinAnalyticsPeriod(undefined, NOW, 30)).toBe(false);
    expect(withinAnalyticsPeriod('no-fecha', NOW, 30)).toBe(false);
  });
});

describe('computeCommercialFunnel (F090)', () => {
  const snapshot = (daysAgoCaptured: number, sale: number, direct = 100) => ({
    capturedAt: iso(daysAgoCaptured),
    breakdown: {
      materialsCost: direct,
      edgeTotal: 0,
      hardwareTotal: 0,
      directCost: direct,
      laborModular: 0,
      laborFixedCost: 0,
      marginFactor: 1.35,
      salePrice: sale,
    },
  });

  it('empty workspace yields zeros and null rates', () => {
    const m = computeCommercialFunnel([], { now: NOW });
    expect(m.openPipelineCount).toBe(0);
    expect(m.quoteToWonRate).toBeNull();
    expect(m.avgDaysToClose).toBeNull();
    expect(m.avgTicket).toBeNull();
    expect(m.stalledOldestDays).toBeNull();
  });

  it('computes acceptance rate, avg close days and avg ticket over won deals', () => {
    const projects = [
      // Won in 4 days, sold at 1000 (createdAt 10d ago, accepted 6d ago)
      project({
        id: 'a',
        status: 'accepted',
        createdAt: iso(10),
        updatedAt: iso(6),
        priceSnapshot: snapshot(6, 1000),
      }),
      // Won in 8 days, sold at 500
      project({
        id: 'b',
        status: 'produced',
        createdAt: iso(20),
        updatedAt: iso(12),
        priceSnapshot: snapshot(12, 500),
      }),
      // Draft
      project({ id: 'c', status: 'draft', createdAt: iso(30) }),
      // Open, quoted with snapshot
      project({
        id: 'd',
        status: 'quoted',
        createdAt: iso(3),
        updatedAt: iso(3),
        priceSnapshot: snapshot(3, 800),
      }),
    ];
    const m = computeCommercialFunnel(projects, { now: NOW });
    expect(m.wonCount).toBe(2);
    expect(m.quoteToWonRate).toBeCloseTo(2 / 3);
    expect(m.avgDaysToClose).toBeCloseTo(6); // (4 + 8) / 2
    expect(m.avgTicket).toBe(750);
    expect(m.openPipelineCount).toBe(2);
    expect(m.openPipelineValue).toBe(800);
  });

  it('flags stalled open quotes by updatedAt with oldest age', () => {
    const projects = [
      project({ id: 'fresh', status: 'quoted', updatedAt: iso(2) }),
      project({ id: 'stale1', status: 'draft', updatedAt: iso(20) }),
      project({ id: 'stale2', status: 'quoted', updatedAt: iso(31) }),
      project({ id: 'won', status: 'accepted', updatedAt: iso(60) }),
    ];
    const m = computeCommercialFunnel(projects, {
      now: NOW,
      stalledAfterDays: 14,
    });
    expect(m.stalledCount).toBe(2);
    expect(m.stalledOldestDays).toBeCloseTo(31);
  });

  it('period buckets by createdAt (old wins excluded from 30d)', () => {
    const projects = [
      project({ id: 'old', status: 'accepted', createdAt: iso(90), priceSnapshot: snapshot(80, 900) }),
      project({ id: 'new', status: 'quoted', createdAt: iso(5) }),
    ];
    const m = computeCommercialFunnel(projects, { now: NOW, period: 30 });
    expect(m.counts.quoted).toBe(1);
    expect(m.counts.accepted).toBe(0);
    expect(m.wonCount).toBe(0);
    // Period 'all' sees both.
    const all = computeCommercialFunnel(projects, { now: NOW, period: 'all' });
    expect(all.wonCount).toBe(1);
  });
});

describe('computeWarrantyAnalytics (F090)', () => {
  const pieces = (qty = 1, lenMm = 1000, widMm = 500, label = 'Frente') => [
    {
      pieceDescription: label,
      materialName: 'Meli 18',
      lengthMm: lenMm,
      widthMm: widMm,
      quantity: qty,
      grain: 0 as const,
      L1: 0 as const,
      L2: 0 as const,
      W1: 0 as const,
      W2: 0 as const,
    },
  ];

  it('aggregates counts by status and category', () => {
    const tickets = [
      ticket({ id: 't1', category: 'damaged_part', status: 'open' }),
      ticket({ id: 't2', category: 'damaged_part', status: 'resolved' }),
      ticket({ id: 't3', category: 'hardware_adjustment', status: 'cancelled' }),
    ];
    const m = computeWarrantyAnalytics(tickets, [], { now: NOW });
    expect(m.total).toBe(3);
    expect(m.open).toBe(1);
    expect(m.resolved).toBe(2); // resolved + cancelled
    expect(m.byCategory.damaged_part).toBe(2);
    expect(m.byCategory.hardware_adjustment).toBe(1);
  });

  it('aggregates refabricated board m² and piece incidence across tickets', () => {
    const tickets = [
      ticket({ id: 't1', refabricationPieces: pieces(2, 1000, 500, 'Frente') }),
      ticket({ id: 't2', refabricationPieces: pieces(1, 1000, 500, 'Frente') }),
      ticket({ id: 't3', refabricationPieces: pieces(1, 600, 400, 'Costado') }),
    ];
    const m = computeWarrantyAnalytics(tickets, [], { now: NOW });
    // Frente: 3 piezas de 0.5 m² = 1.5; Costado: 0.24 → total 1.74
    expect(m.refabricatedPieceCount).toBe(4);
    expect(m.refabricatedBoardM2).toBeCloseTo(1.74, 5);
    expect(m.topPieces[0]).toMatchObject({
      label: 'Frente',
      occurrences: 2,
      quantity: 3,
    });
    expect(m.topPieces).toHaveLength(2);
  });

  it('caps top pieces at 5 sorted by occurrences then quantity', () => {
    const tickets = Array.from({ length: 7 }, (_, i) =>
      ticket({
        id: `t${i}`,
        refabricationPieces: pieces(i + 1, 500, 400, `Pieza ${i}`),
      }),
    );
    const m = computeWarrantyAnalytics(tickets, [], { now: NOW });
    expect(m.topPieces).toHaveLength(5);
    // All have 1 occurrence; sorted by quantity desc → Pieza 6 first.
    expect(m.topPieces[0]?.label).toBe('Pieza 6');
  });

  it('margin at risk sums snapshots of affected projects only', () => {
    const projects = [
      project({
        id: 'p1',
        status: 'accepted',
        priceSnapshot: {
          capturedAt: iso(5),
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
      }),
      project({
        id: 'p2',
        status: 'accepted',
        priceSnapshot: {
          capturedAt: iso(5),
          breakdown: {
            materialsCost: 200,
            edgeTotal: 0,
            hardwareTotal: 0,
            directCost: 300,
            laborModular: 0,
            laborFixedCost: 0,
            marginFactor: 1.35,
            salePrice: 900,
          },
        },
      }),
    ];
    const tickets = [
      ticket({ id: 't1', projectId: 'p1' }),
      ticket({ id: 't2', projectId: 'p1' }), // mismo proyecto: margen NO se duplica
    ];
    const m = computeWarrantyAnalytics(tickets, projects, { now: NOW });
    expect(m.projectsAffected).toBe(1);
    expect(m.marginAtRisk).toBe(500); // solo p1 (1000 − 500)
  });

  it('margin at risk is null when no affected project has snapshot', () => {
    const m = computeWarrantyAnalytics([ticket({ id: 't1' })], [], { now: NOW });
    expect(m.marginAtRisk).toBeNull();
  });

  it('period filters tickets by createdAt', () => {
    const tickets = [
      ticket({ id: 'recent', createdAt: iso(10) }),
      ticket({ id: 'old', createdAt: iso(100) }),
    ];
    expect(computeWarrantyAnalytics(tickets, [], { now: NOW, period: 30 }).total).toBe(1);
    expect(computeWarrantyAnalytics(tickets, [], { now: NOW, period: 'all' }).total).toBe(2);
  });
});

describe('computeWorkshopAnalytics (F090)', () => {
  it('composes funnel + warranties with the same period', () => {
    const projects = [project({ id: 'p1', status: 'quoted', createdAt: iso(5) })];
    const tickets = [ticket({ id: 't1', createdAt: iso(5) })];
    const a = computeWorkshopAnalytics(projects, tickets, {
      now: NOW,
      period: 30,
    });
    expect(a.funnel.period).toBe(30);
    expect(a.funnel.openPipelineCount).toBe(1);
    expect(a.warranties.total).toBe(1);
  });
});
