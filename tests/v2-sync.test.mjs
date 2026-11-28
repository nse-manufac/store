/**
 * เทสตรรกะการซิงค์ — รันด้วย node
 *   node tests/v2-sync.test.mjs
 *
 * หมวด B สำคัญที่สุด — ถ้ารวมข้อมูลผิด งานที่พนักงานเพิ่งคีย์จะหายเงียบ ๆ ตอนเน็ตกลับมา
 * ซึ่งเป็นความเสียหายที่ไม่มีใครเห็นจนกว่าจะมีคนทักว่ายอดไม่ตรง
 */
import fs from 'node:fs';
import { TABLES, asText, asBool, asNum, dirtyRows, mergeIncoming, markSynced, settlePushed,
         chunk, toWire, syncPlan, looksLikeOldScript, normKeys, normKeysAll,
         KEY_COLS, missingTables, normalizeScriptUrl, syncBadge,
         syncTick, dirtyTables, sinceBySheet, askPlan, FULL_MS, FULL_MS_OLD } from '../v2/core/sync.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. ค่าที่ Google Sheets คืนกลับมามีหลายชนิด ===');
ok('รหัสที่ชีตแปลงเป็นตัวเลข ต้องกลับมาเป็นข้อความ', asText(4010600100) === '4010600100');
ok('เวลาที่ชีตแปลงเป็น Date ต้องกลับมาเป็น ISO',
   asText(new Date('2026-08-16T02:00:00.000Z')) === '2026-08-16T02:00:00.000Z');
ok('ค่าว่างไม่กลายเป็น "null" หรือ "undefined"',
   asText(null) === '' && asText(undefined) === '');
ok('TRUE จากชีตเป็นข้อความ แปลงเป็น boolean ได้', asBool('TRUE') && asBool(true));
ok('FALSE และค่าว่างเป็นเท็จ', !asBool('FALSE') && !asBool('') && !asBool(null));
ok('ตัวเลขว่างเป็น null ไม่ใช่ 0 — ศูนย์กับไม่มีค่าคนละเรื่อง',
   asNum('') === null && asNum(0) === 0);

console.log('\n=== B. รวมข้อมูลที่ดึงมา ===');
const local = [
  { id: 'A', qty: 1, updated_at: '2026-08-16T01:00:00.000Z', dirty: false },
  { id: 'B', qty: 2, updated_at: '2026-08-16T01:00:00.000Z', dirty: true },
  { id: 'C', qty: 3, updated_at: '2026-08-16T05:00:00.000Z', dirty: false }
];
const m = mergeIncoming(local, [
  { id: 'A', qty: 9, updated_at: '2026-08-16T02:00:00.000Z' },   // ใหม่กว่า ต้องชนะ
  { id: 'B', qty: 9, updated_at: '2026-08-16T09:00:00.000Z' },   // ใหม่กว่าแต่ของเรายังไม่ได้ส่ง
  { id: 'C', qty: 9, updated_at: '2026-08-16T03:00:00.000Z' },   // เก่ากว่า ต้องแพ้
  { id: 'D', qty: 4, updated_at: '2026-08-16T04:00:00.000Z' }    // ยังไม่มีในเครื่อง
]);
ok('แถวใหม่ถูกเพิ่ม', m.added.length === 1 && m.added[0].id === 'D');
ok('แถวที่ฝั่งโน้นใหม่กว่าถูกอัปเดต',
   m.updated.length === 1 && m.updated[0].id === 'A' && m.updated[0].qty === 9);
ok('แถวที่ฝั่งโน้นเก่ากว่าไม่ถูกแตะ', !m.updated.some(r => r.id === 'C'));
// ข้อนี้คือข้อที่ถ้าพลาด งานที่เพิ่งคีย์จะหาย
ok('แถวที่เรายังส่งไม่สำเร็จ ห้ามถูกทับแม้ฝั่งโน้นจะใหม่กว่า',
   !m.updated.some(r => r.id === 'B') && m.heldBack === 1);
ok('ของที่รับมาไม่ติดธง dirty', m.added.concat(m.updated).every(r => r.dirty === false));
ok('แถวที่รับมาเก็บฟิลด์เดิมที่ฝั่งโน้นไม่มีไว้ด้วย',
   mergeIncoming([{ id: 'X', keep: 1, updated_at: 'a', dirty: false }],
                 [{ id: 'X', add: 2, updated_at: 'b' }]).updated[0].keep === 1);
