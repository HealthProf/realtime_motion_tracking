// End-to-end test of the course app against the production build.
// Run `npm run build` first. Needs ffmpeg (to make two short test clips) and Playwright with Chromium.
// A test course pack is written into dist/course with a test code; the real pack is not touched.
const { chromium, devices } = require('playwright');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const PORT = 4175, ROOT = `http://localhost:${PORT}/`;
const CODE = 'e2e test code words';
const FPS = 30;

function makePack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-e2e-'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  const clip = (name, size) => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${FPS}:duration=4`, '-c:v', 'libvpx-vp9', '-b:v', '600k', '-pix_fmt', 'yuv420p', path.join(src, name)]);
  clip('a.webm', '640x360');
  clip('b.webm', '480x360');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../course-src.example/course.json'), 'utf8'));
  cfg.id = 'e2e-course';
  cfg.videos = [
    { id: 'g1', title: 'Test sport, clip 1', group: 'Test sport', clip: 1, file: 'a.webm', fps: FPS },
    { id: 'g2', title: 'Test sport, clip 2', group: 'Test sport', clip: 2, file: 'b.webm', fps: FPS },
  ];
  fs.writeFileSync(path.join(src, 'course.json'), JSON.stringify(cfg));
  fs.rmSync(path.join(__dirname, '../../dist/course'), { recursive: true, force: true });
  execFileSync('node', ['scripts/pack-course.mjs', '--code', CODE, '--src', src, '--out', 'dist/course'], { cwd: path.join(__dirname, '../..'), stdio: 'pipe' });
}

/** Drags on the canvas between two points given as fractions of its size. */
async function drag(page, sel, a, b, steps = 8) {
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + a[0] * box.width, box.y + a[1] * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + b[0] * box.width, box.y + b[1] * box.height, { steps });
  await page.mouse.up();
}
async function click(page, sel, p) {
  const box = await page.locator(sel).boundingBox();
  await page.mouse.click(box.x + p[0] * box.width, box.y + p[1] * box.height);
}

