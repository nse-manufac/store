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
         importPlan } from './master/bom.js';
import { makeSession, sheetRows, planCount, planSummary, postCount, STATUS } from './core/count.js';
import { balances } from './core/balance.js';

const { createApp, ref, reactive, computed, watch } = Vue;

const APP_VERSION = document.querySelector('meta[name="app-version"]').content;
const SHOW_MAX = 300;
const TABS = [
  { k: 'mat',   label: 'ทะเบียนวัตถุดิบ' },
  { k: 'bom',   label: 'BOM' },
  { k: 'count', label: 'นับของ' },
  { k: 'in',    label: 'รับเข้า' },
  { k: 'out',   label: 'จ่ายออก' },
  { k: 'bal',   label: 'ยอดคงคลัง' }
];

createApp({
  setup() {
    const ready = ref(false);
    const bootMsg = ref('กำลังเปิดฐานข้อมูล...');
    const bootError = ref('');
    const tab = ref('mat');
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
        materials.value = data.materials || [];
        entries.value = data.entries || [];
        bom.value = data.bom || [];
        counts.value = data.counts || [];
        entity.value = await db.getMeta('entity', '') || '';
        // ยังไม่มีหน้าตั้งค่า — ตั้งค่าเริ่มต้นไว้ก่อนเพื่อให้หน้าที่ต้องใช้ entity ทำงานได้
        if (!entity.value) { entity.value = 'NSE'; await db.setMeta('entity', 'NSE'); }
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
        materials.value = await db.all('materials');
        entries.value = await db.all('entries');
        bom.value = await db.all('bom');
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

    return { APP_VERSION, TABS, CATEGORIES, SHOW_MAX, STATUS,
             ready, bootMsg, bootError, tab, entity,
             materials, entries, bom, q, fCat, fState, edit, toast,
             activeCount, needReview, shown, codeCheck, dupOf,
             startAdd, startEdit, saveEdit, approve,
             bomDocs, bomPlan, bomBusy, dragOver, bomSum, bomPns, missingPack,
             bomUnknownCodes, bomUnconfirmed, onDropBom, onPickBom, applyBom,
             counts, cs, csBusy, csNew, csRefText, csRef, countHistory, csPreview,
             csRows, csFilled, csPlanRows, csSum,
             startCount, saveCount, postCountNow, printSheet };
  }
}).mount('#app');
