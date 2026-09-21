import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// SCRATCH theme-validation harness (never commit). Stubs session + catalog RPCs,
// switches Gold Classic <-> VIP through the REAL UI, screenshots every screen.

const COMPANY = { id: 'company-A', company_name: 'شركة الاختبار', legacy_code: 'T', logo_url: null }

function makeRows(n: number) {
  const rows: any[] = []
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `p-${i}`,
      product_name: `منتج ${i}`,
      legacy_code: `BP-${i}`,
      carton_price: 300,
      carton_quantity: 6,
      piece_price: 50,
      dozen_price: 580,
      is_active: true,
      is_out_of_stock: false,
      is_visible: true,
      image_url: null,
      company_id: 'company-A',
      company_name: COMPANY.company_name,
      company_legacy_code: COMPANY.legacy_code,
      bonus_enabled: true,
      company_bonus_enabled: true,
      recently_available_at: null,
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

async function installStubs(page: Page, n: number) {
  const rows = makeRows(n)
  await page.addInitScript(() => {
    try { localStorage.setItem('session_token', 'theme.synthetic.id') } catch { /* noop */ }
  })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() || ''
    let body: unknown = null
    try { body = JSON.parse(route.request().postData() || '{}') } catch { body = {} }
    switch (fn) {
      case 'validate_session':
        return json(route, { valid: true, identity_id: 'i-1', identity_type: 'employee', employee_id: 'e-1', full_name: 'Rep', code: 'T-1', roles: [] })
      case 'get_governed_bonus_products':
        return json(route, rows)
      case 'get_governed_products': {
        const pcid = (body as any).p_company_id
        if (pcid && pcid !== 'company-A') return json(route, [])
        return json(route, rows)
      }
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
}

async function themeState(page: Page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      dataTheme: document.documentElement.dataset.theme || null,
      stored: (() => { try { return localStorage.getItem('ahram_theme') } catch { return null } })(),
      primary: cs.getPropertyValue('--color-primary').trim(),
      accent: cs.getPropertyValue('--theme-accent').trim(),
      themePrimary: cs.getPropertyValue('--theme-primary').trim(),
      navy: cs.getPropertyValue('--theme-navy').trim(),
    }
  })
}

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'

test('theme global validation gold -> vip', async ({ page }) => {
  await installStubs(page, 12)
  const out: string[] = []
  const note = (s: string) => { out.push(s); console.log(s) }

  // 1. Fresh load defaults to Gold Classic
  await page.goto('http://localhost:5173/store/#/storefront', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[title="الثيمات"]', { timeout: 60000 })
  await page.waitForTimeout(1500)
  let st = await themeState(page)
  note(`GOLD initial: ${JSON.stringify(st)}`)
  expect(st.dataTheme).toBe('gold')
  expect(st.primary).toBe('#0052cc')
  await page.screenshot({ path: `${SHOT}/theme-gold-storefront.png` })

  // 2. Products grid (gold) + expanded product modal (product details)
  await page.goto('http://localhost:5173/store/#/storefront/products?companyId=company-A', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[class*="md:grid-cols-5"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/theme-gold-products.png` })

  // 3. Switch to VIP through the REAL UI
  await page.goto('http://localhost:5173/store/#/storefront', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[title="الثيمات"]', { timeout: 60000 })
  await page.locator('button[title="الثيمات"]').click()
  await page.waitForSelector('text=اختر الثيم', { timeout: 15000 })
  await page.screenshot({ path: `${SHOT}/theme-selector-vip-open.png` })
  await page.locator('text=VIP').first().click()
  await page.waitForTimeout(800)
  st = await themeState(page)
  note(`VIP after switch: ${JSON.stringify(st)}`)
  expect(st.dataTheme).toBe('vip')
  expect(st.stored).toBe('vip')
  expect(st.primary).toBe('#1a1a1a')
  expect(st.accent).toBe('#D4AF37')
  await page.screenshot({ path: `${SHOT}/theme-vip-storefront.png` })

  // 4. Products grid in VIP + expanded modal
  await page.goto('http://localhost:5173/store/#/storefront/products?companyId=company-A', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[class*="md:grid-cols-5"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1500)
  st = await themeState(page)
  note(`VIP products grid: ${JSON.stringify(st)}`)
  expect(st.dataTheme).toBe('vip')
  await page.screenshot({ path: `${SHOT}/theme-vip-products.png` })

  // 5. Cart + order review in VIP
  await page.goto('http://localhost:5173/store/#/cart', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/theme-vip-cart.png` })
  await page.goto('http://localhost:5173/store/#/order-review', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/theme-vip-order-review.png` })

  // 6. Bonus L1 + L2 in VIP
  await page.goto('http://localhost:5173/store/#/storefront/bonus', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[class*="grid-cols-3"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/theme-vip-bonus-l1.png` })
  await page.evaluate(() => { (document.querySelector('[class*="grid-cols-3"] button') as HTMLElement)?.click() })
  await page.waitForSelector('[class*="md:grid-cols-4"]', { timeout: 60000, state: 'attached' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/theme-vip-bonus-l2.png` })

  // 7. Dashboard in VIP (shell + nav + cards with stubbed empty data)
  await page.goto('http://localhost:5173/store/#/dashboard', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  st = await themeState(page)
  note(`VIP dashboard: ${JSON.stringify(st)}`)
  await page.screenshot({ path: `${SHOT}/theme-vip-dashboard.png`, fullPage: false })

  // 8. Login in VIP
  await page.goto('http://localhost:5173/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/theme-vip-login.png` })

  // 9. Refresh persistence (wait past splash until provider applies saved theme)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.documentElement.dataset.theme, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  st = await themeState(page)
  note(`VIP after reload: ${JSON.stringify(st)}`)
  expect(st.dataTheme).toBe('vip')
  expect(st.stored).toBe('vip')

  // 10. Switch back to Gold via UI, verify immediate revert
  await page.goto('http://localhost:5173/store/#/storefront', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('button[title="الثيمات"]', { timeout: 60000 })
  await page.locator('button[title="الثيمات"]').click()
  await page.waitForSelector('text=اختر الثيم', { timeout: 15000 })
  await page.locator('text=Gold Classic').first().click()
  await page.waitForTimeout(800)
  st = await themeState(page)
  note(`GOLD after switch-back: ${JSON.stringify(st)}`)
  expect(st.dataTheme).toBe('gold')
  expect(st.primary).toBe('#0052cc')

  console.log('\n=== THEME FLOW DONE ===\n' + out.join('\n'))
})