ok('แถวที่ไม่มีกุญแจถูกข้าม ไม่ใช่เข้ามาเป็นแถวเปล่า',
   mergeIncoming([], [{ updated_at: 'z' }]).changed === 0);

// ทะเบียนใช้ material_code เป็นกุญแจ ไม่ใช่ id
const mm = mergeIncoming([{ material_code: '401', description: 'เดิม', updated_at: '1', dirty: false }],
                         [{ material_code: 401, description: 'ใหม่', updated_at: '2' }], 'material_code');
ok('ตารางที่ใช้กุญแจอื่นก็รวมได้ และเทียบกุญแจแบบข้อความ',
   mm.updated.length === 1 && mm.updated[0].description === 'ใหม่', JSON.stringify(mm));

console.log('\n=== C. หลังส่งขึ้นสำเร็จ ===');
const sent = markSynced([{ id: 'A', updated_at: '2099-01-01T00:00:00.000Z', dirty: true }],
                        '2026-08-16T02:00:00.000Z');
ok('ธง dirty ถูกปิด', sent[0].dirty === false);
// นาฬิกาเครื่องเดินเร็วกว่าเซิร์ฟเวอร์ = การแก้จากเครื่องอื่นจะถูกมองข้ามตลอดไป
ok('เวลาถูกเขียนทับด้วยเวลาของเซิร์ฟเวอร์ แม้เวลาเครื่องจะใหม่กว่า',
   sent[0].updated_at === '2026-08-16T02:00:00.000Z');
ok('ถ้าเซิร์ฟเวอร์ไม่ส่งเวลามา ก็คงของเดิมไว้ ไม่ล้างทิ้ง',
   markSynced([{ id: 'A', updated_at: 'x', dirty: true }], '')[0].updated_at === 'x');

// ระหว่างรอเซิร์ฟเวอร์ตอบ พนักงานแก้แถวเดิมได้ — ห้ามปิดธงหรือเขียนสำเนาตอนส่งทับ (ตรวจทั้งโปรแกรม 14 พ.ย. 2026)
{
  const T = '2026-11-15T03:00:00.000Z';
  const a = { id: 'A', qty: 1, updated_at: 't0', dirty: true };
  const b = { id: 'B', qty: 2, voided: false, updated_at: 't0', dirty: true };
  const c = { id: 'C', date: '', updated_at: 't0', dirty: true };
  const list = [a, b, c], part = [a, b, c];
  const sentJson = part.map(r => JSON.stringify(toWire(r)));
  // ระหว่างรอ: B ถูกยกเลิก (แทนด้วยอ็อบเจกต์ใหม่แบบ doVoid) · C ถูกเติมวันที่ในตัว (แบบ fillPoDate)
  const bVoid = { ...b, voided: true, void_reason: 'คีย์ผิด', updated_at: 't1', dirty: true };
  list.splice(1, 1, bVoid);
  c.date = '2026-11-01'; c.dirty = true;
  const r = settlePushed(list, part, sentJson, T);
  ok('แถวที่ไม่ถูกแตะระหว่างส่ง ปิดธงและได้เวลาเซิร์ฟเวอร์',
     r.done.length === 1 && r.done[0] === a && a.dirty === false && a.updated_at === T, JSON.stringify(r.done));
  ok('แถวที่ถูกยกเลิกระหว่างส่ง ไม่ถูกคืนให้เขียนทับ — การยกเลิกยังรอส่งอยู่',
     !r.done.includes(b) && bVoid.dirty === true && bVoid.voided === true && list[1] === bVoid);
  ok('แถวที่ถูกแก้ในตัวระหว่างส่ง คงธงไว้ รอบหน้าส่งของใหม่ขึ้นไป',
     r.kept.includes(c) && c.dirty === true && c.updated_at === 't0');
  ok('แถวที่หายไปจากรายการ (โหลดใหม่ระหว่างส่ง) ไม่ปิดธงแบบเดา',
     settlePushed([], [{ id: 'Z', dirty: true }], ['{"id":"Z"}'], T).done.length === 0);
  ok('ตารางที่ใช้กุญแจอื่น (ทะเบียน = material_code) ก็จับคู่ได้',
     (() => { const m1 = { material_code: '9900000001', dirty: true };
              return settlePushed([m1], [m1], [JSON.stringify(toWire(m1))], T, 'material_code').done.length === 1; })());
  const appSrc = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  ok('syncNow ใช้ settlePushed — ไม่ปิดธงทั้งก้อนแล้วเขียนสำเนาทับแบบเดิม',
     appSrc.includes('settlePushed(list.value, part, sentJson, res.serverTime, key)')
     && !appSrc.includes('markSynced(part'));
}

