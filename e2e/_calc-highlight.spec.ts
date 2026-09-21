import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode/calc-highlight/'

test('calc highlight row visual', async ({ page }) => {
  test.setTimeout(120000)
  fs.mkdirSync(SHOT, { recursive: true })
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })

  await page.goto('/store/#/orders/900179da-8627-4654-82ca-f840fb3b4829', { waitUntil: 'domcontentloaded' })
  const row = page.getByText('إجمالي المنتجات الأساسية', { exact: true })
  await expect(row).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1500)

  // explainer text must be gone
  await expect(page.getByText('قيمة الأصناف الرئيسية بالسعر الأساسي قبل أي خصم')).toHaveCount(0)

  // calc section must not contain ج.م anymore
  const calcBox = page.locator('div', { hasText: 'حساب قيمة الطلب النهائية' }).last()
  const calcText = await calcBox.innerText()
  console.log('CALC HAS ج.م:', calcText.includes('ج.م'))
  expect(calcText).not.toContain('ج.م')

  // both framed rows present (main base + final)
  const frames = page.locator('div.rounded-xl.border-2.border-\\[\\#2563EB\\]')
  console.log('FRAMED ROWS:', await frames.count())
  await expect(frames).toHaveCount(2)

  const box = page.locator('div', { has: row }).last()
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: SHOT + 'calc-section.png' })
  console.log('ROW TEXT:', (await row.evaluate((e) => e.closest('div.rounded-xl')?.outerHTML.slice(0, 200))) || 'no-frame')
})