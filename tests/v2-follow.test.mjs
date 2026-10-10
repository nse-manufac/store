/**
 * เทสงานตามวัตถุดิบ — รันด้วย node
 *   node tests/v2-follow.test.mjs
 *
 * หมวด C สำคัญที่สุด — การย้ายข้อมูลเก่า
 * ของขาดที่อยู่ในเครื่องพนักงานวันนี้ไม่มีช่อง entity เลยสักแถว
 * ถ้าย้ายผิด แถวจะไปโผล่ผิดนิติบุคคลแบบเงียบ ๆ (ละเมิด INVARIANTS A3)
 * และถ้าย้ายไม่ idempotent ทุกแถวจะติดธง dirty ใหม่ทุกครั้งที่เปิดโปรแกรม
 */
import fs from 'node:fs';
import { FOLLOW_KINDS, SHORT_TYPES, SOURCES, makeFollow, migrateFollow, migrateAll,
         statusOf, remainOf, overdue, closeFollow, reopenFollow, voidFollow,
         listFollow, openFollow, orphanFollow, sumFollow,
         OVER_MIN, overAll, overPending, overCutMatch, fromOverRow, sendbackEntry, shortOfPo, shortWhyOf,
         buyFor, pendingScraps, fromScrapRow, fromManualBuy, buyFromBom, scrapPoSuggest, linkReceive, orphanBuys,
         entityTag, buyDocNo, buyDocNos, buyDocPick, buyDocGroups, buyDocRows, stampBuyDoc,
         shortAll, shortPending, shortCheckOf, shortChecker, fromShortRow, SHORT_MIN,
         cardShortOver, codeShortOver, startKey, startOnce, openPairFor, dupFollows, doubleReturns, reopenOver, buyUnit }
  from '../v2/master/follow.js';
import { receivedOfDoc } from '../v2/core/balance.js';
import { normCode } from '../v2/master/materials.js';
import { makeManualRow, activeBomRowsOf } from '../v2/master/bom.js';
import { signedQty, KINDS, round5 } from '../v2/core/ledger.js';
import { localDate, atFrom } from '../v2/core/localtime.js';

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
const CODE = '4010600100';
const NOW = '2026-09-10T02:00:00.000Z';
const base = extra => Object.assign({
  entity: E, kind: 'short', code: CODE, qty: 10, unit: 'PCE',
  po: 'TMU001A', type: 'ขาด', now: NOW, by: 'สมชาย'
}, extra);

console.log('=== A. สร้างเรื่องตามงาน ===');
const s1 = makeFollow(base());
ok('ได้ id ที่ขึ้นต้นด้วย F', /^F/.test(s1.id), s1.id);
ok('เก็บนิติบุคคลไว้ครบ', s1.entity === E);
ok('เริ่มต้นยังไม่มีอะไรปิด', s1.done === false && s1.done_qty === 0);
ok('created_at กับ updated_at เท่ากันตอนเกิด', s1.created_at === NOW && s1.updated_at === NOW);
ok('วันที่เอามาจากเวลาที่สร้างถ้าไม่ได้ส่งมา', s1.date === '2026-09-10');
ok('คีย์เองถือเป็น source manual', s1.source === 'manual');
ok('รหัสวัตถุดิบถูกทำเป็นตัวใหญ่', makeFollow(base({ code: 'ab10600100' })).code === 'AB10600100');
ok('เรื่องที่คีย์เองยังไม่ผูกกับรายการในสมุด',
   s1.return_entry_id === '' && s1.receive_entry_id === '');

throws('ต้องระบุนิติบุคคล — A3', () => makeFollow(base({ entity: '' })), 'A3');
throws('ต้องระบุรหัสวัตถุดิบ', () => makeFollow(base({ code: '' })), 'รหัสวัตถุดิบ');
throws('ชนิดที่ไม่รู้จักไม่ผ่าน', () => makeFollow(base({ kind: 'อะไรก็ไม่รู้' })), 'ไม่รู้จักชนิด');
throws('จำนวนต้องมากกว่าศูนย์', () => makeFollow(base({ qty: 0 })), 'มากกว่าศูนย์');
throws('จำนวนติดลบไม่ผ่าน', () => makeFollow(base({ qty: -5 })), 'มากกว่าศูนย์');
throws('ของขาดต้องมี PO', () => makeFollow(base({ po: '' })), 'PO');
throws('ประเภทของขาดต้องเลือกจากรายการ',
       () => makeFollow(base({ type: 'ขาดมาก' })), 'ขาด');
throws('ของเกินต้องมี P/N',
       () => makeFollow(base({ kind: 'over', part_no: '' })), 'P/N');
throws('ซื้อทดแทนต้องผูกกับรายการของเสีย',
       () => makeFollow(base({ kind: 'buy', scrap_entry_id: '' })), 'ของเสีย');

const ov = makeFollow(base({ kind: 'over', part_no: '2870627900',
                             order_qty: 500, bom_qty: 100, recv_qty: 120, qty: 20 }));
ok('ของเกินเก็บตัวเลขที่แช่แข็งไว้ครบสามตัว',
   ov.order_qty === 500 && ov.bom_qty === 100 && ov.recv_qty === 120);
ok('ของเกินไม่มีช่องประเภทของขาดติดมา', ov.type === '');
const bu = makeFollow(base({ kind: 'buy', scrap_entry_id: 'Emno1z001abc', po: '' }));
ok('ซื้อทดแทนไม่ต้องมี PO ตอนตั้งเรื่อง', bu.po === '' && bu.scrap_entry_id === 'Emno1z001abc');

ok('ชนิดที่ระบบรู้จักมีสามแบบ',
   Object.keys(FOLLOW_KINDS).join(',') === 'short,over,buy', Object.keys(FOLLOW_KINDS).join(','));
ok('ทุกชนิดบอกชื่อไทยไว้', Object.values(FOLLOW_KINDS).every(d => d.label));
/* 'delta' ต่อท้ายเมื่อ 20 ก.ย. 2026 ตอนเปิดทางนำเข้าไฟล์ MAT'L FOLLOWING ของ Delta
 * ⚠️ ต่อท้ายเท่านั้น · migrateFollow เขียน source ที่ไม่รู้จักทับเป็น 'file' เครื่องรุ่นเก่าจึงลบป้ายนี้ได้ */
ok('แหล่งที่มามีสี่ทาง', SOURCES.join(',') === 'file,manual,auto,delta', SOURCES.join(','));
ok('ประเภทของขาดมีสองแบบ', SHORT_TYPES.join(',') === 'ขาด,รอส่ง');

console.log('\n=== B. ปิดเรื่อง · ปิดบางส่วน ===');
const c1 = closeFollow(s1, { qty: 4, by: 'สมหญิง', at: '2026-09-11T01:00:00.000Z' });
ok('ปิดบางส่วนแล้วยังค้างอยู่', statusOf(c1) === 'partial', statusOf(c1));
ok('ยอดค้างลดลงตามที่ปิด', remainOf(c1) === 6, String(remainOf(c1)));
ok('รู้ว่าใครปิดและปิดเมื่อไหร่',
   c1.done_by === 'สมหญิง' && c1.done_at === '2026-09-11T01:00:00.000Z');
ok('updated_at ขยับตามตอนปิด — D5', c1.updated_at === '2026-09-11T01:00:00.000Z');
ok('id กับ created_at ไม่เปลี่ยนหลังปิด — B3',
   c1.id === s1.id && c1.created_at === s1.created_at);

const c2 = closeFollow(c1, { qty: 6, by: 'สมหญิง', at: NOW });
ok('ปิดครบพอดีถือว่าเสร็จ', statusOf(c2) === 'done' && c2.done === true, statusOf(c2));
ok('ยอดค้างเหลือศูนย์', remainOf(c2) === 0);
throws('ปิดเกินยอดที่ค้างอยู่ไม่ผ่าน', () => closeFollow(c1, { qty: 7 }), 'ไม่เกินยอดที่ค้าง');
throws('ปิดด้วยจำนวนศูนย์ไม่ผ่าน', () => closeFollow(s1, { qty: 0 }), 'มากกว่าศูนย์');

const cAll = closeFollow(s1, { by: 'ก', at: NOW });
ok('ไม่ส่งจำนวนมา = ปิดทั้งใบ',
   statusOf(cAll) === 'done' && cAll.done_qty === 10, JSON.stringify(cAll.done_qty));

/* ⚠️ ของขาดที่แกะจากไฟล์ PO มี qty เป็น 0 ได้ — Delta บอกแค่ว่ายังไม่ส่ง ไม่บอกจำนวน
 *    ถ้าใช้กฎ "ค้างเหลือ 0 = จบแล้ว" กับแถวพวกนั้น ของขาดทั้งกองจะกลายเป็นเสร็จหมดทันที */
const noQty = { id: 'S0', entity: E, kind: 'short', code: CODE, qty: 0, done: false, done_qty: 0 };
ok('แถวที่ไม่มีจำนวนและยังไม่ติ๊ก ต้องยังค้างอยู่', statusOf(noQty) === 'open', statusOf(noQty));
ok('แถวที่ไม่มีจำนวน กดปิดแล้วต้องจบ',
   statusOf(closeFollow(noQty, { at: NOW })) === 'done');

const frac = closeFollow({ ...s1, qty: 0.3 }, { qty: 0.1, at: NOW });
ok('ยอดค้างผ่าน round5 ไม่เหลือเศษ float — A2', remainOf(frac) === 0.2, String(remainOf(frac)));

const re = reopenFollow(c2, { at: '2026-09-12T00:00:00.000Z' });
ok('เปิดกลับมาแล้วค้างใหม่ทั้งใบ',
   statusOf(re) === 'open' && re.done_qty === 0 && remainOf(re) === 10);
ok('เปิดกลับมาแล้วล้างคนปิดกับเวลาปิดทิ้ง', re.done_at === '' && re.done_by === '');
ok('เปิดกลับมา updated_at ก็ต้องขยับ', re.updated_at === '2026-09-12T00:00:00.000Z');

console.log('\n=== C. ย้ายข้อมูลเก่า (สำคัญที่สุด) ===');
/* แถวจริงที่อยู่ในเครื่องพนักงานวันนี้ — po-kit.js สร้างไว้แค่เท่านี้
 * ไม่มี entity · ไม่มี kind · ไม่มี created_at · ไม่มี updated_at */
const legacy = () => ({
  id: 'S2026-08-01-TMU001A-4010600100-abc',
  date: '2026-08-01', po: 'TMU001A', code: CODE,
  type: 'ขาด', qty: 5, unit: 'PCE', eta: '2026-08-05',
  note: 'ข้อความจากไฟล์ PO', done: false
});
// เลขที่ PO อ่านได้เป็น TUE-A ส่วนคอลัมน์ผู้รับเหมาในไฟล์เขียน tue-u — สองแหล่งขัดกัน
// เจ้าของสั่ง 19 ก.ย. 2026 ให้เชื่อเลขที่ PO และเลิกดูคอลัมน์นั้นทั้งระบบ
const poList = [{ po: 'TMU001A', sub: 'tue-u', date: '2026-08-01' }];
const known = ['TUE-A', 'TUE-H'];

const m1 = migrateFollow(legacy(), { known, poList, now: NOW });
ok('แถวเดิมที่ไม่มี kind ถือเป็นของขาด', m1.kind === 'short');
ok('แถวเดิมถือว่ามาจากไฟล์ PO', m1.source === 'file');
ok('เติมยอดที่ปิดแล้วเป็นศูนย์', m1.done_qty === 0);
ok('เติมเวลาสร้างจากวันที่ที่ไฟล์บอกไว้',
   m1.created_at === '2026-08-01T00:00:00.000Z' && m1.updated_at === '2026-08-01T00:00:00.000Z');
ok('เติมนิติบุคคลจากเลขที่ PO ไม่ใช่จากคอลัมน์ผู้รับเหมาในไฟล์',
   m1.entity === 'TUE-A', m1.entity);
ok('ไม่แต่งชื่อคนสร้างขึ้นมาเอง', !m1.created_by);
ok('ของเดิมไม่ถูกแตะ', m1.note === 'ข้อความจากไฟล์ PO' && m1.qty === 5 && m1.eta === '2026-08-05');

/* ⚠️ ข้อนี้คือหัวใจของหมวดนี้ — ไม่รู้จริงต้องปล่อยว่าง
 *    เติมผิดแล้วแถวจะหายไปจากนิติบุคคลที่เป็นเจ้าของแบบเงียบ ๆ
 *    ส่วนแถวที่ว่างยังขึ้นให้ทุกนิติบุคคลเห็น แล้วมีคนมาเลือกให้ได้ */
const offReg = migrateFollow(legacy(), { known: ['TUE-H'], now: NOW });
ok('เลขบอกเป็นรหัสที่ยังไม่มีในทะเบียน ต้องปล่อยว่าง — ไม่มีใครเลือกรหัสนั้นได้ (A3)',
   !offReg.entity, JSON.stringify(offReg.entity));
const noKnown = migrateFollow(legacy(), { now: NOW });
ok('ไม่ส่งทะเบียนมา ต้องปล่อยว่าง ไม่ใช่เติมมั่ว — A3', !noKnown.entity, JSON.stringify(noKnown.entity));
const badPo = migrateFollow({ ...legacy(), po: 'XX-1' }, { known, now: NOW });
ok('เลขที่ PO อ่านไม่ออก ต้องปล่อยว่าง — A3', !badPo.entity, JSON.stringify(badPo.entity));
const lyingSub = migrateFollow(legacy(), { known: ['TUE-A', 'TUE-U'], now: NOW });
ok('คอลัมน์ผู้รับเหมาเขียนเป็นอีกรหัสก็ไม่มีผล', lyingSub.entity === 'TUE-A', lyingSub.entity);

const m2 = migrateFollow(m1, { known, now: NOW });
ok('ย้ายซ้ำได้ผลเดิม และคืนแถวเดิมทั้งตัว (ไม่ติดธง dirty ฟรี ๆ)', m2 === m1);
const already = makeFollow(base());
ok('แถวที่ครบแล้วต้องคืนตัวเดิม', migrateFollow(already, { known, now: NOW }) === already);

const ticked = migrateFollow({ ...legacy(), done: true }, { known, now: NOW });
ok('แถวที่ติ๊กไว้แล้ว ต้องไม่ถูกเปิดกลับ', ticked.done === true);
ok('แถวที่ติ๊กไว้แล้ว ยอดที่ปิดต้องเท่ากับยอดของมัน', ticked.done_qty === 5, String(ticked.done_qty));
ok('แถวที่ติ๊กไว้แล้วอ่านสถานะได้ว่าเสร็จ', statusOf(ticked) === 'done');

const keepEntity = migrateFollow({ ...legacy(), entity: 'TUE-H' }, { known, now: NOW });
ok('แถวที่มี entity อยู่แล้ว ห้ามถูกทับด้วยค่าจากไฟล์ PO', keepEntity.entity === 'TUE-H');

const noDate = migrateFollow({ ...legacy(), date: '' }, { known, now: NOW });
ok('แถวที่ไม่มีวันที่ ใช้เวลาปัจจุบันแทน ไม่ปล่อยว่าง', noDate.created_at === NOW);
ok('ย้ายของที่ไม่ใช่อ็อบเจกต์ต้องไม่พัง',
   migrateFollow(null) === null && migrateFollow(undefined) === undefined);

const many = migrateAll([legacy(), already, { ...legacy(), id: 'S3' }], { known, now: NOW });
ok('ซ่อมทั้งกองแล้วคืนครบทุกแถว', many.rows.length === 3);
ok('บอกเฉพาะแถวที่เปลี่ยนจริง ให้เอาไปเขียนลงฐานข้อมูล',
   many.changed.length === 2, String(many.changed.length));

console.log('\n=== D. เลย ETA ===');
const TODAY = '2026-09-10';
ok('ETA ผ่านมาแล้วและยังไม่ได้ของ = เลยกำหนด', overdue(legacy(), TODAY) === true);
ok('ETA ยังไม่ถึงไม่นับ', overdue({ ...legacy(), eta: '2026-12-31' }, TODAY) === false);
ok('ETA วันนี้พอดียังไม่นับว่าเลย', overdue({ ...legacy(), eta: TODAY }, TODAY) === false);
ok('ไม่มี ETA ไม่นับ', overdue({ ...legacy(), eta: '' }, TODAY) === false);
ok('ปิดเรื่องแล้วไม่นับว่าเลยกำหนด แม้ ETA จะผ่านไปแล้ว',
   overdue({ ...legacy(), done: true }, TODAY) === false);
ok('ยกเลิกแล้วก็ไม่นับ',
   overdue({ ...legacy(), voided: true }, TODAY) === false);
ok('ปิดไปบางส่วนแต่ยังค้าง ยังนับว่าเลยกำหนด',
   overdue({ ...legacy(), done_qty: 2 }, TODAY) === true);
ok('ไม่ส่งวันนี้มาก็ไม่พัง', overdue(legacy(), '') === false);

console.log('\n=== E. ยกเลิก ===');
throws('ยกเลิกต้องบอกเหตุผล', () => voidFollow(s1, { by: 'ก' }), 'เหตุผล');
throws('ยกเลิกต้องบอกว่าใครยกเลิก', () => voidFollow(s1, { reason: 'คีย์ผิด' }), 'ใครยกเลิก');
const v1 = voidFollow(s1, { by: 'หัวหน้า', reason: 'คีย์ผิดใบ' });
ok('ยกเลิกแล้วยังอยู่ครบ ไม่ถูกลบทิ้ง — B1',
   v1.id === s1.id && v1.qty === s1.qty && v1.code === s1.code);
ok('ยกเลิกแล้วบันทึกเหตุผลกับคนยกเลิกไว้',
   v1.voided === true && v1.void_reason === 'คีย์ผิดใบ' && v1.void_by === 'หัวหน้า' && !!v1.void_at);
ok('สถานะอ่านได้ว่ายกเลิกแล้ว', statusOf(v1) === 'cancelled');
throws('ยกเลิกแล้วปิดต่อไม่ได้', () => closeFollow(v1, { qty: 1 }), 'ยกเลิกไปแล้ว');

console.log('\n=== F. กรอง · เรียง · สรุป (หน้าจอ Mat Follow up) ===');
/* หมวดนี้คุมกฎที่พังแล้วเงียบที่สุดในหน้านี้ — การกรองนิติบุคคล (A3)
 * และการกรองชนิดงาน ซึ่งจะสำคัญจริงเมื่อหน้า over/buy เข้ามาใช้กองเดียวกัน */
const TD = '2026-09-10';
const row = (id, o) => Object.assign({
  id, kind: 'short', entity: 'NSE', code: CODE, qty: 10, done_qty: 0,
  done: false, po: 'PO-' + id, date: '2026-09-01', eta: '', note: ''
}, o);
const pool = [
  row('a', { eta: '2026-09-01' }),                    // ของเรา เลยกำหนด
  row('b', { entity: 'TUE-H' }),                      // ของอีกนิติบุคคล
  row('c', { entity: '' }),                           // ยังไม่มีเจ้าของ
  row('d', { done: true, done_qty: 10 }),             // ปิดแล้ว
  row('e', { done_qty: 4, eta: '2026-12-31' }),       // ปิดบางส่วน ยังไม่เลย
  row('f', { voided: true }),                         // ยกเลิกแล้ว
  row('g', { kind: 'over', part_no: '2870627900' }),  // งานตามอีกชนิด
  row('h', { entity: '', done: true, done_qty: 10 })  // ไม่มีเจ้าของ แต่ปิดจบแล้ว
];
const ids = list => list.map(r => (r.s || r).id).join(',');

const shown = listFollow(pool, { kind: 'short', entity: 'NSE', today: TD });
ok('ของนิติบุคคลอื่นไม่โผล่ — A3', !ids(shown).includes('b'), ids(shown));
ok('แถวที่ยังไม่มีเจ้าของโผล่ทุกนิติบุคคล', ids(shown).includes('c'), ids(shown));
ok('แถวที่ปิดแล้วไม่โผล่ถ้าไม่ได้ขอดู', !ids(shown).includes('d'), ids(shown));
ok('แถวที่ยกเลิกไม่โผล่เลย', !ids(shown).includes('f'), ids(shown));
ok('งานตามชนิดอื่นไม่ไหลมาโผล่ในหน้าของขาด', !ids(shown).includes('g'), ids(shown));
ok('เลยกำหนดขึ้นก่อน แล้วไล่ตาม ETA ที่ใกล้ที่สุด', ids(shown) === 'a,e,c', ids(shown));
/* แถวที่ไม่มี ETA เลยต้องตกท้าย — ของที่ Delta นัดวันไว้แล้วต้องมาก่อนของที่ยังไม่นัด
 * (แถว c ไม่มี ETA จึงอยู่หลังแถว e ที่นัดไว้สิ้นปี) */
ok('แถวที่ไม่มี ETA ตกท้ายสุด', shown[shown.length - 1].s.id === 'c', ids(shown));
ok('บอกสถานะกับยอดค้างมาให้พร้อม',
   shown[1].st === 'partial' && shown[1].remain === 6, JSON.stringify(shown[1].remain));
ok('บอกด้วยว่าแถวไหนเลยกำหนด', shown[0].late === true && shown[1].late === false);

/* ⚠️ ข้อข้างบนพิสูจน์เกณฑ์ "เลยกำหนดขึ้นก่อน" ไม่ได้ — แถวที่เลยกำหนดมี ETA เก่าที่สุดอยู่แล้ว
 *    เรียงด้วย ETA เพียว ๆ ก็ได้ลำดับเดียวกัน (ถอดเกณฑ์ออกแล้วเทสยังเขียว ลองมาแล้ว)
 *    เคสที่แยกสองเกณฑ์ออกจากกันได้จริงคือ "แถวที่ปิดแล้วมี ETA เก่ากว่าแถวที่ยังค้าง" */
const mix = [row('x', { eta: '2026-08-01', done: true, done_qty: 10 }),
             row('y', { eta: '2026-09-05' })];
const mixed = listFollow(mix, { kind: 'short', entity: 'NSE', showDone: true, today: TD });
ok('เรื่องที่ยังค้างและเลยกำหนด ขึ้นก่อนเรื่องที่ปิดแล้ว แม้ ETA จะเก่ากว่า',
   ids(mixed) === 'y,x', ids(mixed));

