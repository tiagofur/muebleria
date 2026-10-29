/**
 * #1417 — «Partes del diseño» section behavior: add/edit/remove rows with
 * #1376 membership vocabulary; removal trims the draft; defaults are sane.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HardwareDesignPartsSection } from './HardwareDesignPartsSection';
import type { HardwareDraft } from './hardwareDraft';

afterEach(cleanup);

function baseDraft(designParts: HardwareDraft['designParts'] = []): HardwareDraft {
  return {
    code: 'CORR-IZQ',
    name: 'Corredera izq',
    unit: 'piece',
    costPerUnit: 0,
    packageSize: '',
    imageUrl: '',
    notes: '',
    previewShape: 'slide',
    previewColor: '',
    previewSizeMm: '',
    previewDiameterMm: '',
    previewProjectionMm: '',
    previewRoughness: '',
    previewMetalness: '',
    previewClearcoat: '',
    partFinishes: { body: '', base: '', grip: '' },
    machining: null,
    visualAsset: null,
    maxOpeningAngleDeg: '',
    designParts,
  };
}

function Harness({ initial, onDraft }: { initial: HardwareDraft; onDraft: (d: HardwareDraft) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <HardwareDesignPartsSection
      draft={draft}
      setDraft={(updater) => {
        const next = typeof updater === 'function' ? updater(draft) : updater;
        setDraft(next);
        onDraft(next);
      }}
    />
  );
}

describe('HardwareDesignPartsSection (#1417)', () => {
  it('añade una fila con default body y edita sus campos', async () => {
    const user = userEvent.setup();
    let latest: HardwareDraft | null = null;
    render(<Harness initial={baseDraft()} onDraft={(d) => (latest = d)} />);

    await user.click(screen.getByTestId('hardware-design-parts-add'));
    expect(latest?.designParts).toHaveLength(1);
    expect(latest?.designParts?.[0]).toMatchObject({ componentName: '', actorMembership: 'body' });

    await user.type(screen.getByTestId('hardware-design-part-0-name'), 'riel_fijo');
    expect(latest?.designParts?.[0]?.componentName).toBe('riel_fijo');
  });

  it('elimina filas por índice', async () => {
    const user = userEvent.setup();
    const draft = baseDraft([
      { componentName: 'riel_fijo', actorMembership: 'body', label: '', finishKey: '' },
      { componentName: 'riel_movil', actorMembership: 'actor:drawer', label: '', finishKey: 'body' },
    ]);
    const setDraft = vi.fn((updater: (d: HardwareDraft) => HardwareDraft) => {
      draft.designParts = updater(draft).designParts;
    });
    render(<HardwareDesignPartsSection draft={draft} setDraft={setDraft} />);

    await user.click(screen.getByTestId('hardware-design-part-0-remove'));
    expect(draft.designParts?.map((p) => p.componentName)).toEqual(['riel_movil']);
  });

  it('cambia la membresía dentro del vocabulario #1376', async () => {
    const user = userEvent.setup();
    const draft = baseDraft([
      { componentName: 'riel_movil', actorMembership: 'body', label: '', finishKey: '' },
    ]);
    const setDraft = vi.fn((updater: (d: HardwareDraft) => HardwareDraft) => {
      draft.designParts = updater(draft).designParts;
    });
    render(<HardwareDesignPartsSection draft={draft} setDraft={setDraft} />);

    await user.selectOptions(screen.getByTestId('hardware-design-part-0-membership'), 'actor:drawer');
    expect(draft.designParts?.[0]?.actorMembership).toBe('actor:drawer');
  });
});
