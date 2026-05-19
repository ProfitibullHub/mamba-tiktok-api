import { test, expect } from '@playwright/test';

test.describe('App smoke', () => {
    test('document has expected title', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/Mamba.*TikTok Shop Analytics/);
    });

    test('root mounts without a blank document', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#root')).toBeAttached();
        const html = await page.locator('#root').innerHTML();
        expect(html.length).toBeGreaterThan(0);
    });
});
