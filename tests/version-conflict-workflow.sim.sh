#!/usr/bin/env bash
# จำลองงานต่อใบของ .github/workflows/version-conflict.yml ทั้งวง โดยไม่แตะ GitHub จริง
#
# ⚠️ อย่ารันไฟล์นี้ตรง ๆ — รัน  node tests/version-conflict-workflow.sim.mjs
#    ตัวนั้นดึงสคริปต์ต่อใบออกจาก workflow จริงแล้วส่ง path มาทาง ONE กับ TRUSTED
#    ต้องมี bash 4+ · git · GNU sed (Linux หรือ Git Bash บน Windows)
#
#   origin    = bare repo ในเครื่อง
#   github.com = ถูกชี้มาที่ bare repo ด้วย url.insteadOf (ทั้ง fetch และ push ที่มี PAT)
#   gh        = shim ที่เก็บคอมเมนต์ลงไฟล์
#
# รันสคริปต์ one-pr.sh **ตัวที่ดึงออกมาจาก workflow จริง** ไม่ใช่สำเนาที่พิมพ์ซ้ำ
set -uo pipefail
# Git Bash แปลงอาร์กิวเมนต์ที่หน้าตาเหมือน path ให้เป็น path ของ Windows ก่อนส่งให้โปรแกรม native
# ⚠️ ห้ามปิดทั้งหมดด้วย MSYS_NO_PATHCONV=1 — เคยลองแล้วตัวจำลองพังทั้งชุด (ตก 40 จาก 49 ข้อ)
#    เพราะ mktemp ให้ /tmp/... แล้ว git.exe กับ node.exe หาไม่เจอเมื่อไม่ถูกแปลง
#    ยกเว้นเฉพาะอาร์กิวเมนต์ที่ขึ้นต้นด้วย ref ของ git เช่น origin/main:v2/index.html
export MSYS2_ARG_CONV_EXCL='origin/;refs/'

ONE="${ONE:?ต้องส่ง ONE = path ของ one-pr.sh ที่ดึงจาก workflow}"
TRUSTED="${TRUSTED:?ต้องส่ง TRUSTED = path ของ .github/scripts/version-conflict.mjs}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# แยกจาก git config ของเครื่อง — Git for Windows ตั้ง core.autocrlf=true ไว้ที่ระดับ system
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$T/gitconfig"
git config --global user.name sim
git config --global user.email sim@x
git config --global init.defaultBranch main
git config --global core.autocrlf false

REPO="owner/store"
BARE="$T/origin.git"
git init -q --bare "$BARE"
git config --global url."$BARE".insteadOf "https://github.com/$REPO.git"
git config --global url."$BARE".insteadOf "https://x-access-token:PAT@github.com/$REPO.git" --add 2>/dev/null \
  || git config --global --add url."$BARE".insteadOf "https://x-access-token:PAT@github.com/$REPO.git"

TODAY=$(node -e "console.log(new Date(Date.now()+7*3600e3).toISOString().slice(0,10))")
OLD="$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || node -e "console.log(new Date(Date.now()-7200e3).toISOString())")"

FUTURE="$(node -e "console.log(new Date(Date.now()+2*86400e3).toISOString())")"

mk_html() { # $1=version $2=line10 $3=line20
  printf '%s\r\n' '<!doctype html>' '<head>' "<meta name=\"app-version\" content=\"$1\">" '<title>t</title>' '</head>' \
    'l6' 'l7' 'l8' 'l9' "$2" 'l11' 'l12' 'l13' 'l14' 'l15' 'l16' 'l17' 'l18' 'l19' "$3" 'end'
}

old_commit() { GIT_AUTHOR_DATE="$OLD" GIT_COMMITTER_DATE="$OLD" git commit -q -m "$1"; }

SEED="$T/seed"
git clone -q "$BARE" "$SEED" 2>/dev/null
cd "$SEED"
mkdir -p v2
mk_html "$TODAY.3" 'base10' 'base20' > v2/index.html
echo a > other.txt
echo base > pkg.json
printf '<meta name="app-version" content="2026-08-11">\r\nl2\r\nl3\r\nl4\r\nlegacy body\r\n' > legacy.html
printf '<meta name="app-version" content="%s">\r\nl2\r\nl3\r\nl4\r\napp2 body\r\n' "$TODAY.3" > app2.html
git add . && old_commit base && git push -q origin HEAD:main

