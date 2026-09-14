// #718 — minimal SketchUp-first Customer/Project/Design bootstrap form.
(function () {
  "use strict";
  if (window.GraneteCommercialBootstrap) return;

  var busy = false;
  function el(id) { return document.getElementById(id); }
  function visible(node, value) { if (node) node.style.display = value ? "" : "none"; }
  function setStatus(value) { if (el("bootstrap-status")) el("bootstrap-status").textContent = value || ""; }
  function mode() {
    var checked = document.querySelector('input[name="bootstrap-customer-mode"]:checked');
    return checked ? checked.value : "existing";
  }
  function syncMode() {
    visible(el("bootstrap-customer-select"), mode() === "existing");
    visible(el("bootstrap-customer-name"), mode() === "new");
  }
  function open() {
    if (busy) return;
    visible(el("project-bootstrap-form"), true);
    visible(el("model-binding-picker"), false);
    setStatus("Cargando clientes…");
    syncMode();
    var projectName = el("bootstrap-project-name");
    if (projectName && typeof projectName.focus === "function") projectName.focus();
    if (window.sketchup && window.sketchup.list_bootstrap_customers) window.sketchup.list_bootstrap_customers();
  }
  function close() { if (!busy) { visible(el("project-bootstrap-form"), false); setStatus(""); } }
  function receiveCustomers(result) {
    var select = el("bootstrap-customer-select");
    if (!select) return;
    select.innerHTML = "";
    var entries = result && result.ok && Array.isArray(result.entries) ? result.entries : [];
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = entries.length ? "Elegí un cliente" : "Sin clientes disponibles";
    select.appendChild(placeholder);
    entries.forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.id; option.textContent = entry.name; select.appendChild(option);
    });
    setStatus(result && result.ok ? "" : ((result && result.reason) || "No se pudieron cargar los clientes."));
  }
  function submit(event) {
    event.preventDefault();
    if (busy || !window.sketchup || !window.sketchup.bootstrap_project_design) return;
    var payload = {
      projectName: el("bootstrap-project-name").value,
      designName: el("bootstrap-design-name").value,
      customerMode: mode()
    };
    if (payload.customerMode === "existing") payload.customerId = el("bootstrap-customer-select").value;
    else payload.customerName = el("bootstrap-customer-name").value;
    busy = true;
    el("project-bootstrap-form").setAttribute("aria-busy", "true");
    el("btn-bootstrap-submit").disabled = true;
    setStatus("Creando proyecto y conectando el modelo…");
    window.sketchup.bootstrap_project_design(JSON.stringify(payload));
  }
  function receiveBootstrap(result) {
    busy = false;
    el("project-bootstrap-form").setAttribute("aria-busy", "false");
    el("btn-bootstrap-submit").disabled = false;
    if (result && result.ok) {
      visible(el("project-bootstrap-form"), false);
      setStatus("");
    } else setStatus((result && result.reason) || "No se pudo crear el proyecto.");
  }
  function setBinding(bindingStatus) {
    if (bindingStatus && bindingStatus.state === "connected") visible(el("project-bootstrap-form"), false);
  }

  if (el("btn-bootstrap-project")) el("btn-bootstrap-project").addEventListener("click", open);
  if (el("btn-bootstrap-cancel")) el("btn-bootstrap-cancel").addEventListener("click", close);
  if (el("project-bootstrap-form")) el("project-bootstrap-form").addEventListener("submit", submit);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="bootstrap-customer-mode"]'), function (radio) {
    radio.addEventListener("change", syncMode);
  });
  window.GraneteCommercialBootstrap = {
    setBinding: setBinding, receiveCustomers: receiveCustomers, receiveBootstrap: receiveBootstrap
  };
})();
