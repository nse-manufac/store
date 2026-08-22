/**
 * เทสการออก Bin Card และเวลาไทย — รันด้วย node
 *   node tests/v2-export.test.mjs
 *
 * หมวด C สำคัญที่สุด — ไฟล์ที่ออกไปมีคนรับต่อ ถ้าหน้าตาเปลี่ยนเขาจะรู้สึกทันที
 * เทสนี้จึงเทียบฟอร์มของ v2 กับของ v1 ตรง ๆ ถ้าวันหนึ่งมีคนแก้ข้างใดข้างหนึ่ง เทสจะดังทันที
 */
import fs from 'node:fs';
import { localDate, localTime, atFrom, todayLocal } from '../v2/core/localtime.js';
import { BINCARD_TPL, toCardLines, sheetNameFor, safeFileName } from '../v2/export/bincard.js';

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

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
