/**
 * งานตามวัตถุดิบ — ของขาดรอส่ง · ของเกินรอคืน · ซื้อทดแทนของเสีย
 *
 * ── ทำไมสามเรื่องนี้อยู่ตารางเดียวกัน ──────────────────────────────
 * ทั้งสามเป็น "เรื่องที่เปิดค้างไว้แล้วต้องไล่ให้จบ" เหมือนกันหมด
 * มีวัตถุดิบ · มีจำนวน · มีคนต้องตาม · และมีวันที่ปิดเรื่อง
 * ต่างกันแค่ช่องประกอบไม่กี่ช่อง จึงใช้ kind แยกแทนการทำสามตาราง
 * แบบเดียวกับที่ ledger.js ใช้ kind แยกแปดชนิดในสมุดเล่มเดียว
 *
 * ⚠️ ชื่อตารางในเครื่องกับชื่อชีตยังเป็น shorts / Shorts ตามเดิม
 *    เปลี่ยนไม่ได้ (INVARIANTS E1) และการเปลี่ยนจะทำให้เครื่องที่ยังไม่อัปเดต
 *    มองคนละชีตกับเครื่องที่อัปเดตแล้ว ชื่อที่ไม่ตรงความหมายจึงเป็นราคาที่ยอมจ่าย
 *
 * ── ของที่ไฟล์นี้ไม่ทำ ────────────────────────────────────────────
 * ไม่เขียนลงฐานข้อมูลเอง ไม่แตะหน้าจอ คืนอ็อบเจกต์ให้ผู้เรียกไปบันทึก
 * แบบเดียวกับ core/count.js — เพื่อให้เทสด้วย node ล้วนได้โดยไม่ต้องมีเบราว์เซอร์
 */
import { round5, makeEntry } from '../core/ledger.js';
import { resolveEntity, entityOfPo } from './entities.js';

/** ชนิดของงานตาม · need = ช่องที่ขาดไม่ได้สำหรับชนิดนั้น */
export const FOLLOW_KINDS = {
  short: { label: 'ขาด · รอส่ง',  need: ['po', 'type'] },
  over:  { label: 'เกิน · รอคืน', need: ['po', 'part_no'] },
  buy:   { label: 'ซื้อทดแทน',    need: ['scrap_entry_id'] }
};

/** ของขาดมีสองแบบ — Delta บอกจำนวนที่ขาดมา กับบอกแค่ว่ายังไม่ส่ง */
export const SHORT_TYPES = ['ขาด', 'รอส่ง'];

/** มาจากไหน — แกะจากไฟล์ PO · คีย์เอง · หรือระบบคำนวณให้แล้วคนกดยืนยัน */
/* 'delta' = มาจากไฟล์ MAT'L FOLLOWING ที่ Delta ส่งมา · ต่อท้ายเท่านั้น
 * ⚠️ migrateFollow เขียน source ที่ไม่รู้จักทับเป็น 'file' — เครื่องรุ่นเก่าจึงลบป้ายนี้ทิ้งได้
 *    การจับคู่ตอนนำเข้าซ้ำจึงห้ามพึ่ง source (ดู planMatFollow ของ matfollow.js) */
