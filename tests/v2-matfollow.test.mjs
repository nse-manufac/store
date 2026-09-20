/**
 * เทสตัวอ่านไฟล์ MAT'L FOLLOWING ของ Delta — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์
 *   node tests/v2-matfollow.test.mjs
 *
 * เลข PO · รหัสวัตถุดิบ · จำนวน ในไฟล์นี้ **สมมติขึ้นทั้งหมด** (repo นี้เป็น public)
 * รูปแบบของไฟล์จริงถูกยกมาแค่โครง — หัวตารางแถวสอง · VAR เป็นสูตร · หมายเหตุปนสามแบบ
 */
import { matDate, numOf, readNote, rowToFollow, parseMatFollow, planMatFollow, matKey, dedupeMatRows }
  from '../v2/master/matfollow.js';
import { makeFollow, closeFollow, voidFollow, statusOf, remainOf } from '../v2/master/follow.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};
const throws = (name, fn, want = '') => {
  try { fn(); ok(name, false, 'ไม่ได้โยน error'); }
  catch (e) { ok(name, !want || String(e.message).includes(want), e.message); }
};

const PO_H = 'TM9000H001', PO_H2 = 'TM9000H002', PO_U = 'TM9000U001';
const C1 = 'MC-100', C2 = 'MC-200', PN = '7001';
const head = ["MAT'L FOLLOWING", '', '', '', '', '', '', '', '', ''];
const cols = ['DATE', 'P/O', 'PN', 'CODE', 'DES.', 'P/O', 'ACTUAL', 'VAR.', 'P/O DATE', 'หมายเหตุ'];
/** หนึ่งแถวของไฟล์ — ใส่เฉพาะช่องที่สนใจ ที่เหลือปล่อยว่างเหมือนไฟล์จริง */
const line = (o = {}) => [
  o.date ?? 25413, o.po ?? PO_H, o.pn ?? PN, o.code ?? C1, o.des ?? 'Core',
  o.order ?? 100, o.actual ?? 80, o.var ?? (o.order ?? 100) - (o.actual ?? 80),
  o.note ?? '', o.note2 ?? ''
];

console.log('=== A. วันที่ — ปีในไฟล์เป็น พ.ศ. สองหลัก Excel อ่านเป็น 19xx ===');
/* ⚠️ ข้อนี้คือกับดักที่แพงที่สุดของไฟล์นี้ · ยอดถูกแต่วันที่ผิดทั้งกระดานแบบไม่มีอะไรฟ้อง */
ok('serial ของ Excel ที่ออกมาเป็นปี 1969 ต้องกลายเป็น 2026', matDate(25413) === '2026-07-29', matDate(25413));
/* ⚠️ xlsx สร้าง Date จากเซลล์เป็น "เวลาท้องถิ่นเที่ยงคืน" · ต้องอ่านด้วยตัวอ่านท้องถิ่น
 * อ่านแบบ UTC ที่ไทย (+7) จะได้วันก่อนหน้าเสมอ = ทั้งไฟล์เลื่อนไปหนึ่งวันแบบไม่มีอะไรฟ้อง
 * (เจอจริงตอนเปิดเบราว์เซอร์ทดสอบใบที่สอง) */
ok('ค่าที่ xlsx แปลงเป็น Date มาแล้ว ก็ต้องบวก 57 ปีเหมือนกัน',
   matDate(new Date(1969, 6, 29)) === '2026-07-29', matDate(new Date(1969, 6, 29)));
ok('Date ของเซลล์ต้องอ่านแบบเวลาท้องถิ่น ไม่ใช่ UTC (ไม่งั้นเลื่อนไปหนึ่งวัน)',
   matDate(new Date(1969, 6, 29, 0, 0, 0)) === '2026-07-29'
   && matDate(new Date(1969, 11, 31, 23, 0, 0)) === '2026-12-31',
   matDate(new Date(1969, 11, 31, 23, 0, 0)));
/* ⚠️ ของจริงที่ xlsx คืนมาไม่ตรงเที่ยงคืน — เซลล์ที่แสดง 29/7 ได้ Date เป็น 28/7 เวลา 23:59:56
 * อ่านตรง ๆ จะได้วันที่ 28 ทั้งไฟล์ · จับได้ตอนเปิดเบราว์เซอร์ทดสอบเท่านั้น */