ok('ขอดูที่ปิดแล้วก็เห็น',
   ids(listFollow(pool, { kind: 'short', entity: 'NSE', showDone: true, today: TD }))
     .includes('d'));
ok('ค้นหาตรง PO ได้',
   ids(listFollow(pool, { kind: 'short', entity: 'NSE', q: 'po-a', today: TD })) === 'a');
ok('ค้นหาไม่เจอก็คืนกองว่าง ไม่ใช่คืนทั้งกอง',
   listFollow(pool, { kind: 'short', entity: 'NSE', q: 'ไม่มีคำนี้' }).length === 0);
ok('จำกัดจำนวนแถวได้',
   listFollow(pool, { kind: 'short', entity: 'NSE', today: TD, limit: 2 }).length === 2);
ok('ไม่ระบุชนิดก็ได้ทุกชนิดที่เหลือ',
   ids(listFollow(pool, { entity: 'NSE', today: TD })).includes('g'));

/* ยังไม่ได้เลือกนิติบุคคล ห้ามแปลว่า "ไม่กรอง"
 * การโชว์ยอดข้ามนิติบุคคลคืออาการของ A3 ที่ไม่มีอะไรฟ้อง */
const noEnt = listFollow(pool, { kind: 'short', entity: '', today: TD });
ok('ยังไม่เลือกนิติบุคคล เห็นได้แค่แถวที่ยังไม่มีเจ้าของ — A3',
   ids(noEnt) === 'c', ids(noEnt));

const openList = openFollow(pool, { kind: 'short', entity: 'NSE' });
ok('งานค้างนับเฉพาะของนิติบุคคลนี้บวกที่ยังไม่มีเจ้าของ',
   ids(openList) === 'a,c,e', ids(openList));
ok('งานค้างไม่นับที่ปิดแล้วและที่ยกเลิก',
   !ids(openList).includes('d') && !ids(openList).includes('f'));

const orph = orphanFollow(pool, { kind: 'short' });
ok('แถวไม่มีเจ้าของที่ยังต้องตาม ขึ้นแถบเตือน', ids(orph) === 'c', ids(orph));
ok('แถวไม่มีเจ้าของที่ปิดจบแล้ว ต้องหายจากแถบเตือน ไม่ค้างตลอดไป',
   !ids(orph).includes('h'), ids(orph));

const sum = sumFollow(openList, { today: TD });
ok('สรุปสามตัวเลขถูก',
   sum.open === 2 && sum.partial === 1 && sum.late === 1, JSON.stringify(sum));
ok('ส่งกองว่างมาก็ไม่พัง',
   listFollow(null).length === 0 && openFollow(null).length === 0 &&
   orphanFollow(null).length === 0 && sumFollow(null).open === 0);


console.log('\n=== G. เศษทศนิยมที่วิ่งผ่านชีตกลับมา ===');
/* ⚠️ ยอดที่ผ่าน Google Sheets กลับมาอาจเป็น 0.30000000000000004 แทน 0.3
 *    เดิมทั้ง statusOf และ closeFollow เทียบค่าดิบ แถวจึงค้างเป็น "เหลือ 0" ตลอดไป
 *    ปิดทั้งใบก็ไม่ติด done · ใส่ยอดเองก็โดนกฎต้องมากกว่าศูนย์ — ผู้ตรวจ #67 รันเจอ */
const fz = { id: 'FZ', kind: 'short', entity: 'NSE', code: CODE,
             qty: 0.1 + 0.2, done_qty: 0, done: false };
const fz1 = closeFollow(fz, { qty: 0.1, at: NOW });
ok('ปิดบางส่วนของยอดที่มีเศษ float ยังค้างตามจริง',
   statusOf(fz1) === 'partial' && remainOf(fz1) === 0.2,
   JSON.stringify({ st: statusOf(fz1), remain: remainOf(fz1) }));
const fz2 = closeFollow(fz1, { at: NOW });
ok('ปิดที่เหลือของยอดที่มีเศษ float ต้องจบจริง ไม่ค้างเป็นเหลือ 0',
   fz2.done === true && statusOf(fz2) === 'done',
   JSON.stringify({ done: fz2.done, done_qty: fz2.done_qty, st: statusOf(fz2) }));
ok('แถวที่ยอดปิดเท่ากับยอดหลังปัดแล้ว อ่านสถานะว่าเสร็จ แม้ไม่มีธง done',
   statusOf({ qty: 0.1 + 0.2, done_qty: 0.3 }) === 'done');
ok('ต่างกันจริงในห้าตำแหน่ง ยังนับว่าค้าง ไม่ใช่ปัดทิ้งจนกลายเป็นเสร็จ',
   statusOf({ qty: 10, done_qty: 9.9999 }) === 'partial');


console.log('\n=== H. การ์ด "เพิ่มเรื่องเอง" ต้องบอกวันที่แบบเวลาไทย ===');
/* ⚠️ makeFollow ตั้งต้น date ด้วย toISOString().slice(0,10) ซึ่งเป็นวันที่แบบ UTC
 *    ผู้เรียกจึงต้องส่ง date มาเอง ไม่งั้นคนที่คีย์ช่วง 00:00–07:00 ตามเวลาไทย
 *    จะได้ "แจ้งวันที่" ย้อนไปหนึ่งวัน (ผู้ตรวจ #68)
 *    ชั้นต่อสายอยู่ใน setup() ของ app.js node เรียกตรง ๆ ไม่ได้ จึงตรวจที่ตัวโค้ด
 *    แบบเดียวกับที่ v2-export เทียบโค้ด writeCard กับ v1 */
const appSrc = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const iFu = appSrc.indexOf('async function fuSave(');
ok('หา fuSave ใน app.js เจอ', iFu >= 0);
const fuCall = iFu < 0 ? '' : appSrc.slice(iFu, appSrc.indexOf('});', iFu));
ok('fuSave ส่ง date: todayLocal() เข้า makeFollow ไม่ปล่อยให้ตกไปใช้ค่าตั้งต้น UTC',
   /\bdate:\s*todayLocal\(\)/.test(fuCall),
   'ถ้าตกข้อนี้ เรื่องที่คีย์ช่วงกลางดึกจะขึ้นแจ้งวันที่ย้อนไปหนึ่งวัน');

/* วันที่ที่ผู้เรียกส่งมาต้องชนะค่าตั้งต้นจริง ๆ ไม่ใช่แค่รับไว้เฉย ๆ */
const dz = makeFollow({ kind: 'short', entity: E, code: CODE, qty: 1, po: 'PO-TZ',
                        type: 'ขาด', date: '2026-09-11',
                        now: '2026-09-10T18:30:00.000Z' });
ok('date ที่ผู้เรียกส่งมาชนะวันที่แบบ UTC ที่แกะจาก created_at',
   dz.date === '2026-09-11' && dz.created_at === '2026-09-10T18:30:00.000Z',
   JSON.stringify({ date: dz.date, created_at: dz.created_at }));


console.log('\n=== I. ปุ่ม 🔍 ในการ์ด "เพิ่มเรื่องเอง" ต้องไม่ถูกช่องถัดไปทับ ===');
/* ⚠️ ช่องรหัสอยู่ใน label กว้าง 190px และเป็น flex item ที่ min-width ตั้งต้นเป็น auto
 *    ขนาดในตัวของ input (20 ตัวอักษร) จึงกว้างกว่า label กล่องข้างในล้นออกมา
 *    ปุ่ม 🔍 ไปนั่งนอกคอลัมน์ตัวเอง แล้วโดนช่อง PO (มาทีหลังใน DOM) วาดทับจนกดไม่ได้
 *    ผู้ตรวจ #68 รอบ 2 วัดในเบราว์เซอร์จริง: ปุ่ม x 235..271 · ช่อง PO x 233..373
 *    node เรนเดอร์ไม่ได้ จึงตรวจที่ตัวโค้ดว่ามี min-width:0 ให้ช่องหดได้ */
const htmlSrc = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
const iCard = htmlSrc.indexOf('<h2>เพิ่มเรื่องเอง</h2>');
ok('หาการ์ด "เพิ่มเรื่องเอง" ใน index.html เจอ', iCard >= 0);
const cardSrc = iCard < 0 ? '' : htmlSrc.slice(iCard, htmlSrc.indexOf('</div>\n\n', iCard));
ok('การ์ดนี้มีปุ่ม 🔍 เปิดทะเบียนจริง', /🔍/.test(cardSrc) && /openPick\(fu\)/.test(cardSrc));
const codeInput = (cardSrc.match(/<input[^>]*fu\.code[^>]*>/) || [''])[0];
ok('ช่องรหัสวัตถุดิบหดลงมาให้พอดี label ได้ (min-width:0) ปุ่ม 🔍 จึงไม่ถูกช่อง PO ทับ',
   /min-width:\s*0/.test(codeInput),
   codeInput || 'ไม่เจอช่องรหัสในการ์ด');


console.log('\n=== J. ของเกินรอคืน (คิดสดจากสมุด) ===');
/* PO หนึ่งใบสั่ง 10 ชิ้น · สูตรใช้รหัสนี้ชิ้นละ 10 ⇒ ต้องใช้ 100
 * เลขทั้งหมดสมมติขึ้นมา ไม่ใช่ของจริงจากงาน */
const PO = 'TM9000H001', PO2 = 'TM9000H002', C1 = 'MC-100', C2 = 'MC-200', PN = '7001';
const recv = (o = {}) => ({ id: 'E' + Math.random().toString(36).slice(2, 8),
  entity: 'TUE-H', kind: 'receive', material_code: C1, qty: 120, doc_ref: PO,
  doc_kind: 'po', at: '2026-09-01T03:00:00.000Z', person: 'ก', voided: false, ...o });
const headerOf = po => po === PO ? { pn: PN, order: 10, date: '2026-09-01' }
                     : po === PO2 ? { pn: PN, order: 5, date: '2026-09-02' } : null;
const usageOf = (pn, code) => (pn === PN && code === C1) ? 10 : null;
const opt = { headerOf, usageOf };

const o1 = overAll([recv()], 'TUE-H', opt);
ok('รับ 120 สูตรต้องใช้ 100 ⇒ เกิน 20',
   o1.length === 1 && o1[0].over === 20 && o1[0].bom_qty === 100 && o1[0].recv === 120,
   JSON.stringify(o1[0]));
ok('บอก P/N กับจำนวนสั่งของใบนั้นมาด้วย', o1[0].pn === PN && o1[0].order === 10);

ok('รับเท่าสูตรพอดี ไม่ขึ้นเป็นของเกิน',
   overAll([recv({ qty: 100 })], 'TUE-H', opt).length === 0);
ok('เกินน้อยกว่าค่าเผื่อ ไม่ขึ้น',
   overAll([recv({ qty: 100 + OVER_MIN - 0.5 })], 'TUE-H', opt).length === 0);
ok('เกินเท่าค่าเผื่อพอดี ขึ้น',
   overAll([recv({ qty: 100 + OVER_MIN })], 'TUE-H', opt).length === 1);

// ⚠️ ข้อนี้คือหัวใจ — ไม่หักของที่คืนไปแล้ว รายการเดิมจะโผล่กลับมาแล้วมีคนคืนซ้ำ
const back = { ...recv({ kind: 'sendback', qty: 20, id: 'B1' }) };
ok('คืนไปแล้วต้องหักออก จนไม่เหลือของเกิน',
   overAll([recv(), back], 'TUE-H', opt).length === 0);
const half = overAll([recv(), { ...back, qty: 5 }], 'TUE-H', opt);
ok('คืนไปบางส่วน เหลือเท่าที่ยังไม่ได้คืน',
   half.length === 1 && half[0].over === 15 && half[0].sentBack === 5, JSON.stringify(half[0]));

ok('รายการที่ยกเลิกแล้วไม่นับ (B1)',
   overAll([recv(), recv({ id: 'E9', qty: 50, voided: true })], 'TUE-H', opt)[0].recv === 120);
ok('ใบส่งคืนที่ยกเลิกแล้วก็ไม่นับ',
   overAll([recv(), { ...back, voided: true }], 'TUE-H', opt).length === 1);

ok('ของนิติบุคคลอื่นไม่ปนเข้ามา (A3)',
   overAll([recv(), recv({ id: 'E8', entity: 'TUE-U', qty: 900 })], 'TUE-H', opt)[0].recv === 120);
ok('คนละ PO แยกกันคนละแถว',
   overAll([recv(), recv({ id: 'E7', doc_ref: PO2, qty: 70 })], 'TUE-H', opt).length === 2);
ok('รับเข้าที่ไม่ได้อ้าง PO ไม่ถูกนับ',
   overAll([recv({ doc_ref: '' })], 'TUE-H', opt).length === 0);
ok('ชนิดอื่นในสมุดไม่ถูกนับเป็นยอดรับ',
   overAll([recv({ kind: 'issue', qty: 900 }), recv()], 'TUE-H', opt)[0].recv === 120);

throws('ลืมส่งนิติบุคคลต้องดัง ไม่ใช่คิดรวมทุกโรงงาน',
       () => overAll([recv()], '', opt), 'A3');
throws('ลืมส่ง usageOf ต้องดัง', () => overAll([recv()], 'TUE-H', { headerOf }), 'usageOf');

/* ⚠️ คู่ที่คำนวณไม่ได้ต้องโผล่พร้อมเหตุผล ไม่ใช่เงียบหาย และไม่ใช่ "เกินทั้งก้อน" */
const noBom = overAll([recv({ material_code: C2 })], 'TUE-H', opt);
ok('รหัสที่ไม่มีในสูตร = คำนวณไม่ได้ ไม่ใช่เกินทั้งก้อน',
   noBom.length === 1 && noBom[0].over === null && noBom[0].why.includes('ไม่มีรหัสนี้ในสูตร'),
   JSON.stringify(noBom[0]));
const noHead = overAll([recv({ doc_ref: 'TM9000H999' })], 'TUE-H', opt);
ok('ไม่รู้ P/N ของใบนั้น = คำนวณไม่ได้', noHead.length === 1 && noHead[0].why.includes('P/N'));
const noOrder = overAll([recv({ doc_ref: PO2 })], 'TUE-H',
                        { headerOf: () => ({ pn: PN, order: 0 }), usageOf });
ok('ยังไม่รู้จำนวนสั่ง = คำนวณไม่ได้ ไม่ใช่เกินทั้งก้อน',
   noOrder.length === 1 && noOrder[0].why.includes('จำนวนสั่ง'));

// ⚠️ กับดักที่ตัวคิดยอดเกินรุ่นแรกตกไปแล้ว — byPn() คืนอ็อบเจกต์ทั้งแถว คูณแล้วได้ NaN
const objUsage = overAll([recv()], 'TUE-H',
                         { headerOf, usageOf: () => ({ usage: 10 }) });
ok('ส่ง usageOf ที่คืนอ็อบเจกต์ ต้องกลายเป็นคำนวณไม่ได้ ไม่ใช่ NaN เงียบ ๆ',
   objUsage.length === 1 && objUsage[0].over === null && !!objUsage[0].why,
   JSON.stringify(objUsage[0]));

// ยอดรับที่หน้านี้ใช้ ต้องเป็นยอดเดียวกับที่หน้ารับเข้าใช้ ไม่ใช่คนละสูตรที่ค่อย ๆ เพี้ยนจากกัน
const bookMix = [recv(), recv({ id: 'E6', qty: 30 }), recv({ id: 'E5', qty: 9, voided: true }), back];
ok('ยอดรับตรงกับ receivedOfDoc ของ balance.js',
   overAll(bookMix, 'TUE-H', opt)[0].recv === receivedOfDoc(bookMix, 'TUE-H', PO).get(C1).qty);

console.log('\n=== K. ตั้งเรื่องคืน · ใบส่งคืน Delta ===');
const candRow = overAll([recv()], 'TUE-H', opt)[0];
ok('ตัดคู่ที่ตั้งเรื่องไว้แล้วออก',
   overPending([candRow], [makeFollow({ kind: 'over', entity: 'TUE-H', code: C1, po: PO,
                                     part_no: PN, qty: 20 })]).length === 0);
ok('เรื่องที่ปิดจบแล้วไม่กันไว้ ถ้าเกินอีกก็ต้องเห็นอีก',
   overPending([candRow], [{ ...makeFollow({ kind: 'over', entity: 'TUE-H', code: C1, po: PO,
                                          part_no: PN, qty: 20 }), done: true }]).length === 1);
ok('เรื่องของ PO อื่นไม่กัน',
   overPending([candRow], [makeFollow({ kind: 'over', entity: 'TUE-H', code: C1, po: PO2,
                                     part_no: PN, qty: 20 })]).length === 1);

const overCase = fromOverRow(candRow, { entity: 'TUE-H', person: 'ผู้ทดสอบ' });
ok('ตั้งเรื่องแล้วได้งานตามแบบของเกิน', overCase.kind === 'over' && overCase.qty === 20);
ok('แช่แข็งยอดสั่ง · ตามสูตร · ที่รับมา ไว้ในเรื่อง',
   overCase.order_qty === 10 && overCase.bom_qty === 100 && overCase.recv_qty === 120, JSON.stringify(overCase));
ok('รู้ว่ามาจากระบบคำนวณให้', overCase.source === 'auto' && overCase.created_by === 'ผู้ทดสอบ');
throws('แถวที่คำนวณไม่ได้ ตั้งเรื่องไม่ได้', () => fromOverRow(noBom[0], { entity: 'TUE-H' }));
throws('ตั้งเรื่องโดยไม่บอกนิติบุคคลไม่ได้ (A3)', () => fromOverRow(candRow, {}), 'A3');

// ⚠️ เวลาไทยเร็วกว่า UTC 7 ชม. — กดตั้งเรื่องก่อนเจ็ดโมงเช้าแล้วปล่อยให้ makeFollow
//    สไลซ์วันที่จาก toISOString() เอง จะได้ "ตั้งวันที่" เป็นเมื่อวาน (กับดักเดิมของผู้ตรวจ #68)
const dawnAt = '2026-09-19T23:00:00.000Z';   // = 06:00 น. ของวันที่ 20 ก.ย. ตามเวลาไทย
ok('ตั้งเรื่องก่อนเจ็ดโมงเช้า ต้องได้วันที่ตามเวลาไทย ไม่ใช่ UTC',
   fromOverRow(candRow, { entity: 'TUE-H', person: 'ผู้ทดสอบ',
                          at: dawnAt, date: '2026-09-20' }).date === '2026-09-20',
   fromOverRow(candRow, { entity: 'TUE-H', at: dawnAt, date: '2026-09-20' }).date);
ok('เวลาที่บันทึกยังเป็น ISO เต็มตามเดิม (D5)',
   fromOverRow(candRow, { entity: 'TUE-H', at: dawnAt, date: '2026-09-20' }).created_at === dawnAt);

// ยอดที่แช่แข็งต้องไม่ขยับตามใบที่คีย์ทีหลัง
const later = overAll([recv(), recv({ id: 'E4', qty: 500 })], 'TUE-H', opt)[0];
ok('คีย์รับเพิ่มทีหลัง ยอดในเรื่องที่ตั้งไปแล้วต้องไม่ขยับ',
   overCase.recv_qty === 120 && later.recv === 620);

const sb = sendbackEntry(overCase, { qty: 20, person: 'ผู้ทดสอบ', device: 'test',
                                 reason_code: 'over', at: '2026-09-05T03:00:00.000Z' });
ok('ใบส่งคืนเป็นชนิด sendback', sb.kind === 'sendback' && sb.qty === 20);
ok('ใบส่งคืนต้องพกเลข PO ไปด้วย ไม่งั้นหักกับใบเดิมไม่ได้',
   sb.doc_ref === PO && sb.doc_kind === 'po');
ok('ใบส่งคืนตัดสต็อกจริง (sign = -1)', signedQty(sb) === -20, String(signedQty(sb)));
ok('ติดรหัสวัตถุดิบกับ P/N ไปด้วย', sb.material_code === C1 && sb.part_no === PN);
throws('คืนเกินยอดที่ค้างอยู่ไม่ได้', () => sendbackEntry(overCase, { qty: 21, person: 'ก',
                                                                 reason_code: 'over' }), 'ไม่เกิน');
throws('คืนจำนวนศูนย์ไม่ได้', () => sendbackEntry(overCase, { qty: 0, person: 'ก', reason_code: 'over' }));
throws('ต้องเลือกเหตุผล', () => sendbackEntry(overCase, { qty: 1, person: 'ก' }), 'เหตุผล');
throws('เลือกอื่น ๆ แล้วต้องเขียนอธิบาย',
       () => sendbackEntry(overCase, { qty: 1, person: 'ก', reason_code: 'other' }), 'อธิบาย');
throws('เรื่องของขาดเอามาคืนไม่ได้',
       () => sendbackEntry(makeFollow({ kind: 'short', entity: 'TUE-H', code: C1, po: PO,
                                        type: 'ขาด', qty: 1 }), { qty: 1, person: 'ก',
                                        reason_code: 'over' }), 'ของเกิน');
throws('เรื่องที่ยกเลิกแล้วคืนไม่ได้',
       () => sendbackEntry({ ...overCase, voided: true }, { qty: 1, person: 'ก',
                                                        reason_code: 'over' }), 'ยกเลิก');
ok('ล็อตไม่บังคับ — ของเกินคิดต่อ PO ล็อตมักไม่รู้ (A4)', KINDS.sendback.lot === false);

// คืนแล้วต้องหายไปจากรายการที่ระบบคำนวณได้ทันที
ok('บันทึกใบส่งคืนแล้ว ของเกินก้อนนั้นหายไปจากจอ',
   overAll([recv(), sb], 'TUE-H', opt).length === 0);

console.log('\n=== L. ใบนี้ยังรับมาไม่ครบอีกกี่รหัส (คำเตือนก่อนกดคืน) ===');
/* ⚠️ เตือนอย่างเดียว ห้ามบล็อก (A4) — แต่ต้องเตือน เพราะ "รหัสหนึ่งเกินทั้งที่อีกรหัสยังไม่มา"
 *    เป็นอาการของการคีย์รับเข้าผิดใบได้พอ ๆ กับเป็นเรื่องปกติ */
