/**
 * ซิงค์ขึ้น Google Sheets — ส่วนที่คิด ไม่ใช่ส่วนที่ยิงเน็ต
 *
 * ไฟล์นี้ไม่รู้จัก fetch และไม่รู้จัก IndexedDB ตั้งใจให้เทสด้วย node ล้วนได้
 * เพราะตรรกะการรวมข้อมูลคือจุดที่ผิดแล้วข้อมูลหาย และเป็นจุดที่เทสยากที่สุดถ้าผูกกับเน็ต
 *
 * ── บทเรียนจาก v1 ที่ยกมาทั้งหมด ─────────────────────────────────
 * 1. ห้ามทับแถวที่เครื่องเรายังส่งไม่สำเร็จ (dirty) ไม่ว่าเวลาฝั่งโน้นจะใหม่แค่ไหน
 * 2. หลังส่งขึ้นสำเร็จ ต้องเอาเวลาของเซิร์ฟเวอร์มาเขียนทับเวลาในเครื่อง
 *    ไม่งั้นถ้านาฬิกาเครื่องเดินเร็วกว่าเซิร์ฟเวอร์ การแก้จากเครื่องอื่นจะถูกมองข้ามตลอดไป
 * 3. ตารางใหม่ต้องห่อ try/catch แยก ถ้าเซิร์ฟเวอร์ยังเป็นสคริปต์เวอร์ชันเก่า
 *    รายการเคลื่อนไหวต้องยังซิงค์ได้ ไม่ใช่พังทั้งระบบ
 *
 * ── ที่ v2 ต่างจาก v1 ────────────────────────────────────────────
 * v1 ส่งทะเบียนขึ้นแบบเขียนทับทั้งชีตและกรองเอาเฉพาะ active
 * ผลคือรหัสที่ปิดใช้งานหายจากเซิร์ฟเวอร์ถาวร และเป็นรากของ INVARIANTS E3
 * v2 จึง upsert ทีละแถวเสมอ ไม่มีคำสั่งไหนในระบบที่เขียนทับทั้งตาราง
 */

/** ตารางที่ซิงค์ และกุญแจของแต่ละตาราง */
export const TABLES = {
  entries:   { key: 'id',            label: 'รายการเคลื่อนไหว', sheet: 'Entries' },
  materials: { key: 'material_code', label: 'ทะเบียนวัตถุดิบ',  sheet: 'Materials' },
  bom:       { key: 'id',            label: 'BOM',              sheet: 'BOM' },
  pos:       { key: 'id',            label: 'รายการ PO',        sheet: 'POs' },
  kits:      { key: 'id',            label: 'Kit List',         sheet: 'Kits' },
  shorts:    { key: 'id',            label: 'ของขาด',           sheet: 'Shorts' },
  entities:  { key: 'entity_code',   label: 'นิติบุคคล',        sheet: 'Entities' }
};

/**
 * ล้าง URL ของ Apps Script ที่ก๊อปมาให้ใช้งานได้จริง
 *
 * ── ทำไมต้องล้าง ────────────────────────────────────────────────
 * URL ตัวนี้ยาวเจ็ดสิบกว่าตัวอักษร ผู้ใช้ต้องก๊อปข้ามหน้าจอมาวาง
 * ของที่ติดมาด้วยแล้วมองไม่เห็นในช่องกรอกมีหลายอย่าง — ช่องว่างท้าย ขึ้นบรรทัด
 * zero-width space จากการก๊อปในเว็บ หรือเครื่องหมายคำพูดจากการก๊อปในเอกสาร
 *
 * ผลของอักขระพวกนี้คือ Google ตอบ 404 ซึ่งหน้าตาเหมือน "URL ผิด" ทุกประการ
 * คนก็จะไปไล่ deploy ใหม่ทั้งที่ deployment ไม่มีอะไรผิดเลย
 *
 * คืน problems มาด้วยแทนที่จะแก้เงียบ ๆ อย่างเดียว เพราะบางอย่างต้องให้คนรู้
 * เช่นวาง URL ของ /dev มาแทน /exec — อันนั้นแก้ให้เองไม่ได้ ต้องไปก๊อปใหม่
 */
