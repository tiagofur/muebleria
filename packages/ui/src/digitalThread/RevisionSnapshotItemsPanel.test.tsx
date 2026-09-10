// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignRevisionItem } from '@granete/storage';
import { RevisionSnapshotItemsPanel } from './RevisionSnapshotItemsPanel';

const id = '11111111-1111-4111-8111-111111111111';
const base: DesignRevisionItem = {
  id, design_revision_id: id, furniture_instance_id: '22222222-2222-4222-8222-222222222222',
  furniture_definition_id: '33333333-3333-4333-8333-333333333333', parameters: {}, material_choices: {},
  descriptor_state: 'available', created_at: '2026-09-09T00:00:00Z',
  presentation_snapshot: {
    schema_version: 1, unit: { label: 'Gabinete bajo 1 de 2', index: 1, total: 2 },
    definition: { name: 'Gabinete bajo', code: 'MOD-GAB-01' },
    parameters: [{ key: 'widthMm', label: 'Ancho', type: 'number', value: 600, unit: 'mm', state: 'available' }],
    materials: [{ role: 'INTERIOR', role_label: 'Interior', name: 'Blanco', code: 'MAT-BLA', effective_thickness_mm: 18, provenance: 'quoted' }],
    room: { label: 'Cocina', state: 'available' },
  },
};

afterEach(cleanup);

describe('RevisionSnapshotItemsPanel', () => {
  it('presents frozen business labels and exposes a focusable semantic technical disclosure', () => {
    render(<RevisionSnapshotItemsPanel items={[base]} />);
    expect(screen.getByRole('heading', { name: 'Gabinete bajo 1 de 2' })).toBeTruthy();
    expect(screen.getByText('Tomado de cotización')).toBeTruthy();
    const summary = screen.getByText('Identificadores técnicos');
    const disclosure = summary.closest('details');
    expect(disclosure?.open).toBe(false);
    summary.focus();
    expect(document.activeElement).toBe(summary);
    expect(summary.tagName).toBe('SUMMARY');
    fireEvent.click(summary);
    expect(disclosure?.open).toBe(true);
    expect(screen.getByText(base.furniture_instance_id)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar FurnitureInstance ID' })).toBeTruthy();
  });

  it('labels legacy revisions honestly without a mutable catalog projection', () => {
    render(<RevisionSnapshotItemsPanel items={[{ ...base, descriptor_state: 'unavailable_legacy', presentation_snapshot: undefined }]} />);
    expect(screen.getByText('Descripción histórica no disponible')).toBeTruthy();
    expect(screen.queryByText('Gabinete bajo')).toBeNull();
  });
});