branch() { # $1=name  แล้วตามด้วยคำสั่งแก้ไฟล์
  git checkout -q -B "$1" main
  shift
  "$@"
  git add . && old_commit "$1" && git push -q -f origin HEAD:"refs/heads/$(git rev-parse --abbrev-ref HEAD)"
}

branch pr-version  bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'pr20' > v2/index.html"
branch pr-code     bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' 'pr10' base20 > v2/index.html"
branch pr-clean    bash -c "echo b > other.txt"
branch pr-busy     bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'busy20' > v2/index.html"
branch pr-fork     bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'fork20' > v2/index.html"
branch pr-nonhtml bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'nh20' > v2/index.html; echo pr > pkg.json"
branch pr-nopat   bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'np20' > v2/index.html"
# ไม่ชน แต่เลขเท่ากับ main หลังเมิจ — ใบนี้ตั้ง .5 เท่ากับที่ main จะขยับไป
branch pr-equal    bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.5' base10 'eq20' > v2/index.html"
# ไม่ชน แต่ลืมบัมป์ — หลังเมิจเลขจะเป็นของ main · commit นี้เพิ่มบรรทัด JavaScript ที่มีข้อความ meta ด้วย (ต้องไม่นับว่าบัมป์)
branch pr-forgot   bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.3' base10 'fg20' | sed -b 's#^l7#<script>const re = /<meta name=\"app-version\" content=\"([^\"]*)\">/;</script>#' > v2/index.html"
# ไฟล์รูปแบบเก่า (ไม่มี .N) บัมป์เป็นเลขเดียวกับที่ main เพิ่งใช้ — เลขชน แต่บัมป์เองไม่ได้
branch pr-legacy   bash -c "printf '<meta name=\"app-version\" content=\"2026-08-12\">\r\nl2\r\nl3\r\nl4\r\nlegacy changed\r\n' > legacy.html"
branch pr-rejected bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'rej20' > v2/index.html"
# ใบ draft ที่ลืมบัมป์ — ต้องไม่ถูกบัมป์ (คนอาจกำลังทำอยู่)
branch pr-draft-forgot bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.3' base10 'df20' > v2/index.html"
# ใบ draft ที่ชนแค่เลขรุ่น — ตัวแก้ชนยังทำให้เหมือนเดิม
branch pr-draft-conflict bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'dc20' > v2/index.html; printf '<meta name=\"app-version\" content=\"$TODAY.4\">\r\nl2\r\nl3\r\nl4\r\ndraft body\r\n' > app2.html"
# ชนแค่เลขรุ่นใน v2 + แก้ app2.html โดยลืมบัมป์ — แก้ชนให้ แต่ไม่บัมป์ app2 และคอมเมนต์บอกชื่อไฟล์
branch pr-conflict-forgot bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.4' base10 'cf20' > v2/index.html; printf '<meta name=\"app-version\" content=\"$TODAY.3\">\r\nl2\r\nl3\r\nl4\r\ncf body\r\n' > app2.html"
# ใบ draft ที่บัมป์เองแล้วแต่เลขชนกับ main (ไม่ชน) — ใบปกติกรณีนี้ได้บัมป์ แต่ draft ต้องไม่ถูกแตะ
# (draft-forgot ไม่พอแล้ว: กติกาใหม่ไม่บัมป์ใบที่ลืมอยู่แล้ว ตัวกัน draft จึงไม่ถูกทดสอบ — กลายพันธุ์รอดให้เห็น)
branch pr-draft-equal bash -c "mk_html() { $(declare -f mk_html | tail -n +2); }; mk_html '$TODAY.5' base10 'de20' > v2/index.html"

# ใบที่เพิ่ง commit — ใช้เวลาจริงตอนนี้
git checkout -q -B pr-fresh main
mk_html "$TODAY.4" base10 'fresh20' > v2/index.html
git add . && git commit -q -m fresh && git push -q origin pr-fresh

