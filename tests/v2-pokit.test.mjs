/**
 * เทสตัวอ่าน PO และ Kit List — รันด้วย node
 *   node tests/v2-pokit.test.mjs
 *
 * ข้อมูลจำลองในนี้ปั้นให้เหมือนของจริงเฉพาะรูปทรงที่สำคัญ ไม่ได้ก๊อปไฟล์จริงมา
 * ไฟล์จริงของ Delta อยู่ใน repo intake ที่เป็นส่วนตัว และห้ามเอามาเป็นตัวอย่างใน repo นี้
 *
 * หมวด B กับ D สำคัญที่สุด — ทั้งคู่คือกรณี "บรรทัดซ้ำต้องรวมยอด"
 * ถ้าไม่รวม จะเห็นแค่บรรทัดสุดท้ายแล้วยอดขาดไปเงียบ ๆ โดยไม่มีอะไรฟ้อง
 */
import fs from 'node:fs';
import { parsePoFile, parseKitList, parseKitChem, kitsOfPo, poHeader, importPlan,
         parseThaiDate, parseEnDate, excelDate, receivedOutsideList, switchedPo, nextShownPo,
         poHistory, searchPos } from '../v2/master/po-kit.js';
import { atFrom } from '../v2/core/localtime.js';
import { makeSession, postCount } from '../v2/core/count.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. วันที่ในสามรูปแบบที่เจอจริง ===');
ok('วันที่ไทย พ.ศ. แปลงเป็น ค.ศ.',
   parseThaiDate('รายการ subcontract ที่ 27 กรกฎาคม พ.ศ. 2569') === '2026-07-27',
   parseThaiDate('รายการ subcontract ที่ 27 กรกฎาคม พ.ศ. 2569'));
ok('เดือนแบบย่อก็อ่านได้',
   parseThaiDate('subcontract ที่ 3 ธ.ค. พ.ศ. 2569') === '2026-12-03',
   parseThaiDate('subcontract ที่ 3 ธ.ค. พ.ศ. 2569'));
ok('ETA ภาษาอังกฤษ', parseEnDate('ETA 29 July 2026') === '2026-07-29');
// ฐานของ Excel คือ 30 ธ.ค. 1899 ไม่ใช่ 1 ม.ค. 1900 — พลาดตรงนี้วันที่จะเพี้ยนสองวัน
ok('วันที่แบบ serial ของ Excel', excelDate(46231) === '2026-07-28', excelDate(46231));
ok('ค่าที่ไม่ใช่วันที่ไม่ถูกเดามั่ว', excelDate(5) === '' && excelDate('abc') === '');

console.log('\n=== B. PO รายวัน ===');
const poAoa = [
  ['รายการ subcontract ที่ 27 กรกฎาคม พ.ศ. 2569'],
  ['ลำดับ', 'ผู้รับเหมา', 'P/N', 'PO', '', 'จำนวน', '', '', '', 'core', '', 'หมายเหตุ'],
  [1, 'NSE', 2870627900, 'PO-9001', null, 1000, null, null, null, 'CORE-A', null,
   null, null, null, null, null, 'ด่วน'],
  [2, 'NSE', 2800404400, 'PO-9002', null, 500, null, null, null, '', null,
   '4037010105 Short 12.5 KGM ETA 29 July 2026'],
  [3, 'NSE', 2800404400, 'PO-9003', null, 250, null, null, null, '', null,
   '4037010105 ETA 29 July 2026']
];
const po = parsePoFile(poAoa);
ok('อ่าน PO ได้ครบทุกแถว', po.pos.length === 3, String(po.pos.length));
ok('วันที่จากหัวเรื่องติดไปทุกแถว', po.pos.every(p => p.date === '2026-07-27'));
ok('P/N ที่มาเป็นตัวเลขถูกแปลงเป็นข้อความ',
   po.pos[0].pn === '2870627900' && typeof po.pos[0].pn === 'string');
ok('จำนวนสั่งอ่านถูก', po.pos[0].qty === 1000);
ok('หมายเหตุอ่านจากคอลัมน์ท้ายสุด', po.pos[0].remark === 'ด่วน');
ok('id ผูกวันที่กับ PO เข้าด้วยกัน', po.pos[0].id === 'P2026-07-27-PO-9001', po.pos[0].id);

ok('จับของขาดจากข้อความอิสระได้', po.shorts.length === 2, String(po.shorts.length));
const s1 = po.shorts[0];
ok('แยกรหัสวัตถุดิบออกจากข้อความได้', s1.code === '4037010105', s1.code);
ok('แยกจำนวนที่ขาดและหน่วยได้', s1.qty === 12.5 && s1.unit === 'KGM', s1.qty + ' ' + s1.unit);
ok('แยก ETA ได้', s1.eta === '2026-07-29', s1.eta);
ok('ไม่มีคำว่า Short ถือว่าแค่รอส่ง', po.shorts[1].type === 'รอส่ง' && po.shorts[1].qty === 0);
// ของจริง หมายเหตุข้อความเดียวกันโผล่ได้หลาย PO ในวันเดียวกัน
ok('หมายเหตุเดียวกันคนละ PO ต้องไม่ยุบรวมกัน',
   po.shorts[0].id !== po.shorts[1].id && po.shorts[0].po === 'PO-9002'
   && po.shorts[1].po === 'PO-9003',
   JSON.stringify(po.shorts.map(s => s.po)));

