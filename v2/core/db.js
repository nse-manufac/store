/**
 * ที่เก็บข้อมูลลงดิสก์ — IndexedDB
 *
 * ── ทำไมไม่ใช้ localStorage เหมือน v1 ────────────────────────────
 * localStorage มีเพดาน ~5 MB · ทะเบียนเต็ม 12,259 รายการกินไป 2.5 MB
 * v1 จึงต้องมีกฎ INVARIANTS E3 ให้เก็บเฉพาะ active 1,016 รายการ
 * ผลคือรหัสอีก 11,243 ตัว "ไม่มีอยู่จริง" สำหรับแอป และพนักงานเจอทางตันทุกครั้ง
 * ที่มีของนอกรายการเข้ามา — ซึ่งกลายเป็น issue #29 ในที่สุด
 *
 * ── ขอบเขตของไฟล์นี้ ────────────────────────────────────────────
 * ไฟล์นี้โง่โดยตั้งใจ รู้แค่วิธีอ่านเขียนลงดิสก์ ไม่มีตรรกะธุรกิจแม้แต่บรรทัดเดียว
 * ตรรกะที่สำคัญอยู่ใน ledger.js กับ balance.js ซึ่งเทสด้วย node ล้วนได้
 * เพราะ IndexedDB ไม่มีใน node การเอาตรรกะมาไว้ที่นี่แปลว่าเทสมันไม่ได้ถูก ๆ
 *
 * แอปยังโหลดทุกอย่างขึ้นหน่วยความจำตอนเปิดเหมือน v1 (2.5 MB ใน RAM ไม่ใช่ปัญหา)
 * ที่เปลี่ยนคือชั้นที่เก็บลงดิสก์เท่านั้น ส่วนที่คำนวณและแสดงผลไม่ต้องแก้
 */

export const DB_NAME = 'bincard-v2';
// 2 — เพิ่มตาราง counts (รอบนับของ)
export const DB_VERSION = 2;

/** ตารางทั้งหมด — keyPath ทุกตัวคือ id ยกเว้นที่ระบุ */
const STORES = {
  entries:   { keyPath: 'id', indexes: [['by_code', 'material_code'], ['by_at', 'at']] },
  materials: { keyPath: 'material_code', indexes: [['by_cat', 'category']] },
  bom:       { keyPath: 'id', indexes: [['by_pn', 'pn']] },
  pos:       { keyPath: 'id' },
  kits:      { keyPath: 'id' },
  shorts:    { keyPath: 'id' },
  closes:    { keyPath: 'id' },
  counts:    { keyPath: 'id' },
  meta:      { keyPath: 'k' }
};

let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      return reject(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB — เปิดโหมดไม่ระบุตัวตนอยู่หรือเปล่า'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ev => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: cfg.keyPath });
        for (const [idx, path] of cfg.indexes || []) os.createIndex(idx, path);
      }
      // เวอร์ชันถัดไปเพิ่ม migration ตรงนี้ โดยดูจาก ev.oldVersion
      // ห้ามลบตารางเก่าทิ้งโดยไม่ย้ายข้อมูลออกก่อน — INVARIANTS E2
      void ev;
    };
    req.onsuccess = () => {
      _db = req.result;
      // อีกแท็บขอเปลี่ยนโครงสร้าง ต้องปล่อยให้เขาทำ ไม่งั้นเขาค้างตลอดกาล
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error || new Error('เปิดฐานข้อมูลไม่สำเร็จ'));
    req.onblocked = () => reject(new Error('มีแท็บอื่นเปิดโปรแกรมรุ่นเก่าค้างอยู่ — ปิดแท็บอื่นแล้วลองใหม่'));
  });
}

function tx(db, names, mode) {
  const t = db.transaction(names, mode);
  return { t, done: new Promise((res, rej) => {
    t.oncomplete = res;
    t.onabort = t.onerror = () => rej(t.error || new Error('เขียนข้อมูลไม่สำเร็จ'));
  }) };
}

