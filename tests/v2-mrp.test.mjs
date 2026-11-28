/**
 * เทสแท็บ MRP ราย PO — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์
 *   node tests/v2-mrp.test.mjs
 *
 * เลข PO · รหัสวัตถุดิบ · จำนวน ในไฟล์นี้ **สมมติขึ้นทั้งหมด** (repo นี้เป็น public)
 */
import { readFileSync } from 'node:fs';
import { mrpRows, mrpMatch, mrpKeep, mrpLineLabel, mrpNum, mrpNoPoIssues, fillPoDate, MRP_FILTERS, MRP_SEG, MRP_FRESH_DAYS,
         mrpOrder, planShipList, planMap, planWeek, lotWeek,
         weekKeyOf, weekNumOf, parseWeekInput, setPoWeek, poWeekMap, stockPnRows, openPoKeep, bpDiffLabel } from '../v2/master/mrp.js';
import { makeFollow, closeFollow, skipShort, cancelShort, shortAll, shortPending, OVER_MIN,
         skipOver, cancelOver, overAll, overPending, fromOverRow,
         shortSettled, overSettled, stoppedShorts, sliceKeep } from '../v2/master/follow.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};
const throws = (name, fn, want = '') => {
  try { fn(); ok(name, false, 'ไม่ได้โยน error'); }
  catch (e) { ok(name, !want || String(e.message).includes(want), e.message); }
};

const EN = 'TUE-H', TODAY = '2026-11-12';
const A = '9100000961', B = '9100000962', X = '9100000969';
const BOM = { 'PN-A': [{ code: A, usage: 2 }, { code: B, usage: 0.5 }] };
const bomRowsOf = pn => BOM[pn] || [];
const poList = [
  { po: 'TM0001H961', pn: 'PN-A', qty: 10, date: '2026-11-01' },   // ครบ
  { po: 'TM0001H962', pn: 'PN-A', qty: 10, date: '2026-11-02' },   // short B
  { po: 'TM0001H963', pn: 'PN-A', qty: 10, date: '2026-11-03' },   // over A + นอกสูตร
  { po: 'TM0001H964', pn: 'PN-A', qty: 10, date: '2026-11-04' },   // ยังไม่รับ · ใบใหม่
  { po: 'TM0001H965', pn: 'PN-A', qty: 10, date: '2026-01-05' },   // ยังไม่รับ · ใบเก่า
  { po: 'TM0001H966', pn: 'PN-Z', qty: 10, date: '2026-11-06' },   // ไม่มีสูตร
  { po: 'TM0001H967', pn: 'PN-A', qty: 10, date: '2026-11-07' },   // จบ
];
let n = 0;
const mk = (kind, po, code, qty, extra = {}) => ({ id: 'E' + (++n), entity: EN, kind, doc_ref: po, material_code: code, qty, voided: false, ...extra });
const ents = [
  mk('receive', 'TM0001H961', A, 20), mk('receive', 'TM0001H961', B, 5), mk('issue', 'TM0001H961', A, 8),
  mk('receive', 'TM0001H962', A, 20), mk('receive', 'TM0001H962', B, 4),
  mk('receive', 'TM0001H963', A, 23), mk('receive', 'TM0001H963', B, 5), mk('receive', 'TM0001H963', X, 3),
  mk('receive', 'TM0001H966', A, 7),
  mk('receive', 'TM0001H967', A, 20), mk('receive', 'TM0001H967', B, 5), mk('issue', 'TM0001H967', A, 20), mk('issue', 'TM0001H967', B, 5),
  mk('receive', 'TM0001H961', A, 999, { entity: 'TUE-U' }),        // นิติบุคคลอื่น
  mk('receive', 'TM0001H961', B, 999, { voided: true }),            // ยกเลิกแล้ว
];
const run = (o = {}) => mrpRows(o.ents || ents, EN, { poList, bomRowsOf, follows: o.follows || [], today: TODAY, ...o.opt });
const rows = run();
const at = po => rows.find(r => r.po === po);
const line = (po, code, rs = rows) => rs.find(r => r.po === po).lines.find(l => l.code === code);

console.log('=== M1. สถานะต่อใบ ===');
ok('รับครบทุกรหัส = ครบ (ok)', at('TM0001H961').state === 'ok' && at('TM0001H961').nShort === 0 && at('TM0001H961').nOver === 0);
ok('ต้องใช้ = ต่อชิ้น × จำนวนสั่ง', line('TM0001H961', A).need === 20 && line('TM0001H961', B).need === 5);
ok('รับแล้ว ไม่หักยอดจ่าย (เจ้าของเคาะ) — จ่ายไป 8 ยังรับแล้ว 20', line('TM0001H961', A).have === 20 && line('TM0001H961', A).issued === 8);
ok('รับไม่ครบ = Short 1 รายการ · ส่วนต่างติดลบ', at('TM0001H962').state === 'short' && at('TM0001H962').nShort === 1
   && line('TM0001H962', B).diff === -1 && line('TM0001H962', B).state === 'short');
ok('รับเกินตั้งแต่ OVER_MIN = Over · รหัสนอกสูตรนับเป็น Over ด้วย (เจ้าของเคาะ)',
   at('TM0001H963').state === 'over' && at('TM0001H963').nOver === 2
   && line('TM0001H963', A).state === 'over' && line('TM0001H963', X).state === 'extra' && line('TM0001H963', X).need === null,
   JSON.stringify(at('TM0001H963').lines));
ok('รหัสนอกสูตรอยู่ท้ายตาราง', at('TM0001H963').lines[at('TM0001H963').lines.length - 1].code === X);
const tiny = run({ ents: [mk('receive', 'TM0001H961', A, 20 + OVER_MIN / 2), mk('receive', 'TM0001H961', B, 5)] });
ok('เกินไม่ถึงเกณฑ์การ์ด over = ครบ (เกณฑ์เดียวกับการ์ด — เจ้าของเคาะ)', tiny.find(r => r.po === 'TM0001H961').state === 'ok');
// เจ้าของเคาะ 22 พ.ย. 2026: ขาดต่ำกว่าเกณฑ์เศษของหน่วย = ครบ (เกณฑ์เดียวกับการ์ด short)
const fracEnts = [mk('receive', 'TM0001H961', A, 19.4), mk('receive', 'TM0001H961', B, 4.9995)];
const fracTol = c => ({ [A]: 1, [B]: 0.001 })[c] || 0;
const frc = run({ ents: fracEnts, opt: { tolOf: fracTol } }).find(r => r.po === 'TM0001H961');
ok('ขาดต่ำกว่าเกณฑ์เศษ (ชิ้นขาด 0.6 · กิโลขาด 0.0005) = ครบ · ส่วนต่างยังโชว์ตามจริง',
   frc.state === 'ok' && frc.nShort === 0 && line('TM0001H961', A, [frc]).state === 'ok' && line('TM0001H961', A, [frc]).diff === -0.6,
   JSON.stringify(frc.lines));
ok('ยังไม่ได้รับรหัสนั้นเลย แม้ยอดตามสูตรไม่ถึงเกณฑ์ = ยัง Short (ผู้ตรวจ #182 รอบ 2)',
   run({ ents: [mk('receive', 'TM0001H961', A, 20)], opt: { tolOf: () => 10 } }).find(r => r.po === 'TM0001H961').lines.find(l => l.code === B).state === 'short');
ok('ไม่ส่ง tolOf = Short เหมือนเดิม', run({ ents: fracEnts }).find(r => r.po === 'TM0001H961').nShort === 2);
ok('ขาดเต็มหน่วยยังเป็น Short แม้ส่ง tolOf', run({ ents: [mk('receive', 'TM0001H961', A, 19), mk('receive', 'TM0001H961', B, 5)], opt: { tolOf: fracTol } })
   .find(r => r.po === 'TM0001H961').nShort === 1);
