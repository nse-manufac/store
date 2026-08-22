/**
 * ออก Bin Card เป็น Excel ตามฟอร์มเดิม
 *
 * ── ทำไมต้องลอกมาทั้งดุ้น ────────────────────────────────────────
 * สไตล์ทุกช่องถอดมาจากไฟล์ Wire.xlsx ของจริง (เส้นตาราง ฟอนต์ Tahoma สีหัวตาราง
 * merged cell ความกว้างคอลัมน์ การตั้งค่าหน้ากระดาษ) ไฟล์ที่ออกไปมีคนรับต่อ
 * ถ้าหน้าตาเปลี่ยนแม้แต่นิดเดียวเขาจะรู้สึกทันทีว่าโปรแกรมเปลี่ยน
 * ตอนนี้จึงยกมาจาก v1 แบบไม่แก้ตรรกะเลยสักบรรทัด
 *
 * ⚠️ ห้ามแก้ค่าใน BINCARD_TPL โดยไม่มีไฟล์ต้นฉบับเทียบ
 * ตัวเลขในนี้ไม่ได้เดา แต่ถอดมาจากไฟล์จริงทีละช่อง
 *
 * ExcelJS ไม่ได้ import เข้ามาที่นี่ แต่รับเข้ามาเป็นพารามิเตอร์
 * เพราะไลบรารีตัวนี้หนัก 900 KB จะโหลดตอนกดออกไฟล์เท่านั้น ไม่ใช่ตอนเปิดโปรแกรม
 */
import { localDate, localTime } from '../core/localtime.js';
import { KINDS } from '../core/ledger.js';