/** อ่านทั้งตาราง — ใช้ตอนเปิดแอป */
export async function all(store) {
  const db = await open();
  const { t } = tx(db, [store], 'readonly');
  return new Promise((res, rej) => {
    const r = t.objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

/** โหลดทุกตารางพร้อมกันตอนเปิดแอป */
export async function loadAll() {
  const names = Object.keys(STORES);
  const lists = await Promise.all(names.map(all));
  return Object.fromEntries(names.map((n, i) => [n, lists[i]]));
}

/**
 * เขียนหลายแถวในธุรกรรมเดียว — ทั้งหมดสำเร็จหรือทั้งหมดไม่สำเร็จ
 *
 * ⚠️ ลำดับสำคัญเวลาพื้นที่ดิสก์เต็ม
 * ให้เขียนรายการเคลื่อนไหวก่อนเสมอ แล้วค่อยเขียนของที่สร้างใหม่ได้อย่างทะเบียน
 * เพราะรายการที่พนักงานเพิ่งคีย์คือสิ่งเดียวที่สร้างใหม่ไม่ได้ถ้าหาย
 * (บทเรียนจาก issue #29 ของ v1)
 */
/**
 * ตารางที่ต้องซิงค์ขึ้นเซิร์ฟเวอร์ — เขียนเมื่อไหร่ต้องติดธงรอส่งทุกครั้ง
 *
 * ตั้งใจให้ติดธงที่นี่ที่เดียว ไม่ใช่ให้แต่ละหน้าจำเอง
 * ถ้ากระจายไปติดตามที่เรียกใช้ วันหนึ่งจะมีคนเพิ่มหน้าจอใหม่แล้วลืม
 * ผลคือรายการนั้นอยู่แค่ในเครื่องเดียวตลอดไปโดยไม่มีอะไรเตือน
 * มีที่เดียวที่ผ่านโดยไม่ติดธงคือตัวซิงค์เอง ซึ่งส่ง synced: true มา
 */
const SYNCED = new Set(['entries', 'materials', 'bom', 'pos', 'kits', 'shorts']);

export async function put(store, rows, { synced = false } = {}) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return 0;
  // ติดธงบนตัวอ็อบเจกต์เดิม ไม่ใช่บนสำเนา
  // เพราะหน้าจอถืออ็อบเจกต์ตัวเดียวกันนี้อยู่ในหน่วยความจำ ถ้าติดบนสำเนา
  // ของบนจอจะไม่มีธง แล้วตัวซิงค์จะมองไม่เห็นว่ามีอะไรรอส่ง
  if (SYNCED.has(store) && !synced) for (const r of list) r.dirty = true;
  const db = await open();
  const { t, done } = tx(db, [store], 'readwrite');
  const os = t.objectStore(store);
  for (const r of list) os.put(r);
  try {
    await done;
    return list.length;
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') {
      throw new Error('พื้นที่เก็บข้อมูลในเครื่องเต็ม — ยังไม่ได้บันทึกรายการนี้ '
                    + 'ให้ซิงค์ขึ้นเซิร์ฟเวอร์แล้วล้างข้อมูลเก่าออกก่อน');
    }
    throw err;
  }
}

export async function del(store, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (!list.length) return 0;
  const db = await open();
  const { t, done } = tx(db, [store], 'readwrite');
  for (const k of list) t.objectStore(store).delete(k);
  await done;
  return list.length;
}

export async function clear(stores) {
  const list = Array.isArray(stores) ? stores : [stores];
  const db = await open();
  const { t, done } = tx(db, list, 'readwrite');
  for (const s of list) t.objectStore(s).clear();
  await done;
}

export async function getMeta(k, dflt = null) {
  const db = await open();
  const { t } = tx(db, ['meta'], 'readonly');
  return new Promise((res, rej) => {
    const r = t.objectStore('meta').get(k);
    r.onsuccess = () => res(r.result ? r.result.v : dflt);
    r.onerror = () => rej(r.error);
  });
}

export const setMeta = (k, v) => put('meta', { k, v });

/**
 * ประมาณพื้นที่ที่ใช้ไป — ให้มาตรวัดบอกความจริง
 * v1 เคยแสดงตัวเลขที่ไม่ตรงกับของจริงจนคนเชื่อผิด (issue #29 PR 2/3)
 * ถ้าเบราว์เซอร์ไม่บอก ให้ตอบ null แล้วหน้าจอเขียนว่า "บอกไม่ได้"
 * ห้ามเดาตัวเลขมาแสดง เพราะมาตรวัดที่โกหกแย่กว่าไม่มีมาตรวัด
 */
export async function usage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage: used, quota } = await navigator.storage.estimate();
    if (typeof used !== 'number' || typeof quota !== 'number' || !quota) return null;
    return { used, quota, pct: Math.round((used / quota) * 1000) / 10 };
  } catch { return null; }
}

/** บอกแท็บอื่นว่ามีข้อมูลใหม่ — หลายแท็บบนเครื่องเดียวกันใช้ฐานข้อมูลถังเดียวกัน */
const chan = globalThis.BroadcastChannel ? new BroadcastChannel(DB_NAME) : null;
export const announce = what => chan && chan.postMessage({ what, at: Date.now() });
export const onChange = fn => { if (chan) chan.onmessage = ev => fn(ev.data); };