console.log('\n=== D. เตรียมส่ง ===');
const store = {
  entries: [{ id: '1', dirty: true }, { id: '2', dirty: false }, { id: '3', dirty: true }],
  materials: [{ material_code: 'a', dirty: true }],
  bom: [],
  kits: [{ id: 'k1', dirty: true }]
};
ok('หยิบเฉพาะแถวที่ยังไม่ได้ส่ง', dirtyRows(store.entries).length === 2);
const plan = syncPlan(store);
ok('นับแยกรายตาราง ไม่ใช่ยอดรวมก้อนเดียว',
   plan.per.entries === 2 && plan.per.materials === 1 && plan.per.kits === 1
   && plan.total === 4, JSON.stringify(plan));
ok('ตารางที่ยังไม่มีข้อมูลก็ต้องมีในสรุป ไม่ใช่หายไป',
   plan.per.pos === 0 && plan.per.shorts === 0, JSON.stringify(plan.per));
ok('ซิงค์ครบทุกตารางที่ต้องแชร์กันข้ามเครื่อง',
   Object.keys(TABLES).join(',') === 'entries,materials,bom,pos,kits,shorts,entities,weeks',   // weeks — WK พิมพ์เองใน MRP (15 พ.ย. 2026)
   Object.keys(TABLES).join(','));
ok('ทุกตารางบอกชื่อชีตปลายทางไว้ครบ',
   Object.values(TABLES).every(t => t.sheet && t.key && t.label));
ok('ธง dirty ไม่ถูกส่งขึ้นไปด้วย', toWire({ id: 'x', dirty: true }).dirty === undefined);

// Apps Script มีเพดานเวลา 6 นาที ตอนเปิดระบบครั้งแรกจะมีเป็นพันแถวพร้อมกัน
const big = Array.from({ length: 750 }, (_, i) => ({ id: String(i) }));
const parts = chunk(big, 300);
ok('ตัดเป็นก้อนตามขนาดที่กำหนด', parts.length === 3 && parts[2].length === 150,
   JSON.stringify(parts.map(p => p.length)));
ok('ไม่มีแถวหายและไม่มีแถวเกินตอนตัดก้อน',
   parts.flat().length === 750 && new Set(parts.flat().map(r => r.id)).size === 750);
ok('ไม่มีอะไรจะส่งก็ได้ศูนย์ก้อน', chunk([], 300).length === 0);

console.log('\n=== E. เซิร์ฟเวอร์ยังเป็นสคริปต์เวอร์ชันเก่า ===');
ok('จับข้อความว่ายังไม่ได้อัปสคริปต์ได้', looksLikeOldScript('ไม่รู้จักคำสั่ง: pullTable'));
ok('จับตารางที่ยังไม่มีได้', looksLikeOldScript('ไม่รู้จักตาราง: materials'));
ok('ข้อผิดพลาดอื่นไม่ถูกเหมารวม', !looksLikeOldScript('token ไม่ถูกต้อง'));

console.log('\n=== F. รหัสที่กลับมาเป็นตัวเลข (v1 issue #36) ===');
// Google Sheets เก็บรหัสเลขล้วนเป็นตัวเลข พอเทียบกับข้อความจะไม่ตรงแบบเงียบ ๆ
// ของจริงทำให้คอลัมน์ยอดตามสูตรในหน้ารับเข้าว่างทั้งใบ ทั้งที่ BOM มีข้อมูลครบ
const raw = { material_code: 4010600100, part_no: 2870627900, doc_ref: 5266177,
              code: 4020204800, pn: 123, po: 456, entity: 7, qty: 12.5 };
const fixed = normKeys({ ...raw });
ok('รหัสวัตถุดิบกลายเป็นข้อความ',
   fixed.material_code === '4010600100' && typeof fixed.material_code === 'string');
