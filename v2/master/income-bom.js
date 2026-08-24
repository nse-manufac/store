/**
 * BOM จากใบ Raw material Income (FM-ST-06)
 *
 * ── ทำไมต้องมีตัวอ่านนี้ ทั้งที่มีตัวอ่าน SAP อยู่แล้ว ────────────
 * ไฟล์ Indented BOM จาก SAP ไม่อัปเดตแล้ว ชุดล่าสุดที่มีลงวันที่ 27 ก.ค. 2026
 * และ REV ข้างในบางตัวย้อนไปถึงปี 2022 ส่วนใบเบิกวัตถุดิบออกใหม่ทุกสัปดาห์
 * ของที่ "เก่าแต่ถูกต้อง" กับ "ใหม่แต่คนกรอก" — เลือกอันหลัง แล้วสร้างด่านกันเลขผิดเอง
 *
 * ── ไฟล์นี้ไม่ใช่ไฟล์ BOM ต้องเข้าใจก่อนถึงจะอ่านถูก ──────────────
 * มันคือสมุดสะสมใบเบิกรายออเดอร์ ชีตละหนึ่งใบ ไม่เคยล้าง
 * ไฟล์ที่ชื่อ wk33 มี 224 ชีต แต่เป็นของเดือน ส.ค. 2026 แค่ 62 ชีต
 * ที่เหลือย้อนไปถึง เม.ย. 2024 · ต้องเลือกใบล่าสุดของแต่ละ P/N เสมอ
 *
 * ── BOM ไม่ผูกกับนิติบุคคล — ตรวจแล้ว ────────────────────────────
 * มี 13 P/N ที่ทำทั้ง TUE และ TPP ค่า usage ตรงกันทุกบรรทัด
 * ยกเว้นตัวที่พิสูจน์ได้ว่าเป็น typo อยู่แล้ว จึงคงคีย์ `pn|code` ไว้เหมือนเดิม
 * ชื่อบริษัทบนหัวกระดาษเก็บไว้เป็นที่มาเท่านั้น ไม่ใช่ส่วนหนึ่งของคีย์
 *
 * ── สามด่านที่มาแทนการเทียบกับ SAP ───────────────────────────────
 *   ก. P/N เดียวกันอยู่หลายชีต ค่าต้องตรงกัน   จับ 3222001411 ที่ต่างกัน 100 เท่า
 *   ข. รหัสเดียวกันข้าม P/N ต้องอยู่ใกล้ค่ากลาง จับ 3512142900 และกาวทั้งบล็อกในชีต 73
 *   ค. usage × order ต้องเท่ากับ total ในใบ    เลขเช็คที่ติดมากับเอกสารอยู่แล้ว
 * ด่าน ข ที่เกณฑ์ 10 เท่าเตือน 64 บรรทัดจาก 2,644 (2.4%) — จำนวนที่คนไล่ดูไหว
 * ธงที่เยอะกว่านี้คือธงที่ไม่มีใครดู
 *
 * ⚠️ ด่าน ค ยังจับอะไรไม่ได้เลยกับไฟล์ชุดนี้ ต้องรู้ไว้ ไม่ใช่นับว่ามีสามด่านแล้วอุ่นใจ
 * ช่อง Total Q'ty เป็นสูตร = usage × order จึงตรงกับ usage เสมอแม้ usage จะผิด
 * ที่ดูเหมือนไม่ตรง 41 บรรทัดในไฟล์จริง แยกได้เป็น total = 0 (24) กับ #VALUE! (19)
 * ไม่มีสักบรรทัดที่เป็นเลขจริงแล้วไม่ตรง — เก็บด่านนี้ไว้เพราะไม่มีต้นทุน
 * และใบที่พิมพ์ทับสูตรด้วยมือในอนาคตจะโดนจับ แต่ห้ามพึ่งมันเป็นด่านหลัก
 *
 * ไฟล์นี้ไม่รู้จัก SheetJS โดยตั้งใจ — รับ array of array ที่แปลงมาแล้ว
 * เหมือน po-kit.js จะได้เทสด้วย node ล้วนได้
 */
