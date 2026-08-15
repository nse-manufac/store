/**
 * BOM — สูตรว่าสินค้าหนึ่งตัวใช้วัตถุดิบอะไรอย่างละเท่าไหร่
 *
 * ── การนำเข้าแทนที่ทั้ง P/N เสมอ ไม่ใช่ผสมกัน ────────────────────
 * Delta ทยอยแก้ BOM ทีละ REV และกำลังใส่ pack mat เพิ่มเข้ามาเรื่อย ๆ
 * (วัดจากไฟล์จริง 145 P/N — ปี 2022 มี pack mat 20% ปี 2026 มี 86%)
 * ถ้านำเข้าแบบผสม บรรทัดของ REV เก่าจะค้างอยู่ปนกับของใหม่ แล้วยอดจะเบิ้ล
 * โดยไม่มีอะไรเตือน เพราะทั้งสองบรรทัดดู "ถูก" ทั้งคู่เมื่อดูทีละบรรทัด
 */
import { categorize } from './materials.js';

export const bomId = (pn, code) => `${pn}|${code}`;

/** แปลงผลจากตัวอ่านเอกสารเป็นแถวที่เก็บลงฐานข้อมูลได้ */
export function makeBomRows(doc) {
  if (!doc.ok) return [];
  const now = new Date().toISOString();
  return doc.lines.map(l => ({
    id: bomId(doc.pn, l.code),
    pn: doc.pn,
    code: l.code,
    desc: l.desc,
    usage: l.usage,
    unit: l.unit,
    lines: l.n,                       // มาจากกี่บรรทัดในเอกสาร (คนละขั้นตอนการผลิต)
    altPct: l.altPct,
    uomConfirmed: l.uomConfirmed,
    uomWhy: l.uomWhy || '',
    rawQpa: l.rawQpa,
    rawUom: l.rawUom,
    rev: doc.rev,
    valid_from: doc.valid,
    source: 'SAP ' + (doc.fileName || ''),
    imported_at: now
  }));
}

/** Map<pn, Map<code, row>> — รูปที่หน้าคีย์กับตัวคำนวณของเกินสูตรใช้ */
export function byPn(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.pn)) m.set(r.pn, new Map());
    m.get(r.pn).set(r.code, r);
  }
  return m;
}

/** สรุปราย P/N ที่เก็บไว้ในเครื่อง */
export function pnSummary(rows) {
  const m = new Map();
  for (const r of rows) {
    const s = m.get(r.pn) || { pn: r.pn, rev: r.rev, valid_from: r.valid_from,
                               lines: 0, pack: 0, unconfirmed: 0, imported_at: r.imported_at };
    s.lines++;
    if (categorize(r.desc) === 'PACKING') s.pack++;
    if (r.uomConfirmed === false) s.unconfirmed++;
    if (r.imported_at > s.imported_at) s.imported_at = r.imported_at;
    m.set(r.pn, s);
  }
  return [...m.values()].sort((a, b) => a.pn.localeCompare(b.pn));
}

/**
 * P/N ที่ยังไม่มีวัสดุแพ็กกิ้งในสูตรเลย = ควรขอ BOM ฉบับใหม่จาก Delta
 *
 * จากไฟล์จริงชุดเดือน ก.ค. 2026 มี 63 P/N จาก 145 ที่ยังไม่มี ส่วนใหญ่เป็น REV ปี 2022
 * ตราบใดที่ยังใช้ของเก่า ความต้องการ pack mat ของ P/N พวกนี้จะมองไม่เห็นทั้งก้อน
 */
export const pnsMissingPackMat = rows =>
  pnSummary(rows).filter(s => s.pack === 0);

/** รหัสใน BOM ที่ยังไม่มีในทะเบียน — ต้องเพิ่มก่อนถึงจะคีย์รับเข้าได้สะดวก */
export function unknownCodes(rows, materials) {
  const have = new Set(materials.map(m => String(m.material_code)));
  const out = new Map();
  for (const r of rows) {
    if (have.has(String(r.code))) continue;
    const e = out.get(r.code) || { code: r.code, desc: r.desc, unit: r.unit, pns: [] };
    if (e.pns.length < 6) e.pns.push(r.pn);
    out.set(r.code, e);
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * แผนการนำเข้า — บอกให้เห็นก่อนกดว่าจะเกิดอะไรขึ้น
 * ตั้งใจให้ตัวเลข "ที่จะหายไป" เด่นพอ ๆ กับ "ที่จะเข้ามา"
 * ของที่หายเงียบ ๆ คือสิ่งที่ทำให้ยอดผิดโดยไม่มีใครรู้
 */
export function importPlan(docs, existingRows) {
  const cur = new Map();
  for (const r of existingRows) cur.set(r.pn, (cur.get(r.pn) || 0) + 1);

  const okDocs = docs.filter(d => d.ok);
  const perPn = okDocs.map(d => ({
    pn: d.pn, rev: d.rev, valid_from: d.valid,
    incoming: d.lines.length,
    replacing: cur.get(d.pn) || 0,
    isNew: !cur.has(d.pn),
    blocked: d.dropped.badUom.length,
    inhouse: d.dropped.inhouse.length,
    unconfirmed: d.unconfirmed.length
  }));
  // ไฟล์เดียวกันลากเข้าซ้ำสองครั้ง ต้องเห็นก่อนว่าเป็นตัวเดิม
  const dupInBatch = okDocs.map(d => d.pn)
    .filter((pn, i, a) => a.indexOf(pn) !== i);
  return { perPn, dupInBatch: [...new Set(dupInBatch)], failed: docs.filter(d => !d.ok) };
}
