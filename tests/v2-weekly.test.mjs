/**
 * เทสรับเข้ารวมรายสัปดาห์ — รันด้วย node
 *   node tests/v2-weekly.test.mjs
 *
 * หมวด A สำคัญที่สุด — เอกสารใบเดียวมีของสองนิติบุคคลปนกันได้
 * ถ้าตั้งนิติบุคคลทั้งใบ ยอดจะข้ามโรงงานกันโดยไม่มีอะไรเตือน
 */
import { entityOfPo, bomExpect, pctDiff, summarize, readyLines, checkWeekly, chemPlan, seenBefore }
  from '../v2/master/weekly.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. เดานิติบุคคลจากเลข PO ===');
ok('TM5266H177 เป็นของ TUE-H', entityOfPo('TM5266H177') === 'TUE-H', entityOfPo('TM5266H177'));
ok('TM4267U025 เป็นของ TUE-U', entityOfPo('TM4267U025') === 'TUE-U');
ok('ตัวอักษรอื่นก็ได้', entityOfPo('TM1234A999') === 'TUE-A');
ok('พิมพ์เล็กก็อ่านได้', entityOfPo('tm5266h177') === 'TUE-H');
ok('เว้นวรรคหน้าหลังไม่กวน', entityOfPo('  TM5266H177 ') === 'TUE-H');
// เดาไม่ได้ต้องตอบว่าง ไม่ใช่เดามั่ว — เดามั่วแปลว่ายอดไปโผล่ผิดโรงงาน
ok('รูปแบบอื่นตอบว่าง ไม่ใช่เดามั่ว',
   entityOfPo('PO-9001') === '' && entityOfPo('') === '' && entityOfPo(null) === '');

console.log('\n=== B. เทียบกับสูตร ===');
const bom = [
  { pn: 'TM5267H332', code: '4020204800', usage: 0.0006 },
  { pn: 'TM5267H332', code: '4090006500', usage: 0.002 }
];
ok('คิดยอดตามสูตรจากยอดสั่ง',
   bomExpect(bom, 'TM5267H332', '4020204800', 1000) === 0.6,
   String(bomExpect(bom, 'TM5267H332', '4020204800', 1000)));
ok('ไม่มีในสูตรตอบ null', bomExpect(bom, 'TM5267H332', '9999999999', 1000) === null);
ok('ไม่รู้ยอดสั่งก็ตอบ null', bomExpect(bom, 'TM5267H332', '4020204800', null) === null);

ok('ต่างจากสูตรกี่เปอร์เซ็นต์ — ใช้ยอดที่จ่ายมาจริงเป็นตัวตั้ง',
   pctDiff({ s41: 0.66, req: 0.6 }, 0.6) === 10, String(pctDiff({ s41: 0.66, req: 0.6 }, 0.6)));
ok('ไม่มียอดที่จ่ายมาจริง ใช้ยอดตามสูตรในเอกสารแทน',
   pctDiff({ s41: null, req: 0.54 }, 0.6) === -10, String(pctDiff({ s41: null, req: 0.54 }, 0.6)));
ok('ไม่มีอะไรให้เทียบก็ตอบ null',
   pctDiff({ s41: null, req: null }, 0.6) === null && pctDiff({ s41: 1 }, null) === null);
ok('สูตรเป็นศูนย์ไม่ทำให้หารด้วยศูนย์', pctDiff({ s41: 1 }, 0) === null);

console.log('\n=== C. รวมยอดรายรหัสเทียบกับแถว Total ในเอกสาร ===');
const lines = [
  { code: '4020204800', po: 'TM5266H177', s41: 0.539, qty: 0.539 },
  { code: '4020204800', po: 'TM5266H178', s41: 0.231, qty: 0.231 },
  { code: '4090006500', po: 'TM4267U025', s41: 1.5, qty: 1.5 }
];
const sum = summarize(lines, { '4020204800': 0.77 });
const flux = sum.find(x => x.code === '4020204800');
ok('รวมยอดหลาย PO ของรหัสเดียวกัน', flux.s41 === 0.77 && flux.n === 2, JSON.stringify(flux));
ok('ตรงกับเอกสารแล้วติดธงว่าตรง', flux.match === true);
// ต้องแยก "ยังไม่ได้กรอก" ออกจาก "ไม่ตรง" ให้ชัด
ok('รหัสที่ยังไม่ได้กรอกยอดรวม ไม่ใช่ว่าไม่ตรง',
   sum.find(x => x.code === '4090006500').match === null);
ok('กรอกยอดรวมผิดแล้วจับได้',
   summarize(lines, { '4020204800': 0.8 }).find(x => x.code === '4020204800').match === false);
// ทศนิยมลอยตัวต้องไม่ทำให้ยอดที่ตรงกันกลายเป็นไม่ตรง
ok('บวกทศนิยมแล้วยังเทียบได้ ไม่โดนเศษลอยตัวเล่นงาน',
   summarize([{ code: 'X', po: 'p', s41: 0.1, qty: 0 }, { code: 'X', po: 'p', s41: 0.2, qty: 0 }],
             { X: 0.3 })[0].match === true);