ok('เศษวินาทีจากการแปลง serial ต้องถูกปัดขึ้นเป็นวันที่ถูกต้อง',
   matDate(new Date(1969, 6, 28, 23, 59, 56)) === '2026-07-29',
   matDate(new Date(1969, 6, 28, 23, 59, 56)));
ok('เศษวินาทีอีกทางก็ต้องไม่ดันวันไปข้างหน้า',
   matDate(new Date(1969, 6, 29, 0, 0, 4)) === '2026-07-29');
ok('ข้อความ 29/7/69 (พ.ศ. สองหลัก)', matDate('29/7/69') === '2026-07-29', matDate('29/7/69'));
ok('พิมพ์ พ.ศ. มาเต็มสี่หลัก 2569 ต้องลบ 543', matDate('2569-07-29') === '2026-07-29', matDate('2569-07-29'));
ok('วันที่ ค.ศ. ปกติไม่ถูกแตะ', matDate('2026-07-29') === '2026-07-29');
ok('ช่องว่างหรือข้อความมั่ว คืนค่าว่าง ไม่ใช่วันที่มั่ว',
   matDate('') === '' && matDate('ยังไม่ทราบ') === '' && matDate(null) === '');
ok('เดือนหรือวันที่เกินจริง คืนค่าว่าง', matDate('45/13/69') === '');

console.log('\n=== B. ตัวเลขกับหมายเหตุ ===');
ok('อ่านตัวเลขที่มีจุลภาคได้', numOf('1,929') === 1929 && numOf(1929) === 1929);
ok('ช่องว่างคืน null ไม่ใช่ศูนย์', numOf('') === null && numOf(null) === null);
{
  const cut = readNote('Cut Return 1,929'), over = readNote('Over 13,618'), other = readNote('M508221');
  ok('Cut Return อ่านยอดออก', cut.cut === 1929 && cut.over === null);
  ok('Over อ่านยอดออก', over.over === 13618 && over.cut === null);
  ok('หมายเหตุอื่นเก็บเป็นข้อความเฉย ๆ', other.cut === null && other.over === null && other.text === 'M508221');
}
/* ⚠️ ช่องนี้ปนสามแบบ และแบบหนึ่งคือเลขเอกสาร/ล็อต · ถ้าไปหยิบ "เลขตัวแรกที่เจอในช่อง"
 * เลขเอกสารที่พิมพ์นำหน้าจะถูกเอาไปหักออกจาก VAR แทนยอด Cut Return จริง แล้วพังเงียบสองทาง:
 * เลขใหญ่กว่า VAR → แถวของขาดหายไปทั้งแถว · เลขเล็กกว่า → หักน้อยไป แล้วไปทวง Delta เกินจริง */
{
  ok('เลขเอกสารนำหน้า Cut Return ต้องไม่ถูกหยิบมาหักแทนยอด',
     readNote('TM7001A Cut Return 500').cut === 500, JSON.stringify(readNote('TM7001A Cut Return 500')));
  ok('เลขเอกสารที่เป็นตัวเลขล้วนนำหน้า ก็ต้องไม่ถูกหยิบ',
     readNote('INV 250912 Cut Return 500').cut === 500, String(readNote('INV 250912 Cut Return 500').cut));
  ok('เลขล็อตสั้น ๆ นำหน้า ก็ต้องไม่ถูกหยิบ (หักน้อยไป = ทวงเกินจริง)',
     readNote('L5 Cut Return 500').cut === 500, String(readNote('L5 Cut Return 500').cut));
  ok('มีคำว่า Cut Return แต่ไม่มีเลขตามหลัง ยังคืน null เหมือนเดิม ไม่ใช่ศูนย์',
     readNote('Cut Return').cut === null && readNote('M508221 Cut Return').cut === null);
  ok('Over อ่านเฉพาะเลขที่ตามหลังคำว่า Over',
     readNote('Over 13,618 (M508221)').over === 13618, String(readNote('Over 13,618 (M508221)').over));
}

