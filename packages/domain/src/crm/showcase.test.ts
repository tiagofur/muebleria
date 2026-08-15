import { describe, expect, it } from 'vitest';
import {
  filterShowcasePhotos,
  groupShowcasePhotosByProject,
  type ShowcasePhotoItem,
} from './showcase';

const SAMPLE_PHOTOS: ShowcasePhotoItem[] = [
  {
    id: 'photo-1',
    projectId: 'proj-1',
    projectName: 'Cocina Roble Ana',
    customerName: 'Ana Gomez',
    stage: 'installed',
    url: '/api/media/installed-1.webp',
    caption: 'Isla central terminada con mesada de granito',
    isShowcase: true,
    createdAt: '2026-08-10T12:00:00Z',
  },
  {
    id: 'photo-2',
    projectId: 'proj-1',
    projectName: 'Cocina Roble Ana',
    customerName: 'Ana Gomez',
    stage: 'survey',
    url: '/api/media/survey-1.webp',
    caption: 'Relevamiento inicial de obra',
    isShowcase: false,
    createdAt: '2026-08-01T12:00:00Z',
  },
  {
    id: 'photo-3',
    projectId: 'proj-2',
    projectName: 'Placard Vestidor Juan',
    customerName: 'Juan Perez',
    stage: 'installed',
    url: '/api/media/installed-2.webp',
    caption: 'Puertas corredizas con espejo',
    isShowcase: false,
    createdAt: '2026-08-12T12:00:00Z',
  },
];

describe('filterShowcasePhotos', () => {
  it('filters by onlyShowcase flag', () => {
    const res = filterShowcasePhotos(SAMPLE_PHOTOS, { onlyShowcase: true });
    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe('photo-1');
  });

  it('filters by stage', () => {
    const res = filterShowcasePhotos(SAMPLE_PHOTOS, { stage: 'survey' });
    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe('photo-2');
  });

  it('filters by query across project, customer, and caption', () => {
    const byProject = filterShowcasePhotos(SAMPLE_PHOTOS, { query: 'cocina' });
    expect(byProject).toHaveLength(2);

    const byCustomer = filterShowcasePhotos(SAMPLE_PHOTOS, { query: 'perez' });
    expect(byCustomer).toHaveLength(1);
    expect(byCustomer[0]!.id).toBe('photo-3');

    const byCaption = filterShowcasePhotos(SAMPLE_PHOTOS, { query: 'granito' });
    expect(byCaption).toHaveLength(1);
    expect(byCaption[0]!.id).toBe('photo-1');
  });
});

describe('groupShowcasePhotosByProject', () => {
  it('groups photos by project and designates showcase cover', () => {
    const groups = groupShowcasePhotosByProject(SAMPLE_PHOTOS);
    expect(groups).toHaveLength(2);

    const proj1 = groups.find((g) => g.projectId === 'proj-1')!;
    expect(proj1.projectName).toBe('Cocina Roble Ana');
    expect(proj1.photos).toHaveLength(2);
    expect(proj1.coverPhoto.id).toBe('photo-1'); // isShowcase = true

    const proj2 = groups.find((g) => g.projectId === 'proj-2')!;
    expect(proj2.coverPhoto.id).toBe('photo-3'); // installed
  });
});
