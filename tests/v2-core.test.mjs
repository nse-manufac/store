/**
 * เทสแกนสมุดของ v2 — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์ ไม่ต้องต่อเน็ต
 *   node tests/v2-core.test.mjs
 *
 * เน้นข้อที่ถ้าพลาดแล้วยอดเพี้ยนโดยไม่มีอะไรเตือน ซึ่งเป็นความผิดพลาดชนิดที่แพงที่สุด
 * ในโปรแกรมคลัง เพราะกว่าจะรู้ก็ผ่านไปหลายเดือนแล้ว
 */
import fs from 'node:fs';
import { KINDS, REASONS, makeEntry, voidEntry, signedQty, round5, unknownKinds, setExpiry, missingExpiry,
         LOG_KINDS, logRows, logSheet, LOG_HEAD, missingExpiryCounts } from '../v2/core/ledger.js';
import { balanceOf, balances, cardRows, oddBalances, receivedOfDoc, movedOfDoc, poStockOf, stillToIssue, overIssue, poStocks, poMoves, fracSweep, fracTwins, isFracLeft, lastIssueAt } from '../v2/core/balance.js';
import { poLotsOf } from '../v2/core/lots.js';
import { isFracAdj, FRAC_REASON } from '../v2/core/ledger.js';

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

{
  // สลับแท็บช้า (วัด 16 พ.ย. 2026) — สองจุดที่ทำให้เปิดแท็บแล้วต้องไล่ข้อมูลใหม่ทั้งก้อน
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('matOf เปิดดัชนีทะเบียน ไม่ไล่ find() ทั้งทะเบียนทุกครั้ง',
     src.includes('const matOf = code => matIndex.value.get(normCode(code));')
     && !src.includes('materials.value.find(m => normCode(m.material_code) === normCode(code))'));
  ok('Log รับเข้า/จ่ายออก ค้างผลแยกฝั่ง ไม่ผูกกับแท็บ (กลับมาเปิดซ้ำไม่คำนวณใหม่)',
     src.includes("const lgIn = lgSideRows('in'), lgOut = lgSideRows('out');")
     && !src.includes("tab.value !== 'lgin'"));
}

console.log('\n=== วาดตารางยาวทีละช่วง (เจ้าของสั่ง 16 พ.ย. 2026 · ไม่ตัดแถวทิ้ง) ===');
{
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  const a = src.indexOf('    const DRAW_FIRST'), b = a + src.slice(a).search(/\r?\n\r?\n/);
  // รันโค้ดจริงของตัววาดด้วย ref/computed/watch ปลอม · คิวจำลองเฟรมของเบราว์เซอร์
  const env = () => {
    const q = [], tab = {}; let onTab;
    const make = new Function('ref', 'computed', 'watch', 'tab', 'requestAnimationFrame', 'setTimeout',
      src.slice(a, b) + '\nreturn { drawing, drawN };');
    const d = make(v => ({ value: v }), f => ({ get value() { return f(); } }), (s, cb) => { onTab = cb; }, tab,
      cb => q.push(cb), cb => q.push(cb));
    return { ...d, q, frames: () => { let k = 0; while (q.length && k < 1000) { q.shift()(); k++; } return k; },
             switchTab: () => onTab() };
  };
  {
    const e = env(), rows = Array.from({ length: 1234 }, (_, i) => i);
    const v = e.drawing({ value: rows });
    const first = v.value.length;
    e.frames();
    ok('เปิดแท็บแล้วขึ้นแถวแรก ๆ ก่อน แล้ววาดต่อจนครบทุกแถว ไม่มีแถวหาย',
       first < rows.length && v.value.length === rows.length && v.value.every((x, i) => x === i), first + ' → ' + v.value.length);
    e.switchTab();
    ok('สลับแท็บแล้วเริ่มวาดจากแถวแรก ๆ ใหม่', v.value.length === first);
  }
  {
    const e = env(), rows = Array.from({ length: 40 }, (_, i) => i);
    ok('รายการสั้นแสดงครบทันที ไม่ตั้งรอบวาดต่อ', e.drawing({ value: rows }).value.length === 40 && e.q.length === 0);
  }
  {
    const e = env(), rows = Array.from({ length: 900 }, (_, i) => 'PO' + i);
    ok('แถวที่ต้องเลื่อนไปหา (keep) ขึ้นทันทีแม้อยู่ท้ายรายการ', e.drawing({ value: rows }, r => r === 'PO850').value.includes('PO850'));
  }
  {
    // ⚠️ เคสนี้ต้องใช้ Vue ตัวจริง — computed ปลอมข้างบนไม่ cache (body รันใหม่ทุกครั้งที่อ่าน)
    // จึงตั้งรอบวาดใหม่ให้เองเสมอ และมองไม่เห็นอาการ "ค้างที่ 60 แถว" ที่เจอจริงตอนสลับแท็บเร็ว ๆ
    const Vue = new Function(fs.readFileSync(new URL('../v2/lib/vue.global.prod.js', import.meta.url), 'utf8') + '\nreturn Vue;')();
    const { ref, computed, watch, effect, stop, nextTick } = Vue;
    const q = [], tab = ref('ยาว');
    const make = new Function('ref', 'computed', 'watch', 'tab', 'requestAnimationFrame', 'setTimeout',
      src.slice(a, b) + '\nreturn { drawing };');
    const { drawing } = make(ref, computed, watch, tab, cb => q.push(cb), cb => q.push(cb));
    const frames = () => { let k = 0; while (q.length && k < 5000) { q.shift()(); k++; } };
    const rows = ref(Array.from({ length: 3429 }, (_, i) => i));
    const view = drawing(rows);
    let seen = 0, r = null;
    const mount = () => { r = effect(() => { seen = view.value.length; }); };   // ตารางที่อยู่ใน v-if ของแท็บ
    mount();
    const first = seen;
    tab.value = 'สั้น'; await nextTick(); stop(r);    // สลับออกก่อนก้อนแรกมาถึง → ตารางถูกถอดออกจากจอ
    frames();                                         // ปล่อยเฟรมที่ค้างไว้ให้หมด
    tab.value = 'ยาว'; await nextTick(); mount();      // กลับมาแท็บเดิม ตารางถูกสร้างใหม่
    frames();
    ok('สลับแท็บออกก่อนก้อนแรกมาถึงแล้วกลับมา ยังวาดต่อจนครบทุกแถว ไม่ค้างที่ 60 แถว',
       first === 60 && seen === rows.value.length, first + ' → ' + seen + ' จาก ' + rows.value.length);
  }
  ok('ตารางยาวทุกตารางวนจากตัววาด (MRP · PO · ขาดรอรับ · over · รอเติมวันหมดอายุ)',
     ['r in mrpDraw"', '(p,i) in poDraw"', 'g in fsDraw"', 'g in foDraw"', 'r in fxDraw"'].every(k => html.includes('v-for="' + k)));
  // หน้า short / over (21 พ.ย. 2026): ตัวเลขอยู่บนปุ่มกรอง นับจาก fsNew / foNew เต็ม ไม่ใช่จากที่วาดแล้ว
  ok('ตัวเลขนับบนจอยังนับจากรายการเต็ม', html.includes('{{ fsCounts[f.k] }}') && html.includes('{{ foCounts[f.k] }}')
     && src.includes('new: fsNew.value.length') && src.includes('new: foNew.value.length')
     && html.includes('{{ fxRows.length }} รายการ') && html.includes('แสดง {{ poRows.length }} จาก'));
  ok('ใบที่กดกลับมาจาก MRP ขึ้นทันที (ปุ่มกลับไป MRP เลื่อนหาแถวนั้น)',
     src.includes("const mrpDraw = drawing(mrpShown, r => r.po === mrpPin.value);"));
}

