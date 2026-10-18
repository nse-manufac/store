/**
 * เทสการนับของ — รันด้วย node
 *   node tests/v2-count.test.mjs
 *
 * หมวด A คือข้อที่สำคัญที่สุด — ใบนับต้องไม่มีตัวเลขของระบบติดไปด้วย
 * ถ้าข้อนั้นตก การนับทั้งรอบจะกลายเป็นการยืนยันตัวเลขเดิม แล้วเสียแรงเปล่าทั้งหมด
 */
import { makeSession, sheetRows, planCount, planSummary, postCount, STATUS,
         parseCountSheet, matchCountRows, missingFromFile } from '../v2/core/count.js';
import { balances, balancesAt } from '../v2/core/balance.js';
import { atFromDateTime, localDate, localTime } from '../v2/core/localtime.js';
import fs from 'node:fs';
import { entityOfPo } from '../v2/master/entities.js';
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

console.log('\n=== นำเข้ายอดนับจากไฟล์ Delta (เจ้าของสั่ง 17 ต.ค. 2026) ===');
{
  // ไฟล์สมมติหน้าตาเหมือนชีตของ Delta: ITEM · MATERIAL NO · MATERIAL DESCRIPTION · QTY · REMARK + เส้นคั่น + GRAND TOTAL
  const aoa = [
    ['ITEM', 'MATERIAL NO', 'MATERIAL DESCRIPTION', 'QTY', 'REMARK'],
    [1, 910000001, 'ของเลข 9 หลัก', 12, ''],          // Excel ตัด 0 ข้างหน้าของ 0910000001
    [2, 9100000101, 'TAPE', 5.25, ''],
    [3, '9100000102 ', 'BOBBIN', '1,200', ''],        // ข้อความ · เว้นวรรค · คอมมา
    [4, 9100000101, 'TAPE อีกที่', 1, ''],            // ซ้ำ = รวมยอด
    [5, '91000001R0', 'ลงท้ายตัวอักษร', 3, ''],       // ไม่มีในทะเบียน
    [6, 9100000103, 'ยอดว่าง', null, ''],
    [7, 9100000104, 'ติดลบ', -2, ''],
    [null, null, null, null, null],
    [null, null, null, '==========', null],
    [null, null, null, 'GRAND TOTAL AMOUNT :', null],
    [99, 9100000105, 'หลัง GRAND TOTAL ห้ามอ่าน', 7, '']
  ];
  const p = parseCountSheet(aoa);
  ok('หาหัวคอลัมน์จากชื่อ · อ่านรหัสตัวเลข/ข้อความ/คอมมา', p.header === 1 && p.rows.some(r => r.code === '9100000102' && r.qty === 1200));
  ok('รหัสซ้ำในไฟล์ = รวมยอด และรายงาน', p.rows.find(r => r.code === '9100000101').qty === 6.25
     && p.dups.length === 1 && p.dups[0].lines.join() === '3,5');
  ok('ยอดว่าง / ติดลบ = รายงานเป็นข้อผิด ไม่เดาเป็นศูนย์', p.errors.length === 2 && !p.rows.some(r => r.code === '9100000103' || r.code === '9100000104'),
     JSON.stringify(p.errors));
  ok('เส้นคั่น "=====" ไม่ใช่ข้อผิด · หยุดที่ GRAND TOTAL', !p.rows.some(r => r.code === '9100000105') && !p.errors.some(e => e.line === 10));
  const swapped = parseCountSheet([['x'], ['QTY', 'remark', 'Material No'], [4, '', 'A1']]);
  ok('สลับคอลัมน์ได้ · หัวตารางไม่ได้อยู่แถวแรก', swapped.rows.length === 1 && swapped.rows[0].code === 'A1' && swapped.rows[0].qty === 4);
  ok('ชีตผิด (ไม่มีหัว) = บอกให้ตรวจชีต', parseCountSheet([['Plant', 'P/N']]).header === -1
     && /เลือกชีตผิด/.test(parseCountSheet([['Plant']]).errors[0].why));

  const known = new Set(['0910000001', '9100000101', '9100000102']);
  const m = matchCountRows(p.rows, known);
  ok('รหัส 9 หลักที่ไม่มีในทะเบียน แต่เติม 0 แล้วมี = จับคู่ และบอกว่าเติม', m.matched.some(x => x.code === '0910000001' && x.padded && x.fileCode === '910000001'));
  ok('ลงท้ายตัวอักษร / ไม่มีในทะเบียน = unknown ไม่เดา', m.unknown.length === 1 && m.unknown[0].code === '91000001R0');
  ok('รหัสที่มีในทะเบียนตรงเป๊ะ ไม่เติม 0', !m.matched.find(x => x.code === '9100000101').padded);

  const book = new Map([['9100000101', 6], ['9100000199', 3], ['9100000198', 0], ['9100000197', -1],
                        ['91000001R0', 8]]);
  const miss = missingFromFile(book, m);
  ok('ระบบมีของ (ยอด ≠ 0) แต่ไม่อยู่ในไฟล์ = ขึ้นรายการ · ยอด 0 ไม่ขึ้น', miss.map(x => x.code).join() === '9100000197,9100000199');
  // รหัสที่อยู่ในไฟล์แต่ยังไม่มีในทะเบียน (unknown) ก็คือ Delta นับมาให้แล้ว
  // ถ้าหลุดไปอยู่ในตาราง "ไม่อยู่ในไฟล์" คนกด "ติ๊กทั้งหมด" จะล้างยอดจริง 8 ทิ้งเป็น 0
  ok('รหัสที่อยู่ในไฟล์แต่ไม่มีในทะเบียน (unknown) ไม่โผล่ในรายการ "ไม่อยู่ในไฟล์"',
     !miss.some(x => x.code === '91000001R0'), JSON.stringify(miss));

  // ยอด ณ เวลานับ — ของที่เข้าออกหลังนับต้องไม่ถูกปรับทิ้ง
  const E = 'TUE-H';
  const t = h => `2026-10-17T0${h}:00:00.000Z`;
  const es = [
    makeEntry({ entity: E, kind: 'receive', material_code: 'A1', qty: 100, lot: 'L', doc_kind: 'po', doc_ref: 'PO1', person: 'ก', at: t(1) }),
    makeEntry({ entity: E, kind: 'issue', material_code: 'A1', qty: 20, doc_kind: 'po', doc_ref: 'PO1', person: 'ก', at: t(5) })
  ];
  const countAt = t(3);
  ok('ยอด ณ เวลานับไม่รวมรายการหลังเวลานั้น', balancesAt(es, E, countAt).get('A1') === 100 && balances(es, E).get('A1') === 80);
  ok('ไม่มีเวลา = ว่าง (ไม่ใช่ยอดทั้งหมด)', balancesAt(es, E, '').size === 0);
  const s1 = makeSession({ entity: E, person: 'ก' });
  s1.counted.A1 = { qty: 95, note: '' };
  s1.count_at = countAt;
  const plan = planCount(s1, { balances: balancesAt(es, E, countAt), codesWithHistory: new Set(['A1']) });
  ok('เทียบกับยอด ณ เวลานับ: 100 → 95 = ปรับ −5 (ไม่ใช่ 80 → 95)', plan[0].kind === 'adjust' && plan[0].delta === -5, JSON.stringify(plan[0]));
  const posted = postCount(s1, plan, { device: 'X' });
  const after = balances([...es, ...posted], E).get('A1');
  ok('ลงรายการปรับยอด ณ เวลานับ · ยอดตอนนี้ = 95 − 20 = 75', posted[0].at === countAt && after === 75, `${posted[0].at} · ${after}`);
  const s2 = makeSession({ entity: E, person: 'ก' });
  ok('รอบนับแบบเดิม (ไม่มีเวลานับ) ลง ณ ตอนนี้เหมือนเดิม', postCount(s2, [{ code: 'A1', kind: 'adjust', counted: 1, book: 0, delta: 1, note: '' }])[0].at.slice(0, 16) === new Date().toISOString().slice(0, 16));

  const iso = atFromDateTime('2026-10-17', '09:30');
  ok('วันที่ + เวลาที่คนเลือก → ISO ที่แปลงกลับได้วัน/เวลาเดิม', localDate(iso) === '2026-10-17' && localTime(iso).startsWith('09:30'), iso);
  ok('วันหรือเวลาผิด = ว่าง', atFromDateTime('2026-02-30', '09:00') === '' && atFromDateTime('2026-10-17', '25:00') === ''
     && atFromDateTime('', '09:00') === '' && atFromDateTime('2026-10-17', '') === '');

  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: แผนลงบัญชีใช้ยอด ณ เวลานับเมื่อรอบมีเวลานับ · นิติบุคคลมาจากรอบนับ (A3)',
     /balancesAt\(entries\.value, cs\.value\.entity, cs\.value\.count_at\)/.test(app) && /csAtBook\.value \|\| bookBalances\.value/.test(app));
  ok('จอ: ส่งผลจับคู่ทั้งก้อนเข้า missingFromFile (ไม่ใช่ Set ของ matched อย่างเดียว)',
     /missingFromFile\(book, match, parsed\)/.test(app) && !/missingFromFile\([^)]*matched\.map/.test(app));
  ok('จอ: ปุ่มนำเข้า · ป้ายนิติบุคคล · รายการไม่อยู่ในไฟล์ไม่ติ๊กเป็นค่าตั้งต้น · ต้องใส่เวลานับ',
     html.includes('@click="ciOpen"') && html.includes('ลงกับนิติบุคคล <b>{{ cs.entity }}</b>') && html.includes('v-model="ci.tick[m.code]"')
     && /tick: \{\}/.test(app) && /ใส่วันที่และเวลาที่ Delta นับ/.test(app));
}

