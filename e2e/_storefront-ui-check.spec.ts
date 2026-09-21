import { test, expect, Page } from '@playwright/test'

const BASE = '/store'
const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode/'

async function login(page: Page) {
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('input[type="tel"]', { timeout: 15000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '123321')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 20000 })
}

const barSel = 'button:has-text("إجمالي السلة")'

async function ensureCleanCart(page: Page) {
  await page.evaluate(() => localStorage.removeItem('ahram-cart'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
}

async function openProducts(page: Page) {
  await page.goto(`${BASE}/storefront/products`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="ابحث عن منتج..."]', { timeout: 25000 })
  await page.waitForTimeout(2000)
}

async function openHome(page: Page) {
  await page.goto(`${BASE}/storefront`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="ابحث في جميع المنتجات..."]', { timeout: 25000 })
  await page.waitForTimeout(2000)
}

async function addFirstProduct(page: Page) {
  const card = page.locator('button:has-text("شراء المنتج")').first()
  await card.scrollIntoViewIfNeeded()
  await page.locator('button:has-text("+")').first().click()
  await card.click()
}

test.describe('Cart summary bar — both screens + sticky', () => {
  test('Products + Home, scroll sticky, empty hide, no dup', async ({ page }) => {
    test.setTimeout(180000)
    await page.setViewportSize({ width: 375, height: 667 })
    await login(page)
    await ensureCleanCart(page)

    // ── PRODUCTS screen ──────────────────────────────────────────────
    await openProducts(page)
    await expect(page.locator(barSel)).toHaveCount(0) // empty => hidden, no empty area

    await addFirstProduct(page)
    const bar = page.locator(barSel).first()
    await expect(bar).toHaveCount(1)
    await page.waitForTimeout(800)

    const text = (await bar.textContent()) || ''
    expect(text).toContain('إجمالي السلة')
    expect(text).toContain('عدد المنتجات')
    expect(text).toContain('إجمالي الخصم')
    expect(text).not.toContain('إجمالي البونص')
    expect(text).not.toContain('ج.م')

    // Directly above search, no duplicate
    await expect(page.locator(barSel)).toHaveCount(1)

    // ── Scroll: bar pins under TopBar (top-14 = 56) ──────────────────
    await page.evaluate(() => window.scrollTo(0, 900))
    await page.waitForTimeout(600)
    const boxScrolled = await bar.boundingBox()
    expect(boxScrolled).not.toBeNull()
    expect(Math.abs(boxScrolled!.y - 56)).toBeLessThanOrEqual(3)
    await expect(bar).toBeVisible()
    await page.screenshot({ path: SHOT + 'cartbar-sticky-products-scrolled.png', fullPage: false })

    // Still no horizontal overflow while stuck
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    await page.evaluate(() => window.scrollTo(0, 2000))
    await page.waitForTimeout(600)
    await page.screenshot({ path: SHOT + 'cartbar-sticky-products-deep.png', fullPage: false })
    const boxDeep = await bar.boundingBox()
    expect(Math.abs(boxDeep!.y - 56)).toBeLessThanOrEqual(3)

    // Bottom nav still present
    await expect(page.locator('nav >> text=الرئيسية').first()).toBeVisible()

    // Back to top
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(600)

    // ── HOME screen: same bar above Global Search ────────────────────
    await openHome(page)
    const barH = page.locator(barSel).first()
    await expect(barH).toHaveCount(1)
    await expect(page.locator(barSel)).toHaveCount(1) // no dup
    const searchH = page.locator('input[placeholder="ابحث في جميع المنتجات..."]')
    const barHBox = await barH.boundingBox()
    const searchHBox = await searchH.boundingBox()
    expect(barHBox).not.toBeNull()
    expect(searchHBox).not.toBeNull()
    expect(barHBox!.bottom).toBeLessThanOrEqual(searchHBox!.top + 1)
    await page.screenshot({ path: SHOT + 'cartbar-home-with-bar.png', fullPage: false })

    // Scroll on home: bar pins under TopBar
    await page.evaluate(() => window.scrollTo(0, 700))
    await page.waitForTimeout(600)
    const boxH = await barH.boundingBox()
    expect(Math.abs(boxH!.y - 56)).toBeLessThanOrEqual(3)
    await expect(barH).toBeVisible()
    await page.screenshot({ path: SHOT + 'cartbar-home-scrolled.png', fullPage: false })

    // Click bar on home → opens cart
    await barH.click()
    await page.waitForURL(/\/cart/, { timeout: 15000 })

    // ── Empty cart: bar gone, layout returns to normal ───────────────
    await page.evaluate(() => localStorage.removeItem('ahram-cart'))
    await openProducts(page)
    await expect(page.locator(barSel)).toHaveCount(0)
    await openHome(page)
    await expect(page.locator(barSel)).toHaveCount(0)
    await page.screenshot({ path: SHOT + 'cartbar-both-hidden-empty.png', fullPage: true })
  })
})