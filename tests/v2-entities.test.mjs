/**
 * เทสนิติบุคคล — รันด้วย node
 *   node tests/v2-entities.test.mjs
 *
 * หมวด B สำคัญที่สุด — ถ้าตัดสินนิติบุคคลผิด ยอดจะไปกองผิดโรงงาน
 * ซึ่งเป็นความผิดที่มองไม่เห็นบนหน้าจอ เพราะทุกหน้าจะดูปกติดีทั้งสองฝั่ง
 */
import { readFileSync } from 'node:fs';
import { makeEntity, entityOfPo, resolveEntity, activeCodes, infoOf,
         unknownEntities, poOwnerOf, poVisibleTo, DEFAULT_ENTITY } from '../v2/master/entities.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. สร้างนิติบุคคล ===');
const e1 = makeEntity({ entity_code: ' tue-h ', company_name: 'ทียูอี เอช',
                        store_location: 'คลัง A', vendor_no: 'V001' });
ok('รหัสถูกตัดช่องว่างและทำเป็นตัวใหญ่', e1.entity_code === 'TUE-H', e1.entity_code);
ok('เก็บ store location ไว้กับนิติบุคคล ไม่ใช่ตั้งรวมทั้งโปรแกรม',
   e1.store_location === 'คลัง A');
ok('ค่าเริ่มต้นคือใช้งานอยู่', e1.active === true);
let threw = false;
try { makeEntity({ entity_code: '  ' }); } catch { threw = true; }
ok('ไม่มีรหัสแล้วดัง ไม่ใช่สร้างแถวเปล่า', threw);
ok('มีตัวเลือกตั้งต้นให้ตอนยังไม่มีใครตั้งอะไร', !!DEFAULT_ENTITY);

console.log('\n=== B. รายการนี้เป็นของนิติบุคคลไหน ===');
// ⚠️ เจ้าของสั่ง 19 ก.ย. 2026 ให้เลิกดูคอลัมน์ผู้รับเหมาในไฟล์ PO ทั้งระบบ
//    ที่นี่คือจุดที่ตัดสินว่า "รายการใหม่จะไปลงสมุดของใคร" — เชื่อผิดแล้วยอดขยับผิดโรงงาน
const knownB = ['TUE-H', 'TUE-U'];

const forced = resolveEntity('TM4267U025', { forced: 'TUE-H', current: 'NSE', known: knownB });
ok('คนบังคับทั้งใบมา ชนะการเดาเสมอ', forced.code === 'TUE-H' && forced.from === 'forced');

const guess = resolveEntity('TM4267U025', { current: 'NSE', known: knownB });
ok('อ่านนิติบุคคลจากเลขที่ PO', guess.code === 'TUE-U' && guess.from === 'guess');

const offReg = resolveEntity('TM4267A025', { current: 'TUE-H', known: knownB });
ok('เลขบอกเป็นรหัสที่ยังไม่มีในทะเบียน — ต้องบอกตามจริง ไม่ใช่เทไปเข้าตัวที่เลือกอยู่',
   offReg.code === 'TUE-A' && offReg.from === 'unregistered', JSON.stringify(offReg));

const fallback = resolveEntity('PO-9001', { current: 'NSE', known: knownB });
ok('เลขบอกไม่ได้เลยก็ใช้ตัวที่เลือกอยู่', fallback.code === 'NSE' && fallback.from === 'current');

// ต้องบอกได้ว่าค่านี้มาจากไหน ไม่งั้นหน้าจอแยกไม่ออกว่าอันไหนเดา
ok('บอกที่มาของค่าได้ทุกกรณี',
   ['forced','guess','unregistered','current'].every(f =>
     [forced, guess, offReg, fallback].some(r => r.from === f)));
ok('ไม่มี PO เลยก็ไม่พัง', resolveEntity('', { current: 'NSE' }).code === 'NSE');

console.log('\n=== C. รายชื่อและข้อมูลประกอบ ===');
const list = [e1, makeEntity({ entity_code: 'TUE-U', store_location: 'คลัง B' }),
              makeEntity({ entity_code: 'เลิกใช้', active: false })];
ok('เอาเฉพาะที่ใช้งานอยู่ และเรียงให้',
   activeCodes(list).join(',') === 'TUE-H,TUE-U', activeCodes(list).join(','));
ok('หาข้อมูลของนิติบุคคลได้', infoOf(list, 'tue-u').store_location === 'คลัง B');
ok('หาไม่เจอตอบ null ไม่ใช่ระเบิด', infoOf(list, 'ไม่มี') === null);

// ยอดที่ไปกองอยู่ใต้ชื่อที่ไม่มีในทะเบียน = มองไม่เห็นบนหน้าจอ ต้องฟ้อง
ok('บอกรหัสที่โผล่ในข้อมูลแต่ยังไม่มีในทะเบียน',
   unknownEntities(list, ['TUE-H', 'TUE-A', 'tue-a', '']).join(',') === 'TUE-A',
   unknownEntities(list, ['TUE-H', 'TUE-A', 'tue-a', '']).join(','));
ok('ครบแล้วก็ไม่ฟ้องอะไร', unknownEntities(list, ['TUE-H']).length === 0);

console.log('\n=== D. เดาจากเลข PO (กฎเดิมจาก v1) ===');
ok('TM5266H177 → TUE-H', entityOfPo('TM5266H177') === 'TUE-H');
ok('TM4267U025 → TUE-U', entityOfPo('TM4267U025') === 'TUE-U');
ok('รูปแบบอื่นตอบว่าง ไม่ใช่เดามั่ว', entityOfPo('PO-9001') === '');

