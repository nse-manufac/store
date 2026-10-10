import fs from 'node:fs';
/**
 * เทส BOM ของ v2 — รันด้วย node
 *   node tests/v2-bom.test.mjs
 *
 * ข้อที่สำคัญที่สุดคือหมวด B — การนำเข้าต้องแทนที่ทั้ง P/N ไม่ใช่ผสมกัน
 * เพราะ Delta กำลังทยอยใส่ pack mat เข้ามาทีละ REV ถ้าผสมกันยอดจะเบิ้ลเงียบ ๆ
 */
import { makeBomRows, byPn, pnSummary, pnsMissingPackMat, unknownCodes,
         importPlan, registryPlan, bomId, activeBomRowsOf, reqmtOf, manualBomPlan, manualRowsOf } from '../v2/master/bom.js';

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

console.log('\n=== H. ตั้งทะเบียนจาก BOM ===');
// ของจริงมีทั้งชื่อที่ SAP ตัดคนละที่ หน่วยไม่ตรงกัน และของทำเองที่อาจหลุดมา
const wild = makeBomRows(doc('2800404400', '006', '2022-09-15', [
  { code: '3220130200', desc: 'TAPE PLE 6mm #1350F-1 YEL', usage: 0.2, unit: 'MTR' },
  { code: '4020204800', desc: 'FLUX NON-CLEAN A83 ALPHA', usage: 0.01, unit: 'KGM' },
  { code: '2831524600', desc: 'BOBBIN+WIRE ASSY 28004044', usage: 1, unit: 'PCE' }
]));
const wild2 = makeBomRows(doc('2870599900', '004', '2023-01-01', [
  { code: '4020204800', desc: 'FLUX NON-CLEAN A83', usage: 0.02, unit: 'GRM' }
]));
const rPlan = registryPlan([...wild, ...wild2], [{ material_code: '3220130200',
  description: 'TAPE PLE 6mm #1350F-1 YEL', unit: 'MTR' }]);

ok('รหัสที่มีในทะเบียนแล้วไม่ถูกเสนอซ้ำ', !rPlan.rows.some(r => r.code === '3220130200'));
ok('ของทำเอง (ขึ้นต้น 28) ไม่ถูกเสนอ — กับดักเดียวกับ issue #26',
   !rPlan.rows.some(r => r.code === '2831524600'), JSON.stringify(rPlan.rows.map(r => r.code)));
ok('แต่บอกว่าข้ามอะไรไปบ้าง ไม่ใช่หายเงียบ',
   rPlan.inHouseSkipped.length === 1 && rPlan.inHouseSkipped[0] === '2831524600');
ok('เหลือของซื้อจริงตัวเดียว', rPlan.total === 1, String(rPlan.total));

const flux = rPlan.rows[0];
ok('ยกชื่อกับหน่วยจาก BOM มาให้', flux.desc === 'FLUX NON-CLEAN A83 ALPHA');
ok('เดาหมวดให้จากชื่อ', flux.category === 'CHEMICAL', flux.category);
ok('บอกว่ามาจาก P/N ไหนบ้าง', flux.pns.length === 2 && flux.nPn === 2);
ok('ชื่อไม่ตรงกันข้าม P/N ถูกติดธง และเก็บตัวอื่นไว้ให้เลือก',
   flux.descVaries && flux.otherDescs.includes('FLUX NON-CLEAN A83'));
// หน่วยไม่ตรงกันร้ายแรงกว่าชื่อไม่ตรง เพราะตัวเลขในสูตรจะคนละมาตราส่วน
ok('หน่วยไม่ตรงกันถูกติดธงและสรุปนับให้', flux.unitVaries && rPlan.unitVaries === 1,
   JSON.stringify(flux.units));

const dupPlan = registryPlan(wild2, [{ material_code: '9999999999',
  description: 'flux non-clean a83', unit: 'KGM' }]);
ok('ชื่อซ้ำกับรหัสที่มีอยู่แล้วถูกเตือน (เทียบแบบไม่สนตัวพิมพ์)',
   dupPlan.rows[0].dupDesc.includes('9999999999') && dupPlan.dupDesc === 1,
   JSON.stringify(dupPlan.rows[0].dupDesc));

