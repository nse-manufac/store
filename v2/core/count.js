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
 *
 * ฟอร์มใหม่ (ชีต WIP · เจ้าของสั่ง 18 ต.ค. 2026 — โรงงานจะใช้แบบนี้):
 * Material · Description · UOM · Vendor · Vendor Stk · PO No. · … · QTY · ACT · … · ตัวอักษรนิติบุคคล (คอลัมน์ท้าย ไม่มีหัว)
 * - หนึ่งรหัสหลายแถว แถวละ PO · Vendor Stk อยู่แถวแรกของรหัส (บางไฟล์เติมค่าเดิมซ้ำทุกแถว = ใช้ค่าเดียว ห้ามบวกรวม) · ACT = Vendor Stk − QTY สะสม
 * - **ไฟล์เดียวมีหลายนิติบุคคล** — รับเฉพาะแถวของนิติบุคคลของรอบนับ (นิติบุคคลของแถว = จากเลข PO · ตัวอักษรท้ายแถวต้องตรงกัน)
 * - ยอดนับ = QTY รวมของแถวนิติบุคคลนั้น (โรงงานแจ้ง) · ทางสำรอง = Vendor Stk (เจ้าของขอเผื่อไว้)
 *   Vendor Stk มีตัวเดียวต่อรหัส → รหัสที่มี PO ของหลายนิติบุคคล ไม่ลง (แบ่งเองไม่ได้ว่าส่วนไหนของใคร)
 */
const cellText = v => String(v == null ? '' : v).trim();
const headKey = v => cellText(v).toUpperCase().replace(/[\s._]+/g, '');

/**
 * อ่านชีต (array of arrays) → { rows: [{ line, code, qty, desc }], errors: [{ line, why }], dups: [{ code, lines, qty }], header }
 * ⚠️ หาคอลัมน์จากหัว (MATERIAL NO · QTY) ไม่ยึดตำแหน่ง — ไฟล์รอบจริงสลับคอลัมน์ได้
 * ⚠️ รหัสซ้ำในไฟล์ = รวมยอดให้ แล้วรายงานไว้ (นับสองที่ = สองแถว) · ห้ามเงียบ
 * ⚠️ หยุดที่แถว GRAND TOTAL · แถวว่างข้าม · ยอดว่าง/ไม่ใช่ตัวเลข/ติดลบ = รายงานเป็นข้อผิด ไม่เดาเป็นศูนย์
 */
