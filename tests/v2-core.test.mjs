/**
 * เทสแกนสมุดของ v2 — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์ ไม่ต้องต่อเน็ต
 *   node tests/v2-core.test.mjs
 *
 * เน้นข้อที่ถ้าพลาดแล้วยอดเพี้ยนโดยไม่มีอะไรเตือน ซึ่งเป็นความผิดพลาดชนิดที่แพงที่สุด
 * ในโปรแกรมคลัง เพราะกว่าจะรู้ก็ผ่านไปหลายเดือนแล้ว
 */
import fs from 'node:fs';
import { KINDS, REASONS, makeEntry, voidEntry, signedQty, round5, unknownKinds, setExpiry, missingExpiry,
         LOG_KINDS, logRows, logSheet, LOG_HEAD } from '../v2/core/ledger.js';
import { balanceOf, balances, cardRows, oddBalances, receivedOfDoc, movedOfDoc } from '../v2/core/balance.js';

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
ok('ชนิดที่รู้จักครบ 8 แบบ', Object.keys(KINDS).length === 8, Object.keys(KINDS).join(','));
ok('ส่งคืน Delta ลดยอด', signedQty(mk({ kind: 'sendback', qty: 6, doc_ref: 'PO1', reason_code: 'over' })) === -6);
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
throws('ส่งคืน Delta ต้องอ้าง PO', () => mk({ kind: 'sendback', qty: 5, reason_code: 'over' }), 'เอกสาร');
throws('ส่งคืน Delta ต้องมีเหตุผล', () => mk({ kind: 'sendback', qty: 5, doc_ref: 'PO1' }), 'เหตุผล');
throws('เหตุผลของชนิดอื่นใช้กับส่งคืนไม่ได้', () => mk({ kind: 'sendback', qty: 5, doc_ref: 'PO1', reason_code: 'wind' }), 'เหตุผล');
throws('ส่งคืนเลือกอื่น ๆ แล้วต้องเขียนเพิ่ม', () => mk({ kind: 'sendback', qty: 5, doc_ref: 'PO1', reason_code: 'other' }), 'อธิบายเพิ่ม');
ok('ส่งคืน Delta ไม่บังคับล็อต — ของเกินคิดต่อ PO ล็อตมักไม่รู้ บังคับแล้วบันทึกไม่ได้ (A4)',
   !!mk({ kind: 'sendback', qty: 5, doc_ref: 'PO1', reason_code: 'over' }));
ok('เหตุผลส่งคืนครบห้าข้อตามที่ตกลง', (REASONS.sendback || []).map(r => r.code).join(',') === 'over,carry,wrong,qc,other',
   (REASONS.sendback || []).map(r => r.code).join(','));

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

