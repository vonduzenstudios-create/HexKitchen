// Headless check of dev/audio.html: node dev/audio-pw.mjs (needs `npx vite` running on :5173,
// and playwright installed in /tmp/pw). Clicks Init (user gesture), runs window.__audioSelfTest.
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pw/');
const { chromium } = require('playwright');
const url = process.env.URL || 'http://localhost:5173/dev/audio.html';
const exe = process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(url);
await page.click('#init');
const res = await page.evaluate(() => window.__audioSelfTest());
console.log(JSON.stringify(res, null, 2));
// click every button once more as a smoke test
const n = await page.$$eval('button', (bs) => bs.length);
for (let i = 0; i < n; i++) await page.$$eval('button', (bs, i) => bs[i].click(), i);
await page.waitForTimeout(1500);
console.log('buttons clicked:', n);
console.log(errors.length ? 'CONSOLE ISSUES:\n' + errors.join('\n') : 'no console errors/warnings');
await browser.close();
process.exit(errors.some((e) => e.startsWith('error') || e.startsWith('pageerror')) ? 1 : 0);