console.log('\n=== หน้ายอดคงคลังไม่มีปุ่มจ่ายออก (เจ้าของสั่ง 22 พ.ย. 2026) ===');
{
  // พนักงานกดจ่ายออกจากหน้ายอดคงคลัง (รายรหัส · การ์ด) แล้วสับสน — จ่ายออกที่หน้าจ่ายออกที่เดียว
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  const i = html.indexOf(`<template v-else-if="tab==='bal'">`);
  const bal = html.slice(i, html.indexOf('<template v-else-if="tab===', i + 10));
  ok('หน้ายอดคงคลัง (รายรหัส + การ์ด) ไม่มีปุ่มจ่ายออก · ปุ่มเปิดการ์ดยังอยู่',
     i >= 0 && !/goIssue|จ่ายออกรหัสนี้|>จ่ายออก<\/button>/.test(bal) && bal.includes('@click="openCard(r.code)">การ์ด</button>'));
  ok('ไม่มีฟังก์ชันพาไปจ่ายออกค้างอยู่ใน app.js', !/goIssue/.test(src));
}

console.log('\n=== ยกเลิกรายการจากหน้า Log (เจ้าของสั่ง 19 พ.ย. 2026) ===');
{
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  const a = html.indexOf('<tr v-for="r in lgShown"'), row = html.slice(a, html.indexOf('</tr></tbody>', a));
  ok('ทุกแถวในหน้า Log ที่ยังไม่ยกเลิกมีปุ่มยกเลิก · แถวที่ยกเลิกแล้วไม่มี',
     a > 0 && row.includes('<button v-if="!r.voided" class="btn" style="padding:2px 8px" @click="askVoid(r)">ยกเลิก</button>'));
  ok('หัวตาราง Log มีช่องของปุ่ม (คอลัมน์ไม่เลื่อน)', /<th>หมายเหตุ<\/th><th class="noprint"><\/th>\s*<\/tr><\/thead>/.test(html));
  // กล่องยืนยันตัวเดียวกับการ์ด: ต้องอยู่นอกแท็บ ไม่งั้นกดจากหน้า Log แล้วไม่มีอะไรขึ้น
  const box = html.indexOf('<div class="modal" v-if="voidBox.row"'), lastTab = html.lastIndexOf("v-else-if=\"tab==='");
  ok('กล่องยืนยันยกเลิกอยู่นอกแท็บ (ขึ้นได้จากทุกหน้า)', box > lastTab && box > 0);
  // ใบที่ยกเลิกพร้อมกัน: ล้างเศษ (tw) + คู่ทดแทน short ของ "คืนของ แบบ 2" (pr · ผู้ตรวจ #199 รอบ 3)
  // splice แทนที่ในตำแหน่งเดิมด้วยใบที่ติดธงแล้ว — ไม่ใช่ลบออกจากสมุด (B1)
  ok('ยกเลิกแล้วรายการยังอยู่ในสมุด แค่ติดธงยกเลิก (B1)', /function voidBundle\(src, by, reason\) \{\s*const v = voidEntry\(src,[\s\S]*?all: \[v, \.\.\.tw, \.\.\.pr\][\s\S]*?async function doVoid\(\)[\s\S]*?= voidBundle\(src, by, reason\);[\s\S]*?for \(const x of all\) entries\.value\.splice\(entries\.value\.findIndex\(e => e\.id === x\.id\), 1, x\)/.test(src));
}

console.log('\n=== หน้ารอเติมวันหมดอายุ (แท็บย่อยใน Log · เจ้าของเคาะ 28 ก.ย. 2026) ===');
ok('นับรายการที่ขาดแยกตามนิติบุคคล — ไม่นับที่ยกเลิก/มีแล้ว/ไม่ต้องมี/ไม่ใช่รับเข้า',
   JSON.stringify(missingExpiryCounts(mx, needs)) === JSON.stringify([{ entity: base.entity, n: 2 }, { entity: 'อื่น', n: 1 }].sort((a, b) => a.entity.localeCompare(b.entity))),
   JSON.stringify(missingExpiryCounts(mx, needs)));
ok('ไม่มีอะไรเลยก็ไม่พัง', missingExpiryCounts(null, needs).length === 0);
{
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('แท็บย่อย "รอเติมวันหมดอายุ" อยู่ในกลุ่ม Log', /k: 'log'[\s\S]*?k: 'lgexp'[\s\S]*?\] \}/.test(src));
  ok('หน้าเติมใช้ setExpiry (ด่านเดียว) และกรองนิติบุคคลด้วย missingExpiry',
     src.includes('setExpiry(e, { date: fxDraft[e.id], by: fx.by, today: todayLocal() })')
     && src.includes('missingExpiry(entries.value, entity.value, needsExp)'));
  ok('หน้าแรกมีตัวนับที่พาไปแท็บนี้', src.includes("label: 'รับเข้าที่ยังไม่มีวันหมดอายุ', tab: 'lgexp'"));
}