const bomRowsOf = pn => pn === PN ? [{ code: C1, usage: 10 }, { code: C2, usage: 2 }] : [];
const sOpt = { headerOf, bomRowsOf };

const sh1 = shortOfPo([recv()], 'TUE-H', PO, sOpt);
ok('รหัสที่ยังไม่ได้รับเลย ขึ้นว่าขาดเต็มจำนวน',
   sh1.length === 1 && sh1[0].code === C2 && sh1[0].miss === 20 && sh1[0].have === 0,
   JSON.stringify(sh1));
ok('รหัสที่รับเกินแล้วไม่ขึ้นในรายการขาด', !sh1.some(x => x.code === C1));

ok('รับครบทุกรหัสแล้วไม่เตือนอะไร',
   shortOfPo([recv(), recv({ id: 'X1', material_code: C2, qty: 20 })], 'TUE-H', PO, sOpt).length === 0);
const sh2 = shortOfPo([recv(), recv({ id: 'X2', material_code: C2, qty: 5 })], 'TUE-H', PO, sOpt);
ok('รับมาบางส่วน บอกว่าขาดอีกเท่าไหร่', sh2[0].miss === 15 && sh2[0].have === 5);

/* ⚠️ ต้องหักของที่คืนไปแล้วออกจากยอดรับ เงื่อนไขเดียวกับ overAll (ผู้ตรวจ #90 รอบ 1 ข้อสังเกต 3)
 *    ของที่คืนได้ถูกจำกัดไว้ไม่เกินส่วนที่เกินอยู่แล้ว ใบที่คืนตามปกติจึงยังไม่ขึ้นว่าขาด */
ok('รับเกินแล้วคืนส่วนที่เกิน ยังไม่นับว่าขาด',
   shortOfPo([recv(), recv({ id: 'X3', material_code: C2, qty: 25 }),
              { ...back, material_code: C2, qty: 5 }], 'TUE-H', PO, sOpt).length === 0);
ok('คืนไปจนต่ำกว่าที่สูตรต้องใช้ ต้องขึ้นว่าขาดตามจริง',
   (shortOfPo([recv(), recv({ id: 'X3b', material_code: C2, qty: 25 }),
              { ...back, material_code: C2, qty: 8 }], 'TUE-H', PO, sOpt)[0] || {}).miss === 3);
ok('ใบส่งคืนที่ยกเลิกแล้วไม่ถูกหัก',
   shortOfPo([recv(), recv({ id: 'X3c', material_code: C2, qty: 20 }),
              { ...back, material_code: C2, qty: 20, voided: true }], 'TUE-H', PO, sOpt).length === 0);
ok('รายการที่ยกเลิกแล้วไม่นับเป็นของที่รับมา',
   shortOfPo([recv(), recv({ id: 'X4', material_code: C2, qty: 20, voided: true })],
             'TUE-H', PO, sOpt)[0].miss === 20);
ok('ของนิติบุคคลอื่นไม่นับ (A3)',
   shortOfPo([recv(), recv({ id: 'X5', material_code: C2, qty: 20, entity: 'TUE-U' })],
             'TUE-H', PO, sOpt)[0].miss === 20);
ok('ของ PO อื่นไม่นับ',
   shortOfPo([recv(), recv({ id: 'X6', material_code: C2, qty: 20, doc_ref: PO2 })],
             'TUE-H', PO, sOpt)[0].miss === 20);

ok('ไม่รู้จำนวนสั่ง = ไม่มีอะไรให้เทียบ ตอบว่าง ไม่ใช่เตือนมั่ว',
   shortOfPo([recv()], 'TUE-H', PO, { headerOf: () => ({ pn: PN, order: 0 }), bomRowsOf }).length === 0);
ok('ไม่รู้จัก PO ใบนี้ ตอบว่าง', shortOfPo([recv()], 'TUE-H', 'TM9000H777', sOpt).length === 0);
ok('ไม่มีสูตรของ P/N นั้น ตอบว่าง',
   shortOfPo([recv()], 'TUE-H', PO, { headerOf, bomRowsOf: () => [] }).length === 0);
throws('ลืมส่งนิติบุคคลต้องดัง', () => shortOfPo([recv()], '', PO, sOpt), 'A3');
throws('ลืมส่งสูตรต้องดัง', () => shortOfPo([recv()], 'TUE-H', PO, { headerOf }), 'bomRowsOf');

/* ⚠️ shortOfPo คืน [] ทั้งตอนรับครบและตอนเทียบไม่ได้ · บนกล่องที่ตัดของจริง
 *    "ไม่มีคำเตือน" ต้องไม่ถูกอ่านว่า "ตรวจแล้วไม่มีปัญหา" (ผู้ตรวจ #90 รอบ 2 ข้อ 1) */
ok('รับครบแล้ว = เทียบได้ และไม่มีเหตุผลค้าง',
   shortWhyOf(PO, sOpt) === '' &&
   shortOfPo([recv(), recv({ id: 'W1', material_code: C2, qty: 20 })], 'TUE-H', PO, sOpt).length === 0);
ok('ไม่รู้จัก PO ใบนี้ บอกว่ายังไม่ได้นำเข้าไฟล์ PO',
   shortWhyOf('TM9000H777', sOpt).includes('ยังไม่รู้จัก PO'), shortWhyOf('TM9000H777', sOpt));
ok('ยังไม่รู้จำนวนสั่ง บอกตรง ๆ',
   shortWhyOf(PO, { headerOf: () => ({ pn: PN, order: 0 }), bomRowsOf }).includes('จำนวนสั่ง'));
ok('ไม่มี P/N ของใบนั้น บอกตรง ๆ',
   shortWhyOf(PO, { headerOf: () => ({ pn: '', order: 3 }), bomRowsOf }).includes('P/N'));
ok('ไม่มีสูตรของ P/N นั้น บอกว่าไม่มีสูตรและบอกว่า P/N ไหน',
   shortWhyOf(PO, { headerOf, bomRowsOf: () => [] }) === 'ไม่มีสูตรของ ' + PN);
ok('สูตรที่มีแต่บรรทัดต่อชิ้นศูนย์ ก็เทียบไม่ได้',
   shortWhyOf(PO, { headerOf, bomRowsOf: () => [{ code: C1, usage: 0 }] }).includes('ไม่มีสูตร'));
ok('ไม่มีเลข PO ก็ต้องบอก ไม่ใช่เงียบ', shortWhyOf('', sOpt) !== '');
throws('ลืมส่งสูตรต้องดัง (shortWhyOf)', () => shortWhyOf(PO, { headerOf }), 'bomRowsOf');

/* ⚠️ ยอดคืนมากกว่ายอดรับเกิดได้ถ้าใบรับเข้าถูกยกเลิกทีหลัง หรือเรื่องถูกตั้งด้วยมือเกินของจริง
 *    ถ้าปล่อยให้ "รับมาแล้ว" ติดลบ เลขขาดจะโตเกินยอดสั่งจนอ่านเหมือนข้อมูลเพี้ยน
 *    (ผู้ตรวจ #90 รอบ 3 ข้อ 1 · เจ้าของสั่งให้แก้) */
{
  const over = [recv(), { ...back, material_code: C2, qty: 50 }];   // คืน C2 ทั้งที่ไม่เคยรับ
  const r = shortOfPo(over, 'TUE-H', PO, sOpt)[0];
  ok('คืนมากกว่าที่รับ "ขาด" ต้องไม่เกินยอดที่สูตรต้องใช้',
     r.have === 0 && r.miss === r.need && r.need === 20, JSON.stringify(r));
}

/* ── ข้อ 2 · วันที่ปิดเรื่องตามวันที่คนคีย์ · เวลาซิงค์ห้ามถอยหลัง (D5) ── */
{
  const base = makeFollow({ kind: 'over', entity: 'TUE-H', code: C1, po: PO, part_no: PN, qty: 10 });
  const yday = '2026-09-19T03:00:00.000Z';
  const rec = closeFollow(base, { qty: 4, by: 'ก', doneAt: yday });
  ok('done_at ตามวันที่ที่คนคีย์', rec.done_at === yday, rec.done_at);
  ok('updated_at ยังเป็นเวลาจริง ไม่ถอยหลังตาม (D5)',
     rec.updated_at !== yday && rec.updated_at > yday, rec.updated_at);
  ok('ไม่ส่ง doneAt ก็ยังเป็นเวลาปัจจุบันเหมือนเดิม',
     closeFollow(base, { qty: 4, by: 'ก' }).done_at > yday);
  ok('done_qty ยังคิดเหมือนเดิม ไม่โดนวันที่กวน', rec.done_qty === 4 && rec.done === false);
}

console.log('\n=== M. ต่อสายหน้า over รอคืน (อ่านซอร์ส) ===');
const appOver = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const htmlOver = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');

ok('มีแท็บ over รอคืน ในกลุ่ม Mat Follow up',
   /\{ k: 'fover',\s+label: 'over รอคืน' \}/.test(appOver));
ok('มีแผงรองรับจริง ไม่ใช่ปุ่มที่กดแล้วได้จอเปล่า',
   htmlOver.includes(`tab==='fover'`));