const noU = registryPlan(makeBomRows(doc('2800000000', '001', '2024-01-01', [
  { code: '4090006500', desc: 'SOLDER BAR SN97/AG3', usage: 1, unit: '' }
])), []);
ok('ไม่มีหน่วยก็ยังเสนอได้ แต่ติดธงไว้', noU.rows[0].noUnit && noU.noUnit === 1);
ok('ไม่มีอะไรให้เพิ่มก็ตอบศูนย์ ไม่ใช่พัง', registryPlan([], []).total === 0);

console.log('\n=== สูตรที่หน้ารับเข้ากับหน้าจ่ายออกใช้กาง (issue #78) ===');
// เดิมหน้ารับเข้าไม่ตัดบรรทัดที่ลบแล้ว แต่หน้าจ่ายออกตัด — สองหน้ากางไม่เท่ากัน · เลขสมมติ
const bomAll = [
  { pn: '5267', code: '3220130200', usage: 1, deleted: false },
  { pn: '5267', code: '4090050100', usage: 2, deleted: true },     // ลบแล้ว (ติดธง แถวยังอยู่)
  { pn: 5267,   code: '5301000100', usage: 3 },                    // P/N เป็นตัวเลข · ไม่มีธง deleted
  { pn: '9999', code: '3220130200', usage: 4, deleted: false }
];
const got5267 = activeBomRowsOf(bomAll, '5267').map(r => r.code);
ok('ได้เฉพาะบรรทัดของ P/N นั้น ไม่ปนของ P/N อื่นที่ใช้รหัสเดียวกัน',
   activeBomRowsOf(bomAll, '5267').every(r => String(r.pn) === '5267') && !activeBomRowsOf(bomAll, '5267').some(r => r.usage === 4));
ok('ตัดบรรทัดที่ลบแล้วออก', !got5267.includes('4090050100'), got5267.join(','));
ok('P/N ที่เป็นตัวเลขกับข้อความเทียบเท่ากัน', got5267.includes('5301000100') && activeBomRowsOf(bomAll, 5267).length === 2,
   got5267.join(','));
ok('ไม่มีสูตรหรือยังไม่ได้โหลด ก็ไม่พัง', activeBomRowsOf([], '5267').length === 0 && activeBomRowsOf(null, '5267').length === 0);

// เจ้าของ 16 ก.ย. 2026: Kit List ไม่ใช่ตัวกำหนดยอดตามสูตร — มีในสูตรเมื่อไหร่ ต้องขึ้นทุกแถวทั้งสองหน้า
const rq = [{ pn: 'PN-A', code: 'C-TAPE7', usage: 0.07 }, { pn: 'PN-A', code: 'C-TAPE4', usage: 0.1 }];
ok('ยอดตามสูตร = ต่อชิ้น × จำนวนสั่ง', reqmtOf(rq, 'C-TAPE7', 3) === 0.21, String(reqmtOf(rq, 'C-TAPE7', 3)));
ok('ปัดห้าตำแหน่ง ไม่ใช่ 0.30000000000000004 (A2)', reqmtOf(rq, 'C-TAPE4', 3) === 0.3, String(reqmtOf(rq, 'C-TAPE4', 3)));
ok('รหัสที่ไม่มีในสูตร = ไม่มียอดตามสูตร ไม่ใช่ศูนย์', reqmtOf(rq, 'C-ไม่มี', 3) === null);
ok('ยังไม่ใส่จำนวนสั่ง = ว่าง ไม่ใช่ศูนย์',
   reqmtOf(rq, 'C-TAPE4', null) === null && reqmtOf(rq, 'C-TAPE4', 0) === null && reqmtOf(rq, 'C-TAPE4', '') === null);
ok('จำนวนสั่งที่มาเป็นข้อความก็คิดได้ (ช่องกรอกคืนข้อความ)', reqmtOf(rq, 'C-TAPE4', '3') === 0.3);
ok('รหัสที่เป็นตัวเลขเทียบเท่าข้อความ', reqmtOf([{ pn: 'P', code: 5301000100, usage: 2 }], '5301000100', 2) === 4);
ok('สูตรว่างหรือยังไม่ได้โหลด ก็ไม่พัง', reqmtOf([], 'C-TAPE4', 3) === null && reqmtOf(null, 'C-TAPE4', 3) === null);

