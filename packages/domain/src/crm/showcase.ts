/**
/**
 * Commercial Showcase / Project Portfolio domain helpers (CRM Phase 4).
 * Enriched photos of finished/installed projects for sales presentation & inspiration.
 */

import type { ProjectPhotoStage } from '../types';


export type ShowcasePhotoItem = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly stage: ProjectPhotoStage;
  readonly url: string;
  readonly thumbnailUrl?: string;
  readonly caption?: string;
  readonly isShowcase: boolean;
  readonly createdAt: string;
  readonly tags?: readonly string[];
};

export type ShowcaseFilter = {
  readonly query?: string;
  readonly stage?: ProjectPhotoStage | 'all';
  readonly onlyShowcase?: boolean;
};

export type ProjectShowcaseGroup = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly photos: readonly ShowcasePhotoItem[];
  readonly coverPhoto: ShowcasePhotoItem;
};

/**
 * Filter showcase photos by text search (project name, customer, caption),
 * stage, and showcase flag.
 */
export function filterShowcasePhotos(
  photos: readonly ShowcasePhotoItem[],
  filter: ShowcaseFilter,
): readonly ShowcasePhotoItem[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const stage = filter.stage && filter.stage !== 'all' ? filter.stage : null;
  const onlyShowcase = filter.onlyShowcase ?? false;

  return photos.filter((p) => {
    if (onlyShowcase && !p.isShowcase) {
      return false;
    }
    if (stage && p.stage !== stage) {
      return false;
    }
    if (query) {
      const matchProject = p.projectName.toLowerCase().includes(query);
      const matchCustomer = p.customerName?.toLowerCase().includes(query) ?? false;
      const matchCaption = p.caption?.toLowerCase().includes(query) ?? false;
      if (!matchProject && !matchCustomer && !matchCaption) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Groups photos by project with a designated cover photo (first showcase photo or first installed photo).
 */
export function groupShowcasePhotosByProject(
  photos: readonly ShowcasePhotoItem[],
): readonly ProjectShowcaseGroup[] {
  const map = new Map<string, { projectName: string; customerName?: string; photos: ShowcasePhotoItem[] }>();

  for (const photo of photos) {
    const existing = map.get(photo.projectId);
    if (existing) {
      existing.photos.push(photo);
    } else {
      map.set(photo.projectId, {
        projectName: photo.projectName,
        customerName: photo.customerName,
        photos: [photo],
      });
    }
  }

  const groups: ProjectShowcaseGroup[] = [];
  for (const [projectId, entry] of map.entries()) {
    const cover =
      entry.photos.find((p) => p.isShowcase) ??
      entry.photos.find((p) => p.stage === 'installed') ??
      entry.photos[0]!;

    groups.push({
      projectId,
      projectName: entry.projectName,
      customerName: entry.customerName,
      photos: entry.photos,
      coverPhoto: cover,
    });
  }

  return groups.sort((a, b) => a.projectName.localeCompare(b.projectName));
}
