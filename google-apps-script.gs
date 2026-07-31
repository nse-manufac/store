/**
 * ระบบ Bin Card — Google Apps Script backend
 * ใช้คู่กับไฟล์ บันทึกสต็อก.html
 *
 * วิธีติดตั้งดูใน คู่มือติดตั้ง_GoogleSheets.md
 * แก้ TOKEN ด้านล่างเป็นรหัสของคุณเองก่อนใช้งานจริง
 */

// ═══════════ ตั้งค่า ═══════════
const TOKEN = 'CHANGE-ME-1234';   // ⚠️ ต้องเปลี่ยน และต้องตรงกับที่กรอกในโปรแกรม

const TXN_COLS = ['id','entity','direction','material_code','doc_ref','po_item','part_no',
  'date','time','qty','reqmt_qty','issued_qty','person','expiry_date','remark',
  'created_at','updated_at','voided','void_reason','device','batch'];
const MAT_COLS  = ['material_code','description','unit','category','requires_expiry','active'];
const ENT_COLS  = ['entity_code','company_name','address','store_location','vendor_no'];
const BOM_COLS  = ['pn','material_code','usage_per_pcs','unit','usage_varies'];
// POs และ Shortages ใช้ระบบ upsert ราย record เหมือน Transactions
// จึงต้องมีคอลัมน์ id กับ updated_at ด้วย ห้ามลบสองคอลัมน์นี้
const PO_COLS   = ['id','date','sub','pn','po','qty','core','remark','updated_at'];
const SHORT_COLS= ['id','date','po','code','type','qty','unit','eta','note','done','updated_at'];
// src = '' คือ Kit List รายวัน (22-H) · 'chem' คือกลุ่มจ่ายรวมรายสัปดาห์ (Tube/Chemical/Copper foil/Solder)
// orderQty / req มีเฉพาะกลุ่ม chem — ใช้เทียบกับ BOM
const KIT_COLS  = ['id','date','group','po','pn','code','desc','unit','issue',
                   'src','orderQty','req','remark','updated_at'];

// ═══════════ จุดเข้า ═══════════
function doGet(e)  { return handle(e, {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle(e, body);
}

function handle(e, body) {
  var p = e && e.parameter ? e.parameter : {};
  var action = body.action || p.action || 'ping';
  var token  = body.token  || p.token  || '';

  if (token !== TOKEN) return json({ ok: false, error: 'token ไม่ถูกต้อง' });

  try {
    switch (action) {
      case 'ping':      return json(doPing());
      case 'pullTxns':  return json(doPullTxns(body.since || p.since || ''));
      case 'pushTxns':  return json(doPushTxns(body.rows || [], body.device || ''));
      case 'pullSetup': return json(doPullSetup());
      case 'pushSetup': return json(doPushSetup(body));
      case 'pullRows':  return json(doPullRows(body.table || p.table, body.since || p.since || ''));
      case 'pushRows':  return json(doPushRows(body.table, body.rows || [], body.device || ''));
      case 'clearTable': return json(doClearTable(body.table, body.confirm));
      default:          return json({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════ ตัวช่วยจัดการชีต ═══════════
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheetOf(name, cols) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    s.setFrozenRows(1);
    return s;
  }
  // ชีตมีอยู่แล้วแต่หัวคอลัมน์อาจเก่ากว่าเวอร์ชันนี้ — เติมคอลัมน์ที่ขาดต่อท้ายให้
  var w = Math.max(1, s.getLastColumn());
  var head = s.getRange(1, 1, 1, w).getValues()[0].map(String);
  var missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    var start = head.filter(String).length + 1;
    s.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}

/** อ่านทั้งชีตเป็น array ของ object โดยอิงหัวคอลัมน์แถวแรก */
function readObjects(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var w = sheet.getLastColumn();
  var vals = sheet.getRange(1, 1, last, w).getValues();
  var head = vals[0].map(String);
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = {}, empty = true;
    for (var c = 0; c < head.length; c++) {
      var v = vals[i][c];
      if (v !== '' && v !== null) empty = false;
      o[head[c]] = v;
    }
    if (!empty) { o._row = i + 1; out.push(o); }
  }
  return out;
}

function toRow(obj, cols) {
  return cols.map(function (c) {
    var v = obj[c];
    return (v === undefined || v === null) ? '' : v;
  });
}

/** เขียนทับทั้งชีต (ใช้กับข้อมูลตั้งต้นเท่านั้น ไม่ใช้กับรายการเคลื่อนไหว) */
function replaceAll(sheet, cols, rows) {
  sheet.clear();
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, cols.length)
      .setValues(rows.map(function (r) { return toRow(r, cols); }));
  }
}

function nowIso() { return new Date().toISOString(); }

function meta(key, value) {
  var s = sheetOf('Meta', ['key', 'value']);
  var rows = readObjects(s);
  var hit = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].key) === key) hit = rows[i];
  if (value === undefined) return hit ? String(hit.value) : '';
  if (hit) s.getRange(hit._row, 2).setValue(value);
  else s.appendRow([key, value]);
  return value;
}