export const BINCARD_TPL = {"style":{"B2":{"f":["Tahoma",24.0,1]},"C2":{"f":["Tahoma",24.0,1]},"D2":{"f":["Tahoma",24.0,1]},"B8":{"a":["center","",0]},"C8":{"a":["center","",0]},"D8":{"a":["center","",0]},"E8":{"a":["center","",0]},"F8":{"a":["center","",0]},"G8":{"a":["center","",0]},"H8":{"a":["center","",0]},"I8":{"a":["center","",0]},"J8":{"a":["center","",0]},"K8":{"a":["center","",0]},"L8":{"a":["center","",0]},"M8":{"a":["center","",0]},"N8":{"a":["center","",0]},"O8":{"a":["center","",0]},"P8":{"a":["center","",0]},"B9":{"f":["Tahoma",11.0,1],"b":"t-tt","a":["center","center",0],"fill":"FF00B0F0"},"C9":{"f":["Tahoma",8.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"D9":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"E9":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","",0],"fill":"FF00B0F0"},"F9":{"b":"--tt"},"G9":{"b":"--tt"},"H9":{"b":"-ttt"},"I9":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","",0],"fill":"FF00B0F0"},"J9":{"b":"--tt"},"K9":{"b":"-ttt"},"L9":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"M9":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"N9":{"f":["Tahoma",9.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"O9":{"f":["Tahoma",9.0,1],"b":"tttt","a":["center","center",1],"fill":"FF00B0F0"},"P9":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"B10":{"b":"t--t"},"C10":{"b":"tt-t"},"D10":{"b":"tt-t"},"E10":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"F10":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"G10":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"H10":{"f":["Tahoma",11.0,1],"b":"ttt-","a":["center","center",0],"fill":"FF00B0F0"},"I10":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"J10":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"K10":{"f":["Tahoma",11.0,1],"b":"tttt","a":["center","center",0],"fill":"FF00B0F0"},"L10":{"b":"tt-t"},"M10":{"b":"tt-t"},"N10":{"b":"tt-t"},"O10":{"b":"tt-t"},"P10":{"b":"tt-t"},"B11":{"b":"t--t","a":["center","",0]},"C11":{"b":"t--t","a":["center","",0]},"D11":{"b":"tttt","a":["center","",0]},"E11":{"b":"-ttt","a":["center","",0]},"F11":{"b":"tttt","a":["center","",0]},"G11":{"b":"tttt","a":["center","",0]},"H11":{"b":"tttt","a":["center","",0]},"I11":{"b":"tttt","a":["center","",0]},"J11":{"b":"tttt","a":["center","",0]},"K11":{"b":"tttt","a":["center","",0]},"L11":{"b":"tttt","a":["center","",0]},"M11":{"b":"-t-t","a":["center","",0]},"N11":{"b":"tt-t","a":["center","",0]},"O11":{"b":"tt-t","a":["center","",0]},"P11":{"b":"tt-t","a":["left","",0]},"B12":{"b":"tttt","a":["center","",0]},"D12":{"b":"tttt","a":["center","",0]},"E12":{"b":"-t-t","a":["center","",0]},"F12":{"b":"tt-t","a":["center","",0]},"G12":{"b":"tt-t","a":["center","",0]},"H12":{"b":"tt-t","a":["center","",0]},"I12":{"b":"tt-t","a":["center","",0]},"J12":{"b":"tt-t","a":["center","",0]},"K12":{"b":"tt-t","a":["center","",0]},"L12":{"b":"tttt","a":["center","",0]},"M12":{"b":"-t-t","a":["center","",0]},"N12":{"b":"tt-t","a":["center","",0]},"O12":{"b":"tttt","a":["center","",0]},"P12":{"b":"tttt","a":["left","",0]},"B13":{"b":"tttt","a":["center","",0]},"C13":{"b":"tttt","a":["center","",0]},"D13":{"b":"tt-t","a":["center","",0]},"E13":{"b":"tttt","a":["center","",0]},"F13":{"b":"tttt","a":["center","",0]},"G13":{"b":"tttt","a":["center","",0]},"H13":{"b":"tttt","a":["center","",0]},"I13":{"b":"tttt","a":["center","",0]},"J13":{"b":"tttt","a":["center","",0]},"K13":{"b":"tttt","a":["center","",0]},"L13":{"b":"tttt","a":["center","",0]},"M13":{"b":"-t-t","a":["center","",0]},"N13":{"b":"tt-t","a":["center","",0]},"O13":{"b":"tttt","a":["center","",0]},"P13":{"b":"tttt","a":["left","",0]},"B14":{"b":"tttt","a":["center","",0]},"C14":{"b":"tttt","a":["center","",0]},"D14":{"b":"tttt","a":["center","",0]},"E14":{"b":"tttt","a":["center","",0]},"F14":{"b":"tttt","a":["center","",0]},"G14":{"b":"tttt","a":["center","",0]},"H14":{"b":"tttt","a":["center","",0]},"I14":{"b":"tttt","a":["center","",0]},"J14":{"b":"tttt","a":["center","",0]},"K14":{"b":"tttt","a":["center","",0]},"L14":{"b":"tttt","a":["center","",0]},"M14":{"b":"-t-t","a":["center","",0]},"N14":{"b":"tt-t","a":["center","",0]},"O14":{"b":"tttt","a":["center","",0]},"P14":{"b":"tttt","a":["left","",0]},"B15":{"b":"tttt","a":["center","",0]},"C15":{"b":"tttt","a":["center","",0]},"D15":{"b":"tttt","a":["center","",0]},"E15":{"b":"tttt","a":["center","",0]},"F15":{"b":"tttt","a":["center","",0]},"G15":{"b":"tttt","a":["center","",0]},"H15":{"b":"tttt","a":["center","",0]},"I15":{"b":"tttt","a":["center","",0]},"J15":{"b":"tttt","a":["center","",0]},"K15":{"b":"tttt","a":["center","",0]},"L15":{"b":"tttt","a":["center","",0]},"M15":{"b":"-t-t","a":["center","",0]},"N15":{"b":"tt-t","a":["center","",0]},"O15":{"b":"tttt","a":["center","",0]},"P15":{"b":"tttt","a":["left","",0]},"B16":{"b":"tttt","a":["center","",0]},"C16":{"b":"tttt","a":["center","",0]},"D16":{"b":"tttt","a":["center","",0]},"E16":{"b":"tttt","a":["center","",0]},"F16":{"b":"tttt","a":["center","",0]},"G16":{"b":"tttt","a":["center","",0]},"H16":{"b":"tttt","a":["center","",0]},"I16":{"b":"tttt","a":["center","",0]},"J16":{"b":"tttt","a":["center","",0]},"K16":{"b":"tttt","a":["center","",0]},"L16":{"b":"tttt","a":["center","",0]},"M16":{"b":"-t-t","a":["center","",0]},"N16":{"b":"tt-t","a":["center","",0]},"O16":{"b":"tttt","a":["center","",0]},"P16":{"b":"tttt","a":["left","",0]},"B17":{"b":"tttt","a":["center","",0]},"C17":{"b":"tttt","a":["center","",0]},"D17":{"b":"tttt","a":["center","",0]},"E17":{"b":"tttt","a":["center","",0]},"F17":{"b":"tttt","a":["center","",0]},"G17":{"b":"tttt","a":["center","",0]},"H17":{"b":"tttt","a":["center","",0]},"I17":{"b":"tttt","a":["center","",0]},"J17":{"b":"tttt","a":["center","",0]},"K17":{"b":"tttt","a":["center","",0]},"L17":{"b":"tttt","a":["center","",0]},"M17":{"b":"-t-t","a":["center","",0]},"N17":{"b":"tt-t","a":["center","",0]},"O17":{"b":"tttt","a":["center","",0]},"P17":{"b":"tttt","a":["left","",0]},"B18":{"b":"tttt","a":["center","",0]},"C18":{"b":"tttt","a":["center","",0]},"D18":{"b":"tttt","a":["center","",0]},"E18":{"b":"tttt","a":["center","",0]},"F18":{"b":"tttt","a":["center","",0]},"G18":{"b":"tttt","a":["center","",0]},"H18":{"b":"tttt","a":["center","",0]},"I18":{"b":"tttt","a":["center","",0]},"J18":{"b":"tttt","a":["center","",0]},"K18":{"b":"tttt","a":["center","",0]},"L18":{"b":"tttt","a":["center","",0]},"M18":{"b":"-t-t","a":["center","",0]},"N18":{"b":"tt-t","a":["center","",0]},"O18":{"b":"tttt","a":["center","",0]},"P18":{"b":"tttt","a":["left","",0]},"B19":{"b":"tttt","a":["center","",0]},"C19":{"b":"tttt","a":["center","",0]},"D19":{"b":"tttt","a":["center","",0]},"E19":{"b":"tttt","a":["center","",0]},"F19":{"b":"tttt","a":["center","",0]},"G19":{"b":"tttt","a":["center","",0]},"H19":{"b":"tttt","a":["center","",0]},"I19":{"b":"tttt","a":["center","",0]},"J19":{"b":"tttt","a":["center","",0]},"K19":{"b":"tttt","a":["center","",0]},"L19":{"b":"tttt","a":["center","",0]},"M19":{"b":"-t-t","a":["center","",0]},"N19":{"b":"tttt","a":["center","",0]},"O19":{"b":"tttt","a":["center","",0]},"P19":{"b":"tttt","a":["left","",0]},"B20":{"b":"tttt","a":["center","",0]},"C20":{"b":"tttt","a":["center","",0]},"D20":{"b":"tttt","a":["center","",0]},"E20":{"b":"tttt","a":["center","",0]},"F20":{"b":"tttt","a":["center","",0]},"G20":{"b":"tttt","a":["center","",0]},"H20":{"b":"tttt","a":["center","",0]},"I20":{"b":"tttt","a":["center","",0]},"J20":{"b":"tttt","a":["center","",0]},"K20":{"b":"tttt","a":["center","",0]},"L20":{"b":"tttt","a":["center","",0]},"M20":{"b":"-t-t","a":["center","",0]},"N20":{"b":"tttt","a":["center","",0]},"O20":{"b":"tttt","a":["center","",0]},"P20":{"b":"tttt","a":["left","",0]},"B21":{"b":"tttt","a":["center","",0]},"C21":{"b":"tttt","a":["center","",0]},"D21":{"b":"tttt","a":["center","",0]},"E21":{"b":"tttt","a":["center","",0]},"F21":{"b":"tttt","a":["center","",0]},"G21":{"b":"tttt","a":["center","",0]},"H21":{"b":"tttt","a":["center","",0]},"I21":{"b":"tttt","a":["center","",0]},"J21":{"b":"tttt","a":["center","",0]},"K21":{"b":"tttt","a":["center","",0]},"L21":{"b":"tttt","a":["center","",0]},"M21":{"b":"-t-t","a":["center","",0]},"N21":{"b":"tttt","a":["center","",0]},"O21":{"b":"tttt","a":["center","",0]},"P21":{"b":"tttt","a":["left","",0]},"B22":{"b":"tttt","a":["center","",0]},"C22":{"b":"tttt","a":["center","",0]},"D22":{"b":"tttt","a":["center","",0]},"E22":{"b":"tttt","a":["center","",0]},"F22":{"b":"tttt","a":["center","",0]},"G22":{"b":"tttt","a":["center","",0]},"H22":{"b":"tttt","a":["center","",0]},"I22":{"b":"tttt","a":["center","",0]},"J22":{"b":"tttt","a":["center","",0]},"K22":{"b":"tttt","a":["center","",0]},"L22":{"b":"tttt","a":["center","",0]},"M22":{"b":"-t-t","a":["center","",0]},"N22":{"b":"tttt","a":["center","",0]},"O22":{"b":"tttt","a":["center","",0]},"P22":{"b":"tttt","a":["left","",0]},"B23":{"b":"tttt","a":["center","",0]},"C23":{"b":"tttt","a":["center","",0]},"D23":{"b":"tttt","a":["center","",0]},"E23":{"b":"tttt","a":["center","",0]},"F23":{"b":"tttt","a":["center","",0]},"G23":{"b":"tttt","a":["center","",0]},"H23":{"b":"tttt","a":["center","",0]},"I23":{"b":"tttt","a":["center","",0]},"J23":{"b":"tttt","a":["center","",0]},"K23":{"b":"tttt","a":["center","",0]},"L23":{"b":"tttt","a":["center","",0]},"M23":{"b":"-t-t","a":["center","",0]},"N23":{"b":"tttt","a":["center","",0]},"O23":{"b":"tttt","a":["center","",0]},"P23":{"b":"tttt","a":["left","",0]},"B24":{"b":"tttt","a":["center","",0]},"C24":{"b":"tttt","a":["center","",0]},"D24":{"b":"tttt","a":["center","",0]},"E24":{"b":"tttt","a":["center","",0]},"F24":{"b":"tttt","a":["center","",0]},"G24":{"b":"tttt","a":["center","",0]},"H24":{"b":"tttt","a":["center","",0]},"I24":{"b":"tttt","a":["center","",0]},"J24":{"b":"tttt","a":["center","",0]},"K24":{"b":"tttt","a":["center","",0]},"L24":{"b":"tttt","a":["center","",0]},"M24":{"b":"-t-t","a":["center","",0]},"N24":{"b":"tttt","a":["center","",0]},"O24":{"b":"tttt","a":["center","",0]},"P24":{"b":"tttt","a":["left","",0]},"B25":{"b":"tttt","a":["center","",0]},"C25":{"b":"tttt","a":["center","",0]},"D25":{"b":"tttt","a":["center","",0]},"E25":{"b":"tttt","a":["center","",0]},"F25":{"b":"tttt","a":["center","",0]},"G25":{"b":"tttt","a":["center","",0]},"H25":{"b":"tttt","a":["center","",0]},"I25":{"b":"tttt","a":["center","",0]},"J25":{"b":"tttt","a":["center","",0]},"K25":{"b":"tttt","a":["center","",0]},"L25":{"b":"tttt","a":["center","",0]},"M25":{"b":"-t-t","a":["center","",0]},"N25":{"b":"tttt","a":["center","",0]},"O25":{"b":"tttt","a":["center","",0]},"P25":{"b":"tttt","a":["left","",0]},"B26":{"b":"tttt","a":["center","",0]},"C26":{"b":"tttt","a":["center","",0]},"D26":{"b":"tttt","a":["center","",0]},"E26":{"b":"tttt","a":["center","",0]},"F26":{"b":"tttt","a":["center","",0]},"G26":{"b":"tttt","a":["center","",0]},"H26":{"b":"tttt","a":["center","",0]},"I26":{"b":"tttt","a":["center","",0]},"J26":{"b":"tttt","a":["center","",0]},"K26":{"b":"tttt","a":["center","",0]},"L26":{"b":"tttt","a":["center","",0]},"M26":{"b":"-t-t","a":["center","",0]},"N26":{"b":"tttt","a":["center","",0]},"O26":{"b":"tttt","a":["center","",0]},"P26":{"b":"tttt","a":["left","",0]},"B27":{"b":"tttt","a":["center","",0]},"C27":{"b":"tttt","a":["center","",0]},"D27":{"b":"tttt","a":["center","",0]},"E27":{"b":"tttt","a":["center","",0]},"F27":{"b":"tttt","a":["center","",0]},"G27":{"b":"tttt","a":["center","",0]},"H27":{"b":"tttt","a":["center","",0]},"I27":{"b":"tttt","a":["center","",0]},"J27":{"b":"tttt","a":["center","",0]},"K27":{"b":"tttt","a":["center","",0]},"L27":{"b":"tttt","a":["center","",0]},"M27":{"b":"-t-t","a":["center","",0]},"N27":{"b":"tttt","a":["center","",0]},"O27":{"b":"tttt","a":["center","",0]},"P27":{"b":"tttt","a":["left","",0]},"B28":{"b":"tttt","a":["center","",0]},"C28":{"b":"tttt","a":["center","",0]},"D28":{"b":"tttt","a":["center","",0]},"E28":{"b":"tttt","a":["center","",0]},"F28":{"b":"tttt","a":["center","",0]},"G28":{"b":"tttt","a":["center","",0]},"H28":{"b":"tttt","a":["center","",0]},"I28":{"b":"tttt","a":["center","",0]},"J28":{"b":"tttt","a":["center","",0]},"K28":{"b":"tttt","a":["center","",0]},"L28":{"b":"tttt","a":["center","",0]},"M28":{"b":"-t-t","a":["center","",0]},"N28":{"b":"tttt","a":["center","",0]},"O28":{"b":"tttt","a":["center","",0]},"P28":{"b":"tttt","a":["left","",0]}},"widths":{"A":7.38,"B":5.5,"C":13.75,"D":11.5,"E":9.12,"L":7.12,"M":11.88,"N":12.5,"O":12.62,"P":39.38,"Q":7.62},"heights":{"2":30.0},"merges":["B9:B10","C9:C10","D9:D10","E9:H9","I9:K9","L9:L10","M9:M10","N9:N10","O9:O10","P9:P10"],"page":{"orientation":"landscape","paper":9,"scale":71,"margins":[0.25,0.25,0.75,0.75],"printArea":"A1:Q32","zoom":70},"labels":{"B2":"Bin Card ","P2":"No. Doc…..................................","B4p":"Material code ….....","B5p":"Description…..","B6p":"Store Location…..","B7p":"Subcontract Name….","nums":{"B8":1,"C8":2,"E8":3,"F8":4,"G8":5,"H8":6,"I8":7,"J8":8,"K8":9,"L8":10,"M8":11,"N8":12,"O8":13,"P8":14},"head":{"B9":"No","C9":"Ref Doc No./SB PO DET","D9":"P/N","E9":"Receive mat'l","I9":"Issue Mat'l","L9":"Units","M9":"Balance","N9":"ผู้เบิก/ผู้รับ","O9":"วันหมดอายุ Raw Material","P9":"Remark","E10":"Date","F10":"Time ","G10":"Q'ty /PO","H10":"Units","I10":"Date","J10":"Time ","K10":"Q'ty"}},"firstRow":11,"lastRow":28,"totalRow":29};

/** ใส่สไตล์จาก template ลงในชีต ExcelJS
 *  dataRows = จำนวนแถวข้อมูลที่จะใช้จริง (ขั้นต่ำ 18 เท่าฟอร์มเดิม แต่ยาวกว่านั้นได้ไม่จำกัด
 *  — แถวเกิน 28 ไม่มีสไตล์ต้นฉบับให้ใช้ จึงลอกสไตล์ของแถว 28 ซึ่งเป็นแถวข้อมูล "กลาง" ทั่วไปมาซ้ำ) */
export function applyTpl(ws, dataRows = 18){
  const T = BINCARD_TPL;
  const lastData = 10 + dataRows;     // แถวข้อมูลแถวสุดท้าย (แถวแรกคือ 11)
  const totalRow = lastData + 1;
  const cloneStyle = (c, d) => {
    const [fn, fs, fb] = d.f || ['Tahoma', 11, 0];
    c.font = { name:fn, size:fs, bold:!!fb };
    if (d.b) {
      const map = { t:{ style:'thin' }, '-':undefined };
      c.border = { left:map[d.b[0]], right:map[d.b[1]], top:map[d.b[2]], bottom:map[d.b[3]] };
    }
    if (d.a) c.alignment = { horizontal:d.a[0] || undefined, vertical:d.a[1] || undefined, wrapText:!!d.a[2] };
    if (d.fill) c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:d.fill } };
  };
  for (const [addr, d] of Object.entries(T.style)) cloneStyle(ws.getCell(addr), d);
  // แถวข้อมูลที่ยาวเกินฟอร์มเดิม (เกินแถว 28) — ลอกสไตล์แถว 28 มาซ้ำให้ทุกแถวถัดไป
  if (lastData > T.lastRow) {
    for (let r = T.lastRow + 1; r <= lastData; r++)
      for (const col of 'BCDEFGHIJKLMNOP') {
        const src = T.style[col + T.lastRow];
        if (src) cloneStyle(ws.getCell(col + r), src);
      }
  }
  // ช่องที่ไม่มีสไตล์พิเศษ ก็ยังต้องเป็น Tahoma 11 ให้เหมือนต้นฉบับ
  for (let r = 1; r <= totalRow + 3; r++)
    for (const col of 'ABCDEFGHIJKLMNOPQ') {
      const c = ws.getCell(col + r);
      if (!c.font) c.font = { name:'Tahoma', size:11 };
    }
  for (const [col, w] of Object.entries(T.widths)) ws.getColumn(col).width = w;
  for (const [r, h] of Object.entries(T.heights)) ws.getRow(+r).height = h;
  for (const m of T.merges) ws.mergeCells(m);
  ws.pageSetup = {
    orientation:T.page.orientation, paperSize:T.page.paper, scale:T.page.scale,
    margins:{ left:T.page.margins[0], right:T.page.margins[1], top:T.page.margins[2],
              bottom:T.page.margins[3], header:0.3, footer:0.3 },
    printArea:`A1:Q${totalRow + 3}` };
  ws.views = [{ zoomScale:T.page.zoom }];
  const L = T.labels;
  ws.getCell('B2').value = L.B2;
  ws.getCell('P2').value = L.P2;
  for (const [a, v] of Object.entries(L.nums)) ws.getCell(a).value = v;
  for (const [a, v] of Object.entries(L.head)) ws.getCell(a).value = v;
}

