// Smoke test ของ ทะเบียนวัตถุดิบ.html — ผูกกับ INVARIANTS.md เหมือน smoke.spec.js
//
// ไฟล์นี้แยกจาก smoke.spec.js เพราะเป็นคนละแอป คนละ localStorage key
// และ seam เดียวกันแต่ setupState คนละชุด
//
// ⚠️ กับดักเดิมยังใช้ได้: setupState ถูกห่อด้วย proxyRefs
//    เขียนค่าต้องใช้  s.tab = 'mat'  ห้ามใช้  s.tab.value = 'mat'

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP = '/ทะเบียนวัตถุดิบ.html';
const APP_FILE = path.resolve(__dirname, '..', 'ทะเบียนวัตถุดิบ.html');

/** ตรงกับ request ที่แอปยิงหาไฟล์ตัวเองตอนตรวจเวอร์ชัน
 *  ต้อง decode ก่อน เพราะชื่อไฟล์ภาษาไทยถูก percent-encode ใน URL */
const isSelfCheck = u =>
  decodeURIComponent(u.pathname).endsWith('ทะเบียนวัตถุดิบ.html') && u.search.startsWith('?v=');

async function openApp(page) {
  await page.goto(APP);
  await page.waitForFunction(() => {
    const el = document.querySelector('#app');
    return el && el._vnode && el._vnode.component && el._vnode.component.setupState;
  });
}

const checkUpdate = page => page.evaluate(
  () => document.querySelector('#app')._vnode.component.setupState.checkUpdate(false)
);

// ────────────────────────────────────────────────────────────────────

test('แอปเปิดขึ้นได้ ไม่มี error ที่ทำให้ใช้งานไม่ได้', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openApp(page);
  expect(errors, 'มี error ตอนเปิดแอป').toEqual([]);
  await expect(page.locator('header h1')).toContainText('ทะเบียนวัตถุดิบ');
});

test('F4 — เวอร์ชันต้องแสดงบนหน้าจอ และตรงกับที่ประกาศใน meta', async ({ page }) => {
  await openApp(page);
  const meta = await page.getAttribute('meta[name="app-version"]', 'content');
  expect(meta, 'ต้องประกาศเวอร์ชันไว้ใน <meta name="app-version">').toBeTruthy();
  await expect(page.locator('header .sub'), 'ผู้ใช้ต้องเห็นเวอร์ชันได้โดยไม่ต้องเปิด DevTools')
    .toContainText('v' + meta);
});

test('F4 — เจอเวอร์ชันใหม่บนเซิร์ฟเวอร์ ต้องขึ้นปุ่มให้โหลดใหม่', async ({ page }) => {
  await openApp(page);
  await page.route(isSelfCheck, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<meta name="app-version" content="9999-12-31.9">'
  }));

  await checkUpdate(page);
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ })).toBeVisible();
});

test('F4 — เวอร์ชันตรงกัน ต้องไม่ขึ้นปุ่มหลอกให้โหลดใหม่', async ({ page }) => {
  await openApp(page);
  await checkUpdate(page);
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ })).toHaveCount(0);
  await expect(page.locator('header .sub')).toContainText('ใช้เวอร์ชันล่าสุดอยู่แล้ว');
});

test('F4 — เปิดแท็บค้างไว้ทั้งวัน ต้องตรวจเวอร์ชันซ้ำเองโดยไม่ต้องกด', async ({ page }) => {
  await page.clock.install();          // ต้องติดตั้งก่อนเปิดหน้า ไม่งั้นนาฬิกาของหน้าไม่ถูกแทน
  await openApp(page);
  await page.clock.runFor(5000);       // ผ่านการตรวจรอบแรกตอนเปิดแอป (เวอร์ชันตรงกัน ไม่ขึ้นปุ่ม)
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ })).toHaveCount(0);

  let hits = 0;
  await page.route(isSelfCheck, route => {
    hits++;
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<meta name="app-version" content="9999-12-31.9">'
    });
  });

  await page.clock.runFor(10 * 60 * 1000);
  expect(hits, 'ยังไม่ถึงเวลา ห้ามยิงโหลดไฟล์ซ้ำถี่ ๆ — เน็ตโรงงานรับไม่ไหว').toBe(0);

  await page.clock.runFor(30 * 60 * 1000);
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ }),
    'เปิดแท็บค้างไว้ต้องรู้เองว่ามีเวอร์ชันใหม่').toBeVisible();
  expect(hits, 'ตรวจถี่เกินไป — ต้องห่างกันอย่างน้อยครึ่งชั่วโมง').toBeLessThanOrEqual(2);
});

