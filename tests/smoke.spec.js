// Smoke test ผูกกับ INVARIANTS.md — ชื่อเทสอ้างข้อกฎตรง ๆ
// เทสที่แดงจะบอกได้ทันทีว่าละเมิดกฎข้อไหน ไม่ต้องไปไล่อ่าน diff
//
// ── จุดยึด (test seam) ──────────────────────────────────────────────
// แอปเป็น Vue 3 global build ซึ่ง `app._instance` เป็น null ใน production build
// แต่เข้าถึง state จริงได้ทาง:  document.querySelector('#app')._vnode.component.setupState
// ตัวนี้คือทุกอย่างที่ setup() return ออกมา (~180 ตัว) รวม balOf / round5 / isPoClosed / txns
//
// ⚠️ กับดักที่เสียเวลาไปแล้วครั้งหนึ่ง:
//    setupState ถูกห่อด้วย proxyRefs ซึ่ง "แกะ" ref ให้อัตโนมัติตอนอ่าน
//    เพราะฉะนั้น  s.entity  คืนค่าเป็น string ไม่ใช่ ref
//    ➜ เขียนค่าต้องใช้   s.entity = 'E1'      (proxy setter จะเขียนลง .value ให้เอง)
//    ➜ ห้ามใช้           s.entity.value = 'E1'  (เงียบหาย ไม่มี error และเทสจะหลอกให้เข้าใจผิด)
//
// ถ้า Vue อัปเวอร์ชันแล้ว seam นี้พัง ให้แก้ที่ readState() จุดเดียว

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const APP = '/Stock-log.html';
const APP_FILE = path.resolve(__dirname, '..', 'Stock-log.html');

const SEAM = `document.querySelector('#app')._vnode.component.setupState`;

/** ข้อมูลตั้งต้นขั้นต่ำที่ทำให้แอปพร้อมใช้ (ต้องมี materials + entities ไม่งั้น ready = false) */
function seedData() {
  const txn = (id, direction, code, qty, po, entity, voided = false) => ({
    id, entity, direction, material_code: code, doc_ref: po || '', part_no: '',
    date: '2026-08-02', time: '08', qty,
    reqmt_qty: '', issued_qty: '', person: 'สมชาย',
    expiry_date: '', remark: '', batch: '',
    created_at: '2026-08-02T01:00:00.000Z', updated_at: '2026-08-02T01:00:00.000Z',
    voided, void_reason: '', device: 'test'
  });

  return {
    setup: {
      materials: [
        { material_code: 'M001', description: 'ลวดทองแดง', unit: 'kg', active: 'TRUE', requires_expiry: 'FALSE' },
        { material_code: 'M002', description: 'ฉนวน',      unit: 'm',  active: 'TRUE', requires_expiry: 'FALSE' }
      ],
      entities: [
        { entity_code: 'E1', entity_name: 'บริษัท ก' },
        { entity_code: 'E2', entity_name: 'บริษัท ข' }
      ],
      bom: [{ pn: 'PN1', code: 'M001', usage: 2 }],
      people: ['สมชาย'],
      poList: [], shorts: [], kits: [],
      closes: [{
        id: 'C1', po: 'PO-CLOSED', closed_at: '2026-08-01T00:00:00.000Z', device: 'test',
        note: '', voided: false, void_reason: '', updated_at: '2026-08-01T00:00:00.000Z'
      }]
    },
    txns: [
      txn('T1', 'IN',  'M001', 10,  'PO-1', 'E1'),
      txn('T2', 'OUT', 'M001', 3,   'PO-1', 'E1'),
      txn('T3', 'IN',  'M001', 100, 'PO-9', 'E1', true),  // ยกเลิกแล้ว — ห้ามถูกนับ
      txn('T4', 'IN',  'M001', 500, 'PO-2', 'E2'),        // คนละนิติบุคคล — ห้ามถูกนับ
      txn('T5', 'IN',  'M002', 0.1, 'PO-1', 'E1'),
      txn('T6', 'IN',  'M002', 0.2, 'PO-1', 'E1'),
      txn('T7', 'IN',  'M001', 5, 'PO-CLOSED', 'E1')      // อยู่ใน PO ที่ปิดยอดแล้ว
    ]
  };
}

