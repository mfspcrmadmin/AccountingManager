(function (global) {
  'use strict';
  var ns = global.AccountingManagerApp;
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      var sorted = {}; Object.keys(value).sort().forEach(function (key) { sorted[key] = canonical(value[key]); }); return sorted;
    }
    return value;
  }
  // Stable evidence, rather than a checkbox alone, determines what was accepted.
  ns.closureReviewFingerprint = function (issues) {
    return JSON.stringify(issues.map(function (issue) { return JSON.stringify(canonical(issue)); }).sort());
  };
  ns.createClosureReviewDialog = function (crm, openRecord) {
    var reader = ns.createConsistencyReader(crm), sync = ns.createStatusCopySync(crm);
    async function inspect(load) {
      var local = await load();
      var graph = await reader.scan(String(local.bookingId));
      var findings = ns.analyzeConsistency(graph);
      var titles = {Amount_Paid:'Invoice paid amount differs',Payment_Amount:'Payment total differs',Allocation_Count:'Allocation count differs',Supplier_Count:'Supplier count differs',Booking_Count:'Booking count differs',Settlement_Count:'Settlement count differs',Total_Invoice:'Settlement invoice total differs',Total_Paid:'Settlement paid total differs',Gross_Invoice_Amount:'Gross invoice total differs',Credit_Note_Amount:'Credit note total differs','Invoice status copy':'Copied invoice status is out of date','Payment status copy':'Copied payment status is out of date'};
      function display(value) { return value == null ? 'Unavailable' : String(value); }
      var issues = local.issues.concat(findings.map(function (row) {
        var copy = ns.isStatusCopyFinding(row);
        return { title: titles[row.description] || row.description, record: (row.name || 'Record') + ' [' + row.id + ']', module: row.module, id: row.id,
          explanation: copy ? 'The status saved on this allocation differs from its source record. Sync status copies to refresh it.' : 'The recorded value differs from the value calculated from related records. Open the record and reconcile it, or document a migration exception.',
          evidence: 'Recorded: ' + display(row.stored) + ' · Expected: ' + display(row.expected) + (row.currency ? ' · ' + row.currency : ''), copy: copy };
      }));
      return {issues: issues, findings: findings, bookingId: local.bookingId, revision: local.revision, graph: graph};
    }
    function fingerprint(data) { return JSON.stringify(canonical([ns.closureReviewFingerprint(data.issues), data.revision, data.graph])); }
    return {
      verify: async function (load, evidence) {
        return fingerprint(await inspect(load)) === evidence;
      },
      review: async function (load) {
        var data = await inspect(load);
        if (!data.issues.length) return {issues: [], reason: '', evidence: fingerprint(data)};
        return new Promise(function (resolve) {
          var dialog = document.createElement('dialog'), previous = document.activeElement, working = false;
          dialog.className = 'closure-review-dialog';
          dialog.setAttribute('aria-labelledby', 'closure-review-title');
          dialog.innerHTML = '<header><div><span class="closure-review-eyebrow">TRIP CLOSURE</span><h2 id="closure-review-title">Review before completing</h2></div><button type="button" data-close aria-label="Close review">×</button></header><div class="closure-review-body"><div data-message role="status" aria-live="polite"></div><div data-issues class="closure-review-issues"></div><label class="closure-review-reason">Reason for accepted exceptions<textarea maxlength="2000" rows="3" placeholder="Explain the migration or evidence supporting these exceptions"></textarea></label></div><footer><button type="button" class="button secondary" data-cancel>Return to trip</button><button type="button" class="button secondary" data-sync>Sync status copies</button><button type="button" class="button secondary" data-check>Check again</button><button type="button" class="button primary" data-confirm>Complete with exceptions</button></footer>';
          var list = dialog.querySelector('[data-issues]'), message = dialog.querySelector('[data-message]'), reason = dialog.querySelector('textarea');
          function finish(value) { dialog.close(); dialog.remove(); if (previous && previous.isConnected) previous.focus(); resolve(value); }
          function paint() {
            list.replaceChildren(); reason.value = '';
            message.textContent = data.issues.length ? data.issues.length + ' issues to review' : 'All checks passed. You can complete the closure.';
            dialog.querySelector('[data-sync]').hidden = !data.findings.some(ns.isStatusCopyFinding);
            dialog.querySelector('[data-confirm]').textContent = data.issues.length ? 'Complete with exceptions' : 'Complete closure';
            var groups = new Map();
            data.issues.forEach(function (issue) {
              var key = issue.category || issue.title;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key).push(issue);
            });
            groups.forEach(function (issues, category) {
              var group = document.createElement('details'); group.className = 'closure-review-group';
              var heading = document.createElement('summary'), name = document.createElement('span'), count = document.createElement('span');
              name.textContent = category; count.className = 'closure-review-group-count'; heading.append(name, count); group.appendChild(heading);
              var body = document.createElement('div'); body.className = 'closure-review-group-body';
              var toolbar = document.createElement('label'); toolbar.className = 'closure-review-group-select';
              var all = document.createElement('input'); all.type = 'checkbox'; all.setAttribute('data-ignore-category', '');
              toolbar.append(all, document.createTextNode(' Ignore all in this category')); body.appendChild(toolbar);
              var checks = [];
              function updateSelection() {
                var selected = checks.filter(function (check) { return check.checked; }).length;
                all.checked = selected === checks.length; all.indeterminate = selected > 0 && selected < checks.length;
                count.textContent = issues.length + (issues.length === 1 ? ' issue' : ' issues') + ' / ' + selected + ' ignored';
              }
              all.addEventListener('change', function () {
                if (working) return;
                checks.forEach(function (check) { check.checked = all.checked; }); updateSelection();
              });
              issues.forEach(function (issue) {
              var card = document.createElement('article'); card.className = 'closure-review-issue';
              var title = document.createElement('h3'); title.textContent = issue.title; card.appendChild(title);
              [issue.record, issue.explanation, issue.evidence].filter(Boolean).forEach(function (text) { var p = document.createElement('p'); p.textContent = text; card.appendChild(p); });
              var actions = document.createElement('div'); actions.className = 'closure-review-issue-actions';
              if (issue.module && issue.id) {
                var open = document.createElement('button'); open.type = 'button'; open.className = 'button secondary'; open.textContent = 'Open record';
                open.onclick = async function () { if (working) return; open.disabled = true; try { await openRecord(issue.module, issue.id); message.textContent = 'Run Check again after correcting the record.'; } catch (error) { message.textContent = error.message; } finally { open.disabled = false; } }; actions.appendChild(open);
              }
              var label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.setAttribute('data-ignore', ''); checks.push(check); check.addEventListener('change', updateSelection); label.append(check, document.createTextNode(' Ignore for this closure')); actions.appendChild(label); card.appendChild(actions); body.appendChild(card);
              });
              updateSelection(); group.appendChild(body); list.appendChild(group);
            });
          }
          async function refresh(synchronize) {
            if (working) return; working = true;
            var syncButton = dialog.querySelector('[data-sync]');
            if (synchronize) {
              syncButton.setAttribute('aria-busy', 'true');
              syncButton.innerHTML = '<span class="closure-sync-spinner" aria-hidden="true"></span> Synchronizing...';
            }
            dialog.querySelectorAll('button,input,textarea').forEach(function (control) { control.disabled = true; });
            message.textContent = synchronize ? 'Synchronizing status copies…' : 'Checking current records…';
            try {
              var report = synchronize ? await sync(String(data.bookingId), data.findings) : null;
              data = await inspect(load); paint();
              if (report) message.textContent += ' · ' + report.verified + ' allocations verified. ' + report.failed.map(function (failure) { return failure.message; }).join(' ');
            } catch (error) { message.textContent = 'Check incomplete. ' + error.message; list.replaceChildren(); data = null; }
            finally {
              working = false;
              syncButton.removeAttribute('aria-busy');
              syncButton.textContent = 'Sync status copies';
              dialog.querySelectorAll('button,input,textarea').forEach(function (control) { control.disabled = false; }); dialog.querySelector('[data-confirm]').disabled = !data; syncButton.disabled = !data;
            }
          }
          dialog.querySelector('[data-check]').onclick = function () { refresh(false); };
          dialog.querySelector('[data-sync]').onclick = function () { refresh(true); };
          dialog.querySelector('[data-confirm]').onclick = function () {
            if (working || !data) return;
            if (Array.from(list.querySelectorAll('[data-ignore]')).some(function (check) { return !check.checked; })) { message.textContent = 'Correct each issue or explicitly select Ignore for this closure.'; return; }
            if (data.issues.length && !reason.value.trim()) { message.textContent = 'Enter a justification for the accepted exceptions.'; reason.focus(); return; }
            finish({issues: data.issues.map(function (issue) { return [issue.title, issue.record, issue.explanation, issue.evidence].filter(Boolean).join(' | '); }), reason: reason.value.trim(), evidence: fingerprint(data)});
          };
          dialog.querySelector('[data-close]').onclick = dialog.querySelector('[data-cancel]').onclick = function () { if (!working) finish(null); };
          dialog.addEventListener('cancel', function (event) { event.preventDefault(); if (!working) finish(null); });
          document.body.appendChild(dialog); paint(); dialog.showModal(); dialog.querySelector('[data-close]').focus();
        });
      }
    };
  };
}(window));
