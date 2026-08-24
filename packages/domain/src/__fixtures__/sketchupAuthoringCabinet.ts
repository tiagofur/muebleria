/**
 * Versioned fixture for the authoring envelope golden round-trip: a base
 * cabinet whose two shelves share componentDefinitionId but keep independent
 * componentInstanceId/relationships, plus a manual hinge placement — the
 * canonical case from docs/sketchup-manufacturing-contract.md §13.
 */

import type { AuthoringEnvelopeV1 } from '../sketchupAuthoringSchema';
import type { AuthoringCatalogIndex } from '../sketchupAuthoringValidation';

export const CABINET_FIXTURE_SCHEMA_ID = 'granete.sketchup-authoring.v1';

export const cabinetCatalog: AuthoringCatalogIndex = {
  items: { 'module-base-600': '12' },
  hardware: { 'hinge-softclose-110': true },
  joinerySystems: { 'minifix-dowel': true, 'dowel-only': true },
};

export const cabinetEnvelope: AuthoringEnvelopeV1 = {
  schemaId: CABINET_FIXTURE_SCHEMA_ID,
  schemaName: 'granete.sketchup-authoring',
  schemaVersion: '1.0',
  messageId: 'msg-01J6A2',
  idempotencyKey: 'project-42:source-rev-8',
  sentAt: '2026-08-24T05:00:00Z',
  projectId: 'project-42',
  baseSourceRevisionId: 'source-rev-7',
  sourceRevisionId: 'source-rev-8',
  source: {
    client: 'granete-for-sketchup',
    clientVersion: '0.1.0',
    host: 'sketchup',
    hostVersion: '2026.2',
  },
  units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
  coordinateSystem: {
    handedness: 'right',
    upAxis: 'z',
    projectFrameId: 'frame-project-42',
  },
  mutationMode: 'full-snapshot-with-tombstones',
  assemblies: [
    {
      assemblyId: 'assembly-base-01',
      catalogItemId: 'module-base-600',
      catalogRevision: '12',
      displayName: 'Base cabinet 600',
      transform: {
        frame: 'project',
        translationMm: [1200, 0, 0],
        rotationQuaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      parameters: { widthMm: 600, heightMm: 720, depthMm: 590 },
      components: [
        {
          componentDefinitionId: 'definition-side-panel',
          componentInstanceId: 'side-left-01',
          role: 'left-side',
          transform: {
            frame: 'assembly',
            translationMm: [0, 0, 0],
            rotationQuaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
        {
          componentDefinitionId: 'definition-side-panel',
          componentInstanceId: 'side-right-01',
          role: 'right-side',
          transform: {
            frame: 'assembly',
            translationMm: [582, 0, 0],
            rotationQuaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
        {
          componentDefinitionId: 'definition-shelf',
          componentInstanceId: 'shelf-01',
          role: 'shelf',
          transform: {
            frame: 'assembly',
            translationMm: [18, 0, 350],
            rotationQuaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
        {
          componentDefinitionId: 'definition-shelf',
          componentInstanceId: 'shelf-02',
          role: 'shelf',
          transform: {
            frame: 'assembly',
            translationMm: [18, 0, 520],
            rotationQuaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
      ],
      relationships: [
        {
          relationshipId: 'rel-shelf-01',
          kind: 'shelf-support',
          source: { componentInstanceId: 'shelf-01', role: 'shelf-edge' },
          targets: [
            { componentInstanceId: 'side-left-01', role: 'inside-face' },
            { componentInstanceId: 'side-right-01', role: 'inside-face' },
          ],
          joinerySystemId: 'minifix-dowel',
        },
        {
          relationshipId: 'rel-shelf-02',
          kind: 'shelf-support',
          source: { componentInstanceId: 'shelf-02', role: 'shelf-edge' },
          targets: [
            { componentInstanceId: 'side-left-01', role: 'inside-face' },
            { componentInstanceId: 'side-right-01', role: 'inside-face' },
          ],
          joinerySystemId: 'minifix-dowel',
        },
      ],
      hardwarePlacements: [
        {
          hardwarePlacementId: 'hp-hinge-door-01',
          catalogHardwareId: 'hinge-softclose-110',
          hostComponentInstanceId: 'side-left-01',
          anchorFace: 'inside-face',
          offsetMm: [40, 96],
          rotationDeg: 0,
          handedness: 'left',
        },
      ],
    },
  ],
  tombstones: [],
};

export function cloneCabinetEnvelope(): AuthoringEnvelopeV1 {
  return JSON.parse(JSON.stringify(cabinetEnvelope)) as AuthoringEnvelopeV1;
}

export type WritableEnvelope<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? WritableEnvelope<U>[] : WritableEnvelope<T[K]>;
};

/** Deep-writable clone for tests that mutate intent fields before applying. */
export function mutateCabinetEnvelope(
  mutate: (envelope: WritableEnvelope<AuthoringEnvelopeV1>) => void,
): AuthoringEnvelopeV1 {
  const envelope = JSON.parse(JSON.stringify(cabinetEnvelope)) as WritableEnvelope<AuthoringEnvelopeV1>;
  mutate(envelope);
  return envelope as unknown as AuthoringEnvelopeV1;
}
