/**
 * งานตามวัตถุดิบ — ของขาดรอส่ง · ของเกินรอคืน · ซื้อทดแทนของเสีย
 *
 * ── ทำไมสามเรื่องนี้อยู่ตารางเดียวกัน ──────────────────────────────
 * ทั้งสามเป็น "เรื่องที่เปิดค้างไว้แล้วต้องไล่ให้จบ" เหมือนกันหมด
 * มีวัตถุดิบ · มีจำนวน · มีคนต้องตาม · และมีวันที่ปิดเรื่อง
 * ต่างกันแค่ช่องประกอบไม่กี่ช่อง จึงใช้ kind แยกแทนการทำสามตาราง
 * แบบเดียวกับที่ ledger.js ใช้ kind แยกเจ็ดชนิดในสมุดเล่มเดียว
 *
 * ⚠️ ชื่อตารางในเครื่องกับชื่อชีตยังเป็น shorts / Shorts ตามเดิม
 *    เปลี่ยนไม่ได้ (INVARIANTS E1) และการเปลี่ยนจะทำให้เครื่องที่ยังไม่อัปเดต
 *    มองคนละชีตกับเครื่องที่อัปเดตแล้ว ชื่อที่ไม่ตรงความหมายจึงเป็นราคาที่ยอมจ่าย
 *
 * ── ของที่ไฟล์นี้ไม่ทำ ────────────────────────────────────────────
 * ไม่เขียนลงฐานข้อมูลเอง ไม่แตะหน้าจอ คืนอ็อบเจกต์ให้ผู้เรียกไปบันทึก
 * แบบเดียวกับ core/count.js — เพื่อให้เทสด้วย node ล้วนได้โดยไม่ต้องมีเบราว์เซอร์
 */
import { round5 } from '../core/ledger.js';
import { resolveEntity } from './entities.js';

/** ชนิดของงานตาม · need = ช่องที่ขาดไม่ได้สำหรับชนิดนั้น */
export const FOLLOW_KINDS = {
  short: { label: 'ขาด · รอส่ง',  need: ['po', 'type'] },
  over:  { label: 'เกิน · รอคืน', need: ['po', 'part_no'] },
  buy:   { label: 'ซื้อทดแทน',    need: ['scrap_entry_id'] }
};

/** ของขาดมีสองแบบ — Delta บอกจำนวนที่ขาดมา กับบอกแค่ว่ายังไม่ส่ง */
export const SHORT_TYPES = ['ขาด', 'รอส่ง'];

/** มาจากไหน — แกะจากไฟล์ PO · คีย์เอง · หรือระบบคำนวณให้แล้วคนกดยืนยัน */
export const SOURCES = ['file', 'manual', 'auto'];

const FIELD_LABEL = {
  po: 'PO', type: 'ประเภท (ขาด/รอส่ง)', part_no: 'P/N',
  scrap_entry_id: 'รายการของเสียที่เป็นต้นเหตุ'
};

const txt = v => String(v == null ? '' : v).trim();
const numOrNull = v => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? round5(n) : null;
};

let seq = 0;
/** ⚠️ ต้องไม่ชนกันข้ามเครื่องที่คีย์พร้อมกันโดยไม่มีเน็ต — สูตรเดียวกับ ledger.js */
function newId() {
  seq = (seq + 1) % 1000;
  return 'F' + Date.now().toString(36) + seq.toString(36).padStart(2, '0')
       + Math.random().toString(36).slice(2, 6);
}

/**
 * สร้างเรื่องตามงานใหม่
 *
 * ⚠️ entity ขาดไม่ได้เด็ดขาด (INVARIANTS A3) · ที่นี่ไม่มีค่าตั้งต้นให้โดยตั้งใจ
 *    เพราะการเดาผิดจะทำให้เรื่องไปโผล่ผิดนิติบุคคลแบบเงียบ ๆ
 */
