/**
 * ล็อต — ของกองนี้มาจากการส่งครั้งไหน
 *
 * ── สิ่งที่ระบบนี้ตอบได้ และตอบไม่ได้ ────────────────────────────
 * เก็บเลขล็อตตอน "รับเข้า" เท่านั้น ตอนจ่ายออกระบบเดาให้ว่าใช้ของเก่าก่อน
 * เพราะของในคลังไม่ได้แยกกองตามล็อต พนักงานตอนหยิบจึงไม่มีทางรู้ว่ากำลังหยิบล็อตไหน
 *
 * ผลคือคำตอบที่ให้ลูกค้าได้คือ
 *   "ล็อตนี้รับเข้าวันที่ X และตามลำดับการใช้แล้ว น่าจะไปอยู่ใน PO เหล่านี้"
 * ไม่ใช่
 *   "ไปอยู่ใน PO เหล่านี้แน่นอน"
 *
 * ทุกที่ที่แสดงล็อตที่ระบบเดาให้ ต้องมีป้ายกำกับว่าเป็นค่าที่อนุมาน ห้ามปล่อยให้ดูเหมือนของที่บันทึกไว้
 * — นี่คือกฎเดียวกับหน่วย TP ที่ยังไม่ยืนยัน: มีหลักฐานพอให้ใช้ แต่ต้องไม่พูดเกินกว่าที่รู้
 */
import { signedQty, counts, round5, isFracAdj } from './ledger.js';

/**
 * เลขล็อตตอนรับเข้า — ไม่ใส่ = วันที่รับเข้า (เจ้าของเคาะ 24 ก.ย. 2026 ให้รับเข้าปกติเหมือนรับเข้ารวม)
 * เอกสารของ Delta ไม่มีเลขล็อตมาให้เลย เดิมหน้ารับเข้าปกติปล่อยว่างแล้วบันทึกเป็น "(ไม่ระบุ)"
 * ซึ่งตามรอยย้อนกลับไม่ได้ · วันที่รับเข้าอย่างน้อยแยกกองตามรอบที่ของมาได้
 * ⚠️ ตัดสินตอนบันทึก ไม่ใช่ตอนกางไฟล์ — เปลี่ยนวันที่บนหัวจอทีหลัง ล็อตต้องตามวันที่ใหม่
 */
export const receiveLot = (lot, date) =>
  String(lot == null ? '' : lot).trim() || String(date == null ? '' : date).trim();

/**
 * เปลี่ยนวันที่รับเข้าหลังกางไฟล์แล้ว — บรรทัดที่ล็อตยังเป็นวันที่เดิม (ค่าที่ระบบเติมให้) ตามไปเป็นวันที่ใหม่
 * ล็อตที่คนพิมพ์เองไม่แตะ · คืนจำนวนบรรทัดที่เปลี่ยน
 * มีเพราะแท็บรับเข้ารวมเติมล็อตตั้งแต่ตอนกางไฟล์ (chemPlan) ถ้าแก้วันที่ทีหลัง ล็อตจะค้างวันเก่า
 * ส่วนหน้ารับเข้าปกติไม่ต้องใช้ เพราะตัดสินล็อตตอนบันทึก (receiveLot) — สองหน้าได้ผลเหมือนกัน
 */
export function relot(lines, before, now) {
  let n = 0;
  if (!before) return 0;
  for (const l of lines || []) if (l && l.lot === before) { l.lot = now || ''; n++; }
  return n;
}

/**
 * ล็อตที่ยังมีของเหลือ เรียงเก่าไปใหม่
 *
 * รับเข้าที่มีเลขล็อต = ของเข้ากอง
 * จ่ายออก/ของเสียที่ระบุล็อต = ตัดจากกองนั้น
 * ส่วนที่ไม่ระบุล็อต (รวมยกยอดมา) รวมเป็นกองเดียวชื่อว่าง ซึ่งถือว่าเก่าที่สุดเสมอ
 * เพราะเป็นของที่อยู่ในคลังมาก่อนที่จะเริ่มเก็บล็อต
 */
export function lotsOf(entries, entity, code) {
  if (!entity) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const c = String(code);
  const m = new Map();
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || String(e.material_code) !== c) continue;
    const lot = String(e.lot || '');
    const cur = m.get(lot) || { lot, qty: 0, first: e.at, last: e.at, inferred: false };
    cur.qty = round5(cur.qty + signedQty(e));
    if (e.at < cur.first) cur.first = e.at;
    if (e.at > cur.last) cur.last = e.at;
    m.set(lot, cur);
  }
  return [...m.values()]
    .filter(l => l.qty > 0)
    // กองที่ไม่มีเลขล็อตถือว่าเก่าสุด แล้วที่เหลือเรียงตามวันที่รับเข้าครั้งแรก
    .sort((a, b) => (a.lot === '' ? -1 : b.lot === '' ? 1 : 0) || a.first.localeCompare(b.first));
}

// ชนิดที่นับเป็นของ PO — ชุดเดียวกับ poStockOf (core/balance.js) · ไม่นับคืนของ/ของเสีย · บวกปรับยอดล้างเศษ (isFracAdj)
const PO_KINDS = new Set(['receive', 'sendback', 'issue']);

