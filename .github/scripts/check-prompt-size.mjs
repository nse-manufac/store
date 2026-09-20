// ตรวจขนาดของ prompt ในไฟล์ workflow — กันอาการ "ผู้ตรวจหายเงียบ"
//
// GitHub จำกัดค่าที่มี ${{ }} อยู่ข้างในไว้ที่ 21,000 **ไบต์** (ไม่ใช่ตัวอักษร)
// ภาษาไทยตัวละ 3 ไบต์ ของจริงจึงได้ราว 7,000 ตัวอักษรเท่านั้น
//
// อาการเมื่อเกิน: **ทั้งไฟล์ workflow กลายเป็นไฟล์เสีย** ไม่ใช่แค่ขั้นตอนเดียวล้ม
// PR ใบนั้นจะไม่มีผู้ตรวจเลย และหน้า PR ไม่ขึ้นเช็คสีแดงให้เห็น
// ต้องเปิดหน้า run ถึงจะเห็น "Exceeded max expression length 21000"
// (เจอจริงที่ plan PR #92 เมื่อ 20 ก.ย. 2026 — เกินไป 64 ไบต์)
//
// กฎที่ไฟล์นี้บังคับ
//   1. prompt ที่มี ${{ }} ห้ามยาวเกิน 18,000 ไบต์ — เหลือระยะถึงเพดานจริง 3,000 ไบต์
//      ทางแก้ที่ควรใช้คือ **เอา ${{ }} ออกจาก prompt** แล้วส่งค่าผ่านไฟล์ที่ขั้นตอน
//      ก่อนหน้าเขียนไว้แทน (เช่น pr.txt) · prompt ที่ไม่มี ${{ }} ไม่ถูกนับเข้าเพดานนี้เลย
//   2. prompt อันไหนก็ตามห้ามเกิน 20,500 ไบต์ — ต่อให้ตอนนี้ไม่มี ${{ }}
//      เพราะวันที่มีคนเติมกลับเข้ามาแม้จุดเดียว มันจะพังทันทีในวันนั้น
//   3. มี ${{ }} และเกิน 12,000 ไบต์ = ขึ้นเตือน (ยังเขียว) — ให้รู้ตัวก่อนจะชน
//   4. หาไม่เจอสักอัน = ตก — ตัวอ่านที่หาไม่เจอแล้วเขียวคือด่านที่ไม่ได้ตรวจอะไรเลย
//
// อ่าน YAML แบบหยาบ ๆ เองเพราะ runner ไม่มี dependency ให้ใช้ตอนด่านนี้รัน
// (ตัวแอปและด่านอื่นก็ไม่มี dependency เหมือนกัน)

import fs from 'node:fs';
import path from 'node:path';

const DIR = '.github/workflows';
const HARD_LIMIT = 21000;   // เพดานจริงของ GitHub (เฉพาะค่าที่มี ${{ }} อยู่ข้างใน)
const EXPR_MAX = 18000;     // มี ${{ }} ได้ไม่เกินเท่านี้ — เหลือระยะ 3,000 ไบต์
const EXPR_WARN = 12000;    // มี ${{ }} เกินเท่านี้ = เตือนไว้ก่อน
const ANY_MAX = 20500;      // ไม่มี ${{ }} ก็ห้ามยาวเกินเท่านี้

/** ดึงบล็อก `prompt: |` ทุกอันในไฟล์ออกมา พร้อมเลขบรรทัดที่เริ่ม */
function promptBlocks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)prompt:\s*[|>][-+0-9]*\s*$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { body.push(''); continue; }
      const lead = l.length - l.trimStart().length;
      if (lead <= indent) break;
      body.push(l.slice(indent + 2));
    }
    out.push({ line: i + 1, text: body.join('\n') });
    i = j - 1;
  }
  return out;
}

let found = 0;
let bad = 0;

for (const name of fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f)).sort()) {
  const file = path.join(DIR, name);
  for (const block of promptBlocks(fs.readFileSync(file, 'utf8'))) {
    found++;
    const bytes = Buffer.byteLength(block.text, 'utf8');
    const hasExpr = block.text.includes('${{');
    const where = `${file}:${block.line}`;

    let failed = false;

    if (hasExpr && bytes > EXPR_MAX) {
      failed = true; bad++;
      console.log(`::error file=${file},line=${block.line}::prompt มี \${{ }} อยู่ข้างใน ` +
        `จึงติดเพดาน ${HARD_LIMIT} ไบต์ของ GitHub และตอนนี้ยาว ${bytes} ไบต์ (เกินเกณฑ์ ${EXPR_MAX}) — ` +
        `ทางแก้ที่ควรใช้คือเอา \${{ }} ออก แล้วส่งค่าผ่านไฟล์ที่ขั้นตอนก่อนหน้าเขียนไว้แทน เช่น pr.txt`);
    }
    if (bytes > ANY_MAX) {
      failed = true; bad++;
      console.log(`::error file=${file},line=${block.line}::prompt ยาว ${bytes} ไบต์ ` +
        `เกินเกณฑ์ ${ANY_MAX} — ตอนนี้ยังไม่พังเพราะไม่มี \${{ }} แต่วันที่มีคนเติมกลับเข้ามาจะพังทันที`);
    }
    if (!failed && hasExpr && bytes > EXPR_WARN) {
      console.log(`::warning file=${file},line=${block.line}::prompt มี \${{ }} และยาว ${bytes} ไบต์ ` +
        `เหลือถึงเพดานจริงอีก ${HARD_LIMIT - bytes} ไบต์ (ไทยตัวละ 3 ไบต์ ≈ ${Math.floor((HARD_LIMIT - bytes) / 3)} ตัวอักษร)`);
    }

    console.log(`${failed ? '✖' : '✔'} ${where} — ${bytes} ไบต์` +
      `${hasExpr ? ' · มี ${{ }}' : ' · ไม่มี ${{ }} จึงไม่ติดเพดาน'} · ` +
      `ระยะถึงเพดานจริง ${HARD_LIMIT - bytes}`);
  }
}

if (found === 0) {
  console.log(`::error::หา prompt ไม่เจอสักอันใน ${DIR} — ` +
    `ถ้าเปลี่ยนวิธีเขียน workflow ต้องแก้ตัวอ่านในไฟล์นี้ด้วย ไม่ใช่ปล่อยให้เขียวไปเฉย ๆ`);
  process.exit(1);
}

console.log(`\nตรวจ prompt ทั้งหมด ${found} อัน · ตก ${bad} ข้อ`);
process.exit(bad > 0 ? 1 : 0);