export function makeFollow(input = {}) {
  const kind = txt(input.kind);
  const def = FOLLOW_KINDS[kind];
  if (!def) throw new Error('ไม่รู้จักชนิดของงานตาม: ' + (kind || '(ว่าง)'));

  const entity = txt(input.entity);
  if (!entity) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');

  const code = txt(input.code).toUpperCase();
  if (!code) throw new Error('ต้องระบุรหัสวัตถุดิบ');

  const qty = Number(input.qty);
  if (!isFinite(qty) || qty <= 0) throw new Error('จำนวนต้องมากกว่าศูนย์');

  for (const f of def.need) {
    if (!txt(input[f])) throw new Error(`งานตามแบบ "${def.label}" ต้องระบุ${FIELD_LABEL[f] || f}`);
  }
  if (kind === 'short' && SHORT_TYPES.indexOf(txt(input.type)) < 0) {
    throw new Error('ประเภทของขาดต้องเป็น "ขาด" หรือ "รอส่ง" เท่านั้น');
  }

  const now = txt(input.now) || new Date().toISOString();
  return {
    id: txt(input.id) || newId(),
    entity, kind, code,
    source: SOURCES.indexOf(txt(input.source)) >= 0 ? txt(input.source) : 'manual',
    date: txt(input.date) || now.slice(0, 10),
    po: txt(input.po),
    type: kind === 'short' ? txt(input.type) : '',
    eta: txt(input.eta),
    part_no: txt(input.part_no),
    unit: txt(input.unit),
    qty: round5(qty),
    done_qty: 0,
    done: false,
    /* ⚠️ สามตัวนี้ "แช่แข็ง" ไว้ตั้งแต่ตอนคนกดตั้งเรื่อง ไม่คิดใหม่ตอนอ่าน
     *    เหมือนที่ ledger.js แช่แข็ง delta ของการปรับยอด
     *    ถ้าคิดใหม่ตอนอ่าน ใบรับเข้าที่คีย์ทีหลังจะทำให้ยอดของการคืนที่เกิดไปแล้วขยับเอง */
    order_qty: numOrNull(input.order_qty),
    bom_qty: numOrNull(input.bom_qty),
    recv_qty: numOrNull(input.recv_qty),
    return_entry_id: '', receive_entry_id: '',
    scrap_entry_id: txt(input.scrap_entry_id),
    next_po: txt(input.next_po),
    note: txt(input.note),
    created_at: now, created_by: txt(input.by),
    done_at: '', done_by: '',
    updated_at: now,
    voided: false, void_reason: '', void_by: '', void_at: ''
  };
}

/** ยอดที่ยังค้างอยู่ของเรื่องนี้ */
export function remainOf(row) {
  const q = Number(row && row.qty) || 0;
  const d = Number(row && row.done_qty) || 0;
  return round5(Math.max(0, q - d));
}

/**
 * สถานะของเรื่อง — คิดสดทุกครั้ง ไม่เก็บเป็นข้อความ
 *
 * ⚠️ status ที่เก็บไว้คือแหล่งความจริงที่สอง ซึ่งวันหนึ่งจะขัดกับตัวแรก
 *    แล้วไม่มีใครรู้ว่าควรเชื่ออันไหน
 *
 * ⚠️ แถวเก่าที่แกะจากไฟล์ PO มี qty เป็น 0 ได้ (Delta บอกแค่ว่ายังไม่ส่ง ไม่บอกจำนวน)
 *    จึงห้ามใช้ "ค้างเหลือ 0 = จบแล้ว" กับแถวพวกนั้น ไม่งั้นของขาดทั้งกองจะกลายเป็นเสร็จหมด
 */
export function statusOf(row) {
  if (!row) return 'open';
  if (row.voided) return 'cancelled';
  if (row.done) return 'done';
  const q = Number(row.qty) || 0;
  const d = Number(row.done_qty) || 0;
  if (q > 0 && d >= q) return 'done';
  return d > 0 ? 'partial' : 'open';
}

/** ยังไม่จบและเลยวันที่ Delta นัดไว้ — เกณฑ์เดียวกับที่ v1 ใช้ระบายแดง */
export function overdue(row, today) {
  if (!row || !txt(row.eta) || !txt(today)) return false;
  const st = statusOf(row);
  if (st !== 'open' && st !== 'partial') return false;
  return txt(row.eta) < txt(today);
}

/**
 * ปิดเรื่อง — ปิดทั้งใบ หรือปิดบางส่วนเมื่อของทยอยมา
 *
 * ไม่ส่ง qty มา = ปิดทั้งใบ (เคสปกติที่กดปุ่มเดียวจบ)
 */
export function closeFollow(row, { qty, by = '', at } = {}) {
  if (!row) throw new Error('ไม่มีรายการให้ปิด');
  if (row.voided) throw new Error('รายการนี้ถูกยกเลิกไปแล้ว ปิดไม่ได้');
  const now = txt(at) || new Date().toISOString();
  const remain = remainOf(row);

  let add;
  if (qty === undefined || qty === null || qty === '') {
    add = remain;
  } else {
    add = Number(qty);
    if (!isFinite(add) || add <= 0) throw new Error('จำนวนที่ปิดต้องมากกว่าศูนย์');
    // ปัดก่อนเทียบ ไม่งั้นเศษ float ทำให้ปิดยอดที่เหลือพอดีไม่ผ่าน
    if (Number(row.qty) > 0 && round5(add) > remain) {
      throw new Error(`ปิดได้ไม่เกินยอดที่ค้างอยู่ (${remain})`);
    }
  }

  const done_qty = round5((Number(row.done_qty) || 0) + add);
  const q = Number(row.qty) || 0;
  return { ...row, done_qty, done: q > 0 ? done_qty >= q : true,
           done_at: now, done_by: txt(by), updated_at: now };
}

