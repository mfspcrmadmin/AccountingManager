(function (global) {
var ns = global.AccountingManagerApp = global.AccountingManagerApp || {};

  ns.MODULES = {
    suppliers: "Vendors",
    bookings: "Deals",
    settlements: "Supplier_Settlements",
    invoices: "Supplier_Invoices",
    bookingServices: "Booking_Services",
    invoiceLines: "Supplier_Invoice_Lines",
    invoiceSettlementAllocations: "Inv_Set_Allocations",
    payAllocations: "Supplier_Pay_Allocations",
    payments: "Supplier_Payments",
    paymentAccounts: "Payment_Accounts",
    accountingEntries: "Accounting_Entries",
    accountingEntryLines: "Accounting_Entry_Lines",
    accountingAccounts: "Accounting_Accounts",
    accountingRules: "Accounting_Rules",
    userRelationships: "User_Relationships"
  };

  ns.FIELD_CANDIDATES = {
    supplier: {
      name: ["Vendor_Name"],
      connectionReference: ["TP_Reference", "Connection_Reference", "Supplier_Connection_Reference", "Connection Reference"],
      ezusReference: [
        "Ezus_Supplier_API"
      ],
      lastEzusSyncAt: ["Last_Ezus_Sync_At", "Last Ezus Sync At", "Last_EZUS_Sync_At"],
      lastEzusSyncBy: ["Last_Ezus_Sync_By", "Last Ezus Sync By", "Last_EZUS_Sync_By"],
      vendorType: ["Vendor_Type", "Vendor Type"],
      category: ["Supplier_Category", "Category"],
      subcategory: ["Subcategory"],
      destination: ["Destination"],
      subdestination: ["Subdestination"],
      accounting: ["Cuenta_Contable"],
      selfEmployed: ["Is_Self_Employed", "Is Self Employed", "Self_Employed", "Self Employed", "Autonomo", "Es_Autonomo"],
      accountNumber: ["IBAN", "Account_Number"],
      cifNif: ["CIF_NIF"],
      defaultAccountingAccount: ["Default_Accounting_Account"],
      defaultPaymentAccount: ["Default_Payment_Account"],
      defaultAccountingRule: ["Default_Accounting_Rule"],
      paymentMethod: ["Payment_Method"],
      paymentConditions: ["Payment_Conditions"],
      cancellationPolicy: ["Cancellation_Policy"],
      commissionStatus: ["Commission_Status"],
      commissionAmount: ["Commission_Amount"],
      commissionNotes: ["Commission_Notes"],
      address: ["Address"],
      cityTown: ["City_Town"],
      analysisCity: ["Analysis_City"],
      city: ["City"],
      country: ["Country"],
      zipCode: ["Zip_Code"],
      website: ["Website"],
      taxName: ["Tax_Name"],
      mailingAddress: ["Mailing_Address"],
      mailingCity: ["Mailing_City", "City"],
      postCode: ["Post_Code"],
      mailingCountry: ["Mailing_Country"]
    },
    booking: {
      name: ["Deal_Name", "Name"],
      mfsp: ["MFSP_Reference", "MFSP Reference"],
      ezusProjectRef: ["Ezus_Project_ID", "Ezus Project API", "Ezus Project ID"],
      arrivalDate: ["Arrival_Date", "Arrival Date"],
      departureDate: ["Departure_Date", "Departure Date"],
      agency: ["Account_Name", "Agency Name", "Agency"],
      consortia: ["Consortia"],
      iataCode: ["IATA_Code", "IATA Code"],
      stage: ["Stage"],
      closureStatus: ["Closure_Status", "Closure Status"],
      travellersNumber: ["Travellers_Number"],
      salesPrice: ["Sales_Price_inc_Taxes"],
      purchasePrice: ["Purchase_Price_inc_Taxes"],
      grossMargin: ["Gross_Margin"],
      netMargin: ["Net_Margin"],
      balanceAmount: ["Balance_Amount"],
      totalPaidAmount: ["Paid_Amount"],
      totalRefundAmount: ["Total_Refund_Amount"],
      totalRequestedAmount: ["Total_Requested_Amount"],
      agentCommissionAmount: ["Final_Commission"],
      accountingRep: ["Accounting_Rep"]
    },
    settlement: {
      closureReviewStatus: ["Closure_Review_Status", "Closure Review Status"]
    },
    invoice: {
      number: ["Name", "Invoice_Number", "Invoice Number"],
      invoiceType: ["Invoice_Type", "Invoice Type"],
      status: ["Status"],
      date: ["Invoice_Date", "Invoice Date", "Date"],
      amountExclVat: ["Invoice_Amount_Excl_VAT", "Invoice Amount Excl VAT"],
      amountInclVat: ["Invoice_Amount_Incl_VAT", "Invoice Amount Incl VAT"],
      amount: ["Invoice_Amount_Incl_VAT", "Invoice Amount Incl VAT", "Invoice_Amount_Excl_VAT", "Invoice Amount Excl VAT", "Amount"],
      vatPercent: ["VAT_percentage", "VAT %", "VAT Percentage"],
      vatAmount: ["VAT_Amount", "VAT Amount"],
      additionalAmountExclVat: ["Additional_Amount_Excl_VAT", "Additional Amount Excl VAT"],
      additionalAmountInclVat: ["Additional_Amount_Incl_VAT", "Additional Amount Incl VAT"],
      additionalVatPercent: ["Additional_VAT_percentage", "Additional VAT %", "Additional VAT Percentage"],
      additionalVatAmount: ["Additional_VAT_Amount", "Additional VAT Amount"],
      additionalIrpfPercent: ["Additional_IRPF_percentage", "Additional IRPF %", "Additional IRPF Percentage"],
      additionalIrpfAmount: ["Additional_IRPF_Amount", "Additional IRPF Amount"],
      irpfPercent: ["IRPF_percentage", "IRPF %", "IRPF Percentage"],
      irpfAmount: ["IRPF_Amount", "IRPF Amount"],
      reimbursableExpense: ["Reimbursable_Expense", "Reimbursable Expense"],
      unpaidAmount: ["Unpaid_Invoiced_Amount", "Unpaid Invoiced Amount"],
      amountPaid: ["Amount_Paid", "Amount Paid"],
      invoiceTotal: ["Invoice_Total", "Invoice Total"],
      totalPayableAmount: ["Total_Payable_Amount", "Total Payable Amount"],
      totalAmount: ["Invoice_Total", "Invoice Total", "Total_Payable_Amount", "Total Payable Amount"],
      originalInvoice: ["Original_Invoice", "Original Invoice"],
      supplier: ["Supplier"],
      supplierName: ["Supplier_Name", "Supplier Name"],
      supplierConnectionReference: ["Supplier_Code", "Supplier Code", "TP_Reference", "Connection_Reference", "Supplier_Connection_Reference", "Supplier Connection Reference"],
      mfsp: ["MFSP_Reference", "MFSP Reference"],
      booking: ["Booking"],
      ezusReference: ["Ezus_Supplier_Reference", "Ezus Supplier Reference"],
      supplierAccounting: ["Cuenta_Contable_Supplier", "Cuenta Contable (Supplier)", "Cuenta_Contable", "Cuenta Contable"],
      accountingStatus: ["Accounting_Status", "Accounting Status"]
    },
    payment: {
      reference: ["Name", "Payment_Reference", "Payment Reference"],
      movementType: ["Movement_Type", "Movement Type"],
      status: ["Status"],
      date: ["Payment_Date", "Payment Date"],
      amount: ["Payment_Amount", "Payment Amount", "Amount"],
      paymentAccount: ["Payment_Account", "Payment Account"],
      accountingStatus: ["Accounting_Status", "Accounting Status"],
      contextMode: ["Context_Mode", "Context Mode"],
      contextSummary: ["Context_Summary", "Context Summary"],
      allocationCount: ["Allocation_Count", "Allocation Count"],
      supplierCount: ["Supplier_Count", "Supplier Count"],
      bookingCount: ["Booking_Count", "Booking Count"],
      settlementCount: ["Settlement_Count", "Settlement Count"]
    },
    paymentAccount: {
      name: ["Name", "Payment_Account_Name", "Payment Account Name"],
      email: ["Email"],
      booksMappingStatus: ["Books_Mapping_Status", "Books Mapping Status"],
      lastSyncStatus: ["Last_Sync_Status", "Last Sync Status"],
      lastSyncDate: ["Last_Sync_Date", "Last Sync Date"],
      allowedForSupplierPayments: ["Allowed_For_Supplier_Payments", "Allowed For Supplier Payments"],
      autoSyncToBooks: ["Auto_Sync_To_Books", "Auto Sync To Books"],
      requiresProofOfPayment: ["Requires_Proof_of_Payment", "Requires Proof of Payment"],
      externalId: ["External_ID", "External ID"]
    },
    accountingAccount: {
      code: ["Name", "Account_Code", "Account Code"],
      name: ["Account_Name", "Account Name", "Name"],
      type: ["Account_Type", "Account Type"],
      subtype: ["Account_Subtype", "Account Subtype"],
      status: ["Status"],
      booksAccountId: ["Zoho_Books_Account_Id", "Zoho Books Account Id"]
    },
    accountingRule: {
      name: ["Name", "Accounting_Rule_Name", "Accounting Rule Name"],
      status: ["Status"],
      tripType: ["Trip_Type", "Trip Type"],
      selfEmployed: ["Is_Self_Employed", "Is Self Employed"],
      baseExpenseAccount: ["Base_Expense_Account", "Base Expense Account"],
      reimbursableAccount: ["Reimbursable_Account", "Reimbursable Account"]
    }
  };

  ns.getWorkspaceStatusValues = function (viewKey, tab, allValues) {
    if (tab === "all") { return allValues.slice(); }
    if (viewKey === "payments") {
      return tab === "closed" ? ["Paid", "Cancelled"] : ["Pending Payment"];
    }
    return tab === "closed" ? ["Paid", "Cancelled", "Rejected"] : ["-None-", "Received", "Partially Paid"];
  };

  ns.createInitialState = function () {
    return {
      currentTab: "invoices",
      accountingTab: "entries",
      supplier: null,
      supplierId: "",
      supplierInvoices: [],
      supplierPayments: [],
      supplierInfoTab: "basic",
      supplierActivityTab: "invoices",
      supplierActivityInvoicesSort: {
        key: "date",
        direction: "desc"
      },
      supplierActivityDetail: {
        isOpen: false,
        type: "",
        record: null,
        lines: [],
        allocations: [],
        isLoading: false
      },
      bookingClosure: {
        isOpen: false,
        isLoading: false,
        booking: null,
        settlements: [],
        invoices: [],
        soldSalesPrice: null,
        filter: "all",
        sort: { key: "supplier", direction: "asc" }
      },
      invoiceCreation: {
        isOpen: false,
        mode: "invoice",
        step: 1,
        invoiceFields: {},
        invoiceTypeOptions: [],
        settlements: [],
        selectedSettlement: null,
        selectedSettlements: [],
        settlementAllocationAmounts: {},
        settlementQuery: "",
        settlementStatusValues: ["Pending Invoice", "Partially Paid", "Partially Accounted", "Accounted"],
        settlementStatusOptions: [],
        loadedSupplierId: "",
        hasLoadedSettlements: false,
        settlementMfspFilter: "",
        isLoadingSettlements: false,
        settlementStatusDropdownOpen: false,
        settlementDropdownOpen: false,
        services: [],
        lastEditedAmountMode: "gross",
        documentFile: null,
        documentFilePreviewUrl: "",
        validationMessage: "",
        validationFields: {}
      },
      paymentAccountCreation: {
        isOpen: false,
        fields: {},
        mode: "create",
        recordId: "",
        record: null,
        isBusy: false
      },
      accountingAccountCreation: {
        isOpen: false,
        fields: {},
        isBusy: false
      },
      paymentCreation: {
        isOpen: false,
        isBusy: false,
        feedback: {
          isOpen: false,
          status: "",
          message: "",
          actionSupplierId: ""
        },
        context: null,
        form: {
          name: "",
          paymentDate: "",
          headerPaymentAccountId: "",
          headerPaymentAccountQuery: "",
          headerPaymentAccountDropdownOpen: false,
          movementType: "",
          status: "Paid",
          accountingStatus: "Pending",
          paymentAccountsBySupplier: {},
          supplierAccountQueries: {},
          supplierAccountDropdownSupplierId: "",
          allocations: {}
        }
      },
      paymentLetter: {
        isOpen: false,
        isBusy: false,
        isLoadingRecipients: false,
        paymentId: "",
        selectedSupplierIds: {},
        recipientStatesBySupplierId: {},
        manualEmailBySupplierId: {},
        editingEmailSupplierId: "",
        contactsBySupplierId: {},
        requestToken: 0
      },
      paymentAllocationManager: {
        isOpen: false,
        isLoading: false,
        isSaving: false,
        paymentId: "",
        paymentAmount: 0,
        invoices: [],
        amounts: {},
        unlinkedAmounts: {},
        newInvoiceIds: {},
        isPickerOpen: false,
        tableQuery: "",
        searchRequestId: 0,
        searchResults: [],
        pickerError: "",
        error: ""
      },
      paymentAllocationFeedback: {
        isOpen: false,
        mode: "loading",
        message: ""
      },
      invoiceDeletion: {
        isOpen: false,
        isBusy: false,
        updateSettlement: true
      },
      paymentUndo: {
        isOpen: false,
        isLoading: false,
        isBusy: false,
        mode: "confirmation",
        paymentId: "",
        allocations: [],
        resultMessage: ""
      },
      invoiceAccounting: {
        isBusy: false,
        action: "",
        lastEntryId: ""
      },
      paymentAccounting: {
        isBusy: false,
        action: "",
        lastEntryId: ""
      },
      recentSuppliers: [],
      supplierIndex: {},
      selectedIds: [],
      clientPayload: null,
      isLoading: false,
      zohoReady: false,
      invoiceLinesByInvoiceId: {},
      invoiceLineLoadingId: "",
      invoiceAllocationsByInvoiceId: {},
      invoiceAllocationLoadingId: "",
      records: {
        bookings: [],
        settlements: [],
        invoices: [],
        payments: [],
        payAllocations: [],
        paymentAccounts: [],
        accountingEntries: [],
        accountingEntryLines: [],
        accountingAccounts: [],
        accountingRules: []
      },
      indexes: {
        bookingById: {},
        mfspByBookingId: {},
        paymentContextByPaymentId: {},
        paymentIdsBySupplierId: {},
        paymentSupplierNameById: {},
        relatedPaymentsByAccountId: {},
        paymentAccountMetaById: {}
      },
      loaded: {
        bookings: false,
        settlements: false,
        invoices: false,
        payments: false,
        payAllocations: false,
        paymentAccounts: false,
        paymentAccountsContext: false,
        accountingEntries: false,
        accountingEntryLines: false,
        accountingAccounts: false,
        accountingRules: false
      },
      views: {
        bookings: {
          page: 1,
          perPage: 10,
          hasMore: false,
          countLabel: "0 bookings",
          pageSummary: "Page 1",
          filters: {
            mfsp: "",
            bookingName: "",
            arrivalDateMode: "single",
            arrivalDateFrom: "",
            arrivalDateTo: "",
            agency: "",
            stageValues: [],
            accountingRep: ""
          },
          appliedFilters: {
            mfsp: "",
            bookingName: "",
            arrivalDateMode: "single",
            arrivalDateFrom: "",
            arrivalDateTo: "",
            agency: "",
            stageValues: [],
            accountingRep: ""
          },
          records: [],
          hasLoaded: false,
          stageDropdownOpen: false
        },
        invoices: {
          page: 1,
          perPage: 10,
          hasMore: false,
          hasLoaded: false,
          showAttachments: false,
          groupBy: "none",
          destinationDropdownOpen: false,
          view: "closed",
          statusDropdownOpen: false,
          detailTab: "basic",
          sort: {
            key: "date",
            direction: "desc"
          },
          filters: {
            datePreset: "specific",
            dateFrom: "",
            dateTo: "",
            statusValues: ["-None-", "Received", "Partially Paid", "Paid", "Cancelled", "Rejected"],
            invoiceType: "",
            supplierCode: "",
            invoiceNumber: "",
            destinationValues: ["Empty", "Spain", "Portugal"],
            selfEmployed: "",
            mfsp: ""
          },
          appliedFilters: {
            datePreset: "specific",
            dateFrom: "",
            dateTo: "",
            statusValues: ["-None-", "Received", "Partially Paid", "Paid", "Cancelled", "Rejected"],
            invoiceType: "",
            supplierCode: "",
            invoiceNumber: "",
            destinationValues: ["Empty", "Spain", "Portugal"],
            selfEmployed: "",
            mfsp: ""
          },
          selectedIds: {},
          selectedRecordsById: {},
          selectedDetailId: ""
        },
        payments: {
          page: 1,
          perPage: 10,
          hasMore: false,
          hasLoaded: false,
          section: "payments",
          view: "open",
          detailTab: "payment",
          statusDropdownOpen: false,
          filters: {
            datePreset: "last-7-days",
            dateFrom: "",
            dateTo: "",
            statusValues: ["Planned", "Approved", "Pending Payment", "Cancelled", "Paid", "Reconciled"],
            paymentName: "",
            supplierCode: "",
            mfsp: ""
          },
          appliedFilters: {
            datePreset: "last-7-days",
            dateFrom: "",
            dateTo: "",
            statusValues: ["Planned", "Approved", "Pending Payment", "Cancelled", "Paid", "Reconciled"],
            paymentName: "",
            supplierCode: "",
            mfsp: ""
          },
          selectedId: ""
        },
        paymentAllocations: {
          page: 1,
          perPage: 10,
          selectedId: "",
          filters: { reference: "", movementType: "", payment: "", invoice: "", supplierCode: "" }
        },
        paymentAccounts: {
          page: 1,
          perPage: 10,
          filters: {
            query: "",
            supplierId: "",
            mfsp: "",
            status: ""
          },
          selectedId: ""
        },
        accountingEntries: {
          page: 1,
          perPage: 10,
          hasMore: false,
          hasLoaded: false,
          pageSummary: "Page 1",
          countLabel: "0 entries",
          sort: {
            key: "date",
            direction: "desc"
          },
          filters: {
            dateFrom: "",
            dateTo: "",
            entryName: "",
            movementType: "",
            mfsp: ""
          },
          appliedFilters: {
            dateFrom: "",
            dateTo: "",
            entryName: "",
            movementType: "",
            mfsp: ""
          }
        },
        accountingEntryLines: {
          page: 1,
          perPage: 10,
          hasMore: false,
          hasLoaded: false,
          pageSummary: "Page 1",
          countLabel: "0 lines",
          sort: {
            key: "date",
            direction: "desc"
          },
          filters: {
            dateFrom: "",
            dateTo: "",
            lineName: ""
          },
          appliedFilters: {
            dateFrom: "",
            dateTo: "",
            lineName: ""
          }
        },
        accountingAccounts: {
          page: 1,
          perPage: 10,
          selectedId: ""
        },
        accountingRules: {
          page: 1,
          perPage: 10,
          selectedId: ""
        }
      }
    };
  };
}(window));
