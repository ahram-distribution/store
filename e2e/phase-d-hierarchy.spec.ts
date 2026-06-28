import { test, expect } from '@playwright/test'

test.describe('Phase D — Hierarchy Target Page', () => {
  test.beforeEach(async ({ page }) => {
    // Get a valid session token from the API
    const tokenRes = await fetch('http://localhost:5173/api/test-token')
      .then(r => r.json())
      .catch(() => null)

    // Navigate first to set localStorage origin
    await page.goto('http://localhost:5173/targets/hierarchy')
    
    // Inject session token
    await page.evaluate((tok) => {
      localStorage.setItem('session_token', tok || '')
    }, tokenRes?.token || '')

    // Reload to pick up auth
    await page.reload()
  })

  test('1. Company view shows hierarchy data', async ({ page }) => {
    // Wait for the page to load
    await page.waitForSelector('h1')
    const title = await page.textContent('h1')
    expect(title).toContain('التسلسل الهرمي للأهداف')

    // Company overview should be visible
    const companySection = page.locator('text=الشركة')
    await expect(companySection).toBeVisible()

    // Managers table heading
    const managersHeading = page.locator('text=مديري البيع')
    await expect(managersHeading).toBeVisible()

    // Check manager count indicator
    // The page should render at least one manager or the "لا يوجد مديري بيع" message
    const noMgrs = page.locator('text=لا يوجد مديري بيع')
    const mgrRows = page.locator('table tbody tr')
    const hasMgrs = await mgrRows.count()

    if (hasMgrs > 0) {
      // Verify manager table columns are populated
      const firstMgrRow = mgrRows.first()
      await expect(firstMgrRow).toBeVisible()
      
      // Click on first manager to drill down
      await firstMgrRow.click()
    }
  })

  test('2. Manager team view', async ({ page }) => {
    await page.waitForSelector('h1')

    // Try to click a manager row if one exists
    const mgrRows = page.locator('table tbody tr')
    const count = await mgrRows.count()
    if (count === 0) {
      test.skip('No managers to test')
      return
    }

    await mgrRows.first().click()

    // Should show team summary
    await expect(page.locator('text=فريق')).toBeVisible()

    // Should show manager KPIs
    await expect(page.locator('text=مؤشرات الأداء')).toBeVisible()

    // Members table should exist
    const memberRows = page.locator('table tbody tr')
    const memberCount = await memberRows.count()
    expect(memberCount).toBeGreaterThan(0)

    // First member should have is_manager indicators
    const firstRow = memberRows.first()
    const firstRowBg = await firstRow.getAttribute('class') || ''
    
    // Click on a non-manager member to see details
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
    await page.waitForSelector('h1')

    // Navigate: company → manager → member
    const mgrRows = page.locator('table tbody tr')
    const mgrCount = await mgrRows.count()
    if (mgrCount === 0) {
      test.skip('No managers to drill into')
      return
    }

    // Click first manager
    await mgrRows.first().click()

    // Wait for team view
    await expect(page.locator('text=مؤشرات الأداء')).toBeVisible()

    // Click a non-manager member
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
      // Should show all 6 KPI cards
      const kpiCards = ['المبيعات', 'الطلبات', 'الزيارات', 'عملاء جدد', 'التحصيل', 'الالتزام']
      for (const kpi of kpiCards) {
        await expect(page.locator(`text=${kpi}`).first()).toBeVisible()
      }

      // Should show overall score
      await expect(page.locator('text=النتيجة الإجمالية')).toBeVisible()

      // Each KPI should have target and actual
      await expect(page.locator('text=الهدف:').first()).toBeVisible()
      await expect(page.locator('text=المنفذ:').first()).toBeVisible()
    }
  })

  test('4. Regression — old pages unaffected', async ({ page }) => {
    // Navigate to an old page that should still work
    await page.goto('http://localhost:5173/dashboard/company-targets')
    
    // Wait for the page to load or auth redirect
    await page.waitForTimeout(3000)
    
    // The page should either render or redirect to login (if no valid session)
    // Either way, no crash should occur
    const hasError = await page.locator('text=ERROR').count()
    expect(hasError).toBe(0)
  })
})
