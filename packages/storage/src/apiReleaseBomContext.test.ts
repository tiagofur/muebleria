import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIWorkspaceRepository } from './apiWorkspaceRepository';
import { GraneteApiClient } from './apiClient';
import type { DesignRevision, ProductionRelease } from './openapi/generated/types';

const release: ProductionRelease = {
  id: 'P1', project_id: 'project', release_number: 1, design_id: 'design',
  design_revision_id: 'R1', design_revision_number: 1,
  manufacturing_fingerprint: 'sha256-p1', status: 'active', released_by: 'actor',
  released_at: '2026-09-06T00:00:00Z',
  staleness: { manufacturing_stale: true, current_design_revision_id: 'R2', current_design_revision_number: 2 },
};
const revision: DesignRevision = {
  id: 'R1', design_id: 'design', revision_number: 1, source_type: 'manual',
  status: 'approved', created_at: '2026-09-06T00:00:00Z',
  items: [{ id: 'item', design_revision_id: 'R1', furniture_instance_id: 'fi-1',
    furniture_definition_id: 'module', parameters: { widthMm: 600 },
    material_choices: { BODY: 'material' }, descriptor_state: 'unavailable_legacy',
    created_at: '2026-09-06T00:00:00Z' }],
};

afterEach(() => vi.restoreAllMocks());

describe('exact release BOM reader', () => {
  it('reads the selected historical release and its pinned revision, never latest', async () => {
    const get = vi.spyOn(GraneteApiClient.prototype, 'getProjectProductionRelease').mockResolvedValue(release);
    const list = vi.spyOn(GraneteApiClient.prototype, 'listProjectProductionReleases');
    const design = vi.spyOn(GraneteApiClient.prototype, 'getDesignRevision').mockResolvedValue(revision);
    const result = await new APIWorkspaceRepository().getReleaseBomContext('project', 'P1');
    expect(get).toHaveBeenCalledWith('', 'project', 'P1');
    expect(list).not.toHaveBeenCalled();
    expect(design).toHaveBeenCalledWith('', 'design', 'R1');
    expect(result.items[0]?.furnitureInstanceId).toBe('fi-1');
  });

  it.each(['foreign release', 'missing definition', 'wrong revision'])('rejects %s instead of falling back', async (scenario) => {
    vi.spyOn(GraneteApiClient.prototype, 'getProjectProductionRelease').mockResolvedValue(
      scenario === 'foreign release' ? { ...release, id: 'P2' } : release,
    );
    vi.spyOn(GraneteApiClient.prototype, 'getDesignRevision').mockResolvedValue(
      scenario === 'missing definition' ? { ...revision, items: [{ ...revision.items[0]!, furniture_definition_id: null }] }
        : scenario === 'wrong revision' ? { ...revision, id: 'R2' } : revision,
    );
    await expect(new APIWorkspaceRepository().getReleaseBomContext('project', 'P1')).rejects.toThrow();
  });
});
