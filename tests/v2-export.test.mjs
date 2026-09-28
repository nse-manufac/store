/**
 * เทสการออก Bin Card และเวลาไทย — รันด้วย node
 *   node tests/v2-export.test.mjs
 *
 * หมวด C สำคัญที่สุด — ไฟล์ที่ออกไปมีคนรับต่อ ถ้าหน้าตาเปลี่ยนเขาจะรู้สึกทันที
 * เทสนี้จึงเทียบฟอร์มของ v2 กับของ v1 ตรง ๆ ถ้าวันหนึ่งมีคนแก้ข้างใดข้างหนึ่ง เทสจะดังทันที
 */
import fs from 'node:fs';
import { localDate, localTime, atFrom, todayLocal } from '../v2/core/localtime.js';
import { BINCARD_TPL, toCardLines, sheetNameFor, safeFileName,
         writeBinCard, UNKNOWN_KIND_NOTE, SO_HEAD, SO_SCALE,
         soWidths, textWidth, fitScale, FIT_MAX } from '../v2/export/bincard.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. วันที่ต้องไม่เลื่อนเพราะโซนเวลา ===');
// ปัญหาจริงคือกะเช้าคีย์ตอนตีห้า แล้ววันที่บนการ์ดกลายเป็นเมื่อวาน
const clocks = [
  new Date(2026, 7, 16, 0, 30),   // เที่ยงคืนครึ่ง
  new Date(2026, 7, 16, 5, 0),    // ตีห้า — กะเช้าเข้างาน
  new Date(2026, 7, 16, 12, 0),
  new Date(2026, 7, 16, 23, 45)   // เกือบเที่ยงคืน
];
let allBack = true;
for (const now of clocks) {
  for (const d of ['2026-08-16', '2026-01-01', '2026-12-31', '2025-11-01']) {
    if (localDate(atFrom(d, now)) !== d) {
      allBack = false;
      console.log('    เลื่อน: ' + d + ' ที่เวลา ' + now.getHours() + ' น. → ' + localDate(atFrom(d, now)));
    }
  }
}
ok('เลือกวันไหน แปลงกลับก็ได้วันนั้นเสมอ ไม่ว่าคีย์ตอนกี่โมง', allBack);

// วิธีที่ v1 เตือนไว้ว่าห้ามทำ — ต่อสตริงวันที่เครื่องเข้ากับเวลา UTC
//
// ⚠️ ข้อนี้ขึ้นกับโซนเวลาของเครื่องที่รันเทส
// เครื่องที่อยู่โซน UTC พอดี (เช่น GitHub Actions) วิธีผิดจะดูเหมือนถูก เพราะไม่มีส่วนต่างให้เลื่อน
// เครื่องที่โรงงานอยู่ +7 จึงเจอของจริง — เทสจึงต้องนับจากส่วนต่างของเครื่องเอง
// ไม่ใช่ล็อกเวลาไว้ตายตัวแล้วหวังว่าทุกเครื่องจะให้ผลเหมือนกัน
const naive = (d, now) => d + now.toISOString().slice(10);
const hours = Array.from({ length: 24 }, (_, h) => new Date(2026, 7, 16, h, 30));
const naiveBroken = hours.filter(now => localDate(naive('2026-08-16', now)) !== '2026-08-16').length;
const atFromBroken = hours.filter(now => localDate(atFrom('2026-08-16', now)) !== '2026-08-16').length;
const utc = new Date().getTimezoneOffset() === 0;

ok('atFrom ไม่เลื่อนวันสักชั่วโมงเดียวในยี่สิบสี่ชั่วโมง', atFromBroken === 0, String(atFromBroken));
ok(utc ? 'เครื่องนี้อยู่โซน UTC พอดี วิธีต่อสตริงจึงยังไม่แสดงอาการ (ที่โรงงาน +7 จะเลื่อนจริง)'
       : 'พิสูจน์ว่าวิธีต่อสตริงเลื่อนวันจริง (จึงต้องมี atFrom)',
   utc ? naiveBroken === 0 : naiveBroken > 0,
   'เลื่อน ' + naiveBroken + ' จาก 24 ชั่วโมง');

