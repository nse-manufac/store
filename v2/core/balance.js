/**
 * ยอดคงเหลือ และการ์ด — คำนวณจากสมุดทุกครั้ง
 *
 * ⚠️ ไม่มีที่ไหนในระบบเก็บยอดคงเหลือไว้เป็นตัวเลข
 * ยอดคือผลบวกของสมุดเสมอ ที่ไหนแก้ยอดได้โดยไม่เขียนสมุด ที่นั่นคือจุดที่ตัวเลขเริ่มเชื่อไม่ได้
 *
 * ทุกฟังก์ชันในไฟล์นี้บังคับให้ส่ง entity เข้ามา — INVARIANTS A3
 * บริษัทมีหลายนิติบุคคลใช้แอปเดียวกัน การลืมกรองทำให้ยอดข้ามบริษัทกันโดยไม่มีอะไรเตือน
 * จึงทำให้ "ลืมไม่ได้" ด้วยการไม่ให้มีค่าเริ่มต้น
 */
import { signedQty, counts, round5, KINDS, isKnownKind, makeEntry, isFracAdj, FRAC_REASON } from './ledger.js';

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
 * ยอดคงเหลือทุกรหัส ณ เวลา at (รวมรายการที่เวลาเท่ากับ at) — Map<code, number>
 * ใช้กับการนับที่ Delta ทำตอนที่ยังมีของเข้าออกอยู่ (เจ้าของสั่ง 17 ต.ค. 2026)
 * เทียบยอดนับกับยอด ณ ตอนนับ ไม่ใช่ยอดตอนกดนำเข้า — ไม่งั้นของที่เข้าออกหลังนับจะถูกปรับทิ้ง
 */
export function balancesAt(entries, entity, at) {
  need(entity);
  const cut = String(at || '');
  return balances((entries || []).filter(e => cut && String(e.at || '') <= cut), entity);
}

/**
 * ยอดของชนิดหนึ่งที่อ้าง PO ใบนี้ แยกตามรหัส — Map<code, { qty, times, ats }>
 *
 * qty เป็นยอดดิบ (บวกเสมอ) ไม่ใช่ signedQty — ผู้เรียกรู้อยู่แล้วว่าถามชนิดไหน
 * ของเกินใช้คู่กัน: รับตามใบนี้ (receive) − ส่งคืน Delta ตามใบนี้ (sendback)
 * ถ้าไม่หักยอดที่คืนไปแล้ว รายการเดิมจะโผล่กลับมาแล้วมีคนคืนซ้ำ
 * ats เก็บเวลาดิบไว้ให้ฝั่งแสดงผลไปแปลงเป็นวันที่เอง (ห้าม slice วันที่ในนี้ — ดู localtime.js)
 */
export function movedOfDoc(entries, entity, docRef, kind) {
  need(entity);
  if (!isKnownKind(kind)) throw new Error(`ไม่รู้จักชนิดการเคลื่อนไหว "${kind}"`);
  const ref = String(docRef || '');
  const m = new Map();
  if (!ref) return m;
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || e.kind !== kind) continue;
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
 * PO ใบนี้เคยคีย์รับไปแล้วเท่าไหร่ แยกตามรหัส — Map<code, { qty, times, ats }>
 *
 * ของใน PO ใบเดียวมาไม่พร้อมกัน พนักงานคีย์รับหลายรอบต่อใบได้
 * ถ้าไม่เห็นยอดที่เคยคีย์ไปแล้วบนหน้ารับเข้า จะรับซ้ำหรือรับขาดโดยไม่มีอะไรเตือน
 *
 * นับเฉพาะ kind 'receive' — เป็นยอด "รับมาแล้วเท่าไหร่ตามใบนี้" ไม่ใช่ยอดคงเหลือ
 * ของที่คืน/เสีย/ปรับ/ส่งคืน Delta ทีหลังไม่เกี่ยว เพราะไม่ได้ทำให้ใบนี้รับมาน้อยลง
 */
export const receivedOfDoc = (entries, entity, docRef) => movedOfDoc(entries, entity, docRef, 'receive');

/**
 * ยอดของ PO ใบนี้ แยกตามรหัส — Map<code, { recv, sendback, issued, bal }> (เจ้าของสั่ง 16 พ.ย. 2026)
 *
 * หน้าจ่ายออกใช้แทนยอดคงคลังรวม จะได้ไม่เบิกของ PO หนึ่งไปใช้กับอีกใบ
 *   bal = รับเข้าตามใบนี้ − ส่งคืน Delta ตามใบนี้ − จ่ายออกตามใบนี้
 * ⚠️ ไม่นับ "คืนของ" กับ "ของเสีย" แม้คีย์อ้าง PO นี้ (เจ้าของเคาะ)
 *   คืนของ = ของเหลือจากไลน์กลับเข้าคลัง · ของเสีย = ของที่จ่ายออกไปแล้วถึงเสีย — ไม่ใช่ยอดของใบนี้
 * ⚠️ ไม่ใช่ยอดคงคลัง — ยกยอดมา · ปรับยอด · รับเข้าที่ไม่อ้าง PO ไม่อยู่ในนี้ ห้ามเอาไปแทน balances()
 * ⚠️ ยกเว้นปรับยอด "ล้างเศษ PO" (isFracAdj) นับเป็น frac ด้วย — ไม่งั้นล้างแล้วยอด PO ยังค้างเศษเหมือนเดิม (เจ้าของเคาะ 22 พ.ย. 2026)
 *   bal = รับ − ส่งคืน − จ่าย + frac
 */
