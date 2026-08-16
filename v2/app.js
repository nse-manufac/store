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
         importPlan, registryPlan } from './master/bom.js';
import { makeSession, sheetRows, planCount, planSummary, postCount, STATUS } from './core/count.js';
import { lotsOf, suggestLots, traceLot } from './core/lots.js';
// counts() ของสมุดชื่อชนกับ counts ที่เป็นรอบนับของในไฟล์นี้ จึงเรียกใหม่ว่า alive
import { makeEntry, voidEntry, REASONS, KINDS, counts as alive } from './core/ledger.js';
import { balances, cardRows, oddBalances } from './core/balance.js';
import { localDate, atFrom, todayLocal } from './core/localtime.js';
import { writeCard, toCardLines, sheetNameFor, safeFileName } from './export/bincard.js';

const { createApp, ref, reactive, computed, watch } = Vue;

const APP_VERSION = document.querySelector('meta[name="app-version"]').content;
const SHOW_MAX = 300;
const TABS = [
  { k: 'mat',   label: 'ทะเบียนวัตถุดิบ' },
  { k: 'bom',   label: 'BOM' },
  { k: 'count', label: 'นับของ' },
  { k: 'in',    label: 'รับเข้า' },
  { k: 'out',   label: 'จ่ายออก' },
  { k: 'bal',   label: 'ยอดคงคลัง' },
  // สามชนิดที่เหลือรวมไว้หน้าเดียว เพราะแบบฟอร์มเหมือนกันเกือบหมด
  // และแยกเป็นสามแท็บจะทำให้แถบบนยาวจนหาของไม่เจอบนจอโรงงาน
  { k: 'misc',  label: 'ของเสีย · คืน · ปรับยอด' }
];

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
        store.value = await db.getMeta('store', '') || '';
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
      if (t === out) onOutCode();
      else if (t === mk) onMkCode();
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
      return { k: 'L' + (++lineSeq), code, desc: '', unit: '', reqmt: null,
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

    /** กางสูตรของ P/N นี้ออกมาให้คีย์ */
    function expandBom() {
      if (!inH.pn) return;
      const rows = bom.value.filter(r => r.pn === String(inH.pn));
      if (!rows.length) { bomHint.value = `ยังไม่มีสูตรของ ${inH.pn} ในเครื่อง — คีย์เองได้`; return; }
      const order = Number(inH.order) || 0;
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
          expiry_date: l.expiry || '', reqmt_qty: l.reqmt
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
    const out = reactive({ code: '', qty: null, lot: '', part_no: '', doc_ref: '',
                           date: todayLocal(), person: '', _inferred: false });

    const outKnown = computed(() => !!matOf(out.code));
    const outDesc = computed(() => (matOf(out.code) || {}).description || '');
    const outBal = computed(() =>
      out.code && entity.value ? (bookBalances.value.get(normCode(out.code)) || 0) : 0);
    const outAfter = computed(() => Math.round((outBal.value - (Number(out.qty) || 0)) * 1e5) / 1e5);
    const outLots = computed(() =>
      out.code && entity.value ? lotsOf(entries.value, entity.value, normCode(out.code)) : []);
    const outSuggest = computed(() =>
      out.code && Number(out.qty) > 0 && entity.value
        ? suggestLots(entries.value, entity.value, normCode(out.code), Number(out.qty)) : null);

    function onOutCode() { out.lot = ''; out._inferred = false; }
    function onOutQty() { out._inferred = false; }

    function addFromOut() {
      edit.value = { _new: true, material_code: out.code, description: '', unit: '',
                     category: 'OTHER', requires_expiry: false, active: true };
      tab.value = 'mat';
    }

    async function saveOut() {
      if (!out.person) { flash('ยังไม่ได้ใส่ชื่อผู้เบิก', true); return; }
      // ยอดติดลบเตือนได้ แต่ห้ามบล็อก — INVARIANTS A4
      // ของจริงมีกรณีคีย์รับเข้าย้อนหลัง ถ้าห้ามบันทึกพนักงานจะไปจดใส่กระดาษแล้วลืมคีย์
      if (outAfter.value < 0 &&
          !confirm(`ยอดจะติดลบเป็น ${outAfter.value}\nยืนยันบันทึกไหม`)) return;
      try {
        const e = makeEntry({
          entity: entity.value, kind: 'issue', material_code: out.code, qty: Number(out.qty),
          lot: out.lot, lot_inferred: out._inferred && !!out.lot,
          doc_kind: out.doc_ref ? 'po' : '', doc_ref: out.doc_ref, part_no: out.part_no,
          at: atFrom(out.date),
          person: out.person, device: device.value
        });
        await db.put('entries', e);
        entries.value.push(e);
        db.announce('entries');
        flash(`บันทึกจ่ายออก ${out.qty} ${(matOf(out.code) || {}).unit || ''}`);
        out.code = ''; out.qty = null; out.lot = ''; out._inferred = false;
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
      return { code, description: m.description || '', unit: m.unit || '',
               store: store.value, entity: entity.value };
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

    const saveStore = () => db.setMeta('store', store.value).catch(() => {});

    function openCard(code) { cardCode.value = String(code); traceOf.value = ''; tab.value = 'bal'; }
    function closeCard() { cardCode.value = ''; traceOf.value = ''; }
    function goIssue(code) { out.code = String(code); onOutCode(); tab.value = 'out'; }

    return { APP_VERSION, TABS, CATEGORIES, SHOW_MAX, STATUS,
             ready, bootMsg, bootError, tab, entity,
             materials, entries, bom, q, fCat, fState, edit, toast,
             activeCount, needReview, shown, codeCheck, dupOf,
             startAdd, startEdit, saveEdit, approve,
             bomDocs, bomPlan, bomBusy, dragOver, bomSum, bomPns, missingPack,
             bomUnknownCodes, bomUnconfirmed, onDropBom, onPickBom, applyBom,
             regPlan, regDraft, regBusy, regTake, openRegPlan, applyRegPlan,
             counts, cs, csBusy, csNew, csRefText, csRef, countHistory, csPreview,
             csRows, csFilled, csPlanRows, csSum,
             startCount, saveCount, postCountNow, printSheet,
             pick, pickQ, pickResults, openPick, choosePick,
             inH, inLines, bomHint, bomPnCodes, inReady, inNoLot,
             addInLine, expandBom, fillLine, saveIn, addFromLine,
             out, outKnown, outDesc, outBal, outAfter, outLots, outSuggest,
             onOutCode, onOutQty, saveOut, addFromOut,
             balQ, balCat, balZero, balShown, balSum, oddRows,
             cardCode, cardMat, cardBal, card, cardLots, cardVoided, traceOf, trace,
             openCard, closeCard, goIssue,
             expBusy, expMsg, store, saveStore, cardPlan, exportOneCard, exportAllCards, localDate,
             MISC, KINDS, mk, mkDef, mkReasons, mkMat, mkUnit, mkBook, mkLots,
             mkDelta, mkAfter, mkReady, onMkCode, saveMisc,
             voidBox, askVoid, doVoid, voidAfterAdjust, reasonLabel, noteCell };
  }
}).mount('#app');
