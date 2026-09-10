import { describe, expect, it } from 'vitest';
import type { DesignRevision, DesignRevisionArtifact } from '@granete/storage';
import {
  buildDesignLineage,
  formatArtifactSize,
  artifactHealth,
  canonicalArtifactSHA256,
  formatSha256Digest,
  getArtifactAvailability,
  selectDesignRevision,
} from './designHistory';

function makeRevision(partial: Partial<DesignRevision> & { id: string; revision_number: number }): DesignRevision {
  return {
    id: partial.id,
    design_id: partial.design_id ?? 'design-1',
    revision_number: partial.revision_number,
    parent_revision_id: partial.parent_revision_id ?? null,
    source_type: partial.source_type ?? 'sketchup',
    status: partial.status ?? 'published',
    created_by: partial.created_by ?? 'user-1',
    created_at: partial.created_at ?? '2026-09-01T10:00:00Z',
    items: partial.items ?? [],
    artifacts: partial.artifacts,
    approved_by: partial.approved_by,
    approved_at: partial.approved_at,
  };
}

describe('designHistory pure model', () => {
  describe('buildDesignLineage', () => {
    it('returns empty array when revisions is empty', () => {
      expect(buildDesignLineage([])).toEqual([]);
    });

    it('orders revisions strictly ascending by revision_number even if input is disordered', () => {
      const r3 = makeRevision({ id: 'rev-3', revision_number: 3, parent_revision_id: 'rev-2' });
      const r1 = makeRevision({ id: 'rev-1', revision_number: 1, parent_revision_id: null });
      const r2 = makeRevision({ id: 'rev-2', revision_number: 2, parent_revision_id: 'rev-1' });

      const lineage = buildDesignLineage([r3, r1, r2]);
      expect(lineage.map((n) => n.revisionNumber)).toEqual([1, 2, 3]);
      expect(lineage.map((n) => n.revision.id)).toEqual(['rev-1', 'rev-2', 'rev-3']);

      expect(lineage[0]?.isRoot).toBe(true);
      expect(lineage[0]?.hasValidParent).toBe(true);
      expect(lineage[0]?.isLatest).toBe(false);

      expect(lineage[1]?.isRoot).toBe(false);
      expect(lineage[1]?.parentRevisionId).toBe('rev-1');
      expect(lineage[1]?.hasValidParent).toBe(true);
      expect(lineage[1]?.isLatest).toBe(false);

      expect(lineage[2]?.isRoot).toBe(false);
      expect(lineage[2]?.parentRevisionId).toBe('rev-2');
      expect(lineage[2]?.hasValidParent).toBe(true);
      expect(lineage[2]?.isLatest).toBe(true);
    });

    it('flags orphan parent when parent revision is not in the set', () => {
      const r2 = makeRevision({ id: 'rev-2', revision_number: 2, parent_revision_id: 'rev-unknown' });
      const lineage = buildDesignLineage([r2]);
      expect(lineage[0]?.hasValidParent).toBe(false);
      expect(lineage[0]?.isRoot).toBe(false);
    });

    it('identifies approved status accurately', () => {
      const published = makeRevision({ id: 'rev-1', revision_number: 1, status: 'published' });
      const approved = makeRevision({
        id: 'rev-2',
        revision_number: 2,
        status: 'approved',
        approved_at: '2026-09-02T12:00:00Z',
      });
      const lineage = buildDesignLineage([published, approved]);
      expect(lineage[0]?.isApproved).toBe(false);
      expect(lineage[1]?.isApproved).toBe(true);
    });
  });

  describe('selectDesignRevision', () => {
    it('returns null when revisions list is empty', () => {
      expect(selectDesignRevision([])).toBeNull();
      expect(selectDesignRevision([], 'rev-1')).toBeNull();
    });

    it('selects latest revision when revisionId is omitted or empty', () => {
      const r1 = makeRevision({ id: 'rev-1', revision_number: 1 });
      const r2 = makeRevision({ id: 'rev-2', revision_number: 2 });
      const r3 = makeRevision({ id: 'rev-3', revision_number: 3 });

      expect(selectDesignRevision([r1, r2, r3])).toEqual(r3);
      expect(selectDesignRevision([r1, r2, r3], '')).toEqual(r3);
      expect(selectDesignRevision([r1, r2, r3], null)).toEqual(r3);
    });

    it('returns the exact revision when revisionId matches an older revision', () => {
      const r1 = makeRevision({ id: 'rev-1', revision_number: 1 });
      const r2 = makeRevision({ id: 'rev-2', revision_number: 2 });
      const r3 = makeRevision({ id: 'rev-3', revision_number: 3 });

      const selected = selectDesignRevision([r1, r2, r3], 'rev-1');
      expect(selected).toEqual(r1);
      expect(selected?.revision_number).toBe(1);
    });

    it('fails closed (returns null) when specified revisionId does not exist', () => {
      const r1 = makeRevision({ id: 'rev-1', revision_number: 1 });
      const r2 = makeRevision({ id: 'rev-2', revision_number: 2 });

      // Critical negative proof: an unknown revisionId MUST NOT fall back to latest!
      expect(selectDesignRevision([r1, r2], 'rev-nonexistent')).toBeNull();
    });
  });

  describe('getArtifactAvailability', () => {
    it('handles empty or missing artifacts', () => {
      expect(getArtifactAvailability(null)).toEqual({
        model: null,
        manifest: null,
        preview: null,
        totalArtifacts: 0,
      });
      expect(getArtifactAvailability([])).toEqual({
        model: null,
        manifest: null,
        preview: null,
        totalArtifacts: 0,
      });
    });

    it('categorizes model, manifest, and preview artifacts correctly', () => {
      const model: DesignRevisionArtifact = {
        id: 'art-1',
        design_revision_id: 'rev-1',
        kind: 'model',
        content_type: 'application/octet-stream',
        size_bytes: 15400000,
        sha256: 'abc1234567890',
        created_at: '2026-09-01T10:00:00Z',
        health: { status: 'available', checked_at: '2026-09-01T10:00:05Z' },
      };
      const manifest: DesignRevisionArtifact = {
        id: 'art-2',
        design_revision_id: 'rev-1',
        kind: 'manifest',
        content_type: 'application/json',
        size_bytes: 42000,
        sha256: 'def4567890123',
        created_at: '2026-09-01T10:00:00Z',
        health: { status: 'available', checked_at: '2026-09-01T10:00:05Z' },
      };
      const preview: DesignRevisionArtifact = {
        id: 'art-3',
        design_revision_id: 'rev-1',
        kind: 'preview',
        content_type: 'image/png',
        size_bytes: 250000,
        sha256: 'ghi7890123456',
        created_at: '2026-09-01T10:00:00Z',
        health: { status: 'available', checked_at: '2026-09-01T10:00:05Z' },
      };

      const result = getArtifactAvailability([model, manifest, preview]);
      expect(result.model).toEqual(model);
      expect(result.manifest).toEqual(manifest);
      expect(result.preview).toEqual(preview);
      expect(result.totalArtifacts).toBe(3);
    });
  });

  describe('formatArtifactSize', () => {
    it('formats bytes, kilobytes and megabytes', () => {
      expect(formatArtifactSize(0)).toBe('0 B');
      expect(formatArtifactSize(512)).toBe('512 B');
      expect(formatArtifactSize(1024)).toBe('1.0 KB');
      expect(formatArtifactSize(1024 * 50)).toBe('50 KB');
      expect(formatArtifactSize(1024 * 1024 * 3.5)).toBe('3.5 MB');
    });

    it('handles negative or invalid numbers safely', () => {
      expect(formatArtifactSize(-1)).toBe('0 B');
      expect(formatArtifactSize(NaN)).toBe('0 B');
    });
  });

  describe('formatSha256Digest (#640 canonical contract)', () => {
    const canonical =
      'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    it('renders the canonical digest with exactly one prefix', () => {
      expect(formatSha256Digest(canonical)).toBe('sha256-e3b0c442…');
    });

    it('never duplicates the prefix or reinterprets non-canonical values', () => {
      // Legacy colon forms and bare hex are NOT reinterpreted as digests.
      expect(formatSha256Digest('sha256:' + canonical.slice('sha256-'.length))).toBe('sha256-—');
      expect(formatSha256Digest(canonical.slice('sha256-'.length))).toBe('sha256-—');
      expect(formatSha256Digest('sha256-sha256-' + 'ab'.repeat(32))).toBe('sha256-—');
      expect(formatSha256Digest('')).toBe('sha256-—');
      expect(formatSha256Digest('abcd')).toBe('sha256-—');
      // A duplicated prefix can never appear in the output.
      expect(formatSha256Digest(canonical)).not.toContain('sha256-sha256');
      expect(formatSha256Digest(canonical)).not.toContain('sha256:');
    });
  });

  describe('canonicalArtifactSHA256 (#640)', () => {
    it('accepts exactly the sha256-<64 lowercase hex> contract', () => {
      const good = 'sha256-' + 'ab'.repeat(32);
      expect(canonicalArtifactSHA256(good)).toBe(good);
      expect(canonicalArtifactSHA256('sha256-' + 'AB'.repeat(32))).toBe(null);
      expect(canonicalArtifactSHA256('sha256:' + 'ab'.repeat(32))).toBe(null);
      expect(canonicalArtifactSHA256('')).toBe(null);
      expect(canonicalArtifactSHA256(null)).toBe(null);
    });

    it('trims surrounding whitespace before validating', () => {
      const good = 'sha256-' + 'cd'.repeat(32);
      expect(canonicalArtifactSHA256(` ${good} `)).toBe(good);
    });
  });

  describe('artifactHealth (#640)', () => {
    const base = {
      id: 'art-h1',
      design_revision_id: 'rev-1',
      kind: 'model' as const,
      content_type: 'application/octet-stream',
      size_bytes: 10,
      sha256: 'sha256-' + 'ab'.repeat(32),
      created_at: '2026-09-01T10:00:00Z',
    };

    it('returns the authoritative status when present', () => {
      expect(
        artifactHealth({ ...base, health: { status: 'available', checked_at: '2026-09-01T10:00:05Z' } }),
      ).toBe('available');
      expect(
        artifactHealth({ ...base, health: { status: 'missing', checked_at: '2026-09-01T10:00:05Z' } }),
      ).toBe('missing');
      expect(
        artifactHealth({ ...base, health: { status: 'integrity_mismatch', checked_at: '2026-09-01T10:00:05Z' } }),
      ).toBe('integrity_mismatch');
    });

    it('returns null for absent or unknown health instead of assuming available', () => {
      expect(artifactHealth(base as never)).toBe(null);
      expect(
        artifactHealth({ ...base, health: { status: 'processing', checked_at: 'x' } as never }),
      ).toBe(null);
    });
  });
});
