/**
 * นิติบุคคล — ยอดคงคลังของแต่ละโรงงานต้องไม่ปนกัน
 *
 * ── ทำไมต้องแยก ─────────────────────────────────────────────────
 * บริษัทมีหลายนิติบุคคลใช้โปรแกรมตัวเดียวกัน ของที่รับเข้าในนามหนึ่ง
 * เอาไปจ่ายในนามอีกอันไม่ได้ ทั้งทางบัญชีและทางเอกสารกับ Delta
 * Bin Card ที่ส่งให้ลูกค้าก็พิมพ์ชื่อนิติบุคคลลงไปบนใบ
 *
 * ทุกฟังก์ชันคำนวณยอดใน core/ บังคับให้ส่ง entity เข้ามาอยู่แล้ว (INVARIANTS A3)
 * ไฟล์นี้เพิ่มส่วนที่ขาดคือ "แล้วรายการนี้เป็นของนิติบุคคลไหน"
 *
 * ⚠️ เปลี่ยนนิติบุคคลที่เลือกอยู่ = เปลี่ยนความหมายของทุกยอดบนหน้าจอ
 * ไม่ใช่แค่การกรอง — ยอดคงเหลือ การ์ด และ Bin Card ที่ออกไป จะเป็นคนละชุดกันเลย
 */

/** ตัวเลือกที่หน้าจอใช้ตอนยังไม่มีใครตั้งอะไรเลย */
export const DEFAULT_ENTITY = 'NSE';

export function makeEntity(input) {
  const code = String(input.entity_code || '').trim().toUpperCase();
  if (!code) throw new Error('ต้องระบุรหัสนิติบุคคล');
  return {
    entity_code: code,
    company_name: String(input.company_name || '').trim(),
    address: String(input.address || '').trim(),
    // ขึ้นหัว Bin Card ทุกใบ จึงต้องผูกกับนิติบุคคล ไม่ใช่ตั้งรวมทั้งโปรแกรม
    store_location: String(input.store_location || '').trim(),
    vendor_no: String(input.vendor_no || '').trim(),
    active: input.active !== false,
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * เดานิติบุคคลจากเลขที่ PO
 *
 * ตัวอักษรตำแหน่งที่ 7 คือตัวท้ายของรหัสนิติบุคคล
 *   TM5266H177 → TUE-H · TM4267U025 → TUE-U · TM....A... → TUE-A
 * v1 ตรวจกับ Po Balance วันที่ 27 ก.ค. แล้วครบทั้ง 747 ใบ ไม่มีข้อยกเว้น
 *
 * ⚠️ เอกสารใบเดียวมีของทั้ง TUE-H และ TUE-U ปนกันได้ (เจอจริงในไฟล์ 25 ก.ค.)
 * จึงต้องดูรายบรรทัด ไม่ใช่ตั้งทั้งใบ ไม่งั้นยอดข้ามโรงงานกันโดยไม่มีอะไรเตือน
 */
export function entityOfPo(po) {
  const m = /^TM\w{4}([A-Z])/i.exec(String(po || '').trim());
  return m ? 'TUE-' + m[1].toUpperCase() : '';
}

/**
 * นิติบุคคลของรายการนี้ ตามลำดับความน่าเชื่อถือ
 *   1. ที่คนบังคับมาทั้งใบ — คนตัดสินใจเองย่อมชนะการเดา
 *   2. ช่อง sub ในรายการ PO — มาจากไฟล์ของ Delta โดยตรง
 *   3. เดาจากเลขที่ PO
 *   4. ตัวที่เลือกอยู่บนหน้าจอ
 *
 * คืน { code, from } เพื่อให้หน้าจอบอกได้ว่าค่านี้มาจากไหน
 * ค่าที่เดามาต้องดูออกว่าเป็นการเดา — กฎเดียวกับล็อตและหน่วย TP
 */
export function resolveEntity(po, { forced = '', poList = [], current = '' } = {}) {
  if (forced) return { code: forced, from: 'forced' };
  const hit = poList.find(p => String(p.po) === String(po || '').trim());
  if (hit && hit.sub) return { code: String(hit.sub).trim().toUpperCase(), from: 'po' };
  const guess = entityOfPo(po);
  if (guess) return { code: guess, from: 'guess' };
  return { code: current, from: 'current' };
}

/** รหัสที่ใช้งานอยู่ เรียงตามตัวอักษร */
export const activeCodes = list =>
  list.filter(e => e.active !== false).map(e => e.entity_code).sort();

/** ข้อมูลของนิติบุคคลหนึ่ง — ใช้ตอนออก Bin Card */
export const infoOf = (list, code) =>
  list.find(e => e.entity_code === String(code || '').trim().toUpperCase()) || null;

/**
 * รหัสที่โผล่ในข้อมูลแต่ยังไม่มีในทะเบียนนิติบุคคล
 * เช่นเดาจาก PO ได้ TUE-U แต่ยังไม่มีใครสร้าง TUE-U ไว้
 * ต้องบอกให้เห็น ไม่ใช่ปล่อยให้ยอดไปกองอยู่ใต้ชื่อที่ไม่มีในระบบ
 */
export function unknownEntities(list, used) {
  const have = new Set(list.map(e => e.entity_code));
  return [...new Set(used.filter(Boolean).map(c => String(c).toUpperCase()))]
    .filter(c => !have.has(c)).sort();
}