export const SOURCES = ['file', 'manual', 'auto', 'delta'];

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

  // ซื้อทดแทนที่คีย์เอง (ไม่ได้มาจากของเสีย) ไม่มีรายการของเสียให้ผูก — เจ้าของเคาะ 2 ต.ค. 2026
  // ⚠️ ยกเว้นเฉพาะ source 'manual' · เรื่องที่ระบบตั้งจากของเสีย (auto) ยังต้องผูกเสมอ ไม่งั้นตั้งซ้ำได้ไม่รู้ตัว
  const skipNeed = kind === 'buy' && txt(input.source) === 'manual';
  for (const f of skipNeed ? [] : def.need) {
    if (!txt(input[f])) throw new Error(`งานตามแบบ "${def.label}" ต้องระบุ ${FIELD_LABEL[f] || f}`);
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
    // ใบสั่งซื้อทดแทน (FM-PU-02) ที่เรื่องนี้ถูกใส่ไปแล้ว — ว่าง = ยังไม่ได้ออกใบ (เจ้าของเคาะ 2 ต.ค. 2026)
    pr_no: txt(input.pr_no), pr_date: txt(input.pr_date),
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
  /* ⚠️ ปัดทั้งสองฝั่งก่อนเทียบ (A2) — ยอดที่วิ่งผ่านชีตกลับมาอาจเป็น 0.30000000000000004
   *    เทียบค่าดิบแล้ว done_qty 0.3 จะไม่ถึง qty ไปตลอดกาล แถวค้างเป็น "เหลือ 0" ปิดไม่ลงทั้งสองทาง */
  const q = round5(Number(row.qty) || 0);
  const d = round5(Number(row.done_qty) || 0);
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
 *
 * `doneAt` = วันที่ของงานจริง (คนเลือกเอง คีย์ย้อนหลังได้) ลงเฉพาะ `done_at`
 * ⚠️ `updated_at` ห้ามถอยหลังตาม — เป็นเวลาที่ชั้นซิงค์ใช้ตัดสินว่าของใครใหม่กว่า
 *    ถอยหลังแล้วการแก้นี้จะถูกเครื่องอื่นมองข้ามตลอดไป (INVARIANTS D5)
 */
export function closeFollow(row, { qty, by = '', at, doneAt } = {}) {
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
  // ⚠️ qty ต้องปัดด้วย — done_qty ปัดแล้ว ถ้า qty ยังดิบ การปิดยอดที่เหลือพอดีจะไม่ติด done
  const q = round5(Number(row.qty) || 0);
  return { ...row, done_qty, done: q > 0 ? done_qty >= q : true,
           done_at: txt(doneAt) || now, done_by: txt(by), updated_at: now };
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
 * ⚠️ entity เติมให้เฉพาะเมื่อ "รู้จริง" คือเลขที่ PO บอกได้ และรหัสนั้นมีในทะเบียน
 *    (from === 'guess') · ห้ามใช้ค่าที่เลือกค้างอยู่บนจอ
 *    และห้ามใช้รหัสที่ยังไม่มีในทะเบียน เพราะไม่มีใครเลือกรหัสนั้นได้
 *    เติมไปแล้วแถวจะหายจากทุกจอ ส่วนแถวที่ว่างยังขึ้นให้ทุกนิติบุคคลเห็น
 *
 *    เดิมเติมจากคอลัมน์ผู้รับเหมาในไฟล์ PO — เลิกใช้แล้ว เจ้าของยืนยัน 19 ก.ย. 2026
 *    ว่า Delta กรอกมาไม่ตรงเป็นบางใบ · ความผิดพลาดของ A3 เงียบเสมอ
 *    เติมผิดแล้วแถวจะหายไปจากนิติบุคคลที่เป็นเจ้าของ โดยไม่มีอะไรบอก
 */
export function migrateFollow(row, { known = null, now } = {}) {
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
    // ไม่ส่งทะเบียนมา = ไม่รู้ว่ารหัสไหนเลือกได้ = ไม่เติม (known || [] ทำให้ทุกรหัสเป็น unregistered)
    const got = resolveEntity(row.po, { known: known || [] });
    if (got.from === 'guess' && got.code) patch.entity = got.code;
  }

  return Object.keys(patch).length ? { ...row, ...patch } : row;
}

/**
 * กรองนิติบุคคลของกองงานตาม
 *
 * ⚠️ แถวที่ยังไม่มี entity ต้องเห็นในทุกนิติบุคคล ไม่ใช่ถูกกรองหาย
 *    มันเป็นงานของใครคนหนึ่งแน่ ๆ แค่ยังไม่รู้ว่าใคร ซ่อนแล้วจะไม่มีใครมาเลือกให้เลย
 *
 * ⚠️ ยังไม่ได้เลือกนิติบุคคล = เห็นได้แค่แถวที่ยังไม่มีเจ้าของ
 *    ห้ามแปลว่า "ไม่กรอง" เพราะนั่นคือการโชว์ยอดข้ามนิติบุคคล ซึ่งเป็นอาการของ A3 ที่เงียบที่สุด
 */
const sameEntity = (row, entity) =>
  entity ? (!row.entity || row.entity === entity) : !row.entity;

const matchKind = (row, kind) => !kind || row.kind === kind;

/**
 * แถวที่หน้าจอจะแสดง — เรียงของที่เลยกำหนดขึ้นก่อน แล้วไล่ตาม ETA ที่ใกล้ที่สุด
 *
 * ⚠️ อยู่ในไฟล์นี้ ไม่ใช่ใน app.js เพราะการกรองนิติบุคคล (A3) เป็นกฎที่พังแล้วเงียบที่สุด
 *    และตรรกะที่เทสแตะไม่ถึง คือตรรกะที่คนถัดไปแก้แล้วไม่มีอะไรฟ้อง
 *
 * ⚠️ ต้องกรอง kind ด้วย · ตารางนี้เก็บงานตามสามแบบในกองเดียว
 *    ไม่กรองแล้วเรื่องของเกิน/ซื้อทดแทนจะไหลมาโผล่ในหน้าของขาด
 */
export function listFollow(rows, { kind = '', entity = '', q = '',
                                   showDone = false, today = '', limit = 0 } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = (rows || []).filter(s => {
    if (!matchKind(s, kind)) return false;
    if (!sameEntity(s, entity)) return false;
    const st = statusOf(s);
    if (st === 'cancelled') return false;
    if (!showDone && st === 'done') return false;
    if (!needle) return true;
    return [s.po, s.code, s.note].join(' ').toLowerCase().includes(needle);
  }).map(s => ({ s, st: statusOf(s), late: overdue(s, today), remain: remainOf(s) }));

  out.sort((a, b) => (Number(b.late) - Number(a.late))
    || String(a.s.eta || '9999-99-99').localeCompare(String(b.s.eta || '9999-99-99'))
    || String(a.s.date || '').localeCompare(String(b.s.date || '')));
  return limit > 0 ? out.slice(0, limit) : out;
}

/** เรื่องที่ยังต้องตามของนิติบุคคลนี้ — ตัวเลขที่ขึ้นหน้าแรก */
export function openFollow(rows, { kind = '', entity = '' } = {}) {
  return (rows || []).filter(s => {
    if (!matchKind(s, kind)) return false;
    if (!sameEntity(s, entity)) return false;
    const st = statusOf(s);
    return st === 'open' || st === 'partial';
  });
}

/**
 * แถวที่ยังไม่รู้ว่าเป็นของนิติบุคคลไหน
 *
 * ⚠️ เอาแค่ที่ยังต้องตาม · เรื่องที่ปิดจบไปแล้วไม่มีใครต้องมาเลือกนิติบุคคลให้อีก
 *    ปล่อยไว้จะค้างในแถบเตือนของทุกนิติบุคคลตลอดไป แล้วคนจะเลิกอ่านแถบนั้น
 */
export function orphanFollow(rows, { kind = '' } = {}) {
  return (rows || []).filter(s => {
    if (s.entity) return false;
    if (!matchKind(s, kind)) return false;
    const st = statusOf(s);
    return st === 'open' || st === 'partial';
  });
}

/** สามตัวเลขบนหัวหน้าจอ */
export function sumFollow(rows, { today = '' } = {}) {
  const list = rows || [];
  return {
    open: list.filter(s => statusOf(s) === 'open').length,
    partial: list.filter(s => statusOf(s) === 'partial').length,
    late: list.filter(s => overdue(s, today)).length
  };
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

/* ══════════ ของเกินรอคืน (Mat Follow up 6/8) ══════════ */

/**
 * ค่าเผื่อ — ต่ำกว่านี้ไม่นับว่าเกิน (เจ้าของเคาะไว้ตอนออกแบบ)
 * ⚠️ ค่าเดียวใช้ทุกหมวด · ถ้าวันหนึ่งเคมี (กก.) กับเทป (ชิ้น) ต้องใช้คนละเกณฑ์
 *    แก้ที่นี่ที่เดียวให้เป็นรายหมวด อย่าไปกระจายเกณฑ์ไว้ตามหน้าจอ
 */
export const OVER_MIN = 1;

const pairKey = (po, code) => txt(po) + '|' + txt(code).toUpperCase();

/**
 * ของเกินของนิติบุคคลนี้ — คิดสดจากสมุด ไม่เก็บ
 *
 *   เกิน = รับเข้าตามใบนี้ − ส่งคืน Delta ตามใบนี้ − (ต่อชิ้น × จำนวนสั่งของใบนี้)
 *
 * ⚠️ ต้องหักยอดที่คืนไปแล้ว ไม่งั้นรายการเดิมโผล่กลับมาทุกครั้งที่เปิดจอ
 *    แล้วจะมีคนกดคืนซ้ำ — ซึ่งตัดสต็อกจริงรอบที่สอง
 *
 * ⚠️ usageOf ต้องคืน "ตัวเลขต่อชิ้น" ตรง ๆ (หรือ null ถ้าไม่มีในสูตร)
 *    ห้ามส่ง byPn() ของ bom.js เข้ามา — ตัวนั้นคืนอ็อบเจกต์ทั้งแถว คูณแล้วได้ NaN เงียบ ๆ
 *    (กับดักเดิมของตัวคิดยอดเกินรุ่นแรกใน balance.js ซึ่งลบทิ้งไปแล้วในใบ 8)
 *
 * ⚠️ คู่ที่คำนวณไม่ได้ต้องคืนออกมาด้วย พร้อมเหตุผลใน why
 *    ถ้าเงียบไปเลย PO พวกนั้นจะหายจากจอโดยไม่มีใครรู้ว่าตกหล่น
 *
 * คืน [{ po, pn, code, recv, sentBack, bom_qty, over, order, why }] เรียงตาม PO แล้วรหัส
 */
export function overAll(entries, entity, { headerOf, usageOf, min = OVER_MIN } = {}) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  if (typeof headerOf !== 'function') throw new Error('ต้องส่ง headerOf เข้ามา');
  if (typeof usageOf !== 'function') throw new Error('ต้องส่ง usageOf เข้ามา');

  /* เดินสมุดรอบเดียวแล้วเก็บเป็น Map — ถ้าเรียก movedOfDoc ทีละใบ
   * จะเดินสมุดทั้งเล่มซ้ำทุก PO และหน้านี้คิดใหม่ทุกครั้งที่จอรีเฟรช
   * เงื่อนไขการนับต้องตรงกับ movedOfDoc ของ balance.js เป๊ะ (มีเทสยืนยันไว้) */
  const recvOf = new Map(), backOf = new Map();
  for (const e of entries || []) {
    if (!e || e.entity !== entity || e.voided) continue;
    if (e.kind !== 'receive' && e.kind !== 'sendback') continue;
    const po = txt(e.doc_ref);
    if (!po) continue;
    const k = pairKey(po, e.material_code);
    const box = e.kind === 'receive' ? recvOf : backOf;
    box.set(k, round5((box.get(k) || 0) + (Number(e.qty) || 0)));
  }

  const out = [];
  for (const [k, recv] of recvOf) {
    const [po, code] = k.split('|');
    const sentBack = backOf.get(k) || 0;
    const head = headerOf(po);
    const pn = head ? txt(head.pn) : '';
    const order = head ? Number(head.order) || 0 : 0;
    const row = { po, pn, code, recv: round5(recv), sentBack: round5(sentBack),
                  bom_qty: null, over: null, order, why: '' };

    if (!head || !pn) { row.why = 'ยังไม่รู้ P/N ของใบนี้'; out.push(row); continue; }
    if (!order)       { row.why = 'ยังไม่รู้จำนวนสั่งของใบนี้'; out.push(row); continue; }

    const usage = usageOf(pn, code);
    if (usage == null || !isFinite(Number(usage))) {
      row.why = 'ไม่มีรหัสนี้ในสูตรของ ' + pn;
      out.push(row); continue;
    }

    row.bom_qty = round5(Number(usage) * order);
    row.over = round5(recv - sentBack - row.bom_qty);
    if (row.over >= min) out.push(row);
  }

  out.sort((a, b) => String(a.po).localeCompare(String(b.po))
                  || String(a.code).localeCompare(String(b.code)));
  return out;
}

/**
 * ตัดคู่ PO+รหัสที่ตั้งเรื่องคืนไว้แล้วออก
 * ไม่ตัด รายการเดิมจะขึ้นพร้อมกันทั้งการ์ด "ที่ระบบคำนวณได้" และ "เรื่องที่ตั้งไว้แล้ว"
 * แล้วคนจะตั้งเรื่องซ้ำใบเดิมโดยไม่รู้ตัว
 */
export function overPending(rows, follows) {
  const busy = new Set();
  for (const f of follows || []) {
    if (!f || f.kind !== 'over') continue;
    const st = statusOf(f);
    if (st === 'open' || st === 'partial') busy.add(pairKey(f.po, f.code));
  }
  return (rows || []).filter(r => !busy.has(pairKey(r.po, r.code)));
}

/**
 * เตือนเรื่อง "ใบนี้ยังรับมาไม่ครบ" ให้ใบนี้ได้ไหม — คืน '' ถ้าเตือนได้ · ถ้าไม่ได้คืนว่าติดตรงไหน
 *
 * ⚠️ มีตัวนี้เพราะ shortOfPo คืน [] ทั้งตอน "รับครบแล้ว" และตอน "ไม่มีข้อมูลให้เทียบ"
 *    บนกล่องที่ตัดของจริงออกจากคลัง "ไม่มีคำเตือน" ต้องไม่ถูกอ่านว่า "ตรวจแล้วไม่มีปัญหา"
 *    (ผู้ตรวจ #90 รอบ 2 ข้อ 1 · เจ้าของสั่งให้แก้ 20 ก.ย. 2026)
 */
export function shortWhyOf(po, { headerOf, bomRowsOf } = {}) {
  if (typeof headerOf !== 'function' || typeof bomRowsOf !== 'function') {
    throw new Error('ต้องส่ง headerOf และ bomRowsOf เข้ามา');
  }
  const key = txt(po);
  if (!key) return 'ไม่มีเลข PO ให้เทียบ';
  const head = headerOf(key);
  if (!head) return 'ยังไม่รู้จัก PO ใบนี้ — ยังไม่ได้นำเข้าไฟล์ PO ของวันนั้น';
  if (!txt(head.pn)) return 'ยังไม่รู้ P/N ของใบนี้';
  if (!(Number(head.order) || 0)) return 'ยังไม่รู้จำนวนสั่งของใบนี้';
  const rows = (bomRowsOf(head.pn) || []).filter(b => (Number(b && b.usage) || 0) > 0);
  if (!rows.length) return 'ไม่มีสูตรของ ' + txt(head.pn);
  return '';
}

/**
 * PO ใบนี้ยังรับมาไม่ครบตามสูตรอีกกี่รหัส — คิดสดจากของวันนี้ ไม่ใช่ค่าที่แช่แข็งไว้
 *
 * ⚠️ ใช้เตือนก่อนกดคืน ไม่ใช่ใช้บล็อก (INVARIANTS A4)
 *    รหัสหนึ่งเกินในขณะที่อีกรหัสของใบเดียวกันยังมาไม่ครบ เกิดขึ้นจริงได้
 *    แต่ก็เป็นอาการของ "คีย์รับเข้าผิดใบ" ได้เหมือนกัน คนกดควรได้เห็นก่อนตัดของจริงออกจากคลัง
 *
 * ⚠️ [] แปลว่า "ไม่มีรหัสไหนขาด" เท่านั้น · กรณีที่เทียบไม่ได้ก็คืน [] เหมือนกัน
 *    คนเรียกที่ต้องบอกผู้ใช้ให้ถาม shortWhyOf ควบคู่เสมอ
 *
 * bomRowsOf(pn) ต้องคืนบรรทัดสูตรที่ยังใช้อยู่ [{ code, usage }]
 */
export function shortOfPo(entries, entity, po, { headerOf, bomRowsOf } = {}) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  if (shortWhyOf(po, { headerOf, bomRowsOf })) return [];
  const key = txt(po);
  const head = headerOf(key);
  if (!head) return [];   // shortWhyOf กันไว้แล้ว · กันไว้อีกชั้นกันคนแก้สองที่ให้หลุดจากกัน
  const order = Number(head.order) || 0;

  /* ⚠️ หักยอดที่ส่งคืนไปแล้วด้วย เงื่อนไขการนับต้องตรงกับ overAll
   * ไม่หัก ใบที่คืนของไปแล้วจะกลายเป็น "รับไม่ครบ" ทั้งที่เป็นของที่เราคืนเอง */
  const got = new Map();
  for (const e of entries || []) {
    if (!e || e.entity !== entity || e.voided) continue;
    if (e.kind !== 'receive' && e.kind !== 'sendback') continue;
    if (txt(e.doc_ref) !== key) continue;
    const c = txt(e.material_code).toUpperCase();
    const sign = e.kind === 'receive' ? 1 : -1;
    got.set(c, round5((got.get(c) || 0) + sign * (Number(e.qty) || 0)));
  }

  const out = [];
  for (const b of bomRowsOf(head.pn) || []) {
    const need = round5((Number(b && b.usage) || 0) * order);
    if (need <= 0) continue;
    /* ⚠️ ตัดไม่ให้ติดลบ — ยอดคืนที่มากกว่ายอดรับเกิดได้ถ้าใบรับเข้าถูกยกเลิกทีหลัง
     * หรือเรื่องถูกตั้งด้วยมือเกินของจริง · ปล่อยติดลบแล้วคำเตือนจะขึ้น "ขาด 40"
     * ทั้งที่ทั้งใบสั่งมาแค่ 4 ซึ่งอ่านเหมือนข้อมูลเพี้ยนมากกว่าคำเตือน (ผู้ตรวจ #90 รอบ 3 ข้อ 1) */
    const have = Math.max(0, got.get(txt(b.code).toUpperCase()) || 0);
    const miss = round5(need - have);
    if (miss > 0) out.push({ code: txt(b.code), need, have: round5(have), miss });
  }
  return out;
}

