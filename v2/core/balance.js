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
import { atFrom, localDate } from './localtime.js';

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
 *   เช่น รับ 438 ชิ้น จ่ายตามสูตร 437.10025 → ล้าง −0.89975
 *   ฝั่งติดลบ เช่น รับ 65 จ่าย 65.005 → ล้าง +0.005 — ตั้งแต่ 25 พ.ย. 2026 จ่ายเกินคงเหลือ PO ไม่ได้แล้ว (A4 · overIssue)
 *   จึงเหลือแค่จากรายการเก่าก่อนวันนั้น หรือทางอื่นที่ยังตัดของได้โดยไม่บล็อก เช่นส่งคืน Delta หลังจ่ายไปแล้ว
 * แยกเป็นรายการปรับยอดต่างหาก ไม่แก้ยอดจ่าย (เจ้าของเลือกแบบ ก) — ยอดจ่ายยังตรงกับที่คีย์
 * counted_qty = 0 · book = คงเหลือ PO ก่อนล้าง → delta = −เศษ · ยอดรวมของรหัสก็ขยับตามด้วย (เศษนั้นไม่มีอยู่จริง)
 * ผู้เรียกต้องเขียนรายการที่คืนลงสมุดเอง · ไม่มีเศษ = []
 * at ของรายการล้างเศษไม่เก่ากว่าใบจ่ายออกใบล่าสุดของ PO + รหัสนั้น (lastIssueAt) — ผู้ตรวจ #198 ข้อสังเกต 1
 *   คีย์จ่ายย้อนหลังก่อนใบที่มีอยู่แล้ว → ล้างเศษที่เวลาใบล่าสุดแทนเวลาที่คีย์ย้อน ไม่งั้น fracTwins ของใบล่าสุดผูกคู่ไม่เจอ
 *   ยกเลิกใบนั้นทีหลัง รายการ −เศษ ค้าง ยอด PO ขาดไปเท่าเศษเงียบ ๆ · ด่านอยู่ที่นี่ที่เดียว ครอบทุกทางที่เรียก
 */
export function fracSweep(entries, entity, po, codes, tolOf, by = {}) {
  need(entity);
  const ref = String(po || '');
  if (!ref || typeof tolOf !== 'function') return [];
  const st = poStockOf(entries, entity, ref), seen = fracSeen(entries, entity), out = [];
  for (const c of new Set((codes || []).map(String))) {
    const r = st.get(c), tol = Number(tolOf(c)) || 0;
    if (!isFracLeft(r, tol)) continue;
    const floor = lastIssueAt(entries, entity, ref, c);
    const at = by.at && floor && String(by.at) < floor ? floor : by.at;
    out.push(fracEntry(entity, { po: ref, code: c, bal: r.bal, tol }, { ...by, at }, seen));
  }
  return out;
}

/** ยอดของ PO+รหัส (แถวจาก poStockOf / poStocks) เป็นเศษจากสูตรไหม — 0 < |คงเหลือ| < เกณฑ์ของหน่วย
 *  ยังไม่ได้รับเข้าเลย = ไม่ใช่เศษ (กฎเดียวกับ #182 · เจ้าของเคาะ 23 พ.ย. 2026)
 *  จ่าย 0.8 ก่อนคีย์รับ → ล้าง +0.8 แล้วพอรับเข้าทีหลัง ยอดที่จ่ายไปจะหายทั้งก้อน
 *  ตัวเดียวกับที่ใช้ตัดสินปุ่ม "ล้างเศษ" ในรายการเคลื่อนไหวหน้ายอดคงคลัง — แยกกันเมื่อไหร่ ปุ่มขึ้นแต่กดแล้วไม่ล้าง */
export function isFracLeft(r, tol) {
  return !!r && r.recv > 0 && !!r.bal && Math.abs(r.bal) < (Number(tol) || 0);
}

