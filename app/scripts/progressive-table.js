(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  // Each reset owns its immutable query and request guard. Old completions cannot
  // mutate the new query, including its loading/error state.
  ns.createProgressiveQuery = function (options) {
    var view = options.view, generation = 0, snapshot, request = null;
    function more() {
      if (request) { return request; }
      if (!snapshot || !view.hasMore) { return Promise.resolve(); }
      var token = generation, query = snapshot, page = view.page + 1;
      view.loadingInitial = page === 1;
      view.loadingMore = page > 1;
      view.loadError = '';
      request = Promise.resolve().then(function () {
        options.render();
        return options.fetch(Object.assign({}, query, { page: page }));
      }).then(function (result) {
        if (token !== generation) { return; }
        var records = options.getRecords(), seen = new Set(records.map(function (r) { return String(r.id); }));
        result.records.forEach(function (r) {
          if (!seen.has(String(r.id))) { seen.add(String(r.id)); records.push(r); }
        });
        options.setRecords(records);
        view.page = page;
        view.hasMore = Boolean(result.hasMore);
        view.hasLoaded = true;
      }).catch(function (error) {
        if (token === generation) { view.loadError = error.message || 'Could not load records. Please retry.'; }
      }).finally(function () {
        if (token !== generation) { return; }
        request = null;
        view.loadingInitial = view.loadingMore = false;
        options.render();
      });
      return request;
    }
    return {
      more: more,
      reset: function (query) {
        generation += 1; request = null;
        snapshot = JSON.parse(JSON.stringify(query));
        view.page = 0; view.hasMore = true; view.hasLoaded = false;
        view.loadError = ''; view.loadingMore = false;
        options.setRecords([]);
        if (options.resetScroll) { options.resetScroll(); }
        return more();
      },
      cancel: function () { generation += 1; request = null; snapshot = null; view.loadingInitial = view.loadingMore = false; }
    };
  };

  ns.renderProgressiveTable = function (wrap, empty, view, more) {
    if (!wrap || !global.document) { return; }
    var binding = wrap._progressiveTable;
    if (!binding) {
      var footer = global.document.createElement('div');
      footer.className = 'progressive-table-footer';
      footer.setAttribute('aria-live', 'polite');
      wrap.appendChild(footer);
      binding = wrap._progressiveTable = { footer: footer, scheduled: false };
      wrap.classList.add('progressive-table-scroll');
      binding.check = function () {
        if (!wrap.getClientRects().length || wrap.hidden || binding.view.loadingInitial || binding.view.loadingMore || binding.view.loadError || !binding.view.hasMore) { return; }
        if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80) { binding.more(); }
      };
      wrap.addEventListener('scroll', binding.check, { passive: true });
      if (global.ResizeObserver) { binding.observer = new global.ResizeObserver(binding.check); binding.observer.observe(wrap); }
    }
    if (binding.footer.parentNode !== wrap) { wrap.appendChild(binding.footer); }
    binding.view = view; binding.more = more;
    var busy = view.loadingInitial || view.loadingMore;
    if (busy || view.loadError || view.hasMore) { wrap.hidden = false; if (empty) { empty.hidden = true; } }
    binding.footer.replaceChildren();
    if (view.loadError) {
      var message = global.document.createElement('span'); message.textContent = view.loadError + ' ';
      var retry = global.document.createElement('button'); retry.type = 'button'; retry.className = 'button secondary'; retry.textContent = 'Retry'; retry.onclick = more;
      binding.footer.append(message, retry);
    } else if (busy) {
      binding.footer.innerHTML = '<span class="progressive-table-spinner" aria-hidden="true"></span><span>Loading records...</span>';
    } else if (view.hasMore) { binding.footer.textContent = 'Scroll to load more'; }
    binding.footer.hidden = !busy && !view.loadError && !view.hasMore;
    wrap.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (!binding.scheduled) {
      binding.scheduled = true;
      global.requestAnimationFrame(function () { binding.scheduled = false; binding.check(); });
    }
  };

  // Some reports return a complete result (including cross-record totals).
  // Reveal that result in batches without slicing the source used by filters
  // or exports. Keep the same scroll/loading behaviour as remote queries.
  ns.renderBufferedTable = function (owner, wrap, visible, total, more) {
    if (!wrap) { return; }
    var previous = owner._bufferedScroller;
    if (previous && previous !== wrap && previous._progressiveTable && previous._progressiveTable.observer) { previous._progressiveTable.observer.disconnect(); }
    owner._bufferedScroller = wrap;
    var token = {}, view = { hasMore: visible < total, loadingMore: false };
    owner._bufferedTableToken = token;
    function next() {
      if (owner._bufferedTableToken !== token || view.loadingMore || !view.hasMore) { return; }
      view.loadingMore = true;
      view.loadError = "";
      ns.renderProgressiveTable(wrap, null, view, next);
      // Give the loading indicator a frame before adding the next set of rows.
      global.requestAnimationFrame(function () { global.requestAnimationFrame(function () {
        if (owner._bufferedTableToken !== token || !wrap.isConnected || !wrap.getClientRects().length) { view.loadingMore = false; return; }
        Promise.resolve().then(more).catch(function (error) {
          if (owner._bufferedTableToken !== token) { return; }
          view.loadingMore = false; view.loadError = error.message || "Could not load more records.";
          ns.renderProgressiveTable(wrap, null, view, next);
        });
      }); });
    }
    ns.renderProgressiveTable(wrap, null, view, next);
  };
}(window));