# ชนแค่เลขรุ่น แต่เวลาของ commit อยู่ในอนาคต — ต้องไม่ถูกข้ามตลอดไป
git checkout -q -B pr-future main
mk_html "$TODAY.4" base10 'fut20' > v2/index.html
git add . && GIT_AUTHOR_DATE="$FUTURE" GIT_COMMITTER_DATE="$FUTURE" git commit -q -m future && git push -q origin pr-future

# main ขยับ: บัมป์เลขรุ่น + แก้บรรทัด 10 (ชนกับ pr-code เท่านั้น)
git checkout -q main
mk_html "$TODAY.5" 'main10' base20 > v2/index.html
echo main > pkg.json
printf '<meta name="app-version" content="%s">\r\nl2\r\nl3\r\nl4\r\napp2 body\r\n' "$TODAY.4" > app2.html
printf '<meta name="app-version" content="2026-08-12">\r\nl2\r\nl3\r\nl4\r\nlegacy body\r\n' > legacy.html
git add . && old_commit main-moves && git push -q origin main

# บัมป์เองเป็นเลขเดียวกับ main แล้วกด Update branch ก่อนตัวแก้มาถึง — ต้องยังนับว่าบัมป์เอง (ผู้ตรวจรอบแรกของ #73)
git checkout -q -B pr-updated main~1
mk_html "$TODAY.5" base10 'up20' > v2/index.html
git add . && old_commit pr-updated
GIT_AUTHOR_DATE="$OLD" GIT_COMMITTER_DATE="$OLD" git merge -q --no-edit main
git push -q origin pr-updated
git checkout -q main

# ปฏิเสธ push ของ pr-rejected ที่ฝั่ง origin — จำลอง PAT ไม่มีสิทธิ์
cat > "$BARE/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
while read -r old new ref; do
  if [ "$ref" = "refs/heads/pr-rejected" ]; then echo "ปฏิเสธ (จำลอง)"; exit 1; fi
done
HOOK
chmod +x "$BARE/hooks/pre-receive"

# ── workspace แบบที่ actions/checkout ให้ ─────────────────────────
WS="$T/ws"
git clone -q "https://github.com/$REPO.git" "$WS" 2>/dev/null
cd "$WS"

# ── gh ปลอม ────────────────────────────────────────────────────────
mkdir -p "$T/bin" "$T/comments"
cat > "$T/bin/gh" <<'GH'
#!/usr/bin/env bash
if [ "$1" = api ]; then
  case " $* " in *" --paginate "*) ;; *) echo "gh ปลอม: ต้องมี --paginate" >&2; exit 9 ;; esac
  n=$(printf '%s\n' "$@" | grep -o 'issues/[0-9]*/comments' | cut -d/ -f2)
  touch "$SIM_COMMENTS/$n"; cat "$SIM_COMMENTS/$n"; exit 0
fi
case "$1 $2" in
  "pr view")    echo "gh ปลอม: ต้องใช้ gh api --paginate ไม่ใช่ pr view (มีเพดานคอมเมนต์)" >&2; exit 9 ;;
  "pr comment") f=""; prev=""; for a in "$@"; do [ "$prev" = "--body-file" ] && f="$a"; prev="$a"; done
                { cat "$f"; printf '\n<<<จบคอมเมนต์>>>\n'; } >> "$SIM_COMMENTS/$3" ;;
  *) echo "gh ปลอม: ไม่รู้จัก $*" >&2; exit 9 ;;
esac
GH
chmod +x "$T/bin/gh"

export PATH="$T/bin:$PATH" SIM_COMMENTS="$T/comments"
export REPO PUSH_TOKEN=PAT QUIET_MIN=10 TRUSTED
export RUNNER_TEMP="$T/rt" GITHUB_WORKSPACE="$WS" RESULTS="$T/results.txt"
mkdir -p "$RUNNER_TEMP"; : > "$RESULTS"
git fetch -q origin main
export MAIN_SHA; MAIN_SHA=$(git rev-parse origin/main)
export BUSY=$'\npr-busy\n'

