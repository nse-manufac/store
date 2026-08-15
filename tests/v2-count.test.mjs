/**
 * เทสการนับของ — รันด้วย node
 *   node tests/v2-count.test.mjs
 *
 * หมวด A คือข้อที่สำคัญที่สุด — ใบนับต้องไม่มีตัวเลขของระบบติดไปด้วย
 * ถ้าข้อนั้นตก การนับทั้งรอบจะกลายเป็นการยืนยันตัวเลขเดิม แล้วเสียแรงเปล่าทั้งหมด
 */
import { makeSession, sheetRows, planCount, planSummary, postCount, STATUS } from '../v2/core/count.js';
import { balances } from '../v2/core/balance.js';
import { makeEntry, signedQty } from '../v2/core/ledger.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};
const throws = (name, fn, want) => {
  try { fn(); ok(name, false, 'ไม่โยน error'); }
  catch (e) { ok(name, !want || e.message.includes(want), e.message); }
};

const E = 'NSE';
const mats = [
  { material_code: '3220130200', description: 'TAPE PLE 6mm', unit: 'MTR', category: 'TAPE', active: true },
  { material_code: '4010600100', description: 'WIRE CU 0.5', unit: 'KGM', category: 'WIRE', active: true },
  { material_code: '3512142900', description: 'CARTON PAPER', unit: 'PCE', category: 'PACKING', active: true },
  { material_code: '9999999900', description: 'ของเลิกใช้แล้ว', unit: 'PCE', category: 'OTHER', active: false }
];

console.log('=== A. ใบนับต้องไม่มีตัวเลขของระบบ ===');
const sheet = sheetRows(mats);
ok('ได้เฉพาะของที่ใช้งานอยู่', sheet.length === 3, String(sheet.length));
const keys = new Set(sheet.flatMap(r => Object.keys(r)));
ok('มีแค่ รหัส ชื่อ หน่วย หมวด',
   [...keys].sort().join(',') === 'category,code,desc,unit', [...keys].sort().join(','));
ok('ไม่มีคำว่า qty/book/balance หลุดมา',
   !['qty', 'book', 'balance', 'counted'].some(k => keys.has(k)));
ok('เรียงตามหมวดแล้วรหัส เพื่อให้เดินนับทีละชั้นได้',
   sheet[0].category <= sheet[1].category);
ok('กรองตามหมวดได้', sheetRows(mats, { category: 'TAPE' }).length === 1);
ok('กรองด้วยคำค้นได้', sheetRows(mats, { scope: 'CARTON' }).length === 1);

console.log('\n=== B. สร้างรอบนับ ===');
const s = makeSession({ entity: E, person: 'สมชาย', name: 'นับเปิดระบบ' });
ok('สถานะเริ่มเป็นกำลังนับ', s.status === 'open' && STATUS.open === 'กำลังนับ');
ok('ยังไม่มีของที่นับ', Object.keys(s.counted).length === 0);
throws('ไม่มีนิติบุคคลไม่ผ่าน', () => makeSession({ person: 'ก' }), 'นิติบุคคล');
throws('ไม่มีคนนับไม่ผ่าน', () => makeSession({ entity: E }), 'คนนับ');

console.log('\n=== C. เปิดระบบ — ยังไม่มีประวัติเลย ต้องลงเป็นยกยอดมา ===');
s.counted = { '3220130200': { qty: 47 }, '4010600100': { qty: 2.5 }, '3512142900': { qty: 0 } };
let rows = planCount(s, { balances: new Map(), codesWithHistory: new Set() });
ok('ของที่นับได้ลงเป็นยกยอดมา',
   rows.filter(r => r.kind === 'open').length === 2, JSON.stringify(rows.map(r => r.kind)));
ok('นับได้ศูนย์ไม่ต้องลงอะไร',
   rows.find(r => r.code === '3512142900').kind === null);
const posted = postCount(s, rows, { device: 'PC1' });
ok('ได้รายการลงสมุด 2 รายการ', posted.length === 2);
ok('เป็นชนิดยกยอดมา', posted.every(e => e.kind === 'open'));
ok('ผูกกับรอบนับไว้', posted[0].doc_kind === 'count' && posted[0].doc_ref === s.id);
ok('ยอดหลังลงบัญชีเท่าที่นับได้',
   balances(posted, E).get('3220130200') === 47,
   String(balances(posted, E).get('3220130200')));

console.log('\n=== D. นับรอบถัดไป — มีประวัติแล้ว ต้องลงเป็นปรับยอด ===');
const led = [
  makeEntry({ entity: E, person: 'ก', kind: 'open', material_code: '3220130200', qty: 47 }),
  makeEntry({ entity: E, person: 'ก', kind: 'issue', material_code: '3220130200', qty: 5 })
];
const bal = balances(led, E);
ok('ยอดในสมุดคือ 42', bal.get('3220130200') === 42, String(bal.get('3220130200')));

