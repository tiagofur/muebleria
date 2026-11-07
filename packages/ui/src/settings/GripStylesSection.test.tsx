/**
 * #1533 — GripStylesSection unit tests: list summaries, the single default,
 * editor round-trip with the generated API, the 412 conflict banner, server
 * verbatim previews and honest states. The api handle is a plain object
 * shaped to the methods the section uses.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GripStylesSection, gripStyleSummaryLines } from './GripStylesSection';
import type { GripStyle } from '@granete/storage';

const TOKEN = 'tok-1';

function styleFixture(overrides: Partial<GripStyle> = {}): GripStyle {
  return {
    id: 'style-1',
    organizationId: 'org-1',
    name: 'Jaladera del taller',
    offered: true,
    isDefault: true,
    version: 3,
    byFurnitureType: {
      inferior: { mode: 'handle' },
      superior: { mode: 'handle' },
      alto: { mode: 'handle' },
    },
    ...overrides,
  } as GripStyle;
}

function profilesFixture() {
  const height = 56.5;
  const depth = 27.2;
  return [
    {
      id: 'p-l', code: 'GOLA-L-8006', name: 'Gola L Cymisa 8006',
      usage: { top: { usable: true }, between: { usable: false } },
    },
    {
      id: 'p-c', code: 'GOLA-C-8007', name: 'Gola C 8007',
      usage: { top: { usable: false }, between: { usable: true } },
    },
  ];
}

function apiStub(styles: GripStyle[], calls: { method: string; args: unknown[] }[] = []) {
  const stub = {
    listGripStyles: vi.fn(async () => styles),
    listOpeningProfiles: vi.fn(async () => profilesFixture()),
    listHardware: vi.fn(async () => []),
    previewGripStyles: vi.fn(async (_token: string, _body: unknown) => ({
      previews: [
        { furnitureType: 'inferior', mode: 'gola', preview: 'Mueble de 720 → puerta de 680' },
        { furnitureType: 'superior', mode: 'handle', preview: 'Mueble de 720 → puerta sin descuento (medida de catálogo)' },
      ],
    })),
    createGripStyle: vi.fn(async (_token: string, body: unknown) => {
      calls.push({ method: 'createGripStyle', args: [body] });
      return styleFixture({ id: 'style-new', name: (body as { name: string }).name, version: 1 });
    }),
    updateGripStyle: vi.fn(async (token: string, id: string, version: number, body: unknown) => {
      calls.push({ method: 'updateGripStyle', args: [token, id, version, body] });
      return styleFixture();
    }),
    deleteGripStyle: vi.fn(async () => ({ deleted: true })),
  };
  return { stub, api: stub as unknown as import('@granete/storage').GraneteApiClient };
}

afterEach(() => cleanup());

describe('gripStyleSummaryLines', () => {
  it('names the profile codes and positions per furniture type', () => {
    const style = styleFixture({
      byFurnitureType: {
        inferior: { mode: 'gola', topProfileId: 'p-l', betweenProfileId: 'p-c' },
        superior: { mode: 'bottom_overhang', overhangMm: 20 },
        alto: { mode: 'handle' },
      },
    } as Partial<GripStyle>);
    const codeById = (id: string) => (id === 'p-l' ? 'GOLA-L-8006' : 'GOLA-C-8007');
    const lines = gripStyleSummaryLines(style, codeById);
    expect(lines[0]).toBe('Inferiores: gola GOLA-L-8006 arriba, GOLA-C-8007 entre cajones');
    expect(lines[1]).toBe('Alacenas: rebase 20 mm');
    expect(lines[2]).toBe('Muebles altos: jaladera');
  });
});

describe('GripStylesSection — list', () => {
  it('renders the default badge exactly once and the per-type summary', async () => {
    const second = styleFixture({
      id: 'style-2', name: 'Gola negra', isDefault: false, version: 1,
      byFurnitureType: {
        inferior: { mode: 'gola', topProfileId: 'p-l' },
        superior: { mode: 'bottom_overhang', overhangMm: 20 },
        alto: { mode: 'handle' },
      },
    } as Partial<GripStyle>);
    const { api } = apiStub([styleFixture(), second]);
    render(<GripStylesSection api={api} token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId('grip-styles-list')).toBeDefined());
    expect(screen.getAllByTestId(/^grip-style-default-/)).toHaveLength(1);
    expect(screen.getByTestId('grip-style-summary-style-1').textContent).toContain('Inferiores: jaladera');
    expect(screen.getByTestId('grip-style-summary-style-2').textContent).toContain('Alacenas: rebase 20 mm');
  });

  it('shows the honest loading and error states', async () => {
    const { stub, api } = apiStub([]);
    stub.listGripStyles.mockRejectedValueOnce(new Error('la sesión expiró'));
    render(<GripStylesSection api={api} token={TOKEN} />);
    expect(screen.getByTestId('grip-styles-loading')).toBeDefined();
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByTestId('grip-styles-retry')).toBeDefined();
  });

  it('shows the empty state when the workshop has no styles', async () => {
    const { api } = apiStub([]);
    render(<GripStylesSection api={api} token={TOKEN} />);
    await waitFor(() => expect(screen.getByText('Sin estilos de agarre')).toBeDefined());
    expect(screen.getByText('Crear el primer estilo')).toBeDefined();
  });
});

describe('GripStylesSection — editor round-trip', () => {
  it('creates a style through the generated API with the drafted recipes', async () => {
    const user = userEvent.setup();
    const calls: { method: string; args: unknown[] }[] = [];
    const { api } = apiStub([styleFixture()], calls);
    render(<GripStylesSection api={api} token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId('grip-styles-create')).toBeDefined());
    await user.click(screen.getByTestId('grip-styles-create'));

    await user.type(screen.getByTestId('grip-style-name'), 'Gola negra');
    // Inferior: gola with L top + C between (only usable profiles appear).
    await user.selectOptions(screen.getByTestId('grip-style-mode-inferior'), 'gola');
    const topOptions = (screen.getByTestId('grip-style-top-profile-inferior') as HTMLSelectElement)
      .querySelectorAll('option');
    const optionValues = Array.from(topOptions).map((o) => o.value);
    expect(optionValues).toContain('p-l');
    expect(optionValues).not.toContain('p-c'); // not usable at top
    await user.selectOptions(screen.getByTestId('grip-style-top-profile-inferior'), 'p-l');
    await user.selectOptions(screen.getByTestId('grip-style-between-profile-inferior'), 'p-c');
    // Superior: rebase 20.
    await user.selectOptions(screen.getByTestId('grip-style-mode-superior'), 'bottom_overhang');
    expect((screen.getByTestId('grip-style-overhang-superior') as HTMLInputElement).value).toBe('20');

    // Server-computed preview, rendered verbatim.
    await waitFor(() => expect(screen.getByTestId('grip-style-preview-inferior').textContent).toBe('Mueble de 720 → puerta de 680'));

    await user.click(screen.getByTestId('grip-style-editor-save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'createGripStyle')).toBe(true));
    const write = calls.find((c) => c.method === 'createGripStyle')!.args[0] as {
      name: string; byFurnitureType: Record<string, { mode: string; topProfileId?: string; betweenProfileId?: string; overhangMm?: number }>;
    };
    expect(write.name).toBe('Gola negra');
    expect(write.byFurnitureType.inferior).toMatchObject({ mode: 'gola', topProfileId: 'p-l', betweenProfileId: 'p-c' });
    expect(write.byFurnitureType.superior).toMatchObject({ mode: 'bottom_overhang', overhangMm: 20 });
  });

  it('surfaces the 412 conflict as a banner with Recargar, never a silent overwrite', async () => {
    const user = userEvent.setup();
    const { stub, api } = apiStub([styleFixture()]);
    stub.updateGripStyle.mockRejectedValueOnce(new Error('request failed with status 412'));
    render(<GripStylesSection api={api} token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId(`grip-style-edit-style-1`)).toBeDefined());
    await user.click(screen.getByTestId(`grip-style-edit-style-1`));
    await user.click(screen.getByTestId('grip-style-editor-save'));
    await waitFor(() => expect(screen.getByTestId('grip-style-conflict')).toBeDefined());
    expect(screen.getByText(/Alguien más cambió este estilo/)).toBeDefined();
    expect(screen.getByTestId('grip-style-conflict-reload')).toBeDefined();
  });

  it('round-trips an edit with If-Match (update carries the style version)', async () => {
    const user = userEvent.setup();
    const calls: { method: string; args: unknown[] }[] = [];
    const { api } = apiStub([styleFixture()], calls);
    render(<GripStylesSection api={api} token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId(`grip-style-edit-style-1`)).toBeDefined());
    await user.click(screen.getByTestId(`grip-style-edit-style-1`));
    await user.click(screen.getByTestId('grip-style-editor-save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'updateGripStyle')).toBe(true));
    const update = calls.find((c) => c.method === 'updateGripStyle')!;
    expect(update.args[1]).toBe('style-1');
    expect(update.args[2]).toBe(3); // If-Match version
  });

  it('requires a name and shows the API validation message', async () => {
    const user = userEvent.setup();
    const { stub, api } = apiStub([styleFixture()]);
    stub.createGripStyle.mockRejectedValueOnce(new Error('el nombre del estilo es obligatorio'));
    render(<GripStylesSection api={api} token={TOKEN} />);
    await waitFor(() => expect(screen.getByTestId('grip-styles-create')).toBeDefined());
    await user.click(screen.getByTestId('grip-styles-create'));
    await user.click(screen.getByTestId('grip-style-editor-save'));
    expect(screen.getByTestId('grip-style-save-error')).toBeDefined();
  });
});