declare -A NUM=([pr-version]=1 [pr-code]=2 [pr-clean]=3 [pr-busy]=4 [pr-fork]=5 [pr-rejected]=6 [pr-fresh]=7 [pr-nonhtml]=8 [pr-nopat]=9 [pr-equal]=10 [pr-forgot]=11 [pr-legacy]=12 [pr-future]=13 [pr-draft-forgot]=14 [pr-draft-conflict]=15 [pr-conflict-forgot]=16 [pr-draft-equal]=17 [pr-updated]=18)
declare -A RC
sha_of() { git ls-remote "https://github.com/$REPO.git" "refs/heads/$1" | cut -f1; }
declare -A BEFORE
for b in "${!NUM[@]}"; do BEFORE[$b]=$(sha_of "$b"); done

run_one() { # $1 branch $2 fork $3 draft (ไม่ใส่ = false)
  bash "$ONE" "${NUM[$1]}" "$1" "$2" "${3:-false}" > "$T/log-$1.txt" 2>&1
  RC[$1]=$?
}
for b in pr-version pr-code pr-clean pr-busy pr-rejected pr-fresh pr-nonhtml pr-equal pr-forgot pr-legacy pr-future; do run_one "$b" false; done
run_one pr-fork true
run_one pr-draft-forgot false true
run_one pr-draft-conflict false true
run_one pr-conflict-forgot false
run_one pr-draft-equal false true
run_one pr-updated false
PUSH_TOKEN= bash "$ONE" 9 pr-nopat false false > "$T/log-pr-nopat.txt" 2>&1; RC[pr-nopat]=$?

pass=0; fail=0
ok() { if [ "$2" = 0 ]; then pass=$((pass+1)); echo "  ผ่าน  $1"; else fail=$((fail+1)); echo "  ตก    $1"; [ -n "${3:-}" ] && sed 's/^/        | /' "$3" | tail -8; fi; }
t() { "$@" >/dev/null 2>&1; echo $?; }

show() { git fetch -q origin "+refs/heads/$1:refs/remotes/origin/$1"; git show "refs/remotes/origin/$1:v2/index.html"; }

echo "=== ชนแค่เลขรุ่น → แก้แล้ว push ==="
ok "รหัสออก 0" "$([ "${RC[pr-version]}" = 0 ]; echo $?)" "$T/log-pr-version.txt"
ok "branch ขยับจริง" "$([ "$(sha_of pr-version)" != "${BEFORE[pr-version]}" ]; echo $?)"
v=$(show pr-version | tr -d '\r')
ok "เลขรุ่นเป็น $TODAY.6 (PR .4 ตามหลัง main .5)" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.6\">" <<< "$v"; echo $?)"
ok "งานของ PR (บรรทัด 20) ยังอยู่" "$(grep -qx 'pr20' <<< "$v"; echo $?)"
ok "งานของ main (บรรทัด 10) เข้ามาแล้ว" "$(grep -qx 'main10' <<< "$v"; echo $?)"
ok "ไม่มี marker หลงเหลือ" "$(! grep -qE '^(<{7}|={7}|>{7})' <<< "$v"; echo $?)"
ok "CRLF ยังครบทุกบรรทัด" "$([ "$(show pr-version | grep -vc $'\r$')" = 0 ]; echo $?)"
ok "commit ใหม่มีพ่อสองตัว (เป็นการเมิจ ไม่ใช่เขียนทับประวัติ)" \
   "$([ "$(git rev-list --parents -n1 refs/remotes/origin/pr-version | wc -w)" = 3 ]; echo $?)"
ok "คอมเมนต์บอกว่าแก้แล้ว" "$(grep -q 'แก้ conflict ของเลขรุ่นให้แล้ว' "$T/comments/1"; echo $?)"

echo "=== ชนเรื่องโค้ดด้วย → ไม่แตะ คอมเมนต์ครั้งเดียว ==="
ok "รหัสออก 0 (ไม่ใช่ความล้มเหลว)" "$([ "${RC[pr-code]}" = 0 ]; echo $?)" "$T/log-pr-code.txt"
ok "branch ไม่ขยับ" "$([ "$(sha_of pr-code)" = "${BEFORE[pr-code]}" ]; echo $?)"
ok "คอมเมนต์บอกว่าแก้เองไม่ได้" "$(grep -q 'แก้อัตโนมัติไม่ได้' "$T/comments/2"; echo $?)"
run_one pr-code false
ok "รันซ้ำ → ไม่คอมเมนต์ซ้ำ" "$([ "$(grep -c '<<<จบคอมเมนต์>>>' "$T/comments/2")" = 1 ]; echo $?)"
ok "รันซ้ำ → ไม่มี worktree ค้าง" "$([ "$(git worktree list | wc -l)" = 1 ]; echo $?)"