ok('ไม่มีเวลาก็คืนค่าว่าง ไม่ใช่ NaN', localDate('') === '' && localTime('') === '');
ok('เวลาพังก็ไม่ระเบิด', localDate('ไม่ใช่วันที่') === '');
ok('todayLocal ได้รูปแบบ YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(todayLocal()));

console.log('\n=== B. แปลงบรรทัดในสมุดเป็นบรรทัดบนฟอร์ม ===');
const at = new Date(2026, 7, 16, 9, 5).toISOString();
const lines = toCardLines([
  { kind: 'open', at, moved: 47, balance: 47, person: 'สมชาย', doc_ref: 'C1', note: 'จากการนับ' },
  { kind: 'receive', at, moved: 295, balance: 342, person: 'สมชาย', doc_ref: 'PO-9001',
    part_no: '2870627900', lot: 'LOT-A', expiry_date: '2027-01-01' },
  { kind: 'issue', at, moved: -100, balance: 242, person: 'สมหญิง', part_no: '2870627900',
    lot: 'LOT-A', lot_inferred: true },
  { kind: 'scrap', at, moved: -5, balance: 237, person: 'สมหญิง', reason_code: 'wind' },
  { kind: 'adjust', at, moved: -2, balance: 235, person: 'หัวหน้า', counted_qty: 235 }
], 'MTR');

ok('เลขลำดับเดินทีละหนึ่ง', lines.map(l => l.no).join(',') === '1,2,3,4,5');
ok('รับเข้าอยู่ฝั่งซ้าย', lines[1].direction === 'IN');
ok('จ่ายออกอยู่ฝั่งขวา', lines[2].direction === 'OUT');
ok('ของเสียลงฝั่งจ่าย เพราะทำให้ยอดลดเหมือนกัน', lines[3].direction === 'OUT');
ok('ปรับยอดลงก็อยู่ฝั่งจ่าย', lines[4].direction === 'OUT');
ok('จำนวนบนฟอร์มเป็นบวกเสมอ ทิศทางบอกด้วยคอลัมน์',
   lines.every(l => l.qty >= 0), JSON.stringify(lines.map(l => l.qty)));
ok('ยอดสะสมยกมาตามที่คำนวณไว้แล้ว', lines.map(l => l.bal).join(',') === '47,342,242,237,235');
ok('วันที่กับเวลาแยกคอลัมน์ตามฟอร์ม',
   lines[0].date === '2026-08-16' && lines[0].time === '09:05',
   lines[0].date + ' ' + lines[0].time);

// คนอ่านการ์ดต้องแยกออกว่าของเสียไม่ใช่จ่ายออก ไม่งั้นตัวเลขในฟอร์มจะโกหก
ok('ของเสียเขียนกำกับไว้ในหมายเหตุ', lines[3].remark.includes('ของเสีย'), lines[3].remark);
ok('ปรับยอดเขียนกำกับพร้อมยอดที่นับได้',
   lines[4].remark.includes('ปรับยอด') && lines[4].remark.includes('นับได้ 235'), lines[4].remark);
ok('รับเข้ากับจ่ายออกไม่ต้องกำกับ เพราะมีคอลัมน์ของตัวเองอยู่แล้ว',
   !lines[1].remark.includes('รับเข้า') && !lines[2].remark.includes('จ่ายออก'));
ok('ล็อตติดไปในหมายเหตุ', lines[1].remark.includes('ล็อต LOT-A'));
ok('ล็อตที่ระบบเดาถูกกำกับว่าเดา', lines[2].remark.includes('ระบบเดา'), lines[2].remark);
ok('วันหมดอายุยกไปคอลัมน์ของมัน', lines[1].expiry_date === '2027-01-01');

ok('ชื่อชีตไม่เกิน 31 ตัว', sheetNameFor('4010600100'.repeat(5)).length === 31);
ok('ชื่อชีตตัดอักขระที่ Excel ไม่ยอม', sheetNameFor('A/B:C*D?E[F]') === 'A-B-C-D-E-F-');
ok('ชื่อไฟล์ในซิปตัดอักขระต้องห้าม', safeFileName('METAL/PART') === 'METAL-PART');

console.log('\n=== C. ฟอร์มต้องตรงกับ v1 เป๊ะ ===');
const v1 = fs.readFileSync(new URL('../Stock-log.html', import.meta.url), 'utf8');

const mTpl = /const BINCARD_TPL = (\{.*\});/.exec(v1);
ok('หา BINCARD_TPL ใน v1 เจอ', !!mTpl);
if (mTpl) {
  ok('ค่าสไตล์ทุกช่องตรงกับ v1 ทุกตัว',
     JSON.stringify(JSON.parse(mTpl[1])) === JSON.stringify(BINCARD_TPL),
     'ถ้าตกข้อนี้ แปลว่ามีคนแก้ฟอร์มข้างใดข้างหนึ่งแล้วอีกข้างไม่ตาม');
}

// เทียบตัวโค้ดที่วาดฟอร์มด้วย ไม่ใช่แค่ค่าคงที่
const v2src = fs.readFileSync(new URL('../v2/export/bincard.js', import.meta.url), 'utf8');
const grab = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
};
// เทียบโดยไม่สนขึ้นบรรทัด เพราะ git แปลง CRLF/LF ให้ตอน checkout ตามเครื่องที่ใช้
const nl = s => (s || '').replace(/\r\n/g, '\n');
for (const fn of ['applyTpl', 'writeCard']) {
  const a = nl(grab(v1, fn)), b = nl(grab(v2src, fn));
  ok(`โค้ด ${fn} เหมือนกับ v1 ทุกบรรทัด`, !!a && a === b,
     !a || !b ? 'หาไม่เจอ' : 'ต่างกัน — ถ้าตั้งใจแก้ ต้องแก้ทั้งสองที่พร้อมกัน');
}

