/**
 * การนับของ — ทั้งตอนเปิดระบบและตอนนับแล้วปรับรายตัว
 *
 * ── หน้าจอเดียวทำสองงาน โดยไม่ต้องให้คนเลือกโหมด ─────────────────
 * รหัสที่ยังไม่เคยมีรายการใน v2 เลย  → ลงเป็น "ยกยอดมา" (open)
 * รหัสที่มีประวัติแล้ว                → ลงเป็น "ปรับยอด" (adjust)
 *
 * ตั้งใจไม่ให้มีสวิตช์ให้กดผิด เพราะตอนเปิดระบบจะมีคนคีย์หลายคนพร้อมกัน
 * และคนที่กดโหมดผิดจะไม่รู้ตัวจนกว่ายอดจะเพี้ยนไปแล้วหลายสัปดาห์
 *
 * ── ใบนับต้องไม่มีตัวเลขของระบบ ─────────────────────────────────
 * ถ้าคนนับเห็นว่าระบบบอก 52 เขาจะนับได้ 52 ไม่ใช่เพราะขี้โกง แต่เพราะสมองทำแบบนั้นเอง
 * โดยเฉพาะกับของที่นับยากอย่างลวดหรือเทป การนับทั้งรอบจะกลายเป็นการยืนยันตัวเลขเดิม
 * ซึ่งแปลว่าเสียแรงทั้งหมดไปโดยไม่ได้อะไรเลย — sheetRows() จึงไม่คืนยอดออกมาเด็ดขาด
 */
import { makeEntry, round5 } from './ledger.js';

export const STATUS = { open: 'กำลังนับ', posted: 'ลงบัญชีแล้ว' };

export function makeSession({ entity, name, person, scope = '' }) {
  if (!entity) throw new Error('ต้องระบุนิติบุคคล');
  if (!person) throw new Error('ต้องระบุคนนับ');
  const now = new Date().toISOString();
  return {
    id: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    entity: String(entity),
    name: String(name || 'นับของ ' + now.slice(0, 10)),
    scope: String(scope),               // หมวดหรือคำค้นที่ใช้เลือกรายการมานับ
    person: String(person),
    status: 'open',
    counted: {},                        // code -> { qty, note }
    created_at: now, updated_at: now, posted_at: ''
  };
}

/**
 * รายการสำหรับพิมพ์ใบนับ — มีแค่รหัส ชื่อ หน่วย และช่องว่าง
 * ⚠️ ห้ามเติมยอดลงไปไม่ว่าจะด้วยเหตุผลอะไร ดูหมายเหตุหัวไฟล์
 */
export function sheetRows(materials, { scope = '', category = '' } = {}) {
  const term = String(scope).trim().toUpperCase();
  return materials
    .filter(m => m.active !== false)
    .filter(m => !category || m.category === category)
    .filter(m => !term
      || String(m.material_code).toUpperCase().includes(term)
      || String(m.description).toUpperCase().includes(term))
    .map(m => ({ code: String(m.material_code), desc: m.description || '',
                 unit: m.unit || '', category: m.category || '' }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
}

const has = (v) => v !== null && v !== undefined && v !== '' && isFinite(Number(v));

/**
 * แผนการลงบัญชี — บอกให้เห็นก่อนกดว่าจะเกิดอะไรกับแต่ละรหัส
 *
 *   codesWithHistory  Set ของรหัสที่มีรายการใน v2 แล้ว (ไม่ใช่ "ยอดไม่เป็นศูนย์"
 *                     เพราะรหัสที่รับเข้าแล้วจ่ายออกหมดก็ยอดศูนย์ แต่มีประวัติ
 *                     ถ้าใช้ยอดตัดสินจะลง open ทับประวัติเดิมซึ่งผิด)
 */
export function planCount(session, { balances, codesWithHistory, reference = null }) {
  const rows = [];
  for (const [code, v] of Object.entries(session.counted || {})) {
    if (!has(v && v.qty)) continue;
    const counted = round5(Number(v.qty));
    const book = round5(balances.get(code) || 0);
    const known = codesWithHistory.has(code);
    const ref = reference && reference.has(code) ? round5(reference.get(code)) : null;

    let kind = null, delta = 0;
    if (!known) { kind = counted > 0 ? 'open' : null; delta = counted; }
    else if (counted !== book) { kind = 'adjust'; delta = round5(counted - book); }

    rows.push({ code, counted, book, known, kind, delta,
                note: (v.note || ''),
                ref, refDelta: ref === null ? null : round5(counted - ref) });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** สรุปแผนให้เห็นภาพรวมก่อนกด */
export function planSummary(rows) {
  const opens = rows.filter(r => r.kind === 'open');
  const adjs  = rows.filter(r => r.kind === 'adjust');
  const same  = rows.filter(r => r.kind === null);
  const withRef = rows.filter(r => r.refDelta !== null);
  return {
    counted: rows.length,
    open: opens.length,
    adjust: adjs.length,
    same: same.length,
    up: adjs.filter(r => r.delta > 0).length,
    down: adjs.filter(r => r.delta < 0).length,
    // เทียบกับตัวเลขอ้างอิงจากระบบเดิม — ตัวเลขที่ไม่เคยมีมาก่อนว่าของเดิมเพี้ยนแค่ไหน
    refChecked: withRef.length,
    refMatch: withRef.filter(r => r.refDelta === 0).length,
    refOff: withRef.filter(r => r.refDelta !== 0).length
  };
}

/** สร้างรายการลงสมุดจากแผน — ไม่เขียนอะไรเอง คืนของให้ผู้เรียกไปบันทึก */
export function postCount(session, rows, { device = '' } = {}) {
  const at = new Date().toISOString();
  return rows.filter(r => r.kind).map(r => {
    const base = { entity: session.entity, material_code: r.code, person: session.person,
                   device, at, doc_kind: 'count', doc_ref: session.id,
                   note: [r.note, 'จากการนับ ' + session.name].filter(Boolean).join(' · ') };
    if (r.kind === 'open') {
      return makeEntry({ ...base, kind: 'open', qty: r.counted });
    }
    return makeEntry({ ...base, kind: 'adjust', reason_code: 'count',
                       counted_qty: r.counted, book_qty: r.book });
  });
}
