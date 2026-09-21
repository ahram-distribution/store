import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode/prep-bonus/'

async function login(page: any) {
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })
}

async function capturePrepHtml(page: any): Promise<string> {
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
  await page.getByRole('button', { name: 'إذن تحضير للمخزن', exact: true }).click()
  await page.waitForFunction(() => (window as any).__PRINT_HTML__, { timeout: 15000 })
  return page.evaluate(() => (window as any).__PRINT_HTML__)
}

test.describe.configure({ mode: 'serial' })

test('prep permit: bonus order shows all items with بونص mark', async ({ page }) => {
  test.setTimeout(120000)
  fs.mkdirSync(SHOT, { recursive: true })
  await login(page)
  await page.goto('/store/#/orders/11b48d3f-8036-4b1f-ad6c-57b53559a25f', { waitUntil: 'domcontentloaded' })
  await page.getByText('منتجات البونص', { exact: false }).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)

  const html = await capturePrepHtml(page)
  fs.writeFileSync(SHOT + 'prep-bonus.html', html, 'utf8')

  // all 45 items present, exactly once
  const rows = (html.match(/<tr class="item-row">/g) || []).length
  console.log('BONUS ORDER ROWS:', rows)
  expect(rows).toBe(45)
  // bonus section exists exactly once
  const sections = (html.match(/<tr class="bonus-section-header">/g) || []).length
  console.log('BONUS SECTIONS:', sections)
  expect(sections).toBe(1)
  expect(html).toContain('منتجات البونص')
  // split document into main part / bonus part (match the row markup, not the CSS rule)
  const secIdx = html.indexOf('<tr class="bonus-section-header">')
  const mainPart = html.slice(0, secIdx)
  const bonusPart = html.slice(secIdx)
  // main tables contain no bonus marks and no bonus rows
  expect(mainPart).not.toContain('<span class="bonus-tag">')
  // same product as MAIN (before section) and BONUS (inside section)
  expect(mainPart).toContain('1684')
  expect(bonusPart).toContain('1684')
  expect(bonusPart).toContain('حبة البركة')
  // exactly one بونص mark, inside the bonus section on the bonus company row
  const marks = (html.match(/<span class="bonus-tag">بونص<\/span>/g) || []).length
  console.log('BONUS MARKS:', marks)
  expect(marks).toBe(1)
  expect(bonusPart).toContain('<span class="bonus-tag">بونص</span>')
  // bonus company grouping present
  expect(bonusPart).toContain('group-header')
})

test('prep permit: no-bonus order renders unchanged', async ({ page }) => {
  test.setTimeout(120000)
  await login(page)
  await page.goto('/store/#/orders/7894fa8f-1cec-4bf6-8265-c637e18f5521', { waitUntil: 'domcontentloaded' })
  await page.getByText('إذن تحضير للمخزن', { exact: true }).waitFor({ timeout: 30000 })
  await page.waitForTimeout(1500)

  const html = await capturePrepHtml(page)
  fs.writeFileSync(SHOT + 'prep-nobonus.html', html, 'utf8')

  const rows = (html.match(/<tr class="item-row">/g) || []).length
  console.log('NOBONUS ORDER ROWS:', rows)
  expect(rows).toBe(7)
  expect(html).not.toContain('<tr class="bonus-section-header">')
  expect(html).not.toContain('منتجات البونص')
  expect(html).not.toContain('<span class="bonus-tag">')
  expect(html).not.toContain('>بونص<')
})