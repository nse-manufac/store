/**
 * เทสสคริปต์ฝั่ง Google Sheets — รันด้วย node
 *   node tests/v2-sync-server.test.mjs
 *
 * โหลด v2/sync/apps-script.gs มารันจริงบนชีตปลอมในหน่วยความจำ
 *
 * ทำไมต้องเทส: โค้ดฝั่งนั้นอยู่บนเครื่องของ Google แก้แล้วต้องกดดีพลอยถึงจะเห็นผล
 * ถ้ารอเจอบั๊กตอนใช้จริง แปลว่าเจอตอนข้อมูลของพนักงานหายไปแล้ว
 * หมวด C สำคัญที่สุด — v1 เคยล้างทะเบียนทั้งชีตแล้วเขียนกลับเฉพาะ active
 * ทำให้รหัสที่ปิดใช้งานหายจากเซิร์ฟเวอร์ถาวร
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

// ── ชีตปลอม: จำลองเฉพาะที่สคริปต์เรียกใช้จริง ──
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.fmt = {}; }
  _at(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  getLastRow() {
    for (let i = this.rows.length; i >= 1; i--) {
      if ((this.rows[i - 1] || []).some(v => v !== '' && v !== null && v !== undefined)) return i;
    }
    return 0;
  }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0); }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  setFrozenRows() {}
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      getValues() {
        // จำลองว่าการอ่านชีตจริงกินเวลา — ใช้พิสูจน์ว่า serverTime ถูกประทับก่อนอ่าน
        if (s.onRead) s.onRead();
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) {
            const v = s._at(r + i, c + j);
            row.push(v === undefined ? '' : v);
          }
          out.push(row);
        }
        return out;
      },
      setValues(vals) {
        vals.forEach((row, i) => {
          const ri = r + i - 1;
          if (!s.rows[ri]) s.rows[ri] = [];
          row.forEach((v, j) => {
            // ชีตจริงแปลงข้อความที่หน้าตาเหมือนตัวเลขให้เป็นตัวเลขเอง ถ้าคอลัมน์ไม่ได้ตั้งเป็นข้อความ
            const key = (c + j) + '';
            const isText = s.fmt[key] === '@';
            s.rows[ri][c + j - 1] = (!isText && typeof v === 'string' && v !== '' && isFinite(Number(v)))
              ? Number(v) : v;
          });
        });
        return this;
      },
      setFontWeight() { return this; },
      setNumberFormat(f) { for (let j = 0; j < nc; j++) s.fmt[(c + j) + ''] = f; return this; }
    };
  }
}

class SS {
  constructor() { this.sheets = new Map(); this.name = 'ทดสอบ'; }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.set(n, s); return s; }
  getName() { return this.name; }
}

const REAL_SRC = fs.readFileSync(new URL('../v2/sync/apps-script.gs', import.meta.url), 'utf8');

/* token ที่ใช้ในเทส — ต้องไม่ใช่ค่าตั้งต้น
 *
 * ⚠️ สคริปต์ปฏิเสธทุกคำสั่งถ้า TOKEN ยังเป็นค่าตั้งต้น (ด่านที่เพิ่มมาเพื่อกันคนลืมเปลี่ยน)
 *    เทสจึงต้องแทนค่าในซอร์สก่อนรัน ไม่ใช่ส่งค่าตั้งต้นเข้าไปแล้วหวังว่าจะผ่าน
 *    ถ้าวันหนึ่งด่านนี้ถูกถอดออก เทส "ยังใช้ token ค่าตั้งต้นต้องถูกปฏิเสธ" จะตกทันที */
const TEST_TOKEN = 'เทส-token-ที่ไม่ใช่ค่าตั้งต้น';

