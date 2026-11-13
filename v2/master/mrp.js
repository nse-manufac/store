/**
 * MRP ราย PO — PO แต่ละใบรับวัตถุดิบครบตาม BOM × จำนวนสั่งแล้วหรือยัง (เจ้าของสั่ง 12 พ.ย. 2026)
 *
 * ── เทียบอะไรกับอะไร ─────────────────────────────────────────────
 *   ต้องใช้ = ต่อชิ้นในสูตร × จำนวนสั่งของใบ
 *   รับแล้ว = รับเข้าด้วยเลข PO นี้ − ส่งคืน Delta ตาม PO นี้ (ตัวเดียวกับ shortAll / overAll)
 *             **ไม่หักยอดจ่าย** (เจ้าของเคาะ)
 *   Short = รับแล้ว < ต้องใช้ · นับทุกยอดที่ขาด (SHORT_MIN = 0 แบบการ์ด short)
 *           ยอดขาดที่ "จบเรื่องแล้ว" (ปิดเรื่องตรงยอด · ยกเลิกเรื่อง · ไม่ติดตาม) = skip นับว่าครบ
 *           กฎเดียวกับการ์ด "ยังรับไม่ครบตาม BOM" (shortSettled)
 *   Over  = รับเกินตั้งแต่ OVER_MIN แบบการ์ด over (เจ้าของเคาะ) · เกินไม่ถึงเกณฑ์ = ครบ
 *           รหัสที่รับเข้ามาแต่ไม่อยู่ในสูตรของใบ = extra นับเป็น Over (เจ้าของเคาะ)
 *
 * ── ใบไหนขึ้น (เจ้าของเคาะ 13 พ.ย. 2026) ─────────────────────────
 *   ใบที่คิด = ใบในไฟล์ PO (posVisible) + ใบที่มีรับเข้าแต่ยังไม่ได้นำเข้าไฟล์ (ขึ้นแบบคิดไม่ได้)
 *   มีข้อมูลจากโปรแกรม plan (plan = planMap(...)) → plan เป็นคนตัดสิน ไม่สนวันที่:
 *     ใบที่ plan รู้จัก = ขึ้นทุกใบ · ส่งครบแล้ว = จบ (done) จอซ่อนไว้ใต้ "แสดง PO ที่จบแล้ว"
 *     ใบที่ไม่มีใน plan: มีรับเข้าแล้ว = ขึ้นพร้อม notInPlan (ไม่หายเงียบ) · ยังไม่รับ = ไม่ขึ้น
 *       plan บอกอะไรใบนี้ไม่ได้ → ใช้กฎ freshDays วันกับใบนี้ (เก่ากว่า = จบ · เจ้าของเคาะ 14 พ.ย. 2026)
 *     ⚠️ ใบที่มีใน plan แต่ไม่อยู่ในไฟล์ PO ของนิติบุคคลนี้และยังไม่รับ ไม่ขึ้น — plan ไม่บอกว่าเป็นของนิติบุคคลไหน (A3)
 *   ยังไม่มีข้อมูลจาก plan (plan = null) → กฎ freshDays วัน (เจ้าของเคาะ 90 วัน · 13 พ.ย. 2026):
 *     ใบที่วันที่ PO เก่ากว่า freshDays วัน = จบ (done) ไม่ว่าจะรับแล้วหรือยัง — จอซ่อนไว้ใต้ "แสดง PO ที่จบแล้ว"
 *     ใบที่ไม่มีวันที่ ขึ้นพร้อม noDate ให้เติมวันที่ได้ (fillPoDate) — ไม่ตัดทิ้งเงียบ (ผู้ตรวจ #156 ข้อ 3 · เจ้าของเคาะ)
 *     ใบที่ไม่อยู่ในไฟล์ PO รู้อายุไม่ได้ ขึ้นแบบคิดไม่ได้ ไม่จบ
 *   เรียง: ใบใหม่สุดขึ้นก่อน — WK มากไปน้อย → วันที่ใหม่ไปเก่า → เลข PO → P/N (เจ้าของสั่ง 14 พ.ย. 2026)
 *     ไม่มี WK / ไม่มีวันที่ ไปท้าย
 *   WK: ของ plan ก่อน · plan ไม่มี = WK จากเลขล็อตตอนรับเข้า (W45 · W-45 · WK 45) ที่เจอบ่อยสุดในใบ
 *     (weekFrom = 'lot' · เจ้าของเคาะ 14 พ.ย. 2026) — เรียงปนกับ WK ของ plan ตามปกติ
 *   รหัสในใบเรียงตามหมวดในทะเบียน (ลำดับ CATEGORIES: CORE → WIRE → TAPE …) แล้วตามรหัส (เจ้าของเคาะ 13 พ.ย. 2026)
 *     — ระบบไม่ได้เก็บลำดับบรรทัดของ BOM (id = pn|code เรียงตามรหัส) เรียงตามรหัสล้วนแล้วหมวดสลับกันจนงง
 *     รหัสที่ไม่มีหมวด / หมวดที่ไม่รู้จัก ไปท้ายกลุ่ม · รหัสนอกสูตรยังอยู่ท้ายตารางเหมือนเดิม
 *   จบ (done) = plan บอกว่าส่งลูกค้าครบแล้ว (เจ้าของเคาะ 13 พ.ย. 2026) — ไม่ดูยอดจ่ายแล้ว
 *     ซ่อนบนจอจนกว่าจะติ๊กดู · ยังไม่มีข้อมูล plan = ใบที่ PO เก่ากว่า freshDays วัน (ข้างบน)
 *     issued ของแต่ละรหัส (จ่าย − คืนของ ที่อ้าง PO นี้) ยังคิดไว้ แต่ไม่ใช้ตัดสินจบและจอไม่แสดง
 *
 * ⚠️ สูตรที่มีรหัสเดียวกันหลายบรรทัด ใช้บรรทัดแรกที่ต่อชิ้นมากกว่า 0 (บรรทัดที่ใช้ 0 ข้าม)
 *    — ต่างจาก bomIndex.usageOf ที่การ์ด over ใช้ (บรรทัดแรกเสมอ แม้ใช้ 0) · ผลตรงกันเมื่อบรรทัดแรกใช้มากกว่า 0
 *    (ผู้ตรวจ #156 รอบ 2 ข้อ 1 — การ์ด over จะตามหรือไม่ เจ้าของตัดสินเป็นใบแยก)
 * ⚠️ ห้ามกรองนิติบุคคลของรายการด้วยอย่างอื่นนอกจาก e.entity === entity (A3)
 *    เรื่องติดตามใช้ sameEntity (เรื่องที่ยังไม่มีเจ้าของนับให้ทุกนิติบุคคล — แบบการ์ด short)
 */
