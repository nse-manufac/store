/**
 * ยอดคงเหลือ การ์ด และของเกินสูตร — คำนวณจากสมุดทุกครั้ง
 *
 * ⚠️ ไม่มีที่ไหนในระบบเก็บยอดคงเหลือไว้เป็นตัวเลข
 * ยอดคือผลบวกของสมุดเสมอ ที่ไหนแก้ยอดได้โดยไม่เขียนสมุด ที่นั่นคือจุดที่ตัวเลขเริ่มเชื่อไม่ได้
 *
 * ทุกฟังก์ชันในไฟล์นี้บังคับให้ส่ง entity เข้ามา — INVARIANTS A3
 * บริษัทมีหลายนิติบุคคลใช้แอปเดียวกัน การลืมกรองทำให้ยอดข้ามบริษัทกันโดยไม่มีอะไรเตือน
 * จึงทำให้ "ลืมไม่ได้" ด้วยการไม่ให้มีค่าเริ่มต้น
 */
import { signedQty, counts, round5, KINDS } from './ledger.js';

function need(entity) {
  if (!entity) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  return entity;
}

/** รายการที่นับเข้ายอดของนิติบุคคลนี้ เรียงตามเวลา */
export function live(entries, entity) {
  need(entity);
  return entries
    .filter(e => e.entity === entity && counts(e))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1)));
}

/** ยอดคงเหลือของรหัสเดียว */
export function balanceOf(entries, entity, code) {
  need(entity);
  const c = String(code);
  let bal = 0;
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || String(e.material_code) !== c) continue;
    bal = round5(bal + signedQty(e));
  }
  return bal;
}

/** ยอดคงเหลือทุกรหัส — Map<code, number> */
export function balances(entries, entity) {
  need(entity);
  const m = new Map();
  for (const e of entries) {
    if (e.entity !== entity || !counts(e)) continue;
    const c = String(e.material_code);
    m.set(c, round5((m.get(c) || 0) + signedQty(e)));
  }
  return m;
}

/**
 * PO ใบนี้เคยคีย์รับไปแล้วเท่าไหร่ แยกตามรหัส — Map<code, { qty, times, ats }>
 *
 * ของใน PO ใบเดียวมาไม่พร้อมกัน พนักงานคีย์รับหลายรอบต่อใบได้
 * ถ้าไม่เห็นยอดที่เคยคีย์ไปแล้วบนหน้ารับเข้า จะรับซ้ำหรือรับขาดโดยไม่มีอะไรเตือน
 *
 * นับเฉพาะ kind 'receive' — เป็นยอด "รับมาแล้วเท่าไหร่ตามใบนี้" ไม่ใช่ยอดคงเหลือ
 * ของที่คืน/เสีย/ปรับ ทีหลังไม่เกี่ยว เพราะไม่ได้ทำให้ใบนี้รับมาน้อยลง
 * ats เก็บเวลาดิบไว้ให้ฝั่งแสดงผลไปแปลงเป็นวันที่เอง (ห้าม slice วันที่ในนี้ — ดู localtime.js)
 */
export function receivedOfDoc(entries, entity, docRef) {
  need(entity);
  const ref = String(docRef || '');
  const m = new Map();
  if (!ref) return m;
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || e.kind !== 'receive') continue;
    if (String(e.doc_ref) !== ref) continue;
    const c = String(e.material_code);
    const hit = m.get(c) || { qty: 0, times: 0, ats: [] };
    hit.qty = round5(hit.qty + (e.qty || 0));
    hit.times++;
    hit.ats.push(e.at);
    m.set(c, hit);
  }
  return m;
}

/**
 * การ์ดรายตัว — ประวัติของรหัสเดียวพร้อมยอดสะสมทีละบรรทัด
 * เรียงเก่าไปใหม่ เพราะเป็นเอกสารที่ลูกค้าอ่านไล่ลงมา
 */
export function cardRows(entries, entity, code) {
  const c = String(code);
  let bal = 0;
  return live(entries, entity)
    .filter(e => String(e.material_code) === c)
    .map(e => {
      const d = signedQty(e);
      bal = round5(bal + d);
      return { ...e, moved: d, balance: bal, kindLabel: KINDS[e.kind]?.label || e.kind };
    });
}

/**
 * รายการที่ยอดผิดปกติ — ใช้แทนการนับรอบ ซึ่งตัดสินแล้วว่ายังไม่ทำ
 *
 * ให้เครื่องชี้เป้าแทนคนเดินนับ ทั้งสามข้อคำนวณจากสมุดได้เลยโดยไม่ต้องมีใครไปนับของ
 *   negative  ยอดติดลบ = มีของออกมากกว่าที่เคยเข้า แปลว่ามีอะไรไม่ถูกแน่ ๆ
 *   stale     ไม่ขยับมานาน = อาจเลิกใช้ไปแล้ว หรือมีคนลืมคีย์
 *   heavy     จ่ายออกรวมเกินที่เคยรับเข้ามาก ๆ ทั้งที่ยอดยังไม่ติดลบ
 */
export function oddBalances(entries, entity, { staleDays = 90, now = new Date() } = {}) {
  need(entity);
  const acc = new Map();
  for (const e of entries) {
    if (e.entity !== entity || !counts(e)) continue;
    const c = String(e.material_code);
    const a = acc.get(c) || { code: c, bal: 0, in: 0, out: 0, last: '' };
    const d = signedQty(e);
    a.bal = round5(a.bal + d);
    if (d > 0) a.in = round5(a.in + d); else a.out = round5(a.out - d);
    if (e.at > a.last) a.last = e.at;
    acc.set(c, a);
  }
  const cutoff = new Date(now.getTime() - staleDays * 864e5).toISOString();
  const out = [];
  for (const a of acc.values()) {
    const why = [];
    if (a.bal < 0) why.push('ยอดติดลบ');
    if (a.bal !== 0 && a.last && a.last < cutoff) why.push(`ไม่ขยับมา ${staleDays} วัน`);
    if (a.in > 0 && a.out > a.in * 1.5) why.push('จ่ายออกมากกว่าที่เคยรับเข้าผิดปกติ');
    if (why.length) out.push({ ...a, why });
  }
  return out.sort((x, y) => x.bal - y.bal);
}

/**
 * ของที่เบิกเกินสูตร — เทียบยอดจ่ายออกจริงกับที่ BOM บอกไว้
 * bomFor(pn) ต้องคืน Map<code, usagePerPiece>
 */
export function overBom(entries, entity, { bomFor, orderOf }) {
  need(entity);
  const used = new Map();   // key = pn|code
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || e.kind !== 'issue' || !e.part_no) continue;
    const k = e.part_no + '|' + e.material_code;
    used.set(k, round5((used.get(k) || 0) + e.qty));
  }
  const rows = [];
  for (const [k, qty] of used) {
    const [pn, code] = k.split('|');
    const bom = bomFor(pn);
    if (!bom) continue;
    const per = bom.get(code);
    if (per == null) { rows.push({ pn, code, qty, expect: null, over: null, note: 'ไม่มีในสูตร' }); continue; }
    const expect = round5(per * (orderOf(pn) || 0));
    if (expect > 0 && qty > expect) {
      rows.push({ pn, code, qty, expect, over: round5(qty - expect), note: '' });
    }
  }
  return rows.sort((a, b) => (b.over || 0) - (a.over || 0));
}