// ═══════════ คำสั่ง ═══════════
function doPing() {
  var t = sheetOf('Transactions', TXN_COLS);
  return {
    ok: true,
    serverTime: nowIso(),
    txnCount: Math.max(0, t.getLastRow() - 1),
    setupVersion: meta('setupVersion'),
    spreadsheet: ss().getName()
  };
}

/** ดึงรายการที่เปลี่ยนแปลงหลังเวลา since (ISO string) */
function doPullTxns(since) {
  var rows = readObjects(sheetOf('Transactions', TXN_COLS));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var u = String(r.updated_at || '');
    if (!since || u > since) {
      delete r._row;
      r.voided = (String(r.voided).toUpperCase() === 'TRUE');
      out.push(r);
    }
  }
  return { ok: true, serverTime: nowIso(), rows: out };
}

/** เพิ่มหรืออัปเดตรายการ — อิง id เป็นหลัก ใครแก้ทีหลังชนะ */
function doPushTxns(rows, device) {
  if (!rows.length) return { ok: true, serverTime: nowIso(), saved: 0 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };

  try {
    var sheet = sheetOf('Transactions', TXN_COLS);
    var last = sheet.getLastRow();

    // ทำดัชนี id -> เลขแถว ครั้งเดียว
    var index = {};
    if (last >= 2) {
      var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) index[String(ids[i][0])] = i + 2;
    }

    var stamp = nowIso();
    var appends = [];
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      if (!r.id) continue;
      r.updated_at = stamp;
      r.device = r.device || device || '';
      r.voided = r.voided ? 'TRUE' : 'FALSE';
      var at = index[String(r.id)];
      if (at) sheet.getRange(at, 1, 1, TXN_COLS.length).setValues([toRow(r, TXN_COLS)]);
      else appends.push(toRow(r, TXN_COLS));
    }
    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, TXN_COLS.length).setValues(appends);
    }
    SpreadsheetApp.flush();
    return { ok: true, serverTime: stamp, saved: rows.length, added: appends.length };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════ ตารางที่ upsert ราย record ได้ (POs / Shortages) ═══════════
var ROW_TABLES = { POs: PO_COLS, Shortages: SHORT_COLS, Kits: KIT_COLS };

function doPullRows(table, since) {
  var cols = ROW_TABLES[table];
  if (!cols) return { ok: false, error: 'ไม่รู้จักตาราง: ' + table };
  var rows = readObjects(sheetOf(table, cols));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!since || String(r.updated_at || '') > since) {
      delete r._row;
      if (table === 'Shortages') r.done = (String(r.done).toUpperCase() === 'TRUE');
      out.push(r);
    }
  }
  return { ok: true, serverTime: nowIso(), rows: out };
}

