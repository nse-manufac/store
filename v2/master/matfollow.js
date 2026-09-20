/**
 * อ่านไฟล์ MAT'L FOLLOWING ของ Delta — ใบแจ้งยอดขาด/เกินรายสัปดาห์
 *
 * ไฟล์นี้คือ "ความจริงฝั่ง Delta" ว่าแต่ละ PO ส่งของมาครบไหม
 * หนึ่งชีตต่อหนึ่งแอดมินของ Delta (`H-M5` `H-M4` `H-M1` `U`) หัวตารางอยู่แถวที่ 2
 *
 *   DATE | P/O | PN | CODE | DES. | P/O(จำนวนสั่ง) | ACTUAL(ส่งจริง) | VAR. | (หมายเหตุ) | หมายเหตุ
 *
 * VAR = จำนวนสั่ง − ส่งจริง · **บวก = ของขาด · ลบ = ของเกิน**
 *
 * ⚠️ กับดักสามข้อที่ไฟล์จริงมี และทุกข้อพังแบบเงียบถ้าไม่ดัก
 *   1. ปีในช่องวันที่เป็น พ.ศ. สองหลัก (69) — Excel เก็บเป็น ค.ศ. 1969 ผิดไป 57 ปี
 *   2. คอลัมน์ที่เก้าหัวเขียนว่า "P/O DATE" แต่ข้างในเป็นหมายเหตุอิสระ ไม่มีวันที่สักช่อง
 *   3. รหัส PN/CODE เก็บเป็นตัวเลข ศูนย์นำหน้าหายตั้งแต่ในไฟล์ · ต้องอ่านเป็นข้อความเสมอ
 *
 * ตรรกะล้วน ไม่แตะฐานข้อมูล ไม่แตะหน้าจอ — คืนอ็อบเจกต์ให้ผู้เรียกไปบันทึก
 */
import { round5 } from '../core/ledger.js';
import { entityOfPo } from './entities.js';
import { makeFollow, statusOf, remainOf } from './follow.js';

const txt = v => String(v == null ? '' : v).trim();
const pad = n => String(n).padStart(2, '0');

/** ตัวเลขในไฟล์ของ Delta มีทั้ง 1,929 และ 1929 — ต้องอ่านได้ทั้งคู่ */
export function numOf(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = txt(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/**
 * วันที่ในไฟล์ → `YYYY-MM-DD` ตามปฏิทินสากล
 *
 * ⚠️ คนกรอกพิมพ์ปี พ.ศ. สองหลัก (29/7/69) Excel จึงเก็บเป็น ค.ศ. 1969
 *    อ่านตรง ๆ ทุกแถวจะลงปี 1969 ทั้งกระดาน — ยอดถูกแต่วันที่ผิดหมด
 *    รับทั้งค่าที่เป็น Date (cellDates) · serial ของ Excel · และข้อความ
 */
export function matDate(v) {
  let y, m, d;
  if (v instanceof Date && !isNaN(v)) {
    /* ⚠️ สองข้อในบรรทัดเดียว ทั้งคู่ทำให้ทั้งไฟล์เลื่อนไปหนึ่งวันแบบไม่มีอะไรฟ้อง
     *  1. ต้องอ่านด้วยตัวอ่าน "เวลาท้องถิ่น" ไม่ใช่ UTC — xlsx สร้าง Date ตามเขตเวลาของเครื่อง
     *  2. ค่าที่ xlsx คืนมาไม่ได้ตรงเที่ยงคืน · เซลล์ที่แสดง 29/7 ได้ Date เป็น
     *     28/7 เวลา 23:59:56 (เศษจากการแปลง serial) — อ่านตรง ๆ ได้วันที่ 28
     *     จึงปัดเป็นนาทีที่ใกล้ที่สุดก่อน แล้วค่อยอ่านวัน
     * เจอจริงตอนเปิดเบราว์เซอร์ทดสอบ · เทสที่รันด้วย node ล้วนจับไม่ได้ */
    const t = new Date(Math.round(v.getTime() / 60000) * 60000);
    y = t.getFullYear(); m = t.getMonth() + 1; d = t.getDate();
  } else if (typeof v === 'number' && isFinite(v) && v > 0) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    const s = txt(v);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
    if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
    else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; if (y < 100) y += y > 50 ? 1900 : 2000; }
    else return '';
  }
  if (y > 2400) y -= 543;          // พิมพ์ พ.ศ. สี่หลักมาเต็ม ๆ
  else if (y < 2000) y += 57;      // Excel อ่าน พ.ศ. สองหลักเป็น ค.ศ. 19xx
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
  return y + '-' + pad(m) + '-' + pad(d);
}

