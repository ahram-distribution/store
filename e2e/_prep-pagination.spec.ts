import { test, expect } from '@playwright/test'

// Legacy (pre-fix) pagination logic, reconstructed for sensitivity proof:
// section bar pinned only to its immediate next block -> section can split.
const LEGACY_PAGINATE = `
(function () {
  var MM = 25.4 / 96;
  function mm(px) { return px * MM; }
  var sheet = document.querySelector('.sheet');
  if (!sheet || sheet.getAttribute('data-paginated')) return;
  var USABLE = (210 - 7 - 6 - 6) - 0.5;
  var head = sheet.querySelector('.head');
  var info = sheet.querySelector('.info');
  var summary = sheet.querySelector('.summary');
  var sigs = sheet.querySelector('.signatures');
  var tbody = sheet.querySelector('.items tbody');
  var thead = sheet.querySelector('.items thead');
  if (!head || !info || !summary || !sigs || !tbody || !thead) return;
  var blocks = [head, info];
  var rows = Array.prototype.slice.call(tbody.children);
  for (var i = 0; i < rows.length; i++) blocks.push(rows[i]);
  blocks.push(summary, sigs);
  var rects = blocks.map(function (el) { return el.getBoundingClientRect(); });
  var sizes = [];
  for (var j = 0; j < blocks.length; j++) {
    if (j < blocks.length - 1) sizes.push(mm(rects[j + 1].top - rects[j].top));
    else sizes.push(mm(rects[j].height));
  }
  var required = sizes.slice();
  for (var g = 0; g < blocks.length - 1; g++) {
    if (blocks[g].tagName === 'TR' && /(group-header|bonus-section-header)/.test(blocks[g].className)) {
      required[g] = sizes[g] + sizes[g + 1];
    }
  }
  var pages = [], cur = [], curH = 0;
  for (var p = 0; p < blocks.length; p++) {
    if (cur.length > 0 && curH + required[p] > USABLE) { pages.push(cur); cur = []; curH = 0; }
    cur.push(p); curH += sizes[p];
  }
  if (cur.length) pages.push(cur);
  var wrap = document.createElement('div');
  wrap.className = 'prep-pages';
  for (var pg = 0; pg < pages.length; pg++) {
    var page = document.createElement('div');
    page.className = 'page';
    var body = document.createElement('div');
    body.className = 'page-body';
    var tbl = null;
    for (var k = 0; k < pages[pg].length; k++) {
      var bi = pages[pg][k];
      var blk = blocks[bi];
      if (blk.tagName === 'TR') {
        if (!tbl) {
          tbl = document.createElement('table');
          tbl.className = 'items';
          tbl.appendChild(thead.cloneNode(true));
          var tb = document.createElement('tbody');
          tbl.appendChild(tb);
          body.appendChild(tbl);
        }
        tbl.lastChild.appendChild(blk);
      } else { tbl = null; body.appendChild(blk); }
    }
    page.appendChild(body);
    wrap.appendChild(page);
  }
  sheet.setAttribute('data-paginated', '1');
  sheet.parentNode.replaceChild(wrap, sheet);
})();
`

function syntheticSheet(): string {
  const mm = (n: number) => `height:${n}mm;margin:0;padding:0;border:0;`
  let main = ''
  for (let i = 0; i < 14; i++) main += `<tr class="item-row"><td style="${mm(10)}">m${i}</td></tr>`
  return `<div class="sheet" style="width:148mm;margin:0;padding:0;">
    <div class="head" style="${mm(12)}"><div class="page-count"></div></div>
    <div class="info" style="${mm(10)}"></div>
    <table class="items" style="margin:0;padding:0;border:0;border-collapse:collapse;"><thead><tr><th>H</th></tr></thead><tbody>
      ${main}
      <tr class="bonus-section-header"><td style="${mm(8)}">BONUS</td></tr>
      <tr class="group-header"><td style="${mm(8)}">G</td></tr>
      <tr class="item-row"><td style="${mm(8)}">b1</td></tr>
      <tr class="item-row"><td style="${mm(8)}">b2</td></tr>
      <tr class="item-row"><td style="${mm(8)}">b3</td></tr>
    </tbody></table>
    <div class="summary" style="${mm(12)}"></div>
    <div class="signatures" style="${mm(20)}"></div>
  </div>`
}

async function login(page: any) {
  await page.goto('/store/#/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="tel"]', { timeout: 20000 })
  await page.fill('input[type="tel"]', '01066197010')
  await page.fill('input[type="password"]', '262006')
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 30000 })
}

test.describe.configure({ mode: 'serial' })

test('pagination keeps bonus section atomic (shipped script, synthetic split scenario)', async ({ page }) => {
  test.setTimeout(180000)
  await login(page)

  // 1. capture the SHIPPED pagination script from real prep output
  await page.goto('/store/#/orders/900179da-8627-4654-82ca-f840fb3b4829', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'إذن تحضير للمخزن', exact: true }).waitFor({ timeout: 40000 })
  await page.waitForTimeout(1500)
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
  const prepHtml: string = await page.evaluate(() => (window as any).__PRINT_HTML__)
  const scriptMatch = prepHtml.match(/<script>([\s\S]*?)<\/script>/)
  expect(scriptMatch, 'inline pagination script present in shipped output').toBeTruthy()
  const shippedScript = scriptMatch![1]
  expect(shippedScript).toContain('bonus-section-header')
  console.log('SHIPPED SCRIPT LEN:', shippedScript.length)

  // 2. legacy logic splits the section (sensitivity proof)
  await page.setContent(`<html><body>${syntheticSheet()}</body></html>`)
  await page.waitForTimeout(300)
  await page.evaluate(LEGACY_PAGINATE)
  const legacyPages = await page.locator('.prep-pages .page').count()
  const legacyP1 = await page.locator('.prep-pages .page').first().innerText()
  const legacyP2 = await page.locator('.prep-pages .page').nth(1).innerText()
  console.log('LEGACY pages:', legacyPages, '| p1 has BONUS:', legacyP1.includes('BONUS'), '| p1 bonus rows:', ['b1', 'b2', 'b3'].filter((b) => legacyP1.includes(b)).join(','), '| p2 bonus rows:', ['b1', 'b2', 'b3'].filter((b) => legacyP2.includes(b)).join(','))
  expect(legacyP1.includes('BONUS')).toBe(true)
  expect(['b1', 'b2', 'b3'].filter((b) => legacyP2.includes(b)).length).toBeGreaterThan(0)

  // 3. shipped logic keeps the whole section on one page
  await page.setContent(`<html><body>${syntheticSheet()}</body></html>`)
  await page.waitForTimeout(300)
  await page.evaluate(shippedScript)
  const pages = await page.locator('.prep-pages .page').count()
  console.log('SHIPPED pages:', pages)
  expect(pages).toBe(2)
  const p1 = await page.locator('.prep-pages .page').first().innerText()
  const p2 = await page.locator('.prep-pages .page').nth(1).innerText()
  expect(p1.includes('BONUS')).toBe(false)
  expect(p1.includes('b1')).toBe(false)
  expect(p2.includes('BONUS')).toBe(true)
  for (const b of ['b1', 'b2', 'b3']) expect(p2.includes(b)).toBe(true)
  // no row lost anywhere
  const allRows = await page.locator('.prep-pages .item-row').count()
  expect(allRows).toBe(17)
})