console.log('\n=== ตั้ง BOM ทั้งใบจาก hard copy (เจ้าของสั่ง 10 ต.ค. 2026) ===');
{
  const mats = [{ material_code: '9100000101', description: 'TAPE', unit: 'MTR' },
                { material_code: '9100000102', description: 'BOBBIN', unit: 'PCE' }];
  const NOW = '2026-10-10T03:00:00.000Z';
  const P = (inp, ex = []) => manualBomPlan(inp, ex, { materials: mats, now: NOW });
  const a = P({ pn: '9900000001', rev: 'C', valid_from: '2026-10-10', by: 'สมชาย',
                lines: [{ code: '9100000101', qty: 0.12 }, { code: '', qty: null }, { code: '9100000102', qty: 1 }] });
  ok('ยอดต่อชิ้น — ได้แถวครบ เติมชื่อ/หน่วยจากทะเบียน · แถวว่างข้าม', a.ok && a.rows.length === 2
     && a.rows[0].desc === 'TAPE' && a.rows[0].unit === 'MTR' && a.rows[0].usage === 0.12 && a.isNew, JSON.stringify(a.errors));
  ok('แถวที่ได้ — id/pn/rev/วันที่มีผล · ติดธงแก้มือ (source ขึ้นต้น มือ) · ยืนยันหน่วยแล้ว',
     a.rows[0].id === bomId('9900000001', '9100000101') && a.rows[0].rev === 'C' && a.rows[0].valid_from === '2026-10-10'
     && a.rows[0].source.startsWith('มือ') && a.rows[0].uomConfirmed === true && manualRowsOf(a.rows, ['9900000001']).length === 2);
  const t = P({ pn: 'PN-T', mode: 'total', order: 500, lines: [{ code: '9100000101', qty: 60 }, { code: '9100000102', qty: 500 }] });
  ok('ยอดรวมทั้งใบ ÷ จำนวนสั่ง = ต่อชิ้น', t.ok && t.rows[0].usage === 0.12 && t.rows[1].usage === 1, JSON.stringify(t.rows.map(r => r.usage)));
  ok('ยอดรวมแต่ไม่ใส่จำนวนสั่ง = บอกให้ใส่', !P({ pn: 'PN-T', mode: 'total', lines: [{ code: '9100000101', qty: 60 }] }).ok);
  const d = P({ pn: 'PN-D', lines: [{ code: '9100000101', qty: 0.1 }, { code: '9100000101', qty: 0.05 }] });
  ok('รหัสเดียวกันหลายแถว — รวมยอด นับจำนวนบรรทัด', d.ok && d.rows.length === 1 && d.rows[0].usage === 0.15 && d.rows[0].lines === 2);
  const bad = P({ pn: '', lines: [{ code: '9100000101', qty: 0 }, { code: '2800000001', qty: 1 }, { code: '', qty: 3 },
                                  { code: '9999', qty: 1 }] });
  ok('ข้อผิดบอกเป็นรายแถว — ไม่มี P/N · ยอดศูนย์ · ของทำเอง 28 · ไม่มีรหัส · ไม่มีหน่วย',
     !bad.ok && bad.errors.some(e => e.i === -1) && bad.errors.some(e => e.i === 0) && bad.errors.some(e => e.i === 1 && /28/.test(e.why))
     && bad.errors.some(e => e.i === 2) && bad.errors.some(e => e.i === 3 && /หน่วย/.test(e.why)), JSON.stringify(bad.errors));
  const w = P({ pn: 'PN-W', lines: [{ code: '9999', qty: 1, unit: 'pce' }] });
  ok('รหัสที่ไม่มีในทะเบียน — เตือน ไม่บล็อก · หน่วยเป็นตัวใหญ่', w.ok && w.warns.length === 1 && w.rows[0].unit === 'PCE');
  ok('รหัสนอกทะเบียน คีย์ซ้ำหน่วยไม่ตรงกัน = ผิด', !P({ pn: 'X', lines: [{ code: '9999', qty: 1, unit: 'PCE' }, { code: '9999', qty: 1, unit: 'KGM' }] }).ok);   // รหัสนอกทะเบียน — ในทะเบียนหน่วยมาจากทะเบียนเสมอ ชนกันไม่ได้
  const old = [
    { id: bomId('PN-R', '9100000101'), pn: 'PN-R', code: '9100000101', usage: 0.1, unit: 'MTR' },
    { id: bomId('PN-R', '9100000102'), pn: 'PN-R', code: '9100000102', usage: 1, unit: 'PCE' },
    { id: bomId('PN-R', '9100000103'), pn: 'PN-R', code: '9100000103', usage: 2, unit: 'PCE' },
    { id: bomId('PN-R', '9100000104'), pn: 'PN-R', code: '9100000104', usage: 5, unit: 'PCE', deleted: true },
    { id: bomId('PN-X', '9100000101'), pn: 'PN-X', code: '9100000101', usage: 9, unit: 'MTR' }];
  const r = P({ pn: 'PN-R', lines: [{ code: '9100000101', qty: 0.12 }, { code: '9100000102', qty: 1 }, { code: '9100000105', qty: 3, unit: 'PCE' }] }, old);
  ok('P/N ที่มีอยู่ — แทนที่ทั้ง P/N: เปลี่ยนยอด 1 · เท่าเดิม 1 · เพิ่ม 1 · ตัดออก 1',
     r.ok && !r.isNew && r.replacing === 3 && r.diff.changed.length === 1 && r.diff.changed[0].from === 0.1 && r.diff.changed[0].to === 0.12
     && r.diff.same === 1 && r.diff.added.join() === '9100000105' && r.diff.removed.join() === '9100000103', JSON.stringify(r.diff));
  ok('บรรทัดที่ตัดออก = ติดธง deleted ไม่ลบทิ้ง (B1 · ลบจริงแล้วเครื่องอื่นซิงค์กลับมา) · ที่ลบไปแล้วไม่นับซ้ำ · P/N อื่นไม่โดน',
     r.removed.length === 1 && r.removed[0].deleted === true && r.removed[0].id === bomId('PN-R', '9100000103')
     && r.removed[0].imported_at === NOW && !r.removed.some(x => x.pn === 'PN-X'));
  ok('วันที่มีผลไม่ใส่ = วันนี้ · ใส่ผิดรูป = ผิด', P({ pn: 'Q', lines: [{ code: '9100000101', qty: 1 }] }).rows[0].valid_from === '2026-10-10'
     && !P({ pn: 'Q', valid_from: '10/10/2026', lines: [{ code: '9100000101', qty: 1 }] }).ok);
  ok('ไม่มีบรรทัดเลย = ผิด', !P({ pn: 'Q', lines: [{ code: '', qty: null }] }).ok);
}