function doPushRows(table, rows, device) {
  var cols = ROW_TABLES[table];
  if (!cols) return { ok: false, error: 'ไม่รู้จักตาราง: ' + table };
  if (!rows.length) return { ok: true, serverTime: nowIso(), saved: 0 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };
  try {
    var sheet = sheetOf(table, cols);
    var last = sheet.getLastRow();
    var index = {};
    if (last >= 2) {
      var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) index[String(ids[i][0])] = i + 2;
    }
    var stamp = nowIso();
    var appends = [];
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      if (!r.id) continue;
      r.updated_at = stamp;
      if (table === 'Shortages') r.done = r.done ? 'TRUE' : 'FALSE';
      var at = index[String(r.id)];
      if (at) sheet.getRange(at, 1, 1, cols.length).setValues([toRow(r, cols)]);
      else appends.push(toRow(r, cols));
    }
    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, cols.length).setValues(appends);
    }
    SpreadsheetApp.flush();
    return { ok: true, serverTime: stamp, saved: rows.length, added: appends.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ล้างข้อมูลในชีต (เหลือแถวหัวตาราง)
 * ต้องส่ง confirm มาให้ตรงกับชื่อตาราง เพื่อกันเรียกพลาด
 * ล้างได้เฉพาะตารางที่เป็น "รายการเคลื่อนไหว" — ทะเบียนวัตถุดิบกับ BOM ล้างไม่ได้
 */
function doClearTable(table, confirm) {
  var allowed = { Transactions: TXN_COLS, POs: PO_COLS, Shortages: SHORT_COLS, Kits: KIT_COLS };
  var cols = allowed[table];
  if (!cols) return { ok: false, error: 'ล้างตารางนี้ไม่ได้: ' + table };
  if (confirm !== table) return { ok: false, error: 'confirm ไม่ตรงกับชื่อตาราง' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };
  try {
    var sheet = sheetOf(table, cols);
    var last = sheet.getLastRow();
    var removed = Math.max(0, last - 1);
    if (removed > 0) sheet.deleteRows(2, removed);
    SpreadsheetApp.flush();
    return { ok: true, serverTime: nowIso(), table: table, removed: removed };
  } finally {
    lock.releaseLock();
  }
}

function doPullSetup() {
  return {
    ok: true,
    setupVersion: meta('setupVersion'),
    materials: readObjects(sheetOf('Materials', MAT_COLS)).map(function (r) {
      return { material_code: String(r.material_code), description: String(r.description || ''),
               unit: String(r.unit || ''), category: String(r.category || ''),
               requires_expiry: String(r.requires_expiry || 'FALSE').toUpperCase(),
               active: String(r.active || 'TRUE').toUpperCase() };
    }),
    entities: readObjects(sheetOf('Entities', ENT_COLS)).map(function (r) {
      return { entity_code: String(r.entity_code), company_name: String(r.company_name || ''),
               store_location: String(r.store_location || ''), vendor_no: String(r.vendor_no || '') };
    }),
    bom: readObjects(sheetOf('BOM', BOM_COLS)).map(function (r) {
      return { pn: String(r.pn), code: String(r.material_code),
               usage: Number(r.usage_per_pcs) || 0, unit: String(r.unit || ''),
               varies: String(r.usage_varies).toUpperCase() === 'TRUE' };
    }),
    people: readObjects(sheetOf('People', ['name']))
      .map(function (r) { return String(r.name); }).filter(String),
    poList: doPullRows('POs', '').rows,
    shorts: doPullRows('Shortages', '').rows,
    kits:   doPullRows('Kits', '').rows
  };
}

/** อัปโหลดข้อมูลตั้งต้นจากเครื่องหนึ่ง แล้วเครื่องอื่นดึงไปใช้ */
function doPushSetup(body) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'ระบบกำลังถูกใช้งาน ลองใหม่อีกครั้ง' };
  try {
    if (body.materials) {
      replaceAll(sheetOf('Materials', MAT_COLS), MAT_COLS,
        body.materials.filter(function (m) { return String(m.active).toUpperCase() === 'TRUE'; }));
    }
    if (body.entities) replaceAll(sheetOf('Entities', ENT_COLS), ENT_COLS, body.entities);
    if (body.bom) {
      replaceAll(sheetOf('BOM', BOM_COLS), BOM_COLS, body.bom.map(function (b) {
        return { pn: b.pn, material_code: b.code, usage_per_pcs: b.usage,
                 unit: b.unit, usage_varies: b.varies ? 'TRUE' : 'FALSE' };
      }));
    }
    if (body.people) {
      replaceAll(sheetOf('People', ['name']), ['name'],
        body.people.map(function (p) { return { name: p }; }));
    }
    // POs / Shortages ไม่เขียนทับทั้งก้อนแล้ว — ใช้ upsert เพื่อไม่ให้ทับงานเครื่องอื่น
    if (body.poList) doPushRows('POs', body.poList, '');
    if (body.shorts) doPushRows('Shortages', body.shorts, '');
    if (body.kits)   doPushRows('Kits', body.kits, '');
    var v = nowIso();
    meta('setupVersion', v);
    SpreadsheetApp.flush();
    return { ok: true, setupVersion: v };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════ เมนูช่วยเหลือในสเปรดชีต ═══════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบ Bin Card')
    .addItem('สร้างชีตที่จำเป็นทั้งหมด', 'setupSheets')
    .addItem('ตรวจสอบสถานะ', 'showStatus')
    .addToUi();
}

function setupSheets() {
  sheetOf('Transactions', TXN_COLS);
  sheetOf('Materials', MAT_COLS);
  sheetOf('Entities', ENT_COLS);
  sheetOf('BOM', BOM_COLS);
  sheetOf('People', ['name']);
  sheetOf('POs', PO_COLS);
  sheetOf('Shortages', SHORT_COLS);
  sheetOf('Kits', KIT_COLS);
  sheetOf('Meta', ['key', 'value']);
  SpreadsheetApp.getUi().alert('สร้างชีตครบแล้ว');
}

function showStatus() {
  var s = doPing();
  SpreadsheetApp.getUi().alert(
    'รายการเคลื่อนไหว: ' + s.txnCount + '\n' +
    'ข้อมูลตั้งต้นอัปเดตล่าสุด: ' + (s.setupVersion || 'ยังไม่มี') + '\n' +
    'เวลาเซิร์ฟเวอร์: ' + s.serverTime);
}
