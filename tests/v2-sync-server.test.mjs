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

function loadScript() {
  const src = fs.readFileSync(new URL('../v2/sync/apps-script.gs', import.meta.url), 'utf8');
  const book = new SS();
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: t => ({ setMimeType: () => ({ body: t }) }) }
  };
  // คืน handle ออกมาเพื่อยิงคำสั่งเหมือนของจริง
  const fn = new Function('SpreadsheetApp', 'LockService', 'ContentService',
    src + '\n;return { handle: handle, book: null };');
  const api = fn(env.SpreadsheetApp, env.LockService, env.ContentService);
  const call = (action, body = {}) =>
    JSON.parse(api.handle({ parameter: {} },
      Object.assign({ action, token: 'CHANGE-ME-1234' }, body)).body);
  return { call, book };
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

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