console.log('\n=== D. การ์ดที่มีรายการชนิดที่โปรแกรมรุ่นนี้ไม่รู้จัก ===');
// เครื่องรุ่นเก่าคิดชนิดที่ไม่รู้จักเป็นศูนย์ แล้วพิมพ์ลงฝั่งรับเข้าจำนวน 0 — กระดาษไปถึงมือลูกค้าโดยไม่มีใครรู้
// ชีตปลอมเท่าที่ applyTpl/writeCard เรียกใช้ — ExcelJS จริงไม่ได้ติดตั้งในเครื่องที่รันเทส
const fakeWs = () => {
  const cells = new Map();
  const getCell = a => { if (!cells.has(a)) cells.set(a, {}); return cells.get(a); };
  const cols = new Map();
  const getColumn = k => { if (!cols.has(k)) cols.set(k, {}); return cols.get(k); };
  return { cells, cols, getCell, getColumn, getRow: () => ({}), mergeCells() {} };
};
const warnedAt = ws => [...ws.cells.entries()]
  .filter(([, c]) => String(c.value || '').includes(UNKNOWN_KIND_NOTE)).map(([a]) => a);
const withUnknown = toCardLines([
  { kind: 'receive', at, moved: 50, balance: 50, person: 'สมชาย', doc_ref: 'PO1', lot: 'L1' },
  // nextkind แทนชนิดที่ยังไม่มีจริง · เดิมใช้ sendback ซึ่งตอนนี้รู้จักแล้ว (Mat Follow up 5/8)
  { kind: 'nextkind', at, moved: 0, balance: 50, person: 'สมชาย', doc_ref: 'PO1' }
], 'PCS');
ok('บรรทัดที่ไม่รู้จักถูกกำกับไว้ บรรทัดปกติไม่โดน', withUnknown[1].unknownKind === true && withUnknown[0].unknownKind === false);
ok('หมายเหตุบนการ์ดบอกว่าไม่รู้จักและไม่ถูกนับ พร้อมชื่อชนิด',
   withUnknown[1].remark.includes('ไม่รู้จัก') && withUnknown[1].remark.includes('nextkind'), withUnknown[1].remark);
const sb = toCardLines([{ kind: 'sendback', at, moved: -5, balance: 45, person: 'สมชาย', doc_ref: 'PO1' }], 'PCS')[0];
ok('ส่งคืน Delta ลงฝั่งจ่ายออก พร้อมหมายเหตุ "ส่งคืน Delta" ไม่ใช่คำเตือนชนิดที่ไม่รู้จัก (Mat Follow up 5/8)',
   sb.direction === 'OUT' && sb.qty === 5 && sb.remark.includes('ส่งคืน Delta') && sb.unknownKind === false, JSON.stringify(sb));
