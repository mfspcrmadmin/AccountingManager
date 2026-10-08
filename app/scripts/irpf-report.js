(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var headers = ['Supplier', 'CIF/NIF', 'Booking', 'Invoice date', 'Invoice', 'Invoice Amount Excl VAT', 'Invoice Amount Incl VAT', 'IRPF', 'Currency', 'Type', 'Status', 'Supplier ID', 'Invoice ID'];
  var fields = ['id', 'Name', 'Supplier', 'Booking', 'Invoice_Date', 'Invoice_Amount_Excl_VAT', 'Invoice_Amount_Incl_VAT', 'Additional_Amount_Excl_VAT', 'Additional_Amount_Incl_VAT', 'IRPF_Amount', 'Additional_IRPF_Amount', 'Currency', 'Invoice_Type', 'Status'];
  function text(value) { return String(value == null ? '' : value).trim(); }
  function cents(value) {
    if (value == null || value === '') { return 0; }
    if (!Number.isFinite(Number(value))) { throw new Error('Invalid invoice amount. Correct the CRM record before exporting.'); }
    return Math.round(Number(value) * 100);
  }
  function spain(value) { return /^(spain|españa|espana|es|esp)$/i.test(text(value)); }
  function dateValid(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
  function validate(options) {
    if (!dateValid(options.from) || !dateValid(options.to) || options.from > options.to) { throw new Error('Choose a valid invoice date range.'); }
    if (!['Country', 'Mailing_Country', 'Pais'].includes(options.countryField)) { throw new Error('Choose the supplier country field.'); }
  }
  ns.buildIrpfReport = function (invoices, suppliers, options) {
    validate(options);
    var detail = [], review = [], groups = new Map(), seen = new Set();
    invoices.forEach(function (invoice) {
      if (seen.has(invoice.id)) { return; } seen.add(invoice.id);
      if (invoice.Invoice_Date < options.from || invoice.Invoice_Date > options.to) { return; }
      var primary = cents(invoice.IRPF_Amount), additional = cents(invoice.Additional_IRPF_Amount);
      if (!primary && !additional) { return; }
      var supplierId = text(invoice.Supplier && invoice.Supplier.id), supplier = suppliers[supplierId] || {};
      var country = text(supplier[options.countryField]), reasons = [];
      if (country && !spain(country)) { return; }
      if (!supplierId || !supplier.id) { reasons.push('Missing supplier'); }
      if (!country) { reasons.push('Missing supplier country'); }
      if (!(supplier.Is_Self_Employed === true || supplier.Is_Self_Employed === 'true')) { reasons.push('Supplier is not marked self-employed'); }
      if (!text(supplier.CIF_NIF)) { reasons.push('Missing CIF/NIF'); }
      if (/^(Cancelled|Canceled|Rejected|Draft)$/i.test(text(invoice.Status))) { reasons.push('Excluded status: ' + invoice.Status); }
      if (!['Final Invoice', 'Credit Note', 'Tickets', 'Commission'].includes(invoice.Invoice_Type)) { reasons.push('Review invoice type: ' + (invoice.Invoice_Type || 'missing')); }
      if (!text(invoice.Currency)) { reasons.push('Missing currency'); }
      if (!text(invoice.Name)) { reasons.push('Missing invoice number'); }
      if (invoice.Invoice_Amount_Excl_VAT == null || invoice.Invoice_Amount_Incl_VAT == null) { reasons.push('Missing invoice amount'); }
      var credit = invoice.Invoice_Type === 'Credit Note';
      function signed(value) { return credit ? -Math.abs(value) : value; }
      var net = signed(cents(invoice.Invoice_Amount_Excl_VAT) + cents(invoice.Additional_Amount_Excl_VAT));
      var gross = signed(cents(invoice.Invoice_Amount_Incl_VAT) + cents(invoice.Additional_Amount_Incl_VAT));
      var irpf = signed(primary + additional);
      var row = [supplier.Vendor_Name || invoice.Supplier && invoice.Supplier.name || '', text(supplier.CIF_NIF), invoice.Booking && invoice.Booking.name || '', invoice.Invoice_Date, invoice.Name || '', net / 100, gross / 100, irpf / 100, invoice.Currency || '', invoice.Invoice_Type || '', invoice.Status || '', supplierId, text(invoice.id)];
      if (reasons.length) { review.push(row.concat([country, reasons.join('; ')])); return; }
      detail.push(row);
      var key = supplierId + '|' + invoice.Currency;
      if (!groups.has(key)) { groups.set(key, { supplier: row[0], nif: row[1], count: 0, net: 0, gross: 0, irpf: 0, currency: invoice.Currency, id: supplierId }); }
      var group = groups.get(key); group.count++; group.net += net; group.gross += gross; group.irpf += irpf;
    });
    detail.sort(function (a, b) { return a[0].localeCompare(b[0]) || a[3].localeCompare(b[3]) || a[4].localeCompare(b[4]); });
    var summary = Array.from(groups.values()).sort(function (a, b) { return a.supplier.localeCompare(b.supplier) || a.currency.localeCompare(b.currency); }).map(function (g) { return [g.supplier, g.nif, g.count, g.net / 100, g.gross / 100, g.irpf / 100, g.currency, g.id]; });
    return { detail: detail, review: review, summary: summary, supplierCount: new Set(detail.map(function (r) { return r[11]; })).size, options: Object.assign({}, options) };
  };
  ns.loadIrpfReport = async function (crm, options, progress) {
    validate(options);
    var invoices = [], seen = new Set(), last = '', suppliers = {};
    // Keyset pagination avoids the offset ceiling and never silently truncates.
    while (true) {
      var where = "(Invoice_Date >= '" + options.from + "' and Invoice_Date <= '" + options.to + "')";
      if (last) { where = '(' + where + ' and id > ' + last + ')'; }
      var batch = await crm.coql('select ' + fields.join(', ') + ' from Supplier_Invoices where ' + where + ' order by id asc limit 200', { strict: true });
      if (!Array.isArray(batch)) { throw new Error('Could not read all invoices.'); }
      batch.forEach(function (invoice) {
        var id = text(invoice.id);
        if (!/^\d+$/.test(id) || seen.has(id) || (last && BigInt(id) <= BigInt(last))) { throw new Error('Incomplete invoice pagination. Please retry.'); }
        seen.add(id);
      });
      invoices = invoices.concat(batch);
      if (progress) { progress('Read ' + invoices.length + ' invoices…'); }
      if (batch.length < 200) { break; }
      last = text(batch[batch.length - 1].id);
    }
    var ids = Array.from(new Set(invoices.filter(function (r) { return cents(r.IRPF_Amount) || cents(r.Additional_IRPF_Amount); }).map(function (r) { return text(r.Supplier && r.Supplier.id); }).filter(Boolean)));
    for (var offset = 0; offset < ids.length; offset += 5) {
      await Promise.all(ids.slice(offset, offset + 5).map(async function (id) {
        var supplier = await crm.getRecord('Vendors', id);
        if (!supplier || text(supplier.id) !== id) { throw new Error('Could not read supplier ' + id + '. No partial report was generated.'); }
        suppliers[id] = supplier;
      }));
      if (progress) { progress('Read ' + Math.min(offset + 5, ids.length) + ' of ' + ids.length + ' suppliers…'); }
    }
    return ns.buildIrpfReport(invoices, suppliers, options);
  };
  ns.irpfReportSheets = function (report) {
    return [
      { name: 'Detail', headers: headers, rows: report.detail },
      { name: 'Supplier summary', headers: ['Supplier', 'CIF/NIF', 'Invoices', 'Amount Excl VAT', 'Amount Incl VAT', 'IRPF', 'Currency', 'Supplier ID'], rows: report.summary },
      { name: 'Review', headers: headers.concat(['Country', 'Review reason']), rows: report.review },
      { name: 'Criteria', headers: ['Criterion', 'Value'], rows: [
        ['Invoice date from (inclusive)', report.options.from], ['Invoice date to (inclusive)', report.options.to], ['Country', 'Spain'], ['Supplier country field', report.options.countryField],
        ['Selection', 'Nonzero IRPF_Amount or Additional_IRPF_Amount; self-employed supplier. Review rows are excluded from detail and summary.'],
        ['Amounts', 'Primary + additional amounts. Credit notes subtract. Stored currency; currencies are not combined.'],
        ['Date basis', 'Invoice_Date, not payment date.'], ['Invoice number', 'Name (Invoice Number)'],
        ['Supplier data', 'Current CRM supplier data at report generation.'], ['Generated at', new Date().toISOString()]
      ] }
    ];
  };
  ns.initIrpfReport = function (crm) {
    var el = function (id) { return document.getElementById('irpf-' + id); }, report = null;
    var panel = el('panel'); if (!panel) { return; }
    var controls = Array.from(panel.querySelectorAll('input, select, button'));
    var year = new Date().getFullYear(); el('year').value = year; el('quarter').value = Math.floor(new Date().getMonth() / 3) + 1;
    function preset() {
      var y = Number(el('year').value), q = Number(el('quarter').value);
      if (!Number.isInteger(y) || y < 1900 || y > 9999 || !q) { return; }
      el('from').value = y + '-' + String((q - 1) * 3 + 1).padStart(2, '0') + '-01';
      el('to').value = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
    }
    function invalidate() { report = null; el('export').disabled = true; el('results').hidden = true; el('message').textContent = 'Generate a preview for the selected period.'; }
    preset();
    el('open').addEventListener('click', function () { panel.hidden = !panel.hidden; el('open').setAttribute('aria-expanded', String(!panel.hidden)); });
    ['year', 'quarter'].forEach(function (id) { el(id).addEventListener('change', function () { preset(); invalidate(); }); });
    ['from', 'to'].forEach(function (id) { el(id).addEventListener('input', function () { el('quarter').value = ''; invalidate(); }); });
    function table(target, titles, rows) {
      target.replaceChildren();
      var head = document.createElement('thead'), tr = document.createElement('tr');
      titles.forEach(function (title) { var th = document.createElement('th'); th.textContent = title; tr.appendChild(th); }); head.appendChild(tr); target.appendChild(head);
      var body = document.createElement('tbody'); rows.slice(0, 100).forEach(function (row) { var line = document.createElement('tr'); row.forEach(function (value) { var cell = document.createElement('td'); cell.textContent = typeof value === 'number' ? value.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : value; line.appendChild(cell); }); body.appendChild(line); }); target.appendChild(body);
    }
    el('generate').addEventListener('click', async function () {
      invalidate(); controls.forEach(function (control) { control.disabled = true; });
      try {
        report = await ns.loadIrpfReport(crm, { from: el('from').value, to: el('to').value, countryField: 'Country' }, function (message) { el('message').textContent = message; });
        var totals = {}; report.summary.forEach(function (r) { totals[r[6]] = (totals[r[6]] || 0) + cents(r[5]); });
        el('message').textContent = report.detail.length + ' invoices · ' + report.supplierCount + ' suppliers · IRPF: ' + (Object.keys(totals).map(function (currency) { return (totals[currency] / 100).toFixed(2) + ' ' + currency; }).join(' / ') || '0') + ' · ' + report.review.length + ' records to review (excluded from totals).';
        table(el('detail'), headers.slice(0, 11), report.detail.map(function (r) { return r.slice(0, 11); }));
        table(el('summary'), ns.irpfReportSheets(report)[1].headers, report.summary);
        table(el('review'), ['Supplier', 'Invoice', 'Country', 'Review reason'], report.review.map(function (r) { return [r[0], r[4], r[13], r[14]]; }));
        el('results').hidden = false;
      } catch (error) { report = null; el('message').textContent = error.message || 'Could not generate the report. Please retry.'; }
      finally { controls.forEach(function (control) { control.disabled = false; }); el('export').disabled = !report || !(report.detail.length || report.review.length); }
    });
    el('export').addEventListener('click', function () {
      if (!report) { return; }
      var url = URL.createObjectURL(ns.createExcelWorkbook(ns.irpfReportSheets(report))), link = document.createElement('a');
      link.href = url; link.download = 'IRPF-Spain-' + report.options.from + '-' + report.options.to + '.xlsx'; document.body.appendChild(link); link.click(); link.remove(); global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  };
}(window));