console.log('\n=== C. Kit List รายวัน (22-H) ===');
const kitAoa = [
  ['MATERIAL ISSUE PO SUBCONTRACT', null, null, 46231, null, 'SUB-H'],
  [],
  [null, 'PO NO.', 'MODEL', 'CODE', 'DESCRIPTION', 'UNIT', '541 QTY'],
  [1, 'PO-9001', 2870627900, 3220130200, 'TAPE PLE 6mm', 'MTR', 150],
  [2, 'PO-9001', 2870627900, 4090050100, 'TUBE PTFE', 'PCE', 5.4],
  [null, null, null, 'Total', null, null, 155.4],
  [null, 'PO NO.', 'MODEL', 'CODE', 'DESCRIPTION', 'UNIT', '541 QTY'],
  // บรรทัดซ้ำของ PO+รหัสเดิม เพราะเป็นคนละขั้นตอนการผลิต — ต้องรวมยอด
  [3, 'PO-9001', 2870627900, 4090050100, 'TUBE PTFE', 'PCE', 5.4],
  [4, 'PO-9002', 2800404400, 3220130200, 'TAPE PLE 6mm', 'MTR', 80]
];
const kit = parseKitList(kitAoa);
ok('อ่านวันที่จากหัวเอกสารได้', kit.docDate === '2026-07-28', kit.docDate);
ok('อ่านกลุ่มได้', kit.group === 'SUB-H', kit.group);
ok('ข้ามหัวตารางที่พิมพ์ซ้ำทุกหน้า', kit.headers === 2, String(kit.headers));
ok('ข้ามแถวรวมย่อย', kit.subtotals === 1, String(kit.subtotals));
ok('เหลือสามรายการหลังรวมยอด', kit.rows.length === 3, String(kit.rows.length));
// ข้อสำคัญที่สุดของหมวดนี้
const tube = kit.rows.find(r => r.code === '4090050100');
ok('บรรทัดซ้ำถูกรวมยอด ไม่ใช่เอาบรรทัดสุดท้าย', tube.issue === 10.8, String(tube.issue));
ok('บอกได้ว่ารายการไหนถูกรวมมา', kit.merged.length === 1 && kit.merged[0].n === 2);
ok('รหัสที่มาเป็นตัวเลขกลายเป็นข้อความ', typeof tube.code === 'string');
ok('ติดธงว่าไม่ใช่กลุ่มจ่ายรวม', kit.rows.every(r => r.src === ''));

console.log('\n=== D. Kit List กลุ่มจ่ายรวม ===');
const head = ['ITEM', 'PO NO.', 'GROUP', 'MODEL', "ORDER Q'TY", 'MATERIAL',
              'DESCRIPTION', "REQ Q'TY", '541 QTY', 'REMARK'];
const chem = parseKitChem({ sheets: [
  { name: 'H', hidden: false, aoa: [
    ['Documet Issue Date', 46231],
    head,
    [1, 'PO-9001', 'H', 'TM5267H332', 1000, 4020204800, 'FLUX', 0.6, 0.539, ''],
    // ซ้ำ PO+รหัส ต้องรวมทั้ง req และ 541
    [2, 'PO-9001', 'H', 'TM5267H332', 1000, 4020204800, 'FLUX', 0.25, 0.231, ''],
    [null, null, null, null, null, null, null, null, 0.77, null],
    [1, 'PO-9002', 'H', 'TM5267H333', 500, 4090006500, 'SOLDER BAR', 2, 1.5, 'x'],
    [null, null, null, null, null, null, null, null, 1.5, null]
  ] },
  { name: 'U', hidden: false, aoa: [
    ['Documet Issue Date', 46232],
    head,
    [1, 'PO-9003', 'U', 'TM9', 100, 4020500500, 'INK', 1, 0.9, ''],
    // เลข Item กระโดดจาก 1 ไป 3 = บรรทัดหายตอน export
    [3, 'PO-9004', 'U', 'TM9', 100, 4020500500, 'INK', 1, 0.8, '']
  ] },
  { name: 'ซ่อนอยู่', hidden: true, aoa: [['อะไรก็ไม่รู้']] },
  { name: 'สรุป', hidden: false, aoa: [['ชีตนี้ไม่ใช่ Kit List']] }
] });

ok('ข้ามชีตซ่อน', chem.skipped.some(s => s.why === 'ชีตซ่อน'));
ok('ข้ามชีตที่ไม่มีหัวตาราง',
   chem.skipped.some(s => /ไม่พบหัวตาราง/.test(s.why)), JSON.stringify(chem.skipped));
ok('อ่านสองชีตที่เป็น Kit List จริง', chem.sheets.length === 2, String(chem.sheets.length));
ok('อ่านวันที่ที่สะกดตกตัว n ได้', chem.docDate === '2026-07-28', chem.docDate);
ok('แต่ละชีตเก็บวันที่ของตัวเอง',
   chem.sheets[1].date === '2026-07-29', chem.sheets[1].date);

const flux = chem.rows.find(r => r.code === '4020204800');
ok('บรรทัดซ้ำถูกรวมยอดทั้งสองคอลัมน์',
   flux.issue === 0.77 && flux.req === 0.85, flux.issue + ' / ' + flux.req);
ok('เก็บยอดสั่งกับ P/N มาด้วย เพื่อเทียบ BOM ได้',
   flux.orderQty === 1000 && flux.pn === 'TM5267H332');
ok('ติดธงว่าเป็นกลุ่มจ่ายรวม', chem.rows.every(r => r.src === 'chem'));

// ยอดรวมในเอกสารต้องตรงกับที่บวกเอง ไม่งั้นแปลว่าอ่านตกบรรทัด
ok('เทียบยอดรวมของแต่ละบล็อกกับเอกสารได้',
   chem.blocks.filter(b => b.match === true).length === 2,
   JSON.stringify(chem.blocks.map(b => b.code + ':' + b.match)));
// เลข Item ที่กระโดดคือสัญญาณว่าบรรทัดหายตอน export ต้องฟ้อง ไม่ใช่เงียบ
ok('จับเลข Item ที่กระโดดได้', chem.gaps.length === 1 && chem.gaps[0].missing[0] === 2,
   JSON.stringify(chem.gaps));
