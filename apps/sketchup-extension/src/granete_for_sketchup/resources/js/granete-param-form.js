// #848 post-C4.9 — shared parameter-form module (window.GraneteUI.paramForm).
// Final #848 architectural extraction approved by the owner (Option B of the
// post-C4.9 audit): the only remaining inline domain-sized block in
// dialog.html — the parametric form presentation/semantics shared by the
// Configurator and the Inspector.
//
// Owns:
// - getDefaultParams — registered parameter defaults of a definition.
// - renderParamForm — the interactive parameter form: mm dim inputs,
//   steppers with min/max clamping, enum selects, boolean checkbox + value
//   badge, string inputs with maxlength/hint, aria attributes and the
//   onChange(name, value, unit) callback contract.
// - parameterIssueMessage — structured PARAMETER_* authoring issues →
//   Spanish copy for the dock/error toast.
// - estimatedPartsLabel — the #847 honest dock count: the server estimate
//   only while counting params sit at their defaults, the CURRENT-value
//   heuristic labeled "Aprox.", and "Piezas: se calculan al resolver" when
//   nothing can be estimated honestly.
//
// Consumes: browser DOM primitives (`document.createElement`) for
// renderParamForm, the caller-owned container passed to that renderer and
// the caller-provided onChange callback. No GraneteUI modules, no
// window.sketchup calls and no injected dependency bag.
//
// The module owns no mutable module state; getDefaultParams,
// parameterIssueMessage and estimatedPartsLabel are value helpers, while
// renderParamForm is a stateless DOM renderer over caller-owned state.
//
// Does NOT own: configurator/inspector state (they keep the values and
// call back via onChange); interactive param validation
// (validateInteractiveClient — granete-inspector.js); capability
// authority (capabilityEnabled stays inline); chrome (icon/toast/tabs);
// catalog/material semantics; Ruby bridges; backend business rules.
//
// Public API (4): getDefaultParams, renderParamForm, parameterIssueMessage,
// estimatedPartsLabel. Consumers: window.GraneteUI.configurator and
// window.GraneteUI.inspector receive them via their init() dep bags — the
// bootstrap wiring in dialog.html passes window.GraneteUI.paramForm.*; the
// init contracts of both modules do not change.
//
// State authority: none (stateless by contract).
//
// Start here when: "el formulario de medidas no se renderiza bien", "el
// stepper cambia mal una medida", "el parámetro muestra un error
// equivocado", "el estimado de piezas se ve incorrecto", "los defaults de
// parámetros no aparecen".
//
// Focused harness: test/js/granete_param_form_test.js (via
// test/unit/granete_param_form_js_test.rb). dialog.html keeps only the
// wiring; the inline implementations moved here verbatim (dedent -6).
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.paramForm) return;

  function getDefaultParams(def) {
    var p = {};
    (def.parameters || []).forEach(function (param) {
      p[param.name] = param.defaultValue;
    });
    return p;
  }

  function renderParamForm(container, def, currentValues, onChange) {
    container.innerHTML = "";
    if (!def) return;

    (def.parameters || []).forEach(function (p) {
      var val = currentValues[p.name] !== undefined ? currentValues[p.name] : p.defaultValue;
      var group = document.createElement("div");
      group.className = "param-group";

      var controlId = "param-" + String(p.name).replace(/[^a-zA-Z0-9_-]/g, "-") + "-" + container.id;
      var label = document.createElement("label");
      label.className = "param-label";
      label.textContent = p.label;

      // El control a la derecha de la etiqueta; el valor vive en el
      // control mismo (input/stepper/select) — sin badges duplicados.
      var control = document.createElement("div");
      control.className = "param-control";

      if (p.type === "number" && p.unit === "mm") {
        // Measures are plain text fields (precise mm entry); the
        // registered defaults are one click away via the
        // "medidas registradas" button in the configurator.
        label.setAttribute("for", controlId);
        group.appendChild(label);

        var dimInput = document.createElement("input");
        dimInput.id = controlId;
        dimInput.type = "number";
        dimInput.className = "dim-input";
        dimInput.inputMode = "numeric";
        dimInput.value = val;
        if (p.step) dimInput.step = p.step;
        if (p.min !== undefined) dimInput.min = p.min;
        if (p.max !== undefined) dimInput.max = p.max;
        dimInput.setAttribute("aria-label", p.label);

        var dimUnit = document.createElement("span");
        dimUnit.className = "dim-unit";
        dimUnit.textContent = "mm";

        dimInput.addEventListener("change", function () {
          var v = Number(dimInput.value);
          if (isNaN(v)) v = p.defaultValue;
          if (p.min !== undefined && v < p.min) v = p.min;
          if (p.max !== undefined && v > p.max) v = p.max;
          dimInput.value = v;
          onChange(p.name, v, p.unit);
        });

        control.appendChild(dimInput);
        control.appendChild(dimUnit);
      } else if (p.type === "number" && p.min !== undefined && p.max !== undefined) {
        group.appendChild(label);

        var btnMinus = document.createElement("button");
        btnMinus.className = "btn btn-secondary";
        btnMinus.type = "button";
        btnMinus.textContent = "−";
        btnMinus.setAttribute("aria-label", "Disminuir " + p.label);

        var valDisplay = document.createElement("span");
        valDisplay.className = "stepper-value";
        valDisplay.textContent = val;

        var btnPlus = document.createElement("button");
        btnPlus.className = "btn btn-secondary";
        btnPlus.type = "button";
        btnPlus.textContent = "+";
        btnPlus.setAttribute("aria-label", "Aumentar " + p.label);

        btnMinus.addEventListener("click", function () {
          var cur = Number(currentValues[p.name] !== undefined ? currentValues[p.name] : p.defaultValue);
          if (cur > p.min) {
            cur -= (p.step || 1);
            valDisplay.textContent = cur;
            onChange(p.name, cur, p.unit);
          }
        });

        btnPlus.addEventListener("click", function () {
          var cur = Number(currentValues[p.name] !== undefined ? currentValues[p.name] : p.defaultValue);
          if (cur < p.max) {
            cur += (p.step || 1);
            valDisplay.textContent = cur;
            onChange(p.name, cur, p.unit);
          }
        });

        var stepper = document.createElement("div");
        stepper.className = "stepper";
        stepper.appendChild(btnMinus);
        stepper.appendChild(valDisplay);
        stepper.appendChild(btnPlus);
        control.appendChild(stepper);
      } else if (p.type === "enum" && p.options) {
        label.setAttribute("for", controlId);
        group.appendChild(label);

        var select = document.createElement("select");
        select.id = controlId;
        select.setAttribute("aria-required", p.required ? "true" : "false");
        p.options.forEach(function (optVal) {
          var opt = document.createElement("option");
          opt.value = optVal;
          opt.textContent = optVal;
          if (optVal === val) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener("change", function () {
          onChange(p.name, select.value);
        });
        control.appendChild(select);
      } else if (p.type === "boolean") {
        label.setAttribute("for", controlId);
        group.appendChild(label);

        var valueBadge = document.createElement("span");
        valueBadge.className = "param-value-badge";
        valueBadge.textContent = val === true ? "Sí" : "No";

        var checkbox = document.createElement("input");
        checkbox.id = controlId;
        checkbox.type = "checkbox";
        checkbox.className = "param-checkbox";
        checkbox.checked = val === true;
        checkbox.setAttribute("aria-label", p.label);
        checkbox.addEventListener("change", function () {
          valueBadge.textContent = checkbox.checked ? "Sí" : "No";
          onChange(p.name, checkbox.checked === true);
        });
        control.appendChild(checkbox);
        control.appendChild(valueBadge);
      } else if (p.type === "string") {
        label.setAttribute("for", controlId);
        group.appendChild(label);

        var textInput = document.createElement("input");
        textInput.id = controlId;
        textInput.type = "text";
        textInput.className = "param-text-input";
        textInput.value = val === undefined || val === null ? "" : String(val);
        textInput.required = p.required === true;
        if (p.maxLength !== undefined) textInput.maxLength = p.maxLength;
        textInput.setAttribute("aria-required", p.required ? "true" : "false");
        textInput.addEventListener("change", function () {
          onChange(p.name, textInput.value);
        });
        control.appendChild(textInput);
      }

      group.appendChild(control);
      container.appendChild(group);

      if (p.type === "string" && p.maxLength !== undefined) {
        var stringHint = document.createElement("small");
        stringHint.className = "param-hint";
        stringHint.textContent = "Máximo " + p.maxLength + " caracteres" + (p.required ? " · obligatorio" : "");
        group.appendChild(stringHint);
      }
    });
  }

  function parameterIssueMessage(result, fallback) {
    var issue = result && result.issues && result.issues[0];
    if (!issue || !issue.code) return (result && result.error) || fallback;
    var parameter = issue.parameter || (issue.details && issue.details.parameter);
    var labels = {
      PARAMETER_REQUIRED: "Completá el parámetro requerido",
      PARAMETER_TYPE_INVALID: "El parámetro tiene un tipo de valor incorrecto",
      PARAMETER_OUT_OF_RANGE: "El parámetro está fuera del rango permitido",
      PARAMETER_STEP_INVALID: "El parámetro no coincide con el incremento permitido",
      PARAMETER_ENUM_INVALID: "Elegí una opción permitida",
      PARAMETER_STRING_TOO_LONG: "El texto supera la longitud permitida",
      PARAMETER_UNKNOWN: "La definición no reconoce el parámetro",
      PARAMETER_DEFINITION_INVALID: "La definición paramétrica es inválida",
      PARAMETER_BINDING_CONFLICT: "La definición tiene consumidores paramétricos en conflicto"
    };
    var message = labels[issue.code] || issue.message || fallback;
    return parameter ? message + ": " + parameter : message;
  }

  // Honest piece count for the dock (review #847): never present a
  // local estimate as if it were the resolved BOM. Precedence:
  // (A) a server-resolved count for the CURRENT configuration would
  //     win — no such field reaches the dialog today, so none is
  //     consumed here; the backend stays the authority.
  // (B) otherwise an explicit "Aprox." — the definition's
  //     estimatedPartCount while the counting params sit at their
  //     defaults, else the pre-existing heuristic fed with the
  //     CURRENT values (not the defaults).
  // (C) when nothing can be estimated honestly: defer to resolve.
  function estimatedPartsLabel(def, currentValues) {
    var values = currentValues || {};
    var params = def && def.parameters ? def.parameters : [];
    var countingParams = params.filter(function (p) {
      return p.name === "shelfCount" || p.name === "doorCount";
    });

    var countingAtDefaults = countingParams.every(function (p) {
      var current = values[p.name];
      return current === undefined || current === null ||
        Number(current) === Number(p.defaultValue);
    });

    if (def && typeof def.estimatedPartCount === "number" &&
        (countingParams.length === 0 || countingAtDefaults)) {
      var parts = def.estimatedPartCount;
      var hw = typeof def.estimatedHardwareCount === "number" ? def.estimatedHardwareCount : 0;
      return "Aprox. " + parts + " pieza" + (parts === 1 ? "" : "s") +
        (hw > 0 ? " + " + hw + " herraje" + (hw === 1 ? "" : "s") : "");
    }

    if (countingParams.length > 0) {
      var guess = 2;
      countingParams.forEach(function (p) {
        var current = values[p.name];
        guess += Number(current !== undefined && current !== null ? current : p.defaultValue) || 0;
      });
      return "Aprox. " + guess + " piezas";
    }

    return "Piezas: se calculan al resolver";
  }

  window.GraneteUI.paramForm = {
    getDefaultParams: getDefaultParams,
    renderParamForm: renderParamForm,
    parameterIssueMessage: parameterIssueMessage,
    estimatedPartsLabel: estimatedPartsLabel
  };
})();