console.log('\n=== hard copy — ชื่อ/หน่วยจากทะเบียน · ข้อสังเกตผู้ตรวจ #127 ===');
{
  const mats = [{ material_code: '9100000101', description: 'TAPE', unit: 'MTR' }];
  const P = (inp, o = {}) => manualBomPlan(inp, [], { materials: mats, now: '2026-10-09T20:00:00.000Z', ...o });
  const a = P({ pn: 'Q', lines: [{ code: '9100000101', qty: 1, desc: 'พิมพ์ผิด', unit: 'KGM' }] });
  ok('รหัสที่มีในทะเบียน — ชื่อกับหน่วยมาจากทะเบียนเสมอ ไม่ใช่ที่คีย์ (พนักงานคีย์แค่รหัสกับจำนวน)',
     a.ok && a.rows[0].desc === 'TAPE' && a.rows[0].unit === 'MTR');
  const b = P({ pn: 'Q', lines: [{ code: '9999', qty: 2, unit: 'pce' }] });
  ok('รหัสที่ไม่มีในทะเบียน — ใช้หน่วยที่คีย์เอง + เตือน', b.ok && b.rows[0].unit === 'PCE' && b.warns.length === 1);
  const c = P({ pn: 'Q', lines: [{ code: '9999', qty: 2 }] });
  ok('ไม่มีในทะเบียนและไม่ได้คีย์หน่วย = ผิด และไม่โผล่ซ้ำในกล่องเตือน (ข้อ ช) · ข้อความบอกทางออก (ข้อ ซ)',
     !c.ok && c.warns.length === 0 && /ใส่หน่วย/.test(c.errors[0].why));
  ok('ไม่มีรหัสแต่มียอด — ข้อความบอกทางออก (ข้อ ซ)', /ลบแถว/.test(P({ pn: 'Q', lines: [{ code: '', qty: 3 }] }).errors[0].why));
  const t = P({ pn: 'Q', mode: 'total', order: 3, lines: [{ code: '9100000101', qty: 1 }, { code: '', qty: null }] });
  ok('ยอดต่อชิ้นรายแถวคืนมาให้จอโชว์ — ค่าเดียวกับที่บันทึก (ข้อ ง)', t.lineUsage[0] === t.rows[0].usage && t.lineUsage[1] === null);
  ok('วันที่ว่าง = วันนี้ตามเวลาไทยที่ส่งมา ไม่ใช่วันที่ UTC (ข้อ จ — 03:00 น. ไทย = 20:00Z เมื่อวาน)',
     P({ pn: 'Q', lines: [{ code: '9100000101', qty: 1 }] }, { today: '2026-10-10' }).rows[0].valid_from === '2026-10-10');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('จอ: ช่องชื่อไม่ให้พิมพ์ · ป้าย P/N ใหม่ (ข้อ ฉ) · ต่อชิ้นมาจาก plan ไม่คิดซ้ำในเทมเพลต (ข้อ ง)',
     !html.includes('v-model.trim="l.desc"') && html.includes('P/N ใหม่ — ยังไม่มีสูตรในเครื่อง')
     && html.includes('nbPlan.lineUsage[i]') && !html.includes('l.qty / nb.order'));
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('ตัวเลขสรุปหน้า BOM ไม่นับบรรทัดที่ลบแล้ว (ข้อ ค)',
     /pnSummary\(bomLive\.value\)/.test(app) && /pnsMissingPackMat\(bomLive\.value\)/.test(app) && /registryPlan\(bomLive\.value/.test(app));
}

console.log('\n=== hard copy — ข้อสังเกตผู้ตรวจ #127 รอบ 2 ===');
{
  const mats = [{ material_code: '9100000101', description: 'TAPE', unit: 'MTR' }];
  const P = (inp, ex = []) => manualBomPlan(inp, ex, { materials: mats, now: '2026-10-10T03:00:00.000Z' });
  ok('ยอดรวมแต่ยังไม่ใส่จำนวนสั่ง — ต่อชิ้นเป็น null (จอโชว์ —) ไม่ใช่ 0 (ข้อ 1)',
     P({ pn: 'Q', mode: 'total', lines: [{ code: '9100000101', qty: 5 }] }).lineUsage[0] === null);
  const h = P({ pn: 'Q', lines: [{ code: '2800000001', qty: 1 }] });
  ok('ของทำเอง 28 — ติดชนิด inhouse ให้จอแยกป้ายได้ (ข้อ 2)', h.errors.some(e => e.i === 0 && e.kind === 'inhouse'));
  const old = [{ id: 'PN|abc1', pn: 'PN', code: 'abc1', usage: 1, unit: 'PCE' }];
  const r = P({ pn: 'PN', lines: [{ code: 'ABC1', qty: 2, unit: 'PCE' }] }, old);
  ok('แถวเดิมที่ id ต่าง (ตัวพิมพ์เล็กในฐาน) ถูกติดธงลบ — ไม่เหลือสองแถว active ของรหัสเดียวกัน (ข้อ 6)',
     r.rows.length === 1 && r.removed.length === 1 && r.removed[0].id === 'PN|abc1' && r.diff.removed.length === 0
     && r.diff.changed.length === 1, JSON.stringify({ rows: r.rows.map(x => x.id), removed: r.removed.map(x => x.id), diff: r.diff }));
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('เลือกจากตัวเลือกได้เฉพาะของแถวนั้น (ข้อ 3) · ลบแถวแล้วปิดตัวเลือก (ข้อ 4) · รายการ P/N ไม่นับที่ลบหมดแล้ว (ข้อ 5)',
     app.includes('nbSug.i === i && nbSugList.value.length') && html.includes('@click="nbRemove(i)"')
     && /bomPnCodes = computed\(\(\) => \[\.\.\.new Set\(bomLive\.value/.test(app));
}

console.log('\n=== hard copy — เปลี่ยนรหัสของแถว ชื่อ/หน่วยเดิมต้องไม่ติดไปด้วย (ผู้ตรวจ #127 รอบ 3) ===');
{
  // ดึงตัวฟังก์ชันจริงจาก app.js มารัน — ผูกกับพฤติกรรม ไม่ใช่ข้อความในซอร์ส
  const src = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const bodyOf = (name) => {
    const at = src.indexOf(`function ${name}(`);
    if (at < 0) throw new Error(`หาไม่เจอใน app.js: ${name}`);
    let depth = 0;
    for (let j = src.indexOf('{', at); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
    }
    throw new Error(`ปิดวงเล็บไม่ครบ: ${name}`);
  };
  const nbTypingOf = (nb, nbSug) => new Function('nb', 'nbSug', `${bodyOf('nbTyping')}\nreturn nbTyping;`)(nb, nbSug);

  const mats = [{ material_code: '9100000101', description: 'TAPE 6MM', unit: 'MTR' }];
  const P = (lines) => manualBomPlan({ pn: 'Q', lines }, [], { materials: mats, now: '2026-10-10T03:00:00.000Z', today: '2026-10-10' });

  // เส้นทางของจริง: กด "คีย์ทั้งใบใหม่" → แถวโหลดมาพร้อมชื่อ/หน่วยจากสูตรเดิม → พนักงานพิมพ์รหัสใหม่ทับ
  const nb = { lines: [{ code: '9100000101', desc: 'TAPE 6MM', qty: 1, unit: 'MTR', note: '' }] };
  const nbSug = { i: -1, k: 4 };
  nb.lines[0].code = '7777777777';          // รหัสใหม่ที่ยังไม่มีในทะเบียน
  nbTypingOf(nb, nbSug)(0);                 // @input ของช่องรหัสแถวนั้น
  ok('พิมพ์รหัสทับ → ล้างชื่อ/หน่วยของแถวนั้น และตัวเลือกย้ายมาแถวนี้',
     nb.lines[0].desc === '' && nb.lines[0].unit === '' && nbSug.i === 0 && nbSug.k === 0, JSON.stringify(nb.lines[0]));
  const after = P(nb.lines);
  ok('รหัสนอกทะเบียนที่พิมพ์ทับ = ด่าน "ไม่มีหน่วย" ทำงาน ไม่ใช่บันทึกด้วยหน่วยของรหัสเดิมเงียบ ๆ',
     !after.ok && after.errors.some(e => e.i === 0 && /ไม่มีหน่วย/.test(e.why)), JSON.stringify({ ok: after.ok, rows: after.rows, errors: after.errors }));

  // แถวที่โหลดมาแล้วไม่แตะช่องรหัส ต้องเก็บชื่อ/หน่วยเดิมไว้ (รหัสนอกทะเบียนที่บันทึกไว้แล้วห้ามเสียหน่วย)
  const keep = P([{ code: '7777777777', desc: 'ของเดิม', qty: 2, unit: 'PCE', note: '' }]);
  ok('ไม่แตะช่องรหัส = ชื่อ/หน่วยเดิมของแถวยังอยู่ (nbTyping ไม่ถูกเรียก)',
     keep.ok && keep.rows[0].desc === 'ของเดิม' && keep.rows[0].unit === 'PCE', JSON.stringify(keep.rows));

  // พิมพ์ทับด้วยรหัสที่มีในทะเบียน — ชื่อ/หน่วยมาจากทะเบียนเสมอ การล้างจึงไม่ทำให้เสียอะไร
  const nb2 = { lines: [{ code: '7777777777', desc: 'ของเดิม', qty: 1, unit: 'PCE', note: '' }] };
  nb2.lines[0].code = '9100000101';
  nbTypingOf(nb2, { i: -1, k: 0 })(0);
  const good = P(nb2.lines);
  ok('พิมพ์ทับด้วยรหัสในทะเบียน = ได้ชื่อ/หน่วยของรหัสใหม่',
     good.ok && good.rows[0].desc === 'TAPE 6MM' && good.rows[0].unit === 'MTR', JSON.stringify(good.rows));

  let threw = false;
  try { nbTypingOf({ lines: [] }, { i: -1, k: 0 })(3); } catch { threw = true; }
  ok('แถวนั้นถูกลบไปแล้วระหว่างพิมพ์ = ไม่ระเบิด', !threw);
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