const s2 = makeSession({ entity: E, person: 'สมหญิง' });
s2.counted = { '3220130200': { qty: 40, note: 'นับสองรอบแล้ว' } };
const rows2 = planCount(s2, { balances: bal, codesWithHistory: new Set(['3220130200']) });
ok('ลงเป็นปรับยอด ไม่ใช่ยกยอดมา', rows2[0].kind === 'adjust', rows2[0].kind);
ok('ส่วนต่างคือ −2', rows2[0].delta === -2, String(rows2[0].delta));
const posted2 = postCount(s2, rows2);
ok('เก็บทั้งที่นับได้และยอดในสมุด',
   posted2[0].counted_qty === 40 && posted2[0].delta === -2,
   JSON.stringify({ c: posted2[0].counted_qty, d: posted2[0].delta }));
ok('เหตุผลถูกตั้งเป็นนับได้ไม่ตรง', posted2[0].reason_code === 'count');
ok('หมายเหตุของคนนับติดไปด้วย', posted2[0].note.includes('นับสองรอบแล้ว'));
ok('ยอดรวมหลังปรับเท่าที่นับได้',
   balances([...led, ...posted2], E).get('3220130200') === 40,
   String(balances([...led, ...posted2], E).get('3220130200')));

console.log('\n=== E. รหัสที่เคยมีประวัติแต่ยอดเหลือศูนย์ ===');
// รับเข้าแล้วจ่ายออกหมด ยอดเป็นศูนย์ แต่มีประวัติ — ถ้าตัดสินด้วยยอดจะลง open ทับซึ่งผิด
const led0 = [
  makeEntry({ entity: E, person: 'ก', kind: 'open', material_code: '4010600100', qty: 10 }),
  makeEntry({ entity: E, person: 'ก', kind: 'issue', material_code: '4010600100', qty: 10 })
];
const s3 = makeSession({ entity: E, person: 'ก' });
s3.counted = { '4010600100': { qty: 3 } };
const rows3 = planCount(s3, { balances: balances(led0, E),
                              codesWithHistory: new Set(['4010600100']) });
ok('ยอดศูนย์แต่มีประวัติ ต้องลงเป็นปรับยอด', rows3[0].kind === 'adjust', rows3[0].kind);
ok('ส่วนต่างคือ +3', rows3[0].delta === 3, String(rows3[0].delta));

console.log('\n=== F. นับได้ตรงกับสมุด ไม่ต้องลงอะไร ===');
const s4 = makeSession({ entity: E, person: 'ก' });
s4.counted = { '3220130200': { qty: 42 } };
const rows4 = planCount(s4, { balances: bal, codesWithHistory: new Set(['3220130200']) });
ok('ไม่สร้างรายการ', rows4[0].kind === null && postCount(s4, rows4).length === 0);

console.log('\n=== G. เทียบกับตัวเลขอ้างอิงจากระบบเดิม ===');
// ยอดจาก v1 เอามาเทียบอย่างเดียว ไม่เข้าสมุด — ตัวเลขที่บอกว่าของเดิมเพี้ยนแค่ไหน
const s5 = makeSession({ entity: E, person: 'ก' });
s5.counted = { '3220130200': { qty: 47 }, '4010600100': { qty: 2 }, '3512142900': { qty: 8 } };
const ref = new Map([['3220130200', 47], ['4010600100', 5], ['3512142900', 8]]);
const rows5 = planCount(s5, { balances: new Map(), codesWithHistory: new Set(), reference: ref });
const sum5 = planSummary(rows5);
ok('เทียบครบทุกตัวที่มีค่าอ้างอิง', sum5.refChecked === 3, String(sum5.refChecked));
ok('นับได้ตรงกับของเดิม 2 ตัว', sum5.refMatch === 2, String(sum5.refMatch));
ok('ไม่ตรง 1 ตัว', sum5.refOff === 1, String(sum5.refOff));
ok('บอกส่วนต่างรายตัวได้',
   rows5.find(r => r.code === '4010600100').refDelta === -3,
   String(rows5.find(r => r.code === '4010600100').refDelta));
ok('ตัวเลขอ้างอิงไม่กลายเป็นรายการในสมุด',
   postCount(s5, rows5).every(e => e.kind === 'open'));

console.log('\n=== H. สรุปแผนก่อนกด ===');
const sum = planSummary(rows);
ok('นับไปกี่รหัส', sum.counted === 3);
ok('จะลงยกยอดมากี่ตัว', sum.open === 2);
ok('ตรงกันแล้วกี่ตัว', sum.same === 1);
const sum2 = planSummary(rows2);
ok('แยกปรับขึ้นกับปรับลง', sum2.down === 1 && sum2.up === 0);

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
