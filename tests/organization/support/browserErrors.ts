import { expect, type Page } from '@playwright/test';

/**
 * #644 — "sin consola" for the milestone journey means the user never needs
 * DevTools, manual JavaScript, SQL or localStorage surgery to complete the
 * business steps. Technically: no uncaught page errors and no UNEXPECTED
 * console errors while the supported UI flow runs.
 *
 * Deliberate negative probes (the logged-out session check answering 401, a
 * pinned 404 a test triggers on purpose) may still log; allowlists are
 * scoped to the exact response status AND endpoint so a real regression —
 * including a new auth failure mid-journey — can never hide behind them.
 */
export type ConsoleErrorAllow = (message: string, resourceUrl: string) => boolean;

export interface BrowserErrorCollector {
  readonly errors: readonly string[];
  assertEmpty(label: string): Promise<void>;
}

/**
 * Boot probes while logged out: the anonymous session check legitimately
 * answers 401 on the auth endpoints before the user signs in. A 401 anywhere
 * else — or any other status here — still fails the journey.
 */
export function allowLoggedOutSessionProbe(message: string, resourceUrl: string): boolean {
  return (
    message.includes('401')
    && (resourceUrl.includes('/auth/me') || resourceUrl.includes('/auth/refresh'))
  );
}

/**
 * #781 — projects without a production release legitimately 404 on the
 * workshop-occurrences endpoint. The frontend degrades to the live canonical
 * order; this is not a user-visible error.
 */
export function allowWorkshopOccurrences404(message: string, resourceUrl: string): boolean {
  return message.includes('404') && resourceUrl.includes('/workshop-occurrences');
}

/** Composed allowlist: logged-out auth probes + expected workshop-occurrences 404. */
export function allowExpectedTransientErrors(message: string, resourceUrl: string): boolean {
  return allowLoggedOutSessionProbe(message, resourceUrl)
    || allowWorkshopOccurrences404(message, resourceUrl);
}

export function collectBrowserErrors(
  page: Page,
  options: { readonly allow?: ConsoleErrorAllow } = {},
): BrowserErrorCollector {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const resourceUrl = message.location()?.url ?? '';
    if (options.allow?.(text, resourceUrl)) return;
    errors.push(`console.error: ${text}${resourceUrl ? ` @ ${resourceUrl}` : ''}`);
  });
  return {
    errors,
    async assertEmpty(label: string): Promise<void> {
      // Read once at the end of the journey so late async noise is caught.
      await page.waitForTimeout(250);
      expect(errors, `${label}: the normal journey must not need a hidden console to succeed`).toEqual([]);
    },
  };
}
