/**
 * เทสตัวอ่าน BOM จากใบ Raw material Income — รันด้วย node
 *   node tests/v2-income-bom.test.mjs
 *
 * ไฟล์จริงอยู่ในเครื่องเจ้าของงานเท่านั้น ห้ามเอาเข้ามาเป็นตัวอย่างในเทส
 * ใบในนี้จึงแต่งขึ้นให้เหมือนของจริงทีละอาการ โดยอ้างอิงจากสิ่งที่วัดได้จากไฟล์จริง 224 ใบ
 * ทุกอาการที่เทสไว้ในหมวด B และ C คือของที่เจอจริง ไม่ใช่เคสที่คิดเผื่อ
 */
import {
  UNIT, dateOf, companyOf, parseIncomeSheet, readIncomeBook, pickLatest,
  conflictsWithinPn, peerOutliers, flaggedKeys, makeIncomeRows,
  summarizeIncome, incomePlan, parseDataSheet
} from '../v2/master/income-bom.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

/**
 * ใบแบบ TUE — ช่องขึ้นต้นที่คอลัมน์ B เพราะคอลัมน์ A เป็นช่องว่างสำหรับเจาะรูแฟ้ม
 * lines = [[item, code, desc, usage, total, unit], ...]
 */
function tueSheet({ pn = '2870627900', po = 'TM5268H402', order = 535,
                    date = '2026-08-11', week = 'WEEK ที่ 32', lines = [] } = {}) {
  return [
    ['.'],
    ['', '', '', '', '', '', 'Raw material Income', '', '', '', '', '', '', 'Document Code : FM-ST-06'],
    [],
    ['', 'Thai Union Electronics Co.,Ltd.'],
    ['', '93/59 Songkaew Road, T.Maesod'],
    [],
    ['', 'Part No.   ', pn, 'PO. No.  :  ' + po, '', '', '', 'Order :  ', order, 'PCS.', '', '', 'Date :  ', date, week],
    [],
    ['', 'Item', 'Code Material', 'Description', '', 'Usage/Pcs', "Total Q'ty", '', 'รับเข้า', '', 'จ่ายออก', '', '', 'คงเหลือ', 'Remark'],
    ['', '', '', '', '', '', '', '', 'จำนวน', 'short/ Over', 'จำนวน', 'Sign ผู้เบิก', 'วันที่'],
    ...lines.map(([item, code, desc, usage, total, unit]) =>
      ['', item, code, desc, '', usage, total, unit]),
    [],
    ['', '', 'CHECKER  ___________', '', '', '', '', '', 'APPROVED', '____________']
  ];
}

/** ใบแบบ TPP — เลื่อนซ้ายหนึ่งคอลัมน์ ใช้คำว่า P/N No. และ P/O No. */
function tppSheet({ pn = '2870680301', po = 'TM5249H120', order = 200,
                    date = '2025-01-15', lines = [] } = {}) {
  return [
    [],
    ['TPP', '', '', 'Rawmaterial Control'],
    [],
    ['บริษัท ทีพีพี แมนูแฟคเจอร์ริ่ง จำกัด'],
    ['93/59 ถ.สองแคว ต.แม่สอด'],
    [],
    ['P/N No.   ', pn, '         P/O No.  :  ' + po, '', '', '', '', 'Order :  ', order, 'PCE', 'Date :  ', date],
    [],
    ['Item', 'Code Material', 'Description', '', 'Usage/Pcs', "Total Q'ty", '', 'รับเข้า'],
    [],
    ...lines.map(([item, code, desc, usage, total, unit]) =>
      [item, code, desc, '', usage, total, unit])
  ];
}

const L = [
  [1, '3193440300', 'BOBBIN LUG FR530 EE16', 1, 535, 'Piece'],
  [2, '3220130200', 'TAPE PLE 6mm #1350F-1', 0.12, 64.2, 'Meter'],
  [3, '4011550400', 'WIRE CU 0.35 2UEW', 0.0007, 0.3745, 'Kilogr'],
  [4, '4120416068', 'CORE MZ EE16', 1, 535, 'Pair']
];