/**
 * เปิดเรื่องกลับมาใหม่ — ใช้ตอนกดผิดใบ
 *
 * ⚠️ ล้างยอดที่ปิดไปแล้วทิ้งทั้งหมด เพราะ "ยังไม่จบ" ที่มียอดปิดค้างครึ่งทาง
 *    อ่านแล้วไม่รู้ว่าตกลงของมาถึงเท่าไหร่แล้ว · อยากได้ครึ่งทางให้ปิดใหม่เป็นยอดที่ถูก
 */
export function reopenFollow(row, { at } = {}) {
  if (!row) throw new Error('ไม่มีรายการให้เปิดใหม่');
  const now = txt(at) || new Date().toISOString();
  return { ...row, done: false, done_qty: 0, done_at: '', done_by: '', updated_at: now };
}

/** ยกเลิกเรื่อง — ไม่ลบทิ้ง (INVARIANTS B1) แบบเดียวกับ voidEntry ของสมุด */
export function voidFollow(row, { by, reason } = {}) {
  if (!row) throw new Error('ไม่มีรายการให้ยกเลิก');
  if (!txt(reason)) throw new Error('ยกเลิกต้องบอกเหตุผล');
  if (!txt(by)) throw new Error('ยกเลิกต้องบอกว่าใครยกเลิก');
  const now = new Date().toISOString();
  return { ...row, voided: true, void_reason: txt(reason), void_by: txt(by),
           void_at: now, updated_at: now };
}

/**
 * ซ่อมแถวเก่าให้มีช่องที่โครงใหม่ต้องใช้
 *
 * ⚠️ ต้องเรียกได้ซ้ำโดยได้ผลเดิม และต้อง "คืนแถวเดิมทั้งตัว" เมื่อไม่มีอะไรต้องเติม
 *    ผู้เรียกใช้การเทียบตัวตน (!==) ตัดสินว่าจะเขียนลงฐานข้อมูลไหม
 *    ถ้าคืนอ็อบเจกต์ใหม่ทุกครั้ง ทุกแถวจะติดธง dirty แล้วถูกส่งขึ้นเซิร์ฟเวอร์ใหม่ทุกครั้งที่เปิดโปรแกรม
 *
 * ⚠️ entity เติมให้เฉพาะเมื่อ "รู้จริง" คือไฟล์ PO บอกมาเอง (from === 'po')
 *    ห้ามใช้ค่าที่เดาจากรหัส PO หรือค่าที่เลือกค้างอยู่บนจอ
 *    ความผิดพลาดของ A3 เงียบเสมอ — เดาผิดแล้วแถวจะหายไปจากนิติบุคคลที่เป็นเจ้าของ
 *    และไปโผล่ในที่ที่ไม่ใช่ โดยไม่มีอะไรบอก · ว่างแล้วเห็น ดีกว่าผิดแล้วไม่เห็น
 */
export function migrateFollow(row, { poList = [], now } = {}) {
  if (!row || typeof row !== 'object') return row;
  const patch = {};

  if (!FOLLOW_KINDS[row.kind]) patch.kind = 'short';
  if (SOURCES.indexOf(row.source) < 0) patch.source = 'file';

  if (row.done_qty == null || !isFinite(Number(row.done_qty))) {
    patch.done_qty = row.done ? (Number(row.qty) || 0) : 0;
  }

  // แถวเก่าไม่มีเวลาสร้างเลยสักช่อง — ใช้วันที่ที่ไฟล์ PO บอกไว้เป็นหลักฐานที่ใกล้ที่สุดที่มี
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))
    ? row.date + 'T00:00:00.000Z'
    : (txt(now) || new Date().toISOString());
  if (!txt(row.created_at)) patch.created_at = stamp;
  if (!txt(row.updated_at)) patch.updated_at = stamp;

  if (!txt(row.entity)) {
    const got = resolveEntity(row.po, { poList });
    if (got.from === 'po' && got.code) patch.entity = got.code;
  }

  return Object.keys(patch).length ? { ...row, ...patch } : row;
}

/** ซ่อมทั้งกอง — คืนเฉพาะแถวที่เปลี่ยนจริง ให้ผู้เรียกเอาไปเขียนลงฐานข้อมูล */
export function migrateAll(rows, opts = {}) {
  const out = [], changed = [];
  for (const r of rows || []) {
    const m = migrateFollow(r, opts);
    out.push(m);
    if (m !== r) changed.push(m);
  }
  return { rows: out, changed };
}
