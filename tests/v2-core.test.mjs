/**
 * เทสแกนสมุดของ v2 — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์ ไม่ต้องต่อเน็ต
 *   node tests/v2-core.test.mjs
 *
 * เน้นข้อที่ถ้าพลาดแล้วยอดเพี้ยนโดยไม่มีอะไรเตือน ซึ่งเป็นความผิดพลาดชนิดที่แพงที่สุด
 * ในโปรแกรมคลัง เพราะกว่าจะรู้ก็ผ่านไปหลายเดือนแล้ว
 */
import { KINDS, REASONS, makeEntry, voidEntry, signedQty, round5 } from '../v2/core/ledger.js';
import { balanceOf, balances, cardRows, oddBalances, overBom, receivedOfDoc } from '../v2/core/balance.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};
const throws = (name, fn, want) => {
  try { fn(); ok(name, false, 'ไม่โยน error เลย'); }
  catch (e) { ok(name, !want || e.message.includes(want), e.message); }
};

const E = 'NSE';
const base = { entity: E, person: 'สมชาย', material_code: '3220130200' };
const mk = o => makeEntry({ ...base, ...o });

console.log('=== A. เครื่องหมายอยู่ที่เดียว ===');
ok('ชนิดที่รู้จักครบ 7 แบบ', Object.keys(KINDS).length === 7, Object.keys(KINDS).join(','));
ok('รับเข้าเพิ่มยอด', signedQty(mk({ kind: 'receive', qty: 10, lot: 'L1', doc_ref: 'PO1' })) === 10);
ok('จ่ายออกลดยอด', signedQty(mk({ kind: 'issue', qty: 4 })) === -4);
ok('ของเสียลดยอด', signedQty(mk({ kind: 'scrap', qty: 2, reason_code: 'wind' })) === -2);
ok('คืนของเพิ่มยอด', signedQty(mk({ kind: 'return', qty: 3, reason_code: 'over' })) === 3);
ok('ยกยอดมาเพิ่มยอด', signedQty(mk({ kind: 'open', qty: 40 })) === 40);

console.log('\n=== B. qty เป็นบวกเสมอ ===');
throws('จำนวนติดลบไม่ผ่าน', () => mk({ kind: 'issue', qty: -5 }), 'มากกว่าศูนย์');
throws('จำนวนศูนย์ไม่ผ่าน', () => mk({ kind: 'issue', qty: 0 }), 'มากกว่าศูนย์');
throws('ไม่ใส่จำนวนไม่ผ่าน', () => mk({ kind: 'issue' }), 'มากกว่าศูนย์');

console.log('\n=== C. ปรับยอดเก็บทั้งที่นับได้และส่วนต่าง ===');
const adj = mk({ kind: 'adjust', counted_qty: 47, book_qty: 52, reason_code: 'count' });
ok('เก็บจำนวนที่นับได้ไว้', adj.counted_qty === 47);
ok('ส่วนต่างมีเครื่องหมาย', adj.delta === -5, String(adj.delta));
ok('qty ยังเป็นบวก', adj.qty === 5);
ok('มีผลกับยอดเท่าส่วนต่าง', signedQty(adj) === -5);
const adjUp = mk({ kind: 'adjust', counted_qty: 60, book_qty: 52, reason_code: 'found' });
ok('ปรับขึ้นก็ได้', signedQty(adjUp) === 8, String(signedQty(adjUp)));
throws('ไม่บอกยอดในสมุดไม่ผ่าน', () => mk({ kind: 'adjust', counted_qty: 47, reason_code: 'count' }), 'ยอดในสมุด');
// แช่แข็งส่วนต่างไว้ตั้งแต่ตอนบันทึก ถ้าคำนวณใหม่ตอนอ่าน ยอดในอดีตจะขยับเองเมื่อมีรายการแทรก
ok('ส่วนต่างถูกแช่แข็ง ไม่คำนวณใหม่', signedQty({ ...adj, delta: -5 }) === -5);