ok('P/N กับเลขเอกสารก็ด้วย',
   typeof fixed.part_no === 'string' && typeof fixed.doc_ref === 'string');
ok('ช่อง po / code / pn / entity ครบ',
   ['code', 'pn', 'po', 'entity'].every(c => typeof fixed[c] === 'string'));
// จำนวนต้องยังเป็นตัวเลข ไม่งั้นการบวกยอดจะกลายเป็นการต่อสตริง
ok('แต่จำนวนต้องยังเป็นตัวเลข', fixed.qty === 12.5 && typeof fixed.qty === 'number');
ok('doc_ref อยู่ในลิสต์เสมอ — เป็นช่อง PO ที่เอาไปเทียบกับ Kit List',
   KEY_COLS.includes('doc_ref'));
ok('ค่าที่เป็นข้อความอยู่แล้วไม่ถูกแตะ', normKeys({ code: '0012' }).code === '0012');
ok('แถวว่างไม่พัง', normKeys(null) === null && normKeysAll(null) === null);

// ต้องซ่อมตอนรวมข้อมูลด้วย ไม่ใช่แค่ตอนโหลดจากเครื่อง
const inc = mergeIncoming([], [{ id: 'K1', code: 4020204800, updated_at: '2' }], 'id');
ok('แถวที่รับมาจากเซิร์ฟเวอร์ถูกซ่อมชนิดก่อนเก็บ',
   typeof inc.added[0].code === 'string', typeof inc.added[0].code);
// เทียบด้วย Map เหมือนที่หน้าคีย์รับเข้าทำจริง
ok('จับคู่กับ BOM ติดหลังซ่อม',
   new Map([['4020204800', { usage: 1 }]]).has(inc.added[0].code));

console.log('\n=== ล้าง URL ของ Apps Script ===');
// อาการที่ทำให้ต้องมีฟังก์ชันนี้ — เครื่องหนึ่งได้ HTTP 404 ตอนซิงค์
// ทั้งที่ deployment ถูกต้อง และยิงคำสั่งเดียวกันจากที่อื่นได้ 200 ปกติ
// สาเหตุคืออักขระที่มองไม่เห็นติดมาตอนก๊อป URL ข้ามหน้าจอ
//
// ⚠️ ห้ามใช้ deployment id ของจริงเป็นค่าตัวอย่าง repo นี้เป็น public
// และ id ตัวนี้คือกุญแจเข้าถึงสเปรดชีตในตัวมันเอง แม้แต่บางส่วนก็ไม่ควรมี
const GOOD = 'https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec';
const nu = raw => normalizeScriptUrl(raw);

ok('URL สะอาดผ่านฉลุย ไม่มีคำเตือนกวน',
   nu(GOOD).url === GOOD && !nu(GOOD).problems.length && !nu(GOOD).fatal);
ok('ช่องว่างหน้าหลังถูกตัด และบอกให้รู้',
   nu('  ' + GOOD + '  ').url === GOOD && nu(' ' + GOOD).problems.length === 1);
ok('ขึ้นบรรทัดท้ายถูกตัด', nu(GOOD + '\n').url === GOOD);
ok('zero-width space ถูกตัด', nu(GOOD + '​').url === GOOD);
ok('BOM ถูกตัด', nu('﻿' + GOOD).url === GOOD);
ok('non-breaking space ถูกตัด', nu(GOOD + ' ').url === GOOD);
ok('อักขระที่มองไม่เห็นถูกฟ้อง ไม่ใช่แก้เงียบ ๆ',
   nu(GOOD + '​').problems.some(p => p.includes('มองไม่เห็น')));
ok('/ เกินท้าย /exec ถูกตัดและฟ้อง',
   nu(GOOD + '/').url === GOOD && nu(GOOD + '/').problems.some(p => p.includes('/ เกิน')));
ok('เครื่องหมายคำพูดจากการก๊อปในเอกสารถูกตัด', nu('"' + GOOD + '"').url === GOOD);
ok('อัญประกาศโค้งก็ตัด', nu('“' + GOOD + '”').url === GOOD);
ok('ช่องว่างกลาง URL ถูกตัด',
   nu(GOOD.slice(0, 30) + ' ' + GOOD.slice(30)).url === GOOD);

ok('URL ของ /dev ถูกปฏิเสธพร้อมบอกว่าต้องใช้ /exec',
   nu(GOOD.replace('/exec', '/dev')).fatal.includes('/exec'));
