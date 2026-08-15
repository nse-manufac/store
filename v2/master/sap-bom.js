/**
 * อ่านเอกสาร Indented BOM ของ Delta (REPORT YTRPBOM1 / TCODE YPT43)
 *
 * ⚠️ ไฟล์นี้คือตัวอ่านชุดเดียวในระบบ
 * v1 มีสองชุด — ในโปรแกรมแปลงแยก กับที่คัดลอกไปฝังใน ทะเบียนวัตถุดิบ.html
 * แก้ที่เดียวแล้วอีกที่ไม่ตาม ไฟล์ที่ได้จากสองทางจึงไม่เหมือนกัน ห้ามให้เกิดอีก
 *
 * ── ตัวอ่านแยกเป็นสองชั้นเพื่อให้เทสได้ ──────────────────────────
 * parseBomText()  ตรรกะล้วน ไม่แตะ DOM — เทสด้วย node ได้
 * parseBomHtml()  แค่ดึงข้อความออกจาก HTML แล้วส่งต่อ — ต้องมีเบราว์เซอร์
 */

/**
 * ตารางหน่วย
 *
 *   confirmed: true   ยืนยันแล้ว แปลงได้เลย
 *   confirmed: false  มีหลักฐานหนักแน่นแต่ยังไม่ได้ยืนยันกับ Delta — แปลงให้แต่ติดธงไปด้วย
 *   ไม่มีในตาราง      ไม่รู้จัก = ปฏิเสธไม่ให้เข้า ไม่ใช่ปล่อยผ่านด้วยตัวคูณ 1
 *
 * ── ทำไมของที่ไม่รู้จักต้องถูกปฏิเสธ ─────────────────────────────
 * v1 ปล่อยผ่านด้วยตัวคูณ 1 แล้วติดธง unknown_uom = TRUE ไว้เฉย ๆ
 * ผลคือยอด pack mat ออกมาสูงกว่าจริง 1,000 เท่าโดยไม่มีอะไรหยุด
 * ธงที่ไม่หยุดอะไรเลยคือธงที่ไม่มีใครดู
 */
export const UOM = {
  GRM: { to: 'KGM', f: 1e-3, confirmed: true },
  MG:  { to: 'KGM', f: 1e-6, confirmed: true },
  KG:  { to: 'KGM', f: 1,    confirmed: true },
  KGM: { to: 'KGM', f: 1,    confirmed: true },
  MTR: { to: 'MTR', f: 1,    confirmed: true },
  M:   { to: 'MTR', f: 1,    confirmed: true },
  PCE: { to: 'PCE', f: 1,    confirmed: true },
  PCS: { to: 'PCE', f: 1,    confirmed: true },
  NPR: { to: 'NPR', f: 1,    confirmed: true },
  PST: { to: 'NPR', f: 1,    confirmed: true },

  // TP — เชื่อว่าเป็น "ต่อพันชิ้น" จากการเทียบยอดตามสูตรกับของที่ Delta จ่ายมาจริง
  // 27 คู่ออกมาเป็น 1,000 เท่าพอดี ตรงกันถึงทศนิยมตำแหน่งที่สี่ ข้ามคนละ P/N คนละวัสดุ
  // เช่น CARTON CRGD PAPER 3.473 TP กับของจริง 0.0034725
  // ยังไม่ยืนยันกับ Delta จึงแปลงให้แต่ติดธงไว้ และหน้าจอที่ใช้ตัวเลขนี้ต้องแสดงธงด้วย
  TP:  { to: 'PCE', f: 1e-3, confirmed: false,
         why: 'เชื่อว่าเป็นต่อ 1,000 ชิ้น — ยังรอ Delta ยืนยัน' }
};

const r10 = n => Math.round(n * 1e10) / 1e10;

/** รหัสช่วง 28 คือของที่ทำเองหรือกึ่งสำเร็จรูป ไม่ใช่วัตถุดิบที่เบิกจากคลัง */
export const isInHouse = code => /^28/.test(String(code));

/**
 * อ่านเอกสารจากข้อความล้วน
 *
 * รายงานนี้จัดคอลัมน์แบบตายตัว จึงตัดตามตำแหน่งที่อ่านได้จากบรรทัดหัวตาราง
 * ปลอดภัยกว่าเดาด้วย regex เพราะบางช่องเว้นว่างทั้งคอลัมน์
 */