/**
 * แกะช่องหมายเหตุ — ช่องเดียวแต่ใส่มาสามแบบ
 *   `Over 13,618`      ย้ำยอดเกิน (ตรงกับ VAR ที่ติดลบ) — ใช้ตรวจทานกันได้
 *   `Cut Return 1929`  **มีของเกินจาก PO ใบก่อนมาหักแล้ว** ยอดขาดจริงจึงน้อยกว่า VAR
 *   อย่างอื่น           เลขเอกสาร/ล็อต หรือข้อความอิสระ — เก็บไว้เป็นหมายเหตุเฉย ๆ
 *
 * ⚠️ เอาเฉพาะเลขที่อยู่ **ถัดจากคำสำคัญ** ห้ามหยิบเลขตัวแรกที่เจอในช่อง
 *    เพราะสามแบบนี้ปนกันในเซลล์เดียวได้ (`TM7001A Cut Return 500`) ถ้าหยิบตัวแรก
 *    เลขเอกสารจะถูกเอาไปหักออกจาก VAR แทนยอดจริง แล้วพังเงียบสองทาง —
 *    เลขใหญ่กว่า VAR ทำให้แถวของขาดหายไปทั้งแถว · เลขเล็กกว่าทำให้ไปทวง Delta เกินจริง
 *    มีคำสำคัญแต่ไม่มีเลขตามหลัง = null (ไม่ใช่ศูนย์) คือไม่หักอะไรเลย
 */
export function readNote(s) {
  const note = txt(s);
  const cutM = /cut\s*return\s*:?\s*(-?[\d,.]+)/i.exec(note);
  const overM = /^over\b\s*:?\s*(-?[\d,.]+)/i.exec(note);
  return { cut: cutM ? numOf(cutM[1]) : null, over: overM ? numOf(overM[1]) : null, text: note };
}

/**
 * แปลงหนึ่งแถวของไฟล์เป็นงานตามหนึ่งเรื่อง — คืน null ถ้าแถวนั้นไม่ใช่งานที่ต้องตาม
 *
 * ⚠️ ยอดขาดที่ใช้จริงคือ **VAR − Cut Return** ไม่ใช่ VAR ดิบ
 *    Cut Return คือของเกินจาก PO ใบก่อนที่เอามาใช้แล้ว ถ้าไม่หักจะไปทวง Delta เกินจริง
 */
export function rowToFollow(row, { sheet = '' } = {}) {
  const po = txt(row[1]);
  const code = txt(row[3]).toUpperCase();
  const order = numOf(row[5]);
  const actual = numOf(row[6]);
  const varQty = numOf(row[7]);
  if (!po || !code) return null;
  if (varQty === null) return null;

  const note = readNote(row[8]);
  const kind = varQty > 0 ? 'short' : varQty < 0 ? 'over' : '';
  if (!kind) return null;                       // ส่งมาพอดี ไม่มีอะไรต้องตาม

  const qty = kind === 'short'
    ? round5(varQty - (note.cut || 0))
    : round5(-varQty);
  if (!(qty > 0)) return null;                  // หัก cut return แล้วไม่เหลือของขาด

  const extra = [note.text, txt(row[9])].filter(Boolean).join(' · ');
  return {
    sheet, admin: sheet.includes('-') ? sheet.split('-')[1] : '',
    entity: entityOfPo(po),
    date: matDate(row[0]),
    po, code, part_no: txt(row[2]), desc: txt(row[4]),
    order, actual, var_qty: varQty,
    cut_return: note.cut, over_note: note.over,
    kind, qty, note: extra
  };
}

/** ไฟล์ทั้งเล่ม — book = { ชื่อชีต: แถวแบบ array of array } */
export function parseMatFollow(book = {}) {
  const rows = [];
  const skipped = [];
  for (const [sheet, aoa] of Object.entries(book)) {
    (aoa || []).forEach((raw, i) => {
      if (i < 2 || !raw || !raw.some(c => txt(c))) return;   // แถว 1 เป็นหัวเรื่อง แถว 2 เป็นหัวตาราง
      const hit = rowToFollow(raw, { sheet });
      if (hit) rows.push(hit);
      else if (txt(raw[1])) skipped.push({ sheet, line: i + 1, po: txt(raw[1]), why: whySkipped(raw) });
    });
  }
  return { rows, skipped };
}

function whySkipped(raw) {
  if (!txt(raw[3])) return 'ไม่มีรหัสวัตถุดิบ';
  const v = numOf(raw[7]);
  if (v === null) return 'ช่อง VAR. ว่างหรืออ่านเป็นตัวเลขไม่ได้';
  if (v === 0) return 'ส่งมาพอดี ไม่มีของขาดหรือของเกิน';
  const { cut } = readNote(raw[8]);
  if (v > 0 && cut) return `หัก Cut Return ${cut} แล้วไม่เหลือของขาด`;
  return 'ไม่เข้าเงื่อนไขของงานตาม';
}

export const matKey = r => txt(r.entity) + '|' + txt(r.po) + '|' + txt(r.code).toUpperCase() + '|' + txt(r.kind);