console.log('\n=== C. หนึ่งแถว → หนึ่งเรื่อง ===');
{
  const s = rowToFollow(line({ order: 100, actual: 80 }), { sheet: 'H-M5' });
  ok('VAR บวก = ของขาด', s.kind === 'short' && s.qty === 20, JSON.stringify(s));
  ok('นิติบุคคลมาจากเลขที่ PO ไม่ใช่ชื่อชีต', s.entity === 'TUE-H');
  ok('รหัสแอดมินของ Delta เก็บจากชื่อชีต', s.admin === 'M5' && s.sheet === 'H-M5');
  ok('เก็บยอดสั่งกับยอดที่ส่งจริงไว้ด้วย', s.order === 100 && s.actual === 80);

  const o = rowToFollow(line({ po: PO_U, order: 100, actual: 130, note: 'Over 30' }));
  ok('VAR ลบ = ของเกิน และ qty เป็นบวกเสมอ', o.kind === 'over' && o.qty === 30);
  ok('นิติบุคคลของ PO ฝั่ง U', o.entity === 'TUE-U');
  ok('หมายเหตุ Over ที่ Delta ย้ำมา ตรงกับ VAR', o.over_note === 30 && o.var_qty === -30);
}
/* ⚠️ Cut Return = ของเกินจาก PO ใบก่อนที่หักมาแล้ว · ไม่หักจะไปทวง Delta เกินจริง */
{
  const r = rowToFollow(line({ order: 301.5, actual: 0, note: 'Cut Return 290.5' }));
  ok('หัก Cut Return ออกจาก VAR ก่อนถือเป็นยอดขาด', r.qty === 11 && r.cut_return === 290.5, JSON.stringify(r));
  ok('ยอด VAR ดิบยังเก็บไว้ให้ตรวจย้อนได้', r.var_qty === 301.5);
}
{
  /* เลขเอกสารนำหน้าในช่องหมายเหตุ ต้องไม่ทำให้แถวของขาดหายไปทั้งแถว */
  const r = rowToFollow(line({ order: 100, actual: 90, note: 'TM7001A Cut Return 5' }));
  ok('แถวที่มีเลขเอกสารปนในหมายเหตุ ต้องไม่หายไปทั้งแถว',
     r && r.qty === 5 && r.cut_return === 5, JSON.stringify(r));
}
ok('ส่งมาพอดี ไม่ใช่งานตาม', rowToFollow(line({ order: 100, actual: 100 })) === null);
ok('หัก Cut Return แล้วไม่เหลือ ก็ไม่ใช่งานตาม',
   rowToFollow(line({ order: 110, actual: 100, note: 'Cut Return 10' })) === null);
ok('ไม่มีเลข PO หรือไม่มีรหัส ข้ามไป',
   rowToFollow(line({ po: '' })) === null && rowToFollow(line({ code: '' })) === null);
ok('ช่อง VAR ว่าง ข้ามไป ไม่ใช่เดาเอาจากช่องอื่น',
   rowToFollow([25413, PO_H, PN, C1, 'Core', 100, 80, '', '', '']) === null);
ok('รหัสวัตถุดิบเก็บเป็นข้อความตัวพิมพ์ใหญ่เสมอ',
   rowToFollow(line({ code: 'mc-100' })).code === C1);
ok('รหัสที่เป็นตัวเลขในไฟล์ ไม่ถูกทำให้กลายเป็นเลขทศนิยม',
   rowToFollow(line({ code: 3040061734 })).code === '3040061734');

console.log('\n=== D. ทั้งไฟล์ ===');
{
  const book = {
    'H-M5': [head, cols, line({ order: 100, actual: 80 }), ['', '', '', '', '', '', '', '', '', ''],
             line({ po: PO_H2, code: C2, order: 50, actual: 70, note: 'Over 20' })],
    'U':    [head, cols, line({ po: PO_U, order: 10, actual: 10 })],
    'H-M1': [head, cols]
  };
  const { rows, skipped } = parseMatFollow(book);
  ok('อ่านทุกชีต ข้ามสองแถวแรกของทุกชีต', rows.length === 2, JSON.stringify(rows.map(r => r.po)));
  ok('แถวว่างไม่ถูกนับเป็นของที่ข้าม', skipped.length === 1 && skipped[0].po === PO_U, JSON.stringify(skipped));
  ok('บอกเหตุผลที่ข้ามให้คนอ่านรู้เรื่อง', skipped[0].why.includes('พอดี'), skipped[0].why);
  ok('ชีตที่ไม่มีข้อมูลเลยไม่พัง', Object.keys(book).length === 3);
}