/* ══════════ ของขาดที่คิดจากการรับเข้า (เจ้าของสั่ง 28 ก.ย. 2026) ══════════ */

/**
 * ขาดตั้งแต่เท่าไหร่ถึงนับ — **นับทุกยอดที่ขาดมากกว่าศูนย์** (เจ้าของเคาะ 28 ก.ย. 2026 หลังรีวิว #115)
 * ⚠️ ต่างจาก OVER_MIN โดยตั้งใจ: ของขาดแม้นิดเดียวก็อาจทำให้ผลิตไม่ได้ (เคมียอดตามสูตรระดับ 0.06 กก. เป็นปกติ
 *    ใช้เกณฑ์ 1 หน่วยแล้วรหัสเคมีที่ยังไม่ได้รับเลยจะไม่ขึ้นการ์ด) · ส่วนของเกินนิดเดียวไม่คุ้มตั้งเรื่องคืน
 */
export const SHORT_MIN = 0;

/**
 * ของขาดของนิติบุคคลนี้ — คิดสดจากสมุด แบบเดียวกับ overAll แต่กลับด้าน
 *
 *   ขาด = (ต่อชิ้น × จำนวนสั่งของใบนี้) − (รับเข้าตามใบนี้ − ส่งคืน Delta ตามใบนี้)
 *
 * เจ้าของเคาะ 28 ก.ย. 2026:
 *   - **คิดเฉพาะ PO ที่มีการรับเข้าในระบบแล้ว** — PO เก่าก่อนเริ่มใช้ระบบจะไม่กลายเป็นขาดทั้งใบ
 *     แต่รหัสใน BOM ที่ยังไม่ได้รับเลยของ PO นั้น นับว่าขาดด้วย
 *   - **ไม่ตั้งเรื่องเอง** — ของมาเป็นรอบ รับรอบแรกแล้วยอดต่ำกว่า BOM เป็นเรื่องปกติ
 *     ระบบแค่ขึ้นการ์ดให้ดู คนกดตั้งเรื่องเองเมื่อแน่ใจว่าใบนั้นไม่มีของมาเพิ่ม (fromShortRow)
 *
 * ⚠️ ยอดรับหักยอดที่ส่งคืนแล้ว และตัดไม่ให้ติดลบ — เงื่อนไขเดียวกับ shortOfPo (มีเทสยืนยัน)
 * ⚠️ PO ที่คิดไม่ได้คืนแถวเดียวพร้อม why (ไม่มี code) ไม่ใช่หายเงียบ — แบบเดียวกับ overAll
 * min = ขาดตั้งแต่เท่าไหร่ถึงคืนออกมา · ค่าตั้งต้น SHORT_MIN = นับทุกยอดที่ขาดมากกว่าศูนย์
 * all: true = คืนทุกรหัสในสูตรรวมที่ไม่ขาด (short 0) ใช้เทียบกับยอดที่ Delta แจ้ง
 *
 * คืน [{ po, pn, code, order, need, have, short, why }] เรียงตาม PO แล้วรหัส
 */
export function shortAll(entries, entity, { headerOf, bomRowsOf, min = SHORT_MIN, all = false } = {}) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  if (typeof headerOf !== 'function' || typeof bomRowsOf !== 'function') {
    throw new Error('ต้องส่ง headerOf และ bomRowsOf เข้ามา');
  }
  // เดินสมุดรอบเดียว — ห้ามเรียก shortOfPo ทีละใบ (เดินทั้งเล่มซ้ำทุก PO ทุกครั้งที่จอรีเฟรช)
  const got = new Map(), pos = new Set();
  for (const e of entries || []) {
    if (!e || e.entity !== entity || e.voided) continue;
    if (e.kind !== 'receive' && e.kind !== 'sendback') continue;
    const po = txt(e.doc_ref);
    if (!po) continue;
    if (e.kind === 'receive') pos.add(po);
    const k = pairKey(po, e.material_code);
    got.set(k, round5((got.get(k) || 0) + (e.kind === 'receive' ? 1 : -1) * (Number(e.qty) || 0)));
  }

  const out = [];
  for (const po of [...pos].sort()) {
    const why = shortWhyOf(po, { headerOf, bomRowsOf });
    if (why) {
      out.push({ po, pn: '', code: '', order: 0, need: null, have: null, short: null, why });
      continue;
    }
    const head = headerOf(po);
    const order = Number(head.order) || 0;
    for (const b of bomRowsOf(head.pn) || []) {
      const need = round5((Number(b && b.usage) || 0) * order);
      if (need <= 0) continue;
      const code = txt(b.code).toUpperCase();
      const have = round5(Math.max(0, got.get(pairKey(po, code)) || 0));
      const short = round5(Math.max(0, need - have));
      if (!all && !(short > 0 && short >= min)) continue;
      out.push({ po, pn: txt(head.pn), code, order, need, have, short, why: '' });
    }
  }
  out.sort((a, b) => String(a.po).localeCompare(String(b.po)) || String(a.code).localeCompare(String(b.code)));
  return out;
}

