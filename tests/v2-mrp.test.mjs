/**
 * เทสแท็บ MRP ราย PO — ตรรกะล้วน ไม่ต้องเปิดเบราว์เซอร์
 *   node tests/v2-mrp.test.mjs
 *
 * เลข PO · รหัสวัตถุดิบ · จำนวน ในไฟล์นี้ **สมมติขึ้นทั้งหมด** (repo นี้เป็น public)
 */
import { readFileSync } from 'node:fs';
import { mrpRows, mrpMatch, mrpLineLabel, mrpNum, mrpNoPoIssues, fillPoDate, MRP_FILTERS, MRP_SEG, MRP_FRESH_DAYS } from '../v2/master/mrp.js';
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
ok('ใบที่ยังไม่รับของเลย และเก่ากว่า ' + MRP_FRESH_DAYS + ' วัน = ไม่ขึ้น (ใบก่อนใช้ระบบ — เจ้าของเคาะ)', !at('TM0001H965'));
ok('ใบไม่มีสูตร = คิดไม่ได้ · เหตุตรงกับ shortWhyOf · โชว์รหัสที่รับมา',
   at('TM0001H966').state === 'na' && at('TM0001H966').why.startsWith('ไม่มีสูตรของ PN-Z')
   && at('TM0001H966').lines.length === 1 && at('TM0001H966').lines[0].have === 7);
const unknown = run({ ents: [...ents, mk('receive', 'TM0001H999', A, 4)] }).find(r => r.po === 'TM0001H999');
ok('มีรับเข้าแต่ยังไม่ได้นำเข้าไฟล์ PO = ขึ้นแบบคิดไม่ได้ ไม่หายเงียบ', unknown && unknown.state === 'na' && unknown.why.startsWith('ยังไม่รู้จัก PO'));
ok('เรียงตาม PO', rows.map(r => r.po).join() === [...rows.map(r => r.po)].sort().join());

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
ok('ครบ + จ่ายครบทุกรหัส = จบ', at('TM0001H967').done === true);
ok('ครบแต่ยังจ่ายไม่ครบ = ยังไม่จบ', at('TM0001H961').done === false);
ok('มี Over = ไม่จบ แม้จ่ายครบ', run({ ents: [...ents, mk('receive', 'TM0001H967', A, 5)] }).find(r => r.po === 'TM0001H967').done === false);
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
const issued4 = [...ents, mk('issue', 'TM0001H962', A, 20), mk('issue', 'TM0001H962', B, 4)];
ok('ยอดขาดจบเรื่อง + จ่ายครบเท่าที่รับจริง (4 จาก 5) = จบ', run({ ents: issued4, follows: [skipped] }).find(r => r.po === 'TM0001H962').done === true);

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

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
