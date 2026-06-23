import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173/store';
const PASSWORD = '123321';

async function login(page, phone) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('input[type="tel"]', { timeout: 15000 });
  await page.fill('input[type="tel"]', phone);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // 1. الإدارة العليا — Target Runtime page
  {
    const page = await ctx.newPage();
    await login(page, '01009025501');
    console.log('Admin logged in');
    await page.goto(`${BASE}/target-runtime`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/admin_target_runtime.png', fullPage: true });
    console.log('✓ Admin Target Runtime screenshot saved');
    
    // Check content
    const text = await page.textContent('body');
    if (text.includes('التارجت')) console.log('✓ Page title التارجت found');
    if (text.includes('Company Summary') || text.includes('إجمالي')) console.log('✓ Company summary found');
    if (text.includes('الأفضل') || text.includes('Top')) console.log('✓ Top 5 area found');
    if (text.includes('الأضعف') || text.includes('Worst')) console.log('✓ Worst 5 area found');
    await page.close();
  }

  // 2. مدير البيع (خالد سعيد) — Target Runtime page
  {
    const page = await ctx.newPage();
    await login(page, '01002082831');
    console.log('\nKhaled Saeed logged in');
    await page.goto(`${BASE}/target-runtime`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/khaled_target_runtime.png', fullPage: true });
    console.log('✓ Khaled Target Runtime screenshot saved');
    
    const text = await page.textContent('body');
    if (text.includes('التارجت')) console.log('✓ Page title التارجت found');
    if (!text.includes('لا يوجد فريق تابع حالياً')) {
      console.log('✓ Team members found (not empty)');
    } else {
      console.log('⚠ Still showing empty state');
    }
    await page.close();
  }

  // 3. مدير البيع (هادى سعيد) — Target Runtime page
  {
    const page = await ctx.newPage();
    await login(page, '01557340306');
    console.log('\nHadi Saeed logged in');
    await page.goto(`${BASE}/target-runtime`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/hadi_target_runtime.png', fullPage: true });
    console.log('✓ Hadi Target Runtime screenshot saved');
    
    const text = await page.textContent('body');
    if (text.includes('التارجت')) console.log('✓ Page title التارجت found');
    if (!text.includes('لا يوجد فريق تابع حالياً')) {
      console.log('✓ Team members found (not empty)');
    } else {
      console.log('⚠ Still showing empty state');
    }
    await page.close();
  }

  await browser.close();
  console.log('\n=== All screenshots captured ===');
})();
