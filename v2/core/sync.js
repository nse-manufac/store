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
  // ชีตชื่อ Shorts มาแต่เดิม แต่ตั้งแต่ ก.ย. 2026 เก็บงานตามสามแบบ (ขาด · เกิน · ซื้อทดแทน)
  // ⚠️ ห้ามเปลี่ยน sheet — ข้อมูลของพนักงานอยู่ใต้ชื่อนั้น เปลี่ยนแล้วเครื่องที่ยังไม่อัปเดตจะมองคนละชีต
  shorts:    { key: 'id',            label: 'ตามงานวัตถุดิบ',   sheet: 'Shorts' },
  entities:  { key: 'entity_code',   label: 'นิติบุคคล',        sheet: 'Entities' },
  // WK ที่พิมพ์เองในแท็บ MRP (เจ้าของสั่ง 15 พ.ย. 2026) — แยกจากชีต POs เพื่อไม่ให้นำเข้าไฟล์ PO ใหม่แล้ว WK หาย
  weeks:     { key: 'id',            label: 'WK ที่พิมพ์เอง',     sheet: 'PoWeeks' }
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

const VOID_COLS = ['voided', 'void_reason', 'void_by', 'void_at'];
const voidOf = r => Object.fromEntries(VOID_COLS.map(c => [c, r[c]]));

/**
 * รวมแถวที่ดึงมาเข้ากับของในเครื่อง — ใครแก้ทีหลังชนะ
 *
 * ⚠️ ยกเว้นแถวที่เครื่องเรายังส่งไม่สำเร็จ ห้ามทับเด็ดขาด
 * ถ้าทับ งานที่พนักงานเพิ่งคีย์จะหายไปเงียบ ๆ ตอนเน็ตกลับมา
 * ซึ่งเป็นความเสียหายที่มองไม่เห็นจนกว่าจะมีคนทักว่ายอดไม่ตรง
 *
 * stickyVoid — ยกเลิกแล้วไม่ย้อน (เปิดให้ตาราง entries · เจ้าของเคาะ 24 ก.ย. 2026)
 * ตั้งแต่เติมวันหมดอายุทีหลังได้ (setExpiry) แถวในสมุดถูกแก้ได้จากสองเครื่อง
 * เครื่องที่ยังไม่รู้ว่ารายการถูกยกเลิก ส่งแถวที่เติมแล้วขึ้นไปทับ → รายการฟื้นกลับมานับยอดเงียบ ๆ
 * v2 ไม่มีทางยกเลิกการยกเลิก (INVARIANTS B1) ถ้าฝั่งไหนยกเลิกแล้ว ผลต้องเป็นยกเลิก:
 * เครื่องเรายกเลิกไว้ แถวที่ดึงมาไม่ได้ยกเลิก → รับช่องอื่นมา คงการยกเลิก แล้วติด dirty
 * ให้ส่งกลับขึ้นไปซ่อมเซิร์ฟเวอร์ (เซิร์ฟเวอร์ใครส่งทีหลังชนะ แก้ฝั่งนั้นต้อง redeploy)
 * เครื่องไหนเคยเห็นการยกเลิกก็ซ่อมให้ได้ ทุกเครื่องจึงกลับมาเป็นยกเลิกเมื่อซิงค์ครบ
 * ⚠️ แถวที่เรายังส่งไม่ออกยังห้ามแตะตาม D3 แม้ฝั่งโน้นจะยกเลิกแล้ว — ส่งขึ้นไปแล้วเครื่องอื่นซ่อมให้
 */