console.log('\n=== D. ข้อบังคับของแต่ละชนิด ===');
throws('รับเข้าต้องมีเลขล็อต', () => mk({ kind: 'receive', qty: 5, doc_ref: 'PO1' }), 'เลขล็อต');
throws('รับเข้าต้องอ้างเอกสาร', () => mk({ kind: 'receive', qty: 5, lot: 'L1' }), 'เอกสาร');
throws('ของเสียต้องมีเหตุผล', () => mk({ kind: 'scrap', qty: 1 }), 'เหตุผล');
throws('เหตุผลนอกรายการไม่ผ่าน', () => mk({ kind: 'scrap', qty: 1, reason_code: 'มั่ว' }), 'เหตุผล');
throws('เลือกอื่น ๆ แล้วต้องเขียนเพิ่ม', () => mk({ kind: 'scrap', qty: 1, reason_code: 'other' }), 'อธิบายเพิ่ม');
ok('เลือกอื่น ๆ พร้อมคำอธิบายผ่าน',
   !!mk({ kind: 'scrap', qty: 1, reason_code: 'other', note: 'หนูกัด' }));
throws('ไม่มีนิติบุคคลไม่ผ่าน',
       () => makeEntry({ ...base, entity: '', kind: 'issue', qty: 1 }), 'นิติบุคคล');
ok('จ่ายออกไม่ต้องมีล็อต (ของไม่ได้แยกกองตามล็อต)', !!mk({ kind: 'issue', qty: 1 }));

console.log('\n=== E. ยอดคงเหลือ ===');
const led = [
  mk({ kind: 'open',    qty: 40 }),
  mk({ kind: 'receive', qty: 10, lot: 'L1', doc_ref: 'PO1' }),
  mk({ kind: 'issue',   qty: 4 }),
  mk({ kind: 'scrap',   qty: 1, reason_code: 'wind' }),
  mk({ kind: 'return',  qty: 2, reason_code: 'over' })
];
ok('40 + 10 − 4 − 1 + 2 = 47', balanceOf(led, E, base.material_code) === 47,
   String(balanceOf(led, E, base.material_code)));

const voided = [...led, voidEntry(mk({ kind: 'issue', qty: 100 }), { by: 'เจ้าของ', reason: 'คีย์ผิด' })];
ok('รายการที่ยกเลิกไม่นับเข้ายอด', balanceOf(voided, E, base.material_code) === 47);
ok('แต่ยังอยู่ในสมุดให้เห็น', voided.length === 6);
throws('ยกเลิกต้องบอกเหตุผล', () => voidEntry(led[0], { by: 'x' }), 'เหตุผล');

console.log('\n=== F. กรองนิติบุคคล (INVARIANTS A3) ===');
const two = [...led, makeEntry({ ...base, entity: 'OTHER', kind: 'receive', qty: 999,
                                lot: 'L9', doc_ref: 'PO9' })];
ok('ยอดของบริษัทอื่นไม่ปนเข้ามา', balanceOf(two, E, base.material_code) === 47,
   String(balanceOf(two, E, base.material_code)));
ok('ของอีกบริษัทคำนวณแยกได้', balanceOf(two, 'OTHER', base.material_code) === 999);
throws('ลืมส่ง entity แล้วต้องดัง', () => balanceOf(two, '', base.material_code), 'นิติบุคคล');
throws('balances ก็ลืมไม่ได้', () => balances(two, ''), 'นิติบุคคล');
throws('cardRows ก็ลืมไม่ได้', () => cardRows(two, '', base.material_code), 'นิติบุคคล');

console.log('\n=== G. ปัดทศนิยม (INVARIANTS A2) ===');
const frac = [mk({ kind: 'receive', qty: 0.1, lot: 'L1', doc_ref: 'P' }),
              mk({ kind: 'receive', qty: 0.2, lot: 'L1', doc_ref: 'P' })];
ok('0.1 + 0.2 ได้ 0.3 ไม่ใช่ 0.30000000000000004',
   balanceOf(frac, E, base.material_code) === 0.3, String(balanceOf(frac, E, base.material_code)));
ok('round5 ปัดที่ห้าตำแหน่ง', round5(1 / 3) === 0.33333);

console.log('\n=== H. การ์ดรายตัว ===');
const card = cardRows(led, E, base.material_code);
ok('ครบทุกบรรทัด', card.length === 5);
ok('ยอดสะสมบรรทัดสุดท้ายเท่ายอดคงเหลือ', card[card.length - 1].balance === 47);
ok('ยอดสะสมไล่ถูกทีละบรรทัด',
   card.map(r => r.balance).join(',') === '40,50,46,45,47', card.map(r => r.balance).join(','));
