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

/**
 * แปลงผลอ่าน Kit List กลุ่มจ่ายรวม เป็นบรรทัดของหน้านี้ — คนคีย์ไม่ต้องพิมพ์ตามเอกสารทีละแถว
 *
 * ⚠️ แถวที่เอกสารเขียน Return ในคอลัมน์ Material Document No. ห้ามรวมกับรายการรับเข้า
 * มันคือยอดที่เกินค้างอยู่ที่เราอยู่แล้ว รอบนี้ Delta ตัดจากยอด over แทนการส่งของมาใหม่
 * ถ้าปนไปด้วย ยอดจะเข้าคลังสองรอบสำหรับของก้อนเดียว โดยไม่มีอะไรฟ้อง
 * (ไฟล์จริงรอบ ก.ย. 2026 เป็นแถวแบบนี้ 155 จาก 309 บรรทัด — ไม่ใช่เคสหายาก)
 *
 * เลขล็อตตั้งเป็นวันที่รับเข้า (เจ้าของเคาะ 22 ก.ย. 2026) เพราะเอกสารไม่มีเลขล็อตมาให้เลย
 * ของกลุ่มนี้มาเป็นรอบ วันที่รับจึงเป็นตัวแยกรอบที่ตรงที่สุดเท่าที่มี
 */
export function chemPlan(parsed, { date = '' } = {}) {
  const line = r => ({
    code: String(r.code), po: r.po, pn: r.pn || '', orderQty: r.orderQty,
    // Packing ไม่มียอด 541 — เจ้าของเคาะ 24 ก.ย. 2026 ให้เติมรับจริงจาก Req Qty ตามไฟล์เป๊ะ (มีทศนิยม) แก้ได้ถ้านับไม่ตรง
    req: r.req, s41: r.issue, qty: r.packing ? r.req : r.issue, lot: date,
    desc: r.desc || '', remark: r.remark || ''
  });
  const rows = parsed.rows || [];

  // ยอดรวมรายรหัสที่เอกสารพิมพ์มาในแถว Total — เดิมคนคีย์ต้องพิมพ์เองทีละรหัส
  // รหัสเดียวโผล่ได้ทั้งสองชีต (H และ U) จึงต้องบวกกันก่อน ไม่ใช่ทับกัน
  // ⚠️ บล็อกที่มีแถวตัดจากยอด over ปนอยู่ ห้ามเติมยอดรวมให้ (ผู้ตรวจ #97)
  // ยอด Total ของบล็อกนั้นรวมแถว Return ไว้ด้วย แต่รายการรับเข้าตัดแถวพวกนั้นออกไปแล้ว
  // เติมไปจะขึ้นเตือน "ยอดไม่ตรง" ทั้งที่ไม่มีใครทำอะไรผิด แล้วพนักงานหาสาเหตุไม่เจอ
  // ปล่อยว่างแทน = "ยังไม่กรอก" ซึ่งเป็นความจริง · เอกสารรอบที่เจอจริงไม่พิมพ์ Total
  // ให้รหัสที่เป็น Return อยู่แล้ว ข้อนี้กันไว้เผื่อไฟล์รอบหน้าเปลี่ยนรูปแบบ
  const mixed = new Set((parsed.blocks || []).filter(b => b.overLines).map(b => b.code));
  const totals = {};
  for (const b of parsed.blocks || []) {
    if (b.docTotal === null || !b.code || b.code === '(ปนกัน)' || mixed.has(b.code)) continue;
    totals[b.code] = round5((totals[b.code] || 0) + b.docTotal);
  }

  return {
    receive: rows.filter(r => !r.fromOver).map(line),
    fromOver: rows.filter(r => r.fromOver).map(line),
    totals, location: parsed.location || '', date
  };
}

/**
 * บรรทัดที่ PO + รหัสนี้เคยคีย์รับเข้าไปแล้ว — กันนำไฟล์เดิมเข้าซ้ำรอบ
 *
 * ใบเดียวมีได้สามร้อยบรรทัด กดยืนยันซ้ำอีกครั้งเดียวคือยอดเข้าคลังสองเท่าทั้งใบ
 * และไม่มีใครเห็นจนกว่าจะนับของ · เตือนอย่างเดียว ไม่ห้าม (A4)
 * เพราะ PO ใบเดิมรับของรอบสองได้จริง ของกลุ่มนี้ Delta ทยอยจ่ายเป็นรอบ
 */
export function seenBefore(lines, entries = []) {
  const key = (e, p, c) => String(e || '') + '|' + String(p || '') + '|' + String(c || '');
  const seen = new Set();
  for (const e of entries) {
    if (e.voided || e.kind !== 'receive') continue;
    seen.add(key(e.entity, e.doc_ref, e.material_code));
  }
  return lines.filter(l => seen.has(key(l.entity, l.po, l.code)));
}