/** เปิดแอปพร้อมข้อมูลตั้งต้น และเลือกนิติบุคคลให้เรียบร้อย */
async function openApp(page, entity = 'E1') {
  const seed = seedData();
  await page.addInitScript(s => {
    localStorage.setItem('bincard.setup.v1', JSON.stringify(s.setup));
    localStorage.setItem('bincard.txns.v1', JSON.stringify(s.txns));
  }, seed);
  await page.goto(APP);
  await page.waitForFunction(sel => {
    const el = document.querySelector('#app');
    return el && el._vnode && el._vnode.component && el._vnode.component.setupState;
  }, SEAM);
  await setEntity(page, entity);
}

async function setEntity(page, entity) {
  await page.evaluate(e => {
    document.querySelector('#app')._vnode.component.setupState.entity = e;
  }, entity);
  await page.waitForTimeout(50);
}

/** อ่านค่าจาก setupState — fn รับ setupState เป็นอาร์กิวเมนต์ */
function readState(page, fn) {
  return page.evaluate(src => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    return (0, eval)('(' + src + ')')(s);
  }, fn.toString());
}

// ────────────────────────────────────────────────────────────────────

test('แอปเปิดขึ้นได้ ไม่มี error ที่ทำให้ใช้งานไม่ได้', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push('uncaught: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await openApp(page);

  // ต้องขึ้นแท็บหลัก แปลว่า ready === true และ Vue mount สำเร็จ
  await expect(page.getByRole('button', { name: 'งานประจำวัน' })).toBeVisible();
  expect(errors, 'มี error ตอนเปิดแอป').toEqual([]);
});

test('A1 — ยอดคงเหลือ = รับเข้า − จ่ายออก และไม่นับรายการที่ยกเลิกแล้ว', async ({ page }) => {
  await openApp(page);
  // M001 ของ E1: รับ 10, จ่าย 3, และมีรายการยกเลิก 100 ที่ต้องไม่ถูกนับ
  // (รวมรายการ 5 ของ PO-CLOSED ด้วย → 10 - 3 + 5 = 12)
  const bal = await readState(page, s => s.balOf('M001'));
  expect(bal, 'ยอดผิด — ตรวจ balMap / liveTxns').toBe(12);
});

test('A2 — ยอดทศนิยมต้องไม่เพี้ยนจากการบวก float', async ({ page }) => {
  await openApp(page);
  const r = await readState(page, s => ({ bal: s.balOf('M002'), round5: s.round5(0.1 + 0.2) }));
  expect(r.bal, 'ยอด M002 ควรเป็น 0.3 พอดี — round5 น่าจะหลุดไปจากเส้นทางคำนวณ').toBe(0.3);
  expect(r.round5).toBe(0.3);
});

test('A3 — ยอดของนิติบุคคลหนึ่งต้องไม่ปนไปอีกนิติบุคคลหนึ่ง', async ({ page }) => {
  await openApp(page, 'E1');
  const e1 = await readState(page, s => s.balOf('M001'));

  await setEntity(page, 'E2');
  const e2 = await readState(page, s => ({ m001: s.balOf('M001'), m002: s.balOf('M002') }));

  expect(e1).toBe(12);
  expect(e2.m001, 'E2 ควรเห็นเฉพาะ 500 ของตัวเอง').toBe(500);
  expect(e2.m002, 'E2 ไม่มีรายการ M002 เลย ต้องเป็น 0').toBe(0);
});