console.log('\n=== E. นำเข้าซ้ำ — ทับตัวเลข ไม่ทับความคืบหน้า ===');
const fileRows = parseMatFollow({
  'H-M5': [head, cols, line({ order: 100, actual: 80 }), line({ po: PO_H2, code: C2, order: 50, actual: 40 })]
}).rows;

{
  const plan = planMatFollow(fileRows, [], { now: '2026-09-20T03:00:00.000Z', by: 'ผู้ทดสอบ' });
  ok('รอบแรกสร้างครบทุกแถว', plan.create.length === 2 && !plan.update.length && !plan.gone.length);
  ok('เรื่องที่สร้างรู้ว่ามาจากไฟล์ของ Delta', plan.create[0].rec.source === 'delta');
  ok('ของขาดถูกตั้งประเภทให้เป็น "ขาด"', plan.create[0].rec.kind === 'short' && plan.create[0].rec.type === 'ขาด');

  const saved = plan.create.map(c => c.rec);
  const again = planMatFollow(fileRows, saved, { now: '2026-09-20T04:00:00.000Z' });
  ok('นำเข้าไฟล์เดิมซ้ำ ไม่เกิดอะไรเลย', !again.create.length && !again.update.length && again.same.length === 2);

  // พนักงานปิดไปบางส่วนแล้ว แล้วไฟล์รอบใหม่ยอดลดลง
  const touched = [closeFollow(saved[0], { qty: 5, by: 'พนักงาน' }), saved[1]];
  const newer = parseMatFollow({
    'H-M5': [head, cols, line({ order: 100, actual: 88 }), line({ po: PO_H2, code: C2, order: 50, actual: 40 })]
  }).rows;
  const p3 = planMatFollow(newer, touched, { now: '2026-09-21T03:00:00.000Z' });
  ok('ยอดใหม่ทับของเก่า', p3.update.length === 1 && p3.update[0].rec.qty === 12, JSON.stringify(p3.update[0]?.rec));
  ok('**ความคืบหน้าที่พนักงานคีย์ไว้ต้องอยู่ครบ**', p3.update[0].rec.done_qty === 5);
  ok('ยอดที่ยังค้างคิดจากยอดใหม่', remainOf(p3.update[0].rec) === 7);
  ok('id กับ created_at ไม่ขยับ (B3)',
     p3.update[0].rec.id === touched[0].id && p3.update[0].rec.created_at === touched[0].created_at);
  ok('updated_at ขยับ เพราะชั้นซิงค์ใช้ตัดสินว่าของใครใหม่กว่า (D5)',
     p3.update[0].rec.updated_at === '2026-09-21T03:00:00.000Z');

  // ยอดใหม่ต่ำกว่าที่ปิดไปแล้ว — ต้องถือว่าปิดครบ ไม่ใช่ค้างติดลบ
  const lower = parseMatFollow({ 'H-M5': [head, cols, line({ order: 100, actual: 97 })] }).rows;
  const p4 = planMatFollow(lower, touched, { now: '2026-09-21T04:00:00.000Z' });
  ok('ยอดใหม่ต่ำกว่าที่ปิดไปแล้ว = ปิดครบ ไม่ใช่ค้างติดลบ',
     p4.update[0].rec.done === true && remainOf(p4.update[0].rec) === 0, JSON.stringify(p4.update[0].rec));
}

