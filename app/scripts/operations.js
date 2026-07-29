(function () {
  "use strict";

  var typeCards = Array.prototype.slice.call(document.querySelectorAll("[data-operation-type]"));
  var search = document.getElementById("operations-filter-search");
  var status = document.getElementById("operations-filter-status");
  var dateFrom = document.getElementById("operations-filter-from");
  var dateTo = document.getElementById("operations-filter-to");
  var apply = document.getElementById("operations-apply-filters");
  var reset = document.getElementById("operations-reset-filters");
  var empty = document.getElementById("operations-empty");
  var selectedType = "all";

  function updateEmptyCopy() {
    var hasFilters = Boolean((search && search.value.trim()) || (status && status.value) || (dateFrom && dateFrom.value) || (dateTo && dateTo.value));
    var typeLabel = selectedType === "all" ? "all Operations records" : selectedType.replace("-", " ");

    if (!empty) {
      return;
    }

    empty.innerHTML = hasFilters
      ? "<h3>No live source connected yet</h3><p>The selected filters will be applied to " + typeLabel + " when the Creator reports are mapped.</p>"
      : "<h3>Ready to connect Operations</h3><p>The screen is ready. To load live data, we need to map each Creator form or report and its fields (reference, status, date, amount, supplier and booking).</p>";
  }

  typeCards.forEach(function (card) {
    card.addEventListener("click", function () {
      selectedType = card.getAttribute("data-operation-type") || "all";
      typeCards.forEach(function (candidate) {
        candidate.classList.toggle("is-active", candidate === card);
      });
      updateEmptyCopy();
    });
  });

  if (apply) {
    apply.addEventListener("click", updateEmptyCopy);
  }

  if (reset) {
    reset.addEventListener("click", function () {
      [search, status, dateFrom, dateTo].forEach(function (field) {
        if (field) {
          field.value = "";
        }
      });
      updateEmptyCopy();
    });
  }
}());
