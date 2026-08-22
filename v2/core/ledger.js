/**
 * สมุดการเคลื่อนไหว — แกนกลางของ v2
 *
 * ทั้งระบบมีที่เดียวที่รู้ว่าการเคลื่อนไหวหนึ่งครั้งหน้าตาเป็นยังไง และมีผลกับยอดทางไหน
 * ไฟล์นี้คือที่นั้น ห้ามมีตรรกะเครื่องหมายบวกลบอยู่ที่อื่นในโปรแกรมเด็ดขาด
 *
 * ── ทำไมต้องรวมไว้ที่เดียว ────────────────────────────────────────
 * v1 เก็บ direction:'IN'|'OUT' แล้วเขียน (t.direction === 'IN' ? +qty : -qty)
 * กระจายอยู่ 6 จุดที่คำนวณยอด ผลคือการเพิ่มชนิดการเคลื่อนไหวใหม่แปลว่า
 * ต้องไล่แก้ให้ครบทุกจุด พลาดจุดเดียวยอดเพี้ยนโดยไม่มีอะไรเตือน
 * — ซึ่งเป็นเหตุผลหนึ่งที่ "ของเสีย" กับ "ปรับยอด" ไม่เคยถูกเพิ่มเข้าไปเลย
 */

/** ปัดที่ 5 ตำแหน่ง — INVARIANTS A2
 *  ทุกผลลัพธ์ที่เป็นยอดต้องผ่านตัวนี้ ไม่งั้นการบวกลบ float สะสมจะได้ 0.30000000000000004 */
export const round5 = n => Math.round(n * 1e5) / 1e5;

/**
 * ชนิดการเคลื่อนไหวทั้งหมดที่ระบบรู้จัก
 *
 *   sign    ผลกับยอด · 0 แปลว่าไม่ตายตัว ต้องดูที่ signedQty()
 *   lot     บังคับกรอกเลขล็อตไหม
 *   reason  บังคับเลือกเหตุผลไหม
 *   doc     บังคับอ้างเอกสารไหม
 */
export const KINDS = {
  open:     { label: 'ยกยอดมา',  sign: +1, lot: false, reason: false, doc: false },
  receive:  { label: 'รับเข้า',   sign: +1, lot: true,  reason: false, doc: true  },
  issue:    { label: 'จ่ายออก',   sign: -1, lot: false, reason: false, doc: false },
  return:   { label: 'คืนของ',    sign: +1, lot: false, reason: true,  doc: false },
  scrap:    { label: 'ของเสีย',   sign: -1, lot: false, reason: true,  doc: false },
  adjust:   { label: 'ปรับยอด',   sign:  0, lot: false, reason: true,  doc: false },
  transfer: { label: 'โอนย้าย',   sign:  0, lot: false, reason: false, doc: false }
};

/**
 * เหตุผลต้องเลือกจากรายการ ห้ามพิมพ์อิสระ
 *
 * ถ้าปล่อยให้พิมพ์เอง อีกหกเดือนจะตอบไม่ได้ว่าของหายไปกับอะไรมากที่สุด
 * เพราะจะได้ "พันเสีย" "พันเสีย " "เสียตอนพัน" "wind เสีย" ปนกันหมด
 * ช่อง note มีไว้ให้เขียนรายละเอียดเพิ่ม ไม่ใช่ให้แทนการเลือก
 */
export const REASONS = {
  scrap: [
    { code: 'wind',   label: 'พันเสีย' },
    { code: 'damage', label: 'ตกพื้น / ชำรุด' },
    { code: 'expire', label: 'หมดอายุ' },
    { code: 'qc',     label: 'ตรวจไม่ผ่าน' },
    { code: 'other',  label: 'อื่น ๆ (ต้องเขียนเพิ่ม)' }
  ],
  adjust: [
    { code: 'count',  label: 'นับได้ไม่ตรงสมุด' },
    { code: 'keyerr', label: 'คีย์ผิดแล้วเพิ่งรู้' },
    { code: 'found',  label: 'เจอของที่ไม่เคยบันทึก' },
    { code: 'other',  label: 'อื่น ๆ (ต้องเขียนเพิ่ม)' }
  ],
  return: [
    { code: 'over',   label: 'เบิกเกินแล้วเอากลับ' },
    { code: 'unused', label: 'ทำไม่ทัน คืนเข้าคลัง' },
    { code: 'other',  label: 'อื่น ๆ (ต้องเขียนเพิ่ม)' }
  ]
};

/**
 * ผลของรายการนี้ต่อยอด — เป็นบวกคือเพิ่ม เป็นลบคือลด
 *
 * ⚠️ ปรับยอดคือข้อยกเว้นเดียวในระบบที่ qty ไม่พอบอกทิศ
 * เพราะปรับได้ทั้งขึ้นและลง จึงเก็บ delta แยกไว้แบบมีเครื่องหมาย
 * และแช่แข็งไว้ตั้งแต่ตอนบันทึก ไม่คำนวณใหม่ตอนอ่าน
 * (ถ้าคำนวณใหม่ตอนอ่าน ยอดในอดีตจะขยับเองเมื่อมีรายการอื่นแทรกเข้ามาทีหลัง)
 */
