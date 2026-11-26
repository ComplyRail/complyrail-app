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

/** Home cards are named by their heading, not by the decorative emoji or blurb. */
const HOME_CARDS: { href: string; name: string }[] = [
  { href: '/vasps', name: 'VASP Directory' },
  { href: '/thresholds', name: 'Thresholds' },
  { href: '/payments', name: 'Payments' },
  { href: '/payments/new', name: 'Submit Payment' },
  { href: '/audit', name: 'Audit Log' },
  { href: '/admin', name: 'Contract' },
]

test('home card links have their heading as the accessible name', async ({ page }) => {
  await page.goto('/')

  const cards = page.locator('a[aria-labelledby^="home-card-"]')
  await expect(cards).toHaveCount(HOME_CARDS.length)

  for (const { href, name } of HOME_CARDS) {
    const card = page.locator(`a[href="${href}"][aria-labelledby^="home-card-"]`)
    await expect(card).toHaveAccessibleName(new RegExp(`^${name}$`))
  }

  for (const icon of await cards.locator(':scope > div').all()) {
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
  }
})
