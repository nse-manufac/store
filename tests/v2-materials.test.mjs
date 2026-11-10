/**
 * เทสทะเบียนวัตถุดิบของ v2 — ตรรกะล้วน รันด้วย node
 *   node tests/v2-materials.test.mjs
 *
 * ข้อที่สำคัญที่สุดในไฟล์นี้คือหมวด A กับ C
 * A คือบั๊กที่วัดจากทะเบียนจริงแล้วผิด 40 รายการ
 * C คืออาการที่พนักงานแจ้งเข้ามาเองใน issue #26
 */
import { categorize, checkCode, normCode, makeMaterial, addedOnFloor,
         searchMaterials, duplicateDescriptions, CATEGORIES , codeSuggest, parsePriceFile, priceOf } from '../v2/master/materials.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. จัดหมวดต้องจบคำ (บั๊ก PIN ไปตรงกับ PINK) ===');
ok('FOAM PAD ... PINK เป็นแพ็กกิ้ง ไม่ใช่โลหะ',
   categorize('FOAM PAD EPE 265*230*5 PINK') === 'PACKING',
   categorize('FOAM PAD EPE 265*230*5 PINK'));
ok('DIVIDER TRAY ... PINK เป็นแพ็กกิ้ง',
   categorize('DIVIDER TRAY EPE 265*230*46 PINK') === 'PACKING');
ok('PARTITION EPE ... PINK เป็นแพ็กกิ้ง',
   categorize('PARTITION EPE 35.5*37*33 PINK') === 'PACKING');
ok('ของที่มีคำว่า PIN จริง ๆ ยังเป็นโลหะ',
   categorize('PIN CU 0.6*0.6*12') === 'METAL PART', categorize('PIN CU 0.6*0.6*12'));
ok('BASELUG ยังเป็น BASE ไม่หล่นไป OTHER',
   categorize('BASELUG T220NA PQI2620 2P') === 'BASE', categorize('BASELUG T220NA PQI2620 2P'));
ok('CORE COATING เป็นแกน ไม่ใช่เคมี',
   categorize('CORE COATING 4140190419') === 'CORE', categorize('CORE COATING 4140190419'));
ok('WIRE CU เป็นลวด', categorize('WIRE CU 0.5 2UEW MW-75C') === 'WIRE');
// PML = Packing Material Label — v1 จัดเป็น FG/SEMI ซึ่งผิด มี 209 รายการ
ok('PML เป็นแพ็กกิ้ง ไม่ใช่สินค้ากึ่งสำเร็จรูป',
   categorize('PML 2801960000') === 'PACKING', categorize('PML 2801960000'));
ok('TAPE PI เป็นเทป', categorize('TAPE PI 20mm KA180 AMBER') === 'TAPE');
ok('EOL(PFR) ถูกตัดหัวออกก่อนดู',
   categorize('EOL(PFR) BOBBIN PM9820 PQ3020') === 'BOBBIN');
ok('คำอธิบายว่างได้ OTHER', categorize('') === 'OTHER');
ok('ทุกหมวดที่กฎคืนมาอยู่ในรายการที่อนุญาต',
   ['FOAM PAD X PINK', 'WIRE CU', 'CORE X', 'อะไรก็ไม่รู้']
     .every(d => CATEGORIES.includes(categorize(d))));

console.log('\n=== B. ตรวจรหัส — เตือน ไม่บล็อก ===');
ok('รหัสปกติผ่าน', checkCode('3220130200').level === 'ok');
ok('รหัสที่มีอักษรท้ายผ่าน', checkCode('3170383400M').level === 'ok',
   JSON.stringify(checkCode('3170383400M')));
ok('รหัสขึ้นต้น 28 เตือนว่าน่าจะเป็นของทำเอง', checkCode('2831738022').level === 'warn');
ok('แต่ไม่บล็อก — ยังบันทึกได้', checkCode('2831738022').level !== 'bad');
ok('รหัสสั้นเกินเตือน', checkCode('123').level === 'warn');
ok('รหัสมีช่องว่างถือว่าผิด', checkCode('3220 130200').level === 'bad');
ok('ไม่กรอกเลยถือว่าผิด', checkCode('').level === 'bad');
ok('ตัดช่องว่างหัวท้ายแล้วเทียบ', normCode('  3220130200 ') === '3220130200');

