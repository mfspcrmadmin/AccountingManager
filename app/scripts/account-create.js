(function (global) {
var ns = global.PurchasesManagerApp = global.PurchasesManagerApp || {};

  ns.createAccountCreateModule = function (deps) {
    var MODULES = deps.MODULES;
    var FIELD_CANDIDATES = deps.FIELD_CANDIDATES;
    var PAYMENT_ACCOUNT_CREATE_PICKLIST_FALLBACKS = deps.PAYMENT_ACCOUNT_CREATE_PICKLIST_FALLBACKS;
    var state = deps.state;
    var elements = deps.elements;
    var helpers = deps.helpers;
    var crm = deps.crm;
    var renderer = deps.renderer;
    var renderAll = deps.renderAll;
    var debugError = deps.debugError;
    var renderInvoiceCreateSelect = deps.renderInvoiceCreateSelect;
    var ensurePaymentAccountsLoaded = deps.ensurePaymentAccountsLoaded;
    var ensureAccountingAccountsLoaded = deps.ensureAccountingAccountsLoaded;
    var ensureSupplierDefaultPaymentAccountAssigned = deps.ensureSupplierDefaultPaymentAccountAssigned;

    function refreshPaymentAccountCreateActionState() {
      var isEditMode = state.paymentAccountCreation.mode === "edit";
      var isBusy = Boolean(state.paymentAccountCreation.isBusy);
      var badgeText = isEditMode ? "Editing" : "Ready to create";

      if ((state.isLoading || isBusy) && state.paymentAccountCreation.isOpen) {
        badgeText = "Working...";
      } else if (state.paymentAccountCreation.isOpen) {
        badgeText = isEditMode ? "Edit ready" : "Draft ready";
      }

      elements.paymentAccountCreateOpen.disabled = state.isLoading;
      elements.paymentAccountCreateSubmit.disabled = state.isLoading || isBusy;
      elements.paymentAccountCreateClose.disabled = false;
      elements.paymentAccountCreateCancel.disabled = false;
      elements.paymentAccountCreateModeBadge.textContent = badgeText;
      elements.paymentAccountCreateTitle.textContent = isEditMode ? "Edit payment account" : "Create payment account";
      elements.paymentAccountCreateSubmit.textContent = isEditMode ? "Update payment account" : "Create payment account";
    }

    function normalizePaymentAccountCreatePicklistOptions(options) {
      return (options || []).filter(function (item) {
        return item && item.value && item.value !== "-None-";
      });
    }

    function getPaymentAccountCreatePicklistOptions(fieldKey) {
      var field = state.paymentAccountCreation.fields[fieldKey];
      var options = normalizePaymentAccountCreatePicklistOptions(helpers.getPicklistOptions(field));

      if (options.length) {
        return options;
      }

      return (PAYMENT_ACCOUNT_CREATE_PICKLIST_FALLBACKS[fieldKey] || []).map(function (value) {
        return {
          label: value,
          value: value
        };
      });
    }

    function renderPaymentAccountCreateSelect(selectElement, fieldKey, placeholder) {
      var currentValue = selectElement.value;
      var options = getPaymentAccountCreatePicklistOptions(fieldKey);

      renderInvoiceCreateSelect(selectElement, options, placeholder);

      if (currentValue && options.some(function (item) { return String(item.value) === String(currentValue); })) {
        selectElement.value = currentValue;
      }
    }

    function renderPaymentAccountCreatePicklists() {
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateCurrency, "currency", "Select currency");
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateMethodType, "methodType", "Select method type");
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateStatus, "status", "Select status");
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateCardType, "cardType", "Select card type");
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateDepartment, "department", "Select department");
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateJournalType, "journalType", "Select journal type");
      renderPaymentAccountCreateSelect(elements.paymentAccountCreateBankName, "bankName", "Select bank");
    }

    function getResolvedPaymentAccountCreateFieldApi(fieldKey, fallbackApiName) {
      return state.paymentAccountCreation.fields[fieldKey] && state.paymentAccountCreation.fields[fieldKey].api_name
        ? state.paymentAccountCreation.fields[fieldKey].api_name
        : fallbackApiName;
    }

    function getPaymentAccountCreateFieldHost(fieldKey) {
      if (fieldKey === "name" && elements.paymentAccountCreateName) {
        return elements.paymentAccountCreateName.closest(".field");
      }

      return null;
    }

    function renderPaymentAccountCreateFieldError(fieldKey, message) {
      var host = getPaymentAccountCreateFieldHost(fieldKey);
      var input = fieldKey === "name" ? elements.paymentAccountCreateName : null;
      var errorNode;

      if (!host) {
        return;
      }

      errorNode = host.querySelector(".field-error");
      if (!errorNode) {
        errorNode = global.document.createElement("span");
        errorNode.className = "field-error";
        errorNode.hidden = true;
        host.appendChild(errorNode);
      }

      host.classList.toggle("has-error", Boolean(message));
      errorNode.textContent = message || "";
      errorNode.hidden = !message;

      if (input) {
        if (message) {
          input.setAttribute("aria-invalid", "true");
        } else {
          input.removeAttribute("aria-invalid");
        }
      }
    }

    function clearPaymentAccountCreateFieldErrors() {
      renderPaymentAccountCreateFieldError("name", "");
    }

    async function ensurePaymentAccountCreateFieldMetadataLoaded() {
      var response;
      var fields;

      if (state.paymentAccountCreation.fields && Object.keys(state.paymentAccountCreation.fields).length) {
        return;
      }

      try {
        response = await crm.getFields(MODULES.paymentAccounts);
        fields = response && Array.isArray(response.fields) ? response.fields : [];
      } catch (error) {
        debugError("ensurePaymentAccountCreateFieldMetadataLoaded failed", error);
        fields = [];
      }

      state.paymentAccountCreation.fields = {
        name: helpers.findFieldByCandidates(fields, ["Name"]),
        currency: helpers.findFieldByCandidates(fields, ["Currency"]),
        bankAccountName: helpers.findFieldByCandidates(fields, ["Bank_Account_Name", "Bank Account Name"]),
        accountingAccountName: helpers.findFieldByCandidates(fields, ["Accounting_Account_Name", "Accounting Account Name"]),
        iban: helpers.findFieldByCandidates(fields, ["IBAN"]),
        zohoBooksAccountId: helpers.findFieldByCandidates(fields, ["Zoho_Books_Account_ID", "Zoho Books Account ID"]),
        accountingAccountCode: helpers.findFieldByCandidates(fields, ["Accounting_Account_Code", "Accounting Account Code"]),
        methodType: helpers.findFieldByCandidates(fields, ["Method_Type", "Method Type"]),
        status: helpers.findFieldByCandidates(fields, ["Status"]),
        exportCode: helpers.findFieldByCandidates(fields, ["Export_Code", "Export Code"]),
        counterpartAccountName: helpers.findFieldByCandidates(fields, ["Counterpart_Account_Name", "Counterpart Account Name"]),
        counterpartAccountCode: helpers.findFieldByCandidates(fields, ["Counterpart_Account_Code", "Counterpart Account Code"]),
        lastDigits: helpers.findFieldByCandidates(fields, ["Last_Digits", "Last Digits"]),
        accountAlias: helpers.findFieldByCandidates(fields, ["Account_Alias", "Account Alias"]),
        cardType: helpers.findFieldByCandidates(fields, ["Card_Type", "Card Type"]),
        department: helpers.findFieldByCandidates(fields, ["Department"]),
        journalType: helpers.findFieldByCandidates(fields, ["Journal_Type", "Journal Type"]),
        bankName: helpers.findFieldByCandidates(fields, ["Bank_Name", "Bank Name"]),
        externalId: helpers.findFieldByCandidates(fields, ["External_ID", "External ID"]),
        ownerSupplier: helpers.findFieldByCandidates(fields, ["Owner_Supplier", "Owner Supplier"]),
        ownerType: helpers.findFieldByCandidates(fields, ["Owner_Type", "Owner Type"]),
        allowedForSupplierPayments: helpers.findFieldByCandidates(fields, ["Allowed_For_Supplier_Payments", "Allowed For Supplier Payments"])
      };

      renderPaymentAccountCreatePicklists();
    }

    function resetPaymentAccountCreateForm() {
      var supplierTaxName;
      var supplierAccountNumber;

      elements.paymentAccountCreateForm.reset();
      clearPaymentAccountCreateFieldErrors();
      state.paymentAccountCreation.mode = "create";
      state.paymentAccountCreation.recordId = "";
      state.paymentAccountCreation.record = null;
      state.paymentAccountCreation.isBusy = false;
      supplierTaxName = state.supplier
        ? helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.taxName)
        : "";
      supplierAccountNumber = state.supplier
        ? helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.accountNumber)
        : "";
      elements.paymentAccountCreateName.value = supplierTaxName || "";
      elements.paymentAccountCreateIban.value = supplierAccountNumber || "";
      elements.paymentAccountCreateStatus.value = "Active";
      elements.paymentAccountCreateCurrency.value = "EUR";
    }

    function populatePaymentAccountCreateForm(record) {
      var source = record || {};

      clearPaymentAccountCreateFieldErrors();
      elements.paymentAccountCreateName.value = source.Name || "";
      elements.paymentAccountCreateAccountAlias.value = source.Account_Alias || "";
      elements.paymentAccountCreateMethodType.value = source.Method_Type || "";
      elements.paymentAccountCreateStatus.value = source.Status || "Active";
      elements.paymentAccountCreateCurrency.value = source.Currency || "EUR";
      elements.paymentAccountCreateExternalId.value = source.External_ID || "";
      elements.paymentAccountCreateIban.value = source.IBAN || "";
      elements.paymentAccountCreateLastDigits.value = source.Last_Digits || "";
      elements.paymentAccountCreateBankAccountName.value = source.Bank_Account_Name || "";
      elements.paymentAccountCreateBankName.value = source.Bank_Name || "";
      elements.paymentAccountCreateCardType.value = source.Card_Type || "";
      elements.paymentAccountCreateExportCode.value = source.Export_Code || "";
      elements.paymentAccountCreateAccountingAccountName.value = source.Accounting_Account_Name || "";
      elements.paymentAccountCreateAccountingAccountCode.value = source.Accounting_Account_Code || "";
      elements.paymentAccountCreateCounterpartAccountName.value = source.Counterpart_Account_Name || "";
      elements.paymentAccountCreateCounterpartAccountCode.value = source.Counterpart_Account_Code || "";
      elements.paymentAccountCreateJournalType.value = source.Journal_Type || "";
      elements.paymentAccountCreateDepartment.value = source.Department || "";
      elements.paymentAccountCreateZohoBooksAccountId.value = source.Zoho_Books_Account_ID || "";
    }

    function renderPaymentAccountCreatePanel() {
      elements.paymentAccountCreatePanel.hidden = !state.paymentAccountCreation.isOpen;
    }

    async function openCreatePaymentAccountPanel() {
      renderer.showError("");
      state.currentTab = "payments";
      state.views.payments.section = "accounts";
      state.paymentAccountCreation.isOpen = true;
      state.paymentAccountCreation.isBusy = true;
      renderAll();
      renderer.showNotice("Preparing payment account form...", {
        isLoading: true
      });

      try {
        await ensurePaymentAccountCreateFieldMetadataLoaded();
        resetPaymentAccountCreateForm();
        renderPaymentAccountCreatePicklists();
        state.paymentAccountCreation.isBusy = false;
        renderAll();

        if (elements.paymentAccountCreatePanel && typeof elements.paymentAccountCreatePanel.scrollIntoView === "function") {
          elements.paymentAccountCreatePanel.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      } catch (error) {
        debugError("openCreatePaymentAccountPanel failed", error);
        state.paymentAccountCreation.isBusy = false;
        renderer.showError(error.message || "Could not prepare the payment account form.");
        renderAll();
      } finally {
        renderer.showNotice("");
      }
    }

    async function openEditPaymentAccountPanel(accountId) {
      var record;
      var selectedRecord;

      if (!accountId) {
        renderer.showError("Select a payment account first.");
        return;
      }

      renderer.showError("");
      state.currentTab = "payments";
      state.views.payments.section = "accounts";
      state.paymentAccountCreation.isOpen = true;
      state.paymentAccountCreation.mode = "edit";
      state.paymentAccountCreation.recordId = accountId;
      state.paymentAccountCreation.isBusy = true;
      renderAll();
      renderer.showNotice("Loading payment account...", {
        isLoading: true
      });

      try {
        selectedRecord = state.records.paymentAccounts.find(function (item) {
          return String(item.id) === String(accountId);
        }) || null;

        await ensurePaymentAccountCreateFieldMetadataLoaded();
        renderPaymentAccountCreatePicklists();
        resetPaymentAccountCreateForm();
        state.paymentAccountCreation.mode = "edit";
        state.paymentAccountCreation.recordId = accountId;
        if (selectedRecord) {
          populatePaymentAccountCreateForm(selectedRecord);
        }
        renderAll();

        record = await crm.getRecord(MODULES.paymentAccounts, accountId);
        if (!record) {
          throw new Error("Payment account not found in CRM.");
        }

        state.paymentAccountCreation.mode = "edit";
        state.paymentAccountCreation.recordId = accountId;
        state.paymentAccountCreation.record = record;
        state.paymentAccountCreation.isBusy = false;
        renderPaymentAccountCreatePicklists();
        populatePaymentAccountCreateForm(record);
        renderAll();

        if (elements.paymentAccountCreatePanel && typeof elements.paymentAccountCreatePanel.scrollIntoView === "function") {
          elements.paymentAccountCreatePanel.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      } catch (error) {
        debugError("openEditPaymentAccountPanel failed", error, {
          accountId: accountId
        });
        state.paymentAccountCreation.isBusy = false;
        renderer.showError(error.message || "Could not load the payment account for editing.");
        renderAll();
      } finally {
        renderer.showNotice("");
      }
    }

    function closeCreatePaymentAccountPanel() {
      state.paymentAccountCreation.isOpen = false;
      renderer.showError("");
      resetPaymentAccountCreateForm();
      renderAll();
    }

    function refreshAccountingAccountCreateActionState() {
      var isBusy = Boolean(state.accountingAccountCreation.isBusy);

      if (!elements.accountingAccountCreateOpen) {
        return;
      }

      elements.accountingAccountCreateOpen.disabled = state.isLoading || isBusy;
      elements.accountingAccountCreateSubmit.disabled = state.isLoading || isBusy;
      elements.accountingAccountCreateClose.disabled = isBusy;
      elements.accountingAccountCreateCancel.disabled = isBusy;
      elements.accountingAccountCreateTitle.textContent = "Create accounting account";
      elements.accountingAccountCreateSubmit.textContent = isBusy ? "Creating..." : "Create accounting account";
    }

    function getAccountingAccountCreatePicklistOptions(fieldKey) {
      var field = state.accountingAccountCreation.fields[fieldKey];
      return normalizePaymentAccountCreatePicklistOptions(helpers.getPicklistOptions(field));
    }

    function renderAccountingAccountCreateSelect(selectElement, fieldKey, placeholder) {
      var currentValue = selectElement.value;
      var options = getAccountingAccountCreatePicklistOptions(fieldKey);

      renderInvoiceCreateSelect(selectElement, options, placeholder);

      if (currentValue && options.some(function (item) { return String(item.value) === String(currentValue); })) {
        selectElement.value = currentValue;
      }
    }

    function renderAccountingAccountCreatePicklists() {
      renderAccountingAccountCreateSelect(elements.accountingAccountCreateStatus, "status", "Select status");
      renderAccountingAccountCreateSelect(elements.accountingAccountCreateType, "type", "Select account type");
      renderAccountingAccountCreateSelect(elements.accountingAccountCreateSubtype, "subtype", "Select account subtype");
    }

    function getResolvedAccountingAccountCreateFieldApi(fieldKey, fallbackApiName) {
      return state.accountingAccountCreation.fields[fieldKey] && state.accountingAccountCreation.fields[fieldKey].api_name
        ? state.accountingAccountCreation.fields[fieldKey].api_name
        : fallbackApiName;
    }

    function getAccountingAccountCreateFieldHost(fieldKey) {
      if (fieldKey === "code" && elements.accountingAccountCreateCode) {
        return elements.accountingAccountCreateCode.closest(".field");
      }

      return null;
    }

    function renderAccountingAccountCreateFieldError(fieldKey, message) {
      var host = getAccountingAccountCreateFieldHost(fieldKey);
      var input = fieldKey === "code" ? elements.accountingAccountCreateCode : null;
      var errorNode;

      if (!host) {
        return;
      }

      errorNode = host.querySelector(".field-error");
      if (!errorNode) {
        errorNode = global.document.createElement("span");
        errorNode.className = "field-error";
        errorNode.hidden = true;
        host.appendChild(errorNode);
      }

      host.classList.toggle("has-error", Boolean(message));
      errorNode.textContent = message || "";
      errorNode.hidden = !message;

      if (input) {
        if (message) {
          input.setAttribute("aria-invalid", "true");
        } else {
          input.removeAttribute("aria-invalid");
        }
      }
    }

    function clearAccountingAccountCreateFieldErrors() {
      renderAccountingAccountCreateFieldError("code", "");
    }

    async function ensureAccountingAccountCreateFieldMetadataLoaded() {
      var response;
      var fields;

      if (state.accountingAccountCreation.fields && Object.keys(state.accountingAccountCreation.fields).length) {
        return;
      }

      try {
        response = await crm.getFields(MODULES.accountingAccounts);
        fields = response && Array.isArray(response.fields) ? response.fields : [];
      } catch (error) {
        debugError("ensureAccountingAccountCreateFieldMetadataLoaded failed", error);
        fields = [];
      }

      state.accountingAccountCreation.fields = {
        code: helpers.findFieldByCandidates(fields, ["Name", "Account_Code", "Account Code"]),
        name: helpers.findFieldByCandidates(fields, ["Account_Name", "Account Name"]),
        status: helpers.findFieldByCandidates(fields, ["Status"]),
        type: helpers.findFieldByCandidates(fields, ["Account_Type", "Account Type"]),
        subtype: helpers.findFieldByCandidates(fields, ["Account_Subtype", "Account Subtype"])
      };

      renderAccountingAccountCreatePicklists();
    }

    function resetAccountingAccountCreateForm() {
      elements.accountingAccountCreateForm.reset();
      clearAccountingAccountCreateFieldErrors();
      state.accountingAccountCreation.isBusy = false;
      elements.accountingAccountCreateStatus.value = "Active";
      elements.accountingAccountCreateType.value = "";
      elements.accountingAccountCreateSubtype.value = "";
    }

    function renderAccountingAccountCreatePanel() {
      elements.accountingAccountCreatePanel.hidden = !state.accountingAccountCreation.isOpen;
    }

    async function openCreateAccountingAccountPanel() {
      renderer.showError("");
      state.currentTab = "accounting";
      state.accountingTab = "accounts";
      state.accountingAccountCreation.isOpen = true;
      state.accountingAccountCreation.isBusy = true;
      renderAll();
      renderer.showNotice("Preparing accounting account form...", {
        isLoading: true
      });

      try {
        await ensureAccountingAccountCreateFieldMetadataLoaded();
        resetAccountingAccountCreateForm();
        renderAccountingAccountCreatePicklists();
        state.accountingAccountCreation.isBusy = false;
        renderAll();

        if (elements.accountingAccountCreatePanel && typeof elements.accountingAccountCreatePanel.scrollIntoView === "function") {
          elements.accountingAccountCreatePanel.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        }
      } catch (error) {
        debugError("openCreateAccountingAccountPanel failed", error);
        state.accountingAccountCreation.isBusy = false;
        renderer.showError(error.message || "Could not prepare the accounting account form.");
        renderAll();
      } finally {
        renderer.showNotice("");
      }
    }

    function closeCreateAccountingAccountPanel() {
      state.accountingAccountCreation.isOpen = false;
      renderer.showError("");
      resetAccountingAccountCreateForm();
      renderAll();
    }

    async function refreshAccountingAccountsAfterSave(accountId) {
      state.loaded.accountingAccounts = false;
      state.records.accountingAccounts = [];
      await ensureAccountingAccountsLoaded();
      state.views.accountingAccounts.selectedId = accountId || "";
    }

    async function onCreateAccountingAccountSubmit(event) {
      var payload = {};
      var response;
      var created;
      var status;
      var createdId;

      event.preventDefault();
      renderer.showError("");
      clearAccountingAccountCreateFieldErrors();

      if (!elements.accountingAccountCreateCode.value.trim()) {
        renderAccountingAccountCreateFieldError("code", "Enter an account code.");
        renderer.showError("Enter an account code before creating the record.");
        return;
      }

      payload[getResolvedAccountingAccountCreateFieldApi("code", "Name")] = elements.accountingAccountCreateCode.value.trim();

      if (elements.accountingAccountCreateName.value.trim()) {
        payload[getResolvedAccountingAccountCreateFieldApi("name", "Account_Name")] = elements.accountingAccountCreateName.value.trim();
      }

      if (elements.accountingAccountCreateStatus.value) {
        payload[getResolvedAccountingAccountCreateFieldApi("status", "Status")] = elements.accountingAccountCreateStatus.value;
      }

      if (elements.accountingAccountCreateType.value) {
        payload[getResolvedAccountingAccountCreateFieldApi("type", "Account_Type")] = elements.accountingAccountCreateType.value;
      }

      if (elements.accountingAccountCreateSubtype.value) {
        payload[getResolvedAccountingAccountCreateFieldApi("subtype", "Account_Subtype")] = elements.accountingAccountCreateSubtype.value;
      }

      state.accountingAccountCreation.isBusy = true;
      renderer.setLoading(true, "Creating accounting account...");
      refreshAccountingAccountCreateActionState();

      try {
        response = await crm.insertRecord(MODULES.accountingAccounts, payload);
        created = helpers.extractRecords(response)[0] || {};
        status = String(created.status || created.code || "").toLowerCase();

        if (status && status !== "success") {
          throw new Error(created.message || "Zoho CRM did not confirm the accounting account creation.");
        }

        createdId = created.details && created.details.id;
        await refreshAccountingAccountsAfterSave(createdId);
        closeCreateAccountingAccountPanel();
        renderer.showNotice("Accounting account created successfully in Zoho CRM.", {
          tone: "success"
        });
      } catch (error) {
        debugError("create accounting account flow error", error, {
          accountingAccountPayload: payload,
          rawResponse: response
        });
        renderer.showError(error.message || "Zoho CRM rejected the accounting account creation.");
      } finally {
        state.accountingAccountCreation.isBusy = false;
        renderer.setLoading(false);
        refreshAccountingAccountCreateActionState();
        renderAll();
      }
    }

    async function refreshPaymentAccountsAfterSave(recordId) {
      state.loaded.paymentAccounts = false;
      state.records.paymentAccounts = [];

      await ensurePaymentAccountsLoaded();

      if (recordId) {
        state.views.paymentAccounts.selectedId = recordId;
      }

      renderAll();
    }

    async function onCreatePaymentAccountSubmit(event) {
      var payload = {};
      var response;
      var created;
      var status;
      var createdId;
      var didAssignDefaultPaymentAccount = false;
      var isEditMode = state.paymentAccountCreation.mode === "edit";
      var recordId = state.paymentAccountCreation.recordId;
      var supplierAccountNumber = state.supplier
        ? helpers.getCandidateValue(state.supplier, FIELD_CANDIDATES.supplier.accountNumber)
        : "";
      var ibanValue = elements.paymentAccountCreateIban.value.trim() || (!isEditMode ? String(supplierAccountNumber || "").trim() : "");

      event.preventDefault();
      renderer.showError("");
      clearPaymentAccountCreateFieldErrors();

      if (!elements.paymentAccountCreateName.value.trim()) {
        renderPaymentAccountCreateFieldError("name", "Enter a payment account name.");
        renderer.showError("Enter a payment account name before creating the record.");
        return;
      }

      payload[getResolvedPaymentAccountCreateFieldApi("name", "Name")] = elements.paymentAccountCreateName.value.trim();

      if (!isEditMode && state.supplierId) {
        payload[getResolvedPaymentAccountCreateFieldApi("ownerSupplier", "Owner_Supplier")] = state.supplierId;
        payload[getResolvedPaymentAccountCreateFieldApi("ownerType", "Owner_Type")] = "Supplier";
        payload[getResolvedPaymentAccountCreateFieldApi("allowedForSupplierPayments", "Allowed_For_Supplier_Payments")] = true;
      }

      if (elements.paymentAccountCreateAccountAlias.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("accountAlias", "Account_Alias")] = elements.paymentAccountCreateAccountAlias.value.trim();
      }

      if (elements.paymentAccountCreateMethodType.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("methodType", "Method_Type")] = elements.paymentAccountCreateMethodType.value;
      }

      if (elements.paymentAccountCreateStatus.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("status", "Status")] = elements.paymentAccountCreateStatus.value;
      }

      if (elements.paymentAccountCreateCurrency.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("currency", "Currency")] = elements.paymentAccountCreateCurrency.value;
      }

      if (elements.paymentAccountCreateExternalId.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("externalId", "External_ID")] = elements.paymentAccountCreateExternalId.value.trim();
      }

      if (ibanValue) {
        payload[getResolvedPaymentAccountCreateFieldApi("iban", "IBAN")] = ibanValue;
      }

      if (elements.paymentAccountCreateLastDigits.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("lastDigits", "Last_Digits")] = elements.paymentAccountCreateLastDigits.value.trim();
      }

      if (elements.paymentAccountCreateBankAccountName.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("bankAccountName", "Bank_Account_Name")] = elements.paymentAccountCreateBankAccountName.value.trim();
      }

      if (elements.paymentAccountCreateBankName.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("bankName", "Bank_Name")] = elements.paymentAccountCreateBankName.value;
      }

      if (elements.paymentAccountCreateCardType.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("cardType", "Card_Type")] = elements.paymentAccountCreateCardType.value;
      }

      if (elements.paymentAccountCreateExportCode.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("exportCode", "Export_Code")] = elements.paymentAccountCreateExportCode.value.trim();
      }

      if (elements.paymentAccountCreateAccountingAccountName.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("accountingAccountName", "Accounting_Account_Name")] = elements.paymentAccountCreateAccountingAccountName.value.trim();
      }

      if (elements.paymentAccountCreateAccountingAccountCode.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("accountingAccountCode", "Accounting_Account_Code")] = elements.paymentAccountCreateAccountingAccountCode.value.trim();
      }

      if (elements.paymentAccountCreateCounterpartAccountName.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("counterpartAccountName", "Counterpart_Account_Name")] = elements.paymentAccountCreateCounterpartAccountName.value.trim();
      }

      if (elements.paymentAccountCreateCounterpartAccountCode.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("counterpartAccountCode", "Counterpart_Account_Code")] = elements.paymentAccountCreateCounterpartAccountCode.value.trim();
      }

      if (elements.paymentAccountCreateJournalType.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("journalType", "Journal_Type")] = elements.paymentAccountCreateJournalType.value;
      }

      if (elements.paymentAccountCreateDepartment.value) {
        payload[getResolvedPaymentAccountCreateFieldApi("department", "Department")] = elements.paymentAccountCreateDepartment.value;
      }

      if (elements.paymentAccountCreateZohoBooksAccountId.value.trim()) {
        payload[getResolvedPaymentAccountCreateFieldApi("zohoBooksAccountId", "Zoho_Books_Account_ID")] = elements.paymentAccountCreateZohoBooksAccountId.value.trim();
      }

      renderer.setLoading(true, isEditMode ? "Updating payment account..." : "Creating payment account...");
      refreshPaymentAccountCreateActionState();

      try {
        response = isEditMode
          ? await crm.updateRecord(MODULES.paymentAccounts, recordId, payload)
          : await crm.insertRecord(MODULES.paymentAccounts, payload);
        created = helpers.extractRecords(response)[0] || {};
        status = String(created.status || created.code || "").toLowerCase();

        if (status && status !== "success") {
          throw new Error(created.message || (isEditMode
            ? "Zoho CRM did not confirm the payment account update."
            : "Zoho CRM did not confirm the payment account creation."));
        }

        createdId = (created.details && created.details.id) || recordId;
        if (!isEditMode && state.supplierId && createdId) {
          didAssignDefaultPaymentAccount = await ensureSupplierDefaultPaymentAccountAssigned(state.supplierId, createdId);
        }
        await refreshPaymentAccountsAfterSave(createdId);
        closeCreatePaymentAccountPanel();
        renderer.showNotice(isEditMode
          ? "Payment account updated successfully in Zoho CRM."
          : "Payment account created successfully in Zoho CRM." + (didAssignDefaultPaymentAccount ? " Supplier default payment account updated." : ""), {
          tone: "success"
        });
      } catch (error) {
        debugError("create payment account flow error", error, {
          paymentAccountPayload: payload,
          mode: state.paymentAccountCreation.mode,
          recordId: recordId,
          rawResponse: response
        });
        renderer.showError(error.message || (isEditMode
          ? "Zoho CRM rejected the payment account update."
          : "Zoho CRM rejected the payment account creation."));
      } finally {
        renderer.setLoading(false);
        refreshPaymentAccountCreateActionState();
      }
    }

    return {
      refreshPaymentAccountCreateActionState: refreshPaymentAccountCreateActionState,
      renderPaymentAccountCreatePicklists: renderPaymentAccountCreatePicklists,
      clearPaymentAccountCreateFieldErrors: clearPaymentAccountCreateFieldErrors,
      resetPaymentAccountCreateForm: resetPaymentAccountCreateForm,
      renderPaymentAccountCreatePanel: renderPaymentAccountCreatePanel,
      openCreatePaymentAccountPanel: openCreatePaymentAccountPanel,
      openEditPaymentAccountPanel: openEditPaymentAccountPanel,
      closeCreatePaymentAccountPanel: closeCreatePaymentAccountPanel,
      onCreatePaymentAccountSubmit: onCreatePaymentAccountSubmit,
      refreshAccountingAccountCreateActionState: refreshAccountingAccountCreateActionState,
      clearAccountingAccountCreateFieldErrors: clearAccountingAccountCreateFieldErrors,
      renderAccountingAccountCreatePanel: renderAccountingAccountCreatePanel,
      openCreateAccountingAccountPanel: openCreateAccountingAccountPanel,
      closeCreateAccountingAccountPanel: closeCreateAccountingAccountPanel,
      onCreateAccountingAccountSubmit: onCreateAccountingAccountSubmit
    };
  };
}(window));