/** สร้าง Bin Card 1 ใบเป็นชีตเดียว — รายการเรียงต่อเนื่องยาวไปเรื่อย ๆ ไม่ตัดหน้า 18 บรรทัดอีกต่อไป
 *  (การ์ดสั้นก็ยังได้ตารางเปล่าขั้นต่ำ 18 แถวเท่าฟอร์มเดิม ไม่ให้หน้าตาห้วนกว่าเดิม) */
export function writeCard(ws, info, rows){
  const R = Math.max(rows.length, BINCARD_TPL.lastRow - BINCARD_TPL.firstRow + 1);
  applyTpl(ws, R);
  const dots = (label, val, n) => label + String(val ?? '') + '.'.repeat(Math.max(4, n));
  ws.getCell('B4').value = dots(BINCARD_TPL.labels.B4p, info.code, 30);
  ws.getCell('B5').value = dots(BINCARD_TPL.labels.B5p, info.description, 20);
  ws.getCell('B6').value = dots(BINCARD_TPL.labels.B6p, info.store, 30);
  ws.getCell('B7').value = dots(BINCARD_TPL.labels.B7p, info.entity, 30);

  let r = BINCARD_TPL.firstRow;
  let sumIn = 0, sumOut = 0;
  for (const x of rows) {
    ws.getCell('B' + r).value = x.no;
    ws.getCell('C' + r).value = x.doc_ref || '';
    ws.getCell('D' + r).value = x.part_no || '';
    if (x.direction === 'IN') {
      ws.getCell('E' + r).value = x.date;
      ws.getCell('F' + r).value = x.time;
      ws.getCell('G' + r).value = x.qty;
      ws.getCell('H' + r).value = info.unit;
      sumIn += +x.qty || 0;
    } else {
      ws.getCell('I' + r).value = x.date;
      ws.getCell('J' + r).value = x.time;
      ws.getCell('K' + r).value = x.qty;
      sumOut += +x.qty || 0;
    }
    ws.getCell('L' + r).value = info.unit;
    ws.getCell('M' + r).value = x.bal;
    ws.getCell('N' + r).value = x.person || '';
    ws.getCell('O' + r).value = x.expiry_date || '';
    ws.getCell('P' + r).value = x.remark || '';
    r++;
  }
  // แถวรวม: นับเฉพาะคอลัมน์จำนวน — ต้นฉบับเดิมรวมคอลัมน์ Time มาด้วยซึ่งไม่มีความหมาย
  const t = BINCARD_TPL.firstRow + R;
  ws.getCell('G' + t).value = Math.round(sumIn  * 1e5) / 1e5;
  ws.getCell('K' + t).value = Math.round(sumOut * 1e5) / 1e5;
}