/* ⚠️ จับคู่ด้วย นิติบุคคล+PO+รหัส+ชนิด ไม่ใช่ source
 * เครื่องรุ่นเก่าเขียน source ทับเป็น 'file' ได้ตอน migrate ถ้าไปจับด้วย source จะได้เรื่องซ้ำสองใบ */
{
  const old = makeFollow({ kind: 'short', entity: 'TUE-H', code: C1, po: PO_H, type: 'ขาด',
                           qty: 999, source: 'file' });
  const p = planMatFollow(fileRows, [old], {});
  ok('แถวเดิมที่ source ถูกเขียนทับ ยังถูกจับคู่ได้ ไม่สร้างซ้ำ',
     p.create.length === 1 && p.update.length === 1 && p.update[0].cur.id === old.id);
}
{
  const dead = voidFollow(makeFollow({ kind: 'short', entity: 'TUE-H', code: C1, po: PO_H,
                                       type: 'ขาด', qty: 999 }), { by: 'ก', reason: 'คีย์ผิด' });
  const p = planMatFollow(fileRows, [dead], {});
  ok('เรื่องที่ยกเลิกไปแล้วไม่ถูกจับคู่ · ของใหม่สร้างตามปกติ (B1)',
     p.create.length === 2 && !p.update.length);
}
{
  const mine = makeFollow({ kind: 'short', entity: 'TUE-H', code: 'MC-999', po: 'TM9000H777',
                            type: 'ขาด', qty: 3, source: 'manual' });
  const p = planMatFollow(fileRows, [mine], {});
  ok('เรื่องที่ไม่อยู่ในไฟล์รอบนี้ ขึ้นเป็น "หายจากไฟล์" ไม่ถูกลบให้',
     p.gone.length === 1 && p.gone[0].cur.id === mine.id && p.gone[0].source === 'manual');
  const done = closeFollow(mine, {});
  ok('เรื่องที่ปิดจบไปแล้ว ไม่ต้องขึ้นเตือนว่าหายจากไฟล์',
     planMatFollow(fileRows, [done], {}).gone.length === 0 && statusOf(done) === 'done');
}
ok('กุญแจจับคู่แยกของขาดกับของเกินออกจากกัน',
   matKey({ entity: 'TUE-H', po: PO_H, code: C1, kind: 'short' })
   !== matKey({ entity: 'TUE-H', po: PO_H, code: C1, kind: 'over' }));
/* ⚠️ แถวเดียวที่สร้างเรื่องไม่ได้ ห้ามทำให้ทั้งไฟล์นำเข้าไม่ได้ และห้ามเงียบ
 * ต้องบอกให้ครบว่าชีตไหน แถวไหน เพราะอะไร ไม่งั้นคนคีย์เห็นข้อความแดงบรรทัดเดียวแล้วทำอะไรต่อไม่ถูก
 * (G3 · ผู้ตรวจ #96 ข้อ 1 · เจ้าของสั่งให้แก้ 21 ก.ย. 2026) */
{
  const bad = { ...fileRows[0], entity: '', sheet: 'H-M5', line: 7 };
  const p = planMatFollow([bad, fileRows[1]], [], {});
  ok('แถวที่ไม่รู้นิติบุคคล ไม่ล้มทั้งไฟล์ — แถวที่เหลือยังนำเข้าได้',
     p.create.length === 1 && p.failed.length === 1, JSON.stringify({ c: p.create.length, f: p.failed.length }));
  ok('บอกชีต แถว และเหตุผลของแถวที่สร้างไม่ได้ (A3)',
     p.failed[0].sheet === 'H-M5' && p.failed[0].line === 7 && p.failed[0].why.includes('A3'),
     JSON.stringify(p.failed[0]));
  const noPn = { ...fileRows[0], kind: 'over', part_no: '' };
  ok('แถวของเกินที่ไม่มี P/N ก็เข้ากองเดียวกัน ไม่ใช่โยนทิ้งทั้งไฟล์',
     planMatFollow([noPn], [], {}).failed[0].why.includes('P/N'));
  ok('ไฟล์ที่ทุกแถวดี ไม่มีอะไรในกองที่สร้างไม่ได้', planMatFollow(fileRows, [], {}).failed.length === 0);
}