ok('ต่อสายเกณฑ์เศษเข้า mrpRows', /weeks: poWeekMap\(poWeeks\.value\), tolOf: fracTolAt/.test(readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8')));
ok('ใบนิติบุคคลอื่น / รายการที่ยกเลิก ไม่นับ (A3 · B)', line('TM0001H961', A).have === 20 && line('TM0001H961', B).have === 5);
throws('ไม่ระบุนิติบุคคล = โยน (A3)', () => mrpRows(ents, '', { poList, bomRowsOf }), 'A3');

console.log('=== M2. ใบไหนขึ้น ===');
ok('ใบที่ยังไม่รับของเลย แต่ใหม่ (ใน ' + MRP_FRESH_DAYS + ' วัน) = ขึ้น · Short ทุกรหัส · none',
   at('TM0001H964') && at('TM0001H964').none && at('TM0001H964').nShort === 2);
ok('ไม่มี plan: ใบเก่ากว่า ' + MRP_FRESH_DAYS + ' วัน = จบ (ซ่อนที่จอ — เจ้าของเคาะ 13 พ.ย. 2026)', at('TM0001H965') && at('TM0001H965').done === true);
ok('กฎวันของ MRP = 90 วัน (เจ้าของเคาะ 13 พ.ย. 2026)', MRP_FRESH_DAYS === 90);
const edge = d => mrpRows(ents, EN, { poList: [{ po: 'TM0001H950', pn: 'PN-A', qty: 1, date: d }], bomRowsOf, today: TODAY })[0].done;
ok('ขอบ 90 วันพอดี: วันที่ 90 ย้อนหลังยังไม่จบ · วันที่ 91 จบ', edge('2026-08-14') === false && edge('2026-08-13') === true);
ok('ใบไม่มีสูตร = คิดไม่ได้ · เหตุตรงกับ shortWhyOf · โชว์รหัสที่รับมา',
   at('TM0001H966').state === 'na' && at('TM0001H966').why.startsWith('ไม่มีสูตรของ PN-Z')
   && at('TM0001H966').lines.length === 1 && at('TM0001H966').lines[0].have === 7);
const unknown = run({ ents: [...ents, mk('receive', 'TM0001H999', A, 4)] }).find(r => r.po === 'TM0001H999');
ok('มีรับเข้าแต่ยังไม่ได้นำเข้าไฟล์ PO = ขึ้นแบบคิดไม่ได้ ไม่หายเงียบ', unknown && unknown.state === 'na' && unknown.why.startsWith('ยังไม่รู้จัก PO'));
ok('ไม่มี WK (ยังไม่ได้ดึง plan) = เรียงวันที่ PO ใหม่ไปเก่า · ไม่มีวันที่ไปท้าย',
   rows.map(r => r.date || '').join() === [...rows.map(r => r.date || '')].sort((x, y) => (!x) - (!y) || y.localeCompare(x)).join(), rows.map(r => r.date).join());

const withNoDate = mrpRows(ents, EN, { poList: [...poList, { po: 'TM0001H968', pn: 'PN-A', qty: 10, date: '' }], bomRowsOf, today: TODAY });
const nd = withNoDate.find(r => r.po === 'TM0001H968');
ok('ใบในไฟล์ PO ที่ไม่มีวันที่ และยังไม่รับ = ขึ้นพร้อม noDate ไม่หายเงียบ (ผู้ตรวจ #156 ข้อ 3)', nd && nd.noDate && nd.none, JSON.stringify(nd));
ok('ใบที่มีวันที่ ไม่ติด noDate', at('TM0001H961').noDate === false);
ok('ใบที่ไม่อยู่ในไฟล์ PO (คิดไม่ได้) ไม่ติด noDate — ไม่มีแถวให้เติมวันที่', unknown.noDate === false);
const pl = [{ po: 'TM0001H968', date: '' }, { po: 'TM0001H968', date: '' }, { po: 'TM0001H961', date: '2026-11-01' }];
const filled = fillPoDate(pl, 'TM0001H968', '2026-11-10');
ok('เติมวันที่: แก้ทุกแถวของใบนั้นที่ยังว่าง · ติด dirty ให้ซิงค์', filled.length === 2 && pl[0].date === '2026-11-10' && pl[1].dirty === true);
ok('เติมวันที่: ใบที่มีวันที่อยู่แล้วไม่แตะ', fillPoDate(pl, 'TM0001H961', '2026-11-11').length === 0 && pl[2].date === '2026-11-01');
throws('เติมวันที่: วันที่ไม่มีจริง = โยน พร้อมบอกรูปแบบ', () => fillPoDate(pl, 'TM0001H968', '2026-02-30'), '2026-11-12');
throws('เติมวันที่: ว่าง = โยน', () => fillPoDate(pl, 'TM0001H968', ''), 'วันที่ไม่ถูกต้อง');
const zeroBom = { 'PN-A': [{ code: A, usage: 2 }, { code: B, usage: 0.5 }, { code: X, usage: 0 }] };
const zr = mrpRows(ents, EN, { poList, bomRowsOf: pn => zeroBom[pn] || [], today: TODAY }).find(r => r.po === 'TM0001H963');
const zl = zr.lines.find(l => l.code === X);
ok('รหัสที่อยู่ในสูตรแต่ใช้ 0 แล้วรับเข้ามา = Over แต่ป้าย "BOM ใช้ 0" ไม่ใช่ "ไม่อยู่ใน BOM" (ผู้ตรวจ #156 ข้อ 4)',
   zl.state === 'zero' && zl.need === 0 && zr.nOver === 2 && mrpLineLabel(zl)[0] === 'BOM ใช้ 0 · Over 3', JSON.stringify(zl));
ok('นับจ่ายออกที่ไม่ใส่ PO เฉพาะนิติบุคคลนี้ · ไม่นับที่ยกเลิก (ผู้ตรวจ #156 ข้อ 1)',
   mrpNoPoIssues([mk('issue', '', A, 1), mk('issue', ' ', A, 1), mk('issue', '', A, 1, { voided: true }),
                  mk('issue', '', A, 1, { entity: 'TUE-U' }), mk('issue', 'TM0001H961', A, 1), mk('receive', '', A, 1)], EN) === 2);
ok('ไม่ระบุนิติบุคคล = 0 ไม่ใช่นับข้ามนิติบุคคล', mrpNoPoIssues([mk('issue', '', A, 1)], '') === 0);

console.log('=== M3. จบแล้ว ===');
ok('ไม่มี plan: ใบใน ' + MRP_FRESH_DAYS + ' วันไม่จบ แม้รับครบจ่ายครบ (ยอดจ่ายไม่ใช้ตัดสินจบแล้ว — เจ้าของเคาะ 13 พ.ย. 2026)',
   rows.filter(r => r.po !== 'TM0001H965').every(r => r.done === false) && at('TM0001H967').state === 'ok');
const back = run({ ents: [...ents, mk('sendback', 'TM0001H963', A, 3), mk('sendback', 'TM0001H963', X, 3)] }).find(r => r.po === 'TM0001H963');
ok('ส่งคืน Delta หักจากรับแล้ว · รหัสนอกสูตรที่คืนหมดแล้วไม่ขึ้น', back.state === 'ok' && !back.lines.some(l => l.code === X), JSON.stringify(back.lines));
ok('คืนของ (return) หักจากยอดจ่าย', line('TM0001H967', A, run({ ents: [...ents, mk('return', 'TM0001H967', A, 3)] })).issued === 17);

console.log('=== M4. ยอดขาดจบเรื่องแล้ว — กฎเดียวกับการ์ด "ยังรับไม่ครบตาม BOM" ===');
const calc = shortAll(ents, EN, { headerOf: po => { const p = poList.find(x => x.po === po); return p ? { pn: p.pn, order: p.qty } : null; }, bomRowsOf, all: true });
const calcB = calc.find(r => r.po === 'TM0001H962' && r.code === B);
const skipped = skipShort(calcB, { entity: EN, person: 'ก', why: 'ยอดน้อย' });
const r962 = fl => run({ follows: fl }).find(r => r.po === 'TM0001H962');
ok('ไม่ติดตาม = skip นับว่าครบ · การ์ดก็ไม่ขึ้น', r962([skipped]).state === 'ok' && r962([skipped]).nSkip === 1
   && shortPending([calcB], [skipped]).length === 0);
const cancelled = cancelShort(makeFollow({ kind: 'short', type: 'ขาด', source: 'delta', entity: EN, po: 'TM0001H962', code: B, qty: 1 }), { by: 'ก', why: 'ยอดน้อย' });
ok('ยกเลิกเรื่อง = skip เหมือนไม่ติดตาม', r962([cancelled]).nSkip === 1);
const closedSame = closeFollow(makeFollow({ kind: 'short', type: 'ขาด', source: 'delta', entity: EN, po: 'TM0001H962', code: B, qty: 1 }), { by: 'ก' });
const closedOdd = closeFollow(makeFollow({ kind: 'short', type: 'ขาด', source: 'delta', entity: EN, po: 'TM0001H962', code: B, qty: 3 }), { by: 'ก' });
ok('ปิดเรื่องด้วยยอดเท่าที่ขาด = skip', r962([closedSame]).nSkip === 1);
ok('ปิดเรื่องด้วยยอดไม่ตรง = ยัง Short — ตรงกับการ์ด', r962([closedOdd]).nShort === 1 && shortPending([calcB], [closedOdd]).length === 1);
ok('เรื่องของนิติบุคคลอื่น = ไม่นับ (A3)', r962([{ ...skipped, entity: 'TUE-U' }]).nShort === 1);
ok('เรื่องที่ยังไม่มีเจ้าของ = นับให้ (sameEntity แบบการ์ด short)', r962([{ ...skipped, entity: '' }]).nSkip === 1);

console.log('=== M4b. ยอดเกินจบเรื่องแล้ว — กฎเดียวกับการ์ด over (เจ้าของสั่ง 14 พ.ย. 2026) ===');
const ocalc = overAll(ents, EN, { headerOf: po => { const p = poList.find(x => x.po === po); return p ? { pn: p.pn, order: p.qty } : null; },
                                  usageOf: (pn, code) => { const b = (BOM[pn] || []).find(x => x.code === code); return b ? b.usage : null; } });
const oA = ocalc.find(r => r.po === 'TM0001H963' && r.code === A);
const oSkipped = skipOver(oA, { entity: EN, person: 'ก', why: 'ยอดน้อย' });
const r963 = (fl, more = []) => run({ ents: [...ents, ...more], follows: fl }).find(r => r.po === 'TM0001H963');
ok('ไม่ติดตาม Over = oskip ไม่นับเป็น Over · การ์ด over ก็ไม่ขึ้น',
   line('TM0001H963', A, run({ follows: [oSkipped] })).state === 'oskip' && r963([oSkipped]).nOver === 1
   && overPending([oA], [oSkipped]).length === 0, JSON.stringify(r963([oSkipped]).lines));
ok('ป้าย: เกิน N · จบเรื่องแล้ว (สีเทา)', mrpLineLabel(line('TM0001H963', A, run({ follows: [oSkipped] })))[0] === 'เกิน 3 · จบเรื่องแล้ว'
   && mrpLineLabel(line('TM0001H963', A, run({ follows: [oSkipped] })))[1] === 'mute');
ok('นับรวมใน "จบเรื่องแล้ว N รายการ"', r963([oSkipped]).nSkip === 1);
const oCancel = cancelOver(fromOverRow(oA, { entity: EN, person: 'ก' }), { by: 'ก', why: 'ยอดน้อย' });
ok('ยกเลิกเรื่อง Over = oskip เหมือนไม่ติดตาม', r963([oCancel]).lines.find(l => l.code === A).state === 'oskip');
ok('รับเกินเพิ่มหลังหยุดตาม = กลับมาเป็น Over (ตรงกับการ์ด)',
   r963([oSkipped], [mk('receive', 'TM0001H963', A, 2)]).lines.find(l => l.code === A).state === 'over');
ok('เรื่องของนิติบุคคลอื่น = ไม่นับ (A3)', r963([{ ...oSkipped, entity: 'TUE-U' }]).lines.find(l => l.code === A).state === 'over');
const xFollow = cancelOver(makeFollow({ kind: 'over', type: 'เกิน', source: 'manual', entity: EN, po: 'TM0001H963', part_no: 'PN-A', code: X, qty: 3 }), { by: 'ก', why: 'ยอดน้อย' });
ok('รหัสนอกสูตรที่หยุดตามแล้ว = oskip ไม่นับเป็น Over', r963([oSkipped, xFollow]).lines.find(l => l.code === X).state === 'oskip',
   JSON.stringify(r963([oSkipped, xFollow]).lines));
ok('ทุกรหัสที่เกินจบเรื่องแล้ว = ใบนี้ครบ (ป้ายเขียว)', r963([oSkipped, xFollow]).nOver === 0 && r963([oSkipped, xFollow]).state === 'ok'
   && r963([oSkipped, xFollow]).nSkip === 2);

console.log('=== M4c. ป้าย "จบเรื่องแล้ว" รู้ว่าจบเพราะเรื่องไหน — กดไปแถวนั้นในแท็บ short / over (เจ้าของสั่ง 15 พ.ย. 2026) ===');
const via962 = fl => r962(fl).lines.find(l => l.code === B).via;
ok('ไม่ติดตาม = via ชี้เรื่องที่หยุดไว้ (การ์ดยกเลิก)', JSON.stringify(via962([skipped])) === JSON.stringify({ how: 'stop', id: skipped.id }));
ok('ยกเลิกเรื่อง = via ชี้เรื่องที่ยกเลิก', JSON.stringify(via962([cancelled])) === JSON.stringify({ how: 'stop', id: cancelled.id }));
ok('ปิดเรื่องตรงยอด = via done ชี้เรื่องที่ปิด', JSON.stringify(via962([closedSame])) === JSON.stringify({ how: 'done', id: closedSame.id }));
const sOld = { ...skipped, id: 'F-OLD', void_at: '2026-11-01T01:00:00.000Z' }, sNew = { ...skipped, id: 'F-NEW', void_at: '2026-11-10T01:00:00.000Z' };
const closedEarly = { ...closedSame, created_at: '2026-11-05T01:00:00.000Z' };
ok('ปิดตรงยอดไว้ก่อน แล้วมาหยุดทีหลัง = ชี้การ์ดยกเลิก', JSON.stringify(via962([closedEarly, sNew])) === JSON.stringify({ how: 'stop', id: 'F-NEW' }));
ok('หยุดไว้ก่อน แล้วมีเรื่องตั้งทีหลังและปิดตรงยอด = ชี้เรื่องที่ปิด (เพดานหยุดหมดอายุ — กฎ stopGate เดิม)',
   JSON.stringify(via962([sOld, closedEarly])) === JSON.stringify({ how: 'done', id: closedSame.id }));
ok('หยุดไว้หลายรอบ = ชี้รอบล่าสุด ตรงกับแถวที่การ์ดยกเลิกแสดง (stoppedShorts)',
   via962([sOld, sNew]).id === 'F-NEW' && stoppedShorts([sOld, sNew], { entity: EN })[0].s.id === 'F-NEW');
ok('Short / ครบ = ไม่มี via (ป้ายกดไม่ได้)', via962([]) === null && line('TM0001H961', A).via === null
   && line('TM0001H963', A).via === null);
ok('ไม่ติดตาม Over = via ชี้เรื่อง over ที่หยุดไว้', line('TM0001H963', A, run({ follows: [oSkipped] })).via.id === oSkipped.id);
ok('รหัสนอกสูตรที่หยุดตามแล้ว = via ชี้เรื่องนั้น', r963([oSkipped, xFollow]).lines.find(l => l.code === X).via.id === xFollow.id);
ok('shortSettled / overSettled ยังคืน true / false เหมือนเดิม',
   shortSettled([skipped])('TM0001H962', B, 1) === true && shortSettled([])('TM0001H962', B, 1) === false
   && overSettled([oSkipped])('TM0001H963', A, 3) === true && overSettled([oSkipped])('TM0001H963', A, 9) === false);

console.log('=== M4d. แถวที่กดไปหา / กลับมา ขึ้นเสมอ (เจ้าของสั่ง 15 พ.ย. 2026) ===');
const many = Array.from({ length: 305 }, (_, i) => ({ s: { id: 'F' + i } }));
const keep = id => x => x.s.id === id;
ok('sliceKeep: แถวที่ pin อยู่เลยเพดาน = ต่อท้าย ขึ้นแถวเดียว', (() => { const o = sliceKeep(many, 300, keep('F303'));
   return o.length === 301 && o[300].s.id === 'F303' && o[299].s.id === 'F299'; })());
ok('sliceKeep: แถวที่ pin อยู่ในเพดานแล้ว = ไม่ซ้ำ ไม่เพิ่ม', sliceKeep(many, 300, keep('F5')).length === 300);
ok('sliceKeep: ไม่มี pin / pin ไม่มีในรายการ = ตัดตามเดิม',
   sliceKeep(many, 300, null).length === 300 && sliceKeep(many, 300, keep('X')).length === 300 && sliceKeep(null, 300, null).length === 0);
const allPo = [{ po: 'P1' }, { po: 'P2' }, { po: 'P3' }];
ok('mrpKeep: ใบ pin ขึ้นแม้หลุดตัวกรอง · ลำดับตามรายการเต็ม', mrpKeep(allPo, [allPo[2]], 'P1').map(r => r.po).join() === 'P1,P3');
ok('mrpKeep: ไม่มี pin = ตามตัวกรองเดิม · ใบ pin ผ่านตัวกรองอยู่แล้ว = ไม่ซ้ำ',
   mrpKeep(allPo, [allPo[1]], '').map(r => r.po).join() === 'P2' && mrpKeep(allPo, [allPo[1]], 'P2').map(r => r.po).join() === 'P2');

console.log('=== M5. ตัวกรอง · ค้นหา ===');
ok('ตัวกรอง Short / Over / ครบ / คิดไม่ได้', MRP_FILTERS.short(at('TM0001H962')) && MRP_FILTERS.over(at('TM0001H963'))
   && MRP_FILTERS.ok(at('TM0001H961')) && MRP_FILTERS.na(at('TM0001H966')) && !MRP_FILTERS.ok(at('TM0001H962')));
ok('ค้นด้วยเลข PO · P/N · รหัสวัตถุดิบ ได้', mrpMatch(at('TM0001H962'), 'h962') && mrpMatch(at('TM0001H962'), 'pn-a')
   && mrpMatch(at('TM0001H963'), X) && !mrpMatch(at('TM0001H961'), X));

ok('ป้ายรายรหัส: ครบ · Short X · Over X · นอกสูตร · จบเรื่องแล้ว',
   mrpLineLabel(line('TM0001H961', A))[0] === 'ครบ' && mrpLineLabel(line('TM0001H962', B)).join() === 'Short 1,bad'
   && mrpLineLabel(line('TM0001H963', A)).join() === 'Over 3,warn' && mrpLineLabel(line('TM0001H963', X))[0] === 'ไม่อยู่ใน BOM · Over 3'
   && mrpLineLabel(line('TM0001H962', B, run({ follows: [skipped] })))[0] === 'ขาด 1 · จบเรื่องแล้ว');
ok('ตัวเลข: คั่นหลักพัน · ทศนิยมไม่เกินสี่ · ไม่มีค่า = —', mrpNum(1234.56789) === '1,234.5679' && mrpNum(null) === '—' && mrpNum(0.0011) === '0.0011');
ok('ปุ่มตัวกรองบนจอมีครบทุกตัวกรอง', MRP_SEG.every(s => MRP_FILTERS[s.k]) && MRP_SEG.length === Object.keys(MRP_FILTERS).length);

console.log('=== M7. ดึงสถานะส่งของจาก plan (เจ้าของสั่ง 13 พ.ย. 2026) ===');
const pOrd = (id, poNo, pn, orderQty, week, extra = {}) => ({ id, poNo, pn, orderQty, week, voided: false, ...extra });
const pRec = (orderId, process, qty, extra = {}) => ({ id: 'R' + (++n), orderId, process, qty, voided: false, ...extra });
const ship = planShipList([
  pOrd('o1', 'TM0001H961', 'PN-A', 10, 'WK44'),
  pOrd('o2', 'TM0001H962', 'PN-A', 10, 'WK45'), pOrd('o3', 'TM0001H962', 'PN-B', 5, 'WK45'),
  pOrd('o4', ' tm0001h965 ', 'PN-A', 10, 'WK9'),
  pOrd('o5', 'TM0001H967', 'PN-A', 10, 'WK46', { voided: true }),
  pOrd('o6', 'TM0001H964', 'PN-A', 10, 'WK46', { voided: 'TRUE' }),
], [
  pRec('o1', 'shipping', 6), pRec('o1', 'shipping', 4),
  pRec('o2', 'shipping', 12), pRec('o3', 'shipping', 4),
  pRec('o4', 'inspection', 10), pRec('o4', 'shipping', 9, { voided: true }),
]);
const sp = po => ship.find(x => x.po.trim().toUpperCase() === po);
ok('ส่งแล้ว = ผลรวมขั้น shipping · ส่งครบ = เหลือ 0', sp('TM0001H961').shipped === 10 && sp('TM0001H961').left === 0);
ok('PO เดียวหลาย P/N: ส่งเกินแถวหนึ่งไม่ไปหักอีกแถว — เหลือ 1 (wipBalance ของ plan ครอบไม่ให้ติดลบ)',
   sp('TM0001H962').left === 1 && sp('TM0001H962').qty === 15, JSON.stringify(sp('TM0001H962')));
ok('ไม่นับขั้นอื่น และไม่นับยอดส่งที่ยกเลิก', sp('TM0001H965').shipped === 0 && sp('TM0001H965').left === 10);
ok('ใบที่ยกเลิกใน plan ไม่นับ (voided true หรือข้อความ TRUE)', !sp('TM0001H967') && !sp('TM0001H964'));
ok('WK มาจาก plan', sp('TM0001H962').week === 'WK45');
ok('WK ของ plan เป็นชื่อชีตยาว — ตัดเหลือ WKnn · เก็บของเดิมไว้ดู (ข้อมูลจริงหน้าตาแบบนี้ 13 พ.ย. 2026)',
   planWeek('Plan WK 31  1-4.6. 26') === 'WK31' && planWeek('WK 25  6-9.4.26') === 'WK25' && planWeek('wk09') === 'WK9'
   && planWeek('45') === '45' && planWeek('') === '' && planWeek(null) === '');
const longWk = planShipList([pOrd('x1', 'TM0001H980', 'PN-A', 5, 'Plan WK 31  1-4.6. 26')], [])[0];
ok('planShipList ใช้ WK ที่ตัดแล้ว + weekRaw', longWk.week === 'WK31' && longWk.weekRaw === 'Plan WK 31  1-4.6. 26');
ok('ชื่อชีตต่างแบบ ("Plan WK 31…" กับ "WK 9…") เรียงตามเลขสัปดาห์ ไม่ใช่ตามตัวอักษร (ใหม่สุดก่อน)',
   [{ week: planWeek('WK 9  1-3.3.26'), po: 'B' }, { week: planWeek('Plan WK 31  1-4.6. 26'), po: 'A' }].sort(mrpOrder)[0].po === 'A');

const PL = planMap(ship);
const pr = mrpRows([...ents, mk('receive', 'TM0001H965', A, 3)], EN, { poList, bomRowsOf, plan: PL });
const pat = po => pr.find(r => r.po === po);
ok('plan บอกว่าส่งครบ = จบ (done) ไม่ว่าจะจ่ายของครบหรือยัง (เจ้าของเคาะ 13 พ.ย. 2026)', pat('TM0001H961') && pat('TM0001H961').done === true);
ok('plan บอกว่ายังส่งไม่หมด = ขึ้น ไม่จบ พร้อม WK', pat('TM0001H962') && pat('TM0001H962').week === 'WK45' && !pat('TM0001H962').notInPlan
   && pat('TM0001H962').done === false);
ok('ไม่มีใน plan = ไม่จบ แม้รับครบจ่ายครบ', pat('TM0001H967') && pat('TM0001H967').notInPlan && pat('TM0001H967').done === false);
const shipNa = mrpRows([...ents, mk('receive', 'TM0001H999', A, 4)], EN,
  { poList, bomRowsOf, plan: planMap([{ po: 'TM0001H999', week: 'WK1', qty: 1, shipped: 1, left: 0 }]) }).find(r => r.po === 'TM0001H999');
ok('ใบคิดไม่ได้ที่ plan บอกว่าส่งครบ = จบด้วย', shipNa && shipNa.state === 'na' && shipNa.done === true);
ok('มี plan แล้วไม่ใช้กฎ ' + MRP_FRESH_DAYS + ' วัน — ใบเก่าที่ยังส่งไม่หมดขึ้น · จับคู่ PO ไม่สนช่องว่าง/ตัวพิมพ์',
   pat('TM0001H965') && pat('TM0001H965').week === 'WK9');
ok('ไม่มีใน plan แต่รับแล้ว = ขึ้นพร้อม notInPlan ไม่หายเงียบ', pat('TM0001H963') && pat('TM0001H963').notInPlan && pat('TM0001H963').week === '');
ok('ไม่มีใน plan และยังไม่รับ = ไม่ขึ้น', !pat('TM0001H964'));
ok('ไม่มี plan = ไม่ติด notInPlan สักแถว', rows.every(r => r.notInPlan === false));
ok('มี plan ไม่ต้องส่ง today', Array.isArray(mrpRows(ents, EN, { poList, bomRowsOf, plan: PL })));
ok('planMap ของที่ไม่ใช่รายการ = null (ใช้กฎ 90 วัน)', planMap(null) === null && planMap(undefined) === null);

const old = mrpRows([...ents, mk('receive', 'TM0001H965', A, 3), mk('receive', 'TM0001H999', A, 4)], EN, { poList, bomRowsOf, today: TODAY });
ok('ไม่มี plan: ใบเก่ากว่า ' + MRP_FRESH_DAYS + ' วัน จบแม้รับแล้ว (เจ้าของเคาะ)', old.find(r => r.po === 'TM0001H965')?.done === true);
ok('ไม่มี plan: ใบไม่มีวันที่ / ไม่อยู่ในไฟล์ PO ไม่จบ (รู้อายุไม่ได้)', old.find(r => r.po === 'TM0001H999')?.done === false);
ok('ไม่มี plan: ใบที่ไม่อยู่ในไฟล์ PO (รู้อายุไม่ได้) ยังขึ้นแบบคิดไม่ได้', old.find(r => r.po === 'TM0001H999')?.state === 'na');
throws('ไม่มี plan และไม่ส่ง today = โยน ไม่ตัดใบทิ้งเงียบ (ผู้ตรวจ #156 รอบ 4 ข้อ 1)', () => mrpRows(ents, EN, { poList, bomRowsOf }), 'today');

const R = (week, date, po, pn) => ({ week, date, po, pn });
const sorted = [R('', '2026-11-01', 'P1', 'A'), R('WK46', '2026-11-05', 'P2', 'A'), R('WK45', '2026-11-09', 'P3', 'A'),
                R('WK45', '2026-11-02', 'P4', 'A'), R('WK45', '2026-11-02', 'P4', '0'), R('WK45', '', 'P0', 'A')].sort(mrpOrder);
const sameDay = [R('WK45', '2026-11-02', 'P5', 'A'), R('WK45', '2026-11-02', 'P4', 'A')].sort(mrpOrder);
ok('ใบใหม่สุดก่อน: WK ใหม่ไปเก่า → วันที่ใหม่ไปเก่า → เลข PO → P/N · ไม่มี WK (หรือรู้ปีไม่ได้) / ไม่มีวันที่ไปท้าย (เจ้าของสั่ง 14 พ.ย. 2026)',
   sorted.map(r => r.po + r.pn).join() === 'P2A,P3A,P40,P4A,P1A,P0A' && sameDay.map(r => r.po).join() === 'P4,P5', sorted.map(r => r.po + r.pn).join());
const CAT = { '9100000971': 'PACKING', '9100000972': 'CORE', '9100000973': 'WIRE', '9100000974': 'CORE', '9100000975': '', '9100000976': 'TAPE' };
const catBom = { 'PN-C': ['9100000971', '9100000972', '9100000973', '9100000974', '9100000975'].map(code => ({ code, usage: 1 })) };
const cr = mrpRows([mk('receive', 'TM0001H970', '9100000973', 1), mk('receive', 'TM0001H970', '9100000976', 2)], EN,
  { poList: [{ po: 'TM0001H970', pn: 'PN-C', qty: 1, date: TODAY }], bomRowsOf: pn => catBom[pn] || [], today: TODAY,
    catOf: c => CAT[c] || '' })[0];
ok('รหัสในใบเรียงตามหมวด (CORE → WIRE → … → PACKING) แล้วตามรหัส · ไม่มีหมวดไปท้าย · นอกสูตรยังอยู่ท้ายสุด (เจ้าของเคาะ)',
   cr.lines.map(l => l.code.slice(-2)).join() === '72,74,73,71,75,76', cr.lines.map(l => l.code.slice(-2)).join());
ok('ต่อสายหมวดเข้า mrpRows', /plan: planMap\(planShip\.list\), catOf,/.test(readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8')));
console.log('=== M8. WK จากล็อต · ใบที่ plan ไม่รู้จัก (เจ้าของเคาะ 14 พ.ย. 2026) ===');
ok('lotWeek อ่าน W45 · W-45 · WK 45 · wk09 · ไม่รับวันที่ / เลขผู้ขาย / เกิน 53',
   lotWeek('W45') === 45 && lotWeek('W-45') === 45 && lotWeek('WK 45') === 45 && lotWeek('wk09') === 9 && lotWeek('WK45') === 45
   && lotWeek('2026-11-01') === null && lotWeek('A12') === null && lotWeek('W54') === null && lotWeek('') === null && lotWeek(null) === null);
const lotEnts = [...ents,
  mk('receive', 'TM0001H963', A, 1, { lot: 'W46' }), mk('receive', 'TM0001H963', B, 1, { lot: 'W-45' }),
  mk('receive', 'TM0001H963', A, 1, { lot: 'WK 45' }), mk('receive', 'TM0001H963', B, 1, { lot: '2026-11-01' }),
  mk('receive', 'TM0001H962', A, 1, { lot: 'W30' }),
  mk('receive', 'TM0001H961', A, 1, { lot: 'W50', voided: true }), mk('receive', 'TM0001H961', A, 1, { lot: 'W51', entity: 'TUE-U' })];
const lr = mrpRows(lotEnts, EN, { poList, bomRowsOf, plan: PL, today: TODAY });
const lat = po => lr.find(r => r.po === po);
ok('plan ไม่มีใบนี้ = WK จากล็อตที่เจอบ่อยสุด (WK45 ×2 ชนะ WK46 ×1) · บอกที่มา',
   lat('TM0001H963').week === 'WK45' && lat('TM0001H963').weekFrom === 'lot' && /ล็อต/.test(lat('TM0001H963').weekRaw), JSON.stringify(lat('TM0001H963')));
ok('plan มี WK = ใช้ของ plan ไม่สนล็อต', lat('TM0001H962').week === 'WK45' && lat('TM0001H962').weekFrom === 'plan');
ok('ล็อตที่ยกเลิก / ของนิติบุคคลอื่น ไม่นับ (B · A3)', lat('TM0001H961').weekFrom === 'plan'
   && mrpRows(lotEnts, EN, { poList, bomRowsOf, today: TODAY }).find(r => r.po === 'TM0001H961').week === '');
const tie = mrpRows([...ents, mk('receive', 'TM0001H966', A, 1, { lot: 'W12' }), mk('receive', 'TM0001H966', A, 1, { lot: 'W9' })], EN, { poList, bomRowsOf, today: TODAY });
ok('WK จากล็อตเจอเท่ากัน = เลขน้อยกว่า', tie.find(r => r.po === 'TM0001H966').week === 'WK9');
ok('ไม่มีล็อตแบบ WK = ไม่มี WK (ไปท้ายตาราง)', lr.find(r => r.po === 'TM0001H967').week === '' && lr.find(r => r.po === 'TM0001H967').weekFrom === '');
const oldNip = mrpRows([...ents, mk('receive', 'TM0001H965', A, 3)], EN,
  { poList, bomRowsOf, plan: planMap([{ po: 'TM0001H962', week: 'WK1', qty: 1, shipped: 0, left: 1 }]), today: TODAY });
ok('ไม่มีใน plan + วันที่ PO เก่ากว่า ' + MRP_FRESH_DAYS + ' วัน = จบ (plan บอกไม่ได้ ใช้กฎวัน — เจ้าของเคาะ)',
   oldNip.find(r => r.po === 'TM0001H965')?.notInPlan === true && oldNip.find(r => r.po === 'TM0001H965').done === true);
ok('ไม่มีใน plan + ใบใหม่ = ไม่จบ', oldNip.find(r => r.po === 'TM0001H967')?.done === false);
console.log('=== M9. ข้ามปี · WK ที่พิมพ์เอง (เจ้าของสั่ง 15 พ.ย. 2026) ===');
ok('weekKeyOf: ปีที่ใกล้วันที่ PO ที่สุด — WK52 ปลายปี · WK1 ของปีถัดไปเมื่อ PO ลงวันที่ปลายธันวาคม',
   weekKeyOf(52, '2026-12-24') === '2026-12-21' && weekKeyOf(1, '2026-12-30') === '2027-01-04' && weekKeyOf(1, '2027-01-02') === '2027-01-04'
   && weekKeyOf(52, '2027-01-05') === '2026-12-21' && weekKeyOf(45, '2026-11-11') === '2026-11-02' && weekKeyOf(0, '2026-11-11') === '' && weekKeyOf(45, '') === '');
ok('ข้ามปี: WK1 ของปีใหม่ขึ้นเหนือ WK52 ของปีก่อน (ใบใหม่สุดก่อน)',
   [R('WK52', '2026-12-22', 'OLD', 'A'), R('WK1', '2026-12-29', 'NEW', 'A'), R('WK51', '2026-12-15', 'OLDER', 'A')].sort(mrpOrder).map(r => r.po).join() === 'NEW,OLD,OLDER');
const yearPlan = planMap([{ po: 'TM0001H961', week: 'WK52', qty: 10, shipped: 0, left: 10 }, { po: 'TM0001H962', week: 'WK1', qty: 10, shipped: 0, left: 10 }]);
const yearPos = poList.map(p => p.po === 'TM0001H961' ? { ...p, date: '2026-12-21' } : p.po === 'TM0001H962' ? { ...p, date: '2026-12-30' } : p);
const yr = mrpRows(ents, EN, { poList: yearPos, bomRowsOf, plan: yearPlan, today: '2026-12-31' });
ok('mrpRows: weekKey ติดปีให้ · WK1 (PO 30 ธ.ค.) อยู่เหนือ WK52 (PO 21 ธ.ค.)', yr[0].po === 'TM0001H962' && yr[0].weekKey === '2027-01-04'
   && yr.find(r => r.po === 'TM0001H961').weekKey === '2026-12-21', yr.map(r => r.po + ':' + r.weekKey).join());
ok('weekKeyOf ahead (WK จากล็อต): วันจันทร์ล่าสุดที่ไม่เกินวันอ้างอิง + ahead · ล็อต W10 รับ พ.ย. = ปีนี้ ไม่ใช่ปีหน้า (รีวิว #160)',
   weekKeyOf(10, '2026-11-10', { ahead: 12 }) === '2026-03-02' && weekKeyOf(52, '2027-01-05', { ahead: 12 }) === '2026-12-21'
   && weekKeyOf(1, '2027-01-05', { ahead: 12 }) === '2027-01-04' && weekKeyOf(53, '2026-11-10', { ahead: 12 }) === '2026-12-28'
   && weekKeyOf(52, '2026-11-10', { ahead: 12 }) === '2026-12-21');
const lotY = (po, lot, at) => ({ ...mk('receive', po, A, 1, { lot }), at });
const ly = mrpRows([lotY('TM0001H963', 'W45', '2026-11-10T09:00:00'), lotY('TM0001H966', 'W10', '2026-11-10T09:00:00')], EN,
                   { poList: poList.map(p => ({ ...p, date: '2026-11-10' })), bomRowsOf, plan: null, today: '2026-11-14' });
const lyo = ly.filter(r => r.weekFrom === 'lot').map(r => r.week + ':' + r.weekKey).join();
ok('mrpRows: ล็อต W10 รับเข้า พ.ย. อยู่ใต้ล็อต W45 (ของเก่าไม่เด้งขึ้นหัวตาราง · รีวิว #160)', lyo === 'WK45:2026-11-02,WK10:2026-03-02', lyo);
const ly2 = mrpRows([lotY('TM0001H963', 'W52', '2027-01-05T09:00:00'), lotY('TM0001H966', 'W01', '2027-01-05T09:00:00')], EN,
                    { poList: poList.map(p => ({ ...p, date: '' })), bomRowsOf, plan: null, today: '2027-01-06' });
const ly2o = ly2.filter(r => r.weekFrom === 'lot').map(r => r.week + ':' + r.weekKey).join();
ok('mrpRows: ข้ามปีจากล็อต — W01 รับ 5 ม.ค. อยู่เหนือ W52 ของปีก่อน (อิงวันรับเข้าครั้งแรก)', ly2o === 'WK1:2027-01-04,WK52:2026-12-21', ly2o);
ok('weekNumOf: WK45 · 45 → 45 · ว่าง / เกิน 53 → 0', weekNumOf('WK45') === 45 && weekNumOf('45') === 45 && weekNumOf('') === 0 && weekNumOf('WK60') === 0);

ok('parseWeekInput: 45 · WK45 · wk 45 · W-07 → เลข · ว่าง → ลบ · 0 / 54 / ตัวอักษร → ไม่ถูกต้อง',
   parseWeekInput('45') === 45 && parseWeekInput('WK45') === 45 && parseWeekInput('wk 45') === 45 && parseWeekInput('W-07') === 7
   && parseWeekInput('') === '' && parseWeekInput('0') === null && parseWeekInput('54') === null && parseWeekInput('abc') === null);
const wk = [];
const w1 = setPoWeek(wk, ' tm0001h963 ', 'WK44', { by: 'ก', now: 'T1' });
ok('setPoWeek: สร้างแถวใหม่ · กุญแจ = WK|PO ตัวพิมพ์ใหญ่ · ติด dirty', wk.length === 1 && w1.id === 'WK|TM0001H963' && w1.week === 44 && w1.dirty === true && w1.deleted === false);
w1.dirty = false;
ok('setPoWeek: ค่าเดิม = ไม่เปลี่ยน (null)', setPoWeek(wk, 'TM0001H963', '44') === null && w1.dirty === false);
ok('setPoWeek: แก้เลข = แถวเดิม ติด dirty', setPoWeek(wk, 'TM0001H963', '45') === w1 && w1.week === 45 && w1.dirty === true && wk.length === 1);
ok('setPoWeek: เว้นว่าง = ลบ (deleted ไม่ใช่ลบทิ้ง — ซิงค์ได้)', setPoWeek(wk, 'TM0001H963', '') === w1 && w1.deleted === true && wk.length === 1);
ok('setPoWeek: ลบซ้ำ = ไม่เปลี่ยน', setPoWeek(wk, 'TM0001H963', '') === null);
throws('setPoWeek: เลขไม่ถูกต้อง = โยนพร้อมบอกวิธีพิมพ์', () => setPoWeek(wk, 'TM0001H963', '99'), 'WK45');
ok('poWeekMap: ข้ามแถวที่ลบ (true หรือข้อความ TRUE จากชีต)', poWeekMap([...wk, { po: 'X1', week: '12', deleted: 'TRUE' }, { po: 'x2', week: 7 }]).size === 1
   && poWeekMap([{ po: 'x2', week: 7 }]).get('X2') === 7);
const mw = poWeekMap([{ po: 'TM0001H963', week: 40 }, { po: 'TM0001H962', week: 30 }, { po: 'TM0001H967', week: 41 }]);
const mr = mrpRows([...ents, mk('receive', 'TM0001H967', A, 1, { lot: 'W20' })], EN, { poList, bomRowsOf, plan: PL, today: TODAY, weeks: mw });
const mat = po => mr.find(r => r.po === po);
ok('WK พิมพ์เองใช้เมื่อ plan ไม่มี WK · weekFrom = manual', mat('TM0001H963').week === 'WK40' && mat('TM0001H963').weekFrom === 'manual');
ok('plan มี WK = ใช้ของ plan ไม่สน WK พิมพ์เอง', mat('TM0001H962').week === 'WK45' && mat('TM0001H962').weekFrom === 'plan');
ok('WK พิมพ์เองชนะ WK จากล็อต (คนพิมพ์ตั้งใจ · ล็อตเป็นการเดา)', mat('TM0001H967').week === 'WK41' && mat('TM0001H967').weekFrom === 'manual');
ok('ค้นด้วย WK ได้', !!pat('TM0001H962') && mrpMatch(pat('TM0001H962'), 'wk45') && !mrpMatch(pat('TM0001H962'), 'wk46'));

console.log('=== M6. หน้าจอ ===');
const app = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
ok('มีแท็บ MRP ในงานประจำวัน', /\{ k: 'mrp',\s+label: 'MRP' \}/.test(app));
ok('ต่อสายด้วย mrpRows + posVisible (ใบที่นิติบุคคลนี้มองเห็น) + todayLocal', /mrpRows\(entries\.value, entity\.value, \{[^}]*poList: posVisible\.value/.test(app) && /today: todayLocal\(\)/.test(app));
ok('จอมีปุ่มกางทั้งหมด + พับทั้งหมด + ติ๊กแสดง PO ที่จบแล้ว', html.includes('กางทั้งหมด') && html.includes('พับทั้งหมด') && html.includes('v-model="mrpDone"'));
ok('แท็บอื่นไม่ต้องคิด MRP — watch อ่าน mrpShown เฉพาะตอนอยู่แท็บ mrp (ผู้ตรวจ #156 ข้อ 2)', /watch\(\(\) => tab\.value === 'mrp' &&/.test(app));
ok('จอขึ้นเหตุเต็มของใบที่คิดไม่ได้ ไม่ตัดครึ่งหลัง (ผู้ตรวจ #156 ข้อ 5)', !html.includes("r.why.split(' — ')[0]"));
ok('ตัวคิดพัง = จอบอก ไม่ว่างเงียบ (ผู้ตรวจ #156 ข้อ 6)', html.includes('mrpErr') && /mrpErr/.test(app));
ok('ช่องเติมวันที่ + ป้ายจ่ายไม่ใส่ PO อยู่บนจอ', html.includes('mrpSetDate(') && html.includes('mrpNoPo'));
// ตรวจเฉพาะบล็อกแท็บ MRP — ใบอื่นใส่ @click.stop ให้ <td> ของแท็บอื่นได้ ไม่ทำให้เทสนี้แดง (ผู้ตรวจ #156 รอบ 3 ข้อ 2)
// บล็อก = จาก <template v-else-if="tab==='mrp'"> ถึง <template v-else… ถัดไปที่ย่อหน้าเท่ากัน (แท็บถัดไป)
const mrpStart = html.indexOf(`<template v-else-if="tab==='mrp'">`);
const mrpIndent = mrpStart < 0 ? '' : html.slice(html.lastIndexOf('\n', mrpStart) + 1, mrpStart);
const mrpEndAt = mrpStart < 0 ? -1 : html.indexOf('\n' + mrpIndent + '<template v-else', mrpStart + 1);
const mrpHtml = mrpStart < 0 ? '' : html.slice(mrpStart, mrpEndAt < 0 ? undefined : mrpEndAt);
ok('ตัดบล็อกแท็บ MRP ออกมาตรวจได้ (ไม่งั้นเทสข้อถัดไปไม่มีความหมาย)',
   mrpStart >= 0 && mrpEndAt > mrpStart && mrpHtml.includes('mrpSetDate(') && !mrpHtml.includes(`tab==='misc'`));
ok('กันคลิกเฉพาะช่องเลือกวันที่ — คลิกช่องวันที่ของแถวอื่นยังกางแถวได้ (ผู้ตรวจ #156 รอบ 2 ข้อ 4)',
   !/<td[^>]*@click\.stop/.test(mrpHtml) && /<input type="date"[^>]*@click\.stop/.test(mrpHtml));
ok('ไม่มีแถวไหนเปลี่ยน = ไม่ขึ้นว่าเติมวันที่แล้ว (ผู้ตรวจ #156 รอบ 2 ข้อ 5)', /if \(!changed\.length\) return;/.test(app));
ok('คอลัมน์เรียง WK → วันที่ → PO → P/N (เจ้าของสั่ง 13 พ.ย. 2026)',
   /<th style="width:28px"><\/th><th>WK<\/th><th>วันที่ PO<\/th><th>PO<\/th><th>P\/N<\/th>/.test(mrpHtml));
ok('ต่อสาย plan เข้า mrpRows', /plan: planMap\(planShip\.list\)/.test(app));
ok('ดึงผ่าน Apps Script ฝั่งคลัง (planShip) ไม่ต้องตั้ง URL / token ของ plan ทีละเครื่อง (เจ้าของเลือกแบบ ข)',
   /await api\('planShip'\)/.test(app) && /planShipList\(d\.orders, d\.records\)/.test(app) && !/plan_link|planLink/.test(app + html));
ok('จอบอกเสมอว่าตัดใบจบด้วย plan หรือกฎ 90 วัน', mrpHtml.includes('ใช้ข้อมูลส่งของจาก plan') && mrpHtml.includes('ยังไม่ได้ดึงจาก plan'));
ok('ป้ายไม่มีใน plan อยู่บนจอ', mrpHtml.includes('r.notInPlan'));
ok('ช่องพิมพ์ WK ขึ้นเฉพาะใบที่ไม่มี WK หรือพิมพ์เอง · ต่อสาย mrpSetWeek · ส่ง weeks เข้า mrpRows (เจ้าของสั่ง 15 พ.ย. 2026)',
   /v-if="r\.weekFrom === '' \|\| r\.weekFrom === 'manual'"/.test(mrpHtml) && mrpHtml.includes('mrpSetWeek(r.po, $event.target.value)')
   && /weeks: poWeekMap\(poWeeks\.value\)/.test(app));
ok('จอคอม: ตาราง MRP + ตาราง BOM ข้างในตัวใหญ่ขึ้น · มือถือไม่ขยาย (เจ้าของขอ 14 พ.ย. 2026)', /@media \(min-width:761px\)\{\s*table\.mrp,table\.mrp table\.mrp-bom\{font-size:\d+px\}/.test(html));
{ // ⚠️ กฎ 22px ต้องอยู่หลังกฎ 19px (selector เดียวกัน · @media ไม่เพิ่ม specificity) — ผู้ตรวจ #158 รอบ 1 ข้อ 1
  const at19 = html.indexOf('tr.mrp-po.open > td.mono{font-size:19px'), at22 = html.indexOf('tr.mrp-po.open > td.mono{font-size:22px}');
  ok('จอคอม: หัวใบที่กาง 22px ชนะ 19px จริง (อยู่ล่างกว่า)', at19 >= 0 && at22 > at19, at19 + ' / ' + at22);
}
ok('ช่องสถานะของแถว PO เลื่อนด้วย position:relative ห่างจาก PO Qty. (เจ้าของขอ 14 พ.ย. 2026)', /\.mrp \.mrp-stin\{position:relative;left:\d+px/.test(html) && (mrpHtml.match(/class="mrp-stin"/g) || []).length === 2);
ok('จอทำ WK จากล็อตเป็นตัวจาง + ชี้เมาส์บอกที่มา', html.includes(`:class="{ 'mrp-wklot': r.weekFrom === 'lot' }" :title="r.weekRaw"`) && /td\.mrp-wklot\{color:/.test(html));
ok('ตาราง BOM ไม่มีคอลัมน์จ่ายแล้ว — ปิดใบดูจาก plan แทน (เจ้าของขอ 13 พ.ย. 2026)',
   /<th class="r">รับแล้ว<\/th><th class="mrp-gap"><span>สถานะ<\/span><\/th><\/tr>/.test(mrpHtml) && !mrpHtml.includes('mrpNum(l.issued)'));
ok('ป้ายสถานะเลื่อนด้วย position:relative ไม่ใช่ padding/width — คอลัมน์อื่นต้องไม่เลื่อนตาม (เจ้าของทัก 13 พ.ย. 2026)',
   // ป้าย "จบเรื่องแล้ว" เป็น <button> — ต้องเลื่อนด้วยกฎเดียวกับ <span> ไม่งั้นป้ายในคอลัมน์ไม่อยู่แนวเดียวกัน (รีวิว #165 ข้อ 1)
   /\.mrp-bom \.mrp-gap > span,\.mrp-bom \.mrp-gap > button\{position:relative;left:/.test(html) && !/\.mrp-gap\{[^}]*width/.test(html));
ok('ใบที่กางมีแถวเว้นที่ว่างทั้งบนและล่าง แยกจากใบข้าง ๆ (เจ้าของขอ 13 พ.ย. 2026)',
   (mrpHtml.match(/<tr v-if="mrpOpen\[r\.po\]" class="mrp-space"/g) || []).length === 2 && /tr\.mrp-space > td\{height:/.test(html));
ok('ใบที่กาง: WK · วันที่ · PO · P/N · PO Qty. ตัวใหญ่ตัวหนา (เจ้าของขอ 13 พ.ย. 2026)', /tr\.mrp-po\.open > td\.mono\{font-size:\d+px;font-weight:700/.test(html));
ok('PO ที่กางอยู่ติดคลาส open + แถวรายละเอียดมีคลาสของตัวเอง ให้ CSS แยกให้เห็นชัด',
   mrpHtml.includes(':class="{ open: mrpOpen[r.po] }"') && mrpHtml.includes('class="mrp-det"') && /tr\.mrp-po\.open > td\{/.test(html));

{
  // ผู้ตรวจ #177 รอบ 2: ใบที่พับไว้ในหน้า short / over ไม่มีแถวใน DOM — กดป้ายจาก MRP แล้วต้องกางใบนั้นก่อนหาแถว
  const appF = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const go = appF.slice(appF.indexOf('function mrpGoSettled('), appF.indexOf('async function foRestart('));
  ok('จอ: ป้ายจบเรื่องแล้วกางใบเป้าหมายทั้ง short (fsFold) และ over (foFold) ก่อนสลับแท็บ',
     /if \(over\) foFold\[po\] = false; else fsFold\[po\] = false;/.test(go)
     && go.indexOf('foFold[po] = false') < go.indexOf("tab.value = over ? 'fover' : 'fshort'"));
}
ok('จอ: ป้ายที่มี via เป็นปุ่มเรียก mrpGoSettled · ตาราง short / ยกเลิก short / ยกเลิก over ติด data-fid ให้หาแถวเจอ',
   mrpHtml.includes('@click="mrpGoSettled(l, r.po)"')
   // หน้า short / over จัดกลุ่มราย PO (21 พ.ย. 2026): แถวเรื่องทุกปุ่มกรอง (รอของ · ปิดแล้ว · ยกเลิก) ติด data-fid
   && (html.match(/<tr v-for="r in g\.items" :key="r\.s\.id" class="fol-it" :data-fid="r\.s\.id">/g) || []).length === 4
   && (html.match(/<tr v-for="x in g\.items" :key="x\.s\.id" class="fol-it" :data-fid="x\.s\.id">/g) || []).length === 2);

ok('จอ: ปุ่มกลับไป MRP ขึ้นเฉพาะตอนอยู่แท็บ short / over · แถวรหัสใน MRP ติด data-mrp-line ให้กลับมาถึงแถวเดิม',
   html.includes(`v-if="mrpBack && (tab === 'fshort' || tab === 'fover')"`) && html.includes('@click="mrpGoBack"')
   && mrpHtml.includes(`:data-mrp-line="r.po + '|' + l.code"`)
   && /mrpBack\.value = \{ po, code: l\.code \}/.test(readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8')));

ok('จอ: กดไป / กลับ ตั้ง pin ให้แถวขึ้นเสมอ · ตาราง short ใช้ sliceKeep · ตาราง MRP ใช้ mrpKeep · เปลี่ยนตัวกรองแล้วล้าง pin',
   ((a) => a.includes('followPin.value = v.id;') && a.includes('if (b) mrpPin.value = b.po;')
     && a.includes('sliceKeep(fsAll.value, SHOW_MAX, r => r.s.id === followPin.value)')
     && a.includes('mrpKeep(mrpAll.value,') && a.includes('หาแถวของเรื่องนี้ไม่เจอ — เรื่องนี้อาจยังไม่มีเจ้าของ') && a.includes("watch([mrpQ, mrpFilter, mrpDone], () => { mrpPin.value = ''; });"))
   (readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8')));

console.log('\n=== ยอดคงคลังราย PO (เจ้าของสั่ง 18 พ.ย. 2026) ===');
{
  const { makeEntry, voidEntry } = await import('../v2/core/ledger.js');
  const { poStocks, poMoves, poStockOf } = await import('../v2/core/balance.js');
  const { poHeaderIndex } = await import('../v2/master/po-kit.js');
  const mk = (kind, code, qty, po, x = {}) => makeEntry({ entity: EN, person: 'สมชาย', kind, material_code: code, qty, doc_ref: po,
    ...(kind === 'receive' ? { lot: 'L1' } : {}), ...(kind === 'sendback' ? { reason_code: 'over' } : {}), ...x });
  const P1 = 'TM0001H961', P2 = 'TM0001H962';
  const es = [mk('receive', A, 20, P1, { at: '2026-11-02T01:00:00.000Z' }), mk('issue', A, 15, P1, { at: '2026-11-03T01:00:00.000Z' }),
              mk('sendback', A, 2, P1, { at: '2026-11-04T01:00:00.000Z' }), mk('issue', B, 3, P1),
              mk('receive', X, 4, P1), voidEntry(mk('issue', A, 99, P1), { by: 'ก', reason: 'คีย์ผิด' }),
              mk('receive', A, 7, P2), mk('issue', A, 7, P2), mk('issue', A, 5, ''),
              makeEntry({ entity: 'OTHER', person: 'ข', kind: 'issue', material_code: A, qty: 50, doc_ref: P1 })];
  const st = poStocks(es, EN);
  ok('ยอดราย PO = poStockOf ทุกใบทุกรหัส (หน้าจ่ายออกกับหน้ายอดคงคลังห้ามคนละเลข)',
     [...st].every(([po, m]) => [...m].every(([c, r]) => JSON.stringify(r) === JSON.stringify(poStockOf(es, EN, po).get(c)))) && st.size === 2);
  const head = poHeaderIndex(poList);
  const [r1] = stockPnRows(st, { headerOf: head, bomRowsOf });
  ok('P/N เดียวรวมทุก PO ของมัน · PO เรียงวันที่เก่าก่อน · วันที่เก่าสุด',
     r1.pn === 'PN-A' && r1.pos.map(p => p.po).join() === [P1, P2].join() && r1.oldest === '2026-11-01');
  ok('วัตถุดิบ: รหัสตาม BOM ก่อน แล้วรหัสนอก BOM', r1.lines.map(l => l.code + (l.inBom ? '' : '*')).join() === [A, B, X + '*'].join());
  const la = r1.lines[0];
  ok('ยอดของ P/N = ผลรวมยอดราย PO · ไม่นับที่ยกเลิก / นิติบุคคลอื่น / ไม่ใส่ PO (A3)',
     la.bal === 3 && la.issued === 22 && la.recv === 27 && r1.lines[1].bal === -3 && r1.nNeg === 1 && r1.nLeft === 3, JSON.stringify(la));
  ok('กางวัตถุดิบ: ยอดแยกราย PO ตรงกับ poStockOf ทุกใบ',
     la.byPo.map(p => p.po + ':' + p.bal).join() === `${P1}:3,${P2}:0` && la.byPo.every(p => p.bal === poStockOf(es, EN, p.po).get(A).bal));
  ok('แยกราย PO มี PO qty. จากไฟล์ PO', la.byPo[0].order === 10);
  {
    // ยอดตามสูตร (เจ้าของสั่ง 22 พ.ย. 2026 — ให้เห็นว่าจ่ายถูกจ่ายผิด) · A ใช้ 2 · B ใช้ 0.5 · ทั้งสองใบสั่ง 10
    const lb = r1.lines[1], lx = r1.lines[2];
    ok('ตาม BOM ราย PO = ใช้ต่อชิ้น × PO qty. · จ่ายเทียบ BOM = จ่ายออก − ตาม BOM',
       la.byPo.map(p => p.po + ':' + p.need + ':' + p.issueDiff).join() === `${P1}:20:-5,${P2}:20:-13`, JSON.stringify(la.byPo));
    ok('ตาม BOM ของวัตถุดิบ = รวมทุก PO ที่นับ · จ่ายเทียบ BOM จากยอดรวม', la.usage === 2 && la.need === 40 && la.issueDiff === -18);
    ok('รหัสในสูตรขึ้นครบทุก PO แม้ใบนั้นยังไม่เคลื่อนไหว (ยอด 0 · ค้างจ่ายเต็มสูตร) · ยอดคงเหลือไม่เปลี่ยน',
       lb.byPo.map(p => p.po + ':' + p.issued + ':' + p.need + ':' + p.bal).join() === `${P1}:3:5:-3,${P2}:0:5:0`
       && lb.need === 10 && lb.issueDiff === -7 && lb.bal === -3, JSON.stringify(lb.byPo));
    ok('รหัสนอกสูตร: ตาม BOM = null (ไม่เดาเป็น 0)', lx.usage === null && lx.need === null && lx.issueDiff === null && lx.byPo[0].need === null);
    const hd2 = po => (po === P2 ? { pn: 'PN-A', date: '2026-11-02', order: 0 } : head(po));
    const [r3] = stockPnRows(st, { headerOf: hd2, bomRowsOf });
    ok('ใบที่ไม่รู้ PO qty.: ตาม BOM ของใบ = null และยอดรวมเป็น null ด้วย (ห้ามรวมแค่บางใบ)',
       r3.lines[0].byPo[1].need === null && r3.lines[0].byPo[0].need === 20 && r3.lines[0].need === null && r3.lines[0].issueDiff === null);
    const [r4] = stockPnRows(st, { headerOf: head, bomRowsOf: () => [{ code: A, usage: 0 }, { code: A, usage: 3 }] });
    ok('สูตรมีรหัสซ้ำ: ใช้บรรทัดแรกที่ใช้ > 0 แบบ mrpRows', r4.lines[0].usage === 3 && r4.lines[0].byPo[0].need === 30);
    ok('ป้ายจ่ายเทียบ BOM: เกิน · ยังจ่ายไม่ครบ = ไม่มีป้าย (เจ้าของสั่ง 27 พ.ย. 2026) · ครบ (เศษหลักที่ 5 นับว่าครบ) · null',
       [bpDiffLabel(2.5), bpDiffLabel(-7), bpDiffLabel(0), bpDiffLabel(0.00001), bpDiffLabel(null)].map(x => x.join(':')).join()
       === 'จ่ายเกิน 2.5:bad,:,ครบ:ok,ครบ:ok,—:');
    const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    ok('จอ: คอลัมน์ ตาม BOM / จ่ายเทียบ BOM ทั้งแถววัตถุดิบและแถวราย PO',
       html.includes('{{ mrpNum(l.need) }}') && html.includes('{{ mrpNum(p.need) }}')
       && html.includes('bpDiffLabel(l.issueDiff)[0]') && html.includes('bpDiffLabel(p.issueDiff)[0]'));
    ok('จอ: ป้ายขึ้นเฉพาะครบ / จ่ายเกิน · ยังจ่ายไม่ครบ = ช่องว่าง ไม่ใช่ "—" · ไม่รู้ยอดตาม BOM = "—"',
       html.includes('<span v-if="bpDiffLabel(l.issueDiff)[1]" class="tag"')
       && html.includes('<span v-else-if="bpDiffLabel(p.issueDiff)[1]" class="tag"')   // แถว PO: จ่ายเกินเป็นปุ่มกดแก้ (28 พ.ย. 2026) ที่เหลือเป็นป้ายเหมือนเดิม
       && ['l', 'p'].every(v => html.includes(`<span v-else-if="${v}.issueDiff == null" class="hint">—</span>`)));
    ok('จอ: ป้าย "จ่ายเกิน" ของแถว PO กดแล้วเปิดกล่องแก้ (bpFixOpen) ไม่พับ/กางแถว',
       /<button v-if="bpDiffLabel\(p\.issueDiff\)\[1\] === 'bad'" class="tag bad bp-frac"[^>]*@click\.stop="bpFixOpen\(r\.pn, p\.po, l\.code\)"/.test(html));
    ok('จอ: ไม่มีคอลัมน์ส่งคืน Delta แล้ว — ยอดส่งคืนขึ้นเป็นตัวสีเหลืองใต้ยอดจ่ายออก (ของออกจากคลัง · เจ้าของสั่ง 22 พ.ย. 2026)',
       html.includes('{{ mrpNum(l.issued) }}<div v-if="l.sendback" class="bp-sb">') && html.includes('{{ mrpNum(p.issued) }}<div v-if="p.sendback" class="bp-sb">')
       && !html.includes('l.sendback ? mrpNum(l.sendback)') && !html.includes('p.sendback ? mrpNum(p.sendback)'));
    ok('จอ: บรรทัดส่งคืน Delta ในรายการเคลื่อนไหวเป็นสีเหลือง (เจ้าของสั่ง 22 พ.ย. 2026)',
       html.includes(`<td :style="m.e.kind === 'sendback' ? 'color:var(--warn);font-weight:600' : ''">{{ m.label }}</td>`)
       && html.includes(`m.e.kind === 'sendback' ? 'color:var(--warn);font-weight:600'`));
  }
  {
    const app = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8'), html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    ok('ยอดติดลบราย PO กดแล้วไปแท็บ Log จ่ายออก ค้น PO + รหัส ทุกวันที่ · มีปุ่มกลับไปยอดคงคลัง (เจ้าของสั่ง 19 พ.ย. 2026)',
       html.includes('v-if="p.bal < 0" class="bp-lnk" @click.stop="bpGoLog(p.po, l.code, r.pn)"')
       && app.includes("Object.assign(lg, { from: '', to: '', q: po + ' ' + code, voided: false });") && app.includes("tab.value = 'lgout';")
       && html.includes('v-if="bpBack && tab === \'lgout\'"') && app.includes('Object.assign(lg, b.lg);'));
    ok('กลับมาแล้วบรรทัดถูกซ่อน (ยกเลิกแล้วไม่ติดลบ) เลื่อนไปแถว P/N แทน', html.includes(':data-bpn="r.pn"') && app.includes('[data-bpn="${CSS.escape(b.pn)}"]'));
  }
  {
    // จ่ายผิดใบ: ใบหนึ่งติดลบ อีกใบบวกหายกันพอดี — ยอดรวม 0 แต่ห้ามหายจากจอ และต้องขึ้นป้าย "จ่ายเกินรับ"
    const es2 = [mk('receive', A, 20, P1), mk('issue', A, 25, P1), mk('receive', A, 20, P2), mk('issue', A, 15, P2)];
    const [r2] = stockPnRows(poStocks(es2, EN), { headerOf: head, bomRowsOf }), l2 = r2.lines[0];
    ok('จ่ายผิดใบ: ยอดรวม 0 แต่ใบหนึ่งติดลบ → ไม่ถูกซ่อน และนับเป็น "จ่ายเกินรับ"',
       l2.bal === 0 && l2.byPo.map(p => p.bal).join() === '-5,5' && l2.live && l2.neg
       && !r2.empty && r2.nLeft === 1 && r2.nNeg === 1,
       JSON.stringify({ bal: l2.bal, live: l2.live, neg: l2.neg, nLeft: r2.nLeft, nNeg: r2.nNeg, empty: r2.empty }));
    const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    ok('จอ: ตัวกรองบรรทัดวัตถุดิบกับช่องค้นหาใช้ l.live (ไม่ใช่ยอดรวม) จะได้ไม่ซ่อนใบที่ติดลบ',
       html.includes('r.lines.filter(x => bpFull[r.pn] || x.live)')
       && readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8').includes('r.lines.some(l => l.live && l.code.includes(q))'));
  }
  {
    /* รหัสนอกสูตรที่เคลื่อนไหวหลายใบ ต้องรวมครบทุกใบ (ผู้ตรวจ #184 รอบ 1)
     * เดิมลูปรหัสนอกสูตรเช็ก lines.has(code) ทั้งที่ตัวมันเองใส่รหัสนั้นเข้า lines → ใบที่ 2 ขึ้นไปหายทั้งก้อน */
    const es4 = [mk('receive', A, 20, P1), mk('issue', A, 10, P1),
                 mk('receive', X, 4, P1), mk('issue', X, 1, P1),
                 mk('receive', X, 9, P2), mk('issue', X, 2, P2)];
    const st4 = poStocks(es4, EN);
    const lx4 = stockPnRows(st4, { headerOf: head, bomRowsOf })[0].lines.find(l => l.code === X);
    ok('รหัสนอกสูตรที่เคลื่อนไหวสองใบ: กางได้ครบสองใบ และยอดรวม = ผลรวมทั้งสองใบ',
       lx4.byPo.map(p => p.po).join() === [P1, P2].join()
       && lx4.recv === 13 && lx4.issued === 3 && lx4.bal === 10
       && lx4.byPo.every(p => JSON.stringify(poStockOf(es4, EN, p.po).get(X)) ===
                              /* ลำดับ key ต้องตรงกับที่ poStockOf คืน: recv, sendback, issued, frac, bal */
                              JSON.stringify({ recv: p.recv, sendback: p.sendback, issued: p.issued, frac: p.frac, bal: p.bal })),
       JSON.stringify({ recv: lx4.recv, issued: lx4.issued, bal: lx4.bal, byPo: lx4.byPo.map(p => p.po + ':' + p.bal) }));
    // กลุ่ม "ไม่รู้ P/N" ไม่มีรหัสในสูตรเลย (bomRowsOf ไม่ถูกเรียก) ทุกรหัสจึงเดินผ่านลูปนี้ → โดนหนักสุด
    const N1 = 'TM0009001', N2 = 'TM0009002';
    const es5 = [mk('receive', A, 100, N1), mk('issue', A, 40, N1), mk('sendback', A, 1, N1),
                 mk('receive', A, 60, N2), mk('issue', A, 10, N2)];
    const r5 = stockPnRows(poStocks(es5, EN), { headerOf: head, bomRowsOf }).find(g => g.pn === '');
    ok('กลุ่มไม่รู้ P/N: รหัสเดียวกันสองใบ ยอดรวมครบทั้งสองใบ (ไม่ใช่เหลือใบแรกใบเดียว)',
       r5.lines.length === 1 && r5.lines[0].recv === 160 && r5.lines[0].issued === 50
       && r5.lines[0].sendback === 1 && r5.lines[0].bal === 109 && r5.lines[0].byPo.length === 2,
       JSON.stringify(r5.lines));
  }
  {
    /* ใบที่แท็บ MRP ไม่มีแถวให้เลย ไม่ใช่ "ใบที่ปิดแล้ว" แต่คือใบที่ MRP ตัดสินไม่ได้ — ห้ามซ่อน (B4 · ผู้ตรวจ #175 รอบ 2)
     * มีแต่รายการจ่ายออก จึงไม่อยู่ใน started · มี plan แต่ไม่มีใบนี้ใน plan → mrpRows ไม่สร้างแถว */
    const BAD = 'TM0001H888', P4 = 'TM0001H964';   // BAD = พิมพ์เลข PO ผิด (ไม่อยู่ในไฟล์ PO) · P4 = อยู่ในไฟล์ PO แต่ยังไม่เคยรับเข้า
    const es3 = [mk('issue', A, 5, BAD), mk('issue', A, 5, P4), mk('receive', A, 1, 'TM0001H961'), mk('receive', A, 1, 'TM0001H967')];
    const PL3 = planMap([{ po: 'TM0001H961', week: 'WK1', qty: 10, shipped: 0, left: 10 },
                         { po: 'TM0001H967', week: 'WK1', qty: 10, shipped: 10, left: 0 }]);   // ส่งครบ = จบ (จอซ่อน)
    const app0 = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
    const rs3 = mrpRows(es3, EN, { poList, bomRowsOf, plan: PL3, today: TODAY });
    ok('ใบที่มีแต่จ่ายออก (เลข PO ผิด / จ่ายก่อนรับ) แท็บ MRP ไม่มีแถวให้',
       !rs3.some(r => r.po === BAD || r.po === P4), rs3.map(r => r.po).join());
    const keep = openPoKeep(rs3);
    ok('ตัวกรอง "ยังไม่ปิด" ปล่อยใบที่ MRP ไม่มีแถวให้ผ่าน (ปิดแล้ว ≠ ตัดสินไม่ได้)',
       keep(BAD) && keep(P4) && keep('TM0001H961') && !keep('TM0001H967'));
    const got = stockPnRows(poStocks(es3, EN), { headerOf: head, bomRowsOf, keepPo: keep });
    const poBal = pn => (got.find(r => r.pn === pn)?.lines.find(l => l.code === A)?.byPo || []).map(p => p.po + ':' + p.bal).join();
    ok('ยอดติดลบของใบที่พิมพ์เลข PO ผิด ยังเห็นในมุมมองเริ่มต้น', poBal('') === BAD + ':-5', poBal(''));
    ok('ยอดติดลบของใบที่คีย์จ่ายก่อนรับ (ไม่มีใน plan) ยังเห็น · ใบที่ plan บอกว่าส่งครบยังถูกซ่อนตามเดิม',
       poBal('PN-A') === 'TM0001H961:1,' + P4 + ':-5', poBal('PN-A'));
    ok('ต่อสายตัวกรองเข้าหน้ายอดคงคลัง (openPoKeep ไม่ใช่ Set ของใบที่ยังไม่ปิด)',
       app0.includes('mrpErr.value ? null : openPoKeep(mrpAll.value)') && app0.includes('keepPo: bpClosed.value ? null : bpOpenPos.value'));
  }
  {
    /* กดแถวแล้ว "กาง" ได้จริงไหม — ของที่เทสแบบอ่านซอร์สจับไม่ได้ (ผู้ตรวจ #175 รอบ 3 ข้อ 1)
     * เดิมตัวเก็บสถานะเป็น ref() แล้วเทมเพลตส่งตัวมันเข้า flip() · Vue แกะ ref ให้ก่อนส่งเข้าฟังก์ชันเสมอ
     * (proxyRefs — กับดักเดียวกับ CLAUDE.md §8.1) ฟังก์ชันจึงได้อ็อบเจกต์ธรรมดา แล้ว r.value เป็น undefined
     * → TypeError เงียบ ๆ ทั้งสี่ชั้น เพราะ vue.global.prod.js ไม่เตือนอะไร
     * ที่นี่จึงเอา @click จริงจากเทมเพลต มาคอมไพล์ด้วย Vue ตัวจริงแล้ว "กด" — ไม่ต้องเปิดเบราว์เซอร์ */
    const app = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    const Vue = new Function(readFileSync(new URL('../v2/lib/vue.global.prod.js', import.meta.url), 'utf8') + '\nreturn Vue;')();
    globalThis.Vue = Vue;   // โค้ดที่ compile() สร้างอ้าง Vue ตัวโกลบอล เหมือนตอนรันในเบราว์เซอร์
    const { ref, reactive, computed, proxyRefs, compile } = Vue;
    const srcLine = k => {
      const i = app.indexOf(k);
      if (i < 0) throw new Error('หาไม่เจอใน app.js: ' + k);
      return app.slice(app.lastIndexOf('\n', i) + 1, app.indexOf('\n', i));
    };
    const make = new Function('ref', 'reactive',
      [srcLine('bpOpen = '), srcLine('const bpKey = '), srcLine('const flip = ')].join('\n')
      + '\nreturn { bpOpen, bpCode, bpLine, bpFull, bpKey, flip };');
    // ctx = สิ่งที่เทมเพลตเห็นจริง (ค่าที่ setup() คืน ถูก proxyRefs แกะ ref ให้ก่อนเสมอ)
    const ctx = proxyRefs({ ...make(ref, reactive), r: { pn: 'PN-A' }, l: { code: 'AC01' }, p: { po: P1 } });
    const press = ex => { compile(`<button @click="${ex}"></button>`)(ctx).props.onClick(); };
    const shown = computed(() => [ctx.bpOpen['PN-A'], ctx.bpCode[ctx.bpKey('PN-A', 'AC01')],
                                  ctx.bpLine[ctx.bpKey(P1, 'AC01')], ctx.bpFull['PN-A']].map(v => !!v).join());
    const clicks = [...html.matchAll(/@click(?:\.stop)?="(flip\([^"]*\))"/g)].map(m => m[1]);
    ok('เทมเพลตมีจุดกดกางครบสี่ชั้น (P/N · วัตถุดิบ · ราย PO · แสดงทุกรายการตาม BOM)',
       clicks.length === 4 && new Set(clicks).size === 4, clicks.join(' · '));
    const before = shown.value;   // ต้องอ่านก่อนกด ให้ computed ติด cache — ตัวเก็บที่ไม่ reactive จะไม่แจ้งให้วาดใหม่
    let err = '';
    try { clicks.forEach(press); } catch (e) { err = String(e.message); }
    ok('กดแถวแล้วกางได้จริงทั้งสี่ชั้น และจอรู้ว่าค่าเปลี่ยน (เทมเพลตแกะ ref ให้ก่อนส่งเข้า flip)',
       before === 'false,false,false,false' && !err && shown.value === 'true,true,true,true', err || before + ' → ' + shown.value);
    let err2 = '';
    try { clicks.forEach(press); } catch (e) { err2 = String(e.message); }
    ok('กดซ้ำพับกลับได้', !err2 && shown.value === 'false,false,false,false', err2 || shown.value);
  }
  ok('นับเฉพาะ PO ที่ส่ง keepPo (ใบที่ยังไม่ปิด)', stockPnRows(st, { headerOf: head, bomRowsOf, keepPo: po => po === P2 })[0].lines[0].bal === 0);
  ok('ทุกรหัสเหลือ 0 = ของหมดแล้ว (จอซ่อนไว้)', stockPnRows(st, { headerOf: head, bomRowsOf, keepPo: po => po === P2 })[0].empty && !r1.empty);
  ok('รหัสใน BOM ที่ยังไม่เคยรับ ขึ้นเป็น 0', stockPnRows(new Map([[P1, new Map()]]), { headerOf: head, bomRowsOf })[0].lines.length === 2);
  ok('PO ที่ยังไม่นำเข้าไฟล์ (ไม่รู้ P/N) รวมไว้ท้ายสุด',
     stockPnRows(new Map([['TM9', new Map()], [P1, new Map()]]), { headerOf: head, bomRowsOf }).map(r => r.pn).join() === 'PN-A,');
  const mv = poMoves(es, EN, P1, A);
  ok('รายการเคลื่อนไหวของรหัสใน PO: เรียงเก่าไปใหม่ · คงเหลือสะสมจบที่ยอดของใบ',
     mv.map(m => m.qty).join() === '20,-15,-2' && mv[mv.length - 1].run === la.byPo[0].bal, JSON.stringify(mv.map(m => [m.qty, m.run])));
  throws('poStocks ลืมส่ง entity ไม่ได้ (A3)', () => poStocks(es, ''), 'นิติบุคคล');
  throws('poMoves ลืมส่ง entity ไม่ได้ (A3)', () => poMoves(es, '', P1, A), 'นิติบุคคล');
}

console.log('\n=== ช่องกางไม่ดันตารางล้นขวา (เจ้าของแจ้ง 22 พ.ย. 2026) ===');
{
  // "PO ที่นับ" ของ P/N ที่มีหลายใบเป็นบรรทัดเดียวยาว — ถ้าห้ามขึ้นบรรทัดใหม่ (สืบจาก .mrp td) ตารางทั้งก้อนล้นจอ ตัวเลขหลุดขวา
  const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: .mrp-in ให้ข้อความขึ้นบรรทัดใหม่ได้ (white-space:normal)', /\.mrp-in\{[^}]*white-space:normal/.test(html));
  ok('จอ: บรรทัด "PO ที่นับ" ยังอยู่ใน .mrp-in', /<div class="mrp-in">\s*<div class="hint">PO ที่นับ:/.test(html));
}

console.log('\n=== จ่ายออกทีละ PO จากหน้ายอดคงคลัง (เจ้าของสั่ง 25 พ.ย. 2026) ===');
{
  const { poIssueCheck } = await import('../v2/master/mrp.js');
  // ตาม BOM 3 · รับ 2.604 · ยังไม่จ่าย → จ่ายได้สูงสุด = คงเหลือ 2.604 (น้อยกว่าที่ BOM ยังให้จ่าย)
  const p = { need: 3, recv: 2.604, sendback: 0, issued: 0, bal: 2.604 };
  const a = poIssueCheck(p, 2.604);
  ok('จ่ายเท่าคงเหลือพอดี = ผ่าน · จ่ายได้สูงสุด = min(ตาม BOM − จ่ายแล้ว, คงเหลือ PO)', a.ok && a.max === 2.604 && a.bomLeft === 3);
  ok('เกินคงเหลือของ PO นี้ (ของที่รับเข้ามา) = ไม่ผ่าน · ไม่เผื่อเศษ', !poIssueCheck(p, 2.605).ok && poIssueCheck(p, 2.605).overRecv);
  // ตาม BOM 10 · จ่ายไปแล้ว 8 · ยังมีของ 5 → จ่ายสะสมเกิน BOM ถ้าครั้งนี้เกิน 2
  const q = { need: 10, recv: 13, sendback: 0, issued: 8, bal: 5 };
  ok('จ่ายสะสมเกิน BOM = ไม่ผ่าน แม้ยังมีของ', poIssueCheck(q, 2).ok && !poIssueCheck(q, 2.5).ok && poIssueCheck(q, 2.5).overBom
     && !poIssueCheck(q, 2.5).overRecv && poIssueCheck(q, 0).max === 2);
  ok('จ่ายเกิน BOM ไปแล้ว: จ่ายได้สูงสุด 0 · จ่ายเพิ่มไม่ได้', poIssueCheck({ need: 5, issued: 6, bal: 3 }, 1).max === 0
     && !poIssueCheck({ need: 5, issued: 6, bal: 3 }, 1).ok);
  ok('ไม่รู้ยอดตาม BOM (นอกสูตร / ไม่รู้ PO qty.) = ใช้แค่คงเหลือ PO', poIssueCheck({ need: null, issued: 0, bal: 40 }, 40).ok
     && poIssueCheck({ need: null, issued: 0, bal: 40 }, 0).bomLeft === null && !poIssueCheck({ need: null, issued: 0, bal: 40 }, 41).ok);
  ok('0 · ว่าง · ติดลบ = ยังจ่ายไม่ได้', [0, null, '', -1].every(x => !poIssueCheck(p, x).ok));
  ok('คงเหลือติดลบ: จ่ายได้สูงสุด 0', poIssueCheck({ need: 10, issued: 12, bal: -2 }, 0).max === 0);

  // จอ: ปุ่มจ่ายอยู่ท้ายแถว PO ใต้วัตถุดิบ · กดแล้วไม่พับแถว · ปุ่มบันทึกปิดเมื่อไม่ผ่าน · ไม่มีทางลัดไปหน้าจ่ายออก (#178)
  const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('จอ: ปุ่ม "จ่าย" ท้ายแถว PO เรียก bpIssOpen(r.pn, p.po, l.code) แบบ @click.stop',
     /@click\.stop="bpIssOpen\(r\.pn, p\.po, l\.code\)">จ่าย<\/button>/.test(html));
  ok('จอ: ปุ่มบันทึกปิดเมื่อไม่ผ่านกฎ / ไม่มีชื่อผู้จ่าย / ไม่มีชื่อผู้เบิก / ไม่มีวันที่',
     /@click="bpIssSave"\s*:disabled="!bpIssChk \|\| !bpIssChk\.ok \|\| !bpIss\.person \|\| !bpIss\.requester \|\| !bpIss\.date"/.test(html));
  ok('จอ: มีช่องชื่อผู้เบิก ต่อจากชื่อผู้จ่าย (เจ้าของขอ 28 พ.ย. 2026)',
     /ชื่อผู้จ่าย<input v-model\.trim="bpIss\.person"><\/label>\s*<label class="f grow">ชื่อผู้เบิก<input v-model\.trim="bpIss\.requester"/.test(html));
  ok('app.js: เปิดกล่องตั้งวันที่เป็นวันนี้ · บันทึกเช็กกฎซ้ำก่อนเขียน · อ้าง PO ของปุ่มที่กด',
     /bpIssOpen\(pn, po, code\) \{\s*Object\.assign\(bpIss, \{ open: true, pn, po, code, date: todayLocal\(\)/.test(app)
     && /if \(!c \|\| !c\.ok \|\| !bpIss\.person \|\| !bpIss\.requester \|\| !bpIss\.date\) return;/.test(app) && /doc_ref: bpIss\.po, part_no: bpIss\.pn/.test(app));
  ok('app.js: ผู้เบิกลงหมายเหตุเป็น "ผู้เบิก: ชื่อ" (ไม่เพิ่มช่องใหม่ ไม่ต้องแก้ Apps Script) · เปิดกล่องใหม่ล้างชื่อผู้เบิก',
     /note: 'ผู้เบิก: ' \+ bpIss\.requester/.test(app) && /date: todayLocal\(\), requester: '', qty: null/.test(app));
  ok('ไม่มีทางลัดพาไปหน้าจ่ายออก (goIssue) กลับมา', !/goIssue/.test(app));
}

console.log('\n=== แก้รายการจ่ายเกิน BOM จากหน้ายอดคงคลัง (เจ้าของสั่ง 28 พ.ย. 2026) ===');
{
  const { poFixCheck } = await import('../v2/master/mrp.js');
  // เศษ: ตาม BOM 0.0212 · จ่ายไป 0.0216 ครั้งเดียว → แนะนำ 0.0212 แล้วพอดี BOM
  const crumb = { need: 0.0212, issued: 0.0216 };
  const a = poFixCheck(crumb, 0.0216, 0.0212);
  ok('เศษเกิน: แนะนำจำนวนที่ทำให้พอดี BOM · แก้แล้วเกิน 0', a.ok && a.suggest === 0.0212 && a.after === 0.0212 && a.afterDiff === 0);
  // คีย์ซ้ำ: ตาม BOM 100 · จ่าย 100 สองครั้ง → แนะนำ 0 (รายการนี้ไม่ควรมี) · ใส่ 0 = ยกเลิกอย่างเดียว
  const dup = { need: 100, issued: 200 };
  ok('คีย์ซ้ำ: แนะนำ 0 · ใส่ 0 ได้ (ยกเลิกอย่างเดียว)', poFixCheck(dup, 100, 0).ok && poFixCheck(dup, 100, 0).suggest === 0
     && poFixCheck(dup, 100, 0).afterDiff === 0);
  ok('ลดได้อย่างเดียว — เท่าเดิม / มากกว่าเดิม / ติดลบ / ว่าง ไม่ผ่าน',
     !poFixCheck(dup, 100, 100).ok && poFixCheck(dup, 100, 100).bigger && !poFixCheck(dup, 100, 150).ok
     && !poFixCheck(dup, 100, -1).ok && [null, '', 'x'].every(x => !poFixCheck(dup, 100, x).ok && poFixCheck(dup, 100, x).qty === null));
  // เกินหลายรายการ: ลดรายการเดียวแล้วยังเกิน → บันทึกได้ จอบอกยอดที่ยังเกิน
  const many = { need: 10, issued: 16 };
  ok('ลดแล้วยังเกิน BOM อยู่ = บันทึกได้ · afterDiff บอกยอดที่ยังเกิน · แนะนำไม่ต่ำกว่า 0',
     poFixCheck(many, 3, 0).ok && poFixCheck(many, 3, 0).afterDiff === 3 && poFixCheck(many, 3, 0).suggest === 0);
  ok('ไม่รู้ยอดตาม BOM: ลดได้ · ไม่มีคำแนะนำ', poFixCheck({ need: null, issued: 5 }, 5, 2).ok
     && poFixCheck({ need: null, issued: 5 }, 5, 2).suggest === null && poFixCheck({ need: null, issued: 5 }, 5, 2).afterDiff === null);
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