export function parseCountSheet(aoa, opts = {}) {
  const rows = aoa || [];
  let header = -1, cCode = -1, cQty = -1, cDesc = -1, cStk = -1, cPo = -1;
  for (let i = 0; i < Math.min(rows.length, 40) && header < 0; i++) {
    const keys = (rows[i] || []).map(headKey);
    const code = keys.findIndex(k => k === 'MATERIALNO' || k === 'MATERIAL' || k === 'MATERIALCODE' || k === 'MATNO');
    const qty = keys.findIndex(k => k === 'QTY' || k === 'QUANTITY');
    const stk = keys.findIndex(k => k === 'VENDORSTK' || k === 'VENDORSTOCK');
    if (code >= 0 && (qty >= 0 || stk >= 0)) {
      header = i; cCode = code; cQty = qty; cStk = stk;
      cDesc = keys.findIndex(k => k.startsWith('MATERIALDESC') || k === 'DESCRIPTION');
      cPo = keys.findIndex(k => k === 'PONO' || k === 'PONUMBER');
    }
  }
  const empty = { rows: [], dups: [], header: -1, layout: '', source: '', held: [], entities: [], skippedBlank: 0 };
  if (header < 0) return { ...empty, errors: [{ line: 0, why: 'หาหัวคอลัมน์ "MATERIAL NO" กับ "QTY" ไม่เจอ — เลือกชีตผิดหรือเปล่า' }] };
  // มีคอลัมน์ PO = ยอดราย PO (ฟอร์ม WIP) — ห้ามอ่านแบบตารางยอดนับธรรมดา ไม่งั้น QTY ทุก PO ถูกบวกรวมกันเงียบ ๆ
  if (cPo >= 0) return parseWip(rows, header, { cCode, cQty, cDesc, cStk, cPo }, opts, empty);
  // ชีตมีคอลัมน์ Vendor Stk = ฟอร์ม WIP แน่ ๆ (ฟอร์มเดิมไม่มีคอลัมน์นี้) — หาหัวคอลัมน์ PO ไม่เจอแล้ว
  // ห้ามถอยไปอ่านแบบตารางยอดนับธรรมดา ไม่งั้น QTY ของทุก PO ทุกนิติบุคคลถูกบวกรวมกันเงียบ ๆ (A3)
  if (cStk >= 0) return { ...empty, errors: [{ line: 0, why: 'ชีตนี้เป็นฟอร์ม WIP (มีคอลัมน์ Vendor Stk) แต่หาหัวคอลัมน์ "PO No." ไม่เจอ — เลือกชีตถูกไหม หรือแจ้งเจ้าของว่าหัวคอลัมน์ในไฟล์เปลี่ยน' }] };
  if (cQty < 0) return { ...empty, errors: [{ line: 0, why: 'หาหัวคอลัมน์ "QTY" ไม่เจอ — เลือกชีตผิดหรือเปล่า' }] };
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
  return { ...empty, rows: [...out.values()], errors, dups, header: header + 1, layout: 'simple', source: 'qty',
           label: cellText(rows[header][cQty]) };
}

const numOf = v => typeof v === 'number' ? v : (cellText(v) === '' ? NaN : Number(cellText(v).replace(/,/g, '')));
const blank = v => v == null || cellText(v) === '';

/**
 * ฟอร์ม WIP — opts = { entity: นิติบุคคลของรอบนับ, entityOf: (เลข PO) => นิติบุคคล, source: 'qty' | 'stk', known }
 * คืนแบบเดียวกับ parseCountSheet และเพิ่ม
 *   held      = รหัสที่มีแถวของนิติบุคคลนี้ (อยู่ในไฟล์) แต่ไม่ลง [{ code, line, desc, why, stk, ents }]
 *   entities  = นิติบุคคลในไฟล์ [{ entity, codes }] · skippedBlank = แถว QTY ว่างที่ข้าม (ไม่เดาเป็น 0)
 * ⚠️ entityOf มาจากผู้เรียก (master/entities.js · entityOfPo) — กฎเดียวกับที่ระบบตัดสินเจ้าของ PO ทุกที่
 * ⚠️ known (Set รหัสในทะเบียน) = จัดกลุ่มแถวตามรหัสเดียวกันหลังเติม 0 ไม่ใช่ตามสตริงในไฟล์
 *    รหัสที่ไฟล์เขียนสองแบบ (Excel ตัด 0 หน้าบางแถว) ต้องเป็นกลุ่มเดียว ไม่งั้นด่านรายรหัสข้างล่าง
 *    (หลายนิติบุคคล · unsure · badQty · Vendor Stk ค่าเดียว) เห็นแค่ครึ่งเดียวแล้วลงยอดเงียบ ๆ (A3)
 *    ไม่ส่ง known มา = กุญแจกลุ่มเป็นสตริงในไฟล์เหมือนเดิม
 */