export function poStockOf(entries, entity, docRef) {
  const recv = movedOfDoc(entries, entity, docRef, 'receive');
  const back = movedOfDoc(entries, entity, docRef, 'sendback');
  const iss  = movedOfDoc(entries, entity, docRef, 'issue');
  const frac = new Map(), ref = String(docRef || '');
  if (ref) for (const e of entries) {
    if (e.entity !== entity || !counts(e) || !isFracAdj(e) || String(e.doc_ref) !== ref) continue;
    frac.set(String(e.material_code), round5((frac.get(String(e.material_code)) || 0) + signedQty(e)));
  }
  const m = new Map();
  for (const c of new Set([...recv.keys(), ...back.keys(), ...iss.keys(), ...frac.keys()])) {
    const r = recv.get(c)?.qty || 0, s = back.get(c)?.qty || 0, i = iss.get(c)?.qty || 0, f = frac.get(c) || 0;
    m.set(c, { recv: r, sendback: s, issued: i, frac: f, bal: round5(r - s - i + f) });
  }
  return m;
}

/* ยอดคงคลังราย PO (เจ้าของสั่ง 18 พ.ย. 2026) — สูตรเดียวกับ poStockOf ทุกตัว
 * แยกสูตรเมื่อไหร่ หน้าจ่ายออกกับหน้ายอดคงคลังจะบอกยอด PO คนละเลข */
const PO_FIELD = { receive: 'recv', sendback: 'sendback', issue: 'issued' };

/** ยอดของทุก PO เดินสมุดรอบเดียว — Map<po, Map<code, { recv, sendback, issued, bal }>> · รายการไม่ใส่ PO ไม่อยู่ในนี้ */
export function poStocks(entries, entity) {
  need(entity);
  const out = new Map();
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || !(PO_FIELD[e.kind] || isFracAdj(e))) continue;
    const po = String(e.doc_ref || ''), c = String(e.material_code);
    if (!po) continue;
    if (!out.has(po)) out.set(po, new Map());
    const m = out.get(po), r = m.get(c) || { recv: 0, sendback: 0, issued: 0, frac: 0, bal: 0 };
    if (isFracAdj(e)) r.frac = round5(r.frac + signedQty(e));
    else r[PO_FIELD[e.kind]] = round5(r[PO_FIELD[e.kind]] + (e.qty || 0));
    r.bal = round5(r.recv - r.sendback - r.issued + r.frac);
    m.set(c, r);
  }
  return out;
}

/** รายการเคลื่อนไหวของรหัสหนึ่งใน PO หนึ่ง เรียงเก่าไปใหม่ พร้อมคงเหลือสะสม — [{ e, qty, run }] · qty มีเครื่องหมาย */
export function poMoves(entries, entity, docRef, code) {
  const po = String(docRef || ''), c = String(code);
  let run = 0;
  return po ? live(entries, entity)
    .filter(e => (PO_FIELD[e.kind] || isFracAdj(e)) && String(e.doc_ref) === po && String(e.material_code) === c)
    .map(e => { const qty = isFracAdj(e) ? signedQty(e) : e.kind === 'receive' ? e.qty : -e.qty; run = round5(run + qty); return { e, qty, run }; }) : [];
}

/**
 * ล้างเศษของ PO (เจ้าของเคาะ 22 พ.ย. 2026) — คืนรายการปรับยอด "ล้างเศษ" ของรหัสที่คงเหลือ PO เป็นเศษ
 *   เศษ = 0 < |คงเหลือ PO| < tolOf(code) (FRAC_TOL ของหน่วย · core/ledger.js) ทั้งเหลือและติดลบ
 *   เช่น รับ 438 ชิ้น จ่ายตามสูตร 437.10025 → ล้าง −0.89975 · รับ 65 จ่าย 65.005 → ล้าง +0.005
 * แยกเป็นรายการปรับยอดต่างหาก ไม่แก้ยอดจ่าย (เจ้าของเลือกแบบ ก) — ยอดจ่ายยังตรงกับที่คีย์
 * counted_qty = 0 · book = คงเหลือ PO ก่อนล้าง → delta = −เศษ · ยอดรวมของรหัสก็ขยับตามด้วย (เศษนั้นไม่มีอยู่จริง)
 * ผู้เรียกต้องเขียนรายการที่คืนลงสมุดเอง · ไม่มีเศษ = []
 */
