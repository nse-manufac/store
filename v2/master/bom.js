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
import { isInHouse } from './sap-bom.js';

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
 * สร้างหรือแก้บรรทัด BOM ด้วยมือ
 *
 * ── ทำไมต้องแก้มือได้ ────────────────────────────────────────────
 * ไฟล์ SAP ไม่ได้มาทุกครั้งที่สูตรเปลี่ยน บางทีแก้กันปากเปล่าหน้างานก่อน
 * แล้วเอกสารตามมาทีหลังเป็นสัปดาห์ ถ้าแก้เองไม่ได้ พนักงานจะคีย์รับเข้าโดยไม่มียอดตามสูตร
 * ให้ดูเทียบทั้งช่วงนั้น ซึ่งแปลว่าของเกินสูตรจะมองไม่เห็นไปด้วย
 *
 * ⚠️ ติดธง source ว่า 'มือ' ไว้เสมอ
 * เพราะการนำเข้าไฟล์ SAP รอบหน้าจะ "แทนที่ทั้ง P/N" ซึ่งจะลบบรรทัดที่แก้มือทิ้งไปด้วย
 * ถ้าไม่รู้ว่าบรรทัดไหนแก้มือ จะเตือนก่อนทับไม่ได้เลย
 */
export function makeManualRow(input, existing = []) {
  const pn = String(input.pn || '').trim();
  const code = normCode(input.code);
  if (!pn) throw new Error('ต้องระบุ P/N');
  if (!code) throw new Error('ต้องระบุรหัสวัตถุดิบ');
  const usage = Number(input.usage);
  if (!isFinite(usage) || usage <= 0) throw new Error('ยอดต่อชิ้นต้องเป็นตัวเลขมากกว่าศูนย์');
  const now = new Date().toISOString();
  const prev = existing.find(r => r.id === bomId(pn, code));
  return {
    ...(prev || {}),
    id: bomId(pn, code),
    pn, code,
    desc: String(input.desc || '').trim(),
    usage,
    unit: String(input.unit || '').trim().toUpperCase(),
    lines: prev ? prev.lines : 1,
    altPct: prev ? prev.altPct : null,
    // แก้มือแปลว่าคนยืนยันหน่วยเองแล้ว ไม่ใช่ค่าที่ระบบเดามาจากตาราง UOM
    uomConfirmed: true,
    uomWhy: '',
    rawQpa: usage, rawUom: String(input.unit || '').trim().toUpperCase(),
    rev: String(input.rev || (prev ? prev.rev : '') || 'มือ'),
    valid_from: String(input.valid_from || (prev ? prev.valid_from : '') || now.slice(0, 10)),
    source: 'มือ · ' + String(input.by || 'หน้างาน'),
    imported_at: now,
    deleted: false,
    note: String(input.note || '').trim()
  };
}

/**
 * บรรทัดสูตรของ P/N หนึ่งที่ยังใช้อยู่ — ตัวที่หน้ารับเข้ากับหน้าจ่ายออกใช้กางรายการ (#78)
 *
 * ⚠️ ตัดบรรทัดที่ลบแล้ว (deleted) เสมอ — การลบบรรทัดสูตรคือติดธง แถวยังอยู่ใน bom
 *    เดิมหน้ารับเข้าไม่ตัด หน้าจ่ายออกตัด สองหน้าจึงกางไม่เท่ากัน · ทั้งสองหน้าต้องเรียกตัวนี้ ห้ามกรองเอง
 * เทียบ P/N เป็นข้อความ เพราะ P/N ที่มาจากไฟล์อาจเป็นตัวเลข
 * ⚠️ ห้ามตั้งชื่อ bomRowsOfPn — app.js มี computed ชื่อนั้นของหน้าแก้สูตรอยู่แล้ว มันบังตัว import
 *    แล้วหน้ารับเข้า/จ่ายออกพังด้วย "is not a function" (เจอตอนเปิดเบราว์เซอร์ตรวจ #79 · เทสอ่านซอร์สจับไม่ได้)
 */
export const activeBomRowsOf = (rows, pn) =>
  (rows || []).filter(r => String(r.pn) === String(pn) && !r.deleted);

/**
 * ยอดตามสูตรของรหัสหนึ่ง = ต่อชิ้น × จำนวนสั่ง — null ถ้าไม่มีในสูตร หรือยังไม่ได้ใส่จำนวนสั่ง
 *
 * ⚠️ Kit List ไม่ใช่ตัวกำหนดยอดตามสูตร (เจ้าของ 16 ก.ย. 2026)
 *    ถ้ารหัสมีในสูตรของ P/N นั้น ยอดตามสูตรต้องขึ้นทุกแถวทั้งหน้ารับเข้าและหน้าจ่ายออก
 *    ไม่ว่าแถวจะมาจาก Kit List · จากสูตร · จากที่เคยรับเข้ากับ PO นี้ หรือพนักงานคีย์รหัสเอง
 *    เดิมเติมให้เฉพาะแถวที่มาจาก Kit List กับจากสูตร แถวอื่นช่องตามสูตรว่างทั้งที่มีในสูตร
 * rows = บรรทัดสูตรที่ยังใช้อยู่ของ P/N นั้น (ผ่าน activeBomRowsOf มาแล้ว)
 * ปัดห้าตำแหน่งเหมือนยอดอื่นในระบบ — INVARIANTS A2
 */
