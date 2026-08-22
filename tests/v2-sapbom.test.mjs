/**
 * เทสตัวอ่านเอกสาร Indented BOM ของ Delta — รันด้วย node
 *   node tests/v2-sapbom.test.mjs
 *
 * สร้างเอกสารจำลองที่คอลัมน์ตรงกับของจริงเป๊ะ แล้วจงใจใส่เคสที่เคยทำให้ยอดผิด
 * ไม่ใช้ไฟล์จริงเป็น fixture เพราะไฟล์จริงมีข้อมูลธุรกิจ และอยู่ใน repo ส่วนตัว
 */
import { parseBomText, summarize, UOM, isInHouse } from '../v2/master/sap-bom.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

// หัวตารางยกมาจากเอกสารจริงทั้งบรรทัด เพื่อให้ตำแหน่งคอลัมน์ตรงของจริง
const HDR = 'ITEM LEVEL          PART NUMBER        REV MFG PART           VENDOR     VENDOR NAME          LF   DESCRIPTION               ALT.GRP%   QPA     UOM DESIGN NO  ITEM TEXT     CB MT DMS';
const C = { desc: HDR.indexOf('DESCRIPTION'), alt: HDR.indexOf('ALT.GRP%'),
            qpa: HDR.indexOf('QPA'), uom: HDR.indexOf('UOM'), dsg: HDR.indexOf('DESIGN NO') };

/** วางแต่ละช่องตามตำแหน่งคอลัมน์จริง */
function row({ item, level, code, desc, alt = '', qpa, uom, deep = false }) {
  const a = [];
  const put = (col, s) => { while (a.length < col) a.push(' '); for (const ch of String(s)) a.push(ch); };
  put(0, String(item).padStart(4));
  put(8, (deep ? '.' : ' ') + level);
  put(20, '.'.repeat(7) + code);
  put(C.desc, desc);
  if (alt !== '') put(C.alt, alt);
  put(C.qpa, String(qpa).padStart(6));
  put(C.uom, uom);
  return a.join('');
}

const HEAD = 'MODEL NO: 2800404400         REV: 006      L/F: TG     TRANSFORMER MAIN EE16 84.5uH +/-15%      VALID DATE FROM: 09/15/2022';

const doc = [HEAD, HDR,
  // ชิ้นประกอบที่กางลูกออกมา — ด่านที่ 1 ต้องตัดทิ้ง
  row({ item: 1, level: 1, code: '2831524600', desc: 'BOBBIN+WIRE ASSY 28004044', qpa: '1.0000', uom: 'PCE' }),
  row({ item: 2, level: 2, code: '3188790200', desc: 'BOBBIN LUG A3X2G5 EE16 H', qpa: '1.0000', uom: 'PCE', deep: true }),
  row({ item: 3, level: 2, code: '3220130200', desc: 'TAPE PLE 6mm #1350F-1 YEL', qpa: '0.1200', uom: 'MTR', deep: true }),
  // ชิ้นประกอบที่ไม่กางลูก — ด่านที่ 1 มองไม่เห็น ต้องให้ด่านช่วงรหัสจับ
  row({ item: 4, level: 1, code: '2831738022', desc: 'COIL FLAT WIRE 6.5*0.7 2T', qpa: '1.0000', uom: 'PCE' }),
  // หน่วยที่ต้องแปลง
  row({ item: 5, level: 1, code: '4020208300', desc: 'THINNER IPA 800', qpa: '2.5000', uom: 'GRM' }),
  // pack mat หน่วย TP — แปลงให้แต่ต้องติดธงว่ายังไม่ยืนยัน
  row({ item: 6, level: 1, code: '3512142900', desc: 'CARTON PAPER 495*295*205', qpa: '6.2500', uom: 'TP' }),
  // หน่วยที่ไม่รู้จัก — ต้องไม่ให้เข้า
  row({ item: 7, level: 1, code: '3999999900', desc: 'MYSTERY THING', qpa: '3.0000', uom: 'MMT' }),
  // รหัสเดิมโผล่อีกครั้งคนละขั้นตอน — ต้องรวมยอด
  row({ item: 8, level: 1, code: '3220130200', desc: 'TAPE PLE 6mm #1350F-1 YEL', qpa: '0.0800', uom: 'MTR' }),
  // ALT 0% — เอกสารบอกว่าไม่ใช้ แต่หน้างานเคยเบิกจริง จึงนำเข้าแต่ทำเครื่องหมาย
  row({ item: 9, level: 1, code: '3220169221', desc: 'TAPE PLE 10mm #631S-25', alt: 'DD  0  %', qpa: '0.1700', uom: 'MTR' })
].join('\n');

const d = parseBomText(doc, 'Report.html');

console.log('=== A. อ่านหัวเอกสาร ===');
ok('อ่านได้', d.ok === true, d.error || '');
ok('P/N ถูก', d.pn === '2800404400', d.pn);
ok('REV ถูก', d.rev === '006', d.rev);
ok('แปลงวันที่จาก mm/dd/yyyy เป็น yyyy-mm-dd', d.valid === '2022-09-15', d.valid);
ok('อ่านคำอธิบายสินค้าได้', d.desc.startsWith('TRANSFORMER MAIN EE16'), d.desc);
ok('นับบรรทัดดิบครบ 9', d.rawCount === 9, String(d.rawCount));