import { round5 } from '../core/ledger.js';
import { shortWhyOf, shortSettled, sameEntity, OVER_MIN } from './follow.js';
import { poHeaderIndex } from './po-kit.js';
import { CATEGORIES } from './materials.js';

export const MRP_FRESH_DAYS = 90;

const txt = v => String(v == null ? '' : v).trim();
const codeKey = c => txt(c).toUpperCase();
const pairKey = (po, code) => txt(po) + '|' + codeKey(code);

/** วันที่ (YYYY-MM-DD) ถอยหลัง n วัน — คิดแบบ UTC ล้วน ไม่ให้เวลาเครื่องทำวันเลื่อน */
function daysBefore(date, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(date));
  if (!m) return '';
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) - n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * คืน [{ po, pn, week, date, order, why, none, notInPlan, lines, nShort, nOver, nSkip, state, done }]
 *   lines = [{ code, usage, need, have, issued, diff, state }]
 *     state: ok · short · skip (ขาดแต่จบเรื่องแล้ว) · over · extra (ไม่อยู่ในสูตร) · zero (สูตรใช้ 0) · na (ใบคิดไม่ได้)
 *   noDate = ใบในไฟล์ PO ที่ไม่มีวันที่ — จอให้เติมวันที่ได้
 *   state ของใบ: short (มี Short) · over (มี Over ไม่มี Short) · ok · na (คิดไม่ได้ — why บอกเหตุ)
 *
 * poList = รายการ PO ที่นิติบุคคลนี้มองเห็น (posVisible) · bomRowsOf(pn) = บรรทัดสูตรที่ยังใช้อยู่
 * today = 'YYYY-MM-DD' ตามเวลาไทย (todayLocal) — ส่งเข้ามาเพื่อเทสได้ · ไม่มี plan ต้องมีเสมอ
 * plan = Map จาก planMap(list) · null = ยังไม่ได้ดึงจาก plan · catOf(code) = หมวดในทะเบียน (ใช้เรียงรหัส)
 * weekFrom = 'plan' · 'lot' · '' (ไม่มี WK)
 */