/* เลขรายการล้างเศษ: คู่ PO+รหัสเดียวกันในสถานะเดียวกันได้เลขเดียวกันเสมอ
 *   สองเครื่องกดล้างพร้อมกันก่อนซิงค์ → ซิงค์แล้วรวมเป็นรายการเดียว ไม่หักซ้อน
 *   n = จำนวนรายการล้างเศษของคู่นี้ที่มีอยู่แล้ว (รวมที่ยกเลิก) → ยกเลิกแล้วล้างใหม่ได้เลขใหม่ ไม่ทับประวัติ (B1)
 *   คั่นด้วย | ไม่ใช่ - เพราะเลข PO / รหัสอาจมีขีด แล้วสองคู่ต่างกันจะได้เลขเดียวกัน (ผู้ตรวจ #186) */
function fracSeen(entries, entity) {
  const m = new Map();
  for (const e of entries) if (e.entity === entity && isFracAdj(e)) {
    const k = String(e.doc_ref) + '|' + String(e.material_code);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function fracEntry(entity, { po, code, bal, tol }, { person, device = '', at, part_no = '' }, seen) {
  return makeEntry({ id: `FRAC|${entity}|${po}|${code}|${seen.get(po + '|' + code) || 0}`,
                     entity, kind: 'adjust', material_code: code, reason_code: FRAC_REASON,
                     counted_qty: 0, book_qty: bal, doc_kind: 'po', doc_ref: po, part_no, person, device, at,
                     note: `ล้างเศษ PO ${po}: คงเหลือ ${bal} ต่ำกว่าเกณฑ์ ${tol}` });
}

/**
 * เวลา at ของใบจ่ายออกที่ยังไม่ยกเลิก ใบล่าสุดของ PO + รหัสนั้น — '' ถ้ายังไม่มีใบจ่าย
 * = พื้นเวลาที่รายการล้างเศษของคู่นี้ต้องไม่เก่ากว่า เพราะ fracTwins ผูกคู่ด้วย String(x.at) >= String(e.at)
 * ล้างเศษที่ at เก่ากว่าใบจ่าย → ยกเลิกใบจ่ายแล้วรายการ −เศษ ค้างอยู่ ยอด PO ขาดไปเท่าเศษเงียบ ๆ
 * (คงเหลือที่ค้างเกินเกณฑ์ ป้าย "เศษ" จึงไม่ขึ้นให้ใครเห็นอีก · ผู้ตรวจ #198 รอบ 1)
 * ทุกทางที่ให้คนเลือกวันที่ล้างเศษเองต้องเทียบกับค่านี้ก่อนบันทึก — ห้ามแก้ fracTwins แทน (CLAUDE.md ข้อ 7)
 */
export function lastIssueAt(entries, entity, po, code) {
  need(entity);
  const ref = String(po || ''), c = String(code);
  if (!ref) return '';
  let max = '';
  for (const e of entries) {
    if (e.entity !== entity || !counts(e) || e.kind !== 'issue') continue;
    if (String(e.doc_ref) !== ref || String(e.material_code) !== c) continue;
    const at = String(e.at || '');
    if (at > max) max = at;
  }
  return max;
}

/**
 * เวลา at ของรายการล้างเศษจากกล่องที่ให้คนเลือกวันที่เอง — คืน { at } หรือ { err } (ข้อความแดง)
 * floor = lastIssueAt ของ PO + รหัสนั้น ('' = ยังไม่มีใบจ่าย ไม่มีพื้น)
 *   - วันที่เลือกอยู่ก่อนวันของใบจ่ายล่าสุด → err (ล้างย้อนข้ามใบจ่ายไม่ได้)
 *   - วันเดียวกับใบจ่าย แต่ atFrom ยืมเวลาในวันจากนาฬิกาตอนกด ซึ่งย้อนกว่าเวลาในใบที่คีย์ย้อนหลังไว้
 *     → at = floor ขยับแค่เวลาในวัน วันที่ที่บันทึกยังเป็นวันที่คนเลือก ไม่ใช่การเปลี่ยนวันเงียบ ๆ
 * แยกออกมาจาก bpFracClean ให้เทสด้วยการรันจริงได้ (ผู้ตรวจ #198 ข้อสังเกต 2)
 */
export function fracCleanAt(date, floor, now = new Date()) {
  let at = atFrom(date, now);
  if (floor && at < floor) {
    if (localDate(at) !== localDate(floor))
      return { err: `ล้างเศษย้อนหลังก่อนวันที่จ่ายออกครั้งล่าสุด (${localDate(floor)}) ไม่ได้ — เลือกวันที่ตั้งแต่วันนั้นขึ้นไป` };
    at = floor;
  }
  return { at };
}

/** รายการล้างเศษของ PO + รหัสเดียวกันที่ทำตั้งแต่จ่ายออกรายการนี้เป็นต้นไป (ยังไม่ยกเลิก)
 *  ยกเลิกจ่ายออกแล้วต้องยกเลิกพวกนี้ด้วย (เจ้าของเคาะ 23 + 25 พ.ย. 2026)
 *  เศษที่ล้างหลังจ่ายรายการนี้ คิดจากยอดที่รวมรายการนี้อยู่ — จ่ายหายไปแล้วเศษนั้นก็ไม่มีจริง
 *  ถ้าเก็บไว้ ยอด PO กับยอดรวมจะขาดไปเท่าเศษเงียบ ๆ (ยอดที่เหลือเกินเกณฑ์ ไม่มีป้ายเศษให้เห็น)
 *    - ล้างพร้อมจ่าย: saveOut ส่ง at ตัวเดียวกับใบจ่าย → เวลาเท่ากัน
 *    - ล้างจากปุ่มทีหลัง: เวลาที่กด → หลังใบจ่าย (ผู้ตรวจ #186 รอบ 2)
 *    - ล้างก่อนจ่ายรายการนี้ = เศษของยอดที่ไม่มีรายการนี้ ไม่แตะ
 *  ยกเลิกแล้วถ้ายังเหลือเศษจริง ป้าย "เศษ" กับปุ่มจะกลับมาเอง · ไม่ต้องเพิ่มช่องในสมุด (E2) */
export function fracTwins(entries, e) {
  if (!e || e.kind !== 'issue' || !e.doc_ref) return [];
  return entries.filter(x => x.entity === e.entity && isFracAdj(x) && !x.voided && String(x.at) >= String(e.at)
                             && String(x.doc_ref) === String(e.doc_ref) && String(x.material_code) === String(e.material_code));
}

/** ยังต้องจ่ายอีก = ตามสูตร − จ่ายแล้ว · null ถ้ายังไม่รู้ยอดตามสูตร (ไม่เดาเป็น 0) · ติดลบ = จ่ายเกินสูตรแล้ว */
export function stillToIssue(reqmt, issued) {
  if (reqmt === null || reqmt === undefined || reqmt === '' || !isFinite(Number(reqmt))) return null;
  return round5(Number(reqmt) - (Number(issued) || 0));
}

/**
 * รหัสที่จะจ่ายเกินของที่มี — หน้าจ่ายออกห้ามบันทึกถ้ามีสักรหัส (INVARIANTS A4 · เจ้าของสั่ง 25 พ.ย. 2026)
 * ของมาแล้วต้องคีย์รับเข้าก่อน ไม่ใช่จ่ายไปก่อนแล้วตามคีย์รับทีหลัง
 * lines = [{code, qty}] · balOf(code) = ยอดที่มี (ของ PO บนหัวจอ หรือยอดรวมถ้าไม่ใส่ PO)
 * รหัสเดียวกันหลายบรรทัดรวมยอดก่อนเทียบ — แยกบรรทัดแล้วผ่านทีละบรรทัดไม่ได้
 * คืน [{code, bal, qty, short}] · ว่าง = จ่ายได้
 */
export function overIssue(lines, balOf, key = c => String(c || '').trim().toUpperCase()) {
  const sum = new Map();
  for (const l of lines) {
    const q = Number(l.qty) || 0;
    if (!l.code || q <= 0) continue;
    const k = key(l.code), cur = sum.get(k);
    sum.set(k, { code: cur ? cur.code : l.code, qty: round5((cur ? cur.qty : 0) + q) });
  }
  const out = [];
  for (const { code, qty } of sum.values()) {
    const bal = round5(Number(balOf(code)) || 0), short = round5(qty - bal);
    if (short > 0) out.push({ code, bal, qty, short });
  }
  return out;
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
