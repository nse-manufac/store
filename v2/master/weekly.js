/**
 * รับเข้ารวมรายสัปดาห์ — Tube · Chemical · Copper foil · Solder
 *
 * ── ทำไมของกลุ่มนี้ต้องมีหน้าจอของตัวเอง ─────────────────────────
 * Delta จ่ายของกลุ่มนี้รวมเป็นรอบ ไม่ได้ผูกกับ PO ทีละใบเหมือนของอื่น
 * เอกสารที่ได้มาเป็น PDF สแกน (Work Order Material Kit List) จึงคีย์มือทั้งหมด
 * ถ้าเอาไปคีย์ในหน้ารับเข้าปกติ จะต้องเปิดใบเดิมซ้ำทีละ PO ซึ่งช้าและพลาดง่าย
 *
 * แต่ในเอกสารแยกยอดตาม PO ไว้แล้ว และมีแถว "รหัส Total" ปิดท้ายแต่ละรหัส
 * จึงคีย์แบบกระจายตาม PO แล้วให้ระบบรวมยอดเทียบกับแถว Total ให้อัตโนมัติ
 * — คนคีย์ไม่ต้องบวกเลขเอง และถ้าบวกไม่ตรงจะรู้ทันทีตั้งแต่ก่อนบันทึก
 *
 * ⚠️ กฎทั้งหมดในไฟล์นี้ยกมาจาก v1 ทั้งดุ้น ห้ามแก้โดยไม่คุยกับหน้างานก่อน
 * ทุกข้อมาจากการเจอของจริงแล้วเจ็บมาก่อน
 */
import { round5 } from '../core/ledger.js';
// นิติบุคคลมีที่นิยามที่เดียวคือ entities.js — ที่นี่ส่งต่อให้ของเดิมที่เรียกใช้อยู่
import { entityOfPo } from './entities.js';
export { entityOfPo };

/** ยอดที่สูตรบอกว่าควรได้ = usage ต่อชิ้น × ยอดสั่งของ PO นั้น */
export function bomExpect(bomRows, pn, code, orderQty) {
  if (!pn || !code || !orderQty) return null;
  const b = bomRows.find(r => String(r.pn) === String(pn) && String(r.code) === String(code));
  return b ? round5(b.usage * orderQty) : null;
}

/**
 * ต่างจากสูตรกี่เปอร์เซ็นต์
 * ใช้ยอดที่ Delta จ่ายมาจริง (541) เป็นตัวตั้ง ถ้าไม่มีค่อยใช้ยอดตามสูตรในเอกสาร (req)
 */
export function pctDiff(line, expect) {
  const base = line.s41 === null || line.s41 === '' ? line.req : line.s41;
  if (expect === null || !expect || base === null || base === '' || base === undefined) return null;
  return Math.round((Number(base) - expect) / expect * 1000) / 10;
}

/**
 * สรุปยอดรายรหัส เทียบกับแถว Total ที่คีย์มาจากเอกสาร
 * match=null แปลว่ายังไม่ได้กรอกยอดรวม ไม่ใช่ว่าไม่ตรง — สองอย่างนี้ต้องแยกกันให้ชัด
 */
export function summarize(lines, totals = {}) {
  const g = new Map();
  for (const l of lines) {
    if (!l.code) continue;
    const hit = g.get(l.code) || { code: l.code, n: 0, s41: 0, qty: 0 };
    hit.n++;
    hit.s41 += Number(l.s41) || 0;
    hit.qty += Number(l.qty) || 0;
    g.set(l.code, hit);
  }
  return [...g.values()].map(x => {
    const doc = totals[x.code];
    const s41 = round5(x.s41);
    const blank = doc === undefined || doc === '' || doc === null;
    return { ...x, s41, qty: round5(x.qty),
             doc: blank ? null : Number(doc),
             match: blank ? null : Math.abs(Number(doc) - s41) < 1e-5 };
  });
}

/** บรรทัดที่กรอกครบพอจะบันทึกได้ */
export const readyLines = lines =>
  lines.filter(l => l.code && l.po && Number(l.qty) > 0);

/**
 * ตรวจทั้งใบก่อนบันทึก
 *
 * ทุกข้อในนี้เป็น "เตือน" ไม่ใช่ "ห้าม" — INVARIANTS A4
 * ของจริงมีทั้งเอกสารที่ยอดรวมพิมพ์ผิด และรหัสที่ยังไม่ทันเข้าทะเบียน
 * ถ้าห้ามบันทึก พนักงานจะไปจดใส่กระดาษแล้วลืมคีย์ ซึ่งแย่กว่ายอดที่ต้องมาตามแก้
 */
export function checkWeekly(lines, { totals = {}, materials = [], entity = '' } = {}) {
  const ready = readyLines(lines);
  const sum = summarize(lines, totals);
  const known = new Set(materials.map(m => String(m.material_code)));
  const perLine = ready.map(l => l.entity || entityOfPo(l.po));
  return {
    ready,
    summary: sum,
    mismatch: sum.filter(x => x.match === false),
    noTotal: sum.filter(x => x.match === null).length,
    unknown: [...new Set(ready.filter(l => !known.has(String(l.code))).map(l => l.code))],
    noLot: ready.filter(l => !l.lot).length,
    // นิติบุคคลที่เดาได้จากเลข PO แต่ไม่ตรงกับที่โปรแกรมตั้งไว้ตอนนี้
    otherEntities: [...new Set(perLine.filter(e => e && entity && e !== entity))],
    entities: [...new Set(perLine.filter(Boolean))].sort()
  };
}
