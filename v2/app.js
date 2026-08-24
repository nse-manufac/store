/**
 * ประกอบร่าง v2
 *
 * ไฟล์นี้มีหน้าที่เดียวคือต่อสายระหว่างที่เก็บข้อมูล ตรรกะ และหน้าจอ
 * ตรรกะจริงอยู่ใน core/ กับ master/ ซึ่งเทสด้วย node ล้วนได้โดยไม่ต้องเปิดเบราว์เซอร์
 * ห้ามย้ายกฎธุรกิจมาไว้ที่นี่ เพราะจะกลายเป็นของที่เทสถูก ๆ ไม่ได้
 */
import * as db from './core/db.js';
import { CATEGORIES, categorize, checkCode, makeMaterial, addedOnFloor,
         searchMaterials, duplicateDescriptions, normCode } from './master/materials.js';
import { parseBomHtml, summarize } from './master/sap-bom.js';
import { makeBomRows, pnSummary, pnsMissingPackMat, unknownCodes,
         importPlan, registryPlan, makeManualRow, manualRowsOf,
         bomId } from './master/bom.js';
import { makeSession, sheetRows, planCount, planSummary, postCount, STATUS } from './core/count.js';
import { lotsOf, suggestLots, traceLot } from './core/lots.js';
// counts() ของสมุดชื่อชนกับ counts ที่เป็นรอบนับของในไฟล์นี้ จึงเรียกใหม่ว่า alive
import { makeEntry, voidEntry, REASONS, KINDS, counts as alive } from './core/ledger.js';
import { balances, cardRows, oddBalances } from './core/balance.js';
import { localDate, atFrom, todayLocal } from './core/localtime.js';
import { writeCard, toCardLines, sheetNameFor, safeFileName } from './export/bincard.js';
import { TABLES, dirtyRows, mergeIncoming, markSynced, chunk, toWire,
         syncPlan, looksLikeOldScript, normKeysAll, missingTables } from './core/sync.js';
import { parsePoFile, parseKitList, parseKitChem, kitsOfPo,
         importPlan as importPlanKit } from './master/po-kit.js';
import { readIncomeBook, pickLatest, conflictsWithinPn, peerOutliers, flaggedKeys,
         makeIncomeRows, summarizeIncome, incomePlan, parseDataSheet } from './master/income-bom.js';
import { bomExpect, pctDiff, checkWeekly } from './master/weekly.js';
import { makeEntity, entityOfPo, resolveEntity, activeCodes, infoOf,
         unknownEntities, DEFAULT_ENTITY } from './master/entities.js';

const { createApp, ref, reactive, computed, watch } = Vue;

const APP_VERSION = document.querySelector('meta[name="app-version"]').content;
const SHOW_MAX = 300;
/**
 * แท็บจัดเป็นกลุ่ม เพราะสิบแท็บเรียงยาวเป็นแถวเดียวหาของไม่เจอบนจอโรงงาน
 * จัดตามจังหวะการทำงานจริง ไม่ใช่ตามโครงข้อมูล
 *   งานประจำวัน  สิ่งที่พนักงานเปิดทุกวัน
 *   ข้อมูลตั้งต้น ของที่ตั้งครั้งเดียวแล้วแก้เป็นครั้งคราว
 *   ระบบ         ของเจ้าของ
 */
const GROUPS = [
  { k: 'day',  label: 'งานประจำวัน', tabs: [
    { k: 'home',  label: 'หน้าแรก' },
    { k: 'in',    label: 'รับเข้า' },
    { k: 'out',   label: 'จ่ายออก' },
    { k: 'bal',   label: 'ยอดคงคลัง' },
    { k: 'misc',  label: 'ของเสีย · คืน · ปรับยอด' },
    { k: 'wk',    label: 'รับเข้ารวมรายรอบ' }
  ] },
  { k: 'data', label: 'ข้อมูลตั้งต้น', tabs: [
    { k: 'mat',   label: 'ทะเบียนวัตถุดิบ' },
    { k: 'bom',   label: 'BOM' },
    { k: 'po',    label: 'PO / Kit List' },
    { k: 'count', label: 'นับของ' }
  ] },
  { k: 'sys',  label: 'ระบบ', tabs: [
    { k: 'sync',  label: 'ตั้งค่า · ซิงค์' }
  ] }
];

const TABS = GROUPS.flatMap(g => g.tabs);

/** สามชนิดที่หน้า misc ดูแล — เรียงตามความถี่ที่ใช้จริง */
const MISC = [
  { k: 'scrap',  what: 'ตัดของที่เสียออกจากคลัง' },
  { k: 'return', what: 'ของที่เบิกไปแล้วเอากลับเข้าคลัง' },
  { k: 'adjust', what: 'นับได้ไม่ตรงสมุด แก้ยอดให้ตรงของจริง' }
];