/* ── ของที่ลบทิ้งไปแล้ว ต้องไม่กลับมาเงียบ ๆ (Mat Follow up 8/8) ──
 * overBom เคยคิด "ของเบิกเกินสูตร" แต่ไม่มีใครเรียกมาตั้งแต่ v2 ขึ้น และคิดยอดคนละสูตร
 * กับที่หน้าจอใช้จริง · ของเกินตัวจริงอยู่ที่ overAll ของ master/follow.js (ใบ 6)
 * ถ้ามีคนเติมกลับมาโดยไม่มีใครเรียก เราจะมีสองสูตรที่ค่อย ๆ เพี้ยนจากกันอีกรอบ */
{
  const srcBal = fs.readFileSync(new URL('../v2/core/balance.js', import.meta.url), 'utf8');
  const srcApp = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  // จับทุกรูปแบบที่ export ออกมาได้ ไม่ใช่เฉพาะ export function (ผู้ตรวจ #94 ข้อสังเกต 2)
  ok('overBom ถูกลบออกจาก balance.js แล้ว', !/overBom/.test(srcBal));
  ok('ไม่มีใครเรียก overBom ใน app.js', !/\boverBom\s*\(/.test(srcApp));
}

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

console.log('\n=== L. ชนิดรายการที่โปรแกรมรุ่นนี้ไม่รู้จัก (เครื่องอื่นใช้รุ่นใหม่กว่า) ===');
// รายการจากเครื่องรุ่นใหม่ที่ซิงค์มาถึง — makeEntry ของรุ่นนี้สร้างไม่ได้ จึงประกอบเองแบบแถวที่ดึงมาจากชีต
// ชื่อ nextkind แทนชนิดที่ยังไม่มีจริง · เดิมใช้ sendback ซึ่งตอนนี้รู้จักแล้ว (Mat Follow up 5/8)
const future = o => ({ ...mk({ kind: 'issue', qty: 1 }), ...o });
const mixed = [
  mk({ kind: 'receive', qty: 50, lot: 'L1', doc_ref: 'PO1' }),
  future({ kind: 'nextkind', qty: 20, doc_ref: 'PO1' }),
  future({ kind: 'nextkind', qty: 5, doc_ref: 'PO1' }),
  voidEntry(future({ kind: 'mystery', qty: 9 }), { by: 'เจ้าของ', reason: 'คีย์ผิด' }),
  future({ kind: 'nextkind', qty: 7, entity: 'OTHER' })
];
let sq;
try { sq = signedQty(mixed[1]); } catch (e) { sq = e; }
ok('คิดยอดต่อได้ ไม่โยน error — โยนในลูปคิดยอด = จอขาวทั้งโปรแกรม', sq === 0, String(sq));
const uk = unknownKinds(mixed);
ok('ฟ้องชนิดที่ไม่รู้จักพร้อมจำนวน นับทุกนิติบุคคล (บอกว่าโปรแกรมเก่า ไม่ใช่ยอดของใคร)',
   uk.length === 1 && uk[0].kind === 'nextkind' && uk[0].n === 3, JSON.stringify(uk));
ok('รายการที่ยกเลิกแล้วไม่ฟ้อง เพราะไม่ได้นับเข้ายอดอยู่แล้ว (B1)', !uk.some(k => k.kind === 'mystery'));
ok('ชนิดที่รู้จักครบ ไม่ฟ้องอะไร', unknownKinds(led).length === 0);
ok('ชื่อที่ติดมากับทุกอ็อบเจกต์ไม่นับว่ารู้จัก', unknownKinds([future({ kind: 'constructor' })]).length === 1);
const oddU = oddBalances(mixed, E).find(o => o.code === base.material_code);
ok('รหัสที่โดนขึ้นในรายการที่ควรไปดู แม้ยอดไม่ติดลบ', !!oddU && oddU.bal === 50, JSON.stringify(oddU));
ok('เหตุผลบอกว่ามีรายการที่ไม่รู้จัก และบอกทางออกให้โหลดใหม่ (G3)',
   !!oddU && oddU.why.some(w => w.includes('ไม่รู้จัก') && w.includes('โหลดโปรแกรมใหม่')), oddU && oddU.why.join(' | '));
ok('นับเฉพาะของนิติบุคคลนี้ (A3)', !!oddU && oddU.unknown === 2, oddU && String(oddU.unknown));
ok('รหัสที่โดนขึ้นก่อนรหัสยอดติดลบ เพราะข้ออื่นคิดจากยอดที่ผิดไปแล้ว',
   oddBalances([mk({ kind: 'issue', qty: 5, material_code: 'NEG1' }), ...mixed], E)[0].code === base.material_code);

console.log('\n=== M. ส่งคืน Delta และยอดตามใบของชนิดใดก็ได้ (Mat Follow up 5/8) ===');
const C = base.material_code;
const sbk = [
  mk({ kind: 'receive',  qty: 120, lot: 'L1', doc_ref: 'PO1' }),
  // 0.1 กับ 0.2 ตั้งใจเลือก — บวกกันตรง ๆ ได้ 0.30000000000000004 เทสจึงจับได้ถ้าใครถอด round5 (A2)
  mk({ kind: 'sendback', qty: 0.1, doc_ref: 'PO1', reason_code: 'over' }),
  mk({ kind: 'sendback', qty: 0.2, doc_ref: 'PO1', reason_code: 'carry' }),
  mk({ kind: 'sendback', qty: 30,  doc_ref: 'PO2', reason_code: 'over' }),
  voidEntry(mk({ kind: 'sendback', qty: 400, doc_ref: 'PO1', reason_code: 'over' }), { by: 'เจ้าของ', reason: 'คีย์ผิด' }),
  makeEntry({ ...base, entity: 'OTHER', kind: 'sendback', qty: 77, doc_ref: 'PO1', reason_code: 'over' })
];
ok('ส่งคืนลดยอดคงเหลือ 120 − 0.1 − 0.2 − 30 = 89.7 (A2)', balanceOf(sbk, E, C) === 89.7, String(balanceOf(sbk, E, C)));
const sent = movedOfDoc(sbk, E, 'PO1', 'sendback');
ok('รวมยอดส่งคืนของ PO ใบเดียวกันทุกรอบได้ 0.3 ไม่ใช่ 0.30000000000000004 · ไม่ปน PO อื่น (A2) · ที่ยกเลิกไม่นับ (B1)',
   sent.get(C)?.qty === 0.3 && sent.get(C)?.times === 2, JSON.stringify(sent.get(C)));
ok('ส่งคืนของนิติบุคคลอื่นไม่ปน (A3)', movedOfDoc(sbk, 'OTHER', 'PO1', 'sendback').get(C)?.qty === 77);
throws('movedOfDoc ลืมส่ง entity ไม่ได้ (A3)', () => movedOfDoc(sbk, '', 'PO1', 'sendback'), 'นิติบุคคล');
throws('ชนิดที่พิมพ์ผิดต้องดัง ไม่ใช่คืนค่าว่างเงียบ ๆ แล้วของเกินโผล่ให้คืนซ้ำ', () => movedOfDoc(sbk, E, 'PO1', 'sendbak'), 'ไม่รู้จัก');
throws('ไม่ส่งชนิดมาก็ต้องดัง', () => movedOfDoc(sbk, E, 'PO1'), 'ไม่รู้จัก');
// ตรวจชนิดต้องมาก่อน "ไม่มีเลข PO คืนว่าง" — สลับลำดับแล้วชนิดที่พิมพ์ผิดจะเงียบตอนช่อง PO ยังว่าง
throws('ชนิดพิมพ์ผิดต้องดังแม้ยังไม่ได้ใส่เลข PO', () => movedOfDoc(sbk, E, '', 'sendbak'), 'ไม่รู้จัก');
ok('ยอดรับของใบเดียวกันไม่ลดตามที่ส่งคืน — ส่งคืนไม่ได้ทำให้ใบนี้รับมาน้อยลง',
   receivedOfDoc(sbk, E, 'PO1').get(C)?.qty === 120 && receivedOfDoc(sbk, E, 'PO1').size === 1);
ok('receivedOfDoc ให้ผลเท่ากับ movedOfDoc ชนิดรับเข้าทุกประการ',
   JSON.stringify([...receivedOfDoc(rcv, E, 'PO1')]) === JSON.stringify([...movedOfDoc(rcv, E, 'PO1', 'receive')]));
ok('การ์ดรายตัวขึ้นชื่อ "ส่งคืน Delta" เป็นยอดติดลบ',
   cardRows(sbk, E, C).some(r => r.kindLabel === 'ส่งคืน Delta' && r.moved === -0.2));
ok('ส่งคืนไม่ถูกฟ้องว่าเป็นชนิดที่ไม่รู้จัก', unknownKinds(sbk).length === 0);

console.log('\n=== เติมวันหมดอายุทีหลัง (เจ้าของ 24 ก.ย. 2026) ===');
const rx = mk({ kind: 'receive', qty: 5, lot: '2026-09-24', doc_ref: 'PO1', note: 'รับรวมรายรอบ' });
const fx = setExpiry(rx, { date: '2027-03-31', by: 'สมชาย', today: '2026-09-25' });
ok('เติมแล้วได้วันหมดอายุ', fx.expiry_date === '2027-03-31');
ok('ใครเติมเมื่อไหร่ต่อท้ายหมายเหตุเดิม', fx.note === 'รับรวมรายรอบ · เติมวันหมดอายุ 2026-09-25 โดย สมชาย', fx.note);
ok('id กับ created_at ไม่เปลี่ยน (B3) · ยอดไม่เปลี่ยน',
   fx.id === rx.id && fx.created_at === rx.created_at && fx.qty === rx.qty && fx.lot === rx.lot);
ok('updated_at ขยับ ให้ซิงค์รู้ว่ามีการแก้', fx.updated_at >= rx.updated_at);
ok('ไม่แก้ตัวเดิมในที่', rx.expiry_date === '');
throws('รายการที่ยกเลิกแล้วเติมไม่ได้',
   () => setExpiry(voidEntry(rx, { by: 'x', reason: 'y' }), { date: '2027-03-31', by: 'a', today: 't' }), 'ยกเลิก');
throws('เติมได้เฉพาะรับเข้า',
   () => setExpiry(mk({ kind: 'issue', qty: 1 }), { date: '2027-03-31', by: 'a', today: 't' }), 'รับเข้า');
throws('มีวันหมดอายุอยู่แล้ว เติมทับไม่ได้', () => setExpiry(fx, { date: '2027-04-01', by: 'a', today: 't' }), 'อยู่แล้ว');
throws('วันที่ต้องเป็นวันที่', () => setExpiry(rx, { date: '31/03/2027', by: 'a', today: 't' }), 'วันที่');
throws('ต้องบอกว่าใครเติม', () => setExpiry(rx, { date: '2027-03-31', today: 't' }), 'ใคร');
// ผู้ตรวจ #106 — รูปแบบถูกแต่ไม่มีวันนั้นจริง ต้องไม่ผ่าน
throws('เดือน 13 ไม่ผ่าน', () => setExpiry(rx, { date: '2027-13-01', by: 'a', today: 't' }), 'มีอยู่จริง');
throws('31 เม.ย. ไม่ผ่าน', () => setExpiry(rx, { date: '2027-04-31', by: 'a', today: 't' }), 'มีอยู่จริง');
throws('0000-00-00 ไม่ผ่าน', () => setExpiry(rx, { date: '0000-00-00', by: 'a', today: 't' }), 'มีอยู่จริง');
ok('29 ก.พ. ปีอธิกสุรทินผ่าน', setExpiry(rx, { date: '2028-02-29', by: 'a', today: 't' }).expiry_date === '2028-02-29');
throws('29 ก.พ. ปีปกติไม่ผ่าน', () => setExpiry(rx, { date: '2027-02-29', by: 'a', today: 't' }), 'มีอยู่จริง');
throws('ชื่อที่เป็นช่องว่างล้วนไม่นับว่าบอกแล้ว', () => setExpiry(rx, { date: '2027-03-31', by: '   ', today: 't' }), 'ใคร');
ok('ชื่อคนเติมถูกตัดช่องว่างก่อนลงหมายเหตุ',
   setExpiry(rx, { date: '2027-03-31', by: '  สมชาย ', today: '2026-09-25' }).note.endsWith('โดย สมชาย'));
const needs = c => c === 'CHEM';
const mx = [
  mk({ kind: 'receive', material_code: 'CHEM', qty: 1, lot: 'L', doc_ref: 'P', at: '2026-09-22T01:00:00.000Z' }),
  mk({ kind: 'receive', material_code: 'CHEM', qty: 1, lot: 'L', doc_ref: 'P', at: '2026-09-20T01:00:00.000Z' }),
  mk({ kind: 'receive', material_code: 'CHEM', qty: 1, lot: 'L', doc_ref: 'P', expiry_date: '2027-01-01' }),
  mk({ kind: 'receive', material_code: 'TAPE', qty: 1, lot: 'L', doc_ref: 'P' }),
  mk({ kind: 'receive', material_code: 'CHEM', qty: 1, lot: 'L', doc_ref: 'P', entity: 'อื่น' }),
  voidEntry(mk({ kind: 'receive', material_code: 'CHEM', qty: 1, lot: 'L', doc_ref: 'P' }), { by: 'x', reason: 'y' }),
  mk({ kind: 'issue', material_code: 'CHEM', qty: 1 })
];
const miss = missingExpiry(mx, base.entity, needs);
ok('หาเฉพาะรับเข้าที่ยังว่าง ของรหัสที่ต้องมี นิติบุคคลนี้ ไม่ยกเลิก', miss.length === 2, String(miss.length));
ok('เรียงเก่าก่อน', miss[0].at < miss[1].at);
throws('ไม่บอกนิติบุคคล = โยน (A3)', () => missingExpiry(mx, '', needs), 'A3');

console.log('\n=== Log รับเข้า / จ่ายออก (เจ้าของสั่ง 24–25 ก.ย. 2026) ===');
// เวลาเที่ยงวัน — วันที่ตามเวลาเครื่องไม่เลื่อนไม่ว่าเครื่องอยู่เขตเวลาไหน
const at = d => new Date(d + 'T12:00:00').toISOString();
const lgE = [
  mk({ kind: 'receive', qty: 5, lot: 'L1', doc_ref: 'TM9269H001', at: at('2026-09-24'), material_code: 'M1' }),
  mk({ kind: 'return', qty: 1, reason_code: REASONS.return[0].code, at: at('2026-09-25'), material_code: 'M2' }),
  mk({ kind: 'open', qty: 9, at: at('2026-09-01'), material_code: 'M1' }),
  mk({ kind: 'issue', qty: 2, doc_ref: 'TM9269H001', person: 'สมหญิง', at: at('2026-09-25'), material_code: 'M1' }),
  mk({ kind: 'scrap', qty: 1, reason_code: REASONS.scrap[0].code, at: at('2026-09-25'), material_code: 'M2' }),
  mk({ kind: 'sendback', qty: 1, doc_ref: 'TM9269H001', reason_code: REASONS.sendback[0].code, at: at('2026-09-25'), material_code: 'M1' }),
  mk({ kind: 'adjust', counted_qty: 3, book_qty: 4, reason_code: REASONS.adjust[0].code, at: at('2026-09-25'), material_code: 'M1' }),
  mk({ kind: 'receive', qty: 7, lot: 'L2', doc_ref: 'TM9269H002', at: at('2026-09-25'), material_code: 'M2', entity: 'อื่น' }),
  voidEntry(mk({ kind: 'receive', qty: 3, lot: 'L3', doc_ref: 'TM9269H003', at: at('2026-09-25'), material_code: 'M1' }),
            { by: 'หัวหน้า', reason: 'คีย์ซ้ำ' })
];
const mats = { M1: { description: 'GLUE A', unit: 'KGM', category: 'CHEMICAL' }, M2: { description: 'TAPE', unit: 'MTR', category: 'TAPE' } };
const lg = o => logRows(lgE, { entity: base.entity, matOf: c => mats[c], ...o });
ok('รับเข้า = ยกยอดมา · รับเข้า · คืนของ', lg({ side: 'in' }).map(r => r.kind).sort().join() === 'open,receive,return');
ok('จ่ายออก = จ่ายออก · ของเสีย · ส่งคืน Delta', lg({ side: 'out' }).map(r => r.kind).sort().join() === 'issue,scrap,sendback');
ok('ปรับยอดไม่อยู่ทั้งสองฝั่ง', !lg({ side: 'in' }).concat(lg({ side: 'out' })).some(r => r.kind === 'adjust'));
ok('นิติบุคคลอื่นไม่โผล่ (A3)', !lg({ side: 'in' }).some(r => r.entity === 'อื่น'));
throws('ไม่บอกนิติบุคคล = โยน (A3)', () => logRows(lgE, { side: 'in' }), 'A3');
ok('ช่วงวันที่ — วันเดียว', lg({ side: 'in', from: '2026-09-25', to: '2026-09-25' }).map(r => r.kind).join() === 'return');
ok('ใหม่สุดขึ้นก่อน', lg({ side: 'in' }).map(r => r.day).join() === '2026-09-25,2026-09-24,2026-09-01');
ok('รายการที่ยกเลิกซ่อนไว้ก่อน ติ๊กแล้วเห็น (ไม่เคยถูกลบ — B1)',
   !lg({ side: 'in' }).some(r => r.voided) && lg({ side: 'in', voided: true }).filter(r => r.voided).length === 1);
ok('ค้นด้วยชื่อวัตถุดิบ (จากทะเบียน)', lg({ side: 'out', q: 'glue' }).length === 2);
ok('ค้นหลายคำต้องเจอครบทุกคำ', lg({ side: 'out', q: 'TM9269H001 สมหญิง' }).map(r => r.kind).join() === 'issue');
ok('แถวมีชื่อ · หน่วย · หมวด · ชนิดภาษาไทย · เหตุผลอ่านรู้เรื่อง',
   (() => { const r = lg({ side: 'out' }).find(x => x.kind === 'scrap');
            return r.desc === 'TAPE' && r.unit === 'MTR' && r.category === 'TAPE' && r.kindLabel === 'ของเสีย'
                && r.memo.includes(REASONS.scrap[0].label); })());
ok('รหัสที่ไม่มีในทะเบียนไม่พัง', logRows([mk({ kind: 'issue', qty: 1, material_code: 'ZZ' })],
   { entity: base.entity, side: 'out' })[0].desc === '');
{
  const sh = logSheet(lg({ side: 'in', voided: true }));
  ok('Excel — หัวคอลัมน์ครบ และจำนวนแถวตามที่กรอง', sh[0] === LOG_HEAD && sh.length === 1 + 4);
  ok('Excel — แถวที่ยกเลิกบอกสถานะพร้อมเหตุผลและคน',
     sh.some(r => r[15] === 'ยกเลิก — คีย์ซ้ำ โดย หัวหน้า'), JSON.stringify(sh.map(r => r[15])));
}
ok('ไม่มีอะไรเลยก็ไม่พัง', logRows(null, { entity: 'X' }).length === 0 && logSheet([]).length === 1);

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