const ws1 = fakeWs();
const nBad = writeBinCard(ws1, { code: 'C1', unit: 'PCS', entity: 'NSE' }, withUnknown);
ok('คืนจำนวนบรรทัดที่ไม่รู้จักให้หน้าจอบอกคนกด', nBad === 1, String(nBad));
ok('พิมพ์คำเตือนลงการ์ดทั้งเหนือตาราง (B3) และใต้แถวรวม (B31)',
   warnedAt(ws1).includes('B3') && warnedAt(ws1).includes('B31'), warnedAt(ws1).join(','));
ok('ตัวเลขในการ์ดยังเขียนตามปกติ ไม่ถูกคำเตือนทับ', ws1.getCell('G11').value === 50 && ws1.getCell('M12').value === 50);
const ws2 = fakeWs();
ok('การ์ดที่ไม่มีชนิดแปลกไม่มีคำเตือน', writeBinCard(ws2, { code: 'C1', unit: 'MTR', entity: 'NSE' }, lines) === 0
   && warnedAt(ws2).length === 0, warnedAt(ws2).join(','));
const appSrc = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
ok('app.js ออกการ์ดผ่าน writeBinCard ทุกทาง — เรียก writeCard ตรง ๆ = การ์ดหลุดออกไปโดยไม่มีคำเตือน',
   !/\bwriteCard\(/.test(appSrc) && (appSrc.match(/\bwriteBinCard\(/g) || []).length === 2,
   'writeBinCard ' + (appSrc.match(/\bwriteBinCard\(/g) || []).length + ' ที่');

console.log('\n=== E. คอลัมน์ Short / Over ถัดจาก Balance (เจ้าของสั่ง 28 ก.ย. 2026) ===');
{
  const so = toCardLines([
    { kind: 'receive', at, moved: 6, balance: 6, person: 'สมชาย', doc_ref: 'PA', short: 4, over: null, expiry_date: '2027-01-01' },
    { kind: 'receive', at, moved: 5, balance: 11, person: 'สมชาย', doc_ref: 'PA', short: null, over: 1 },
    { kind: 'issue', at, moved: -3, balance: 8, person: 'สมหญิง', doc_ref: 'PA' }
  ], 'PCS');
  ok('toCardLines ส่ง short/over ต่อ · ไม่มี = null', so[0].short === 4 && so[1].over === 1 && so[2].short === null && so[2].over === null);
  const ws = fakeWs();
  writeBinCard(ws, { code: 'C1', unit: 'PCS', entity: 'NSE' }, so);
  const v = a => ws.getCell(a).value;
  ok('หัวตาราง Short · Over อยู่ถัดจาก Balance', v('M9') === 'Balance' && v('N9') === SO_HEAD.N && v('O9') === SO_HEAD.O);
  ok('คอลัมน์เดิมเลื่อนไปขวาสองช่อง ครบทั้งหัวตาราง', v('P9') === 'ผู้เบิก/ผู้รับ' && v('Q9') === 'วันหมดอายุ Raw Material' && v('R9') === 'Remark');
  ok('ค่าในแถวข้อมูล — มียอดใส่ยอด ไม่มีใส่ "-"',
     v('N11') === 4 && v('O11') === '-' && v('N12') === '-' && v('O12') === 1 && v('N13') === '-' && v('O13') === '-');
  ok('ข้อมูลคอลัมน์เดิมเลื่อนตาม (ผู้รับ · วันหมดอายุ) และยอด Balance ไม่ขยับ',
     v('P11') === 'สมชาย' && v('Q11') === '2027-01-01' && v('M12') === 11);
  ok('เลขลำดับคอลัมน์แถว 8 นับต่อถึง 16', v('M8') === 11 && v('N8') === 12 && v('R8') === 16);
  ok('ป้าย No. Doc มุมขวาบนเลื่อนตาม', String(v('R2') || '').startsWith('No. Doc'));
  ok('พื้นที่พิมพ์ขยายถึงคอลัมน์ S', /^A1:S\d+$/.test(ws.pageSetup.printArea), ws.pageSetup.printArea);
  /* ⚠️ ขยายพื้นที่พิมพ์แล้วต้องคุมความกว้างหน้าด้วย ไม่งั้น Remark ยกไปหน้าสองทั้งคอลัมน์
   * (ผู้ตรวจ #117 รอบ 1 ข้อ 1) — ฟอร์มเดิม scale 71 พอดีแค่ A–Q เท่านั้น */
  const ps = ws.pageSetup;
  ok('ให้ Excel ย่อให้พอดีกว้างหนึ่งหน้า · ยาวได้หลายหน้า',
     ps.fitToPage === true && ps.fitToWidth === 1 && ps.fitToHeight === 0, JSON.stringify(ps));
  // ทางถอยถ้าตัวอ่านไฟล์ไม่สน fitToPage — เลขคณิตความกว้าง A–S ที่ scale นั้นต้องไม่เกินหน้า A4 นอน
  const w19 = { ...BINCARD_TPL.widths };
  w19.N = w19.O = BINCARD_TPL.widths.M; w19.P = BINCARD_TPL.widths.N;
  w19.Q = BINCARD_TPL.widths.O; w19.R = BINCARD_TPL.widths.P; w19.S = BINCARD_TPL.widths.Q;
  const cols = 'ABCDEFGHIJKLMNOPQRS'.split('');
  const inch = cols.reduce((s, c) => s + ((w19[c] === undefined ? 8.43 : w19[c]) * 7 + 5), 0) / 96;
  const [mL, mR] = BINCARD_TPL.page.margins;                 // A4 นอน = 11.69 นิ้ว
  const room = 11.69 - mL - mR;
  // ≤ SO_SCALE ไม่ใช่เท่ากับ — คอลัมน์ที่ข้อมูลยาวเกินถูกขยาย (หมวด F) แล้ว scale ลดตาม
  ok(`scale ที่ใช้ย่อ A–S (${inch.toFixed(2)}") ให้ไม่เกินหน้า (${room.toFixed(2)}")`,
     ps.scale <= SO_SCALE && inch * SO_SCALE / 100 <= room,
     `scale ${ps.scale} → ${(inch * (ps.scale || 100) / 100).toFixed(2)}"`);
  ok('ไม่ได้แก้ scale ในฟอร์มพื้นฐาน — override ที่ addShortOverCols เท่านั้น',
     BINCARD_TPL.page.scale === 71 && SO_SCALE < 71, String(BINCARD_TPL.page.scale));
  ok('ฟอร์มพื้นฐาน (BINCARD_TPL · applyTpl · writeCard) ยังเหมือน v1 — ขั้นเพิ่มคอลัมน์อยู่นอกสามตัวนั้น',
     /addShortOverCols\(ws, lines\)/.test(fs.readFileSync(new URL('../v2/export/bincard.js', import.meta.url), 'utf8')));
}

console.log('\n=== F. ขยายคอลัมน์ให้พอดีข้อมูล — ขยายอย่างเดียว ไม่หด (เจ้าของสั่ง 29 ก.ย. 2026) ===');
{
  const base = soWidths();
  const widthOf = (ws, c) => ws.cols.has(c) && ws.cols.get(c).width !== undefined ? ws.cols.get(c).width : base[c];
  const shortLines = toCardLines([
    { kind: 'receive', at, moved: 6, balance: 6, person: 'สมชาย', doc_ref: 'PA', expiry_date: '2027-01-01' },
    { kind: 'issue', at, moved: -3, balance: 3, person: 'สมหญิง', doc_ref: 'PA' }
  ], 'PCS');
  const ws = fakeWs();
  writeBinCard(ws, { code: 'C1', unit: 'PCS', entity: 'NSE' }, shortLines);
  // วันที่ YYYY-MM-DD ด้วย Tahoma 11 กว้างเกินช่อง Date ของฟอร์มเดิม (9.12) — ฟอร์มเดิมตัดวันที่อยู่แล้ว จึงขยายทุกใบ
  const dateW = textWidth(localDate(at));
  ok('ช่องวันที่รับ/จ่าย (E · I) ขยายพอดีวันที่', widthOf(ws, 'E') >= dateW && widthOf(ws, 'I') >= dateW
     && widthOf(ws, 'E') > base.E, `E=${widthOf(ws, 'E')} I=${widthOf(ws, 'I')} ต้องการ ${dateW.toFixed(2)}`);
  ok('ข้อมูลสั้น — คอลัมน์อื่นกว้างเท่าฟอร์มเดิมทุกคอลัมน์',
     [...'BCDFGHJKLMNOPQR'].every(c => widthOf(ws, c) === base[c]),
     [...'BCDFGHJKLMNOPQR'].map(c => c + '=' + widthOf(ws, c)).join(' '));

  const longPo = 'PO-TEST-0000000000000000000';
  const longNote = 'หมายเหตุยาวมาก '.repeat(12);
  const longLines = toCardLines([
    { kind: 'receive', at, moved: 6, balance: 6, person: 'สมชาย', doc_ref: longPo, note: longNote },
    { kind: 'issue', at, moved: -3, balance: 3, person: 'สมหญิง', doc_ref: 'PA' }
  ], 'PCS');
  const ws2 = fakeWs();
  writeBinCard(ws2, { code: 'C1', unit: 'PCS', entity: 'NSE' }, longLines);
  ok('เลข PO ยาวเกินช่อง — คอลัมน์ Ref Doc (C) ขยายพอดีข้อความ',
     widthOf(ws2, 'C') > base.C && widthOf(ws2, 'C') >= textWidth(longPo), String(widthOf(ws2, 'C')));
  ok('Remark ยาวผิดปกติ — ขยายไม่เกินเพดาน', widthOf(ws2, 'R') === FIT_MAX, String(widthOf(ws2, 'R')));
  ok('ไม่มีคอลัมน์ไหนแคบกว่าฟอร์มเดิม', [...'BCDEFGHIJKLMNOPQR'].every(c => (widthOf(ws2, c) ?? 8.43) >= (base[c] ?? 8.43)));
  ok('คอลัมน์ที่ข้อมูลไม่ยาวไม่ถูกแตะ (P/N · Balance)', widthOf(ws2, 'D') === base.D && widthOf(ws2, 'M') === base.M);
  const W2 = {}; for (const c of 'ABCDEFGHIJKLMNOPQRS') W2[c] = widthOf(ws2, c);
  const inch = [...'ABCDEFGHIJKLMNOPQRS'].reduce((s, c) => s + ((W2[c] === undefined ? 8.43 : W2[c]) * 7 + 5), 0) / 96;
  const room = 11.69 - BINCARD_TPL.page.margins[0] - BINCARD_TPL.page.margins[1];
  ok(`คอลัมน์กว้างขึ้นแล้ว scale ทางถอยลดตาม — A–S ยังไม่เกินหน้า A4 นอน`,
     ws2.pageSetup.scale < SO_SCALE && inch * ws2.pageSetup.scale / 100 <= room
     && ws2.pageSetup.fitToWidth === 1 && ws2.pageSetup.fitToHeight === 0,
     `scale ${ws2.pageSetup.scale} → ${(inch * ws2.pageSetup.scale / 100).toFixed(2)}" / ${room.toFixed(2)}"`);
  ok('ฟอร์มเดิมไม่ขยาย → fitScale ได้ไม่ต่ำกว่า SO_SCALE', fitScale(base) >= SO_SCALE, String(fitScale(base)));

  ok('สระบน/ล่าง/วรรณยุกต์ไทยไม่นับความกว้าง', textWidth('ที่นี่') === textWidth('ทน'), textWidth('ที่นี่') + ' vs ' + textWidth('ทน'));
  ok('ช่องว่าง/ไม่มีค่า = 0 · ตัวเลขนับตามที่แสดง', textWidth('') === 0 && textWidth(null) === 0 && textWidth(0.1 + 0.2) === textWidth('0.3'));
  ok('ฟอนต์เล็กกินที่น้อยกว่า', textWidth('ABC', 8) < textWidth('ABC', 11));

  const ws3 = fakeWs();
  writeBinCard(ws3, { code: 'C1', unit: 'PCS', entity: 'NSE' }, withUnknown);
  ok('คำเตือนยาวใต้แถวรวมไม่ทำให้คอลัมน์ No (B) ขยาย', widthOf(ws3, 'B') === base.B, String(widthOf(ws3, 'B')));
  ok('fitColWidths อยู่นอก applyTpl / writeCard (หมวด C) และทำหลัง addShortOverCols',
     /addShortOverCols\(ws, lines\);\s*fitColWidths\(ws, lines\);/.test(fs.readFileSync(new URL('../v2/export/bincard.js', import.meta.url), 'utf8')));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
