/**
 * จำลอง .github/workflows/version-conflict.yml ทั้งวง โดยไม่แตะ GitHub จริง — รันด้วย node
 *   node tests/version-conflict-workflow.sim.mjs
 *
 * ไม่อยู่ใน test:core — บน Linux ราว 3 วินาที · บน Git Bash ของ Windows ราว 2 นาที (git ช้ากว่ามาก)
 * **แก้ version-conflict.yml หรือ .github/scripts/version-conflict.mjs ต้องรันให้ผ่าน** และเพิ่มเคสเมื่อเพิ่มพฤติกรรม
 * ต้องมี bash 4+ · git · GNU sed (Linux หรือ Git Bash บน Windows)
 *
 * สองส่วน ทั้งคู่ดึงโค้ดจาก workflow จริง ไม่ใช่สำเนาที่พิมพ์ซ้ำ
 *   1. งานต่อใบ — สคริปต์ one-pr.sh ใน heredoc รันกับ bare repo ในเครื่อง + gh ปลอม
 *      (สถานการณ์ทั้งหมดอยู่ใน tests/version-conflict-workflow.sim.sh)
 *   2. ลูปชั้นนอก — ลูปที่ไล่ทุก PR รันกับ PR ตัวอย่าง + งานต่อใบปลอมที่จดอาร์กิวเมนต์
 *      ส่วนนี้ตัวจำลองข้อ 1 เข้าไม่ถึง
 *
 * ชื่อไฟล์ไม่ลงท้าย .test.mjs โดยตั้งใจ — playwright.config.js ใช้ testDir ./tests กับ testMatch ค่าเริ่มต้น
 * กันไม่ให้ npm test (playwright) หยิบไปรันเป็นเทสของมัน
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'version-conflict.yml');
const TRUSTED = path.join(ROOT, '.github', 'scripts', 'version-conflict.mjs');
const SIM = path.join(ROOT, 'tests', 'version-conflict-workflow.sim.sh');
// bash บน Windows (Git Bash) อ่าน C:/... ได้ แต่ไม่ชอบ backslash
const posix = (p) => p.split(path.sep).join('/');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + String(extra).trim().slice(0, 600) : '')); }
};

// ── ดึงบล็อกออกจาก run: | ของ YAML โดยไม่พึ่ง parser ─────────────────────
// block scalar ตัดย่อหน้าร่วมของบล็อกออก — ทุกบรรทัดใน step นี้ย่อหน้าอย่างน้อยเท่ากับบรรทัดเริ่ม
// checkout บน Windows อาจเป็น CRLF ทั้งไฟล์ — ตัด CR ทิ้งก่อน ไม่งั้น bash อ่าน $'\r' เป็นคำสั่ง
const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
function block(isStart, isEnd, { keepEnds }) {
  const s = lines.findIndex(isStart);
  if (s < 0) throw new Error('หาบรรทัดเริ่มของบล็อกไม่เจอใน version-conflict.yml');
  const indent = lines[s].match(/^ */)[0];
  let e = -1;
  for (let i = s + 1; i < lines.length; i++) if (isEnd(lines[i], indent)) { e = i; break; }
  if (e < 0) throw new Error('หาบรรทัดจบของบล็อกไม่เจอใน version-conflict.yml');
  return (keepEnds ? lines.slice(s, e + 1) : lines.slice(s + 1, e)).map((l) => {
    if (l.startsWith(indent)) return l.slice(indent.length);
    if (l.trim() === '') return '';
    throw new Error('ย่อหน้าน้อยกว่าบรรทัดเริ่มของบล็อก: ' + l);
  }).join('\n') + '\n';
}