import { isInHouse } from './sap-bom.js';

/**
 * หน่วยบนใบเบิก
 *
 * โชคดีที่ใบนี้เขียนหน่วยเป็นหน่วยที่คลังใช้จริงอยู่แล้ว ไม่มี TP ไม่มี MMT
 * จึงไม่ต้องคูณอะไรเลย — แปลว่าไม่มีทางพลาดแบบ 1,000 เท่าจากการแปลงหน่วย
 * เหลือแค่ทำให้ตัวพิมพ์เล็กใหญ่เท่ากัน เพราะของจริงเขียนปนกันทั้ง Piece/piece/Pce
 *
 * ⚠️ ที่ไม่อยู่ในตารางนี้ต้องไม่ให้เข้า ห้ามเดาว่าเป็นตัวคูณ 1
 * ของจริงมี MRT อยู่ 2 บรรทัด ซึ่ง "น่าจะ" คือ MTR พิมพ์สลับ
 * แต่ถ้ายอมรับ typo หนึ่งตัว ครั้งหน้าก็จะมีเหตุผลให้ยอมรับตัวถัดไป
 * ทางที่ถูกคือฟ้องออกไปให้แก้ที่ต้นทาง ไม่ใช่เดาแทนเขาเงียบ ๆ
 */
export const UNIT = {
  PIECE: 'PCE', PIECES: 'PCE', PCE: 'PCE', PCS: 'PCE', PC: 'PCE',
  METER: 'MTR', METERS: 'MTR', MTR: 'MTR', M: 'MTR',
  KILOGR: 'KGM', KILOGRAM: 'KGM', KILOGRAMS: 'KGM', KG: 'KGM', KGM: 'KGM',
  PAIR: 'NPR', PAIRS: 'NPR', NPR: 'NPR', PST: 'NPR'
};

const pad = n => String(n).padStart(2, '0');
const r10 = n => Math.round(n * 1e10) / 1e10;