/**
 * เทียบของในไฟล์กับเรื่องที่มีอยู่ — คืนแผนว่าจะสร้าง/อัปเดต/อะไรหายไป
 *
 * ⚠️ "ทับของเก่า" หมายถึงทับตัวเลข **ไม่ใช่ทับความคืบหน้า** (เจ้าของสั่ง 20 ก.ย. 2026)
 *    แถวที่พนักงานปิดบางส่วนไปแล้วต้องเก็บ done_qty ไว้ และถ้ายอดใหม่ต่ำกว่าที่ปิดไปแล้ว
 *    ให้ถือว่าปิดครบ ไม่ใช่ทำให้ยอดค้างติดลบ
 *
 * ⚠️ จับคู่ด้วย นิติบุคคล+PO+รหัส+ชนิด **ไม่ดูว่ามาจากไหน**
 *    เครื่องรุ่นเก่าเขียน source ทับเป็น 'file' ได้ตอน migrate ถ้าไปจับคู่ด้วย source
 *    ของเดิมจะกลายเป็นคนละแถวแล้วเกิดเรื่องซ้ำสองใบของ PO เดียวกัน
 */
export function dedupeMatRows(parsed = []) {
  /* ⚠️ ไฟล์อาจเป็นแบบ "ต่อท้ายไปเรื่อย ๆ" ไม่ใช่แบบส่งใหม่ทั้งใบ (เจ้าของยังไม่แน่ใจ 20 ก.ย. 2026)
   * ถ้าต่อท้าย คู่ PO+รหัสเดิมจะโผล่ได้หลายแถว โดยแถวหลังคือยอดที่แก้แล้ว
   * เอาแถวที่วันที่ใหม่สุดไว้ · วันที่เท่ากันเอาแถวล่างสุด (คนพิมพ์ต่อท้ายลงไปเรื่อย ๆ)
   * จับแถวแรกไว้จะได้ยอดเก่าค้างอยู่ทั้งที่ Delta แก้มาแล้ว — ผิดแบบเงียบสนิท */
  const keep = new Map();
  (parsed || []).forEach((r, i) => {
    const k = matKey(r);
    const cur = keep.get(k);
    if (!cur || txt(r.date) > txt(cur.row.date) || (txt(r.date) === txt(cur.row.date) && i > cur.i)) {
      keep.set(k, { row: r, i });
    }
  });
  return { rows: [...keep.values()].sort((a, b) => a.i - b.i).map(x => x.row),
           dropped: (parsed || []).length - keep.size };
}

export function planMatFollow(input, existing = [], { now = '', by = '' } = {}) {
  const { rows: parsed, dropped } = dedupeMatRows(input);
  const live = (existing || []).filter(r => r && !r.voided && (r.kind === 'short' || r.kind === 'over'));
  const byKey = new Map();
  for (const r of live) {
    const k = matKey(r);
    if (!byKey.has(k)) byKey.set(k, r);          // ถ้าซ้ำ ใช้ใบแรกที่เจอ ใบที่เหลือไปโผล่ในรายการซ้ำ
  }

  const create = [], update = [], same = [];
  const seen = new Set();
  for (const p of parsed) {
    const k = matKey(p);
    seen.add(k);
    const cur = byKey.get(k);
    const fields = {
      qty: p.qty, date: p.date, part_no: p.part_no, note: p.note,
      order_qty: p.order, recv_qty: p.actual
    };
    if (!cur) {
      create.push({ row: p, rec: makeFollow({
        kind: p.kind, entity: p.entity, source: 'delta',
        code: p.code, po: p.po, part_no: p.part_no,
        type: p.kind === 'short' ? 'ขาด' : '',
        qty: p.qty, date: p.date, note: p.note,
        order_qty: p.order, recv_qty: p.actual,
        by, now
      }) });
      continue;
    }
    const done = round5(Number(cur.done_qty) || 0);
    const changed = round5(Number(cur.qty) || 0) !== round5(p.qty)
      || txt(cur.note) !== txt(p.note)
      || (numOf(cur.order_qty) ?? null) !== (p.order ?? null)
      || (numOf(cur.recv_qty) ?? null) !== (p.actual ?? null);
    if (!changed) { same.push({ row: p, cur }); continue; }
    const rec = { ...cur, ...fields, done_qty: done,
                  done: round5(p.qty) > 0 ? done >= round5(p.qty) : true,
                  updated_at: txt(now) || new Date().toISOString() };
    update.push({ row: p, cur, rec, wasDone: !!cur.done, nowDone: rec.done });
  }

  /**
   * เรื่องที่ยังเปิดอยู่แต่ไม่อยู่ในไฟล์รอบนี้ — **บอกเฉย ๆ ไม่ลบให้ ไม่ปิดให้**
   *
   * ⚠️ ดูเฉพาะนิติบุคคลที่มีอยู่ในไฟล์รอบนี้เท่านั้น
   *    Delta ส่งมาทีละชีต และบางรอบอาจส่งมาไม่ครบทุกโรงงาน
   *    ถ้าไม่จำกัดขอบเขต รอบที่ส่งมาแค่ฝั่งเดียว จะประกาศว่าอีกฝั่ง "หายจากไฟล์" ทั้งกอง
   */
  const ents = new Set(parsed.map(p => txt(p.entity)).filter(Boolean));
  const gone = live.filter(r => ents.has(txt(r.entity)) && !seen.has(matKey(r)) && statusOf(r) !== 'done')
                   .map(r => ({ cur: r, remain: remainOf(r), source: txt(r.source) || 'manual' }));

  return { create, update, same, gone, dropped, entities: [...ents].sort() };
}