export function mrpRows(entries, entity, { poList = [], bomRowsOf, follows = [], today = '', plan = null, catOf = () => '',
                                           freshDays = MRP_FRESH_DAYS, overMin = OVER_MIN } = {}) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  if (typeof bomRowsOf !== 'function') throw new Error('ต้องส่ง bomRowsOf เข้ามา');
  // ไม่ส่ง today = ตัดใบทุกใบที่มีวันที่ทิ้งเงียบ ๆ — โยนให้รู้แทน (ผู้ตรวจ #156 รอบ 4 ข้อ 1)
  if (!plan && !/^\d{4}-\d{2}-\d{2}$/.test(txt(today))) throw new Error('ต้องส่ง today (YYYY-MM-DD) — ยังไม่มีข้อมูล plan ต้องใช้กฎ PO ใหม่ใน ' + freshDays + ' วัน');

  // เดินสมุดรอบเดียว
  const got = new Map(), used = new Map(), codesOf = new Map(), started = new Set(), lotWk = new Map();
  for (const e of entries || []) {
    if (!e || e.entity !== entity || e.voided) continue;
    const po = txt(e.doc_ref);
    if (!po) continue;
    const k = pairKey(po, e.material_code), q = Number(e.qty) || 0;
    if (e.kind === 'receive' || e.kind === 'sendback') {
      if (e.kind === 'receive') {
        started.add(po);
        const w = lotWeek(e.lot);
        if (w) { if (!lotWk.has(po)) lotWk.set(po, new Map()); const m = lotWk.get(po); m.set(w, (m.get(w) || 0) + 1); }
      }
      got.set(k, round5((got.get(k) || 0) + (e.kind === 'receive' ? q : -q)));
      if (!codesOf.has(po)) codesOf.set(po, new Set());
      codesOf.get(po).add(codeKey(e.material_code));
    } else if (e.kind === 'issue' || e.kind === 'return') {
      used.set(k, round5((used.get(k) || 0) + (e.kind === 'issue' ? q : -q)));
    }
  }
  const haveOf = k => round5(Math.max(0, got.get(k) || 0));
  const usedOf = k => round5(Math.max(0, used.get(k) || 0));

  const headerOf = poHeaderIndex(poList);
  const settled = shortSettled((follows || []).filter(f => f && sameEntity(f, entity)));
  const since = txt(today) ? daysBefore(today, freshDays) : '';
  const oldPo = head => !!since && !!head && !!txt(head.date) && txt(head.date) < since;
  // WK จากล็อต: ที่เจอบ่อยสุดในใบ · เท่ากัน = เลขน้อยกว่า · คืน [WK, ข้อความบอกที่มา]
  const weekOfLots = po => {
    const m = lotWk.get(po);
    if (!m) return ['', ''];
    const all = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return ['WK' + all[0][0], 'จากล็อตรับเข้า: ' + all.map(([w, n]) => 'WK' + w + ' ×' + n).join(' · ')];
  };
  const catRank = c => { const i = CATEGORIES.indexOf(txt(catOf(c)).toUpperCase()); return i < 0 ? CATEGORIES.length : i; };
  const codeCmp = (a, b) => catRank(a) - catRank(b) || a.localeCompare(b);
  const planOf = po => (plan ? plan.get(txt(po).toUpperCase()) || null : null);

  const cand = new Set(started);
  for (const p of poList || []) { const po = txt(p && p.po); if (po) cand.add(po); }
  const pos = [];
  for (const po of cand) {
    if (plan) {
      const p = planOf(po);
      if (p || started.has(po)) pos.push(po);   // ส่งครบแล้ว = จบ (ซ่อนที่จอ) · ไม่มีใน plan ขึ้นเฉพาะใบที่รับแล้ว
    } else {
      pos.push(po);   // ไม่มี plan: ทุกใบขึ้น · ใบที่เก่ากว่า freshDays วัน = จบ (ดู done ข้างล่าง · เจ้าของเคาะ)
    }
  }

  const out = [];
  for (const po of pos) {
    const head = headerOf(po), p = planOf(po);
    const [lw, lwRaw] = p && txt(p.week) ? ['', ''] : weekOfLots(po);
    const row = { po, pn: head ? txt(head.pn) : '',
                  week: p && txt(p.week) ? txt(p.week) : lw, weekRaw: p && txt(p.week) ? txt(p.weekRaw) : lwRaw,
                  weekFrom: p && txt(p.week) ? 'plan' : lw ? 'lot' : '',
                  date: head ? head.date : '',
                  order: head ? head.order || 0 : 0, notInPlan: !!plan && !p,
                  why: '', none: !started.has(po), lines: [], nShort: 0, nOver: 0, nSkip: 0, state: 'ok',
                  done: p ? !(p.left > 0)     // จบ = plan บอกว่าส่งครบ
                          : oldPo(head) };    // plan บอกไม่ได้ (ไม่มี plan / ไม่มีใน plan) = เก่ากว่า freshDays วัน
    row.noDate = !!head && !txt(row.date);   // ใบที่ไม่อยู่ในไฟล์ PO เติมวันที่ไม่ได้ — ต้องนำเข้าไฟล์ก่อน
    row.why = shortWhyOf(po, { headerOf, bomRowsOf });
    if (row.why) {
      row.state = 'na';
      for (const c of [...(codesOf.get(po) || [])].sort(codeCmp)) {
        const k = pairKey(po, c);
        row.lines.push({ code: c, usage: null, need: null, have: haveOf(k), issued: usedOf(k), diff: null, state: 'na' });
      }
      out.push(row);
      continue;
    }
    const seen = new Set(), zero = new Set();
    for (const b of bomRowsOf(row.pn) || []) {
      const usage = Number(b && b.usage) || 0, code = codeKey(b && b.code);
      if (!code || seen.has(code)) continue;
      if (usage <= 0) { zero.add(code); continue; }   // อยู่ในสูตรแต่ใช้ 0 — รับเข้ามาเมื่อไหร่ขึ้นแบบ zero
      seen.add(code);
      const k = pairKey(po, code);
      const need = round5(usage * row.order), have = haveOf(k), issued = usedOf(k), diff = round5(have - need);
      let state = 'ok';
      if (diff < 0) state = settled(po, code, -diff) ? 'skip' : 'short';
      else if (diff >= overMin) state = 'over';
      row.lines.push({ code, usage, need, have, issued, diff, state });
    }
    row.lines.sort((a, b) => codeCmp(a.code, b.code));
    for (const c of [...(codesOf.get(po) || [])].sort(codeCmp)) {
      if (seen.has(c)) continue;
      const k = pairKey(po, c), have = haveOf(k);
      if (!(have > 0)) continue;           // รับแล้วส่งคืนหมด = ไม่มีอะไรค้าง
      // ใช้ 0 ในสูตร = นับเป็น Over เหมือนกัน (overAll ให้ over = ยอดรับ) แต่ป้ายต้องไม่บอกว่า "ไม่อยู่ใน BOM" (ผู้ตรวจ #156 ข้อ 4)
      const z = zero.has(c);
      row.lines.push({ code: c, usage: z ? 0 : null, need: z ? 0 : null, have, issued: usedOf(k), diff: have, state: z ? 'zero' : 'extra' });
    }
    row.nShort = row.lines.filter(l => l.state === 'short').length;
    row.nOver = row.lines.filter(l => l.state === 'over' || l.state === 'extra' || l.state === 'zero').length;
    row.nSkip = row.lines.filter(l => l.state === 'skip').length;
    row.state = row.nShort ? 'short' : row.nOver ? 'over' : 'ok';
    out.push(row);
  }
  out.sort(mrpOrder);
  return out;
}

