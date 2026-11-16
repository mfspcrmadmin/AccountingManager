(function (global) {
  "use strict";
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var paths = {
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
    expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H4v13h4"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>'; }
  ns.createSetupModule = function (deps) {
    var root = global.document.getElementById("tab-setup"), initialized = false, fields = [], generation = 0, busy = false, loaded = false;
    var profiles = [], selectedTemplate = 0, previewHtml = "", modal = null, modalReturn = null, observer = null;
    var esc = deps.helpers.escapeHtml;
    function el(id) { return root.querySelector("#setup-" + id); }
    var templates = [
      { name: "Invoice request", type: "Manual", scope: "Bookings", used: "Bookings · Request invoice", trigger: "User reviews the invoice request and selects Send.", description: "Requests the invoice needed to process payment and close the booking.", fn: "sendsupplierinvoicerequest", preview: "invoice" },
      { name: "Supplier payment letter", type: "Manual", scope: "Supplier payments", used: "Supplier payments · Payment letter", trigger: "User reviews the recipient and payment details and sends the payment letter.", fn: "sendsupplierpaymentletter", preview: "paymentLetter" },
      { name: "Bank payment request", type: "Manual", scope: "Operations · Prepayments", used: "Operations · Prepayments", trigger: "User selects prepayments, reviews recipients and email content, and sends the bank request.", description: "Preview of the default draft. The sender can edit its content before sending.", fn: "notif_sendprepaymentbankrequest", preview: "bankRequest" },
      { name: "Prepayment proof", type: "Manual", scope: "Operations · Prepayments", used: "Operations · Prepayments", trigger: "User sends payment proof for the selected prepayment.", fn: "notif_sendprepaymentproof", preview: "prepaymentProof" },
      { name: "Supplier accounting account request", type: "Manual", scope: "Supplier information", used: "Supplier · Accounting information", trigger: "User requests the supplier's accounting account information.", fn: "email_requestsupplieraccountingaccountemail", preview: "accountingAccount" },
      { name: "Missing invoice reminder", type: "Disabled", scope: "Trip Accounting Closure", used: "CRM reminder schedule · Services", trigger: "Automatic sending disabled on 23 Oct 2026. Template preview remains available.", fn: "invoicereminder_send", preview: "service" },
      { name: "Proforma to final invoice reminder", type: "Disabled", scope: "Active Proformas", used: "CRM reminder schedule · Proforma invoices", trigger: "Automatic sending disabled on 23 Oct 2026. Template preview remains available.", fn: "invoicereminder_send", preview: "proforma" }
    ];
    function fillIcons(scope) { scope.querySelectorAll('[data-setup-icon]').forEach(function (node) { node.innerHTML = icon(node.dataset.setupIcon); }); }
    function dataRow(label, value) { return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>'; }
    function renderList() {
      var query = el("template-search").value.trim().toLowerCase(), count = 0;
      el("template-list").innerHTML = templates.map(function (item, index) {
        if (!item.name.toLowerCase().includes(query)) { return ""; }
        count++;
        return '<button type="button" class="setup-template-row" data-template-index="' + index + '" aria-pressed="' + (index === selectedTemplate) + '"><span class="setup-template-name">' + esc(item.name) + '</span><span class="setup-template-meta"><span>' + esc(item.scope) + '</span><span class="setup-badge">' + item.type + '</span></span>' + (item.type === "Automatic" ? '<span class="setup-list-status">Schedule active · Last verified 16 Oct 2026</span>' : item.type === "Disabled" ? '<span class="setup-list-status">Automatic sending disabled ? 23 Oct 2026</span>' : '') + '</button>';
      }).join("");
      el("template-empty").hidden = count > 0;
    }
    function previewDocument(html) {
      var style = '<style>body{overflow-wrap:anywhere}a{overflow-wrap:anywhere}img{max-width:100%;height:auto}@media(max-width:600px){table{table-layout:fixed;max-width:100%}td span,th span{white-space:normal!important}td,th{white-space:normal!important;overflow-wrap:anywhere;padding:8px!important}}</style>';
      return /<head[\s>]/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1>' + style) : '<!doctype html><html><head>' + style + '</head><body>' + html + '</body></html>';
    }
    function renderDetail() {
      var item = templates[selectedTemplate];
      previewHtml = "";
      if (item.preview === "invoice") {
        previewHtml = ns.createInvoiceRequestModule({ helpers: deps.helpers, MODULES: ns.MODULES }).buildMessage({Vendor_Name:"Sample supplier"}, {MFSP_Reference:"SAMPLE-001",Deal_Name:"Sample booking"}, []);
      } else if (item.preview) { previewHtml = (ns.invoiceReminderPreviews || {})[item.preview] || (ns.emailTemplatePreviews || {})[item.preview] || ""; }
      el("template-detail").innerHTML = '<header class="setup-detail-header"><h3>' + esc(item.name) + '</h3><span class="setup-badge">' + item.type + '</span></header>' +
        (item.type === "Automatic" ? '<p class="setup-detail-status">Schedule active · Sender approved; runs daily at 09:00 (Madrid) <small>Last verified 16 Oct 2026; not a live status.</small></p>' : item.type === "Disabled" ? '<p class="setup-detail-status">Automatic sending disabled <small>Verified 23 Oct 2026; not a live status.</small></p>' : '') +
        '<dl class="setup-detail-fields">' + dataRow("Used in",item.used) + dataRow("Trigger",item.trigger) + (item.type === "Automatic" ? dataRow("From / Reply-to","proveedores@madeforspainandportugal.com") + dataRow("Recipients","1. AC — Accounts; 2. RE — Reservas. First valid email in CRM ID order.") : '') + '</dl>' +
        (item.description ? '<p class="setup-muted">' + esc(item.description) + '</p>' : '') +
        (previewHtml ? '<div class="setup-preview-heading"><h4>Email preview</h4><span class="setup-badge">Sample data</span><button type="button" id="setup-expand" class="setup-icon-button" title="Expand preview" aria-label="Expand preview">' + icon("expand") + '</button></div><iframe class="setup-preview" title="' + esc(item.name) + ' preview" sandbox="allow-same-origin"></iframe>' : '<p class="setup-preview-unavailable">' + icon("info") + 'Preview unavailable</p>') +
        '<details class="setup-disclosure setup-technical"><summary>' + icon("chevron") + 'Technical details</summary><div class="setup-technical-body"><div><span class="setup-muted">CRM function</span><code>' + esc(item.fn) + '</code></div><button type="button" id="setup-copy" class="setup-icon-button" title="Copy function name" aria-label="Copy function name">' + icon("copy") + '</button><span id="setup-copy-status" role="status"></span></div></details>';
      if (previewHtml) { el("template-detail").querySelector("iframe").srcdoc = previewDocument(previewHtml); el("expand").addEventListener("click", expandPreview); }
      el("copy").addEventListener("click", async function () {
        var status = el("copy-status");
        try { await global.navigator.clipboard.writeText(item.fn); status.textContent = "Copied"; }
        catch (error) { status.textContent = "Copy unavailable. Select the function name to copy."; }
      });
    }
    function expandPreview() {
      if (modal) { return; }
      modalReturn = global.document.activeElement;
      modal = global.document.createElement("dialog");
      modal.className = "setup-preview-dialog";
      modal.setAttribute("aria-labelledby","setup-preview-title");
      modal.innerHTML = '<header><div><h3 id="setup-preview-title">' + esc(templates[selectedTemplate].name) + '</h3><span class="setup-badge">Sample data · Read only</span></div><button type="button" class="setup-icon-button" title="Close preview" aria-label="Close preview">' + icon("close") + '</button></header><div class="setup-preview-body" tabindex="0" aria-label="Email content"><iframe title="Expanded email preview" sandbox="allow-same-origin" scrolling="no"></iframe></div>';
      global.document.body.appendChild(modal);
      var frame = modal.querySelector("iframe");
      frame.addEventListener("load", function () {
        if (!modal) { return; }
        var doc = frame.contentDocument;
        function resize() { if (doc && doc.body) { frame.style.height = Math.ceil(doc.body.getBoundingClientRect().height + 32) + "px"; } }
        resize();
        if (global.ResizeObserver && doc && doc.body) { observer = new ResizeObserver(resize); observer.observe(doc.body); }
      });
      frame.srcdoc = previewDocument(previewHtml);
      modal.querySelector("button").addEventListener("click", function () { modal.close(); });
      modal.addEventListener("click", function (event) { if (event.target === modal) { var box = modal.getBoundingClientRect(); if(event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) { modal.close(); } } });
      modal.addEventListener("close", function () { if(observer) { observer.disconnect(); observer = null; } modal.remove(); modal = null; if(modalReturn && modalReturn.isConnected) { modalReturn.focus(); } });
      modal.showModal();
    }
    function accessState(kind, title, message) {
      el("access-status").dataset.state = kind;
      el("access-status").innerHTML = icon(kind === "loading" ? "refresh" : "info") + '<div><strong>' + esc(title) + '</strong>' + (message ? '<p>' + esc(message) + '</p>' : '') + '</div>';
      el("permission-table").hidden = kind !== "available";
    }
    function renderPermissions() {
      if(busy || !loaded) { return; }
      var selected = el("profile").value, query = el("field-search").value.trim().toLowerCase(), rows = [], exposed = 0;
      fields.forEach(function (field) {
        (Array.isArray(field.profiles) ? field.profiles : []).forEach(function (profile) {
          exposed++;
          if (selected && String(profile.id || profile.name) !== selected) { return; }
          if(query && !String(field.field_label || field.api_name).toLowerCase().includes(query)) { return; }
          var labels = { read_write: "Read / write", read_only: "Read only", hidden: "Hidden" }, value = profile.permission_type || "Not reported";
          rows.push('<tr><td>' + esc(field.field_label || field.api_name) + '</td><td>' + esc(profile.name || "Unnamed profile") + '</td><td><span class="setup-access-tag" data-access="' + (Object.hasOwn(labels,value) ? value : "unknown") + '">' + esc(labels[value] || value) + '</span></td></tr>');
        });
      });
      el("access-rows").innerHTML = rows.join("");
      if(!exposed) { accessState("unavailable","Permission data unavailable","CRM did not return field permissions for this module. This does not establish whether access is allowed or denied."); }
      else if(!rows.length) { accessState("empty","No matching permissions","Choose another profile or change the field search."); }
      else { accessState("available", rows.length + " field/profile entries", ""); }
    }
    function renderProfileOptions() {
      var query = el("profile-search").value;
      var options = [{id:"",name:"All profiles"}].concat(profiles).filter(function (item) { return deps.helpers.matchesText(item.name, query); });
      var clear = el("profile-picker").querySelector(".ui-option-search-clear");
      if (clear) { clear.disabled = !query; }
      el("profile-options").innerHTML = options.map(function (item) { return '<button type="button" data-profile-id="' + esc(item.id) + '" aria-pressed="' + (el("profile").value === item.id) + '">' + esc(item.name) + '</button>'; }).join("") || '<p class="setup-muted">No matching profiles.</p>';
    }
    function syncProfile() {
      el("profile-caption").textContent = el("profile").selectedOptions[0] ? el("profile").selectedOptions[0].textContent : "All profiles";
      renderPermissions();
    }
    async function refresh(force) {
      if(busy && !force) { return; }
      var token = ++generation, previous = el("profile").value;
      busy = true; loaded = false; fields = []; profiles = [];
      el("refresh").disabled = true; el("refresh").setAttribute("aria-busy","true");
      el("profile").disabled = true; el("profile-picker").open = false; el("profile-picker").hidden = true; el("profile").hidden = false;
      el("access-rows").innerHTML = "";
      el("profile").innerHTML = '<option value="">All profiles</option>';
      accessState("loading","Loading permissions", "Reading field permissions from CRM…");
      try {
        var response = await deps.crm.getFields(el("module").value);
        if(token !== generation) { return; }
        if(!response || !Array.isArray(response.fields)) { throw new Error("CRM did not return field metadata."); }
        fields = response.fields; loaded = true;
        var found = new Map();
        fields.forEach(function (field) { (Array.isArray(field.profiles) ? field.profiles : []).forEach(function (profile) { found.set(String(profile.id || profile.name),profile.name || "Unnamed profile"); }); });
        profiles = Array.from(found).map(function (pair) { return {id:pair[0],name:pair[1]}; }).sort(function (a,b) { return a.name.localeCompare(b.name); });
        el("profile").innerHTML += profiles.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join("");
        if(found.has(previous)) { el("profile").value = previous; }
        el("profile").hidden = profiles.length > 10;
        el("profile-picker").hidden = profiles.length <= 10;
        el("profile-search").value = "";
        busy = false; renderProfileOptions(); syncProfile();
      } catch(error) {
        if(token === generation) { accessState("error","Could not load permissions",(error.message || "CRM access could not be verified.") + " Refresh to retry."); }
      } finally {
        if(token === generation) { busy = false; el("refresh").disabled = false; el("refresh").setAttribute("aria-busy","false"); el("profile").disabled = false; }
      }
    }
    async function open() {
      if(initialized) { return; } initialized = true; fillIcons(root);
      var tabs = Array.from(root.querySelectorAll('[data-setup-tab]'));
      function selectTab(button, focus) {
        tabs.forEach(function (tab) { var active = tab === button; tab.setAttribute("aria-selected",String(active)); tab.tabIndex = active ? 0 : -1; el("panel-" + tab.dataset.setupTab).hidden = !active; });
        if(focus) { button.focus(); }
      }
      tabs.forEach(function (tab,index) { tab.addEventListener("click",function () { selectTab(tab,false); }); tab.addEventListener("keydown",function (event) { var next; if(event.key === "ArrowRight") { next=(index+1)%tabs.length; } else if(event.key === "ArrowLeft") { next=(index+tabs.length-1)%tabs.length; } else if(event.key === "Home") { next=0; } else if(event.key === "End") { next=tabs.length-1; } else { return; } event.preventDefault(); selectTab(tabs[next],true); }); });
      el("module").innerHTML = [["Supplier_Invoices","Invoices"],["Supplier_Payments","Payments"],["Vendors","Suppliers"],["Deals","Bookings"],["Prepayment_Requests","Prepayment requests"],["Prepayments","Prepayments"],["Supplier_Settlements","Settlements"]].map(function (item) { return '<option value="' + item[0] + '">' + item[1] + '</option>'; }).join("");
      renderList(); renderDetail();
      el("template-search").addEventListener("input",renderList);
      el("template-list").addEventListener("click",function (event) { var button=event.target.closest('[data-template-index]'); if(button) { selectedTemplate=Number(button.dataset.templateIndex); renderDetail(); root.querySelectorAll('[data-template-index]').forEach(function (row) { row.setAttribute("aria-pressed",String(Number(row.dataset.templateIndex)===selectedTemplate)); }); } });
      el("refresh").addEventListener("click",function () { refresh(false); });
      el("module").addEventListener("change",function () { refresh(true); });
      el("profile").addEventListener("change",syncProfile);
      el("field-search").addEventListener("input",renderPermissions);
      var searchShell = global.document.createElement("div"), clearSearch = global.document.createElement("button");
      searchShell.className = "ui-option-search";
      clearSearch.type = "button"; clearSearch.className = "ui-option-search-clear"; clearSearch.textContent = "×";
      clearSearch.setAttribute("aria-label","Clear option search"); clearSearch.title = "Clear option search";
      el("profile-search").before(searchShell); searchShell.append(el("profile-search"), clearSearch);
      clearSearch.addEventListener("click",function () { el("profile-search").value = ""; renderProfileOptions(); el("profile-search").focus(); });
      el("profile-search").addEventListener("input",renderProfileOptions);
      el("profile-picker").addEventListener("toggle",function () { if(this.open) { renderProfileOptions(); el("profile-search").focus(); } });
      el("profile-picker").addEventListener("keydown",function (event) { if(event.key==='Escape') { this.open=false; this.querySelector('summary').focus(); } });
      el("profile-picker").addEventListener("keydown",function (event) {
        if (!this.open || event.isComposing) { return; }
        if (event.key === "Enter" && event.target === el("profile-search")) { event.preventDefault(); event.stopPropagation(); return; }
        if (!["ArrowDown","ArrowUp","Home","End"].includes(event.key) ||
            (event.target === el("profile-search") && ["Home","End"].includes(event.key))) { return; }
        var buttons = Array.from(el("profile-options").querySelectorAll("button")), index = buttons.indexOf(global.document.activeElement);
        var next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0,Math.min(buttons.length-1,index+(event.key==="ArrowUp"?-1:1)));
        event.preventDefault(); event.stopPropagation(); if(buttons[next]) { buttons[next].focus(); }
      });
      el("profile-options").addEventListener("click",function (event) { var button=event.target.closest('[data-profile-id]'); if(button) { el("profile").value=button.dataset.profileId; el("profile-picker").open=false; syncProfile(); el("profile-picker").querySelector('summary').focus(); } });
      global.document.addEventListener("click",function (event) { if(!el("profile-picker").contains(event.target)) { el("profile-picker").open=false; } });
      el("user").textContent = "Identifying current CRM user…";
      deps.getCurrentUserEmail().then(function (email) { el("user").textContent="Signed in as " + email; }).catch(function () { el("user").textContent="Current user could not be verified."; });
      await refresh(false);
    }
    return {open:open};
  };
}(window));