function parseWip(rows, header, { cCode, cQty, cDesc, cStk, cPo }, opts, empty) {
  const source = opts.source === 'stk' ? 'stk' : 'qty';
  const entity = String(opts.entity || '').trim().toUpperCase();
  const fail = why => ({ ...empty, errors: [{ line: 0, why }], layout: 'wip', source });
  if (!entity || typeof opts.entityOf !== 'function') return fail('ไม่รู้นิติบุคคลของรอบนับ');
  if (source === 'qty' && cQty < 0) return fail('หาหัวคอลัมน์ "QTY" ไม่เจอ');
  if (source === 'stk' && cStk < 0) return fail('หาหัวคอลัมน์ "Vendor Stk" ไม่เจอ');
  // คอลัมน์ตัวอักษรนิติบุคคลไม่มีหัว — คอลัมน์ขวาสุดที่ทุกช่องที่มีค่าเป็นตัวอักษรตัวเดียว
  const width = Math.max(0, ...rows.map(r => (r || []).length));
  let cLetter = -1;
  for (let c = width - 1; c > cCode && cLetter < 0; c--) {
    let seen = 0, ok = true;
    for (let i = header + 1; i < rows.length && ok; i++) {
      const v = cellText((rows[i] || [])[c]);
      if (v) { seen++; ok = /^[A-Z]$/i.test(v); }
    }
    if (seen && ok) cLetter = c;
  }
  const groups = new Map(), errors = [];
  // กฎเติม 0 ต้องเป็นกฎเดียวกับ matchCountRows เป๊ะ ๆ ห้ามเดากฎใหม่ ไม่งั้นสองที่จัดกลุ่มคนละแบบ
  const known = opts.known;
  const canon = c => known && !known.has(c) && /^\d{9}$/.test(c) && known.has('0' + c) ? '0' + c : c;
  let skippedBlank = 0;
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.some(v => /GRAND\s*TOTAL/i.test(cellText(v)))) break;
    const raw = r[cCode];
    const code = cellText(typeof raw === 'number' ? String(raw) : raw).toUpperCase();
    if (!code) continue;                                   // แถวว่างคั่นระหว่างรหัส
    const line = i + 1;
    const key = canon(code);
    let g = groups.get(key);
    // g.code = สตริงรหัสที่เจอในไฟล์ครั้งแรก (ไม่ใช่รหัสที่เติม 0 แล้ว) — matched[].padded / fileCode ต้องยังใช้ได้
    if (!g) groups.set(key, g = { code, line, desc: '', ents: new Set(), stk: [], qty: 0, qtyRows: 0, badQty: false, unsure: false });
    if (!g.desc && cDesc >= 0) g.desc = cellText(r[cDesc]);
    const po = cellText(r[cPo]);
    const ent = String(opts.entityOf(po) || '').toUpperCase();
    const letter = cLetter >= 0 ? cellText(r[cLetter]).toUpperCase() : '';
    if (!ent) { errors.push({ line, code, why: `ตัดสินนิติบุคคลจากเลข PO "${po}" ไม่ได้` }); g.unsure = true; continue; }
    if (letter && !ent.endsWith('-' + letter)) {
      errors.push({ line, code, why: `ตัวอักษรนิติบุคคลท้ายแถว (${letter}) ไม่ตรงกับเลข PO ${po}` }); g.unsure = true; continue;
    }
    g.ents.add(ent);
    if (cStk >= 0 && !blank(r[cStk])) g.stk.push({ line, n: numOf(r[cStk]) });
    if (ent !== entity || cQty < 0) continue;
    if (blank(r[cQty])) { skippedBlank++; continue; }
    const n = numOf(r[cQty]);
    if (!isFinite(n) || n < 0) { errors.push({ line, code, why: n < 0 ? 'QTY ติดลบ' : 'QTY ไม่ใช่ตัวเลข' }); g.badQty = true; continue; }
    g.qty = round5(g.qty + n); g.qtyRows++;
  }
  const out = [], held = [], dups = [], count = new Map();
  for (const g of groups.values()) {
    for (const e of g.ents) count.set(e, (count.get(e) || 0) + 1);
    if (!g.ents.has(entity) && !g.unsure) continue;        // รหัสของนิติบุคคลอื่นล้วน = ไม่อยู่ในไฟล์ของรอบนี้
    const base = { code: g.code, line: g.line, desc: g.desc, ents: [...g.ents].sort() };
    // Vendor Stk มีตัวเดียวต่อรหัส — ฟอร์มจริงเขียนไว้แถวแรก แต่คนทำ Excel เติมค่าเดิมลงมาทุกแถวได้
    // ⚠️ ห้ามบวกรวมเด็ดขาด (จะได้ยอดเป็นหลายเท่า) · ค่าเท่ากันทุกแถว = ค่านั้น · ไม่เท่ากัน = ตัดสินให้ไม่ได้
    const stkVals = g.stk.map(x => x.n);
    const stkOne = stkVals.length ? round5(stkVals[0]) : null;
    const stkSame = stkVals.every(n => n === stkVals[0]);
    if (g.unsure) { held.push({ ...base, why: 'มีแถวที่ตัดสินนิติบุคคลไม่ได้' }); continue; }
    if (source === 'qty') {
      if (g.badQty) held.push({ ...base, why: 'มีแถว QTY ที่อ่านไม่ได้' });
      else if (!g.qtyRows) held.push({ ...base, why: 'QTY ว่างทุกแถวของนิติบุคคลนี้' });
      else out.push({ line: g.line, code: g.code, qty: g.qty, desc: g.desc });
      continue;
    }
    if (g.ents.size > 1) { held.push({ ...base, stk: stkSame ? stkOne : null, why: 'มี PO ของหลายนิติบุคคล — Vendor Stk แบ่งไม่ได้' }); continue; }
    if (!g.stk.length) { held.push({ ...base, why: 'ไม่มี Vendor Stk' }); continue; }
    if (g.stk.some(x => !isFinite(x.n) || x.n < 0)) { held.push({ ...base, why: 'Vendor Stk อ่านไม่ได้หรือติดลบ' }); continue; }
    if (!stkSame) { held.push({ ...base, stks: stkVals,
      why: `Vendor Stk ไม่เท่ากันหลายแถว (${stkVals.join(' / ')}) — คีย์ยอดเองในตารางนับ` }); continue; }
    out.push({ line: g.line, code: g.code, qty: stkOne, desc: g.desc });
  }
  const entities = [...count].map(([e, codes]) => ({ entity: e, codes })).sort((a, b) => a.entity.localeCompare(b.entity));
  return { rows: out, errors, dups, header: header + 1, layout: 'wip', source, held, entities, skippedBlank,
           label: source === 'stk' ? cellText(rows[header][cStk]) : cellText(rows[header][cQty]) };
}

