/**
 * เทสการย้ายข้อมูลข้ามนิติบุคคล — รันด้วย node
 *   node tests/v2-entity-move.test.mjs
 *
 * หมวด C สำคัญที่สุด — ตัวนี้เขียนทับช่องนิติบุคคลของข้อมูลจริงทั้งก้อน
 * ผิดแล้วยอดจะไปกองผิดโรงงานแบบที่ทุกหน้าจอดูปกติดี
 * เลขทุกตัวในไฟล์นี้สมมติขึ้นมา ไม่ใช่ของจริงจากงาน
 */
import { readFileSync } from 'node:fs';
import { normEnt, movedTo, addMove, applyMoves, movePreview } from '../v2/master/entity-move.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};
const threw = fn => { try { fn(); return ''; } catch (e) { return e.message; } };

console.log('=== A. ตั้งกติกาย้าย ===');
ok('ไม่ระบุปลายทางแล้วดัง ไม่ใช่เงียบ', !!threw(() => addMove([], { from: 'AAA', to: '' })));
ok('ต้นทางกับปลายทางเดียวกันแล้วดัง', !!threw(() => addMove([], { from: 'AAA', to: ' aaa ' })));

const m1 = addMove([], { from: ' aaa ', to: 'bbb-x', by: 'ผู้ดูแล' });
ok('ตัวพิมพ์เล็กและช่องว่างไม่มีผล', m1[0].from === 'AAA' && m1[0].to === 'BBB-X',
   JSON.stringify(m1[0]));
ok('บันทึกไว้ว่าใครตั้งเมื่อไหร่', m1[0].by === 'ผู้ดูแล' && !!m1[0].at);

const base = [];
addMove(base, { from: 'AAA', to: 'BBB-X' });
ok('ไม่แก้รายการเดิม คืนชุดใหม่', base.length === 0);

ok('ตั้งกติกาซ้ำรหัสเดิมแล้วดัง พร้อมบอกว่าต้องย้ายจากที่ไหน',
   threw(() => addMove(m1, { from: 'AAA', to: 'CCC' })).includes('BBB-X'));
ok('ย้ายกลับทางเดิมแล้วดัง', !!threw(() => addMove(m1, { from: 'BBB-X', to: 'AAA' })));

console.log('\n=== B. ปลายทางสุดท้าย ===');
ok('รหัสที่มีกติกา ได้ปลายทาง', movedTo('AAA', m1) === 'BBB-X');
ok('รหัสที่ไม่มีกติกา ตอบว่าง ไม่ใช่เดา', movedTo('ZZZ', m1) === '');
ok('ช่องว่างตอบว่าง', movedTo('', m1) === '' && movedTo(null, m1) === '');
ok('ไม่มีกติกาเลยก็ไม่พัง', movedTo('AAA', []) === '' && movedTo('AAA') === '');

const chain = addMove(m1, { from: 'BBB-X', to: 'CCC' });
ok('ย้ายต่อเป็นทอด ๆ ได้ปลายทางสุดท้าย', movedTo('AAA', chain) === 'CCC', movedTo('AAA', chain));

// กติกาที่ซิงค์มาจากเครื่องอื่นไม่ได้ผ่านด่าน addMove ของเครื่องนี้
const loop = [{ from: 'AAA', to: 'BBB-X' }, { from: 'BBB-X', to: 'AAA' }];
ok('กติกาที่วนกันเอง ตอบว่าไม่ต้องย้าย ไม่ใช่ค้างวนไม่จบ', movedTo('AAA', loop) === '');

// วงจรที่ AAA เดินไปเจอ แต่ตัว AAA เองไม่ได้อยู่ในวง (BBB-X ↔ CCC)
// ถ้าจำแค่จุดตั้งต้นจะจับไม่ได้ แล้วคำตอบจะแกว่งตามจำนวนกติกาในชุด
const reach = [{ from: 'AAA', to: 'BBB-X' }, { from: 'BBB-X', to: 'CCC' }, { from: 'CCC', to: 'BBB-X' }];
ok('วงจรที่เดินไปเจอ (ไม่ได้มีตัวเองอยู่ในวง) ต้องตอบว่าไม่ต้องย้าย',
   movedTo('AAA', reach) === '', JSON.stringify(movedTo('AAA', reach)));