export function reqmtOf(rows, code, order) {
  const n = Number(order) || 0;
  if (!n) return null;
  const hit = (rows || []).find(r => String(r.code) === String(code));
  return hit ? Math.round((Number(hit.usage) || 0) * n * 1e5) / 1e5 : null;
}

const r10 = n => Math.round(n * 1e10) / 1e10;

/**
 * ตั้ง BOM ทั้งใบด้วยมือ — Delta ให้มาเป็น hard copy ไม่มีไฟล์ (เจ้าของสั่ง 10 ต.ค. 2026)
 *
 * mode 'unit'  = คีย์ยอดต่อชิ้นตามใบ
 * mode 'total' = คีย์ยอดรวมทั้งใบ (เช่นใบเบิก) แล้วหารด้วย order (จำนวนสั่ง) เป็นยอดต่อชิ้น
 * ⚠️ แทนที่ทั้ง P/N เหมือนการนำเข้าไฟล์ (เจ้าของเลือก) — บรรทัดเดิมที่ไม่มีในใบใหม่ติดธง deleted
 *    ไม่ลบทิ้ง เพราะลบจริงแล้วเครื่องอื่นจะซิงค์มันกลับมา (กฎเดียวกับ deleteBomRow)
 * รหัสเดียวกันหลายบรรทัด = คนละขั้นตอนการผลิต รวมยอด (กฎเดียวกับใบเบิก/Kit List)
 * คืน { ok, rows, removed, errors: [{ i, why }], warns: [{ i, code, why }], isNew, diff }
 *   i = ลำดับแถวที่คีย์ (เริ่ม 0) · -1 = หัวใบ · แถวว่างทั้งแถวข้ามไปเฉย ๆ
 */
