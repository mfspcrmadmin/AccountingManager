(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createInlineFeedback = function (state) {
    var document = global.document;
    var anchors = {
      'supplier-search': '#supplier-search-feedback',
      'supplier-bootstrap': '#supplier-search-feedback',
      suppliers: '#supplier-feedback-rail',
      'supplier-activity': '#supplier-activity-panel',
      'invoice-detail': '#selected-invoice-panel',
      'payment-detail': '#payments-browser-workspace .sidebar-stack > .panel',
      invoices: '#invoices-filter-toolbar',
      payments: '#payments-filter-toolbar',
      bookings: '.bookings-filters-grid',
      'invoice-create': '#invoice-create-feedback',
      'payment-create': '#invoice-payment-panel',
      'payment-account-create': '#payment-account-create-panel',
      'accounting-account-create': '#accounting-account-create-panel'
    };

    function resolve(scope) {
      if (scope && scope.nodeType === 1) { return { element: scope, inside: true }; }
      var name = scope || state.currentTab || 'invoices';
      var selector = anchors[name];
      if (name === 'accounting') {
        selector = '#accounting-' + ({ lines: 'entry-lines', accounts: 'accounts', rules: 'rules' }[state.accountingTab] || 'entries') + '-workspace .panel';
      }
      if (name === 'payments' && state.views && state.views.payments && state.views.payments.section === 'accounts') {
        selector = '#payments-accounts-workspace .panel';
      }
      if (name === 'payments' && state.views && state.views.payments && state.views.payments.section === 'allocations') {
        selector = '#payments-allocations-workspace .panel';
      }
      if (name.charAt(0) === '#') { selector = name; }
      var element = selector && document.querySelector(selector);
      // A completed form may already be closed. Keep its result in its owning tab.
      if (element && (name === 'invoice-create' || name === 'payment-create') && (element.hidden || (name === 'invoice-create' && element.closest('#invoice-create-panel[hidden]')))) {
        element = document.querySelector(name === 'invoice-create' ? '#supplier-feedback-rail' : '#invoices-filter-toolbar');
      }
      if (element && /-account-create$/.test(name) && element.hidden) {
        element = document.querySelector(name === 'payment-account-create' ? '#payments-accounts-workspace .panel' : '#accounting-accounts-workspace .panel');
      }
      if (!element) { element = document.querySelector('#tab-' + name + ' .panel') || document.getElementById('tab-' + name); }
      if (!element) { element = document.querySelector('.tab-panel:not([hidden])'); }
      return { element: element, inside: !element || !element.matches('.table-filter-bar, .search-bar, .supplier-summary-header') };
    }

    function slot(scope) {
      var target = resolve(scope);
      if (!target.element) { return null; }
      var host = target.inside ? target.element : target.element.parentElement;
      var key = target.element;
      var existing = key._inlineFeedback;
      if (existing && existing.isConnected) { return existing; }
      var box = document.createElement('div');
      box.className = 'inline-feedback';
      box.hidden = true;
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.setAttribute('aria-atomic', 'true');
      var spinner = document.createElement('span');
      spinner.className = 'inline-feedback-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      var text = document.createElement('span');
      text.className = 'inline-feedback-text';
      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'inline-feedback-dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss message');
      dismiss.textContent = '\u00d7';
      dismiss.addEventListener('click', function () { box.hidden = true; });
      box.append(spinner, text, dismiss);
      if (!target.inside) { target.element.after(box); }
      else {
        var header = host.querySelector(':scope > .panel-header, :scope > .section-heading, :scope > header');
        if (header) { header.after(box); } else { host.prepend(box); }
      }
      key._inlineFeedback = box;
      return box;
    }

    var supplierLoading = {};
    function updateSupplierLoading(scope, loading, label) {
      if (scope !== 'supplier-search' && scope !== 'supplier-bootstrap') { return; }
      supplierLoading[scope] = loading ? label || 'Loading suppliers' : '';
      var message = supplierLoading['supplier-search'] || supplierLoading['supplier-bootstrap'];
      var spinner = document.getElementById('supplier-search-spinner');
      var button = document.getElementById('load-supplier');
      if (spinner) { spinner.hidden = !message; spinner.setAttribute('aria-label', message || 'Loading suppliers'); }
      if (button) { button.classList.toggle('is-searching', Boolean(message)); button.setAttribute('aria-busy', String(Boolean(message))); }
    }

    function show(message, options, scope) {
      var settings = options || {};
      if ((scope === 'supplier-search' || scope === 'supplier-bootstrap') && settings.isLoading) {
        updateSupplierLoading(scope, true, message);
        return;
      }
      var box = slot(scope);
      if (!box) { return; }
      if (scope === 'supplier-bootstrap' && supplierLoading['supplier-search']) { return; }
      if (!message) {
        if (!settings.clearTone || box.dataset.tone === settings.clearTone || (settings.clearTone === 'notice' && box.dataset.tone !== 'error')) { box.hidden = true; }
        return;
      }
      box.dataset.tone = settings.tone || 'neutral';
      box._feedbackScope = scope;
      box.classList.toggle('is-loading', Boolean(settings.isLoading));
      box.setAttribute('role', settings.tone === 'error' ? 'alert' : 'status');
      box.setAttribute('aria-live', settings.tone === 'error' ? 'assertive' : 'polite');
      box.querySelector('.inline-feedback-text').textContent = message;
      box.querySelector('button').hidden = Boolean(settings.isLoading);
      box.hidden = false;
    }

    function finish(scope) {
      updateSupplierLoading(scope, false);
      var box = slot(scope);
      if (box && box._feedbackScope === scope && box.classList.contains('is-loading')) {
        box.hidden = true;
        box.classList.remove('is-loading');
      }
    }

    function actionScope() {
      var active = document.activeElement;
      var panel = active && active.closest('[data-feedback-context], .embedded-form-panel, .detail-subsection, .supplier-main-section, .panel, [role="dialog"]');
      return panel && !panel.closest('[hidden]') ? panel : state.currentTab;
    }

    return { show: show, finish: finish, actionScope: actionScope };
  };
}(window));