ok('คำตอบต้องไม่ขยับเพราะมีกติกาคู่อื่นที่ไม่เกี่ยวกันเพิ่มเข้ามา',
   movedTo('AAA', [...reach, { from: 'XXX', to: 'YYY' }]) === '' &&
   movedTo('AAA', [...reach, { from: 'XXX', to: 'YYY' }, { from: 'PPP', to: 'QQQ' }]) === '',
   JSON.stringify([movedTo('AAA', [...reach, { from: 'XXX', to: 'YYY' }]),
                   movedTo('AAA', [...reach, { from: 'XXX', to: 'YYY' }, { from: 'PPP', to: 'QQQ' }])]));
ok('กติกาคู่อื่นที่ไม่ได้อยู่ในวงจร ยังไล่สายได้ตามปกติ',
   movedTo('XXX', [...reach, { from: 'XXX', to: 'YYY' }]) === 'YYY');

console.log('\n=== C. ย้ายข้อมูล ===');
const rows = [
  { id: 'E1', entity: 'AAA', material_code: 'MC-001', qty: 10,
    created_at: '2026-01-02T03:00:00.000Z', updated_at: '2026-01-02T03:00:00.000Z' },
  { id: 'E2', entity: 'aaa', material_code: 'MC-002', qty: 5, voided: true,
    created_at: '2026-01-03T03:00:00.000Z', updated_at: '2026-01-03T03:00:00.000Z' },
  { id: 'E3', entity: 'ZZZ', material_code: 'MC-003', qty: 7,
    created_at: '2026-01-04T03:00:00.000Z', updated_at: '2026-01-04T03:00:00.000Z' },
  { id: 'E4', entity: '', material_code: 'MC-004', qty: 1,
    created_at: '2026-01-05T03:00:00.000Z', updated_at: '2026-01-05T03:00:00.000Z' }
];
const now = '2026-09-19T04:00:00.000Z';
const r1 = applyMoves(rows, m1, { now });

ok('ไม่มีแถวไหนหายไป (B1)', r1.rows.length === rows.length, String(r1.rows.length));
ok('ย้ายเฉพาะแถวของรหัสนั้น', r1.changed.length === 2, String(r1.changed.length));
ok('ตัวพิมพ์เล็กก็ย้ายด้วย', r1.rows[1].entity === 'BBB-X', r1.rows[1].entity);
ok('แถวที่ยกเลิกไปแล้วก็ย้าย มันยังเป็นประวัติของนิติบุคคลนั้น', r1.rows[1].voided === true);
ok('รหัสอื่นไม่ถูกแตะเลย คืนตัวเดิมทั้งตัว', r1.rows[2] === rows[2]);
ok('แถวที่ยังไม่รู้นิติบุคคล ไม่เดาให้', r1.rows[3] === rows[3] && r1.rows[3].entity === '');

ok('id ไม่ขยับ (B3)', r1.rows[0].id === 'E1');
ok('created_at ไม่ขยับ (B3)', r1.rows[0].created_at === '2026-01-02T03:00:00.000Z');
ok('ยอดกับรหัสวัตถุดิบไม่ถูกแตะ', r1.rows[0].qty === 10 && r1.rows[0].material_code === 'MC-001');
ok('updated_at ขยับ ไม่งั้นการซิงค์จะไม่พาไปทับของเดิมบนชีต', r1.rows[0].updated_at === now);
ok('ติดธงรอส่งขึ้น', r1.rows[0].dirty === true);
ok('ของเดิมในหน่วยความจำไม่ถูกแก้', rows[0].entity === 'AAA' && rows[0].dirty === undefined);

const local = applyMoves([{ id: 'C1', entity: 'AAA', updated_at: '2026-01-01T00:00:00.000Z' }],
                         m1, { now, dirty: false });
ok('ตารางที่ไม่ได้ซิงค์ ไม่ต้องติดธงรอส่ง', local.changed[0].dirty === undefined);