ok('ชีตที่รีเซ็ตเลข Item เมื่อขึ้นรหัสใหม่ ไม่ถูกฟ้องผิด ๆ',
   !chem.gaps.some(g => g.sheet === 'H'), JSON.stringify(chem.gaps.map(g => g.sheet)));

console.log('\n=== E. กลุ่มจ่ายรวมต้องไม่โผล่ในหน้าคีย์รับเข้าปกติ ===');
// กฎนี้ยกมาจาก v1 ทั้งดุ้น — ของกลุ่มนั้นไม่ได้มาพร้อม PO
// ถ้ากางขึ้นมา พนักงานจะคีย์ยอดที่ยังไม่ได้รับของจริง
const all = [...kit.rows, ...chem.rows];
const forPo = kitsOfPo(all, 'PO-9001');
ok('ได้เฉพาะของที่มาพร้อม PO', forPo.length === 2, String(forPo.length));
ok('ไม่มีของกลุ่มจ่ายรวมปนมา', !forPo.some(k => k.src === 'chem'),
   JSON.stringify(forPo.map(k => k.code + ':' + k.src)));
ok('PO ที่ไม่มีอะไรจ่ายมาก็ตอบรายการว่าง', kitsOfPo(all, 'ไม่มี PO นี้').length === 0);

console.log('\n=== F. แผนก่อนนำเข้า ===');
const plan = importPlan(kit.rows, {
  existing: [{ id: kit.rows[0].id }],
  materials: [{ material_code: '3220130200' }],
  poList: [{ po: 'PO-9001' }]
});
ok('นับของที่มีอยู่แล้วเป็นซ้ำ', plan.dup === 1 && plan.fresh.length === 2, JSON.stringify(plan.dup));
ok('บอกรหัสที่ยังไม่มีในทะเบียน',
   plan.codeNew.length === 1 && plan.codeNew[0] === '4090050100', JSON.stringify(plan.codeNew));
ok('บอก PO ที่ยังไม่มีในรายการ PO',
   plan.noPo.length === 1 && plan.noPo[0] === 'PO-9002', JSON.stringify(plan.noPo));
ok('รวมยอดที่ Delta จ่ายมาทั้งไฟล์', plan.totalIssue === 240.8, String(plan.totalIssue));
ok('ไฟล์เปล่าไม่พัง', importPlan([]).total === 0);

console.log('\n=== G. คีย์แค่ PO ต้องรู้ว่าเป็น P/N อะไร (issue #51) ===');
// หน้ารับเข้าของ v2 กางสูตรได้ก็ต่อเมื่อรู้ P/N — ถ้าไม่เติมให้จากไฟล์ PO รายวัน
// พนักงานที่คีย์แค่เลข PO จะไม่เห็นรายการอะไรเลย ทั้งที่ข้อมูลมีอยู่ในเครื่องแล้ว
const poRows = [
  { id: 'P2026-07-27-PO-9001', date: '2026-07-27', sub: 'TUE-TPP', pn: '5267', po: 'PO-9001', qty: 100 },
  { id: 'P2026-07-28-PO-9001', date: '2026-07-28', sub: 'TUE-TPP', pn: '5267', po: 'PO-9001', qty: 120 },
  { id: 'P2026-07-27-PO-9002', date: '2026-07-27', sub: 'TUE-TPP', pn: '5301', po: 'PO-9002', qty: 40 }
];
const h1 = poHeader(poRows, 'PO-9002');
ok('คีย์เลข PO แล้วได้ P/N · จำนวนสั่ง · วันที่',
   h1 && h1.pn === '5301' && h1.order === 40 && h1.date === '2026-07-27', JSON.stringify(h1));
// ของทยอยมา PO ใบเดิมจึงโผล่ได้หลายวัน — ต้องยึดวันล่าสุดที่ Delta ยืนยัน
ok('PO ที่โผล่หลายวัน ยึดแถวของวันล่าสุด',
   poHeader(poRows, 'PO-9001').date === '2026-07-28' && poHeader(poRows, 'PO-9001').order === 120,
   JSON.stringify(poHeader(poRows, 'PO-9001')));
ok('เว้นวรรคหน้าหลังเลข PO ก็ยังหาเจอ', poHeader(poRows, '  PO-9002  ').pn === '5301');
// ไม่พบ = ต้องคืน null ให้ผู้เรียกปล่อยช่องเดิมไว้ ห้ามเดา P/N ให้ (G3 — คีย์เองต่อได้)
ok('PO ที่ยังไม่ได้นำเข้า ตอบ null ไม่ใช่เดาค่า', poHeader(poRows, 'PO-ไม่มี') === null);
ok('ช่อง PO ว่างหรือยังไม่มีไฟล์ PO เลย ก็ไม่พัง',
   poHeader(poRows, '') === null && poHeader([], 'PO-9001') === null && poHeader(null, 'PO-9001') === null);

console.log('\n=== H. หน้ารับเข้ากับหน้าจ่ายออกต้องกางรายการชุดเดียวกัน (issue #78) ===');
// เจ้าของเจอ 15 ก.ย. 2026: PO เดียวกัน หน้ารับเข้ามีรหัสที่รับมานอก Kit List (#52 เติมให้) แต่หน้าจ่ายออกไม่มี
// พนักงานจึงเบิกของนั้นไม่ได้ · เลขในเทสเป็นเลขสมมติ
const recvOfPo = new Map([
  ['3220130200', { qty: 10, times: 1, ats: ['2026-09-01T02:00:00.000Z'] }],
  ['4090050100', { qty: 4, times: 1, ats: ['2026-09-02T02:00:00.000Z'] }],
  ['5301000100', { qty: 1.5, times: 2, ats: ['2026-09-02T02:00:00.000Z', '2026-09-03T02:00:00.000Z'] }]
]);
const extraRecv = receivedOutsideList(recvOfPo, ['3220130200', '9999999999']);
ok('เอาเฉพาะรหัสที่รับมาแต่ไม่อยู่ในรายการ ตามลำดับในสมุด',
   extraRecv.map(x => x.code).join(',') === '4090050100,5301000100', JSON.stringify(extraRecv.map(x => x.code)));
