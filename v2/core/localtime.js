/**
 * เวลาไทยกับเวลาที่เก็บในสมุด
 *
 * ── ปัญหาที่ไฟล์นี้มีไว้แก้ ──────────────────────────────────────
 * สมุดเก็บเวลาเป็น ISO ซึ่งเป็นเวลา UTC ช้ากว่าไทย 7 ชั่วโมง
 * ถ้าเอา at.slice(0,10) มาแสดงตรง ๆ รายการที่คีย์ก่อน 07:00 น. จะกลายเป็น "เมื่อวาน"
 * ทั้งกะเช้าเข้างานตีห้า — วันที่บนการ์ดจะเลื่อนไปหนึ่งวันทุกใบ
 *
 * v1 เจอเรื่องนี้มาก่อนและเขียนเตือนไว้ในโค้ดว่า "ห้ามใช้ toISOString() ทำวันที่"
 * v2 เก็บ at เป็น UTC จริง ๆ (เพื่อให้เรียงลำดับข้ามเครื่องได้ถูก) แล้วแปลงตอนแสดงผลแทน
 * ทุกที่ที่แสดงวันที่ให้คนอ่าน ต้องผ่านไฟล์นี้ ห้าม slice เอาเอง
 *
 * ไม่ผูกกับโซนเวลาไทยตายตัว ใช้โซนของเครื่องที่เปิดโปรแกรม
 * เพราะเครื่องในโรงงานตั้งเป็นเวลาไทยอยู่แล้ว และการฮาร์ดโค้ด +7
 * จะพังทันทีถ้าวันหนึ่งมีคนเปิดจากที่อื่น
 */

const pad = n => String(n).padStart(2, '0');

/** วันที่ตามเวลาเครื่อง — YYYY-MM-DD */
export function localDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** เวลาตามเวลาเครื่อง — HH:MM */
export function localTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export const localDateTime = iso => (iso ? (localDate(iso) + ' ' + localTime(iso)).trim() : '');

/** วันนี้ตามเวลาเครื่อง — ใช้เป็นค่าตั้งต้นของช่องวันที่ */
export const todayLocal = () => localDate(new Date().toISOString());

/**
 * แปลงวันที่ที่คนเลือก (YYYY-MM-DD) เป็นเวลา ISO ที่จะเก็บลงสมุด
 *
 * ใช้นาฬิกาปัจจุบันเป็นเวลาในวัน เพื่อให้รายการที่คีย์ย้อนหลังยังเรียงถูกตามลำดับที่คีย์
 * ผลลัพธ์เมื่อแปลงกลับด้วย localDate() จะได้วันที่เดิมที่คนเลือกเสมอ
 *
 * ⚠️ ห้ามทำด้วยการต่อสตริง เช่น dateStr + at.slice(10)
 * วิธีนั้นเอาวันที่ตามเวลาเครื่องมาต่อกับเวลาตาม UTC ซึ่งเป็นคนละโซน
 * ผลคือรายการที่คีย์ระหว่างเที่ยงคืนถึงเจ็ดโมงเช้าจะเลื่อนไปอีกวัน
 */
export function atFrom(dateStr, now = new Date()) {
  if (!dateStr) return now.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!m) return now.toISOString();
  return new Date(+m[1], +m[2] - 1, +m[3], now.getHours(), now.getMinutes(),
                  now.getSeconds(), now.getMilliseconds()).toISOString();
}