/**
 * เรียงแถว: ใบใหม่สุดขึ้นก่อน (เจ้าของสั่ง 14 พ.ย. 2026)
 *   WK มากไปน้อย → วันที่ PO ใหม่ไปเก่า → เลข PO น้อยไปมาก → P/N · ค่าว่างไปท้าย · WK เทียบแบบตัวเลข (WK10 ก่อน WK9)
 * ⚠️ WK เทียบแค่เลขสัปดาห์ — ช่วงข้ามปี WK1 ของปีใหม่จะไปอยู่ล่าง WK52 ของปีก่อน
 */
export function mrpOrder(a, b) {
  const blankLast = (x, y, cmp) => (!x && !y ? 0 : !x ? 1 : !y ? -1 : cmp(x, y));
  const num = (x, y) => x.localeCompare(y, 'en', { numeric: true, sensitivity: 'base' });
  const desc = (x, y) => num(y, x);
  return blankLast(txt(a.week), txt(b.week), desc) || blankLast(txt(a.date), txt(b.date), desc)
    || num(txt(a.po), txt(b.po)) || num(txt(a.pn), txt(b.pn));
}

/**
 * สถานะส่งของจากโปรแกรม plan (เจ้าของสั่ง 13 พ.ย. 2026) — คืนรายการราย PO [{ po, week, qty, shipped, left }]
 * orders / records = แถวจากตาราง Orders / Records ของ plan (pullRows ของ Apps Script ฝั่ง plan)
 *   ส่งแล้ว = ผลรวม Records ขั้น 'shipping' ที่ไม่ยกเลิก ของ order นั้น (buildCumMap ของ plan)
 *   เหลือส่ง = Σ ต่อแถว max(0, orderQty − ส่งแล้ว) (wipBalance ของ plan) — PO เดียวมีหลาย P/N ได้ ครบทุกแถวถึงนับว่าส่งครบ
 *   ใบที่ยกเลิกใน plan ไม่นับ (activeOrders ของ plan)
 * ⚠️ ผูกกับชื่อคอลัมน์ของ plan: Orders.id · poNo · week · orderQty · voided · Records.orderId · process · qty · voided
 *    และ id ขั้น 'shipping' ซึ่ง plan ล็อกไว้ห้ามเปลี่ยน (LOCKED_PROCESS_IDS) — plan เปลี่ยนชื่อพวกนี้เมื่อไหร่ ต้องแก้ที่นี่ด้วย
 */
