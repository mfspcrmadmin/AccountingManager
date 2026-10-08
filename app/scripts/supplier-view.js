(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  // Presentation interactions only; record operations remain in the workspace.
  ns.bindSupplierView = function (root) {
    var search = root.querySelector('#supplier-search');
    var clear = root.querySelector('#clear-supplier-search');
    var feedback = root.querySelector('#supplier-copy-feedback');
    var feedbackTimer;
    function updateClear() { clear.hidden = !search.value; }
    search.addEventListener('input', updateClear);
    search.addEventListener('focus', updateClear);
    clear.addEventListener('click', function () {
      search.value = '';
      updateClear();
      root.querySelector('#search-results-card').hidden = true;
      search.focus();
    });
    root.querySelectorAll('[role="tablist"]').forEach(function (list) {
      list.querySelectorAll('button').forEach(function (button) {
        button.setAttribute('role', 'tab');
        button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1;
      });
      list.addEventListener('keydown', function (event) {
        var tabs = Array.from(list.querySelectorAll('[role="tab"]'));
        var index = tabs.indexOf(event.target);
        if (index < 0) { return; }
        if (event.key === 'ArrowRight') { index = (index + 1) % tabs.length; }
        else if (event.key === 'ArrowLeft') { index = (index + tabs.length - 1) % tabs.length; }
        else if (event.key === 'Home') { index = 0; }
        else if (event.key === 'End') { index = tabs.length - 1; }
        else { return; }
        event.preventDefault();
        tabs[index].click();
        tabs[index].focus({ preventScroll: true });
      });
    });
    root.addEventListener('click', async function (event) {
      updateClear();
      var button = event.target.closest('[data-supplier-copy]');
      if (!button) { return; }
      global.clearTimeout(feedbackTimer);
      try {
        var text = button.getAttribute('data-supplier-copy');
        if (global.navigator.clipboard && global.isSecureContext) {
          await global.navigator.clipboard.writeText(text);
        } else {
          var input = document.createElement('textarea');
          input.value = text;
          input.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(input);
          try {
            input.select();
            if (!document.execCommand('copy')) { throw new Error('Clipboard unavailable'); }
          } finally { input.remove(); button.focus({ preventScroll: true }); }
        }
        feedback.textContent = 'Copied to clipboard';
      } catch (error) {
        feedback.textContent = 'Could not copy. Select the value and copy it manually.';
      }
      feedbackTimer = global.setTimeout(function () { feedback.textContent = ''; }, 3500);
    });
    updateClear();
  };
}(window));
