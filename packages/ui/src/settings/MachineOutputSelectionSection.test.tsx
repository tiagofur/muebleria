/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MachineOutputSelectionRecord,
  ResolvedManufacturingOutputTarget,
} from '@granete/domain';
import {
  MachineOutputSelectionSection,
  type MachineOutputCatalogView,
} from './MachineOutputSelectionSection';

afterEach(() => cleanup());

const PROFILE_DIGEST = '4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537';

const catalog: MachineOutputCatalogView = {
  formatFamilyOperations: { ptx: ['cutting'] },
  machines: [{
    machineProfileId: 'client-a-machine-b-hpp250',
    machineProfileRevisionId: 'r1',
    manufacturerFamily: 'HOLZMA (HOMAG)',
    model: 'HPP 250',
    role: 'panel-dividing-saw',
    operations: ['cutting'],
    supportStatus: 'NOT_TESTED',
    provenance: 'OWNER_CONFIRMED',
  }],
  outputProfiles: [{
    outputCompatibilityProfileId: 'ptx-cadmatic-4',
    revisionId: 'r3',
    formatFamily: 'ptx',
    supportStatus: 'NOT_TESTED',
    digest: PROFILE_DIGEST,
  }],
  adapters: [{
    postprocessorAdapterId: 'granete-ptx',
    adapterVersion: '1.2.0',
    implementationDigest: '954fd63d08425a241309826d936597a4f20f857ae18b94741643480d679f7236',
    producedFormatFamily: 'ptx',
    serializerImplemented: true,
  }],
};

function historicalRecord(): MachineOutputSelectionRecord {
  return {
    selection: {
      operation: 'cutting',
      machineProfileId: 'client-a-machine-b-hpp250',
      machineProfileRevisionId: 'r1',
      outputCompatibilityProfileId: 'ptx-cadmatic-4',
      outputCompatibilityProfileRevisionId: 'r2',
      outputCompatibilityProfileDigest: null,
      postprocessorAdapterId: 'granete-ptx',
      postprocessorAdapterVersion: '1.1.0',
      postprocessorImplementationDigest: 'historical-adapter-digest',
    },
    version: 4,
    updatedAt: '2026-09-01T00:00:00Z',
    updatedBy: 'admin@example.com',
  };
}

describe('MachineOutputSelectionSection historical pins', () => {
  it('muestra r2 como desactualizada y exige reselección explícita de r3', async () => {
    const user = userEvent.setup();
    const record = historicalRecord();
    const resolved: ResolvedManufacturingOutputTarget = {
      status: 'CONFIGURED',
      operation: 'cutting',
      selection: record.selection,
      machineLabel: 'HOLZMA (HOMAG) HPP 250',
      profileLabel: 'ptx-cadmatic-4@r2',
      adapterLabel: 'granete-ptx · 1.1.0',
      supportStatus: 'NOT_TESTED',
      readiness: {
        ready: false,
        reasons: [{
          code: 'PROFILE_DIGEST_MISMATCH',
          detail: 'perfil histórico sin pin exacto',
        }],
      },
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <MachineOutputSelectionSection
        catalog={catalog}
        selections={{ cutting: record }}
        resolved={{ cutting: resolved }}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Desactualizada')).toBeTruthy();
    expect(screen.getByText('r3')).toBeTruthy();
    expect(screen.getByText(/Seleccioná explícitamente la versión vigente/)).toBeTruthy();
    expect(screen.getByText(/histórico sin pin/)).toBeTruthy();

    await user.selectOptions(
      screen.getByTestId('machine-output-cutting-profile'),
      `ptx-cadmatic-4@r3#${PROFILE_DIGEST}`,
    );
    await user.click(screen.getByTestId('machine-output-cutting-save'));
    expect(onSave).toHaveBeenCalledWith(
      'cutting',
      expect.objectContaining({
        outputCompatibilityProfileRevisionId: 'r3',
        outputCompatibilityProfileDigest: PROFILE_DIGEST,
      }),
      4,
    );
  });
});
