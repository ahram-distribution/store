import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// SCRATCH mobile order-details validation (never commit).
// Stubs session + get_unified_order with realistic multi-company orders
// (direct-discount + bonus-tier) and checks viewports 360/390/414 + desktop.

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'

function json(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
}

const CUSTOMER = {
  id: 'c-1', company_name: 'عميل الاختبار للتجارة', phone: '01001234567',
  address_line1: 'شارع الجمهورية ١٢', address_line2: null, city: 'القاهرة', governorate: 'القاهرة',
  previous_order_count: 3, previous_orders_total: 120000,
  previous_order_number: 'AHR-2026-000100', previous_order_total: 40000,
  previous_order_date: '2026-08-20T10:00:00Z',
}

function li(id: string, productId: string, name: string, code: string, company: string, unit: string, qty: number, pieces: number, unitPrice: number, basePrice: number, extra?: any) {
  return {
    id, product_id: productId, product_name: name, legacy_code: code, company_id: `co-${company}`,
    company_name: company, unit_type: unit, unit_quantity: qty, piece_quantity: pieces,
    unit_price: unitPrice, base_unit_price: basePrice, total_price: Math.round(unitPrice * qty * 100) / 100,
    ...(extra || {}),
  }
}

const DIRECT_ORDER = {
  order: {
    id: 'order-direct-1', order_number: 'AHR-2026-000123', reference_number: 'REF-9988',
    status: 'submitted', created_at: '2026-09-10T12:30:00Z', updated_at: '2026-09-10T12:30:00Z',
    order_type: 'cash', discount_amount: 1800, total_amount: 65880,
    snapshot_tier_name: 'شريحة الجملة', snapshot_tier_discount: 5, effective_discount_percent: 5,
    delivery_mode: 'internal', revision_number: 0, owner_id: 'e-1', created_by: 'i-1',
    customer_id: 'c-1', tier_id: null, payment_method_option_id: null, shipping_method_option_id: null,
    notes: 'ملاحظة اختبار للطلب', customer_owner_name: 'مندوب الاختبار',
    order_creator_name: 'مندوب الاختبار', order_creator_id: 'e-1',
  },
  customer: CUSTOMER,
  items: [
    li('li-1', 'p-pal-1', 'صبغة باليت سيمي كيت 1.0', '1', 'صبغة باليت', 'carton', 50, 300, 936, 960),
    li('li-2', 'p-pal-2', 'صبغة باليت بلوند 9.0', '2', 'صبغة باليت', 'piece', 24, 24, 45, 45),
    li('li-3', 'p-eva-1', 'كريم إيفا بالعسل', '101', 'إيفا', 'dozen', 10, 120, 600, 660),
    li('li-4', 'p-eva-2', 'شامبو إيفا 500مل', '102', 'إيفا', 'carton', 5, 60, 2400, 2400),
  ],
  collections: [], current_delivery: null, modification_history: [],
  status_history: [], delivery_history: [], returns: [], last_visit: null,
}

const BONUS_ORDER = {
  order: {
    id: 'order-bonus-1', order_number: 'AHR-2026-000200', reference_number: 'REF-7700',
    status: 'submitted', created_at: '2026-09-11T09:00:00Z', updated_at: '2026-09-11T09:00:00Z',
    order_type: 'cash', discount_amount: 0, total_amount: 21000,
    bonus_mode_used: true, bonus_credit: 1000, main_base_total: 20000,
    snapshot_tier_name: 'شريحة البونص', snapshot_tier_discount: 5,
    delivery_mode: 'internal', revision_number: 0, owner_id: 'e-1', created_by: 'i-1',
    customer_id: 'c-1', tier_id: null, payment_method_option_id: null, shipping_method_option_id: null,
    notes: null, customer_owner_name: 'مندوب الاختبار',
    order_creator_name: 'مندوب الاختبار', order_creator_id: 'e-1',
  },
  customer: CUSTOMER,
  items: [
    li('li-b1', 'p-pal-9', 'صبغة باليت أحمر 5.5', '9', 'صبغة باليت', 'carton', 10, 60, 960, 960),
    li('li-b2', 'p-eva-9', 'بلسم إيفا 1لتر', '109', 'إيفا', 'carton', 4, 48, 2600, 2600),
    li('li-b3', 'p-bn-1', 'هدية فرشاة صبغة', '901', 'هدايا', 'piece', 2, 2, 500, 500, { is_bonus: true }),
    li('li-b4', 'p-bn-2', 'هدية مشط احترافي', '902', 'هدايا', 'piece', 4, 4, 250, 250, { is_bonus: true }),
  ],
  collections: [], current_delivery: null, modification_history: [],
  status_history: [], delivery_history: [], returns: [], last_visit: null,
}