test('B1 — ยกเลิกรายการแล้วข้อมูลต้องยังอยู่ ไม่ถูกลบออกจากระบบ', async ({ page }) => {
  await openApp(page);
  page.on('dialog', d => d.accept('เหตุผลจากเทสอัตโนมัติ'));

  const before = await readState(page, s => ({ total: s.txns.length, bal: s.balOf('M001') }));

  await page.evaluate(() => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    s.voidTxn(s.txns.find(t => t.id === 'T2'));   // จ่ายออก 3 ของ PO-1 (PO ยังไม่ปิด)
  });
  await page.waitForTimeout(100);

  const after = await readState(page, s => {
    const t2 = s.txns.find(t => t.id === 'T2');
    return { total: s.txns.length, bal: s.balOf('M001'), voided: t2 && t2.voided, reason: t2 && t2.void_reason };
  });

  expect(after.total, 'จำนวนรายการต้องเท่าเดิม — ห้ามลบออกจาก array').toBe(before.total);
  expect(after.voided, 'ต้องถูกมาร์คเป็น voided').toBe(true);
  expect(after.reason, 'ต้องบันทึกเหตุผลไว้ด้วย').toBeTruthy();
  expect(after.bal, 'ยกเลิกรายการจ่าย 3 แล้วยอดต้องเพิ่มกลับ').toBe(before.bal + 3);
});

test('C1 + C2 — PO ที่ปิดยอดแล้วต้องล็อก ยกเลิกรายการของ PO นั้นไม่ได้', async ({ page }) => {
  await openApp(page);
  page.on('dialog', d => d.accept('พยายามยกเลิกจากเทส'));

  const closed = await readState(page, s => ({
    isClosed: s.isPoClosed('PO-CLOSED'),
    isOpen:   s.isPoClosed('PO-1')
  }));
  expect(closed.isClosed, 'PO-CLOSED ควรอยู่ในสถานะปิดยอด').toBe(true);
  expect(closed.isOpen, 'PO-1 ยังไม่ถูกปิด').toBe(false);

  await page.evaluate(() => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    s.voidTxn(s.txns.find(t => t.id === 'T7'));   // T7 อยู่ใน PO-CLOSED
  });
  await page.waitForTimeout(100);

  const t7 = await readState(page, s => s.txns.find(t => t.id === 'T7').voided);
  expect(t7, 'รายการของ PO ที่ปิดยอดแล้วต้องยกเลิกไม่ได้').toBe(false);
});

test('B2 — ปิดยอด PO แล้วยกเลิกการปิด ประวัติต้องไม่หาย', async ({ page }) => {
  await openApp(page);
  page.on('dialog', d => d.accept('ยกเลิกการปิดจากเทส'));

  const before = await readState(page, s => s.closes.length);
  await page.evaluate(() => {
    document.querySelector('#app')._vnode.component.setupState.unclosePo('PO-CLOSED');
  });
  await page.waitForTimeout(100);

  const after = await readState(page, s => ({
    total: s.closes.length,
    stillClosed: s.isPoClosed('PO-CLOSED'),
    voidedRows: s.closes.filter(c => c.voided).length
  }));

  expect(after.total, 'แถวประวัติการปิดต้องยังอยู่ครบ ห้ามลบ').toBe(before);
  expect(after.voidedRows, 'แถวที่ถูกยกเลิกต้องถูกมาร์ค voided').toBe(1);
  expect(after.stillClosed, 'ยกเลิกการปิดแล้ว PO ต้องกลับมาคีย์ได้').toBe(false);
});

test('E1 — refresh แล้วข้อมูลต้องยังอยู่ใน localStorage key เดิม', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => document.querySelector('#app')._vnode.component.setupState.persist());

  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys, 'key ของ localStorage เปลี่ยน = ข้อมูลของพนักงานหายทันที')
    .toEqual(expect.arrayContaining(['bincard.setup.v1', 'bincard.txns.v1']));

  await page.reload();
  await page.waitForFunction(() => {
    const el = document.querySelector('#app');
    return el && el._vnode && el._vnode.component;
  });
  await setEntity(page, 'E1');

  const bal = await readState(page, s => s.balOf('M001'));
  expect(bal, 'หลัง refresh ยอดต้องเท่าเดิม').toBe(12);
});

