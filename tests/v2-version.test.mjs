/**
 * เทสการตรวจเวอร์ชันและการล้าง cache — รันด้วย node
 *   node tests/v2-version.test.mjs
 *
 * หมวด C สำคัญที่สุด — ถ้าเลือกไฟล์ที่ต้องล้างผิดไปแม้ไฟล์เดียว
 * ผู้ใช้จะกดปุ่ม "โหลดใหม่" แล้วได้โค้ดใหม่ไม่ครบ โดยไม่มีอะไรฟ้อง
 * ซึ่งแย่กว่าไม่มีปุ่มเลย เพราะเขาจะเชื่อว่าอัปเดตแล้ว
 */
import fs from 'node:fs';
import { versionFromHtml, isStale, filesToBust } from '../v2/core/version.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ผ่าน  ' + name); }
  else { fail++; console.log('  ตก    ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('=== A. อ่านเวอร์ชันจากไฟล์บนเซิร์ฟเวอร์ ===');
ok('อ่านจากรูปแบบที่ใช้จริง',
   versionFromHtml('<meta name="app-version" content="2026-08-24.3">') === '2026-08-24.3');
ok('เครื่องหมายคำพูดเดี่ยวก็อ่านได้',
   versionFromHtml("<meta name='app-version' content='2026-08-24.3'>") === '2026-08-24.3');
ok('ตัวพิมพ์ใหญ่เล็กไม่สำคัญ',
   versionFromHtml('<META NAME="APP-VERSION" CONTENT="x">') === 'x');
ok('เว้นวรรคหลายช่องก็อ่านได้',
   versionFromHtml('<meta   name="app-version"   content="y">') === 'y');
ok('meta ตัวอื่นไม่ถูกหยิบมา',
   versionFromHtml('<meta name="viewport" content="width=device-width">') === '');
ok('หาไม่เจอคืนค่าว่าง ไม่ใช่โยน error',
   versionFromHtml('<html></html>') === '');
ok('ของพังไม่ระเบิด',
   versionFromHtml(null) === '' && versionFromHtml(undefined) === '' && versionFromHtml(123) === '');

// ต้องอ่านไฟล์จริงได้ ไม่ใช่อ่านได้แค่ตัวอย่างที่แต่งเอง
const real = fs.readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
ok('อ่านเวอร์ชันจาก v2/index.html ตัวจริงได้',
   /^\d{4}-\d{2}-\d{2}\.\d+$/.test(versionFromHtml(real)), versionFromHtml(real));

console.log('\n=== B. ตัดสินว่าต้องเตือนไหม ===');
ok('เวอร์ชันเดียวกันไม่ต้องเตือน', !isStale('2026-08-24.3', '2026-08-24.3'));
ok('เซิร์ฟเวอร์ใหม่กว่าต้องเตือน', isStale('2026-08-24.3', '2026-08-25.1'));
// ย้อนเวอร์ชันกลับเพราะรุ่นใหม่มีบั๊ก — เครื่องที่ค้างอยู่กับรุ่นนั้นต้องถูกดึงกลับมาด้วย
ok('เซิร์ฟเวอร์ย้อนกลับไปรุ่นเก่า ก็ยังต้องเตือน',
   isStale('2026-08-25.1', '2026-08-24.3'));
ok('อ่านเวอร์ชันจากเซิร์ฟเวอร์ไม่ได้ ไม่ถือว่าเก่า — อย่าเตือนมั่ว',
   !isStale('2026-08-24.3', '') && !isStale('2026-08-24.3', null));
ok('ไม่รู้เวอร์ชันตัวเองก็ไม่เตือน', !isStale('', '2026-08-25.1'));

console.log('\n=== C. ไฟล์ที่ต้องล้าง cache ===');
const BASE = 'https://nse-manufac.github.io/store/v2/';
const loaded = [
  BASE + 'app.js',
  BASE + 'core/db.js',
  BASE + 'core/sync.js',
  BASE + 'master/income-bom.js',
  BASE + 'lib/vue.global.prod.js',        // ไลบรารีตรึงเวอร์ชัน ไม่ต้องล้าง
  BASE + 'lib/xlsx.full.min.js',
  'https://nse-manufac.github.io/store/index.html',   // นอกโฟลเดอร์แอป
  'https://fonts.example.com/x.css',                  // คนละโดเมน
  BASE + 'style.css',
  BASE + 'core/db.js'                                 // ซ้ำ
];
const files = filesToBust(loaded, BASE);

ok('โมดูลของเราถูกล้างครบ',
   ['app.js', 'core/db.js', 'core/sync.js', 'master/income-bom.js', 'style.css']
     .every(f => files.includes(BASE + f)), JSON.stringify(files));
// ไฟล์ใหญ่ที่สุดในโปรเจกต์ และไม่เคยเปลี่ยนพร้อมโค้ดเรา — ดึงใหม่ทุกครั้งคือทรมานเน็ตโรงงานเปล่า ๆ
ok('lib/ ไม่ถูกดึงใหม่', !files.some(f => f.includes('/lib/')));
ok('ไฟล์นอกโฟลเดอร์แอปไม่ถูกแตะ',
   !files.includes('https://nse-manufac.github.io/store/index.html'));
ok('คนละโดเมนไม่ถูกแตะ', !files.some(f => f.includes('fonts.example.com')));
ok('ไฟล์ซ้ำนับครั้งเดียว',
   files.filter(f => f === BASE + 'core/db.js').length === 1);
// ถ้าไม่ล้าง index.html จะเห็นเลขเวอร์ชันเก่าค้างต่อไปอีกรอบ ทั้งที่โมดูลใหม่หมดแล้ว
ok('index.html อยู่ในรายการเสมอ แม้เบราว์เซอร์ไม่ได้นับเป็น resource',
   files.includes(BASE + 'index.html'));

ok('ตัวเดียวกันที่ต่อ query มา ถือเป็นไฟล์เดียวกัน',
   filesToBust([BASE + 'app.js?v=1', BASE + 'app.js?v=2'], BASE)
     .filter(f => f === BASE + 'app.js').length === 1);
ok('รูปกับ json ไม่ต้องล้าง',
   !filesToBust([BASE + 'a.png', BASE + 'b.json'], BASE).includes(BASE + 'a.png'));

ok('ไม่มี resource เลยก็ยังได้ index.html กลับไป',
   filesToBust([], BASE).length === 1);
ok('ของพังไม่ระเบิด',
   Array.isArray(filesToBust(null, BASE)) && Array.isArray(filesToBust([null, 5], BASE)));
ok('ไม่รู้ base ก็ไม่ไปล้างมั่วทั้งเบราว์เซอร์',
   filesToBust([BASE + 'app.js'], '').every(f => !f.includes('app.js')));

// ข้อนี้คือข้อที่กันไม่ให้บั๊กเดิมกลับมา — โมดูลที่เพิ่มใหม่ต้องถูกล้างด้วยเสมอ
// โดยไม่ต้องมีใครนึกได้ว่าต้องมาแก้รายชื่อไฟล์
const modules = fs.readdirSync(new URL('../v2/core/', import.meta.url))
  .filter(f => f.endsWith('.js')).map(f => BASE + 'core/' + f);
ok('โมดูลทุกตัวใน core/ ถูกล้างโดยไม่ต้องเขียนชื่อไว้ล่วงหน้า',
   modules.every(m => filesToBust(modules, BASE).includes(m)),
   String(modules.length) + ' ไฟล์');

console.log(`\n${fail === 0 ? '>>> ผ่านทั้งหมด' : '>>> มีข้อที่ไม่ผ่าน'} (${pass} ผ่าน · ${fail} ตก)`);
process.exit(fail === 0 ? 0 : 1);