async function installStubs(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('session_token', 'order.synthetic.id') } catch { /* noop */ }
  })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() || ''
    switch (fn) {
      case 'validate_session':
        return json(route, { valid: true, identity_id: 'i-1', identity_type: 'employee', employee_id: 'e-1', full_name: 'Rep', code: 'T-1', roles: [] })
      case 'get_unified_order': {
        let body: any = {}
        try { body = JSON.parse(route.request().postData() || '{}') } catch { body = {} }
        if (body.p_id === 'order-bonus-1') return json(route, BONUS_ORDER)
        return json(route, DIRECT_ORDER)
      }
      case 'governed_check_product_availability_v2':
        return json(route, { available: true, error: null, max_allowed_units: null, max_allowed_pieces: null, carton_quantity: 12, unit_type: 'carton', prior_reservations_exist: false, expected_executable_pieces: null })
      case 'get_order_discount_snapshots':
        return json(route, [])
      default:
        return json(route, [])
    }
  })
}

async function checkViewport(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    visibleTables: Array.from(document.querySelectorAll('table')).filter((t) => (t as HTMLElement).offsetParent !== null).length,
  }))
  console.log(`${label}: scrollWidth=${overflow.scrollW} innerWidth=${overflow.innerW} visibleTables=${overflow.visibleTables}`)
  expect(overflow.scrollW, `${label} horizontal overflow`).toBeLessThanOrEqual(overflow.innerW + 1)
  return overflow
}

async function checkButtons(page: Page, label: string) {
  const bad = await page.evaluate(() => {
    const innerW = window.innerWidth
    const out: string[] = []
    for (const b of Array.from(document.querySelectorAll('#app button')) as HTMLElement[]) {
      if (b.offsetParent === null) continue
      const r = b.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      if (r.left < -1 || r.right > innerW + 1) out.push(`${(b.textContent || '').trim().slice(0, 20)} [${Math.round(r.left)},${Math.round(r.right)}]`)
      if (r.height < 20) out.push(`SHORT ${(b.textContent || '').trim().slice(0, 20)} h=${Math.round(r.height)}`)
    }
    return out
  })
  console.log(`${label} badButtons=${bad.length}${bad.length ? ' :: ' + bad.slice(0, 8).join(' | ') : ''}`)
  expect(bad, `${label} buttons out of viewport`).toEqual([])
}

const MOBILE_VIEWPORTS = [
  { w: 360, h: 800, name: '360' },
  { w: 390, h: 844, name: '390' },
  { w: 414, h: 896, name: '414' },
]

for (const orderId of ['order-direct-1', 'order-bonus-1']) {
  for (const vp of MOBILE_VIEWPORTS) {
    test(`order ${orderId} mobile ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h })
      await installStubs(page)
      await page.goto(`http://localhost:5173/store/#/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('text=المنتجات', { timeout: 60000 })
      await page.waitForTimeout(2000)
      const ov = await checkViewport(page, `${orderId}@${vp.name}`)
      expect(ov.visibleTables, 'tables must be hidden on mobile').toBe(0)
      await checkButtons(page, `${orderId}@${vp.name}`)
      // Key data present AND visible (hidden desktop table also contains these strings)
      for (const t of ['إجمالي الصنف', 'سعر الوحدة', 'شركة صبغة']) {
        const n = await page.locator(`text=${t}`).evaluateAll((els) =>
          els.filter((e) => (e as HTMLElement).offsetParent !== null).length)
        expect(n, `visible ${t}`).toBeGreaterThan(0)
      }
      await page.screenshot({ path: `${SHOT}/order-${orderId}-${vp.name}.png`, fullPage: true })
    })
  }
  test(`order ${orderId} desktop unchanged`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await installStubs(page)
    await page.goto(`http://localhost:5173/store/#/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=المنتجات', { timeout: 60000 })
    await page.waitForTimeout(2000)
    const ov = await checkViewport(page, `${orderId}@desktop`)
    expect(ov.visibleTables, 'desktop tables must render').toBeGreaterThan(0)
    await checkButtons(page, `${orderId}@desktop`)
    await page.screenshot({ path: `${SHOT}/order-${orderId}-desktop.png` })
  })
}