/**
 * ตัดคู่ PO+รหัสที่มีเรื่องขาดอยู่แล้วออก — ทุกที่มา (Delta แจ้ง · ไฟล์ PO · ตั้งเอง)
 * เจ้าของเคาะ 28 ก.ย. 2026: เรื่องที่ Delta แจ้งมาแล้วไม่ขึ้นซ้ำในการ์ดคำนวณ
 *
 * ⚠️ เรื่องที่ปิดแล้วก็กันด้วย ถ้ายอดที่คิดได้ตอนนี้เท่ากับยอดของเรื่องที่ปิด (เจ้าของเคาะ 6 ต.ค. 2026)
 *    ของที่ส่งมาแทนมักรับเข้าด้วย PO อื่น ยอดขาดของ PO เดิมจึงไม่หายไปไหน
 *    เดิมปิดเรื่องแล้วคู่นั้นโผล่ในการ์ดอีก แล้วถูกตั้งซ้ำทั้งที่ยอดเท่าเดิม
 *    (วัดจากชีตจริง 6 ต.ค.: เรื่องที่ตั้งช่วงเย็น 198 จาก 215 เรื่อง เป็นคู่ที่เคยปิดไปแล้ว)
 *    ยอดต่างจากเรื่องที่ปิด = ขาดเพิ่มจริง ยังขึ้นให้ตั้งเรื่องได้ · เรื่องที่ยกเลิกไม่กัน
 */
export function shortPending(rows, follows) {
  const busy = new Set(), closed = new Map();
  for (const f of follows || []) {
    if (!f || f.kind !== 'short') continue;
    const st = statusOf(f), k = pairKey(f.po, f.code);
    if (st === 'open' || st === 'partial') busy.add(k);
    else if (st === 'done') {
      if (!closed.has(k)) closed.set(k, []);
      closed.get(k).push(round5(Number(f.qty) || 0));
    }
  }
  // เกณฑ์ "ยอดเท่ากัน" เดียวกับ shortChecker — ต่างกันไม่เกินครึ่งของหลักทศนิยมที่สาม
  const sameAsClosed = r => (closed.get(pairKey(r.po, r.code)) || [])
    .some(q => q > 0 && Math.abs(q - (Number(r.short) || 0)) < 5e-4);
  return (rows || []).filter(r => !busy.has(pairKey(r.po, r.code)) && !sameAsClosed(r));
}

/**
 * ยอดขาดที่ระบบคิดได้ของเรื่องนี้ — เทียบกับที่เรื่องแจ้งไว้ (เช่นยอดจากใบ MAT'L FOLLOWING ของ Delta)
 * calcRows = shortAll(..., { all: true }) · คืน { calc, why, same }
 *   calc = ยอดขาดที่คิดได้ตอนนี้ (0 = รับครบตามสูตรแล้ว) · null = คิดไม่ได้ ดู why
 *   same = ยอดที่เรื่องแจ้งไว้ตรงกับที่คิดได้ (ต่างกันไม่เกินครึ่งของหลักทศนิยมที่สาม)
 *          null = เรื่องนี้ไม่ได้แจ้งจำนวนมา จึงไม่มียอดให้เทียบ — คนละเรื่องกับ "แจ้งมาแล้วไม่ตรง"
 */
export function shortChecker(calcRows) {
  // ทำดัชนีครั้งเดียว — ตารางเรื่องเรียกทุกแถว ไล่ calcRows ทั้งก้อนทุกครั้งช้าสามเท่า (ผู้ตรวจ #115 ข้อ 1)
  const pair = new Map(), whyOf = new Map(), pos = new Set();
  for (const r of calcRows || []) {
    if (r.why) { whyOf.set(r.po, r.why); continue; }
    pos.add(r.po);
    pair.set(pairKey(r.po, r.code), r.short);
  }
  // ⚠️ same: null ทุกกิ่งที่ไม่มียอดให้เทียบ — ไม่ใช่ false ซึ่งแปลว่า "แจ้งมาแล้วไม่ตรง" (ผู้ตรวจ #115 ข้อ 3)
  return follow => {
    const po = txt(follow && follow.po);
    if (!po) return { calc: null, why: 'เรื่องนี้ไม่มีเลข PO', same: null };
    if (whyOf.has(po)) return { calc: null, why: whyOf.get(po), same: null };
    const k = pairKey(po, follow.code);
    if (!pair.has(k)) {
      return { calc: null, why: pos.has(po) ? 'ไม่มีรหัสนี้ในสูตรของใบนี้' : 'ยังไม่มีการรับเข้าของใบนี้ในระบบ', same: null };
    }
    const calc = pair.get(k), q = Number(follow.qty) || 0;
    /* ⚠️ เรื่องประเภท "รอส่ง" (และแถวที่แกะจากไฟล์ PO แล้วอ่านจำนวนไม่ออก) มี qty = 0 โดยการออกแบบ —
     *    ช่อง "ที่แจ้งมา" ของแถวพวกนั้นเป็น — อยู่แล้ว ไม่มียอดให้เทียบ จึงห้ามตอบ same: false
     *    เพราะจอจะขึ้นป้าย "ต่าง" ทั้งที่ไม่มีอะไรให้ทำต่อ แล้วคนจะเลิกเชื่อป้ายนี้ทั้งคอลัมน์ (G3) */
    if (!(q > 0)) return { calc, why: '', same: null };
    return { calc, why: '', same: Math.abs(q - calc) < 5e-4 };
  };
}
export const shortCheckOf = (follow, calcRows) => shortChecker(calcRows)(follow);

/**
 * ตั้งเรื่องขาดจากแถวที่ระบบคำนวณได้ — ประเภท "ขาด" · ที่มา auto
 * ⚠️ ยอดสั่ง · ยอดตามสูตร · ยอดรับ แช่แข็งลงในเรื่องตรงนี้ เหมือน fromOverRow
 */
export function fromShortRow(row, { entity, person = '', at = '', unit = '', date = '', follows = null } = {}) {
  if (!row) throw new Error('ไม่มีแถวให้ตั้งเรื่อง');
  if (row.why) throw new Error('แถวนี้คำนวณยอดขาดไม่ได้: ' + row.why);
  // ด่านที่สอง ถ้ากดซ้ำหลุดมาได้ (เช่นสองเครื่อง หรือการ์ดยังไม่ทันคิดใหม่) — ส่ง follows มาเพื่อเช็ค
  if (follows && openPairFor(follows, 'short', entity, row.po, row.code)) {
    throw new Error(`PO ${txt(row.po)} · ${txt(row.code)} มีเรื่อง short เปิดอยู่แล้ว — ไม่ต้องตั้งซ้ำ`);
  }
  return makeFollow({
    kind: 'short', type: 'ขาด', entity, source: 'auto',
    code: row.code, po: row.po, part_no: row.pn, unit,
    qty: row.short,
    order_qty: row.order, bom_qty: row.need, recv_qty: row.have,
    note: 'รับไม่ครบตามสูตร (ระบบคำนวณจากการรับเข้า)',
    by: person, now: at, date
  });
}

/* ══════════ กันกดตั้งเรื่องซ้ำ (เจ้าของสั่ง 7 ต.ค. 2026) ══════════
 * วัดจากชีตจริง 7 ต.ค.: over เปิดค้างซ้ำคู่เดียวกัน 38 คู่ รวมเกินมา 144 เรื่อง
 * สร้างห่างกัน 0–1 วินาที (กลางราว 0.4 วิ) ยอดเท่ากันทุกเรื่อง = กดปุ่มซ้ำระหว่างที่ยังบันทึกไม่เสร็จ
 * แถวยังไม่หายจากการ์ดจนกว่าการเขียนลงเครื่องจะเสร็จ กดอีกทีก็ได้อีกเรื่อง
 * ⚠️ เรื่อง over ที่ซ้ำ = เสี่ยงคืนของซ้ำ = ตัดสต็อกเกินจริง
 */

/** กุญแจของปุ่มตั้งเรื่องหนึ่งแถว — short/over ใช้คู่ PO+รหัส · buy ใช้เลขที่ของเสีย */
export const startKey = (kind, row) => kind === 'buy'
  ? 'buy|' + txt(row && row.id)
  : kind + '|' + pairKey(row && row.po, row && row.code);