/**
 * จับคู่รหัสในไฟล์กับทะเบียน — known = Set ของรหัสในทะเบียน (ตัวพิมพ์ใหญ่)
 * ตรงเป๊ะก่อน · ไม่เจอและเป็นตัวเลข 9 หลัก → ลองเติม 0 ข้างหน้า (Excel ตัด 0 ตัวแรกของรหัสที่เป็นตัวเลขทิ้ง)
 * ⚠️ ไม่เดาอย่างอื่น — รหัสที่ลงท้ายตัวอักษรหรือไม่มีในทะเบียน ขึ้นเป็น unknown ให้คนดู
 *
 * sum = รหัสเดียวกันที่ไฟล์เขียนสองแบบ (เติม 0 แล้วชนกัน) รวมยอดได้ไหม
 *   true  (ค่าตั้งต้น) ยอดเคลื่อนไหวอย่าง QTY = บวกรวม ของชิ้นเดียวกันนับมาสองแถว
 *   false ยอดคงเหลืออย่าง Vendor Stk = บวกกันไม่ได้ · ค่าเท่ากันใช้ค่าเดียว · ไม่เท่ากันไม่ลง เข้า held
 * คืน { matched: [{ code, qty, fileCode, padded, desc }], unknown: [{ code, qty, desc, line }],
 *       held: [{ code, line, desc, why }] }
 */
