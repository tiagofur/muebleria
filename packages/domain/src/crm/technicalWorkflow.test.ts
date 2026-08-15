import { describe, expect, it } from 'vitest';
import {
  TECHNICAL_STATUS_METADATA,
  INTERNAL_MESSAGE_TYPE_METADATA,
  getAvailableTechnicalTransitions,
} from './technicalWorkflow';

describe('technicalWorkflow', () => {
  it('defines metadata for all 8 technical statuses', () => {
    expect(Object.keys(TECHNICAL_STATUS_METADATA)).toHaveLength(8);
    expect(TECHNICAL_STATUS_METADATA.pending_assignment.label).toContain('Pendiente');
    expect(TECHNICAL_STATUS_METADATA.approved_for_production.stepNumber).toBe(3);
  });

  it('defines metadata for all 6 internal message types', () => {
    expect(Object.keys(INTERNAL_MESSAGE_TYPE_METADATA)).toHaveLength(6);
    expect(INTERNAL_MESSAGE_TYPE_METADATA.technical_query.badgeColor).toBe('warning');
    expect(INTERNAL_MESSAGE_TYPE_METADATA.gate_approval.badgeColor).toBe('success');
  });

  it('returns valid transitions from in_review', () => {
    const transitions = getAvailableTechnicalTransitions('in_review');
    expect(transitions).toContain('approved_for_production');
    expect(transitions).toContain('changes_requested');
  });

  it('returns valid transitions from approved_for_production', () => {
    const transitions = getAvailableTechnicalTransitions('approved_for_production');
    expect(transitions).toContain('in_workshop');
  });
});