echo "=== ชนไฟล์ที่ไม่ใช่ html ด้วย (เช่นสองใบเติมเทสใน package.json) → ไม่แตะ ==="
ok "รหัสออก 0" "$([ "${RC[pr-nonhtml]}" = 0 ]; echo $?)" "$T/log-pr-nonhtml.txt"
ok "branch ไม่ขยับ" "$([ "$(sha_of pr-nonhtml)" = "${BEFORE[pr-nonhtml]}" ]; echo $?)"
ok "คอมเมนต์บอกว่าแก้เองไม่ได้ พร้อมชื่อไฟล์ที่ชน" "$(grep -q 'แก้อัตโนมัติไม่ได้' "$T/comments/8" && grep -q 'pkg.json' "$T/comments/8"; echo $?)"

echo "=== ไม่ชน บัมป์เองแล้วแต่เลขชนกับ main → เมิจแล้วบัมป์ให้ ==="
for b in pr-equal; do
  n=${NUM[$b]}
  ok "$b: รหัสออก 0" "$([ "${RC[$b]}" = 0 ]; echo $?)" "$T/log-$b.txt"
  ok "$b: branch ขยับจริง" "$([ "$(sha_of $b)" != "${BEFORE[$b]}" ]; echo $?)"
  vv=$(show $b | tr -d '\r')
  ok "$b: เลขรุ่นเป็น $TODAY.6 (ใหม่กว่า main .5)" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.6\">" <<< "$vv"; echo $?)"
  ok "$b: งานของ main (บรรทัด 10) เข้ามาแล้ว" "$(grep -qx 'main10' <<< "$vv"; echo $?)"
  ok "$b: เป็น merge commit พ่อสองตัว" "$([ "$(git rev-list --parents -n1 refs/remotes/origin/$b | wc -w)" = 3 ]; echo $?)"
  ok "$b: คอมเมนต์บอกว่าบัมป์ให้แล้ว" "$(grep -q 'บัมป์เลขรุ่นให้แล้ว' "$T/comments/$n"; echo $?)"
done
vv=$(show pr-equal | tr -d '\r')
ok "pr-equal: งานของ PR (บรรทัด 20) ยังอยู่" "$(grep -qx 'eq20' <<< "$vv"; echo $?)"
ok "สิ่งที่ด่านจะเห็น: เลขของ PR ไม่เท่ากับ main" "$([ "$(show pr-equal | grep -o 'app-version\" content=\"[^\"]*' | head -1)" != "$(git show origin/main:v2/index.html | grep -o 'app-version\" content=\"[^\"]*' | head -1)" ]; echo $?)"

echo "=== ลืมบัมป์ (ไม่ชน) → ไม่บัมป์ให้ ไม่แตะ ไม่คอมเมนต์ ด่านแดงเตือนเอง ==="
ok "forgot: รหัสออก 0" "$([ "${RC[pr-forgot]}" = 0 ]; echo $?)" "$T/log-pr-forgot.txt"
ok "forgot: branch ไม่ขยับ" "$([ "$(sha_of pr-forgot)" = "${BEFORE[pr-forgot]}" ]; echo $?)" "$T/log-pr-forgot.txt"
ok "forgot: ไม่คอมเมนต์" "$([ ! -s "$T/comments/11" ]; echo $?)"
ok "forgot: สรุปบอกว่าลืมบัมป์" "$(grep -q $'^#11\t.*ลืมบัมป์' "$RESULTS"; echo $?)" "$RESULTS"
ok "forgot: ไม่มี worktree หรือการเมิจค้าง" "$([ "$(git worktree list | wc -l)" = 1 ]; echo $?)"