ok('ของที่ไม่ใช่ Apps Script ถูกปฏิเสธ',
   !!nu('https://example.com/exec').fatal);
ok('ช่องว่างเปล่าไม่ถือว่าพัง แค่ยังไม่ได้กรอก',
   nu('').fatal === 'ยังไม่ได้ใส่ URL' && nu('  ').url === '');
ok('ส่ง null มาก็ไม่ระเบิด', nu(null).url === '' && nu(undefined).url === '');
// เคยพลาดมาแล้วกับ regex ที่มีธง g แล้วเรียก test ซ้ำ — lastIndex ค้างทำให้ครั้งที่สองหลุด
ok('เรียกซ้ำได้ผลเหมือนเดิมทุกครั้ง',
   nu(GOOD + '​').url === nu(GOOD + '​').url &&
   nu(GOOD + '​').problems.length === nu(GOOD + '​').problems.length);

console.log('\n=== ยกเลิกแล้วไม่ย้อน (stickyVoid · เติมวันหมดอายุทีหลัง 24 ก.ย. 2026) ===');
// เครื่อง A ยกเลิก · เครื่อง B ยังไม่รู้ เติมวันหมดอายุแล้วส่งขึ้นทีหลัง → เซิร์ฟเวอร์ได้แถวที่ไม่ยกเลิก
const vA = { id: 'V', qty: 5, expiry_date: '', voided: true, void_reason: 'คีย์ผิด', void_by: 'ก', void_at: 't1',
             updated_at: '2026-09-24T01:00:00.000Z', dirty: false };
const fromB = { id: 'V', qty: 5, expiry_date: '2027-01-31', voided: 'FALSE', void_reason: '', void_by: '', void_at: '',
                updated_at: '2026-09-24T02:00:00.000Z' };
const sv1 = mergeIncoming([vA], [fromB], 'id', { stickyVoid: true }).updated[0];
ok('เครื่องที่ยกเลิกไว้ ไม่ฟื้นรายการตามแถวที่ดึงมา', sv1.voided === true && sv1.void_reason === 'คีย์ผิด');
ok('แต่รับช่องอื่นที่อีกเครื่องแก้มาด้วย', sv1.expiry_date === '2027-01-31');
ok('แล้วติดธงรอส่ง เพื่อไปซ่อมเซิร์ฟเวอร์กลับเป็นยกเลิก', sv1.dirty === true);
ok('ตารางอื่นยังเป็นใครแก้ทีหลังชนะเหมือนเดิม',
   mergeIncoming([{ ...vA }], [fromB]).updated[0].voided === 'FALSE');
// แถวของเครื่องเรายังส่งไม่ออก แต่เซิร์ฟเวอร์ยกเลิกไปแล้ว — D3 ยังชนะ ห้ามแตะ
const vB = { id: 'V', qty: 5, expiry_date: '2027-01-31', voided: false, void_reason: '', updated_at: 'a', dirty: true };
const sv2 = mergeIncoming([vB], [{ ...vA, voided: 'TRUE', updated_at: 'b' }], 'id', { stickyVoid: true });
ok('แถวที่ยังส่งไม่ออก ยังห้ามแตะ (D3) แม้ฝั่งโน้นยกเลิกแล้ว',
   sv2.heldBack === 1 && sv2.updated.length === 0 && vB.voided === false);
// ไล่ทั้งวง: เซิร์ฟเวอร์ถูกทับเป็นไม่ยกเลิก → A ซ่อมส่งขึ้น → B ดึงแล้วได้ยกเลิก
const aFix = { ...sv1, updated_at: '2026-09-24T03:00:00.000Z', dirty: false };
const bNow = { ...fromB, voided: false, dirty: false };
const bAfter = mergeIncoming([bNow], [aFix], 'id', { stickyVoid: true }).updated[0];
ok('เครื่องที่ส่งแถวไม่ยกเลิกขึ้นไป ได้การยกเลิกกลับมาเมื่อซิงค์รอบถัดไป',
   bAfter.voided === true && bAfter.expiry_date === '2027-01-31' && bAfter.dirty === false);
ok('ยกเลิกทั้งสองฝั่ง รวมตามปกติ ไม่ติดธงรอส่ง',
   mergeIncoming([{ ...vA }], [{ ...vA, voided: 'TRUE', updated_at: 'z' }], 'id', { stickyVoid: true })
     .updated[0].dirty === false);
