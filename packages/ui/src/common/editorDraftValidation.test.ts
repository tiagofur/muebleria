/** @vitest-environment jsdom */
import { expect, it } from 'vitest';
import { createEmptyAgregadoDraft, isAgregadoDraft } from '../agregados/agregadoDraft'; import { emptyComponentDraft, isComponentDraft } from '../components/componentDraft';
import { emptyModuleDraft, isModuleDraft } from '../modules/helpers/moduleDraftTransforms'; import { emptyStructureDraft, isStructureDraft, structureToDraft } from '../structures/structureDraft';
import { hasDirtyDraftSessions, readDraftSession, registerDraftSessionBaseline } from './useDraftSession';
it('validates production drafts and rejects nested or enum corruption', () => {
  expect([isModuleDraft(emptyModuleDraft()), isStructureDraft(emptyStructureDraft()), isComponentDraft(emptyComponentDraft()), isAgregadoDraft(createEmptyAgregadoDraft())]).toEqual([true, true, true, true]);
  expect([isModuleDraft({ ...emptyModuleDraft(), furnitureType: 'invalid' }),
    isStructureDraft({ ...emptyStructureDraft(), components: [{ componentId: 'x', quantity: 'invalid' }] }),
    isComponentDraft({ ...emptyComponentDraft(), placement: 'invalid' }),
    isAgregadoDraft({ ...createEmptyAgregadoDraft(), hardwareLines: [{ id: 'x', optionRole: '', quantity: 'invalid' }] })]).toEqual([false, false, false, false]);
});
it('restores and detects dirty structure component without placement override', () => {
  const baseline = structureToDraft({ id: 's1', code: 'S1', name: 'Structure', components: [{ componentId: 'c1', quantity: 1 }] }); sessionStorage.setItem('structure-no-override', JSON.stringify({ ...baseline, name: 'Edited' }));
  expect(readDraftSession('structure-no-override', baseline, isStructureDraft)?.components[0]?.placementOverride).toBeUndefined();
  registerDraftSessionBaseline('structure-no-override', baseline, isStructureDraft); expect(hasDirtyDraftSessions()).toBe(true);
});