console.log('=== A. อ่านใบมาตรฐานทั้งสองสำเนียง ===');
const a = parseIncomeSheet(tueSheet({ lines: L }), '9');
ok('อ่านใบ TUE ได้', a.ok, a.error);
ok('ได้ P/N ถูก', a.pn === '2870627900', a.pn);
ok('ได้เลข PO ถูก', a.po === 'TM5268H402', a.po);
ok('ได้จำนวนสั่งผลิต', a.order === 535, String(a.order));
ok('ได้วันที่', a.date === '2026-08-11', a.date);
ok('รู้ว่าเป็นใบของ TUE', a.company === 'TUE', a.company);
ok('ได้ครบทุกบรรทัด', a.lines.length === 4, String(a.lines.length));
ok('หน่วยถูกแปลงเป็นหน่วยคลัง',
   a.lines.map(l => l.unit).join(',') === 'PCE,MTR,KGM,NPR',
   a.lines.map(l => l.unit).join(','));
ok('ยอดต่อชิ้นไม่ถูกคูณอะไรเลย', a.lines[1].usage === 0.12, String(a.lines[1].usage));
ok('เก็บหน่วยดิบไว้ด้วย เผื่อต้องย้อนดูว่าในใบเขียนว่าอะไร', a.lines[2].rawUnit === 'Kilogr');

const b = parseIncomeSheet(tppSheet({ lines: L }), '11');
ok('อ่านใบ TPP ที่เลื่อนคอลัมน์ได้', b.ok, b.error);
ok('ใบ TPP ได้ P/N จากช่อง P/N No.', b.pn === '2870680301', b.pn);
ok('ใบ TPP ได้ PO จากช่อง P/O No.', b.po === 'TM5249H120', b.po);
ok('รู้ว่าเป็นใบของ TPP', b.company === 'TPP', b.company);
ok('ใบ TPP ได้บรรทัดครบเท่ากัน', b.lines.length === 4, String(b.lines.length));

// ของจริงมีสองใบที่สะกดหัวคอลัมน์ตกเป็น Usage/Pes
const typo = tueSheet({ lines: L });
typo[8][5] = 'Usage/Pes';
ok('หัวคอลัมน์สะกดตกเป็น Usage/Pes ก็ยังอ่านได้', parseIncomeSheet(typo, '9').lines.length === 4);

console.log('\n=== B. ของที่ต้องไม่ให้เข้า ===');
const dirty = parseIncomeSheet(tueSheet({ lines: [
  ...L,
  [5, '3220130800', 'TAPE PLE 9mm', 0.5, 267.5, 'MRT'],        // หน่วยพิมพ์สลับ
  [6, '3513605500', 'CARTON', 0.02, 10.7, 'ggb'],              // หน่วยมั่ว
  [7, '4020241300', 'THINNER T-100', '', 0, 'Kilogr'],         // ไม่กรอกยอด
  [8, '4020600700', 'ADHESIVE', 0, 0, 'Kilogr'],               // ยอดเป็นศูนย์
  [9, '2831738022', 'COIL FLAT WIRE', 1, 535, 'Piece']         // ของทำเองช่วง 28
] }), '9');
ok('รับเฉพาะบรรทัดที่ใช้ได้', dirty.lines.length === 4, String(dirty.lines.length));
ok('หน่วยไม่รู้จักถูกปฏิเสธ ไม่ใช่เดาว่าคูณหนึ่ง',
   dirty.rejected.filter(r => r.why === 'หน่วยไม่รู้จัก').length === 2);
ok('MRT ไม่ถูกเดาว่าเป็น MTR', !dirty.lines.some(l => l.code === '3220130800'));
ok('บรรทัดที่ไม่กรอกยอดถูกปฏิเสธ',
   dirty.rejected.filter(r => r.why === 'ไม่มียอดต่อชิ้น').length === 2);
ok('ของทำเองช่วง 28 ถูกตัดออก ไม่ปนมาเป็นวัตถุดิบ',
   dirty.inhouse.length === 1 && !dirty.lines.some(l => l.code.startsWith('28')));
ok('ของที่ถูกปฏิเสธยังบอกได้ว่าคือรหัสอะไร ไม่ใช่หายเงียบ',
   dirty.rejected.every(r => r.code && r.why));