/** ตัดช่องว่างกับ ' ออกแล้วทำเป็นตัวใหญ่ — ใช้จับหัวคอลัมน์ที่สะกดไม่นิ่ง */
const norm = v => String(v == null ? '' : v).replace(/[\s']+/g, '').toUpperCase();
const txt = v => String(v == null ? '' : v).trim();
const numOf = v => {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = txt(v).replace(/,/g, '');
  if (!s || isNaN(+s)) return null;
  return +s;
};
const codeOf = v => typeof v === 'number' ? String(Math.round(v)) : txt(v);

/**
 * วันที่ในใบ — มาได้สามหน้าตาแล้วแต่ว่าใครแปลงไฟล์มา
 * Date object (SheetJS เปิด cellDates) · serial ของ Excel · หรือสตริงอยู่แล้ว
 */
export function dateOf(v) {
  if (v instanceof Date && !isNaN(v))
    return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  if (typeof v === 'number' && v > 40000 && v < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
  return m ? m[0] : '';
}

/**
 * บริษัทบนหัวกระดาษ
 * ฟอร์มสองสำเนียงต่างกันมากกว่าโลโก้ — TPP ใช้คำว่า P/N No. และ P/O No.
 * ถ้าจับแต่ Part No. จะหลุดไป 21 ชีตแบบเงียบ ๆ ซึ่งเป็นอาการที่แย่ที่สุด
 */
export function companyOf(head) {
  const s = head.join(' ');
  if (/ทีพีพี/.test(s) || /\bTPP\b/i.test(s)) return 'TPP';
  if (/Thai\s*Union/i.test(s)) return 'TUE';
  return '';
}

/**
 * ค่าถัดจากช่องป้ายชื่อ — ป้ายกับค่าอาจอยู่เซลล์เดียวกันหรือคนละเซลล์
 *
 * ⚠️ ต้องตรวจ "รูปร่างของค่า" ด้วย ไม่ใช่คว้าเซลล์ถัดไปที่ไม่ว่าง
 * ของจริงมีใบที่ช่อง PO เขียนป้ายไว้แต่ไม่ได้กรอกค่า ถ้าคว้าเซลล์ถัดไปดื้อ ๆ
 * จะได้คำว่า "Order :" มาเป็นเลข PO แล้วเดานิติบุคคลผิดตามไปทั้งใบ
 */
function after(row, i, re, test) {
  const inline = re.exec(txt(row[i]));
  if (inline && inline[1] && (!test || test(inline[1]))) return inline[1];
  for (let j = i + 1; j < row.length; j++) {
    const v = codeOf(row[j]);
    if (!v) continue;
    if (!test) return v;
    if (test(v)) return v;
    // เจอค่าที่ไม่ใช่รูปที่รอ = ป้ายนี้ไม่ได้กรอก อย่าเดินต่อไปคว้าของช่องอื่น
    if (/[:：]/.test(v)) return '';
  }
  return '';
}

const isPn = v => /^\d{9,10}$/.test(v);
const isPo = v => /^[A-Za-z]{2}[\w\-/]{3,}$/.test(v);

/**
 * อ่านใบเบิกหนึ่งใบ
 *
 * หาคอลัมน์จากแถวหัวตารางเสมอ ไม่ล็อกตำแหน่ง
 * ของจริงเจอสามแบบ — เลื่อนไปหนึ่งคอลัมน์บ้าง สะกด Usage/Pes บ้าง
 */
export function parseIncomeSheet(aoa, sheetName = '') {
  const rows = (aoa || []).map(r => Array.isArray(r) ? r : []);
  const fail = error => ({ ok: false, sheet: sheetName, error });

  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const n = rows[i].map(norm);
    if (n.includes('ITEM') && n.some(c => c.startsWith('CODEMATERIAL'))) { hi = i; break; }
  }
  /**
   * ไม่เจอหัวตารางเลย = ไม่ใช่ใบเบิก ไม่ใช่ใบเบิกที่พัง
   *
   * ต้องแยกสองอย่างนี้ให้ออก เพราะสมุดจริงมีชีตอื่นปนอยู่หลายชีต
   * (Material · เคมี · ตารางรับวัตถุดิบ · stock Tpp · PN · data)
   * ถ้าฟ้องว่า "อ่านไม่ได้" ทุกชีต รายการเตือนจะยาวจนคนเลิกอ่าน
   * แล้วใบที่พังจริงจะจมหายไปในนั้น
   */
  if (hi < 0) return { ...fail('ไม่ใช่ใบ Raw material Income'), notForm: true };

  const hdr = rows[hi].map(norm);
  const col = re => hdr.findIndex(c => re.test(c));
  const cItem = col(/^ITEM$/), cCode = col(/^CODEMATERIAL/), cDesc = col(/^DESCRIPTION/);
  // ของจริงสะกดตกเป็น Usage/Pes อยู่ 2 ชีต จึงจับแค่ USAGE พอ
  const cUse = col(/^USAGE/), cTot = col(/^TOTALQ?TY/);
  if (cCode < 0 || cUse < 0 || cTot < 0)
    return fail('หัวตารางไม่ครบ — ต้องมี Code Material · Usage · Total Q\'ty');

  const head = [];
  for (let i = 0; i < hi; i++) for (const c of rows[i]) if (c != null && txt(c)) head.push(txt(c));

  let pn = '', po = '', order = null, date = '', week = '';
  for (let i = 0; i < hi; i++) {
    const row = rows[i];
    for (let j = 0; j < row.length; j++) {
      const n = norm(row[j]);
      if (!n) continue;
      if (!pn && /^(PARTNO|P\/NNO)/.test(n))
        pn = after(row, j, /(?:PART|P\/N)\s*NO\.?\s*:?\s*(\d{9,10})\b/i, isPn);
      if (!po && /(^|\W)(PO\.?NO|P\/ONO)/.test(n))
        po = after(row, j, /(?:P\/O|PO)\.?\s*No\.?\s*:\s*([\w\-/]+)/i, isPo);
      if (order == null && /^ORDER/.test(n)) order = numOf(after(row, j, /ORDER\s*:?\s*([\d,.]+)/i));
      if (!date && /^DATE/.test(n)) {
        const inline = dateOf(row[j]);
        if (inline) date = inline;
        else for (let k = j + 1; k < row.length && !date; k++) date = dateOf(row[k]);
      }
      if (!week && /^WEEK/.test(n)) week = txt(row[j]).replace(/\s+/g, ' ');
    }
  }
  /**
   * ใบที่ไม่มี P/N ใช้ไม่ได้เลย เพราะไม่รู้ว่าเป็นสูตรของอะไร
   *
   * แต่ต้องบอกให้ตรงจุดว่าพังตรงไหน ไม่ใช่ "อ่านไม่ได้" เฉย ๆ
   * เพราะสองใบที่พังในไฟล์จริงเป็นคนกรอกผิด ไม่ใช่ฟอร์มคนละแบบ — แก้ที่ต้นทางได้ทันทีถ้ารู้ว่าผิดอะไร
   *   ชีต 21  ป้ายสลับกัน ช่อง P0 No. ใส่ P/N ส่วนช่อง Part No. ใส่เลข PO
   *   ชีต 152 พิมพ์ P/N เกินมาหนึ่งหลัก 28707083900 มี 11 หลัก
   */
  if (!isPn(pn)) {
    const good = [], loose = [];
    for (let i = 0; i < hi; i++) for (const c of rows[i]) {
      const v = codeOf(c);
      if (!/^\d{8,12}$/.test(v)) continue;
      (isPn(v) ? good : loose).push(v);
    }
    // มีเลขที่หน้าตาเป็น P/N อยู่ในหัวใบ แต่ไม่ได้อยู่ในช่องของมัน = กรอกสลับช่อง
    // ไม่หยิบมาใช้เองเด็ดขาด — เดาถูกเก้าครั้งไม่ได้ชดเชยครั้งที่สิบที่ผูกสูตรผิดตัว
    if (good.length) return fail(`ช่อง Part No. ไม่มี P/N แต่เจอ "${good[0]}" อยู่ช่องอื่นในหัวใบ — น่าจะกรอกสลับช่อง`);
    if (loose.length) return fail(`P/N ต้องมี 9–10 หลัก แต่ในใบเขียนว่า "${loose[0]}" (${loose[0].length} หลัก)`);
    return fail('อ่าน P/N ไม่ได้ — หาเลข 9–10 หลักในหัวใบไม่เจอ');
  }

  const lines = [], rejected = [], inhouse = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = codeOf(row[cCode]);
    if (!/^\d{9,10}$/.test(code)) continue;
    // ของทำเองช่วง 28 ไม่ใช่วัตถุดิบที่เบิกจากคลัง — กฎเดียวกับตัวอ่าน SAP
    if (isInHouse(code)) { inhouse.push(code); continue; }

    const rawUnit = txt(row[cTot + 1]);
    const unit = UNIT[norm(rawUnit)] || '';
    const usage = numOf(row[cUse]);
    const total = numOf(row[cTot]);
    const desc = cDesc >= 0 ? txt(row[cDesc]) : '';
    const item = cItem >= 0 ? numOf(row[cItem]) : null;

    if (usage == null || usage <= 0) {
      rejected.push({ code, desc, why: 'ไม่มียอดต่อชิ้น', rawUnit, raw: txt(row[cUse]) });
      continue;
    }
    if (!unit) {
      rejected.push({ code, desc, why: 'หน่วยไม่รู้จัก', rawUnit, raw: rawUnit });
      continue;
    }
    lines.push({ item, code, desc, usage: r10(usage), unit, rawUnit, total });
  }
  if (!lines.length) return fail('ไม่มีบรรทัดวัตถุดิบที่ใช้ได้เลย');

  // ── ด่าน ค · เลขเช็คที่ติดมากับเอกสาร ──────────────────────────
  // ช่อง Total Q'ty ในใบส่วนใหญ่เป็นสูตร usage × order ซึ่งจะตรงเสมอและเช็คอะไรไม่ได้
  // แต่ของจริงมี 41 บรรทัดที่ไม่ตรง แปลว่ามีคนพิมพ์ทับสูตรไว้ — ตรงนั้นคือที่ที่ต้องดู
  const sumOff = [];
  if (order) for (const l of lines) {
    if (l.total == null || l.total === 0) continue;
    const want = l.usage * order;
    if (Math.abs(want - l.total) > Math.max(0.01, Math.abs(l.total) * 0.005))
      sumOff.push({ code: l.code, desc: l.desc, usage: l.usage, order, total: l.total, want: r10(want) });
  }

  // รหัสเดียวกันโผล่หลายบรรทัดในใบเดียว = คนละขั้นตอนการผลิต ต้องรวมยอด
  // กฎเดียวกับ Kit List ที่ของจริงเจอ TUE PTFE 5.4 + 5.4 = 10.8
  const agg = new Map();
  for (const l of lines) {
    const hit = agg.get(l.code);
    if (hit) { hit.usage = r10(hit.usage + l.usage); hit.n++; }
    else agg.set(l.code, { ...l, n: 1 });
  }

  return {
    ok: true, sheet: sheetName, pn, po, order, date, week,
    company: companyOf(head),
    lines: [...agg.values()],
    rejected, inhouse, sumOff
  };
}

/** อ่านทั้งสมุด — sheets คือ [{ name, aoa }] */
export const readIncomeBook = sheets =>
  (sheets || []).map(s => parseIncomeSheet(s.aoa, s.name));

/**
 * เลือกใบล่าสุดของแต่ละ P/N
 *
 * ใบเก่ายังมีประโยชน์ในฐานะพยาน (ด่าน ก ใช้เทียบ) แต่ห้ามเอามาเป็นสูตรที่ใช้จริง
 * ใบไม่มีวันที่ให้ถือว่าเก่าที่สุด — ไม่ใช่ใหม่ที่สุด เพราะเดาผิดฝั่งนี้เสียหายน้อยกว่า
 * เสมอกันให้เอาชีตที่อยู่ท้ายสมุด เพราะคนเพิ่มใบใหม่ต่อท้ายเสมอ
 */
export function pickLatest(docs) {
  const best = new Map();
  for (const d of docs) {
    if (!d.ok) continue;
    const cur = best.get(d.pn);
    if (!cur) { best.set(d.pn, d); continue; }
    const a = d.date || '', b = cur.date || '';
    if (a > b || (a === b && (+d.sheet || 0) > (+cur.sheet || 0))) best.set(d.pn, d);
  }
  return [...best.values()].sort((a, b) => a.pn.localeCompare(b.pn));
}

/**
 * ด่าน ก — P/N เดียวกันอยู่หลายชีต แล้วค่าไม่ตรงกัน
 *
 * ปัดเศษต่างกันเป็นเรื่องปกติ (0.000834 กับ 0.0008341 คือค่าเดียวกัน)
 * ที่ต้องฟ้องคือต่างกันจนเป็นคนละจำนวน จึงวัดเป็นสัดส่วน ไม่ใช่วัดเป็นผลต่าง
 */
export function conflictsWithinPn(docs, tol = 0.02) {
  const byPn = new Map();
  for (const d of docs) {
    if (!d.ok) continue;
    if (!byPn.has(d.pn)) byPn.set(d.pn, []);
    byPn.get(d.pn).push(d);
  }
  const out = [];
  for (const [pn, list] of byPn) {
    if (list.length < 2) continue;
    const byCode = new Map();
    for (const d of list) for (const l of d.lines) {
      if (!byCode.has(l.code)) byCode.set(l.code, []);
      byCode.get(l.code).push({ sheet: d.sheet, date: d.date, usage: l.usage, desc: l.desc });
    }
    for (const [code, vals] of byCode) {
      if (vals.length < 2) continue;
      const us = vals.map(v => v.usage);
      const lo = Math.min(...us), hi = Math.max(...us);
      if (lo > 0 && (hi - lo) / lo > tol)
        out.push({ pn, code, desc: vals[0].desc, values: vals, ratio: r10(hi / lo) });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * ด่าน ข — รหัสเดียวกันข้าม P/N ควรอยู่ใกล้ ๆ กัน
 *
 * เทปเส้นเดียวกันใช้กับหม้อแปลงคนละรุ่นก็จริง แต่ไม่ควรต่างกันสิบเท่า
 * นี่คือตัวแทนของ SAP ที่หายไป — แทนที่จะเทียบกับแหล่งนอก ให้ข้อมูลเทียบกันเอง
 *
 * ต้องมีเพื่อนอย่างน้อย 3 P/N ถึงจะตัดสิน ไม่งั้นค่ากลางมาจากตัวอย่างสองตัวซึ่งเชื่อไม่ได้
 * ใช้ค่ากลาง (median) ไม่ใช่ค่าเฉลี่ย เพราะตัวที่ผิดสิบเท่าจะลากค่าเฉลี่ยตามไปด้วย
 */
export function peerOutliers(docs, { factor = 10, minPns = 3 } = {}) {
  const byCode = new Map();
  for (const d of docs) {
    if (!d.ok) continue;
    for (const l of d.lines) {
      if (!byCode.has(l.code)) byCode.set(l.code, []);
      byCode.get(l.code).push({ pn: d.pn, sheet: d.sheet, usage: l.usage, desc: l.desc });
    }
  }
  const out = [];
  for (const [code, vals] of byCode) {
    if (new Set(vals.map(v => v.pn)).size < minPns) continue;
    const med = median(vals.map(v => v.usage));
    if (!(med > 0)) continue;
    for (const v of vals) {
      const ratio = v.usage > med ? v.usage / med : med / v.usage;
      if (ratio >= factor)
        out.push({ code, desc: v.desc, pn: v.pn, sheet: v.sheet,
                   usage: v.usage, median: r10(med), ratio: r10(ratio) });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** แถวที่ถูกด่าน ก หรือ ข ทัก — ใช้กันไม่ให้กดรับทั้งชุดโดยไม่ดู */
export function flaggedKeys(conflicts, outliers) {
  const s = new Set();
  for (const c of conflicts) s.add(c.pn + '|' + c.code);
  for (const o of outliers) s.add(o.pn + '|' + o.code);
  return s;
}

/** แปลงใบหนึ่งใบเป็นแถว BOM — รูปเดียวกับที่ตัวอ่าน SAP คืนมา จะได้ใช้หน้าจอเดิมได้ */
export function makeIncomeRows(doc, { now = new Date().toISOString() } = {}) {
  if (!doc.ok) return [];
  return doc.lines.map(l => ({
    id: `${doc.pn}|${l.code}`,
    pn: doc.pn,
    code: l.code,
    desc: l.desc,
    usage: l.usage,
    unit: l.unit,
    lines: l.n,
    altPct: null,
    // หน่วยบนใบนี้เป็นหน่วยคลังอยู่แล้ว ไม่ได้ผ่านตัวคูณอะไรเลย จึงถือว่ายืนยัน
    uomConfirmed: true,
    uomWhy: '',
    rawQpa: l.usage,
    rawUom: l.rawUnit,
    rev: '',
    valid_from: doc.date || '',
    // เก็บให้ตามรอยกลับไปที่ใบต้นทางได้ ตอนมีคนถามว่าเลขนี้มาจากไหน
    source: `ใบเบิก ชีต ${doc.sheet}` + (doc.date ? ' · ' + doc.date : ''),
    source_po: doc.po || '',
    source_company: doc.company || '',
    imported_at: now
  }));
}

/**
 * สรุปทั้งสมุดให้หน้าจออ่าน
 * ตัวเลขที่ "ไม่ได้เข้า" ต้องเด่นพอ ๆ กับตัวเลขที่ "เข้าแล้ว" — กฎเดียวกับ summarize ของ SAP
 */
export function summarizeIncome(docs, latest, conflicts, outliers) {
  const ok = docs.filter(d => d.ok);
  const units = new Map();
  const noUse = [];
  for (const d of ok) for (const r of d.rejected) {
    if (r.why === 'หน่วยไม่รู้จัก') {
      const k = r.rawUnit || '(ว่าง)';
      const e = units.get(k) || { unit: k, n: 0, sample: [] };
      e.n++; if (e.sample.length < 3) e.sample.push(`${d.pn}/${r.code}`);
      units.set(k, e);
    } else if (noUse.length < 40) noUse.push({ ...r, pn: d.pn, sheet: d.sheet });
  }
  const dates = ok.map(d => d.date).filter(Boolean).sort();
  return {
    sheets: docs.length,
    failed: docs.filter(d => !d.ok),
    pnsAll: new Set(ok.map(d => d.pn)).size,
    pnsUsed: latest.length,
    dropped: ok.length - latest.length,
    lines: latest.reduce((a, d) => a + d.lines.length, 0),
    inhouse: ok.reduce((a, d) => a + d.inhouse.length, 0),
    badUnits: [...units.values()].sort((a, b) => b.n - a.n),
    noUsage: noUse,
    sumOff: latest.reduce((a, d) => a + d.sumOff.length, 0),
    conflicts: conflicts.length,
    outliers: outliers.length,
    companies: ok.reduce((m, d) => (m[d.company || '?'] = (m[d.company || '?'] || 0) + 1, m), {}),
    from: dates[0] || '', to: dates[dates.length - 1] || ''
  };
}

/**
 * แผนว่าจะเกิดอะไรขึ้นถ้ากดนำเข้า
 * ตัวเลข replacing สำคัญกว่า incoming — คนกลัวของที่หายไป ไม่ใช่ของที่เพิ่มมา
 */
export function incomePlan(latest, existingRows) {
  const cur = new Map();
  for (const r of existingRows || []) {
    if (r.deleted) continue;
    cur.set(r.pn, (cur.get(r.pn) || 0) + 1);
  }
  return latest.map(d => ({
    pn: d.pn, sheet: d.sheet, date: d.date, po: d.po, company: d.company,
    incoming: d.lines.length,
    replacing: cur.get(d.pn) || 0,
    isNew: !cur.has(d.pn),
    rejected: d.rejected.length,
    sumOff: d.sumOff.length
  })).sort((a, b) => a.pn.localeCompare(b.pn));
}

/**
 * ชีต data — ทะเบียนวัตถุดิบ 12,579 รายการ
 *
 * ตรงไปตรงมากว่า BOM มาก เพราะไม่มีตัวเลขให้ผิด มีแค่รหัส ชื่อ หน่วย
 * แต่ยังต้องกันของทำเองช่วง 28 ออก ด้วยเหตุผลเดียวกับ registryPlan
 */
export function parseDataSheet(aoa) {
  const rows = (aoa || []).map(r => Array.isArray(r) ? r : []);
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const n = rows[i].map(norm);
    if (n.some(c => /^MATERIALNO/.test(c)) && n.some(c => /^MATERIALDESC/.test(c))) { hi = i; break; }
  }
  if (hi < 0) return { ok: false, error: 'หาหัวตารางของชีต data ไม่เจอ' };
  const hdr = rows[hi].map(norm);
  const cCode = hdr.findIndex(c => /^MATERIALNO/.test(c));
  const cDesc = hdr.findIndex(c => /^MATERIALDESC/.test(c));
  const cUnit = hdr.findIndex(c => /^UNIT$/.test(c));
  const cNote = hdr.findIndex(c => /^REMARK/.test(c));

  const items = [], skipped = { inhouse: 0, badCode: 0, dup: 0, badUnit: [] };
  const seen = new Set();
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = codeOf(row[cCode]);
    if (!/^\d{9,10}$/.test(code)) { if (txt(row[cCode])) skipped.badCode++; continue; }
    if (isInHouse(code)) { skipped.inhouse++; continue; }
    if (seen.has(code)) { skipped.dup++; continue; }
    seen.add(code);
    const rawUnit = cUnit >= 0 ? txt(row[cUnit]) : '';
    const unit = UNIT[norm(rawUnit)] || '';
    if (!unit && rawUnit) skipped.badUnit.push({ code, rawUnit });
    items.push({ code, desc: cDesc >= 0 ? txt(row[cDesc]) : '',
                 unit, rawUnit, note: cNote >= 0 ? txt(row[cNote]) : '' });
  }
  return { ok: true, items, skipped };
}