console.log('\n=== B. ตัดชิ้นส่วนประกอบ ===');
ok('ตัวที่กางลูกถูกตัด (ด่าน 1)',
   d.dropped.parents.length === 1 && d.dropped.parents[0].code === '2831524600',
   JSON.stringify(d.dropped.parents.map(p => p.code)));
ok('ตัวที่ไม่กางลูกถูกจับด้วยช่วงรหัส (ด่าน 2)',
   d.dropped.inhouse.length === 1 && d.dropped.inhouse[0].code === '2831738022',
   JSON.stringify(d.dropped.inhouse.map(p => p.code)));
ok('ของทำเองไม่หลุดเข้า BOM',
   !d.lines.some(l => l.code === '2831738022'));
ok('รู้จักช่วงรหัสของทำเอง', isInHouse('2831738022') && !isInHouse('3220130200'));

console.log('\n=== C. แปลงหน่วย ===');
const thinner = d.lines.find(l => l.code === '4020208300');
ok('GRM แปลงเป็น KGM หาร 1,000',
   thinner.usage === 0.0025 && thinner.unit === 'KGM', `${thinner.usage} ${thinner.unit}`);
ok('หน่วยที่ยืนยันแล้วไม่ติดธง', thinner.uomConfirmed === true);

console.log('\n=== D. หน่วย TP — แปลงให้แต่ติดธง ===');
const carton = d.lines.find(l => l.code === '3512142900');
ok('TP แปลงเป็นต่อชิ้น หาร 1,000',
   carton.usage === 0.00625 && carton.unit === 'PCE', `${carton.usage} ${carton.unit}`);
ok('ติดธงว่ายังไม่ยืนยัน', carton.uomConfirmed === false);
ok('บอกเหตุผลไว้ให้หน้าจอแสดง', /1,000/.test(carton.uomWhy), carton.uomWhy);
ok('อยู่ในรายการที่ต้องเตือน', d.unconfirmed.some(l => l.code === '3512142900'));
ok('ตาราง UOM ระบุสถานะยืนยันครบทุกตัว',
   Object.values(UOM).every(u => typeof u.confirmed === 'boolean'));

console.log('\n=== E. หน่วยที่ไม่รู้จักต้องไม่ให้เข้า ===');
ok('MMT ไม่หลุดเข้า BOM', !d.lines.some(l => l.code === '3999999900'));
ok('ถูกกันไว้ในรายการที่ปฏิเสธ',
   d.dropped.badUom.length === 1 && d.dropped.badUom[0].uom === 'MMT',
   JSON.stringify(d.dropped.badUom.map(x => x.uom)));
ok('MMT ไม่มีในตารางหน่วย', !UOM.MMT);

console.log('\n=== F. รวมยอดรหัสที่ซ้ำในเอกสารเดียว ===');
const tape = d.lines.find(l => l.code === '3220130200');
ok('0.12 + 0.08 = 0.2', tape.usage === 0.2, String(tape.usage));
ok('บอกว่ามาจากกี่บรรทัด', tape.n === 2, String(tape.n));
ok('เหลือรหัสไม่ซ้ำ', new Set(d.lines.map(l => l.code)).size === d.lines.length);

console.log('\n=== G. ALT 0% นำเข้าแต่ทำเครื่องหมาย ===');
ok('ยังนำเข้าให้', d.lines.some(l => l.code === '3220169221'));
ok('ทำเครื่องหมายไว้', d.alt0.length === 1 && d.alt0[0].code === '3220169221',
   JSON.stringify(d.alt0.map(l => l.code)));

console.log('\n=== H. ไฟล์ที่อ่านไม่ได้ต้องบอกเหตุผลที่คนอ่านรู้เรื่อง ===');
const bad = parseBomText('<html>ไฟล์อะไรก็ไม่รู้</html>', 'x.html');
ok('ไม่ระเบิด แต่ตอบว่าอ่านไม่ได้', bad.ok === false);
ok('บอกเป็นภาษาไทย', /MODEL NO/.test(bad.error) && /ไหม/.test(bad.error), bad.error);
const noRows = parseBomText([HEAD, HDR].join('\n'), 'y.html');
ok('มีหัวแต่ไม่มีบรรทัดวัตถุดิบ', noRows.ok === false && /ไม่พบบรรทัด/.test(noRows.error), noRows.error);

console.log('\n=== I. สรุปหลายไฟล์ ===');
const s = summarize([d, d, bad]);
ok('นับไฟล์ทั้งหมด', s.files === 3);
ok('นับไฟล์ที่อ่านไม่ได้', s.failed.length === 1);
ok('นับ P/N ที่อ่านได้', s.pns === 2);
ok('รวมของทำเองที่กันออก', s.inhouse === 2, String(s.inhouse));
ok('รวมบรรทัดที่ถูกปฏิเสธเพราะหน่วย', s.blocked === 2, String(s.blocked));
ok('บอกว่าหน่วยไหนที่ติด', s.blockedUoms[0].uom === 'MMT' && s.blockedUoms[0].n === 2,
   JSON.stringify(s.blockedUoms));
ok('รวมบรรทัดที่หน่วยยังไม่ยืนยัน', s.unconfirmed === 2, String(s.unconfirmed));

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