ok('มีชื่อชนิดเป็นภาษาไทยให้แสดง', card[3].kindLabel === 'ของเสีย', card[3].kindLabel);

console.log('\n=== I. จับยอดผิดปกติ (ใช้แทนการนับรอบ) ===');
const odd = oddBalances([
  mk({ kind: 'issue', qty: 5, material_code: 'NEG1' }),
  mk({ kind: 'open',  qty: 10, material_code: 'OK1' }),
  mk({ kind: 'receive', qty: 10, material_code: 'HEAVY', lot: 'L', doc_ref: 'P' }),
  mk({ kind: 'issue', qty: 18, material_code: 'HEAVY' })
], E);
const codes = odd.map(o => o.code);
ok('จับยอดติดลบได้', codes.includes('NEG1'), codes.join(','));
ok('จับที่จ่ายเกินที่เคยรับได้', codes.includes('HEAVY'), codes.join(','));
ok('ของปกติไม่ถูกจับ', !codes.includes('OK1'));
ok('บอกเหตุผลที่ถูกจับ', odd.find(o => o.code === 'NEG1').why.includes('ยอดติดลบ'));

console.log('\n=== J. ของเกินสูตร ===');
const bom = new Map([['3220130200', 0.15]]);
const over = overBom([
  makeEntry({ ...base, kind: 'issue', qty: 20, part_no: '2800404400' })
], E, { bomFor: pn => (pn === '2800404400' ? bom : null), orderOf: () => 100 });
ok('เบิก 20 ทั้งที่สูตรบอก 15 = เกิน 5', over.length === 1 && over[0].over === 5,
   JSON.stringify(over));

console.log('\n=== K. ยอดที่เคยคีย์รับไปแล้วของ PO ใบเดียวกัน (issue #52) ===');
const rcv = [
  mk({ kind: 'receive', qty: 10, lot: 'L1', doc_ref: 'PO1' }),
  mk({ kind: 'receive', qty: 0.2, lot: 'L2', doc_ref: 'PO1' }),
  mk({ kind: 'receive', qty: 7, lot: 'L3', doc_ref: 'PO1', material_code: 'OTHERCODE' }),
  mk({ kind: 'receive', qty: 99, lot: 'L4', doc_ref: 'PO2' }),
  mk({ kind: 'issue',   qty: 3, doc_ref: 'PO1' }),
  voidEntry(mk({ kind: 'receive', qty: 500, lot: 'L5', doc_ref: 'PO1' }),
            { by: 'เจ้าของ', reason: 'คีย์ผิด' }),
  makeEntry({ ...base, entity: 'OTHER', kind: 'receive', qty: 888, lot: 'L6', doc_ref: 'PO1' })
];
const got = receivedOfDoc(rcv, E, 'PO1');
ok('รวมยอดรับของ PO ใบเดียวกันทุกรอบ (A2)', got.get(base.material_code).qty === 10.2,
   String(got.get(base.material_code).qty));
ok('บอกได้ว่าเคยคีย์รับกี่ครั้ง', got.get(base.material_code).times === 2);
ok('แยกตามรหัสวัตถุดิบ', got.get('OTHERCODE').qty === 7);
ok('PO ใบอื่นไม่ปนเข้ามา', receivedOfDoc(rcv, E, 'PO2').get(base.material_code).qty === 99);
ok('รายการที่ยกเลิกไม่นับ (B1)', got.get(base.material_code).qty === 10.2);
ok('จ่ายออกที่อ้าง PO เดียวกันไม่นับเป็นรับแล้ว', got.size === 2, [...got.keys()].join(','));
ok('ของนิติบุคคลอื่นไม่ปนเข้ามา (A3)', !receivedOfDoc(rcv, 'OTHER', 'PO1').get(base.material_code)
   || receivedOfDoc(rcv, 'OTHER', 'PO1').get(base.material_code).qty === 888);
throws('receivedOfDoc ก็ลืมส่ง entity ไม่ได้ (A3)', () => receivedOfDoc(rcv, '', 'PO1'), 'นิติบุคคล');
ok('ไม่ได้ใส่เลข PO = ไม่มีอะไรให้แสดง', receivedOfDoc(rcv, E, '').size === 0);
ok('เก็บเวลาที่เคยรับไว้ให้ฝั่งแสดงผลแปลงเป็นวันที่', got.get(base.material_code).ats.length === 2);

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
