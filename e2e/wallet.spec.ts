import { test, expect } from '@playwright/test'

test('Connect Wallet opens the wallet selection modal', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))

  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click()

  // The kit's modal lists the supported wallets.
  await expect(page.getByText('Freighter', { exact: true })).toBeVisible()
  await expect(page.getByText('Albedo', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