echo "=== บัมป์เองแล้ว แต่กด Update branch ก่อนตัวแก้มาถึง (เลขตรงกับ main) → ยังนับว่าบัมป์เอง บัมป์ให้ ==="
ok "updated: ปลาย branch เป็น merge commit จริง (ตั้งฉากถูก)" "$([ "$(git ls-remote "https://github.com/$REPO.git" refs/heads/pr-updated | cut -f1)" != "" ] && [ "$(git rev-list --parents -n1 "${BEFORE[pr-updated]}" | wc -w)" = 3 ]; echo $?)"
ok "updated: รหัสออก 0" "$([ "${RC[pr-updated]}" = 0 ]; echo $?)" "$T/log-pr-updated.txt"
ok "updated: branch ขยับจริง" "$([ "$(sha_of pr-updated)" != "${BEFORE[pr-updated]}" ]; echo $?)" "$T/log-pr-updated.txt"
vu=$(show pr-updated | tr -d '\r')
ok "updated: เลขรุ่นเป็น $TODAY.6 (ใหม่กว่า main .5)" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.6\">" <<< "$vu"; echo $?)"
ok "updated: งานของ PR (บรรทัด 20) ยังอยู่" "$(grep -qx 'up20' <<< "$vu"; echo $?)"
ok "updated: คอมเมนต์บอกว่าบัมป์ให้แล้ว" "$(grep -q 'บัมป์เลขรุ่นให้แล้ว' "$T/comments/18"; echo $?)" "$T/comments/18"

echo "=== ชนแค่เลขรุ่น + อีกไฟล์ลืมบัมป์ → แก้ชนให้ ไม่บัมป์ไฟล์ที่ลืม แต่คอมเมนต์บอกชื่อ ==="
ok "conflict-forgot: รหัสออก 0" "$([ "${RC[pr-conflict-forgot]}" = 0 ]; echo $?)" "$T/log-pr-conflict-forgot.txt"
ok "conflict-forgot: branch ขยับจริง" "$([ "$(sha_of pr-conflict-forgot)" != "${BEFORE[pr-conflict-forgot]}" ]; echo $?)" "$T/log-pr-conflict-forgot.txt"
vcf=$(show pr-conflict-forgot | tr -d '\r')
ok "conflict-forgot: v2 แก้ชนเป็น $TODAY.6" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.6\">" <<< "$vcf"; echo $?)"
acf=$(git show refs/remotes/origin/pr-conflict-forgot:app2.html | tr -d '\r')
ok "conflict-forgot: app2.html ไม่ถูกบัมป์ (ยังเป็นของ main $TODAY.4)" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.4\">" <<< "$acf"; echo $?)"
ok "conflict-forgot: งานของ PR ใน app2.html ยังอยู่" "$(grep -qx 'cf body' <<< "$acf"; echo $?)"
ok "conflict-forgot: คอมเมนต์บอกชื่อไฟล์ที่ลืมบัมป์" "$(grep -q 'ไม่ได้บัมป์เลขรุ่นเอง' "$T/comments/16" && grep -q 'app2.html' "$T/comments/16"; echo $?)" "$T/comments/16"


echo "=== เลขรุ่นรูปแบบเก่าเท่ากับ main → บัมป์เองไม่ได้ ไม่แตะ ไม่ล้ม ==="
ok "รหัสออก 0" "$([ "${RC[pr-legacy]}" = 0 ]; echo $?)" "$T/log-pr-legacy.txt"
ok "branch ไม่ขยับ" "$([ "$(sha_of pr-legacy)" = "${BEFORE[pr-legacy]}" ]; echo $?)"
ok "บอกเหตุผลในสรุป" "$(grep -q 'บัมป์เองไม่ได้' "$RESULTS"; echo $?)"
ok "ไม่มี worktree หรือการเมิจค้าง" "$([ "$(git worktree list | wc -l)" = 1 ]; echo $?)"

echo "=== เวลาของ commit อยู่ในอนาคต → ไม่ถูกข้ามตลอดไป ==="
ok "รหัสออก 0" "$([ "${RC[pr-future]}" = 0 ]; echo $?)" "$T/log-pr-future.txt"
ok "ถูกแก้ ไม่ใช่ถูกข้าม" "$([ "$(sha_of pr-future)" != "${BEFORE[pr-future]}" ]; echo $?)" "$T/log-pr-future.txt"

