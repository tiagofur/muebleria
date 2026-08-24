/**
 * Registered, deterministic, lossless schema migrations for the authoring
 * envelope. v1 is the first version: the registry is intentionally empty and
 * any older/unknown version fails closed before mutation.
 */

import type { AppliedSchemaMigration, AuthoringEnvelopeV1 } from './sketchupAuthoringSchema';

type RegisteredMigration = {
  readonly migrationId: string;
  readonly fromSchemaVersion: string;
  readonly toSchemaVersion: string;
  readonly transform: (envelope: AuthoringEnvelopeV1) => AuthoringEnvelopeV1;
};

const REGISTERED_MIGRATIONS: readonly RegisteredMigration[] = [];

/**
 * Returns the migration that was applied, `undefined` when no migration was
 * needed, or `'unsupported'` when the envelope version has no registered
 * lossless path to the current schema.
 */
export function applyRegisteredMigrations(
  envelope: AuthoringEnvelopeV1,
): AppliedSchemaMigration | undefined | 'unsupported' {
  const current = '1.0';
  if (envelope.schemaVersion === current) {
    return undefined;
  }
  const reachable = REGISTERED_MIGRATIONS.some(
    (migration) => migration.fromSchemaVersion === envelope.schemaVersion,
  );
  if (!reachable) {
    return 'unsupported';
  }
  throw new Error(
    `Registered migration from ${envelope.schemaVersion} is declared but has no implementation; refusing to mutate`,
  );
}
