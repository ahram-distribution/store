import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// SCRATCH interactive customer-history validation (never commit).
// Mirrors the REAL target order ea51797b (ORD-2026-000321):
// 4 previous orders, purchases 45121.48, latest ORD-2026-000284 @12312.98, 6 visits.

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'
const TARGET_ID = 'ea51797b-7e4c-42c8-aa40-b06a091d76de'
const CUSTOMER_ID = '77d2f0da-1e49-4011-b764-370c4f83b0af'

function json(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
}

// Deliberately UNSORTED to prove client-side DESC sorting (284 must come first).
const PREV_ORDERS = [
  { id: 'o-139', order_number: 'ORD-2026-000139', status: 'delivered', created_at: '2026-08-09T17:06:50.595Z', total_amount: 10087.67, customer_name: 'احمر شفايف', reference_number: 'REF-0139' },
  { id: 'o-284', order_number: 'ORD-2026-000284', status: 'delivered', created_at: '2026-09-05T12:44:32.234Z', total_amount: 12312.98, customer_name: 'احمر شفايف', reference_number: 'REF-0284' },
  { id: 'o-183', order_number: 'ORD-2026-000183', status: 'delivered', created_at: '2026-08-16T12:05:30.849Z', total_amount: 9896, customer_name: 'احمر شفايف', reference_number: 'REF-0183' },
  { id: 'o-225', order_number: 'ORD-2026-000225', status: 'delivered', created_at: '2026-08-20T11:46:26.595Z', total_amount: 12824.83, customer_name: 'احمر شفايف', reference_number: 'REF-0225' },
]

const VISITS = [
  { id: 'v-1', code: 'VIS-2026-002087', status: 'completed', visit_result: 'follow_up', check_in_at: '2026-09-09T11:46:57.342Z', check_out_at: '2026-09-09T12:21:50.224Z', employee_name: 'مندوب واحد' },
  { id: 'v-2', code: 'VIS-2026-001885', status: 'completed', visit_result: 'follow_up', check_in_at: '2026-08-26T16:15:45.001Z', check_out_at: '2026-08-26T16:20:44.452Z', employee_name: 'مندوب واحد' },
  { id: 'v-3', code: 'VIS-2026-001726', status: 'completed', visit_result: 'order_taken', check_in_at: '2026-08-20T11:30:39.460Z', check_out_at: '2026-08-20T11:49:04.489Z', employee_name: 'مندوب اثنان' },
  { id: 'v-4', code: 'VIS-2026-001542', status: 'completed', visit_result: 'order_taken', check_in_at: '2026-08-16T11:57:26.248Z', check_out_at: '2026-08-16T12:22:27.106Z', employee_name: 'مندوب اثنان' },
  { id: 'v-5', code: 'VIS-2026-001246', status: 'completed', visit_result: 'order_taken', check_in_at: '2026-08-09T17:10:02.519Z', check_out_at: '2026-08-09T17:10:14.320Z', employee_name: 'مندوب واحد' },
  { id: 'v-6', code: 'VIS-2026-001241', status: 'completed', visit_result: 'order_taken', check_in_at: '2026-08-09T16:29:04.242Z', check_out_at: '2026-08-09T17:03:54.215Z', employee_name: 'مندوب واحد' },
]

