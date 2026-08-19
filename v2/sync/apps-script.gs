/**
 * ระบบ Bin Card v2 — ฝั่ง Google Sheets
 * ใช้คู่กับ v2/index.html · วิธีติดตั้งดูใน v2/sync/README.md
 *
 * ⚠️ สคริปต์นี้เป็นคนละตัวกับ google-apps-script.gs ของ v1 โดยตั้งใจ
 * ให้สร้างสเปรดชีตใหม่แยกจากของเดิม เหตุผลสองข้อ
 *   1. v1 ยังใช้งานจริงอยู่จนกว่าจะย้าย ถ้าไปแก้สคริปต์เดิมแล้วพลาด คือหยุดงานทั้งโรงงาน
 *   2. โครงรายการเคลื่อนไหวของ v2 ไม่เหมือน v1 (มีเจ็ดชนิดแทน IN/OUT · มีล็อต · มีเหตุผล)
 *      ถ้าเอามาปนชีตเดียวกัน จะอ่านย้อนหลังไม่รู้เรื่องทั้งสองฝั่ง
 * ของเดิมใน v1 จึงอยู่ครบเป็นบันทึกย้อนหลังต่อไป ไม่ต้องย้ายและไม่ต้องลบ
 */

// ═══════════ ตั้งค่า ═══════════
var TOKEN = 'CHANGE-ME-1234';   // ⚠️ ต้องเปลี่ยน และต้องตรงกับที่กรอกในโปรแกรม

/**
 * คอลัมน์ของแต่ละตาราง
 *
 * ⚠️ ห้ามลบ id / material_code และ updated_at
 * ตัวแรกคือกุญแจที่ใช้ upsert ตัวหลังคือสิ่งที่ทำให้ดึงเฉพาะของที่เปลี่ยนได้
 *
 * เพิ่มคอลัมน์ใหม่ให้ต่อท้ายเสมอ อย่าแทรกกลาง — sheetOf จะเติมหัวที่ขาดให้เอง
 * แต่ข้อมูลเดิมที่อยู่ใต้หัวเก่าจะไม่เลื่อนตามถ้าแทรกกลาง
 */
var TABLES = {
  Entries: {
    key: 'id',
    cols: ['id','entity','kind','material_code','qty','delta','counted_qty',
           'lot','lot_inferred','doc_kind','doc_ref','part_no','at','person','device',
           'reason_code','note','expiry_date','reqmt_qty','issued_qty','location',
           'voided','void_reason','void_by','void_at','created_at','updated_at'],
    bools: ['lot_inferred','voided'],
    // คอลัมน์ที่ต้องเป็นข้อความล้วน ไม่งั้นชีตจะแปลงเป็นตัวเลขหรือวันที่ให้เอง
    // รหัส 4010600100 จะกลายเป็นตัวเลข · เวลา ISO จะกลายเป็น Date แล้วเทียบ since ไม่ได้อีก
    texts: ['id','material_code','lot','doc_ref','part_no','at','expiry_date',
            'created_at','updated_at','void_at']
  },
  Materials: {
    key: 'material_code',
    cols: ['material_code','description','unit','category','requires_expiry','active',
           'needs_review','source','note','created_at','updated_at'],
    bools: ['requires_expiry','active','needs_review'],
    texts: ['material_code','created_at','updated_at']
  },
  BOM: {
    key: 'id',
    cols: ['id','pn','code','desc','usage','unit','rev','valid_from','lines','altPct',
           'uomConfirmed','uomWhy','rawQpa','rawUom','source','imported_at',
           'deleted','updated_at'],
    bools: ['uomConfirmed','deleted'],
    texts: ['id','pn','code','valid_from','imported_at','updated_at']
  },
  // สามตารางนี้มาจากไฟล์ที่ Delta ส่งมา เครื่องไหนนำเข้าก็ได้ แต่ทุกเครื่องต้องเห็นเหมือนกัน
  // ถ้าไม่ซิงค์ เครื่องที่ไม่ได้นำเข้าจะกางรายการรับเข้าจากสูตรแทน Kit List โดยไม่รู้ตัว
  POs: {
    key: 'id',
    cols: ['id','date','sub','pn','po','qty','core','remark','updated_at'],
    bools: [],
    texts: ['id','date','pn','po','updated_at']
  },
  Kits: {
    key: 'id',
    cols: ['id','date','group','po','pn','code','desc','unit','issue',
           'src','orderQty','req','remark','updated_at'],
    bools: [],
    texts: ['id','date','po','pn','code','updated_at']
  },
  Shorts: {
    key: 'id',
    cols: ['id','date','po','code','type','qty','unit','eta','note','done','updated_at'],
    bools: ['done'],
    texts: ['id','date','po','code','eta','updated_at']
  }
};