test('เวอร์ชันต้องแสดงบนหน้าจอ และตรงกับที่ประกาศใน meta', async ({ page }) => {
  await openApp(page);
  const meta = await page.getAttribute('meta[name="app-version"]', 'content');
  expect(meta, 'ต้องประกาศเวอร์ชันไว้ใน <meta name="app-version">').toBeTruthy();
  await expect(page.locator('header .sub'), 'ผู้ใช้ต้องเห็นเวอร์ชันได้โดยไม่ต้องเปิด DevTools')
    .toContainText('v' + meta);
});

test('เจอเวอร์ชันใหม่บนเซิร์ฟเวอร์ ต้องขึ้นปุ่มให้โหลดใหม่', async ({ page }) => {
  await openApp(page);
  await page.route('**/Stock-log.html?v=*', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<meta name="app-version" content="9999-12-31.9">'
  }));

  await page.evaluate(() => document.querySelector('#app')._vnode.component.setupState.checkUpdate(false));
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ })).toBeVisible();
});

test('F4 — เปิดแท็บค้างไว้ทั้งวัน ต้องตรวจเวอร์ชันซ้ำเองโดยไม่ต้องกด', async ({ page }) => {
  await page.clock.install();          // ต้องติดตั้งก่อนเปิดหน้า ไม่งั้นนาฬิกาของหน้าไม่ถูกแทน
  await openApp(page);
  await page.clock.runFor(5000);       // ผ่านการตรวจรอบแรกตอนเปิดแอป (เวอร์ชันตรงกัน ไม่ขึ้นปุ่ม)
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ })).toHaveCount(0);

  // หลังจากนี้เซิร์ฟเวอร์มีของใหม่ แต่พนักงานไม่ได้แตะอะไรเลย
  let hits = 0;
  await page.route('**/Stock-log.html?v=*', route => {
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
  await page.route('**/Stock-log.html?v=*', route => {
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

test('D7 — ตรวจอัปเดตไม่ได้ตอนออฟไลน์ ต้องไม่ทำให้แอปใช้งานไม่ได้', async ({ page }) => {
  await openApp(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.route('**/Stock-log.html?v=*', route => route.abort());
  await page.evaluate(() => document.querySelector('#app')._vnode.component.setupState.checkUpdate(false));
  await page.waitForTimeout(300);

  expect(errors, 'ตรวจอัปเดตล้มเหลวต้องไม่โยน error หลุดออกมา').toEqual([]);
  expect(await readState(page, s => s.balOf('M001')), 'แอปต้องยังทำงานได้ตามปกติ').toBe(12);
  await expect(page.getByRole('button', { name: /มีเวอร์ชันใหม่/ }), 'ตรวจไม่ได้ ห้ามเดาว่ามีของใหม่')
    .toHaveCount(0);
});

test('F3 — ห้ามมี URL ของ Apps Script หรือ token ฝังอยู่ในไฟล์', () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  // placeholder ที่เป็น ".../exec" ปล่อยผ่านได้ ที่ห้ามคือ deployment id จริง (ขึ้นต้นด้วย AKfyc)
  expect(src, 'พบ deployment URL จริงฝังในไฟล์ — repo นี้เป็น public')
    .not.toMatch(/AKfyc[A-Za-z0-9_-]{20,}/);
  expect(src, 'พบ GitHub token ฝังในไฟล์').not.toMatch(/gh[pousr]_[A-Za-z0-9]{30,}/);
  expect(src, 'พบ GitHub PAT ฝังในไฟล์').not.toMatch(/github_pat_[A-Za-z0-9_]{30,}/);
});
