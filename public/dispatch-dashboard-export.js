/* XLSX report export. Uses inline strings so account names cannot become formulas. */
(function (root) {
  "use strict";
  const columns = [
    ["name", "Name"], ["surname", "Surname"], ["accounts", "User account(s)"],
    ["actions", "Contribution actions"], ["actionShare", "% of all actions"],
    ["dispatches", "Dispatches contributed"], ["dispatchShare", "% of dispatches"],
    ["communication", "Communication"], ["fieldChanges", "Field changes"],
    ["timeline", "Timeline"], ["evidence", "Evidence uploads"], ["other", "Workflow and other"]
  ];
  const xml = value => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function zip(files) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0;
    function crc32(bytes) {
      let crc = -1;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      return (crc ^ -1) >>> 0;
    }
    for (const [path, contents] of Object.entries(files)) {
      const name = encoder.encode(path), data = encoder.encode(contents), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(12, 33, true);
      l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true);
      l.setUint16(26, name.length, true); local.set(name, 30);
      const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
      chunks.push(local, data); directory.push(central); offset += local.length + data.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, directory.length, true); e.setUint16(10, directory.length, true);
    e.setUint32(12, directory.reduce((sum, entry) => sum + entry.length, 0), true); e.setUint32(16, offset, true);
    return new Blob([...chunks, ...directory, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  function workbook(data, period) {
    if (!Array.isArray(data.openedDispatches)) throw new TypeError("Opened dispatches are missing from the report.");
    const cell = (reference, value, style = 0) => typeof value === "number"
      ? `<c r="${reference}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`
      : `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    const row = (number, values, styles = []) => `<row r="${number}"${number === 6 ? ' ht="42" customHeight="1"' : ''}>${values.map((v, i) => cell(`${String.fromCharCode(65 + i)}${number}`, v, styles[i] || 0)).join("")}</row>`;
    const metrics = data.metrics;
    const body = row(2, ["Dispatch contribution report"], [3])
      + row(3, ["Dispatches", metrics.dispatches, "", "Contribution actions", metrics.actions, "", "Contributors", metrics.contributors], [1, 1, 0, 1, 1, 0, 1, 1])
      + row(4, [period]) + row(6, columns.map(c => c[1]), columns.map(() => 1))
      + data.contributors.map((entry, i) => row(i + 7, columns.map(c => entry[c[0]]), columns.map((c, index) => [4, 6].includes(index) ? 2 : 0))).join("");
    const openedPeriod = period.replace("Dispatch event period", "Dispatch opening period").replace("All dispatch event times", "All dispatch opening times");
    const openedBody = row(2, ["Opened dispatches"], [3])
      + row(3, ["Total dispatches opened", metrics.openedDispatches], [1, 1])
      + row(4, [openedPeriod]) + row(5, ["Counted by dispatch creation time."])
      + row(6, ["Operator", "Total dispatches opened"], [1, 1])
      + (data.openedDispatches.length
        ? data.openedDispatches.map((entry, i) => row(i + 7, [[entry.name, entry.surname].filter(Boolean).join(" "), entry.dispatches])).join("")
        : row(7, ["No dispatches opened for this period."]));
    const files = {
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Opened dispatches" sheetId="2" r:id="rId3"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF183759"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="0" numFmtId="164" xfId="0" applyNumberFormat="1"/><xf fontId="2" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="2" width="20" customWidth="1"/><col min="3" max="3" width="48" customWidth="1"/><col min="4" max="12" width="22" customWidth="1"/></cols><sheetData>${body}</sheetData><autoFilter ref="A6:L${Math.max(6, data.contributors.length + 6)}"/></worksheet>`
    };
    files["xl/worksheets/sheet2.xml"] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="46" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/></cols><sheetData>${openedBody}</sheetData><autoFilter ref="A6:B${Math.max(6, data.openedDispatches.length + 6)}"/></worksheet>`;
    return zip(files);
  }
  root.DispatchDashboardExport = { columns, workbook };
})(globalThis);