echo "=== ช่วงเงียบตั้งเป็นค่าที่ไม่ใช่ตัวเลข → เตือนแล้วใช้ 10 ไม่ล้ม ==="
QUIET_MIN=abc bash "$ONE" 3 pr-clean false false > "$T/log-badquiet.txt" 2>&1
ok "รหัสออก 0" "$?" "$T/log-badquiet.txt"
ok "มีคำเตือน" "$(grep -q 'ไม่ใช่ตัวเลข' "$T/log-badquiet.txt"; echo $?)"

echo "=== ใบ draft ลืมบัมป์ → ไม่บัมป์ ไม่แตะ ไม่คอมเมนต์ ==="
ok "draft-forgot: รหัสออก 0" "$([ "${RC[pr-draft-forgot]}" = 0 ]; echo $?)" "$T/log-pr-draft-forgot.txt"
ok "draft-forgot: branch ไม่ขยับ" "$([ "$(sha_of pr-draft-forgot)" = "${BEFORE[pr-draft-forgot]}" ]; echo $?)" "$T/log-pr-draft-forgot.txt"
ok "draft-forgot: ไม่คอมเมนต์" "$([ ! -s "$T/comments/14" ]; echo $?)"
ok "draft-forgot: สรุปบอกว่าเป็น draft" "$(grep -q $'^#14\t.*draft' "$RESULTS"; echo $?)"
ok "draft-forgot: ไม่มี worktree หรือการเมิจค้าง" "$([ "$(git worktree list | wc -l)" = 1 ]; echo $?)"

echo "=== ใบ draft ที่บัมป์เองแล้วแต่เลขชน (ไม่ชน) → ไม่แตะ แม้ใบปกติกรณีนี้ได้บัมป์ ==="
ok "draft-equal: รหัสออก 0" "$([ "${RC[pr-draft-equal]}" = 0 ]; echo $?)" "$T/log-pr-draft-equal.txt"
ok "draft-equal: branch ไม่ขยับ" "$([ "$(sha_of pr-draft-equal)" = "${BEFORE[pr-draft-equal]}" ]; echo $?)" "$T/log-pr-draft-equal.txt"
ok "draft-equal: ไม่คอมเมนต์" "$([ ! -s "$T/comments/17" ]; echo $?)"
ok "draft-equal: สรุปบอกว่าเป็น draft" "$(grep -q $'^#17\t.*draft' "$RESULTS"; echo $?)" "$RESULTS"

echo "=== ค่า draft ผิดรูป (isDraft หลุดจาก --json) → ล้มดัง ๆ ไม่บัมป์เงียบ ๆ ==="
bash "$ONE" 14 pr-draft-forgot false "" > "$T/log-baddraft.txt" 2>&1
rcbd=$?
ok "baddraft: รหัสออก 1 (ต้องขึ้นแดง)" "$([ "$rcbd" = 1 ]; echo $?)" "$T/log-baddraft.txt"
ok "baddraft: branch ไม่ขยับ" "$([ "$(sha_of pr-draft-forgot)" = "${BEFORE[pr-draft-forgot]}" ]; echo $?)"
ok "baddraft: บอกว่าค่า draft ผิดรูป" "$(grep -q 'ค่า draft ไม่ใช่ true/false' "$T/log-baddraft.txt"; echo $?)"

