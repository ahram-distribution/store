import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// SCRATCH orders filter layout check (never commit).
const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'

function json(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
}

const ORDERS = [
  {
    id: 'o-1', order_number: 'AHR-2026-000123', status: 'submitted', created_at: '2026-09-10T12:30:00Z',
    total_amount: 65880, customer_id: 'c-1', customer_name: 'عميل الاختبار', owner_id: 'e-1',
    order_type: 'cash', tier_id: null,
  },
  {
    id: 'o-2', order_number: 'AHR-2026-000124', status: 'approved', created_at: '2026-09-09T10:00:00Z',
    total_amount: 12000, customer_id: 'c-2', customer_name: 'عميل ثان', owner_id: 'e-2',
    order_type: 'cash', tier_id: null,
  },
]

async function installStubs(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('session_token', 'order.synthetic.id') } catch { /* noop */ }
  })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() || ''
    switch (fn) {
      case 'validate_session':
        return json(route, { valid: true, identity_id: 'i-1', identity_type: 'employee', employee_id: 'e-1', full_name: 'Rep', code: 'T-1', roles: [] })
      case 'get_unified_orders':
        return json(route, ORDERS)
      case 'get_governed_employees':
        return json(route, [
          { id: 'e-1', full_name: 'مندوب واحد' },
          { id: 'e-2', full_name: 'مندوب اثنان' },
        ])
      case 'get_governed_customers':
        return json(route, [])
      default:
        return json(route, [])
    }
  })
  await page.route('**/rest/v1/customer_addresses*', async (route) => json(route, []))
  await page.route('**/rest/v1/sector_governorates*', async (route) => json(route, []))
}

test('orders filters layout mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await installStubs(page)
  await page.goto('http://localhost:5173/store/#/orders', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  // Layout order: search bar, then employee filter below it
  const searchY = await page.locator('input[placeholder*="برقم الطلب"]').evaluate((el) => (el as HTMLElement).getBoundingClientRect().top)
  const empY = await page.locator('button:has-text("المسؤول"), button:has-text("كل المناديب")').first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().top)
  console.log(`searchTop=${Math.round(searchY)} empTop=${Math.round(empY)}`)
  expect(empY).toBeGreaterThan(searchY)
  // No horizontal overflow
  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }))
  console.log(`scrollWidth=${ov.s} innerWidth=${ov.w}`)
  expect(ov.s).toBeLessThanOrEqual(ov.w + 1)
  await page.screenshot({ path: `${SHOT}/orders-filters-360.png` })
})

test('orders filters layout desktop + behavior', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installStubs(page)
  await page.goto('http://localhost:5173/store/#/orders', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  // Order-type filter sits in the date-type row
  const dateRow = page.locator('text=نوع التاريخ')
  await expect(dateRow).toBeVisible()
  const typeFilter = page.locator('button:has-text("كل الأنواع")')
  await expect(typeFilter).toBeVisible()
  const row1 = await dateRow.evaluate((el) => (el as HTMLElement).getBoundingClientRect().top)
  const row2 = await typeFilter.evaluate((el) => (el as HTMLElement).getBoundingClientRect().top)
  console.log(`dateRowTop=${Math.round(row1)} typeFilterTop=${Math.round(row2)}`)
  expect(Math.abs(row1 - row2)).toBeLessThan(40)
  // Employee filter still functional: open + select
  await page.locator('button:has-text("المسؤول"), button:has-text("كل المناديب")').first().click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOT}/orders-filters-desktop.png` })
  // Search still functional
  await page.locator('input[placeholder*="برقم الطلب"]').fill('AHR-2026-000123')
  await page.waitForTimeout(1000)
  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }))
  expect(ov.s).toBeLessThanOrEqual(ov.w + 1)
})
