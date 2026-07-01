import { test, expect, Page } from '@playwright/test'

const BASE = '/store'

async function login(page: Page) {
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('input[type="tel"]', { timeout: 15000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '123321')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 20000 })
}

test.describe('Phase D — Hierarchy Target Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    // Wait for splash screen to finish and auth to restore
    await page.goto(`${BASE}/targets/hierarchy`, { waitUntil: 'domcontentloaded' })
    // Wait for the splash screen overlay to disappear and the page to render
    await page.waitForTimeout(3000)
  })

  test('1. Company view shows hierarchy data', async ({ page }) => {
    await page.waitForSelector('h1:has-text("التسلسل الهرمي للأهداف")', { timeout: 20000 })
    const title = await page.textContent('h1:has-text("التسلسل الهرمي للأهداف")')
    expect(title).toContain('التسلسل الهرمي للأهداف')

    // Company overview should be visible
    const companySection = page.locator('text=الشركة')
    await expect(companySection).toBeVisible()

    // Managers table heading
    const managersHeading = page.locator('text=مديري البيع')
    await expect(managersHeading).toBeVisible()

    // Check manager count indicator
    const noMgrs = page.locator('text=لا يوجد مديري بيع')
    const mgrRows = page.locator('table tbody tr')
    const hasMgrs = await mgrRows.count()

    if (hasMgrs > 0) {
      const firstMgrRow = mgrRows.first()
      await expect(firstMgrRow).toBeVisible()
      await firstMgrRow.click()
    }
  })

  test('2. Manager team view', async ({ page }) => {
    await page.waitForSelector('h1:has-text("التسلسل الهرمي للأهداف")', { timeout: 20000 })

    const mgrRows = page.locator('table tbody tr')
    const count = await mgrRows.count()
    if (count === 0) {
      test.skip(true, 'No managers to test')
      return
    }

    await mgrRows.first().click()

    await expect(page.locator('text=فريق')).toBeVisible()
    await expect(page.locator('text=مؤشرات الأداء')).toBeVisible()

    const memberRows = page.locator('table tbody tr')
    const memberCount = await memberRows.count()
    expect(memberCount).toBeGreaterThan(0)

    for (let i = 0; i < memberCount; i++) {
      const row = memberRows.nth(i)
      const hasManagerIcon = await row.locator('text=✅').count()
      if (hasManagerIcon === 0) {
        await row.click()
        break
      }
    }
  })

  test('3. Individual KPI cards view', async ({ page }) => {
    await page.waitForSelector('h1:has-text("التسلسل الهرمي للأهداف")', { timeout: 20000 })

    const mgrRows = page.locator('table tbody tr')
    const mgrCount = await mgrRows.count()
    if (mgrCount === 0) {
      test.skip(true, 'No managers to drill into')
      return
    }

    await mgrRows.first().click()
    await expect(page.locator('text=مؤشرات الأداء')).toBeVisible()

    const memberRows = page.locator('table tbody tr')
    const memberCount = await memberRows.count()
    let clicked = false
    for (let i = 0; i < memberCount; i++) {
      const row = memberRows.nth(i)
      const hasManagerIcon = await row.locator('text=✅').count()
      if (hasManagerIcon === 0) {
        await row.click()
        clicked = true
        break
      }
    }

    if (clicked) {
      const kpiCards = ['المبيعات', 'الطلبات', 'الزيارات', 'عملاء جدد', 'التحصيل', 'الالتزام']
      for (const kpi of kpiCards) {
        await expect(page.locator(`text=${kpi}`).first()).toBeVisible()
      }
      await expect(page.locator('text=النتيجة الإجمالية')).toBeVisible()
      await expect(page.locator('text=الهدف:').first()).toBeVisible()
      await expect(page.locator('text=المنفذ:').first()).toBeVisible()
    }
  })

  test('4. Regression — old pages unaffected', async ({ page }) => {
    await page.goto(`${BASE}/dashboard/company-targets`)
    await page.waitForTimeout(3000)
    const hasError = await page.locator('text=ERROR').count()
    expect(hasError).toBe(0)
  })
})
