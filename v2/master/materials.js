/**
 * ทะเบียนวัตถุดิบ — สร้างและแก้ในโปรแกรมนี้เลย ไม่มีแอปแยก ไม่มี xlsx กลางทาง
 *
 * ── ทะเบียนถูกสร้างจากของจริง ────────────────────────────────────
 * ตอนเปิดระบบ พนักงานเดินนับของทั้งคลัง ทุกกล่องที่หยิบขึ้นมานับคือของที่ต้องมีในทะเบียน
 * อะไรที่ไม่เจอบนชั้นก็ไม่ต้องมี — ต่างจาก v1 ที่ทะเบียนมาจากไฟล์ 12,259 แถวของ Delta
 * ซึ่งไม่มีใครรู้ว่าอันไหนยังใช้อยู่จริง
 *
 * และเพราะเพิ่มรหัสได้จากหน้าคีย์เลย ทะเบียนไม่จำเป็นต้องครบตั้งแต่วันแรก
 */

/** หมวดหมู่ที่ใช้ได้ */
export const CATEGORIES = ['CORE', 'WIRE', 'TAPE', 'TUBE', 'BOBBIN', 'BASE', 'INSULATOR',
                           'LABEL', 'CHEMICAL', 'METAL PART', 'ELECTRONIC', 'PACKING',
                           'FG/SEMI', 'OTHER'];

const CAT_RULES = [
  ['CORE',       ['CORE']],
  ['WIRE',       ['WIRE', 'LITZ']],
  ['TAPE',       ['TAPE']],
  ['TUBE',       ['TUBE']],
  ['BOBBIN',     ['BOBBIN', 'BIBBIN']],
  ['BASE',       ['BASE', 'BASELUG']],
  ['INSULATOR',  ['INSULATOR', 'MYLAR', 'MYKAR', 'SHEET', 'COVER']],
  ['LABEL',      ['LABEL']],
  ['CHEMICAL',   ['ADHESIVE', 'THINNER', 'VARNISH', 'ACTIVATOR', 'FLUX', 'INK', 'EPOXY',
                  'RTV', 'GLUE', 'SOLDER', 'CLEANER', 'RESIN', 'COATING', 'PEN']],
  ['METAL PART', ['TERMINAL', 'STRIP', 'BUS', 'CLIP', 'FOIL', 'COPPER', 'PIN', 'FRAME',
                  'SCREW', 'HSK', 'SHIELD', 'CONDUCT PLATE']],
  ['ELECTRONIC', ['RES', 'FUSE', 'CAP', 'DIODE', 'NTC', 'PTC', 'THERMAL']],
  ['PACKING',    ['FOAM', 'PARTITION', 'TRAY', 'CARTON', 'PAD', 'DIVIDER', 'PALLET',
                  'ANGLE', 'CARRIER', 'BAG', 'FILM', 'STRAPING', 'BOX', 'STOPPER']],
  // ⚠️ PML ยังไม่ย้ายมา PACKING ทั้งที่มีเค้าว่าน่าจะใช่ (รหัสอยู่ช่วง 35 เหมือนแพ็กกิ้ง
  // และใน BOM ใช้หน่วย TP เหมือนแพ็กกิ้ง) แต่ยังไม่รู้ว่าย่อมาจากอะไร และมีถึง 209 รายการ
  // การย้ายด้วยการเดาจึงเสี่ยงเกินไป — คงไว้ที่ FG/SEMI เหมือน v1 จนกว่าจะถาม Delta ได้
  ['FG/SEMI',    ['INDUCTOR', 'TRANSFORMER', 'LINE FILTER', 'COIL', 'CHOKE', 'TEONEX',
                  'XFMR', 'PML']]
];

/**
 * เดาหมวดจากคำอธิบาย
 *
 * ⚠️ คำค้นต้อง "จบคำ" ด้วย ไม่ใช่แค่ขึ้นต้นคำ
 * v1 เขียน d.startsWith(k) || (' '+d).includes(' '+k) ซึ่งไม่ได้บังคับท้ายคำ
 * ผลคือ PIN (หมวดโลหะ) ไปตรงกับ PINK แล้ว FOAM PAD ... PINK ถูกจัดเป็น METAL PART
 * ทั้งที่เป็นแพ็กกิ้ง — วัดจากทะเบียนจริงแล้วผิดแบบนี้ 40 รายการ
 */
export function categorize(desc) {
  const d = String(desc || '').replace(/^(EOL\(PFR\)|EOL)\s*/i, '').trim().toUpperCase();
  if (!d) return 'OTHER';
  for (const [name, keys] of CAT_RULES) {
    for (const k of keys) {
      // ต้องอยู่ต้นคำ และตัวถัดจากคำค้นต้องไม่ใช่ตัวอักษรหรือตัวเลข
      const re = new RegExp('(?:^|\\s)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Z0-9])');
      if (re.test(d)) return name;
    }
  }
  return 'OTHER';
}

export const normCode = c => String(c == null ? '' : c).trim().toUpperCase();

/**
 * ตรวจรูปแบบรหัส — เตือน ไม่บล็อก
 *
 * ⚠️ ห้ามบล็อกเด็ดขาด เพราะทางตันคือสิ่งที่ v2 ตั้งใจกำจัด
 * ถ้ารหัสแปลกแต่ของอยู่ตรงหน้าจริง พนักงานต้องบันทึกได้ แล้วให้เจ้าของมาดูทีหลัง
 */
