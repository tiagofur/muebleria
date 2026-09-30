import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseGenerated } from './openapi/generated/types';
import type {
  AuthoringResolveResponse,
  WorkshopFurnitureCatalogEnvelope,
} from './openapi/generated/types';

// #496 (PR #937) modeled the furniture catalog envelope and the authoring
// resolve into the generated contract WITHOUT runtime tests of its own.
// These tests close that gap with the REAL wires the #497 chain pinned as
// goldens (server-produced fixtures): the schemas PR #937 added must accept
// them — now and after any spec regeneration. A divergence here means the
// generated client would reject a production response on first real use.
describe('furniture contract schemas vs #497 real-wire goldens', () => {
  const preview = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../contracts/furnitureAuthoringPreview.fixture.json', import.meta.url)),
      'utf8',
    ),
  ) as { readonly catalogRevision: string; readonly resolved: unknown };
  const cross = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../contracts/furnitureAuthoringCrossSurface.fixture.json', import.meta.url)),
      'utf8',
    ),
  ) as {
    readonly moduleWrite: { readonly id: string; readonly code: string; readonly name: string };
    readonly expected: { readonly definitionHash: string; readonly publishedParameters: unknown };
  };

  it('WorkshopFurnitureCatalogEnvelope accepts the served catalog shape', () => {
    const envelope = {
      schemaId: 'granete.workshopFurnitureCatalog.v1',
      revisionId: 'workshop-abc123def456',
      categories: [],
      materialCategories: [],
      definitions: {
        [cross.moduleWrite.id]: {
          furnitureDefinitionId: cross.moduleWrite.id,
          code: cross.moduleWrite.code,
          name: cross.moduleWrite.name,
          category: 'Sin categoría',
          version: '1',
          schemaRevision: 1,
          definitionHash: cross.expected.definitionHash,
          parameters: cross.expected.publishedParameters,
        },
      },
      presets: [],
      materials: [],
    };
    const parsed = parseGenerated<WorkshopFurnitureCatalogEnvelope>('WorkshopFurnitureCatalogEnvelope', envelope);
    expect(parsed.definitions[cross.moduleWrite.id]?.definitionHash).toBe(cross.expected.definitionHash);
  });

  it('AuthoringResolveResponse accepts the real resolved wire', () => {
    const response = {
      schemaId: 'granete.sketchup-authoring-resolve.v1',
      schemaName: 'granete.sketchup-authoring-resolve',
      schemaVersion: '1.0',
      resolveContract: 'granete.sketchup-authoring-resolve.v1',
      responseMessageId: 'resolve-m1',
      inReplyToMessageId: 'm1',
      idempotencyKey: 'k1',
      catalogRevision: preview.catalogRevision,
      status: 'accepted',
      resolved: preview.resolved,
      issues: [],
    };
    const parsed = parseGenerated<AuthoringResolveResponse>('AuthoringResolveResponse', response);
    expect(parsed.status).toBe('accepted');
  });
});