export function planShipList(orders, records) {
  const voided = v => v === true || String(v).toUpperCase() === 'TRUE';
  const shipped = new Map();
  for (const r of records || []) {
    if (!r || voided(r.voided) || txt(r.process) !== 'shipping') continue;
    const id = txt(r.orderId);
    shipped.set(id, round5((shipped.get(id) || 0) + (Number(r.qty) || 0)));
  }
  const byPo = new Map();
  for (const o of orders || []) {
    if (!o || voided(o.voided)) continue;
    const po = txt(o.poNo);
    if (!po) continue;
    const key = po.toUpperCase(), qty = Number(o.orderQty) || 0, s = shipped.get(txt(o.id)) || 0;
    const cur = byPo.get(key) || { po, week: '', weekRaw: '', qty: 0, shipped: 0, left: 0 };
    cur.qty = round5(cur.qty + qty);
    cur.shipped = round5(cur.shipped + s);
    cur.left = round5(cur.left + Math.max(0, qty - s));
    if (!cur.week && txt(o.week)) { cur.week = planWeek(o.week); cur.weekRaw = txt(o.week); }
    byPo.set(key, cur);
  }
  return [...byPo.values()];
}

/**
 * WK ของ plan เป็นชื่อชีตของไฟล์แผน เช่น "Plan WK 31  1-4.6. 26" หรือ "WK 25  6-9.4.26" (หน้าตาแบบเดียวกับข้อมูลจริง 13 พ.ย. 2026 · ตัวอย่างนี้แต่งขึ้น)
 * ตัดเหลือ "WK31" ให้จออ่านง่ายและเรียงเป็นตัวเลขได้ — ไม่มีคำว่า WK = ใช้ข้อความเดิม
 */
export function planWeek(raw) {
  const m = /WK\s*0*(\d{1,2})(?!\d)/i.exec(txt(raw));
  return m ? 'WK' + m[1] : txt(raw);
}

/**
 * WK จากเลขล็อตตอนรับเข้า — ล็อตที่พนักงานพิมพ์เป็นสัปดาห์ เช่น "W45" "W-45" "WK 45" "wk09" → 45 / 9
 * ล็อตแบบอื่น (วันที่รับเข้าที่ระบบเติมให้ · เลขล็อตของผู้ขาย) = null · รับ 1–53 เท่านั้น
 */
export function lotWeek(lot) {
  const m = /^WK?[\s-]*0*(\d{1,2})$/i.exec(txt(lot));
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 53 ? n : null;
}

/** รายการจาก planShipList (หรือที่เก็บไว้ในเครื่อง) → Map ที่ mrpRows ใช้ · กุญแจ = PO ตัดช่องว่าง ตัวพิมพ์ใหญ่ */
export function planMap(list) {
  if (!Array.isArray(list)) return null;
  const m = new Map();
  for (const p of list) if (p && txt(p.po)) m.set(txt(p.po).toUpperCase(), p);
  return m;
}

