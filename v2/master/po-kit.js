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
    if (typeof c3 !== 'number' || !row[1]) continue;
    rawLines++;
    const code = String(Math.round(c3));
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
 *
 * รับ { sheets: [{ name, hidden, aoa }] } ไม่ใช่ workbook ของ SheetJS
 * เพื่อให้เทสได้โดยไม่ต้องมีไฟล์จริง
 */
export function parseKitChem(book) {
  const agg = new Map(), sheets = [], skipped = [], gaps = [], blocks = [];
  let rawLines = 0, docDate = '';

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

    let blk = null, nSheet = 0, prevItem = null, blockStart = false;
    const closeBlock = docTotal => {
      if (!blk || !blk.n) { blk = null; return; }
      blocks.push({ sheet: sh.name, code: blk.code, lines: blk.n, calc: r6(blk.sum),
        docTotal: docTotal === null ? null : r6(docTotal),
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
      if (!blk) blk = { code, n: 0, sum: 0 };

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
      const key = po + '|' + code, hit = agg.get(key);
      if (hit) {
        hit.req   = (req === null && hit.req   === null) ? null : r6((hit.req   || 0) + (req || 0));
        hit.issue = (s41 === null && hit.issue === null) ? null : r6((hit.issue || 0) + (s41 || 0));
        hit.n++;
      } else agg.set(key, {
        id: 'C' + (sheetDate || docDate) + '-' + po + '-' + code,
        src: 'chem', date: sheetDate || docDate,
        group: String(row[col.group] == null ? '' : row[col.group]).trim().toUpperCase(),
        po, code, pn: codeOf(row[col.pn]), orderQty: numOf(row[col.order]),
        desc: String(row[col.desc] == null ? '' : row[col.desc]).trim(), unit: '',
        req, issue: s41,
        remark: col.rem >= 0 ? String(row[col.rem] == null ? '' : row[col.rem]).trim() : '',
        n: 1
      });
    }
    closeBlock(null);
    sheets.push({ name: sh.name, rows: nSheet, date: sheetDate });
  }

  const rows = [...agg.values()];
  return { rows, docDate, sheets, skipped, gaps, blocks, rawLines,
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
  kits.filter(k => k.po === String(po || '').trim() && k.src !== 'chem');

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