console.log('\n=== D. บรรทัดที่พร้อมบันทึก ===');
ok('ต้องมีครบทั้งรหัส PO และจำนวน',
   readyLines([{ code: 'A', po: 'p', qty: 1 }, { code: 'A', po: '', qty: 1 },
               { code: '', po: 'p', qty: 1 }, { code: 'A', po: 'p', qty: 0 }]).length === 1);

console.log('\n=== E. ตรวจทั้งใบก่อนบันทึก ===');
const chk = checkWeekly([
  { code: '4020204800', po: 'TM5266H177', s41: 0.539, qty: 0.539, lot: 'L1' },
  { code: '4020204800', po: 'TM5266H178', s41: 0.231, qty: 0.231, lot: '' },
  { code: '9999999999', po: 'TM4267U025', s41: 1.5, qty: 1.5, lot: 'L2' }
], { totals: { '4020204800': 0.9 },
     materials: [{ material_code: '4020204800' }],
     entity: 'TUE-H' });

ok('บอกรหัสที่ยอดรวมไม่ตรง', chk.mismatch.length === 1 && chk.mismatch[0].code === '4020204800');
ok('บอกรหัสที่ยังไม่มีในทะเบียน',
   chk.unknown.length === 1 && chk.unknown[0] === '9999999999', JSON.stringify(chk.unknown));
ok('บอกจำนวนบรรทัดที่ยังไม่ใส่ล็อต', chk.noLot === 1, String(chk.noLot));
ok('บอกรหัสที่ยังไม่ได้กรอกยอดรวม', chk.noTotal === 1, String(chk.noTotal));
// ข้อสำคัญที่สุด — เอกสารใบเดียวมีสองนิติบุคคล
ok('จับได้ว่ามีบรรทัดของนิติบุคคลอื่นปนมา',
   chk.otherEntities.length === 1 && chk.otherEntities[0] === 'TUE-U',
   JSON.stringify(chk.otherEntities));
ok('ไล่รายชื่อนิติบุคคลทั้งใบได้',
   chk.entities.join(',') === 'TUE-H,TUE-U', chk.entities.join(','));
ok('ทุกอย่างเรียบร้อยก็ไม่มีอะไรค้าง',
   checkWeekly([{ code: 'A', po: 'TM5266H177', s41: 1, qty: 1, lot: 'L' }],
               { totals: { A: 1 }, materials: [{ material_code: 'A' }], entity: 'TUE-H' })
     .mismatch.length === 0);
ok('ใบเปล่าไม่พัง', checkWeekly([]).ready.length === 0);


console.log('\n=== F. นำเข้าไฟล์ Kit List กลุ่มจ่ายรวมตรง ๆ (เจ้าของ 22 ก.ย. 2026) ===');
// เดิมพนักงานต้องคีย์ทั้งใบเอง ทั้งที่ไฟล์มีทุกช่องอยู่แล้ว
// ⚠️ แถวที่ Delta ตัดจากยอด over ต้องไม่ปนมากับรายการรับเข้า ไม่งั้นของก้อนเดียวเข้าคลังสองรอบ
const parsed = {
  location: '0014',
  rows: [
    { code: 9000000001, po: 'TM9269H001', pn: 'PN9001', orderQty: 1000, req: 0.5,  issue: 0.5,  desc: 'GLUE', fromOver: false },
    { code: 9000000001, po: 'TM9269H002', pn: 'PN9002', orderQty: 500,  req: 0.25, issue: 0.25, desc: 'GLUE', fromOver: false },
    { code: 9000000002, po: 'TM9269H003', pn: 'PN9003', orderQty: 200,  req: 0.1,  issue: 0.1,  desc: 'INK',  fromOver: true }
  ],
  blocks: [
    { sheet: 'H', code: '9000000001', docTotal: 0.5 },
    { sheet: 'U', code: '9000000001', docTotal: 0.25 },
    { sheet: 'H', code: '9000000002', docTotal: null },
    { sheet: 'H', code: '(ปนกัน)',   docTotal: 9 }
  ]
};
const plan = chemPlan(parsed, { date: '2026-09-22' });
ok('ของที่มาจริงกับของที่ตัดจากยอด over แยกคนละรายการ',
   plan.receive.length === 2 && plan.fromOver.length === 1,
   plan.receive.length + ' / ' + plan.fromOver.length);
ok('ยอดรับจริงตั้งไว้ให้เท่ากับที่ Delta จ่ายมา แก้ทับเป็นยอดนับจริงได้',
   plan.receive[0].qty === 0.5 && plan.receive[0].s41 === 0.5);
ok('เลขล็อตตั้งเป็นวันที่รับเข้า เพราะเอกสารไม่มีเลขล็อตมาให้เลย',
   plan.receive.every(l => l.lot === '2026-09-22'));
ok('รหัสอ่านเป็นข้อความเสมอ ไม่ใช่ตัวเลข', plan.receive.every(l => typeof l.code === 'string'));
// ยอดรวมรายรหัสเคยต้องคีย์มือทีละรหัส ทั้งที่เอกสารพิมพ์มาให้แล้ว
ok('ยอดรวมรายรหัสมาจากแถว Total ในเอกสาร และบวกข้ามชีตให้ด้วย',
   plan.totals['9000000001'] === 0.75, JSON.stringify(plan.totals));