/**
 * ทำงานทีละครั้งต่อกุญแจ — กดซ้ำระหว่างที่ครั้งแรกยังไม่เสร็จ = ไม่ทำอะไร คืน false
 * busy = Set (ฝั่งจอส่ง reactive Set มา เพื่อให้ปุ่มกดไม่ได้ระหว่างรอ) · เสร็จหรือพังก็ปลดกุญแจเสมอ
 */
export async function startOnce(busy, key, fn) {
  if (busy.has(key)) return false;
  busy.add(key);
  try { await fn(); return true; }
  finally { busy.delete(key); }
}

/** เรื่องที่ยังเปิดอยู่ของคู่ PO+รหัสนี้ (ชนิดเดียวกัน · นิติบุคคลเดียวกัน) — ไม่มี = null */
export function openPairFor(follows, kind, entity, po, code) {
  const k = pairKey(po, code);
  return (follows || []).find(f => f && f.kind === kind && f.entity === entity
    && pairKey(f.po, f.code) === k && ['open', 'partial'].includes(statusOf(f))) || null;
}

/* ══════════ Short / Over บน Bin Card (เจ้าของสั่ง 28 ก.ย. 2026) ══════════ */

/**
 * Short / Over สะสมราย PO ทีละบรรทัดของการ์ด — ใส่ถัดจากคอลัมน์ Balance ทั้งบนจอและใน Excel
 *
 * เจ้าของเคาะ: **สะสมราย PO** — แถวรับเข้า (และส่งคืน Delta) บอกว่า PO ของแถวนั้น
 * หลังรายการนี้ยังขาดหรือเกินตามสูตรเท่าไร · แถวอื่น (จ่ายออก · ของเสีย · ปรับยอด ฯลฯ) ได้ค่าว่าง = "-"
 *
 *   รับแล้วสะสม = รับเข้าตาม PO นี้ − ส่งคืนตาม PO นี้ (ถึงบรรทัดนี้)
 *   ขาด = ตามสูตร − รับแล้วสะสม (ถ้ามากกว่าศูนย์) · เกิน = รับแล้วสะสม − ตามสูตร (ถ้ามากกว่าศูนย์)
 *
 * rows = cardRows() ของรหัสเดียว **เรียงเก่าไปใหม่** (ไม่รวมรายการที่ยกเลิก) · คืนอาร์เรย์ยาวเท่า rows
 * ⚠️ ใช้สูตรกับจำนวนสั่ง "ของวันนี้" ทั้งการ์ด — ถ้าสูตรหรือจำนวนสั่งของ PO เปลี่ยนทีหลัง แถวเก่าก็เปลี่ยนตาม
 * ⚠️ PO ที่คิดไม่ได้ (ไม่รู้ P/N · จำนวนสั่ง · ไม่มีรหัสนี้ในสูตร) ได้ "-" เหมือนแถวที่ไม่เกี่ยว — ไม่เดา
 *    ไม่ใช้เกณฑ์ขั้นต่ำ (SHORT_MIN / OVER_MIN) เพราะคอลัมน์นี้คือยอดสะสมตามจริง ไม่ใช่การ์ดเตือน
 */
export function cardShortOver(rows, { headerOf, usageOf } = {}) {
  if (typeof headerOf !== 'function' || typeof usageOf !== 'function') {
    throw new Error('ต้องส่ง headerOf และ usageOf เข้ามา');
  }
  const NONE = { short: null, over: null };
  const got = new Map();
  return (rows || []).map(r => {
    if (!r || r.voided || (r.kind !== 'receive' && r.kind !== 'sendback')) return NONE;
    const po = txt(r.doc_ref);
    if (!po) return NONE;
    const have = round5((got.get(po) || 0) + (r.kind === 'receive' ? 1 : -1) * (Number(r.qty) || 0));
    got.set(po, have);
    const head = headerOf(po);
    const order = head ? Number(head.order) || 0 : 0;
    if (!head || !txt(head.pn) || !order) return NONE;
    const usage = usageOf(txt(head.pn), r.material_code);
    if (usage == null || !isFinite(Number(usage))) return NONE;
    /* ⚠️ ตัดไม่ให้ติดลบตอนเทียบ แบบเดียวกับ shortAll:490 (ยอดสะสมใน got ยังเก็บตามจริง)
     * ยอดคืนที่มากกว่ายอดรับเกิดได้ถ้าใบรับเข้าถูกยกเลิกทีหลัง — ปล่อยติดลบแล้วการ์ด
     * จะขึ้น "ขาด 14" ทั้งที่ทั้งใบสั่งมาแค่ 10 และไม่ตรงกับหน้า Mat Follow up (ผู้ตรวจ #117 รอบ 1 ข้อ 2) */
    const d = round5(Math.max(0, have) - round5(Number(usage) * order));
    return { short: d < 0 ? round5(-d) : null, over: d > 0 ? d : null };
  });
}

/**
 * สรุป Short / Over ราย PO ของรหัสเดียว — ส่วนสรุปบนหน้าการ์ด
 * calcAll = shortAll(..., { all: true }) · เจ้าของเคาะ: ทุก PO ที่มีรหัสนี้ในสูตรและเริ่มรับแล้ว (รวมที่ครบพอดี)
 * follows = เรื่องตามงาน — แนบเรื่องขาด/เกินที่ยังเปิดอยู่ของคู่นั้นไว้ให้เห็น
 */
export function codeShortOver(calcAll, code, follows = []) {
  const c = txt(code).toUpperCase();
  if (!c) return [];
  const open = new Map();
  for (const f of follows || []) {
    if (!f || (f.kind !== 'short' && f.kind !== 'over')) continue;
    const st = statusOf(f);
    if (st === 'open' || st === 'partial') open.set(pairKey(f.po, f.code) + '|' + f.kind, f);
  }
  return (calcAll || [])
    .filter(r => !r.why && r.code === c)
    .map(r => {
      const over = round5(Math.max(0, r.have - r.need));
      return { po: r.po, pn: r.pn, order: r.order, need: r.need, have: r.have,
               short: r.short > 0 ? r.short : 0, over,
               follow: open.get(pairKey(r.po, c) + '|short') || open.get(pairKey(r.po, c) + '|over') || null };
    });
}

/**
 * ตั้งเรื่องคืนจากแถวที่ระบบคำนวณได้
 * ⚠️ ยอดสั่ง · ยอดตามสูตร · ยอดรับ ถูกแช่แข็งลงไปในเรื่องตรงนี้
 *    ใบรับเข้าที่คีย์ทีหลังจะทำให้ยอดของเรื่องที่ตั้งไปแล้วขยับเองถ้าไม่แช่แข็ง
 */
export function fromOverRow(row, { entity, person = '', at = '', unit = '', date = '', follows = null } = {}) {
  if (!row) throw new Error('ไม่มีแถวให้ตั้งเรื่อง');
  if (row.why) throw new Error('แถวนี้คำนวณยอดเกินไม่ได้: ' + row.why);
  if (follows && openPairFor(follows, 'over', entity, row.po, row.code)) {
    throw new Error(`PO ${txt(row.po)} · ${txt(row.code)} มีเรื่องคืนเปิดอยู่แล้ว — ไม่ต้องตั้งซ้ำ`);
  }
  return makeFollow({
    kind: 'over', entity, source: 'auto',
    code: row.code, po: row.po, part_no: row.pn, unit,
    qty: row.over,
    order_qty: row.order, bom_qty: row.bom_qty, recv_qty: row.recv,
    // ⚠️ คนเรียกต้องส่ง date ตามเวลาไทยมาเอง — ค่าตั้งต้นของ makeFollow สไลซ์จาก
    //    toISOString() ซึ่งเป็น UTC ช่วงตีศูนย์ถึงเจ็ดโมงเช้าจะได้ "ตั้งวันที่" เป็นเมื่อวาน
    by: person, now: at, date
  });
}

/**
 * ใบส่งคืน Delta หนึ่งรายการ — คืน makeEntry ให้ผู้เรียกไปบันทึก ไม่เขียนเอง
 *
 * ⚠️ ต้องพกเลข PO ไปด้วย (doc_ref) ของเกินนิยามต่อใบ
 *    ไม่พกไปแล้วยอดที่คืนจะหักกับใบไหนไม่ได้ และ overAll จะเห็นของเกินก้อนเดิมอีกรอบ
 */
export function sendbackEntry(row, { qty, person, device = '', at = '',
                                     reason_code = '', lot = '', note = '' } = {}) {
  if (!row) throw new Error('ไม่มีเรื่องให้คืน');
  if (row.kind !== 'over') throw new Error('คืนของได้เฉพาะเรื่องของเกิน');
  if (row.voided) throw new Error('เรื่องนี้ถูกยกเลิกไปแล้ว');
  const n = Number(qty);
  if (!isFinite(n) || n <= 0) throw new Error('จำนวนที่คืนต้องมากกว่าศูนย์');
  if (round5(n) > remainOf(row)) {
    throw new Error(`คืนได้ไม่เกินยอดที่ค้างอยู่ (${remainOf(row)})`);
  }
  return makeEntry({
    kind: 'sendback', entity: row.entity, material_code: row.code,
    qty: n, lot, doc_kind: 'po', doc_ref: row.po, part_no: row.part_no,
    person, device, at, reason_code, note
  });
}

