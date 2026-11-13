/**
 * เทสแท็บ MRP ราย PO — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์
 *   node tests/v2-mrp.test.mjs
 *
 * เลข PO · รหัสวัตถุดิบ · จำนวน ในไฟล์นี้ **สมมติขึ้นทั้งหมด** (repo นี้เป็น public)
 */
import { readFileSync } from 'node:fs';
import { mrpRows, mrpMatch, mrpLineLabel, mrpNum, mrpNoPoIssues, fillPoDate, MRP_FILTERS, MRP_SEG, MRP_FRESH_DAYS,
         mrpOrder, planShipList, planMap, planWeek } from '../v2/master/mrp.js';
import { makeFollow, closeFollow, skipShort, cancelShort, shortAll, shortPending, OVER_MIN } from '../v2/master/follow.js';

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
ok('ไม่มี WK (ยังไม่ได้ดึง plan) = เรียงตามวันที่ PO', rows.map(r => r.date || '~').join() === [...rows.map(r => r.date || '~')].sort().join());

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
const skipped = skipShort(calcB, { entity: EN, person: 'ก' });
const r962 = fl => run({ follows: fl }).find(r => r.po === 'TM0001H962');
ok('ไม่ติดตาม = skip นับว่าครบ · การ์ดก็ไม่ขึ้น', r962([skipped]).state === 'ok' && r962([skipped]).nSkip === 1
   && shortPending([calcB], [skipped]).length === 0);
const cancelled = cancelShort(makeFollow({ kind: 'short', type: 'ขาด', source: 'delta', entity: EN, po: 'TM0001H962', code: B, qty: 1 }), { by: 'ก' });
ok('ยกเลิกเรื่อง = skip เหมือนไม่ติดตาม', r962([cancelled]).nSkip === 1);
const closedSame = closeFollow(makeFollow({ kind: 'short', type: 'ขาด', source: 'delta', entity: EN, po: 'TM0001H962', code: B, qty: 1 }), { by: 'ก' });
const closedOdd = closeFollow(makeFollow({ kind: 'short', type: 'ขาด', source: 'delta', entity: EN, po: 'TM0001H962', code: B, qty: 3 }), { by: 'ก' });
ok('ปิดเรื่องด้วยยอดเท่าที่ขาด = skip', r962([closedSame]).nSkip === 1);
ok('ปิดเรื่องด้วยยอดไม่ตรง = ยัง Short — ตรงกับการ์ด', r962([closedOdd]).nShort === 1 && shortPending([calcB], [closedOdd]).length === 1);
ok('เรื่องของนิติบุคคลอื่น = ไม่นับ (A3)', r962([{ ...skipped, entity: 'TUE-U' }]).nShort === 1);
ok('เรื่องที่ยังไม่มีเจ้าของ = นับให้ (sameEntity แบบการ์ด short)', r962([{ ...skipped, entity: '' }]).nSkip === 1);

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
ok('ชื่อชีตต่างแบบ ("Plan WK 31…" กับ "WK 9…") เรียงตามเลขสัปดาห์ ไม่ใช่ตามตัวอักษร',
   [{ week: planWeek('Plan WK 31  1-4.6. 26'), po: 'A' }, { week: planWeek('WK 9  1-3.3.26'), po: 'B' }].sort(mrpOrder)[0].po === 'B');

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
const sorted = [R('', '2026-11-01', 'P1', 'A'), R('WK10', '2026-11-05', 'P2', 'A'), R('WK9', '2026-11-09', 'P3', 'A'),
                R('WK9', '2026-11-02', 'P4', 'A'), R('WK9', '2026-11-02', 'P4', '0'), R('WK9', '', 'P0', 'A')].sort(mrpOrder);
ok('เรียง WK (WK9 ก่อน WK10) → วันที่ → PO → P/N · ไม่มี WK / ไม่มีวันที่ไปท้าย',
   sorted.map(r => r.po + r.pn).join() === 'P40,P4A,P3A,P0A,P2A,P1A', sorted.map(r => r.po + r.pn).join());
const CAT = { '9100000971': 'PACKING', '9100000972': 'CORE', '9100000973': 'WIRE', '9100000974': 'CORE', '9100000975': '', '9100000976': 'TAPE' };
const catBom = { 'PN-C': ['9100000971', '9100000972', '9100000973', '9100000974', '9100000975'].map(code => ({ code, usage: 1 })) };
const cr = mrpRows([mk('receive', 'TM0001H970', '9100000973', 1), mk('receive', 'TM0001H970', '9100000976', 2)], EN,
  { poList: [{ po: 'TM0001H970', pn: 'PN-C', qty: 1, date: TODAY }], bomRowsOf: pn => catBom[pn] || [], today: TODAY,
    catOf: c => CAT[c] || '' })[0];
ok('รหัสในใบเรียงตามหมวด (CORE → WIRE → … → PACKING) แล้วตามรหัส · ไม่มีหมวดไปท้าย · นอกสูตรยังอยู่ท้ายสุด (เจ้าของเคาะ)',
   cr.lines.map(l => l.code.slice(-2)).join() === '72,74,73,71,75,76', cr.lines.map(l => l.code.slice(-2)).join());
ok('ต่อสายหมวดเข้า mrpRows', /plan: planMap\(planShip\.list\), catOf \}/.test(readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8')));
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
ok('ตาราง BOM ไม่มีคอลัมน์จ่ายแล้ว — ปิดใบดูจาก plan แทน (เจ้าของขอ 13 พ.ย. 2026)',
   /<th class="r">รับแล้ว<\/th><th class="mrp-gap"><span>สถานะ<\/span><\/th><\/tr>/.test(mrpHtml) && !mrpHtml.includes('mrpNum(l.issued)'));
ok('ป้ายสถานะเลื่อนด้วย position:relative ไม่ใช่ padding/width — คอลัมน์อื่นต้องไม่เลื่อนตาม (เจ้าของทัก 13 พ.ย. 2026)',
   /\.mrp-bom \.mrp-gap > span\{position:relative;left:/.test(html) && !/\.mrp-gap\{[^}]*width/.test(html));
ok('ใบที่กางมีแถวเว้นที่ว่างทั้งบนและล่าง แยกจากใบข้าง ๆ (เจ้าของขอ 13 พ.ย. 2026)',
   (mrpHtml.match(/<tr v-if="mrpOpen\[r\.po\]" class="mrp-space"/g) || []).length === 2 && /tr\.mrp-space > td\{height:/.test(html));
ok('ใบที่กาง: WK · วันที่ · PO · P/N · PO Qty. ตัวใหญ่ตัวหนา (เจ้าของขอ 13 พ.ย. 2026)', /tr\.mrp-po\.open > td\.mono\{font-size:\d+px;font-weight:700/.test(html));
ok('PO ที่กางอยู่ติดคลาส open + แถวรายละเอียดมีคลาสของตัวเอง ให้ CSS แยกให้เห็นชัด',
   mrpHtml.includes(':class="{ open: mrpOpen[r.po] }"') && mrpHtml.includes('class="mrp-det"') && /tr\.mrp-po\.open > td\{/.test(html));

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
