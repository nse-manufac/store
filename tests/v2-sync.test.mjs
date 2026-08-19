/**
 * เทสตรรกะการซิงค์ — รันด้วย node
 *   node tests/v2-sync.test.mjs
 *
 * หมวด B สำคัญที่สุด — ถ้ารวมข้อมูลผิด งานที่พนักงานเพิ่งคีย์จะหายเงียบ ๆ ตอนเน็ตกลับมา
 * ซึ่งเป็นความเสียหายที่ไม่มีใครเห็นจนกว่าจะมีคนทักว่ายอดไม่ตรง
 */
import { TABLES, asText, asBool, asNum, dirtyRows, mergeIncoming, markSynced,
         chunk, toWire, syncPlan, looksLikeOldScript } from '../v2/core/sync.js';

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
   Object.keys(TABLES).join(',') === 'entries,materials,bom,pos,kits,shorts',
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

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
