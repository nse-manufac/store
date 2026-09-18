/**
 * ย้ายข้อมูลจากนิติบุคคลหนึ่งไปอีกนิติบุคคลหนึ่ง
 *
 * ── ทำไมต้องมีไฟล์นี้ ───────────────────────────────────────────
 * ทะเบียนนิติบุคคลใช้ "รหัส" เป็นกุญแจ (db.js entities.keyPath = entity_code)
 * แก้รหัสในหน้าทะเบียนจึงไม่ใช่การเปลี่ยนชื่อ แต่เป็นการ "สร้างอีกตัว"
 * แถวเก่ายังคาอยู่ใต้รหัสเดิม และทุกบรรทัดในสมุด · งานตามวัตถุดิบ · รอบนับ
 * ก็ยังประทับรหัสเดิมไว้ในตัวมันเอง — ไม่มีอะไรขยับตาม
 *
 * ── ทำไมเป็น "กติกา" ไม่ใช่ "กดครั้งเดียวจบ" ─────────────────────
 * ข้อมูลอยู่หลายเครื่องและไหลเข้ามาทีหลังได้เสมอ เครื่องที่ปิดอยู่ตอนย้าย
 * จะส่งแถวรหัสเดิมตามขึ้นมาอีกหลายวันให้หลัง ถ้าย้ายแบบครั้งเดียวจบ
 * แถวพวกนั้นจะตกค้างใต้รหัสที่ไม่มีใครเปิดดูแล้ว โดยไม่มีอะไรฟ้อง
 * เก็บเป็นกติกาแล้วรันทุกครั้งที่เปิดโปรแกรม (แบบเดียวกับ migrateAll ของ follow.js)
 * ของที่ตามมาทีหลังจึงถูกย้ายให้เองทุกรอบ
 *
 * ⚠️ ไฟล์นี้ไม่ลบอะไรทั้งสิ้น และไม่แตะ id / created_at (INVARIANTS B1 · B3)
 *    เปลี่ยนแค่ช่องนิติบุคคล แล้วดัน updated_at ให้การซิงค์พาไปทับของเดิมบนชีต
 */

export const normEnt = code => String(code || '').trim().toUpperCase();

/**
 * ปลายทางสุดท้ายของรหัสนี้ — คืน '' ถ้าไม่ต้องย้าย
 * ไล่ตามสายจนสุด (NSE→TUE-H แล้วต่อมา TUE-H→TUE-A ⇒ NSE ได้ TUE-A)
 * นับรอบไว้กันวน ถึงจะกันตอนเพิ่มกติกาแล้วก็ยังกันซ้ำตรงนี้
 * เพราะกติกาที่ซิงค์มาจากเครื่องอื่นไม่ได้ผ่านด่านของเครื่องนี้
 */
export function movedTo(code, moves = []) {
  let cur = normEnt(code);
  if (!cur) return '';
  const start = cur;
  for (let i = 0; i <= (moves || []).length; i++) {
    const hit = (moves || []).find(m => m && normEnt(m.from) === cur);
    if (!hit) break;
    cur = normEnt(hit.to);
    if (cur === start) return '';       // วนกลับที่เดิม = ไม่ต้องย้าย
  }
  return cur === normEnt(code) ? '' : cur;
}

/**
 * เพิ่มกติกาย้ายหนึ่งข้อ — คืนรายการใหม่ ไม่แก้ของเดิม
 *
 * ⚠️ รหัสหนึ่งมีกติกาได้ข้อเดียว · ถ้าย้าย NSE ไปแล้วแล้วอยากย้ายต่อ
 *    ต้องย้ายจากปลายทางปัจจุบัน ไม่ใช่เขียนทับกติกาเดิม
 *    เขียนทับแปลว่าแถวที่ย้ายไปแล้วกับแถวที่ยังไม่ย้ายจะไปคนละที่
 */
export function addMove(moves = [], { from, to, at = '', by = '' } = {}) {
  const f = normEnt(from), t = normEnt(to);
  if (!f || !t) throw new Error('ต้องระบุทั้งรหัสต้นทางและปลายทาง');
  if (f === t) throw new Error('ต้นทางกับปลายทางเป็นรหัสเดียวกัน');
  const old = (moves || []).find(m => m && normEnt(m.from) === f);
  if (old) throw new Error(`${f} ถูกย้ายไป ${normEnt(old.to)} แล้ว — ถ้าจะย้ายต่อ ให้ย้ายจาก ${normEnt(old.to)}`);
  if (movedTo(t, moves) === f) throw new Error(`${t} ถูกย้ายไป ${f} อยู่แล้ว — ย้ายกลับจะวนกัน`);
  return [...(moves || []), { from: f, to: t, at: at || new Date().toISOString(), by: String(by || '') }];
}

/**
 * ใช้กติกากับรายการ — คืน { rows, changed }
 * แถวที่ไม่ต้องย้ายคืนตัวเดิมทั้งตัว (===) ผู้เรียกจึงเขียนลงฐานข้อมูลเฉพาะ changed ได้
 *
 * ⚠️ แถวที่ยังไม่รู้นิติบุคคล (ช่องว่าง) ไม่แตะ — ว่างแล้วเห็น ดีกว่าเดาแล้วไม่เห็น
 * ⚠️ แถวที่ถูกยกเลิกไปแล้วก็ย้ายด้วย มันยังเป็นประวัติของนิติบุคคลนั้น (B1)
 */
export function applyMoves(rows, moves, { now = new Date().toISOString(), dirty = true } = {}) {
  const out = [], changed = [];
  for (const r of rows || []) {
    const dest = r && r.entity ? movedTo(r.entity, moves) : '';
    if (!dest) { out.push(r); continue; }
    const rec = { ...r, entity: dest, updated_at: now };
    if (dirty) rec.dirty = true;
    out.push(rec); changed.push(rec);
  }
  return { rows: out, changed };
}

/** นับก่อนย้ายจริง — ให้คนเห็นตัวเลขก่อนกดยืนยัน ไม่ใช่กดแล้วค่อยรู้ */
export function movePreview(store = {}, moves = []) {
  const per = {}; let total = 0;
  for (const [name, rows] of Object.entries(store)) {
    const n = (rows || []).filter(r => r && r.entity && movedTo(r.entity, moves)).length;
    per[name] = n; total += n;
  }
  return { per, total };
}
