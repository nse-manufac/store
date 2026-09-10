/**
 * เทสงานตามวัตถุดิบ — รันด้วย node
 *   node tests/v2-follow.test.mjs
 *
 * หมวด C สำคัญที่สุด — การย้ายข้อมูลเก่า
 * ของขาดที่อยู่ในเครื่องพนักงานวันนี้ไม่มีช่อง entity เลยสักแถว
 * ถ้าย้ายผิด แถวจะไปโผล่ผิดนิติบุคคลแบบเงียบ ๆ (ละเมิด INVARIANTS A3)
 * และถ้าย้ายไม่ idempotent ทุกแถวจะติดธง dirty ใหม่ทุกครั้งที่เปิดโปรแกรม
 */
import { FOLLOW_KINDS, SHORT_TYPES, SOURCES, makeFollow, migrateFollow, migrateAll,
         statusOf, remainOf, overdue, closeFollow, reopenFollow, voidFollow,
         listFollow, openFollow, orphanFollow, sumFollow }
  from '../v2/master/follow.js';

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
ok('แหล่งที่มามีสามทาง', SOURCES.join(',') === 'file,manual,auto');
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
const poList = [{ po: 'TMU001A', sub: 'tue-u', date: '2026-08-01' }];

const m1 = migrateFollow(legacy(), { poList, now: NOW });
ok('แถวเดิมที่ไม่มี kind ถือเป็นของขาด', m1.kind === 'short');
ok('แถวเดิมถือว่ามาจากไฟล์ PO', m1.source === 'file');
ok('เติมยอดที่ปิดแล้วเป็นศูนย์', m1.done_qty === 0);
ok('เติมเวลาสร้างจากวันที่ที่ไฟล์บอกไว้',
   m1.created_at === '2026-08-01T00:00:00.000Z' && m1.updated_at === '2026-08-01T00:00:00.000Z');
ok('เติมนิติบุคคลจากคอลัมน์ที่ไฟล์ PO พกมาเอง และทำเป็นตัวใหญ่',
   m1.entity === 'TUE-U', m1.entity);
ok('ไม่แต่งชื่อคนสร้างขึ้นมาเอง', !m1.created_by);
ok('ของเดิมไม่ถูกแตะ', m1.note === 'ข้อความจากไฟล์ PO' && m1.qty === 5 && m1.eta === '2026-08-05');

/* ⚠️ ข้อนี้คือหัวใจของหมวดนี้ — เดาไม่ได้ต้องปล่อยว่าง
 *    resolveEntity เดาจากรหัส PO ได้ (from === 'guess') แต่ห้ามเอามาใช้
 *    เพราะถ้าเดาผิด แถวจะหายไปจากนิติบุคคลที่เป็นเจ้าของแบบเงียบ ๆ */
const noSub = migrateFollow(legacy(), { poList: [{ po: 'TMU001A', sub: '' }], now: NOW });
ok('ไฟล์ PO ไม่ได้บอกหน่วยมา ต้องปล่อย entity ว่าง ไม่ใช่เดาจากรหัส PO — A3',
   !noSub.entity, JSON.stringify(noSub.entity));
const noPo = migrateFollow(legacy(), { poList: [], now: NOW });
ok('ไม่มีไฟล์ PO ให้เทียบเลย ก็ต้องปล่อยว่าง — A3', !noPo.entity, JSON.stringify(noPo.entity));

const m2 = migrateFollow(m1, { poList, now: NOW });
ok('ย้ายซ้ำได้ผลเดิม และคืนแถวเดิมทั้งตัว (ไม่ติดธง dirty ฟรี ๆ)', m2 === m1);
const already = makeFollow(base());
ok('แถวที่ครบแล้วต้องคืนตัวเดิม', migrateFollow(already, { poList, now: NOW }) === already);

const ticked = migrateFollow({ ...legacy(), done: true }, { poList, now: NOW });
ok('แถวที่ติ๊กไว้แล้ว ต้องไม่ถูกเปิดกลับ', ticked.done === true);
ok('แถวที่ติ๊กไว้แล้ว ยอดที่ปิดต้องเท่ากับยอดของมัน', ticked.done_qty === 5, String(ticked.done_qty));
ok('แถวที่ติ๊กไว้แล้วอ่านสถานะได้ว่าเสร็จ', statusOf(ticked) === 'done');

const keepEntity = migrateFollow({ ...legacy(), entity: 'TUE-H' }, { poList, now: NOW });
ok('แถวที่มี entity อยู่แล้ว ห้ามถูกทับด้วยค่าจากไฟล์ PO', keepEntity.entity === 'TUE-H');

const noDate = migrateFollow({ ...legacy(), date: '' }, { poList, now: NOW });
ok('แถวที่ไม่มีวันที่ ใช้เวลาปัจจุบันแทน ไม่ปล่อยว่าง', noDate.created_at === NOW);
ok('ย้ายของที่ไม่ใช่อ็อบเจกต์ต้องไม่พัง',
   migrateFollow(null) === null && migrateFollow(undefined) === undefined);

const many = migrateAll([legacy(), already, { ...legacy(), id: 'S3' }], { poList, now: NOW });
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


console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
