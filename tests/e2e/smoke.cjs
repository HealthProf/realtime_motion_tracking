// End-to-end smoke test against the production build, using the synthetic demo as ground truth.
// Run `npm run build` first. Optional: FAKE_VIDEO=/path/to/person.y4m also exercises the real pose
// model through Chromium's fake camera, and the offline check.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert');

const PORT = 4174, URL = `http://localhost:${PORT}/`;
const fake = process.env.FAKE_VIDEO;

(async () => {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  const args = fake ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${fake}`] : [];
  const browser = await chromium.launch({ args });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const save = async (selector) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
      return { name: dl.suggestedFilename(), path: await dl.path() };
    };
    const openAll = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

    // Squat demo: calibrate by clicking a known 1 m span (demo scale is 300 px per metre).
    await page.goto(`${URL}?demo=squat`);
    await openAll();
    await page.selectOption('#preset', 'squat');
    await page.click('#btn-cal-pick');
    await page.locator('#view').scrollIntoViewIfNeeded();
    const box = await page.locator('#view').boundingBox();
    const k = box.width / 1280;
    await page.mouse.click(box.x + 200 * k, box.y + 300 * k);
    await page.mouse.click(box.x + 500 * k, box.y + 300 * k);
    assert.match(await page.textContent('#cal-status'), /300\.0 pixels per metre/);
    await page.waitForTimeout(1200);
    await page.click('#btn-trial');
    await page.waitForTimeout(3200);
    await page.keyboard.press('m');
    await page.waitForTimeout(3600);
    await page.click('#btn-trial');
    await page.waitForSelector('#results:not([hidden])');
    assert.match(await page.textContent('#res-summary'), /calibrated \(reference length\)/);
    const reps = await page.locator('#res-reps tbody tr').count();
    assert.ok(reps >= 3, `expected 2+ reps plus the mean row, got ${reps} rows`);
    assert.match(await page.textContent('#res-reps'), /100\.0/);

    const csv = await save('#btn-csv');
    const lines = fs.readFileSync(csv.path, 'utf8').trim().split('\n');
    const header = lines.find((l) => l.startsWith('time_s')).split(',');
    assert.ok(header.includes('l_knee_deg') && header.includes('com_speed_m_s'), 'CSV columns');
    assert.ok(lines.some((l) => l.startsWith('# filter: zero-phase')), 'CSV methods header');
    assert.ok(lines.some((l) => l.split(',')[1] === 'mark 1'), 'key moment in CSV');
    assert.ok(lines.length > 300, 'CSV rows');
    const video = await save('#btn-video-dl');
    assert.ok(fs.statSync(video.path).size > 20000, 'video file has content');
    assert.match(video.name, /\.(webm|mp4)$/);
    const raw = await save('#btn-raw');
    assert.ok(fs.statSync(raw.path).size > 50000, 'raw landmark CSV');
    const session = await save('#btn-session');
    assert.equal(await page.locator('#gallery figure').count(), 1, 'key moment screenshot');

    // Instant replay.
    await page.keyboard.press('r');
    await page.waitForSelector('#replay-bar:not([hidden])');
    await page.click('#replay-prev');
    assert.match(await page.textContent('#replay-time'), /\d+\.\d+ \/ \d+\.\d+ s/);
    await page.click('#replay-exit');

    // Session round trip: reload, import, export again, compare CSVs.
    await page.goto(URL);
    await openAll();
    await page.selectOption('#preset', 'squat');
    await page.selectOption('#side', 'left');
    await page.setInputFiles('#file-session', session.path);
    await page.waitForSelector('#results:not([hidden])');
    const csv2 = await save('#btn-csv');
    assert.equal(fs.readFileSync(csv2.path, 'utf8'), fs.readFileSync(csv.path, 'utf8'), 'session round trip reproduces the CSV');

    // Jump demo: flight-time height should be close to the synthetic 30.7 cm.
    await page.goto(`${URL}?demo=jump`);
    await openAll();
    await page.selectOption('#preset', 'jump');
    await page.waitForTimeout(500);
    await page.click('#btn-trial');
    await page.waitForTimeout(3400);
    await page.click('#btn-trial');
    await page.waitForSelector('#res-jump table');
    const h = Number((await page.locator('#res-jump tbody tr td').nth(3).textContent()).trim());
    assert.ok(Math.abs(h - 30.7) < 6, `jump height ${h} cm should be near 30.7 cm`);

    // Frontal demo: symmetry table and anatomy layers.
    await page.goto(`${URL}?demo=raise`);
    await openAll();
    await page.selectOption('#preset', 'reach');
    await page.check('#ly-bones');
    await page.check('#ly-muscles');
    await page.selectOption('#ly-highlight', 'shoulder');
    await page.waitForTimeout(2200);
    assert.ok((await page.locator('#muscle-list li').count()) > 3, 'muscle list');
    await page.click('#btn-trial');
    await page.waitForTimeout(4500);
    await page.click('#btn-trial');
    await page.waitForSelector('#res-symmetry table');

    // New anatomy layers and search (front view, still on the arm-raise demo).
    for (const sys of ['organs', 'arteries', 'veins', 'nerves', 'ligaments', 'lymph', 'landmarks']) await page.check(`#ly-sys-${sys}`);
    await page.fill('#find-input', 'thigh bone');
    assert.match(await page.textContent('#find-list'), /Femur/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Femur is highlighted/.test(document.getElementById('find-status').textContent));
    await page.fill('#find-input', 'scapula');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /back view/.test(document.getElementById('find-status').textContent));
    await page.fill('#find-input', 'qqqq');
    assert.match(await page.textContent('#find-list'), /No matching structure/);
    const frameMs = await page.evaluate(() => new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => (++n === 60 ? resolve((performance.now() - t0) / 60) : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
    console.log(`frame interval with every layer on: ${frameMs.toFixed(1)} ms`);

    // Bike fit and running modes on the synthetic rider and runner.
    for (const [demo, preset, text] of [['cycle', 'bike', /Knee flexion at the bottom of the stroke/], ['run', 'run', /Foot-strike angle/]]) {
      await page.goto(`${URL}?demo=${demo}`);
      await openAll();
      await page.selectOption('#preset', preset);
      await page.waitForTimeout(2500);
      assert.match(await page.textContent('#readouts tbody tr'), demo === 'cycle' ? /9\d rev\/min/ : /17\d steps\/min/);
      await page.click('#btn-trial');
      await page.waitForTimeout(8000);
      await page.click('#btn-trial');
      await page.waitForSelector('#res-mode table');
      const report = await page.textContent('#res-mode');
      assert.match(report, text);
      assert.match(report, /Options to try/);
      const rep = await save('#btn-mode-csv');
      const body = fs.readFileSync(rep.path, 'utf8');
      assert.match(body, /doi|10\.\d{4}/);
      assert.match(rep.name, new RegExp(`${preset}-side-report\\.csv$`));
      const kin = fs.readFileSync((await save('#btn-csv')).path, 'utf8');
      assert.match(kin, /# report: /);
    }

    if (fake) {
      await page.goto(`${URL}?autostart=camera`);
      await page.waitForFunction(() => !document.getElementById('btn-trial').disabled, null, { timeout: 90000 });
      await page.waitForFunction(() => /Person detected \(pass\)/.test(document.getElementById('coach').textContent), null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      await ctx.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => !document.getElementById('btn-trial').disabled, null, { timeout: 90000 });
      await ctx.setOffline(false);
      console.log('real model + offline reload: ok');
    }
    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('smoke test passed');
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