createApp({
  setup() {
    const ready = ref(false);
    const bootMsg = ref('กำลังเปิดฐานข้อมูล...');
    const bootError = ref('');
    const tab = ref('home');
    const groupOf = k => (GROUPS.find(g => g.tabs.some(t => t.k === k)) || GROUPS[0]).k;
    const openGroup = ref('day');
    watch(tab, k => { openGroup.value = groupOf(k); });
    const entity = ref('');

    const materials = ref([]);
    const entries = ref([]);
    const bom = ref([]);
    const counts = ref([]);

    const q = ref('');
    const fCat = ref('');
    const fState = ref('active');
    const edit = ref(null);

    // ชื่อเครื่อง — ติดไปกับทุกรายการเพื่อให้ไล่ได้ว่าคีย์มาจากเครื่องไหน (INVARIANTS B)
    // สุ่มครั้งเดียวแล้วเก็บไว้ เพราะยังไม่มีหน้าตั้งค่าให้ตั้งชื่อเอง
    const device = ref('');

    const toast = reactive({ show: false, text: '', bad: false });
    let toastTimer = null;
    function flash(text, bad = false) {
      toast.text = text; toast.bad = bad; toast.show = true;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.show = false; }, bad ? 5000 : 2600);
    }

    // ── เปิดโปรแกรม ────────────────────────────────────────────────
    (async () => {
      try {
        bootMsg.value = 'กำลังโหลดข้อมูลจากเครื่อง...';
        const data = await db.loadAll();
        // normKeysAll ตรงนี้ซ่อมข้อมูลที่ค้างในเครื่องมาตั้งแต่ก่อนแก้ issue #36 ด้วย
        // แถวพวกนั้นมี updated_at ไม่ขยับ การซิงค์จึงไม่เขียนทับให้
        materials.value = normKeysAll(data.materials || []);
        entries.value = normKeysAll(data.entries || []);
        bom.value = normKeysAll(data.bom || []);
        counts.value = data.counts || [];
        pos.value = normKeysAll(data.pos || []);
        kits.value = normKeysAll(data.kits || []);
        shorts.value = normKeysAll(data.shorts || []);
        entities.value = normKeysAll(data.entities || []);
        entity.value = await db.getMeta('entity', '') || '';
        // ยังไม่มีหน้าตั้งค่า — ตั้งค่าเริ่มต้นไว้ก่อนเพื่อให้หน้าที่ต้องใช้ entity ทำงานได้
        if (!entity.value) {
          entity.value = DEFAULT_ENTITY;
          await db.setMeta('entity', DEFAULT_ENTITY);
        }
        store.value = await db.getMeta('store', '') || '';
        const cfg = await db.getMeta('sync', null);
        if (cfg) {
          sync.url = cfg.url || ''; sync.token = cfg.token || '';
          sync.auto = cfg.auto !== false;
          sync.since = Object.assign({}, cfg.since || {});
        }
        // รับค่าตั้งค่าจากลิงก์ได้ เช่น  .../v2/#url=...&token=...&entity=TUE-H
        // แจกเป็นบุ๊กมาร์กเดียวแล้วทุกเครื่องเปิดใช้ได้เลย ไม่ต้องเดินไปกรอกทีละเครื่อง
        // ล้าง hash ทิ้งทันทีหลังรับค่า เพื่อไม่ให้รหัสค้างอยู่บนแถบที่อยู่ให้คนเดินผ่านเห็น
        if (location.hash.length > 1) {
          const h = new URLSearchParams(location.hash.slice(1));
          if (h.get('url')) sync.url = h.get('url');
          if (h.get('token')) sync.token = h.get('token');
          if (h.get('entity')) { entity.value = h.get('entity'); await db.setMeta('entity', entity.value); }
          if (h.get('url') || h.get('token')) {
            saveSyncCfg();
            history.replaceState(null, '', location.pathname + location.search);
            fromLink.value = true;
          }
        }
        device.value = await db.getMeta('device', '') || '';
        if (!device.value) {
          device.value = 'PC-' + Math.random().toString(36).slice(2, 6).toUpperCase();
          await db.setMeta('device', device.value);
        }
        ready.value = true;
      } catch (err) {
        // เปิดฐานข้อมูลไม่ได้ = ทำอะไรไม่ได้เลย ต้องบอกให้ชัดว่าเกิดอะไรและทำยังไงต่อ
        // ห้ามปล่อยหน้าขาวเงียบ ๆ เพราะพนักงานจะไม่รู้ว่าต้องรอหรือต้องเรียกใคร
        bootError.value = 'เปิดฐานข้อมูลในเครื่องไม่ได้: ' + err.message;
        bootMsg.value = bootError.value;
        console.error(err);
      }
    })();

    // อีกแท็บบนเครื่องเดียวกันเขียนข้อมูล ต้องรู้ตัว ไม่งั้นสองแท็บจะเห็นคนละยอด
    db.onChange(async () => {
      try {
        materials.value = normKeysAll(await db.all('materials'));
        entries.value = normKeysAll(await db.all('entries'));
        bom.value = normKeysAll(await db.all('bom'));
      } catch { /* อ่านไม่ได้ก็ปล่อยไป รอบหน้าค่อยว่ากัน */ }
    });

    // ── ทะเบียน ────────────────────────────────────────────────────
    const activeCount = computed(() => materials.value.filter(m => m.active !== false).length);
    const needReview = computed(() => materials.value.filter(m => m.needs_review).length);

    const shown = computed(() => {
      let pool = materials.value;
      if (fState.value === 'active') pool = pool.filter(m => m.active !== false);
      else if (fState.value === 'review') pool = pool.filter(m => m.needs_review);
      if (fCat.value) pool = pool.filter(m => m.category === fCat.value);
      return searchMaterials(pool, q.value, { limit: SHOW_MAX, activeOnly: false });
    });

    const dupMap = computed(() => {
      const m = new Map();
      for (const d of duplicateDescriptions(materials.value)) m.set(d.description, d.codes);
      return m;
    });
    const dupOf = desc => {
      const key = String(desc || '').trim().toUpperCase().replace(/\s+/g, ' ');
      return dupMap.value.get(key) || [];
    };

    const codeCheck = computed(() =>
      edit.value ? checkCode(edit.value.material_code) : { level: 'ok', msg: '' });

    function startAdd() {
      edit.value = { _new: true, material_code: q.value.trim(), description: '', unit: '',
                     category: 'OTHER', requires_expiry: false, active: true };
    }
    function startEdit(m) { edit.value = { ...m, _new: false }; }

    // เดาหมวดให้ตอนพิมพ์ชื่อ แต่ไม่ทับถ้าคนเลือกเองแล้ว
    watch(() => edit.value && edit.value.description, d => {
      const e = edit.value;
      if (e && e._new && d && e.category === 'OTHER') e.category = categorize(d);
    });

    async function saveEdit() {
      const e = edit.value;
      if (!e) return;
      const chk = checkCode(e.material_code);
      if (chk.level === 'bad') { flash(chk.msg, true); return; }
      if (e._new && materials.value.some(m => normCode(m.material_code) === normCode(e.material_code))) {
        flash('รหัสนี้มีอยู่ในทะเบียนแล้ว', true); return;
      }
      try {
        // รหัสที่เพิ่มหน้างานติดธงรอตรวจไว้เสมอ ยกเว้นเจ้าของแก้เอง
        // พนักงานเดินต่อได้ทันที เจ้าของมาไล่ดูตอนพักเที่ยง — รูปแบบเดียวกับทีม agent
        const rec = e._new
          ? addedOnFloor({ ...e, needs_review: true }, e._by || 'หน้างาน')
          : makeMaterial(e);
        await db.put('materials', rec);
        const i = materials.value.findIndex(m => m.material_code === rec.material_code);
        if (i >= 0) materials.value.splice(i, 1, rec); else materials.value.push(rec);
        db.announce('materials');
        flash(e._new ? `เพิ่ม ${rec.material_code} แล้ว` : `แก้ ${rec.material_code} แล้ว`);
        edit.value = null;
      } catch (err) { flash(err.message, true); }
    }

    async function approve(m) {
      const rec = { ...m, needs_review: false, updated_at: new Date().toISOString() };
      try {
        await db.put('materials', rec);
        const i = materials.value.findIndex(x => x.material_code === m.material_code);
        materials.value.splice(i, 1, rec);
        db.announce('materials');
        flash(`ยืนยัน ${m.material_code} แล้ว`);
      } catch (err) { flash(err.message, true); }
    }

    // ── BOM ────────────────────────────────────────────────────────
    const bomDocs = ref([]);
    const bomPlan = ref(null);
    const bomBusy = ref(false);
    const dragOver = ref(false);

    const bomSum = computed(() => summarize(bomDocs.value));
    const bomPns = computed(() => pnSummary(bom.value));
    const missingPack = computed(() => pnsMissingPackMat(bom.value));
    const bomUnknownCodes = computed(() => unknownCodes(bom.value, materials.value));
    const bomUnconfirmed = computed(() => bom.value.filter(r => r.uomConfirmed === false).length);

    function readBomFiles(files) {
      const list = [...files].filter(f => /\.html?$/i.test(f.name));
      if (!list.length) { flash('ต้องเป็นไฟล์ .html ที่ออกจาก SAP', true); return; }
      let left = list.length;
      const docs = [];
      list.forEach(f => {
        const fr = new FileReader();
        fr.onload = ev => {
          try { docs.push(parseBomHtml(String(ev.target.result), f.name)); }
          catch (err) { docs.push({ ok: false, fileName: f.name, error: err.message }); }
          if (--left === 0) {
            bomDocs.value = docs;
            bomPlan.value = importPlan(docs, bom.value);
          }
        };
        fr.onerror = () => { docs.push({ ok: false, fileName: f.name, error: 'อ่านไฟล์ไม่ได้' });
                             if (--left === 0) { bomDocs.value = docs; bomPlan.value = importPlan(docs, bom.value); } };
        fr.readAsText(f, 'utf-8');
      });
    }
    const onDropBom = e => { dragOver.value = false; readBomFiles(e.dataTransfer.files); };
    const onPickBom = e => { readBomFiles(e.target.files); e.target.value = ''; };

    async function applyBom() {
      const docs = bomDocs.value.filter(d => d.ok);
      if (!docs.length) return;
      bomBusy.value = true;
      try {
        // แทนที่ทั้ง P/N เสมอ — ทิ้งของเดิมก่อนแล้วค่อยใส่ของใหม่
        // ถ้าใส่ทับทีละบรรทัด บรรทัดของ REV เก่าที่ไม่มีใน REV ใหม่จะค้างอยู่
        // แล้วยอดจะเบิ้ลโดยไม่มีอะไรเตือน เพราะทั้งสองบรรทัดดูถูกทั้งคู่เมื่อดูทีละบรรทัด
        const pns = new Set(docs.map(d => d.pn));
        const stale = bom.value.filter(r => pns.has(r.pn)).map(r => r.id);
        if (stale.length) await db.del('bom', stale);

        const rows = docs.flatMap(makeBomRows);
        await db.put('bom', rows);

        bom.value = [...bom.value.filter(r => !pns.has(r.pn)), ...rows];
        db.announce('bom');
        bomDocs.value = []; bomPlan.value = null;
        flash(`นำเข้า ${rows.length} บรรทัด จาก ${pns.size} P/N แล้ว`);
      } catch (err) { flash(err.message, true); }
      finally { bomBusy.value = false; }
    }

    // ── นำเข้า BOM จากใบเบิกวัตถุดิบ (.xlsx) ────────────────────────
    // ทางเข้าหลักตั้งแต่ ส.ค. 2026 เพราะไฟล์ Indented BOM จาก SAP ไม่อัปเดตแล้ว
    // ชุดล่าสุดลงวันที่ 27 ก.ค. 2026 และ REV ข้างในบางตัวย้อนไปถึงปี 2022
    //
    // ⚠️ ไม่มี SAP ไว้เทียบอีกแล้ว ด่านกันเลขผิดจึงอยู่ในไฟล์นี้ทั้งหมด
    // P/N ที่มีบรรทัดโดนทัก จะไม่ถูกติ๊กไว้ให้ตั้งแต่แรก — คนต้องเปิดดูแล้วติ๊กเอง
    const inc = ref(null);
    const incBusy = ref(false);
    const incDrag = ref(false);
    const incPick = reactive({});          // pn → เอาเข้าไหม
    const incOpen = ref('');               // P/N ที่กางดูรายละเอียดอยู่

    const incPicked = computed(() =>
      inc.value ? inc.value.latest.filter(d => incPick[d.pn]) : []);
    const incPickedLines = computed(() =>
      incPicked.value.reduce((a, d) => a + d.lines.length, 0));

    /** รหัสที่โดนทักของ P/N หนึ่ง — ใช้ทั้งกันติ๊กอัตโนมัติและกางให้ดูรายตัว */
    const incFlagsOf = pn => {
      if (!inc.value) return [];
      return [
        ...inc.value.conf.filter(c => c.pn === pn).map(c => ({
          kind: 'ขัดกันเอง', code: c.code, desc: c.desc, ratio: c.ratio,
          detail: c.values.map(v => `ชีต ${v.sheet} = ${v.usage}`).join(' · ') })),
        ...inc.value.out.filter(o => o.pn === pn).map(o => ({
          kind: 'หลุดค่ากลาง', code: o.code, desc: o.desc, ratio: o.ratio,
          detail: `ใบนี้ = ${o.usage} · P/N อื่นใช้ราว ${o.median}` }))
      ];
    };

    async function readIncomeFile(file) {
      incBusy.value = true;
      try {
        await loadLib('lib/xlsx.full.min.js', 'XLSX');
        const buf = await file.arrayBuffer();
        // cellDates ให้วันที่กลับมาเป็น Date ไม่ใช่ serial — dateOf รับได้ทั้งสองแบบ
        // แต่ Date อ่านง่ายกว่าตอนไล่ดูปัญหา
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
        const aoaOf = n => XLSX.utils.sheet_to_json(wb.Sheets[n],
                             { header: 1, defval: null, blankrows: true });

        const sheets = wb.SheetNames.filter(n => n !== 'data').map(n => ({ name: n, aoa: aoaOf(n) }));
        // ชีตที่ไม่ใช่ใบเบิกทิ้งไปเงียบ ๆ ส่วนใบเบิกที่พังต้องโผล่ในรายการเตือน
        const all = readIncomeBook(sheets);
        const docs = all.filter(d => d.ok || !d.notForm);
        if (!docs.length) throw new Error('ไม่เจอใบ Raw material Income ในไฟล์นี้เลย');

        const latest = pickLatest(docs);
        const conf = conflictsWithinPn(docs);
        const out = peerOutliers(latest);
        const flagged = flaggedKeys(conf, out);

        const data = wb.Sheets.data ? parseDataSheet(aoaOf('data')) : null;

        for (const k of Object.keys(incPick)) delete incPick[k];
        for (const d of latest) {
          // ใบที่มีบรรทัดโดนทัก ไม่ติ๊กให้ — ให้คนเปิดดูก่อน
          incPick[d.pn] = !d.lines.some(l => flagged.has(d.pn + '|' + l.code));
        }
        incOpen.value = '';
        inc.value = {
          fileName: file.name, docs, latest, conf, out, flagged, data,
          sum: summarizeIncome(docs, latest, conf, out),
          plan: incomePlan(latest, bom.value)
        };
      } catch (err) {
        flash('อ่านไฟล์ไม่สำเร็จ: ' + err.message, true);
        inc.value = null;
      } finally { incBusy.value = false; }
    }
    const onDropInc = e => { incDrag.value = false;
      if (e.dataTransfer.files[0]) readIncomeFile(e.dataTransfer.files[0]); };
    const onPickInc = e => { if (e.target.files[0]) readIncomeFile(e.target.files[0]); e.target.value = ''; };

    const incPickAll = v => { for (const d of inc.value.latest) incPick[d.pn] = v; };

    async function applyIncome() {
      const picked = incPicked.value;
      if (!picked.length) { flash('ยังไม่ได้ติ๊ก P/N ไหนเลย', true); return; }
      incBusy.value = true;
      try {
        // แทนที่ทั้ง P/N เหมือนทางเข้า SAP ด้วยเหตุผลเดียวกัน
        // บรรทัดที่หายไปจากสูตรใหม่ต้องหายจริง ไม่ใช่ค้างอยู่แล้วทำให้ยอดเบิ้ล
        const pns = new Set(picked.map(d => d.pn));
        const stale = bom.value.filter(r => pns.has(r.pn)).map(r => r.id);
        if (stale.length) await db.del('bom', stale);

        const rows = plain(picked.flatMap(d => makeIncomeRows(d)));
        await db.put('bom', rows);
        bom.value = [...bom.value.filter(r => !pns.has(r.pn)), ...rows];
        db.announce('bom');
        inc.value = null;
        flash(`นำเข้า ${rows.length} บรรทัด จาก ${pns.size} P/N แล้ว`);
      } catch (err) { flash(err.message, true); }
      finally { incBusy.value = false; }
    }

    /**
     * ทะเบียนวัตถุดิบจากชีต data
     *
     * ── ทำไมต้องมีสองปุ่ม ────────────────────────────────────────
     * ชีตนี้มีเกือบแปดพันรหัส ซึ่งเป็นจำนวนเดียวกับที่ทำให้ v1 พัง
     * ไม่ใช่เพราะเก็บไม่ไหว (IndexedDB เก็บได้สบาย) แต่เพราะช่องค้นหาจะกลายเป็นกองฟาง
     * ค่าตั้งต้นจึงเป็น "เฉพาะที่ BOM ใช้จริง" ส่วนทั้งก้อนต้องตั้งใจกดเอง
     */
    const incRegUsed = computed(() => {
      if (!inc.value || !inc.value.data || !inc.value.data.ok) return [];
      const have = new Set(materials.value.map(m => normCode(m.material_code)));
      const used = new Set(bom.value.map(r => normCode(r.code)));
      for (const d of incPicked.value) for (const l of d.lines) used.add(normCode(l.code));
      return inc.value.data.items.filter(i => used.has(normCode(i.code)) && !have.has(normCode(i.code)));
    });
    const incRegAll = computed(() => {
      if (!inc.value || !inc.value.data || !inc.value.data.ok) return [];
      const have = new Set(materials.value.map(m => normCode(m.material_code)));
      return inc.value.data.items.filter(i => !have.has(normCode(i.code)));
    });

    async function applyIncomeRegistry(scope) {
      const list = scope === 'all' ? incRegAll.value : incRegUsed.value;
      if (!list.length) { flash('ไม่มีรหัสใหม่ให้เพิ่ม', true); return; }
      if (scope === 'all' && !confirm(
            `กำลังจะเพิ่ม ${list.length.toLocaleString()} รหัสเข้าทะเบียนทั้งก้อน\n\n` +
            'ส่วนใหญ่เป็นของที่ไม่ได้ใช้ในสายการผลิตตอนนี้ และจะไปโผล่ในช่องค้นหาทุกครั้งที่คีย์\n' +
            'ปกติควรใช้ปุ่ม "เฉพาะที่สูตรใช้จริง" แทน\n\nยืนยันว่าจะเพิ่มทั้งหมด?')) return;
      incBusy.value = true;
      try {
        // หน่วยที่แปลงไม่ได้ปล่อยว่างไว้ ไม่เดา — ธงรอตรวจจะพาคนมาเติมเอง
        const recs = list.map(i => makeMaterial({
          material_code: i.code, description: i.desc, unit: i.unit,
          active: true, needs_review: true, source: 'ใบเบิก',
          note: 'ตั้งจากชีต data ของใบเบิกวัตถุดิบ' + (i.note ? ' · ' + i.note : '')
        }));
        await db.put('materials', plain(recs));
        materials.value.push(...recs);
        db.announce('materials');
        flash(`เพิ่ม ${recs.length.toLocaleString()} รหัสเข้าทะเบียนแล้ว — ติดธงรอตรวจไว้ทุกตัว`);
      } catch (err) { flash(err.message, true); }
      finally { incBusy.value = false; }
    }

    // ── แก้ BOM ด้วยมือ ────────────────────────────────────────────
    // ไฟล์ SAP ไม่ได้มาทุกครั้งที่สูตรเปลี่ยน บางทีแก้ปากเปล่าหน้างานก่อนแล้วเอกสารตามมาทีหลัง
    // ถ้าแก้เองไม่ได้ ช่วงนั้นจะคีย์รับเข้าโดยไม่มียอดตามสูตรให้เทียบเลย
    const bomPn = ref('');            // P/N ที่กางดูอยู่
    const bomEdit = ref(null);
    const bomBy = ref('');

    const bomRowsOfPn = computed(() => bom.value
      .filter(r => String(r.pn) === String(bomPn.value) && !r.deleted)
      .sort((a, b) => String(a.code).localeCompare(String(b.code))));

    function openBomPn(pn) { bomPn.value = String(pn); bomEdit.value = null; }
    function startBomRow(r) {
      bomEdit.value = r
        ? { ...r, _new: false }
        : { pn: bomPn.value, code: '', desc: '', usage: null, unit: '', note: '', _new: true };
    }
    // เลือกรหัสจากช่องค้นหาร่วม แล้วเติมชื่อกับหน่วยจากทะเบียนให้เลย
    function onBomCode() {
      const e = bomEdit.value;
      if (!e) return;
      const m = matOf(e.code);
      if (m) { if (!e.desc) e.desc = m.description; if (!e.unit) e.unit = m.unit; }
    }

    async function saveBomRow() {
      const e = bomEdit.value;
      if (!e) return;
      try {
        const rec = makeManualRow({ ...e, by: bomBy.value || 'หน้างาน' }, bom.value);
        await db.put('bom', rec);
        const i = bom.value.findIndex(r => r.id === rec.id);
        if (i >= 0) bom.value.splice(i, 1, rec); else bom.value.push(rec);
        db.announce('bom');
        flash(`บันทึกสูตร ${rec.pn} · ${rec.code} แล้ว`);
        bomEdit.value = null;
      } catch (err) { flash(err.message, true); }
    }

    /**
     * ลบบรรทัดสูตร — ติดธง deleted ไม่ใช่ลบทิ้งจากเครื่อง
     * ถ้าลบจริง เครื่องอื่นที่ยังมีแถวนั้นอยู่จะซิงค์มันกลับมาให้ใหม่รอบหน้า
     */
    async function deleteBomRow(r) {
      if (!confirm(`ลบ ${r.code} ออกจากสูตรของ ${r.pn} ไหม`)) return;
      const rec = { ...plain(r), deleted: true, imported_at: new Date().toISOString() };
      await db.put('bom', rec);
      const i = bom.value.findIndex(x => x.id === r.id);
      bom.value.splice(i, 1, rec);
      db.announce('bom');
      flash('ลบแล้ว');
    }

    /** บรรทัดที่แก้มือไว้ และกำลังจะถูกไฟล์ที่ลากมาทับ */
    /**
     * บรรทัดที่แก้มือไว้ แล้วกำลังจะโดนทับ
     *
     * ⚠️ ต้องดูทั้งสองทางเข้า ไม่ใช่แค่ทาง SAP
     * ทั้งคู่ "แทนที่ทั้ง P/N" เหมือนกัน จึงกลืนบรรทัดที่แก้มือได้เหมือนกัน
     * และตั้งแต่ ส.ค. 2026 ทางที่ใช้จริงคือทางใบเบิก ถ้าเช็คแค่ทาง SAP
     * คำเตือนนี้จะไม่เคยขึ้นอีกเลย ทั้งที่ของหายจริงทุกครั้งที่นำเข้า
     */
    const bomManualHit = computed(() => {
      const pns = [
        ...bomDocs.value.filter(d => d.ok).map(d => d.pn),
        ...incPicked.value.map(d => d.pn)
      ];
      return pns.length ? manualRowsOf(bom.value, pns) : [];
    });

    // ── ตั้งทะเบียนจาก BOM ─────────────────────────────────────────
    // BOM ที่ Delta ให้มามีครบสามอย่างที่ทะเบียนต้องใช้ คือ รหัส ชื่อ หน่วย
    // จึงใช้ตั้งต้นทะเบียนได้เลย และได้เฉพาะของที่ใช้ผลิตจริง
    const regPlan = computed(() => registryPlan(bom.value, materials.value));
    const regDraft = ref(null);      // ตารางที่กำลังตรวจก่อนกดสร้าง
    const regBusy = ref(false);

    function openRegPlan() {
      // ก๊อปออกมาเป็นชุดแก้ได้ ยังไม่แตะทะเบียนจริงจนกว่าจะกดสร้าง
      regDraft.value = regPlan.value.rows.map(r => ({ ...r, take: true }));
    }
    const regTake = computed(() => (regDraft.value || []).filter(r => r.take));

    async function applyRegPlan() {
      const rows = regTake.value;
      if (!rows.length) { flash('ยังไม่ได้เลือกรายการไหนเลย', true); return; }
      regBusy.value = true;
      try {
        // ติดธงรอตรวจทุกตัว เพราะ BOM บอกวันหมดอายุไม่ได้ และหมวดเป็นแค่การเดาจากชื่อ
        // พนักงานเดินต่อได้ทันที เจ้าของมาไล่ยืนยันทีเดียว — รูปแบบเดียวกับรหัสที่เพิ่มหน้างาน
        const recs = rows.map(r => makeMaterial({
          material_code: r.code, description: r.desc, unit: r.unit, category: r.category,
          active: true, needs_review: true, source: 'sap',
          note: 'ตั้งจาก BOM · ใช้ใน ' + r.pns.slice(0, 3).join(' ')
              + (r.nPn > 3 ? ` และอีก ${r.nPn - 3} P/N` : '')
        }));
        await db.put('materials', recs);
        materials.value.push(...recs);
        db.announce('materials');
        flash(`เพิ่ม ${recs.length} รหัสเข้าทะเบียนแล้ว — ติดธงรอตรวจไว้ทุกตัว`);
        regDraft.value = null;
        tab.value = 'mat';
        fState.value = 'review';
      } catch (err) { flash(err.message, true); }
      finally { regBusy.value = false; }
    }

    // ── นับของ ─────────────────────────────────────────────────────
    const cs = ref(null);                       // รอบนับที่เปิดอยู่
    const csBusy = ref(false);
    const csRefText = ref('');
    const csNew = reactive({ name: '', person: '', category: '', scope: '' });

    const countHistory = computed(() =>
      [...counts.value].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12));

    const csPreview = computed(() =>
      sheetRows(materials.value, { scope: csNew.scope, category: csNew.category }).length);

    const csRows = computed(() =>
      cs.value ? sheetRows(materials.value, { scope: cs.value.scope, category: cs.value.category }) : []);

    const csFilled = computed(() => {
      if (!cs.value) return 0;
      return Object.values(cs.value.counted || {})
        .filter(v => v && v.qty !== null && v.qty !== undefined && v.qty !== '').length;
    });

    /** ยอดอ้างอิงจากระบบเดิม — วางเป็นข้อความ ไม่เข้าสมุด ใช้เทียบอย่างเดียว */
    const csRef = computed(() => {
      const m = new Map();
      for (const line of String(csRefText.value).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const p = t.split(/[\s,\t]+/);
        if (p.length < 2) continue;
        const v = Number(p[p.length - 1]);
        if (isFinite(v)) m.set(String(p[0]).trim().toUpperCase(), v);
      }
      return m;
    });

    const codesWithHistory = computed(() => {
      const s = new Set();
      for (const e of entries.value) if (e.entity === entity.value) s.add(String(e.material_code));
      return s;
    });
    const bookBalances = computed(() =>
      entity.value ? balances(entries.value, entity.value) : new Map());

    const csPlanRows = computed(() => cs.value
      ? planCount(cs.value, { balances: bookBalances.value,
                              codesWithHistory: codesWithHistory.value,
                              reference: csRef.value.size ? csRef.value : null })
      : []);
    const csSum = computed(() => planSummary(csPlanRows.value));

    function startCount() {
      if (!entity.value) { flash('ยังไม่ได้เลือกนิติบุคคล', true); return; }
      try {
        const s = makeSession({ entity: entity.value, name: csNew.name,
                                person: csNew.person, scope: csNew.scope });
        s.category = csNew.category;
        // เตรียมช่องว่างไว้ให้ทุกรหัสที่ต้องนับ เพื่อให้ v-model ผูกได้ตั้งแต่แรก
        for (const r of sheetRows(materials.value, { scope: s.scope, category: s.category })) {
          s.counted[r.code] = { qty: null, note: '' };
        }
        cs.value = s;
        counts.value.push(s);
        db.put('counts', JSON.parse(JSON.stringify(s))).catch(e => flash(e.message, true));
      } catch (err) { flash(err.message, true); }
    }

    let saveTimer = null;
    function saveCount() {
      // คีย์ของ 400 รายการแล้วหายเพราะปิดแท็บคือฝันร้าย เซฟทุกครั้งที่แก้ แต่หน่วงไว้กันเขียนถี่
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (!cs.value) return;
        cs.value.updated_at = new Date().toISOString();
        try { await db.put('counts', JSON.parse(JSON.stringify(cs.value))); }
        catch (err) { flash(err.message, true); }
      }, 400);
    }

    async function postCountNow() {
      if (!cs.value) return;
      const rows = csPlanRows.value.filter(r => r.kind);
      if (!rows.length) { flash('ไม่มีอะไรต้องลงบัญชี', true); return; }
      csBusy.value = true;
      try {
        const posted = postCount(cs.value, csPlanRows.value, { device: device.value });
        // เขียนรายการเคลื่อนไหวก่อนเสมอ — เป็นสิ่งเดียวที่สร้างใหม่ไม่ได้ถ้าหาย (บทเรียน #29)
        await db.put('entries', posted);
        entries.value.push(...posted);
        cs.value.status = 'posted';
        cs.value.posted_at = new Date().toISOString();
        await db.put('counts', JSON.parse(JSON.stringify(cs.value)));
        db.announce('entries');
        flash(`ลงบัญชี ${posted.length} รายการแล้ว`);
      } catch (err) { flash(err.message, true); }
      finally { csBusy.value = false; }
    }

    const printSheet = () => window.print();

    // ── ค้นหารหัส (ใช้ร่วมกันทุกหน้า) ────────────────────────────
    // ไม่ใช้ <datalist> เหมือน v1 เพราะมันแสดงคำอธิบายอย่างเดียว
    // ในทะเบียนที่ใช้งานอยู่มี 32 คำอธิบายที่ซ้ำกันเป๊ะ แยกกันไม่ออกบนหน้าจอ — issue #26
    const pick = ref(null);        // อ็อบเจกต์ปลายทางที่จะเติมรหัสลงไป
    const pickQ = ref('');
    const pickResults = computed(() =>
      searchMaterials(materials.value, pickQ.value, { limit: 60 }));
    function openPick(target) { pick.value = target; pickQ.value = target.code || ''; }
    function choosePick(m) {
      const t = pick.value;
      if (!t) return;
      t.code = m.material_code;
      if (t === mk) onMkCode();
      else if (t === bomEdit.value) onBomCode();
      else if (outLines.value.includes(t)) fillOutLine(t);
      else fillLine(t);
      pick.value = null;
    }

    const matOf = code => materials.value.find(m => normCode(m.material_code) === normCode(code));

    /** เหตุผลเก็บเป็นรหัสในสมุด แต่บนจอต้องอ่านรู้เรื่อง */
    const reasonLabel = e => {
      if (!e || !e.reason_code) return '';
      const r = (REASONS[e.kind] || []).find(x => x.code === e.reason_code);
      return r ? r.label : e.reason_code;
    };

    /** ช่องหมายเหตุในการ์ด — ต่อเฉพาะส่วนที่มีจริง ไม่งั้นจะได้ "· " ห้อยหน้าลอย ๆ */
    const noteCell = e => [
      reasonLabel(e),
      (e.kind === 'adjust' && e.counted_qty != null) ? 'นับได้ ' + e.counted_qty : '',
      e.note
    ].filter(Boolean).join(' · ');

    // ── รับเข้า ────────────────────────────────────────────────────
    const inH = reactive({ po: '', pn: '', order: null, date: todayLocal(), person: '' });
    const inLines = ref([]);
    const bomHint = ref('');
    let lineSeq = 0;

    const bomPnCodes = computed(() => [...new Set(bom.value.map(r => r.pn))].sort());

    function blankLine(code = '') {
      return { k: 'L' + (++lineSeq), code, desc: '', unit: '', reqmt: null, issued: null,
               qty: null, lot: '', expiry: '', needExp: false, known: false };
    }
    function fillLine(l) {
      const m = matOf(l.code);
      l.known = !!m;
      l.desc = m ? m.description : '';
      l.unit = m ? m.unit : '';
      l.needExp = m ? m.requires_expiry === true : false;
    }
    const addInLine = () => inLines.value.push(blankLine());

    /**
     * กางรายการให้คีย์ — ยึด Kit List ก่อน แล้วค่อยตกมาที่ BOM
     *
     * ลำดับความน่าเชื่อถือ: Kit List (ของที่ Delta จ่ายมาจริง) > BOM (ยอดตามสูตร)
     * ถ้ามี Kit List จะเติมช่อง "ตามที่จ่ายมา" ให้เลย เหลือให้พนักงานคีย์แค่ยอดนับจริง
     * ซึ่งเป็นงานที่ต่างกันมาก — คีย์ทับเลขที่มีอยู่แล้ว เร็วกว่าและผิดยากกว่าคีย์จากศูนย์
     *
     * ⚠️ kitsOfPo ตัดกลุ่มจ่ายรวมรายสัปดาห์ (chem) ออกให้แล้ว ห้ามเอากลับเข้ามา
     * ของกลุ่มนั้นไม่ได้มาพร้อม PO ถ้ากางขึ้นมาพนักงานจะคีย์ยอดที่ยังไม่ได้รับของจริง
     */
    function expandBom() {
      const kit = inH.po ? kitsOfPo(kits.value, inH.po) : [];
      const rows = inH.pn ? bom.value.filter(r => r.pn === String(inH.pn)) : [];
      const order = Number(inH.order) || 0;
      const bomOf = new Map(rows.map(r => [String(r.code), r]));

      if (kit.length) {
        // เติม P/N จาก Kit List ให้ถ้ายังไม่ได้ใส่ — เอกสารใบเดียวกันน่าเชื่อกว่าที่คนจำมา
        if (!inH.pn && kit[0].pn) inH.pn = kit[0].pn;
        inLines.value = kit.map(k => {
          const l = blankLine(k.code);
          fillLine(l);
          if (!l.known) { l.desc = k.desc; l.unit = k.unit; }
          l.issued = k.issue;                       // Delta จ่ายมาเท่าไหร่
          l.qty = k.issue;                          // ตั้งไว้ให้ก่อน พนักงานแก้ทับเป็นยอดนับจริง
          const b = bomOf.get(String(k.code));
          l.reqmt = b && order ? Math.round(b.usage * order * 1e5) / 1e5 : null;
          l.uomConfirmed = b ? b.uomConfirmed : true;
          return l;
        });
        // รายการที่สูตรบอกว่าต้องใช้ แต่ Kit List ไม่ได้จ่ายมา — บอกไว้ ไม่ใช่เติมให้เอง
        const missing = rows.filter(r => !kit.some(k => String(k.code) === String(r.code)));
        bomHint.value = `ดึงจาก Kit List ${kit.length} รายการ (เติมยอดที่ Delta จ่ายให้แล้ว)`
          + (missing.length ? ` · อีก ${missing.length} รายการมีในสูตรแต่ Kit List ไม่ได้จ่ายมา` : '');
        return;
      }

      if (!rows.length) {
        bomHint.value = inH.po
          ? `ยังไม่มีทั้ง Kit List ของ PO ${inH.po} และสูตรของ ${inH.pn || '(ยังไม่ใส่ P/N)'} — คีย์เองได้`
          : `ยังไม่มีสูตรของ ${inH.pn} ในเครื่อง — คีย์เองได้`;
        return;
      }

      inLines.value = rows.map(r => {
        const l = blankLine(r.code);
        fillLine(l);
        if (!l.known) { l.desc = r.desc; l.unit = r.unit; }
        l.reqmt = order ? Math.round(r.usage * order * 1e5) / 1e5 : null;
        l.uomConfirmed = r.uomConfirmed;
        return l;
      });
      const un = rows.filter(r => r.uomConfirmed === false).length;
      bomHint.value = `กางสูตร ${rows.length} รายการ`
        + (inH.po ? ` · ยังไม่มี Kit List ของ PO ${inH.po} จึงใช้สูตรแทน` : '')
        + (order ? ` · คิดจากจำนวนสั่ง ${order}` : ' · ใส่จำนวนสั่งเพื่อให้คำนวณยอดตามสูตร')
        + (un ? ` · ⚠️ ${un} รายการใช้หน่วยที่ยังไม่ยืนยันกับ Delta` : '');
    }

    const inReady = computed(() => inLines.value.filter(l => l.code && Number(l.qty) > 0));
    const inNoLot = computed(() => inReady.value.filter(l => !l.lot));

    async function saveIn() {
      if (!inH.person) { flash('ยังไม่ได้ใส่ชื่อผู้รับ', true); return; }
      if (!inH.po) { flash('ยังไม่ได้ใส่เลข PO', true); return; }
      const bad = inReady.value.filter(l => l.needExp && !l.expiry);
      if (bad.length) { flash(`ต้องกรอกวันหมดอายุอีก ${bad.length} รายการ`, true); return; }
      const noLot = inNoLot.value.length;
      if (noLot && !confirm(`มี ${noLot} บรรทัดที่ยังไม่ใส่เลขล็อต\n`
        + 'ล็อตเก็บได้แค่ตอนรับเข้า ถ้าไม่ใส่ตอนนี้จะตามรอยย้อนกลับไม่ได้ตลอดไป\n\nบันทึกต่อไหม')) return;
      try {
        const posted = inReady.value.map(l => makeEntry({
          entity: entity.value, kind: 'receive', material_code: l.code, qty: Number(l.qty),
          lot: l.lot || '(ไม่ระบุ)', doc_kind: 'po', doc_ref: inH.po, part_no: inH.pn,
          at: atFrom(inH.date),
          person: inH.person, device: device.value,
          expiry_date: l.expiry || '', reqmt_qty: l.reqmt, issued_qty: l.issued
        }));
        await db.put('entries', posted);
        entries.value.push(...posted);
        db.announce('entries');
        flash(`บันทึกรับเข้า ${posted.length} รายการ · PO ${inH.po}`);
        inLines.value = []; bomHint.value = ''; inH.po = ''; inH.pn = ''; inH.order = null;
      } catch (err) { flash(err.message, true); }
    }

    function addFromLine(l) {
      edit.value = { _new: true, material_code: l.code, description: '', unit: '',
                     category: 'OTHER', requires_expiry: false, active: true };
      tab.value = 'mat';
      flash('กรอกชื่อกับหน่วยแล้วกดบันทึก จากนั้นกลับมาหน้ารับเข้าได้เลย');
    }

    // ── จ่ายออก ────────────────────────────────────────────────────
    // ทำเป็นใบเหมือนหน้ารับเข้า — ใส่เลข PO แล้วกางรายการขึ้นมาให้คีย์ทีเดียวจบ
    // ของเดิมคีย์ได้ทีละรหัส ซึ่งแปลว่างานเบิกหนึ่งใบต้องกดบันทึกสิบกว่ารอบ
    const outH = reactive({ po: '', pn: '', order: null, date: todayLocal(), person: '' });
    const outLines = ref([]);
    const outHint = ref('');

    function outBlank(code = '') {
      return { k: 'O' + (++lineSeq), code, desc: '', unit: '', reqmt: null,
               qty: null, lot: '', inferred: false, known: false };
    }
    function fillOutLine(l) {
      const m = matOf(l.code);
      l.known = !!m;
      l.desc = m ? m.description : '';
      l.unit = m ? m.unit : '';
    }
    const addOutLine = () => outLines.value.push(outBlank());

    /** ยอดคงเหลือของบรรทัดนี้ ณ ตอนนี้ */
    const outBalOf = l =>
      l.code && entity.value ? (bookBalances.value.get(normCode(l.code)) || 0) : 0;
    const outAfterOf = l =>
      Math.round((outBalOf(l) - (Number(l.qty) || 0)) * 1e5) / 1e5;

    /** ระบบเดาให้ว่าน่าจะหยิบจากล็อตไหน — ของเก่าก่อน */
    const outSuggestOf = l =>
      l.code && Number(l.qty) > 0 && entity.value
        ? suggestLots(entries.value, entity.value, normCode(l.code), Number(l.qty)) : null;
    function useSuggested(l) {
      const s = outSuggestOf(l);
      if (s && s.picks.length) { l.lot = s.picks[0].lot; l.inferred = true; }
    }

    /**
     * กางรายการที่ต้องเบิกของใบนี้ — ใช้ที่มาชุดเดียวกับหน้ารับเข้า
     * Kit List บอกว่า Delta จ่ายอะไรมาให้ PO นี้ ซึ่งก็คือของที่ต้องเบิกไปผลิต
     * ถ้ายังไม่มี Kit List ก็กางจากสูตรตามจำนวนสั่ง
     */
    function expandOut() {
      const kit = outH.po ? kitsOfPo(kits.value, outH.po) : [];
      const rows = outH.pn ? bom.value.filter(r => String(r.pn) === String(outH.pn) && !r.deleted) : [];
      const order = Number(outH.order) || 0;
      const bomOf = new Map(rows.map(r => [String(r.code), r]));

      if (kit.length) {
        if (!outH.pn && kit[0].pn) outH.pn = kit[0].pn;
        outLines.value = kit.map(k => {
          const l = outBlank(String(k.code));
          fillOutLine(l);
          if (!l.known) { l.desc = k.desc; l.unit = k.unit; }
          const b = bomOf.get(String(k.code));
          l.reqmt = b && order ? Math.round(b.usage * order * 1e5) / 1e5 : null;
          // ตั้งยอดเบิกไว้เท่าที่ Delta จ่ายมา แล้วให้แก้ทับตามที่หยิบจริง
          l.qty = k.issue;
          return l;
        });
        outHint.value = `ดึงจาก Kit List ${kit.length} รายการ — แก้เป็นยอดที่เบิกจริงได้เลย`;
        return;
      }
      if (!rows.length) {
        outHint.value = outH.po
          ? `ยังไม่มีทั้ง Kit List ของ PO ${outH.po} และสูตรของ ${outH.pn || '(ยังไม่ใส่ P/N)'} — คีย์เองได้`
          : 'ใส่เลข PO หรือ P/N แล้วโปรแกรมจะกางรายการให้';
        return;
      }
      outLines.value = rows.map(r => {
        const l = outBlank(String(r.code));
        fillOutLine(l);
        if (!l.known) { l.desc = r.desc; l.unit = r.unit; }
        l.reqmt = order ? Math.round(r.usage * order * 1e5) / 1e5 : null;
        l.qty = l.reqmt;
        return l;
      });
      outHint.value = `กางสูตร ${rows.length} รายการ`
        + (outH.po ? ` · ยังไม่มี Kit List ของ PO ${outH.po} จึงใช้สูตรแทน` : '')
        + (order ? ` · คิดจากจำนวนสั่ง ${order}` : ' · ใส่จำนวนสั่งเพื่อให้คำนวณยอดตามสูตร');
    }

    const outReady = computed(() => outLines.value.filter(l => l.code && Number(l.qty) > 0));
    const outNegative = computed(() => outReady.value.filter(l => outAfterOf(l) < 0));

    function addFromOutLine(l) {
      edit.value = { _new: true, material_code: l.code, description: '', unit: '',
                     category: 'OTHER', requires_expiry: false, active: true };
      tab.value = 'mat';
    }

    async function saveOut() {
      if (!outH.person) { flash('ยังไม่ได้ใส่ชื่อผู้เบิก', true); return; }
      if (!outReady.value.length) { flash('ยังไม่มีบรรทัดที่กรอกจำนวน', true); return; }
      // ยอดติดลบเตือนได้ แต่ห้ามบล็อก — INVARIANTS A4
      // ของจริงมีกรณีคีย์รับเข้าย้อนหลัง ถ้าห้ามบันทึกพนักงานจะไปจดใส่กระดาษแล้วลืมคีย์
      const neg = outNegative.value;
      if (neg.length && !confirm(
        [`มี ${neg.length} รายการที่ยอดจะติดลบ`,
         neg.slice(0, 5).map(l => l.code + ' → ' + outAfterOf(l)).join('\n'),
         '', 'ยืนยันบันทึกไหม'].join('\n'))) return;
      try {
        const posted = outReady.value.map(l => makeEntry({
          entity: entity.value, kind: 'issue', material_code: l.code, qty: Number(l.qty),
          lot: l.lot, lot_inferred: l.inferred && !!l.lot,
          doc_kind: outH.po ? 'po' : '', doc_ref: outH.po, part_no: outH.pn,
          at: atFrom(outH.date), person: outH.person, device: device.value
        }));
        await db.put('entries', posted);
        entries.value.push(...posted);
        db.announce('entries');
        flash(`บันทึกจ่ายออก ${posted.length} รายการ`
              + (outH.po ? ` · PO ${outH.po}` : ''));
        outLines.value = []; outHint.value = '';
      } catch (err) { flash(err.message, true); }
    }

    // ── ของเสีย · คืนของ · ปรับยอด ─────────────────────────────────
    // สามชนิดนี้คือส่วนที่ v1 ไม่มีเลย พนักงานจึงต้องเอาไปแอบใส่ในจ่ายออก
    // ผลคือยอด "จ่ายออก" ในรายงานปนของเสียอยู่ข้างใน แยกกันไม่ออกย้อนหลัง
    const mk = reactive({ kind: 'scrap', code: '', qty: null, counted: null,
                          lot: '', part_no: '', reason: '', note: '',
                          date: todayLocal(), person: '' });

    const mkDef = computed(() => KINDS[mk.kind]);
    const mkReasons = computed(() => REASONS[mk.kind] || []);
    const mkMat = computed(() => matOf(mk.code));
    const mkUnit = computed(() => (mkMat.value || {}).unit || '');
    const mkBook = computed(() =>
      mk.code && entity.value ? (bookBalances.value.get(normCode(mk.code)) || 0) : 0);
    const mkLots = computed(() =>
      mk.code && entity.value ? lotsOf(entries.value, entity.value, normCode(mk.code)) : []);

    /** ปรับยอด: ส่วนต่างที่จะเขียนลงสมุด — แสดงให้เห็นก่อนกดบันทึกเสมอ */
    const mkDelta = computed(() => {
      if (mk.kind !== 'adjust' || mk.counted === null || mk.counted === '') return null;
      return Math.round((Number(mk.counted) - mkBook.value) * 1e5) / 1e5;
    });
    const mkAfter = computed(() => {
      if (mk.kind === 'adjust') return mkDelta.value === null ? mkBook.value : Number(mk.counted);
      const q = Number(mk.qty) || 0;
      return Math.round((mkBook.value + (mkDef.value.sign * q)) * 1e5) / 1e5;
    });

    const mkReady = computed(() => {
      if (!mk.code || !mk.person || !mk.reason) return false;
      if (mk.reason === 'other' && !mk.note.trim()) return false;
      return mk.kind === 'adjust'
        ? (mk.counted !== null && mk.counted !== '' && isFinite(Number(mk.counted)))
        : Number(mk.qty) > 0;
    });

    // เหตุผลของแต่ละชนิดเป็นคนละชุด ถ้าไม่ล้างจะเหลือค่าเดิมที่ใช้กับชนิดใหม่ไม่ได้
    // แล้วจะไปตกตอน makeEntry ซึ่งสายเกินไปที่จะบอกพนักงาน
    watch(() => mk.kind, () => { mk.reason = ''; });
    function onMkCode() { mk.lot = ''; }

    async function saveMisc() {
      try {
        // จับยอดเดิมไว้ก่อน — mkBook คำนวณสดจากสมุด พอเขียนรายการลงไปแล้วมันจะเป็นยอดใหม่ทันที
        const was = mkBook.value;
        const base = {
          entity: entity.value, kind: mk.kind, material_code: mk.code,
          lot: mk.lot, part_no: mk.part_no, reason_code: mk.reason, note: mk.note.trim(),
          at: atFrom(mk.date),
          person: mk.person, device: device.value
        };
        const e = mk.kind === 'adjust'
          ? makeEntry({ ...base, counted_qty: Number(mk.counted), book_qty: mkBook.value })
          : makeEntry({ ...base, qty: Number(mk.qty) });
        // ยอดติดลบเตือนได้แต่ห้ามบล็อก — INVARIANTS A4
        if (mkAfter.value < 0 &&
            !confirm(`ยอดจะติดลบเป็น ${mkAfter.value}\nยืนยันบันทึกไหม`)) return;
        await db.put('entries', e);
        entries.value.push(e);
        db.announce('entries');
        flash(mk.kind === 'adjust'
          ? `ปรับยอด ${mk.code} จาก ${was} เป็น ${mk.counted} แล้ว`
          : `บันทึก${mkDef.value.label} ${mk.qty} ${mkUnit.value} แล้ว`);
        mk.qty = null; mk.counted = null; mk.lot = ''; mk.note = '';
      } catch (err) { flash(err.message, true); }
    }

    // ── ยกเลิกรายการ ───────────────────────────────────────────────
    // สมุดเขียนเพิ่มได้อย่างเดียว ห้ามลบ — INVARIANTS B
    // รายการที่ยกเลิกไม่นับเข้ายอด แต่ยังต้องเห็นได้ว่าเคยมีและใครสั่งยกเลิกเพราะอะไร
    const voidBox = reactive({ row: null, reason: '', by: '' });
    function askVoid(r) { voidBox.row = r; voidBox.reason = ''; voidBox.by = ''; }

    /**
     * ยกเลิกรายการที่อยู่ "ก่อน" การปรับยอด = ต้องเตือน
     *
     * ส่วนต่างของการปรับยอดถูกแช่แข็งไว้ตั้งแต่ตอนบันทึก และตั้งใจให้เป็นแบบนั้น
     * (ถ้าคำนวณใหม่ตอนอ่าน ยอดในอดีตจะขยับเองเมื่อมีรายการแทรกทีหลัง — ดู core/ledger.js)
     * ผลข้างเคียงคือถ้ายกเลิกรายการเก่ากว่า ยอดใหม่จะไม่ตรงกับที่เคยนับได้อีกต่อไป
     * ระบบแก้ให้เองไม่ได้ จึงต้องบอกให้คนตัดสินใจ ไม่ใช่เงียบแล้วปล่อยให้ตัวเลขเพี้ยน
     */
    const voidAfterAdjust = computed(() => {
      const r = voidBox.row;
      if (!r) return null;
      const c = normCode(r.material_code);
      const later = entries.value.filter(e =>
        e.entity === r.entity && !e.voided && e.kind === 'adjust'
        && normCode(e.material_code) === c && e.at > r.at);
      return later.length ? later[later.length - 1] : null;
    });
    async function doVoid() {
      try {
        const src = entries.value.find(e => e.id === voidBox.row.id);
        const v = voidEntry(src, { by: voidBox.by.trim(), reason: voidBox.reason.trim() });
        await db.put('entries', v);
        entries.value.splice(entries.value.indexOf(src), 1, v);
        db.announce('entries');
        flash('ยกเลิกรายการแล้ว — ยังอยู่ในสมุดให้ตรวจย้อนหลังได้');
        voidBox.row = null;
      } catch (err) { flash(err.message, true); }
    }

    // ── ยอดคงคลัง และการ์ด ─────────────────────────────────────────
    const balQ = ref('');
    const balCat = ref('');
    const balZero = ref(false);
    const cardCode = ref('');        // เปิดการ์ดของรหัสไหนอยู่
    const traceOf = ref('');         // กำลังตามรอยล็อตไหน

    /** วันที่เคลื่อนไหวล่าสุดและจำนวนบรรทัดของแต่ละรหัส — ใช้แสดงผลอย่างเดียว */
    const balStats = computed(() => {
      const m = new Map();
      if (!entity.value) return m;
      for (const e of entries.value) {
        if (e.entity !== entity.value || !alive(e)) continue;
        const c = normCode(e.material_code);
        const a = m.get(c) || { last: '', lines: 0 };
        a.lines++;
        if (e.at > a.last) a.last = e.at;
        m.set(c, a);
      }
      return m;
    });

    const balAll = computed(() => {
      const rows = [];
      for (const [code, qty] of bookBalances.value) {
        const m = matOf(code);
        const s = balStats.value.get(normCode(code)) || { last: '', lines: 0 };
        rows.push({ code, qty, known: !!m,
                    desc: m ? m.description : '', unit: m ? m.unit : '',
                    category: m ? m.category : '', last: s.last, lines: s.lines });
      }
      return rows.sort((a, b) => a.code.localeCompare(b.code));
    });

    const balShown = computed(() => {
      const t = balQ.value.trim().toUpperCase();
      const pool = balAll.value.filter(r =>
        (balZero.value || r.qty !== 0) &&
        (!balCat.value || r.category === balCat.value) &&
        (!t || r.code.toUpperCase().includes(t) || r.desc.toUpperCase().includes(t)));
      return { rows: pool.slice(0, SHOW_MAX), total: pool.length };
    });

    const balSum = computed(() => {
      const r = balAll.value;
      return { codes: r.filter(x => x.qty !== 0).length,
               negative: r.filter(x => x.qty < 0).length,
               unknown: r.filter(x => !x.known && x.qty !== 0).length };
    });

    /**
     * รายการที่ควรไปดู — ใช้แทนการนับรอบ ซึ่งตกลงกันแล้วว่ายังไม่มีคนทำ
     * ให้เครื่องชี้เป้าจากสมุด แทนที่จะให้คนเดินนับทั้งคลังตามรอบ
     */
    const oddRows = computed(() => {
      if (!entity.value) return [];
      return oddBalances(entries.value, entity.value).map(o => {
        const m = matOf(o.code);
        return { ...o, desc: m ? m.description : '', unit: m ? m.unit : '' };
      });
    });

    const cardMat = computed(() => (cardCode.value ? matOf(cardCode.value) : null));
    const cardBal = computed(() =>
      cardCode.value ? (bookBalances.value.get(normCode(cardCode.value)) || 0) : 0);
    const card = computed(() => (cardCode.value && entity.value)
      ? cardRows(entries.value, entity.value, normCode(cardCode.value)).reverse() : []);
    const cardLots = computed(() => (cardCode.value && entity.value)
      ? lotsOf(entries.value, entity.value, normCode(cardCode.value)) : []);
    const trace = computed(() => (traceOf.value !== '' && cardCode.value && entity.value)
      ? traceLot(entries.value, entity.value, normCode(cardCode.value),
                 traceOf.value === '(ว่าง)' ? '' : traceOf.value) : null);

    /** รายการที่ถูกยกเลิกของรหัสนี้ — ไม่นับเข้ายอด แต่ต้องเห็นได้ (INVARIANTS B) */
    const cardVoided = computed(() => {
      if (!cardCode.value || !entity.value) return [];
      const c = normCode(cardCode.value);
      return entries.value
        .filter(e => e.entity === entity.value && e.voided && normCode(e.material_code) === c)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(e => ({ ...e, kindLabel: (KINDS[e.kind] || {}).label || e.kind }));
    });

    // ── นิติบุคคล ──────────────────────────────────────────────────
    // ⚠️ เปลี่ยนตัวที่เลือกอยู่ = เปลี่ยนความหมายของทุกยอดบนหน้าจอ
    // ไม่ใช่แค่การกรอง — ยอดคงเหลือ การ์ด และ Bin Card ที่ออกไป เป็นคนละชุดกันเลย
    const entities = ref([]);
    const entEdit = ref(null);

    const entCodes = computed(() => {
      const list = activeCodes(entities.value);
      // ตัวที่เลือกอยู่ต้องมีในรายการเสมอ ไม่งั้นช่องเลือกจะว่างแล้วยอดหายทั้งจอ
      return list.includes(entity.value) ? list : [entity.value, ...list].filter(Boolean);
    });
    const entInfo = computed(() => infoOf(entities.value, entity.value));

    /** นิติบุคคลที่โผล่ในสมุดแล้ว แต่ยังไม่มีในทะเบียน */
    const entUsed = computed(() => [...new Set(entries.value.map(e => e.entity))]);
    const entMissing = computed(() => unknownEntities(entities.value, entUsed.value));

    /** จำนวนรายการของแต่ละนิติบุคคล — ใช้ดูว่ายอดไปกองอยู่ที่ไหนบ้าง */
    const entCounts = computed(() => {
      const m = new Map();
      for (const e of entries.value) {
        if (!alive(e)) continue;
        m.set(e.entity, (m.get(e.entity) || 0) + 1);
      }
      return m;
    });

    async function switchEntity(code) {
      entity.value = code;
      await db.setMeta('entity', code);
      // ล้างของที่กำลังคี่ค้างอยู่ไม่ได้ แต่ต้องเตือนว่าหน้าจอเปลี่ยนความหมายแล้ว
      flash(`เปลี่ยนเป็น ${code} — ยอดคงเหลือและการ์ดทุกหน้าเป็นของ ${code} แล้ว`);
    }

    function startEnt(e) {
      entEdit.value = e ? { ...e, _new: false }
                        : { entity_code: '', company_name: '', address: '',
                            store_location: '', vendor_no: '', active: true, _new: true };
    }
    async function saveEnt() {
      const e = entEdit.value;
      if (!e) return;
      try {
        const rec = makeEntity(e);
        if (e._new && entities.value.some(x => x.entity_code === rec.entity_code)) {
          flash('รหัสนี้มีอยู่แล้ว', true); return;
        }
        await db.put('entities', rec);
        const i = entities.value.findIndex(x => x.entity_code === rec.entity_code);
        if (i >= 0) entities.value.splice(i, 1, rec); else entities.value.push(rec);
        db.announce('entities');
        flash(`บันทึก ${rec.entity_code} แล้ว`);
        entEdit.value = null;
      } catch (err) { flash(err.message, true); }
    }
    /** สร้างจากรหัสที่โผล่ในข้อมูลแล้ว — พิมพ์ซ้ำไม่มีประโยชน์ */
    const addMissingEnt = code => startEnt({ entity_code: code, active: true });

    // ── รับเข้ารวมรายสัปดาห์ ───────────────────────────────────────
    // Tube · Chemical · Copper foil · Solder — Delta จ่ายรวมเป็นรอบ ไม่ผูกกับ PO ทีละใบ
    // กฎทั้งหมดอยู่ใน master/weekly.js ที่นี่มีแค่การต่อสายเข้าหน้าจอ
    const wkH = reactive({ date: todayLocal(), docNo: '', group: '', person: '', entity: '' });
    const wkLines = ref([]);
    const wkTotals = ref({});          // รหัส -> ยอดรวมตามแถว Total ในเอกสาร (คีย์เอง)
    let wkSeq = 0;

    function wkBlank(copyFrom) {
      return { k: 'W' + (++wkSeq),
               code: copyFrom ? copyFrom.code : '', desc: '', unit: '',
               po: '', pn: '', entity: '', orderQty: null,
               req: null, s41: null, qty: null, lot: '', expiry: '',
               needExp: false, known: false, poFound: null, remark: '' };
    }
    function wkFill(l) {
      const m = matOf(l.code);
      l.known = !!m;
      l.desc = m ? m.description : '';
      l.unit = m ? m.unit : '';
      l.needExp = m ? m.requires_expiry === true : false;
    }
    function wkAdd(copyCode) {
      const prev = wkLines.value[wkLines.value.length - 1];
      const l = wkBlank(copyCode ? prev : null);
      if (copyCode && prev) { wkFill(l); }
      wkLines.value.push(l);
    }

    /** กรอก PO แล้วดึง P/N กับยอดสั่งจากรายการ PO ที่นำเข้าไว้ */
    function wkPo(l) {
      const hit = pos.value.find(p => p.po === l.po);
      l.poFound = l.po ? !!hit : null;
      // นิติบุคคลรายบรรทัด — เอกสารใบเดียวมีของสองโรงงานปนกันได้
      // เก็บที่มาไว้ด้วย เพื่อให้หน้าจอบอกได้ว่าค่าไหนเดามา ค่าไหนมาจากไฟล์ของ Delta
      const r = resolveEntity(l.po, { forced: wkH.entity, poList: pos.value,
                                      current: entity.value });
      l.entity = r.code;
      l.entityFrom = r.from;
      if (!hit) return;
      if (!l.pn) l.pn = hit.pn;
      if (!l.orderQty) l.orderQty = hit.qty;
    }

    // บังคับทั้งใบแล้วต้องมีผลกับทุกบรรทัดทันที ไม่ใช่รอให้ไปแก้ช่อง PO ทีละบรรทัด
    watch(() => wkH.entity, () => wkLines.value.forEach(wkPo));

    /**
     * ดึงรายการจาก Kit List กลุ่มจ่ายรวมที่นำเข้าไว้แล้ว
     * เอกสารจริงเป็น PDF สแกนจึงต้องคีย์มือ แต่ถ้าวันไหนได้ไฟล์ Excel มาด้วย
     * ก็ไม่มีเหตุผลให้คีย์ซ้ำ — ดึงมาแล้วแก้ทับได้เหมือนกัน
     */
    const chemDates = computed(() =>
      [...new Set(kits.value.filter(k => k.src === 'chem').map(k => k.date))]
        .filter(Boolean).sort().reverse());
    const wkPickDate = ref('');

    function wkFromKit() {
      const d = wkPickDate.value || chemDates.value[0];
      const rows = kits.value.filter(k => k.src === 'chem' && (!d || k.date === d));
      if (!rows.length) { flash('ยังไม่มี Kit List กลุ่มจ่ายรวมของวันนั้น', true); return; }
      wkLines.value = rows.map(k => {
        const l = wkBlank(null);
        l.code = String(k.code); l.po = k.po; l.pn = k.pn || '';
        l.orderQty = k.orderQty; l.req = k.req; l.s41 = k.issue;
        l.qty = k.issue;                       // ตั้งไว้ให้ก่อน แก้ทับเป็นยอดนับจริงได้
        l.remark = k.remark || '';
        wkFill(l); wkPo(l);
        return l;
      });
      if (d) wkH.date = d;
      if (!wkH.group && rows[0].group) wkH.group = rows[0].group;
      flash(`ดึงจาก Kit List ${rows.length} บรรทัด — แก้ยอดนับจริงแล้วบันทึกได้เลย`);
    }

    const wkBomOf = l => bomExpect(bom.value, l.pn, l.code, l.orderQty);
    const wkPctOf = l => pctDiff(l, wkBomOf(l));

    const wkCheck = computed(() => checkWeekly(wkLines.value, {
      totals: wkTotals.value, materials: materials.value, entity: entity.value }));

    function wkUseIssued() {
      for (const l of wkLines.value) {
        if (l.qty === null || l.qty === '') l.qty = l.s41;
      }
    }

    async function saveWeekly() {
      const c = wkCheck.value;
      if (!wkH.docNo) { flash('ยังไม่ได้กรอกเลขที่เอกสาร', true); return; }
      if (!wkH.person) { flash('ยังไม่ได้ใส่ชื่อผู้รับ', true); return; }
      if (!c.ready.length) { flash('ยังไม่มีบรรทัดที่กรอกครบ', true); return; }

      // ทุกข้อเตือนแล้วไปต่อได้ — INVARIANTS A4
      if (c.mismatch.length && !confirm(
        `มี ${c.mismatch.length} รหัสที่ยอดรวมไม่ตรงกับเอกสาร\nบันทึกต่อไหม`)) return;
      if (c.unknown.length && !confirm(
        `มี ${c.unknown.length} รหัสที่ยังไม่มีในทะเบียน\nบันทึกต่อไหม`)) return;
      if (c.otherEntities.length && !confirm(
        [`ใบนี้มีบรรทัดของ ${c.otherEntities.join(' · ')} ซึ่งไม่ใช่ ${entity.value} ที่เลือกอยู่`,
         'แต่ละบรรทัดจะถูกบันทึกเข้านิติบุคคลของตัวเอง ยอดไม่ปนกัน',
         `ผลคือบรรทัดพวกนั้นจะไม่โผล่ในหน้ายอดคงคลังของ ${entity.value}`,
         'ต้องสลับนิติบุคคลบนหัวจอถึงจะเห็น',
         '', 'บันทึกต่อไหม'].join('\n'))) return;
      const badExp = c.ready.filter(l => l.needExp && !l.expiry);
      if (badExp.length) { flash(`ต้องกรอกวันหมดอายุอีก ${badExp.length} รายการ`, true); return; }
      if (c.noLot && !confirm(
        [`มี ${c.noLot} บรรทัดที่ยังไม่ใส่เลขล็อต`,
         'ล็อตเก็บได้แค่ตอนรับเข้า ถ้าไม่ใส่ตอนนี้จะตามรอยย้อนกลับไม่ได้ตลอดไป',
         '', 'บันทึกต่อไหม'].join('\n'))) return;

      try {
        const posted = c.ready.map(l => makeEntry({
          // ⚠️ ใช้นิติบุคคลของบรรทัดนั้น ไม่ใช่ตัวที่เลือกอยู่บนหน้าจอ
          // เอกสารใบเดียวมีของสองโรงงานปนกันได้ ถ้าเขียนเป็นตัวเดียวกันหมด
          // ยอดจะข้ามโรงงานกันโดยไม่มีอะไรเตือน และตามแก้ทีหลังแทบไม่ได้
          entity: l.entity || entity.value, kind: 'receive',
          material_code: l.code, qty: Number(l.qty),
          lot: l.lot || '(ไม่ระบุ)',
          doc_kind: 'po', doc_ref: l.po, part_no: l.pn || '',
          at: atFrom(wkH.date), person: wkH.person, device: device.value,
          expiry_date: l.expiry || '',
          reqmt_qty: l.req === null || l.req === '' ? null : Number(l.req),
          issued_qty: l.s41 === null || l.s41 === '' ? null : Number(l.s41),
          note: ['รับรวมรายรอบ ' + wkH.docNo, l.remark].filter(Boolean).join(' · ')
        }));
        await db.put('entries', posted);
        entries.value.push(...posted);
        db.announce('entries');
        flash(`บันทึกรับเข้ารวม ${posted.length} รายการ · เอกสาร ${wkH.docNo}`);
        wkLines.value = []; wkTotals.value = {}; wkH.docNo = '';
      } catch (err) { flash(err.message, true); }
    }

    // ── นำเข้า PO / Kit List ───────────────────────────────────────
    // ไฟล์จาก Delta สามแบบ อ่านด้วยตัวอ่านคนละตัว แต่เข้าท่อเดียวกัน
    const pos = ref([]);
    const kits = ref([]);
    const shorts = ref([]);
    const imp = ref(null);          // ผลอ่านไฟล์ที่รอให้ตรวจก่อนกดนำเข้า
    const impBusy = ref(false);
    const impDrag = ref(false);

    const KIND_LABEL = { po: 'PO รายวัน', kit: 'Kit List (22-H)', chem: 'Kit List กลุ่มจ่ายรวม' };

    /**
     * เดาว่าไฟล์ที่ลากมาเป็นแบบไหน จากเนื้อในไม่ใช่จากชื่อไฟล์
     * ชื่อไฟล์ของจริงตั้งไม่เป็นระบบ (22-H.xls · 4020600700-4020241300.xlsx)
     * และเดาผิดแล้วจะได้ข้อมูลเปล่า ๆ โดยไม่มีอะไรฟ้อง จึงลองอ่านจริงทั้งสามแบบแล้วดูว่าอันไหนได้ของ
     */
    function detectAndParse(wb, XLSX) {
      const aoaOf = name => XLSX.utils.sheet_to_json(wb.Sheets[name],
                              { header: 1, defval: null, blankrows: true });
      const first = aoaOf(wb.SheetNames[0]);

      const chemBook = { sheets: wb.SheetNames.map(n => ({
        name: n,
        hidden: ((wb.Workbook && wb.Workbook.Sheets) || [])
                  .some(s => s.name === n && s.Hidden),
        aoa: aoaOf(n)
      })) };
      const chem = parseKitChem(chemBook);
      if (chem.rows.length) return { kind: 'chem', ...chem };

      const kit = parseKitList(first);
      if (kit.rows.length) return { kind: 'kit', ...kit };

      const po = parsePoFile(first);
      if (po.pos.length) return { kind: 'po', ...po };

      return { kind: '', rows: [], pos: [] };
    }

    async function readImpFile(file) {
      impBusy.value = true;
      try {
        await loadLib('lib/xlsx.full.min.js', 'XLSX');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const p = detectAndParse(wb, XLSX);
        if (!p.kind) throw new Error('อ่านไม่ออกว่าเป็นไฟล์แบบไหน — ไม่เจอทั้งแถว PO และบรรทัด Kit List');
        const rows = p.kind === 'po' ? p.pos : p.rows;
        const plan = p.kind === 'po'
          ? { total: p.pos.length, fresh: p.pos.filter(x => !pos.value.some(y => y.id === x.id)),
              dup: 0, pos: p.pos.map(x => x.po), noPo: [], codeNew: [], totalIssue: 0 }
          : importPlanKit(rows, { existing: kits.value, materials: materials.value,
                                  poList: pos.value });
        if (p.kind === 'po') plan.dup = p.pos.length - plan.fresh.length;
        imp.value = { fileName: file.name, ...p, plan,
                      freshShorts: (p.shorts || []).filter(s => !shorts.value.some(x => x.id === s.id)) };
      } catch (err) {
        flash('อ่านไฟล์ไม่สำเร็จ: ' + err.message, true);
        imp.value = null;
      } finally { impBusy.value = false; }
    }

    const onDropImp = e => { impDrag.value = false;
      if (e.dataTransfer.files[0]) readImpFile(e.dataTransfer.files[0]); };
    const onPickImp = e => { if (e.target.files[0]) readImpFile(e.target.files[0]); e.target.value = ''; };

    async function applyImp() {
      const p = imp.value;
      if (!p) return;
      impBusy.value = true;
      try {
        if (p.kind === 'po') {
          await db.put('pos', p.plan.fresh.map(plain));
          pos.value.push(...p.plan.fresh);
          if (p.freshShorts.length) {
            await db.put('shorts', p.freshShorts.map(plain));
            shorts.value.push(...p.freshShorts);
          }
          flash(`นำเข้า PO ${p.plan.fresh.length} รายการ · ของขาด ${p.freshShorts.length} รายการ`);
        } else {
          await db.put('kits', p.plan.fresh.map(plain));
          kits.value.push(...p.plan.fresh);
          flash(`นำเข้า ${KIND_LABEL[p.kind]} ${p.plan.fresh.length} รายการ · ${p.plan.pos.length} PO`);
        }
        imp.value = null;
      } catch (err) { flash(err.message, true); }
      finally { impBusy.value = false; }
    }

    const openShorts = computed(() => shorts.value.filter(s => !s.done));
    const poToday = computed(() => {
      const d = todayLocal();
      return pos.value.filter(p => p.date === d);
    });
    const recentPos = computed(() =>
      [...pos.value].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40));

    async function toggleShort(s) {
      const rec = { ...plain(s), done: !s.done };
      await db.put('shorts', rec);
      const i = shorts.value.findIndex(x => x.id === s.id);
      shorts.value.splice(i, 1, rec);
    }

    // ── หน้าแรก ────────────────────────────────────────────────────
    // เป็นรายการงานของวันนี้ ไม่ใช่แค่ตัวเลขสวย ๆ
    // พนักงานเปิดมาแล้วต้องรู้ทันทีว่าวันนี้เหลืออะไรที่ยังไม่ได้ทำ
    const homeToday = computed(() => todayLocal());

    const homePoToday = computed(() =>
      pos.value.filter(p => p.date === homeToday.value));

    const homeKitToday = computed(() =>
      kits.value.some(k => k.src !== 'chem' && k.date === homeToday.value));

    /** PO ของวันนี้ที่คีย์รับเข้าไปแล้วอย่างน้อยหนึ่งบรรทัด */
    const homePoKeyed = computed(() => {
      const keyed = new Set(entries.value
        .filter(e => e.entity === entity.value && alive(e) && e.kind === 'receive' && e.doc_ref)
        .map(e => String(e.doc_ref)));
      return homePoToday.value.filter(p => keyed.has(String(p.po))).length;
    });

    const homeCountToday = kind => entries.value.filter(e =>
      e.entity === entity.value && alive(e) && e.kind === kind
      && localDate(e.at) === homeToday.value).length;

    const homeIn = computed(() => homeCountToday('receive'));
    const homeOut = computed(() => homeCountToday('issue'));

    /** สิ่งที่ค้างอยู่ทั้งระบบ — เรียงตามความเร่งด่วนของงานหน้าคลัง */
    const homeTasks = computed(() => [
      { k: 'po', label: 'นำเข้าไฟล์ PO ของวันนี้', tab: 'po',
        done: homePoToday.value.length > 0,
        detail: homePoToday.value.length
          ? `พบ ${homePoToday.value.length} PO ของวันนี้แล้ว` : 'ยังไม่พบไฟล์ PO ของวันนี้' },
      { k: 'kit', label: 'นำเข้า Kit List (22-H)', tab: 'po',
        done: homeKitToday.value,
        detail: homeKitToday.value ? 'นำเข้าของวันนี้แล้ว' : 'ยังไม่พบ Kit List ของวันนี้' },
      { k: 'in', label: 'คีย์รับเข้า', tab: 'in',
        done: homePoToday.value.length > 0 && homePoKeyed.value >= homePoToday.value.length,
        detail: homePoToday.value.length
          ? `คีย์แล้ว ${homePoKeyed.value} จาก ${homePoToday.value.length} PO ของวันนี้`
          : `วันนี้คีย์รับเข้าไป ${homeIn.value} รายการ` },
      { k: 'out', label: 'คีย์จ่ายออก', tab: 'out',
        done: homeOut.value > 0,
        detail: `วันนี้จ่ายออกไป ${homeOut.value} รายการ` },
      { k: 'wk', label: 'รับเข้ารวมรายรอบ', tab: 'wk',
        done: null,
        detail: chemDates.value.length
          ? `Kit List กลุ่มจ่ายรวมล่าสุด ${chemDates.value[0]}` : 'ยังไม่มี Kit List กลุ่มจ่ายรวม' }
    ]);

    /** เรื่องที่ต้องตามแก้ — ตัวเลขที่ไม่ควรค้างไว้นาน */
    const homeAlerts = computed(() => [
      { n: openShorts.value.length, label: 'ของขาด / รอส่ง', tab: 'po', bad: false },
      { n: oddRows.value.length, label: 'รายการที่ควรไปดู', tab: 'bal', bad: true },
      { n: needReview.value, label: 'รหัสรอตรวจในทะเบียน', tab: 'mat', bad: false },
      { n: bomUnknownCodes.value.length, label: 'รหัสใน BOM ที่ยังไม่มีในทะเบียน', tab: 'bom', bad: false },
      { n: pending.value.total, label: 'รายการที่ยังไม่ได้ซิงค์', tab: 'sync', bad: false }
    ].filter(x => x.n > 0));

    // ── ซิงค์ขึ้น Google Sheets ────────────────────────────────────
    // ตรรกะการรวมข้อมูลอยู่ใน core/sync.js ที่นี่มีแค่การยิงเน็ตและต่อสายเข้าหน้าจอ
    const sync = reactive({ url: '', token: '', auto: true,
                            state: 'idle', error: '', lastOkAt: '',
                            since: {},
                            needDeploy: false, msg: '' });
    let syncing = false;

    /**
     * ถอดความเป็น reactive ออกก่อนเขียนลงฐานข้อมูล
     *
     * Vue ห่ออ็อบเจกต์ในหน้าจอไว้ด้วย Proxy ซึ่ง IndexedDB โคลนไม่ได้
     * ถ้าส่งตรง ๆ จะได้ "could not be cloned" ตอนซิงค์ ซึ่งอ่านแล้วไม่รู้เลยว่าเกิดจากอะไร
     * แถวพวกนี้เป็นข้อมูลแบนล้วน ไม่มีฟังก์ชันและไม่มีวันที่ การแปลงผ่าน JSON จึงปลอดภัย
     */
    const plain = r => JSON.parse(JSON.stringify(r));

    const syncStore = computed(() => ({
      entries: entries.value, materials: materials.value, bom: bom.value
    }));
    const pending = computed(() => syncPlan(syncStore.value));

    const fromLink = ref(false);
    const linkCopied = ref('');

    /**
     * ลิงก์สำหรับแจกให้เครื่องอื่น
     * ⚠️ มีรหัสผ่านอยู่ในลิงก์ ส่งในไลน์กลุ่มของทีมได้ แต่อย่าเอาไปโพสต์ที่สาธารณะ
     */
    const shareLink = computed(() => {
      if (!sync.url) return '';
      const p = new URLSearchParams();
      p.set('url', sync.url);
      if (sync.token) p.set('token', sync.token);
      if (entity.value) p.set('entity', entity.value);
      return location.origin + location.pathname + '#' + p.toString();
    });

    async function copyShareLink() {
      if (!shareLink.value) return;
      try {
        await navigator.clipboard.writeText(shareLink.value);
        linkCopied.value = 'คัดลอกแล้ว — เอาไปเปิดในเครื่องอื่นได้เลย';
      } catch {
        // บางเบราว์เซอร์ห้ามคัดลอกถ้าไม่ได้กดเอง — โชว์ให้ลากคลุมเอง
        linkCopied.value = 'คัดลอกอัตโนมัติไม่ได้ — ลากคลุมข้อความข้างล่างแล้วก๊อปเอง';
      }
      setTimeout(() => { linkCopied.value = ''; }, 6000);
    }

    /**
     * เก็บค่าตั้งค่าซิงค์ลงเครื่อง
     *
     * ⚠️ ต้องถอด reactive ออกก่อน — sync.since เป็น Proxy ซึ่ง IndexedDB โคลนไม่ได้
     * เคยพลาดตรงนี้แล้วเงียบสนิท เพราะ .catch() กลืน error ทิ้ง
     * ผลคือกรอก URL แล้วดูเหมือนติด แต่พอปิดเปิดโปรแกรมใหม่ค่าหายหมด
     * ตอนนี้ถ้าเซฟไม่ได้ต้องบอกให้เห็น ไม่ใช่กลืนแล้วปล่อยให้คนคิดว่าเรียบร้อย
     */
    const saveSyncCfg = () => db.setMeta('sync', {
      url: sync.url, token: sync.token, auto: sync.auto, since: sync.since
    }).catch(err => flash('เก็บค่าตั้งค่าไม่สำเร็จ: ' + err.message, true));

    /**
     * ยิงคำสั่งไปที่ Apps Script
     *
     * ⚠️ สองบรรทัดนี้ห้ามแก้ ทั้งคู่มาจากการชนกำแพงจริงใน v1
     *   text/plain  — ถ้าใส่ application/json เบราว์เซอร์จะยิง preflight ก่อน
     *                 ซึ่ง Apps Script ไม่ตอบ แล้วจะได้ CORS error ที่หาสาเหตุยากมาก
     *   redirect    — Apps Script ตอบ 302 ไปโดเมน googleusercontent เสมอ ต้องตามต่อ
     */
    async function api(action, body = {}) {
      if (!sync.url) throw new Error('ยังไม่ได้ใส่ URL ของ Apps Script');
      const res = await fetch(sync.url, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: sync.token, device: device.value, ...body })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || 'เซิร์ฟเวอร์ตอบกลับผิดพลาด');
      return d;
    }

    async function testConnection() {
      sync.state = 'busy'; sync.error = ''; sync.msg = '';
      try {
        const d = await api('ping');
        sync.state = 'ok';
        sync.msg = `ต่อได้ · ${d.spreadsheet} · `
                 + Object.entries(d.counts || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
      } catch (err) { sync.state = 'error'; sync.error = err.message; }
    }

    /**
     * ตารางในเครื่องกับกล่องข้อมูลของมัน — ชื่อชีตอยู่ใน TABLES แล้ว
     *
     * ⚠️ เพิ่มตารางใน TABLES เมื่อไหร่ ต้องมาเพิ่มที่นี่ด้วยเสมอ
     * ลืม entities มารอบหนึ่งแล้ว ซิงค์วิ่งไปหกตารางแล้วพังที่ตารางที่เจ็ด
     * ด้วยข้อความที่ไม่บอกว่าตารางไหน — ตอนนี้ missingTables() จะฟ้องตั้งแต่เปิดโปรแกรม
     */
    const LIST_OF = { entries, materials, bom, pos, kits, shorts, entities };
    const listOf = t => {
      const l = LIST_OF[t];
      if (!l) throw new Error(`ตาราง ${t} ยังไม่ได้ต่อสายกับข้อมูลในเครื่อง — เป็นบั๊กของโปรแกรม ไม่ใช่การตั้งค่า`);
      return l;
    };

    // ตรวจตั้งแต่เปิดโปรแกรม ไม่ต้องรอให้คนกดซิงค์แล้วเจอ error ที่อ่านไม่รู้เรื่อง
    const wiringGap = missingTables(LIST_OF);
    if (wiringGap.length) console.error('ตารางที่ประกาศไว้แต่ยังไม่ได้ต่อสาย:', wiringGap);

    async function syncNow(silent = false) {
      if (!sync.url || syncing) return;
      syncing = true; sync.state = 'busy'; sync.error = ''; sync.needDeploy = false;
      let up = 0, down = 0;
      try {
        for (const t of Object.keys(TABLES)) {
          const key = TABLES[t].key;
          const list = listOf(t);

          // ── ส่งขึ้นก่อน ──
          // ส่งก่อนดึงเสมอ เพื่อให้ของที่เครื่องนี้เพิ่งคีย์ไปถึงเซิร์ฟเวอร์
          // ก่อนที่จะเอาของฝั่งโน้นมาทับ
          const waiting = dirtyRows(list.value);
          for (const part of chunk(waiting, 300)) {
            sync.msg = `กำลังส่ง ${TABLES[t].label} ${up + part.length}/${waiting.length}...`;
            const res = await api('pushTable', { table: TABLES[t].sheet, rows: part.map(toWire) });
            // เอาเวลาของเซิร์ฟเวอร์มาใช้ ไม่ใช่เวลาเครื่อง — ดูเหตุผลใน core/sync.js
            const stamped = markSynced(part, res.serverTime);
            stamped.forEach((r, i) => { part[i].dirty = false; part[i].updated_at = r.updated_at; });
            await db.put(t, stamped.map(plain), { synced: true });
            up += part.length;
          }

          // ── แล้วค่อยดึงลง ──
          sync.msg = `กำลังดึง ${TABLES[t].label}...`;
          const d = await api('pullTable', { table: TABLES[t].sheet, since: sync.since[t] || '' });
          const m = mergeIncoming(list.value, d.rows || [], key);
          if (m.added.length) {
            await db.put(t, m.added.map(plain), { synced: true });
            list.value.push(...m.added);
          }
          for (const r of m.updated) {
            const i = list.value.findIndex(x => String(x[key]) === String(r[key]));
            if (i >= 0) list.value.splice(i, 1, r);
          }
          if (m.updated.length) await db.put(t, m.updated.map(plain), { synced: true });
          sync.since[t] = d.serverTime;
          down += m.changed;
        }
        sync.lastOkAt = new Date().toISOString();
        sync.state = 'ok';
        sync.msg = `ส่งขึ้น ${up} · รับมา ${down}`;
        saveSyncCfg();
        if (!silent) flash(`ซิงค์แล้ว · ส่งขึ้น ${up} · รับมา ${down}`);
      } catch (err) {
        sync.state = 'error';
        sync.error = err.message;
        sync.msg = '';
        // เซิร์ฟเวอร์ยังเป็นสคริปต์รุ่นเก่า ต้องบอกให้ชัดว่าให้ไปกดอะไร
        // ไม่ใช่ปล่อยให้เห็นข้อความดิบแล้วเดาเอาเองว่าพังตรงไหน
        if (looksLikeOldScript(err.message)) sync.needDeploy = true;
        if (!silent) flash('ซิงค์ไม่สำเร็จ: ' + err.message, true);
      } finally { syncing = false; }
    }

    /**
     * ส่งขึ้นใหม่ทั้งหมด — ติดธงทุกแถวว่ายังไม่ได้ส่ง แล้วซิงค์
     *
     * มีไว้สำหรับกรณีที่ธงหายไปโดยที่ข้อมูลยังอยู่ เช่น
     *   ตารางเพิ่งถูกเพิ่มเข้าระบบซิงค์ทีหลัง แถวเก่าจึงไม่เคยมีธงมาก่อน
     *   หรือเคยกดล้างข้อมูลบนเซิร์ฟเวอร์แล้วอยากอัปใหม่จากเครื่องนี้
     * ไม่มีอะไรถูกลบ ฝั่งเซิร์ฟเวอร์ upsert ทับของเดิมด้วยกุญแจเดียวกัน
     */
    async function pushAll() {
      if (!confirm(['จะส่งข้อมูลทั้งหมดในเครื่องนี้ขึ้นเซิร์ฟเวอร์อีกครั้ง',
                    'ของบนเซิร์ฟเวอร์ที่มีกุญแจเดียวกันจะถูกทับด้วยของในเครื่องนี้',
                    '', 'ทำต่อไหม'].join('\n'))) return;
      for (const t of Object.keys(TABLES)) {
        const list = listOf(t).value;
        for (const r of list) r.dirty = true;
        if (list.length) await db.put(t, list.map(plain));
      }
      await syncNow(false);
    }

    /** ดึงใหม่ทั้งหมดตั้งแต่ต้น — ใช้ตอนสงสัยว่าเครื่องนี้ตกอะไรไป */
    async function resync() {
      if (!confirm('จะดึงข้อมูลใหม่ทั้งหมดจากเซิร์ฟเวอร์\n'
        + 'ของที่ยังไม่ได้ส่งขึ้นจะไม่ถูกทับ และไม่มีอะไรถูกลบ\n\nทำต่อไหม')) return;
      sync.since = {};
      await syncNow(false);
    }

    // ซิงค์อัตโนมัติเมื่อว่าง — เน็ตโรงงานหลุดบ่อย จึงต้องลองใหม่เรื่อย ๆ เอง
    // ไม่ใช่รอให้พนักงานนึกได้ว่าต้องกดปุ่ม
    setInterval(() => { if (sync.auto && sync.url && !syncing) syncNow(true); }, 120000);
    window.addEventListener('online', () => { if (sync.auto && sync.url) syncNow(true); });

    // ── ออกไฟล์ Bin Card ───────────────────────────────────────────
    // ไฟล์ที่ออกไปมีคนรับต่อ ฟอร์มจึงต้องเหมือน v1 ทุกช่อง — ดู export/bincard.js
    const expBusy = ref(false);
    const expMsg = ref('');
    const store = ref('');

    /**
     * โหลดไลบรารีตอนกดออกไฟล์เท่านั้น
     * ExcelJS กับ JSZip หนักรวมเกือบ 1 MB ถ้าโหลดตั้งแต่เปิดโปรแกรม
     * เครื่องในโรงงานจะรอทุกเช้า ทั้งที่บางวันไม่มีใครกดออกไฟล์เลยสักครั้ง
     */
    function loadLib(src, globalName) {
      if (globalThis[globalName]) return Promise.resolve();
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => globalThis[globalName] ? res()
          : rej(new Error(`โหลด ${src} แล้วแต่ไม่เจอ ${globalName}`));
        s.onerror = () => rej(new Error(`โหลด ${src} ไม่สำเร็จ — ไฟล์อยู่ในเครื่องไม่ได้ใช้เน็ต `
                                      + 'ลองรีเฟรชหน้า ถ้ายังไม่ได้แปลว่าไฟล์ในโฟลเดอร์ lib หาย'));
        document.head.appendChild(s);
      });
    }

    const saveBlob = (blob, name) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };

    const cardInfo = code => {
      const m = matOf(code) || {};
      // store location ผูกกับนิติบุคคล ถ้ายังไม่ได้ตั้งค่อยตกมาที่ค่ารวมของเครื่อง
      return { code, description: m.description || '', unit: m.unit || '',
               store: (entInfo.value && entInfo.value.store_location) || store.value,
               entity: entity.value };
    };

    /** ออกการ์ดใบเดียวจากหน้าที่เปิดดูอยู่ */
    async function exportOneCard() {
      if (!card.value.length) { flash('รหัสนี้ยังไม่มีรายการเคลื่อนไหว', true); return; }
      expBusy.value = true;
      try {
        await loadLib('lib/exceljs.min.js', 'ExcelJS');
        const info = cardInfo(cardCode.value);
        // card เรียงใหม่สุดขึ้นก่อนเพื่อดูบนจอ แต่เอกสารต้องเรียงเก่าไปใหม่
        const rows = toCardLines([...card.value].reverse(), info.unit);
        const wb = new ExcelJS.Workbook();
        wb.creator = 'ระบบ Bin Card';
        const nm = sheetNameFor(cardCode.value);
        wb.addWorksheet(nm);
        writeCard(wb.getWorksheet(nm), info, rows);
        const buf = await wb.xlsx.writeBuffer();
        saveBlob(new Blob([buf], { type: 'application/octet-stream' }),
                 `BinCard_${cardCode.value}_${todayLocal()}.xlsx`);
        flash('เซฟการ์ดเรียบร้อย');
      } catch (err) { flash('ออกไฟล์ไม่สำเร็จ: ' + err.message, true); }
      finally { expBusy.value = false; }
    }

    /** รหัสที่มีรายการเคลื่อนไหว แยกตามหมวด — ใช้บอกล่วงหน้าว่าจะได้กี่ไฟล์กี่การ์ด */
    const cardPlan = computed(() => {
      const byCat = new Map();
      let cards = 0, lines = 0;
      if (!entity.value) return { cards, lines, byCat };
      const seen = new Map();
      for (const e of entries.value) {
        if (e.entity !== entity.value || !alive(e)) continue;
        const c = normCode(e.material_code);
        seen.set(c, (seen.get(c) || 0) + 1);
      }
      for (const [c, n] of seen) {
        const cat = safeFileName((matOf(c) || {}).category || 'OTHER');
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(c);
        cards++; lines += n;
      }
      for (const list of byCat.values()) list.sort();
      return { cards, lines, byCat };
    });

    /** ออกการ์ดทุกรหัส — หนึ่งหมวดหนึ่งไฟล์ รวมเป็นซิปเดียว เหมือน v1 */
    async function exportAllCards() {
      const plan = cardPlan.value;
      if (!plan.cards) { flash('ยังไม่มีรายการเคลื่อนไหวให้ออกการ์ด', true); return; }
      expBusy.value = true;
      expMsg.value = 'กำลังโหลดตัวเขียนไฟล์...';
      try {
        await loadLib('lib/exceljs.min.js', 'ExcelJS');
        await loadLib('lib/jszip.min.js', 'JSZip');
        const zip = new JSZip();
        let done = 0;
        for (const [cat, codes] of plan.byCat) {
          const wb = new ExcelJS.Workbook();
          wb.creator = 'ระบบ Bin Card';
          for (const code of codes) {
            const info = cardInfo(code);
            const rows = toCardLines(cardRows(entries.value, entity.value, code), info.unit);
            const nm = sheetNameFor(code);
            wb.addWorksheet(nm);
            writeCard(wb.getWorksheet(nm), info, rows);
            done++;
            if (done % 20 === 0) {
              expMsg.value = `กำลังสร้าง ${done} / ${plan.cards} การ์ด...`;
              await new Promise(r => setTimeout(r, 0));   // ปล่อยให้หน้าจอขยับ
            }
          }
          zip.file(`${cat}.xlsx`, await wb.xlsx.writeBuffer());
        }
        expMsg.value = 'กำลังบีบไฟล์...';
        saveBlob(await zip.generateAsync({ type: 'blob' }),
                 `BinCard_${entity.value}_${todayLocal()}.zip`);
        expMsg.value = `เสร็จแล้ว · ${plan.cards} การ์ด · ${plan.lines} บรรทัด · ${plan.byCat.size} ไฟล์`;
        flash('ออก Bin Card เรียบร้อย');
      } catch (err) {
        expMsg.value = 'ผิดพลาด: ' + err.message;
        flash('ออกไฟล์ไม่สำเร็จ: ' + err.message, true);
      } finally { expBusy.value = false; }
    }

    const saveStore = () => db.setMeta('store', store.value)
      .catch(err => flash('เก็บค่าไม่สำเร็จ: ' + err.message, true));

    function openCard(code) { cardCode.value = String(code); traceOf.value = ''; tab.value = 'bal'; }
    function closeCard() { cardCode.value = ''; traceOf.value = ''; }
    function goIssue(code) {
      const l = outBlank(String(code));
      fillOutLine(l);
      outLines.value.push(l);
      outHint.value = 'เพิ่ม ' + code + ' เข้าใบเบิกแล้ว';
      tab.value = 'out';
    }

    return { APP_VERSION, TABS, GROUPS, openGroup, CATEGORIES, SHOW_MAX, STATUS,
             ready, bootMsg, bootError, tab, entity,
             materials, entries, bom, q, fCat, fState, edit, toast,
             activeCount, needReview, shown, codeCheck, dupOf,
             startAdd, startEdit, saveEdit, approve,
             bomDocs, bomPlan, bomBusy, dragOver, bomSum, bomPns, missingPack,
             bomUnknownCodes, bomUnconfirmed, onDropBom, onPickBom, applyBom,
             regPlan, regDraft, regBusy, regTake, openRegPlan, applyRegPlan,
             inc, incBusy, incDrag, incPick, incOpen, incPicked, incPickedLines,
             incFlagsOf, onDropInc, onPickInc, incPickAll, applyIncome,
             incRegUsed, incRegAll, applyIncomeRegistry,
             bomPn, bomEdit, bomBy, bomRowsOfPn, openBomPn, startBomRow, onBomCode,
             saveBomRow, deleteBomRow, bomManualHit,
             counts, cs, csBusy, csNew, csRefText, csRef, countHistory, csPreview,
             csRows, csFilled, csPlanRows, csSum,
             startCount, saveCount, postCountNow, printSheet,
             pick, pickQ, pickResults, openPick, choosePick,
             inH, inLines, bomHint, bomPnCodes, inReady, inNoLot,
             addInLine, expandBom, fillLine, saveIn, addFromLine,
             outH, outLines, outHint, addOutLine, fillOutLine, expandOut,
             outBalOf, outAfterOf, outSuggestOf, useSuggested,
             outReady, outNegative, saveOut, addFromOutLine,
             balQ, balCat, balZero, balShown, balSum, oddRows,
             cardCode, cardMat, cardBal, card, cardLots, cardVoided, traceOf, trace,
             openCard, closeCard, goIssue,
             expBusy, expMsg, store, saveStore, cardPlan, exportOneCard, exportAllCards, localDate,
             homeTasks, homeAlerts, homeIn, homeOut, homeToday,
             sync, pending, wiringGap, saveSyncCfg, testConnection, syncNow, resync, pushAll, TABLES,
             shareLink, copyShareLink, fromLink, linkCopied,
             entities, entEdit, entCodes, entInfo, entMissing, entCounts,
             switchEntity, startEnt, saveEnt, addMissingEnt,
             wkH, wkLines, wkTotals, wkAdd, wkFill, wkPo, wkFromKit, wkUseIssued,
             wkBomOf, wkPctOf, wkCheck, saveWeekly, chemDates, wkPickDate,
             pos, kits, shorts, imp, impBusy, impDrag, KIND_LABEL, onDropImp, onPickImp,
             applyImp, openShorts, poToday, recentPos, toggleShort,
             MISC, KINDS, mk, mkDef, mkReasons, mkMat, mkUnit, mkBook, mkLots,
             mkDelta, mkAfter, mkReady, onMkCode, saveMisc,
             voidBox, askVoid, doVoid, voidAfterAdjust, reasonLabel, noteCell };
  }
}).mount('#app');