ok('รหัสที่เอกสารไม่ได้พิมพ์ยอดรวมมา ต้องไม่ถูกเดาให้', !('9000000002' in plan.totals));
ok('บล็อกที่รหัสปนกัน ไม่ถูกนับเป็นยอดของรหัสไหน', !('(ปนกัน)' in plan.totals));
// ⚠️ ห้ามเอารหัส location ไปเติมเป็นเลขที่เอกสาร — ทุกไฟล์เป็นเลขเดียวกันหมด
ok('ส่งรหัส location ต่อให้หน้าจอ ไม่ใช่ในชื่อเลขที่เอกสาร',
   plan.location === '0014' && !('docNo' in plan), JSON.stringify(Object.keys(plan)));
const csum = summarize(plan.receive, plan.totals);
ok('บวกยอดเองแล้วตรงกับที่เอกสารพิมพ์มา',
   csum.find(x => x.code === '9000000001').match === true, JSON.stringify(csum));
ok('ไฟล์เปล่าไม่พัง',
   chemPlan({}, {}).receive.length === 0 && chemPlan({}).fromOver.length === 0);

// ⚠️ บล็อกที่มีแถว Return ปน ยอด Total ของเอกสารรวมแถวพวกนั้นไว้ด้วย
// แต่รายการรับเข้าตัดออกแล้ว ถ้าเติมยอดให้จะขึ้นเตือน "ไม่ตรง" ทั้งที่ไม่มีใครผิด (ผู้ตรวจ #97)
const mixPlan = chemPlan({
  rows: [
    { code: '9000000004', po: 'TM9269H005', issue: 1, fromOver: false },
    { code: '9000000004', po: 'TM9269H006', issue: 2, fromOver: true }
  ],
  blocks: [{ sheet: 'H', code: '9000000004', docTotal: 3, overLines: 1 }]
}, { date: '2026-09-22' });
ok('บล็อกที่มีแถว over ปน ไม่ถูกเติมยอดรวมให้ — ปล่อยเป็นยังไม่กรอก',
   !('9000000004' in mixPlan.totals), JSON.stringify(mixPlan.totals));
ok('ยอดที่ไม่ได้เติม ต้องขึ้นว่ายังไม่กรอก ไม่ใช่ว่าไม่ตรง',
   summarize(mixPlan.receive, mixPlan.totals)[0].match === null);

console.log('\n=== G. กันนำไฟล์เดิมเข้าซ้ำรอบ (เจ้าของ 22 ก.ย. 2026) ===');
// ใบเดียวมีได้สามร้อยบรรทัด กดยืนยันซ้ำครั้งเดียว ยอดเข้าคลังสองเท่าทั้งใบ
const book = [
  { entity: 'TUE-H', kind: 'receive', doc_ref: 'TM9269H001', material_code: 9000000001, voided: false },
  { entity: 'TUE-H', kind: 'receive', doc_ref: 'TM9269H002', material_code: 9000000001, voided: true },
  { entity: 'TUE-H', kind: 'issue',   doc_ref: 'TM9269H003', material_code: 9000000001, voided: false },
  { entity: 'TUE-U', kind: 'receive', doc_ref: 'TM9269H004', material_code: 9000000001, voided: false }
];
const seen = seenBefore([
  { entity: 'TUE-H', po: 'TM9269H001', code: '9000000001' },   // เคยรับไปแล้วจริง
  { entity: 'TUE-H', po: 'TM9269H002', code: '9000000001' },   // รายการเดิมถูกยกเลิกไปแล้ว
  { entity: 'TUE-H', po: 'TM9269H003', code: '9000000001' },   // เคยจ่ายออก ไม่ใช่รับเข้า
  { entity: 'TUE-H', po: 'TM9269H004', code: '9000000001' },   // คนละนิติบุคคล
  { entity: 'TUE-H', po: 'TM9269H009', code: '9000000001' }
], book);
ok('จับบรรทัดที่ PO+รหัสเดิมเคยรับเข้าไปแล้วได้',
   seen.length === 1 && seen[0].po === 'TM9269H001', JSON.stringify(seen.map(l => l.po)));
ok('รายการที่ถูกยกเลิกไปแล้ว ไม่นับว่าเคยรับ', !seen.some(l => l.po === 'TM9269H002'));
ok('ทิศทางอื่นไม่นับ — จ่ายออกไม่ใช่รับเข้า', !seen.some(l => l.po === 'TM9269H003'));
ok('คนละนิติบุคคลไม่นับ แม้ PO กับรหัสตรงกัน', !seen.some(l => l.po === 'TM9269H004'));
ok('รหัสที่เก็บเป็นตัวเลขในสมุด เทียบกับข้อความบนจอได้',
   seenBefore([{ entity: 'TUE-H', po: 'TM9269H001', code: 9000000001 }], book).length === 1);
ok('สมุดเปล่าไม่พัง', seenBefore([{ entity: 'A', po: 'B', code: 'C' }]).length === 0);

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
