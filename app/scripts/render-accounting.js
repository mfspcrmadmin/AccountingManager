(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.createAccountingRenderer = function (deps) {
    var elements = deps.elements;
    var state = deps.state;
    var helpers = deps.helpers;
    var fieldCandidates = deps.fieldCandidates;
    var bindSortableHeaders = deps.bindSortableHeaders;

    function renderAccountingWorkspace(activeTab) {
      var isEntries = activeTab !== "lines" && activeTab !== "accounts" && activeTab !== "rules";
      var isLines = activeTab === "lines";
      var isAccounts = activeTab === "accounts";
      var isRules = activeTab === "rules";

      elements.accountingTabEntries.classList.toggle("is-active", isEntries);
      elements.accountingTabEntries.setAttribute("aria-selected", isEntries ? "true" : "false");
      elements.accountingTabLines.classList.toggle("is-active", isLines);
      elements.accountingTabLines.setAttribute("aria-selected", isLines ? "true" : "false");
      elements.accountingTabAccounts.classList.toggle("is-active", isAccounts);
      elements.accountingTabAccounts.setAttribute("aria-selected", isAccounts ? "true" : "false");
      elements.accountingTabRules.classList.toggle("is-active", isRules);
      elements.accountingTabRules.setAttribute("aria-selected", isRules ? "true" : "false");
      elements.accountingEntriesWorkspace.hidden = !isEntries;
      elements.accountingEntryLinesWorkspace.hidden = !isLines;
      elements.accountingAccountsWorkspace.hidden = !isAccounts;
      elements.accountingRulesWorkspace.hidden = !isRules;
    }

    function renderAccountingEntriesWorkspace(view, onSortChange) {
      var accountingEntriesSortLabels = {
        date: "Date",
        entry: "Entry",
        movement: "Movement",
        invoice: "Invoice",
        supplier: "Supplier",
        mfsp: "MFSP",
        status: "Status",
        debit: "Debit",
        credit: "Credit"
      };

      elements.accountingEntriesCount.textContent = view.countLabel;

      if (!view.records.length) {
        elements.accountingEntriesEmpty.textContent = view.emptyMessage;
        elements.accountingEntriesEmpty.hidden = false;
        elements.accountingEntriesTableWrap.hidden = true;
        elements.accountingEntriesPaginationBar.hidden = true;
        elements.accountingEntriesTableBody.innerHTML = "";
      } else {
        elements.accountingEntriesTableBody.innerHTML = view.records.map(function (entry) {
          return [
            "<tr>",
            "  <td>" + helpers.escapeHtml(helpers.formatDate(entry.Entry_Date || entry.Posting_Date || entry.Source_Date || entry.Invoice_Date)) + "</td>",
            "  <td>" + helpers.escapeHtml(entry.Name || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(entry.Movement_Type || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.getLookupName(entry.Supplier_Invoice) || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.getLookupName(entry.Supplier) || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(entry.MFSP_Reference || "-") + "</td>",
            "  <td><span class=\"status-pill " + helpers.escapeHtml(helpers.getStatusTone(entry.Accounting_Status)) + "\">" + helpers.escapeHtml(entry.Accounting_Status || "-") + "</span></td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(Number(entry.Total_Debit || 0) || 0)) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(Number(entry.Total_Credit || 0) || 0)) + "</td>",
            "</tr>"
          ].join("");
        }).join("");

        elements.accountingEntriesEmpty.hidden = true;
        elements.accountingEntriesTableWrap.hidden = false;
        elements.accountingEntriesPaginationBar.hidden = view.page <= 1 && !view.hasMore;
        elements.accountingEntriesPaginationCopy.textContent = view.pageSummary;
      }

      bindSortableHeaders(
        elements.accountingEntriesTableWrap,
        "th[data-accounting-entries-sort]",
        "data-accounting-entries-sort",
        accountingEntriesSortLabels,
        view.sort,
        onSortChange
      );

      elements.accountingEntriesPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.accountingEntriesNextPage.disabled = state.isLoading || !view.hasMore;
    }

    function renderAccountingEntryLinesWorkspace(view, onSortChange) {
      var accountingEntryLinesSortLabels = {
        name: "Name",
        date: "Date",
        account: "Account",
        debit: "Debit",
        credit: "Credit",
        lineNo: "Line No",
        lineType: "Line Type"
      };

      elements.accountingEntryLinesCount.textContent = view.countLabel;

      if (!view.records.length) {
        elements.accountingEntryLinesEmpty.textContent = view.emptyMessage;
        elements.accountingEntryLinesEmpty.hidden = false;
        elements.accountingEntryLinesTableWrap.hidden = true;
        elements.accountingEntryLinesPaginationBar.hidden = true;
        elements.accountingEntryLinesTableBody.innerHTML = "";
      } else {
        elements.accountingEntryLinesTableBody.innerHTML = view.records.map(function (line) {
          var accountLookup = line && line.Account;
          var accountId = helpers.getLookupId(accountLookup);
          var accountRecord = accountId
            ? state.records.accountingAccounts.find(function (record) {
              return String(record && record.id || "") === String(accountId);
            }) || null
            : null;
          var accountLabel = accountLookup && typeof accountLookup === "object"
            ? String(accountLookup.name || accountLookup.Name || accountLookup.Account_Code || accountLookup.Account_Name || "")
            : "";

          if (!accountLabel && accountRecord) {
            accountLabel = String(accountRecord.Name || accountRecord.Account_Code || accountRecord.Account_Name || "");
          }

          if (!accountLabel && accountLookup && typeof accountLookup !== "object") {
            accountLabel = String(accountLookup || "");
          }

          return [
            "<tr>",
            "  <td>" + helpers.escapeHtml(line.Name || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.formatDate(line.Source_Date || line.Date)) + "</td>",
            "  <td>" + helpers.escapeHtml(accountLabel || "-") + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(Number(line.Debit || 0) || 0)) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(helpers.formatCurrency(Number(line.Credit || 0) || 0)) + "</td>",
            '  <td class="numeric-cell">' + helpers.escapeHtml(String(line.Line_No || "-")) + "</td>",
            "  <td>" + helpers.escapeHtml(line.Line_Type || "-") + "</td>",
            "</tr>"
          ].join("");
        }).join("");

        elements.accountingEntryLinesEmpty.hidden = true;
        elements.accountingEntryLinesTableWrap.hidden = false;
        elements.accountingEntryLinesPaginationBar.hidden = view.page <= 1 && !view.hasMore;
        elements.accountingEntryLinesPaginationCopy.textContent = view.pageSummary;
      }

      bindSortableHeaders(
        elements.accountingEntryLinesTableWrap,
        "th[data-accounting-entry-lines-sort]",
        "data-accounting-entry-lines-sort",
        accountingEntryLinesSortLabels,
        view.sort,
        onSortChange
      );

      elements.accountingEntryLinesPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.accountingEntryLinesNextPage.disabled = state.isLoading || !view.hasMore;
    }

    function renderAccountingAccountsWorkspace(view, onSelected) {
      elements.accountingAccountsCount.textContent = view.records.length + (view.records.length === 1 ? " account" : " accounts");

      if (!view.records.length) {
        elements.accountingAccountsEmpty.textContent = view.emptyMessage;
        elements.accountingAccountsEmpty.hidden = false;
        elements.accountingAccountsTableWrap.hidden = true;
        elements.accountingAccountsPaginationBar.hidden = true;
        elements.accountingAccountsTableBody.innerHTML = "";
      } else {
        elements.accountingAccountsTableBody.innerHTML = view.visibleRecords.map(function (account) {
          var isActive = account.id === view.selectedId;

          return [
            '<tr class="is-clickable' + (isActive ? " is-active" : "") + '" data-accounting-account-id="' + helpers.escapeHtml(account.id) + '">',
            "  <td>" + helpers.escapeHtml(account.Name || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(account.Account_Name || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(account.Account_Type || "-") + "</td>",
            '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(account.Status)) + '">' + helpers.escapeHtml(account.Status || "-") + "</span></td>",
            "</tr>"
          ].join("");
        }).join("");

        Array.prototype.forEach.call(elements.accountingAccountsTableBody.querySelectorAll("tr[data-accounting-account-id]"), function (row) {
          row.addEventListener("click", function () {
            onSelected(row.getAttribute("data-accounting-account-id"));
          });
        });

        elements.accountingAccountsEmpty.hidden = true;
        elements.accountingAccountsTableWrap.hidden = false;
        elements.accountingAccountsPaginationBar.hidden = view.totalPages <= 1;
        elements.accountingAccountsPaginationCopy.textContent = "Page " + view.page + " of " + view.totalPages;
      }

      elements.accountingAccountsPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.accountingAccountsNextPage.disabled = state.isLoading || view.page >= view.totalPages;
    }

    function renderSelectedAccountingAccount(account) {
      var status;
      var tone;

      if (!account) {
        if (elements.selectedAccountingAccountPill) {
          elements.selectedAccountingAccountPill.textContent = "No account selected";
        }
        elements.selectedAccountingAccountEmpty.hidden = false;
        elements.selectedAccountingAccountContent.hidden = true;
        return;
      }

      status = account.Status || "-";
      tone = helpers.getStatusTone(status);
      if (elements.selectedAccountingAccountPill) {
        elements.selectedAccountingAccountPill.textContent = account.Name || "Accounting account";
      }
      elements.selectedAccountingAccountEmpty.hidden = true;
      elements.selectedAccountingAccountContent.hidden = false;
      elements.selectedAccountingAccountTitle.textContent = account.Name || "-";
      elements.selectedAccountingAccountStatus.textContent = status;
      elements.selectedAccountingAccountStatus.className = "status-pill " + tone;
      elements.selectedAccountingAccountCode.textContent = helpers.textValue(account.Name);
      elements.selectedAccountingAccountName.textContent = helpers.textValue(account.Account_Name);
      elements.selectedAccountingAccountType.textContent = helpers.textValue(account.Account_Type);
      elements.selectedAccountingAccountSubtype.textContent = helpers.textValue(account.Account_Subtype);
      elements.selectedAccountingAccountBooksId.textContent = helpers.textValue(account.Zoho_Books_Account_Id);
    }

    function renderAccountingRulesWorkspace(view, onSelected) {
      elements.accountingRulesCount.textContent = view.records.length + (view.records.length === 1 ? " rule" : " rules");

      if (!view.records.length) {
        elements.accountingRulesEmpty.textContent = view.emptyMessage;
        elements.accountingRulesEmpty.hidden = false;
        elements.accountingRulesTableWrap.hidden = true;
        elements.accountingRulesPaginationBar.hidden = true;
        elements.accountingRulesTableBody.innerHTML = "";
      } else {
        elements.accountingRulesTableBody.innerHTML = view.visibleRecords.map(function (rule) {
          var isActive = rule.id === view.selectedId;

          return [
            '<tr class="is-clickable' + (isActive ? " is-active" : "") + '" data-accounting-rule-id="' + helpers.escapeHtml(rule.id) + '">',
            "  <td>" + helpers.escapeHtml(rule.Name || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.getCandidateValue(rule, fieldCandidates.accountingRule.tripType) || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.booleanLabel(Boolean(rule.Is_Self_Employed))) + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.getLookupName(rule.Base_Expense_Account) || "-") + "</td>",
            "  <td>" + helpers.escapeHtml(helpers.getLookupName(rule.Reimbursable_Account) || "-") + "</td>",
            '  <td><span class="status-pill ' + helpers.escapeHtml(helpers.getStatusTone(rule.Status)) + '">' + helpers.escapeHtml(rule.Status || "-") + "</span></td>",
            "</tr>"
          ].join("");
        }).join("");

        Array.prototype.forEach.call(elements.accountingRulesTableBody.querySelectorAll("tr[data-accounting-rule-id]"), function (row) {
          row.addEventListener("click", function () {
            onSelected(row.getAttribute("data-accounting-rule-id"));
          });
        });

        elements.accountingRulesEmpty.hidden = true;
        elements.accountingRulesTableWrap.hidden = false;
        elements.accountingRulesPaginationBar.hidden = view.totalPages <= 1;
        elements.accountingRulesPaginationCopy.textContent = "Page " + view.page + " of " + view.totalPages;
      }

      elements.accountingRulesPrevPage.disabled = state.isLoading || view.page <= 1;
      elements.accountingRulesNextPage.disabled = state.isLoading || view.page >= view.totalPages;
    }

    function renderSelectedAccountingRule(rule) {
      var status;
      var tone;

      if (!rule) {
        elements.selectedAccountingRuleEmpty.hidden = false;
        elements.selectedAccountingRuleContent.hidden = true;
        return;
      }

      status = rule.Status || "-";
      tone = helpers.getStatusTone(status);
      elements.selectedAccountingRuleEmpty.hidden = true;
      elements.selectedAccountingRuleContent.hidden = false;
      elements.selectedAccountingRuleTitle.textContent = rule.Name || "-";
      elements.selectedAccountingRuleStatus.textContent = status;
      elements.selectedAccountingRuleStatus.className = "status-pill " + tone;
      elements.selectedAccountingRuleTripType.textContent = helpers.textValue(helpers.getCandidateValue(rule, fieldCandidates.accountingRule.tripType));
      elements.selectedAccountingRuleSelfEmployed.textContent = helpers.booleanLabel(Boolean(rule.Is_Self_Employed));
      elements.selectedAccountingRuleBaseExpenseAccount.textContent = helpers.textValue(helpers.getLookupName(rule.Base_Expense_Account));
      elements.selectedAccountingRuleReimbursableAccount.textContent = helpers.textValue(helpers.getLookupName(rule.Reimbursable_Account));
    }

    return {
      renderAccountingWorkspace: renderAccountingWorkspace,
      renderAccountingEntriesWorkspace: renderAccountingEntriesWorkspace,
      renderAccountingEntryLinesWorkspace: renderAccountingEntryLinesWorkspace,
      renderAccountingAccountsWorkspace: renderAccountingAccountsWorkspace,
      renderSelectedAccountingAccount: renderSelectedAccountingAccount,
      renderAccountingRulesWorkspace: renderAccountingRulesWorkspace,
      renderSelectedAccountingRule: renderSelectedAccountingRule
    };
  };
}(window));