(async () => {
  makePack();
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const save = async (selector) => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click(selector)]);
      return { name: dl.suggestedFilename(), path: await dl.path() };
    };

    // Old demo links forward to the lab.
    await page.goto(`${ROOT}?demo=squat`);
    await page.waitForURL(/lab\.html\?demo=squat/);

    // Landing page, then the code gate.
    await page.goto(ROOT);
    await page.click('text=Course projects');
    await page.waitForSelector('#gate-code');
    await page.fill('#gate-code', 'wrong code entirely');
    await page.click('#gate-open');
    await page.waitForFunction(() => /not recognised/.test(document.getElementById('gate-error').textContent));
    await page.fill('#gate-code', '  E2E Test  Code Words ');
    await page.click('#gate-open');
    await page.waitForSelector('#home:not([hidden])', { timeout: 20_000 });
    assert.match(await page.textContent('#home-h'), /Project 1/);
    assert.strictEqual(await page.isDisabled('#analysis-list li:first-child button'), true, 'analyses wait for a choice of clips');
    await page.check('input[name=pair]');
    await page.fill('#student-name', 'Sam Rivera');

    // Analysis 1: step, capture, draw.
    await page.click('#analysis-list li:nth-child(1) button');
    await page.waitForSelector('#video-pane:not([hidden])', { timeout: 20_000 });
    await page.waitForFunction(() => /frames per second/.test(document.getElementById('status').textContent), null, { timeout: 15_000 });
    const t0 = await page.evaluate(() => document.getElementById('clip').currentTime);
    for (let i = 0; i < 10; i++) await page.click('#clip-bar [data-a=next]');
    await page.waitForTimeout(300);
    const t1 = await page.evaluate(() => document.getElementById('clip').currentTime);
    assert.ok(Math.abs(t1 - t0 - 10 / FPS) < 1.5 / FPS, `ten frame steps move 10 frames (moved ${(t1 - t0) * FPS} frames)`);
    await page.click('#btn-capture');
    await page.waitForSelector('#edit-pane:not([hidden])');
    assert.strictEqual(await page.inputValue('#snap-name'), 'A1 Snapshot 1');
    assert.strictEqual(await page.inputValue('#snap-prompt'), 'friction');

    await page.click('#snap-tools button[title^="Arrow"]');
    await drag(page, '#snap-canvas', [0.2, 0.2], [0.5, 0.5]);
    await page.click('#snap-tools button[title^="Text"]');
    await click(page, '#snap-canvas', [0.6, 0.2]);
    await page.waitForSelector('.ann-text-input:not([hidden])');
    await page.keyboard.type('Ground friction');
    await page.keyboard.press('Enter');
    await page.click('#snap-tools button[title^="Angle"]');
    await drag(page, '#snap-canvas', [0.2, 0.8], [0.4, 0.6]);
    await page.mouse.move(0, 0);
    const box = await page.locator('#snap-canvas').boundingBox();
    await page.mouse.move(box.x + 0.6 * box.width, box.y + 0.8 * box.height, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => /3 items/.test(document.querySelector('#snap-list .sn-meta').textContent));
    // Undo and redo the angle.
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => /2 items/.test(document.querySelector('#snap-list .sn-meta').textContent));
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => /3 items/.test(document.querySelector('#snap-list .sn-meta').textContent));
    // Structural checklist only.
    const checks = await page.textContent('#prompt-list li:first-child .checks');
    assert.match(checks, /✓ 1 snapshot/);
    assert.match(checks, /✓ text/);
    assert.match(checks, /✓ drawing/);
    await page.waitForTimeout(900); // autosave

    // Reload: the code is remembered and the work is still there.
    await page.reload();
    await page.waitForSelector('#home:not([hidden])', { timeout: 20_000 });
    await page.click('#analysis-list li:nth-child(1) button');
    await page.waitForFunction(() => /3 items/.test(document.querySelector('#snap-list .sn-meta')?.textContent ?? ''), null, { timeout: 15_000 });

    // PDF export: cover page plus one page per snapshot.
    const pdf = await save('#btn-pdf');
    assert.strictEqual(pdf.name, 'Rivera-P1-A1.pdf');
    const pdfText = fs.readFileSync(pdf.path, 'latin1');
    assert.ok(pdfText.startsWith('%PDF'), 'a PDF file');
    assert.strictEqual((pdfText.match(/\/Type \/Page\b/g) || []).length, 2, 'cover page and one snapshot page');

    // Analysis 3: align, lock, play in sync, add text, export video.
    await page.click('#work-back');
    await page.click('#analysis-list li:nth-child(3) button');
    await page.waitForSelector('#cmp-pane:not([hidden])', { timeout: 30_000 });
    await page.waitForFunction(() => /press Lock/.test(document.getElementById('status').textContent), null, { timeout: 20_000 });
    assert.match(await page.textContent('.tool-help >> nth=1'), /Lock the clips together before/);
    for (let i = 0; i < 12; i++) await page.click('#cmp-bar-2 [data-a=next]');
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({ a: document.getElementById('cmp-v1').currentTime, b: document.getElementById('cmp-v2').currentTime }));
    await page.click('#btn-lock');
    await page.waitForSelector('#cmp-locked:not([hidden])');
    await page.click('#cmp-bar-sync [data-a=play]');
    await page.waitForTimeout(1500);
    const during = await page.evaluate(() => ({ a: document.getElementById('cmp-v1').currentTime, b: document.getElementById('cmp-v2').currentTime }));
    await page.click('#cmp-bar-sync [data-a=play]');
    assert.ok(during.a > before.a + 0.5, 'both clips play');
    const err = Math.abs(during.b - during.a - (before.b - before.a));
    assert.ok(err <= 2 / FPS, `clips stay in step while playing (error ${(err * FPS).toFixed(2)} frames)`);
    await page.click('#cmp-bar-sync [data-a=prev]');
    await page.waitForTimeout(400);
    const stepped = await page.evaluate(() => ({ a: document.getElementById('cmp-v1').currentTime, b: document.getElementById('cmp-v2').currentTime }));
    assert.ok(Math.abs(stepped.b - stepped.a - (before.b - before.a)) <= 1 / FPS, 'stepping keeps the clips locked');

    await page.click('#cmp-tools button[title^="Text"]');
    await click(page, '#cmp-canvas', [0.3, 0.15]);
    await page.waitForSelector('.ann-text-input:not([hidden])');
    await page.keyboard.type('Longer lever arm in clip 2');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#cmp-items li').length === 1);
    assert.match(await page.textContent('#cmp-items li'), /Longer lever arm/);
    const vid = await save('#btn-export-video');
    assert.match(vid.name, /^Rivera-P1-A3\.(webm|mp4)$/);
    assert.ok(fs.statSync(vid.path).size > 10_000, 'the exported video has content');

    // Backup round trip file is produced.
    await page.click('#cmp-back');
    const backup = await save('#btn-backup');
    const b = JSON.parse(fs.readFileSync(backup.path, 'utf8'));
    assert.strictEqual(b.courseId, 'e2e-course');
    assert.strictEqual(b.work.projects.p1.analyses.a1.snapshots[0].shapes.length, 3);
    assert.ok(b.work.projects.p1.analyses.a3.compare.sync, 'the lock is saved');

    // Screenshots for review.
    const shots = process.env.SHOTS;
    if (shots) {
      await page.click('#analysis-list li:nth-child(1) button');
      await page.waitForSelector('#snap-list button');
      await page.click('#snap-list button');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(shots, 'course-laptop-snapshot.png') });
      await page.click('#work-back');
      await page.click('#analysis-list li:nth-child(3) button');
      await page.waitForSelector('#cmp-locked:not([hidden])', { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(shots, 'course-laptop-compare.png') });
    }

    // Phone: layout fits the width, and drawing works with touch-sized screens.
    const phone = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
    const pp = await phone.newPage();
    pp.on('pageerror', (e) => errors.push(e.message));
    await pp.goto(`${ROOT}course.html`);
    await pp.fill('#gate-code', CODE);
    await pp.click('#gate-open');
    await pp.waitForSelector('#home:not([hidden])', { timeout: 30_000 });
    await pp.check('input[name=pair]');
    await pp.click('#analysis-list li:nth-child(2) button');
    await pp.waitForSelector('#video-pane:not([hidden])', { timeout: 20_000 });
    await pp.waitForFunction(() => /frames per second/.test(document.getElementById('status').textContent), null, { timeout: 15_000 });
    await pp.tap('#btn-capture');
    await pp.waitForSelector('#edit-pane:not([hidden])');
    await pp.tap('#snap-tools button[title^="Text"]');
    const pbox = await pp.locator('#snap-canvas').boundingBox();
    await pp.touchscreen.tap(pbox.x + pbox.width * 0.3, pbox.y + pbox.height * 0.3);
    await pp.waitForSelector('.ann-text-input:not([hidden])');
    await pp.keyboard.type('Hinge joint?');
    await pp.keyboard.press('Enter');
    await pp.waitForFunction(() => /1 item\b/.test(document.querySelector('#snap-list .sn-meta').textContent));
    const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `no sideways scrolling on a phone (overflow ${overflow}px)`);
    if (shots) await pp.screenshot({ path: path.join(shots, 'course-phone-snapshot.png'), fullPage: false });

    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log('Course app end-to-end test passed.');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