export function mergeIncoming(local, incoming, key = 'id', { stickyVoid = false } = {}) {
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
      const back = stickyVoid && asBool(cur.voided) && !asBool(raw.voided);
      updated.push(back ? { ...cur, ...raw, ...voidOf(cur), dirty: true } : { ...cur, ...raw, dirty: false });
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
 * หลังส่งก้อนหนึ่งขึ้นสำเร็จ — ปิดธงเฉพาะแถวที่ยังเป็นของที่ส่งไปจริง
 *
 * ระหว่างรอเซิร์ฟเวอร์ตอบ (2–35 วินาที) พนักงานแก้แถวเดิมต่อได้ เช่น กดยกเลิกรายการ
 * ของเดิมปิดธงทุกแถวในก้อนแล้วเขียนสำเนาตอนส่งทับลงเครื่อง → การยกเลิกหายจากในเครื่อง
 * และไม่ถูกส่งขึ้นอีกเลย (D3 · D7 · ตรวจทั้งโปรแกรม 14 พ.ย. 2026)
 *
 * ปิดธงได้ก็ต่อเมื่อแถวในรายการตอนนี้ยังเป็นอ็อบเจกต์เดิม และเนื้อในยังตรงกับที่ส่ง
 *   ถูกแทนด้วยอ็อบเจกต์ใหม่ (ยกเลิก · เติมวันหมดอายุ · เอาเรื่องกลับ) → คงธงไว้ ไม่เขียนทับ
 *   ถูกแก้ในตัว (เติมวันที่ PO · ตั้ง WK) → คงธงไว้ รอบหน้าส่งของใหม่ขึ้นไป
 * sentJson = JSON ของ toWire(แถว) ตอนส่ง เรียงตามลำดับเดียวกับ part
 * แถวที่ปิดธงถูกแก้ในตัว (dirty · updated_at) แบบเดียวกับของเดิม คืนไว้ให้เขียนลงเครื่อง
 */
export function settlePushed(list, part, sentJson, serverTime, key = 'id') {
  const byKey = new Map((list || []).map(r => [asText(r && r[key]), r]));
  const done = [], kept = [];
  part.forEach((r, i) => {
    const same = byKey.get(asText(r[key])) === r && JSON.stringify(toWire(r)) === sentJson[i];
    (same ? done : kept).push(r);
  });
  for (const r of done) { r.dirty = false; r.updated_at = serverTime || r.updated_at; }
  return { done, kept };
}

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

/**
 * ป้ายสถานะซิงค์บนหัวจอ — เจ้าของขอ 6 ต.ค. 2026 ให้เหมือนของ plan
 * เดิมต้องเข้าแท็บระบบถึงจะรู้ว่าซิงค์อยู่ไหม พังเงียบ ๆ ได้ทั้งวันโดยไม่มีใครเห็น
 *
 * คืน { cls, text, title } · cls = '' (เทา) · ok (เขียว) · busy / pending (เหลือง) · error (แดง)
 * ⚠️ "ok" ดูจาก lastOkAt ไม่ใช่ state — กดทดสอบการเชื่อมต่อผ่าน (state 'ok') ไม่ได้แปลว่าข้อมูลซิงค์แล้ว
 * time = ตัวแปลงเวลาเป็นเวลาเครื่อง (localTime) · today = วันนี้ YYYY-MM-DD ตามเวลาเครื่อง
 *   ส่งเข้ามาแทนที่จะ import เอง — ไฟล์นี้ตั้งใจไม่ผูกกับนาฬิกาเครื่อง เทสด้วย node ได้ตรง ๆ
 */
export function syncBadge({ url = '', state = '', error = '', pending = 0, lastOkAt = '' } = {},
                          { time = iso => String(iso).slice(11, 16), date = iso => String(iso).slice(0, 10), today = '' } = {}) {
  const n = Number(pending) || 0;
  if (!url) return { cls: '', text: 'ยังไม่เชื่อมต่อ', title: 'ยังไม่ได้ตั้งค่าซิงค์ — กดเพื่อไปตั้งค่า' };
  if (state === 'busy') return { cls: 'busy', text: 'กำลังซิงค์...', title: 'กำลังส่งและดึงข้อมูล' };
  if (state === 'error') return { cls: 'error', text: 'ซิงค์ไม่ได้' + (n ? ` · ค้าง ${n}` : ''),
                                  title: (error || 'ซิงค์ไม่สำเร็จ') + ' — กดเพื่อลองใหม่ · รายละเอียดอยู่ที่แท็บระบบ' };
  if (n) return { cls: 'pending', text: `รอส่ง ${n}`, title: `มี ${n} รายการที่ยังไม่ได้ส่งขึ้น — กดเพื่อซิงค์ทันที` };
  if (!lastOkAt) return { cls: '', text: 'ยังไม่เคยซิงค์', title: 'เครื่องนี้ยังไม่เคยซิงค์สำเร็จ — กดเพื่อซิงค์ทันที' };
  const when = (today && date(lastOkAt) !== today ? date(lastOkAt) + ' ' : '') + time(lastOkAt);
  return { cls: 'ok', text: 'ซิงค์แล้ว ' + when, title: 'ซิงค์สำเร็จล่าสุด ' + when + ' — กดเพื่อซิงค์ทันที' };
}

/** เซิร์ฟเวอร์ยังเป็นสคริปต์เวอร์ชันเก่าหรือเปล่า — ดูจากข้อความที่ตอบกลับมา */
export const looksLikeOldScript = msg =>
  /ไม่รู้จัก(คำสั่ง|ตาราง)/.test(String(msg || ''));

/* ═══════════ ซิงค์ให้เครื่องอื่นเห็นเร็ว (เจ้าของสั่ง 28 พ.ย. 2026) ═══════════
 * เดิมซิงค์เต็ม 8 ตารางทุก 2 นาที เครื่องอื่นจึงเห็นของใหม่ช้าได้ถึงราว 4 นาที
 * (รอรอบของเครื่องที่ส่ง แล้วรอรอบของเครื่องที่ดึงอีกชั้น) และยิงเซิร์ฟเวอร์ 8 ครั้งทุกรอบแม้ไม่มีอะไรเปลี่ยน
 * ตอนนี้: บันทึกแล้วส่งเฉพาะตารางที่มีของค้างภายในไม่กี่วินาที · ทุก ~20 วินาทีถามคำเดียวว่าตารางไหนเปลี่ยน
 * (คำสั่ง changes ไม่อ่านชีต ไม่จับ lock) แล้วดึงเฉพาะตารางนั้น · ซิงค์เต็มเหลือเป็นตัวสำรองทุก 10 นาที */
export const ASK_MS = 20000;
export const PUSH_DELAY_MS = 4000;
export const FULL_MS = 10 * 60000;
export const FULL_MS_OLD = 120000;   // สคริปต์รุ่นเก่าที่ยังไม่มี changes · หรือรอบก่อนพัง = ซิงค์เต็มทุก 2 นาทีเหมือนเดิม

/**
 * รอบนี้ทำอะไร: 'full' ซิงค์เต็ม · 'push' ส่งเฉพาะตารางที่มีของค้าง · 'ask' ถามว่าตารางไหนเปลี่ยน · '' ไม่ทำ
 * canAsk = เซิร์ฟเวอร์รู้จัก changes
 * failed = รอบก่อนพัง → กลับไปแบบเดิมทุกอย่าง (ซิงค์เต็มทุก 2 นาที ไม่ส่ง ไม่ถาม ระหว่างนั้น)
 *   ไม่งั้นช่วงเน็ตหลุดหรือเซิร์ฟเวอร์แน่น จะลองส่งซ้ำทุก 20 วินาที ป้ายกะพริบ และไปเพิ่มคิวให้เซิร์ฟเวอร์
 * hidden = แท็บถูกซ่อน → ไม่ถาม (ไม่มีใครดูอยู่ · กลับมาที่หน้าจอแล้วถามทันที) แต่ยังส่งของค้างและซิงค์เต็มตามรอบ
 */
export function syncTick({ now = 0, lastFullAt = 0, pending = 0, hidden = false, canAsk = true, failed = false, busy = false } = {}) {
  if (busy) return '';
  if (now - lastFullAt >= (canAsk && !failed ? FULL_MS : FULL_MS_OLD)) return 'full';
  if (failed) return '';
  if (pending) return 'push';
  if (hidden || !canAsk) return '';
  return 'ask';
}

/** ตารางที่มีของค้างส่ง (ชื่อตารางในเครื่อง) */
export const dirtyTables = store =>
  Object.keys(TABLES).filter(t => dirtyRows((store && store[t]) || []).length);

/** since ในเครื่อง (รายชื่อตารางในเครื่อง) → รูปที่คำสั่ง changes รับ (รายชื่อชีต) */
export const sinceBySheet = since =>
  Object.fromEntries(Object.entries(TABLES).map(([t, d]) => [d.sheet, String((since && since[t]) || '')]));

const ISO_AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;

/**
 * ตารางที่ต้องดึงจากคำตอบของ changes (คืนชื่อตารางในเครื่อง)
 *
 * res.changed = ชีตที่เซิร์ฟเวอร์บอกว่าเปลี่ยน · res.stamps = เวลาที่จดของแต่ละชีต
 * seen = { ชีต: เวลาที่จด } ที่เครื่องนี้ดึงตามไปสำเร็จแล้ว
 *
 * ข้ามชีตที่เวลาที่จดเท่ากับที่ดึงตามไปแล้ว — ไม่งั้นทางเผื่อหนึ่งนาทีของเซิร์ฟเวอร์ (CHANGE_SLACK_MS)
 * ทำให้ทุกเครื่องดึงชีตเดิมซ้ำราวสามรอบต่อการเปลี่ยนหนึ่งครั้ง แล้วกลับไปแย่ง lock กันเหมือนเดิม
 * ข้ามได้ปลอดภัยเพราะ push จดเวลา "ใต้ lock" ก่อนเขียนแถว → การดึงที่เริ่มหลังเห็นเวลานั้น
 * ต้องรอ lock จน push ก้อนนั้นเขียนเสร็จ จึงได้แถวครบแล้ว · มีคนส่งใหม่ = เวลาที่จดเปลี่ยน = ดึงอีก
 * ⚠️ seen ต้องตั้งหลัง "ดึง" สำเร็จเท่านั้น (ดู syncNow ใน app.js) — ส่งผ่านแต่ดึงพัง แล้วตั้ง seen
 *    = ของที่เครื่องอื่นส่งไว้ก่อนหน้าถูกข้ามไปจนถึงรอบซิงค์เต็ม
 * เวลาที่จดว่างหรืออ่านไม่ออก = ดึงเสมอ (สงสัยเมื่อไหร่ให้ดึง)
 */
export function askPlan(res, seen = {}) {
  const changed = res && Array.isArray(res.changed) ? res.changed : [];
  const stamps = (res && res.stamps) || {};
  return Object.keys(TABLES).filter(t => {
    const sh = TABLES[t].sheet;
    if (!changed.includes(sh)) return false;
    const at = String(stamps[sh] || '');
    return !(ISO_AT.test(at) && seen && seen[sh] === at);
  });
}
