(function (global) {
  var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};
  var tables = {};
  var storageKey = "accounting-manager.table-columns.v1";
  var dialog = null;
  var dragKey = null;

  function readPreferences() {
    try { return JSON.parse(global.localStorage.getItem(storageKey) || "{}"); } catch (error) { return {}; }
  }

  function writePreferences() {
    var preferences = readPreferences();
    Object.keys(tables).forEach(function (key) { preferences[key] = { order: tables[key].order.slice(), visible: tables[key].visible.slice(), widths: tables[key].widths || {} }; });
    global.localStorage.setItem(storageKey, JSON.stringify(preferences));
  }

  function setupColumnWidths(tableKey) {
    var definition = tables[tableKey];
    var button = document.querySelector('[data-table-columns-button="' + tableKey + '"]');
    var table = button && button.closest("table");
    if (!table || !table.getBoundingClientRect().width) { return; }
    var headers = Array.prototype.slice.call(table.tHead.rows[0].cells);
    var previousGroup = table.querySelector("colgroup[data-column-widths]");
    if (previousGroup) { previousGroup.remove(); }
    table.classList.remove("has-column-widths");
    table.style.removeProperty("width");
    var widths = headers.map(function (header) {
      var key = header.getAttribute("data-resizable-column");
      var saved = Number(definition.widths[key]);
      var column = definition.columns.find(function (item) { return item.key === key; });
      return key && Number.isFinite(saved) && saved >= 40 && saved <= 1600
        ? saved : column && column.defaultWidth || header.getBoundingClientRect().width;
    });
    var group = document.createElement("colgroup");
    group.setAttribute("data-column-widths", "");
    headers.forEach(function () { group.appendChild(document.createElement("col")); });
    table.insertBefore(group, table.firstChild);
    function applyWidths() {
      table.classList.add("has-column-widths");
      widths.forEach(function (width, index) { group.children[index].style.width = width + "px"; });
      table.style.width = widths.reduce(function (sum, width) { return sum + width; }, 0) + "px";
    }
    function saveWidths() {
      headers.forEach(function (header, index) {
        var key = header.getAttribute("data-resizable-column");
        if (key) { definition.widths[key] = Math.round(widths[index]); }
      });
      writePreferences();
    }
    if (Object.keys(definition.widths).length || definition.columns.some(function (column) { return column.defaultWidth; })) { applyWidths(); }
    headers.forEach(function (header, index) {
      var key = header.getAttribute("data-resizable-column");
      if (!key) { return; }
      var previousHandle = header.querySelector(".table-column-resize-handle");
      if (previousHandle) { previousHandle.remove(); }
      var handle = document.createElement("span");
      handle.className = "table-column-resize-handle";
      handle.tabIndex = 0;
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      var column = definition.columns.find(function (item) { return item.key === key; });
      handle.setAttribute("aria-label", "Resize " + column.label + " column");
      handle.setAttribute("aria-valuemin", "40");
      handle.setAttribute("aria-valuemax", "1600");
      handle.setAttribute("aria-valuenow", String(Math.round(widths[index])));
      handle.title = "Drag to resize column. Use arrow keys for fine adjustment.";
      handle.addEventListener("click", function (event) { event.stopPropagation(); });
      function resize(width) {
        widths[index] = Math.max(40, Math.min(1600, Math.round(width)));
        applyWidths();
        handle.setAttribute("aria-valuenow", String(widths[index]));
      }
      handle.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) { return; }
        event.preventDefault();
        event.stopPropagation();
        var startX = event.clientX;
        var startWidth = widths[index];
        var originalWidths = widths.slice();
        handle.setPointerCapture(event.pointerId);
        table.classList.add("is-resizing-column");
        function move(moveEvent) { resize(startWidth + moveEvent.clientX - startX); }
        function finish(endEvent) {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", finish);
          handle.removeEventListener("pointercancel", finish);
          table.classList.remove("is-resizing-column");
          if (endEvent.type === "pointercancel") {
            widths = originalWidths;
            applyWidths();
            handle.setAttribute("aria-valuenow", String(Math.round(widths[index])));
          }
          else { saveWidths(); }
          if (handle.hasPointerCapture(event.pointerId)) { handle.releasePointerCapture(event.pointerId); }
        }
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
      });
      handle.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") { return; }
        event.preventDefault();
        event.stopPropagation();
        resize(widths[index] + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 25 : 5));
        saveWidths();
      });
      header.appendChild(handle);
    });
  }

  function normalizeOrder(definition, order) {
    var valid = definition.columns.map(function (column) { return column.key; });
    var selected = (order || []).filter(function (key) { return valid.indexOf(key) !== -1; });
    valid.forEach(function (key) { if (selected.indexOf(key) === -1) { selected.push(key); } });
    return selected;
  }

  function closeDialog() {
    if (dialog && dialog.parentNode) { dialog.parentNode.removeChild(dialog); }
    dialog = null;
    dragKey = null;
  }

  function renderDialog(tableKey) {
    var definition = tables[tableKey];
    if (!definition) { return; }
    var labels = {};
    definition.columns.forEach(function (column) { labels[column.key] = column.label; });
    var draft = definition.order.slice();
    var visible = definition.visible.slice();
    var originalVisible = definition.visible.slice();
    var originalOrder = definition.order.slice();
    closeDialog();
    dialog = document.createElement("div");
    dialog.className = "table-column-config-backdrop";
    dialog.innerHTML = '<section class="table-column-config-modal" role="dialog" aria-modal="true" aria-labelledby="table-column-config-title">' +
      '<header><h2 id="table-column-config-title">Edit columns</h2><button type="button" class="table-column-config-close" aria-label="Close">&times;</button></header>' +
      '<p>Drag a column to change its order. Use the eye to show or hide it.</p>' +
      '<div class="table-column-config-list"></div>' +
      '<footer><button type="button" class="button secondary" data-column-config-cancel>Cancel</button><button type="button" class="button primary" data-column-config-save>Save</button></footer></section>';
    document.body.appendChild(dialog);
    var list = dialog.querySelector(".table-column-config-list");
    function repaint() {
      list.innerHTML = draft.map(function (key) {
        var isVisible = visible.indexOf(key) !== -1;
        var icon = isVisible
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5c1.2 0 2.3.2 3.3.6M21.5 12s-3.5 5-9.5 5c-1.2 0-2.3-.2-3.3-.6"/><path d="m3 3 18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
        return '<div class="table-column-config-row" draggable="true" data-column-key="' + key + '"><span class="table-column-drag-handle" aria-hidden="true">&#8942;&#8942;</span><strong>' + labels[key] + '</strong><button type="button" data-column-toggle="' + key + '" title="' + (isVisible ? "Hide column" : "Show column") + '" aria-label="' + (isVisible ? "Hide column" : "Show column") + '" aria-pressed="' + isVisible + '">' + icon + "</button></div>";
      }).join("");
    }
    repaint();
    dialog.addEventListener("click", function (event) {
      var toggle = event.target.closest("[data-column-toggle]");
      if (toggle) {
        var key = toggle.getAttribute("data-column-toggle");
        if (visible.indexOf(key) === -1) { visible.push(key); } else if (visible.length > 1) { visible.splice(visible.indexOf(key), 1); }
        definition.visible = draft.filter(function (columnKey) { return visible.indexOf(columnKey) !== -1; });
        definition.onChange();
        repaint();
        return;
      }
      if (event.target === dialog || event.target.closest(".table-column-config-close") || event.target.closest("[data-column-config-cancel]")) {
        definition.order = originalOrder;
        definition.visible = originalVisible;
        definition.onChange();
        closeDialog();
        return;
      }
      if (event.target.closest("[data-column-config-save]")) {
        definition.order = draft.slice();
        definition.visible = draft.filter(function (key) { return visible.indexOf(key) !== -1; });
        writePreferences();
        closeDialog();
        definition.onChange();
      }
    });
    list.addEventListener("dragstart", function (event) { var row = event.target.closest("[data-column-key]"); dragKey = row && row.getAttribute("data-column-key"); });
    list.addEventListener("dragover", function (event) { event.preventDefault(); });
    list.addEventListener("drop", function (event) {
      event.preventDefault();
      var row = event.target.closest("[data-column-key]");
      var targetKey = row && row.getAttribute("data-column-key");
      if (!dragKey || !targetKey || dragKey === targetKey) { return; }
      draft.splice(draft.indexOf(dragKey), 1);
      draft.splice(draft.indexOf(targetKey), 0, dragKey);
      repaint();
    });
  }

  ns.tableColumns = {
    configure: function (key, columns, onChange) {
      var saved = readPreferences()[key];
      var definition = tables[key] || {};
      definition.columns = columns;
      if (!definition.initialized) {
        definition.order = normalizeOrder(definition, saved && saved.order ? saved.order : columns.map(function (column) { return column.key; }));
        definition.visible = normalizeOrder(definition, saved && saved.visible ? saved.visible : definition.order).filter(function (columnKey) { return (saved && saved.visible ? saved.visible : definition.order).indexOf(columnKey) !== -1; });
        definition.initialized = true;
        definition.widths = Object.assign({}, saved && saved.widths || {});
      }
      if (!definition.visible.length) { definition.visible = [definition.order[0]]; }
      definition.onChange = onChange;
      tables[key] = definition;
      if (["bookings", "tripClosure", "invoices", "payments"].indexOf(key) !== -1) {
        global.cancelAnimationFrame(definition.resizeFrame);
        definition.resizeFrame = global.requestAnimationFrame(function () { setupColumnWidths(key); });
      }
    },
    resizableHeader: function (key, html) {
      return html.replace("<th", '<th data-resizable-column="' + key + '"');
    },
    visibleOrder: function (key) {
      var definition = tables[key];
      return definition ? definition.order.filter(function (columnKey) { return definition.visible.indexOf(columnKey) !== -1; }) : [];
    },
    button: function (key) {
      return '<button class="table-columns-button" type="button" data-table-columns-button="' + key + '" title="Edit columns" aria-label="Edit columns">&#9881;</button>';
    }
  };
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-table-columns-button]");
    if (button) { renderDialog(button.getAttribute("data-table-columns-button")); }
  });
}(window));