console.log('\n=== C. ใบที่คนกรอกผิด — ของจริงเจอสองใบ ===');
const swapped = tueSheet({ lines: L });
swapped[6] = ['', 'P0 No.   ', '2873213400', '   Part No.  :  TM5262H353', '', '', '', '', 'Order :  ', 457, 'PCS'];
const sw = parseIncomeSheet(swapped, '21');
ok('ใบที่กรอกสลับช่องถูกปฏิเสธ', !sw.ok);
ok('บอกได้ว่าเจอ P/N อยู่ผิดช่อง ไม่ใช่ "อ่านไม่ได้" เฉย ๆ',
   /สลับช่อง/.test(sw.error) && sw.error.includes('2873213400'), sw.error);
ok('ไม่หยิบเลขที่เจอมาใช้เอง', !sw.pn);

const tooLong = parseIncomeSheet(tueSheet({ pn: '28707083900', lines: L }), '152');
ok('P/N ที่มี 11 หลักถูกปฏิเสธ', !tooLong.ok);
ok('บอกจำนวนหลักที่ผิดให้เห็น', /11 หลัก/.test(tooLong.error), tooLong.error);

console.log('\n=== D. รหัสซ้ำในใบเดียวต้องรวมยอด ===');
const dup = parseIncomeSheet(tueSheet({ lines: [
  [1, '3227500125', 'TUBE PTFE 0.46', 5.4, 2889, 'Meter'],
  [2, '3227500125', 'TUBE PTFE 0.46', 5.4, 2889, 'Meter']
] }), '9');
ok('รหัสเดียวกันสองบรรทัดเหลือแถวเดียว', dup.lines.length === 1);
ok('ยอดถูกบวกกัน ไม่ใช่เอาบรรทัดสุดท้าย', dup.lines[0].usage === 10.8, String(dup.lines[0].usage));
ok('บอกได้ว่ามาจากกี่บรรทัด', dup.lines[0].n === 2);

console.log('\n=== E. วันที่มาได้สามหน้าตา ===');
ok('รับ Date object', dateOf(new Date(2026, 7, 19)) === '2026-08-19');
ok('รับ serial ของ Excel', dateOf(46253) === '2026-08-19', dateOf(46253));
ok('รับสตริงที่มีเวลาต่อท้าย', dateOf('2026-08-19 00:00:00') === '2026-08-19');
ok('ของที่ไม่ใช่วันที่คืนค่าว่าง ไม่ใช่ NaN', dateOf('ไม่มี') === '' && dateOf(null) === '');
ok('เลขน้อย ๆ ไม่ถูกตีความเป็นวันที่', dateOf(535) === '');

console.log('\n=== F. เลือกใบล่าสุดของแต่ละ P/N ===');
const book = readIncomeBook([
  { name: '13', aoa: tueSheet({ pn: '2870709801', date: '2026-08-19',
      lines: [[1, '3222001411', 'TAPE', 0.08, 40, 'Meter']] }) },
  { name: '14', aoa: tueSheet({ pn: '2870709801', date: '2025-03-02',
      lines: [[1, '3222001411', 'TAPE', 0.00083418, 0.4, 'Meter']] }) },
  { name: '84', aoa: tueSheet({ pn: '2870709801', date: '2024-06-01',
      lines: [[1, '3222001411', 'TAPE', 0.08, 40, 'Meter']] }) },
  { name: '99', aoa: tueSheet({ pn: '2877669000', date: '2026-08-01',
      lines: [[1, '3220130200', 'TAPE PLE 6mm', 0.12, 60, 'Meter']] }) }
]);
const latest = pickLatest(book);
ok('เหลือใบละหนึ่งต่อหนึ่ง P/N', latest.length === 2, String(latest.length));
ok('เลือกใบที่ลงวันที่ใหม่สุด',
   latest.find(d => d.pn === '2870709801').sheet === '13');

const noDate = pickLatest(readIncomeBook([
  { name: '5', aoa: tueSheet({ pn: '2800404400', date: '', lines: L }) },
  { name: '6', aoa: tueSheet({ pn: '2800404400', date: '2025-01-01', lines: L }) }
]));
ok('ใบไม่มีวันที่ถือว่าเก่ากว่าใบที่มีวันที่', noDate[0].sheet === '6', noDate[0].sheet);

