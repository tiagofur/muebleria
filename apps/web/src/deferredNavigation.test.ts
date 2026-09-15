import { describe, expect, it } from 'vitest';
import {
  captureDeferredNavigationIntent,
  deferredNavigationStillCurrent,
} from './deferredNavigation';

const intent = captureDeferredNavigationIntent({
  scopeKey: '["web","gen-1","org-a"]',
  path: '/quotes/p-1/reconciliacion?qrev=q1',
});

describe('deferredNavigation (#738 review)', () => {
  it('proceeds when scope, path and session are unchanged', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-1","org-a"]',
        path: '/quotes/p-1/reconciliacion?qrev=q1',
        sessionActive: true,
      }),
    ).toBe(true);
  });

  it('blocks a late navigation after the user moved to another route/project', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-1","org-a"]',
        path: '/quotes/p-2',
        sessionActive: true,
      }),
    ).toBe(false);
  });

  it('blocks after an organization/session switch', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-2","org-b"]',
        path: '/quotes/p-1/reconciliacion?qrev=q1',
        sessionActive: true,
      }),
    ).toBe(false);
  });

  it('blocks when the session ended', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-1","org-a"]',
        path: '/quotes/p-1/reconciliacion?qrev=q1',
        sessionActive: false,
      }),
    ).toBe(false);
  });
});