echo "=== ใบ draft ชนแค่เลขรุ่น → ตัวแก้ชนยังทำให้ ==="
ok "draft-conflict: รหัสออก 0" "$([ "${RC[pr-draft-conflict]}" = 0 ]; echo $?)" "$T/log-pr-draft-conflict.txt"
ok "draft-conflict: branch ขยับจริง" "$([ "$(sha_of pr-draft-conflict)" != "${BEFORE[pr-draft-conflict]}" ]; echo $?)" "$T/log-pr-draft-conflict.txt"
vd=$(show pr-draft-conflict | tr -d '\r')
ok "draft-conflict: เลขรุ่นเป็น $TODAY.6" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.6\">" <<< "$vd"; echo $?)"
ok "draft-conflict: งานของ PR (บรรทัด 20) ยังอยู่" "$(grep -qx 'dc20' <<< "$vd"; echo $?)"
ok "draft-conflict: งานของ main (บรรทัด 10) เข้ามาแล้ว" "$(grep -qx 'main10' <<< "$vd"; echo $?)"
a2=$(git show refs/remotes/origin/pr-draft-conflict:app2.html | tr -d '\r')
ok "draft-conflict: ไฟล์อื่นที่เลขชน (app2.html) ถูกบัมป์ให้ครบในทีเดียว" "$(grep -qx "<meta name=\"app-version\" content=\"$TODAY.5\">" <<< "$a2"; echo $?)"
ok "draft-conflict: งานของ PR ใน app2.html ยังอยู่" "$(grep -qx 'draft body' <<< "$a2"; echo $?)"
ok "draft-conflict: คอมเมนต์บอกว่าแก้ conflict แล้ว" "$(grep -q 'แก้ conflict ของเลขรุ่นให้แล้ว' "$T/comments/15"; echo $?)"

echo "=== ไม่มี AGENT_PUSH_PAT ==="
ok "มีงานต้อง push → รหัสออก 1 (ต้องขึ้นแดง)" "$([ "${RC[pr-nopat]}" = 1 ]; echo $?)" "$T/log-pr-nopat.txt"
ok "branch ไม่ขยับ และไม่คอมเมนต์ว่าแก้แล้ว" "$([ "$(sha_of pr-nopat)" = "${BEFORE[pr-nopat]}" ] && [ ! -s "$T/comments/9" ]; echo $?)"
ok "ไม่มีงานต้อง push (ชนเรื่องอื่น) → ยังรหัสออก 0 ไม่แดงฟรี" "$(PUSH_TOKEN= bash "$ONE" 2 pr-code false false >/dev/null 2>&1; echo $?)"

echo "=== ใบอื่น ๆ ==="
ok "ไม่ชน → ไม่ทำอะไร ไม่คอมเมนต์" "$([ "${RC[pr-clean]}" = 0 ] && [ "$(sha_of pr-clean)" = "${BEFORE[pr-clean]}" ] && [ ! -s "$T/comments/3" ]; echo $?)" "$T/log-pr-clean.txt"
ok "ช่างซ่อมกำลังทำงาน → ข้าม" "$([ "${RC[pr-busy]}" = 0 ] && [ "$(sha_of pr-busy)" = "${BEFORE[pr-busy]}" ] && grep -q 'ช่างซ่อม' "$T/log-pr-busy.txt"; echo $?)" "$T/log-pr-busy.txt"
ok "fork → ข้าม" "$([ "${RC[pr-fork]}" = 0 ] && [ "$(sha_of pr-fork)" = "${BEFORE[pr-fork]}" ]; echo $?)" "$T/log-pr-fork.txt"
ok "commit เพิ่งเกิด → ข้าม" "$([ "${RC[pr-fresh]}" = 0 ] && [ "$(sha_of pr-fresh)" = "${BEFORE[pr-fresh]}" ] && grep -q 'เพิ่ง' "$T/log-pr-fresh.txt"; echo $?)" "$T/log-pr-fresh.txt"
ok "🛑 push โดนปฏิเสธทั้งที่ branch ไม่ขยับ → รหัสออก 1 (ต้องขึ้นแดง)" "$([ "${RC[pr-rejected]}" = 1 ]; echo $?)" "$T/log-pr-rejected.txt"
ok "🛑 push โดนปฏิเสธ → ไม่คอมเมนต์ว่าแก้แล้ว" "$([ ! -s "$T/comments/6" ]; echo $?)"
ok "ทุกใบไม่มี worktree ค้าง" "$([ "$(git worktree list | wc -l)" = 1 ]; echo $?)"

echo
echo "ผลที่ workflow จะเขียนลงสรุป:"; sed 's/^/  /' "$RESULTS"
echo; [ "$fail" = 0 ] && echo ">>> ผ่านทั้งหมด ($pass ผ่าน · 0 ตก)" || echo ">>> มีข้อที่ไม่ผ่าน ($pass ผ่าน · $fail ตก)"
exit $([ "$fail" = 0 ] && echo 0 || echo 1)
