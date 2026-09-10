/**
 * เทสตัวแก้ conflict ของบรรทัด app-version — รันด้วย node
 *   node tests/version-conflict.test.mjs
 *
 * หมวด C สำคัญที่สุด — ถ้าตัวแก้ไปแตะบล็อกที่ไม่ใช่เลขรุ่นแม้บล็อกเดียว
 * มันจะ commit การตัดสินใจเรื่องโค้ดแทนคน แล้ว push ขึ้น PR โดยไม่มีใครรู้ว่าเลือกฝั่งไหนไป
 * ซึ่งแย่กว่าปล่อยให้ชนค้างไว้มาก
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseVersion, compareVersions, bangkokDate, pickVersion, resolveText, resolveFiles,
} from '../.github/scripts/version-conflict.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

// 20:53 เวลาไทยของ 10 ก.ย. 2026 — เวลาที่ #68 ชนจริง
const NOW = new Date('2026-09-10T13:53:00Z');
const meta = (v) => `<meta name="app-version" content="${v}">`;
const block = (ours, theirs) =>
  ['<<<<<<< HEAD', meta(ours), '=======', meta(theirs), '>>>>>>> origin/main'].join('\n');

console.log('=== A. อ่านเลขรุ่น ===');
ok('รูปแบบที่ใช้จริง', JSON.stringify(parseVersion('2026-09-10.5')) === '{"date":"2026-09-10","seq":5}');
ok('ช่องว่างหน้าหลังไม่เป็นไร', parseVersion(' 2026-09-10.5 ')?.seq === 5);
ok('เดือนหลักเดียวไม่รับ', parseVersion('2026-9-10.5') === null);
ok('ไม่มีลำดับไม่รับ', parseVersion('2026-09-10') === null);
ok('ค่าว่างไม่รับ ไม่โยน error', parseVersion('') === null && parseVersion(undefined) === null);

console.log('\n=== B. เลือกเลขรุ่น ===');
ok('.10 ใหม่กว่า .9 — เทียบเป็นตัวเลข ไม่ใช่สตริง',
   compareVersions(parseVersion('2026-09-10.10'), parseVersion('2026-09-10.9')) > 0);
ok('เคส #68 จริง: PR .6 ใหม่กว่า main .5 อยู่แล้ว → ใช้ของ PR',
   pickVersion('2026-09-10.6', '2026-09-10.5', NOW) === '2026-09-10.6');
ok('PR ตามหลัง main วันเดียวกัน → ลำดับถัดจาก main',
   pickVersion('2026-09-10.3', '2026-09-10.4', NOW) === '2026-09-10.5');
ok('เคส #66 จริง: PR วันเก่า .3 · main วันนี้ .4 → .5',
   pickVersion('2026-09-09.3', '2026-09-10.4', NOW) === '2026-09-10.5');
ok('เท่ากันเป๊ะ → ลำดับถัดไป', pickVersion('2026-09-10.4', '2026-09-10.4', NOW) === '2026-09-10.5');
ok('main เป็นวันเก่า → ขึ้นวันนี้ที่ .1', pickVersion('2026-09-01.2', '2026-09-08.7', NOW) === '2026-09-10.1');
ok('ใช้วันตามเวลาไทย: 17:30 UTC ของวันที่ 10 คือวันที่ 11 แล้ว',
   bangkokDate(new Date('2026-09-10T17:30:00Z')) === '2026-09-11');
ok('.9 ต่อด้วย .10 ไม่ใช่ .91', pickVersion('2026-09-10.9', '2026-09-10.9', NOW) === '2026-09-10.10');
ok('อ่านไม่ออกฝั่งใดฝั่งหนึ่ง → null', pickVersion('abc', '2026-09-10.5', NOW) === null && pickVersion('2026-09-10.5', '', NOW) === null);

// คุณสมบัติที่ต้องจริงเสมอ: ผลไม่เท่ากับของ main (ไม่งั้นด่านบัมป์เวอร์ชันแดง)
// และไม่เก่ากว่าของ main (ไม่งั้นเครื่องที่รันรุ่นใหม่จะเห็นเลขถอยหลัง)
let bad = '';
for (let i = 0; i < 3000 && !bad; i++) {
  const d = () => `2026-09-${String(1 + Math.floor(Math.random() * 15)).padStart(2, '0')}`;
  const s = () => 1 + Math.floor(Math.random() * 12);
  const ours = `${d()}.${s()}`, theirs = `${d()}.${s()}`;
  const got = pickVersion(ours, theirs, NOW);
  if (got === theirs || compareVersions(parseVersion(got), parseVersion(theirs)) <= 0) bad = `${ours} / ${theirs} -> ${got}`;
}
ok('สุ่ม 3000 คู่: ผลใหม่กว่าของ main เสมอ', bad === '', bad);

console.log('\n=== C. แก้เฉพาะบล็อกที่เป็นเลขรุ่นอย่างเดียว ===');
const around = (mid) => ['<!doctype html>', '<head>', mid, '<title>Stock</title>', '</head>'].join('\r\n');
const real = around(block('2026-09-10.6', '2026-09-10.5').split('\n').join('\r\n'));
const r1 = resolveText(real, NOW);
ok('บล็อกจริงของ #68 (CRLF) แก้ได้', r1.ok, r1.reason);
ok('ผลคือบรรทัดเดียว ไม่เหลือ marker', r1.ok && !/^(<{7}|={7}|>{7})/m.test(r1.text));
ok('บรรทัดนอกบล็อกไม่ถูกแตะเลย',
   r1.ok && r1.text === around(meta('2026-09-10.6')), JSON.stringify(r1.text));
ok('CRLF ยังเป็น CRLF ทั้งไฟล์', r1.ok && !/[^\r]\n/.test(r1.text));
ok('รายงานว่าแก้จากอะไรเป็นอะไร',
   r1.ok && r1.from.ours === '2026-09-10.6' && r1.from.theirs === '2026-09-10.5' && r1.to === '2026-09-10.6');

const lf = ['a', block('2026-09-10.3', '2026-09-10.4'), 'b'].join('\n');
const r2 = resolveText(lf, NOW);
ok('ไฟล์ LF ก็แก้ได้และยังเป็น LF', r2.ok && r2.text === ['a', meta('2026-09-10.5'), 'b'].join('\n'));

const indented = ['<<<<<<< HEAD', "  <meta name='app-version' content='2026-09-10.3'>", '=======',
  "  <meta name='app-version' content='2026-09-10.4'>", '>>>>>>> origin/main'].join('\n');
const r3 = resolveText(indented, NOW);
ok('ย่อหน้าและเครื่องหมายคำพูดตามของ main', r3.ok && r3.text === "  <meta name='app-version' content='2026-09-10.5'>");

const mixed = ['<<<<<<< HEAD', meta('2026-09-10.6'), '<div>ของ PR</div>', '=======',
  meta('2026-09-10.5'), '>>>>>>> origin/main'].join('\n');
ok('🛑 บล็อกที่มีโค้ดอื่นปน → ไม่แก้', resolveText(mixed, NOW).ok === false);

const code = ['<<<<<<< HEAD', '<b>อ่านไม่ได้</b>', '=======', '<b>อ่านไม่ออก</b>', '>>>>>>> origin/main'].join('\n');
ok('🛑 บล็อกที่ชนเรื่องโค้ดล้วน → ไม่แก้', resolveText(code, NOW).ok === false);

const both = [block('2026-09-10.6', '2026-09-10.5'), 'กลางไฟล์',
  ['<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> origin/main'].join('\n')].join('\n');
ok('🛑 มีบล็อกเลขรุ่น + บล็อกโค้ด → ไม่แก้ทั้งไฟล์ (ไม่ใช่แก้ครึ่งเดียว)', resolveText(both, NOW).ok === false);

const diff3 = ['<<<<<<< HEAD', meta('2026-09-10.6'), '||||||| base', meta('2026-09-10.4'), '=======',
  meta('2026-09-10.5'), '>>>>>>> origin/main'].join('\n');
ok('🛑 แบบ diff3 → ไม่แก้', resolveText(diff3, NOW).ok === false);

// สองเคสนี้เพิ่มหลังกลายพันธุ์เจอว่าเทสเดิมไม่ได้พิสูจน์ด่านของมันจริง
// - เคสโค้ดปนเดิมใส่ของไว้ฝั่ง PR อย่างเดียว ด่านฝั่ง main จะหายไปก็ไม่มีใครรู้
// - เคส diff3 เดิมมีบรรทัดฐานอยู่ในบล็อก เลยถูกด่าน "หลายบรรทัด" ตีตกแทนด่าน diff3
//   ต้องใช้ฐานว่าง (ทั้งสองฝั่งเพิ่มบรรทัดเดียวกัน) ซึ่งฝั่งละบรรทัดพอดีและจะผ่านไปได้ถ้าไม่มีด่านนี้
const mixedMain = ['<<<<<<< HEAD', meta('2026-09-10.6'), '=======',
  meta('2026-09-10.5'), '<div>ของ main</div>', '>>>>>>> origin/main'].join('\n');
ok('🛑 ฝั่ง main มีโค้ดอื่นปน → ไม่แก้', resolveText(mixedMain, NOW).ok === false);

const diff3Empty = ['<<<<<<< HEAD', meta('2026-09-10.6'), '||||||| base', '=======',
  meta('2026-09-10.5'), '>>>>>>> origin/main'].join('\n');
ok('🛑 แบบ diff3 ที่ฐานว่าง → ไม่แก้', resolveText(diff3Empty, NOW).ok === false);

ok('🛑 บล็อกไม่ปิด → ไม่แก้', resolveText(['<<<<<<< HEAD', meta('2026-09-10.6'), '='.repeat(7), meta('2026-09-10.5')].join('\n'), NOW).ok === false);
ok('🛑 ไม่มีเส้นแบ่ง → ไม่แก้', resolveText(['<<<<<<< HEAD', meta('2026-09-10.6'), '>>>>>>> origin/main'].join('\n'), NOW).ok === false);
ok('🛑 ไม่มีบล็อกชนเลย → ไม่แก้', resolveText(around(meta('2026-09-10.5')), NOW).ok === false);
ok('🛑 marker ลอย ๆ ไม่มีหัวบล็อก → ไม่แก้', resolveText(['a', '>>>>>>> origin/main', 'b'].join('\n'), NOW).ok === false);
ok('🛑 สองบล็อกเลขรุ่นในไฟล์เดียว → ไม่แก้',
   resolveText([block('2026-09-10.6', '2026-09-10.5'), block('2026-09-10.6', '2026-09-10.5')].join('\n'), NOW).ok === false);
ok('🛑 เลขรุ่นรูปแบบแปลก → ไม่แก้', resolveText(block('ใหม่ล่าสุด', '2026-09-10.5'), NOW).ok === false);
ok('บรรทัด ======= ที่ไม่อยู่ในบล็อก (เช่นในคอมเมนต์) ถือว่าผิดปกติ → ไม่แก้',
   resolveText(['<!--', '='.repeat(7), '-->', block('2026-09-10.6', '2026-09-10.5')].join('\n'), NOW).ok === false);

console.log('\n=== D. ทั้งชุดหรือไม่มีเลย ===');
const files = { 'a.html': block('2026-09-10.6', '2026-09-10.5'), 'b.html': code };
const written = [];
const res = resolveFiles(Object.keys(files), { now: NOW, read: (p) => files[p], write: (p) => written.push(p) });
ok('ไฟล์หนึ่งแก้ไม่ได้ → ไม่เขียนไฟล์ไหนเลย แม้ไฟล์อื่นจะแก้ได้', res.ok === false && written.length === 0, written.join(','));

const good = { 'a.html': block('2026-09-10.6', '2026-09-10.5'), 'Stock-log.html': block('2026-08-25.1', '2026-08-25.2') };
const w2 = {};
const res2 = resolveFiles(Object.keys(good), { now: NOW, read: (p) => good[p], write: (p, t) => { w2[p] = t; } });
ok('แก้ได้ทุกไฟล์ → เขียนครบทุกไฟล์ แต่ละไฟล์คิดเลขของตัวเอง',
   res2.ok && w2['a.html'] === meta('2026-09-10.6') && w2['Stock-log.html'] === meta('2026-09-10.1'));

// เรียกผ่านบรรทัดคำสั่งจริง แบบที่ workflow เรียก — ชื่อไฟล์มีเว้นวรรคได้ ("แปลง BOM จาก SAP.html")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
const spaced = path.join(dir, 'แปลง BOM จาก SAP.html');
const broken = path.join(dir, 'b.html');
fs.writeFileSync(spaced, block('2026-09-10.3', '2026-09-10.4'));
fs.writeFileSync(broken, code);
// fileURLToPath ไม่ใช่ .pathname — pathname เข้ารหัสอักษรไทยเป็น %E0%B8... แล้วหาไฟล์ไม่เจอ
// (repo นี้อยู่ใต้โฟลเดอร์ชื่อไทยบนเครื่องเจ้าของ)
const script = fileURLToPath(new URL('../.github/scripts/version-conflict.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

const bad2 = run(spaced, broken);
ok('บรรทัดคำสั่ง: มีไฟล์แก้ไม่ได้ → รหัสออก 2 และไฟล์ที่แก้ได้ยังไม่ถูกเขียน',
   bad2.status === 2 && fs.readFileSync(spaced, 'utf8').includes('<<<<<<<'), bad2.stdout + bad2.stderr);
const ok2 = run(spaced);
ok('บรรทัดคำสั่ง: แก้ได้ → รหัสออก 0 และไฟล์ชื่อมีเว้นวรรคถูกเขียน',
   ok2.status === 0 && !fs.readFileSync(spaced, 'utf8').includes('<<<<<<<'), ok2.stdout + ok2.stderr);
ok('บรรทัดคำสั่ง: ไม่ส่งไฟล์มา → รหัสออก 2', run().status === 2);

// ชนแบบลบไฟล์ — path อยู่ในรายการที่ชนแต่ไม่มีตัวไฟล์ใน worktree
const gone = run(path.join(dir, 'ไม่มีไฟล์นี้.html'));
ok('บรรทัดคำสั่ง: ไฟล์ที่ชนไม่มีอยู่ → รหัสออก 2 พร้อมเหตุผลภาษาไทย ไม่ใช่ stack trace',
   gone.status === 2 && gone.stdout.includes('อ่านไฟล์ไม่ได้') && !/node:internal|\n\s+at /.test(gone.stdout + gone.stderr),
   gone.stdout + gone.stderr);
const r4 = resolveFiles(['x.html', 'y.html'], {
  now: NOW,
  read: (p) => { if (p === 'x.html') { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } return block('2026-09-10.6', '2026-09-10.5'); },
  write: () => { throw new Error('ไม่ควรถูกเรียก'); },
});
ok('อ่านไฟล์หนึ่งไม่ได้ → ไม่โยน error และไม่เขียนไฟล์อื่นในชุด', r4.ok === false && r4.results[0].reason.includes('ENOENT'));
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