function targetPayload(id: string, num: string) {
  return {
    order: {
      id, order_number: num, reference_number: 'REF-0321', status: 'returned_for_revision',
      created_at: '2026-09-09T12:51:43.492Z', updated_at: '2026-09-09T12:51:43.492Z',
      order_type: 'cash', discount_amount: 0, total_amount: 40871.45,
      delivery_mode: 'internal', revision_number: 0, owner_id: 'e-1', created_by: 'i-1',
      customer_id: CUSTOMER_ID, tier_id: null, payment_method_option_id: null, shipping_method_option_id: null,
      notes: null, customer_owner_name: 'مندوب واحد',
      order_creator_name: 'مندوب واحد', order_creator_id: 'e-1',
    },
    customer: {
      id: CUSTOMER_ID, code: 'CUS-2026-000717', company_name: 'احمر شفايف', phone: '01001234567',
      address_line1: 'شارع الاختبار ٥', address_line2: null, city: 'القاهرة', governorate: 'القاهرة',
      display_address: null, address_latitude: null, address_longitude: null,
      gps_formatted_address: null, gps_latitude: null, gps_longitude: null, gps_accuracy_meters: null,
      previous_order_count: 4, previous_orders_total: 45121.48,
      previous_order_number: 'ORD-2026-000284', previous_order_date: '2026-09-05T12:44:32.234Z',
      previous_order_total: 12312.98,
      previous_visits_count: null,
    },
    items: [
      {
        id: 'li-1', product_id: 'p-1', product_name: 'منتج اختبار', legacy_code: 'T1',
        company_id: 'co-1', company_name: 'شركة الاختبار', unit_type: 'carton',
        unit_quantity: 10, piece_quantity: 60, unit_price: 1000, base_unit_price: 1000, total_price: 10000,
      },
    ],
    last_visit: {
      employee_name: 'مندوب واحد', started_at: '2026-09-09T11:46:57.342Z',
      completed_at: '2026-09-09T12:21:50.224Z', status: 'completed',
      start_latitude: 30.0, start_longitude: 31.0, maps_url: 'https://maps.example/1',
    },
    collections: [], current_delivery: null, modification_history: [],
    status_history: [], delivery_history: [], returns: [],
  }
}

async function installStubs(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('session_token', 'hist.synthetic.id') } catch { /* noop */ }
  })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() || ''
    let body: any = {}
    try { body = JSON.parse(route.request().postData() || '{}') } catch { body = {} }
    switch (fn) {
      case 'validate_session':
        return json(route, { valid: true, identity_id: 'i-1', identity_type: 'employee', employee_id: 'e-1', full_name: 'Rep', code: 'T-1', roles: [] })
      case 'get_unified_order': {
        const pid = String(body.p_id || '')
        if (pid === TARGET_ID) return json(route, targetPayload(TARGET_ID, 'ORD-2026-000321'))
        const prev = PREV_ORDERS.find((o) => o.id === pid)
        if (prev) return json(route, targetPayload(prev.id, prev.order_number))
        return json(route, { error: 'NOT_FOUND' })
      }
      case 'get_unified_orders':
        return json(route, PREV_ORDERS)
      case 'get_customer_visits':
        return json(route, VISITS)
      default:
        return json(route, [])
    }
  })
}

