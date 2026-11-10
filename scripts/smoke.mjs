// End-to-end smoke test against a running build: `pnpm build && pnpm preview` then `node scripts/smoke.mjs`.
// Set CHROME_PATH to use a system Chrome instead of Playwright's bundled browser.
import { chromium } from '@playwright/test';
import { mkdirSync, statSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const shots = process.env.SHOTS ?? 'test-results/smoke';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();
const issues = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => issues.push(`[pageerror] ${e.message}`));
let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log('OK  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '-', e.message.split('\n')[0]); }
};
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const tab = (name) => page.getByRole('tab', { name }).click();

await page.goto(BASE);
await page.waitForTimeout(800);
await shot('01-onboarding');

await step('onboarding opens the bedroom studio', () => page.getByRole('button', { name: 'Fix a bedroom studio' }).click());
await step('first simulation completes', async () => {
  await tab('Analysis');
  await page.locator('.hero-metric .num-xl').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('02-plan-analysis');
});
const rtBefore = await page.locator('.hero-metric .num-xl').innerText().catch(() => '?');

await step('advisor one-click fix lowers RT60', async () => {
  await tab('Advisor');
  await page.waitForTimeout(400);
  await shot('03-advisor-before');
  const btn = page.locator('.finding .btn-primary').first();
  console.log('     action:', await btn.innerText());
  await btn.click();
  await page.waitForTimeout(3500);
  await shot('04-advisor-after');
  await tab('Analysis');
  await page.waitForTimeout(300);
  const rtAfter = await page.locator('.hero-metric .num-xl').innerText();
  console.log(`     RT60 ${rtBefore} s -> ${rtAfter} s`);
  if (!(parseFloat(rtAfter) < parseFloat(rtBefore))) throw new Error('RT60 did not drop');
  await shot('05-analysis-after');
  await page.locator('.tab-scroll').evaluate((el) => el.scrollTo(0, 900));
  await page.waitForTimeout(300);
  await shot('06-analysis-scrolled');
});

for (const [i, v] of ['Waves', 'Rays', 'Bass map', '3D'].entries()) {
  await step(`view: ${v}`, async () => {
    await page.locator('.views button', { hasText: v }).click();
    await page.waitForTimeout(v === 'Bass map' ? 4000 : 2000);
    await shot(`${String(7 + i).padStart(2, "0")}-view-${v.replace(' ', '')}`);
  });
}
await page.locator('.views button', { hasText: 'Plan' }).click();

await step('listen: clap in room, A/B toggle', async () => {
  await tab('Listen');
  await page.locator('.source', { hasText: 'Hand clap' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Dry', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'In this room' }).click();
  await page.waitForTimeout(800);
  await shot('11-listen');
  if (!(await page.locator('.source.playing').count())) throw new Error('not playing');
});
await step('listen: drums, guitar, microphone', async () => {
  for (const s of ['Drum loop', 'Plucked guitar', 'Your voice']) {
    await page.locator('.source', { hasText: s }).click();
    await page.waitForTimeout(600);
    if (!(await page.locator('.source.playing', { hasText: s }).count())) throw new Error(`${s} not playing`);
  }
  await page.locator('.source', { hasText: 'Your voice' }).click();
});
await step('export impulse response WAV', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Impulse response/ }).click()]);
  console.log('     ', dl.suggestedFilename(), statSync(await dl.path()).size, 'bytes');
});
await step('render clap through room to WAV', async () => {
  await page.locator('.source', { hasText: 'Hand clap' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: /Render/ }).click()]);
  console.log('     ', dl.suggestedFilename(), statSync(await dl.path()).size, 'bytes');
  await page.locator('.source', { hasText: 'Hand clap' }).click();
});

await step('templates: stone chapel', async () => {
  await tab('Room');
  await page.locator('.preset', { hasText: 'Stone chapel' }).click();
  await page.waitForTimeout(5000);
  console.log('      chapel RT60', await page.locator('.quick b').first().innerText());
  await shot('12-room-chapel');
});
await step('material picker changes a wall', async () => {
  await page.locator('.wall-head').first().click();
  await page.locator('.wall-body .mat-btn').first().click();
  await page.waitForTimeout(400);
  await shot('13-material-pop');
  await page.locator('.mat-opt', { hasText: 'Heavy curtain' }).click();
  if (!(await page.locator('.wall-head').first().innerText()).includes('Heavy curtain')) throw new Error('material not applied');
});
await step('undo restores the wall', async () => {
  await page.locator('.stage-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  if ((await page.locator('.wall-head').first().innerText()).includes('Heavy curtain')) throw new Error('undo failed');
});
await step('drag a wall on the canvas resizes the room', async () => {
  await page.locator('.preset', { hasText: 'Bedroom studio' }).click();
  await page.waitForTimeout(400);
  const before = await page.locator('.kv-grid b').first().innerText();
  const box = await page.locator('.stage-canvas').boundingBox();
  const y = box.y + box.height / 2;
  let found = null;
  for (let x = box.x + box.width / 2; x < box.x + box.width; x += 2) {
    await page.mouse.move(x, y);
    if ((await page.locator('.stage-canvas').evaluate((el) => el.style.cursor)) === 'move') { found = x; break; }
  }
  if (!found) throw new Error('wall not found');
  await page.mouse.down();
  await page.mouse.move(found + 60, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.locator('.kv-grid b').first().innerText();
  console.log(`      floor area ${before} -> ${after}`);
  if (before === after) throw new Error('area unchanged');
});
await step('draw a new 5-wall room', async () => {
  await page.keyboard.press('d');
  const box = await page.locator('.stage-canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const [dx, dy] of [[-200, -150], [200, -150], [200, 50], [0, 150], [-200, 150]]) {
    await page.mouse.click(cx + dx, cy + dy);
    await page.waitForTimeout(80);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const walls = await page.locator('.kv-grid b').nth(2).innerText();
  if (walls !== '5') throw new Error(`walls=${walls}`);
  await shot('14-drawn-room');
});
await step('share link round-trip', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.waitForTimeout(600);
  const url = page.url();
  if (!url.includes('#room=')) throw new Error('no share hash');
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto(url);
  await p2.waitForTimeout(1000);
  const n = await p2.evaluate(() => JSON.parse(localStorage.getItem('roomtone:v1')).state.room.vertices.length);
  if (n !== 5) throw new Error(`shared room has ${n} corners`);
  console.log(`      link ${url.length} chars, opened with ${n} corners`);
  await fresh.close();
});
await step('shortcuts dialog', async () => {
  await page.keyboard.press('?');
  await page.locator('.modal').waitFor();
  await page.locator('.modal .icon-btn').click();
});
await step('mobile layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/15-mobile.png`, fullPage: true });
});

console.log(`\n${failed} failed step(s); console warnings/errors: ${issues.length}`);
issues.slice(0, 30).forEach((e) => console.log('  ', e));
await browser.close();
process.exit(failed ? 1 : 0);