export function signedQty(e) {
  if (e.kind === 'adjust') return round5(e.delta || 0);
  return round5((KINDS[e.kind]?.sign ?? 0) * (e.qty || 0));
}

/** รายการที่ถูกยกเลิกไม่นับเข้ายอด แต่ยังอยู่ในสมุดให้เห็น — INVARIANTS B */
export const counts = e => !e.voided;

const isNum = v => typeof v === 'number' && isFinite(v);

/**
 * สร้างรายการใหม่พร้อมตรวจความครบถ้วน
 * โยน Error ถ้าไม่ผ่าน — ตั้งใจให้ดังตั้งแต่ตอนเขียน ไม่ใช่ปล่อยของพิการเข้าสมุด
 */
export function makeEntry(input) {
  const k = KINDS[input.kind];
  if (!k) throw new Error(`ไม่รู้จักชนิดการเคลื่อนไหว "${input.kind}"`);
  if (!input.entity) throw new Error('ต้องระบุนิติบุคคล — INVARIANTS A3');
  if (!input.material_code) throw new Error('ต้องระบุรหัสวัตถุดิบ');
  if (!input.person) throw new Error('ต้องระบุคนบันทึก');

  const e = {
    id: input.id || newId(),
    entity: String(input.entity),
    kind: input.kind,
    material_code: String(input.material_code),
    lot: String(input.lot || ''),
    lot_inferred: !!input.lot_inferred,
    qty: 0,
    location: '',            // จองช่องไว้ ยังไม่ใช้ — ตัดสินแล้ว 12 ส.ค. ว่ายังไม่เก็บที่เก็บของ
    doc_kind: String(input.doc_kind || ''),
    doc_ref: String(input.doc_ref || ''),
    part_no: String(input.part_no || ''),
    at: input.at || new Date().toISOString(),
    person: String(input.person),
    device: String(input.device || ''),
    reason_code: String(input.reason_code || ''),
    note: String(input.note || ''),
    expiry_date: String(input.expiry_date || ''),
    reqmt_qty: isNum(input.reqmt_qty) ? round5(input.reqmt_qty) : null,
    issued_qty: isNum(input.issued_qty) ? round5(input.issued_qty) : null,
    counted_qty: null,
    delta: null,
    voided: false, void_reason: '', void_by: '', void_at: '',
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (input.kind === 'adjust') {
    // ปรับยอดเก็บสองตัวเลข ไม่ใช่ตัวเดียว
    //   counted_qty  ที่นับได้จริง
    //   delta        ส่วนต่างที่คำนวณ ณ ตอนบันทึก แล้วแช่แข็ง
    // ถ้าเก็บแค่ส่วนต่าง ข้อมูลว่านับได้เท่าไหร่จะหายไปตลอดกาล
    // แล้วอ่านย้อนหลังจะเหลือแค่ "ปรับลง 5" ซึ่งบอกไม่ได้ว่าปรับจากอะไรไปอะไร
    if (!isNum(input.counted_qty)) throw new Error('ปรับยอดต้องระบุจำนวนที่นับได้');
    if (!isNum(input.book_qty))    throw new Error('ปรับยอดต้องระบุยอดในสมุด ณ ตอนนั้น');
    e.counted_qty = round5(input.counted_qty);
    e.delta = round5(input.counted_qty - input.book_qty);
    e.qty = round5(Math.abs(e.delta));
  } else {
    if (!isNum(input.qty) || input.qty <= 0) {
      // qty เป็นบวกเสมอทุกชนิด — ทิศทางเป็นหน้าที่ของ kind
      throw new Error('จำนวนต้องเป็นตัวเลขมากกว่าศูนย์');
    }
    e.qty = round5(input.qty);
  }

  if (k.lot && !e.lot) throw new Error(`${k.label} ต้องระบุเลขล็อต`);
  if (k.doc && !e.doc_ref) throw new Error(`${k.label} ต้องอ้างอิงเอกสาร`);
  if (k.reason) {
    const ok = (REASONS[input.kind] || []).some(r => r.code === e.reason_code);
    if (!ok) throw new Error(`${k.label} ต้องเลือกเหตุผลจากรายการที่กำหนด`);
    if (e.reason_code === 'other' && !e.note) {
      throw new Error('เลือก "อื่น ๆ" แล้วต้องเขียนอธิบายเพิ่ม');
    }
  }
  return e;
}

/** ยกเลิกรายการ — ไม่ลบทิ้ง เพราะสมุดต้องเขียนเพิ่มได้อย่างเดียว (INVARIANTS B) */
export function voidEntry(e, { by, reason }) {
  if (!reason) throw new Error('ยกเลิกรายการต้องบอกเหตุผล');
  if (!by) throw new Error('ยกเลิกรายการต้องบอกว่าใครยกเลิก');
  return { ...e, voided: true, void_reason: String(reason), void_by: String(by),
           void_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

let seq = 0;
function newId() {
  // ต้องไม่ชนกันข้ามเครื่องที่คีย์พร้อมกันโดยไม่มีเน็ต จึงผสมเวลา ตัวนับ และตัวสุ่ม
  seq = (seq + 1) % 1000;
  return 'E' + Date.now().toString(36) + seq.toString(36).padStart(2, '0')
       + Math.random().toString(36).slice(2, 6);
}
