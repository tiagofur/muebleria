import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
} catch (e) { errors.push('GOTO FAIL: ' + e.message); }
await page.waitForTimeout(3000);
const rootKids = await page.locator('#root > *').count();
const hasSidebar = await page.locator('.app-sidebar').count();
const hasLogin = await page.locator('form, .login-card').count();
console.log('pageerrors:', errors.length ? errors.join(' | ') : '(none)');
console.log('#root children:', rootKids, '| sidebar:', hasSidebar, '| login form:', hasLogin);
await browser.close();
