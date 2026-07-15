import { describe, expect, it } from 'vitest';
import type { ProjectStatus } from '@muebles/domain';
import {
  countActiveMaterials,
  countActiveProjects,
  countModules,
  formatDashboardMoney,
  selectRecentProjects,
  sumMonthlyQuotedTotal,
} from './dashboardHelpers';

function project(
  id: string,
  status: ProjectStatus,
  updatedAt: string,
): { id: string; status: ProjectStatus; updatedAt: string } {
  return { id, status, updatedAt };
}

describe('dashboardHelpers (F023)', () => {
  it('countActiveProjects counts draft + quoted only', () => {
    const projects = [
      project('a', 'draft', '2026-07-01T00:00:00.000Z'),
      project('b', 'quoted', '2026-07-02T00:00:00.000Z'),
      project('c', 'accepted', '2026-07-03T00:00:00.000Z'),
      project('d', 'draft', '2026-07-04T00:00:00.000Z'),
    ];
    expect(countActiveProjects(projects)).toBe(3);
    expect(countActiveProjects([])).toBe(0);
  });

  it('countActiveMaterials counts active flags', () => {
    expect(
      countActiveMaterials([
        { active: true },
        { active: false },
        { active: true },
      ]),
    ).toBe(2);
    expect(countActiveMaterials([])).toBe(0);
  });

  it('countModules returns length', () => {
    expect(countModules([1, 2, 3])).toBe(3);
    expect(countModules([])).toBe(0);
  });

  it('selectRecentProjects sorts by updatedAt desc and limits', () => {
    const projects = [
      project('old', 'draft', '2026-01-01T00:00:00.000Z'),
      project('mid', 'quoted', '2026-06-15T12:00:00.000Z'),
      project('new', 'accepted', '2026-07-10T08:00:00.000Z'),
      project('newer', 'draft', '2026-07-12T18:00:00.000Z'),
    ];
    const top2 = selectRecentProjects(projects, 2);
    expect(top2.map((p) => p.id)).toEqual(['newer', 'new']);

    const top5 = selectRecentProjects(projects, 5);
    expect(top5).toHaveLength(4);
    expect(top5.map((p) => p.id)).toEqual(['newer', 'new', 'mid', 'old']);

    expect(selectRecentProjects([], 5)).toEqual([]);
  });

  it('selectRecentProjects defaults limit to 5', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      project(`p${i}`, 'draft', `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
    );
    expect(selectRecentProjects(many)).toHaveLength(5);
    expect(selectRecentProjects(many).map((p) => p.id)).toEqual([
      'p7',
      'p6',
      'p5',
      'p4',
      'p3',
    ]);
  });

  it('sumMonthlyQuotedTotal sums quoted/accepted in current calendar month', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    const projects = [
      project('q1', 'quoted', '2026-07-01T00:00:00.000Z'),
      project('q2', 'accepted', '2026-07-10T00:00:00.000Z'),
      project('q3', 'quoted', '2026-06-28T00:00:00.000Z'), // previous month
      project('d1', 'draft', '2026-07-05T00:00:00.000Z'), // draft ignored
      project('q4', 'quoted', '2026-07-12T00:00:00.000Z'), // null estimate
    ];
    const estimates = {
      q1: 100,
      q2: 250.5,
      q3: 999,
      d1: 50,
      q4: null as number | null,
    };
    expect(sumMonthlyQuotedTotal(projects, estimates, now)).toBe(350.5);
  });

  it('formatDashboardMoney uses 2 decimals', () => {
    expect(formatDashboardMoney(202.5)).toBe('202.50');
    expect(formatDashboardMoney(0)).toBe('0.00');
  });
});