const r2 = applyMoves(r1.rows, m1, { now: '2026-09-20T04:00:00.000Z' });
ok('ย้ายซ้ำอีกรอบไม่มีอะไรเปลี่ยน', r2.changed.length === 0);
ok('ย้ายซ้ำแล้ว updated_at ไม่ถูกดันฟรี ๆ', r2.rows[0].updated_at === now);

// เครื่องที่ปิดอยู่ตอนย้าย ส่งแถวรหัสเดิมตามมาทีหลัง
const late = applyMoves([...r1.rows, { id: 'E9', entity: 'AAA', qty: 2,
                                       created_at: now, updated_at: now }], m1, { now });
ok('แถวที่ตามมาทีหลังใต้รหัสเดิม ถูกย้ายให้ในรอบถัดไป',
   late.changed.length === 1 && late.changed[0].id === 'E9' && late.changed[0].entity === 'BBB-X');

const far = applyMoves(rows, chain, { now });
ok('ย้ายเป็นทอดแล้วข้อมูลไปถึงปลายทางสุดท้ายรอบเดียว', far.rows[0].entity === 'CCC');

console.log('\n=== D. นับก่อนย้ายจริง ===');
const pv = movePreview({ entries: rows, shorts: [{ id: 'S1', entity: 'AAA' }], counts: [] }, m1);
ok('นับแยกรายตาราง', pv.per.entries === 2 && pv.per.shorts === 1 && pv.per.counts === 0,
   JSON.stringify(pv.per));
ok('บอกยอดรวมให้คนดูก่อนกดยืนยัน', pv.total === 3, String(pv.total));
ok('ไม่มีอะไรต้องย้ายก็ตอบศูนย์', movePreview({ entries: rows }, []).total === 0);

console.log('\n=== E. ตัวช่วยเล็ก ๆ ===');
ok('normEnt ตัดช่องว่างและทำเป็นตัวใหญ่', normEnt(' tue-h ') === 'TUE-H');
ok('normEnt รับค่าว่างได้', normEnt(null) === '' && normEnt(undefined) === '');

console.log('\n=== F. ต่อสายในหน้าจอ (อ่านซอร์ส) ===');
const app = readFileSync(new URL('../v2/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
const doMoveSrc = app.slice(app.indexOf('async function doMove'),
                            app.indexOf('async function doMove') + 2200);

// ตกตารางเดียวคือยอดของนิติบุคคลเก่าค้างอยู่โดยไม่มีอะไรฟ้อง (A3)
ok('ย้ายครบทุกตารางที่ประทับรหัสนิติบุคคลไว้ (A3)',
   /moveLists = \(\) => \(\{ entries, shorts, counts \}\)/.test(app));
ok('รันกติกาตอนเปิดโปรแกรม',
   /getMeta\('entity_moves'[\s\S]{0,160}await runMoves\(\)/.test(app));
ok('รันอีกรอบหลังดึงของจากเครื่องอื่นลงมา', /if \(down\) await runMoves\(\);/.test(app));
ok('เก็บกติกาไว้ก่อนย้าย ไม่งั้นรอบถัดไปจะไม่มีกติกา',
   /setMeta\('entity_moves'[\s\S]{0,160}runMoves\(\)/.test(doMoveSrc));
ok('ตัวที่เลือกอยู่บนจอย้ายตามด้วย', /movedTo\(entity\.value/.test(app));
ok('ปิดรหัสเดิม ไม่ใช่ลบทิ้ง (B1)',
   /active: false/.test(doMoveSrc) && !/db\.del\(/.test(doMoveSrc));
ok('เครื่องที่ยังเลือกรหัสที่ปิดไปแล้ว ต้องเห็นคำเตือนบนหน้าแรก',
   /entClosed\.value \? 1 : 0/.test(app));
ok('หน้าจอบอกจำนวนก่อนกดยืนยัน', html.includes('<b>{{ entMovePv.total }}</b>'));
ok('หน้าจอเตือนให้ก๊อปชีตเก็บก่อนกด', html.includes('ก๊อปปี้ชีตทั้งไฟล์'));

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
