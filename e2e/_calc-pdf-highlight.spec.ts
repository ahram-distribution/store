import { test, expect } from '@playwright/test'

test('pdf calc highlight row', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })

  await page.goto('/store/#/orders/900179da-8627-4654-82ca-f840fb3b4829', { waitUntil: 'domcontentloaded' })
  await page.getByText('إجمالي المنتجات الأساسية', { exact: true }).first().waitFor({ timeout: 30000 })

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
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  await page.waitForFunction(() => (window as any).__PRINT_HTML__, { timeout: 15000 })
  const html: string = await page.evaluate(() => (window as any).__PRINT_HTML__)
  console.log('PDF HTML LEN:', html.length)
  expect(html).toContain('calc-highlight')
  expect(html).toContain('calc-label-highlight')
  expect(html).toContain('calc-value-highlight')
  expect(html).toContain('إجمالي المنتجات الأساسية')
  for (const cls of ['calc-label-amber', 'calc-value-amber', 'calc-label-purple', 'calc-value-purple', 'calc-label-teal', 'calc-label-red', 'calc-value-red']) {
    expect(html).toContain(cls)
  }
  // calc section must not contain ج.م
  const calcStart = html.indexOf('حساب قيمة الطلب النهائية')
  const calcHtml = html.slice(calcStart, calcStart + 4000)
  console.log('PDF CALC HAS ج.م:', calcHtml.includes('ج.م'))
  expect(calcHtml).not.toContain('ج.م')
  // highlighted rows: main base + final
  const frames = (html.match(/<tr class="calc-row calc-highlight">/g) || []).length
  console.log('PDF FRAMED ROWS:', frames)
  expect(frames).toBe(2)
})