export function matchCountRows(rows, known, { sum = true } = {}) {
  const matched = [], unknown = [], taken = new Map();
  for (const r of rows || []) {
    let code = r.code, padded = false;
    if (!known.has(code) && /^\d{9}$/.test(code) && known.has('0' + code)) { code = '0' + code; padded = true; }
    if (!known.has(code)) { unknown.push({ code: r.code, qty: r.qty, desc: r.desc, line: r.line }); continue; }
    // เติม 0 แล้วไปชนรหัสที่มีอยู่แล้วในไฟล์ = ของชิ้นเดียวกัน
    const t = taken.get(code);
    if (t) {
      t.codes.push(r.code);
      if (sum) t.m.qty = round5(t.m.qty + r.qty);
      else if (round5(r.qty) !== round5(t.m.qty)) t.clash.push(round5(r.qty));
      continue;
    }
    const m = { code, qty: r.qty, fileCode: r.code, padded, desc: r.desc };
    taken.set(code, { m, line: r.line, codes: [r.code], clash: [] }); matched.push(m);
  }
  const held = [];
  for (const t of taken.values()) {
    if (!t.clash.length) continue;
    held.push({ code: t.m.code, line: t.line, desc: t.m.desc,
                why: `ไฟล์เขียนรหัสนี้สองแบบ (${t.codes.join(' / ')}) และยอดไม่เท่ากัน `
                     + `(${[round5(t.m.qty), ...t.clash].join(' / ')}) — คีย์ยอดเองในตารางนับ` });
  }
  const bad = new Set(held.map(h => h.code));
  return { matched: bad.size ? matched.filter(m => !bad.has(m.code)) : matched, unknown, held };
}

/**
 * รหัสที่ระบบมีของ (ยอด ≠ 0 ณ เวลานับ) แต่ไม่อยู่ในไฟล์ — เจ้าของเลือก: ไม่แตะเอง ขึ้นให้คนติ๊กว่าตัวไหนนับเป็น 0
 * book = Map<code, number> · match = ผลจาก matchCountRows() · คืน [{ code, book }] เรียงตามรหัส
 *
 * ⚠️ รับผลจาก matchCountRows() ทั้งก้อน ไม่ใช่ Set ที่ผู้เรียกทำเอง
 * เพราะ "อยู่ในไฟล์" = matched + unknown · รหัสที่อยู่ในไฟล์แต่ยังไม่มีในทะเบียน (unknown)
 * ก็คือรหัสที่ Delta นับมาให้แล้ว ถ้านับแค่ matched มันจะไปโผล่ในรายการ "ไม่อยู่ในไฟล์"
 * แล้วคนกด "ติ๊กทั้งหมด" จะล้างยอดจริงทิ้งเป็น 0
 * parsed (ไม่บังคับ) = ผลจาก parseCountSheet() — รหัสในแถวที่อ่านไม่ได้ และรหัสที่อยู่ในไฟล์แต่ไม่ลง (held)
 * ก็อยู่ในไฟล์เหมือนกัน · ยังไม่ผ่านการเติม 0 จึงนับทั้งรหัสเดิมและรหัสที่เติม 0 แล้ว
 * match.held (รหัสที่จับคู่แล้วชนกันเองจนไม่ลง) ก็อยู่ในไฟล์ ต้องไม่ไปโผล่ในรายการให้ติ๊กเป็น 0
 */
export function missingFromFile(book, match, parsed = null) {
  const inFile = new Set([...((match && match.matched) || []).map(m => m.code),
                          ...((match && match.unknown) || []).map(u => u.code),
                          ...((match && match.held) || []).map(h => h.code)]);
  for (const x of [...((parsed && parsed.errors) || []), ...((parsed && parsed.held) || [])]) {
    if (!x.code) continue;
    inFile.add(x.code);
    if (/^\d{9}$/.test(x.code)) inFile.add('0' + x.code);
  }
  const out = [];
  for (const [code, qty] of book || []) if (qty !== 0 && !inFile.has(code)) out.push({ code, book: qty });
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
