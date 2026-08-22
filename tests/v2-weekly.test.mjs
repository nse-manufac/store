/**
 * เทสรับเข้ารวมรายสัปดาห์ — รันด้วย node
 *   node tests/v2-weekly.test.mjs
 *
 * หมวด A สำคัญที่สุด — เอกสารใบเดียวมีของสองนิติบุคคลปนกันได้
 * ถ้าตั้งนิติบุคคลทั้งใบ ยอดจะข้ามโรงงานกันโดยไม่มีอะไรเตือน
 */
import { entityOfPo, bomExpect, pctDiff, summarize, readyLines, checkWeekly }
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

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