/* ══════════ ซื้อแมททดแทนของเสีย (Mat Follow up 7/8) ══════════
 * ของเสียตัดออกจากคลังไปแล้วด้วยรายการชนิด scrap · ของที่หายไปต้องซื้อทดแทนผ่าน Delta
 * เรื่องซื้อทดแทนจึงผูกกับ "รายการของเสียใบนั้น" เสมอ ไม่ใช่ผูกกับรหัสลอย ๆ
 * ไม่งั้นไล่ย้อนไม่ได้ว่าซื้อมาทดแทนของที่เสียครั้งไหน และตั้งเรื่องซ้ำใบเดิมได้ไม่รู้ตัว
 */

/** เรื่องซื้อทดแทนที่ผูกกับรายการของเสียใบนี้อยู่แล้ว — ที่ยกเลิกไปแล้วไม่นับ */
export function buyFor(follows, scrapEntryId) {
  const key = txt(scrapEntryId);
  if (!key) return null;
  return (follows || []).find(f => f && f.kind === 'buy' && !f.voided
                                && txt(f.scrap_entry_id) === key) || null;
}

/**
 * ของเสียของนิติบุคคลนี้ที่ยังไม่มีใครตั้งเรื่องซื้อทดแทน — คิดสดจากสมุด ไม่เก็บ
 * ใหม่สุดขึ้นก่อน เพราะของที่เพิ่งเสียคือของที่ต้องรีบสั่ง
 */
export function pendingScraps(entries, entity, follows) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  return (entries || [])
    .filter(e => e && e.entity === entity && e.kind === 'scrap' && !e.voided
                 && !buyFor(follows, e.id))
    .map(e => ({ id: txt(e.id), code: txt(e.material_code), qty: round5(Number(e.qty) || 0),
                 lot: txt(e.lot), at: txt(e.at), reason_code: txt(e.reason_code),
                 note: txt(e.note), person: txt(e.person),
                 // PO ที่ของเสียเกิด + P/N — ช่อง "Old Po." / "Part NO." ของใบสั่งซื้อ FM-PU-02
                 po: txt(e.doc_ref), part_no: txt(e.part_no) }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * ตั้งเรื่องซื้อทดแทนจากรายการของเสียหนึ่งใบ
 * ⚠️ ส่ง follows เข้ามาด้วยเสมอ — กันตั้งเรื่องซ้ำใบเดิม ซึ่งจะกลายเป็นสั่งของสองเท่า
 * PO ยังว่างได้ เพราะตอนตั้งเรื่องมักยังไม่รู้ว่า Delta จะออกใบไหนให้
 */
export function fromScrapRow(row, { entity, person = '', unit = '', date = '',
                                    at = '', follows = null } = {}) {
  if (!row || !txt(row.id)) throw new Error('ไม่มีรายการของเสียให้ตั้งเรื่อง');
  if (follows && buyFor(follows, row.id)) {
    throw new Error('ของเสียใบนี้ตั้งเรื่องซื้อทดแทนไว้แล้ว');
  }
  return makeFollow({
    kind: 'buy', entity, source: 'auto',
    code: row.code, qty: row.qty, unit,
    scrap_entry_id: row.id,
    // po = PO เดิมที่ของเสียเกิด (Old Po.) · PO ใหม่ที่ Delta ออกให้ทีหลังเก็บที่ next_po
    po: txt(row.po), part_no: txt(row.part_no),
    note: txt(row.note), by: person, now: at, date
  });
}

/* ── ใบสั่งซื้อทดแทน FM-PU-02 "ISSUE MATERIAL LOSS FOR SUBCONTRACT" (เจ้าของเคาะ 2 ต.ค. 2026) ──
 * ไฟล์ Excel เดิมตั้งชื่อชีตเป็น "วัน.เดือน.ปี นิติบุคคล" เช่น 22.9.26 H — เลขใบใช้แบบเดียวกัน
 * วันเดียวกันออกหลายใบ ต่อท้าย -2 -3 · ใบจัดกลุ่มเป็น Item = Part NO. + Old Po. เหมือนฟอร์มเดิม */

/** ตัวย่อนิติบุคคลบนเลขใบ — TUE-H → H · ไม่มีขีดใช้ทั้งรหัส */
export const entityTag = e => {
  const s = txt(e).toUpperCase();
  const i = s.lastIndexOf('-');
  return i >= 0 ? s.slice(i + 1) : s;
};

/** เลขใบสั่งซื้อ — taken = เลขที่ใช้ไปแล้วของนิติบุคคลนี้ */
export function buyDocNo(date, entity, taken = []) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(date));
  if (!m) throw new Error('วันที่ใบสั่งซื้อไม่ถูกต้อง — เลือกวันที่ใหม่');
  const base = `${+m[3]}.${+m[2]}.${m[1].slice(2)} ${entityTag(entity)}`;
  const used = new Set((taken || []).map(txt));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(base + '-' + n)) return base + '-' + n;
}

/** เลขใบที่ออกไปแล้วของนิติบุคคลนี้ (นับทั้งที่ยกเลิกเรื่องไปแล้ว — เลขที่เคยใช้ห้ามใช้ซ้ำ) */
export const buyDocNos = (follows, entity) => [...new Set((follows || [])
  .filter(f => f && f.kind === 'buy' && f.entity === entity && txt(f.pr_no)).map(f => txt(f.pr_no)))];

/**
 * เรื่องที่ใส่ในใบได้ — คืน { rows, skipped: [{ id, why }] }
 * ⚠️ เรื่องที่ออกใบไปแล้วห้ามใส่ซ้ำ = สั่งของสองรอบ
 */
export function buyDocPick(follows, entity, ids) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const want = new Set((ids || []).map(txt));
  const rows = [], skipped = [];
  for (const f of follows || []) {
    if (!f || !want.has(txt(f.id))) continue;
    const why = f.kind !== 'buy' ? 'ไม่ใช่เรื่องซื้อทดแทน'
      : f.entity !== entity ? 'เป็นของนิติบุคคลอื่น'
      : f.voided ? 'ยกเลิกเรื่องไปแล้ว'
      : statusOf(f) === 'done' ? 'รับของครบแล้ว'
      : txt(f.pr_no) ? 'ออกใบไปแล้ว (' + txt(f.pr_no) + ')' : '';
    if (why) skipped.push({ id: txt(f.id), code: f.code, why });
    else rows.push(f);
  }
  return { rows, skipped };
}

/**
 * เรื่องทั้งหมดที่อยู่ในใบเลขนี้ — ใช้ตอนพิมพ์ใบเดิมซ้ำ
 * ⚠️ รวมเรื่องที่ยกเลิกทีหลังด้วย เพราะใบที่ส่งให้ผู้ขายไปแล้วมีบรรทัดนั้นอยู่
 *    ตัดออก = ใบเลขเดียวกันสองใบมีจำนวนบรรทัดไม่เท่ากัน (ผู้ตรวจ #121 รอบ 1 ข้อ 1)
 */
export function buyDocRows(follows, entity, no) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const want = txt(no);
  if (!want) return [];
  return (follows || []).filter(f =>
    f && f.kind === 'buy' && f.entity === entity && txt(f.pr_no) === want);
}

/**
 * จัดกลุ่มเป็น Item ของฟอร์ม — Part NO. + Old Po. · เรียงตาม P/N แล้ว PO · บรรทัดในกลุ่มเรียงตามรหัส
 *
 * qty = 'remain' (ตั้งต้น) ยอดที่ยังค้าง — ใบที่ออกใหม่ สั่งเฉพาะของที่ยังไม่มา
 * qty = 'order'  จำนวนที่ตั้งเรื่องไว้ (`qty` ซึ่งไม่ขยับหลังสร้าง) — **ใบที่พิมพ์ซ้ำต้องใช้ตัวนี้**
 *   ถ้าพิมพ์ซ้ำด้วย 'remain' จำนวนในใบจะลดลงทุกครั้งที่รับของ และเป็น 0 เมื่อรับครบ
 *   ทั้งที่ใบจริงที่ส่งให้ผู้ขายเขียนจำนวนเดิม (ผู้ตรวจ #121 รอบ 1 ข้อ 1)
 */
export function buyDocGroups(rows, { qty = 'remain' } = {}) {
  const qtyOf = qty === 'order' ? f => round5(Number(f && f.qty) || 0) : remainOf;
  const by = new Map();
  for (const f of rows || []) {
    const key = txt(f.part_no) + '|' + txt(f.po);
    if (!by.has(key)) by.set(key, { part_no: txt(f.part_no), po: txt(f.po), lines: [] });
    by.get(key).lines.push({ id: txt(f.id), code: txt(f.code), qty: qtyOf(f), unit: txt(f.unit),
                             note: txt(f.note), voided: !!f.voided });
  }
  const groups = [...by.values()].sort((a, b) =>
    a.part_no.localeCompare(b.part_no) || a.po.localeCompare(b.po));
  for (const g of groups) g.lines.sort((a, b) => a.code.localeCompare(b.code));
  return groups;
}