// ═══════════ จุดเข้า ═══════════
function doGet(e)  { return handle(e, {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle(e, body);
}

function handle(e, body) {
  var p = (e && e.parameter) ? e.parameter : {};
  var action = body.action || p.action || 'ping';
  if ((body.token || p.token || '') !== TOKEN) return json({ ok: false, error: 'token ไม่ถูกต้อง' });
  try {
    switch (action) {
      case 'ping':      return json(doPing());
      case 'pullTable': return json(doPullTable(body.table || p.table, body.since || p.since || ''));
      case 'pushTable': return json(doPushTable(body.table, body.rows || [], body.device || ''));
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

// ═══════════ ตัวช่วย ═══════════
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function nowIso() { return new Date().toISOString(); }

function sheetOf(name) {
  var def = TABLES[name];
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.getRange(1, 1, 1, def.cols.length).setValues([def.cols]).setFontWeight('bold');
    s.setFrozenRows(1);
    markTextColumns(s, def);
    return s;
  }
  // ชีตมีอยู่แล้วแต่หัวอาจเก่ากว่าสคริปต์รุ่นนี้ — เติมคอลัมน์ที่ขาดต่อท้าย
  var head = s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getValues()[0].map(String);
  var missing = [];
  for (var i = 0; i < def.cols.length; i++) {
    if (head.indexOf(def.cols[i]) < 0) missing.push(def.cols[i]);
  }
  if (missing.length) {
    var start = head.filter(String).length + 1;
    s.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    s.setFrozenRows(1);
    markTextColumns(s, def);
  }
  return s;
}

/**
 * บังคับให้คอลัมน์รหัสและเวลาเป็นข้อความล้วน
 *
 * ถ้าไม่ทำ ชีตจะแปลง 4010600100 เป็นตัวเลข และแปลง 2026-08-16T02:00:00.000Z เป็นวันที่
 * ผลคือรหัสที่ขึ้นต้นด้วยศูนย์จะเสียเลขหน้าไป และการดึงเฉพาะของที่เปลี่ยน (since) จะเทียบไม่ได้อีก
 * — พังแบบเงียบ ๆ ทั้งคู่ กว่าจะรู้ก็ตอนข้อมูลเพี้ยนไปแล้ว
 */
function markTextColumns(sheet, def) {
  var head = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(String);
  for (var i = 0; i < def.texts.length; i++) {
    var at = head.indexOf(def.texts[i]);
    if (at >= 0) sheet.getRange(2, at + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  }
}

function readObjects(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var vals = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
  var head = vals[0].map(String);
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = {}, empty = true;
    for (var c = 0; c < head.length; c++) {
      var v = vals[i][c];
      if (v !== '' && v !== null) empty = false;
      o[head[c]] = (v instanceof Date) ? v.toISOString() : v;
    }
    if (!empty) { o._row = i + 1; out.push(o); }
  }
  return out;
}

function toRow(obj, def) {
  return def.cols.map(function (c) {
    var v = obj[c];
    if (def.bools.indexOf(c) >= 0) return v ? 'TRUE' : 'FALSE';
    if (v === undefined || v === null) return '';
    // เติมเครื่องหมายคำพูดนำหน้าเพื่อบังคับเป็นข้อความไม่ได้ เพราะมันจะติดไปกับค่าตอนอ่านกลับ
    // จึงคุมด้วยรูปแบบตัวเลขของคอลัมน์แทน — ดู markTextColumns
    return v;
  });
}

// ═══════════ คำสั่ง ═══════════
function doPing() {
  var counts = {};
  for (var name in TABLES) counts[name] = Math.max(0, sheetOf(name).getLastRow() - 1);
  return { ok: true, serverTime: nowIso(), counts: counts, spreadsheet: ss().getName() };
}

/** ดึงเฉพาะแถวที่เปลี่ยนหลังเวลา since */
function doPullTable(table, since) {
  var def = TABLES[table];
  if (!def) return { ok: false, error: 'ไม่รู้จักตาราง: ' + table };
  var rows = readObjects(sheetOf(table));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // เทียบแบบ "ตั้งแต่เวลานี้" ไม่ใช่ "หลังเวลานี้" โดยตั้งใจ
    // แถวที่ประทับเวลาชนกับ serverTime ของการดึงรอบก่อนพอดี ถ้าใช้ > จะไม่ถูกส่งอีกเลยตลอดกาล
    // ส่งซ้ำเสียแค่แบนด์วิดท์ ฝั่งโปรแกรมรวมข้อมูลแบบเดิมซ้ำได้ไม่มีผลอยู่แล้ว
    // แต่ส่งขาดคือข้อมูลหาย — สองอย่างนี้ราคาไม่เท่ากัน
    if (since && String(r.updated_at || '') < since) continue;
    delete r._row;
    for (var b = 0; b < def.bools.length; b++) {
      r[def.bools[b]] = String(r[def.bools[b]]).toUpperCase() === 'TRUE';
    }
    out.push(r);
  }
  return { ok: true, serverTime: nowIso(), rows: out };
}

/**
 * เพิ่มหรืออัปเดตทีละแถว — ใครแก้ทีหลังชนะ
 *
 * ⚠️ ไม่มีคำสั่งไหนในสคริปต์นี้ที่เขียนทับทั้งตาราง โดยตั้งใจ
 * v1 ส่งทะเบียนขึ้นแบบล้างทั้งชีตแล้วเขียนใหม่เฉพาะรหัสที่ active
 * ผลคือรหัสที่ปิดใช้งานหายจากเซิร์ฟเวอร์ถาวร และเป็นรากของ INVARIANTS E3
 */
function doPushTable(table, rows, device) {
  var def = TABLES[table];
  if (!def) return { ok: false, error: 'ไม่รู้จักตาราง: ' + table };
  if (!rows.length) return { ok: true, serverTime: nowIso(), saved: 0, added: 0 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return { ok: false, error: 'มีเครื่องอื่นกำลังซิงค์อยู่ ลองใหม่อีกครั้ง' };
  try {
    var sheet = sheetOf(table);
    var last = sheet.getLastRow();
    var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var keyCol = head.indexOf(def.key) + 1;
    if (keyCol < 1) return { ok: false, error: 'ชีต ' + table + ' ไม่มีคอลัมน์ ' + def.key };

    // ทำดัชนีกุญแจ -> เลขแถว ครั้งเดียว แล้วใช้ตลอดก้อนนี้
    var index = {};
    if (last >= 2) {
      var keys = sheet.getRange(2, keyCol, last - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) index[String(keys[i][0])] = i + 2;
    }

    var stamp = nowIso();
    var appends = [];
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      if (!r[def.key] && r[def.key] !== 0) continue;
      r.updated_at = stamp;
      if (device && !r.device && def.cols.indexOf('device') >= 0) r.device = device;
      var at = index[String(r[def.key])];
      if (at) sheet.getRange(at, 1, 1, def.cols.length).setValues([toRow(r, def)]);
      else appends.push(toRow(r, def));
    }
    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, def.cols.length).setValues(appends);
    }
    SpreadsheetApp.flush();
    return { ok: true, serverTime: stamp, saved: rows.length, added: appends.length };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════ เมนูในสเปรดชีต ═══════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบ Bin Card v2')
    .addItem('สร้างชีตที่จำเป็นทั้งหมด', 'setupSheets')
    .addItem('ตรวจสอบสถานะ', 'showStatus')
    .addToUi();
}

function setupSheets() {
  for (var name in TABLES) sheetOf(name);
  SpreadsheetApp.getUi().alert('สร้างชีตครบแล้ว');
}

function showStatus() {
  var s = doPing();
  var lines = ['เวลาเซิร์ฟเวอร์: ' + s.serverTime];
  for (var k in s.counts) lines.push(k + ': ' + s.counts[k] + ' แถว');
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