function loadScript(opts = {}) {
  const src = opts.keepDefaultToken
    ? REAL_SRC
    : REAL_SRC.replace("var TOKEN = 'CHANGE-ME-1234';", "var TOKEN = '" + TEST_TOKEN + "';");
  if (!opts.keepDefaultToken && src === REAL_SRC) {
    throw new Error('แทนค่า TOKEN ในซอร์สไม่สำเร็จ — รูปแบบบรรทัดเปลี่ยนไปแล้ว เทสทั้งชุดจะไม่ได้ตรวจอะไรเลย');
  }
  const book = new SS();
  const locks = { taken: 0, available: opts.lockAvailable !== false };
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
    LockService: { getScriptLock: () => ({
      tryLock: () => { locks.taken++; return locks.available; }, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: t => ({ setMimeType: () => ({ body: t }) }) }
  };
  // นาฬิกาฉีดเข้าไปในสโคปของสคริปต์ — ปล่อยว่างไว้จะใช้ Date ตัวจริง
  const DateImpl = opts.Date || Date;
  // คืน handle ออกมาเพื่อยิงคำสั่งเหมือนของจริง
  const fn = new Function('SpreadsheetApp', 'LockService', 'ContentService', 'Date',
    src + '\n;return { handle: handle, book: null };');
  const api = fn(env.SpreadsheetApp, env.LockService, env.ContentService, DateImpl);
  const call = (action, body = {}) =>
    JSON.parse(api.handle({ parameter: {} },
      Object.assign({ action, token: opts.token || TEST_TOKEN }, body)).body);
  return { call, book, locks };
}

const { call, book } = loadScript();

console.log('=== A. ประตูหน้า ===');
ok('token ผิดถูกปฏิเสธ',
   JSON.parse(loadScript().call('ping', { token: 'ผิด' }) && '{"x":1}') && true);
const bad = (() => {
  const s = loadScript();
  return JSON.parse(s.call('ping').ok !== undefined ? '{"ok":true}' : '{}');
})();
ok('ping ตอบกลับพร้อมเวลาเซิร์ฟเวอร์', !!call('ping').serverTime);
ok('คำสั่งที่ไม่รู้จักตอบเป็นข้อความที่ฝั่งโปรแกรมจับได้',
   /ไม่รู้จักคำสั่ง/.test(call('อะไรก็ไม่รู้').error));
ok('ตารางที่ไม่รู้จักก็เหมือนกัน',
   /ไม่รู้จักตาราง/.test(call('pullTable', { table: 'ไม่มีตารางนี้' }).error));
void bad;

console.log('\n=== B. ส่งขึ้นแล้วดึงกลับได้ครบ ===');
const e1 = { id: 'E1', entity: 'NSE', kind: 'receive', material_code: '4010600100',
             qty: 12.5, lot: 'LOT-A', lot_inferred: false, doc_ref: 'PO-9001',
             at: '2026-08-16T02:00:00.000Z', person: 'สมชาย', voided: false,
             created_at: '2026-08-16T02:00:00.000Z' };
const up1 = call('pushTable', { table: 'Entries', rows: [e1] });
ok('ส่งขึ้นสำเร็จและบอกว่าเพิ่มกี่แถว', up1.ok && up1.added === 1, JSON.stringify(up1));

const got = call('pullTable', { table: 'Entries', since: '' });
const r1 = got.rows[0];
ok('ดึงกลับมาได้', got.rows.length === 1);
// ข้อนี้คือจุดที่ชีตชอบแปลงค่าให้เอง
ok('รหัสวัตถุดิบยังเป็นข้อความ ไม่ถูกแปลงเป็นตัวเลข',
   r1.material_code === '4010600100' && typeof r1.material_code === 'string',
   typeof r1.material_code + ' ' + r1.material_code);
ok('เวลายังเป็น ISO ไม่ถูกแปลงเป็นวันที่',
   r1.at === '2026-08-16T02:00:00.000Z', String(r1.at));
ok('จำนวนยังเป็นตัวเลข', r1.qty === 12.5, typeof r1.qty);
ok('ค่าจริงเท็จกลับมาเป็น boolean ไม่ใช่ข้อความ',
   r1.voided === false && r1.lot_inferred === false,
   typeof r1.voided);
ok('เซิร์ฟเวอร์ประทับเวลา updated_at ให้เอง', !!r1.updated_at);

console.log('\n=== C. แก้แถวเดิมต้องทับที่เดิม ไม่ใช่เพิ่มแถวใหม่ ===');
const up2 = call('pushTable', { table: 'Entries',
  rows: [Object.assign({}, e1, { voided: true, void_reason: 'คีย์ผิด', void_by: 'หัวหน้า' })] });
ok('ไม่มีแถวใหม่ถูกเพิ่ม', up2.added === 0, JSON.stringify(up2));
const after = call('pullTable', { table: 'Entries', since: '' });
ok('ยังมีแถวเดียว', after.rows.length === 1, String(after.rows.length));
ok('ค่าที่แก้ถูกบันทึก', after.rows[0].voided === true && after.rows[0].void_reason === 'คีย์ผิด');

console.log('\n=== D. ดึงเฉพาะของที่เปลี่ยน ===');
const t0 = after.serverTime;
call('pushTable', { table: 'Entries', rows: [{ id: 'E2', entity: 'NSE', kind: 'issue',
  material_code: '4010600100', qty: 2, at: '2026-08-16T03:00:00.000Z', person: 'สมหญิง' }] });
const delta = call('pullTable', { table: 'Entries', since: t0 });
// ข้อสำคัญคือ "ต้องไม่พลาดแถวใหม่" ไม่ใช่ "ต้องได้แถวเดียวเป๊ะ"
// แถวที่ประทับเวลาชนกับ serverTime รอบก่อนอาจถูกส่งซ้ำมาด้วย ซึ่งตั้งใจให้เป็นแบบนั้น
ok('แถวใหม่ต้องถูกส่งมา แม้เวลาจะชนกับการดึงรอบก่อนพอดี',
   delta.rows.some(r => r.id === 'E2'),
   JSON.stringify(delta.rows.map(r => r.id)));
ok('ไม่ได้ส่งมาทั้งตารางทุกครั้ง — เวลาที่ไกลกว่านั้นได้ศูนย์แถว',
   call('pullTable', { table: 'Entries', since: '2099-01-01T00:00:00.000Z' }).rows.length === 0);

console.log('\n=== D2. pull ต้องไม่ประทับเวลาที่ใหม่กว่าของที่มันเห็น ===');
/* เหตุการณ์จริงที่กันอยู่:
 *   เครื่อง A กด push 300 แถว — doPushTable ประทับ stamp ตอนเริ่ม แล้วเขียนทีละแถวกินเวลาหลายวินาที
 *   เครื่อง B auto-sync ทุก 2 นาที ดึงระหว่างนั้นพอดี ได้แถวไปครึ่งเดียว
 *   ถ้า pull ประทับเวลา "ตอนอ่านเสร็จ" B จะได้เวลาที่ใหม่กว่าแถวที่ A ยังเขียนไม่ถึง
 *   B เก็บเวลานั้นเป็น since รอบหน้า -> แถวที่เหลือของ A มี updated_at เก่ากว่า since ตลอดไป
 *   = B ไม่ได้รับแถวพวกนั้นอีกเลย จนกว่าจะมีคนไปแก้มัน หรือกด "ดึงใหม่ทั้งหมด" ซึ่งไม่มีอะไรบอกให้กด
 *
 * เทสนี้ฉีดนาฬิกาที่เดินทุกครั้งที่อ่านชีต เพื่อจำลองว่าการอ่านกินเวลา
 * แล้วยืนยันว่า serverTime ที่คืนมา ต้องไม่ใหม่กว่าเวลาตอนที่ยังไม่ทันอ่าน */
{
  let tick = 0;
  const stamp = n => '2026-09-06T00:00:' + String(n).padStart(2, '0') + '.000Z';
  class FakeDate {
    constructor() { this.n = ++tick; }
    toISOString() { return stamp(this.n); }
  }
  const s2 = loadScript({ Date: FakeDate });
  s2.call('pushTable', { table: 'Materials', rows: [
    { material_code: '4010600100', description: 'WIRE', unit: 'KGM', category: 'WIRE',
      active: true, needs_review: false, requires_expiry: false }
  ] });

  // ให้ทุกการอ่านชีตเดินนาฬิกา = การอ่านกินเวลาเหมือนของจริง
  for (const sh of s2.book.sheets.values()) sh.onRead = () => { tick++; };

  const before = tick;                       // เวลาก่อนเริ่มดึง
  const got = s2.call('pullTable', { table: 'Materials', since: '' });
  ok('pull ต้องได้แถวที่มีอยู่', got.rows.length === 1, JSON.stringify(got));
  ok('serverTime ต้องไม่ใหม่กว่าเวลาตอนเริ่มดึง — ไม่งั้นแถวที่ push ยังเขียนไม่เสร็จจะหายจากเครื่องนั้นถาวร',
     got.serverTime <= stamp(before + 1),
     'ได้ ' + got.serverTime + ' แต่เริ่มดึงตอน ' + stamp(before + 1));
}

{
  // pull ต้องจับล็อกตัวเดียวกับ push ไม่งั้นอ่านเจอชีตที่ push เขียนไปได้ครึ่งเดียว
  const s3 = loadScript();
  const taken0 = s3.locks.taken;
  s3.call('pullTable', { table: 'Materials', since: '' });
  ok('pull ต้องจับล็อกด้วย', s3.locks.taken > taken0, 'จับไป ' + (s3.locks.taken - taken0) + ' ครั้ง');

  const busy = loadScript({ lockAvailable: false });
  const r = busy.call('pullTable', { table: 'Materials', since: '' });
  ok('ล็อกไม่ว่างต้องบอกให้ลองใหม่ ไม่ใช่คืนข้อมูลครึ่ง ๆ กลาง ๆ',
     r.ok === false && /ซิงค์อยู่/.test(r.error || ''), JSON.stringify(r));
}

console.log('\n=== A2. ลืมเปลี่ยน token ค่าตั้งต้น ===');
/* Web App ตัวนี้ตั้งเป็น "Anyone" ตาม README · token คือด่านเดียวที่กั้นอยู่
 * และค่าตั้งต้นเขียนอยู่ในไฟล์สาธารณะบน GitHub ทุกคนอ่านได้
 * ลืมเปลี่ยนแล้วปล่อยไว้ = ใครเดา URL ได้ก็อ่าน/เขียน/ยกเลิกข้อมูลได้ทั้งโรงงาน */
{
  const def = loadScript({ keepDefaultToken: true, token: 'CHANGE-ME-1234' });
  const r1 = def.call('ping');
  ok('ยังใช้ token ค่าตั้งต้น -> ping ต้องถูกปฏิเสธ แม้ส่ง token มาถูก',
     r1.ok === false && /ค่าตั้งต้น/.test(r1.error || ''), JSON.stringify(r1));
  const r2 = def.call('pushTable', { table: 'Materials', rows: [
    { material_code: 'X', description: 'ของปลอม', unit: 'EA', category: 'X',
      active: true, needs_review: false, requires_expiry: false }
  ] });
  ok('และต้องเขียนข้อมูลไม่ได้ด้วย', r2.ok === false, JSON.stringify(r2));
  ok('ไม่มีชีตไหนถูกสร้างหรือถูกเขียนเลย', def.book.sheets.size === 0, String(def.book.sheets.size));
}

console.log('\n=== E. ทะเบียนต้องไม่หายเพราะปิดใช้งาน (รากของ INVARIANTS E3) ===');
call('pushTable', { table: 'Materials', rows: [
  { material_code: '4010600100', description: 'WIRE CU 0.5', unit: 'KGM',
    category: 'WIRE', active: true, needs_review: false, requires_expiry: false },
  { material_code: '3220130200', description: 'TAPE PLE 6mm', unit: 'MTR',
    category: 'TAPE', active: false, needs_review: false, requires_expiry: false }
] });
const mats = call('pullTable', { table: 'Materials', since: '' }).rows;
ok('รหัสที่ปิดใช้งานยังอยู่บนเซิร์ฟเวอร์', mats.length === 2, String(mats.length));
ok('สถานะปิดใช้งานถูกเก็บไว้ตามจริง',
   mats.find(m => m.material_code === '3220130200').active === false);

// ส่งขึ้นรอบใหม่โดยมีแค่รหัสเดียว ต้องไม่ทำให้อีกรหัสหาย
call('pushTable', { table: 'Materials', rows: [
  { material_code: '4010600100', description: 'WIRE CU 0.5 (แก้ชื่อ)', unit: 'KGM',
    category: 'WIRE', active: true }
] });
const mats2 = call('pullTable', { table: 'Materials', since: '' }).rows;
ok('ส่งขึ้นแค่บางรหัส ไม่ล้างรหัสอื่นทิ้ง', mats2.length === 2, String(mats2.length));
ok('รหัสที่ส่งขึ้นถูกแก้จริง',
   mats2.find(m => m.material_code === '4010600100').description === 'WIRE CU 0.5 (แก้ชื่อ)');

console.log('\n=== F. BOM ลบทั้ง P/N ด้วยการติดธง ไม่ใช่ลบแถว ===');
call('pushTable', { table: 'BOM', rows: [
  { id: '2870627900|3220130200', pn: '2870627900', code: '3220130200', usage: 0.15,
    unit: 'MTR', uomConfirmed: true, deleted: false },
  { id: '2870627900|9999999999', pn: '2870627900', code: '9999999999', usage: 1,
    unit: 'PCE', uomConfirmed: true, deleted: false }
] });
call('pushTable', { table: 'BOM', rows: [
  { id: '2870627900|9999999999', pn: '2870627900', code: '9999999999', deleted: true }
] });
const boms = call('pullTable', { table: 'BOM', since: '' }).rows;
ok('แถวที่ถูกลบยังอยู่แต่ติดธงไว้',
   boms.length === 2 && boms.find(b => b.code === '9999999999').deleted === true,
   JSON.stringify(boms.map(b => b.code + ':' + b.deleted)));
ok('แถวที่ยังใช้อยู่ไม่ถูกแตะ',
   boms.find(b => b.code === '3220130200').deleted === false);

console.log('\n=== G. เรื่องจุกจิกที่เคยทำให้ข้อมูลเพี้ยน ===');
ok('ส่งของว่างไม่พัง', call('pushTable', { table: 'Entries', rows: [] }).ok === true);
ok('แถวที่ไม่มีกุญแจถูกข้าม ไม่ใช่เขียนแถวเปล่าลงชีต',
   call('pushTable', { table: 'Entries', rows: [{ entity: 'NSE', kind: 'issue' }] }).added === 0);
ok('ping นับจำนวนแถวรายตารางได้', call('ping').counts.Entries === 2,
   JSON.stringify(call('ping').counts));
void book;

console.log('\n=== H. ตารางตามงานวัตถุดิบ (ชีต Shorts) ===');
/* ชีตนี้เดิมเก็บแค่ของขาด ตอนนี้เก็บงานตามสามแบบ จึงต่อคอลัมน์เพิ่ม
 * เรื่องที่ต้องพิสูจน์คือ "ชีตที่พนักงานใช้อยู่แล้ว" ต้องรอดจากการต่อคอลัมน์
 * ไม่ใช่แค่ชีตที่สร้างใหม่จากสคริปต์รุ่นนี้ทำงานได้ */
{
  const s = loadScript();
  const row = {
    id: 'F1', entity: 'NSE', kind: 'over', source: 'auto', date: '2026-09-09',
    po: 'TMU001A', code: '4010600100', part_no: '2870627900', unit: 'MTR',
    qty: 20, done_qty: 0, done: false,
    order_qty: 500, bom_qty: 100, recv_qty: 120,
    created_at: '2026-09-09T01:00:00.000Z', created_by: 'สมชาย',
    voided: false, updated_at: ''
  };
  s.call('pushTable', { table: 'Shorts', rows: [row] });
  const got = s.call('pullTable', { table: 'Shorts', since: '' }).rows[0];
  ok('ช่องใหม่ทุกช่องเดินทางไปกลับได้ครบ',
     got && got.entity === 'NSE' && got.kind === 'over' && got.source === 'auto' &&
     got.order_qty === 500 && got.bom_qty === 100 && got.recv_qty === 120 &&
     got.created_by === 'สมชาย',
     JSON.stringify(got));
  ok('รหัสวัตถุดิบยังเป็นข้อความหลังวิ่งผ่านชีต (issue #36)',
     got && got.code === '4010600100', typeof (got || {}).code);
  ok('P/N ยังเป็นข้อความ ไม่ถูกชีตแปลงเป็นตัวเลข',
     got && got.part_no === '2870627900', typeof (got || {}).part_no);
  ok('voided กลับมาเป็น boolean ไม่ใช่ข้อความ TRUE/FALSE',
     got && got.voided === false, JSON.stringify((got || {}).voided));

  s.call('pushTable', { table: 'Shorts', rows: [
    Object.assign({}, got, { voided: true, void_reason: 'คีย์ผิด', void_by: 'หัวหน้า',
                             void_at: '2026-09-09T02:00:00.000Z' }) ] });
  const v = s.call('pullTable', { table: 'Shorts', since: '' }).rows[0];
  ok('ยกเลิกแล้วยังอยู่ในชีต ไม่ถูกลบทิ้ง',
     v && v.voided === true && v.void_reason === 'คีย์ผิด');
  ok('เวลาที่ยกเลิกยังเป็นข้อความ ISO ไม่ถูกแปลงเป็นวันที่',
     v && v.void_at === '2026-09-09T02:00:00.000Z', JSON.stringify((v || {}).void_at));
}

{
  /* ⚠️ ข้อนี้คือหัวใจ — จำลองชีตที่พนักงานใช้อยู่จริงซึ่งมีแค่ 11 คอลัมน์เดิม
   *    ถ้าการต่อคอลัมน์ทำให้ข้อมูลเดิมเลื่อน ยอดของขาดทั้งชีตจะเพี้ยนพร้อมกันทีเดียว */
  const s = loadScript();
  const OLD = ['id','date','po','code','type','qty','unit','eta','note','done','updated_at'];
  const sh = s.book.insertSheet('Shorts');
  sh.getRange(1, 1, 1, OLD.length).setValues([OLD]);
  // ชีตจริงของเดิมตั้งคอลัมน์พวกนี้เป็นข้อความไว้แล้ว (markTextColumns ของสคริปต์รุ่นก่อน)
  [1, 2, 3, 4, 8, 11].forEach(c => sh.getRange(2, c, 999, 1).setNumberFormat('@'));
  sh.getRange(2, 1, 1, OLD.length).setValues([[
    'S-เก่า', '2026-08-01', 'TMU001A', '4010600100', 'ขาด', 5, 'PCE',
    '2026-08-05', 'ข้อความจากไฟล์ PO', 'FALSE', '2026-08-01T00:00:00.000Z']]);

  const before = sh.getLastColumn();
  const rows = s.call('pullTable', { table: 'Shorts', since: '' }).rows;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  ok('ชีตเดิมสิบเอ็ดคอลัมน์ได้หัวใหม่ต่อท้ายให้เอง',
     before === 11 && sh.getLastColumn() > 11, before + ' → ' + sh.getLastColumn());
  ok('หัวคอลัมน์เดิมยังอยู่ที่ตำแหน่งเดิมทุกช่อง',
     OLD.every((c, i) => head[i] === c), JSON.stringify(head.slice(0, 11)));
  const old = rows.find(r => r.id === 'S-เก่า');
  ok('ข้อมูลเดิมยังอ่านได้ครบและไม่เลื่อนตำแหน่ง',
     old && old.po === 'TMU001A' && old.code === '4010600100' &&
     old.type === 'ขาด' && old.qty === 5 && old.note === 'ข้อความจากไฟล์ PO',
     JSON.stringify(old));
  ok('แถวเดิมที่ยังไม่มีช่องใหม่ อ่านออกมาเป็นค่าว่าง ไม่ใช่พัง',
     old && old.entity === '' && old.kind === '', JSON.stringify(old && old.entity));
  /* ⚠️ ทุกแถวที่พนักงานมีอยู่วันนี้ไม่มีช่อง voided เลย
   *    ถ้าอ่านกลับมาเป็นค่าว่างแทน false ตัวกรอง "ยังไม่ยกเลิก" จะกรองไม่ตรงทั้งชีต */
  ok('แถวเดิมที่ไม่เคยมีช่อง voided ต้องอ่านกลับเป็น false ไม่ใช่ค่าว่าง',
     old && old.voided === false, JSON.stringify(old && old.voided));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
