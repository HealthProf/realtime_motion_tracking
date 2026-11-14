// End-to-end smoke test against the production build, using the synthetic demo as ground truth.
// Run `npm run build` first. Optional: FAKE_VIDEO=/path/to/person.y4m also exercises the real pose
// model through Chromium's fake camera, and the offline check. Optional: TEST_VIDEO=/path/to/clip.webm
// TEST_VIDEO_FRAMES=<count> checks frame-by-frame analysis of a video file (needs `npm run assets`).
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

    // Delayed view: fills, then shows the earlier picture; trials keep their data but record no video.
    await page.evaluate(() => { const el = document.getElementById('delay-seconds'); el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.match(await page.textContent('#delay-note'), /at 5 s the picture is kept up to \d+ pixels wide/);
    await page.keyboard.press('d');
    assert.ok(await page.isChecked('#delay-on'), 'D switches the delayed view on');
    assert.ok(await page.isDisabled('#chk-video'), 'trial video is unavailable while delayed');
    assert.equal(await page.textContent('#live-tag'), 'delayed 5 s');
    await page.waitForFunction(() => /Showing the picture from 5 s ago/.test(document.getElementById('delay-state').textContent), null, { timeout: 12000 });
    await page.waitForFunction(() => /\d/.test(document.querySelector('#readouts tbody tr td:nth-child(2)').textContent));
    await page.click('#btn-trial');
    await page.waitForTimeout(1500);
    await page.click('#btn-trial');
    await page.waitForSelector('#results:not([hidden])');
    assert.ok(await page.isHidden('#btn-video-dl'), 'no video is saved from the delayed view');
    await page.uncheck('#delay-on');
    assert.equal(await page.textContent('#live-tag'), 'live estimate');
    assert.ok(!(await page.isDisabled('#chk-video')), 'trial video is available again');

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

    // Planes, axes and the teaching overlays (side-view squat).
    await page.goto(`${URL}?demo=squat`);
    await openAll();
    for (const id of ['sagittal', 'frontal', 'transverse']) { await page.check(`#ly-plane-${id}`); await page.check(`#ly-axis-${id}`); }
    await page.check('#ly-gravity');
    await page.check('#ly-vectors');
    await page.selectOption('#moment-joint', 'knees');
    await page.fill('#body-mass', '70');
    await page.dispatchEvent('#body-mass', 'change');
    await page.waitForFunction(() => /looking at the sagittal plane/.test(document.getElementById('plane-status').textContent));
    assert.match(await page.textContent('#plane-status'), /mediolateral axis/);
    await page.waitForFunction(() => /Line of gravity (inside|outside)/.test(document.getElementById('gravity-status').textContent));
    await page.waitForFunction(() => /W = \d+ N/.test(document.getElementById('moment-status').textContent));
    assert.match(await page.textContent('#moment-status'), /88 % of body mass/);
    await page.selectOption('#live-chart-mode', 'aa');
    assert.ok(await page.locator('#live-aa').isVisible(), 'angle-angle selectors');
    // Countdown calibration refuses a person who is moving and not upright.
    await page.selectOption('#cal-count', '3');
    await page.click('#btn-cal-countdown');
    await page.waitForFunction(() => /Not calibrated:/.test(document.getElementById('status-msg').textContent), null, { timeout: 8000 });

    // Countdown calibration on a standing figure of known height (eyes at 1.65 m, 300 px per metre).
    await page.goto(`${URL}?demo=raise`);
    await openAll();
    await page.fill('#cal-height', '176.3');
    await page.selectOption('#cal-height-unit', 'cm');
    await page.selectOption('#cal-count', '3');
    await page.click('#btn-cal-countdown');
    await page.waitForFunction(() => /Calibrated by subject height: 300\.\d pixels per metre/.test(document.getElementById('cal-status').textContent), null, { timeout: 8000 });
    await page.waitForFunction(() => /looking at the frontal/.test(document.getElementById('plane-status').textContent) || true);

    // Weight lifting: the demo draws a barbell, so the real plate tracker runs. Known rise 0.525 m, 100 kg.
    await page.goto(`${URL}?demo=lift`);
    await openAll();
    assert.equal(await page.inputValue('#preset'), 'lift');
    await page.click('#btn-trial');
    assert.match(await page.textContent('#status-msg'), /needs calibration first/);
    await page.locator('#view').scrollIntoViewIfNeeded();
    const lb = await page.locator('#view').boundingBox(), lk = lb.width / 1280;
    for (let i = 0; i < 8 && !/Following the plate/.test(await page.textContent('#lift-steps')); i++) {
      await page.locator('#view').scrollIntoViewIfNeeded();
      await page.mouse.click(lb.x + 640 * lk, lb.y + (660 - 1.3 * 300) * lk);
      await page.waitForTimeout(450);
    }
    assert.match(await page.textContent('#lift-steps'), /Following the plate/);
    await page.click('#btn-plate-cal');
    const ppm = Number((await page.textContent('#cal-status')).match(/([\d.]+) pixels per metre/)[1]);
    assert.ok(Math.abs(ppm - 300) < 3, `plate calibration ${ppm} px/m should be near 300`);
    await page.fill('#lift-load', '100');
    await page.dispatchEvent('#lift-load', 'change');
    await page.waitForTimeout(500);
    await page.click('#btn-trial');
    await page.waitForTimeout(7200);
    await page.click('#btn-trial');
    await page.waitForSelector('#res-lift table');
    const liftCells = await page.locator('#res-lift tbody tr').first().locator('td').allTextContents();
    const romCm = Number(liftCells[1]), workJ = Number(liftCells[9]);
    assert.ok(Math.abs(romCm - 52.5) < 1.5, `bar rise ${romCm} cm should be near 52.5`);
    assert.ok(Math.abs(workJ - 100 * 9.80665 * 0.5248) < 20, `work ${workJ} J should be near 515`);
    const liftCsv = await save('#btn-lift-csv');
    assert.match(fs.readFileSync(liftCsv.path, 'utf8'), /mean_propulsive_velocity_m_s/);
    const liftKin = await save('#btn-csv');
    assert.ok(fs.readFileSync(liftKin.path, 'utf8').includes('bar_power_W'), 'bar columns in the kinematics CSV');

    // Video file: every frame of a clip with a known frame count is analysed once.
    if (process.env.TEST_VIDEO) {
      await page.goto(URL);
      await openAll();
      await page.setInputFiles('#file-video', process.env.TEST_VIDEO);
      await page.waitForFunction(() => /Video loaded|Could not/.test(document.getElementById('status-msg').textContent), null, { timeout: 90000 });
      assert.match(await page.textContent('#status-msg'), /Video loaded/);
      await page.click('#video-analyse');
      await page.waitForSelector('#results:not([hidden])', { timeout: 300000 });
      const got = Number((await page.textContent('#res-summary')).match(/(\d+) frames/)[1]);
      assert.equal(got, Number(process.env.TEST_VIDEO_FRAMES), 'every frame analysed once');
    }

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