async function openTarget(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h })
  await installStubs(page)
  await page.goto(`http://localhost:5173/store/#/orders/${TARGET_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=منشئ الطلب', { timeout: 60000 })
  await page.waitForTimeout(1500)
}

async function noOverflow(page: Page, label: string) {
  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }))
  console.log(`${label}: scrollWidth=${ov.s} innerWidth=${ov.w}`)
  expect(ov.s, label).toBeLessThanOrEqual(ov.w + 1)
}

test('position: history below creator, before products @360', async ({ page }) => {
  await openTarget(page, 360, 800)
  const order = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('#app p, #app h3, #app span, #app div'))
    const idx = (re: RegExp) => all.findIndex((el) => re.test(el.textContent || '') && (el.children.length === 0 || /منشئ الطلب|الطلبات السابقة|المنتجات/.test(el.textContent || '')))
    const iCreator = all.findIndex((el) => (el.textContent || '').includes('منشئ الطلب') && el.children.length <= 2)
    const iHist = all.findIndex((el) => (el.textContent || '').trim() === 'الطلبات السابقة')
    const iProd = all.findIndex((el) => (el.textContent || '').trim() === 'المنتجات')
    return { iCreator, iHist, iProd }
  })
  console.log('order: ' + JSON.stringify(order))
  expect(order.iCreator).toBeGreaterThanOrEqual(0)
  expect(order.iHist).toBeGreaterThan(order.iCreator)
  expect(order.iProd).toBeGreaterThan(order.iHist)
  await noOverflow(page, 'position@360')
  await page.screenshot({ path: `${SHOT}/hist-360-top.png` })
})

test('previous-orders modal: 4 records, sorted, total reconciles, excludes current @390', async ({ page }) => {
  await openTarget(page, 390, 844)
  await page.locator('button:has-text("الطلبات السابقة")').click()
  await page.waitForSelector('text=إجمالي المعروض', { timeout: 15000 })
  // Exactly 4 order numbers, latest first
  const nums = await page.locator('[role="dialog"] .font-mono').evaluateAll((els) =>
    els.map((e) => (e.textContent || '').trim()).filter((t) => /ORD-/.test(t)))
  console.log('modal nums: ' + JSON.stringify(nums))
  expect(nums.length).toBe(4)
  expect(nums[0]).toBe('ORD-2026-000284')
  expect(nums).not.toContain('ORD-2026-000321')
  // Footer reconciles with the displayed metric 45,121.48
  const footer = await page.locator('text=إجمالي المعروض').evaluate((el) => (el.parentElement?.textContent || ''))
  console.log('footer: ' + footer.trim())
  expect(footer.replace(/[\s,]/g, '')).toContain('45121.48')
  await noOverflow(page, 'modal@390')
  await page.screenshot({ path: `${SHOT}/hist-390-modal.png` })
  // Navigate to the original order via first card
  await page.locator('[role="dialog"] .font-mono').first().click()
  await page.waitForURL(/orders\/o-284/, { timeout: 15000 })
  await page.waitForTimeout(1500)
  const shown = await page.locator('text=ORD-2026-000284').first().isVisible()
  console.log('navigated, order visible: ' + shown)
  expect(shown).toBe(true)
})

test('purchases + last-order metrics open reconciling records @414', async ({ page }) => {
  await openTarget(page, 414, 896)
  // Purchases
  await page.locator('button:has-text("المشتريات السابقة")').click()
  await page.waitForSelector('text=إجمالي المعروض', { timeout: 15000 })
  const footer = await page.locator('text=إجمالي المعروض').evaluate((el) => (el.parentElement?.textContent || ''))
  expect(footer.replace(/[\s,]/g, '')).toContain('45121.48')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  // Last order -> latest highlighted
  await page.locator('button:has-text("آخر طلب سابق")').click()
  await page.waitForSelector('text=الأحدث', { timeout: 15000 })
  const first = await page.locator('[role="dialog"] .font-mono').evaluateAll((els) =>
    els.map((e) => (e.textContent || '').trim()).filter((t) => /ORD-/.test(t)))
  expect(first[0]).toBe('ORD-2026-000284')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  // Last order value metric
  await page.locator('button:has-text("قيمة آخر طلب")').click()
  await page.waitForSelector('text=الأحدث', { timeout: 15000 })
  await noOverflow(page, 'metrics@414')
})

test('visits modal lists 6 visits @360', async ({ page }) => {
  await openTarget(page, 360, 800)
  await page.locator('button:has-text("آخر زيارة للعميل")').click()
  await page.waitForSelector('text=زيارات العميل', { timeout: 15000 })
  const codes = await page.locator('[role="dialog"] .font-mono').evaluateAll((els) =>
    els.map((e) => (e.textContent || '').trim()).filter((t) => /VIS-/.test(t)))
  console.log('visits: ' + JSON.stringify(codes))
  expect(codes.length).toBe(6)
  expect(codes[0]).toBe('VIS-2026-002087')
  await noOverflow(page, 'visits@360')
  await page.screenshot({ path: `${SHOT}/hist-360-visits.png` })
})

test('desktop 1280 layout + modal', async ({ page }) => {
  await openTarget(page, 1280, 900)
  await page.locator('button:has-text("الطلبات السابقة")').click()
  await page.waitForSelector('text=إجمالي المعروض', { timeout: 15000 })
  const n = await page.locator('[role="dialog"] .font-mono').evaluateAll((els) =>
    els.map((e) => (e.textContent || '').trim()).filter((t) => /ORD-/.test(t)))
  expect(n.length).toBe(4)
  await noOverflow(page, 'desktop')
  await page.screenshot({ path: `${SHOT}/hist-desktop.png` })
})