test('F4 — แท็บที่ถูกซ่อนอยู่ต้องไม่ตรวจ ตรวจตอนพนักงานสลับกลับมา', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.clock.runFor(5000);

  let hits = 0;
  await page.route(isSelfCheck, route => {
    hits++;
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<meta name="app-version" content="9999-12-31.9">'
    });
  });

  // พนักงานสลับไปโปรแกรมอื่น แท็บนี้ถูกซ่อน
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    window.__hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(40 * 60 * 1000);
  expect(hits, 'แท็บถูกซ่อนอยู่ ห้ามตรวจ — ปล่อยเครื่องเก่าได้พัก').toBe(0);

  // สลับกลับมาที่แท็บนี้ — เลยเวลาที่ควรตรวจแล้ว ต้องตรวจให้
  await page.evaluate(() => {
    window.__hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ })).toBeVisible();
  expect(hits, 'สลับกลับมาแล้วต้องตรวจครั้งเดียวพอ').toBe(1);
});

test('ตรวจอัปเดตไม่ได้ตอนออฟไลน์ ต้องไม่ทำให้แอปใช้งานไม่ได้', async ({ page }) => {
  await openApp(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.route(isSelfCheck, route => route.abort());
  await checkUpdate(page);
  await page.waitForTimeout(300);

  expect(errors, 'ตรวจอัปเดตล้มเหลวต้องไม่โยน error หลุดออกมา').toEqual([]);
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ }), 'ตรวจไม่ได้ ห้ามเดาว่ามีของใหม่')
    .toHaveCount(0);
  await expect(page.locator('header h1'), 'แอปต้องยังอยู่').toContainText('ทะเบียนวัตถุดิบ');
});

test('G1 — มีของยังไม่บันทึกแล้วกดโหลดใหม่ ต้องถามรอบเดียวเป็นภาษาไทย', async ({ page }) => {
  await openApp(page);
  await page.route(isSelfCheck, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<meta name="app-version" content="9999-12-31.9">'
  }));
  await checkUpdate(page);

  // จำลองว่ามีรายการที่แก้ไว้แต่ยังไม่ได้บันทึก
  await page.evaluate(() => {
    document.querySelector('#app')._vnode.component.setupState.dirty = true;
    window.__beforeReload = true;   // หายไปเมื่อหน้าโหลดใหม่จริง
  });

  const dialogs = [];
  page.on('dialog', d => { dialogs.push({ type: d.type(), message: d.message() }); d.accept(); });

  // ต้องคลิกปุ่มจริง เพราะกล่อง beforeunload ของเบราว์เซอร์ขึ้นเฉพาะเมื่อมี user gesture
  await page.getByRole('button', { name: /มีเวอร์ชันใหม่/ }).click();
  await page.waitForFunction(() => !window.__beforeReload);   // รอให้โหลดใหม่เสร็จจริงก่อนค่อยนับ

  expect(dialogs.map(d => d.type), 'ต้องถามรอบเดียว ห้ามให้ beforeunload เด้งซ้ำ').toEqual(['confirm']);
  expect(dialogs[0].message, 'ข้อความยืนยันต้องเป็นภาษาไทย').toMatch(/ยังไม่ได้บันทึก/);
});

test('G1 — กดยกเลิกในคำถามโหลดใหม่ ต้องไม่โหลดใหม่ และ beforeunload ต้องยังกันอยู่', async ({ page }) => {
  await openApp(page);
  await page.route(isSelfCheck, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<meta name="app-version" content="9999-12-31.9">'
  }));
  await checkUpdate(page);
  await page.evaluate(() => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    s.dirty = true;
    window.__stillHere = true;
  });

  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: /มีเวอร์ชันใหม่/ }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__stillHere), 'กดยกเลิกแล้วต้องไม่โหลดหน้าใหม่').toBe(true);

  // ตอบยกเลิกไปแล้ว ตัวกันเผลอปิดแท็บต้องยังทำงานอยู่
  const guarded = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(guarded, 'ยังมีของค้าง ตัวกันเผลอปิดแท็บต้องยังเตือน').toBe(true);
});

test('F3 — ห้ามมี URL ของ Apps Script หรือ token ฝังอยู่ในไฟล์', () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  expect(src, 'พบ deployment URL จริงฝังในไฟล์ — repo นี้เป็น public')
    .not.toMatch(/AKfyc[A-Za-z0-9_-]{20,}/);
  expect(src, 'พบ GitHub token ฝังในไฟล์').not.toMatch(/gh[pousr]_[A-Za-z0-9]{30,}/);
  expect(src, 'พบ GitHub PAT ฝังในไฟล์').not.toMatch(/github_pat_[A-Za-z0-9_]{30,}/);
});
