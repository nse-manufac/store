/**
 * PO รายวัน และ Kit List จาก Delta
 *
 * ── สามไฟล์ สามหน้าตา ────────────────────────────────────────────
 *   PO รายวัน       ไฟล์เดียว บอกว่าวันนี้มี PO อะไรบ้าง P/N ไหน จำนวนเท่าไหร่
 *                   และมีหมายเหตุของขาด/ETA ปนอยู่ในคอลัมน์ข้อความอิสระ
 *   Kit List 22-H   บอกว่าแต่ละ PO Delta จ่ายวัตถุดิบอะไรมาจริงบ้าง
 *   Kit List กลุ่มจ่ายรวม  Tube · Chemical · Copper foil · Solder จ่ายเป็นรอบสัปดาห์
 *
 * ── ทำไมต้องแยก Kit List ออกจาก BOM ──────────────────────────────
 * BOM บอกว่า "ตามสูตรต้องใช้เท่าไหร่" · Kit List บอกว่า "Delta จ่ายมาจริงเท่าไหร่"
 * สองอย่างนี้ไม่เท่ากันและไม่ควรทำให้เท่ากัน ตอนคีย์รับเข้าจึงยึด Kit List ก่อนเสมอ
 * แล้วใช้ BOM เป็นตัวสำรองเมื่อยังไม่มี Kit List ของ PO นั้น
 *
 * ⚠️ ตัวเลขทั้งหมดในไฟล์พวกนี้ซ้ำบรรทัดได้ ต้องรวมยอดก่อนใช้เสมอ
 * PO เดียวกัน + รหัสเดียวกัน โผล่ได้หลายบรรทัดเพราะเป็นคนละขั้นตอนการผลิต
 * ถ้าไม่รวม จะเห็นแค่บรรทัดสุดท้ายแล้วยอดขาดไปเงียบ ๆ
 * (ของจริงเจอ 3 คู่ในไฟล์ 22-H เช่น TUBE PTFE 5.4 + 5.4 = 10.8)
 *
 * ไฟล์นี้ไม่รู้จัก SheetJS โดยตั้งใจ — รับ array of array ที่แปลงมาแล้ว
 * จะได้เทสด้วย node ล้วนได้ ทั้งที่ของจริงมาจาก .xls ที่เปิดใน node ไม่ได้
 */

import { localDate } from '../core/localtime.js';
import { receivedOfDoc } from '../core/balance.js';
import { poOwnerOf, poVisibleTo, resolveEntity } from './entities.js';

const pad = n => String(n).padStart(2, '0');
const r6 = n => Math.round(n * 1e6) / 1e6;

const THAI_MONTH = { 'ม.ค': 1, 'ก.พ': 2, 'มี.': 3, 'เม.': 4, 'พ.ค': 5, 'มิ.': 6,
                     'ก.ค': 7, 'ส.ค': 8, 'ก.ย': 9, 'ต.ค': 10, 'พ.ย': 11, 'ธ.ค': 12,
                     'มกร': 1, 'กุม': 2, 'มีน': 3, 'เมษ': 4, 'พฤษ': 5, 'มิถ': 6,
                     'กรก': 7, 'สิง': 8, 'กัน': 9, 'ตุล': 10, 'พฤศ': 11, 'ธัน': 12 };
const EN_MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                   jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "ที่ 27 กรกฎาคม พ.ศ. 2569" → "2026-07-27" (พ.ศ. ลบ 543) */
export function parseThaiDate(s) {
  const m = String(s).match(/ที่\s*(\d{1,2})\s*([ก-๙.]+)\s*พ\.?ศ\.?\s*(\d{4})/);
  if (!m) return '';
  const mo = THAI_MONTH[m[2].slice(0, 3)];
  return mo ? (+m[3] - 543) + '-' + pad(mo) + '-' + pad(+m[1]) : '';
}

/** "ETA 29 July 2026" → "2026-07-29" */
export function parseEnDate(s) {
  const m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/);
  if (!m) return '';
  const mo = EN_MONTH[m[2].slice(0, 3).toLowerCase()];
  return mo ? m[3] + '-' + pad(mo) + '-' + pad(+m[1]) : '';
}