console.log('\n=== G. ด่าน ก · P/N เดียวกันหลายใบต้องได้ค่าตรงกัน ===');
const conf = conflictsWithinPn(book);
ok('จับได้ว่าใบของ P/N เดียวกันให้ค่าไม่ตรงกัน', conf.length === 1, String(conf.length));
ok('บอกว่าต่างกันกี่เท่า', Math.round(conf[0].ratio) === 96, String(conf[0].ratio));
ok('บอกครบว่าใบไหนให้ค่าอะไร', conf[0].values.length === 3);

const rounding = conflictsWithinPn(readIncomeBook([
  { name: '1', aoa: tueSheet({ pn: '2870709801', date: '2026-08-01',
      lines: [[1, '4010990000', 'WIRE', 0.000834, 0.44, 'Kilogr']] }) },
  { name: '2', aoa: tueSheet({ pn: '2870709801', date: '2026-07-01',
      lines: [[1, '4010990000', 'WIRE', 0.0008341, 0.44, 'Kilogr']] }) }
]));
ok('ปัดเศษต่างกันเล็กน้อยไม่ถือว่าขัดกัน', rounding.length === 0, JSON.stringify(rounding));

console.log('\n=== H. ด่าน ข · รหัสเดียวกันข้าม P/N ต้องอยู่ใกล้ค่ากลาง ===');
const mk = (pn, usage) => ({ name: pn, aoa: tueSheet({ pn, date: '2026-08-01',
  lines: [[1, '4020246500', 'ADHESIVE EPOXY', usage, 1, 'Kilogr']] }) });
const peers = readIncomeBook([
  mk('2870000001', 0.0001), mk('2870000002', 0.00011), mk('2870000003', 0.0001),
  mk('2870000004', 0.18)                                   // หลุดไปพันเท่า
]);
const outs = peerOutliers(pickLatest(peers));
ok('จับตัวที่หลุดค่ากลางได้', outs.length === 1, String(outs.length));
ok('ชี้ถูกตัว', outs[0].pn === '2870000004', outs[0].pn);
// สี่ค่า ค่ากลางจึงเป็นค่าเฉลี่ยของสองตัวกลาง = (0.0001 + 0.00011) / 2
ok('บอกค่ากลางให้เทียบด้วย', outs[0].median === 0.000105, String(outs[0].median));

// ค่ากลางต้องไม่ถูกตัวที่ผิดลากไป — เหตุผลที่ใช้ median ไม่ใช่ average
const half = peerOutliers(pickLatest(readIncomeBook([
  mk('2870000001', 0.0001), mk('2870000002', 0.0001), mk('2870000003', 100)
])));
ok('ตัวที่ผิดตัวเดียวไม่ลากค่ากลางจนตัวถูกกลายเป็นผิด',
   half.length === 1 && half[0].pn === '2870000003', JSON.stringify(half.map(h => h.pn)));

ok('เพื่อนน้อยกว่าสาม P/N ไม่ตัดสิน',
   peerOutliers(pickLatest(readIncomeBook([mk('2870000001', 0.0001), mk('2870000002', 5)]))).length === 0);

const keys = flaggedKeys(conf, outs);
ok('รวมรายการที่ถูกทักไว้ให้หน้าจอกันกดรับทั้งชุด',
   keys.has('2870709801|3222001411') && keys.has('2870000004|4020246500'));

console.log('\n=== I. แปลงเป็นแถว BOM ===');
const rows = makeIncomeRows(latest.find(d => d.pn === '2870709801'), { now: '2026-08-24T00:00:00.000Z' });
ok('คีย์เป็น pn|code เหมือนของเดิม ไม่ผูกนิติบุคคล', rows[0].id === '2870709801|3222001411');
ok('หน่วยบนใบนี้ถือว่ายืนยันแล้ว เพราะไม่ได้ผ่านตัวคูณอะไร', rows[0].uomConfirmed === true);
ok('ที่มาชี้กลับไปที่ใบต้นทางได้', /ชีต 13/.test(rows[0].source), rows[0].source);
ok('เก็บบริษัทบนหัวกระดาษไว้เป็นที่มา', rows[0].source_company === 'TUE');

