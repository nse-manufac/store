/**
 * แก้ conflict ที่เกิดจากบรรทัด app-version อย่างเดียว
 *
 * ทำไมถึงชนบ่อย: INVARIANTS F4 บังคับให้ทุก PR ที่แก้ไฟล์ .html บัมป์
 * <meta name="app-version"> ซึ่งอยู่บรรทัดเดียวกันเสมอ ใบไหนเมิจทีหลังจึงชนแน่นอน
 * (9-10 ก.ย. 2026 ชนติดกันหลายใบ: #66 · #68)
 *
 * ขอบเขตของสคริปต์นี้แคบโดยตั้งใจ
 *   ✓ แก้ให้เฉพาะเมื่อ **ทุกบล็อกที่ชน** เป็นบรรทัด app-version บรรทัดเดียวทั้งสองฝั่ง
 *   ✗ ถ้ามีบล็อกไหนมีอย่างอื่นปนแม้บรรทัดเดียว — ไม่แตะอะไรเลยทั้งไฟล์
 *   ✗ ถ้าไฟล์ไหนในชุดแก้ไม่ได้ — ไม่เขียนไฟล์ไหนเลยทั้งชุด (ทั้งหมดหรือไม่มีเลย)
 *
 * เลือกเลขรุ่นยังไง
 *   v2/core/version.js เทียบแค่ "ไม่เท่ากัน" (onServer !== running)
 *   เลขอะไรก็ได้ที่ต่างจากของ main ทำงานได้ ลำดับมีไว้ให้คนอ่านเท่านั้น
 *   - ฝั่ง PR ใหม่กว่า main อยู่แล้ว → ใช้ของ PR (ไม่เปลี่ยนสิ่งที่คนเขียนไว้โดยไม่จำเป็น)
 *   - ไม่งั้น → ลำดับถัดจากของ main · ถ้าวันนี้ (เวลาไทย) ใหม่กว่า ขึ้นวันใหม่ที่ .1
 *
 * ⚠️ workflow ต้องรันสคริปต์นี้จาก checkout ของ main เท่านั้น ห้ามรันจาก branch ของ PR
 *    ไม่งั้น PR แก้สคริปต์นี้แล้วได้ AGENT_PUSH_PAT ไปฟรี ๆ
 *
 * ใช้:  node .github/scripts/version-conflict.mjs <ไฟล์ที่ชน>...
 *       รหัสออก 0 = แก้ครบทุกไฟล์แล้ว · 2 = มีไฟล์ที่แก้ไม่ได้ (ไม่มีไฟล์ไหนถูกเขียน)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERSION_RE = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;

// บรรทัด meta ของเลขรุ่น — รูปแบบเดียวกับที่ v2/core/version.js อ่าน
const META_RE = /^(\s*<meta\s+name=["']app-version["']\s+content=["'])([^"']*)(["']\s*\/?>\s*)$/i;

const OURS = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const SPLIT = /^={7}$/;
const THEIRS = /^>{7}(?: |$)/;

export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v ?? '').trim());
  return m ? { date: m[1], seq: Number(m[2]) } : null;
}

/** เทียบแบบตัวเลข — ".10" ต้องใหม่กว่า ".9" ซึ่งการเทียบสตริงจะผิด */
export function compareVersions(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.seq === b.seq ? 0 : a.seq < b.seq ? -1 : 1;
}

