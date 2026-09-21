import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'

const OUT = 'C:/Users/joker/AppData/Local/Temp/opencode/repro377/'
fs.mkdirSync(OUT, { recursive: true })

const ORDER_ID = '11b48d3f-8036-4b1f-ad6c-57b53559a25f'
const TIER_50K = '35f28dfa-7924-47f8-ac75-55013d148361'
const PAY_PREPAID = 'bede2f32-c2fb-4409-9600-be0209bf8725'

const TRACKED_RPCS = /\/rest\/v1\/rpc\/(governed_replace_order_contents|governed_submit_order|get_unified_order)$/

async function login(page: Page) {
  await page.goto('/store/login')
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01004466887')
  await page.fill('input[type="password"]', '123321')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 25000 })
}

test('reproduce ORD-2026-000377 edit resubmit failure', async ({ page }) => {
  test.setTimeout(300000)
  await page.setViewportSize({ width: 390, height: 844 })

  const events: any[] = []
  const consoleErrors: string[] = []
  let cartBeforeReview: any = null

  // Capture EVERY rpc call so we see which operation fails first
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const req = route.request()
    let payload: any = null
    try { payload = req.postDataJSON() } catch { payload = { raw: req.postData() } }
    const response = await route.fetch()
    const bodyText = await response.text()
    let body: any = bodyText
    try { body = JSON.parse(bodyText) } catch { /* keep raw */ }
    const url = req.url()
    const m = url.match(/governed_replace_order_contents|governed_submit_order|get_unified_order/)
    const rpcName = m ? m[0] : (url.split('/rpc/')[1] || url)
    events.push({
      rpc: rpcName,
      t: Date.now(),
      status: response.status(),
      payload: TRACKED_RPCS.test(url) ? payload : undefined,
      bodyPreview: typeof body === 'object' ? JSON.stringify(body).slice(0, 2000) : body.slice(0, 2000),
    })
    console.log(`=== ${rpcName} → ${response.status()} ===`)
    if (TRACKED_RPCS.test(url)) {
      console.log('PAYLOAD:', JSON.stringify(payload))
      console.log('BODY:', JSON.stringify(body).slice(0, 2000))
    }
    await route.fulfill({ response })
  })

  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))

  await login(page)

  // Open the returned order
  await page.goto(`/store/#/orders/${ORDER_ID}`, { waitUntil: 'domcontentloaded' })
  const editBtn = page.getByRole('button', { name: 'تعديل الطلب' })
  await editBtn.waitFor({ timeout: 30000 })
  await page.screenshot({ path: OUT + '01-order-detail.png', fullPage: false })
  await editBtn.click()

  // Restore → cart
  await page.waitForURL(/\/cart/, { timeout: 20000 })
  await page.waitForTimeout(1200)

  // Snapshot the restored cart BEFORE review
  cartBeforeReview = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('ahram-cart')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })
  if (cartBeforeReview) {
    fs.writeFileSync(OUT + 'cart-locals-storage.json', JSON.stringify({ items: cartBeforeReview.items, bonusItems: cartBeforeReview.bonusItems, selectedTierId: cartBeforeReview.selectedTierId, selectedPaymentMethodId: cartBeforeReview.selectedPaymentMethodId, bonusMode: cartBeforeReview.bonusMode, editingOrderId: cartBeforeReview.editingOrderId, orderType: cartBeforeReview.orderType }, null, 2))
  }
  await page.screenshot({ path: OUT + '02-cart-restored.png', fullPage: false })

  // Select tier شريحة 50 ألف
  const tierLabel = page.locator('label', { hasText: 'شريحتك' }).first()
  await tierLabel.waitFor({ timeout: 15000 })
  const tierSelect = tierLabel.locator('select')
  const tierText = await tierSelect.locator('option', { hasText: /50\s*ألف/ }).first().textContent()
  await tierSelect.selectOption({ value: TIER_50K }).catch(async () => {
    const opt = tierSelect.locator('option', { hasText: /50\s*ألف/ }).first()
    await opt.evaluate((el: any) => { el.selected = true; el.dispatchEvent(new Event('change', { bubbles: true })) })
  })
  console.log('selected tier option:', tierText?.trim())
  await page.waitForTimeout(900)

  // Select payment دفع مسبق
  const payLabel = page.locator('label', { hasText: 'طريقة الدفع' }).first()
  await payLabel.waitFor({ timeout: 15000 })
  const paySelect = payLabel.locator('select')
  const payText = await paySelect.locator('option', { hasText: /دفع مسبق/ }).first().textContent()
  await paySelect.selectOption({ value: PAY_PREPAID }).catch(async () => {
    const opt = paySelect.locator('option', { hasText: /دفع مسبق/ }).first()
    await opt.evaluate((el: any) => { el.selected = true; el.dispatchEvent(new Event('change', { bubbles: true })) })
  })
  console.log('selected payment option:', payText?.trim())
  await page.waitForTimeout(1200)

  // Gate box: تحقيق الشريحة + الشراء بكامل رصيد البونص
  const gateText = await page.locator('text=تحقيق الشريحة').first().textContent().catch(() => null)
  const bonusText = await page.locator('text=الشراء بكامل رصيد البونص').first().textContent().catch(() => null)
  console.log('GATES:', JSON.stringify({ تحقيقالشريحة: gateText, الشراءبكامل: bonusText }))

  const continueBtn = page.getByRole('button', { name: 'متابعة الطلب' }).first()
  const ariaDisabled = await continueBtn.getAttribute('aria-disabled')
  const disabledClass = await continueBtn.getAttribute('class')
  console.log('continue button aria-disabled:', ariaDisabled, '| class:', disabledClass)
  await page.screenshot({ path: OUT + '03-cart-gates.png', fullPage: false })

  if (ariaDisabled === 'true' || /opacity-40/.test(disabledClass || '')) {
    fs.writeFileSync(OUT + 'STOPPED-gates-not-met.json', JSON.stringify({ gates: { تحقيقالشريحة: gateText, الشراءبكامل: bonusText } }, null, 2))
    // Do not attempt the review — capture and stop
  } else {
    await continueBtn.click()
    await page.waitForURL(/\/order-review/, { timeout: 20000 })
    await page.waitForTimeout(1500)

    const submitBtn = page.getByRole('button', { name: 'تأكيد وإرسال الطلب' }).first()
    const submitDisabled = await submitBtn.getAttribute('disabled')
    console.log('submit disabled:', submitDisabled)
    await page.screenshot({ path: OUT + '04-order-review.png', fullPage: false })

    if (submitDisabled === null) {
      await submitBtn.click()
      console.log('clicked تأكيد وإرسال الطلب — waiting for outcome...')
      // Wait for EITHER a success toast or an error toast
      try {
        await page.getByText('تم تحديث الطلب وإرساله بنجاح').waitFor({ timeout: 30000 })
      } catch {
        /* fall through — capture toast nodes */
      }
      await page.waitForTimeout(1500)
      await page.screenshot({ path: OUT + '05-after-submit.png', fullPage: false })
    }
  }

  // Final toast capture
  const toasts = await page.locator('div[role="status"], text=تعذر تحديث الطلب الآن, text=تم تحديث الطلب وإرساله بنجاح, text=تعذر إرسال الطلب الآن')
    .allTextContents().catch(() => [])
  console.log('TOASTS:', JSON.stringify(toasts))

  const finalUrl = page.url()
  const userAfter = await page.evaluate(() => {
    try { return localStorage.getItem('session_token') } catch { return null }
  })

  const report = {
    finalUrl,
    session: userAfter ? 'present' : 'MISSING',
    gates: { تحقيقالشريحة: gateText, الشراءبكامل: bonusText },
    ariaDisabled,
    events,
    consoleErrors,
    cartBeforeReview: cartBeforeReview
      ? { items: cartBeforeReview.items?.length, bonusItems: cartBeforeReview.bonusItems?.length, bonusMode: cartBeforeReview.bonusMode, tierId: cartBeforeReview.selectedTierId, payId: cartBeforeReview.selectedPaymentMethodId, editingOrderId: cartBeforeReview.editingOrderId }
      : null,
  }
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 2))
  console.log('REPORT SAVED:', OUT + 'report.json')
  console.log('EVENTS:', JSON.stringify(events.map((e) => ({ rpc: e.rpc, status: e.status })), null, 1))
})