console.log('\n=== ยอดของ PO ใบเดียวบนหน้าจ่ายออก (เจ้าของสั่ง 16 พ.ย. 2026) ===');
{
  const C = base.material_code;
  const rows = [
    mk({ kind: 'receive', qty: 100, lot: 'L1', doc_ref: 'POA' }),
    mk({ kind: 'receive', qty: 20.5, lot: 'L2', doc_ref: 'POA' }),
    mk({ kind: 'receive', qty: 999, lot: 'L3', doc_ref: 'POB' }),
    mk({ kind: 'sendback', qty: 5, reason_code: 'over', doc_ref: 'POA' }),
    mk({ kind: 'issue', qty: 30, doc_ref: 'POA' }),
    mk({ kind: 'issue', qty: 10.2, doc_ref: 'POA' }),
    mk({ kind: 'issue', qty: 7, doc_ref: 'POB' }),
    mk({ kind: 'issue', qty: 3 }),                                    // เบิกไม่อ้าง PO
    mk({ kind: 'return', qty: 4, reason_code: 'unused', doc_ref: 'POA' }),
    mk({ kind: 'scrap', qty: 2, reason_code: 'wind', doc_ref: 'POA' }),
    voidEntry(mk({ kind: 'issue', qty: 50, doc_ref: 'POA' }), { by: 'เจ้าของ', reason: 'คีย์ผิด' }),
    makeEntry({ ...base, entity: 'OTHER', kind: 'issue', qty: 888, doc_ref: 'POA' })
  ];
  const s = poStockOf(rows, E, 'POA').get(C);
  ok('คงเหลือ PO = รับ − ส่งคืน Delta − จ่ายออก ของใบนี้', s.bal === 75.3, JSON.stringify(s));
  ok('จ่ายแล้วรวมทุกรอบของใบนี้ ไม่นับที่ยกเลิก (B1)', s.issued === 40.2, String(s.issued));
  ok('ไม่นับคืนของกับของเสียที่อ้าง PO (เจ้าของเคาะ)', s.recv === 120.5 && s.sendback === 5);
  ok('PO ใบอื่น · เบิกไม่อ้าง PO · นิติบุคคลอื่น ไม่ปน (A3)',
     poStockOf(rows, E, 'POB').get(C).bal === 992 && poStockOf(rows, 'OTHER', 'POA').get(C).bal === -888);
  ok('จ่ายไปแล้วแต่ยังไม่รับ = ติดลบ ไม่หาย',
     poStockOf([mk({ kind: 'issue', qty: 6, doc_ref: 'POC' })], E, 'POC').get(C).bal === -6);
  ok('ไม่ใส่เลข PO = ว่าง', poStockOf(rows, E, '').size === 0);
  throws('poStockOf ลืมส่ง entity ไม่ได้ (A3)', () => poStockOf(rows, '', 'POA'), 'นิติบุคคล');
  ok('ยังต้องจ่าย = ตามสูตร − จ่ายแล้ว', stillToIssue(100, 40.2) === 59.8);
  ok('ยังไม่รู้ยอดตามสูตร = null ไม่ใช่ 0', stillToIssue(null, 5) === null && stillToIssue('', 5) === null);
  ok('จ่ายเกินสูตร = ติดลบ', stillToIssue(10, 12) === -2);
}

