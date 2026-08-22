// Regression test ของ issue #36 — "จำนวนวัตถุดิบตาม BOM ไม่แสดงในระบบ"
//
// อาการจริงที่หน้างานเจอ: คอลัมน์ "Reqmt (สูตร)" ในหน้ารับเข้าว่างเป็น "—" ทั้งใบ
// ทั้งที่ไฟล์ BOM มีข้อมูลของ P/N นั้นครบ และช่องอื่นของบรรทัดเดียวกัน (รหัส คำอธิบาย
// หน่วย รับแล้ว) แสดงถูกต้องหมด
//
// ต้นตอ: Google Sheets เก็บรหัสวัตถุดิบ/P·N ที่เป็นเลขล้วนไว้เป็น "ตัวเลข"
// pullRows/pullTxns คืนค่าดิบมาโดยไม่แปลงชนิด (ต่างจาก pullSetup ที่ String() ให้)
// พอเอา k.code (ตัวเลข) ไปถาม Map ที่ key เป็นข้อความ จึงไม่ตรงแบบเงียบ ๆ ไม่มี error
//
// เทสนี้จึงจงใจ seed kits ด้วย code/pn ที่เป็น "ตัวเลข" แบบเดียวกับที่ซิงค์มาจริง
// ถ้าใครถอด normKeys ออก หรือถอด String() ใน loadBom เทสนี้จะแดงทันที
//
// ⚠️ กับดักเดิม: setupState ถูกห่อด้วย proxyRefs — เขียนค่าต้องใช้ s.inH.po = '...'

const { test, expect } = require('@playwright/test');

const APP = '/Stock-log.html';

const PN   = '2870603701';
const PO   = 'TM5268H082';
const CODE_IN_KIT  = '3500501200';   // มีทั้งใน Kit List และ BOM → ต้องได้ Reqmt
const CODE_BOM_ONLY = '3502519400';  // มีเฉพาะใน BOM → ต้องถูกนับเป็น "Kit List ไม่ได้จ่ายมา"

/** ข้อมูลตั้งต้นที่จำลองเครื่องซึ่งเพิ่งซิงค์ Kits มาจาก Google Sheets */
function seedData() {
  return {
    materials: [
      { material_code: CODE_IN_KIT,   description: 'FOAM PAD EPE 265*230*6 PINK', unit: 'PCE',
        category: '', active: 'TRUE', requires_expiry: 'FALSE' },
      { material_code: CODE_BOM_ONLY, description: 'SHEET EPE 265*230*3 PINK', unit: 'PCE',
        category: '', active: 'TRUE', requires_expiry: 'FALSE' }
    ],
    entities: [{ entity_code: 'E1', company_name: 'บริษัท ก' }],
    // BOM มาจาก pullSetup / ไฟล์ xlsx → รหัสเป็นข้อความเสมอ
    bom: [
      { pn: PN, code: CODE_IN_KIT,   usage: 1, unit: 'PCE', varies: false },
      { pn: PN, code: CODE_BOM_ONLY, usage: 2, unit: 'PCE', varies: false }
    ],
    people: ['สมชาย'],
    poList: [], shorts: [], closes: [],
    // ⚠️ หัวใจของเทส — code กับ pn เป็นตัวเลข เหมือนที่ getValues() ของ Sheets คืนมา
    kits: [{
      id: 'K2026-08-05-' + PO + '-' + CODE_IN_KIT, date: '2026-08-05', group: '',
      po: PO, pn: Number(PN), code: Number(CODE_IN_KIT),
      desc: 'FOAM PAD EPE 265*230*6 PINK', unit: 'PCE', issue: null,
      src: '', orderQty: '', req: '', remark: '', updated_at: '2026-08-05T01:00:00.000Z'
    }]
  };
}

async function openApp(page) {
  await page.addInitScript(setup => {
    localStorage.setItem('bincard.setup.v1', JSON.stringify(setup));
    localStorage.setItem('bincard.txns.v1', '[]');
  }, seedData());
  await page.goto(APP);
  await page.waitForFunction(() => {
    const el = document.querySelector('#app');
    return el && el._vnode && el._vnode.component && el._vnode.component.setupState;
  });
  await page.evaluate(() => {
    document.querySelector('#app')._vnode.component.setupState.entity = 'E1';
  });
  await page.waitForTimeout(50);
}