console.log('\n=== J. สรุปและแผนก่อนนำเข้า ===');
const sum = summarizeIncome(book, latest, conf, outs);
ok('นับใบทั้งหมด', sum.sheets === 4);
ok('บอกว่าทิ้งใบเก่าไปกี่ใบ', sum.dropped === 2, String(sum.dropped));
ok('บอกช่วงวันที่ของใบในไฟล์', sum.from === '2024-06-01' && sum.to === '2026-08-19',
   sum.from + ' → ' + sum.to);

const plan = incomePlan(latest, [
  { pn: '2870709801', code: 'x' }, { pn: '2870709801', code: 'y' },
  { pn: '2870709801', code: 'z', deleted: true }
]);
ok('บอกว่าจะทับของเดิมกี่แถว', plan.find(p => p.pn === '2870709801').replacing === 2);
ok('แถวที่ลบไปแล้วไม่นับว่าถูกทับ', plan.find(p => p.pn === '2870709801').replacing !== 3);
ok('P/N ที่ยังไม่เคยมี ติดป้ายว่าใหม่', plan.find(p => p.pn === '2877669000').isNew === true);

console.log('\n=== K. ชีต data → ทะเบียนวัตถุดิบ ===');
const data = parseDataSheet([
  ['ITEM', 'MATERIAL NO', 'MATERIAL DESCRIPTION', ' Unit', 'Remark'],
  [1, '827330710', 'FUSE THERMAL 133C 1A', 'PCE', ''],
  [2, '3220130200', 'TAPE PLE 6mm', 'MTR', 'ใช้บ่อย'],
  [3, '2831738022', 'COIL FLAT WIRE', 'PCE', ''],       // ของทำเอง
  [4, '3220130200', 'TAPE PLE 6mm', 'MTR', ''],         // ซ้ำ
  [5, 'ไม่ใช่รหัส', 'อะไรสักอย่าง', 'PCE', ''],
  [6, '4020241300', 'THINNER T-100', 'ggb', '']          // หน่วยมั่ว
]);
ok('อ่านชีต data ได้', data.ok, data.error);
ok('ได้เฉพาะของที่ใช้ได้', data.items.length === 3, String(data.items.length));
ok('ตัดของทำเองช่วง 28 ออก', data.skipped.inhouse === 1);
ok('รหัสซ้ำเข้าครั้งเดียว', data.skipped.dup === 1);
ok('แถวที่ไม่ใช่รหัสถูกนับไว้ ไม่ใช่หายเงียบ', data.skipped.badCode === 1);
ok('หน่วยที่แปลงไม่ได้ยังเข้าได้แต่ติดธงไว้ให้คนตัดสิน',
   data.skipped.badUnit.length === 1 && data.items.find(i => i.code === '4020241300').unit === '');
ok('หมายเหตุติดมาด้วย', data.items.find(i => i.code === '3220130200').note === 'ใช้บ่อย');

console.log('\n=== L. ของพังต้องไม่ทำให้ทั้งไฟล์ล่ม ===');
ok('ชีตว่างเปล่า', parseIncomeSheet([], 'x').ok === false);
ok('ชีตที่ไม่ใช่ใบเบิก', parseIncomeSheet([['อะไรก็ไม่รู้']], 'x').ok === false);
ok('ส่ง null เข้ามา', parseIncomeSheet(null, 'x').ok === false);
ok('ใบที่ไม่มีบรรทัดวัตถุดิบเลย', parseIncomeSheet(tueSheet({ lines: [] }), 'x').ok === false);
ok('อ่านทั้งเล่มแล้วมีใบพังปนอยู่ ก็ยังได้ใบที่ดีครบ',
   readIncomeBook([{ name: '1', aoa: tueSheet({ lines: L }) },
                   { name: '2', aoa: [['ขยะ']] }]).filter(d => d.ok).length === 1);
ok('UNIT ไม่มีของที่ต้องคูณ — ถ้าวันหนึ่งมีใครเติม ต้องมาคิดเรื่องธงยืนยันหน่วยด้วย',
   Object.values(UNIT).every(v => ['PCE', 'MTR', 'KGM', 'NPR'].includes(v)));
ok('companyOf ไม่รู้จักก็คืนค่าว่าง ไม่เดา', companyOf(['อะไรสักอย่าง']) === '');

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