/** วันที่แบบ serial ของ Excel — ฐานคือ 30 ธ.ค. 1899 ไม่ใช่ 1 ม.ค. 1900 */
export function excelDate(v) {
  // ⚠️ ถ้าใครเปิดไฟล์ด้วย cellDates:true เซลล์วันที่จะมาเป็น Date ไม่ใช่เลข serial
  // ตัวอ่านไฟล์กลุ่มจ่ายรวมเจอของแบบนี้มาแล้ว และตัวนี้เคยคืนค่าว่างเงียบ ๆ
  // ซึ่งแปลว่าวันที่ของทั้งไฟล์หายไปโดยไม่มีอะไรฟ้อง (เจอตอนลองกับไฟล์ 22-H จริง 23 ก.ย. 2026)
  // ⚠️ ค่าที่ xlsx คืนมาไม่ได้ตรงเที่ยงคืน · เซลล์ที่แสดง 29/7 ได้ Date เป็น
  // 28/7 เวลา 23:59:56 (เศษจากการแปลง serial) — อ่านตรง ๆ ได้วันที่ 28 คือทั้งไฟล์เลื่อนหนึ่งวัน
  // จึงปัดเป็นนาทีที่ใกล้ที่สุดก่อนค่อยอ่านวัน แบบเดียวกับ matDate ใน matfollow.js
  if (v instanceof Date && !isNaN(v)) {
    const t = new Date(Math.round(v.getTime() / 60000) * 60000);
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }
  if (typeof v !== 'number' || v <= 40000 || v >= 60000) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/**
 * ทำให้ข้อความเทียบกันได้ ไม่ว่าจะเว้นวรรคหรือพิมพ์เล็กใหญ่ยังไง
 *
 * ตัดเครื่องหมาย ' ทิ้งด้วย เพราะหัวตารางของจริงสะกดไม่เหมือนกันในไฟล์เดียวกัน
 * — "ORDER Q'TY" มี แต่ "REQ QTY" ไม่มี ถ้าไม่ตัด ตัวจับหัวคอลัมน์จะพลาดใบใดใบหนึ่งเสมอ
 * และผลของการพลาดคือคอลัมน์นั้นกลายเป็น null เงียบ ๆ ไม่ใช่ฟ้องว่าอ่านไม่ได้
 */
const norm = v => String(v == null ? '' : v).replace(/[\s']+/g, '').toUpperCase();
const numOf = v => typeof v === 'number' ? v
                 : (v == null || v === '' ? null : (isNaN(+v) ? null : +v));
const codeOf = v => typeof v === 'number' ? String(Math.round(v))
                  : String(v == null ? '' : v).trim();

/** ย่อข้อความยาวให้เป็นกุญแจสั้น ๆ ที่ไม่ชนกัน */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * PO รายวัน
 *
 * อ่านตามตำแหน่งคอลัมน์ เพราะไฟล์นี้ไม่มีหัวตารางให้จับ
 * แถวข้อมูลดูจาก "คอลัมน์ A เป็นตัวเลขลำดับ และคอลัมน์ D มีเลข PO"
 * วันที่มาจากแถวหัวเรื่องภาษาไทยที่โผล่คั่นเป็นช่วง ๆ
 */
export function parsePoFile(aoa) {
  const pos = [], shorts = [];
  let curDate = '', lastPo = '';
  for (const row of aoa) {
    if (!row) continue;
    const a = row[0];
    if (typeof a === 'string' && a.includes('subcontract')) {
      const d = parseThaiDate(a);
      if (d) curDate = d;
      continue;
    }
    if (typeof a === 'number' && row[3]) {
      const po = String(row[3]).trim();
      lastPo = po;
      pos.push({
        id: 'P' + curDate + '-' + po,
        date: curDate,
        // เก็บไว้เป็นข้อมูลดิบให้คนอ่าน — ⚠️ ห้ามเอาไปตัดสินนิติบุคคล (เจ้าของ 19 ก.ย. 2026)
        // Delta กรอกมาไม่ตรงเป็นบางใบ · นิติบุคคลอ่านจากเลขที่ PO เท่านั้น (entities.js poOwnerOf)
        sub: String(row[1] || '').trim(),
        pn: row[2] != null ? String(Math.round(Number(row[2]) || 0)) : '',
        po,
        qty: Number(row[5]) || 0,
        core: String(row[9] || '').trim(),
        remark: String(row[16] || '').trim()
      });
    }
    // คอลัมน์ L เก็บหมายเหตุของขาด/ETA เป็นข้อความอิสระ ไม่มีโครงสร้าง
    const note = row[11];
    if (typeof note === 'string' && /\d{10}/.test(note)) {
      const code = (note.match(/\b([345]\d{9})\b/) || [])[1] || '';
      const sh = note.match(/[Ss]hort\s*([\d,.]+)\s*([A-Za-z]+)?/);
      const eta = note.match(/ETA\s+(.+)$/i);
      // ⚠️ id ต้องมี PO ด้วย เพราะหมายเหตุข้อความเดียวกันโผล่ได้หลาย PO ในวันเดียวกัน
      // (ของจริง "4037010105 ETA 29 July 2026" โผล่ 3 PO) ถ้าไม่ใส่ PO จะยุบเหลือรายการเดียว
      shorts.push({
        id: 'S' + curDate + '-' + lastPo + '-' + code + '-' + hash(note),
        date: curDate, po: lastPo, code,
        type: sh ? 'ขาด' : 'รอส่ง',
        qty: sh ? Number(String(sh[1]).replace(/[,.]$/, '').replace(/,/g, '')) || 0 : 0,
        unit: sh && sh[2] ? sh[2].toUpperCase() : '',
        eta: eta ? parseEnDate(eta[1]) : '',
        note: note.trim(), done: false
      });
    }
  }
  return { pos, shorts, dates: [...new Set(pos.map(p => p.date))].filter(Boolean) };
}

/**
 * เลือกชีต Kit List ของจริงในไฟล์ — ชีตแรกที่ไม่ซ่อนและมีหัวตาราง CODE ที่คอลัมน์ที่สี่
 * (กฎเดียวกับที่ parseKitList ใช้จับหัวตาราง) · ไม่เจอ = ชีตแรกที่ไม่ซ่อน
 *
 * ⚠️ ห้ามกลับไปอ่านชีตแรกเฉย ๆ — ไฟล์ 23-H (เจ้าของเจอ 24 ก.ย. 2026) มีชีตซ่อนของ Delta
 * วางอยู่หน้าชีตข้อมูลจริง หัวตารางมีทั้ง PO No. กับ Material
 *   - ที่หน้ารับเข้า ตัวดักไฟล์กลุ่มจ่ายรวมจับชีตซ่อนนั้น แล้วไล่ไฟล์ทั้งไฟล์ไปผิดแท็บ
 *   - ที่หน้า PO / Kit List อ่านชีตซ่อนเป็น Kit List ได้หน้าตาปกติ เพราะคอลัมน์ที่สี่ของชีตนั้น
 *     เป็นตัวเลข (จำนวนสั่ง) — ได้รหัสวัตถุดิบมั่วทั้งใบโดยไม่มีอะไรฟ้อง
 * sheets = [{ name, hidden, aoa }] แบบเดียวกับที่ parseKitChem รับ
 */
export function pickKitSheet(sheets = []) {
  const shown = (sheets || []).filter(s => s && !s.hidden);
  const isKit = s => (s.aoa || []).slice(0, 40)
    .some(r => r && typeof r[3] === 'string' && r[3].trim().toUpperCase().startsWith('CODE'));
  return shown.find(isKit) || shown[0] || null;
}

/**
 * Kit List รายวัน (22-H) — Delta จ่ายอะไรมาบ้างต่อ PO
 * ใช้เติมช่อง "Issue" ตอนคีย์รับเข้า เหลือให้พนักงานคีย์แค่ยอดนับจริง
 */
export function parseKitList(aoa) {
  let docDate = '', group = '';
  for (const row of aoa.slice(0, 3)) {
    if (!row) continue;
    for (const v of row) {
      if (!docDate) { const d = excelDate(v); if (d) docDate = d; }
      if (typeof v === 'string' && /^SUB-/.test(v.trim())) group = v.trim();
    }
  }

  const agg = new Map();
  let headers = 0, subtotals = 0, rawLines = 0;
  for (const row of aoa) {
    if (!row) continue;
    const c3 = row[3];
    // หัวตารางพิมพ์ซ้ำทุกหน้า และมีแถวรวมย่อยของแต่ละรหัส — ทั้งคู่ไม่ใช่ข้อมูล
    if (typeof c3 === 'string' && c3.trim().toUpperCase().startsWith('CODE')) { headers++; continue; }
    if (typeof c3 === 'string' && /total/i.test(c3)) { subtotals++; continue; }
    // รหัสส่วนใหญ่เป็นตัวเลข แต่มีรหัสที่มีตัวอักษรปน (เลขล้วนตามด้วย R และเลข) ซึ่ง Excel เก็บเป็นข้อความ
    // เดิมรับแต่ตัวเลข บรรทัดพวกนั้นหายเงียบจากไฟล์ 23-H (24 ก.ย. 2026)
    // ⚠️ ข้อความต้องขึ้นต้นด้วยเลขอย่างน้อยหกหลัก — ไฟล์ PO มีเลข PO อยู่คอลัมน์นี้ (ขึ้นต้นด้วยตัวอักษร)
    //    ถ้ารับข้อความทุกแบบ ไฟล์ PO จะถูกอ่านเป็น Kit List
    const textCode = typeof c3 === 'string' && /^\d{6,}[A-Z0-9]*$/i.test(c3.trim());
    if ((typeof c3 !== 'number' && !textCode) || !row[1]) continue;
    rawLines++;
    const code = textCode ? c3.trim().toUpperCase() : String(Math.round(c3));
    const po = String(row[1]).trim();
    const id = 'K' + docDate + '-' + po + '-' + code;
    const issue = typeof row[6] === 'number' ? row[6] : null;
    const hit = agg.get(id);
    if (hit) { hit.issue = r6((hit.issue || 0) + (issue || 0)); hit.n++; }
    else agg.set(id, { id, date: docDate, group, po, src: '',
      pn: typeof row[2] === 'number' ? String(Math.round(row[2])) : String(row[2] || '').trim(),
      code, desc: String(row[4] || '').trim(),
      unit: String(row[5] || '').trim().toUpperCase(),
      issue, orderQty: null, req: null, remark: '', n: 1 });
  }
  const rows = [...agg.values()];
  return { rows, docDate, group, headers, subtotals, rawLines,
           merged: rows.filter(r => r.n > 1),
           pos: [...new Set(rows.map(r => r.po))],
           codes: [...new Set(rows.map(r => r.code))] };
}

/**
 * Kit List กลุ่มจ่ายรวม — Tube · Chemical · Copper foil · Solder
 *
 * ต่างจาก 22-H สามอย่าง
 *   1. ไฟล์เดียวมีหลายชีต (แยกตามกลุ่มโรงงาน H / U) และมีชีตซ่อนที่ไม่ใช่ข้อมูล
 *   2. ชีตเดียวมีได้หลายรหัส คั่นด้วยแถวรวมยอด — ห้ามเชื่อชื่อชีต ต้องอ่านรายบรรทัด
 *   3. มีคอลัมน์ Order Q'TY และ Model (P/N) มาให้ → เทียบกับ BOM ได้เลย
 *   4. บางบรรทัดเขียน Return ในคอลัมน์ Material Document No. — ของไม่ได้มาใหม่
 *      แต่ตัดจากยอด over ที่ค้างอยู่ที่เรา · แถวพวกนี้ได้ป้ายที่มาเป็น 'chemover'
 *      ⚠️ ป้ายที่มาต้องต่างกัน ไม่ใช่แค่ธง fromOver เพราะ fromOver ไม่ใช่คอลัมน์ที่ซิงค์
 *      เครื่องอื่นที่รับข้อมูลมาทางชีตจึงแยกสองอย่างนี้ออกจากกันไม่ได้ถ้าดูแต่ธง
 *
 * ⚠️ ไฟล์จริงเว้นช่องวันที่ไว้ว่างทั้งสองที่ (Documet Issue Date และ Date)
 * จึงรับ fallbackDate มาใช้แทน ไม่ใช่เดาวันที่เอง — วันที่ผิดแปลว่ารายการไปโผล่ผิดวัน
 *
 * รับ { sheets: [{ name, hidden, aoa }] } ไม่ใช่ workbook ของ SheetJS
 * เพื่อให้เทสได้โดยไม่ต้องมีไฟล์จริง
 */
export function parseKitChem(book, { fallbackDate = '' } = {}) {
  const agg = new Map(), sheets = [], skipped = [], gaps = [], blocks = [];
  let rawLines = 0, docDate = '', location = '';

  for (const sh of book.sheets || []) {
    if (sh.hidden) { skipped.push({ name: sh.name, why: 'ชีตซ่อน' }); continue; }
    const aoa = sh.aoa || [];

    // หาแถวหัวตารางเอง ห้ามล็อกตำแหน่งไว้ตายตัว
    // (บทเรียนจากไฟล์ Rawmat ที่หัวตารางวางไม่เหมือนกัน 7 แบบ)
    let h = -1, col = null;
    for (let i = 0; i < Math.min(aoa.length, 40); i++) {
      const n = (aoa[i] || []).map(norm);
      const iPo = n.indexOf('PONO.'), iMat = n.indexOf('MATERIAL');
      if (iPo < 0 || iMat < 0) continue;
      h = i;
      col = { item: n.indexOf('ITEM'), po: iPo, group: iPo + 1, pn: n.indexOf('MODEL'),
              order: n.findIndex(x => x.startsWith('ORDERQ')), code: iMat,
              desc: n.indexOf('DESCRIPTION'),
              req: n.findIndex(x => x.startsWith('REQQTY')),
              s41: n.findIndex(x => x.startsWith('541QTY')),
              // หัวคอลัมน์เขียนว่า Material Document No. แต่ของจริงใส่คำว่า Return มา
              // = รอบนี้ Delta ไม่ได้ส่งของ ตัดจากยอด over ที่ค้างอยู่ที่เราแทน
              doc: n.findIndex(x => x.startsWith('MATERIALDOCUMENT')),
              rem: n.indexOf('REMARK') };
      break;
    }
    if (h < 0) { skipped.push({ name: sh.name, why: 'ไม่พบหัวตาราง — ไม่ใช่ชีต Kit List' }); continue; }

    // ต้นฉบับสะกด "Documet Issue Date" ตกตัว n จึงจับแค่ ISSUEDATE
    let sheetDate = '';
    for (let i = 0; i < h && !sheetDate; i++) {
      const row = aoa[i] || [];
      for (let c = 0; c < row.length && !sheetDate; c++) {
        if (typeof row[c] !== 'string' || !/ISSUEDATE/.test(norm(row[c]))) continue;
        for (let k = c + 1; k < row.length; k++) {
          const v = row[k];
          const d = excelDate(v);
          if (d) { sheetDate = d; break; }
          if (v instanceof Date) {
            sheetDate = v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
            break;
          }
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
            sheetDate = v.trim().slice(0, 10); break;
          }
        }
      }
    }
    if (sheetDate && !docDate) docDate = sheetDate;

    // "Location  : 0014" — รหัสที่เก็บฝั่ง Delta (location sub) ไม่ใช่เลขที่เอกสาร
    // เจ้าของยืนยัน 22 ก.ย. 2026 ว่าทุกไฟล์เป็นเลขเดียวกันหมด ห้ามเอาไปเติมเป็นเลขที่เอกสาร
    // ของจริงอยู่ในเซลล์เดียวกับคำว่า Location แต่ไล่เซลล์ถัดไปให้ด้วย
    // เพราะหัวเอกสารเป็นช่อง merge ที่ขยับได้ แบบเดียวกับตัวอ่านวันที่ข้างบน (ผู้ตรวจ #97)
    for (let i = 0; i < h && !location; i++) {
      const row = aoa[i] || [];
      for (let c = 0; c < row.length && !location; c++) {
        if (typeof row[c] !== 'string' || !/LOCATION/.test(norm(row[c]))) continue;
        const same = (row[c].split(':')[1] || '').trim();
        if (same) { location = same; break; }
        for (let k = c + 1; k < row.length; k++) {
          const t = String(row[k] == null ? '' : row[k]).replace(/^[\s:]+/, '').trim();
          if (t) { location = t; break; }
        }
      }
    }

    let blk = null, nSheet = 0, prevItem = null, blockStart = false;
    const closeBlock = docTotal => {
      if (!blk || !blk.n) { blk = null; return; }
      blocks.push({ sheet: sh.name, code: blk.code, lines: blk.n, calc: r6(blk.sum),
        docTotal: docTotal === null ? null : r6(docTotal),
        // กี่บรรทัดในบล็อกนี้เป็นแถวที่ตัดจากยอด over — ปลายทางต้องรู้ว่ายอดรวมนี้ปนมาไหม
        overLines: blk.over,
        // ยอมให้ต่างได้ไม่เกินครึ่งของหลักทศนิยมสุดท้ายที่เอกสารใช้ (3 ตำแหน่ง)
        match: docTotal === null ? null : Math.abs(docTotal - blk.sum) < 5e-4 });
      blk = null;
    };

    for (let r = h + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const po = String(row[col.po] == null ? '' : row[col.po]).trim();
      const code = codeOf(row[col.code]);
      if (!po || !code) {
        const t = numOf(row[col.s41]);
        if (t !== null) { closeBlock(t); blockStart = true; }   // แถวรวมยอดปิดบล็อก
        continue;
      }
      rawLines++; nSheet++;
      const over = col.doc >= 0 && /RETURN/i.test(String(row[col.doc] == null ? '' : row[col.doc]));
      const day = sheetDate || docDate || fallbackDate;
      if (!blk) blk = { code, n: 0, sum: 0, over: 0 };
      if (over) blk.over++;

      // เลข Item ต้องเดินทีละ 1 ถ้ากระโดดแปลว่าบรรทัดหายตอน export
      // ⚠️ สองชีตในไฟล์เดียวกันนับคนละแบบ — ชีต H รีเซ็ตเป็น 1 เมื่อขึ้นรหัสใหม่
      // แต่ชีต U นับต่อเนื่องข้ามรหัส จึงต้องรองรับทั้งสองแบบ
      const it = numOf(row[col.item]);
      if (it !== null) {
        const restart = blockStart && it === 1;
        if (!restart && prevItem !== null && it > prevItem + 1) {
          const miss = [];
          for (let v = prevItem + 1; v < it; v++) miss.push(v);
          gaps.push({ sheet: sh.name, code, after: prevItem, missing: miss });
        }
        prevItem = it;
      }
      blockStart = false;

      const req = numOf(row[col.req]), s41 = numOf(row[col.s41]);
      blk.n++; blk.sum += s41 || 0;
      if (blk.code !== code) blk.code = '(ปนกัน)';

      // ⚠️ PO เดียวกัน + รหัสเดียวกัน โผล่ได้หลายบรรทัด ต้องรวมยอดก่อนเทียบ BOM
      // ของจริงเจอ 3 คู่ เช่น TM5267H332 0.539 + 0.231 = 0.770
      const key = po + '|' + code + (over ? '|R' : ''), hit = agg.get(key);
      if (hit) {
        hit.req   = (req === null && hit.req   === null) ? null : r6((hit.req   || 0) + (req || 0));
        hit.issue = (s41 === null && hit.issue === null) ? null : r6((hit.issue || 0) + (s41 || 0));
        hit.n++;
      } else agg.set(key, {
        id: 'C' + day + '-' + po + '-' + code + (over ? '-R' : ''),
        src: over ? 'chemover' : 'chem', date: day, fromOver: over,
        group: String(row[col.group] == null ? '' : row[col.group]).trim().toUpperCase(),
        po, code, pn: codeOf(row[col.pn]), orderQty: numOf(row[col.order]),
        desc: String(row[col.desc] == null ? '' : row[col.desc]).trim(), unit: '',
        req, issue: s41,
        remark: col.rem >= 0 ? String(row[col.rem] == null ? '' : row[col.rem]).trim() : '',
        n: 1
      });
    }
    closeBlock(null);
    sheets.push({ name: sh.name, rows: nSheet, date: sheetDate, hasDocCol: col.doc >= 0 });
  }

  const rows = [...agg.values()];
  // ชีตที่ไม่มีคอลัมน์ Material Document No. = แยกแถวที่ตัดจากยอด over ไม่ได้เลย
  // ปล่อยเงียบแล้วทุกแถวจะกลายเป็นของที่มาจริง ซึ่งเป็นโหมดพังที่อันตรายที่สุดของไฟล์นี้ (ผู้ตรวจ #97)
  const noDocCol = sheets.filter(x => !x.hasDocCol).map(x => x.name);
  return { rows, docDate, location, sheets, skipped, gaps, blocks, rawLines, noDocCol,
           merged: rows.filter(r => r.n > 1),
           codes: [...new Set(rows.map(r => r.code))],
           pos: [...new Set(rows.map(r => r.po))] };
}

/**
 * รายการที่ Delta จ่ายมาของ PO นี้
 *
 * ⚠️ ไม่รวมกลุ่มจ่ายรวมรายสัปดาห์ (src='chem') โดยตั้งใจ
 * เพราะของกลุ่มนั้นไม่ได้มาพร้อม PO ถ้ารวมเข้ามา หน้าคีย์รับเข้าปกติ
 * จะกางเคมีขึ้นมาให้คีย์ทั้งที่ของยังไม่มา แล้วพนักงานจะคีย์ยอดที่ยังไม่ได้รับจริง
 * — กฎนี้ยกมาจาก v1 ทั้งดุ้น ห้ามแก้โดยไม่คุยกับหน้างานก่อน
 */
export const kitsOfPo = (kits, po) =>
  kits.filter(k => k.po === String(po || '').trim() && !isChemKit(k));

/**
 * บรรทัดรับเข้าจากไฟล์ Kit List (22-H) ทั้งใบ — หลาย PO ในตารางเดียว
 *
 * ⚠️ Delta เข้าตรวจแล้วสั่งให้เลิกคีย์มือ เปลี่ยนเป็นดึงจากไฟล์ (เจ้าของแจ้ง 23 ก.ย. 2026)
 * ทางคีย์เองยังอยู่ แต่ต้องกดเปิดก่อน — ไฟล์ยังมาไม่ถึงแต่ของมาแล้วต้องลงสมุดได้
 * ไม่งั้นพนักงานจะไปจดใส่กระดาษ ซึ่งแย่กว่ายอดที่ต้องมาตามแก้
 *
 * ยอด "รับจริง" ตั้งไว้ให้เท่ากับที่ Delta จ่ายมา **แก้ทับได้ถ้านับไม่ตรง** (เจ้าของเคาะ 23 ก.ย. 2026)
 * ส่วนต่างระหว่างที่นับกับที่ Delta แจ้ง คือของที่ระบบของขาด/ของเกินทั้งหมดยืนอยู่บนนั้น
 * ถ้าวันไหนเปลี่ยนเป็นใช้เลขในไฟล์ห้ามแก้ ระบบนั้นจะจับอะไรไม่ได้อีกเลย
 *
 * ⚠️ ไม่เดาว่าของมาถึงหรือยัง — เจ้าของบอกว่า "แล้วแต่รอบ ไม่แน่นอน" บางรอบมาพร้อมกันทั้งใบ
 * บางรอบทยอยมาทีละ PO · ที่นี่กางให้ครบทั้งไฟล์ แล้วให้หน้าจอกับคนตัดสินว่าบรรทัดไหนรับจริง
 */
// ปัดเศษทศนิยมลอยของเลขจากไฟล์ แต่ค่าว่างต้องยังว่าง ไม่ใช่กลายเป็นศูนย์
// (ผู้ตรวจ #104 — 0.1+0.2 เคยขึ้นในช่องรับจริงเป็น 0.30000000000000004 · ยอดที่เก็บไม่เพี้ยน
//  เพราะ makeEntry ปัดอีกชั้น แต่คนที่เห็นเลขแบบนั้นบนจอจะไม่เชื่อตัวเลขทั้งตาราง)
const n6 = v => { const n = numOf(v); return n === null ? null : r6(n); };

export function kitReceivePlan(rows = [], { poList = [] } = {}) {
  const have = new Set((poList || []).map(p => String(p.po || '').trim()));
  const byPo = new Map();
  for (const r of rows || []) {
    if (!r || !r.po || !r.code) continue;
    const po = String(r.po).trim();
    const g = byPo.get(po) || { po, pn: '', lines: [], inList: have.has(po) };
    if (!g.pn && r.pn) g.pn = String(r.pn);
    g.lines.push({
      po, pn: r.pn ? String(r.pn) : '', code: codeOf(r.code),
      desc: String(r.desc == null ? '' : r.desc).trim(),
      unit: String(r.unit == null ? '' : r.unit).trim(),
      issued: n6(r.issue),
      qty: n6(r.issue)               // ตั้งไว้ให้ก่อน แก้ทับเป็นยอดนับจริงได้
    });
    byPo.set(po, g);
  }
  const groups = [...byPo.values()];
  const lines = [];
  for (const g of groups) lines.push(...g.lines);
  return {
    groups, lines,
    pos: groups.map(g => g.po),
    // PO ที่ไม่มีในรายการ PO ที่นำเข้าไว้ — บอกไว้ ไม่ใช่ห้ามรับเข้า (A4)
    noPo: groups.filter(g => !g.inList).map(g => g.po),
    date: (rows || []).map(r => r && r.date).find(Boolean) || ''
  };
}

/**
 * แต่ละ PO ในไฟล์เป็นของนิติบุคคลไหน และเคยคีย์รับไปแล้วเท่าไหร่ — Map<po, { entity, from, recv }>
 *
 * ⚠️ **ต้องรู้นิติบุคคลของ PO ก่อน แล้วค่อยถามสมุดด้วยตัวนั้น** (INVARIANTS A3)
 * `receivedOfDoc()` กรองสมุดด้วยนิติบุคคลที่ส่งเข้าไป ถ้าถามด้วยตัวที่เลือกอยู่บนหัวจอตัวเดียว
 * ทั้งไฟล์ PO ของอีกโรงงานจะไปถามสมุดผิดเล่ม → คอลัมน์ "รับแล้ว" ขึ้น 0 ทั้งที่เคยคีย์ไปแล้ว
 * แล้วพนักงานคีย์ซ้ำ **ยอดคงคลังบานขึ้นเงียบ ๆ** โดยไม่มีอะไรบนจอเตือน (ผู้ตรวจรอบ 1 ของใบ 8)
 * ในทางกลับกันยอดของโรงงานที่เลือกอยู่ก็จะไปโผล่บนบรรทัดที่ป้ายเขียนว่าอีกโรงงาน
 *
 * นิติบุคคลที่ตัดสินไม่ได้ (ไม่มีทั้งเลข PO ที่อ่านออกและตัวที่เลือกบนจอ) คืน recv ว่าง
 * ไม่ใช่เดาเอาจากใครสักคน — เดาผิดคือเลขผิดโรงงานบนจอ
 */
export function kitReceiveByPo(groups = [], entries = [], { current = '', known = null } = {}) {
  const out = new Map();
  for (const g of groups || []) {
    const r = resolveEntity(g.po, { current, known });
    out.set(g.po, { entity: r.code, from: r.from,
      recv: r.code ? receivedOfDoc(entries, r.code, g.po) : new Map() });
  }
  return out;
}

/**
 * สถานะรายใบของบรรทัดที่กางจากไฟล์ — ใบไหนมาแล้ว (มียอดครบ) ใบไหนยังไม่มา (ว่างทั้งใบ)
 *
 * ⚠️ มีเพราะเจ้าของบอกว่าของ "แล้วแต่รอบ ไม่แน่นอน" (23 ก.ย. 2026)
 * ไฟล์จริงใบหนึ่ง 238 บรรทัด 33 PO ถ้ารอบนั้นมาแค่สิบใบ พนักงานต้องไล่ล้างยอด
 * ร้อยกว่าบรรทัดทีละช่อง ซึ่งคือการคีย์มือที่ Delta สั่งให้เลิก ในอีกรูปหนึ่ง
 *
 * เรียงตามลำดับที่บรรทัดอยู่ ไม่สลับให้ · headerPo = เลข PO บนหัวจอ (ทางคีย์เอง)
 *
 * ⚠️ นับและสลับเฉพาะบรรทัดที่ไฟล์บอกยอดมามากกว่าศูนย์ (fromFile) — รีวิว #105
 * บรรทัดที่ไม่มียอดจากไฟล์ (ซื้อทดแทนจากปุ่ม "ไปรับของ" · ช่อง issue ว่าง · Delta จ่ายศูนย์)
 * ถ้านับด้วย ชิปจะขึ้น "บางส่วน" ตั้งแต่ยังไม่มีใครแตะ และปุ่ม "ยังไม่มา" จะล้างยอด
 * ที่พนักงานคีย์เองทิ้ง โดยกดชิปเอากลับไม่ได้ เพราะไฟล์ไม่มีเลขให้เติมคืน
 */
const fromFile = l => !!l && Number(l.issued) > 0;

export function kitPoSummary(lines = [], { headerPo = '' } = {}) {
  const byPo = new Map();
  for (const l of lines || []) {
    if (!fromFile(l)) continue;
    const po = String(l.po || headerPo || '').trim();
    if (!po) continue;
    const g = byPo.get(po) || { po, lines: 0, filled: 0 };
    g.lines++;
    if (Number(l.qty) > 0) g.filled++;
    byPo.set(po, g);
  }
  return [...byPo.values()].map(g => ({
    ...g, state: g.filled === 0 ? 'none' : g.filled === g.lines ? 'all' : 'some'
  }));
}

/**
 * สลับทั้งใบ — มาแล้ว = เติมยอดรับจริงตามที่ไฟล์บอก · ยังไม่มา = ล้างยอดทิ้ง (ไม่ถูกบันทึก)
 * คืนจำนวนบรรทัดที่เปลี่ยน · แก้บรรทัดเดิมในที่ เพราะหน้าจอผูกกับอ็อบเจกต์ตัวนั้นอยู่
 *
 * ⚠️ ล้าง = ค่าว่าง ไม่ใช่ศูนย์ — บรรทัดที่ว่างไม่ถูกบันทึก แต่บรรทัดที่เป็นศูนย์
 *    จะถูกอ่านว่า "มาแล้วแต่ได้ศูนย์" ซึ่งเป็นคนละเรื่องกันเลย
 * ⚠️ เติมทับยอดที่พนักงานแก้ไว้ในใบนั้น — สลับทั้งใบคือ "กลับไปตามไฟล์" โดยตั้งใจ
 *    หน้าจอต้องบอกไว้ให้เห็นก่อนกด
 */
export function setPoArrived(lines = [], po, arrived, { headerPo = '' } = {}) {
  const want = String(po || '').trim();
  let n = 0;
  for (const l of lines || []) {
    if (!fromFile(l) || String(l.po || headerPo || '').trim() !== want) continue;
    const next = arrived ? l.issued : null;
    if (l.qty !== next) { l.qty = next; n++; }
  }
  return n;
}

/**
 * กดชิปของใบนี้แล้วจะเป็น "มาแล้ว" ไหม — ว่างทั้งใบ → เติม · มียอดอยู่ (ครบหรือบางส่วน) → ล้าง
 * บางส่วนเลือกล้าง เพราะพลาดแล้วไม่มีอะไรถูกบันทึกเกิน แค่ต้องกดเติมกลับ
 */
export const nextArrived = g => !!g && g.state === 'none';

/**
 * แถวนี้มาจากไฟล์กลุ่มจ่ายรวมไหม — ของที่มาจริง ('chem') หรือของที่ตัดจากยอด over ('chemover')
 *
 * ⚠️ มีตัวกลางตัวเดียวเพราะเดิมโค้ดเทียบ src === 'chem' ตรง ๆ อยู่สี่จุด
 * พอเพิ่มป้ายที่มาใหม่ ถ้าไล่แก้ไม่ครบ แถวที่ตัดจากยอด over จะไปโผล่ในหน้าคีย์รับเข้าปกติ
 * และในตัวนับหน้าแรก โดยไม่มีอะไรฟ้อง
 */
export const isChemKit = k => !!k && (k.src === 'chem' || k.src === 'chemover');

/**
 * รหัสที่เคยคีย์รับเข้ากับ PO นี้แล้ว แต่ไม่อยู่ในรายการที่กางมา (Kit List หรือสูตร) — issue #52 · #78
 *
 * หน้ารับเข้ากับหน้าจ่ายออกต้องกางรายการชุดเดียวกัน · เดิมหน้ารับเข้าเติมรหัสพวกนี้ให้ (#52)
 * แต่หน้าจ่ายออกไม่เติม ของที่รับมานอก Kit List จึงหายจากหน้าจ่ายออก เบิกไม่ได้ (#78 — เจ้าของเจอ 15 ก.ย. 2026)
 * ⚠️ ทั้งสองหน้าต้องเรียกตัวนี้ ห้ามเขียนเงื่อนไขซ้ำเอง ไม่งั้นสองหน้าจะหลุดจากกันอีก
 *
 * recv   = ผลของ receivedOfDoc() ซึ่งกรองนิติบุคคลมาแล้ว (INVARIANTS A3)
 * listed = รหัสที่กางอยู่แล้ว · เทียบเป็นข้อความ เพราะรหัสจาก Kit List อาจเป็นตัวเลข
 * คืน [{ code, recv }] ตามลำดับที่เจอในสมุด
 */
export function receivedOutsideList(recv, listed) {
  const have = new Set([...(listed || [])].map(c => String(c)));
  const out = [];
  for (const [code, r] of (recv || new Map())) {
    if (!have.has(String(code))) out.push({ code: String(code), recv: r });
  }
  return out;
}

/**
 * เลข PO บนหัวฟอร์มเปลี่ยนจากใบที่รายการบนจอเป็นของจริงไหม — ใช้ตัดสินว่าจะล้างบรรทัดเดิมทิ้ง (#78)
 *
 * เจ้าของเลือก 15 ก.ย. 2026: ล้างเฉพาะตอนเปลี่ยนใบ · แก้ P/N หรือจำนวนสั่งในใบเดิม บรรทัดที่พนักงานคีย์เองต้องอยู่
 * (รอบแรกล้างทุกครั้งที่แตะช่องหัว — คีย์บรรทัดเองแล้วค่อยเติม P/N บรรทัดหายหมด)
 * เจ้าของเลือก 16 ก.ย. 2026: เปลี่ยนใบ = **จากเลขหนึ่งไปอีกเลขหนึ่งเท่านั้น**
 *   ช่องว่างแล้วค่อยใส่เลข (คีย์บรรทัดก่อน หรือกด "ไปเบิก" มาจากหน้าการ์ด) หรือลบเลขทิ้ง → บรรทัดอยู่ครบ
 * เทียบเป็นข้อความตัดช่องว่าง เพราะช่อง PO มาจากทั้งการพิมพ์และไฟล์ที่อาจเป็นตัวเลข
 */
export function switchedPo(shownPo, po) {
  const was = String(shownPo ?? '').trim(), now = String(po ?? '').trim();
  return !!was && !!now && was !== now;
}

/**
 * เลข PO ที่ต้องจำไว้หลังกางรอบนี้ — ช่องว่างไม่ลบความจำ
 * ไม่งั้น "ลบเลข A ทิ้ง แล้วพิมพ์ B" จะนับเป็นว่าง → B ไม่ใช่เปลี่ยนใบ บรรทัดของ A ค้างอยู่ใต้หัว B
 */
export const nextShownPo = (shownPo, po) =>
  String(po ?? '').trim() || String(shownPo ?? '').trim();

/**
 * เลข PO ทุกใบที่เคยมีประวัติในโปรแกรม — [{ po, pn, date, from }] ใบล่าสุดขึ้นก่อน (เจ้าของ 16 ก.ย. 2026)
 *
 * รวมสี่ที่มา: ไฟล์ PO รายวัน · Kit List · ใบที่เคยคีย์รับ-จ่าย (สมุด) · รายการของขาด
 * ⚠️ INVARIANTS A3 — สมุดกับรายการของขาดเป็นของราย**นิติบุคคล** จึงกรองด้วย entity เสมอ
 *    ถ้ายังไม่ได้เลือกนิติบุคคล จะไม่เอาสองที่มานั้นมาเลย (ไฟล์ PO กับ Kit List เป็นเอกสารกลาง ใช้ร่วมกัน)
 * วันที่เก็บวันล่าสุดที่เจอของใบนั้น ใช้เรียงลำดับให้ใบที่เพิ่งใช้อยู่บนสุด
 */
export function poHistory({ pos = [], kits = [], entries = [], shorts = [],
                            entity = '', known = null } = {}) {
  const seen = new Map();
  const add = (po, pn, date, from) => {
    const key = String(po ?? '').trim();
    if (!key) return;
    const hit = seen.get(key) || { po: key, pn: '', date: '', from: [] };
    if (!hit.pn && pn != null && String(pn).trim()) hit.pn = String(pn).trim();
    const d = String(date || '').slice(0, 10);
    if (d > hit.date) hit.date = d;
    if (!hit.from.includes(from)) hit.from.push(from);
    seen.set(key, hit);
  };
  // เอกสารของ Delta ไม่มีช่องนิติบุคคลรายแถว — ดูจากรูปแบบเลขที่ PO อย่างเดียว
  // ⚠️ ไม่ดูคอลัมน์ผู้รับเหมาในไฟล์ (ช่อง sub) เจ้าของยืนยัน 19 ก.ย. 2026 ว่ากรอกมาไม่ตรงเป็นบางใบ
  // ใบที่ตัดสินไม่ได้ หรือเป็นของรหัสที่ยังไม่มีในทะเบียน ขึ้นทุกนิติบุคคล (เจ้าของ 17 ก.ย. 2026)
  const ownerOf = po => poOwnerOf(po, { known });
  for (const p of pos || []) {
    if (!poVisibleTo(ownerOf(p && p.po), entity)) continue;
    add(p && p.po, p && p.pn, p && p.date, 'ไฟล์ PO');
  }
  for (const k of kits || []) {
    if (!poVisibleTo(ownerOf(k && k.po), entity)) continue;
    add(k && k.po, k && k.pn, k && k.date, 'Kit List');
  }
  if (entity) {
    for (const e of entries || []) {
      if (!e || e.entity !== entity || e.voided) continue;
      // doc_ref ของรายการจากการนับของคือเลขใบนับ ไม่ใช่เลข PO (core/count.js:107) — ห้ามเอามาเป็นประวัติ PO
      // ตัดเฉพาะ count ออก ไม่ใช่เอาเฉพาะ doc_kind === 'po' เพราะแบบหลังจะทิ้งรายการที่ doc_kind ว่างไปด้วย
      if (e.doc_kind === 'count') continue;
      // ⚠️ at ของสมุดเป็น UTC — slice เอาเองจะได้ "เมื่อวาน" ทุกใบที่คีย์ก่อนเจ็ดโมง (localtime.js:11)
      add(e.doc_ref, e.part_no, localDate(e.at), 'เคยคีย์');
    }
    for (const s of shorts || []) {
      if (!s || s.voided || (s.entity && s.entity !== entity)) continue;
      add(s.po, s.part_no, s.date, 'ของขาด');
    }
  }
  return [...seen.values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.po).localeCompare(String(a.po)));
}

/**
 * ค้นเลข PO จากที่พิมพ์บางส่วน — พนักงานพิมพ์ **ท้ายเลข** (เช่น 4 ตัวท้าย) เป็นหลัก จึงให้คะแนนท้ายเลขสูงรองจากตรงเป๊ะ
 * ไม่ใช้ <datalist> เหมือน v1 เพราะมันโชว์ได้บรรทัดเดียว แยกใบที่ P/N ต่างกันไม่ออก (issue #26)
 */
export function searchPos(list, q, { limit = 40 } = {}) {
  const term = String(q ?? '').trim().toUpperCase();
  const scored = [];
  for (const r of list || []) {
    if (!r) continue;
    const po = String(r.po || '').toUpperCase();
    const pn = String(r.pn || '').toUpperCase();
    let score = -1;
    if (!term) score = 0;
    else if (po === term) score = 100;
    else if (po.endsWith(term)) score = 80;
    else if (po.startsWith(term)) score = 70;
    else if (po.includes(term)) score = 50;
    else if (pn.includes(term)) score = 30;
    if (score < 0) continue;
    scored.push({ ...r, _score: score });
  }
  scored.sort((a, b) => b._score - a._score
    || String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.po).localeCompare(String(b.po)));
  return scored.slice(0, limit);
}