/**
 * แปลงบรรทัดในสมุด v2 ให้เป็นรูปแบบที่ writeCard เข้าใจ
 *
 * ── จุดที่ v2 ต่างจาก v1 ────────────────────────────────────────
 * v1 มีแค่ IN กับ OUT ส่วน v2 มีเจ็ดชนิด ฟอร์มมีแค่สองฝั่ง จึงต้องเลือกฝั่งจากผลที่มีต่อยอด
 * ชนิดที่ไม่ใช่รับเข้า/จ่ายออกจะถูกเขียนกำกับไว้ในช่อง Remark ด้วย
 * เพราะคนอ่านการ์ดต้องแยกออกว่า "ของเสีย 5" ไม่ใช่ "จ่ายออก 5"
 * ถ้าปล่อยให้ทั้งสองอย่างหน้าตาเหมือนกัน ตัวเลขในฟอร์มจะโกหกโดยที่ไม่มีใครรู้
 *
 * rows = ผลจาก cardRows() ซึ่งมี moved (มีเครื่องหมาย) และ balance (ยอดสะสม) มาให้แล้ว
 */
export function toCardLines(rows, unit = '') {
  let no = 0;
  return rows.map(r => {
    const label = (KINDS[r.kind] || {}).label || r.kind;
    const extra = [];
    if (r.kind !== 'receive' && r.kind !== 'issue') extra.push(label);
    if (r.lot) extra.push('ล็อต ' + r.lot + (r.lot_inferred ? ' (ระบบเดา)' : ''));
    if (r.kind === 'adjust' && r.counted_qty != null) extra.push('นับได้ ' + r.counted_qty);
    if (r.note) extra.push(r.note);
    return {
      no: ++no,
      doc_ref: r.doc_ref || '',
      part_no: r.part_no || '',
      // ปรับยอดขึ้นถือเป็นฝั่งรับ ปรับลงถือเป็นฝั่งจ่าย ตามผลที่มีต่อยอดจริง
      direction: r.moved >= 0 ? 'IN' : 'OUT',
      date: localDate(r.at),
      time: localTime(r.at),
      qty: Math.abs(r.moved),
      bal: r.balance,
      person: r.person || '',
      expiry_date: r.expiry_date || '',
      remark: extra.join(' · '),
      unit
    };
  });
}

/** ชื่อชีตห้ามเกิน 31 ตัวและห้ามมีอักขระต้องห้าม — 1 รหัส = 1 ชีตเสมอ */
export const sheetNameFor = code => String(code).replace(/[\/:*?[\]]/g, '-').slice(0, 31);

/** ชื่อโฟลเดอร์/ไฟล์ในซิป — หมวดที่มีอักขระต้องห้ามจะทำให้ซิปเปิดไม่ออกบางเครื่อง */
export const safeFileName = s => String(s || 'OTHER').replace(/[\/:*?"<>|]/g, '-');