/**
 * ล็อตที่ยังเหลือของ PO ใบเดียว — ชุดเดียวกับ poStockOf (core/balance.js) จึงรวมกันได้เท่าคงเหลือ PO
 *
 * นับเฉพาะ รับเข้า · ส่งคืน Delta · จ่ายออก ที่อ้าง PO นี้ (ไม่นับคืนของ/ของเสีย — เจ้าของเคาะ 16 พ.ย. 2026)
 * ของออกที่ระบุล็อตตัดจากล็อตนั้นก่อน ส่วนที่ไม่ระบุล็อต (หรือเกินล็อตนั้น) ตัดจากล็อตเก่าก่อน
 * ⚠️ ถ้าตัดจ่ายออกไม่ระบุล็อตจากกองว่างตรง ๆ แบบ lotsOf กองว่างติดลบแล้วถูกกรองทิ้ง
 *    ล็อตที่รับมาจะเหลือเต็ม → ป้าย "ของไม่พอ" ไม่ขึ้นทั้งที่คงเหลือ PO หมดแล้ว
 */
export function poLotsOf(entries, entity, code, docRef) {
  if (!entity) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const c = String(code), ref = String(docRef || '');
  if (!ref) return [];
  const rows = entries.filter(e => e.entity === entity && counts(e) && String(e.material_code) === c
    && String(e.doc_ref) === ref && (PO_KINDS.has(e.kind) || isFracAdj(e)));
  const piles = new Map();
  for (const e of rows) {
    const d = signedQty(e);
    if (d <= 0) continue;
    const lot = String(e.lot || '');
    const cur = piles.get(lot) || { lot, qty: 0, first: e.at, last: e.at, inferred: false };
    cur.qty = round5(cur.qty + d);
    if (e.at < cur.first) cur.first = e.at;
    if (e.at > cur.last) cur.last = e.at;
    piles.set(lot, cur);
  }
  let loose = 0;
  for (const e of rows) {
    let out = -signedQty(e);
    if (out <= 0) continue;
    const p = e.lot ? piles.get(String(e.lot)) : null;
    if (p) { const t = Math.min(p.qty, out); p.qty = round5(p.qty - t); out = round5(out - t); }
    loose = round5(loose + out);
  }
  const sorted = [...piles.values()]
    .sort((a, b) => (a.lot === '' ? -1 : b.lot === '' ? 1 : 0) || a.first.localeCompare(b.first));
  for (const p of sorted) {
    if (loose <= 0) break;
    const t = Math.min(p.qty, loose);
    p.qty = round5(p.qty - t); loose = round5(loose - t);
  }
  return sorted.filter(p => p.qty > 0);
}

/**
 * เดาว่าควรตัดจากล็อตไหน — ของเก่าก่อน
 * คืนรายการที่อาจมีหลายล็อตถ้าล็อตเดียวไม่พอ
 *
 * enough=false แปลว่าของที่บันทึกไว้ไม่พอกับที่จะจ่าย
 * ⚠️ ห้ามเอาไปบล็อกการบันทึก — INVARIANTS A4 บอกว่ายอดติดลบเตือนได้แต่ห้ามห้าม
 * เพราะของจริงมีกรณีคีย์รับเข้าย้อนหลัง
 */
export function suggestLots(entries, entity, code, qty, docRef) {
  const want = Number(qty) || 0;
  // ส่งเลข PO มา = หยิบจากล็อตของใบนั้นเท่านั้น (หน้าจ่ายออก · เจ้าของสั่ง 16 พ.ย. 2026)
  const open = docRef ? poLotsOf(entries, entity, code, docRef) : lotsOf(entries, entity, code);
  const picks = [];
  let left = want;
  for (const l of open) {
    if (left <= 0) break;
    const take = round5(Math.min(l.qty, left));
    picks.push({ lot: l.lot, take, available: l.qty, inferred: true });
    left = round5(left - take);
  }
  return { picks, short: round5(Math.max(0, left)), enough: left <= 0, lots: open };
}

/**
 * ตามรอยย้อนกลับ — ล็อตนี้ถูกใช้ไปกับงานไหนบ้าง
 * คำถามที่ลูกค้าถามตอนของมีปัญหา
 */
export function traceLot(entries, entity, code, lot) {
  if (!entity) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const c = String(code), L = String(lot || '');
  const rows = entries
    .filter(e => e.entity === entity && counts(e) && String(e.material_code) === c
                 && String(e.lot || '') === L)
    .sort((a, b) => a.at.localeCompare(b.at));
  const inQ = rows.filter(e => signedQty(e) > 0).reduce((a, e) => round5(a + signedQty(e)), 0);
  const outRows = rows.filter(e => signedQty(e) < 0);
  const jobs = new Map();
  for (const e of outRows) {
    const key = e.part_no || e.doc_ref || '(ไม่ระบุงาน)';
    const j = jobs.get(key) || { job: key, qty: 0, inferred: false, first: e.at, last: e.at };
    j.qty = round5(j.qty - signedQty(e));
    if (e.lot_inferred) j.inferred = true;
    if (e.at < j.first) j.first = e.at;
    if (e.at > j.last) j.last = e.at;
    jobs.set(key, j);
  }
  return {
    lot: L,
    received: inQ,
    used: round5(outRows.reduce((a, e) => a - signedQty(e), 0)),
    remaining: round5(rows.reduce((a, e) => a + signedQty(e), 0)),
    jobs: [...jobs.values()].sort((a, b) => a.first.localeCompare(b.first)),
    // ถ้ามีบรรทัดไหนที่ล็อตมาจากการเดา คำตอบทั้งก้อนก็เป็นการอนุมาน ต้องบอกให้ชัด
    anyInferred: outRows.some(e => e.lot_inferred)
  };
}
