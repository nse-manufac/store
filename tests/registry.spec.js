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

test('F3 — ห้ามมี URL ของ Apps Script หรือ token ฝังอยู่ในไฟล์', () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  expect(src, 'พบ deployment URL จริงฝังในไฟล์ — repo นี้เป็น public')
    .not.toMatch(/AKfyc[A-Za-z0-9_-]{20,}/);
  expect(src, 'พบ GitHub token ฝังในไฟล์').not.toMatch(/gh[pousr]_[A-Za-z0-9]{30,}/);
  expect(src, 'พบ GitHub PAT ฝังในไฟล์').not.toMatch(/github_pat_[A-Za-z0-9_]{30,}/);
});