const onePr = block((l) => l.trim() === `cat > "$RUNNER_TEMP/one-pr.sh" <<'EOS'`, (l, ind) => l === ind + 'EOS', { keepEnds: false });
const outer = block((l) => l.trim() === 'errors=0', (l) => l.trim().startsWith('done < <(jq -r'), { keepEnds: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-wf-'));
try {
  console.log('=== ดึงโค้ดจาก workflow ===');
  const onePath = path.join(tmp, 'one-pr.sh');
  fs.writeFileSync(onePath, onePr);
  const syn = spawnSync('bash', ['-n', posix(onePath)], { encoding: 'utf8' });
  ok(`สคริปต์ต่อใบ ${onePr.split('\n').length - 1} บรรทัด · bash -n ผ่าน`, onePr.length > 2000 && syn.status === 0, syn.stderr || syn.error);
  ok('ลูปชั้นนอกเรียกสคริปต์ต่อใบ', outer.includes('bash "$RUNNER_TEMP/one-pr.sh"'), outer);

  // ── 1. งานต่อใบ ──────────────────────────────────────────────────────
  console.log('\n=== 1. งานต่อใบ (bare repo ในเครื่อง + gh ปลอม) ===');
  const simPath = path.join(tmp, 'sim.sh');
  fs.writeFileSync(simPath, fs.readFileSync(SIM, 'utf8').split('\r\n').join('\n'));
  const r = spawnSync('bash', [posix(simPath)], {
    encoding: 'utf8',
    timeout: 600_000,
    env: { ...process.env, ONE: posix(onePath), TRUSTED: posix(TRUSTED) },
  });
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stdout.write(r.stderr);
  const m = /^>>> ผ่านทั้งหมด \((\d+) ผ่าน · 0 ตก\)$/m.exec(r.stdout || '');
  ok(`ตัวจำลองงานต่อใบผ่านครบ${m ? ` (${m[1]} ข้อ)` : ''}`, r.status === 0 && !!m, r.error || `รหัสออก ${r.status}`);
  // เพดานล่าง — ลบเคสทิ้งครึ่งหนึ่งแล้วยังรายงาน "ผ่านครบ (40 ข้อ)" จะไม่มีใครสังเกต (ผู้ตรวจของ #75)
  // เพิ่มเคสแล้วขยับเลขนี้ขึ้นได้ · ลบเคสโดยตั้งใจต้องลดเลขนี้ในใบเดียวกัน ให้ผู้ตรวจเห็น
  const MIN_CASES = 80;
  ok(`จำนวนเคสของงานต่อใบไม่น้อยกว่า ${MIN_CASES}`, !!m && Number(m[1]) >= MIN_CASES, m ? `ได้ ${m[1]} ข้อ` : 'อ่านจำนวนไม่ได้');

  // ── 2. ลูปชั้นนอก ────────────────────────────────────────────────────
  console.log('\n=== 2. ลูปชั้นนอก ===');
  const prs = [
    { number: 1, headRefName: 'แก้ a b', isCrossRepository: false, isDraft: true },
    { number: 2, headRefName: 'c', isCrossRepository: true, isDraft: false },
    { number: 3, headRefName: 'd', isCrossRepository: false, isDraft: false },
  ];
  const want = ['1|แก้ a b|false|true', '2|c|true|false', '3|d|false|false'];

  // เครื่องที่ไม่มี jq ใช้ตัวแทนที่อ่าน filter จริงจากอาร์กิวเมนต์ และล้มทันทีถ้าเจอรูปที่ไม่รู้จัก
  const hasJq = spawnSync('jq', ['--version']).status === 0;
  const shim = String.raw`import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (!args.includes('-r')) { console.error('jq ปลอม: ต้องมี -r'); process.exit(3); }
const filter = args.filter((a) => a !== '-r');
if (filter.length !== 1) { console.error('jq ปลอม: ต้องมี filter ตัวเดียว'); process.exit(3); }
const m = /^\.\[\] \| \[(.+)\] \| @tsv$/.exec(filter[0].trim());
if (!m) { console.error('jq ปลอม: ไม่รู้จัก filter ' + filter[0]); process.exit(3); }
const fields = m[1].split(',').map((f) => f.trim());
for (const f of fields) if (!/^\.[A-Za-z]+$/.test(f)) { console.error('jq ปลอม: ไม่รู้จักฟิลด์ ' + f); process.exit(3); }
const data = JSON.parse(readFileSync(0, 'utf8'));
for (const item of data) console.log(fields.map((f) => { const v = item[f.slice(1)]; return v === undefined || v === null ? '' : String(v); }).join('\t'));
`;

  function runLoop(body, name) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'prs.json'), JSON.stringify(prs));
    if (!hasJq) {
      fs.writeFileSync(path.join(dir, 'jq-shim.mjs'), shim);
      fs.writeFileSync(path.join(dir, 'bin', 'jq'), `#!/usr/bin/env bash\nexec node "${posix(path.join(dir, 'jq-shim.mjs'))}" "$@"\n`);
    }
    const script = [
      'set -euo pipefail',
      'export RUNNER_TEMP="$1" RESULTS="$1/results.txt"',
      // PATH คั่นด้วย : — path แบบ C:/... ของ Windows ต้องแปลงเป็น /c/... ก่อน
      'if command -v cygpath >/dev/null 2>&1; then B="$(cygpath -u "$1")/bin"; else B="$1/bin"; fi',
      'export PATH="$B:$PATH"',
      'if [ -f "$B/jq" ]; then chmod +x "$B/jq"; fi',
      ': > "$RESULTS"; : > "$RUNNER_TEMP/calls.txt"',
      `printf '%s\\n' 'IFS="|"; echo "$*" >> "$RUNNER_TEMP/calls.txt"' > "$RUNNER_TEMP/one-pr.sh"`,
      'prs=$(cat "$RUNNER_TEMP/prs.json")',
      body,
      'sed "s/^/CALL:/" "$RUNNER_TEMP/calls.txt"',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'outer.sh'), script);
    const p = spawnSync('bash', [posix(path.join(dir, 'outer.sh')), posix(dir)], { encoding: 'utf8' });
    return {
      status: p.status,
      calls: (p.stdout || '').split('\n').filter((l) => l.startsWith('CALL:')).map((l) => l.slice(5)),
      err: p.stderr || p.error,
    };
  }

  const real = runLoop(outer, 'outer');
  ok(`ลูปจริงรันจบ และเรียกงานต่อใบครบ 3 ใบ${hasJq ? '' : ' (ใช้ jq ตัวแทน)'}`, real.status === 0 && real.calls.length === 3,
     `รหัส ${real.status} · ${JSON.stringify(real.calls)} · ${real.err}`);
  ok('ส่ง num · head · fork · draft ถึงงานต่อใบถูกช่อง (รวมชื่อ branch ที่มีเว้นวรรค)',
     JSON.stringify(real.calls) === JSON.stringify(want), JSON.stringify(real.calls));
  ok('gh pr list ขอ isDraft มาด้วย', lines.join('\n').includes('--json number,headRefName,isCrossRepository,isDraft)'));

  // พิสูจน์ว่าตัวตรวจข้อนี้ไวพอ — กลายพันธุ์ลูปเอง ต้องยังรันครบ แต่ผลต้องต่าง
  const mutated = outer.replace(', .isDraft] | @tsv', '] | @tsv');
  const mu = runLoop(mutated, 'outer-mutant');
  ok('กลายพันธุ์ลูป (ตัด .isDraft) ยังรันครบ 3 ใบ แต่ค่า draft ไม่ถูกส่ง → ตัวตรวจจับได้',
     mutated !== outer && mu.calls.length === 3 && JSON.stringify(mu.calls) !== JSON.stringify(want), JSON.stringify(mu.calls));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