console.log('\n=== C. ช่องเลือกรหัส — แยกของที่ชื่อซ้ำกันออกได้ (issue #26) ===');
const mats = [
  makeMaterial({ material_code: '3500224400', description: 'FOAM PAD EPE 265*230*5 PINK', unit: 'PCE' }),
  makeMaterial({ material_code: '3502870800', description: 'FOAM PAD EPE 265*230*5 PINK', unit: 'PCE' }),
  makeMaterial({ material_code: '3520870800', description: 'FOAM PAD EPE 265*230*5 PINK', unit: 'PCE' }),
  makeMaterial({ material_code: '3500520400', description: 'FOAM PAD EPE 265*230*10 WHT', unit: 'PCE' }),
  makeMaterial({ material_code: '3220130200', description: 'TAPE PLE 6mm #1350F-1 YEL', unit: 'MTR' }),
  makeMaterial({ material_code: '4010600100', description: 'WIRE CU 0.5 2UEW MW-75C', unit: 'KGM', active: false })
];
const foam = searchMaterials(mats, 'FOAM PAD EPE 265*230*5');
ok('ค้นด้วยชื่อเจอครบสามตัว', foam.length === 3, String(foam.length));
ok('ทั้งสามถูกทำเครื่องหมายว่าชื่อซ้ำ', foam.every(m => m.dupDesc));
ok('ตัวที่ชื่อไม่ซ้ำไม่ถูกทำเครื่องหมาย',
   searchMaterials(mats, '265*230*10').every(m => !m.dupDesc));
ok('ค้นด้วยรหัสได้', searchMaterials(mats, '3220130200')[0].material_code === '3220130200');
ok('รหัสตรงเป๊ะมาก่อน',
   searchMaterials(mats, '3500224400')[0].material_code === '3500224400');
ok('ค้นด้วยชื่อบางส่วนได้', searchMaterials(mats, 'TAPE').length === 1);
ok('ของที่ปิดใช้งานไม่ขึ้นมา',
   searchMaterials(mats, 'WIRE').length === 0, String(searchMaterials(mats, 'WIRE').length));
ok('เปิดดูของที่ปิดใช้งานได้ถ้าขอ',
   searchMaterials(mats, 'WIRE', { activeOnly: false }).length === 1);
ok('ค้นด้วยคำว่างได้ทั้งหมดที่ยังใช้อยู่', searchMaterials(mats, '').length === 5);

const dups = duplicateDescriptions(mats);
ok('สรุปรายการชื่อซ้ำได้', dups.length === 1 && dups[0].codes.length === 3,
   JSON.stringify(dups));

console.log('\n=== D. สร้างรายการใหม่ ===');
const m = makeMaterial({ material_code: ' 3220130200 ', description: '  TAPE PLE 6mm  ', unit: 'mtr' });
ok('รหัสถูกตัดช่องว่าง', m.material_code === '3220130200');
ok('หน่วยเป็นตัวใหญ่', m.unit === 'MTR');
ok('เดาหมวดให้อัตโนมัติ', m.category === 'TAPE');
ok('ค่าเริ่มต้นคือใช้งานอยู่', m.active === true);
const chem = makeMaterial({ material_code: '4020208300', description: 'THINNER IPA 800' });
ok('เคมีถูกตั้งว่าต้องมีวันหมดอายุเอง', chem.requires_expiry === true);
ok('ระบุหมวดเองได้ ไม่ถูกเดาทับ',
   makeMaterial({ material_code: '1234567890', description: 'อะไรสักอย่าง', category: 'OTHER' }).category === 'OTHER');

const floor = addedOnFloor({ material_code: '3999999900', description: 'เทปใหม่ที่เพิ่งเจอ', unit: 'MTR' }, 'สมชาย');
ok('รหัสที่เพิ่มหน้างานติดธงรอตรวจ', floor.needs_review === true);
ok('บันทึกไว้ว่าใครเพิ่ม', floor.note.includes('สมชาย'), floor.note);
ok('รู้ว่ามาจากการเพิ่มด้วยมือ', floor.source === 'มือ');

console.log('\n=== พิมพ์รหัสบางส่วนแล้วมีตัวเลือก (เจ้าของสั่ง 10 ต.ค. 2026) ===');
{
  const L = [{ material_code: '9100000101', description: 'TAPE 6mm', unit: 'MTR' },
             { material_code: '9100000201', description: 'TAPE 8mm', unit: 'MTR' },
             { material_code: '9100000102', description: 'BOBBIN 0101', unit: 'PCE' },
             { material_code: '5999000101', description: 'CORE', unit: 'PCE', active: false }];
  const a = codeSuggest(L, '0101');
  ok('พิมพ์เลขท้าย — ตัวที่ลงท้ายด้วยขึ้นก่อน · ไม่ค้นในชื่อ (BOBBIN 0101 ไม่โผล่) · ตัวที่ปิดใช้ไม่โผล่',
     a.items.map(m => m.material_code).join() === '9100000101' && a.code === '9100000101', JSON.stringify(a.items.map(m => m.material_code)));
  const b = codeSuggest(L, '01');
  ok('ตรงหลายตัว = ไม่เดา (code ว่าง) ให้คนเลือก', b.code === '' && b.items.length === 3);
  ok('พิมพ์เต็มตรงเป๊ะ = ได้เลย', codeSuggest(L, '9100000201').code === '9100000201');
  ok('ไม่พิมพ์ / ไม่ตรงอะไร = ว่าง', codeSuggest(L, '').items.length === 0 && codeSuggest(L, 'ZZZ').code === '');
  ok('เพดานจำนวนตัวเลือก', codeSuggest(L, '0', { limit: 2 }).items.length === 2);
}