console.log('\n=== E. ใบ PO นี้เป็นของนิติบุคคลไหน (เจ้าของ 17 · 19 ก.ย. 2026) ===');
const known5 = ['NSE', 'TUE-H'];

// ⚠️ ห้ามดูคอลัมน์ผู้รับเหมาในไฟล์ (เจ้าของ 19 ก.ย. 2026 — Delta กรอกมาไม่ตรงเป็นบางใบ)
// ถ้าใครเอากลับมาใช้ ข้อนี้จะแดงทันที
ok('ดูจากรูปแบบเลขที่ PO อย่างเดียว คอลัมน์ผู้รับเหมาไม่มีผล',
   poOwnerOf('TM5266H177', { known: known5 }).code === 'TUE-H');
ok('บอกที่มาได้ว่าเป็นการเดาจากเลข',
   poOwnerOf('TM5266H177', { known: known5 }).from === 'guess');

// ต่างจาก resolveEntity ตรงที่ห้ามตกมาที่ "ตัวที่เลือกอยู่บนจอ" — ไม่งั้นทุกใบกลายเป็นของทุกคน
ok('เลขไม่เข้ารูปแบบ ต้องตอบว่าไม่รู้ ไม่ใช่ตอบเป็นคนที่ถาม',
   poOwnerOf('PO-9001', { known: known5 }).code === '' &&
   poOwnerOf('PO-9001', { known: known5 }).from === 'unknown');
ok('ค่าว่างไม่พัง', poOwnerOf(null).from === 'unknown' && poOwnerOf('').from === 'unknown');
ok('ไม่ส่งทะเบียนมาก็ยังเดาได้', poOwnerOf('TM5266H177').from === 'guess');

// รหัสที่ยังไม่มีในทะเบียนต้องไม่ถูกซ่อน — ไม่มีใครเลือกรหัสนั้นได้ ซ่อนแล้วจะไม่เหลือใครที่เห็น
const off = poOwnerOf('TM4267U025', { known: known5 });
ok('รหัสที่ยังไม่มีในทะเบียน ต้องบอกว่ายังไม่มี ไม่ใช่นับเป็นของคนอื่น',
   off.code === 'TUE-U' && off.from === 'unregistered', JSON.stringify(off));
ok('ทะเบียนตัวพิมพ์เล็กหรือมีช่องว่างก็เทียบได้',
   poOwnerOf('TM4267U025', { known: [' tue-u '] }).from === 'guess');

ok('ใบของตัวเองเห็น', poVisibleTo({ code: 'TUE-H', from: 'guess' }, 'TUE-H'));
ok('ใบของนิติบุคคลอื่นไม่เห็น', !poVisibleTo({ code: 'TUE-U', from: 'guess' }, 'TUE-H'));
ok('ใบที่เลขบอกไม่ได้ เห็นทุกนิติบุคคล (เจ้าของเลือก 17 ก.ย. 2026)',
   poVisibleTo({ code: '', from: 'unknown' }, 'TUE-H') && poVisibleTo({ code: '', from: 'unknown' }, 'TUE-U'));
ok('ใบของรหัสที่ยังไม่มีในทะเบียน เห็นทุกนิติบุคคล',
   poVisibleTo(off, 'TUE-H') && poVisibleTo(off, 'NSE'));
ok('ยังไม่ได้เลือกนิติบุคคล = เห็นหมด', poVisibleTo({ code: 'TUE-U', from: 'guess' }, ''));
ok('เทียบโดยไม่สนตัวพิมพ์และช่องว่าง', poVisibleTo({ code: 'TUE-H', from: 'guess' }, ' tue-h '));

console.log('\n=== F. ไม่มีใครกลับไปอ่านคอลัมน์ผู้รับเหมาอีก (เจ้าของ 19 ก.ย. 2026) ===');
/* คอลัมน์ผู้รับเหมา (ช่อง sub) ยังถูกเก็บไว้เป็นข้อมูลดิบ แต่ห้ามเอามาตัดสินนิติบุคคล
 * ด่านนี้อ่านซอร์สตรง ๆ เพราะบั๊กแบบนี้ไม่ทำให้อะไรพัง — มันแค่ทำให้ยอดไปผิดโรงงานเงียบ ๆ */
const src = f => readFileSync(new URL('../v2/' + f, import.meta.url), 'utf8');
const entSrc = src('master/entities.js');
const followSrc = src('master/follow.js');
const appSrc = src('app.js');
const pokitSrc = src('master/po-kit.js');

const reads = t => /\.sub\b/.test(t);
ok('entities.js ไม่อ่านช่อง sub', !reads(entSrc));
ok('follow.js ไม่อ่านช่อง sub', !reads(followSrc));
ok('app.js ไม่อ่านช่อง sub', !reads(appSrc));
ok('po-kit.js เก็บ sub ไว้ได้ แต่ไม่เอาไปตัดสินอะไร',
   /sub: String\(row\[1\]/.test(pokitSrc) && !reads(pokitSrc));

ok('resolveEntity ไม่รับรายการ PO เข้ามาแล้ว', !/resolveEntity\([^)]*poList/.test(appSrc + followSrc));
ok('หน้าคีย์รับเข้ารวมรายสัปดาห์ส่งทะเบียนนิติบุคคลเข้าไป',
   /resolveEntity\(l\.po, \{ forced: wkH\.entity, current: entity\.value,\s*\n?\s*known: entCodes\.value \}\)/.test(appSrc));

const calls = appSrc.match(/migrateAll\([^)]*\)/g) || [];
ok('migrateAll ทุกที่ในหน้าจอส่งทะเบียนนิติบุคคลเข้าไป ไม่งั้นจะไม่เติมให้เลย',
   calls.length >= 2 && calls.every(c => c.includes('known:')), calls.join(' | '));

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
