/**
 * เทส BOM ของ v2 — รันด้วย node
 *   node tests/v2-bom.test.mjs
 *
 * ข้อที่สำคัญที่สุดคือหมวด B — การนำเข้าต้องแทนที่ทั้ง P/N ไม่ใช่ผสมกัน
 * เพราะ Delta กำลังทยอยใส่ pack mat เข้ามาทีละ REV ถ้าผสมกันยอดจะเบิ้ลเงียบ ๆ
 */
import { makeBomRows, byPn, pnSummary, pnsMissingPackMat, unknownCodes,
         importPlan, bomId } from '../v2/master/bom.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

/** เอกสารจำลองที่ผ่านตัวอ่านมาแล้ว */
const doc = (pn, rev, valid, lines, extra = {}) => ({
  ok: true, pn, rev, valid, fileName: pn + '.html',
  lines: lines.map(l => ({ n: 1, altPct: null, uomConfirmed: true, uomWhy: '',
                           rawQpa: l.usage, rawUom: l.unit, ...l })),
  dropped: { parents: [], inhouse: [], badUom: [] }, unconfirmed: [], alt0: [], ...extra
});

const OLD = doc('2870627900', '002', '2022-08-10', [
  { code: '3220130200', desc: 'TAPE PLE 6mm #1350F-1 YEL', usage: 0.12, unit: 'MTR' },
  { code: '4010600100', desc: 'WIRE CU 0.5 2UEW MW-75C', usage: 0.002, unit: 'KGM' }
]);
const NEW = doc('2870627900', '003', '2026-06-26', [
  { code: '3220130200', desc: 'TAPE PLE 6mm #1350F-1 YEL', usage: 0.15, unit: 'MTR' },
  { code: '4010600100', desc: 'WIRE CU 0.5 2UEW MW-75C', usage: 0.002, unit: 'KGM' },
  { code: '3512142900', desc: 'CARTON PAPER 495*295*205', usage: 0.00625, unit: 'PCE',
    uomConfirmed: false, uomWhy: 'เชื่อว่าเป็นต่อ 1,000 ชิ้น' }
], { unconfirmed: [{ code: '3512142900' }] });

console.log('=== A. แปลงเป็นแถวที่เก็บได้ ===');
const rowsOld = makeBomRows(OLD);
ok('ได้ครบทุกบรรทัด', rowsOld.length === 2);
ok('id ผูก P/N กับรหัสเข้าด้วยกัน', rowsOld[0].id === bomId('2870627900', '3220130200'),
   rowsOld[0].id);
ok('เก็บ REV กับวันที่มีผลไว้ด้วย',
   rowsOld[0].rev === '002' && rowsOld[0].valid_from === '2022-08-10');
ok('เอกสารที่อ่านไม่ได้คืนแถวว่าง', makeBomRows({ ok: false }).length === 0);

console.log('\n=== B. นำเข้าใหม่ต้องแทนที่ทั้ง P/N ===');
const plan = importPlan([NEW], rowsOld);
ok('บอกว่าจะเข้ามากี่บรรทัด', plan.perPn[0].incoming === 3, String(plan.perPn[0].incoming));
ok('บอกว่าจะแทนที่ของเดิมกี่บรรทัด', plan.perPn[0].replacing === 2, String(plan.perPn[0].replacing));
ok('รู้ว่าไม่ใช่ P/N ใหม่', plan.perPn[0].isNew === false);
ok('P/N ที่ไม่เคยมีถูกบอกว่าใหม่',
   importPlan([NEW], []).perPn[0].isNew === true);

// จำลองการแทนที่จริง — ทิ้งของเดิมทั้ง P/N แล้วใส่ของใหม่
const merged = [...rowsOld.filter(r => r.pn !== NEW.pn), ...makeBomRows(NEW)];
ok('ไม่มีบรรทัดของ REV เก่าค้างอยู่', merged.length === 3, String(merged.length));
ok('ยอดของรหัสเดิมถูกทับด้วยค่าใหม่',
   merged.find(r => r.code === '3220130200').usage === 0.15,
   String(merged.find(r => r.code === '3220130200').usage));
ok('ไม่มี id ซ้ำกัน', new Set(merged.map(r => r.id)).size === merged.length);

console.log('\n=== C. ลากไฟล์เดิมเข้าซ้ำในรอบเดียว ===');
const dup = importPlan([NEW, NEW], []);
ok('เตือนว่ามี P/N ซ้ำในชุดที่ลากมา',
   dup.dupInBatch.length === 1 && dup.dupInBatch[0] === '2870627900',
   JSON.stringify(dup.dupInBatch));
ok('ไฟล์ที่อ่านไม่ได้ถูกแยกออกมา',
   importPlan([{ ok: false, error: 'พัง' }], []).failed.length === 1);

console.log('\n=== D. สรุปราย P/N ===');
const s = pnSummary(merged);
ok('รวมเป็น P/N เดียว', s.length === 1);
ok('นับบรรทัดถูก', s[0].lines === 3);
ok('นับ pack mat ได้จากคำอธิบาย', s[0].pack === 1, String(s[0].pack));
ok('นับบรรทัดที่หน่วยยังไม่ยืนยัน', s[0].unconfirmed === 1, String(s[0].unconfirmed));

console.log('\n=== E. P/N ที่ยังไม่มี pack mat — รายการที่ต้องขอ BOM ใหม่ ===');
const miss = pnsMissingPackMat(rowsOld);
ok('REV เก่าที่ไม่มีแพ็กกิ้งถูกจับ', miss.length === 1 && miss[0].pn === '2870627900',
   JSON.stringify(miss.map(m => m.pn)));
ok('REV ใหม่ที่มีแพ็กกิ้งแล้วไม่ถูกจับ', pnsMissingPackMat(merged).length === 0);

console.log('\n=== F. รหัสใน BOM ที่ยังไม่มีในทะเบียน ===');
const mats = [{ material_code: '3220130200' }, { material_code: '4010600100' }];
const unk = unknownCodes(merged, mats);
ok('เจอรหัสที่ขาด', unk.length === 1 && unk[0].code === '3512142900',
   JSON.stringify(unk.map(u => u.code)));
ok('บอกด้วยว่าใช้ใน P/N ไหน', unk[0].pns.includes('2870627900'));
ok('ไม่มีรหัสขาดเมื่อทะเบียนครบ',
   unknownCodes(merged, [...mats, { material_code: '3512142900' }]).length === 0);

console.log('\n=== G. รูปที่หน้าคีย์ใช้ ===');
const m = byPn(merged);
ok('จัดกลุ่มตาม P/N ได้', m.size === 1 && m.get('2870627900').size === 3);
ok('หาสูตรรายรหัสได้', m.get('2870627900').get('3512142900').usage === 0.00625);

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
