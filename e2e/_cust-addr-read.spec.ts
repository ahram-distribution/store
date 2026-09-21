import { test, expect } from '@playwright/test'

test('read customer full address', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })
  await page.goto('/store/#/customers/26d9df16-7fcf-4f8d-aa9b-67ce0b93dbeb', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=بيانات العميل', { timeout: 30000 })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  console.log('=== BODY START ===')
  console.log(body.slice(0, 3000))
  console.log('=== BODY END ===')
  await page.screenshot({ path: 'C:/Users/joker/AppData/Local/Temp/opencode/cust-addr-screen.png', fullPage: true })
})