/** ติดเลขใบไว้ที่เรื่อง — ติดแล้วติดซ้ำไม่ได้ · id / created_at ไม่ขยับ (B3) */
export function stampBuyDoc(row, { no, date, now = '' } = {}) {
  if (!row || row.kind !== 'buy') throw new Error('ติดเลขใบสั่งซื้อได้เฉพาะเรื่องซื้อทดแทน');
  if (txt(row.pr_no)) throw new Error('เรื่องนี้ออกใบไปแล้ว (' + txt(row.pr_no) + ') — ห้ามสั่งซ้ำ');
  if (!txt(no) || !txt(date)) throw new Error('ต้องมีเลขใบและวันที่');
  return { ...row, pr_no: txt(no), pr_date: txt(date), updated_at: txt(now) || new Date().toISOString() };
}

/**
 * PO ที่แนะนำในช่อง "PO ที่เสีย" — PO ที่เพิ่งคีย์ของเสียไว้ขึ้นก่อน (ใหม่สุดก่อน) แล้วต่อด้วยรายการ PO
 * เจ้าของเคาะ 2 ต.ค. 2026: ไม่ค้างค่าเดิมหลังบันทึก (กัน Old Po. ผิดใบ) แต่ให้กดเลือกจากที่เคยคีย์ได้ง่าย ๆ
 * ⚠️ เฉพาะนิติบุคคลนี้ (A3) · ของเสียที่ยกเลิกแล้วไม่นับ
 */
export function scrapPoSuggest(entries, entity, poList = [], limit = 40) {
  if (!txt(entity)) return [];
  // คืน [{ po, pn }] — P/N กำกับไว้ในตัวเลือก ใบที่ P/N ต่างกันจะได้แยกออก (issue #26 · ผู้ตรวจ #119 รอบ 2 ข้อ 3)
  const pnOf = new Map();
  const list = (poList || []).filter(p => p && txt(p.po))
    // รายการ PO เรียงใหม่สุดก่อน — ถ้าปล่อยตามลำดับในฐานข้อมูล 40 ตัวแรกจะเป็นใบเก่าที่ไม่เกี่ยวกับวันนี้ (ข้อ 4)
    .sort((a, b) => txt(b.date).localeCompare(txt(a.date)) || txt(b.po).localeCompare(txt(a.po)));
  for (const p of list) if (!pnOf.has(txt(p.po))) pnOf.set(txt(p.po), txt(p.pn));
  const recent = (entries || [])
    .filter(e => e && e.entity === entity && e.kind === 'scrap' && !e.voided && txt(e.doc_ref))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  for (const e of recent) if (!pnOf.has(txt(e.doc_ref))) pnOf.set(txt(e.doc_ref), txt(e.part_no));
  const order = [...new Set([...recent.map(e => txt(e.doc_ref)), ...list.map(p => txt(p.po))])];
  return order.slice(0, limit).map(po => ({ po, pn: pnOf.get(po) || '' }));
}

/**
 * ซื้อทดแทนที่คีย์เอง — ของที่ต้องสั่งแต่ไม่ได้มาจากของเสียในสมุด (เจ้าของเคาะ 2 ต.ค. 2026)
 * ไม่มี scrap_entry_id จึงไม่ถูกนับเป็นเรื่องที่ต้นเหตุหายไป (orphanBuys ข้ามให้)
 */
export function fromManualBuy({ entity, code, qty, unit = '', po = '', part_no = '', note = '',
                                person = '', date = '', at = '' } = {}) {
  return makeFollow({
    kind: 'buy', entity, source: 'manual', code, qty, unit,
    po: txt(po), part_no: txt(part_no), note: txt(note), by: person, now: at, date
  });
}

/**
 * หน่วยที่ติดไปกับเรื่องซื้อ — ทะเบียนก่อนเสมอ ไม่มีค่อยใช้ของ BOM / ที่คีย์ (เจ้าของเคาะ 10 ต.ค. 2026)
 * หน่วยนี้ไหลไปถึงใบสั่งซื้อที่ส่งผู้ขาย · ทะเบียน = หน่วยที่ซื้อจริง
 * ⚠️ เดิมแถวที่ติ๊กจาก BOM ใช้หน่วย BOM ก่อน แต่แถวนอกสูตรใช้ทะเบียนก่อน — รหัสเดียวกันได้หน่วยคนละตัว (ผู้ตรวจ #129 ข้อ 1)
 */
export function buyUnit(regUnit, ...fallbacks) {
  for (const u of [regUnit, ...fallbacks]) if (txt(u)) return txt(u);
  return '';
}

/**
 * ตั้งเรื่องซื้อทดแทนหลายรหัสทีเดียว จากสูตรของ PO ที่เสีย (เจ้าของสั่ง 10 ต.ค. 2026)
 * คีย์เลข PO → ได้ P/N → กาง BOM → ติ๊กรหัสที่จะสั่ง + คีย์จำนวนเองทุกแถว → เป็นเรื่องซื้อ (source manual) ทีละรหัส
 * picks = [{ code, qty, unit, note }] · คืน { ok, recs, errors: [{ code, why }], dup: [code] }
 * note ของแต่ละแถว (เจ้าของสั่ง 10 ต.ค. 2026 — เดิมได้หมายเหตุเดียวทั้ง PO) · แถวที่เว้นว่างใช้ note ของทั้งชุด
 * dup = รหัสที่มีเรื่องซื้อของ PO นี้เปิดอยู่และยังไม่ออกใบ — เตือนก่อน ไม่บล็อก (สั่งเพิ่มได้จริง)
 */
export function buyFromBom({ entity, po = '', part_no = '', picks = [], note = '', person = '', date = '', at = '' } = {},
                           follows = []) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const errors = [], recs = [], dup = [];
  if (!txt(po)) errors.push({ code: '', why: 'ใส่เลข PO ที่เสียก่อน' });
  if (!(picks || []).length) errors.push({ code: '', why: 'ยังไม่ได้ติ๊กรายการไหนเลย' });
  const seen = new Set();
  for (const p of picks || []) {
    const code = txt(p && p.code).toUpperCase();
    const q = Number(p && p.qty);
    if (!(q > 0) || !isFinite(q)) { errors.push({ code, why: `${code} ใส่จำนวนที่จะสั่ง (มากกว่าศูนย์)` }); continue; }
    if (!code) { errors.push({ code: '', why: 'มีแถวที่ไม่มีรหัสวัตถุดิบ — ตรวจสูตรของ P/N นี้ที่ ข้อมูลตั้งต้น → BOM' }); continue; }
    // รหัสนอกสูตรที่คีย์เอง (เจ้าของสั่ง 10 ต.ค. 2026) ซ้ำกับที่ติ๊กจากสูตรได้ — สองเรื่องรหัสเดียวกันในรอบเดียวคือคีย์พลาด
    if (seen.has(code)) { errors.push({ code, why: `${code} เลือกซ้ำ — อยู่ในสูตรแล้วหรือคีย์ซ้ำสองแถว ให้เหลือแถวเดียว` }); continue; }
    seen.add(code);
    // แถวที่มาจากสูตรไม่มีช่องหน่วยให้คีย์ ต้องบอกทางออกที่มีจริงด้วย (G3 · ผู้ตรวจ #129 ข้อ 1)
    if (!txt(p.unit)) { errors.push({ code, why: `${code} ไม่มีหน่วย — ใส่หน่วยในช่องหน่วยของแถวนี้ หรือเติมหน่วยให้รหัสนี้ที่ ข้อมูลตั้งต้น → BOM / ทะเบียนวัตถุดิบ` }); continue; }
    const open = (follows || []).some(f => f && f.kind === 'buy' && f.entity === entity && !f.voided
      && !txt(f.pr_no) && statusOf(f) !== 'done' && txt(f.po) === txt(po) && txt(f.code).toUpperCase() === code);
    if (open) dup.push(code);
    /* ⚠️ ห้ามให้ error หลุดออกจากฟังก์ชันนี้ — ผู้เรียกคือ computed (fbmPlan) · โยนที่นั่น = จอหยุดอัปเดต */
    if (!errors.length) {
      try { recs.push(fromManualBuy({ entity, code, qty: q, unit: txt(p.unit), po, part_no, note: txt(p.note) || note, person, date, at })); }
      catch (err) { errors.push({ code, why: `${code} ${err.message}` }); }
    }
  }
  return { ok: !errors.length, recs: errors.length ? [] : recs, errors, dup };
}

