import { test, expect } from '@playwright/test'

test('download prep pdf page count', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })
  await page.goto('/store/#/orders/900179da-8627-4654-82ca-f840fb3b4829', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'تحميل إذن التحضير', exact: true }).waitFor({ timeout: 40000 })
  await page.waitForTimeout(2000)
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('button', { name: 'تحميل إذن التحضير', exact: true }).click(),
  ]).then(([d]) => d)
  const p = 'C:/Users/joker/AppData/Local/Temp/opencode/prep-900179-download.pdf'
  await dl.saveAs(p)
  console.log('SAVED:', p)
})