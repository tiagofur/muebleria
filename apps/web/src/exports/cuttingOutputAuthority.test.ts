import { describe, expect, it, vi } from 'vitest';

import type { MachineOutputSelection } from '@granete/domain';

import {
  forCurrentMachineOutputScope,
  isCurrentMachineOutputRequest,
  runWithCuttingOutputAuthority,
  type CuttingOutputSelectionState,
} from './cuttingOutputAuthority';

const selection: MachineOutputSelection = {
  operation: 'cutting',
  machineProfileId: 'client-a-machine-b-hpp250',
  machineProfileRevisionId: 'r1',
  outputCompatibilityProfileId: 'ptx-cadmatic-4',
  outputCompatibilityProfileRevisionId: 'r3',
  outputCompatibilityProfileDigest: '4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537',
  postprocessorAdapterId: 'granete-ptx',
  postprocessorAdapterVersion: '1.2.0',
  postprocessorImplementationDigest:
    '954fd63d08425a241309826d936597a4f20f857ae18b94741643480d679f7236',
};

function state(
  value: Record<string, unknown>,
): CuttingOutputSelectionState {
  return { ...value, scopeKey: 'org-a' } as CuttingOutputSelectionState;
}

describe('cutting output authority (#691)', () => {
  it.each([
    state({ status: 'loading' }),
    state({ status: 'error', error: 'No se pudo cargar la configuración.' }),
    state({ status: 'blocked', selection, reason: 'La selección está desactualizada.' }),
  ])('$status blocks without invoking selected or legacy generation', async (current) => {
    const selected = vi.fn(async () => 'selected');
    const legacy = vi.fn(async () => 'legacy');

    await expect(
      runWithCuttingOutputAuthority(current, { selected, legacy }),
    ).rejects.toThrow();

    expect(selected).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('confirmed empty is the only state that permits legacy generation', async () => {
    const selected = vi.fn(async () => 'selected');
    const legacy = vi.fn(async () => 'legacy');

    await expect(
      runWithCuttingOutputAuthority(state({ status: 'empty' }), {
        selected,
        legacy,
      }),
    ).resolves.toBe('legacy');

    expect(legacy).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
  });

  it('configured uses only the exact selected tuple', async () => {
    const selected = vi.fn(async () => 'selected');
    const legacy = vi.fn(async () => 'legacy');

    await expect(
      runWithCuttingOutputAuthority(
        state({ status: 'configured', selection }),
        { selected, legacy },
      ),
    ).resolves.toBe('selected');

    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenCalledWith(selection);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('treats a state from another organization as loading immediately', async () => {
    const stale = state({ status: 'empty' });
    const current = forCurrentMachineOutputScope(stale, 'org-b');
    const selected = vi.fn(async () => 'selected');
    const legacy = vi.fn(async () => 'legacy');

    expect(current).toEqual({ status: 'loading', scopeKey: 'org-b' });
    await expect(
      runWithCuttingOutputAuthority(current, { selected, legacy }),
    ).rejects.toThrow(/cargando/i);
    expect(selected).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('rejects a late response from the organization that started the request', () => {
    expect(isCurrentMachineOutputRequest('org-a', 'org-b')).toBe(false);
    expect(isCurrentMachineOutputRequest('org-a', null)).toBe(false);
    expect(isCurrentMachineOutputRequest('org-a', 'org-a')).toBe(true);
  });
});
