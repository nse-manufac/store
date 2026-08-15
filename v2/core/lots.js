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
import { signedQty, counts, round5 } from './ledger.js';

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

/**
 * เดาว่าควรตัดจากล็อตไหน — ของเก่าก่อน
 * คืนรายการที่อาจมีหลายล็อตถ้าล็อตเดียวไม่พอ
 *
 * enough=false แปลว่าของที่บันทึกไว้ไม่พอกับที่จะจ่าย
 * ⚠️ ห้ามเอาไปบล็อกการบันทึก — INVARIANTS A4 บอกว่ายอดติดลบเตือนได้แต่ห้ามห้าม
 * เพราะของจริงมีกรณีคีย์รับเข้าย้อนหลัง
 */
export function suggestLots(entries, entity, code, qty) {
  const want = Number(qty) || 0;
  const open = lotsOf(entries, entity, code);
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
