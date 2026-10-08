(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var fields = ['id', 'Booking_Won_Date', 'MFSP_Reference', 'Deal_Name', 'Account_Name', 'Sales_Rep', 'Reservation_Rep', 'Arrival_Date', 'Departure_Date', 'Travellers_Number', 'Stage', 'Contact_Name', 'Agent_Email', 'IATA_Code', 'Consortia', 'Trip_Type', 'Sales_Price_inc_Taxes', 'Purchase_Price_inc_Taxes', 'Final_Commission'];
  function validate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error('Choose a valid Booking Won date.');
    }
  }
  function label(value) { return value && typeof value === 'object' ? value.name || value.full_name || value.Full_Name || '' : value || ''; }
  fields.push('Ezus_Project_ID');
  ns.loadBookingWonReport = async function (crm, date, stages) {
    validate(date);
    if (Array.isArray(stages) && !stages.length) { throw new Error('Select at least one booking stage.'); }
    var records = [], seen = new Set(), last = '';
    while (true) {
      var where = "(Booking_Won_Date = '" + date + "' and Ezus_Project_ID is not null)";
      if (last) { where = '(' + where + ' and id > ' + last + ')'; }
      var batch = await crm.coql('select ' + fields.join(', ') + ' from Deals where ' + where + ' order by id asc limit 200', { strict: true });
      if (!Array.isArray(batch)) { throw new Error('Could not read bookings. Please retry.'); }
      batch.forEach(function (record) {
        var id = String(record.id || '');
        if (!/^\d+$/.test(id) || seen.has(id) || (last && BigInt(id) <= BigInt(last)) || record.Booking_Won_Date !== date) {
          throw new Error('Incomplete or inconsistent booking results. Please retry.');
        }
        seen.add(id); last = id;
        if (String(record.Ezus_Project_ID || '').trim() && (!Array.isArray(stages) || stages.indexOf(record.Stage) !== -1)) { records.push(record); }
      });
      if (batch.length < 200) { break; }
    }
    // COQL/SDK lookup results may contain only an ID. Resolve display values
    // from the record endpoint before building either preview or workbook.
    var lookupFields = ['Sales_Rep', 'Reservation_Rep', 'Contact_Name'];
    var unresolved = records.filter(function (record) {
      return lookupFields.some(function (field) { return record[field] && !label(record[field]); });
    });
    for (var offset = 0; offset < unresolved.length; offset += 5) {
      await Promise.all(unresolved.slice(offset, offset + 5).map(async function (record) {
        var full = await crm.getRecord('Deals', record.id);
        if (!full || String(full.id) !== String(record.id)) { throw new Error('Could not resolve booking contact and representative names. Please retry.'); }
        lookupFields.forEach(function (field) {
          if (record[field] && !label(record[field])) {
            if (!label(full[field])) { throw new Error('Could not read ' + field + ' name for booking ' + record.id + '.'); }
            record[field] = full[field];
          }
        });
      }));
    }
    var agencies = {};
    var ids = Array.from(new Set(records.map(function (r) { return r.Account_Name && r.Account_Name.id; }).filter(Boolean)));
    for (var i = 0; i < ids.length; i++) {
      var agency = await crm.getRecord('Accounts', ids[i]);
      if (!agency || String(agency.id) !== String(ids[i])) { throw new Error('Could not read agency ' + ids[i] + '. Please retry.'); }
      agencies[ids[i]] = agency;
    }
    return { date: date, records: records, agencies: agencies };
  };
  function number(value) {
    if (value == null || value === '') { return ''; }
    var n = Number(value); if (!Number.isFinite(n)) { throw new Error('Invalid booking amount or PAX.'); } return n;
  }
  function money(value) { var n = number(value); return n === '' ? '' : { value: n, format: 'money' }; }
  function dateCell(value) {
    if (!value) { return ''; } validate(value);
    return { value: Date.parse(value) / 86400000 + 25569, format: 'date' };
  }
  function formula(text, value, format) { return { formula: text, value: value, format: format || 'money' }; }
  ns.bookingWonReportSheets = function (report, type) {
    var sales = type !== 'invoices', year = report.date.slice(0, 4);
    var headers = sales
      ? ['MFSP', '# REF', 'Agencia', 'Cliente', 'Pax', 'MfS Sales', 'Grupo', 'Check in', 'Check out', 'Mes', 'TOTAL PVP', 'TOTAL COST', 'GROSS PROFIT', 'NET PROFIT', 'IVA 21%', 'NET SALE', 'TOTAL PVP', 'Gross Margin', '\u20ac', 'NET Margin']
      : ['N\u00ba Tourplan', '# REF', 'Groups', 'FIT', 'Small FIT', 'Shorex', 'S. Services', 'Agent Trip', 'MfS OPS', 'MfS Sales', '# Invoice', 'Date', 'Travelers', 'Pax', 'Aviso', 'Cobro', 'Check in', 'Check out', 'Agency', 'Parent Agency', 'Nombre Agente', "Agent's e-mail", 'IATA #', 'Address', 'City', 'State', 'Zip code', 'Country', 'Phone number', 'GROUP', 'Total Invoice', 'Commission', 'NET SALE', 'EST. COST', 'NET Profit', 'Amount', 'Charged', 'Balance', 'Date', 'Charged', 'Payment', '', 'Gross sale', 'Acum.', 'Profit', 'Acum', 'Date'];
    var group = Array(headers.length).fill('');
    if (sales) { group[7] = 'FECHAS INICIO / FIN VIAJE'; group[17] = '%'; group[18] = 'COMISSION'; }
    else { group[2] = 'TRIP CATEGORY'; group[16] = 'DATES OF THE TRIP'; group[23] = 'AGENCY INFORMATION'; group[35] = 'DEPOSIT'; group[37] = 'FINAL PAYMENT'; }
    var preamble = sales ? [['MADE FOR SPAIN AND PORTUGAL - RELACI\u00d3N DE VENTAS ' + year], [], group] : [['', 'FACTURAS PROFORMAS ' + year], group];
    var rows = report.records.map(function (r, index) {
      var agency = (report.agencies || {})[r.Account_Name && r.Account_Name.id] || {};
      var ref = String(agency.Agent_Code || ''), price = number(r.Sales_Price_inc_Taxes), cost = number(r.Purchase_Price_inc_Taxes), commission = number(r.Final_Commission);
      var n = index + preamble.length + 2, arrival = dateCell(r.Arrival_Date), departure = dateCell(r.Departure_Date);
      var ready = price !== '' && cost !== '', gross = ready ? price - cost : '', net = ready ? gross / 1.21 : '', sale = ready ? cost + net : '';
      if (sales) {
        var month = departure ? new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(new Date(r.Departure_Date)) : '';
        return [r.MFSP_Reference || '', ref, agency.Account_Name || label(r.Account_Name), r.Deal_Name || '', number(r.Travellers_Number), label(r.Sales_Rep), r.Consortia || '', arrival, departure,
          formula('IF(I' + n + '= "","",TEXT(I' + n + ',"[$-es-ES]mmmm"))', month), money(price), money(cost),
          formula('IF(COUNT(K' + n + ':L' + n + ')=2,K' + n + '-L' + n + ',"")', gross),
          formula('IF(M' + n + '="","",M' + n + '/1.21)', net),
          formula('IF(N' + n + '="","",N' + n + '*21%)', ready ? net * .21 : ''),
          formula('IF(N' + n + '="","",L' + n + '+N' + n + ')', sale),
          formula('IF(P' + n + '="","",O' + n + '+P' + n + ')', ready ? net * .21 + sale : ''),
          formula('IFERROR(N' + n + '/P' + n + ',"")', ready && sale ? net / sale : '', 'percent'), money(commission),
          formula('IF(OR(N' + n + '="",S' + n + '=""),"",IFERROR(N' + n + '/(P' + n + '-S' + n + '),""))', ready && commission !== '' && sale !== commission ? net / (sale - commission) : '', 'percent')];
      }
      var categories = ['Groups', 'FIT', 'Small FIT', 'Shorex', 'Single Services', 'Agent Trip'].map(function (category) { return r.Trip_Type === category ? 'x' : ''; });
      return [r.MFSP_Reference || '', ref].concat(categories, [label(r.Reservation_Rep), label(r.Sales_Rep), '', dateCell(r.Booking_Won_Date), r.Deal_Name || '', number(r.Travellers_Number),
        formula('IF(Q' + n + '="","",Q' + n + '-47)', arrival ? arrival.value - 47 : '', 'date'),
        formula('IF(Q' + n + '="","",Q' + n + '-40)', arrival ? arrival.value - 40 : '', 'date'), arrival, departure,
        agency.Account_Name || label(r.Account_Name), label(agency.Parent_Account), label(r.Contact_Name), r.Agent_Email || '', String(r.IATA_Code || ''),
        agency.Billing_Street || agency.Billing_Address || '', agency.Billing_City || '', agency.Billing_State || '', String(agency.Billing_Code || agency.Post_Code || ''), agency.Billing_Country || '', agency.Phone || '', r.Consortia || '', money(price), money(commission),
        formula('IF(COUNT(AE' + n + ':AF' + n + ')=2,AE' + n + '-AF' + n + ',"")', price !== '' && commission !== '' ? price - commission : ''), money(cost),
        formula('IF(OR(AE' + n + '="",AH' + n + '=""),"",(AE' + n + '-AH' + n + ')/1.21)', net)], Array(12).fill(''));
    });
    return [{ name: 'Hoja1', headers: headers, preamble: preamble, rows: rows, merges: sales ? ['H3:J3', 'S3:T3'] : [] }];
  };
  ns.initBookingWonReport = function (crm, stageOptions) {
    var el = function (id) { return document.getElementById('booking-won-' + id); };
    if (!el('panel')) { return; }
    var report = null, sheets = null;
    function invalidate() {
      report = null; sheets = null; el('results').hidden = true;
      el('export-sales').disabled = true; el('export-invoices').disabled = true;
      el('message').textContent = 'Generate a preview for the selected date and stages.';
    }
    function cellText(cell) {
      if (cell && typeof cell === 'object') {
        var value = cell.value;
        if (value == null || value === '') { return ''; }
        if (cell.format === 'date') { return new Date((value - 25569) * 86400000).toLocaleDateString('en-GB', { timeZone: 'UTC' }); }
        if (typeof value === 'number') {
          return value.toLocaleString('en-GB', cell.format === 'percent' ? { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return String(value);
      }
      return cell == null ? '' : String(cell);
    }
    function renderPreview(type, sheet) {
      var table = el(type + '-table'); table.replaceChildren();
      var head = document.createElement('thead'), header = document.createElement('tr');
      sheet.headers.forEach(function (title) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = title; header.appendChild(th); });
      head.appendChild(header); table.appendChild(head);
      var body = document.createElement('tbody');
      sheet.rows.slice(0, 100).forEach(function (row) {
        var tr = document.createElement('tr');
        row.forEach(function (value) { var td = document.createElement('td'); td.textContent = cellText(value); tr.appendChild(td); });
        body.appendChild(tr);
      });
      table.appendChild(body);
    }
    (stageOptions || []).forEach(function (stage) {
      var label = document.createElement('label'), input = document.createElement('input');
      label.className = 'bookings-stage-option';
      input.type = 'checkbox'; input.value = stage; input.checked = true;
      label.appendChild(input); label.appendChild(document.createTextNode(stage)); el('stages').appendChild(label);
    });
    function setStageMenu(open) {
      el('stage-menu').hidden = !open;
      el('stage-summary').setAttribute('aria-expanded', String(open));
    }
    el('stage-summary').addEventListener('click', function () { setStageMenu(el('stage-menu').hidden); });
    document.addEventListener('click', function (event) {
      if (!el('stage-field').contains(event.target)) { setStageMenu(false); }
    });
    el('stage-field').addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { setStageMenu(false); el('stage-summary').focus(); }
    });
    function selectedStages() { return Array.from(el('stages').querySelectorAll('input:checked')).map(function (input) { return input.value; }); }
    function stageSummary() {
      var count = selectedStages().length;
      el('stage-summary').textContent = count === (stageOptions || []).length ? 'All stages' : count + ' stages selected';
      invalidate();
    }
    el('stages').addEventListener('change', stageSummary);
    ['all', 'none'].forEach(function (action) { el('stages-' + action).addEventListener('click', function () {
      el('stages').querySelectorAll('input').forEach(function (input) { input.checked = action === 'all'; }); stageSummary();
    }); });
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    function part(type) { return parts.find(function (p) { return p.type === type; }).value; }
    el('date').value = part('year') + '-' + part('month') + '-' + part('day');
    el('open').addEventListener('click', function () {
      el('panel').hidden = !el('panel').hidden;
      el('open').setAttribute('aria-expanded', String(!el('panel').hidden));
    });
    el('date').addEventListener('input', invalidate);
    invalidate();
    el('generate').addEventListener('click', async function () {
      invalidate(); el('generate').disabled = true;
      el('export-sales').disabled = true; el('export-invoices').disabled = true; el('date').disabled = true;
      el('stage-controls').disabled = true;
      el('message').textContent = '';
      el('loading').hidden = false; el('panel').setAttribute('aria-busy', 'true');
      try {
        report = await ns.loadBookingWonReport(crm, el('date').value, selectedStages());
        if (!report.records.length) { el('message').textContent = 'No bookings won on ' + report.date + '.'; return; }
        sheets = { sales: ns.bookingWonReportSheets(report, 'sales'), invoices: ns.bookingWonReportSheets(report, 'invoices') };
        renderPreview('sales', sheets.sales[0]); renderPreview('invoices', sheets.invoices[0]);
        el('results').hidden = false;
        el('message').textContent = report.records.length + ' bookings for ' + report.date + '.';
      } catch (error) {
        invalidate(); el('message').textContent = error.message || 'Could not load preview. Please retry.';
      } finally {
        el('loading').hidden = true; el('panel').setAttribute('aria-busy', 'false');
        el('generate').disabled = false; el('date').disabled = false; el('stage-controls').disabled = false;
        el('export-sales').disabled = !sheets; el('export-invoices').disabled = !sheets;
      }
    });
    ['sales', 'invoices'].forEach(function (type) { el('export-' + type).addEventListener('click', function () {
      if (!report || !sheets) { return; }
      try {
        var url = URL.createObjectURL(ns.createExcelWorkbook(sheets[type]));
        var link = document.createElement('a'); link.href = url; link.download = (type === 'sales' ? 'VENTAS-' : 'RELACION-FACTURAS-') + report.date + '.xlsx';
        document.body.appendChild(link); link.click(); link.remove();
        global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        el('message').textContent = report.records.length + ' bookings exported for ' + report.date + '.';
      } catch (error) {
        el('message').textContent = error.message || 'Could not export bookings. Please retry.';
      }
    }); });
  };
}(window));