console.log('\n=== ฟอร์ม WIP: หลายนิติบุคคลในไฟล์เดียว · QTY หรือ Vendor Stk (เจ้าของสั่ง 18 ต.ค. 2026) ===');
{
  // ชีตสมมติหน้าตาเหมือน WIP: หนึ่งรหัสหลายแถว (แถวละ PO) · Vendor Stk แถวแรก · ตัวอักษรนิติบุคคลคอลัมน์ท้ายไม่มีหัว
  const H = ['Material', 'Description', 'UOM', 'Vendor', 'Vendor Stk', 'PO No.', 'SB Part', 'Req. Date', 'QTY', 'ACT', 'REMARK ', 'PO', null];
  const row = (code, desc, stk, po, qty, letter) => [code, desc, 'PCE', 900001, stk, po, 1, 46300, qty, 0, null, 'TM5', letter];
  const aoa = [H,
    row(9100000201, 'ของ H ล้วน', 50, 'TM0001H001', 12, 'H'),
    row(9100000201, null, null, 'TM0001H002', 8, 'H'),
    [],
    row(9100000202, 'ปน A กับ H', 30, 'TM0001A001', 5, 'A'),
    row(9100000202, null, null, 'TM0001H003', 7, 'H'),
    [],
    row(9100000203, 'ของ A ล้วน', 9, 'TM0001A002', 4, 'A'),
    [],
    row(9100000204, 'QTY ว่างทุกแถวของ H', 6, 'TM0001H004', null, 'H'),
    [],
    row(9100000205, 'มีแถวว่างปน', 10, 'TM0001H005', null, 'H'),
    row(9100000205, null, null, 'TM0001H006', 3, 'H'),
    [],
    row(910000206, 'Excel ตัด 0', 2, 'TM0001H007', 1, 'H'),
    [],
    row(9100000207, 'ตัวอักษรไม่ตรง PO', 5, 'TM0001H008', 2, 'A')
  ];
  const q = parseCountSheet(aoa, { entity: 'TUE-H', entityOf: entityOfPo, source: 'qty' });
  const qOf = c => (q.rows.find(r => r.code === c) || {}).qty;
  ok('มีคอลัมน์ PO = ฟอร์ม WIP · ตั้งต้นใช้ QTY', q.layout === 'wip' && q.source === 'qty' && q.label === 'QTY');
  ok('QTY = รวมทุก PO ของนิติบุคคลของรอบนับ (12 + 8)', qOf('9100000201') === 20);
  ok('รหัสที่ปนนิติบุคคล: QTY รับเฉพาะแถวของ H (7 ไม่ใช่ 12)', qOf('9100000202') === 7);
  ok('รหัสของนิติบุคคลอื่นล้วน ไม่อยู่ในไฟล์ของรอบนี้', qOf('9100000203') === undefined && !q.held.some(h => h.code === '9100000203'));
  ok('QTY ว่าง = ข้ามแถว ไม่เดาเป็น 0 · ว่างทุกแถว = อยู่ในไฟล์แต่ไม่ลง', qOf('9100000205') === 3 && qOf('9100000204') === undefined
     && q.held.some(h => h.code === '9100000204' && /ว่างทุกแถว/.test(h.why)) && q.skippedBlank === 2);
  ok('ตัวอักษรท้ายแถวไม่ตรงกับเลข PO = แถวที่อ่านไม่ได้ และรหัสนั้นไม่ลง',
     q.errors.some(e => e.code === '9100000207' && /ไม่ตรงกับเลข PO/.test(e.why)) && qOf('9100000207') === undefined
     && q.held.some(h => h.code === '9100000207'));
  ok('สรุปนิติบุคคลในไฟล์', q.entities.map(e => e.entity + ':' + e.codes).join() === 'TUE-A:2,TUE-H:5');
  ok('แถวราย PO ของรหัสเดียวกันไม่นับเป็นรหัสซ้ำ', q.dups.length === 0);

  const st = parseCountSheet(aoa, { entity: 'TUE-H', entityOf: entityOfPo, source: 'stk' });
  const sOf = c => (st.rows.find(r => r.code === c) || {}).qty;
  ok('ทางสำรอง Vendor Stk: ใช้ยอดแถวแรกของรหัสที่เป็น H ล้วน', st.source === 'stk' && st.label === 'Vendor Stk' && sOf('9100000201') === 50);
  ok('Vendor Stk ของรหัสที่มี PO หลายนิติบุคคล = ไม่ลง ขึ้นรายการพร้อมยอด',
     sOf('9100000202') === undefined && st.held.some(h => h.code === '9100000202' && h.stk === 30 && h.ents.join() === 'TUE-A,TUE-H'));
  ok('Vendor Stk ไม่สน QTY ว่าง', sOf('9100000204') === 6);

  const known = new Set(['9100000201', '9100000202', '9100000204', '0910000206', '9100000207']);
  const m = matchCountRows(q.rows, known);
  ok('ฟอร์ม WIP เติม 0 ให้รหัสที่ Excel ตัดได้เหมือนเดิม', m.matched.some(x => x.code === '0910000206' && x.padded));
  const book = new Map([['9100000204', 4], ['9100000207', 5], ['9100000203', 9], ['9100000299', 1]]);
  const miss = missingFromFile(book, m, q).map(x => x.code);
  ok('รหัสที่อยู่ในไฟล์แต่ไม่ลง / แถวอ่านไม่ได้ ไม่โผล่ใน "ไม่อยู่ในไฟล์" (กดติ๊กทั้งหมดแล้วไม่ล้างเป็น 0)',
     !miss.includes('9100000204') && !miss.includes('9100000207'), miss.join());
  ok('รหัสของนิติบุคคลอื่นล้วน = ไม่อยู่ในไฟล์ของรอบนี้ (ขึ้นให้ติ๊ก ไม่ติ๊กเป็นค่าตั้งต้น)', miss.includes('9100000203') && miss.includes('9100000299'));

  // Vendor Stk เขียนซ้ำทุกแถวของรหัส — คนทำ Excel เติมค่าเดิมลงมาทุกแถวเป็นเรื่องปกติ
  // ⚠️ บวกรวมแล้วยอดนับพุ่งเป็นหลายเท่า แล้วลงรายการ "ปรับยอด" ผิดลงสมุด (ผู้ตรวจ #140 ข้อ 1)
  const rep = [H,
    row(9100000211, 'Vendor Stk ซ้ำ ค่าเท่ากัน', 200, 'TM0001H101', 60, 'H'),
    row(9100000211, null, 200, 'TM0001H102', 40, 'H'),
    [],
    row(9100000212, 'Vendor Stk ซ้ำ ค่าไม่เท่ากัน', 200, 'TM0001H103', 10, 'H'),
    row(9100000212, null, 170, 'TM0001H104', 5, 'H'),
    [],
    row(9100000213, 'ปน A กับ H · Vendor Stk ซ้ำ', 90, 'TM0001A101', 3, 'A'),
    row(9100000213, null, 90, 'TM0001H105', 4, 'H')
  ];
  const rs = parseCountSheet(rep, { entity: 'TUE-H', entityOf: entityOfPo, source: 'stk' });
  const rOf = c => (rs.rows.find(r => r.code === c) || {}).qty;
  ok('Vendor Stk เขียนซ้ำทุกแถว ค่าเท่ากัน = ใช้ค่าเดียว ห้ามบวกรวม (200 ไม่ใช่ 400)',
     rOf('9100000211') === 200, String(rOf('9100000211')));
  ok('Vendor Stk หลายแถวค่าไม่เท่ากัน = ไม่ลง ขึ้นรายการพร้อมค่าที่เจอและทางออก',
     rOf('9100000212') === undefined
     && rs.held.some(h => h.code === '9100000212' && /ไม่เท่ากัน/.test(h.why) && /200/.test(h.why) && /170/.test(h.why) && /คีย์ยอดเอง/.test(h.why)),
     JSON.stringify(rs.held));
  ok('Vendor Stk ซ้ำที่ค่าเท่ากัน ไม่ขึ้นเป็น "รหัสซ้ำในไฟล์ (รวมยอดให้)"', rs.dups.length === 0, JSON.stringify(rs.dups));
  ok('รหัสที่มี PO หลายนิติบุคคล: โชว์ Vendor Stk ค่าเดียว ไม่ใช่ผลบวก (90 ไม่ใช่ 180)',
     rs.held.some(h => h.code === '9100000213' && h.stk === 90), JSON.stringify(rs.held));
  ok('ทาง QTY ของชีตเดียวกันยังรวมทุก PO ของนิติบุคคลนั้น (60 + 40)',
     (parseCountSheet(rep, { entity: 'TUE-H', entityOf: entityOfPo, source: 'qty' })
       .rows.find(r => r.code === '9100000211') || {}).qty === 100);

  // หัวคอลัมน์ PO สะกดอื่น แต่ชีตเป็นฟอร์ม WIP (มี Vendor Stk) — ห้ามถอยไปอ่านแบบตารางยอดนับธรรมดา
  // ไม่งั้น QTY ของทุก PO ทุกนิติบุคคลถูกบวกรวมกันเงียบ ๆ (A3 · ผู้ตรวจ #140 ข้อ 2)
  const otherHead = [H.map(h => h === 'PO No.' ? 'P/O' : h),
    row(9100000201, 'ของ H', 50, 'TM0001H001', 10, 'H'),
    row(9100000201, null, null, 'TM0001A001', 500, 'A')];
  const oh = parseCountSheet(otherHead, { entity: 'TUE-H', entityOf: entityOfPo, source: 'qty' });
  ok('ฟอร์ม WIP ที่หัวคอลัมน์ PO สะกดอื่น = ไม่อ่านเลย บอกให้ตรวจหัวคอลัมน์ (ไม่ลงยอดปนนิติบุคคล)',
     oh.header === -1 && oh.layout !== 'simple' && !oh.rows.length && /PO No\./.test(oh.errors[0].why),
     JSON.stringify({ header: oh.header, layout: oh.layout, rows: oh.rows, errors: oh.errors }));

  ok('ไม่บอกนิติบุคคล = ไม่อ่าน (ไม่เดา)', parseCountSheet(aoa, {}).header === -1);
  ok('ไฟล์แบบเดิม (ไม่มีคอลัมน์ PO) ยังอ่านแบบเดิม', parseCountSheet([['MATERIAL NO', 'QTY'], ['A1', 3]]).layout === 'simple');

  // รหัสเดียวกันที่ไฟล์เขียนสองแบบ (บางแถว Excel ตัด 0 หน้า บางแถวไม่ตัด) → ชนกันตอนจับคู่ทะเบียน
  // ⚠️ Vendor Stk เป็นยอดคงเหลือ บวกรวมแล้วได้ยอดเป็นสองเท่าแบบเงียบ (ผู้ตรวจ #140 รอบ 2 ข้อ 1)
  const two = [H,
    row(910000206, 'เขียนสองแบบ · Vendor Stk เท่ากัน', 80, 'TM0001H201', 10, 'H'),
    [],
    row('0910000206', null, 80, 'TM0001H202', 15, 'H'),
    [],
    row(910000306, 'เขียนสองแบบ · Vendor Stk ไม่เท่ากัน', 70, 'TM0001H203', 2, 'H'),
    [],
    row('0910000306', null, 55, 'TM0001H204', 3, 'H')
  ];
  const kn2 = new Set(['0910000206', '0910000306']);
  const ms = matchCountRows(parseCountSheet(two, { entity: 'TUE-H', entityOf: entityOfPo, source: 'stk' }).rows,
                            kn2, { sum: false });
  ok('Vendor Stk: ไฟล์เขียนรหัสเดียวกันสองแบบ ค่าเท่ากัน = ค่าเดียว ห้ามบวกรวม (80 ไม่ใช่ 160)',
     (ms.matched.find(x => x.code === '0910000206') || {}).qty === 80, JSON.stringify(ms.matched));
  ok('Vendor Stk: เขียนสองแบบแล้วค่าไม่เท่ากัน = ไม่ลง ขึ้นรายการพร้อมค่าที่เจอและทางออก',
     !ms.matched.some(x => x.code === '0910000306')
     && ms.held.some(h => h.code === '0910000306' && /910000306/.test(h.why) && /70/.test(h.why) && /55/.test(h.why)
                          && /คีย์ยอดเอง/.test(h.why)), JSON.stringify(ms.held));
  ok('รหัสที่ชนกันแล้วไม่ลง ยังนับว่า "อยู่ในไฟล์" (กดติ๊กทั้งหมดแล้วไม่ล้างยอดจริงเป็น 0)',
     !missingFromFile(new Map([['0910000306', 12]]), ms).some(x => x.code === '0910000306'));
  const mq = matchCountRows(parseCountSheet(two, { entity: 'TUE-H', entityOf: entityOfPo, source: 'qty' }).rows, kn2);
  ok('ทาง QTY ยังบวกรวมรหัสที่เขียนสองแบบเหมือนเดิม (10 + 15) · ไม่มีรหัสไหนถูกกัน',
     (mq.matched.find(x => x.code === '0910000206') || {}).qty === 25 && !mq.held.length, JSON.stringify(mq.matched));

  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('จอ: ส่งนิติบุคคลของรอบนับ + entityOfPo + คอลัมน์ที่เลือก · ชีตตั้งต้น = WIP',
     /parseCountSheet\(sh\.aoa, \{ entity: cs\.value\.entity, entityOf: entityOfPo, source: ci\.source \}\)/.test(app)
     && /=== 'WIP'/.test(app) && /source: 'qty'/.test(app));
  ok('จอ: โหมด Vendor Stk สั่งห้ามบวกรวมตอนจับคู่ · รหัสที่ชนกันไปโผล่กล่อง "อยู่ในไฟล์แต่ไม่ลง"',
     /matchCountRows\([^)]*\{ sum: raw\.source !== 'stk' \}\)/.test(app)
     && /held: \[\.\.\.raw\.held, \.\.\.match\.held\]/.test(app));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