// ⚠️ กับดักเดิมของตัวคิดยอดเกินรุ่นแรก — ส่งอ็อบเจกต์ทั้งแถวเข้าไปแล้วคูณได้ NaN เงียบ ๆ
ok('หน้าจอส่ง usageOf ที่คืนตัวเลขต่อชิ้น ไม่ใช่ byPn ทั้งแถว',
   /const bomUsageOf = \(pn, code\) => \{[\s\S]{0,220}Number\(hit\.usage\)/.test(appOver)
   && !/usageOf: byPn/.test(appOver));
ok('ตัดคู่ที่ตั้งเรื่องไว้แล้วออกจากรายการที่ระบบคำนวณได้',
   /overPending\(foCalc\.value\.filter\(r => !r\.why\), shorts\.value\)/.test(appOver));
ok('การ์ด "คำนวณไม่ได้" มีจริง — ไม่งั้น PO พวกนั้นหายจากจอเงียบ ๆ',
   /foBlocked/.test(appOver) && htmlOver.includes('v-if="foBlocked.length"'));

/* ⚠️ การ์ดเทียบยอดที่ Delta ตัด ต้องคิดของเกินฝั่งเราแบบไม่มีเพดาน OVER_MIN
 *    ส่ง foNew เข้าไปเมื่อไหร่ ของเกินต่ำกว่า 1 หน่วย (ค่าปกติของไฟล์เคมี) จะหายทั้งก้อน
 *    แล้วการ์ดขึ้นแถบแดงว่า "เรามีน้อยกว่า" ทั้งที่ยอดตรงกันเป๊ะ (ผู้ตรวจ #102 รอบ 1) */
ok('การ์ดเทียบยอด Delta ตัด ใช้ของเกินที่ไม่มีเพดาน OVER_MIN ไม่ใช่ foNew',
   /pending: ocPending\.value/.test(appOver)
   && /const ocPending = computed\([\s\S]{0,500}min: 0[\s\S]{0,200}overPending\(/.test(appOver)
   && !/pending: foNew\.value/.test(appOver));
ok('การ์ด "ของเกินที่ระบบคำนวณได้" ยังคงเพดาน 1 หน่วยไว้เหมือนเดิม',
   /overAll\(entries\.value, entity\.value,\s*\{ headerOf: po => poHeader\(pos\.value, po\), usageOf: bomUsageOf \}\)/
     .test(appOver)
   && htmlOver.includes('ยอดที่ต่ำกว่า 1 หน่วยไม่นับว่าเกิน'));

ok('foStart ส่งวันที่ตามเวลาไทยเข้าไปเอง ไม่ปล่อยให้เป็น UTC',
   /fromOverRow\(row, \{[\s\S]{0,160}date: todayLocal\(\)/.test(appOver));

// ปุ่มนี้ตัดของจริงออกจากคลัง ห้ามเป็นปุ่มติ๊กเดียวจบ
ok('ปุ่มคืนเปิดกล่องให้ยืนยันก่อน ไม่ใช่ตัดสต็อกทันที',
   /@click="askReturn\(r\.s\)"/.test(htmlOver) && /v-if="rb\.row"/.test(htmlOver));
ok('กล่องคืนของให้เลือกล็อตจากของที่มีจริง และไม่ใช้ datalist (issue #26)',
   /rbLots/.test(htmlOver) && /@click="rb\.lot = l\.lot"/.test(htmlOver)
   && !/id="rblots"/.test(htmlOver));
ok('กล่องคืนของบอกยอดหลังคืน และย้อมแดงเมื่อติดลบ',
   /rbAfter/.test(htmlOver) && /rbAfter < 0/.test(htmlOver));
/* ⚠️ เคมีคิดเป็นกิโลกรัม มีทศนิยม · ลบ float ดิบ ๆ ในเทมเพลตจะได้ 1.3499999999999999
 *    ขณะที่ตารางข้างหลังขึ้น 1.35 เพราะผ่าน remainOf — สองตัวเลขในจอเดียวกันไม่ตรงกัน
 *    บนกล่องที่ตัดของจริงออกจากคลัง (ผู้ตรวจ #90 รอบ 1 · INVARIANTS A2) */
ok('ยอด "ยังค้าง" ในกล่องคืนของมาจาก remainOf ไม่ใช่ลบ float ดิบ ๆ ในเทมเพลต — A2',
   /ยังค้าง \{\{ rbRemain \}\}/.test(htmlOver)
   && !/rb\.row\.qty\s*-\s*\(?rb\.row\.done_qty/.test(htmlOver));
ok('rbRemain ต่อสายไว้จริงและส่งออกให้เทมเพลตใช้ได้',
   /const rbRemain = computed\(\(\) => \(rb\.row \? remainOf\(rb\.row\) : 0\)\)/.test(appOver)
   && /\brbRemain\b/.test(appOver.slice(appOver.lastIndexOf('return {'))));
{ // ค่าที่ rbRemain คืน ต้องตรงกับค่าตั้งต้นของช่อง "จำนวนที่คืน" เป๊ะ (ทางเดียวกัน)
  const frac2 = { qty: 2.96, done_qty: 1.61 };
  ok('เคสทศนิยมที่เคยโชว์ยาวเกินจอ ผ่าน remainOf แล้วได้ 1.35',
     remainOf(frac2) === 1.35 && frac2.qty - frac2.done_qty !== 1.35,
     `${remainOf(frac2)} vs ${frac2.qty - frac2.done_qty}`);
}
ok('เตือนเมื่อใบนั้นยังรับมาไม่ครบ แต่ยังกดต่อได้ (A4)',
   /v-if="rbShort\.length"/.test(htmlOver)
   && /:disabled="!rbReady \|\| rb\.busy"/.test(htmlOver));
ok('บันทึกลงสมุดก่อน แล้วค่อยปิดเรื่อง และผูกเลขที่รายการไว้ให้ไล่ย้อนได้',
   /db\.put\('entries', e\)[\s\S]{0,800}rec\.return_entry_id =/.test(appOver));

/* ── ข้อสังเกตหกข้อของผู้ตรวจ #90 (เจ้าของสั่งให้แก้ 20 ก.ย. 2026) ── */
ok('จับค่าจาก rb.row ไว้ก่อน await — กล่องปิดกลางคันแล้วต้องไม่โยน TypeError',
   /const row = plain\(rb\.row\);[\s\S]{0,120}const qty = Number\(rb\.qty\);/.test(appOver)
   && !/flash\(`คืน \$\{rb\.row/.test(appOver));
ok('คืนหลายรอบต้องต่อท้ายเลขที่รายการ ไม่ทับของเดิม',
   /rec\.return_entry_id = \[String\(row\.return_entry_id[\s\S]{0,60}\.join\(' '\)/.test(appOver));
ok('กล่องคืนของมีช่องวันที่ และส่ง atFrom(rb.date) เข้าไป',
   /v-model="rb\.date" type="date"/.test(htmlOver) && /at: atFrom\(rb\.date\)/.test(appOver)
   && /rb\.date = todayLocal\(\)/.test(appOver));
ok('กล่องส่งวันที่ที่คนคีย์ไปเป็นวันที่ปิดเรื่องด้วย',
   /closeFollow\(row, \{ qty, by: rb\.person\.trim\(\), doneAt: atFrom\(rb\.date\) \}\)/.test(appOver));
ok('ยังไม่เลือกนิติบุคคล กล่องต้องบอกว่าเทียบไม่ได้ ไม่ใช่เงียบ (A3)',
   /if \(!entity\.value\) return 'ยังไม่ได้เลือกนิติบุคคลที่หัวจอ';/.test(appOver)
   && /const rbShortWhy = computed/.test(appOver));
ok('เทียบไม่ได้ต้องขึ้นบอกในกล่อง ไม่ใช่เงียบเหมือนตอนรับครบ',
   /const rbShortWhy = computed/.test(appOver) && /shortWhyOf\(rb\.row\.po/.test(appOver)
   && /v-if="rbShortWhy"/.test(htmlOver)
   && /\brbShortWhy\b/.test(appOver.slice(appOver.lastIndexOf('return {'))));
ok('ยกเลิกเรื่องใช้ voidFollow ไม่ใช่ลบทิ้ง (B1)',
   /voidFollow\(plain\(row\)/.test(appOver) && !/db\.del\('shorts'/.test(appOver));

/* ── ผู้ตรวจ #90 รอบ 4 ข้อ 1 — วันที่คืนที่โชว์กลับมาในตาราง ──────────────
 * done_at ของเรื่องของเกินเป็นวันที่ที่คนเลือกเอง (atFrom) แล้ว
 * ถ้าเทมเพลต slice เอา 10 ตัวแรกของ ISO จะได้วันที่ตาม UTC
 * คนกะเช้ากดตอนตีห้าครึ่งจะเห็น "เมื่อวาน" ขณะที่รายการในสมุดลงวันที่ที่เลือกจริง
 * (ตรวจเฉพาะบล็อกแท็บ fover — บรรทัดของแท็บ fshort เป็นของเดิม ไม่ใช่ของใบนี้) */
{
  const iOver = htmlOver.indexOf(`tab==='fover'`);
  const foverSrc = iOver < 0 ? ''
    : htmlOver.slice(iOver, htmlOver.indexOf(`v-else-if="tab===`, iOver + 1));
  ok('หาบล็อกแท็บ over รอคืน ใน index.html เจอ', foverSrc.length > 0);
  ok('วันที่คืนในตารางผ่าน localDate ไม่ slice ISO เอาเอง',
     /คืน \{\{ localDate\(r\.s\.done_at\) \}\}/.test(foverSrc)
     && !/done_at[^}]*\.slice\(0,\s*10\)/.test(foverSrc));
  ok('localDate ส่งออกให้เทมเพลตใช้ได้จริง',
     /\blocalDate\b/.test(appOver.slice(appOver.lastIndexOf('return {'))));
}
{ /* พิสูจน์ว่าสองวิธีให้คนละคำตอบจริง ไม่ใช่เทสที่เขียวทั้งก่อนและหลัง
   * เครื่องในโรงงานตั้งเป็นเวลาไทย (+7) แต่เครื่องที่รันเทสอาจเป็น UTC
   * จึงเลือกเวลาหลังเที่ยงคืนนิดเดียว ซึ่งเลื่อนวันแน่นอนในทุกโซนที่เร็วกว่า UTC */
  const early = new Date(2026, 8, 19, 0, 30, 0);
  const doneAt = atFrom('2026-09-19', early);
  const rec = closeFollow(makeFollow({ kind: 'over', entity: 'TUE-H', code: C1, po: PO,
                                       part_no: PN, qty: 10 }),
                          { qty: 10, by: 'ก', doneAt });
  ok('วันที่คืนที่คนเลือกอ่านกลับมาผ่าน localDate ได้ตรงเดิม',
     localDate(rec.done_at) === '2026-09-19', rec.done_at);
  const eastOfUtc = early.getTimezoneOffset() < 0;   // ไทยคือ -420
  ok('โซนที่เร็วกว่า UTC — slice ISO ได้คนละวันกับ localDate (เครื่องที่รันที่ UTC ข้ามข้อนี้)',
     !eastOfUtc || rec.done_at.slice(0, 10) === '2026-09-18', rec.done_at);
}

console.log('\n=== N. ซื้อแมททดแทนของเสีย ===');
/* ของเสียถูกตัดออกจากคลังไปแล้ว · ของที่หายไปต้องสั่งทดแทนผ่าน Delta
 * เรื่องผูกกับรายการของเสียใบนั้นเสมอ ไม่ใช่ผูกกับรหัสลอย ๆ */
const scrap = (o = {}) => ({ id: 'S1', entity: 'TUE-H', kind: 'scrap', material_code: C1,
  qty: 6, lot: 'L-9', at: '2026-09-10T03:00:00.000Z', reason_code: 'wind',
  person: 'ก', note: '', voided: false, ...o });

{
  const list = pendingScraps([scrap(), recv()], 'TUE-H', []);
  ok('ของเสียที่ยังไม่มีใครตั้งเรื่อง ขึ้นในรายการ · ใบรับเข้าไม่ปนมา',
     list.length === 1 && list[0].id === 'S1' && list[0].qty === 6, JSON.stringify(list));
  ok('พกล็อตกับเหตุผลมาให้ดูด้วย', list[0].lot === 'L-9' && list[0].reason_code === 'wind');
}
ok('ของเสียที่ยกเลิกแล้วไม่ขึ้น (B1)',
   pendingScraps([scrap({ voided: true })], 'TUE-H', []).length === 0);
ok('ของเสียของนิติบุคคลอื่นไม่ปน (A3)',
   pendingScraps([scrap({ entity: 'TUE-U' })], 'TUE-H', []).length === 0);
throws('ลืมส่งนิติบุคคลต้องดัง ไม่ใช่รวมทุกโรงงาน',
       () => pendingScraps([scrap()], '', []), 'A3');
ok('ใหม่สุดขึ้นก่อน',
   pendingScraps([scrap(), scrap({ id: 'S2', at: '2026-09-12T03:00:00.000Z' })],
                 'TUE-H', [])[0].id === 'S2');

const scrapRow = pendingScraps([scrap()], 'TUE-H', [])[0];
const buyCase = fromScrapRow(scrapRow, { entity: 'TUE-H', person: 'ผู้ทดสอบ', unit: 'PCS' });
ok('ตั้งเรื่องแล้วได้งานตามแบบซื้อทดแทน',
   buyCase.kind === 'buy' && buyCase.qty === 6 && buyCase.code === C1);
ok('ผูกกับรายการของเสียใบนั้นไว้ ไล่ย้อนได้ว่าซื้อแทนของที่เสียครั้งไหน',
   buyCase.scrap_entry_id === 'S1' && buyCase.source === 'auto');
// po ของเรื่องซื้อ = PO เดิมที่ของเสียเกิด (Old Po.) · ของเสียที่ไม่ได้อ้าง PO ก็ว่างได้
ok('ของเสียไม่ได้อ้าง PO — เรื่องซื้อตั้งได้ PO ว่าง · PO ใหม่ (next_po) ยังไม่รู้',
   buyCase.po === '' && buyCase.next_po === '');
throws('ตั้งเรื่องโดยไม่บอกนิติบุคคลไม่ได้ (A3)', () => fromScrapRow(scrapRow, {}), 'A3');
throws('ไม่มีรายการของเสียก็ตั้งเรื่องไม่ได้',
       () => fromScrapRow(null, { entity: 'TUE-H' }), 'ของเสีย');

// ⚠️ ตั้งซ้ำใบเดิม = สั่งของสองเท่าโดยไม่มีใครรู้
throws('ของเสียใบเดียวตั้งเรื่องซ้ำไม่ได้',
       () => fromScrapRow(scrapRow, { entity: 'TUE-H', follows: [buyCase] }), 'ตั้งเรื่อง');
ok('ตั้งเรื่องไว้แล้ว ของเสียใบนั้นหายจากรายการที่รอ',
   pendingScraps([scrap()], 'TUE-H', [buyCase]).length === 0);
ok('เรื่องที่ยกเลิกไปแล้วไม่กันไว้ — ของเสียใบนั้นต้องกลับมาตั้งเรื่องใหม่ได้',
   pendingScraps([scrap()], 'TUE-H', [{ ...buyCase, voided: true }]).length === 1);
ok('buyFor หาเรื่องที่ผูกอยู่เจอ และไม่สับสนกับของเสียใบอื่น',
   buyFor([buyCase], 'S1') === buyCase && buyFor([buyCase], 'S2') === null);

const got = linkReceive(buyCase, { entryId: 'E-IN-1', qty: 6, by: 'ผู้รับ',
                                   doneAt: '2026-09-20T03:00:00.000Z' });
ok('รับของครบแล้วเรื่องปิด', got.done === true && got.done_qty === 6);
ok('ผูกเลขที่รายการรับเข้าไว้', got.receive_entry_id === 'E-IN-1');
ok('วันที่รับของตามที่ส่งมา แต่เวลาซิงค์ยังเป็นเวลาจริง (D5)',
   got.done_at === '2026-09-20T03:00:00.000Z' && got.updated_at > got.done_at);

const part1 = linkReceive(buyCase, { entryId: 'E-IN-A', qty: 2, by: 'ก' });
ok('รับมาบางส่วน เรื่องยังไม่ปิด', part1.done === false && remainOf(part1) === 4);
const part2 = linkReceive(part1, { entryId: 'E-IN-B', qty: 4, by: 'ก' });
ok('ของทยอยมา เลขที่รายการต้องต่อท้าย ไม่ทับของเดิม',
   part2.receive_entry_id === 'E-IN-A E-IN-B' && part2.done === true, part2.receive_entry_id);

// ⚠️ Delta ส่งเผื่อมาเกินเกิดขึ้นจริง · ปิดได้แค่ยอดที่ค้าง ไม่ใช่โยนทิ้งทั้งที่ของมาถึงแล้ว
ok('รับมามากกว่าที่ตั้งเรื่องไว้ ต้องปิดเรื่องได้ ไม่ใช่ error',
   linkReceive(buyCase, { entryId: 'E-IN-2', qty: 99, by: 'ก' }).done_qty === 6);

throws('ผูกของที่รับมากับเรื่องของขาดไม่ได้',
       () => linkReceive(makeFollow({ kind: 'short', entity: 'TUE-H', code: C1, po: PO,
                                      type: 'ขาด', qty: 1 }), { entryId: 'E1', qty: 1 }), 'ซื้อทดแทน');
throws('เรื่องที่ยกเลิกแล้วผูกไม่ได้',
       () => linkReceive({ ...buyCase, voided: true }, { entryId: 'E1', qty: 1 }), 'ยกเลิก');
throws('เรื่องที่ปิดไปแล้วผูกซ้ำไม่ได้', () => linkReceive(got, { entryId: 'E1', qty: 1 }), 'ปิด');
throws('ไม่มีเลขที่รายการรับเข้า ผูกไม่ได้', () => linkReceive(buyCase, { qty: 1 }), 'เลขที่');
throws('จำนวนที่รับต้องมากกว่าศูนย์', () => linkReceive(buyCase, { entryId: 'E1', qty: 0 }), 'ศูนย์');

/* ⚠️ ผูกใบเดิมซ้ำ = ปิดยอดซ้ำสองรอบจากของกองเดียว (ผู้ตรวจรอบ 1 ข้อสังเกต 5) */
{
  const once = linkReceive(buyCase, { entryId: 'E-DUP', qty: 2, by: 'ก' });
  throws('ผูกกับใบรับเข้าใบเดิมซ้ำไม่ได้',
         () => linkReceive(once, { entryId: 'E-DUP', qty: 2, by: 'ก' }), 'ไปแล้ว');
  ok('ใบอื่นยังผูกต่อได้ตามปกติ',
     linkReceive(once, { entryId: 'E-OTHER', qty: 2, by: 'ก' }).receive_entry_id === 'E-DUP E-OTHER');
}

/* ── I · ของเสียต้นเรื่องถูกยกเลิกทีหลัง — ต้องเห็น ไม่ใช่ค้างเงียบ (เจ้าของสั่ง 20 ก.ย. 2026) ── */
{
  const dead = [scrap({ voided: true })];
  const o = orphanBuys(dead, 'TUE-H', [buyCase]);
  ok('ของเสียถูกยกเลิกทีหลัง เรื่องซื้อขึ้นเป็นรายการที่ต้นเหตุหายไป',
     o.length === 1 && o[0].id === buyCase.id && o[0].why.includes('ยกเลิก'), JSON.stringify(o[0] || {}));
  ok('ของเสียยังอยู่ดี ๆ ไม่ขึ้นเป็นรายการที่ต้องเตือน',
     orphanBuys([scrap()], 'TUE-H', [buyCase]).length === 0);
  ok('หารายการของเสียไม่เจอในสมุด ก็ต้องเตือนเหมือนกัน',
     orphanBuys([], 'TUE-H', [buyCase])[0].why.includes('ไม่เจอ'));
  ok('เรื่องที่รับของครบแล้ว ไม่ต้องเตือนย้อนหลัง',
     orphanBuys(dead, 'TUE-H', [{ ...buyCase, done: true, done_qty: buyCase.qty }]).length === 0);
  ok('เรื่องที่ยกเลิกไปแล้ว ไม่ต้องเตือน',
     orphanBuys(dead, 'TUE-H', [{ ...buyCase, voided: true }]).length === 0);
  ok('เรื่องของนิติบุคคลอื่นไม่ปน (A3)',
     orphanBuys(dead, 'TUE-H', [{ ...buyCase, entity: 'TUE-U' }]).length === 0);
  ok('เรื่องของขาด/ของเกิน ไม่เกี่ยวกับการ์ดนี้',
     orphanBuys(dead, 'TUE-H', [{ ...buyCase, kind: 'short' }]).length === 0);
  throws('ลืมส่งนิติบุคคลต้องดัง', () => orphanBuys(dead, '', [buyCase]), 'A3');
  ok('ไม่ยกเลิกเรื่องให้เอง — คืนสำเนาพร้อมเหตุผล ของเดิมไม่ถูกแตะ (B1)',
     o[0] !== buyCase && buyCase.voided === false && !('why' in buyCase));
}

console.log('\n=== O. ต่อสายหน้าซื้อแมททดแทน (อ่านซอร์ส) ===');
const appBuy = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const htmlBuy = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');

ok('มีแท็บซื้อแมททดแทนในกลุ่ม Mat Follow up',
   /\{ k: 'fbuy',\s+label: 'ซื้อแมททดแทน' \}/.test(appBuy));
ok('มีแผงรองรับจริง ไม่ใช่ปุ่มที่กดแล้วได้จอเปล่า', htmlBuy.includes(`tab==='fbuy'`));
ok('รายการของเสียที่รอ คิดจาก pendingScraps และกรองนิติบุคคล (A3)',
   /pendingScraps\(entries\.value, entity\.value, shorts\.value\)/.test(appBuy));
ok('ตั้งเรื่องส่ง follows เข้าไปด้วย — กันตั้งซ้ำใบเดิม',
   /fromScrapRow\(row, \{[\s\S]{0,220}follows: shorts\.value/.test(appBuy));

/* ⚠️ ข้อนี้คือหัวใจของใบนี้ — หน้านี้ต้องไม่มีทางเขียนของเข้าคลังเอง
 *    มีสองทางรับเข้าเมื่อไหร่ ช่องผู้รับ/ล็อต/วันหมดอายุจะเต็มบ้างไม่เต็มบ้าง */
ok('หน้านี้ไม่สร้างรายการรับเข้าเอง — ส่งไปหน้ารับเข้าหน้าเดิม',
   /function fbGo\(row\)[\s\S]{0,600}tab\.value = 'in'/.test(appBuy)
   && !/fbGo[\s\S]{0,600}makeEntry\(/.test(appBuy));

/* ⚠️ กดไปรับของสองเรื่องติดกันเกิดขึ้นจริง · ค่าเดี่ยวจะทับเรื่องแรกเงียบ ๆ (ผู้ตรวจรอบ 2 ข้อ 2) */
ok('คิวรอเป็นรายการ ไม่ใช่ค่าเดี่ยวที่ทับกันเอง',
   /const buyWaits = ref\(\[\]\)/.test(appBuy)
   && /buyWaits\.value\.push\(\{ id: row\.id, code: normCode\(row\.code\) \}\)/.test(appBuy)
   && !/\bbuyWait\b(?!s)/.test(appBuy));
ok('กดเรื่องเดิมซ้ำไม่เข้าคิวสองรอบ',
   /if \(!buyWaits\.value\.some\(w => w\.id === row\.id\)\)/.test(appBuy));

/* ⚠️ ไม่มีทางเลิกรอ = บรรทัดตามไปทุกใบจนกว่าจะรับของรหัสนั้นจริง (ผู้ตรวจรอบ 2 ข้อ 1) */
ok('ออกจากหน้ารับเข้าแล้วเลิกรอเอง แต่เดินกลับไปกดเรื่องที่สองไม่นับว่าเลิกรอ',
   /watch\(tab, \(now, before\) => \{[\s\S]{0,200}before === 'in' && now !== 'in' && now !== 'fbuy'[\s\S]{0,40}buyWaits\.value = \[\]/.test(appBuy));
ok('มีปุ่มเลิกรอให้กดเองด้วย',
   /function cancelBuyWaits\(\)/.test(appBuy) && /@click="cancelBuyWaits"/.test(htmlBuy)
   && /v-if="buyWaits\.length"/.test(htmlBuy));
ok('ผูกเลขที่รายการกลับมาหลังบันทึกรับเข้าสำเร็จแล้วเท่านั้น',
   /db\.announce\('entries'\);[\s\S]{0,260}await linkBuy\(posted\)/.test(appBuy));
/* ⚠️ ข้อความปิดเรื่องเคยทับ "บันทึกรับเข้า N รายการ" จนไม่เห็นยืนยันว่าบันทึกกี่รายการ */
ok('ข้อความเดียวจบ — linkBuy คืนข้อความให้ saveIn ไม่ flash เอง',
   /const extra = await linkBuy\(posted\)/.test(appBuy)
   && /flash\(\[`บันทึกรับเข้า/.test(appBuy)
   && !/linkBuy[\s\S]{0,900}flash\(`ปิดเรื่องซื้อทดแทน/.test(appBuy));
ok('ยกเลิกเรื่องใช้ voidFollow ไม่ลบทิ้ง (B1)', /fbVoid[\s\S]{0,300}voidFollow\(plain\(row\)/.test(appBuy));
/* เรื่องถูกยกเลิกหรือปิดไปก่อนของจะมาถึง — ต้องเงียบ ไม่ใช่เด้ง error ทับข้อความบันทึกสำเร็จ (G3) */
ok('เรื่องหายไประหว่างรอของ ต้องไม่เด้ง error หลังบันทึกรับเข้าสำเร็จ',
   /if \(!row \|\| row\.voided \|\| remainOf\(row\) <= 0\) continue;/.test(appBuy));
ok('การ์ดเตือนเรื่องที่ต้นเหตุหายไปมีจริงบนจอ',
   /const fbOrphans = computed/.test(appBuy) && /v-if="fbOrphans\.length"/.test(htmlBuy));
/* ── บรรทัดที่รออยู่ ต้องรอดจาก expandBom() ── รันของจริงที่แกะออกมาจากซอร์ส ───────────
 * ⚠️ ข้อที่ผู้ตรวจรอบ 1 ทักไว้ · เทสหมวดนี้ที่เหลืออ่านซอร์สล้วน จับพฤติกรรมข้อนี้ไม่ได้เลย
 * เรื่องซื้อทดแทนไม่มีเลข PO ตอนตั้งเรื่อง พนักงานจึงคีย์เลข PO หลังกด [ไปรับของ] เสมอ
 * ซึ่งวิ่งเข้า expandBom() ที่สั่ง `inLines.value = ...` ตรง ๆ — บรรทัดที่เพิ่งใส่ให้หายเงียบ
 * แล้ว linkBuy() หารหัสนั้นไม่เจอ เรื่องไม่ถูกปิดโดยไม่มีอะไรฟ้อง */
function cutFn(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`ไม่พบ function ${name} ใน v2/app.js`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`อ่าน function ${name} ใน v2/app.js ไม่จบ`);
}

// ถ้าฟังก์ชันหายไป รายงานเป็นข้อที่ตก ไม่ใช่ทิ้งทั้งไฟล์ — ข้ออื่นอีกสองร้อยกว่าข้อต้องยังรายงานได้
const hasKeep = appBuy.includes('function keepBuyLine(');
ok('มี keepBuyLine ให้ expandBom เรียก', hasKeep);

// ตัวแปรที่ keepBuyLine อ้างถึงใน setup() ส่งเข้าไปเป็นพารามิเตอร์แทน
const keepFn = hasKeep && new Function('buyWaits', 'shorts', 'inLines', 'bomHint',
                            'blankLine', 'fillInLine', 'normCode', 'remainOf', 'round5',
                            cutFn(appBuy, 'keepBuyLine') + '\nreturn keepBuyLine();');
const HINT = 'กางสูตร 3 รายการ';
// waiting = แถวเดียว หรือหลายแถว (รหัสเดียวกันได้ — ของเสียรหัสเดิมหลายรอบเป็นเรื่องปกติ)
const keepRun = (lines, waiting, rows) => {
  const ctx = { lines: { value: lines }, hint: { value: HINT }, ran: hasKeep };
  if (!hasKeep) return ctx;
  const queue = (Array.isArray(waiting) ? waiting : waiting ? [waiting] : [])
    .map(r => ({ id: r.id, code: normCode(r.code) }));
  // คิวรอเป็นรายการตั้งแต่รอบแก้ข้อสังเกต — ส่งเข้าไปเป็น array
  keepFn({ value: queue }, { value: rows }, ctx.lines, ctx.hint,
         code => ({ k: 'L', code, desc: '', unit: '', reqmt: null, qty: null }),
         () => {}, normCode, remainOf, round5);
  return ctx;
};

{
  const c = keepRun([{ code: 'ZZ-อื่น', qty: 2 }], buyCase, [buyCase]);
  ok('บรรทัดที่ expandBom ล้างไป ต้องงอกกลับพร้อมยอดที่ยังค้าง',
     c.lines.value.length === 2 && normCode(c.lines.value[1].code) === normCode(C1)
     && c.lines.value[1].qty === 6, JSON.stringify(c.lines.value));
  ok('bomHint ที่ถูกทับ ต้องเตือนว่ายังมีเรื่องซื้อทดแทนรอผูกอยู่',
     c.hint.value.startsWith(HINT) && c.hint.value.includes('ซื้อทดแทน'), c.hint.value);
}
// รหัสนั้นบังเอิญอยู่ใน Kit List — ยอดที่ Delta จ่ายมาน่าเชื่อกว่ายอดที่ค้าง ห้ามทับ
ok('รหัสนั้นอยู่ในใบอยู่แล้ว ไม่งอกซ้ำ และไม่ทับยอดที่ Kit List เติมให้',
   (() => { const c = keepRun([{ code: C1, qty: 4 }], buyCase, [buyCase]);
            return c.ran && c.lines.value.length === 1 && c.lines.value[0].qty === 4; })());
ok('เรื่องถูกยกเลิกไประหว่างรอ ไม่งอกบรรทัดให้',
   (() => { const c = keepRun([], buyCase, [{ ...buyCase, voided: true }]);
            return c.ran && c.lines.value.length === 0 && c.hint.value === HINT; })());
ok('เรื่องปิดครบไปแล้ว ไม่งอกบรรทัดให้',
   (() => { const c = keepRun([], got, [got]);
            return c.ran && c.lines.value.length === 0 && c.hint.value === HINT; })());
ok('ไม่มีเรื่องรออยู่ หน้ารับเข้าต้องไม่ถูกแตะเลย',
   (() => { const c = keepRun([], null, []);
            return c.ran && c.lines.value.length === 0 && c.hint.value === HINT; })());

/* ── สองเรื่องรหัสเดียวกันรอพร้อมกัน ── ของเสียรหัสเดิมเสียหลายรอบเป็นเรื่องปกติ ───────
 * ⚠️ คนละเรื่องกับ "เรื่องเดียวสองบรรทัดในใบ" ที่เทสเดิมคุมไว้
 *    ถ้ายอดที่งอกกลับเป็นของเรื่องแรกเรื่องเดียว จอจะบอกว่ารอ 6 กับ 4 แต่เติมให้แค่ 6
 *    แล้ว linkBuy จะปิดให้ทั้งสองเรื่องรวม 10 จากของ 6 ชิ้น (ผู้ตรวจรอบ 4 ข้อ 1.2) */
const buy2 = fromScrapRow({ id: 'S2', code: C1, qty: 4 },
                          { entity: 'TUE-H', person: 'ผู้ทดสอบ', unit: 'PCS' });
{
  const c = keepRun([], [buyCase, buy2], [buyCase, buy2]);
  ok('สองเรื่องรหัสเดียวกัน — บรรทัดเดียวแต่ยอดต้องเป็นผลรวมของทุกเรื่องที่รออยู่',
     c.ran && c.lines.value.length === 1 && c.lines.value[0].qty === 10,
     JSON.stringify(c.lines.value));
  ok('คำเตือนบอกว่ารออยู่กี่เรื่อง ค้างรวมเท่าไหร่',
     c.hint.value.includes('2 เรื่อง') && c.hint.value.includes('ค้าง 10'), c.hint.value);
}

/* ── ของกองเดียวต้องถูกหักไปทีละเรื่อง ── รัน linkBuy ตัวจริงที่แกะจากซอร์ส ────────────
 * ⚠️ ข้อที่ผู้ตรวจรอบ 4 ทัก · ถ้าแต่ละเรื่องหยิบ "ผลรวมทุกบรรทัดของรหัสนั้น" ไปคนละครั้งเต็ม ๆ
 *    เรื่องที่สองจะขึ้นว่าของมาครบแล้วทั้งที่ยังไม่ได้รับสักชิ้น แล้วหายจากรายการที่ต้องตาม */
const hasLink = appBuy.includes('async function linkBuy(');
ok('มี linkBuy ให้ saveIn เรียก', hasLink);
const linkFn = hasLink && new Function('buyWaits', 'shorts', 'inH', 'fsPut', 'plain',
                            'normCode', 'remainOf', 'round5', 'linkReceive', 'posted',
                            'async ' + cutFn(appBuy, 'linkBuy') + '\nreturn linkBuy(posted);');
/** waiting = เรื่องที่กด [ไปรับของ] ไว้ · posted = บรรทัดที่เพิ่งบันทึกรับเข้า */
const linkRun = async (waiting, posted) => {
  const rows = waiting.map(r => ({ ...r }));
  const queue = { value: rows.map(r => ({ id: r.id, code: normCode(r.code) })) };
  const put = rec => { const i = rows.findIndex(x => x.id === rec.id); rows.splice(i, 1, rec); };
  const msgs = await linkFn(queue, { value: rows }, { person: 'ผู้รับ' }, put,
                            r => JSON.parse(JSON.stringify(r)), normCode, remainOf, round5,
                            linkReceive, posted);
  return { rows, left: queue.value, msgs };
};

if (hasLink) {
  // ของมา 4 ชิ้น แต่รออยู่สองเรื่อง 6 กับ 4 — ปิดรวมต้องไม่เกิน 4
  const r = await linkRun([buyCase, buy2],
                          [{ id: 'E-1', material_code: C1, qty: 4, at: NOW }]);
  const sum = round5(r.rows.reduce((n, x) => n + (Number(x.done_qty) || 0), 0));
  ok('ของกองเดียวปิดได้ไม่เกินที่รับจริง — ไม่ใช่ทุกเรื่องหยิบกองเต็ม',
     sum === 4, `ปิดรวม ${sum} จากของ 4`);
  ok('เรื่องแรกได้ของไปก่อน · เรื่องที่สองยังไม่ได้รับสักชิ้น',
     r.rows[0].done_qty === 4 && r.rows[0].done === false
     && !r.rows[1].done_qty && r.rows[1].done === false, JSON.stringify(r.rows[1]));
  ok('เรื่องที่ยังไม่ได้ของ ต้องค้างอยู่ในคิวเพื่อรอใบถัดไป',
     r.left.length === 1 && r.left[0].id === buy2.id, JSON.stringify(r.left));
  ok('เรื่องที่ยังไม่ได้ของ ต้องไม่ถูกผูกเลขที่รายการที่ไม่เกี่ยวกัน',
     !r.rows[1].receive_entry_id, r.rows[1].receive_entry_id);
  ok('ข้อความบอกตามจริงว่าปิดไปเท่าไหร่ ยังค้างเท่าไหร่',
     r.msgs.length === 1 && r.msgs[0].includes('ยังค้างอีก 2'), JSON.stringify(r.msgs));

  // ของมาครบทั้งสองเรื่อง — แบ่งกันถูกใบ ไม่ปนเลขที่รายการของกันและกัน
  const full = await linkRun([buyCase, buy2],
                             [{ id: 'E-1', material_code: C1, qty: 6, at: NOW },
                              { id: 'E-2', material_code: C1, qty: 4, at: NOW }]);
  ok('ของมาครบ ปิดได้ทั้งสองเรื่อง แยกใบกันถูกตัว',
     full.rows[0].done_qty === 6 && full.rows[0].receive_entry_id === 'E-1'
     && full.rows[1].done_qty === 4 && full.rows[1].receive_entry_id === 'E-2'
     && full.left.length === 0, JSON.stringify(full.rows.map(x => x.receive_entry_id)));

  /* ⚠️ เรื่องเดียวแต่ใบมีรหัสเดียวกันสองบรรทัด (คนละล็อต) เป็นเรื่องปกติ
   *    ต้องรวมทั้งสองบรรทัด ไม่ใช่หยิบบรรทัดแรก (ผู้ตรวจรอบ 2 ข้อ 2 — เดิมเป็นเทสอ่านซอร์ส) */
  const twoLines = await linkRun([buyCase],
                                 [{ id: 'E-1', material_code: C1, qty: 2, at: NOW },
                                  { id: 'E-2', material_code: ' mc-100 ', qty: 4, at: NOW }]);
  ok('เรื่องเดียว ใบมีรหัสนั้นสองบรรทัด — รวมทั้งสองบรรทัดแล้วปิดครบ',
     twoLines.rows[0].done === true && twoLines.rows[0].done_qty === 6
     && twoLines.rows[0].receive_entry_id === 'E-1 E-2',
     JSON.stringify(twoLines.rows[0]));

  // ใบนี้ไม่มีของที่รออยู่เลย — ต้องเงียบและค้างคิวไว้ ไม่ใช่ปิดให้
  const none = await linkRun([buyCase], [{ id: 'E-9', material_code: C2, qty: 5, at: NOW }]);
  ok('ใบที่ไม่มีของที่รออยู่ ไม่แตะเรื่องเลย และยังค้างคิวไว้',
     !none.rows[0].done_qty && none.left.length === 1 && none.msgs.length === 0);

  // เรื่องถูกยกเลิกไปก่อนของมาถึง — เงียบ ไม่เด้ง error ทับข้อความบันทึกสำเร็จ (G3)
  const dead2 = await linkRun([{ ...buyCase, voided: true }],
                              [{ id: 'E-1', material_code: C1, qty: 6, at: NOW }]);
  ok('เรื่องถูกยกเลิกระหว่างรอ — เงียบ ไม่มีข้อความ error ปนมากับข้อความบันทึกสำเร็จ',
     dead2.msgs.length === 0 && dead2.left.length === 0);

  // เศษทศนิยมต้องไม่ทำให้ปิดไม่ลง (A2)
  const frac2 = await linkRun([{ ...buyCase, qty: 0.3 }],
                              [{ id: 'E-1', material_code: C1, qty: 0.1, at: NOW },
                               { id: 'E-2', material_code: C1, qty: 0.2, at: NOW }]);
  ok('เศษทศนิยม 0.1 + 0.2 ปิดลงพอดี ไม่ค้างเศษ (A2)',
     frac2.rows[0].done === true && frac2.rows[0].done_qty === 0.3,
     JSON.stringify(frac2.rows[0]));
}

/* ── คิวต้องรับเรื่องที่สองได้จริง ── รัน fbGo กับตัว watch ของจริงที่แกะจากซอร์ส ─────────
 * ⚠️ ข้อที่ผู้ตรวจรอบ 5 ทัก · ปุ่ม [ไปรับของ] อยู่ในแท็บ fbuy แท็บเดียว และ fbGo จบด้วย tab='in'
 *    การกดเรื่องที่สองจึงบังคับให้เดิน in → fbuy → in เสมอ ถ้าตัวเลิกรอนับทางนั้นเป็น
 *    "ออกจากหน้ารับเข้า" คิวจะถูกล้างก่อนเรื่องที่สองจะเข้าไปทุกครั้ง = มีได้ไม่เกินหนึ่งเรื่องตลอดกาล
 *    เรื่องแรกหลุดคิวเงียบ ๆ ทั้งที่บรรทัดยังค้างอยู่ในใบ แล้วของกองเดียวถูกรับเข้าคลังสองรอบ
 *    เทสเดิมเป็น regex ที่ยืนยันแค่ว่าบรรทัด watch มีอยู่ จับลำดับนี้ไม่ได้เลย */
function cutWatchTab(src) {
  const cut = i => {
    let depth = 0;
    for (let k = src.indexOf('(', i); k < src.length; k++) {
      if (src[k] === '(') depth++;
      else if (src[k] === ')' && --depth === 0) return src.slice(src.indexOf(',', i) + 1, k);
    }
    throw new Error('อ่าน watch(tab, ...) ใน v2/app.js ไม่จบ');
  };
  // ไฟล์มี watch(tab, ...) มากกว่าหนึ่งที่ — เอาตัวที่ยุ่งกับคิวรอ
  for (let i = src.indexOf('watch(tab,'); i >= 0; i = src.indexOf('watch(tab,', i + 1)) {
    const body = cut(i);
    if (body.includes('buyWaits')) return body;
  }
  throw new Error('ไม่พบ watch(tab, ...) ที่เลิกรอคิวซื้อทดแทน ใน v2/app.js');
}

const hasGo = appBuy.includes('function fbGo(');
ok('มี fbGo ให้ปุ่ม [ไปรับของ] เรียก', hasGo);
if (hasGo) {
  const goFn = new Function('buyWaits', 'inH', 'inLines', 'bomHint', 'tab', 'inManual',
                            'normCode', 'remainOf', 'blankLine', 'fillInLine', 'row',
                            cutFn(appBuy, 'fbGo') + '\nreturn fbGo(row);');
  const q = { value: [] };
  const lines = { value: [] };
  const hint = { value: '' };
  const tabRef = { value: 'fbuy' };
  // ทางคีย์เองถูกซ่อนไว้หลังปุ่มตั้งแต่ใบ 8 — ค่าเริ่มต้นบนจอจริงคือปิด
  const manual = { value: false };
  const onTab = new Function('buyWaits', 'return (' + cutWatchTab(appBuy) + ')')(q);
  const hop = now => {
    const before = tabRef.value;
    tabRef.value = now;
    if (now !== before) onTab(now, before);
  };
  const press = row => {
    const before = tabRef.value;
    goFn(q, { po: '' }, lines, hint, tabRef, manual, normCode, remainOf,
         code => ({ k: 'L', code, desc: '', unit: '', reqmt: null, qty: null }), () => {}, row);
    if (tabRef.value !== before) onTab(tabRef.value, before);
  };

  press(buyCase);        // อยู่แท็บ fbuy กด [ไปรับของ] เรื่องแรก → เด้งไปแท็บ in
  hop('fbuy');           // เดินกลับไปกดเรื่องที่สอง — ไม่ใช่การเลิกรอ
  press(buy2);
  ok('กดไปรับของสองเรื่องติดกัน คิวต้องเก็บไว้ทั้งคู่ ไม่ใช่เหลือเรื่องเดียว',
     q.value.length === 2 && q.value[0].id === buyCase.id && q.value[1].id === buy2.id,
     JSON.stringify(q.value));
  ok('บรรทัดของทั้งสองเรื่องอยู่ในใบรับเข้าครบ',
     lines.value.length === 2, JSON.stringify(lines.value.map(l => l.code)));
  // ⚠️ เรื่องซื้อทดแทนไม่มีเลข PO ตอนตั้งเรื่อง ต้องคีย์ต่อที่หน้ารับเข้าเสมอ
  //    ถ้าไม่เปิดทางคีย์เองให้ จะเด้งไปเจอหน้าที่ไม่มีช่อง PO แล้วไปต่อไม่ได้ (ผู้ตรวจรอบ 1 ของใบ 8)
  ok('กด [ไปรับของ] ต้องเปิดทางคีย์เองให้ด้วย ไม่งั้นไม่มีช่อง PO ให้คีย์',
     manual.value === true);
  ok('กดเรื่องเดิมซ้ำหลังเดินกลับไปกลับมา ไม่เข้าคิวสองรอบ',
     (() => { hop('fbuy'); press(buy2); return q.value.length === 2; })(),
     JSON.stringify(q.value));
  hop('card');
  ok('ออกจากหน้ารับเข้าไปแท็บอื่น ยังเลิกรอให้เหมือนเดิม',
     q.value.length === 0, JSON.stringify(q.value));
}

/* ต้องครบ "ทุก" สาขา — สาขา Kit List กับสาขาสูตรเขียนทับ inLines ทั้งกองคนละบรรทัดกัน */
{
  const branches = cutFn(appBuy, 'expandBom').split('markReceived(recv)');
  ok('ทุกสาขาของ expandBom เรียก keepBuyLine ก่อน markReceived',
     branches.length === 4
     && branches.slice(0, 3).every(b => /keepBuyLine\(\);[^\n]*\n\s*$/.test(b)),
     `พบ ${branches.length - 1} สาขา`);
}

ok('ชื่อที่เทมเพลตเรียก ถูกส่งออกจาก setup() ครบ',
   ['fbNew','fbRows','fbAll','fbStart','fbVoid','fbGo','fbSearch','fbShowDone','fbOrphans',
    'buyWaits','cancelBuyWaits']
     .every(n => new RegExp('\\b' + n + '\\b').test(appBuy.slice(appBuy.lastIndexOf('return {')))));


console.log('\n=== P. คอลัมน์หมวดหมู่ทุกตารางฝั่ง Mat Follow up (เจ้าของ 22 ก.ย. 2026) ===');
// เจ้าของบอกว่า "มีแค่ code mat แล้วไม่รู้ว่าคืออะไร" — ทุกตารางที่โชว์รหัสต้องบอกหมวดหมู่ด้วย
// นับหัวคอลัมน์แทนการไล่ดูทีละตาราง จะได้ไม่ลืมตอนมีคนเพิ่มตารางใหม่ในอนาคต
const appSrcP = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const blockOf = tab => {
  const i = htmlSrc.indexOf("tab==='" + tab + "'");
  if (i < 0) return '';
  const j = htmlSrc.indexOf('<template v-else-if', i + 10);   // ข้าม <template> ซ้อนในบล็อกเดียวกัน
  return htmlSrc.slice(i, j < 0 ? htmlSrc.length : j);
};
const count = (str, needle) => str.split(needle).length - 1;
for (const tab of ['fshort', 'fover', 'fbuy', 'fmat']) {
  const b = blockOf(tab);
  // นับหัวที่ "ขึ้นต้นด้วยรหัส" ไม่ใช่คำว่ารหัสเป๊ะ ๆ — ตารางใหม่ที่ตั้งหัวว่า "รหัสวัตถุดิบ"
  // เคยรอดเทสนี้ไปได้ (ผู้ตรวจ #100 รอบสามพิสูจน์ด้วยการกลายพันธุ์ไฟล์)
  const codes = (b.match(/>รหัส[^<]*<\/th>/g) || []).length, cats = count(b, '>หมวดหมู่</th>');
  ok('แท็บ ' + tab + ' — ทุกตารางที่โชว์รหัส มีหมวดหมู่ครบ',
     codes > 0 && codes === cats, 'รหัส ' + codes + ' · หมวดหมู่ ' + cats);
}
ok('ทุกช่องหมวดหมู่อ่านจาก catOf ไม่ใช่เดาเอง',
   count(htmlSrc, 'catOf(') >= count(htmlSrc, '>หมวดหมู่</th>'),
   count(htmlSrc, 'catOf(') + ' / ' + count(htmlSrc, '>หมวดหมู่</th>'));
// ⚠️ ต้องอ่านผ่านดัชนี ไม่ใช่ไล่ทะเบียนทั้งก้อน — ช่องนี้ถูกเรียกทุกแถวทุกครั้งที่เรนเดอร์
ok('catOf อ่านจากดัชนีทะเบียนวัตถุดิบ และเปิดให้เทมเพลตใช้จริง',
   /matIndex\.value\.get\(normCode\(code\)\)/.test(appSrcP)
   && /const matIndex = computed\(/.test(appSrcP) && /entity, catOf,/.test(appSrcP));
ok('ดัชนีเก็บตัวแรกที่เจอ ให้ผลเท่ากับ find() เดิมเมื่อทะเบียนมีรหัสซ้ำ',
   /if \(!m\.has\(k\)\) m\.set\(k, x\);/.test(appSrcP));
// รหัสที่ยังไม่มีในทะเบียนต้องขึ้นขีด ไม่ใช่ช่องว่างเปล่าที่ดูเหมือนยังโหลดไม่เสร็จ
const catCells = htmlSrc.match(/\{\{ catOf\([^)]*\)[^}]*\}\}/g) || [];
ok('ทุกช่องหมวดหมู่ ถ้าไม่มีในทะเบียนต้องขึ้นขีด',
   catCells.length === count(htmlSrc, 'catOf(') && catCells.every(c => c.includes("|| '—'")),
   JSON.stringify(catCells.filter(c => !c.includes("|| '—'"))));
// แทรกคอลัมน์แล้วลืมบวก colspan ของแถว "ไม่มีเรื่อง" = แถวว่างเหลื่อมไปหนึ่งช่อง
// เทสนับหัวคอลัมน์ข้างบนมองไม่เห็น จึงต้องไล่ colspan เทียบ <th> ของตารางเดียวกันด้วย
for (const tab of ['fshort', 'fover', 'fbuy', 'fmat']) {
  const tables = blockOf(tab).split('<table').slice(1);
  const bad = [];
  tables.forEach((t, k) => {
    const head = (t.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0];
    const th = (head.match(/<th[ >]/g) || []).length;
    for (const m of t.matchAll(/colspan="(\d+)"/g)) {
      if (+m[1] !== th) bad.push(`ตารางที่ ${k + 1}: colspan=${m[1]} แต่หัวมี ${th}`);
    }
  });
  ok('แท็บ ' + tab + ' — colspan ของแถวว่างเท่ากับจำนวนหัวคอลัมน์',
     tables.length > 0 && bad.length === 0, bad.join(' · '));
}


console.log('\n=== Q. เทียบยอดที่ Delta ตัดจาก over กับของที่เรามี (เจ้าของ 22 ก.ย. 2026) ===');
// ⚠️ ต้องจับคู่ด้วยรหัส ไม่ใช่ PO — ของเกินเกิดจาก PO ใบเก่า แต่ Delta ตัดตอนจ่ายของให้ PO ใบใหม่
const cuts = [
  { po: 'TM9269H001', code: '9000000001', issue: 2, date: '2026-09-22', src: 'chemover' },
  { po: 'TM9269H002', code: '9000000001', issue: 1, date: '2026-09-22', src: 'chemover' },
  { po: 'TM9269H003', code: '9000000002', issue: 5, date: '2026-09-22', src: 'chemover' },
  { po: 'TM4269U001', code: '9000000001', issue: 9, date: '2026-09-22', src: 'chemover' },  // คนละโรงงาน
  { po: 'PO-เก่า',     code: '9000000001', issue: 7, date: '2026-09-22', src: 'chemover' }   // อ่านเลขไม่ออก
];
const pend = [{ po: 'TM9269H900', code: '9000000001', over: 3 }];
const tickets = [
  { id: 'F1', kind: 'over', entity: 'TUE-H', po: 'TM9269H901', code: '9000000001', qty: 2, done_qty: 1 },
  { id: 'F2', kind: 'over', entity: 'TUE-U', po: 'TM4269U900', code: '9000000001', qty: 8, done_qty: 0 },
  { id: 'F3', kind: 'over', entity: 'TUE-H', po: 'TM9269H902', code: '9000000002', qty: 4, done_qty: 4 },
  { id: 'F4', kind: 'over', entity: 'TUE-H', po: 'TM9269H903', code: '9000000002', qty: 6, done_qty: 0, voided: true }
];
const m = overCutMatch(cuts, { pending: pend, follows: tickets, entity: 'TUE-H' });

ok('รวมยอดที่ตัดรายรหัส ข้าม PO ให้', m.rows.find(r => r.code === '9000000001').cut === 3,
   JSON.stringify(m.rows));
ok('บอกด้วยว่ามาจาก PO ไหนบ้าง กี่บรรทัด',
   m.rows.find(r => r.code === '9000000001').pos.length === 2
   && m.rows.find(r => r.code === '9000000001').lines === 2);
// ของที่เรามี = ที่ยังไม่ตั้งเรื่อง (3) + ที่ตั้งแล้วยังค้าง (2-1=1) = 4
ok('ของเกินที่เรามี รวมทั้งที่ยังไม่ตั้งเรื่องและที่ตั้งแล้วยังคืนไม่หมด',
   m.rows.find(r => r.code === '9000000001').have === 4,
   String(m.rows.find(r => r.code === '9000000001').have));
ok('ต่างกันเท่าไหร่ คิดจาก ของที่เรามี − ที่ Delta ตัด',
   m.rows.find(r => r.code === '9000000001').diff === 1);
ok('เรื่องที่ปิดแล้วกับที่ถูกยกเลิก ไม่นับเป็นของที่เรามี',
   m.rows.find(r => r.code === '9000000002').have === 0
   && m.rows.find(r => r.code === '9000000002').diff === -5);
// A3 — ข้อสำคัญที่สุดในหมวดนี้
ok('แถวของอีกโรงงานไม่ถูกนับมารวม (A3)',
   m.rows.find(r => r.code === '9000000001').cut === 3 && m.lines === 3, String(m.lines));
ok('เรื่องของอีกโรงงานก็ไม่ถูกนับเป็นของที่เรามี (A3)',
   m.rows.find(r => r.code === '9000000001').have === 4);
ok('แถวที่อ่านนิติบุคคลจากเลขที่ PO ไม่ได้ ต้องนับแยกไว้บอก ไม่ใช่เททิ้งเงียบ',
   m.unreadable === 1, String(m.unreadable));
ok('ไม่มีนิติบุคคล = ไม่ตอบ ไม่ใช่รวมทุกโรงงาน (A3)',
   overCutMatch(cuts, { pending: pend, follows: tickets }).rows.length === 0);
ok('เรียงเอาคู่ที่ต่างกันมากที่สุดขึ้นก่อน',
   m.rows[0].code === '9000000002', JSON.stringify(m.rows.map(r => r.code + ':' + r.diff)));
ok('บอกวันที่ของรอบที่เทียบ และรอบทั้งหมดที่มีในเครื่อง',
   m.date === '2026-09-22' && m.dates.join(',') === '2026-09-22', m.date + ' / ' + m.dates.join(','));
// เลือกดูรอบเก่าได้ ไม่งั้นข้อมูลที่เก็บไว้ก็ไม่มีประโยชน์
const two = overCutMatch([...cuts, { po: 'TM9269H001', code: '9000000001', issue: 4, date: '2026-09-15' }],
                         { pending: [], follows: [], entity: 'TUE-H', date: '2026-09-15' });
ok('เลือกดูเฉพาะรอบที่ต้องการได้', two.rows.length === 1 && two.rows[0].cut === 4,
   JSON.stringify(two.rows));
// ⚠️ ในเครื่องมีหลายรอบคือเคสปกติ (เก็บไว้กลับมาดูทีหลังได้)
// "ไม่ระบุรอบ" ต้องหมายถึงรอบล่าสุด ไม่ใช่รวมทุกรอบมากองเดียวแล้วติดป้ายว่าเป็นรอบล่าสุด
const rounds = [
  { po: 'TM9269H001', code: '9000000001', issue: 2, date: '2026-09-22', src: 'chemover' },
  { po: 'TM9269H001', code: '9000000001', issue: 1, date: '2026-09-15', src: 'chemover' }
];
const last = overCutMatch(rounds, { entity: 'TUE-H' });
ok('ไม่ระบุรอบ = เอาเฉพาะรอบล่าสุด ไม่ใช่รวมทุกรอบมากองเดียว',
   last.rows.length === 1 && last.rows[0].cut === 2 && last.lines === 1,
   JSON.stringify(last.rows) + ' / ' + last.lines);
ok('วันที่ที่คืนต้องเป็นรอบเดียวกับยอดที่คืน', last.date === '2026-09-22', last.date);
// เลือกรอบเก่าแล้วต้องกลับไปรอบล่าสุดได้ — ช่องเลือกรอบอ่านจาก dates
const older = overCutMatch(rounds, { entity: 'TUE-H', date: '2026-09-15' });
ok('เลือกรอบเก่าแล้ว รอบอื่นต้องยังอยู่ในรายการรอบครบ',
   older.dates.join(',') === '2026-09-22,2026-09-15' && older.rows[0].cut === 1,
   older.dates.join(',') + ' / ' + JSON.stringify(older.rows));
ok('ไม่มีอะไรเลยก็ไม่พัง',
   overCutMatch([], { entity: 'TUE-H' }).rows.length === 0
   && overCutMatch(null, { entity: 'TUE-H' }).lines === 0);

// ⚠️ PO ที่รูปแบบถูกแต่ตัวอักษรโรงงานไม่มีในทะเบียน เคยหายไปเงียบทั้งแถว (ผู้ตรวจ #101)
// เครื่องมือที่มีหน้าที่ตอบว่า "ตรงกับที่ Delta แจ้งไหม" ห้ามทิ้งแถวโดยไม่บอก
const odd = [
  { po: 'TM9269H001', code: '9000000001', issue: 2, date: '2026-09-22' },
  { po: 'TM9269G001', code: '9000000001', issue: 5, date: '2026-09-22' },   // G ไม่มีในทะเบียน
  { po: 'อ่านไม่ออก',   code: '9000000001', issue: 9, date: '2026-09-22' }
];
const withReg = overCutMatch(odd, { entity: 'TUE-H', known: ['TUE-H', 'TUE-U'] });
ok('รหัสที่เดาได้แต่ไม่มีในทะเบียน ถูกนับแยกไว้บอก ไม่ใช่หายเงียบ',
   withReg.unregistered === 1 && withReg.unreadable === 1 && withReg.rows[0].cut === 2,
   JSON.stringify({ u: withReg.unregistered, r: withReg.unreadable }));
ok('ส่งทะเบียนมาแล้ว ยอดของโรงงานที่ไม่มีในทะเบียนต้องไม่ปนเข้ามา',
   withReg.rows.length === 1 && withReg.lines === 1);
ok('ไม่ส่งทะเบียนมา = ไม่เช็ก (พฤติกรรมเดิม ไม่พัง)',
   overCutMatch(odd, { entity: 'TUE-H' }).unregistered === 0);

/* ⚠️ เส้นทางจริงทั้งสาย overAll → overPending → overCutMatch (ผู้ตรวจ #102 รอบ 1)
 *    ไฟล์กลุ่มจ่ายรวมเป็นเคมี ยอดต่ำกว่า 1 หน่วยคือค่าปกติ
 *    ถ้าฝั่งเราคิดด้วยเพดาน OVER_MIN ของเกินก้อนนั้นหายไปก่อนถึงการ์ด
 *    แล้วการ์ดขึ้นแถบแดง "เรามีน้อยกว่า" ทั้งที่ยอดตรงกันเป๊ะ */
const CHEM = '9000000001', CPO = 'TM9269H001';
const chemBook = [{ id: 'EC1', entity: 'TUE-H', kind: 'receive', material_code: CHEM,
                    qty: 100.062, doc_ref: CPO, at: '2026-09-01T03:00:00.000Z', voided: false }];
const chemCut = [{ po: CPO, code: CHEM, issue: 0.062, date: '2026-09-22', src: 'chemover' }];
const chainOf = min => overCutMatch(chemCut, {
  entity: 'TUE-H', known: ['TUE-H'], follows: [],
  pending: overPending(
    overAll(chemBook, 'TUE-H', { headerOf: po => po === CPO ? { pn: PN, order: 100 } : null,
                                 usageOf: (pn, code) => (pn === PN && code === CHEM) ? 1 : null,
                                 min }).filter(r => !r.why), [])
}).rows[0];
ok('ของเกิน 0.062 ที่ยังไม่ได้ตั้งเรื่อง เทียบกับที่ Delta ตัด 0.062 แล้วต้องตรงพอดี',
   chainOf(0).have === 0.062 && chainOf(0).diff === 0, JSON.stringify(chainOf(0)));
ok('คิดด้วยเพดาน OVER_MIN แล้วของก้อนนี้หายทั้งก้อน — เหตุผลที่การ์ดต้องใช้ min: 0',
   chainOf(OVER_MIN).have === 0 && chainOf(OVER_MIN).diff === -0.062,
   JSON.stringify(chainOf(OVER_MIN)));

console.log('\n=== R. ของขาดที่คิดจากการรับเข้า (เจ้าของสั่ง 28 ก.ย. 2026) ===');
{
  const E = 'TUE-H';
  const heads = { TM9269H001: { pn: 'PN1', order: 10 }, TM9269H002: { pn: 'PN1', order: 5 }, TM9269H009: { pn: '', order: 3 } };
  const boms = { PN1: [{ code: 'A', usage: 2 }, { code: 'B', usage: 1 }, { code: 'C', usage: 0.5 }] };
  const opt = { headerOf: po => heads[po], bomRowsOf: pn => boms[pn] || [] };
  const en = (kind, po, code, qty, x = {}) => ({ id: po + code + kind + qty, entity: E, kind, doc_ref: po,
                                                  material_code: code, qty, voided: false, ...x });
  const led = [
    en('receive', 'TM9269H001', 'A', 12),                // A ต้องการ 20 ได้ 12 → ขาด 8
    en('receive', 'TM9269H001', 'B', 10),                // B ครบ
    en('receive', 'TM9269H001', 'B', 3),                 // B เกิน — ไม่ขาด
    en('sendback', 'TM9269H001', 'B', 5),                // คืน 5 → เหลือ 8 → ขาด 2
    en('receive', 'TM9269H001', 'A', 50, { voided: true }),   // ยกเลิกแล้ว ไม่นับ
    en('receive', 'TM9269H001', 'A', 50, { entity: 'TUE-U' }), // คนละนิติบุคคล ไม่นับ (A3)
    en('receive', 'TM9269H009', 'A', 1)                  // ไม่รู้ P/N
    // TM9269H002 ไม่มีรับเข้าเลย → ไม่คิด (เจ้าของเคาะ)
  ];
  const sa = shortAll(led, E, opt);
  const f = (rows, po, c) => rows.find(r => r.po === po && r.code === c);
  ok('ขาด = ตามสูตร − รับแล้ว', f(sa, 'TM9269H001', 'A') && f(sa, 'TM9269H001', 'A').short === 8);
  ok('หักยอดที่ส่งคืนแล้ว', f(sa, 'TM9269H001', 'B') && f(sa, 'TM9269H001', 'B').short === 2);
  ok('รหัสในสูตรที่ยังไม่ได้รับเลย นับว่าขาดทั้งหมด', f(sa, 'TM9269H001', 'C') && f(sa, 'TM9269H001', 'C').short === 5);
  ok('PO ที่ยังไม่มีการรับเข้าเลย ไม่คิด', !sa.some(r => r.po === 'TM9269H002'));
  ok('PO ที่คิดไม่ได้ ขึ้นแถวเดียวพร้อมเหตุผล ไม่หายเงียบ',
     sa.filter(r => r.po === 'TM9269H009').length === 1 && /P\/N/.test(f(sa, 'TM9269H009', '').why));
  // เจ้าของเคาะ 28 ก.ย. 2026 หลังรีวิว #115 — short นับทุกยอดที่ขาด (เคมียอดตามสูตรต่ำกว่า 1 หน่วยเป็นปกติ)
  ok('ค่าตั้งต้น — นับทุกยอดที่ขาดมากกว่าศูนย์ แม้ไม่ถึง 1 หน่วย', SHORT_MIN === 0
     && shortAll([en('receive', 'TM9269H001', 'A', 19.5), en('receive', 'TM9269H001', 'B', 10), en('receive', 'TM9269H001', 'C', 5)], E, opt)
          .map(r => r.code + ':' + r.short).join() === 'A:0.5');
  ok('รหัสที่รับครบพอดี ไม่คืนออกมา (ขาด 0 ไม่นับ)',
     !shortAll([en('receive', 'TM9269H001', 'A', 20), en('receive', 'TM9269H001', 'B', 10), en('receive', 'TM9269H001', 'C', 5)], E, opt)
       .some(r => !r.why));
  ok('ส่ง min มาเองได้', shortAll([en('receive', 'TM9269H001', 'A', 19.5)], E, { ...opt, min: 1 }).map(r => r.code).join() === 'B,C');
  ok('all: true คืนทุกรหัสในสูตร รวมที่ไม่ขาด', shortAll([en('receive', 'TM9269H001', 'C', 5)], E, { ...opt, all: true })
       .map(r => r.code + r.short).join() === 'A20,B10,C0');
  throws('ไม่บอกนิติบุคคล = โยน (A3)', () => shortAll(led, '', opt), 'A3');
  // ต้องได้ผลเดียวกับ shortOfPo ที่ใช้อยู่ในกล่องคืนของ (เงื่อนไขการนับต้องตรงกันเป๊ะ)
  ok('ตรงกับ shortOfPo ทุกรหัส', shortOfPo(led, E, 'TM9269H001', opt)
       .every(m => f(sa, 'TM9269H001', m.code) && f(sa, 'TM9269H001', m.code).short === m.miss));

  const tickets = [makeFollow({ kind: 'short', type: 'ขาด', entity: E, po: 'TM9269H001', code: 'A', qty: 8, source: 'delta' }),
                   { ...makeFollow({ kind: 'short', type: 'ขาด', entity: E, po: 'TM9269H001', code: 'B', qty: 3 }), done: true }];
  const pend = shortPending(sa.filter(r => !r.why), tickets);
  ok('คู่ที่มีเรื่องเปิดอยู่ (รวมที่ Delta แจ้ง) ไม่ขึ้นซ้ำ · เรื่องที่ปิดแล้วยอดต่างจากตอนนี้ ไม่กัน (ขาดเพิ่มจริง)',
     !pend.some(r => r.code === 'A') && pend.some(r => r.code === 'B') && pend.some(r => r.code === 'C'));
  // เจ้าของเคาะ 6 ต.ค. 2026 — ปิดเรื่องแล้วยอดที่คิดได้ยังเท่าเดิม ห้ามขึ้นให้ตั้งซ้ำ
  //   (ของที่ส่งมาแทนรับเข้าด้วย PO อื่น ยอดขาดของ PO เดิมจึงยังอยู่ — ชีตจริงมีเรื่องซ้ำแบบนี้ราว 365 คู่)
  const closedSame = { ...makeFollow({ kind: 'short', type: 'ขาด', entity: E, po: 'TM9269H001', code: 'B', qty: 2 }), done: true };
  ok('เรื่องที่ปิดแล้ว ยอดเท่าที่คิดได้ตอนนี้ — กัน ไม่ขึ้นซ้ำ',
     !shortPending(sa.filter(r => !r.why), [closedSame]).some(r => r.code === 'B'));
  ok('ปิดด้วยยอดรับครบ (done_qty ถึง qty) ก็นับว่าปิด — กันเหมือนกัน',
     !shortPending(sa.filter(r => !r.why), [{ ...closedSame, done: false, done_qty: 2 }]).some(r => r.code === 'B'));
  ok('ยอดที่วิ่งผ่านชีตมาเพี้ยนทศนิยม (2.0000001) ยังนับว่าเท่ากัน',
     !shortPending(sa.filter(r => !r.why), [{ ...closedSame, qty: 2.0000001 }]).some(r => r.code === 'B'));
  ok('เรื่องที่ยกเลิก ไม่กัน — ยังตั้งเรื่องใหม่ได้',
     shortPending(sa.filter(r => !r.why), [{ ...closedSame, voided: true }]).some(r => r.code === 'B'));
  ok('เรื่องที่ปิดแล้วแต่ไม่มียอด (qty 0 · เรื่องรอส่ง) ไม่กัน — ไม่มียอดให้เทียบ',
     shortPending(sa.filter(r => !r.why), [{ ...closedSame, qty: 0 }]).some(r => r.code === 'B'));
  ok('ปิดหลายรอบ — ยอดตรงกับรอบไหนก็กัน',
     !shortPending(sa.filter(r => !r.why), [{ ...closedSame, qty: 7 }, closedSame]).some(r => r.code === 'B'));
  ok('เรื่องของ PO อื่นที่รหัสเดียวกัน ไม่กันคู่นี้',
     shortPending(sa.filter(r => !r.why), [{ ...closedSame, po: 'TM9269H002' }]).some(r => r.code === 'B'));

  const all0 = shortAll(led, E, { ...opt, all: true });
  ok('เทียบกับยอดที่ Delta แจ้ง — ตรง', JSON.stringify(shortCheckOf(tickets[0], all0)) === JSON.stringify({ calc: 8, why: '', same: true }));
  ok('เทียบ — ต่าง', shortCheckOf({ po: 'TM9269H001', code: 'C', qty: 3 }, all0).same === false
     && shortCheckOf({ po: 'TM9269H001', code: 'C', qty: 3 }, all0).calc === 5);
  /* เรื่องประเภท "รอส่ง" ที่แกะจากไฟล์ PO มี qty = 0 โดยการออกแบบ (Delta บอกแค่ว่ายังไม่ส่ง ไม่บอกจำนวน)
     ช่อง "ที่แจ้งมา" ของแถวพวกนั้นเป็น — จึงไม่มียอดให้เทียบ ห้ามตีเป็น "ต่าง" */
  ok('เรื่องที่ไม่ได้แจ้งจำนวนมา (รอส่ง qty 0) ไม่ได้ป้าย "ต่าง" — same เป็น null',
     shortCheckOf({ kind: 'short', type: 'รอส่ง', entity: E, po: 'TM9269H001', code: 'A', qty: 0, done: false }, all0).same === null
     && shortCheckOf({ po: 'TM9269H001', code: 'A', qty: 0 }, all0).calc === 8,
     JSON.stringify(shortCheckOf({ po: 'TM9269H001', code: 'A', qty: 0 }, all0)));
  ok('คอลัมน์ "ระบบคิดได้" ขึ้นป้าย ตรง/ต่าง เฉพาะเมื่อ same ไม่ใช่ null',
     /same !== null/.test(htmlSrc.split('ระบบคิดได้')[1].slice(0, 1200)));

  ok('เทียบ — PO ยังไม่มีรับเข้า / ไม่มีในสูตร / คิดไม่ได้ บอกเหตุผล',
     /ยังไม่มีการรับเข้า/.test(shortCheckOf({ po: 'TM9269H002', code: 'A', qty: 1 }, all0).why)
     && /ไม่มีรหัสนี้ในสูตร/.test(shortCheckOf({ po: 'TM9269H001', code: 'Z', qty: 1 }, all0).why)
     && /P\/N/.test(shortCheckOf({ po: 'TM9269H009', code: 'A', qty: 1 }, all0).why));

  // ผู้ตรวจ #115 ข้อ 3 — ทุกกิ่งที่ไม่มียอดให้เทียบต้องเป็น same: null ไม่ใช่ false ("แจ้งมาแล้วไม่ตรง")
  ok('คิดไม่ได้ / ไม่มีในสูตร / ยังไม่มีรับเข้า / ไม่มี PO → same เป็น null ทุกกิ่ง',
     [{ po: 'TM9269H009', code: 'A', qty: 1 }, { po: 'TM9269H001', code: 'Z', qty: 1 },
      { po: 'TM9269H002', code: 'A', qty: 1 }, { po: '', code: 'A', qty: 1 }]
       .every(x => shortCheckOf(x, all0).same === null && shortCheckOf(x, all0).calc === null));
  ok('ตัวเทียบแบบทำดัชนีครั้งเดียว ให้ผลเท่ากับเรียกทีละครั้ง',
     (() => { const c = shortChecker(all0);
              return [tickets[0], { po: 'TM9269H001', code: 'C', qty: 3 }, { po: 'TM9269H002', code: 'A', qty: 1 }]
                .every(x => JSON.stringify(c(x)) === JSON.stringify(shortCheckOf(x, all0))); })());
  const rec = fromShortRow(f(sa, 'TM9269H001', 'C'), { entity: E, person: 'สมชาย', unit: 'KGM', date: '2026-09-28' });
  ok('ตั้งเรื่องขาด — ประเภทขาด · ที่มา auto · แช่แข็งยอดสั่ง/ตามสูตร/รับแล้ว',
     rec.kind === 'short' && rec.type === 'ขาด' && rec.source === 'auto' && rec.qty === 5
     && rec.order_qty === 10 && rec.bom_qty === 5 && rec.recv_qty === 0 && rec.part_no === 'PN1' && rec.date === '2026-09-28');
  throws('แถวที่คิดไม่ได้ ตั้งเรื่องไม่ได้', () => fromShortRow(f(sa, 'TM9269H009', ''), { entity: E }), 'คำนวณ');
}

console.log('\n=== S. Short / Over บน Bin Card (เจ้าของสั่ง 28 ก.ย. 2026) ===');
{
  const heads = { PA: { pn: 'PN1', order: 10 }, PB: { pn: 'PN1', order: 8 }, PX: { pn: '', order: 1 } };
  const use = (pn, code) => (pn === 'PN1' && code === 'M' ? 1 : null);
  const opt = { headerOf: po => heads[po], usageOf: use };
  // ตัวอย่างเดียวกับที่ถามเจ้าของ: PO A ตามสูตร 10 · PO B ตามสูตร 8
  const rows = [
    { kind: 'receive', doc_ref: 'PA', material_code: 'M', qty: 6 },
    { kind: 'receive', doc_ref: 'PB', material_code: 'M', qty: 8 },
    { kind: 'receive', doc_ref: 'PA', material_code: 'M', qty: 5 },
    { kind: 'issue', doc_ref: 'PA', material_code: 'M', qty: 3 },
    { kind: 'sendback', doc_ref: 'PA', material_code: 'M', qty: 1 },
    { kind: 'receive', doc_ref: 'PX', material_code: 'M', qty: 2 },
    { kind: 'receive', doc_ref: '', material_code: 'M', qty: 2 }
  ];
  const so = cardShortOver(rows, opt).map(x => (x.short ?? '-') + '/' + (x.over ?? '-'));
  ok('สะสมราย PO: A6→ขาด4 · B8→ครบ · A+5→เกิน1 · จ่ายออก→- · ส่งคืน A1→ครบ',
     so.slice(0, 5).join(' ') === '4/- -/- -/1 -/- -/-', so.join(' '));
  ok('PO ที่คิดไม่ได้ / ไม่มีเลข PO → "-"', so[5] === '-/-' && so[6] === '-/-');
  ok('ยาวเท่าแถวการ์ด', cardShortOver(rows, opt).length === rows.length);
  throws('ไม่ส่งตัวช่วยมา = โยน', () => cardShortOver(rows), 'headerOf');

  const E = 'TUE-H';
  const calc = shortAll([
    { entity: E, kind: 'receive', doc_ref: 'PA', material_code: 'M', qty: 12, voided: false },
    { entity: E, kind: 'receive', doc_ref: 'PB', material_code: 'M', qty: 3, voided: false },
    { entity: E, kind: 'receive', doc_ref: 'PC', material_code: 'Q', qty: 1, voided: false }
  ], E, { headerOf: po => ({ PA: { pn: 'PN1', order: 10 }, PB: { pn: 'PN1', order: 8 }, PC: { pn: 'PN2', order: 1 } })[po],
          bomRowsOf: pn => (pn === 'PN1' ? [{ code: 'M', usage: 1 }] : [{ code: 'Q', usage: 1 }]), all: true });
  const tk = makeFollow({ kind: 'short', type: 'ขาด', entity: E, po: 'PB', code: 'M', qty: 5 });
  const sum = codeShortOver(calc, 'm', [tk]);
  ok('สรุปราย PO ของรหัสเดียว — ทุก PO ที่มีรหัสในสูตรและเริ่มรับ (PC ไม่มีรหัสนี้ในสูตร ไม่ขึ้น)',
     sum.map(r => r.po + ':' + r.short + '/' + r.over).join() === 'PA:0/2,PB:5/0', JSON.stringify(sum));
  ok('แนบเรื่องที่เปิดอยู่ของคู่นั้น', sum[1].follow && sum[1].follow.id === tk.id && sum[0].follow === null);
  ok('ไม่มีรหัส = ว่าง', codeShortOver(calc, '').length === 0);

  /* ⚠️ ส่งคืนมากกว่ารับ (ใบรับเข้าถูกยกเลิกทีหลัง) ต้องไม่ทำให้ขาดเกินยอดทั้งใบ
   * และต้องตรงกับหน้า Mat Follow up ของข้อมูลชุดเดียวกัน (ผู้ตรวจ #117 รอบ 1 ข้อ 2) */
  const negOpt = { headerOf: po => ({ PA: { pn: 'PN1', order: 10 } })[po], usageOf: (pn, c) => (pn === 'PN1' && c === 'M' ? 1 : null) };
  const negRows = [
    { kind: 'receive', doc_ref: 'PA', material_code: 'M', qty: 1 },
    { kind: 'sendback', doc_ref: 'PA', material_code: 'M', qty: 5 }
  ];
  const neg = cardShortOver(negRows, negOpt);
  const negCalc = shortAll([{ entity: E, kind: 'receive', doc_ref: 'PA', material_code: 'M', qty: 1, voided: false },
                            { entity: E, kind: 'sendback', doc_ref: 'PA', material_code: 'M', qty: 5, voided: false }], E,
                           { headerOf: negOpt.headerOf, bomRowsOf: () => [{ code: 'M', usage: 1 }] });
  ok('ส่งคืนมากกว่ารับ → ขาดไม่เกินยอดตามสูตร และแถวสุดท้ายตรงกับ shortAll ชุดเดียวกัน',
     neg[1].short === 10 && neg[1].over === null && negCalc[0].short === 10,
     JSON.stringify(neg) + ' vs ' + JSON.stringify(negCalc));
  // ใบรับเข้าถูกยกเลิกไปแล้ว — cardRows กรองออก เหลือแต่แถวส่งคืน
  ok('เหลือแต่แถวส่งคืน (ใบรับเข้าถูกยกเลิก) → ขาดเท่ายอดตามสูตร ไม่ใช่ 15',
     cardShortOver([negRows[1]], negOpt)[0].short === 10, JSON.stringify(cardShortOver([negRows[1]], negOpt)));
  ok('ยอดสะสมยังเก็บตามจริง — รับเพิ่ม 6 หลังติดลบ 4 ได้ขาด 8 ไม่ใช่ 4',
     cardShortOver([...negRows, { kind: 'receive', doc_ref: 'PA', material_code: 'M', qty: 6 }], negOpt)[2].short === 8);
}

console.log('\n=== O. ใบสั่งซื้อทดแทน — PO ที่เสีย · คีย์เพิ่มเอง (เจ้าของเคาะ 2 ต.ค. 2026) ===');
{
  const sc = scrap({ doc_kind: 'po', doc_ref: 'PO-OLD-1', part_no: 'PN-1' });
  const row = pendingScraps([sc], 'TUE-H', [])[0];
  ok('ของเสียที่อ้าง PO — รายการรอตั้งเรื่องพก PO กับ P/N มาด้วย', row.po === 'PO-OLD-1' && row.part_no === 'PN-1',
     JSON.stringify(row));
  const b = fromScrapRow(row, { entity: 'TUE-H', person: 'ก', unit: 'PCS' });
  ok('เรื่องซื้อจากของเสีย — po = PO เดิม · part_no ติดไป · next_po ยังว่าง',
     b.po === 'PO-OLD-1' && b.part_no === 'PN-1' && b.next_po === '' && b.scrap_entry_id === 'S1');

  const m = fromManualBuy({ entity: 'TUE-H', code: C1, qty: 3, unit: 'MTR', po: 'PO-OLD-2', part_no: 'PN-2',
                            note: '5 Roll', person: 'ก' });
  ok('ซื้อที่คีย์เอง — ไม่ต้องผูกของเสีย · source manual · รหัสเป็นตัวใหญ่',
     m.kind === 'buy' && m.source === 'manual' && m.scrap_entry_id === '' && m.code === C1.toUpperCase()
     && m.po === 'PO-OLD-2' && m.part_no === 'PN-2' && m.note === '5 Roll', JSON.stringify(m));
  ok('ซื้อที่คีย์เองไม่ถูกนับเป็นเรื่องที่ต้นเหตุหายไป', orphanBuys([sc], 'TUE-H', [m]).length === 0);
  throws('ซื้อที่คีย์เอง ไม่บอกนิติบุคคลไม่ได้ (A3)', () => fromManualBuy({ code: C1, qty: 1 }), 'A3');
  throws('ซื้อที่คีย์เอง จำนวนต้องมากกว่าศูนย์', () => fromManualBuy({ entity: 'TUE-H', code: C1, qty: 0 }), 'จำนวน');
  // ⚠️ ยกเว้นเฉพาะ manual — เรื่องที่ระบบตั้ง (auto) ไม่ผูกของเสีย = ตั้งซ้ำได้โดยไม่รู้ตัว
  throws('เรื่องซื้อที่ไม่ใช่คีย์เอง ยังต้องผูกรายการของเสีย',
         () => makeFollow({ kind: 'buy', entity: 'TUE-H', code: C1, qty: 1, source: 'auto' }), 'ต้องระบุ');

  const appSrc = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('ปุ่มไปรับของเติม PO จาก next_po (PO ใหม่) ไม่ใช่ po (PO เดิมที่ของเสียเกิด)',
     /if \(row\.next_po && !inH\.po\) inH\.po = row\.next_po;/.test(appSrc) && !/inH\.po = row\.po;/.test(appSrc));
  ok('หน้าของเสียเขียน PO ลง doc_ref เฉพาะชนิดของเสีย',
     appSrc.includes("...(mk.kind === 'scrap' && mk.po ? { doc_kind: 'po', doc_ref: mk.po } : {})"));
}

console.log('\n=== P. ออกใบสั่งซื้อทดแทน FM-PU-02 (เจ้าของเคาะ 2 ต.ค. 2026) ===');
{
  ok('ตัวย่อนิติบุคคล — TUE-H → H · ไม่มีขีดใช้ทั้งรหัส', entityTag('TUE-H') === 'H' && entityTag('nse') === 'NSE');
  ok('เลขใบแบบชื่อชีตเดิม "วัน.เดือน.ปี นิติบุคคล"', buyDocNo('2026-09-22', 'TUE-H') === '22.9.26 H');
  ok('วันเดียวกันออกใบที่สอง/สาม ต่อท้าย -2 -3',
     buyDocNo('2026-09-22', 'TUE-H', ['22.9.26 H']) === '22.9.26 H-2'
     && buyDocNo('2026-09-22', 'TUE-H', ['22.9.26 H', '22.9.26 H-2']) === '22.9.26 H-3');
  throws('เลขใบไม่บอกนิติบุคคลไม่ได้ (A3)', () => buyDocNo('2026-09-22', ''), 'A3');
  throws('วันที่ผิดรูปต้องบอกทางออก', () => buyDocNo('22/9/2026', 'TUE-H'), 'วันที่');

  const B = (o = {}) => ({ ...fromManualBuy({ entity: 'TUE-H', code: C1, qty: 4, unit: 'MTR', po: 'PO-A', part_no: 'PN-2' }), ...o });
  const b1 = B({ id: 'B1', code: 'Z9' }), b2 = B({ id: 'B2', code: 'A1' }),
        b3 = B({ id: 'B3', po: 'PO-B', part_no: 'PN-1' }),
        bDone = B({ id: 'B4', done: true, done_qty: 4 }), bVoid = B({ id: 'B5', voided: true }),
        bU = B({ id: 'B6', entity: 'TUE-U' }), bStamped = B({ id: 'B7', pr_no: '1.10.26 H', pr_date: '2026-10-01' });
  const all = [b1, b2, b3, bDone, bVoid, bU, bStamped];
  const pick = buyDocPick(all, 'TUE-H', all.map(x => x.id));
  ok('ใส่ในใบได้เฉพาะเรื่องที่ยังเปิด · ไม่ยกเลิก · นิติบุคคลเดียวกัน · ยังไม่ออกใบ',
     pick.rows.map(x => x.id).join() === 'B1,B2,B3' && pick.skipped.length === 4, JSON.stringify(pick.skipped));
  ok('เรื่องที่ออกใบแล้วบอกเลขใบเดิม', pick.skipped.some(x => x.id === 'B7' && x.why.includes('1.10.26 H')));
  ok('เลขใบที่ใช้ไปแล้วนับเฉพาะนิติบุคคลนี้', buyDocNos(all, 'TUE-H').join() === '1.10.26 H' && buyDocNos(all, 'TUE-U').length === 0);

  const g = buyDocGroups(pick.rows);
  ok('จัดกลุ่ม Item = P/N + PO · เรียงตาม P/N · บรรทัดในกลุ่มเรียงตามรหัส',
     g.length === 2 && g[0].part_no === 'PN-1' && g[1].part_no === 'PN-2'
     && g[1].lines.map(l => l.code).join() === 'A1,Z9', JSON.stringify(g));
  ok('จำนวนในใบ = ยอดที่ยังค้าง', g[0].lines[0].qty === 4);

  /* ── พิมพ์ใบเดิมซ้ำ ต้องได้ใบเดิม ไม่ใช่ใบตามยอดค้างวันนี้ (ผู้ตรวจ #121 รอบ 1 ข้อ 1) ── */
  const p1 = B({ id: 'P1', code: 'C1', pr_no: '2.10.26 H', pr_date: '2026-10-02', done_qty: 2 }),
        p2 = B({ id: 'P2', code: 'C2', pr_no: '2.10.26 H', pr_date: '2026-10-02', done_qty: 4, done: true }),
        p3 = B({ id: 'P3', code: 'C3', pr_no: '2.10.26 H', pr_date: '2026-10-02', voided: true }),
        p4 = B({ id: 'P4', code: 'C4', pr_no: '3.10.26 H', pr_date: '2026-10-03' }),
        p5 = B({ id: 'P5', code: 'C5', entity: 'TUE-U', pr_no: '2.10.26 H', pr_date: '2026-10-02' });
  const inDoc = buyDocRows([...all, p1, p2, p3, p4, p5], 'TUE-H', '2.10.26 H');
  ok('เรื่องในใบเลขนี้ — รวมที่ยกเลิกทีหลัง · ไม่เอาใบอื่น/นิติบุคคลอื่น',
     inDoc.map(x => x.id).join() === 'P1,P2,P3', inDoc.map(x => x.id).join());
  throws('หาเรื่องในใบ ไม่บอกนิติบุคคลไม่ได้ (A3)', () => buyDocRows(all, '', '2.10.26 H'), 'A3');
  ok('ไม่บอกเลขใบ = ไม่คืนอะไรเลย', buyDocRows(all, 'TUE-H', '').length === 0);

  const gr = buyDocGroups(inDoc, { qty: 'order' });
  ok('ใบที่พิมพ์ซ้ำใช้จำนวนที่สั่งไป ไม่ใช่ยอดค้าง — รับของแล้วจำนวนในใบไม่ขยับ',
     gr.length === 1 && gr[0].lines.map(l => l.code + '=' + l.qty).join() === 'C1=4,C2=4,C3=4',
     JSON.stringify(gr[0].lines));
  ok('ใบที่พิมพ์ซ้ำยังมีบรรทัดของเรื่องที่ยกเลิกทีหลัง และติดธงไว้ให้บอกบนใบ',
     gr[0].lines.filter(l => l.voided).map(l => l.code).join() === 'C3');
  ok('ใบที่ออกใหม่ยังใช้ยอดค้างเหมือนเดิม (ตั้งต้น remain)',
     buyDocGroups(inDoc)[0].lines.map(l => l.code + '=' + l.qty).join() === 'C1=2,C2=0,C3=4');
  const appJs = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('เส้นทางพิมพ์ซ้ำใน app.js เรียกด้วย order และใช้ buyDocRows (ตรรกะอยู่ใน master/ ไม่ใช่ app.js)',
     /buyDocRows\(shorts\.value, entity\.value, no\)/.test(appJs)
     && /buyDocFile\(no, rows\[0\]\.pr_date, rows, 'order'\)/.test(appJs));

  const st = stampBuyDoc(b1, { no: '2.10.26 H', date: '2026-10-02', now: '2026-10-02T03:00:00.000Z' });
  ok('ติดเลขใบแล้ว id / created_at ไม่ขยับ (B3) · updated_at เดินหน้า',
     st.pr_no === '2.10.26 H' && st.pr_date === '2026-10-02' && st.id === b1.id && st.created_at === b1.created_at
     && st.updated_at === '2026-10-02T03:00:00.000Z');
  throws('ติดเลขซ้ำไม่ได้ — กันสั่งของสองรอบ', () => stampBuyDoc(st, { no: 'x', date: '2026-10-02' }), 'ออกใบไปแล้ว');
  throws('ติดเลขใบได้เฉพาะเรื่องซื้อ', () => stampBuyDoc({ kind: 'short' }, { no: 'x', date: 'y' }), 'ซื้อทดแทน');
  ok('เรื่องใหม่เริ่มที่ยังไม่ออกใบ', b1.pr_no === '' && b1.pr_date === '');
}

console.log('\n=== O2. ช่อง PO ที่เสีย — ไม่ค้างค่าเดิม · dropdown แนะนำ (เจ้าของเคาะ 2 ต.ค. 2026) ===');
{
  const ents = [scrap({ id: 'a', doc_ref: 'PO-1', at: '2026-09-01T00:00:00Z' }),
                scrap({ id: 'b', doc_ref: 'PO-2', at: '2026-09-03T00:00:00Z' }),
                scrap({ id: 'c', doc_ref: 'PO-1', at: '2026-09-02T00:00:00Z' }),
                scrap({ id: 'd', doc_ref: 'PO-X', voided: true }),
                scrap({ id: 'e', doc_ref: 'PO-U', entity: 'TUE-U' }),
                recv()];
  const got = scrapPoSuggest(ents, 'TUE-H', [{ po: 'PO-9', pn: 'PN-9', date: '2026-08-01' }, { po: 'PO-1', pn: 'PN-1', date: '2026-09-01' },
                                             { po: 'PO-8', pn: 'PN-8', date: '2026-09-20' }]);
  const pos = got.map(x => x.po);
  ok('PO ที่เพิ่งคีย์ของเสียขึ้นก่อน (ใหม่สุดก่อน) แล้วต่อด้วยรายการ PO ใหม่สุดก่อน · ไม่ซ้ำ',
     pos.join() === 'PO-2,PO-1,PO-8,PO-9', pos.join());
  ok('ของเสียที่ยกเลิก / ของนิติบุคคลอื่น ไม่ถูกแนะนำ (A3)', !pos.includes('PO-X') && !pos.includes('PO-U'));
  ok('แต่ละตัวเลือกมี P/N กำกับ — จากรายการ PO ก่อน ไม่มีค่อยใช้ของในใบของเสีย (issue #26)',
     got.find(x => x.po === 'PO-1').pn === 'PN-1' && got.find(x => x.po === 'PO-8').pn === 'PN-8', JSON.stringify(got));
  ok('ตัดที่เพดาน — ไม่ล้น dropdown', scrapPoSuggest(ents, 'TUE-H', [], 1).length === 1);
  ok('ไม่มีนิติบุคคล = ไม่แนะนำอะไร', scrapPoSuggest(ents, '', [{ po: 'PO-9' }]).length === 0);
  const appSrc = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  /* ⚠️ ฟอร์ม "งานอื่น ๆ" ใช้ร่วมกันสามชนิด — ถ้าล้าง PO เฉพาะตอนบันทึกชนิด scrap
   *    คนที่พิมพ์ PO ไว้แล้วสลับไปบันทึกคืนของ/ปรับยอด จะเหลือ PO ค้างสวมของเสียใบถัดไป
   *    (ผู้ตรวจ #119 รอบ 6 ข้อ 1) → ล้างทุกครั้งที่บันทึกสำเร็จ ห้ามอยู่ใต้เงื่อนไขชนิด */
  ok('บันทึกสำเร็จแล้วล้าง PO ทุกครั้ง ไม่ใช่เฉพาะชนิดของเสีย — ไม่ค้างข้ามใบ',
     /\n\s*mk\.po = '';/.test(appSrc) && !/if \(mk\.kind === 'scrap'\)[^\n]*mk\.po/.test(appSrc));
  ok('บันทึกของเสียแล้วล้าง P/N ด้วย (ชนิดอื่นยังคงค่าไว้ตามเดิม)',
     appSrc.includes("if (mk.kind === 'scrap') { mk.part_no = ''; }"));
  ok('เพิ่มเรื่องซื้อเองแล้วล้าง PO ด้วย', appSrc.includes("Object.assign(fbm, { po: '', part_no: '', pick: {}, qty: {}, rnote: {}, extra: [] })"));
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('ช่อง PO ที่เสียมี dropdown แนะนำ', (html.match(/list="scrappolist"/g) || []).length === 2 && html.includes('id="scrappolist"'));
  ok('ป้ายเตือนขึ้นหลังออกจากช่องเท่านั้น ไม่ใช่ทุกตัวอักษร (ผู้ตรวจ #119 รอบ 2 ข้อ 2)',
     html.includes('checked.mkPo === mk.po && poUnknown(mk.po)') && html.includes('checked.fbmPo === fbm.po && poUnknown(fbm.po)'));
  // ⚠️ ป้ายโผล่ตอน @change = ตอน mousedown บนปุ่มบันทึก · ถ้าป้ายเพิ่มความสูง ปุ่มเลื่อนหนีเมาส์ก่อน mouseup แล้วคลิกไม่ติด
  //    (ผู้ตรวจ #119 รอบ 3) → จองที่ไว้เสมอ สลับแค่ visibility ห้ามใช้ v-if
  ok('ป้ายเตือน PO/รหัส จองที่ไว้ (visibility) ไม่ใช่ v-if — ปุ่มบันทึกไม่เลื่อนตอนกด',
     !/v-if="[^"]*(poUnknown\((mk|fbm)\.po\)|checked\.fbmCode)/.test(html)
     && (html.match(/:style="\{ visibility: [^"]*(poUnknown\((mk|fbm)\.po\)|checked\.fbmCode)/g) || []).length === 2);   // ช่องรหัสของแผงคีย์เองเลิกใช้ (เปลี่ยนเป็นติ๊กจาก BOM 10 ต.ค. 2026)
  ok('คอลัมน์ PO ใหม่ซ่อนไว้ก่อน (ผู้ตรวจ #119 ข้อ 1)', !html.includes("r.s.next_po || 'ยังไม่รู้'"));
}

console.log('\n=== O3. ฟังก์ชันที่เทมเพลตเรียก ต้องถูกส่งออกจาก setup ===');
{
  /* ⚠️ เทมเพลตเรียกฟังก์ชันที่ setup ไม่ได้ return = หน้าจอขาวทั้งหน้าตอนเปิดแท็บนั้น (Vue prod กลืน error)
   *    เจอจริงตอนเปิดเบราว์เซอร์ตรวจ #119 — ป้าย "ไม่มีในทะเบียน" เรียก matOf ที่ไม่ได้ส่งออก */
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const ret = app.slice(app.lastIndexOf('return {'));
  const used = [...new Set([...html.matchAll(/\b(matOf|catOf|unitOf|poUnknown|fbCanPick)\(/g)].map(m => m[1]))];
  const missing = used.filter(f => !new RegExp('\\b' + f + '\\b').test(ret));
  ok('ฟังก์ชันที่เทมเพลตเรียก (matOf · catOf · poUnknown …) ส่งออกครบ', missing.length === 0, missing.join(','));
}

console.log('\n=== T. กันกดตั้งเรื่องซ้ำ (เจ้าของสั่ง 7 ต.ค. 2026) ===');
{
  // ชีตจริง 7 ต.ค.: over เปิดค้างซ้ำ 38 คู่ (เกิน 144 เรื่อง) สร้างห่างกันไม่ถึงวินาที = กดรัว
  const busy = new Set();
  let runs = 0, release;
  const slow = () => new Promise(r => { release = r; });
  const first = startOnce(busy, 'over|PO|A', async () => { runs++; await slow(); });
  const again = await startOnce(busy, 'over|PO|A', async () => { runs++; });
  ok('กดซ้ำระหว่างที่ครั้งแรกยังบันทึกไม่เสร็จ — ไม่ทำซ้ำ คืน false', again === false && runs === 1);
  ok('ระหว่างรอ กุญแจยังจับอยู่ (ปุ่มกดไม่ได้)', busy.has('over|PO|A'));
  const other = await startOnce(busy, 'over|PO|B', async () => { runs++; });
  ok('แถวอื่นกดได้ตามปกติ ไม่ติดกุญแจของแถวแรก', other === true && runs === 2);
  release(); const done = await first;
  ok('เสร็จแล้วปลดกุญแจ กดใหม่ได้', done === true && !busy.has('over|PO|A'));
  let threw = false;
  try { await startOnce(busy, 'k', async () => { throw new Error('พัง'); }); } catch (e) { threw = e.message === 'พัง'; }
  ok('งานพัง — โยน error ต่อ และปลดกุญแจ (ไม่ติดค้างจนกดไม่ได้อีก)', threw && !busy.has('k'));

  ok('กุญแจ: short/over ใช้คู่ PO+รหัส (ไม่สนตัวพิมพ์ของรหัส) · buy ใช้เลขที่ของเสีย',
     startKey('over', { po: 'P1', code: 'a1' }) === startKey('over', { po: 'P1', code: 'A1' })
     && startKey('over', { po: 'P1', code: 'A1' }) !== startKey('short', { po: 'P1', code: 'A1' })
     && startKey('buy', { id: 'E9' }) === 'buy|E9');

  const E = 'TUE-H';
  const openOver = makeFollow({ kind: 'over', entity: E, po: 'P1', code: 'A1', part_no: 'PN', qty: 5 });
  const row = { po: 'P1', code: 'A1', pn: 'PN', over: 5, order: 10, recv: 15 };
  ok('openPairFor หาเรื่องที่เปิดอยู่ของคู่นี้เจอ', openPairFor([openOver], 'over', E, 'P1', 'a1') === openOver);
  ok('openPairFor ไม่นับเรื่องที่ปิดแล้ว · ยกเลิกแล้ว · นิติบุคคลอื่น · ชนิดอื่น',
     !openPairFor([{ ...openOver, done: true }, { ...openOver, voided: true }, { ...openOver, entity: 'TUE-U' },
                   { ...openOver, kind: 'short' }], 'over', E, 'P1', 'A1'));
  throws('ตั้งเรื่องคืนซ้ำคู่ที่เปิดอยู่ = โยน (ด่านที่สองถ้ากดซ้ำหลุดมา)',
         () => fromOverRow(row, { entity: E, follows: [openOver] }), 'เปิดอยู่แล้ว');
  ok('เรื่องเดิมปิดแล้ว ตั้งใหม่ได้', fromOverRow(row, { entity: E, follows: [{ ...openOver, done: true }] }).kind === 'over');
  ok('ไม่ส่ง follows มา = ไม่เช็ค (ของเดิมไม่พัง)', fromOverRow(row, { entity: E }).kind === 'over');
  const openShort = makeFollow({ kind: 'short', type: 'ขาด', entity: E, po: 'P1', code: 'A1', qty: 2 });
  throws('ตั้งเรื่อง short ซ้ำคู่ที่เปิดอยู่ = โยน',
         () => fromShortRow({ po: 'P1', code: 'A1', pn: 'PN', short: 2, order: 1, need: 3, have: 1 },
                            { entity: E, follows: [openShort] }), 'เปิดอยู่แล้ว');

  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('ปุ่มตั้งเรื่องทั้งสามแบบ กดไม่ได้ระหว่างบันทึก',
     ["isStarting('short', r)", "isStarting('over', r)", "isStarting('buy', r)"].every(x => html.includes(x)));
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('ทั้งสามทางเดินผ่าน startOnce และส่ง follows ให้ด่านที่สอง',
     (app.match(/await startOnce\(starting, startKey\('(short|over|buy)'/g) || []).length === 3
     && /fromShortRow\(row, \{[^}]*follows: shorts\.value/.test(app) && /fromOverRow\(row, \{[^}]*follows: shorts\.value/.test(app));
}

console.log('\n=== U. ซื้อทดแทนจาก BOM ของ PO — ติ๊กเลือกหลายรหัส (เจ้าของสั่ง 10 ต.ค. 2026) ===');
{
  const E = 'TUE-H';
  const base = { entity: E, po: 'PO-B1', part_no: 'PN-B', person: 'สมหญิง', date: '2026-10-10', at: '2026-10-10T03:00:00.000Z' };
  const a = buyFromBom({ ...base, note: 'แตก', picks: [{ code: 'a1', qty: 5, unit: 'MTR' }, { code: 'A2', qty: 2, unit: 'PCE' }] });
  ok('ติ๊ก 2 รหัส = เรื่องซื้อ 2 เรื่อง — PO ที่เสีย · P/N · หน่วย · หมายเหตุติดไป · ที่มา manual · รหัสตัวใหญ่',
     a.ok && a.recs.length === 2 && a.recs.every(r => r.kind === 'buy' && r.source === 'manual' && r.po === 'PO-B1'
       && r.part_no === 'PN-B' && r.note === 'แตก' && r.entity === E) && a.recs[0].code === 'A1' && a.recs[0].unit === 'MTR' && a.recs[0].qty === 5,
     JSON.stringify(a.errors));
  const b = buyFromBom({ ...base, picks: [{ code: 'A1', qty: 5 }, { code: 'A2', qty: null }] });
  ok('ติ๊กแล้วไม่ใส่จำนวน = ไม่เพิ่มสักเรื่อง บอกว่ารหัสไหน', !b.ok && b.recs.length === 0 && b.errors.some(e => e.code === 'A2'));
  ok('ไม่ได้ติ๊กเลย / ไม่มี PO = บอกทางออก', !buyFromBom({ ...base, picks: [] }).ok
     && /PO/.test(buyFromBom({ ...base, po: '', picks: [{ code: 'A1', qty: 1, unit: 'PCE' }] }).errors[0].why));
  throws('ไม่บอกนิติบุคคล = โยน (A3)', () => buyFromBom({ ...base, entity: '', picks: [{ code: 'A1', qty: 1, unit: 'PCE' }] }), 'A3');
  const openBuy = fromManualBuy({ entity: E, code: 'A1', qty: 3, po: 'PO-B1', part_no: 'PN-B' });
  const c = buyFromBom({ ...base, picks: [{ code: 'A1', qty: 1, unit: 'PCE' }, { code: 'A2', qty: 1, unit: 'PCE' }] }, [openBuy]);
  ok('รหัสที่มีเรื่องซื้อของ PO นี้เปิดอยู่ (ยังไม่ออกใบ) = เตือน ไม่บล็อก', c.ok && c.dup.join() === 'A1' && c.recs.length === 2);
  ok('เรื่องเดิมออกใบแล้ว / ปิดแล้ว / ยกเลิก / PO อื่น / นิติบุคคลอื่น ไม่นับว่าซ้ำ',
     ['pr_no', 'done', 'voided'].every(k => !buyFromBom({ ...base, picks: [{ code: 'A1', qty: 1, unit: 'PCE' }] },
        [{ ...openBuy, [k]: k === 'pr_no' ? '1.10.26 H' : true }]).dup.length)
     && !buyFromBom({ ...base, picks: [{ code: 'A1', qty: 1, unit: 'PCE' }] }, [{ ...openBuy, po: 'PO-X' }]).dup.length
     && !buyFromBom({ ...base, picks: [{ code: 'A1', qty: 1, unit: 'PCE' }] }, [{ ...openBuy, entity: 'TUE-U' }]).dup.length);
  /* ⚠️ ผู้เรียกคือ computed (fbmPlan) — โยน error ที่นั่น = Vue เรนเดอร์ล้ม จอหยุดอัปเดต
        ค่าพวกนี้ถึงมือพนักงานได้จริงจาก <input type="number"> (พิมพ์/วาง 1e999 ได้ตามสเปก HTML) */
  const guard = [
    ['จำนวนเป็น Infinity (พิมพ์ 1e999)', [{ code: 'A1', qty: Infinity }]],
    ['จำนวนเป็น -Infinity', [{ code: 'A1', qty: -Infinity }]],
    ['แถวที่ไม่มีรหัสวัตถุดิบ', [{ code: '', qty: 5 }]],
    ['รหัสเป็นช่องว่างล้วน', [{ code: '  ', qty: 5 }]],
  ];
  for (const [why, picks] of guard) {
    let r, thrown = '';
    try { r = buyFromBom({ ...base, picks }); } catch (err) { thrown = err.message; }
    ok(`${why} = คืน errors ไม่โยน (ผู้เรียกเป็น computed)`,
       !thrown && r && r.ok === false && r.recs.length === 0 && r.errors.length > 0, thrown);
  }
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: กาง BOM ของ P/N ให้ติ๊ก · ช่องจำนวนเปิดเมื่อติ๊ก · ปุ่มเพิ่มกันกดซ้ำ (startOnce)',
     html.includes('v-for="r in fbmRows"') && html.includes(':disabled="!fbm.pick[r.code]"')
     && /startOnce\(starting, 'buybom\|'/.test(app) && /activeBomRowsOf\(bom\.value, fbm\.part_no\)/.test(app));
}

console.log('\n=== U2. ซื้อทดแทน — รหัสนอกสูตร · ปุ่มบอกว่ากำลังเพิ่ม (เจ้าของสั่ง 10 ต.ค. 2026) ===');
{
  const base = { entity: 'TUE-H', po: 'PO-B1', part_no: 'PN-B', person: 'สมหญิง', date: '2026-10-10', at: '2026-10-10T03:00:00.000Z' };
  const a = buyFromBom({ ...base, picks: [{ code: 'A1', qty: 5, unit: 'MTR' }, { code: 'X9', qty: 2, unit: 'pce' }] });
  ok('ติ๊กจากสูตร + รหัสนอกสูตร = เรื่องซื้อครบทั้งสอง', a.ok && a.recs.map(r => r.code).join() === 'A1,X9');
  const d = buyFromBom({ ...base, picks: [{ code: 'A1', qty: 5, unit: 'MTR' }, { code: 'a1', qty: 1, unit: 'MTR' }] });
  ok('รหัสนอกสูตรซ้ำกับที่ติ๊กจากสูตร (หรือคีย์ซ้ำสองแถว) = ผิด ไม่เพิ่มสักเรื่อง', !d.ok && d.recs.length === 0 && /ซ้ำ/.test(d.errors[0].why));
  const u = buyFromBom({ ...base, picks: [{ code: 'X9', qty: 2, unit: '' }] });
  ok('รหัสนอกทะเบียนที่ไม่ได้ใส่หน่วย = ผิด บอกทางออก', !u.ok && /ใส่หน่วย/.test(u.errors[0].why));
  // ตารางสูตรไม่มีช่องหน่วยให้คีย์ ข้อความต้องบอกทางออกที่มีจริงด้วย (G3 · ผู้ตรวจ #129 ข้อ 1)
  ok('ข้อความ "ไม่มีหน่วย" บอกที่เติมหน่วยให้แถวที่มาจากสูตรด้วย', /ข้อมูลตั้งต้น → BOM/.test(u.errors[0].why));
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: แถวรหัสนอกสูตรใช้ codeSuggest · ชื่อ/หน่วยจากทะเบียน (matIndex) · พิมพ์เปลี่ยนรหัสล้างหน่วย',
     /fxSugList = computed[\s\S]{0,200}codeSuggest\(materials\.value/.test(app) && /fxMats = computed[\s\S]{0,120}matIndex/.test(app)
     && /function fxTyping\(i\) \{ const l = fbm\.extra\[i\]; if \(l\) l\.unit = ''/.test(app) && html.includes('v-for="(l, i) in fbm.extra"'));
  // แถว BOM ที่คีย์มือทีละแถวไม่บังคับหน่วย (makeManualRow) — ติ๊กแล้วต้องตั้งเรื่องได้เหมือนเดิม (ผู้ตรวจ #129 ข้อ 1)
  const reg = new Map([['A1', { material_code: 'A1', description: 'ของในทะเบียน', unit: 'MTR' }]]);
  const bomRow = makeManualRow({ pn: 'PN-B', code: 'A1', desc: '', usage: 2, by: 'สมหญิง' }, []);
  const fromBom = buyFromBom({ ...base, picks: activeBomRowsOf([bomRow], 'PN-B')
    .map(r => ({ code: normCode(r.code), qty: 4, unit: buyUnit((reg.get(normCode(r.code)) || {}).unit, r.unit) })) });
  ok('แถวจากสูตรที่หน่วยว่าง แต่ทะเบียนมีหน่วย = ตั้งเรื่องได้ · fbmRows ถอยไปเอาหน่วยจากทะเบียน (ผู้ตรวจ #129 ข้อ 1)',
     bomRow.unit === '' && fromBom.ok && fromBom.recs.length === 1 && fromBom.recs[0].unit === 'MTR'
     && /unit: buyUnit\(\(matIndex\.value\.get\(normCode\(r\.code\)\) \|\| \{\}\)\.unit, r\.unit\)/.test(app),
     JSON.stringify(fromBom.errors));
  ok('ปุ่มเพิ่มจางและบอก "กำลังเพิ่ม..." ระหว่างบันทึก (ผู้ตรวจ #128 ข้อ 3)',
     html.includes(':disabled="!fbmPlan || !fbmPlan.ok || fbmBusy"') && html.includes("กำลังเพิ่ม...")
     && /fbmBusy = computed\(\(\) => starting\.has\('buybom\|' \+ fbm\.po\)\)/.test(app));
}

console.log('\n=== W. ล้างเรื่องซ้ำที่ค้างอยู่ · over เอากลับได้ (เจ้าของสั่ง 10 ต.ค. 2026) ===');
{
  const E = 'TUE-H';
  const mk = (kind, po, code, qty, day, extra = {}) => ({ ...makeFollow({ kind, type: 'ขาด', entity: E, po, code, part_no: 'PN1',
    qty: qty || 1, by: 'ก', now: `2026-10-0${day}T03:00:00.000Z` }), ...(qty === 0 ? { qty: 0 } : {}), ...extra });
  const o1 = mk('over', 'TM9269H001', 'A1', 3, 1), o2 = mk('over', 'TM9269H001', 'A1', 3, 2), o3 = mk('over', 'TM9269H001', 'a1', 3, 3);
  const d1 = dupFollows([o3, o1, o2], { kind: 'over', entity: E });
  ok('over เปิดซ้ำยอดเท่ากัน = เก็บเรื่องที่ตั้งก่อน เสนอยกเลิกที่เหลือ (รหัสตัวพิมพ์เล็กนับเป็นคู่เดียวกัน)',
     d1.length === 2 && d1.every(d => d.twin.id === o1.id) && d1.map(d => d.row.id).sort().join() === [o2.id, o3.id].sort().join());
  const s1 = closeFollow(mk('short', 'TM9269H002', 'B1', 5, 1), { by: 'ก' }), s2 = mk('short', 'TM9269H002', 'B1', 5, 4);
  const d2 = dupFollows([s1, s2], { kind: 'short', entity: E });
  ok('short ตั้งซ้ำหลังปิดไปแล้ว ยอดเท่ากัน = เสนอยกเลิกเรื่องที่เปิดอยู่ (กฎเดียวกับ #123)',
     d2.length === 1 && d2[0].row.id === s2.id && /ที่ปิดแล้ว/.test(d2[0].why));
  ok('ยอดต่างจากเรื่องที่ปิด = ขาดเพิ่มจริง ไม่นับว่าซ้ำ',
     dupFollows([s1, mk('short', 'TM9269H002', 'B1', 7, 4)], { kind: 'short', entity: E }).length === 0);
  const p1 = closeFollow(mk('over', 'TM9269H003', 'C1', 4, 3), { qty: 1, by: 'ก' }), p0 = mk('over', 'TM9269H003', 'C1', 4, 1);
  const d3 = dupFollows([p0, p1], { kind: 'over', entity: E });
  ok('เรื่องที่มีความคืบหน้าถูกเก็บไว้เสมอ แม้ตั้งทีหลัง — เสนอยกเลิกเรื่องที่ยังไม่ได้ทำอะไร',
     d3.length === 1 && d3[0].row.id === p0.id && d3[0].twin.id === p1.id);
  const r1 = mk('over', 'TM9269H004', 'D1', 2, 1), r2 = mk('over', 'TM9269H004', 'D1', 2, 2, { return_entry_id: 'E-x' });
  ok('เรื่องที่ผูกรายการในสมุดแล้วไม่ถูกเสนอให้ยกเลิก', dupFollows([r1, r2], { kind: 'over', entity: E }).every(d => d.row.id !== r2.id));
  ok('นิติบุคคลอื่นไม่นับเป็นคู่เดียวกัน (A3) · ไม่มีนิติบุคคล = ไม่เสนออะไร',
     dupFollows([o1, { ...o2, entity: 'TUE-U' }], { kind: 'over', entity: E }).length === 0 && dupFollows([o1, o2], { kind: 'over', entity: '' }).length === 0);
  ok('เรื่องที่ยกเลิกไปแล้วไม่นับ', dupFollows([o1, { ...o2, voided: true }], { kind: 'over', entity: E }).length === 0);
  const z1 = mk('short', 'TM9269H005', 'E1', 0, 1), z2 = mk('short', 'TM9269H005', 'E1', 0, 2);
  ok('ยอด 0 เปิดซ้ำกัน = ซ้ำ · ยอด 0 ที่ปิดแล้วไม่ใช้เป็นคู่ซ้ำ',
     dupFollows([z1, z2], { kind: 'short', entity: E }).length === 1
     && dupFollows([closeFollow(z1, { by: 'ก' }), z2], { kind: 'short', entity: E }).length === 0);
  throws('ชนิด buy ไม่ได้', () => dupFollows([], { kind: 'buy', entity: E }), 'short');
  // ไฟล์ Delta อัปเดตใบแรกที่เจอ ซึ่งอาจเป็นใบที่ตั้งทีหลัง (ผู้ตรวจ #131 ข้อ 1)
  const ea = mk('short', 'TM9269H006', 'F1', 5, 1), eb = mk('short', 'TM9269H006', 'F1', 5, 2, { eta: '2026-10-20' });
  const de = dupFollows([ea, eb], { kind: 'short', entity: E });
  ok('ใบที่มี ETA ถูกเก็บไว้แม้ตั้งทีหลัง — เสนอยกเลิกใบเปล่า', de.length === 1 && de[0].row.id === ea.id && de[0].twin.id === eb.id);
  const ec = mk('short', 'TM9269H006', 'F1', 5, 2, { note: 'Delta แจ้ง 8 ต.ค.' });
  const du = dupFollows([ea, ec], { kind: 'short', entity: E });
  ok('ใบที่มีหมายเหตุจากไฟล์ Delta ถูกเก็บไว้ก่อนใบเปล่า',
     du.length === 1 && du[0].row.id === ea.id && du[0].twin.id === ec.id);
  /* ⚠️ markSynced เขียน updated_at ทับทุกแถวที่ส่งขึ้นสำเร็จ (D4 · core/sync.js)
   * ข้อมูลที่ใบนี้มาล้างซิงค์แล้วทั้งหมด → "updated_at ขยับ" ไม่ใช่ร่องรอยว่ามีใครเติมข้อมูล
   * และถ้าใช้เป็นเกณฑ์ สองเครื่องจะเสนอยกเลิกใบตรงข้ามกัน (ผู้ตรวจ #131 รอบ 3 ข้อ 1) */
  const es = { ...ea, updated_at: '2026-10-09T10:00:00.000Z' };
  const ds = dupFollows([es, eb], { kind: 'short', entity: E });
  ok('ใบเปล่าที่ซิงค์แล้ว (updated_at ถูกเขียนทับตาม D4) ไม่นับว่า "มีข้อมูลเพิ่ม" — ยังเก็บใบที่มี ETA',
     ds.length === 1 && ds[0].row.id === es.id && ds[0].twin.id === eb.id);
  const f1 = mk('short', 'TM9269H007', 'G1', 5, 1), f2 = mk('short', 'TM9269H007', 'G1', 5, 2);
  const pick = rows => { const d = dupFollows(rows, { kind: 'short', entity: E }); return d.length === 1 ? d[0].row.id : '?'; };
  ok('สองใบเปล่าที่ต่างกันแค่ว่าเครื่องไหนส่งขึ้นแล้ว = เสนอใบเดียวกันทุกเครื่อง (ใบที่ตั้งทีหลัง)',
     pick([f1, f2]) === f2.id && pick([{ ...f1, updated_at: '2026-10-09T10:00:00.000Z' }, f2]) === f2.id
     && pick([f1, { ...f2, updated_at: '2026-10-09T10:00:00.000Z' }]) === f2.id);
  ok('ความคืบหน้ายังชนะข้อมูลเพิ่มเสมอ', dupFollows([eb, closeFollow(ea, { qty: 1, by: 'ก' })], { kind: 'short', entity: E })
     .every(d => d.row.id === eb.id));

  const at = '2026-10-05T03:00:00.000Z';
  const ra = sendbackEntry(o1, { qty: 3, person: 'ก', at, reason_code: 'over' }), rb = sendbackEntry(o2, { qty: 3, person: 'ก', at, reason_code: 'over' });
  const c1 = { ...closeFollow(o1, { by: 'ก' }), return_entry_id: ra.id }, c2 = { ...closeFollow(o2, { by: 'ก' }), return_entry_id: rb.id };
  const g = doubleReturns([c1, c2], [ra, rb], { entity: E });
  ok('คู่ที่คืนไปแล้วสองเรื่อง = ขึ้นให้ตรวจ พร้อมยอดคืนรวม', g.length === 1 && g[0].total === 6 && g[0].rows.length === 2);
  ok('รายการส่งคืนที่ยกเลิกไปแล้วไม่นับ', doubleReturns([c1, c2], [ra, { ...rb, voided: true }], { entity: E }).length === 0);

  const ra2 = sendbackEntry({ ...o1, done_qty: 0 }, { qty: 1, person: 'ก', at, reason_code: 'over' });
  const c1b = { ...c1, return_entry_id: ra.id + ' ' + ra2.id };
  const u = reopenOver(c1b, [ra, ra2, rb], { by: 'หัวหน้า' });
  ok('เอากลับ = เปิดเรื่องใหม่ ล้างเลขที่ผูก · ยกเลิกรายการส่งคืนทุกรอบแบบไม่ลบ (B1) · ไม่แตะรายการของเรื่องอื่น',
     statusOf(u.rec) === 'open' && u.rec.return_entry_id === '' && u.voids.length === 2
     && u.voids.every(v => v.voided && v.void_by === 'หัวหน้า' && /over/.test(v.void_reason))
     && !u.voids.some(v => v.id === rb.id));
  ok('รายการที่ยกเลิกไปแล้ว ไม่ยกเลิกซ้ำ', reopenOver(c1b, [{ ...ra, voided: true }, ra2], { by: 'ก' }).voids.length === 1);
  throws('มีรายการให้ยกเลิกแต่ไม่มีชื่อผู้บันทึก = โยน', () => reopenOver(c1b, [ra], {}), 'ผู้บันทึก');
  ok('เรื่องที่ไม่ได้ผูกรายการ เอากลับได้โดยไม่ต้องมีชื่อ', reopenOver(closeFollow(o3, { by: 'ก' }), [], {}).voids.length === 0);
  throws('ใช้กับ short ไม่ได้', () => reopenOver(s1, [], {}), 'over');
  throws('เรื่องที่ยกเลิกแล้ว เอากลับไม่ได้', () => reopenOver({ ...c1, voided: true }, [ra], { by: 'ก' }), 'ยกเลิก');

  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: ปุ่มเอากลับของ over (ปิดแล้ว + บางส่วน) · ยกเลิกก่อนปิดเรื่องแบบเดียวกับ short',
     (html.match(/@click="foReopen\(r\.s\)"/g) || []).length === 2 && /reopenOver\(plain\(row\), entries\.value/.test(app)
     && /await db\.put\('entries', voids\)[\s\S]{0,300}await fsPut\(rec\)/.test(app));
  ok('จอ: การ์ดเรื่องซ้ำทั้งหน้า short และ over · ติ๊กไว้เป็นค่าตั้งต้น · ยกเลิกด้วย voidFollow ไม่ลบ',
     html.includes(`@click="dupVoid('short')"`) && html.includes(`@click="dupVoid('over')"`)
     && html.includes(':checked="!dupSkip[d.row.id]"') && /voidFollow\(plain\(d\.row\)/.test(app) && html.includes('v-if="foDouble.length"')
     && (html.match(/\{\{ d\.row\.eta \|\| '—' \}\}/g) || []).length === 2);
}

console.log('\n=== X. ซื้อทดแทน — หน่วยจากทะเบียนก่อน · หมายเหตุรายรหัส (เจ้าของสั่ง 10 ต.ค. 2026) ===');
{
  ok('หน่วย: ทะเบียนก่อน', buyUnit('MTR', 'ROLL') === 'MTR');
  ok('หน่วย: ทะเบียนว่าง = ใช้ของ BOM / ที่คีย์', buyUnit('', ' ROLL ') === 'ROLL' && buyUnit(undefined, '', 'pce') === 'pce');
  ok('หน่วย: ไม่มีที่ไหนเลย = ว่าง (ด่านไม่มีหน่วยของ buyFromBom จับต่อ)', buyUnit(null, '', undefined) === '');
  const base = { entity: 'TUE-H', po: 'PO-N1', part_no: 'PN-N', person: 'สมหญิง', date: '2026-10-10', at: '2026-10-10T03:00:00.000Z' };
  const r = buyFromBom({ ...base, note: 'ทั้งชุด', picks: [{ code: 'A1', qty: 2, unit: 'MTR', note: ' 5 Roll ' }, { code: 'B1', qty: 1, unit: 'pce', note: '' }] });
  ok('หมายเหตุรายรหัส ติดไปกับเรื่องของรหัสนั้น · แถวที่เว้นว่างใช้หมายเหตุของทั้งชุด',
     r.ok && r.recs[0].note === '5 Roll' && r.recs[1].note === 'ทั้งชุด', JSON.stringify(r.recs.map(x => x.note)));
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: แถวจากสูตรและแถวนอกสูตรใช้ buyUnit ทั้งคู่ · ส่ง note รายแถว',
     /unit: buyUnit\(m && m\.unit, l\.unit\), note: l\.note/.test(app) && /unit: r\.unit, note: fbm\.rnote\[r\.code\]/.test(app));
  ok('จอ: ช่องหมายเหตุทุกแถว (สูตร + นอกสูตร) · ไม่มีช่องหมายเหตุเดียวทั้ง PO แล้ว · บอกเมื่อหน่วย BOM ไม่ตรงทะเบียน',
     html.includes('v-model="fbm.rnote[r.code]"') && html.includes('v-model="l.note"') && !html.includes('v-model="fbm.note"')
     && html.includes('(BOM {{ r.bomUnit }})'));
  ok('จอ: เปลี่ยน PO / P/N / บันทึกแล้ว ล้างหมายเหตุรายแถวด้วย',
     /fbm\.pick = \{\}; fbm\.qty = \{\}; fbm\.rnote = \{\}; fbm\.extra = \[\]/.test(app) && html.includes('fbm.pick = {}; fbm.qty = {}; fbm.rnote = {}'));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
