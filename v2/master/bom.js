/**
 * BOM — สูตรว่าสินค้าหนึ่งตัวใช้วัตถุดิบอะไรอย่างละเท่าไหร่
 *
 * ── การนำเข้าแทนที่ทั้ง P/N เสมอ ไม่ใช่ผสมกัน ────────────────────
 * Delta ทยอยแก้ BOM ทีละ REV และกำลังใส่ pack mat เพิ่มเข้ามาเรื่อย ๆ
 * (วัดจากไฟล์จริง 145 P/N — ปี 2022 มี pack mat 20% ปี 2026 มี 86%)
 * ถ้านำเข้าแบบผสม บรรทัดของ REV เก่าจะค้างอยู่ปนกับของใหม่ แล้วยอดจะเบิ้ล
 * โดยไม่มีอะไรเตือน เพราะทั้งสองบรรทัดดู "ถูก" ทั้งคู่เมื่อดูทีละบรรทัด
 */
import { categorize, normCode } from './materials.js';

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

const normDesc = s => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * ตั้งทะเบียนวัตถุดิบจาก BOM ที่นำเข้ามาแล้ว
 *
 * ── ทำไมถึงคุ้ม ──────────────────────────────────────────────────
 * BOM ที่ Delta ให้มามีครบสามอย่างที่ทะเบียนต้องใช้ คือ รหัส ชื่อ และหน่วย
 * (วัดจากไฟล์จริง: 293 รหัสที่ขาดทะเบียน มีชื่อและหน่วยครบทั้ง 293)
 * และได้เฉพาะของที่ใช้ผลิตจริง ไม่ใช่ลากทั้ง 12,259 รหัสที่ส่วนใหญ่ตายไปแล้วมาทั้งก้อน
 *
 * ── สิ่งที่ BOM บอกไม่ได้ และห้ามเดาแทนคน ────────────────────────
 * หมวด    เดาจากชื่อให้ก่อน แต่ต้องให้แก้ได้ก่อนกดสร้าง
 * วันหมดอายุ  ไม่มีใน SAP เลย จึงติดธงรอตรวจไว้ทุกตัว
 *          (ยกเว้นหมวด CHEMICAL ที่ makeMaterial บังคับให้ต้องกรอกอยู่แล้ว)
 *
 * ⚠️ ของที่ทำเองในบ้าน (รหัสขึ้นต้น 28) ต้องไม่หลุดมาถึงตรงนี้
 * ตัวอ่าน SAP ตัดทิ้งตั้งแต่ต้นทางแล้ว แต่ถ้าวันหนึ่งมันหลุดมา
 * เราจะได้ "วัตถุดิบ" ชื่อ BOBBIN+WIRE ASSY ซึ่งคือของที่เราพันเอง ไม่ใช่ของที่ซื้อ
 * — เป็นของตระกูลเดียวกับที่ทำให้เกิด issue #26 จึงกันซ้ำอีกชั้นตรงนี้
 */
export function registryPlan(rows, materials) {
  const have = new Set(materials.map(m => normCode(m.material_code)));

  // ชื่อที่ทะเบียนมีอยู่แล้ว ใช้เตือนว่ากำลังจะสร้างของชื่อซ้ำกับรหัสเดิม
  const descOwners = new Map();
  for (const m of materials) {
    const d = normDesc(m.description);
    if (!d) continue;
    if (!descOwners.has(d)) descOwners.set(d, []);
    descOwners.get(d).push(normCode(m.material_code));
  }

  const byCode = new Map();
  const inHouse = [];
  for (const r of rows) {
    const code = normCode(r.code);
    if (!code || have.has(code)) continue;
    if (/^28/.test(code)) { if (!inHouse.includes(code)) inHouse.push(code); continue; }
    const e = byCode.get(code) || { code, pns: [], nPn: 0, descs: new Map(), units: new Map() };
    e.nPn++;
    if (e.pns.length < 6) e.pns.push(r.pn);
    const d = String(r.desc || '').trim();
    const u = String(r.unit || '').trim().toUpperCase();
    if (d) e.descs.set(d, (e.descs.get(d) || 0) + 1);
    if (u) e.units.set(u, (e.units.get(u) || 0) + 1);
    byCode.set(code, e);
  }

  // ชื่อกับหน่วยอาจไม่ตรงกันข้าม P/N เพราะ SAP ตัดชื่อคนละที่ — เอาตัวที่พบบ่อยสุด แล้วบอกว่ามีตัวอื่นด้วย
  // เท่ากันให้เอาชื่อที่ยาวกว่า เพราะ SAP ตัดท้ายทิ้ง ตัวยาวกว่าจึงบอกอะไรได้มากกว่าเสมอ
  const pickDesc = m =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length
                                 || a[0].localeCompare(b[0]))[0];
  const pickUnit = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const list = [...byCode.values()].map(e => {
    const d = pickDesc(e.descs), u = pickUnit(e.units);
    const desc = d ? d[0] : '';
    return {
      code: e.code,
      desc,
      unit: u ? u[0] : '',
      category: categorize(desc),
      pns: e.pns,
      nPn: e.nPn,
      descVaries: e.descs.size > 1,
      otherDescs: [...e.descs.keys()].filter(x => x !== desc),
      // หน่วยไม่ตรงกันคือเรื่องใหญ่กว่าชื่อไม่ตรง เพราะตัวเลขในสูตรจะคนละมาตราส่วน
      unitVaries: e.units.size > 1,
      units: [...e.units.keys()],
      noUnit: e.units.size === 0,
      dupDesc: descOwners.get(normDesc(desc)) || []
    };
  }).sort((a, b) => a.code.localeCompare(b.code));

  return {
    rows: list,
    total: list.length,
    unitVaries: list.filter(r => r.unitVaries).length,
    noUnit: list.filter(r => r.noUnit).length,
    dupDesc: list.filter(r => r.dupDesc.length).length,
    inHouseSkipped: inHouse
  };
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
