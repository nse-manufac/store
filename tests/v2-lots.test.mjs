/**
 * เทสล็อต — รันด้วย node
 *   node tests/v2-lots.test.mjs
 *
 * หมวด D สำคัญที่สุด — ระบบต้องบอกได้ว่าคำตอบไหนเป็นการเดา
 * ถ้าปล่อยให้ล็อตที่เดามาดูเหมือนของที่บันทึกไว้ เราจะพูดกับลูกค้าเกินกว่าที่รู้จริง
 */
import fs from 'node:fs';
import { lotsOf, suggestLots, traceLot, receiveLot, relot } from '../v2/core/lots.js';
import { makeEntry } from '../v2/core/ledger.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

const E = 'NSE', CODE = '4010600100';
let t = 0;
const at = () => new Date(Date.UTC(2026, 7, 1 + (t++))).toISOString();
const mk = o => makeEntry({ entity: E, person: 'ก', material_code: CODE, at: at(), ...o });

console.log('=== A. กองของแต่ละล็อต ===');
const led = [
  mk({ kind: 'open', qty: 5 }),                                          // ของเก่า ไม่มีล็อต
  mk({ kind: 'receive', qty: 10, lot: 'L-A', doc_ref: 'PO1' }),
  mk({ kind: 'receive', qty: 8,  lot: 'L-B', doc_ref: 'PO2' })
];
const lots = lotsOf(led, E, CODE);
ok('ได้สามกอง', lots.length === 3, String(lots.length));
ok('กองที่ไม่มีเลขล็อตมาก่อน เพราะอยู่ในคลังมาก่อนเริ่มเก็บล็อต',
   lots[0].lot === '', JSON.stringify(lots.map(l => l.lot)));
ok('ที่เหลือเรียงตามวันที่รับเข้า',
   lots[1].lot === 'L-A' && lots[2].lot === 'L-B');
ok('ยอดแต่ละกองถูก',
   lots.map(l => l.qty).join(',') === '5,10,8', lots.map(l => l.qty).join(','));

console.log('\n=== B. เดาว่าควรตัดจากล็อตไหน — ของเก่าก่อน ===');
const s1 = suggestLots(led, E, CODE, 3);
ok('ตัดจากกองเก่าสุดกองเดียวพอ', s1.picks.length === 1 && s1.picks[0].lot === '');
ok('ตัดตามจำนวนที่ขอ', s1.picks[0].take === 3);
ok('ของพอ', s1.enough === true && s1.short === 0);

const s2 = suggestLots(led, E, CODE, 12);
ok('ไม่พอกองเดียวก็ไล่กองถัดไป',
   s2.picks.map(p => p.lot + ':' + p.take).join(' ') === ':5 L-A:7',
   s2.picks.map(p => p.lot + ':' + p.take).join(' '));
ok('รวมได้ครบ', s2.enough === true);

const s3 = suggestLots(led, E, CODE, 40);
ok('ของไม่พอก็บอกว่าขาดเท่าไหร่', s3.short === 17, String(s3.short));
ok('แต่ยังคืนของที่มีให้ ไม่ใช่ปฏิเสธ (INVARIANTS A4)', s3.picks.length === 3);

console.log('\n=== C. จ่ายออกแล้วกองลด ===');
const led2 = [...led, mk({ kind: 'issue', qty: 10, lot: 'L-A', part_no: '2800404400' })];
const lots2 = lotsOf(led2, E, CODE);
ok('กองที่ใช้หมดหายไปจากรายการ',
   !lots2.some(l => l.lot === 'L-A'), JSON.stringify(lots2.map(l => l.lot)));
ok('กองอื่นไม่ถูกแตะ', lots2.find(l => l.lot === 'L-B').qty === 8);
const led3 = [...led, mk({ kind: 'scrap', qty: 4, lot: 'L-B', reason_code: 'wind' })];
ok('ของเสียก็ตัดจากกองด้วย', lotsOf(led3, E, CODE).find(l => l.lot === 'L-B').qty === 4);

console.log('\n=== D. ต้องบอกได้ว่าคำตอบไหนเป็นการเดา ===');
ok('ทุก pick ถูกทำเครื่องหมายว่าเป็นการอนุมาน',
   s2.picks.every(p => p.inferred === true));

const ledTrace = [
  mk({ kind: 'receive', qty: 10, lot: 'L-A', doc_ref: 'PO1' }),
  mk({ kind: 'issue', qty: 4, lot: 'L-A', part_no: '2800404400', lot_inferred: true }),
  mk({ kind: 'issue', qty: 3, lot: 'L-A', part_no: '2870627900' })
];
const tr = traceLot(ledTrace, E, CODE, 'L-A');
ok('รู้ว่ารับเข้ามาเท่าไหร่', tr.received === 10);
ok('รู้ว่าใช้ไปเท่าไหร่', tr.used === 7, String(tr.used));
ok('รู้ว่าเหลือเท่าไหร่', tr.remaining === 3, String(tr.remaining));
ok('บอกได้ว่าไปอยู่ในงานไหนบ้าง',
   tr.jobs.map(j => j.job).sort().join(',') === '2800404400,2870627900',
   JSON.stringify(tr.jobs.map(j => j.job)));