/** นับใบตามตัวกรองบนจอ — PO ทั้งหมด · ครบ · มี Short · มี Over · คิดไม่ได้ */
export const MRP_FILTERS = {
  all: () => true,
  ok: r => r.state === 'ok',
  short: r => r.nShort > 0,
  over: r => r.nOver > 0,
  na: r => r.state === 'na'
};

/** ปุ่มตัวกรองบนจอ — ลำดับ · ชื่อ · สีจุด */
export const MRP_SEG = [
  { k: 'all', label: 'ทั้งหมด', dot: '' },
  { k: 'ok', label: 'ครบ', dot: 'ok' },
  { k: 'short', label: 'มี Short', dot: 'bad' },
  { k: 'over', label: 'มี Over', dot: 'warn' },
  { k: 'na', label: 'คิดไม่ได้', dot: 'na' }
];

/** ตัวเลขบนจอ — คั่นหลักพัน ทศนิยมไม่เกินสี่ตำแหน่ง · ไม่มีค่า = — */
export const mrpNum = n => (n == null || !isFinite(Number(n)) ? '—'
  : round5(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 4 }));

/** ป้ายสถานะของรหัสหนึ่งในตาราง BOM — คืน [ข้อความ, คลาสสี] */
export function mrpLineLabel(l) {
  if (!l) return ['', 'mute'];
  if (l.state === 'ok') return ['ครบ', 'ok'];
  if (l.state === 'short') return ['Short ' + mrpNum(-l.diff), 'bad'];
  if (l.state === 'over') return ['Over ' + mrpNum(l.diff), 'warn'];
  if (l.state === 'skip') return ['ขาด ' + mrpNum(-l.diff) + ' · จบเรื่องแล้ว', 'mute'];
  if (l.state === 'extra') return ['ไม่อยู่ใน BOM · Over ' + mrpNum(l.have), 'warn'];
  if (l.state === 'zero') return ['BOM ใช้ 0 · Over ' + mrpNum(l.have), 'warn'];
  return ['', 'mute'];
}

/**
 * จ่ายออกที่ไม่ได้ใส่เลข PO ของนิติบุคคลนี้กี่รายการ — นับให้ใบไหนไม่ได้ ใบที่ใช้ของนั้นจึงอาจค้างไม่ "จบ"
 * จอขึ้นป้ายบอกเหตุ (ผู้ตรวจ #156 ข้อ 1 · เจ้าของเคาะ — แบบเดียวกับที่ #155 มี)
 */
export function mrpNoPoIssues(entries, entity) {
  if (!txt(entity)) return 0;
  let n = 0;
  for (const e of entries || []) {
    if (e && e.entity === entity && !e.voided && e.kind === 'issue' && !txt(e.doc_ref)) n++;
  }
  return n;
}

/**
 * เติมวันที่ให้ใบในไฟล์ PO ที่ไม่มีวันที่ (เจ้าของเคาะ 12 พ.ย. 2026) — แก้ในที่ คืนแถวที่แก้
 * แก้เฉพาะแถวของ PO นั้นที่ยังไม่มีวันที่ · ใบที่มีวันที่อยู่แล้วไม่แตะ (ไม่ใช่ช่องแก้วันที่)
 * date ต้องเป็น YYYY-MM-DD ที่มีจริง ไม่งั้นโยนพร้อมบอกว่าต้องใส่แบบไหน (G3)
 * ⚠️ ติด dirty ให้ด้วย — ตัวซิงค์หาแถวที่ต้องส่งจาก dirty บนอ็อบเจกต์ในหน่วยความจำ
 */
export function fillPoDate(poList, po, date) {
  const d = txt(date), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const real = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === d;
  if (!real) throw new Error('วันที่ไม่ถูกต้อง — เลือกจากปฏิทิน หรือพิมพ์แบบ 2026-11-12');
  const key = txt(po), out = [];
  for (const p of poList || []) {
    if (!p || txt(p.po) !== key || txt(p.date)) continue;
    p.date = d; p.dirty = true; out.push(p);
  }
  return out;
}

/** ค้นด้วยเลข PO · P/N · WK · รหัสวัตถุดิบ (ตัวพิมพ์เล็กใหญ่ไม่มีผล) */
export function mrpMatch(row, q) {
  const s = txt(q).toUpperCase();
  if (!s) return true;
  return row.po.toUpperCase().includes(s) || row.pn.toUpperCase().includes(s)
    || txt(row.week).toUpperCase().includes(s)
    || row.lines.some(l => l.code.includes(s));
}