/** วันที่ตามเวลาไทย — ชื่อรุ่นในไฟล์ใช้วันของคนที่ทำงานอยู่ ไม่ใช่วันของ UTC */
export function bangkokDate(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/**
 * @param ours   เลขรุ่นฝั่ง PR
 * @param theirs เลขรุ่นฝั่ง main
 * @returns เลขรุ่นที่ต้องใช้ หรือ null ถ้าอ่านเลขฝั่งไหนไม่ออก
 *          ผลลัพธ์ **ต่างจาก theirs เสมอ** — ด่านบัมป์เวอร์ชันเทียบกับ main
 */
export function pickVersion(ours, theirs, now = new Date()) {
  const o = parseVersion(ours);
  const t = parseVersion(theirs);
  if (!o || !t) return null;
  if (compareVersions(o, t) > 0) return String(ours).trim();

  const today = bangkokDate(now);
  const date = today > t.date ? today : t.date;
  const seq = date === t.date ? t.seq + 1 : 1;
  return `${date}.${seq}`;
}

/**
 * แก้บล็อกชนในเนื้อไฟล์หนึ่งไฟล์
 * @returns {{ok:true, text, from:{ours,theirs}, to}} | {{ok:false, reason}}
 */
export function resolveText(text, now = new Date()) {
  const src = String(text ?? '');
  const crlf = src.includes('\r\n');
  const lines = src.split('\r\n').join('\n').split('\n');

  const out = [];
  let blocks = 0;
  let from = null;
  let to = null;

  for (let i = 0; i < lines.length; i++) {
    if (!OURS.test(lines[i])) {
      if (SPLIT.test(lines[i]) || THEIRS.test(lines[i]) || BASE.test(lines[i])) {
        return { ok: false, reason: `บรรทัด ${i + 1} มี marker ของ conflict ที่ไม่มีหัวบล็อก` };
      }
      out.push(lines[i]);
      continue;
    }

    const start = i + 1;
    const ours = [];
    const theirs = [];
    let side = 'ours';
    let closed = false;

    for (i = i + 1; i < lines.length; i++) {
      const l = lines[i];
      if (BASE.test(l)) {
        return { ok: false, reason: `บล็อกที่บรรทัด ${start} เป็นแบบ diff3 — ไม่แก้ให้` };
      }
      if (OURS.test(l)) return { ok: false, reason: `บล็อกที่บรรทัด ${start} ซ้อนกัน` };
      if (SPLIT.test(l)) {
        if (side !== 'ours') return { ok: false, reason: `บล็อกที่บรรทัด ${start} มีเส้นแบ่งเกินหนึ่ง` };
        side = 'theirs';
        continue;
      }
      if (THEIRS.test(l)) {
        closed = side === 'theirs';
        break;
      }
      (side === 'ours' ? ours : theirs).push(l);
    }

    if (!closed) return { ok: false, reason: `บล็อกที่บรรทัด ${start} ไม่ปิด` };

    const o = ours.length === 1 ? META_RE.exec(ours[0]) : null;
    const t = theirs.length === 1 ? META_RE.exec(theirs[0]) : null;
    if (!o || !t) {
      return {
        ok: false,
        reason: `บล็อกที่บรรทัด ${start} ไม่ใช่บรรทัด app-version อย่างเดียว (ฝั่ง PR ${ours.length} บรรทัด · ฝั่ง main ${theirs.length} บรรทัด)`,
      };
    }

    blocks++;
    if (blocks > 1) return { ok: false, reason: 'มีบล็อกเลขรุ่นมากกว่าหนึ่งในไฟล์เดียว — ผิดปกติ ไม่แก้ให้' };

    const picked = pickVersion(o[2], t[2], now);
    if (!picked) {
      return { ok: false, reason: `อ่านเลขรุ่นไม่ออก (ฝั่ง PR "${o[2]}" · ฝั่ง main "${t[2]}")` };
    }

    // ใช้รูปแบบบรรทัดของ main (ย่อหน้า · เครื่องหมายคำพูด) แล้วเปลี่ยนแค่ค่า
    out.push(t[1] + picked + t[3]);
    from = { ours: o[2], theirs: t[2] };
    to = picked;
  }

  if (blocks === 0) return { ok: false, reason: 'ไม่พบบล็อกชนในไฟล์' };

  const body = out.join('\n');
  return { ok: true, text: crlf ? body.split('\n').join('\r\n') : body, from, to };
}

/** แก้ทุกไฟล์ในชุด · ถ้ามีไฟล์ไหนแก้ไม่ได้ จะไม่เขียนไฟล์ไหนเลย */
export function resolveFiles(paths, { now = new Date(), read = readFileSync, write = writeFileSync } = {}) {
  const results = paths.map((p) => {
    // ชนแบบลบหรือเปลี่ยนชื่อไฟล์ — git ใส่ path ไว้ในรายการที่ชน แต่ไม่มีตัวไฟล์ใน worktree
    // ถ้าปล่อยให้โยน error stack trace ภาษาอังกฤษจะไปโผล่ในคอมเมนต์บน PR
    let text;
    try {
      text = read(p, 'utf8');
    } catch (e) {
      return { path: p, ok: false, reason: `อ่านไฟล์ไม่ได้ (${e.code || 'error'}) — มักเป็นการชนแบบลบหรือเปลี่ยนชื่อไฟล์` };
    }
    return { path: p, ...resolveText(text, now) };
  });
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    for (const r of results) write(r.path, r.text, 'utf8');
  }
  return { ok: failed.length === 0, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('ใช้: node version-conflict.mjs <ไฟล์ที่ชน>...');
    process.exit(2);
  }
  const { ok, results } = resolveFiles(paths);
  for (const r of results) {
    console.log(r.ok ? `แก้แล้ว  ${r.path}  ${r.from.ours} / ${r.from.theirs} -> ${r.to}` : `แก้ไม่ได้  ${r.path}  ${r.reason}`);
  }
  if (!ok) console.log('ไม่ได้เขียนไฟล์ไหนเลย เพราะมีไฟล์ที่แก้ไม่ได้ในชุด');
  process.exit(ok ? 0 : 2);
}