/**
 * ของที่ซื้อทดแทนมาถึงแล้ว — ผูกเลขที่รายการรับเข้าไว้ แล้วปิดเรื่องตามจำนวนที่รับจริง
 *
 * ⚠️ รับมามากกว่าที่ตั้งเรื่องไว้ไม่ใช่ความผิดพลาด (Delta ส่งเผื่อ) · ปิดได้แค่ยอดที่ค้าง
 *    ไม่งั้น closeFollow จะโยนทิ้งทั้งที่ของมาถึงจริง แล้วเรื่องจะค้างอยู่ตลอดไป
 * ⚠️ ต่อท้ายเลขที่รายการ ไม่ทับของเดิม · ของทยอยมาหลายรอบได้ (กฎเดียวกับ return_entry_id ของใบ 6)
 */
export function linkReceive(row, { entryId, qty, by = '', at = '', doneAt = '' } = {}) {
  if (!row) throw new Error('ไม่มีเรื่องให้ผูกของที่รับมา');
  if (row.kind !== 'buy') throw new Error('ผูกของที่รับมาได้เฉพาะเรื่องซื้อทดแทน');
  if (row.voided) throw new Error('เรื่องนี้ถูกยกเลิกไปแล้ว');
  const id = txt(entryId);
  if (!id) throw new Error('ต้องบอกเลขที่รายการรับเข้า');
  /* ⚠️ ผูกใบเดิมซ้ำ = ปิดยอดซ้ำสองรอบจากของกองเดียว · ยอดที่ค้างจะหายไปทั้งที่ของยังไม่มา */
  if (String(row.receive_entry_id || '').split(/\s+/).includes(id)) {
    throw new Error('ผูกกับใบรับเข้าใบนี้ไปแล้ว');
  }
  const remain = remainOf(row);
  if (remain <= 0) throw new Error('เรื่องนี้ปิดไปแล้ว');
  const got = Number(qty);
  if (!isFinite(got) || got <= 0) throw new Error('จำนวนที่รับต้องมากกว่าศูนย์');

  const rec = closeFollow(row, { qty: Math.min(round5(got), remain), by, at, doneAt });
  rec.receive_entry_id = [txt(row.receive_entry_id), id].filter(Boolean).join(' ');
  return rec;
}

/**
 * เรื่องซื้อทดแทนที่ "ต้นเหตุหายไปแล้ว" — ของเสียที่ผูกไว้ถูกยกเลิก หรือหาไม่เจอในสมุด
 *
 * ⚠️ ห้ามยกเลิกเรื่องให้เอง · ของอาจสั่งไปแล้วจริง การตัดสินว่ายังต้องซื้อไหมเป็นของคน
 *    หน้าที่ของตัวนี้คือทำให้เห็น ไม่ใช่ตัดสินแทน (เจ้าของสั่ง 20 ก.ย. 2026 ให้แจ้งเตือน)
 */
export function orphanBuys(entries, entity, follows) {
  if (!txt(entity)) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  const alive = new Map();
  for (const e of entries || []) {
    if (e && e.entity === entity && e.kind === 'scrap') alive.set(txt(e.id), !e.voided);
  }
  return (follows || []).filter(r => {
    if (!r || r.kind !== 'buy' || r.voided || r.entity !== entity) return false;
    if (statusOf(r) === 'done') return false;
    const key = txt(r.scrap_entry_id);
    if (!key) return false;
    return alive.get(key) !== true;   // ยกเลิกไปแล้ว หรือไม่มีในสมุดของนิติบุคคลนี้
  }).map(r => ({ ...r, why: alive.has(txt(r.scrap_entry_id))
    ? 'รายการของเสียที่ผูกไว้ถูกยกเลิกทีหลัง'
    : 'หารายการของเสียที่ผูกไว้ไม่เจอในสมุด' }));
}

/**
 * เทียบ "ยอดที่ Delta ตัดจาก over" ในไฟล์ Kit List กลุ่มจ่ายรวม กับของเกินที่เรามีอยู่จริง
 *
 * ⚠️ จับคู่ด้วย **รหัส** ไม่ใช่ PO โดยตั้งใจ
 * ของเกินเกิดจาก PO ใบเก่า แต่ Delta ไปตัดตอนจ่ายของให้ PO ใบใหม่
 * จับคู่ด้วย PO เมื่อไหร่จะไม่เจอกันสักคู่ แล้วหน้าจอจะบอกว่า "ไม่ตรงทั้งหมด" ทั้งที่ของตรง
 *
 * "ของเกินที่เรามีอยู่" = ที่ยังไม่ได้ตั้งเรื่อง (pending) + ที่ตั้งเรื่องแล้วยังคืนไม่หมด
 * สองก้อนนี้ไม่ทับกัน เพราะ overPending ตัดคู่ที่ตั้งเรื่องแล้วออกไปตั้งแต่ต้นทาง
 *
 * ⚠️ A3 — ไม่มีนิติบุคคลคืนรายการว่าง ไม่ใช่รวมทุกโรงงานมากองเดียวกัน
 * แถวที่อ่านนิติบุคคลจากเลขที่ PO ไม่ได้ ถูกนับแยกไว้ให้หน้าจอบอก ไม่ใช่เททิ้งเงียบ ๆ
 * (pending ต้องถูกกรองนิติบุคคลมาแล้วจากผู้เรียก เพราะแถวพวกนั้นมาจากสมุดโดยตรง)
 */
export function overCutMatch(cuts = [], { pending = [], follows = [], entity = '', date = '', known = null } = {}) {
  const ent = String(entity || '').trim().toUpperCase();
  const empty = { rows: [], lines: 0, unreadable: 0, unregistered: 0, dates: [], date: '' };
  if (!ent) return empty;

  const want = String(date || '').trim();
  // รอบทั้งหมดที่มีในเครื่อง — ต้องนับให้ครบ "ก่อน" กรองรอบ
  // ไม่งั้นพอเลือกรอบเก่า ช่องเลือกรอบจะเหลือรอบเดียว แล้วกลับไปรอบล่าสุดไม่ได้อีก
  const dates = new Set();
  for (const c of cuts || []) if (c && c.code && c.date) dates.add(String(c.date));
  const all = [...dates].sort().reverse();
  // ไม่ระบุรอบ = รอบล่าสุด ห้ามรวมทุกรอบมากองเดียวแล้วติดป้ายว่าเป็นรอบล่าสุด
  // (ยอดที่เอาไปเทียบก่อนตัดของจริงออกจากคลัง จะบวกยอดของรอบเก่าที่เก็บไว้เข้ามาด้วย)
  const pick = want || all[0] || '';

  // ⚠️ รหัสนิติบุคคลที่อ่านจากเลข PO ได้ แต่ยังไม่มีในทะเบียน ต้องนับแยกไว้บอก
  // ไม่ใช่ทิ้งเงียบ ๆ ปนกับ "เป็นของอีกโรงงานจริง ๆ" (ผู้ตรวจ #101)
  // เครื่องมือนี้มีหน้าที่ตอบว่า "ของเกินที่เรามีตรงกับที่ Delta แจ้งไหม"
  // แถวที่หายเงียบจะทำให้คำตอบเป็น "ตรง" ทั้งที่ไม่ตรง
  // ไม่ส่งทะเบียนมา = ไม่เช็ก (พฤติกรรมเดิม) แต่หน้าจอควรส่งมาเสมอ
  const reg = known ? new Set((known || []).map(x => String(x).trim().toUpperCase())) : null;
  const mine = [];
  let unreadable = 0, unregistered = 0;
  for (const c of cuts || []) {
    if (!c || !c.code) continue;
    if (pick && String(c.date || '') !== pick) continue;
    const e = entityOfPo(c.po);
    if (!e) { unreadable++; continue; }
    if (reg && !reg.has(e)) { unregistered++; continue; }
    if (e === ent) mine.push(c);
  }

  const cut = new Map();
  for (const c of mine) {
    const key = String(c.code);
    const hit = cut.get(key) || { code: key, cut: 0, lines: 0, pos: [] };
    hit.cut = round5(hit.cut + (Number(c.issue) || 0));
    hit.lines++;
    if (c.po && !hit.pos.includes(c.po)) hit.pos.push(c.po);
    cut.set(key, hit);
  }

  const have = new Map();
  const add = (code, n) => {
    const key = String(code);
    if (!key || !n) return;
    have.set(key, round5((have.get(key) || 0) + n));
  };
  for (const p of pending || []) add(p.code, Number(p.over) || 0);
  for (const f of follows || []) {
    if (!f || f.kind !== 'over' || f.voided) continue;
    if (String(f.entity || '').trim().toUpperCase() !== ent) continue;
    const st = statusOf(f);
    if (st !== 'open' && st !== 'partial') continue;
    add(f.code, remainOf(f));
  }

  const rows = [...cut.values()].map(x => {
    const own = have.get(x.code) || 0;
    return { ...x, have: own, diff: round5(own - x.cut) };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)
                 || String(a.code).localeCompare(String(b.code)));

  return { rows, lines: mine.length, unreadable, unregistered, dates: all, date: pick };
}
