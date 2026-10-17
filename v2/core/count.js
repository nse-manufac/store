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

/** สร้างรายการลงสมุดจากแผน — ไม่เขียนอะไรเอง คืนของให้ผู้เรียกไปบันทึก
 *  รอบที่ระบุเวลานับ (session.count_at · นำเข้าไฟล์ Delta) ลงรายการ ณ เวลานั้น
 *  ของที่เข้าออกหลังนับจึงต่อท้ายถูกที่ ยอดปัจจุบันไม่เพี้ยน */
export function postCount(session, rows, { device = '' } = {}) {
  const at = session.count_at || new Date().toISOString();
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

/* ══════════ นำเข้ายอดนับจากไฟล์ Excel ของ Delta (เจ้าของสั่ง 17 ต.ค. 2026) ══════════
 * Delta มาทำ inventory check แล้วส่งไฟล์สรุปยอดสุดท้ายมา (แยกไฟล์ต่อนิติบุคคล)
 * ชีตหน้าตา: ITEM · MATERIAL NO · MATERIAL DESCRIPTION · QTY · REMARK · ท้ายชีตมี "GRAND TOTAL AMOUNT"
 * ไม่มีคอลัมน์หน่วย / นิติบุคคล / ล็อต — หน่วยเดียวกับทะเบียน (เจ้าของยืนยัน) · นิติบุคคล = ที่เลือกบนหัวจอ
 */
const cellText = v => String(v == null ? '' : v).trim();
const headKey = v => cellText(v).toUpperCase().replace(/[\s._]+/g, '');

/**
 * อ่านชีต (array of arrays) → { rows: [{ line, code, qty, desc }], errors: [{ line, why }], dups: [{ code, lines, qty }], header }
 * ⚠️ หาคอลัมน์จากหัว (MATERIAL NO · QTY) ไม่ยึดตำแหน่ง — ไฟล์รอบจริงสลับคอลัมน์ได้
 * ⚠️ รหัสซ้ำในไฟล์ = รวมยอดให้ แล้วรายงานไว้ (นับสองที่ = สองแถว) · ห้ามเงียบ
 * ⚠️ หยุดที่แถว GRAND TOTAL · แถวว่างข้าม · ยอดว่าง/ไม่ใช่ตัวเลข/ติดลบ = รายงานเป็นข้อผิด ไม่เดาเป็นศูนย์
 */
export function parseCountSheet(aoa) {
  const rows = aoa || [];
  let header = -1, cCode = -1, cQty = -1, cDesc = -1;
  for (let i = 0; i < Math.min(rows.length, 40) && header < 0; i++) {
    const keys = (rows[i] || []).map(headKey);
    const code = keys.findIndex(k => k === 'MATERIALNO' || k === 'MATERIAL' || k === 'MATERIALCODE' || k === 'MATNO');
    const qty = keys.findIndex(k => k === 'QTY' || k === 'QUANTITY');
    if (code >= 0 && qty >= 0) {
      header = i; cCode = code; cQty = qty;
      cDesc = keys.findIndex(k => k.startsWith('MATERIALDESC') || k === 'DESCRIPTION');
    }
  }
  if (header < 0) return { rows: [], errors: [{ line: 0, why: 'หาหัวคอลัมน์ "MATERIAL NO" กับ "QTY" ไม่เจอ — เลือกชีตผิดหรือเปล่า' }], dups: [], header: -1 };
  const out = new Map(), errors = [], lines = new Map();
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.some(v => /GRAND\s*TOTAL/i.test(cellText(v)))) break;
    const raw = r[cCode];
    const code = cellText(typeof raw === 'number' ? String(raw) : raw).toUpperCase();
    const q = r[cQty];
    if (!code && (q === '' || q == null)) continue;
    const line = i + 1;
    // เส้นคั่นอย่าง "=====" ใต้ตารางไม่ใช่รายการ · ไม่มีรหัสแต่มีตัวเลข = รายงาน
    if (!code) { if (typeof q === 'number' || /^-?[\d.,]+$/.test(cellText(q))) errors.push({ line, why: 'มียอดแต่ไม่มีรหัส' }); continue; }
    const n = typeof q === 'number' ? q : (cellText(q) === '' ? NaN : Number(cellText(q).replace(/,/g, '')));
    if (!isFinite(n)) { errors.push({ line, code, why: 'ยอดว่างหรือไม่ใช่ตัวเลข' }); continue; }
    if (n < 0) { errors.push({ line, code, why: 'ยอดติดลบ' }); continue; }
    const prev = out.get(code);
    out.set(code, { line: prev ? prev.line : line, code, qty: round5((prev ? prev.qty : 0) + n),
                    desc: prev ? prev.desc : (cDesc >= 0 ? cellText(r[cDesc]) : '') });
    lines.set(code, [...(lines.get(code) || []), line]);
  }
  const dups = [...lines].filter(([, l]) => l.length > 1).map(([code, l]) => ({ code, lines: l, qty: out.get(code).qty }));
  return { rows: [...out.values()], errors, dups, header: header + 1 };
}

/**
 * จับคู่รหัสในไฟล์กับทะเบียน — known = Set ของรหัสในทะเบียน (ตัวพิมพ์ใหญ่)
 * ตรงเป๊ะก่อน · ไม่เจอและเป็นตัวเลข 9 หลัก → ลองเติม 0 ข้างหน้า (Excel ตัด 0 ตัวแรกของรหัสที่เป็นตัวเลขทิ้ง)
 * ⚠️ ไม่เดาอย่างอื่น — รหัสที่ลงท้ายตัวอักษรหรือไม่มีในทะเบียน ขึ้นเป็น unknown ให้คนดู
 * คืน { matched: [{ code, qty, fileCode, padded, desc }], unknown: [{ code, qty, desc, line }] }
 */
export function matchCountRows(rows, known) {
  const matched = [], unknown = [], taken = new Map();
  for (const r of rows || []) {
    let code = r.code, padded = false;
    if (!known.has(code) && /^\d{9}$/.test(code) && known.has('0' + code)) { code = '0' + code; padded = true; }
    if (!known.has(code)) { unknown.push({ code: r.code, qty: r.qty, desc: r.desc, line: r.line }); continue; }
    // เติม 0 แล้วไปชนรหัสที่มีอยู่แล้วในไฟล์ = รวมยอด (ของชิ้นเดียวกัน)
    if (taken.has(code)) { const m = taken.get(code); m.qty = round5(m.qty + r.qty); continue; }
    const m = { code, qty: r.qty, fileCode: r.code, padded, desc: r.desc };
    taken.set(code, m); matched.push(m);
  }
  return { matched, unknown };
}

/**
 * รหัสที่ระบบมีของ (ยอด ≠ 0 ณ เวลานับ) แต่ไม่อยู่ในไฟล์ — เจ้าของเลือก: ไม่แตะเอง ขึ้นให้คนติ๊กว่าตัวไหนนับเป็น 0
 * book = Map<code, number> · fileCodes = Set ของรหัสที่จับคู่ได้ · คืน [{ code, book }] เรียงตามรหัส
 */
export function missingFromFile(book, fileCodes) {
  const out = [];
  for (const [code, qty] of book || []) if (qty !== 0 && !fileCodes.has(code)) out.push({ code, book: qty });
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
