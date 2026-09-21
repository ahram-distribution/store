import { test, expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

// SCRATCH cold-load flash validation (never commit).
// Proves the persisted theme is applied BEFORE React runs (bundle blocked),
// then that the first visible render already carries the theme (bundle live).

const SHOT = 'C:/Users/joker/AppData/Local/Temp/opencode'
const BASE = 'http://localhost:5173/store/'
const THEME_BTN = 'button[title="الثيمات"]'
const THEME_SHEET = 'text=اختر الثيم'
const SPLASH_TEXT = 'جاري تهيئة النظام'

function json(route: Route, payload: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
}

async function installStubs(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('session_token', 'theme.synthetic.id') } catch { /* noop */ }
  })
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() || ''
    if (fn === 'validate_session') {
      return json(route, { valid: true, identity_id: 'i-1', identity_type: 'employee', employee_id: 'e-1', full_name: 'Rep', code: 'T-1', roles: [] })
    }
    return json(route, [])
  })
  await page.route('**/rest/v1/companies*', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('id')?.startsWith('eq.')) return json(route, { id: 'company-A', company_name: 'c', legacy_code: 'T', logo_url: null })
    return json(route, [{ id: 'company-A', company_name: 'c', legacy_code: 'T', logo_url: null }])
  })
}

async function noCache(page: Page) {
  // Force network (bypass memory cache) so route aborts below actually fire.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
}

async function preReactTheme(page: Page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      dataTheme: document.documentElement.dataset.theme || null,
      primary: cs.getPropertyValue('--color-primary').trim(),
      navy: cs.getPropertyValue('--theme-navy').trim(),
      accent: cs.getPropertyValue('--theme-accent').trim(),
      reactMounted: !!document.getElementById('app')?.firstElementChild,
    }
  })
}

async function firstFrameSplashBg(page: Page) {
  // Polls until the splash exists and returns its backdrop color from that
  // very first frame (innermost text match -> closest fixed backdrop).
  return page.waitForFunction((needle: string) => {
    const all = Array.from(document.querySelectorAll('div'));
    for (let i = all.length - 1; i >= 0; i--) {
      const d = all[i];
      if ((d.textContent || '').includes(needle)) {
        const box = d.closest('div.fixed') as HTMLElement | null;
        if (box) return getComputedStyle(box).backgroundColor;
      }
    }
    return null;
  }, SPLASH_TEXT, { timeout: 60000 });
}

test('cold load VIP has zero flash', async ({ page }) => {
  await installStubs(page)
  // Real path: open app, switch to VIP through the UI (writes both keys via ThemeContext).
  await page.goto(`${BASE}#/storefront`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(THEME_BTN, { timeout: 60000 })
  await page.locator(THEME_BTN).click()
  await page.waitForSelector(THEME_SHEET, { timeout: 15000 })
  await page.locator('text=VIP').first().click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'vip', null, { timeout: 15000 })

  // Cold load with the app bundle BLOCKED: React can never run.
  await page.route('**/src/**', (route) => route.abort())
  await page.route('**/@vite/**', (route) => route.abort())
  await page.route('**/node_modules/**', (route) => route.abort())
  await noCache(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const pre = await preReactTheme(page)
  console.log('VIP pre-react: ' + JSON.stringify(pre))
  expect(pre.reactMounted).toBe(false)
  expect(pre.dataTheme).toBe('vip')
  expect(pre.primary).toBe('#1a1a1a')
  expect(pre.navy).toBe('#1a1a1a')
  expect(pre.accent).toBe('#D4AF37')

  // Full cold load: first visible render must already be VIP.
  await page.unrouteAll({ behavior: 'wait' })
  await installStubs(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const bgHandle = await firstFrameSplashBg(page)
  const bg = await bgHandle.jsonValue()
  console.log('VIP first-frame splash bg: ' + bg)
  expect(bg).toBe('rgb(0, 0, 0)')
  await page.screenshot({ path: `${SHOT}/theme-cold-vip-firstframe.png` })
})

test('cold load Gold stays correct', async ({ page }) => {
  await installStubs(page)
  await page.goto(`${BASE}#/storefront`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(THEME_BTN, { timeout: 60000 })
  await page.locator(THEME_BTN).click()
  await page.waitForSelector(THEME_SHEET, { timeout: 15000 })
  await page.locator('text=Gold Classic').first().click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'gold', null, { timeout: 15000 })

  await page.route('**/src/**', (route) => route.abort())
  await page.route('**/@vite/**', (route) => route.abort())
  await page.route('**/node_modules/**', (route) => route.abort())
  await noCache(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const pre = await preReactTheme(page)
  console.log('GOLD pre-react: ' + JSON.stringify(pre))
  expect(pre.reactMounted).toBe(false)
  expect(pre.dataTheme).toBe('gold')
  expect(pre.primary).toBe('#0052cc')
  expect(pre.navy).toBe('#0B3D91')

  await page.unrouteAll({ behavior: 'wait' })
  await installStubs(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const bgHandle = await firstFrameSplashBg(page)
  const bg = await bgHandle.jsonValue()
  console.log('GOLD first-frame splash bg: ' + bg)
  expect(bg).toBe('rgb(7, 27, 77)')
  await page.screenshot({ path: `${SHOT}/theme-cold-gold-firstframe.png` })
})