console.log('\n=== ห้ามจ่ายออกเกินของที่มี (A4 · เจ้าของสั่ง 25 พ.ย. 2026) ===');
{
  const have = { A1: 10, B2: 0.5, C3: 3 };                       // รหัสสมมติ
  const bal = c => have[String(c).trim().toUpperCase()] ?? 0;
  ok('จ่ายไม่เกินที่มี = ผ่าน', overIssue([{ code: 'A1', qty: 10 }, { code: 'B2', qty: 0.5 }], bal).length === 0);
  const o = overIssue([{ code: 'A1', qty: 12 }], bal);
  ok('จ่ายเกิน = บอกมีเท่าไหร่ จะจ่ายเท่าไหร่ ขาดเท่าไหร่',
     o.length === 1 && o[0].bal === 10 && o[0].qty === 12 && o[0].short === 2, JSON.stringify(o));
  ok('เกินแค่เศษก็ไม่ผ่าน (ทุกรหัส ไม่มีเพดานเศษ)', overIssue([{ code: 'B2', qty: 0.50001 }], bal).length === 1);
  ok('ทศนิยมลอยไม่ทำให้ติด — 0.1 + 0.2 จากของ 0.3', overIssue([{ code: 'X', qty: 0.1 }, { code: 'X', qty: 0.2 }], () => 0.3).length === 0);
  const two = overIssue([{ code: 'C3', qty: 2 }, { code: ' c3 ', qty: 2 }], bal);
  ok('รหัสเดียวกันสองบรรทัดรวมยอดก่อนเทียบ — ทีละบรรทัดผ่าน รวมกันเกิน',
     two.length === 1 && two[0].qty === 4 && two[0].short === 1, JSON.stringify(two));
  ok('ไม่เคยรับเลย = ของที่มีเป็น 0 ไม่ผ่าน', overIssue([{ code: 'NEW', qty: 1 }], bal)[0]?.short === 1);
  ok('ของติดลบอยู่แล้ว = ขาดนับจากยอดติดลบ', overIssue([{ code: 'Z', qty: 1 }], () => -2)[0]?.short === 3);
  ok('บรรทัดไม่มีรหัสหรือยอดว่างไม่นับ', overIssue([{ code: '', qty: 5 }, { code: 'A1', qty: 0 }], bal).length === 0);

  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  const save = src.slice(src.indexOf('async function saveOut()'), src.indexOf('const at = atFrom(outH.date)', src.indexOf('async function saveOut()')));
  ok('saveOut หยุดก่อนบันทึกเมื่อจ่ายเกิน ไม่มีกล่องยืนยันให้กดผ่าน',
     /if \(outOver\.value\.length\) \{ flash\([^\n]*\); return; \}/.test(save) && !/confirm\(/.test(save));
  ok('ของที่มี = ยอดของ PO บนหัวจอ หรือยอดรวมถ้าไม่ใส่ PO (outBalOf)',
     /const outOver = computed\(\(\) => overIssue\(outReady\.value, code => outBalOf\(\{ code \}\)/.test(src));
  ok('ปุ่มบันทึกจ่ายออกกดไม่ได้เมื่อจ่ายเกิน · กล่องแดงบอกตัวเลขที่ทำให้ติด',
     /:disabled="!outReady\.length \|\| outOver\.length > 0">บันทึกจ่ายออก/.test(html)
     && /class="msg bad" v-if="outOver\.length"/.test(html) && /' มี ' \+ o\.bal \+ ' จะจ่าย ' \+ o\.qty \+ ' ขาด ' \+ o\.short/.test(html));
}

console.log('\n=== ล้างเศษ PO ตอนจ่ายออก (เจ้าของเคาะ 22 พ.ย. 2026 · แบบ ก แยกเป็นรายการปรับยอด) ===');
{
  const P = '3510000001', K = '4010000001', M = '3220000001';   // ชิ้น · กิโล · เมตร (สมมติ)
  const tolOf = c => ({ [P]: 1, [K]: 0.001, [M]: 0.01 })[c] || 0;
  const by = { person: 'สมชาย', device: 'PC-T', at: '2026-11-22T03:00:00.000Z', part_no: 'PN-1' };
  const rows = [
    mk({ material_code: P, kind: 'receive', qty: 438, lot: 'W46', doc_ref: 'POF' }),
    mk({ material_code: P, kind: 'issue', qty: 437.10025, doc_ref: 'POF' }),       // จ่ายตามสูตร เหลือ 0.89975 ชิ้น
    mk({ material_code: K, kind: 'receive', qty: 1.2, lot: 'W46', doc_ref: 'POF' }),
    mk({ material_code: K, kind: 'issue', qty: 1.2005, doc_ref: 'POF' }),          // จ่ายเกิน 0.0005 กก. (ไม่ถึง 1 กรัม)
    mk({ material_code: M, kind: 'receive', qty: 10, lot: 'W46', doc_ref: 'POF' }),
    mk({ material_code: M, kind: 'issue', qty: 9.5, doc_ref: 'POF' })               // เหลือ 0.5 เมตร = ของจริง ไม่ล้าง
  ];
  const sw = fracSweep(rows, E, 'POF', [P, K, M], tolOf, by);
  const of = c => sw.find(e => e.material_code === c);
  ok('ล้างเฉพาะรหัสที่เหลือเป็นเศษต่ำกว่าเกณฑ์ (ชิ้นเหลือ 0.89975 · กิโลติดลบ 0.0005) · เมตรเหลือ 0.5 ไม่แตะ',
     sw.length === 2 && of(P) && of(K) && !of(M), JSON.stringify(sw.map(e => [e.material_code, e.delta])));
  ok('เป็นปรับยอดเหตุผล "ล้างเศษ" อ้าง PO · delta = −เศษ ทั้งเหลือและติดลบ · ไม่ใช่ "นับได้" จริง',
     sw.every(e => e.kind === 'adjust' && e.reason_code === FRAC_REASON && isFracAdj(e) && e.doc_ref === 'POF' && e.doc_kind === 'po')
     && of(P).delta === -0.89975 && of(K).delta === 0.0005 && of(P).counted_qty === 0 && /ล้างเศษ PO POF/.test(of(P).note),
     JSON.stringify(sw));
  const after = [...rows, ...sw];
  ok('ล้างแล้วคงเหลือ PO = 0 ทั้ง poStockOf · poStocks · poMoves (สามตัวต้องพูดตรงกัน)',
     poStockOf(after, E, 'POF').get(P).bal === 0 && poStockOf(after, E, 'POF').get(K).bal === 0
     && poStocks(after, E).get('POF').get(P).bal === 0 && poStocks(after, E).get('POF').get(K).frac === 0.0005
     && poMoves(after, E, 'POF', P).at(-1).run === 0 && poMoves(after, E, 'POF', K).at(-1).run === 0
     && poStockOf(after, E, 'POF').get(M).bal === 0.5);
  ok('ยอดคงคลังรวมของรหัสขยับตาม (เศษนั้นไม่มีอยู่จริง) · ล็อตราย PO หมดด้วย',
     balanceOf(after, E, P) === 0 && balanceOf(after, E, K) === 0 && poLotsOf(after, E, P, 'POF').length === 0);
  ok('ล้างแล้วเรียกซ้ำ = ไม่มีอะไรให้ล้าง (ไม่เกิดรายการซ้อน)', fracSweep(after, E, 'POF', [P, K, M], tolOf, by).length === 0);
  ok('หน่วยที่ไม่มีเกณฑ์ (0) · รหัสที่ไม่ได้ส่งมา · ไม่มีเลข PO · คงเหลือ 0 พอดี = ไม่ล้าง',
     fracSweep(rows, E, 'POF', [P], () => 0, by).length === 0 && fracSweep(rows, E, 'POF', [M], tolOf, by).length === 0
     && fracSweep(rows, E, '', [P], tolOf, by).length === 0
     && fracSweep([mk({ material_code: P, kind: 'receive', qty: 5, lot: 'L', doc_ref: 'POG' }), mk({ material_code: P, kind: 'issue', qty: 5, doc_ref: 'POG' })],
                  E, 'POG', [P], tolOf, by).length === 0);
  ok('PO ที่ยังไม่ได้รับเข้าเลย = ไม่ใช่เศษ ไม่ล้าง ทั้งจ่ายเกินเศษหรือส่งคืน (กฎเดียวกับ #182 · เจ้าของเคาะ 23 พ.ย.)',
     fracSweep([mk({ material_code: P, kind: 'issue', qty: 0.8, doc_ref: 'POH' })], E, 'POH', [P], tolOf, by).length === 0
     && fracSweep([mk({ material_code: K, kind: 'issue', qty: 0.0004, doc_ref: 'POH' })], E, 'POH', [K], tolOf, by).length === 0);
  ok('ล้างจากปุ่มทีหลัง (เวลาที่กด) ผูกกับจ่ายออกก่อนหน้า · ยกเลิกจ่ายแล้วยอด PO กลับเท่ารับ ไม่ขาดไปเท่าเศษ (ผู้ตรวจ #186 รอบ 2)',
     (() => { const iss = rows[1], later = new Date(Date.parse(iss.at) + 30 * 86400e3).toISOString();   // กดปุ่มหนึ่งเดือนหลังจ่าย
              const btn = fracSweep(rows, E, 'POF', [P, K], tolOf, { ...by, at: later }), tw = fracTwins([...rows, ...btn], iss);
              const back = [...rows.filter(e => e !== iss), voidEntry(iss, { by: 'ก', reason: 'ข' }), ...btn.map(e => tw.includes(e) ? voidEntry(e, { by: 'ก', reason: 'ข' }) : e)];
              return btn.length === 2 && tw.length === 1 && tw[0].material_code === P && poStockOf(back, E, 'POF').get(P).bal === 438; })());
  {
    const iss = rows[1], sw2 = fracSweep(rows, E, 'POF', [P, K], tolOf, { ...by, at: iss.at }), all = [...rows, ...sw2];
    const tw = fracTwins(all, iss);
    const early = fracSweep(rows, E, 'POF', [P], tolOf, { ...by, at: '2000-01-01T00:00:00.000Z' });
    ok('ล้างเศษที่ทำพร้อมจ่ายออก ผูกกับจ่ายออกรายการนั้น (PO + รหัส + เวลาเดียวกัน) · รหัสอื่น / ล้างก่อนจ่าย / รับเข้า ไม่ผูก',
       tw.length === 1 && tw[0].material_code === P && tw[0].at === iss.at
       && fracTwins([...rows, ...early], iss).length === 0 && fracTwins(all, rows[0]).length === 0 && fracTwins(all, null).length === 0,
       JSON.stringify(tw.map(e => [e.material_code, e.at])));
    ok('ล้างเศษคู่กันที่ยกเลิกไปแล้วไม่นับซ้ำ · ยกเลิกทั้งคู่แล้วยอด PO กลับเหมือนก่อนจ่าย',
       fracTwins([...rows, ...sw2.map(e => e.material_code === P ? voidEntry(e, { by: 'ก', reason: 'ข' }) : e)], iss).length === 0
       && poStockOf([...rows.filter(e => e !== iss), voidEntry(iss, { by: 'ก', reason: 'ข' }), ...sw2.map(e => e.material_code === P ? voidEntry(e, { by: 'ก', reason: 'ข' }) : e)], E, 'POF').get(P).bal === 438);
  }
  ok('ปรับยอดชนิดอื่นที่อ้าง PO ยังไม่นับเข้ายอด PO เหมือนเดิม (เจ้าของเคาะ 16 พ.ย.)',
     poStockOf([...rows, mk({ material_code: M, kind: 'adjust', reason_code: 'count', counted_qty: 0, book_qty: 0.5, doc_ref: 'POF' })], E, 'POF').get(M).bal === 0.5);
  ok('ยกเลิกรายการล้างเศษ = เศษกลับมา (B1)',
     poStockOf([...rows, voidEntry(of(P), { by: 'เจ้าของ', reason: 'ทดสอบ' })], E, 'POF').get(P).bal === 0.89975);
  // ── ล้างเศษของเก่า: ปุ่มในรายการเคลื่อนไหวหน้ายอดคงคลังราย P/N (ใบที่ 3 · เจ้าของเคาะ 23 พ.ย.) ──
  ok('isFracLeft: รับเข้าแล้ว และ 0 < |คงเหลือ| < เกณฑ์ เท่านั้น',
     isFracLeft({ recv: 438, bal: 0.89975 }, 1) && isFracLeft({ recv: 1.2, bal: -0.0005 }, 0.001)
     && !isFracLeft({ recv: 0, bal: -0.8 }, 1) && !isFracLeft({ recv: 5, bal: 0 }, 1) && !isFracLeft({ recv: 10, bal: 0.5 }, 0.01)
     && !isFracLeft({ recv: 5, bal: 1 }, 1) && !isFracLeft(null, 1) && !isFracLeft({ recv: 5, bal: 0.5 }, 0));
  ok('ปุ่มขึ้นตรงกับที่ fracSweep ล้างจริง (ตัวตัดสินตัวเดียวกัน)',
     [...poStockOf(rows, E, 'POF')].filter(([c, r]) => isFracLeft(r, tolOf(c))).map(([c]) => c).sort().join()
     === sw.map(e => e.material_code).sort().join());
  ok('สองเครื่องกดล้างพร้อมกันก่อนซิงค์ ได้เลขรายการเดียวกัน (ซิงค์แล้วรวมเป็นรายการเดียว ไม่หักซ้อน)',
     fracSweep(rows, E, 'POF', [P], tolOf, { ...by, device: 'PC-2' })[0].id === of(P).id && of(P).id !== of(K).id);
  ok('ยกเลิกรายการล้างเศษแล้วล้างใหม่ ได้เลขใหม่ ไม่ทับประวัติที่ยกเลิก (B1)',
     (() => { const again = fracSweep([...rows, voidEntry(of(P), { by: 'เจ้าของ', reason: 'ทดสอบ' })], E, 'POF', [P], tolOf, by);
              return again.length === 1 && again[0].id !== of(P).id; })());
  ok('เลขรายการล้างเศษคั่นด้วย | — PO/รหัสที่มีขีดไม่ชนกัน (ผู้ตรวจ #186)',
     (() => { const mk = (po, c) => fracSweep([{ id: 'r', entity: E, kind: 'receive', material_code: c, doc_ref: po, qty: 1.5, at: '2026-11-01T00:00:00Z' },
                                               { id: 'i', entity: E, kind: 'issue', material_code: c, doc_ref: po, qty: 1, at: '2026-11-02T00:00:00Z' }],
                                              E, po, [c], () => 1, by)[0];
              const a = mk('A-B', 'C'), b = mk('A', 'B-C');
              return !!a && !!b && a.id !== b.id && a.id === `FRAC|${E}|A-B|C|0`; })());
  // ── กล่องล้างเศษให้เลือกวันที่เองได้ จึงต้องมีพื้นเวลา: ห้ามเก่ากว่าใบจ่ายออกใบล่าสุด (ผู้ตรวจ #198 รอบ 1) ──
  {
    const R = mk({ material_code: P, kind: 'receive', qty: 438, lot: 'W46', doc_ref: 'POJ', at: '2026-11-01T03:00:00.000Z' });
    const I1 = mk({ material_code: P, kind: 'issue', qty: 200, doc_ref: 'POJ', at: '2026-11-10T03:00:00.000Z' });
    const I2 = mk({ material_code: P, kind: 'issue', qty: 237.10025, doc_ref: 'POJ', at: '2026-11-20T03:00:00.000Z' });
    const vo = e => voidEntry(e, { by: 'เจ้าของ', reason: 'ทดสอบ' });
    const base3 = [R, I1, I2], floor = lastIssueAt(base3, E, 'POJ', P);
    ok('lastIssueAt: เวลาใบจ่ายออกใบล่าสุดของ PO + รหัสนั้น · ไม่นับรับเข้า / ใบที่ยกเลิก / PO หรือรหัสอื่น / ไม่มีเลข PO',
       floor === I2.at && lastIssueAt([R, I1, vo(I2)], E, 'POJ', P) === I1.at
       && lastIssueAt([R], E, 'POJ', P) === '' && lastIssueAt(base3, E, 'POJ', K) === ''
       && lastIssueAt(base3, E, 'POZ', P) === '' && lastIssueAt(base3, E, '', P) === '',
       floor + ' / ' + lastIssueAt([R, I1, vo(I2)], E, 'POJ', P));
    // เศษ 0.89975 เกิดจากใบ 20 พ.ย. — ล้างย้อนไป 15 พ.ย. (คั่นกลางสองใบจ่าย) ผูกคู่ไม่เจอ แล้วยกเลิกใบนั้นยอดขาดเงียบ ๆ
    const bad = fracSweep(base3, E, 'POJ', [P], tolOf, { ...by, at: '2026-11-15T03:00:00.000Z' });
    const left = poStockOf([R, I1, vo(I2), ...bad], E, 'POJ').get(P);
    ok('ล้างเศษที่ at เก่ากว่าใบจ่ายล่าสุด = ยกเลิกใบจ่ายแล้วยอด PO ขาดไปเท่าเศษ และไม่มีป้าย "เศษ" ให้เห็นอีก',
       bad.length === 1 && fracTwins([...base3, ...bad], I2).length === 0
       && left.bal === 237.10025 && !isFracLeft(left, tolOf(P)) && '2026-11-15T03:00:00.000Z' < floor,
       JSON.stringify(left));
    const good = fracSweep(base3, E, 'POJ', [P], tolOf, { ...by, at: floor });
    ok('ล้างเศษที่ at ไม่เก่ากว่า lastIssueAt ผูกคู่ได้ · ยกเลิกทั้งคู่แล้วยอด PO กลับเท่ารับ − ที่จ่ายจริง (จอต้องบังคับให้อยู่ฝั่งนี้)',
       good.length === 1 && fracTwins([...base3, ...good], I2).length === 1
       && poStockOf([R, I1, vo(I2), ...good.map(vo)], E, 'POJ').get(P).bal === 238);
    throws('lastIssueAt ลืมส่ง entity ไม่ได้ (A3)', () => lastIssueAt(base3, '', 'POJ', P), 'นิติบุคคล');
  }
  {
    const appB = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
    const htmlB = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    ok('จอ: ค้างเศษ = ปุ่ม "ล้างเศษ" ท้ายรายการเคลื่อนไหวของ PO นั้น (ไม่ทำตารางแยก) · ปุ่มเรียก fracSweep รหัสเดียว · ป้าย "ล้างเศษ" ในรายการ',
       /<tr v-if="bpFrac\(p, l\.code\)" class="noprint">[\s\S]*?@click\.stop="bpFracOpen\(p\.po, l\.code, r\.pn\)">ล้างเศษ<\/button>/.test(htmlB)
       && /const bpFrac = \(p, code\) => isFracLeft\(p, fracTolAt\(code\)\);/.test(appB)
       && /fracSweep\(entries\.value, entity\.value, po, \[code\], fracTolAt, \{ person, device: device\.value, part_no: pn, at \}/.test(appB)
       && /if \(!person \|\| !date\) return;/.test(appB)
       && /v-if="balView==='pn' && !bpClosed" class="hint noprint"[^>]*>PO ที่ส่งครบแล้วหรือเก่ากว่า \{\{ MRP_FRESH_DAYS \}\}/.test(htmlB)
       && /label: isFracAdj\(m\.e\) \? 'ล้างเศษ' : KINDS/.test(appB) && !/fracLeftovers|balView==='frac'/.test(appB + htmlB));
    ok('จอ: ป้าย "เศษ" บนแถว PO กดล้างได้เลย เรียกตัวเดียวกับปุ่มข้างใน · ไม่พับ/กางแถว (ผู้ใช้บอกว่าลึกเกิน · 26 พ.ย. 2026)',
       /<button v-if="bpFrac\(p, l\.code\)" class="tag warn bp-frac"[^>]*@click\.stop="bpFracOpen\(p\.po, l\.code, r\.pn\)">เศษ<\/button>/.test(htmlB)
       && /button\.tag\.bp-frac\{[^}]*cursor:pointer/.test(htmlB));
    ok('จอ: ล้างเศษเป็นกล่องกรอกวันที่ · ชื่อผู้ล้าง แบบกล่องจ่ายออก ไม่ใช้ prompt · ปุ่มบันทึกกดไม่ได้ถ้าไม่มีเศษแล้ว/ไม่มีชื่อ/ไม่มีวันที่ (27 พ.ย. 2026)',
       !/prompt\(`ล้างเศษ/.test(appB) && /<div class="modal" v-if="bpFq\.open"/.test(htmlB)
       && /<input v-model="bpFq\.date" type="date"/.test(htmlB) && /ชื่อผู้ล้าง<input v-model\.trim="bpFq\.person"/.test(htmlB)
       && /:disabled="!bpFqRow \|\| !bpFrac\(bpFqRow, bpFq\.code\) \|\| !bpFq\.person \|\| !bpFq\.date">บันทึกล้างเศษ/.test(htmlB));
    ok('จอ: กล่องล้างเศษไม่ยอมบันทึกวันที่ย้อนก่อนใบจ่ายออกครั้งล่าสุด · ด่านอยู่ใน bpFracClean ไม่ใช่แค่ :min (พิมพ์ข้ามได้) · ข้อความบอกทางออก (G3 · ผู้ตรวจ #198 รอบ 1)',
       /const bpFqFloor = computed\(\(\) => \(bpFq\.open && entity\.value \? lastIssueAt\(entries\.value, entity\.value, bpFq\.po, bpFq\.code\)/.test(appB)
       && /const floor = bpFqFloor\.value;\s*\n\s*let at = atFrom\(date\);\s*\n\s*if \(floor && at < floor\) \{/.test(appB)
       && /flash\(`ล้างเศษย้อนหลังก่อนวันที่จ่ายออกครั้งล่าสุด \(\$\{localDate\(floor\)\}\) ไม่ได้ — เลือกวันที่ตั้งแต่วันนั้นขึ้นไป`, true\);\s*\n\s*return;/.test(appB)
       && /if \(localDate\(at\) !== localDate\(floor\)\) \{/.test(appB)   // วันเดียวกันแต่นาฬิกาย้อน = ขยับเวลาในวัน ไม่ใช่ปฏิเสธ (ไม่งั้นล้างไม่ได้เลย)
       && /<input v-model="bpFq\.date" type="date" :min="localDate\(bpFqFloor\)">/.test(htmlB));
  }
  throws('fracSweep ลืมส่ง entity ไม่ได้ (A3)', () => fracSweep(rows, '', 'POF', [P], tolOf, by), 'นิติบุคคล');
  ok('"ล้างเศษ" ระบบทำเอง — อยู่ในรายการเหตุผล (ป้ายในการ์ด) แต่ติด auto ไม่ให้คนเลือก',
     REASONS.adjust.some(r => r.code === FRAC_REASON && r.auto === true) && REASONS.adjust.filter(r => r.auto).length === 1);
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const so = app.slice(app.indexOf('async function saveOut('), app.indexOf('// ── ของเสีย · คืนของ · ปรับยอด'));
  const htmlV = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: กล่องยกเลิกรายการ ถ้าการปรับยอดที่อยู่หลังเป็นล้างเศษ ไม่เขียน "ที่เคยนับได้" (ผู้ตรวจ #185)',
     /v-if="isFracAdj\(voidAfterAdjust\)">รายการนั้นคือ <b>ล้างเศษ PO/.test(htmlV)
     && /e\.at > r\.at\s*&& !voidTwins\.value\.some\(t => t\.id === e\.id\)\)/.test(app) && /<span class="hint" v-else>ส่วนต่างของการปรับยอด/.test(htmlV)
     && /voidTwins, voidPairs, reasonLabel, noteCell, isFracAdj \};/.test(app));
  ok('จอ: ยกเลิกจ่ายออกแล้วยกเลิกล้างเศษที่คู่กันในรอบเดียวกัน · กล่องยืนยันบอกก่อน (เจ้าของเคาะ 23 พ.ย.)',
     /const tw = fracTwins\(entries\.value, src\)\.map\(t => voidEntry\(t,/.test(app)
     && /return \{ v, tw, pr, all: \[v, \.\.\.tw, \.\.\.pr\] \};/.test(app)
     && /const \{ tw, pr, all \} = voidBundle\(src, by, reason\);\s*await db\.put\('entries', all\)/.test(app)
     && /<p class="hint" v-if="voidTwins\.length"/.test(htmlV));
  // ปุ่มแก้จ่ายเกิน BOM หน้ายอดคงคลัง (28 พ.ย. 2026) ยกเลิกผ่าน voidBundle ตัวเดียวกับ Log — ล้างเศษคู่ไม่ค้าง
  ok('จอ: แก้จ่ายเกินจากหน้ายอดคงคลังยกเลิกผ่าน voidBundle เดียวกับ Log (ล้างเศษ / คู่ทดแทนไปด้วย)',
     /async function bpFixSave\(\)[\s\S]*?const \{ tw, all \} = voidBundle\(src, by,/.test(app)
     && /await db\.put\('entries', \[\.\.\.all, \.\.\.add\]\);\s*for \(const x of all\) entries\.value\.splice/.test(app));
  ok('จอ: บันทึกจ่ายออกแล้วล้างเศษของ PO นั้น (try ของตัวเอง) · ช่องเลือกเหตุผลกรองของ auto ออก · "นับได้" ไม่ขึ้นกับล้างเศษ',
     /fracSweep\(entries\.value, entity\.value, outH\.po, posted\.map\(e => e\.material_code\), fracTolAt,/.test(so)
     && so.indexOf('fracSweep(') > so.indexOf("await db.put('entries', posted)") && /if \(outH\.po\) try \{/.test(so)
     && /REASONS\[mk\.kind\] \|\| \[\]\)\.filter\(r => !r\.auto\)/.test(app) && /!isFracAdj\(e\)\) \? 'นับได้ '/.test(app));
  // atFrom หยิบมิลลิวินาทีของนาฬิกาขณะเรียก — เรียกใหม่ทุกบรรทัดใน .map() แล้วบรรทัดที่ 2 ขึ้นไป
  // จะมี at ต่างจากรายการล้างเศษ (วัดได้ 0.26–4.3% ตามจำนวนบรรทัด) แล้ว fracTwins ผูกคู่ไม่เจอ
  ok('จอ: จ่ายออกคิดเวลาครั้งเดียวต่อการบันทึก ทุกบรรทัดกับล้างเศษใช้ at ตัวเดียวกัน (ผู้ตรวจ #185 รอบ 4)',
     /const at = atFrom\(outH\.date\);/.test(so) && (so.match(/atFrom\(/g) || []).length === 1
     && so.indexOf('atFrom(') < so.indexOf('outReady.value.map(') && !so.includes('posted[0].at'),
     JSON.stringify(so.match(/at[,:] ?[^\n]*/g)));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
