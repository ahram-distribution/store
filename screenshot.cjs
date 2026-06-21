const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto('https://ahram-distribution.github.io/store/data-center', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Final URL:', page.url());
  console.log('Title:', await page.title());

  await page.screenshot({ path: 'C:\\Users\\joker\\AppData\\Local\\Temp\\opencode\\data-center.png', fullPage: true });
  console.log('Screenshot saved');

  await browser.close();
})();