export function fracSweep(entries, entity, po, codes, tolOf, { person, device = '', at, part_no = '' } = {}) {
  need(entity);
  const ref = String(po || '');
  if (!ref || typeof tolOf !== 'function') return [];
  const st = poStockOf(entries, entity, ref), out = [];
  for (const c of new Set((codes || []).map(String))) {
    const r = st.get(c), tol = Number(tolOf(c)) || 0;
    // ยังไม่ได้รับเข้าเลย = ไม่ใช่เศษ ห้ามล้าง (กฎเดียวกับ #182 · เจ้าของเคาะ 23 พ.ย. 2026)
    // จ่าย 0.8 ก่อนคีย์รับ → ล้าง +0.8 แล้วพอรับเข้าทีหลัง ยอดที่จ่ายไปจะหายทั้งก้อน
    if (!r || !(r.recv > 0) || !r.bal || Math.abs(r.bal) >= tol) continue;
    out.push(makeEntry({ entity, kind: 'adjust', material_code: c, reason_code: FRAC_REASON,
                         counted_qty: 0, book_qty: r.bal, doc_kind: 'po', doc_ref: ref, part_no, person, device, at,
                         note: `ล้างเศษ PO ${ref}: คงเหลือ ${r.bal} ต่ำกว่าเกณฑ์ ${tol}` }));
  }
  return out;
}

/** รายการล้างเศษที่เกิดพร้อมจ่ายออกรายการนี้ (ยังไม่ยกเลิก) — ยกเลิกจ่ายออกแล้วต้องยกเลิกคู่กัน (เจ้าของเคาะ 23 พ.ย. 2026)
 *  ผูกด้วย PO + รหัส + เวลา: saveOut คิดเวลา (atFrom) ครั้งเดียวต่อการบันทึก แล้วส่งตัวเดียวกันนั้นให้ทุกบรรทัด
 *  และให้ fracSweep จึงเท่ากันทุกตัวอักษร (เรียก atFrom ใหม่ทุกบรรทัดจะได้มิลลิวินาทีต่างกัน แล้วการผูกขาดเงียบ ๆ)
 *  ไม่ต้องเพิ่มช่องในสมุด (E2) */
export function fracTwins(entries, e) {
  if (!e || e.kind !== 'issue' || !e.doc_ref) return [];
  return entries.filter(x => x.entity === e.entity && isFracAdj(x) && !x.voided && x.at === e.at
                             && String(x.doc_ref) === String(e.doc_ref) && String(x.material_code) === String(e.material_code));
}

/** ยังต้องจ่ายอีก = ตามสูตร − จ่ายแล้ว · null ถ้ายังไม่รู้ยอดตามสูตร (ไม่เดาเป็น 0) · ติดลบ = จ่ายเกินสูตรแล้ว */
export function stillToIssue(reqmt, issued) {
  if (reqmt === null || reqmt === undefined || reqmt === '' || !isFinite(Number(reqmt))) return null;
  return round5(Number(reqmt) - (Number(issued) || 0));
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
 *   unknown   มีรายการชนิดที่โปรแกรมรุ่นนี้ไม่รู้จัก ถูกคิดเป็นศูนย์ = ยอดไม่ตรงกับเครื่องอื่นแน่นอน
 *             ขึ้นก่อนทุกข้อ เพราะข้ออื่นคำนวณจากยอดที่ผิดไปแล้ว (ดู unknownKinds ใน ledger.js)
 */
export function oddBalances(entries, entity, { staleDays = 90, now = new Date() } = {}) {
  need(entity);
  const acc = new Map();
  for (const e of entries) {
    if (e.entity !== entity || !counts(e)) continue;
    const c = String(e.material_code);
    const a = acc.get(c) || { code: c, bal: 0, in: 0, out: 0, last: '', unknown: 0 };
    if (!isKnownKind(e.kind)) a.unknown++;
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
    if (a.unknown) why.push(`มี ${a.unknown} รายการที่โปรแกรมรุ่นนี้ไม่รู้จัก — ยอดไม่ตรงกับเครื่องอื่น ต้องโหลดโปรแกรมใหม่`);
    if (a.bal < 0) why.push('ยอดติดลบ');
    if (a.bal !== 0 && a.last && a.last < cutoff) why.push(`ไม่ขยับมา ${staleDays} วัน`);
    if (a.in > 0 && a.out > a.in * 1.5) why.push('จ่ายออกมากกว่าที่เคยรับเข้าผิดปกติ');
    if (why.length) out.push({ ...a, why });
  }
  return out.sort((x, y) => (y.unknown - x.unknown) || (x.bal - y.bal));
}