/** กางรายการของ PO แล้วคืนสิ่งที่หน้าจอจะแสดงจริง */
function runLoadBom(page) {
  return page.evaluate(([pn, po]) => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    s.inH.po = po; s.inH.pn = pn; s.inH.order = 1700;
    s.loadBom();
    return {
      lines: s.inLines.map(l => ({ code: l.code, reqmt: l.reqmt, fromKit: !!l.fromKit })),
      hint: s.bomHint
    };
  }, [PN, PO]);
}

// ────────────────────────────────────────────────────────────────────

test('issue #36 — รหัสจาก Kit List ที่ซิงค์มาเป็นตัวเลข ต้องยังจับคู่กับ BOM ได้', async ({ page }) => {
  await openApp(page);
  const r = await runLoadBom(page);

  const line = r.lines.find(l => l.code === CODE_IN_KIT);
  expect(line, 'ไม่พบบรรทัดของรหัสที่อยู่ใน Kit List').toBeTruthy();
  expect(line.fromKit, 'บรรทัดนี้ต้องมาจาก Kit List').toBe(true);
  expect(line.reqmt,
    'Reqmt (สูตร) ว่าง ทั้งที่ BOM มีรหัสนี้ — รหัสจาก Kit List กับ BOM ถูกเทียบกันคนละชนิด'
  ).toBe(1700);   // usage 1 × ยอดสั่ง 1700
});

test('issue #36 — รหัสที่ Kit List จ่ายมาแล้ว ต้องไม่ถูกนับซ้ำเป็น "ไม่ได้จ่ายมา"', async ({ page }) => {
  await openApp(page);
  const r = await runLoadBom(page);

  const dup = r.lines.filter(l => l.code === CODE_IN_KIT);
  expect(dup.length, 'รหัสเดียวกันโผล่สองบรรทัด — inKit จับคู่กับ BOM ไม่ติด').toBe(1);

  // มีของในสูตรที่ Kit List ไม่ได้จ่ายมาจริง ๆ อยู่ตัวเดียว
  expect(r.hint).toContain('อีก 1 รายการ');

  const only = r.lines.find(l => l.code === CODE_BOM_ONLY);
  expect(only, 'ของที่อยู่ในสูตรแต่ Kit List ไม่ได้จ่ายมา ต้องยังแสดงให้เห็น').toBeTruthy();
  expect(only.reqmt, 'บรรทัดที่มาจาก BOM ล้วน ต้องมี Reqmt ตามสูตร').toBe(3400);
});

test('issue #36 — ข้อมูลที่ค้างในเครื่องมาแต่เดิม ต้องถูกซ่อมชนิดให้ตอนเปิดแอป', async ({ page }) => {
  await openApp(page);
  const kinds = await page.evaluate(() => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    return s.kits.map(k => ({ code: typeof k.code, pn: typeof k.pn }));
  });
  expect(kinds[0], 'ถ้าไม่ซ่อมตอนโหลด แถวเก่าที่ updated_at ไม่ขยับจะพังค้างอยู่ตลอด')
    .toEqual({ code: 'string', pn: 'string' });
});

// ────────────────────────────────────────────────────────────────────
// เลข PO ที่เป็นตัวเลขล้วน — เคสที่ normKeys ต้องครอบให้ครบทั้งสองฝั่ง
//
// closes.po / poList.po / kits.po ถูกบังคับเป็นข้อความ ส่วนช่อง PO ของรายการ
// เคลื่อนไหวชื่อ doc_ref ถ้าตกไปตัวเดียว สองฝั่งจะกลายเป็นคนละชนิดแล้วเทียบไม่ติด
// ผลคือ PO ที่ปิดยอดแล้วจะไม่ล็อก (ละเมิด C2) และ lockLeaks จะจับไม่เจอ (ละเมิด B4)
// ก่อนแก้ทั้งสองฝั่งเป็นตัวเลขเหมือนกันจึงบังเอิญตรง — เทสนี้กันไม่ให้ถอยหลังแบบนั้น

const PO_NUM = '5268082';   // PO ที่ Sheets เก็บเป็นตัวเลขล้วน

