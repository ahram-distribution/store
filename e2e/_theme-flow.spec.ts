import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// SCRATCH: expanded product modal + non-empty cart/order-review/checkout in VIP (never commit).
const COMPANY = { id: 'company-A', company_name: 'شركة الاختبار', legacy_code: 'T', logo_url: null }

function makeRows(n: number) {
  const rows: any[] = []
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `p-${i}`, product_name: `منتج ${i}`, legacy_code: `BP-${i}`,
      carton_price: 300, carton_quantity: 6, piece_price: 50, dozen_price: 580,
      is_active: true, is_out_of_stock: false, is_visible: true, image_url: null,
      company_id: 'company-A', company_name: COMPANY.company_name, company_legacy_code: 'T',
      bonus_enabled: true, company_bonus_enabled: true, recently_available_at: null,
      product_units: [
        { unit_type: 'piece', is_active: true },
        { unit_type: 'dozen', is_active: true },
        { unit_type: 'carton', is_active: true },
      ],
      geo_adjustment_percent: 0,
    })
  }
  return rows
}

function json(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
}

test('vip expanded modal + filled order flow', async ({ page }) => {
  const rows = makeRows(6)
  const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'
  await page.addInitScript(() => {
    try {
      localStorage.setItem('session_token', 'theme.synthetic.id')
      localStorage.setItem('ahram_theme', 'vip')
    } catch { /* noop */ }
  })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() || ''
    let body: unknown = null
    try { body = JSON.parse(route.request().postData() || '{}') } catch { body = {} }
    switch (fn) {
      case 'validate_session':
        return json(route, { valid: true, identity_id: 'i-1', identity_type: 'employee', employee_id: 'e-1', full_name: 'Rep', code: 'T-1', roles: [] })
      case 'get_governed_products': {
        const pcid = (body as any).p_company_id
        if (pcid && pcid !== 'company-A') return json(route, [])
        return json(route, rows)
      }
      case 'get_governed_bonus_products':
        return json(route, rows)
      case 'get_governed_bonus_config':
        return json(route, { bonus_mode_enabled: true })
      default:
        return json(route, [])
    }
  })
  await page.route('**/rest/v1/companies*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('id')?.startsWith('eq.')) return json(route, COMPANY)
    return json(route, [COMPANY])
  })
  await page.route('**/rest/v1/customer_addresses*', async (route) => json(route, []))
  await page.route('**/rest/v1/sector_governorates*', async (route) => json(route, []))

  await page.goto('http://localhost:5173/store/#/storefront/products?companyId=company-A', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[class*="md:grid-cols-5"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1500)

  // Expanded product modal (product details) via placeholder-image click
  // (stub products have no image_url, so cards render the Package placeholder)
  const grid = '[class*="md:grid-cols-5"]'
  await page.locator(`${grid} > div svg`).first().click({ force: true })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${SHOT}/theme-vip-expanded.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // Add a BONUS item through the REAL UI (incl. the manual qty entry):
  // bonus flow needs no tier wizard.
  await page.goto('http://localhost:5173/store/#/storefront/bonus', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[class*="grid-cols-3"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1000)
  await page.evaluate(() => { (document.querySelector('[class*="grid-cols-3"] button') as HTMLElement)?.click() })
  await page.waitForSelector('[class*="md:grid-cols-4"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1000)
  const bgrid = '[class*="md:grid-cols-4"]'
  const bcard = page.locator(`${bgrid} > div`).first()
  await bcard.locator('input[type="number"]').fill('3')
  await bcard.getByRole('button', { name: 'إضافة إلى سلة البونص' }).click()
  await page.waitForSelector('text=تمت الإضافة للسلة', { timeout: 30000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOT}/theme-vip-bonus-added.png` })

  // Order review + checkout with items
  await page.goto('http://localhost:5173/store/#/order-review', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOT}/theme-vip-order-review-items.png` })
  await page.goto('http://localhost:5173/store/#/checkout', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOT}/theme-vip-checkout.png` })
  console.log('FLOW DONE')
})
