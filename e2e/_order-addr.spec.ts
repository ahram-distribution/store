import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode/order-addr/'
const EXPECTED = 'البحر الأحمر - الغردقة - طريق النصر'
const STALE = 'الكوثر, الكوثر'

async function login(page: any) {
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })
}

async function capturePrintHtml(page: any, btnName: string): Promise<string> {
  await page.evaluate(() => {
    ;(window as any).__PRINT_HTML__ = null
    const iv = setInterval(() => {
      const f = document.querySelector('iframe')
      if (f && (f as any).contentDocument && (f as any).contentDocument.body && (f as any).contentDocument.body.innerHTML) {
        ;(window as any).__PRINT_HTML__ = (f as any).contentDocument.documentElement.outerHTML
        clearInterval(iv)
      }
    }, 30)
    setTimeout(() => clearInterval(iv), 15000)
  })
  await page.getByRole('button', { name: btnName, exact: true }).click()
  await page.waitForFunction(() => (window as any).__PRINT_HTML__, { timeout: 15000 })
  return page.evaluate(() => (window as any).__PRINT_HTML__)
}

test.describe.configure({ mode: 'serial' })

test('order screen + permit PDF share current full address', async ({ page }) => {
  test.setTimeout(180000)
  fs.mkdirSync(SHOT, { recursive: true })
  await login(page)
  await page.goto('/store/#/orders/900179da-8627-4654-82ca-f840fb3b4829', { waitUntil: 'domcontentloaded' })
  await page.getByText('إجمالي المنتجات الأساسية', { exact: true }).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500)

  // 1. screen address
  const bodyText: string = await page.locator('body').innerText()
  const addrLine = bodyText.split('\n').find((l) => l.includes('العنوان:')) || ''
  console.log('SCREEN ADDR LINE:', addrLine)
  expect(bodyText).toContain(EXPECTED)
  expect(bodyText).not.toContain('البحر الأحمر - الغردقة - الكوثر')

  // 2. delivery permit print HTML
  const permit = await capturePrintHtml(page, 'PDF')
  fs.writeFileSync(SHOT + 'permit.html', permit, 'utf8')
  console.log('PERMIT HAS NEW:', permit.includes(EXPECTED), '| HAS STALE:', permit.includes(STALE))
  expect(permit).toContain(EXPECTED)
  expect(permit).not.toContain(STALE)
  // content otherwise intact
  expect(permit).toContain('إجمالي المنتجات الأساسية')
  expect(permit).toContain('calc-highlight')
})

test('prep permit print HTML shares current full address', async ({ page }) => {
  test.setTimeout(180000)
  await login(page)
  await page.goto('/store/#/orders/900179da-8627-4654-82ca-f840fb3b4829', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'إذن تحضير للمخزن', exact: true }).waitFor({ timeout: 40000 })
  await page.waitForTimeout(2500)

  const prep = await capturePrintHtml(page, 'إذن تحضير للمخزن')
  fs.writeFileSync(SHOT + 'prep.html', prep, 'utf8')
  console.log('PREP HAS NEW:', prep.includes(EXPECTED), '| HAS STALE:', prep.includes(STALE))
  expect(prep).toContain(EXPECTED)
  expect(prep).not.toContain(STALE)
  // structure intact: 38 rows + bonus section
  expect((prep.match(/<tr class="item-row">/g) || []).length).toBe(38)
  expect((prep.match(/<tr class="bonus-section-header">/g) || []).length).toBe(1)
})