ok('พกยอดที่รับไปด้วย ให้หน้ารับเข้าโชว์ "รับแล้ว" ได้', extraRecv[0].recv.qty === 4);
ok('รหัสในรายการที่เป็นตัวเลข ต้องเทียบเท่ากับข้อความ',
   receivedOutsideList(recvOfPo, [3220130200, 4090050100, 5301000100]).length === 0);
ok('ยังไม่เคยรับ หรือไม่มีรายการ ก็ไม่พัง',
   receivedOutsideList(new Map(), ['x']).length === 0 && receivedOutsideList(null, null).length === 0
   && receivedOutsideList(recvOfPo, null).length === 3);

// สองหน้าต้องเรียกตัวเดียวกัน — ตรรกะอยู่ใน po-kit.js ส่วน app.js ต่อสายอย่างเดียว เทสจึงอ่านซอร์สมาเช็ก
const appSrc = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bodyOf = name => {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) return '';
  let depth = 0, started = false;
  for (let j = i; j < appSrc.length; j++) {
    if (appSrc[j] === '{') { depth++; started = true; }
    else if (appSrc[j] === '}') { depth--; if (started && depth === 0) return appSrc.slice(i, j + 1); }
  }
  return '';
};
ok('หน้ารับเข้า (markReceived) ใช้ receivedOutsideList', bodyOf('markReceived').includes('receivedOutsideList('));
ok('หน้าจ่ายออกใช้ receivedOutsideList ผ่าน addReceivedToOut',
   bodyOf('addReceivedToOut').includes('receivedOutsideList(') && bodyOf('addReceivedToOut').includes('receivedOfDoc('));
ok('หน้าจ่ายออกเติมให้ทั้งสามทาง — มี Kit List · ไม่มีอะไรเลย · กางจากสูตร',
   (bodyOf('expandOut').match(/addReceivedToOut\(\)/g) || []).length === 3,
   String((bodyOf('expandOut').match(/addReceivedToOut\(\)/g) || []).length));
// เจ้าของเลือกให้ปล่อยยอดเบิกว่าง — ตั้งยอดให้แล้วของที่เคยเบิกไปบางส่วนจะถูกบันทึกซ้ำ
ok('แถวที่เติมในหน้าจ่ายออกต้องไม่ตั้งยอดเบิกให้', !/\.qty\s*=/.test(bodyOf('addReceivedToOut')));
// ผู้ตรวจรอบสามของ #79: คืนแค่จำนวนที่เพิ่งเติม กางซ้ำในใบเดิมได้ 0 ข้อความ "อีก N รายการ…" หายทั้งที่แถวยังอยู่บนจอ
ok('ข้อความบอกจำนวนแถวที่เติม นับแถวที่อยู่บนจอทั้งหมด ไม่ใช่แค่ที่เพิ่งเติมรอบนี้',
   bodyOf('addReceivedToOut').includes('l.fromRecv = true')
   && /return outLines\.value\.filter\(l => l\.fromRecv\)\.length/.test(bodyOf('addReceivedToOut'))
   && !/return extra\.length/.test(bodyOf('addReceivedToOut')));

// ผู้ตรวจของ #79 เจอเพิ่มอีกสามทางที่สองหน้ากางไม่เท่ากัน — เจ้าของสั่งแก้ในใบเดียวกัน
const htmlSrc = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ok('ช่อง PO ของหน้าจ่ายออกเติม P/N จากไฟล์ PO ก่อนกาง (pickOutPo) เหมือนหน้ารับเข้า (pickPo)',
   /v-model\.trim="outH\.po"[^>]*@change="pickOutPo"/.test(htmlSrc)
   && /v-model\.trim="inH\.po"[^>]*@change="pickPo"/.test(htmlSrc));
ok('pickOutPo เติม P/N จากไฟล์ PO แล้วกางต่อ แต่ไม่เติมวันที่ (วันจ่ายออกคือวันที่เบิก)',
   bodyOf('pickOutPo').includes('poHeader(') && bodyOf('pickOutPo').includes('outH.pn')
   && bodyOf('pickOutPo').includes('expandOut()') && !bodyOf('pickOutPo').includes('outH.date'));
// เจ้าของ 16 ก.ย. 2026: ของที่เบิกทำ P/N หนึ่งไม่ได้จ่ายครบทุกรหัสในรอบเดียว ยอดที่เติมให้ทั้งใบกลายเป็นงานนั่งลบ
ok('หน้ารับเข้ายังเติมจำนวนสั่งจากไฟล์ PO · หน้าจ่ายออกไม่เติม',
   /inH\.order = h\.order/.test(bodyOf('pickPo')) && !/outH\.order = h\.order/.test(bodyOf('pickOutPo')));
/* ผู้ตรวจรอบสองของ #81: เลิกเติมจำนวนสั่งแล้วไม่มีใครล้างค่าเดิมทิ้ง เลขของใบก่อนจึงค้างข้ามใบ
 * ไปคูณ usage ของ P/N ใบใหม่ แล้วช่อง "ตามสูตร" ขึ้นเลขผิดเงียบ ๆ ทั้งที่ P/N บนจอถูกต้อง
 * ต้องปิดทั้งสามทาง: คีย์ PO ใบใหม่ · กดปุ่ม "ล้าง" · บันทึกจบ
 * ⚠️ ห้ามใช้ switchedPo เป็นเงื่อนไข — หลัง clearOut/saveOut ค่า outShownPo ว่าง switchedPo คืน false */
