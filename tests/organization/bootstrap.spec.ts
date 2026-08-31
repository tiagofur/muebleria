import { expect, test } from '@playwright/test';
import { assertAuthoritativeSession } from './support/api';

test('boots the real organization harness with an authoritative session', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('form')).toBeVisible();
  await assertAuthoritativeSession();
});