export function manualBomPlan(input = {}, existing = [], { materials = [], now = new Date().toISOString(), today = '' } = {}) {
  const pn = String(input.pn || '').trim();
  const mode = input.mode === 'total' ? 'total' : 'unit';
  const order = Number(input.order);
  const errors = [], warns = [];
  if (!pn) errors.push({ i: -1, why: 'ต้องระบุ P/N' });
  if (mode === 'total' && !(order > 0)) errors.push({ i: -1, why: 'คีย์เป็นยอดรวม ต้องใส่จำนวนสั่ง (ชิ้น) ด้วย' });
  const vf = String(input.valid_from || '').trim();
  if (vf && !/^\d{4}-\d{2}-\d{2}$/.test(vf)) errors.push({ i: -1, why: 'วันที่มีผลไม่ถูกต้อง — เลือกวันที่ใหม่' });
  const matOf = new Map((materials || []).map(m => [normCode(m.material_code), m]));
  const merged = new Map();
  // ยอดต่อชิ้นของแต่ละแถวที่คีย์ — ให้จอโชว์ค่าเดียวกับที่จะบันทึก ไม่คิดซ้ำในเทมเพลต (ผู้ตรวจ #127 ข้อ ง)
  const lineUsage = [];
  (input.lines || []).forEach((l, i) => {
    lineUsage[i] = null;
    const code = normCode(l && l.code);
    const raw = l ? l.qty : null;
    if (!code && (raw === '' || raw == null)) return;
    if (!code) { errors.push({ i, why: 'ไม่มีรหัส — ใส่รหัส หรือกด ✕ ลบแถวนี้' }); return; }
    if (isInHouse(code)) { errors.push({ i, kind: 'inhouse', why: `${code} ขึ้นต้น 28 = ของทำเอง ไม่ใช่วัตถุดิบที่เบิกจากคลัง — ลบแถวนี้` }); return; }
    const q = Number(raw);
    if (raw === '' || raw == null || !isFinite(q) || q <= 0) { errors.push({ i, why: `${code} ยอดต้องเป็นตัวเลขมากกว่าศูนย์` }); return; }
    const m = matOf.get(code);
    // ชื่อกับหน่วยมาจากทะเบียนเสมอ (เจ้าของสั่ง 10 ต.ค. 2026 — พนักงานคีย์แค่รหัสกับจำนวน)
    // คีย์หน่วยเองได้เฉพาะรหัสที่ไม่มีในทะเบียน หรือทะเบียนยังไม่มีหน่วย
    const unit = String(((m && m.unit) || l.unit || '')).trim().toUpperCase();
    if (!unit) { errors.push({ i, why: `${code} ไม่มีหน่วย — ใส่หน่วยในช่องหน่วยของแถวนี้` }); return; }
    // เตือนเฉพาะแถวที่ผ่านแล้ว แถวที่ตกไปแล้วอยู่ในกล่องแดงที่เดียว (ผู้ตรวจ #127 ข้อ ช)
    if (!m) warns.push({ i, code, why: 'ไม่มีในทะเบียน' });
    const usage = mode === 'total' ? (order > 0 ? r10(q / order) : 0) : r10(q);
    // ยอดรวมแต่ยังไม่ใส่จำนวนสั่ง = ยังคิดต่อชิ้นไม่ได้ → null (จอโชว์ —) ไม่ใช่ 0 (ผู้ตรวจ #127 รอบ 2 ข้อ 1)
    lineUsage[i] = mode === 'total' && !(order > 0) ? null : usage;
    const hit = merged.get(code);
    if (hit) {
      if (hit.unit !== unit) { errors.push({ i, why: `${code} คีย์ซ้ำแต่หน่วยไม่ตรงกัน (${hit.unit} กับ ${unit})` }); return; }
      hit.usage = r10(hit.usage + usage); hit.lines++;
      if (l.note) hit.note = [hit.note, String(l.note).trim()].filter(Boolean).join(' · ');
    } else {
      merged.set(code, { code, unit, usage, lines: 1,
                         desc: String((m && m.description) || l.desc || '').trim(), note: String(l.note || '').trim() });
    }
  });
  if (!merged.size && !errors.length) errors.push({ i: -1, why: 'ยังไม่มีบรรทัดสูตร' });

  const cur = (existing || []).filter(r => String(r.pn) === pn && !r.deleted);
  const curOf = new Map(cur.map(r => [normCode(r.code), r]));
  const by = String(input.by || '').trim() || 'หน้างาน';
  const rows = [...merged.values()].map(l => ({
    id: bomId(pn, l.code), pn, code: l.code, desc: l.desc, usage: l.usage, unit: l.unit,
    lines: l.lines, altPct: null,
    // คนคีย์จากเอกสารเอง = ยืนยันหน่วยแล้ว ไม่ใช่ค่าที่ระบบเดามา
    uomConfirmed: true, uomWhy: '', rawQpa: l.usage, rawUom: l.unit,
    // วันที่ว่าง = วันนี้ตามเวลาไทย (ผู้เรียกส่ง today มา) · now.slice เป็นวันที่ UTC ตี 0–7 จะได้เมื่อวาน (ผู้ตรวจ #127 ข้อ จ)
    rev: String(input.rev || '').trim(), valid_from: vf || today || now.slice(0, 10),
    // ขึ้นต้น 'มือ' — manualRowsOf จะเตือนก่อนนำเข้าไฟล์ทับ
    source: 'มือ · hard copy · ' + by, imported_at: now, deleted: false,
    note: [String(input.note || '').trim(), l.note].filter(Boolean).join(' · ')
  }));
  // ⚠️ ตัดออกเทียบด้วย id ไม่ใช่รหัสที่ normalize — แถวเดิมที่ id ต่างจากแถวใหม่ (เช่นรหัสตัวพิมพ์เล็กในฐาน)
  //    ต้องถูกติดธงลบ ไม่งั้นเหลือสองแถว active ของรหัสเดียวกัน = ยอดเบิ้ล (ผู้ตรวจ #127 รอบ 2 ข้อ 6)
  const newIds = new Set(rows.map(r => r.id));
  const removed = cur.filter(r => !newIds.has(r.id))
    .map(r => ({ ...r, deleted: true, imported_at: now }));
  const diff = { added: [], changed: [], same: 0,
                 removed: removed.filter(r => !merged.has(normCode(r.code))).map(r => r.code) };
  for (const r of rows) {
    const old = curOf.get(r.code);
    if (!old) diff.added.push(r.code);
    else if (Math.abs((Number(old.usage) || 0) - r.usage) > 1e-9 || String(old.unit || '').toUpperCase() !== r.unit) {
      diff.changed.push({ code: r.code, from: Number(old.usage) || 0, to: r.usage, fromUnit: old.unit || '', unit: r.unit });
    } else diff.same++;
  }
  return { ok: !errors.length, rows, removed, errors, warns, isNew: !cur.length, replacing: cur.length, diff, lineUsage };
}

/** บรรทัดที่แก้มือไว้ของ P/N พวกนี้ — ใช้เตือนก่อนนำเข้าไฟล์ทับ */
export const manualRowsOf = (rows, pns) => {
  const set = new Set(pns.map(String));
  return rows.filter(r => set.has(String(r.pn)) && String(r.source || '').startsWith('มือ'));
};

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