/* ⚠️ วันที่บนแถวคือ "วันที่ Delta แจ้งรอบล่าสุด" · ไม่อัปเดตแล้วคนจะเข้าใจว่าเรื่องนี้เงียบมานาน
 * ทั้งที่เพิ่งแจ้งมาเมื่อวาน (ผู้ตรวจ #96 ข้อ 4 · เจ้าของสั่งให้แก้ 21 ก.ย. 2026) */
{
  const first = planMatFollow(fileRows, [], { now: '2026-09-20T03:00:00.000Z' });
  const saved = first.create.map(c => c.rec);
  const moved = fileRows.map((r, i) => i === 0 ? { ...r, date: '2026-08-05' } : r);
  const p = planMatFollow(moved, saved, { now: '2026-09-21T03:00:00.000Z' });
  ok('ไฟล์ที่เปลี่ยนแค่วันที่ ต้องอัปเดตวันที่ให้',
     p.update.length === 1 && p.update[0].rec.date === '2026-08-05' && p.same.length === 1,
     JSON.stringify({ u: p.update.length, d: p.update[0]?.rec.date }));
  ok('ยอดกับความคืบหน้าไม่ถูกแตะตอนอัปเดตแค่วันที่',
     p.update[0].rec.qty === saved[0].qty && p.update[0].rec.done_qty === saved[0].done_qty);
}

console.log('\n=== F. ไฟล์แบบต่อท้าย · ไฟล์ที่ส่งมาไม่ครบทุกโรงงาน ===');
/* ⚠️ เจ้าของยังไม่แน่ใจว่า Delta ส่งใหม่ทั้งใบหรือต่อท้ายไปเรื่อย ๆ (20 ก.ย. 2026)
 * ตัวอ่านต้องถูกทั้งสองแบบ — จับคู่ด้วยกุญแจ PO+รหัส+ชนิด ไม่ได้ดูตำแหน่งแถว */
{
  const dup = parseMatFollow({ 'H-M5': [head, cols,
    line({ date: 25413, order: 100, actual: 80 }),        // ยอดเก่า ขาด 20
    line({ date: 25420, order: 100, actual: 95 })         // แถวที่ใหม่กว่า ขาดเหลือ 5
  ] }).rows;
  const { rows, dropped } = dedupeMatRows(dup);
  ok('คู่เดิมที่โผล่สองแถว เอาแถวที่วันที่ใหม่กว่า',
     rows.length === 1 && rows[0].qty === 5 && dropped === 1, JSON.stringify(rows.map(r => r.qty)));

  const tie = parseMatFollow({ 'H-M5': [head, cols,
    line({ date: 25413, order: 100, actual: 80 }),
    line({ date: 25413, order: 100, actual: 90 })
  ] }).rows;
  ok('วันที่เท่ากัน เอาแถวล่างสุด (คนพิมพ์ต่อท้ายลงไปเรื่อย ๆ)', dedupeMatRows(tie).rows[0].qty === 10);

  const plan = planMatFollow(dup, [], {});
  ok('planMatFollow ตัดแถวซ้ำให้เอง ไม่สร้างสองใบของคู่เดียวกัน',
     plan.create.length === 1 && plan.dropped === 1);
}
/* ⚠️ บางรอบ Delta อาจส่งมาไม่ครบทุกโรงงาน · ถ้าไม่จำกัดขอบเขตของ "หายจากไฟล์"
 * รอบที่ส่งมาแค่ฝั่งเดียวจะประกาศว่าอีกฝั่งหายทั้งกอง แล้วคนจะเลิกเชื่อรายการนี้ */
{
  const onlyH = parseMatFollow({ 'H-M5': [head, cols, line({ order: 100, actual: 80 })] }).rows;
  const mineU = makeFollow({ kind: 'short', entity: 'TUE-U', code: C2, po: PO_U, type: 'ขาด', qty: 9 });
  const mineH = makeFollow({ kind: 'short', entity: 'TUE-H', code: C2, po: PO_H2, type: 'ขาด', qty: 9 });
  const p = planMatFollow(onlyH, [mineU, mineH], {});
  ok('ไฟล์มาแค่ฝั่ง H — เรื่องฝั่ง U ต้องไม่ถูกหาว่าหายจากไฟล์',
     p.gone.length === 1 && p.gone[0].cur.entity === 'TUE-H',
     JSON.stringify(p.gone.map(g => g.cur.entity)));
  ok('บอกด้วยว่าไฟล์รอบนี้ครอบคลุมนิติบุคคลไหนบ้าง', p.entities.join(',') === 'TUE-H');
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
