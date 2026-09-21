import { test, expect } from '@playwright/test'

// SCRATCH: login-screen theme check without session (never commit).
test('login theme gold vs vip', async ({ page }) => {
  const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'
  await page.goto('http://localhost:5173/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.documentElement.dataset.theme, null, { timeout: 60000 })
  await page.waitForTimeout(2000)
  const gold = await page.evaluate(() => ({
    dt: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
  }))
  console.log('LOGIN gold: ' + JSON.stringify(gold))
  expect(gold.dt).toBe('gold')
  await page.screenshot({ path: `${SHOT}/theme-gold-login.png` })
  await page.evaluate(() => { try { localStorage.setItem('ahram_theme', 'vip') } catch {} })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'vip', null, { timeout: 60000 })
  await page.waitForTimeout(2000)
  const vip = await page.evaluate(() => ({
    dt: document.documentElement.dataset.theme,
    navy: getComputedStyle(document.documentElement).getPropertyValue('--theme-navy').trim(),
  }))
  console.log('LOGIN vip: ' + JSON.stringify(vip))
  expect(vip.dt).toBe('vip')
  await page.screenshot({ path: `${SHOT}/theme-vip-login2.png` })
})