/**
 * PO ใบนี้คือ P/N อะไร จำนวนเท่าไหร่ วันที่ไหน — จากไฟล์ PO รายวันที่นำเข้าไว้
 *
 * 1 PO ต่อ 1 P/N เสมอ แต่ PO ใบเดียวโผล่ได้หลายวันในไฟล์ (ของทยอยมา)
 * จึงเอาแถวของวันล่าสุดเป็นตัวตอบ เพราะเป็นข้อมูลที่ Delta ยืนยันครั้งหลังสุด
 * ไม่พบ = คืน null ให้ผู้เรียกปล่อยช่องเดิมไว้ ห้ามเดาค่าให้
 */
export function poHeader(poList, po) {
  const key = String(po == null ? '' : po).trim();
  if (!key) return null;
  const hit = (poList || [])
    .filter(p => p && String(p.po == null ? '' : p.po).trim() === key)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .pop();
  return hit ? { pn: String(hit.pn || ''), order: Number(hit.qty) || null,
                 date: String(hit.date || '') } : null;
}

/** แผนการนำเข้า — บอกก่อนกดว่าอะไรใหม่ อะไรซ้ำ อะไรยังไม่รู้จัก */
export function importPlan(rows, { existing = [], materials = [], poList = [] } = {}) {
  const have = new Set(existing.map(x => String(x.id)));
  const known = new Set(materials.map(m => String(m.material_code)));
  const knownPo = new Set(poList.map(p => String(p.po)));
  const fresh = rows.filter(r => !have.has(String(r.id)));
  const pos = [...new Set(rows.map(r => r.po))].filter(Boolean);
  return {
    total: rows.length,
    fresh,
    dup: rows.length - fresh.length,
    pos,
    noPo: pos.filter(p => !knownPo.has(p)),
    codeNew: [...new Set(rows.map(r => r.code).filter(c => c && !known.has(String(c))))],
    totalIssue: r6(rows.reduce((a, r) => a + (r.issue || 0), 0))
  };
}
