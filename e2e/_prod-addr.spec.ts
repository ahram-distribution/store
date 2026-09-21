import { test, expect } from '@playwright/test'

const PROD = 'https://ahram-distribution.github.io/store'
const ORDER = `${PROD}/#/orders/900179da-8627-4654-82ca-f840fb3b4829`
const EXPECTED = 'البحر الأحمر - الغردقة - طريق النصر'
const STALE = 'الكوثر, الكوثر'

async function login(page: any) {
  await page.goto(`${PROD}/#/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 30000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 40000 })
}

async function capturePrintHtml(page: any, btnName: string): Promise<string> {
  await page.evaluate(() => {
    ;(window as any).__PRINT_HTML__ = null
    const iv = setInterval(() => {
      const fs = document.querySelectorAll('iframe')
      const f = fs[fs.length - 1]
      if (f && (f as any).contentDocument && (f as any).contentDocument.body && (f as any).contentDocument.body.innerHTML) {
        ;(window as any).__PRINT_HTML__ = (f as any).contentDocument.documentElement.outerHTML
        clearInterval(iv)
      }
    }, 30)
    setTimeout(() => clearInterval(iv), 20000)
  })
  await page.getByRole('button', { name: btnName, exact: true }).click()
  await page.waitForFunction(() => (window as any).__PRINT_HTML__, { timeout: 20000 })
  return page.evaluate(() => (window as any).__PRINT_HTML__)
}

test('PROD: order screen + both PDFs use current full address', async ({ page }) => {
  test.setTimeout(240000)
  await login(page)
  await page.goto(ORDER, { waitUntil: 'domcontentloaded' })
  await page.getByText('إجمالي المنتجات الأساسية', { exact: true }).first().waitFor({ timeout: 40000 })
  await page.waitForTimeout(3500)

  const bodyText: string = await page.locator('body').innerText()
  const addrLine = bodyText.split('\n').find((l) => l.includes('العنوان:')) || ''
  console.log('PROD SCREEN ADDR LINE:', addrLine)
  expect(bodyText).toContain(EXPECTED)
  expect(bodyText).not.toContain('الكوثر')

  const permit = await capturePrintHtml(page, 'PDF')
  console.log('PROD PERMIT HAS NEW:', permit.includes(EXPECTED), '| HAS STALE:', permit.includes(STALE))
  expect(permit).toContain(EXPECTED)
  expect(permit).not.toContain(STALE)
  expect(permit).toContain('إجمالي المنتجات الأساسية')

  // Wait for the delivery-permit iframe to be removed (printInvoice removes it after 500ms)
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0, { timeout: 5000 })
  await page.waitForTimeout(300)

  const prep = await capturePrintHtml(page, 'إذن تحضير للمخزن')
  console.log('PROD PREP HAS NEW:', prep.includes(EXPECTED), '| HAS STALE:', prep.includes(STALE))
  expect(prep).toContain(EXPECTED)
  expect(prep).not.toContain(STALE)
  expect((prep.match(/<tr class="item-row">/g) || []).length).toBe(38)
  expect((prep.match(/<tr class="bonus-section-header">/g) || []).length).toBe(1)
})