function seedNumericPo() {
  return {
    setup: {
      materials: [{ material_code: CODE_IN_KIT, description: 'FOAM PAD', unit: 'PCE',
                    category: '', active: 'TRUE', requires_expiry: 'FALSE' }],
      entities: [{ entity_code: 'E1', company_name: 'บริษัท ก' }],
      bom: [{ pn: PN, code: CODE_IN_KIT, usage: 1, unit: 'PCE', varies: false }],
      people: ['สมชาย'], kits: [], shorts: [],
      // ⚠️ po เป็นตัวเลข เหมือนที่ getValues() ของ Sheets คืนมา
      poList: [{ id: 'P1', date: '2026-08-01', sub: '', pn: '', po: Number(PO_NUM),
                 qty: 1700, core: '', remark: '', updated_at: '2026-08-01T00:00:00.000Z' }],
      closes: [{ id: 'C1', po: Number(PO_NUM), closed_at: '2026-08-01T00:00:00.000Z',
                 device: 'test', note: '', voided: false, void_reason: '',
                 updated_at: '2026-08-01T00:00:00.000Z' }]
    },
    txns: [{
      id: 'T1', entity: 'E1', direction: 'IN', material_code: CODE_IN_KIT,
      doc_ref: Number(PO_NUM), part_no: PN, date: '2026-08-02', time: '08', qty: 5,
      reqmt_qty: '', issued_qty: '', person: 'สมชาย', expiry_date: '', remark: '', batch: '',
      created_at: '2026-08-02T01:00:00.000Z', updated_at: '2026-08-02T01:00:00.000Z',
      voided: false, void_reason: '', device: 'test'
    }]
  };
}

async function openWithNumericPo(page) {
  await page.addInitScript(d => {
    localStorage.setItem('bincard.setup.v1', JSON.stringify(d.setup));
    localStorage.setItem('bincard.txns.v1', JSON.stringify(d.txns));
  }, seedNumericPo());
  await page.goto(APP);
  await page.waitForFunction(() => {
    const el = document.querySelector('#app');
    return el && el._vnode && el._vnode.component && el._vnode.component.setupState;
  });
  await page.evaluate(() => {
    document.querySelector('#app')._vnode.component.setupState.entity = 'E1';
  });
  await page.waitForTimeout(50);
}

test('C2 — PO ตัวเลขล้วนที่ปิดยอดแล้ว ต้องยังล็อกการยกเลิกรายการได้', async ({ page }) => {
  await openWithNumericPo(page);
  page.on('dialog', d => d.accept('พยายามยกเลิกจากเทส'));

  expect(await page.evaluate(([po]) => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    return s.isPoClosed(po);
  }, [PO_NUM]), 'PO ตัวเลขล้วนที่ปิดยอดแล้ว ต้องอ่านได้ว่าปิดอยู่').toBe(true);

  await page.evaluate(() => {
    const s = document.querySelector('#app')._vnode.component.setupState;
    s.voidTxn(s.txns.find(t => t.id === 'T1'));
  });
  await page.waitForTimeout(100);

  const voided = await page.evaluate(() =>
    document.querySelector('#app')._vnode.component.setupState.txns.find(t => t.id === 'T1').voided);
  expect(voided, 'doc_ref หลุดจาก KEY_COLS → PO ที่ปิดยอดแล้วไม่ล็อก ยกเลิกรายการทะลุได้').toBe(false);
});

test('B4 — รายการที่หลุดเข้ามาหลังปิด PO ตัวเลขล้วน ต้องถูกจับได้', async ({ page }) => {
  await openWithNumericPo(page);
  // T1 ถูกสร้างหลัง closed_at ของ C1 → ต้องโผล่ใน lockLeaks
  const leaks = await page.evaluate(() =>
    document.querySelector('#app')._vnode.component.setupState.lockLeaks.map(t => t.id));
  expect(leaks, 'lockLeaks ต้องจับรายการที่หลุดหลังปิด PO ได้ ไม่ใช่เงียบหาย').toEqual(['T1']);
});

test('ของเกิน BOM ต้องหายอดสั่งของ PO ตัวเลขล้วนเจอ ไม่ใช่ขึ้นว่าไม่รู้ยอดสั่ง', async ({ page }) => {
  await openWithNumericPo(page);
  // orderQtyMap เป็นตัวภายใน ไม่ได้ส่งออกมา จึงตรวจผ่าน overOf ซึ่งเป็นสิ่งที่หน้าจอใช้จริง
  const h = await page.evaluate(([code]) => {
    const o = document.querySelector('#app')._vnode.component.setupState.overOf(code);
    return o && { noOrder: o.noOrder, order: o.lines[0] && o.lines[0].order };
  }, [CODE_IN_KIT]);

  expect(h, 'ควรมีสรุปของรหัสนี้').toBeTruthy();
  expect(h.order, 'orderQtyMap ถูก key ด้วยข้อความ แต่ถูกถามด้วย doc_ref — ต้องเป็นชนิดเดียวกัน').toBe(1700);
  expect(h.noOrder, 'ไม่ควรมีบรรทัดที่หายอดสั่งไม่เจอ').toBe(0);
});