export function normalizeScriptUrl(raw) {
  const problems = [];
  let s = String(raw == null ? '' : raw);

  // zero-width / BOM / อักขระควบคุม — มองไม่เห็นในช่องกรอกแต่ทำให้ URL พัง
  // เขียนเป็นรหัสยูนิโคด เพราะถ้าเขียนเป็นตัวอักษรจริงจะมองไม่เห็นในโค้ดเหมือนกัน
  const INV = '[\u0000-\u001f\u007f\u00a0\u200b-\u200f\u2028\u2029\u202f\u2060\ufeff]';
  if (new RegExp(INV).test(s)) {
    problems.push('มีอักขระที่มองไม่เห็นปนอยู่');
    s = s.replace(new RegExp(INV, 'g'), '');
  }

  // ช่องว่างหน้า-หลังตัดทิ้งได้ก็จริง แต่ต้องบอกด้วย เพราะเป็นสาเหตุที่พบบ่อยที่สุด
  // และคนที่เพิ่งโดน 404 ควรได้รู้ว่ามันเคยมีอะไรติดมา ไม่ใช่แก้ให้เงียบ ๆ แล้วจบ
  if (/^\s|\s$/.test(s)) problems.push('มีช่องว่างติดมาหน้าหรือหลัง URL');

  if (/^["'“”‘’]|["'“”‘’]$/.test(s.trim())) { problems.push('มีเครื่องหมายคำพูดติดมา'); }
  s = s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  if (/\s/.test(s)) { problems.push('มีช่องว่างปนอยู่กลาง URL'); s = s.replace(/\s+/g, ''); }

  // ท้าย /exec ห้ามมีอะไรต่อ — /exec/ ก็ 404 เหมือนกัน
  if (/\/exec\/+$/.test(s)) { problems.push('มีเครื่องหมาย / เกินมาท้าย /exec'); }
  s = s.replace(/\/+$/, '');

  if (!s) return { url: '', problems, fatal: 'ยังไม่ได้ใส่ URL' };

  // ตรวจโดเมนก่อนเสมอ แล้วค่อยตรวจ /dev
  // ถ้าตรวจ /dev ก่อน คนที่วาง https://example.com/dev มาจะถูกบอกว่า "นี่คือ URL ของ /dev"
  // ทั้งที่ปัญหาจริงคือไม่ใช่โดเมนของ Apps Script เลย แล้วเขาจะไปไล่หาผิดทาง
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/(exec|dev)$/.test(s))
    return { url: s, problems,
             fatal: 'ไม่ใช่รูปแบบของ Apps Script — ต้องเป็น https://script.google.com/macros/s/.../exec' };

  if (/\/dev$/.test(s))
    return { url: s, problems,
             fatal: 'นี่คือ URL ของ /dev ซึ่งเปิดได้เฉพาะเจ้าของสคริปต์ — ต้องใช้ /exec จาก Deploy' };

  return { url: s, problems, fatal: '' };
}

/**
 * ตารางที่ประกาศไว้ใน TABLES แต่ยังไม่ได้ต่อสายกับกล่องข้อมูลในแอป
 *
 * ── ทำไมต้องมีฟังก์ชันนี้ ────────────────────────────────────────
 * ตอนเพิ่มตาราง entities เข้า TABLES แล้วลืมต่อสายฝั่งแอป
 * ผลคือซิงค์วิ่งไปหกตารางแล้วพังที่ตารางที่เจ็ด ด้วยข้อความ
 * "Cannot read properties of undefined (reading 'value')"
 * ซึ่งไม่ได้บอกเลยว่าตารางไหน และดูเหมือนเป็นปัญหาการตั้งค่าของผู้ใช้
 *
 * ของแบบนี้ต้องดังตั้งแต่ตอนเปิดโปรแกรม ไม่ใช่ตอนคนกดซิงค์แล้วรอเก้อ
 */
export const missingTables = map =>
  Object.keys(TABLES).filter(t => !map || !map[t]);

/**
 * Google Sheets คืนค่ามาเป็นได้ทั้ง string, number, boolean และ Date
 * รหัสวัตถุดิบที่เป็นตัวเลขล้วนจะกลายเป็น number ถ้าไม่ระวัง
 * และเวลา ISO อาจกลายเป็น Date object เมื่อชีตตีความเอง
 */
export const asText = v => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

export const asBool = v =>
  v === true || String(v).trim().toUpperCase() === 'TRUE';

export const asNum = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/**
 * คอลัมน์ที่ถูกเอาไปเทียบกับคอลัมน์อื่นเสมอ จึงต้องเป็นข้อความเท่านั้น
 *
 * ── บั๊กที่ทำให้ต้องมีบรรทัดพวกนี้ (v1 issue #36) ────────────────
 * Google Sheets เก็บรหัสที่เป็นเลขล้วนไว้เป็น "ตัวเลข" พอดึงกลับมาแล้วเอาไปเทียบ
 * กับรหัสที่เป็น "ข้อความ" ด้วย === หรือ Map.has() จะไม่ตรงแบบเงียบ ๆ ไม่มี error สักตัว
 * ของจริงทำให้คอลัมน์ยอดตามสูตรในหน้ารับเข้าว่างทั้งใบ ทั้งที่ BOM มีข้อมูลครบ
 *
 * ⚠️ ต้องซ่อมที่ขาเข้าทุกทาง ไม่ใช่แค่ตอนซิงค์
 * แถวที่ค้างอยู่ในเครื่องมาก่อนแล้วมี updated_at ไม่ขยับ จะไม่ถูกเขียนทับจากการซิงค์
 * ถ้าไม่ซ่อมตอนโหลดขึ้นมาด้วย มันจะพังค้างอยู่อย่างนั้นตลอดไป
 *
 * doc_ref ต้องอยู่ในลิสต์นี้ด้วยเสมอ เพราะเป็นช่อง PO ของรายการเคลื่อนไหว
 * ซึ่งถูกเอาไปเทียบกับ po ของ Kit List และรายการ PO ที่บังคับเป็นข้อความไปแล้ว
 */
export const KEY_COLS = ['material_code', 'part_no', 'doc_ref', 'code', 'pn', 'po',
                         'entity', 'entity_code', 'lot', 'id'];

export function normKeys(row) {
  if (row) for (const c of KEY_COLS) if (typeof row[c] === 'number') row[c] = String(row[c]);
  return row;
}

export const normKeysAll = list => Array.isArray(list) ? list.map(normKeys) : list;

/** แถวที่ยังไม่ได้ส่งขึ้น */
export const dirtyRows = list => list.filter(r => r && r.dirty === true);

/**
 * รวมแถวที่ดึงมาเข้ากับของในเครื่อง — ใครแก้ทีหลังชนะ
 *
 * ⚠️ ยกเว้นแถวที่เครื่องเรายังส่งไม่สำเร็จ ห้ามทับเด็ดขาด
 * ถ้าทับ งานที่พนักงานเพิ่งคีย์จะหายไปเงียบ ๆ ตอนเน็ตกลับมา
 * ซึ่งเป็นความเสียหายที่มองไม่เห็นจนกว่าจะมีคนทักว่ายอดไม่ตรง
 */
export function mergeIncoming(local, incoming, key = 'id') {
  const byKey = new Map(local.map(r => [asText(r[key]), r]));
  const added = [], updated = [];
  let heldBack = 0;
  for (const raw of incoming) {
    normKeys(raw);                    // ซ่อมชนิดก่อนเทียบเสมอ — issue #36
    const k = asText(raw[key]);
    if (!k) continue;
    const cur = byKey.get(k);
    if (!cur) { added.push({ ...raw, dirty: false }); continue; }
    if (cur.dirty === true) { heldBack++; continue; }
    if (asText(raw.updated_at) > asText(cur.updated_at)) {
      updated.push({ ...cur, ...raw, dirty: false });
    }
  }
  return { added, updated, heldBack, changed: added.length + updated.length };
}

/**
 * ปิดธง dirty หลังส่งขึ้นสำเร็จ พร้อมรับเวลาเซิร์ฟเวอร์มาใช้
 * (บทเรียนข้อ 2 — ห้ามเก็บเวลาของเครื่องตัวเองไว้หลังส่งสำเร็จ)
 */
export const markSynced = (rows, serverTime) =>
  rows.map(r => ({ ...r, dirty: false, updated_at: serverTime || r.updated_at }));

/**
 * ตัดเป็นก้อนก่อนส่ง
 *
 * Apps Script มีเพดานเวลาทำงาน 6 นาทีต่อครั้ง และ setValues ทีละมาก ๆ ช้ากว่าที่คิด
 * ตอนเปิดระบบครั้งแรกจะมีทะเบียนเป็นพันแถวขึ้นไปพร้อมกัน ถ้าส่งก้อนเดียวจะไปไม่ถึง
 * ส่งทีละก้อนแล้วรายงานความคืบหน้าดีกว่าค้างแล้วไม่รู้ว่าถึงไหน
 */
export function chunk(rows, size = 300) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** เอาของที่ใช้ในเครื่องอย่างเดียวออกก่อนส่ง */
export function toWire(row) {
  const o = { ...row };
  delete o.dirty;
  return o;
}

/**
 * สรุปว่ารอบนี้จะเกิดอะไรขึ้น — ใช้ทั้งบอกผู้ใช้ก่อนกด และเขียนลง log หลังทำ
 * นับแยกรายตาราง เพราะ "ส่งขึ้น 500" ไม่บอกอะไรถ้าไม่รู้ว่าเป็นทะเบียนหรือรายการเคลื่อนไหว
 */
export function syncPlan(store) {
  const per = {};
  let total = 0;
  for (const t of Object.keys(TABLES)) {
    const n = dirtyRows(store[t] || []).length;
    per[t] = n;
    total += n;
  }
  return { per, total };
}

/** เซิร์ฟเวอร์ยังเป็นสคริปต์เวอร์ชันเก่าหรือเปล่า — ดูจากข้อความที่ตอบกลับมา */
export const looksLikeOldScript = msg =>
  /ไม่รู้จัก(คำสั่ง|ตาราง)/.test(String(msg || ''));
