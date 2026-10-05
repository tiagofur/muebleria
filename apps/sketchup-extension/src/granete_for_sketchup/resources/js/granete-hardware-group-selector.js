// #1046 S3 — hardware group selector modal.
//
// Owns:
// - the "Elegir herraje" modal for ONE hardware option group: renders the
//   member rows the caller prepared, tracks the selection and commits it
//   through the injected onPick callback. Pure presentation: no catalog
//   authority, no mutation submission, no local manufacturing inference —
//   the decision (and its consequences: perforations, demand, price) belong
//   to the authoritative resolve triggered by the caller's Apply.
//
// Consumes:
// - its own DOM island in dialog.html (#hardware-group-modal), styled with
//   the shared selector-modal classes of the finish selector.
//
// Does NOT own:
// - the option group catalog slice (granete-inspector.js), the #784 draft,
//   or any SketchUp callback (the caller decides what a pick means).
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.hardwareGroupSelector) return;

  var backdrop = document.getElementById("hardware-group-modal");
  var modalTitle = document.getElementById("hw-group-modal-title");
  var modalBadge = document.getElementById("hw-group-modal-badge");
  var list = document.getElementById("hw-group-list");
  var emptyMsg = document.getElementById("hw-group-empty");
  var btnClose = document.getElementById("btn-hw-group-close");
  var btnCancel = document.getElementById("btn-hw-group-cancel");
  var btnApply = document.getElementById("btn-hw-group-apply");

  // The open session: { rows, chosenId, onPick }. Cleared on every close so
  // a stale modal never commits onto a new selection.
  var session = null;
  var selectedId = null;

  function close() {
    if (!backdrop) return;
    backdrop.style.display = "none";
    // Rows leave with the session: a stale member list must never flash
    // when the next group opens (nor outlive its selection context).
    if (list) list.innerHTML = "";
    session = null;
    selectedId = null;
  }

  function updateApplyState() {
    if (!btnApply) return;
    btnApply.disabled = !session || !selectedId || selectedId === session.chosenId;
  }

  function renderRow(row) {
    var item = document.createElement("button");
    item.type = "button";
    item.className = "hw-group-option" + (row.id === selectedId ? " selected" : "") +
      (row.id === session.chosenId ? " current" : "");
    item.setAttribute("data-hw-id", row.id);

    var head = document.createElement("div");
    head.className = "hw-group-option-head";
    var name = document.createElement("span");
    name.className = "hw-group-option-name";
    name.textContent = row.name;
    head.appendChild(name);
    if (row.id === session.chosenId) {
      var badge = document.createElement("span");
      badge.className = "status-badge valid";
      badge.textContent = "Actual";
      head.appendChild(badge);
    }
    item.appendChild(head);

    var meta = document.createElement("div");
    meta.className = "hw-group-option-meta";
    var parts = [];
    if (row.code) parts.push(row.code);
    if (row.categoryLabel) parts.push(row.categoryLabel);
    if (row.unitLabel) parts.push(row.unitLabel);
    meta.textContent = parts.join(" · ");
    item.appendChild(meta);

    if (row.notes) {
      var notes = document.createElement("div");
      notes.className = "hw-group-option-notes";
      notes.textContent = row.notes;
      item.appendChild(notes);
    }

    item.addEventListener("click", function () {
      selectedId = row.id;
      var children = list.children;
      for (var i = 0; i < children.length; i++) {
        children[i].classList.toggle("selected", children[i].getAttribute("data-hw-id") === selectedId);
      }
      updateApplyState();
    });
    return item;
  }

  function open(options) {
    if (!backdrop) return;
    var opts = options || {};
    session = {
      rows: Array.isArray(opts.rows) ? opts.rows : [],
      chosenId: opts.chosenId || null,
      onPick: typeof opts.onPick === "function" ? opts.onPick : null
    };
    selectedId = null;

    if (modalTitle) modalTitle.textContent = opts.title || "Elegir herraje";
    if (modalBadge) modalBadge.textContent = opts.groupLabel ? ("Grupo: " + opts.groupLabel) : "";

    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      session.rows.forEach(function (row) {
        list.appendChild(renderRow(row));
      });
    }
    if (emptyMsg) emptyMsg.style.display = session.rows.length === 0 ? "block" : "none";
    updateApplyState();
    backdrop.style.display = "flex";
  }

  if (btnClose) btnClose.addEventListener("click", close);
  if (btnCancel) btnCancel.addEventListener("click", close);
  if (backdrop) {
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) close();
    });
  }
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && backdrop && backdrop.style.display !== "none") close();
  });
  if (btnApply) {
    btnApply.addEventListener("click", function () {
      if (!session || !selectedId || selectedId === session.chosenId) return;
      var pick = session.onPick;
      var id = selectedId;
      close();
      if (pick) pick(id);
    });
  }

  window.GraneteUI.hardwareGroupSelector = {
    open: open,
    close: close,
    isOpen: function () { return !!(backdrop && backdrop.style.display !== "none"); }
  };
})();
