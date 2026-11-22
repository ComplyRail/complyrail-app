import { test, expect, type Page } from '@playwright/test'

/**
 * Every static route, with a heading that must render. Pages that read from
 * the contract still render their heading while loading, so these tests do
 * not depend on testnet availability.
 */
const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/', heading: /On-Chain Compliance/ },
  { path: '/vasps/', heading: /VASP Directory/ },
  { path: '/thresholds/', heading: /Threshold Configuration/ },
  { path: '/payments/', heading: /Payment Queue/ },
  { path: '/payments/new/', heading: /Submit Payment/ },
  { path: '/payments/view/?id=1', heading: /Payment #1|Loading from contract/ },
  { path: '/audit/', heading: /Audit Log/ },
  { path: '/admin/', heading: /Contract/ },
]

/** Collects uncaught exceptions thrown in the page (not caught network errors). */
function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  return errors
}

for (const route of ROUTES) {
  test(`${route.path} renders its heading without page errors`, async ({ page }) => {
    const errors = trackPageErrors(page)
    const response = await page.goto(route.path)
    expect(response?.status(), 'HTTP status').toBe(200)

    await expect(page.getByText(route.heading).first()).toBeVisible()
    expect(errors, 'uncaught page errors').toEqual([])
  })
}