export function checkCode(code) {
  const c = normCode(code);
  if (!c) return { level: 'bad', msg: 'ยังไม่ได้กรอกรหัส' };
  if (/\s/.test(c)) return { level: 'bad', msg: 'รหัสมีช่องว่างปนอยู่' };

  // รหัสของ Delta คือ 9–11 ตัว ขึ้นต้นด้วยตัวเลข บางตัวมีอักษรต่อท้าย เช่น 3170383400M
  if (!/^\d{2}/.test(c) || c.length < 9 || c.length > 11) {
    return { level: 'warn',
             msg: 'รูปแบบไม่เหมือนรหัสของ Delta (ปกติเป็นตัวเลข 9–10 ตัว) — ตรวจกับกล่องอีกครั้ง' };
  }
  // ช่วง 28 คือของที่ทำเองหรือกึ่งสำเร็จรูป ไม่ใช่วัตถุดิบที่รับเข้าคลัง
  // วัดจากทะเบียนจริง 4,072 รายการในช่วงนี้เป็นของทำเองทั้งหมด
  if (c.startsWith('28')) {
    return { level: 'warn',
             msg: 'รหัสขึ้นต้นด้วย 28 มักเป็นของที่เราทำเอง ไม่ใช่วัตถุดิบที่ Delta ส่งมา — แน่ใจแล้วใช่ไหม' };
  }
  return { level: 'ok', msg: '' };
}

export function makeMaterial(input) {
  const code = normCode(input.material_code);
  if (!code) throw new Error('ต้องระบุรหัสวัตถุดิบ');
  const desc = String(input.description || '').trim();
  const cat = CATEGORIES.includes(input.category) ? input.category : categorize(desc);
  return {
    material_code: code,
    description: desc,
    unit: String(input.unit || '').trim().toUpperCase(),
    category: cat,
    requires_expiry: input.requires_expiry === true || cat === 'CHEMICAL',
    active: input.active !== false,
    source: String(input.source || 'มือ'),     // มือ · นับ · sap
    note: String(input.note || ''),
    needs_review: input.needs_review === true,
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/** รหัสที่พนักงานเพิ่มเองหน้างาน ติดธงไว้ให้เจ้าของตรวจตอนพักเที่ยง */
export const addedOnFloor = (input, person) =>
  makeMaterial({ ...input, source: 'มือ', needs_review: true,
                 note: [input.note, 'เพิ่มโดย ' + person].filter(Boolean).join(' · ') });

const norm = s => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * ค้นหาวัตถุดิบสำหรับช่องเลือกรหัส
 *
 * ── ปัญหาที่แก้ ──────────────────────────────────────────────────
 * v1 ใช้ <datalist> ที่แสดงคำอธิบายอย่างเดียว ในทะเบียนที่ active อยู่
 * มี 32 คำอธิบายที่ซ้ำกันเป๊ะ เช่น FOAM PAD EPE 265*230*5 PINK มี 3 รหัส
 * และ DIVIDER TRAY EPE 265*230*46 PINK มี 5 รหัส — บนหน้าจอแยกกันไม่ออกเลย
 * ซึ่งกลายเป็น issue #26 "รายการวัตถุดิบซ้ำกัน"
 *
 * ที่นี่จึงคืนธง dupDesc มาด้วย ให้หน้าจอเน้นรหัสเป็นพิเศษเมื่อชื่อซ้ำกับตัวอื่น
 */
export function searchMaterials(list, q, { limit = 40, activeOnly = true } = {}) {
  const term = norm(q);
  const pool = activeOnly ? list.filter(m => m.active !== false) : list;

  const seen = new Map();
  for (const m of pool) {
    const d = norm(m.description);
    if (d) seen.set(d, (seen.get(d) || 0) + 1);
  }

  const scored = [];
  for (const m of pool) {
    const code = normCode(m.material_code);
    const d = norm(m.description);
    let score = -1;
    if (!term)                       score = 0;
    else if (code === term)          score = 100;
    else if (code.startsWith(term))  score = 80;
    else if (d.startsWith(term))     score = 60;
    else if (code.includes(term))    score = 40;
    else if (d.includes(term))       score = 30;
    if (score < 0) continue;
    scored.push({ ...m, _score: score, dupDesc: (seen.get(d) || 0) > 1 });
  }
  scored.sort((a, b) => b._score - a._score
    || String(a.description).localeCompare(String(b.description))
    || String(a.material_code).localeCompare(String(b.material_code)));
  return scored.slice(0, limit);
}

/** คำอธิบายที่ซ้ำกันในกลุ่มที่ใช้งานอยู่ — ให้เจ้าของไล่เก็บทีหลัง */
export function duplicateDescriptions(list) {
  const by = new Map();
  for (const m of list) {
    if (m.active === false) continue;
    const d = norm(m.description);
    if (!d) continue;
    (by.get(d) || by.set(d, []).get(d)).push(normCode(m.material_code));
  }
  return [...by.entries()]
    .filter(([, codes]) => codes.length > 1)
    .map(([desc, codes]) => ({ description: desc, codes: codes.sort() }))
    .sort((a, b) => b.codes.length - a.codes.length);
}