ok('แยกจำนวนรายงานได้', tr.jobs.find(j => j.job === '2800404400').qty === 4);
ok('ติดธงว่าคำตอบนี้มีส่วนที่มาจากการเดา', tr.anyInferred === true);
ok('งานที่ล็อตมาจากการเดา ถูกทำเครื่องหมายรายตัว',
   tr.jobs.find(j => j.job === '2800404400').inferred === true);
ok('งานที่คนระบุล็อตเองไม่ถูกทำเครื่องหมาย',
   tr.jobs.find(j => j.job === '2870627900').inferred === false);

const clean = traceLot([
  mk({ kind: 'receive', qty: 5, lot: 'L-C', doc_ref: 'PO9' }),
  mk({ kind: 'issue', qty: 2, lot: 'L-C', part_no: '2800404400' })
], E, CODE, 'L-C');
ok('ถ้าไม่มีการเดาเลย ก็ไม่ติดธง', clean.anyInferred === false);

console.log('\n=== E. กรองนิติบุคคล ===');
const mixed = [...led, makeEntry({ entity: 'OTHER', person: 'ก', material_code: CODE,
                                   kind: 'receive', qty: 999, lot: 'X', doc_ref: 'P' })];
ok('ล็อตของบริษัทอื่นไม่ปนมา',
   !lotsOf(mixed, E, CODE).some(l => l.lot === 'X'));
let threw = false;
try { lotsOf(mixed, '', CODE); } catch { threw = true; }
ok('ลืมส่ง entity แล้วดัง', threw);

console.log('\n=== เลขล็อตตอนรับเข้า — ไม่ใส่ = วันที่รับเข้า (เจ้าของ 24 ก.ย. 2026) ===');
ok('ใส่เลขล็อตมา ใช้ตามที่ใส่', receiveLot('LOT-7', '2026-09-24') === 'LOT-7');
ok('เว้นว่าง ใช้วันที่รับเข้า', receiveLot('', '2026-09-24') === '2026-09-24');
ok('ช่องว่างล้วนนับว่าเว้นว่าง', receiveLot('   ', '2026-09-24') === '2026-09-24');
ok('null / undefined ก็ใช้วันที่', receiveLot(null, '2026-09-24') === '2026-09-24' && receiveLot(undefined, '2026-09-24') === '2026-09-24');
ok('ไม่มีทั้งคู่ ได้ค่าว่าง (ให้คนเรียกตัดสินเอง)', receiveLot('', '') === '');
console.log('\n=== สองหน้ารับเข้าใช้กติกาล็อต/วันหมดอายุเดียวกัน (เจ้าของเคาะ 24 ก.ย. 2026) ===');
const rl = [{ lot: '2026-09-24' }, { lot: 'LOT-7' }, { lot: '' }, { lot: '2026-09-24' }];
ok('แก้วันที่หลังกางไฟล์ — ล็อตที่ระบบเติมให้ตามวันที่ใหม่', relot(rl, '2026-09-24', '2026-09-25') === 2
   && rl[0].lot === '2026-09-25' && rl[3].lot === '2026-09-25');
ok('ล็อตที่คนพิมพ์เอง / ช่องว่าง ไม่ถูกแตะ', rl[1].lot === 'LOT-7' && rl[2].lot === '');
ok('ล้างวันที่จนว่าง — ล็อตกลับเป็นว่าง (ตอนบันทึกได้วันนี้แทน)',
   (() => { const x = [{ lot: '2026-09-25' }]; relot(x, '2026-09-25', ''); return x[0].lot === ''; })());
ok('ไม่มีวันที่เดิม / ไม่มีอะไรเลย ไม่พัง', relot(rl, '', 'x') === 0 && relot(null, 'a', 'b') === 0);
{
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('ทั้งสองหน้าตัดสินล็อตด้วย receiveLot และวันที่ว่างใช้วันนี้ (ผู้ตรวจ #108 ข้อ 1)',
     src.includes('receiveLot(l.lot, inH.date || todayLocal())')
     && src.includes('receiveLot(l.lot, wkH.date || todayLocal())'));
  ok('แท็บรับเข้ารวม — ล็อตตามวันที่เมื่อแก้วันที่หลังกางไฟล์', /watch\(\(\) => wkH\.date,[^\n]*relot\(/.test(src));
  ok('ไม่บล็อก / ไม่ถามยืนยัน เพราะไม่มีวันหมดอายุ หรือไม่มีล็อต ทั้งสองหน้า',
     !src.includes('ต้องกรอกวันหมดอายุอีก') && !/confirm\([^;]*ยังไม่มีวันหมดอายุ/.test(src)
     && !/confirm\([^;]*ยังไม่ใส่เลขล็อต/.test(src));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