console.log('\n=== PR. ไฟล์ราคาแมท (เจ้าของสั่ง 8 พ.ย. 2026) — ราคาสมมติทั้งหมด ===');
{
  const aoa = [
    ['ITEM', 'MATERIAL NO', 'MATERIAL DESCRIPTION', 'VENDOR', 'STOCK QTY', 'STD COST', 'REMARK '],
    [1, 901000001, 'ของ 9 หลัก', 1, 10, 1.25, null],          // Excel ตัด 0 หน้ารหัส
    [2, 9100000002, 'ของ 2', 1, 10, 2.5, null],
    [3, '91000000AB', 'รหัสมีตัวอักษร', 1, 10, '1,234.5', null],
    [4, 9100000004, 'ราคาว่าง', 1, 10, null, null],
    [5, 9100000005, 'ราคาติดลบ', 1, 10, -3, null],
    [6, 9100000006, 'ซ้ำ ราคาไม่ตรง', 1, 10, 1, null],
    [7, 9100000006, 'ซ้ำ ราคาไม่ตรง', 1, 10, 2, null],
    [8, 9100000007, 'ซ้ำ ราคาเดียวกัน', 1, 10, 3, null],
    [9, 9100000007, 'ซ้ำ ราคาเดียวกัน', 1, 10, 3, null],
    [10, 9100000008, 'ของฟรี', 1, 10, 0, null],
    [null, null, null, null, null, null, null]];
  const p = parsePriceFile(aoa);
  ok('หาหัว MATERIAL NO + STD COST เจอ · อ่านราคาตัวเลข / ข้อความมีจุลภาค',
     p.ok && p.prices['9100000002'] === 2.5 && p.prices['91000000AB'] === 1234.5, JSON.stringify(p.prices));
  ok('ช่องราคาว่าง / ติดลบ = ข้าม (นับไว้) ไม่ใส่ 0 ให้', !('9100000004' in p.prices) && !('9100000005' in p.prices) && p.bad === 2, String(p.bad));
  ok('รหัสซ้ำราคาไม่ตรง = ไม่คิดราคาให้ + บอกรายชื่อ · ซ้ำราคาเดียวกัน = ใช้ได้',
     !('9100000006' in p.prices) && p.conflicts.join() === '9100000006' && p.prices['9100000007'] === 3);
  ok('ราคา 0 (ของฟรี) เก็บเป็น 0 ไม่ใช่ไม่มีราคา', priceOf(p.prices, '9100000008') === 0);
  ok('Excel ตัด 0 หน้ารหัส: ทะเบียน 0901000001 หาเจอ · ไฟล์มีเลข 10 หลักแต่คีย์ 9 หลักก็เจอ',
     priceOf(p.prices, '0901000001') === 1.25 && priceOf({ '0901000009': 7 }, '901000009') === 7);
  ok('ไม่มีในไฟล์ / ไม่มีไฟล์ = null (ห้ามเป็น 0)',
     priceOf(p.prices, '9199999999') === null && priceOf(null, '9100000002') === null && priceOf(p.prices, '') === null);
  ok('หัวอยู่ใต้แถวชื่อเรื่อง + แบบไฟล์ data.1 (หัว "price") ก็อ่านได้',
     parsePriceFile([['รายงานราคา'], [], ['ITEM', 'MATERIAL NO', 'DESC', ' Unit', 'price'], [1, 9100000002, 'x', 'PCS', 4]]).prices['9100000002'] === 4);
  ok('ไฟล์มีทั้ง PRICE และ STD COST = ใช้ STD COST เสมอ แม้ PRICE อยู่ซ้ายกว่า (ผู้ตรวจ #154 ข้อ 4)',
     parsePriceFile([['MATERIAL NO', 'PRICE', 'STD COST'], ['A1', 1, 2]]).prices.A1 === 2);
  ok('หัวครบแต่ราคาใช้ไม่ได้ทุกแถว = ok:true n:0 + นับ bad (แอปบอกเหตุให้ถูก)',
     (q => q.ok && q.n === 0 && q.bad === 2)(parsePriceFile([['MATERIAL NO', 'STD COST'], ['A1', null], ['A2', 'x']])));
  ok('ไม่มีหัวที่รู้จัก = ok:false ไม่เดาคอลัมน์', !parsePriceFile([['A', 'B'], [1, 2]]).ok && !parsePriceFile(null).ok);
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
