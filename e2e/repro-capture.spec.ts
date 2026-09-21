import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode/'

async function login(page: Page) {
  await page.goto('/store/login')
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '123321')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 25000 })
}

test('capture real governed_create_order from storefront', async ({ page }) => {
  test.setTimeout(240000)
  await page.setViewportSize({ width: 390, height: 844 })

  const events: any[] = []
  await page.route('**/rest/v1/rpc/governed_create_order', async (route) => {
    const req = route.request()
    const payload = req.postDataJSON()
    const response = await route.fetch()
    const body = await response.text()
    events.push({ payload, status: response.status(), body: body.slice(0, 1200) })
    console.log(`=== governed_create_order → ${response.status()} ===`)
    console.log(JSON.stringify({ payloadKeys: Object.keys(payload).sort(), status: response.status(), body }, null, 1))
    await route.fulfill({ response })
  })

  await login(page)

  // clean cart then add one product
  await page.evaluate(() => localStorage.removeItem('ahram-cart'))
  await page.goto('/store/storefront/products', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="ابحث عن منتج..."]', { timeout: 30000 })
  await page.waitForTimeout(2500)
  await page.locator('button:has-text("+")').first().click()
  await page.waitForTimeout(1200)
  await page.locator('button:has-text("شراء المنتج")').first().click()
  await page.waitForTimeout(1500)

  // open cart via the summary bar
  const bar = page.locator('button:has-text("إجمالي السلة")').first()
  if (await bar.isVisible({ timeout: 8000 }).catch(() => false)) {
    await bar.click()
  }
  await page.waitForURL(/\/cart/, { timeout: 15000 })

  // proceed to review
  const checkout = page.locator('button:has-text("إتمام الطلب")').first()
  if (await checkout.isVisible({ timeout: 8000 }).catch(() => false)) await checkout.click()
  await page.waitForTimeout(2000)

  // try to submit (confirm order) — may or may not be visible depending on bonus mode
  const submit = page.locator('button:has-text("تأكيد الطلب")').first()
  if (await submit.isVisible({ timeout: 8000 }).catch(() => false)) {
    await submit.click()
    await page.waitForTimeout(3000)
  }

  await page.screenshot({ path: SHOT + 'repro-storefront-submit.png', fullPage: false })
  fs.writeFileSync(SHOT + 'repro-storefront-events.json', JSON.stringify(events, null, 2))
  console.log('saved events:', events.length)
})