export function parseBomText(text, fileName = '') {
  const lines = String(text).replace(/\u00a0/g, ' ')
    .split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());

  let head = null;
  for (const l of lines) {
    const m = l.match(/MODEL\s*NO:\s*(\d+)\s+REV:\s*(\w+)\s+L\/F:\s*(\w+)\s+(.*?)\s+VALID\s*DATE\s*FROM:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) { head = { pn: m[1], rev: m[2], lf: m[3], desc: m[4].trim(),
                      valid: `${m[7]}-${m[5]}-${m[6]}` }; break; }
  }
  if (!head) return { ok: false, fileName, error: 'หาบรรทัด MODEL NO / VALID DATE FROM ไม่เจอ — เป็นไฟล์ Indented BOM จริงไหม' };

  const hdr = lines.find(l => l.includes('PART NUMBER') && l.includes('QPA'));
  if (!hdr) return { ok: false, fileName, error: 'หาบรรทัดหัวตารางไม่เจอ' };
  const at = s => hdr.indexOf(s);
  const cDesc = at('DESCRIPTION'), cAlt = at('ALT.GRP%'), cQpa = at('QPA'),
        cUom = at('UOM'), cDsg = at('DESIGN NO');

  const raw = [];
  for (const l of lines) {
    const m = l.match(/^\s*(\d+)\s+L?\.*(\d+)\s+\.*(\d{9,10})\s/);
    if (!m) continue;
    const seg = (a, b) => l.slice(a, b).trim();
    const qpaTxt = seg(cQpa, cUom).replace(/[^\d.]/g, '');
    const uom = (seg(cUom, cDsg).split(/\s+/)[0] || '').toUpperCase();
    if (!qpaTxt || !uom) continue;
    const altM = seg(cAlt, cQpa).match(/(\d+)\s*%/);
    raw.push({ item: +m[1], level: +m[2], code: m[3], desc: seg(cDesc, cAlt),
               qpa: parseFloat(qpaTxt), uom, altPct: altM ? +altM[1] : null });
  }
  if (!raw.length) return { ok: false, fileName, error: 'ไม่พบบรรทัดวัตถุดิบเลย' };

  // ── ตัดชิ้นส่วนประกอบออก ────────────────────────────────────────
  // ด่านที่ 1 — ถ้าบรรทัดถัดไปลึกกว่า แปลว่าตัวนี้เป็นหัวของกลุ่ม ไม่ใช่ของที่เบิก
  const parents = [], leaves = [];
  raw.forEach((r, i) => {
    (raw[i + 1] && raw[i + 1].level > r.level ? parents : leaves).push(r);
  });

  // ด่านที่ 2 — ด่านแรกมองเห็นเฉพาะชิ้นประกอบที่ SAP กางลูกออกมาให้ดู
  // ตัวที่พิมพ์บรรทัดเดียวไม่กาง จะแยกจากของซื้อด้วยโครงสร้างไม่ได้เลย
  // จึงใช้ช่วงรหัสแทน — วัดจากทะเบียนจริง 4,072 รายการในช่วง 28 เป็นของทำเองทั้งหมด
  // (เคยหลุดเข้ามาจริง 3 ตัว: COIL FLAT WIRE 2831738022 · 2831738122 · 2831747200)
  const inhouse = [], keep = [];
  for (const r of leaves) (isInHouse(r.code) ? inhouse : keep).push(r);

  // ── แปลงหน่วย ───────────────────────────────────────────────────
  const badUom = [], unconfirmed = [], out = [];
  for (const r of keep) {
    const u = UOM[r.uom];
    if (!u) { badUom.push(r); continue; }        // ไม่รู้จัก = ไม่ให้เข้า
    const line = { code: r.code, desc: r.desc, item: r.item, altPct: r.altPct,
                   rawQpa: r.qpa, rawUom: r.uom,
                   usage: r10(r.qpa * u.f), unit: u.to,
                   uomConfirmed: u.confirmed, uomWhy: u.why || '' };
    if (!u.confirmed) unconfirmed.push(line);
    out.push(line);
  }

  // รหัสเดียวกันโผล่หลายบรรทัด = ใช้คนละขั้นตอนในสินค้าเดียว ต้องรวมยอด
  const agg = new Map();
  for (const l of out) {
    const hit = agg.get(l.code);
    if (hit) { hit.usage = r10(hit.usage + l.usage); hit.rawQpa = r10(hit.rawQpa + l.rawQpa); hit.n++; }
    else agg.set(l.code, { ...l, n: 1 });
  }

  return {
    ok: true, fileName, ...head,
    lines: [...agg.values()],
    rawCount: raw.length,
    dropped: { parents, inhouse, badUom },
    unconfirmed,
    alt0: out.filter(l => l.altPct === 0)
  };
}

/** ดึงข้อความออกจาก HTML แล้วส่งให้ตัวอ่าน — ต้องมี DOM */
export function parseBomHtml(html, fileName = '') {
  const div = document.createElement('div');
  div.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/tr>/gi, '\n</tr>');
  return parseBomText(div.textContent || '', fileName);
}

/**
 * สรุปผลการอ่านหลายไฟล์ให้หน้าจออ่านง่าย
 * ตั้งใจให้ตัวเลขที่ "ไม่ได้เข้า" เด่นพอ ๆ กับตัวเลขที่ "เข้าแล้ว"
 * ของที่หายไปเงียบ ๆ คือสิ่งที่ทำให้ยอดผิดโดยไม่มีใครรู้
 */
export function summarize(docs) {
  const okDocs = docs.filter(d => d.ok);
  const cnt = (f) => okDocs.reduce((a, d) => a + f(d), 0);
  const uoms = new Map();
  for (const d of okDocs) for (const r of d.dropped.badUom) {
    const e = uoms.get(r.uom) || { uom: r.uom, n: 0, sample: [] };
    e.n++; if (e.sample.length < 3) e.sample.push(`${d.pn}/${r.code}`);
    uoms.set(r.uom, e);
  }
  return {
    files: docs.length,
    failed: docs.filter(d => !d.ok),
    pns: okDocs.length,
    lines: cnt(d => d.lines.length),
    parents: cnt(d => d.dropped.parents.length),
    inhouse: cnt(d => d.dropped.inhouse.length),
    blocked: cnt(d => d.dropped.badUom.length),
    blockedUoms: [...uoms.values()].sort((a, b) => b.n - a.n),
    unconfirmed: cnt(d => d.unconfirmed.length),
    alt0: cnt(d => d.alt0.length)
  };
}