ok('แอปเปิด stickyVoid ให้ตาราง entries ตอนซิงค์',
   /mergeIncoming\([^)]*stickyVoid: t === 'entries'/.test(fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8')));

console.log('\n=== ตารางที่ประกาศไว้ ต้องต่อสายครบทุกตัว ===');
// บั๊กจริง 24 ส.ค. 2026 — เพิ่ม entities เข้า TABLES แล้วลืมต่อสายฝั่งแอป
// ซิงค์วิ่งไปหกตารางแล้วพังที่ตารางที่เจ็ด ด้วยข้อความ
// "Cannot read properties of undefined (reading 'value')"
// ซึ่งไม่บอกว่าตารางไหน และดูเหมือนเป็นความผิดของคนตั้งค่า ทั้งที่เป็นบั๊กของโปรแกรม
const wired = {};
for (const t of Object.keys(TABLES)) wired[t] = { value: [] };
ok('ต่อครบแล้วไม่ฟ้อง', missingTables(wired).length === 0);
delete wired.entities;
ok('ขาดตารางไหน บอกชื่อตารางนั้น',
   missingTables(wired).join(',') === 'entities', missingTables(wired).join(','));
ok('ไม่ได้ส่งอะไรมาเลย ถือว่าขาดทั้งหมด ไม่ใช่ปล่อยผ่าน',
   missingTables(undefined).length === Object.keys(TABLES).length);
ok('ตอนนี้ประกาศไว้แปดตาราง — เพิ่มเมื่อไหร่ต้องไปต่อสายใน app.js ด้วย',
   Object.keys(TABLES).length === 8, String(Object.keys(TABLES).length));

console.log('\n=== ป้ายสถานะซิงค์บนหัวจอ (เจ้าของขอ 6 ต.ค. 2026) ===');
{
  const U = 'https://script.google.com/macros/s/X/exec';
  const fmt = { time: iso => iso.slice(11, 16), date: iso => iso.slice(0, 10), today: '2026-10-06' };
  const b = (o, f = fmt) => syncBadge({ url: U, ...o }, f);
  ok('ยังไม่ตั้งค่า = เทา "ยังไม่เชื่อมต่อ"', syncBadge({}, fmt).cls === '' && syncBadge({}, fmt).text === 'ยังไม่เชื่อมต่อ');
  ok('กำลังซิงค์ = เหลือง', b({ state: 'busy' }).cls === 'busy');
  ok('ซิงค์ไม่ได้ = แดง บอกยอดค้าง · title มีข้อความ error จริง',
     b({ state: 'error', error: 'HTTP 404', pending: 3 }).cls === 'error'
     && b({ state: 'error', pending: 3 }).text === 'ซิงค์ไม่ได้ · ค้าง 3'
     && b({ state: 'error', error: 'HTTP 404' }).title.startsWith('HTTP 404'));
  ok('error ชนะ "รอส่ง" — มีของค้างแล้วซิงค์ไม่ได้ ต้องเห็นแดง ไม่ใช่เหลือง',
     b({ state: 'error', pending: 5, lastOkAt: '2026-10-06T08:00:00.000Z' }).cls === 'error');
  ok('มีของรอส่ง = เหลือง "รอส่ง N"', b({ state: 'ok', pending: 2 }).text === 'รอส่ง 2' && b({ pending: 2 }).cls === 'pending');
  ok('ซิงค์แล้ววันนี้ = เขียว บอกแค่เวลา', b({ state: 'ok', lastOkAt: '2026-10-06T08:05:00.000Z' }).text === 'ซิงค์แล้ว 08:05'
     && b({ lastOkAt: '2026-10-06T08:05:00.000Z' }).cls === 'ok');
  ok('ซิงค์ล่าสุดไม่ใช่วันนี้ = บอกวันที่ด้วย (เห็นว่าค้างมาแต่เมื่อวาน)',
     b({ lastOkAt: '2026-10-05T08:05:00.000Z' }).text === 'ซิงค์แล้ว 2026-10-05 08:05');
  ok('กดทดสอบผ่านแต่ยังไม่เคยซิงค์ = ไม่ขึ้นเขียว (ok ดูจาก lastOkAt ไม่ใช่ state)',
     b({ state: 'ok' }).cls === '' && b({ state: 'ok' }).text === 'ยังไม่เคยซิงค์');
  const html = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
  ok('หัวจอมีป้าย ผูกกับ badge และกดได้', /class="sync-badge"[^>]*@click="onBadge"/.test(html) && html.includes(':class="badge.cls"'));
  ok('เวลา "ซิงค์ล่าสุด" ใช้เวลาเครื่อง ไม่ใช่ตัด ISO ตรง ๆ (= UTC ช้ากว่าเวลาไทย 7 ชั่วโมง)',
     !html.includes('lastOkAt.slice(11') && (html.match(/localTime\(sync\.lastOkAt\)/g) || []).length === 2);
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const ret = app.slice(app.lastIndexOf('return {'));
  ok('badge · onBadge · localTime ส่งออกให้เทมเพลต (ไม่งั้นจอขาวทั้งหน้า)',
     ['badge', 'onBadge', 'localTime'].every(f => new RegExp('\\b' + f + '\\b').test(ret)));
}

console.log('\n=== ของที่นำเข้าต้องมีธงรอส่งตั้งแต่บนจอ (ตรวจทั้งโปรแกรม 14 พ.ย. 2026 ข้อ 2) ===');
{
  // db.put ติดธง dirty บนอ็อบเจกต์ที่ส่งเข้าไป ถ้าใส่สำเนา (x.map(plain) · plain(x)) แล้วเอาตัวเดิม x ขึ้นจอ
  // ตัวบนจอไม่มีธง → ป้ายรอส่งขึ้น 0 และไม่ถูกส่งขึ้นจนกว่าจะรีเฟรช (เคยเป็นกับนำเข้า PO · Kit List · ทะเบียนจากใบเบิก)
  const copyThenPushOriginal = src => {
    const bad = [];
    const re = /await db\.put\('(\w+)',\s*(?:plain\(([\w.]+)\)|([\w.]+)\.map\(plain\))\)/g;
    for (let m; (m = re.exec(src));) {
      const name = m[2] || m[3];
      if (src.slice(m.index, m.index + 400).includes('.push(...' + name + ')')) bad.push(m[1] + ' ← ' + name);
    }
    return bad;
  };
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const bad = copyThenPushOriginal(app);
  ok('ไม่มีจุดไหนใส่สำเนาลงเครื่องแล้วเอาตัวเดิม (ไม่มีธง) ขึ้นจอ', bad.length === 0, bad.join(' · '));
  ok('ด่านนี้จับแบบเดิมได้จริง', copyThenPushOriginal(
    "await db.put('pos', p.plan.fresh.map(plain));\n pos.value.push(...p.plan.fresh);\n"
    + "await db.put('materials', plain(recs));\n materials.value.push(...recs);").length === 2);
}

console.log('\n=== Q. ซิงค์ให้เครื่องอื่นเห็นเร็ว — ส่งหลังบันทึก · ถามทุก 20 วินาที (เจ้าของสั่ง 28 พ.ย. 2026) ===');
{
  const T = 10 * 3600000;
  const tk = o => syncTick({ now: T, lastFullAt: T - 30000, ...o });
  ok('กำลังซิงค์/กำลังถามอยู่ = ไม่ทำอะไรซ้อน', tk({ busy: true, pending: 3 }) === '');
  ok('เพิ่งเปิดโปรแกรม (ยังไม่เคยซิงค์เต็ม) = ซิงค์เต็ม', syncTick({ now: T }) === 'full');
  ok('มีของค้างส่ง = ส่ง (เฉพาะตารางที่ค้าง)', tk({ pending: 2 }) === 'push');
  ok('ไม่มีของค้าง = ถามว่าตารางไหนเปลี่ยน', tk({}) === 'ask');
  ok('แท็บถูกซ่อน = ไม่ถาม แต่ยังส่งของค้าง', tk({ hidden: true }) === '' && tk({ hidden: true, pending: 1 }) === 'push');
  ok('ถามได้ = ซิงค์เต็มเหลือทุก 10 นาที', syncTick({ now: T, lastFullAt: T - FULL_MS + 1000 }) === 'ask'
     && syncTick({ now: T, lastFullAt: T - FULL_MS }) === 'full');
  ok('สคริปต์รุ่นเก่า (ถามไม่ได้) = ซิงค์เต็มทุก 2 นาทีเหมือนเดิม ไม่ถาม',
     syncTick({ now: T, lastFullAt: T - FULL_MS_OLD, canAsk: false }) === 'full' && tk({ canAsk: false }) === '');
  ok('สคริปต์รุ่นเก่ายังส่งของค้างหลังบันทึกได้', tk({ canAsk: false, pending: 1 }) === 'push');
  ok('รอบก่อนพัง = กลับไปแบบเดิม: ไม่ส่งซ้ำทุก 20 วินาที · ซิงค์เต็มทุก 2 นาที',
     tk({ failed: true, pending: 4 }) === '' && syncTick({ now: T, lastFullAt: T - FULL_MS_OLD, failed: true }) === 'full');

  const store = { entries: [{ id: 'a', dirty: true }], materials: [{ material_code: 'm', dirty: false }], weeks: [{ id: 'w', dirty: true }] };
  ok('ตารางที่มีของค้างส่ง', JSON.stringify(dirtyTables(store)) === '["entries","weeks"]', JSON.stringify(dirtyTables(store)));
  const sb = sinceBySheet({ entries: '2026-11-28T01:00:00.000Z', weeks: '2026-11-28T02:00:00.000Z' });
  ok('since ส่งเป็นชื่อชีต ครบทุกตาราง · ที่ยังไม่เคยดึง = ว่าง',
     sb.Entries === '2026-11-28T01:00:00.000Z' && sb.PoWeeks === '2026-11-28T02:00:00.000Z' && sb.Materials === ''
     && Object.keys(sb).length === Object.keys(TABLES).length, JSON.stringify(sb));

  const A = '2026-11-28T03:00:00.000Z', B = '2026-11-28T03:00:20.000Z';
  const res = { changed: ['Entries', 'Shorts'], stamps: { Entries: A, Shorts: A, Materials: A } };
  ok('ดึงเฉพาะชีตที่เซิร์ฟเวอร์บอกว่าเปลี่ยน (คืนชื่อตารางในเครื่อง)', JSON.stringify(askPlan(res, {})) === '["entries","shorts"]',
     JSON.stringify(askPlan(res, {})));
  ok('เวลาที่จดเท่ากับที่ดึงตามไปแล้ว = ข้าม (ไม่ดึงซ้ำทุก 20 วินาทีในช่วงเผื่อหนึ่งนาที)',
     JSON.stringify(askPlan(res, { Entries: A })) === '["shorts"]');
  ok('มีคนส่งใหม่ (เวลาที่จดเปลี่ยน) = ดึงอีก', JSON.stringify(askPlan({ ...res, stamps: { ...res.stamps, Entries: B } }, { Entries: A, Shorts: A })) === '["entries"]');
  ok('เวลาที่จดว่างหรืออ่านไม่ออก = ดึงเสมอ แม้ seen ตรงกัน',
     askPlan({ changed: ['Entries'], stamps: { Entries: '' } }, { Entries: '' }).length === 1
     && askPlan({ changed: ['Entries'], stamps: { Entries: '1' } }, { Entries: '1' }).length === 1);
  ok('ชีตที่ไม่ได้เปลี่ยน ไม่ดึงแม้ seen ไม่ตรง', askPlan({ changed: [], stamps: { Entries: B } }, { Entries: A }).length === 0);
  ok('คำตอบแปลก/ว่าง = ไม่ดึงอะไร ไม่พัง', askPlan(null).length === 0 && askPlan({}).length === 0);

  // ต่อสายใน app.js — seen ต้องตั้งหลังดึงสำเร็จ (หลัง since) ไม่ใช่หลังส่ง
  const app = fs.readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
  const at = s => app.indexOf(s);
  ok('app.js ตั้ง seen หลังดึงสำเร็จเท่านั้น (หลังบรรทัด since)',
     at('if (mark) seen[TABLES[t].sheet] = mark;') > at('sync.since[t] = d.serverTime;') && at('sync.since[t] = d.serverTime;') > 0);
  ok('app.js ใช้ syncTick ตัดสินรอบ ไม่เหลือ setInterval 2 นาทีแบบเดิม',
     app.includes('setInterval(syncTickNow, ASK_MS)') && !/setInterval\([^\n]*120000\)/.test(app));
}

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
