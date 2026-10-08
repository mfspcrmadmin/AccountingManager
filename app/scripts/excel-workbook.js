(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  // Minimal OOXML workbook, packaged as a ZIP with stored entries. All text is
  // inline text (never a formula), preserving tax IDs and invoice numbers.
  function xml(value) {
    return String(value == null ? "" : value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function column(index) {
    var name = "";
    for (index += 1; index; index = Math.floor((index - 1) / 26)) { name = String.fromCharCode(65 + (index - 1) % 26) + name; }
    return name;
  }
  function zip(files) {
    var encoder = new TextEncoder(), chunks = [], directory = [], offset = 0, size = 0;
    files.forEach(function (file) {
      var name = encoder.encode(file[0]), data = encoder.encode(file[1]), crc = -1;
      data.forEach(function (byte) { crc ^= byte; for (var bit = 0; bit < 8; bit++) { crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } });
      crc = (crc ^ -1) >>> 0;
      var local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(12, 33, true);
      l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
      var central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
      chunks.push(local, data); directory.push(central); offset += local.length + data.length; size += central.length;
    });
    var end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob(chunks.concat(directory, [end]), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  ns.createExcelWorkbook = function (sheets) {
    var main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    var rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    var workbook = '<workbook xmlns="' + main + '" xmlns:r="' + rel + '"><sheets>', relationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">', files = [];
    sheets.forEach(function (sheet, index) {
      var id = index + 1;
      workbook += '<sheet name="' + xml(sheet.name) + '" sheetId="' + id + '" r:id="rId' + id + '"/>';
      relationships += '<Relationship Id="rId' + id + '" Type="' + rel + '/worksheet" Target="worksheets/sheet' + id + '.xml"/>';
      types += '<Override PartName="/xl/worksheets/sheet' + id + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      var rows = (sheet.preamble || []).concat([sheet.headers], sheet.rows);
      var headerRow = (sheet.preamble || []).length + 1;
      files.push(['xl/worksheets/sheet' + id + '.xml', '<worksheet xmlns="' + main + '"><sheetViews><sheetView workbookViewId="0"><pane ySplit="' + headerRow + '" topLeftCell="A' + (headerRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' + rows.map(function (row, ri) {
        return '<row r="' + (ri + 1) + '">' + row.map(function (value, ci) {
          var ref = column(ci) + (ri + 1);
          if (value && typeof value === 'object') {
            var style = value.format === 'date' ? 1 : value.format === 'money' ? 2 : value.format === 'percent' ? 3 : 0;
            var formula = value.formula ? '<f>' + xml(value.formula) + '</f>' : '';
            var cached = value.value;
            return '<c r="' + ref + '" s="' + style + '"' + (typeof cached === 'string' ? ' t="str"' : '') + '>' + formula + (cached == null ? '' : '<v>' + xml(cached) + '</v>') + '</c>';
          }
          return typeof value === 'number' && Number.isFinite(value)
            ? '<c r="' + ref + '"><v>' + value + '</v></c>'
            : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('') + '</sheetData><autoFilter ref="A' + headerRow + ':' + column(sheet.headers.length - 1) + rows.length + '"/>' + (sheet.merges ? '<mergeCells count="' + sheet.merges.length + '">' + sheet.merges.map(function (ref) { return '<mergeCell ref="' + xml(ref) + '"/>'; }).join('') + '</mergeCells>' : '') + '</worksheet>']);
    });
    types += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    relationships += '<Relationship Id="styles" Type="' + rel + '/styles" Target="styles.xml"/>';
    files.push(['xl/styles.xml', '<styleSheet xmlns="' + main + '"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>']);
    files.push(['[Content_Types].xml', types + '</Types>'], ['xl/workbook.xml', workbook + '</sheets></workbook>'], ['xl/_rels/workbook.xml.rels', relationships + '</Relationships>'], ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    return zip(files);
  };
}(window));
