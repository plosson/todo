import { test, expect } from '@playwright/test';

test('add, check, filter by tag', async ({ page }) => {
  await page.goto('/');

  // Dev sign-in
  await expect(page.getByRole('button', { name: 'Continue as dev' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue as dev' }).click();
  // The add sheet stays hidden until the + button is pressed.
  await expect(page.getByPlaceholder('Add a todo…')).toBeHidden();
  await page.getByRole('button', { name: 'New todo' }).click();
  await expect(page.getByPlaceholder('Add a todo…')).toBeVisible();

  // Add with tag
  await page.getByPlaceholder('Add a todo…').fill('Ship todo MVP');
  await page.getByPlaceholder('tags (comma)').fill('agentio');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Ship todo MVP')).toBeVisible();
  await expect(page.locator('.todo-item .tag', { hasText: 'agentio' })).toBeVisible();

  // Add another with different tag
  await page.getByPlaceholder('Add a todo…').fill('Buy milk');
  await page.getByPlaceholder('tags (comma)').fill('errands');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Buy milk')).toBeVisible();

  // Escape closes the sheet
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Add a todo…')).toBeHidden();

  // Filter by tag
  await page.locator('.tag-chip', { hasText: 'agentio' }).click();
  await expect(page.locator('#view-title')).toHaveText('#agentio');
  await expect(page.getByText('Ship todo MVP')).toBeVisible();
  await expect(page.getByText('Buy milk')).toHaveCount(0);

  await page.locator('.tag-chip[data-tag=""]').click();
  await expect(page.getByText('Buy milk')).toBeVisible();

  // Check off
  const milk = page.locator('.todo-item', { hasText: 'Buy milk' });
  await milk.locator('.check').click();
  // Still on open filter — milk should disappear
  await expect(page.getByText('Buy milk')).toHaveCount(0);

  await page.locator('.chip[data-status="done"]').click();
  await expect(page.getByText('Buy milk')).toBeVisible();
});

test('login page dev sign-in follows a safe redirectTo', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/login?redirectTo=' + encodeURIComponent('/sessions'));
  await page.getByRole('button', { name: 'Continue as dev' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
});

test('login page dev sign-in ignores an offsite redirectTo', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/login?redirectTo=' + encodeURIComponent('/\\evil.example'));
  await page.getByRole('button', { name: 'Continue as dev' }).click();
  await page.waitForLoadState();
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
});
