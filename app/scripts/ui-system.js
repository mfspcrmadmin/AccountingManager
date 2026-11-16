(function (global) {
  "use strict";
  var doc = global.document;
  if (!doc || !doc.body.classList.contains("accounting-widget")) { return; }
  var active = null, counter = 0;
  var floatingMenus = new Map();
  var checkboxSearches = new WeakMap();
  function normalizeOption(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim(); }
  function optionSearch(label, onInput) {
    var shell = doc.createElement("div"), input = doc.createElement("input"), clear = doc.createElement("button");
    shell.className = "ui-option-search";
    input.type = "search"; input.placeholder = "Search options"; input.autocomplete = "off";
    input.setAttribute("aria-label", "Search " + label);
    clear.type = "button"; clear.className = "ui-option-search-clear"; clear.textContent = "×";
    clear.setAttribute("aria-label", "Clear option search"); clear.title = "Clear option search";
    function update(event) { if (event) { event.stopPropagation(); } clear.disabled = !input.value; onInput(input.value); }
    input.addEventListener("input", update);
    input.addEventListener("change", function(event) { event.stopPropagation(); });
    clear.addEventListener("click", function(event) { event.stopPropagation(); input.value = ""; update(); input.focus(); });
    clear.disabled = true;
    shell.append(input, clear);
    return {shell:shell, input:input};
  }
  var canPopover = typeof global.HTMLElement.prototype.showPopover === "function";
  function visible(node) { return node && node.isConnected && !node.closest("[hidden]") && node.getClientRects().length > 0 && global.getComputedStyle(node).visibility !== "hidden"; }
  function labelFor(select) {
    return select.getAttribute("aria-label") ||
      Array.from(select.labels || []).map(function (label) {
        var copy = label.cloneNode(true);
        copy.querySelectorAll("select, input, button, small").forEach(function (child) { child.remove(); });
        return copy.textContent.trim();
      }).join(" ") || "Choose an option";
  }
  function closeSelect(restore) {
    if (!active) { return; }
    var previous = active; active = null;
    previous.observer.disconnect();
    previous.menu.hidePopover(); previous.menu.remove();
    ["aria-expanded", "aria-controls"].forEach(function (name) {
      if (previous.attributes[name] === null) { previous.select.removeAttribute(name); }
      else { previous.select.setAttribute(name, previous.attributes[name]); }
    });
    if (restore && visible(previous.select)) { previous.select.focus({preventScroll:true}); }
  }
  function positionSelect() {
    if (!active) { return; }
    if (!visible(active.select) || active.select.disabled) { closeSelect(false); return; }
    var rect = active.select.getBoundingClientRect(), menu = active.menu;
    var height = global.innerHeight, width = Math.min(Math.max(rect.width, 240), global.innerWidth - 16);
    var below = height - rect.bottom - 12, above = rect.top - 12;
    var upward = below < 220 && above > below;
    menu.style.width = width + "px";
    menu.style.maxHeight = Math.max(80, Math.min(360, upward ? above : below)) + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, global.innerWidth - width - 8)) + "px";
    menu.style.top = upward ? "auto" : (rect.bottom + 4) + "px";
    menu.style.bottom = upward ? (height - rect.top + 4) + "px" : "auto";
  }
  function selectOption(index, expected) {
    if (!active) { return; }
    var select = active.select, option = select.options[index];
    if (option !== expected) { closeSelect(true); return; }
    if (!option || option.disabled || select.disabled || option.parentElement.disabled) { return; }
    var changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    closeSelect(true);
    if (changed) {
      select.dispatchEvent(new global.Event("input", {bubbles:true}));
      select.dispatchEvent(new global.Event("change", {bubbles:true}));
    }
  }
  function renderOptions() {
    if (!active) { return; }
    var current = active, query = current.search ? normalizeOption(current.search.value) : "";
    current.options.replaceChildren();
    var group = null, count = 0;
    Array.from(current.select.options).forEach(function (option, index) {
      if (option.hidden || option.parentElement.hidden || !normalizeOption(option.label).includes(query)) { return; }
      var parent = option.parentElement;
      if (parent.tagName === "OPTGROUP" && parent !== group) {
        group = parent;
        var heading = doc.createElement("div"); heading.className = "ui-select-group"; heading.textContent = parent.label;
        heading.setAttribute("role", "presentation"); current.options.appendChild(heading);
      }
      var button = doc.createElement("button");
      button.type = "button"; button.className = "ui-select-option";
      button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(option.selected));
      button.disabled = option.disabled || parent.disabled;
      button.textContent = option.label; button.dataset.optionIndex = String(index);
      button.addEventListener("click", function () { selectOption(index, option); });
      current.options.appendChild(button); count++;
    });
    if (!count) {
      var empty = doc.createElement("p"); empty.className = "ui-select-empty";
      empty.textContent = "No matching options"; empty.setAttribute("role", "status");
      current.options.appendChild(empty);
    }
  }
  function openSelect(select) {
    if (!canPopover || select.multiple || select.size > 1 || select.disabled || !visible(select) || select.dataset.nativeSelect === "true") { return false; }
    if (active && active.select === select) { return true; }
    closeSelect(false);
    var menu = doc.createElement("div"), options = doc.createElement("div");
    menu.id = "ui-select-menu-" + (++counter); menu.className = "ui-select-menu"; menu.setAttribute("popover", "manual");
    options.className = "ui-select-options"; options.setAttribute("role", "listbox"); options.setAttribute("aria-label", labelFor(select));
    var search = null;
    if (select.options.length > 10) {
      var searchControl = optionSearch(labelFor(select), renderOptions);
      search = searchControl.input; menu.appendChild(searchControl.shell);
    }
    menu.appendChild(options);
    // Keep the picker inside a native modal when one owns the select. Popover
    // puts it in the top layer without breaking the modal's inert boundary.
    (select.closest("dialog") || doc.body).appendChild(menu);
    var observer = new global.MutationObserver(function () {
      if (active && active.select === select) { renderOptions(); positionSelect(); }
    });
    observer.observe(select, {subtree:true, childList:true, characterData:true, attributes:true,
      attributeFilter:["disabled", "hidden", "label", "selected", "value"]});
    active = {select:select, menu:menu, options:options, search:search, observer:observer,
      attributes:{"aria-expanded":select.getAttribute("aria-expanded"), "aria-controls":select.getAttribute("aria-controls")}};
    select.setAttribute("aria-expanded", "true"); select.setAttribute("aria-controls", menu.id);
    renderOptions(); menu.showPopover(); positionSelect();
    var first = search || options.querySelector('[aria-selected="true"]:not(:disabled)') || options.querySelector("button:not(:disabled)");
    if (first) { first.focus({preventScroll:true}); if (!search) { first.scrollIntoView({block:"nearest"}); } }
    menu.addEventListener("keydown", function (event) {
      // Picker keys must never reach a form's record-search handlers.
      event.stopPropagation();
      if (event.isComposing) { return; }
      if (event.key === "Escape" || event.key === "Tab") {
        var source = select;
        event.preventDefault(); event.stopPropagation(); closeSelect(true);
        if(event.key==="Tab") {
          var owner=source.closest('dialog, [role="dialog"][aria-modal="true"]');
          var items=focusables(owner||doc.body), index=items.indexOf(source);
          var next=items[index+(event.shiftKey?-1:1)];
          if(!next && owner) { next=event.shiftKey?items[items.length-1]:items[0]; }
          if(next) { next.focus(); }
        }
        return;
      }
      if (event.key === "Enter" && event.target === search) {
        var match = options.querySelector("button:not(:disabled)");
        event.preventDefault(); if (match) { match.click(); } return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || (event.target === search && ["Home", "End"].includes(event.key))) { return; }
      event.preventDefault();
      var buttons = Array.from(options.querySelectorAll("button:not(:disabled)"));
      var index = buttons.indexOf(doc.activeElement);
      var next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
        Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
      if (buttons[next]) { buttons[next].focus(); }
    });
    return true;
  }
  doc.addEventListener("mousedown", function (event) {
    var select = event.target.closest("select");
    if (event.button === 0 && select && openSelect(select)) { event.preventDefault(); }
    else if (active && !active.menu.contains(event.target) && event.target !== active.select) { closeSelect(false); }
  }, true);
  doc.addEventListener("click", function (event) {
    // Touch and assistive-technology activation may not emit mousedown.
    var select = event.target.closest("select");
    if (select && openSelect(select)) { event.preventDefault(); }
    else if (active && !active.menu.contains(event.target)) { closeSelect(false); }
    doc.querySelectorAll("details.setup-picker[open], details.table-filters-popover[open]").forEach(function (details) {
      if (!details.contains(event.target)) { details.open = false; }
    });
  });
  doc.addEventListener("keydown", function (event) {
    var select = event.target.closest("select");
    if (select && ["ArrowDown", "ArrowUp", " ", "Enter"].includes(event.key) && openSelect(select)) {
      event.preventDefault(); event.stopPropagation();
    }
  }, true);
  global.addEventListener("resize", positionSelect);
  doc.addEventListener("scroll", function (event) {
    if (active && !active.menu.contains(event.target)) { positionSelect(); }
  }, true);

  // Existing filter/lookup menus keep their DOM location and event handlers.
  // The top layer removes clipping by table, drawer and dialog scroll containers.
  function positionMenu(menu, anchor) {
    var rect = anchor.getBoundingClientRect(), gap = 6;
    var width = Math.min(Math.max(rect.width, 260), global.innerWidth - 16);
    var below = global.innerHeight - rect.bottom - 12, above = rect.top - 12;
    var up = below < 200 && above > below;
    Object.assign(menu.style, {position:"fixed", margin:"0", right:"auto",
      width:width+"px", minWidth:"0", maxWidth:"calc(100vw - 16px)",
      maxHeight:Math.max(80,Math.min(330,up?above:below))+"px",
      left:Math.max(8,Math.min(rect.left,global.innerWidth-width-8))+"px",
      top:up?"auto":(rect.bottom+gap)+"px", bottom:up?(global.innerHeight-rect.top+gap)+"px":"auto"});
  }
  function syncFloatingMenus() {
    if (!canPopover) { return; }
    floatingMenus.forEach(function (entry, menu) {
      if (!visible(entry.anchor) || menu.hidden || !menu.isConnected || menu.parentElement.closest("[hidden]") ||
          (entry.details && !entry.details.open)) {
        if(menu.matches(":popover-open")) { menu.hidePopover(); }
        menu.removeAttribute("popover");
        if(entry.style===null) { menu.removeAttribute("style"); } else { menu.setAttribute("style",entry.style); }
        floatingMenus.delete(menu);
      } else { positionMenu(menu,entry.anchor); }
    });
    doc.querySelectorAll(".bookings-stage-menu, .card-purchases-status-menu, .payment-account-dropdown-popover, .settlement-dropdown, details.setup-picker[open] .setup-picker-menu").forEach(function (menu) {
      if (floatingMenus.has(menu) || !visible(menu)) { return; }
      var details = menu.closest("details.setup-picker");
      var anchor = details ? details.querySelector("summary") : menu.id && doc.querySelector('[aria-controls="'+global.CSS.escape(menu.id)+'"]');
      if (!anchor || !visible(anchor)) { return; }
      floatingMenus.set(menu,{anchor:anchor,details:details,style:menu.getAttribute("style")});
      menu.setAttribute("popover","manual"); menu.showPopover(); positionMenu(menu,anchor);
    });
  }
  global.addEventListener("resize",syncFloatingMenus);
  doc.addEventListener("scroll",function(event){
    floatingMenus.forEach(function(entry,menu){if(!menu.contains(event.target)) { positionMenu(menu,entry.anchor); }});
  },true);

  // Only existing, locally rendered option lists are enhanced here.
  // Remote lookups retain their own query, debounce and pagination contracts.
  function syncCheckboxSearches() {
    doc.querySelectorAll(".bookings-stage-menu, .card-purchases-status-menu").forEach(function(menu) {
      if (!visible(menu)) {
        if (checkboxSearches.has(menu)) {
          menu.querySelectorAll(".ui-option-search, .ui-select-empty").forEach(function(node) { node.remove(); });
          menu.querySelectorAll(".bookings-stage-option[hidden], .service-multi-filter-option[hidden]").forEach(function(row) { row.hidden = false; });
          checkboxSearches.delete(menu);
        }
        return;
      }
      var rows = Array.from(menu.querySelectorAll(".bookings-stage-option, .service-multi-filter-option:not(.service-multi-filter-option--all)"));
      if (rows.length <= 10) {
        if (checkboxSearches.has(menu)) {
          menu.querySelectorAll(".ui-option-search, .ui-select-empty").forEach(function(node) { node.remove(); });
          rows.forEach(function(row) { if (row.hidden) { row.hidden = false; } });
          checkboxSearches.delete(menu);
        }
        return;
      }
      var entry = checkboxSearches.get(menu);
      if (!entry) { entry = {query:""}; checkboxSearches.set(menu, entry); }
      function filter(value) {
        entry.query = value;
        var count = 0, query = normalizeOption(value);
        menu.querySelectorAll(".bookings-stage-option, .service-multi-filter-option:not(.service-multi-filter-option--all)").forEach(function(row) {
          var hidden = !normalizeOption(row.textContent).includes(query);
          if (row.hidden !== hidden) { row.hidden = hidden; }
          if (!hidden) { count++; }
        });
        var empty = menu.querySelector(".ui-select-empty");
        if (empty.hidden !== !!count) { empty.hidden = !!count; }
      }
      if (!menu.querySelector(".ui-option-search")) {
        var control = optionSearch("options", filter), empty = doc.createElement("p");
        empty.className = "ui-select-empty"; empty.textContent = "No matching options"; empty.setAttribute("role","status");
        menu.prepend(control.shell); menu.appendChild(empty);
        control.input.value = entry.query;
        control.shell.querySelector("button").disabled = !entry.query;
        control.shell.addEventListener("keydown", function(event) {
          if(event.key !== "Escape" && event.key !== "Tab") { event.stopPropagation(); }
          if(event.key === "Enter") { event.preventDefault(); }
          if(event.key === "ArrowDown") {
            event.preventDefault();
            var first = menu.querySelector('.bookings-stage-option:not([hidden]) input:not(:disabled), .service-multi-filter-option:not([hidden]) input:not(:disabled), button.service-multi-filter-option:not([hidden]):not(:disabled)');
            if(first) { first.focus(); }
          }
        });
      }
      filter(entry.query);
    });
  }
  doc.addEventListener("keydown",function(event){
    if(event.key!=="Escape" || active) { return; }
    var details=event.target.closest("details.table-filters-popover[open], details.setup-picker[open]");
    if(details) { event.preventDefault();event.stopImmediatePropagation();details.open=false;details.querySelector("summary").focus();return; }
    var entries=Array.from(floatingMenus.entries());
    if(!entries.length) { return; }
    var menu=entries[entries.length-1][0], anchor=entries[entries.length-1][1].anchor;
    var trigger=anchor.tagName==="BUTTON"?anchor:menu.parentElement.querySelector(".settlement-combobox-toggle");
    if(trigger && !trigger.disabled) {
      event.preventDefault();event.stopImmediatePropagation();trigger.click();anchor.focus({preventScroll:true});
    }
  },true);

  // Add focus containment to older ARIA dialogs. Closing remains entirely owned
  // by their existing handlers, including unsaved-change and in-flight guards.
  var dialogs = [], scheduled = false, describedErrors = new Map();
  function syncFieldErrors() {
    describedErrors.forEach(function (entry, control) {
      if (!visible(entry.error) || !entry.error.textContent.trim() || !control.isConnected) {
        var ids=(control.getAttribute("aria-describedby")||"").split(/\s+/).filter(function(id){return id && id!==entry.error.id;});
        if(ids.length) { control.setAttribute("aria-describedby",ids.join(" ")); } else { control.removeAttribute("aria-describedby"); }
        if(entry.invalid===null) { control.removeAttribute("aria-invalid"); } else { control.setAttribute("aria-invalid",entry.invalid); }
        describedErrors.delete(control);
      }
    });
    doc.querySelectorAll(".field .field-error, .operation-edit-field .operation-field-error").forEach(function(error){
      if(!visible(error) || !error.textContent.trim()) { return; }
      var control=error.closest(".field, .operation-edit-field").querySelector("input,select,textarea");
      if(!control || describedErrors.has(control)) { return; }
      if(!error.id) { error.id="ui-field-error-"+(++counter); }
      describedErrors.set(control,{error:error,invalid:control.getAttribute("aria-invalid")});
      var ids=(control.getAttribute("aria-describedby")||"").split(/\s+/).filter(Boolean);
      if(!ids.includes(error.id)) { ids.push(error.id); }
      control.setAttribute("aria-describedby",ids.join(" "));control.setAttribute("aria-invalid","true");
    });
  }
  function focusables(dialog) {
    return Array.from(dialog.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]'))
      .filter(function (node) { return !node.disabled && node.tabIndex >= 0 && visible(node); });
  }
  function syncDialogs() {
    scheduled = false;
    syncFloatingMenus();
    syncCheckboxSearches();
    syncFieldErrors();
    if (active && (!visible(active.select) || active.select.disabled)) { closeSelect(false); }
    var shown = Array.from(doc.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(function(node){
      return visible(node) && global.getComputedStyle(node).pointerEvents !== "none";
    });
    dialogs.slice().reverse().forEach(function (entry) {
      if (!shown.includes(entry.node)) {
        dialogs.splice(dialogs.indexOf(entry), 1);
        if (visible(entry.returnTo) && (!dialogs.length || dialogs[dialogs.length - 1].node.contains(entry.returnTo))) {
          entry.returnTo.focus({preventScroll:true});
        }
      }
    });
    shown.forEach(function (node) {
      if (dialogs.some(function (entry) { return entry.node === node; })) { return; }
      dialogs.push({node:node, returnTo:doc.activeElement});
      if (!node.contains(doc.activeElement)) {
        var initial = focusables(node)[0];
        if (initial) { initial.focus({preventScroll:true}); }
        else { node.tabIndex = -1; node.focus({preventScroll:true}); }
      }
    });
    doc.querySelectorAll('button[aria-label]:not([title])').forEach(function (button) {
      if (!button.textContent.trim() || /^[×✕]$/.test(button.textContent.trim())) { button.title = button.getAttribute("aria-label"); }
    });
  }
  new global.MutationObserver(function () {
    if (!scheduled) { scheduled = true; global.queueMicrotask(syncDialogs); }
  }).observe(doc.body, {childList:true, subtree:true, attributes:true, attributeFilter:["hidden", "open", "disabled", "class"]});
  doc.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || active || !dialogs.length) { return; }
    var top = dialogs[dialogs.length - 1].node;
    if (!visible(top)) { return; }
    if (event.key === "Tab") {
      var items = focusables(top), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!top.contains(doc.activeElement) || (event.shiftKey && doc.activeElement === first) || (!event.shiftKey && doc.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }
  });
  // Preserve the existing toolbar Enter contract. Option searches must not
  // invoke a toolbar's record-search action.
  doc.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) { return; }
    var input = event.target;
    if (input.closest(".ui-option-search")) { return; }
    if (!input.matches("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), select")) { return; }
    var scopes = [
      ["#invoices-filter-toolbar", "#invoices-apply-filters"],
      ["#payments-filter-toolbar", "#payments-apply-filters"],
      ["#operations-filters", "#operations-apply-filters"],
      ["#card-purchases-toolbar", "#card-purchases-apply-filters"],
      ["#ministry-traveller-register .ministry-traveller-register-toolbar", "#ministry-search"]
    ];
    var button;
    scopes.some(function (pair) {
      if (input.closest(pair[0])) { button = doc.querySelector(pair[1]); return true; }
      return false;
    });
    if (!button) {
      var toolbar = input.closest(".table-filter-bar");
      if (toolbar) { button = toolbar.querySelector('button[id*="apply"], button[id$="search"], button[aria-label^="Apply"]'); }
    }
    if (button && !button.disabled && button.getClientRects().length) { event.preventDefault(); button.click(); }
  });
  syncDialogs();
})(window);
