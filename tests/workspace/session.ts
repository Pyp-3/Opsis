import type { Page } from '@playwright/test';

/**
 * Signs a fresh account up through the API. `page.request` shares the browser context's
 * cookies, so the page is signed in from its next navigation.
 */
export async function signUp(page: Page, name = 'Test reader') {
  const email = `reader-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await page.request.post('/v1/auth/signup', {
    data: { name, email, password: 'correct horse' },
  });
  if (response.status() !== 201) throw new Error(`Sign-up failed: ${await response.text()}`);
  return { name, email, password: 'correct horse' };
}