// เอาคอมเมนต์ออกก่อนตรวจ — ข้อนี้ตรวจว่าโค้ดทำอะไร ไม่ใช่ว่าคอมเมนต์เอ่ยถึงอะไร
const codeOf = name => bodyOf(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('ขึ้นใบใหม่แล้วจำนวนสั่งของหน้าจ่ายออกต้องว่าง ไม่ใช่ค่าของใบเก่า',
   /outH\.order = null/.test(codeOf('pickOutPo'))
   && /outH\.order = null/.test(codeOf('clearOut'))
   && /outH\.order = null/.test(codeOf('saveOut'))
   && !/switchedPo/.test(codeOf('pickOutPo')));
ok('สองหน้ากางสูตรผ่านตัวกรองเดียวกัน (ตัดบรรทัดสูตรที่ลบแล้ว)',
   /const inBomRows = computed\(\(\) => inH\.pn \? activeBomRowsOf\(/.test(appSrc)
   && /const outBomRows = computed\(\(\) => outH\.pn \? activeBomRowsOf\(/.test(appSrc)
   && bodyOf('expandBom').includes('inBomRows.value') && bodyOf('expandOut').includes('outBomRows.value')
   && !/bom\.value\.filter/.test(bodyOf('expandBom') + bodyOf('expandOut')));
// เจ้าของ 16 ก.ย. 2026: Kit List ไม่ใช่ตัวกำหนดยอดตามสูตร — รหัสที่มีในสูตรต้องมียอดตามสูตรทุกแถว
ok('ยอดตามสูตรมาจากตัวเดียวกันทั้งสองหน้า ไม่คำนวณเองในหน้า',
   bodyOf('fillInLine').includes('reqmtOf(') && bodyOf('fillOutLine').includes('reqmtOf(')
   && !/Math\.round\([^)]*usage/.test(bodyOf('expandBom') + bodyOf('expandOut')));
ok('แถวที่เติมเพราะเคยรับเข้ากับ PO นี้ และแถวที่พนักงานคีย์รหัสเอง ก็ได้ยอดตามสูตร',
   bodyOf('markReceived').includes('fillInLine(') && bodyOf('addReceivedToOut').includes('fillOutLine(')
   && /@change="fillInLine\(l\)"/.test(htmlSrc) && /@change="fillOutLine\(l\)"/.test(htmlSrc)
   && bodyOf('choosePick').includes('fillInLine('));
ok('P/N ที่ไม่มีสูตร ยอดตามสูตรของบรรทัดที่ค้างบนจอต้องหายตาม ไม่ค้างเลขของ P/N ก่อนหน้า',
   /for \(const l of inLines\.value\) l\.reqmt = reqmtOf\(/.test(bodyOf('expandBom'))
   && /for \(const l of outLines\.value\) l\.reqmt = reqmtOf\(/.test(bodyOf('expandOut')));

// ผู้ตรวจรอบสองของ #79: รอบแรกล้างทุกครั้งที่แตะช่องหัว — คีย์บรรทัดเองแล้วค่อยเติม P/N บรรทัดหายหมด
// เจ้าของเลือก 15 ก.ย. 2026: ล้างเฉพาะตอนเลข PO เปลี่ยน
ok('เปลี่ยนจากเลขหนึ่งไปอีกเลขหนึ่ง = เปลี่ยนใบ', switchedPo('PO-A', 'PO-B'));
ok('เลข PO เดิม (แก้แค่ P/N หรือจำนวนสั่ง) ไม่ใช่เปลี่ยนใบ',
   !switchedPo('PO-A', 'PO-A') && !switchedPo('', '') && !switchedPo(undefined, null));
ok('เว้นวรรค หรือเลข PO ที่มาเป็นตัวเลข ไม่นับว่าเปลี่ยนใบ', !switchedPo(' 9001 ', 9001) && !switchedPo('9001', ' 9001'));
// ผู้ตรวจรอบสาม: คีย์บรรทัดเองก่อนใส่ PO (หรือกด "ไปเบิก" จากหน้าการ์ด) แล้วค่อยพิมพ์ PO บรรทัดหายหมด
// เจ้าของเลือก 16 ก.ย. 2026: ล้างเฉพาะเลขหนึ่ง → อีกเลขหนึ่ง
ok('จากช่องว่างเป็นมีเลข หรือลบเลขทิ้ง ไม่ใช่เปลี่ยนใบ — บรรทัดที่คีย์ก่อนใส่ PO ต้องอยู่',
   !switchedPo('', 'PO-A') && !switchedPo(null, 'PO-A') && !switchedPo('PO-A', '') && !switchedPo('PO-A', '  '));
ok('ลบเลข PO ทิ้งยังจำใบเดิมไว้ — ลบ A แล้วพิมพ์ B ยังนับว่าเปลี่ยนใบ ไม่ปล่อยบรรทัดของ A ค้างใต้หัว B',
   nextShownPo('PO-A', '') === 'PO-A' && switchedPo(nextShownPo('PO-A', ''), 'PO-B')
   && nextShownPo('', ' PO-B ') === 'PO-B' && nextShownPo('PO-A', 'PO-B') === 'PO-B' && nextShownPo(null, undefined) === '');
ok('สองหน้าล้างบรรทัดเฉพาะตอนเปลี่ยนใบ ไม่ใช่ทุกครั้งที่แตะช่องหัว',
   /switchedPo\(inShownPo, inH\.po\)/.test(bodyOf('expandBom'))
   && /switchedPo\(outShownPo, outH\.po\)/.test(bodyOf('expandOut'))
   && /if \(poSwitched\) inLines\.value = \[\]/.test(bodyOf('expandBom'))
   && /if \(poSwitched\) outLines\.value = \[\]/.test(bodyOf('expandOut'))
   && !/if \((inH|outH)\.po \|\| (inH|outH)\.pn\)/.test(appSrc));
ok('จำเลข PO ของรายการบนจอทุกครั้งที่กาง ก่อนแยกทาง — ไม่งั้นทางที่ return ก่อนจะไม่ได้จำ',
   /const poSwitched = switchedPo\(inShownPo, inH\.po\);\s*inShownPo = nextShownPo\(inShownPo, inH\.po\);/.test(bodyOf('expandBom'))
   && /const poSwitched = switchedPo\(outShownPo, outH\.po\);\s*outShownPo = nextShownPo\(outShownPo, outH\.po\);/.test(bodyOf('expandOut')));
// เจ้าของเลือก 15 ก.ย. 2026: ทางสูตรของหน้าจ่ายออกไม่ตั้งยอดเบิก — ช่อง PO เติม P/N กับจำนวนสั่งให้แล้ว
// ถ้ายังตั้งยอดตามสูตร แค่คีย์ PO ก็กดบันทึกทั้งใบได้ · ทาง Kit List ยังตั้งตามที่ Delta จ่ายมา (ยอดจากเอกสาร)
// เจ้าของเลือก 16 ก.ย. 2026: ใบที่มี Kit List ก็ปล่อยยอดเบิกว่างเหมือนทางสูตร
// ยอดที่ Delta จ่ายมาโชว์ในคอลัมน์ของมันเอง — เห็นไว้เทียบได้ แต่ไม่ถูกบันทึกถ้าไม่คีย์
// ⚠️ ต้องตัดเฉพาะเทมเพลตของหน้าจ่ายออกมาเช็ก — หน้ารับเข้ามีคอลัมน์ชื่อเดียวกันอยู่ก่อนแล้ว
//    เช็กทั้งไฟล์จะเขียวทั้งที่คอลัมน์ของหน้าจ่ายออกถูกลบไป (เจอตอนย้อนโค้ดทดสอบเทสเอง)
const outTpl = htmlSrc.slice(htmlSrc.indexOf("tab==='out'"));
ok('หน้าจ่ายออกไม่ตั้งยอดเบิกให้ทุกทาง · โชว์ยอดที่ Delta จ่ายมาแทน',
   !/l\.qty\s*=/.test(bodyOf('expandOut')) && bodyOf('expandOut').includes('l.issued = k.issue')
   && outTpl.length > 500 && /<th[^>]*>Delta จ่ายมา<\/th>/.test(outTpl) && /l\.issued == null/.test(outTpl));
// ผู้ตรวจรอบสาม: บันทึกหรือกด "ล้าง" แล้วจอว่างแต่ยังจำ PO เดิม — คีย์บรรทัดต่อแล้วเปลี่ยน PO บรรทัดหาย
ok('บันทึกหรือกด "ล้าง" แล้วลืมเลข PO เดิม ทั้งสองหน้า',
   /inShownPo = ''/.test(bodyOf('saveIn')) && /outShownPo = ''/.test(bodyOf('saveOut'))
   && /inShownPo = ''/.test(bodyOf('clearIn')) && /outShownPo = ''/.test(bodyOf('clearOut'))
   && /@click="clearIn"/.test(htmlSrc) && /@click="clearOut"/.test(htmlSrc)
   && !/@click="(inLines|outLines)=\[\]/.test(htmlSrc));

/* ⚠️ ชื่อที่ import เข้า app.js ห้ามถูกประกาศซ้ำในไฟล์ — ตัวในไฟล์จะบังตัว import เงียบ ๆ
 *    เจอจริงตอนทำ #79: ตั้งชื่อตัวกรองสูตรว่า bomRowsOfPn ซึ่งซ้ำกับ computed ของหน้าแก้สูตร
 *    เทสอ่านซอร์สทุกข้อข้างบนเขียว แต่เปิดหน้าจ่ายออกแล้วพังด้วย "is not a function"
 *    ข้อนี้คุมทั้งไฟล์ ไม่ใช่แค่ชื่อเดียว */
const importedNames = [...appSrc.matchAll(/import\s*\{([^}]*)\}\s*from/g)]
  .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
const shadowed = importedNames.filter(n => new RegExp('(?:const|let|var|function)\\s+' + n + '\\b').test(appSrc));
ok('ชื่อที่ import เข้า app.js ต้องไม่ถูกประกาศซ้ำในไฟล์', importedNames.length > 20 && shadowed.length === 0,
   'ซ้ำ: ' + shadowed.join(', ') + ' · อ่านชื่อได้ ' + importedNames.length);

console.log('\n=== I. ค้นเลข PO จากที่พิมพ์บางส่วน (เจ้าของ 16 ก.ย. 2026) ===');
// เลขสมมติ · เจ้าของสั่งว่ารายการต้องมี "ทุก PO ที่เคยมีประวัติในโปรแกรม"
// TM5269H0031 เป็นตัวล่อ — มี "H003" อยู่กลางเลขแต่ไม่ได้ลงท้าย และวันที่ใหม่กว่า
// ถ้าไม่ให้คะแนนท้ายเลขสูงกว่า ตัวล่อจะขึ้นก่อนใบที่พนักงานตั้งใจพิมพ์
const hPos = [{ po: 'TM5269H001', pn: '2873100001', date: '2026-09-10' },
              { po: 'TM5269H0031', pn: '2873100031', date: '2026-09-16' }];
const hKits = [{ po: 'TM5269H002', pn: '2873100002', date: '2026-09-12', code: 'C1', src: 'kit' }];
const hEntries = [
  { entity: 'NSE', kind: 'receive', doc_ref: 'TM5269H003', part_no: '2873100003', at: '2026-09-14T02:00:00.000Z' },
  { entity: 'NSE', kind: 'issue', doc_ref: 'TM5269H001', at: '2026-09-15T02:00:00.000Z' },
  { entity: 'OTHER', kind: 'receive', doc_ref: 'TM9999X999', at: '2026-09-15T02:00:00.000Z' },
  { entity: 'NSE', kind: 'receive', doc_ref: 'TM5269H004', at: '2026-09-15T02:00:00.000Z', voided: true },
  // แถวที่ช่องนิติบุคคลว่าง — ด่านที่กันต้องเป็น "ยังไม่เลือกนิติบุคคล = ไม่แตะสมุด"
  // ไม่ใช่การเทียบค่าที่บังเอิญไม่ตรง (poHistory ตั้งค่าเริ่มต้น entity = '' แถวนี้จึงเท่ากันพอดีถ้าด่านหาย)
  { entity: '', kind: 'receive', doc_ref: 'TM5269H404', at: '2026-09-15T03:00:00.000Z' }
];
const hShorts = [{ entity: 'NSE', po: 'TM5269H005', part_no: '2873100005', date: '2026-09-13' }];
const hist = poHistory({ pos: hPos, kits: hKits, entries: hEntries, shorts: hShorts, entity: 'NSE' });
const hPoList = hist.map(r => r.po);
ok('รวมทุกที่มา — ไฟล์ PO · Kit List · ใบที่เคยคีย์ · ของขาด',
   ['TM5269H001', 'TM5269H002', 'TM5269H003', 'TM5269H005'].every(p => hPoList.includes(p))
   && hist.length === 5, hPoList.join(','));
ok('ใบเดียวกันจากหลายที่มา รวมเป็นแถวเดียว และบอกที่มาครบ',
   hPoList.filter(p => p === 'TM5269H001').length === 1
   && hist.find(r => r.po === 'TM5269H001').from.join(',') === 'ไฟล์ PO,เคยคีย์');
ok('ใบที่ใช้ล่าสุดอยู่บนสุด', hPoList[0] === 'TM5269H0031', hPoList.join(','));
ok('เก็บ P/N ไว้ให้ดูก่อนเลือก', hist.find(r => r.po === 'TM5269H003').pn === '2873100003');
// A3 — สมุดกับของขาดเป็นของรายนิติบุคคล ห้ามข้ามกัน
ok('ใบของนิติบุคคลอื่นไม่ปนเข้ามา (A3)', !hPoList.includes('TM9999X999'));
ok('รายการที่ยกเลิกแล้วไม่นับ (B1)', !hPoList.includes('TM5269H004'));
ok('ใบที่ไม่ได้ระบุนิติบุคคลในสมุด ก็ไม่ขึ้นให้นิติบุคคลที่เลือกอยู่ (A3)', !hPoList.includes('TM5269H404'));
ok('ยังไม่ได้เลือกนิติบุคคล = เอาเฉพาะเอกสารกลาง ไม่แตะสมุด (A3)',
   poHistory({ pos: hPos, kits: hKits, entries: hEntries, shorts: hShorts }).map(r => r.po).join(',')
   === 'TM5269H0031,TM5269H002,TM5269H001');
// ผู้ตรวจ #82 รอบสาม: core/count.js เขียน session.id ลง doc_ref — เลขใบนับจึงโผล่เป็น "เลข PO" และได้วันที่ล่าสุด
// ผูกกับ makeSession/postCount ตัวจริง ไม่ปั้น object เอง เพื่อให้เทสยังจับได้ถ้าวันหลัง count.js เปลี่ยนรูปแบบ id
const cs = makeSession({ entity: 'NSE', name: 'นับปลายเดือน', person: 'สมชาย' });
const countEntries = postCount(cs, [{ code: '2873100001', kind: 'adjust', counted: 5, book: 7, delta: -2 }], {});
ok('เลขใบนับของไม่โผล่ในประวัติ PO',
   countEntries.length === 1 && countEntries[0].doc_ref === cs.id
   && poHistory({ entity: 'NSE', entries: countEntries }).length === 0,
   poHistory({ entity: 'NSE', entries: countEntries }).map(r => r.po).join(','));
// และต้องไม่ตัดรายการปกติทิ้งไปด้วย — ใบที่ doc_kind ว่างหรือเป็น 'po' ยังต้องอยู่
ok('รายการที่ doc_kind ว่างหรือเป็น po ยังนับเป็นประวัติเหมือนเดิม',
   poHistory({ entity: 'NSE', entries: [
     { entity: 'NSE', doc_kind: 'po', doc_ref: 'TM5269H008', at: '2026-09-15T02:00:00.000Z' },
     { entity: 'NSE', doc_ref: 'TM5269H009', at: '2026-09-15T02:00:00.000Z' },
     ...countEntries
   ] }).map(r => r.po).sort().join(',') === 'TM5269H008,TM5269H009');

ok('ไม่มีข้อมูลเลยก็ไม่พัง', poHistory().length === 0 && poHistory({ pos: null, kits: null }).length === 0);
ok('เลข PO ว่างไม่ถูกนับเป็นใบ', poHistory({ pos: [{ po: '   ' }, { po: null }] }).length === 0);

// ผู้ตรวจ #82 ทัก: at ของสมุดเป็น UTC — slice(0,10) เอาเองทำให้ใบที่คีย์กะเช้า (เข้างานตีห้า) กลายเป็นเมื่อวาน
// ⚠️ ต้องปักโซนเวลาไว้ที่ไทยชั่วคราว เพราะเครื่องที่รันเทสบน GitHub Actions อยู่โซน UTC พอดี
//    ซึ่งไม่มีส่วนต่างให้เลื่อน วิธีผิดจะดูเหมือนถูกและจับอาการไม่ได้เลย (เหมือนที่ v2-export ชี้ไว้)
const tzBefore = process.env.TZ;
process.env.TZ = 'Asia/Bangkok';
const dawnHist = poHistory({
  entity: 'NSE',
  entries: [
    // ตีห้าของวันที่ 17 ตามเวลาไทย = 2026-09-16T22:00Z
    { entity: 'NSE', doc_ref: 'TM5269H006', part_no: '2873100006',
      at: atFrom('2026-09-17', new Date(2026, 8, 17, 5, 0, 0)) },
    // เมื่อวานตอนเย็น — ใบนี้ต้องอยู่ล่างกว่า
    { entity: 'NSE', doc_ref: 'TM5269H007', part_no: '2873100007',
      at: atFrom('2026-09-16', new Date(2026, 8, 16, 20, 0, 0)) }
  ]
});
if (tzBefore === undefined) delete process.env.TZ; else process.env.TZ = tzBefore;
ok('ใบที่คีย์กะเช้าตีห้า ได้วันที่ตามเวลาไทย ไม่เลื่อนไปเมื่อวาน',
   dawnHist.find(r => r.po === 'TM5269H006').date === '2026-09-17',
   dawnHist.map(r => r.po + '=' + r.date).join(' · '));
ok('ใบที่เพิ่งคีย์เมื่อเช้าอยู่บนสุด ไม่ถูกใบเมื่อวานเย็นแซง',
   dawnHist.map(r => r.po).join(',') === 'TM5269H006,TM5269H007',
   dawnHist.map(r => r.po + '=' + r.date).join(' · '));

ok('พิมพ์ 4 ตัวท้าย เจอใบนั้นเป็นอันดับแรก แม้มีใบอื่นที่มีเลขชุดนี้อยู่กลางเลขและใหม่กว่า',
   searchPos(hist, 'H003')[0].po === 'TM5269H003', searchPos(hist, 'H003').map(r => r.po).join(','));
ok('พิมพ์เลขเต็มได้ใบนั้นตรง ๆ', searchPos(hist, 'tm5269h002')[0].po === 'TM5269H002');
ok('พิมพ์ต้นเลขก็เจอครบทุกใบ', searchPos(hist, 'TM5269').length === 5, String(searchPos(hist, 'TM5269').length));
ok('ค้นด้วย P/N ก็ได้', searchPos(hist, '2873100005')[0].po === 'TM5269H005');
ok('ไม่ได้พิมพ์อะไร = ได้ทั้งหมด เรียงใบล่าสุดก่อน', searchPos(hist, '')[0].po === 'TM5269H0031');
ok('ไม่เจอ = ว่าง ไม่ใช่ทั้งหมด', searchPos(hist, 'ZZZZ').length === 0);
ok('จำกัดจำนวนที่แสดงได้', searchPos(hist, '', { limit: 2 }).length === 2);
ok('รายการว่างหรือไม่ได้ส่งมา ก็ไม่พัง', searchPos([], 'x').length === 0 && searchPos(null, 'x').length === 0);
// ผู้ตรวจ #82 ทัก: คะแนนเสมอกันแล้วตัดสินด้วยอะไร ยังไม่มีเทสล็อกไว้ ใครมาแก้ลำดับทีหลังจะไม่มีอะไรเตือน
const tie = [{ po: 'AA-1234', date: '2026-09-10' }, { po: 'CC-1234', date: '2026-09-15' },
             { po: 'BB-1234', date: '2026-09-15' }];
ok('ลงท้ายเหมือนกันหลายใบ — ใบที่ใช้ล่าสุดขึ้นก่อน วันเดียวกันเรียงตามเลข',
   searchPos(tie, '1234').map(r => r.po).join(',') === 'BB-1234,CC-1234,AA-1234',
   searchPos(tie, '1234').map(r => r.po).join(','));

// ต่อสายบนจอ — ปุ่มค้นอยู่ข้างช่อง PO ทั้งสองหน้า และเลือกแล้วต้องเดินเส้นทางเดิมของหน้านั้น
ok('ปุ่มค้นเลข PO อยู่ทั้งหน้ารับเข้าและหน้าจ่ายออก',
   /@click="openPoPick\('in'\)"/.test(htmlSrc) && /@click="openPoPick\('out'\)"/.test(htmlSrc));
ok('กล่องค้นใช้ poPickResults และกดเลือกแล้วเรียก choosePo',
   /v-for="r in poPickResults"/.test(htmlSrc) && /@click="choosePo\(r\)"/.test(htmlSrc));
ok('เลือกใบแล้วเดินเส้นทางเดิมของแต่ละหน้า (เติม P/N · กางรายการ)',
   bodyOf('choosePo').includes('pickPo()') && bodyOf('choosePo').includes('pickOutPo()'));
ok('รายการเลข PO มาจาก poHistory ที่ส่งนิติบุคคลที่เลือกอยู่ไปด้วย (A3)',
   /poHistory\(\{[\s\S]*entity: entity\.value/.test(appSrc));
// เจ้าของเลือก 17 ก.ย. 2026 หลังผู้ตรวจ #82 ทัก
ok('เปิดกล่องค้นแล้วเคอร์เซอร์อยู่ในช่องพิมพ์เลย ทั้งกล่องค้น PO และกล่องค้นรหัสวัตถุดิบ',
   bodyOf('openPoPick').includes('focusSoon(poPickInput)') && bodyOf('openPick').includes('focusSoon(pickInput)')
   && /ref="poPickInput"/.test(htmlSrc) && /ref="pickInput"/.test(htmlSrc)
   && /\.focus\(\)/.test(appSrc));
ok('ปุ่มค้นเลข PO ไม่กินจังหวะ Tab — กดจากช่อง PO ไป P/N ทีเดียวเหมือนเดิม',
   (htmlSrc.match(/tabindex="-1" title="ค้นจากเลขบางส่วน"/g) || []).length === 2,
   String((htmlSrc.match(/tabindex="-1" title="ค้นจากเลขบางส่วน"/g) || []).length));

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
