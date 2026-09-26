// #848 Phase B — account & device enrollment module.
// Owns:
// - account/session presentation (connection pill, login/session cards)
// - device enrollment lifecycle (code, countdown, 5s polling)
// - account popover interaction (open/close/focus, Esc, outside click)
//
// Consumes:
// - window.sketchup enroll/poll_enrollment/logout/open_external_url
//   (+ get_model_binding after a successful enrollment)
// - injected showToast/icon dependencies via init() — no duplicate helpers
//
// Does NOT own:
// - credentials or session tokens (they live in the Ruby session)
// - catalog/library rendering
// - model binding state
// - commercial truth
(function () {
  "use strict";

  window.GraneteUI = window.GraneteUI || {};

  if (window.GraneteUI.account) return;

  // Injected by the dialog bootstrap before dialog_ready: presentation
  // helpers stay single-implementation in dialog.html.
  var showToast = null;
  var icon = null;

  // Connection elements (the popover header + the header pill)
  var connectionPill = document.getElementById("connection-pill");
  var connectionHeading = document.getElementById("connection-heading");
  var connectionDetail = document.getElementById("connection-detail");

  // Session elements
  var loginCard = document.getElementById("login-card");
  var sessionCard = document.getElementById("session-card");
  var loginServer = document.getElementById("login-server");
  var btnLogin = document.getElementById("btn-login");
  var btnLogout = document.getElementById("btn-logout");
  var loginFormArea = document.getElementById("login-form-area");
  var enrollCodeArea = document.getElementById("enroll-code-area");
  var enrollCodeDisplay = document.getElementById("enroll-code-display");
  var btnCopyEnrollCode = document.getElementById("btn-copy-enroll-code");
  var copyEnrollCodeIcon = document.getElementById("copy-enroll-code-icon");
  var copyEnrollCodeText = document.getElementById("copy-enroll-code-text");
  var enrollCountdownDisplay = document.getElementById("enroll-countdown-display");
  var enrollStatusText = document.getElementById("enroll-status-text");
  var btnOpenWebDevices = document.getElementById("btn-open-web-devices");
  var btnCancelEnroll = document.getElementById("btn-cancel-enroll");
  var currentEnrollmentId = null;
  var enrollPollInterval = null;
  var enrollCountdownInterval = null;
  var sessionUserName = document.getElementById("session-user-name");
  var sessionUserEmail = document.getElementById("session-user-email");
  var sessionServer = document.getElementById("session-server");
  var sessionLicense = document.getElementById("session-license");

  var accountPopover = document.getElementById("account-popover");
  var accountCloseBtn = document.getElementById("btn-close");

  // Foco contextual (review #847): sin sesión el camino principal es
  // el servidor; con sesión, la acción útil visible (cerrar sesión).
  // Nunca se enfoca un control display:none.
  function accountFocusTarget() {
    if (loginCard && loginCard.style.display !== "none") return loginServer;
    var logout = document.getElementById("btn-logout");
    if (logout && logout.style.display !== "none") return logout;
    return accountCloseBtn || connectionPill;
  }

  function openAccountPopover() {
    if (accountPopover.style.display === "block") return;
    accountPopover.style.display = "block";
    connectionPill.setAttribute("aria-expanded", "true");
    var target = accountFocusTarget();
    if (target && target.focus) target.focus();
  }

  function closeAccountPopover() {
    if (accountPopover.style.display === "none") return;
    accountPopover.style.display = "none";
    connectionPill.setAttribute("aria-expanded", "false");
    if (connectionPill.focus) connectionPill.focus();
  }

  connectionPill.addEventListener("click", function () {
    if (accountPopover.style.display === "none") {
      openAccountPopover();
    } else {
      closeAccountPopover();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeAccountPopover();
    }
  });

  document.addEventListener("click", function (event) {
    if (accountPopover.style.display === "none") return;
    var node = event.target;
    while (node) {
      if (node === accountPopover || node === connectionPill) return;
      node = node.parentNode;
    }
    closeAccountPopover();
  }, true);

  function renderSessionLicense(license) {
    license = license || {};
    var plan = license.plan || "none";
    var planLabel = plan === "pro" ? "Pro" : (plan === "trial" ? "Prueba" : "Sin licencia");
    var status = license.status || "none";
    if (status === "active") {
      sessionLicense.textContent = planLabel + (license.expires_at ? " · vence " + String(license.expires_at).slice(0, 10) : "");
      sessionLicense.style.color = "";
    } else if (status === "expired") {
      sessionLicense.textContent = planLabel + " · vencida";
      sessionLicense.style.color = "var(--danger-600)";
    } else {
      sessionLicense.textContent = "Sin licencia activa";
      sessionLicense.style.color = "var(--warning-700)";
    }
  }

  function setStatus(status) {
    status = status || {};
    if (status.heading) connectionHeading.textContent = String(status.heading);
    if (status.message) connectionDetail.textContent = String(status.message);

    var state = status.state || "disabled";
    if (state === "logged_in") {
      connectionPill.textContent = "Conectado";
      connectionPill.className = "status-badge valid connection-pill-btn";
    } else if (state === "configured") {
      connectionPill.textContent = "Configurado";
      connectionPill.className = "status-badge pending connection-pill-btn";
    } else {
      connectionPill.textContent = "Sin sesión";
      connectionPill.className = "status-badge invalid connection-pill-btn";
    }

    var loggedIn = state === "logged_in";
    loginCard.style.display = loggedIn ? "none" : "block";
    sessionCard.style.display = loggedIn ? "block" : "none";
    if (!loginServer.value && status.server_url) loginServer.value = String(status.server_url);

    if (loggedIn) {
      var user = status.user || {};
      sessionUserName.textContent = user.name || "--";
      sessionUserEmail.textContent = user.email || "--";
      sessionServer.textContent = status.server_url || "--";
      renderSessionLicense(status.license);
    }
  }

  function clearEnrollmentTimers() {
    if (enrollPollInterval) {
      clearInterval(enrollPollInterval);
      enrollPollInterval = null;
    }
    if (enrollCountdownInterval) {
      clearInterval(enrollCountdownInterval);
      enrollCountdownInterval = null;
    }
  }

  function startEnrollCountdown(expiresAtStr) {
    if (enrollCountdownInterval) clearInterval(enrollCountdownInterval);
    if (!expiresAtStr) {
      if (enrollCountdownDisplay) enrollCountdownDisplay.textContent = "--:--";
      return;
    }
    var targetMs = new Date(expiresAtStr).getTime();
    if (isNaN(targetMs)) {
      if (enrollCountdownDisplay) enrollCountdownDisplay.textContent = "--:--";
      return;
    }

    var updateTick = function () {
      var diffMs = targetMs - Date.now();
      if (diffMs <= 0) {
        clearEnrollmentTimers();
        if (enrollCountdownDisplay) enrollCountdownDisplay.textContent = "00:00";
        if (enrollStatusText) {
          enrollStatusText.textContent = "El código expiró. Generá uno nuevo.";
          enrollStatusText.style.color = "var(--danger-600)";
        }
        return;
      }
      var totalSec = Math.floor(diffMs / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      if (enrollCountdownDisplay) {
        enrollCountdownDisplay.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      }
    };

    updateTick();
    enrollCountdownInterval = setInterval(updateTick, 1000);
  }

  function onEnrollResult(result) {
    btnLogin.disabled = false;
    btnLogin.textContent = "Generar código";
    if (result && result.success) {
      currentEnrollmentId = result.id || result.enrollment_id;
      if (enrollCodeDisplay) enrollCodeDisplay.textContent = result.code;
      if (enrollStatusText) {
        enrollStatusText.textContent = "Esperando aprobación en la web...";
        enrollStatusText.style.color = "var(--text-muted)";
      }
      loginFormArea.style.display = "none";
      enrollCodeArea.style.display = "block";

      clearEnrollmentTimers();
      startEnrollCountdown(result.expires_at);

      // #563: 5s polling interval aligned with backend rate limits
      enrollPollInterval = setInterval(function() {
        if (window.sketchup && window.sketchup.poll_enrollment && currentEnrollmentId) {
          window.sketchup.poll_enrollment(JSON.stringify({ enrollmentId: currentEnrollmentId }));
        }
      }, 5000);
    } else {
      showToast("error", (result && result.error) || "No se pudo iniciar la vinculación.");
    }
  }

  function onPollResult(result) {
    if (result && result.success) {
      if (result.status === 'rejected' || result.status === 'expired') {
        clearEnrollmentTimers();
        loginFormArea.style.display = "block";
        enrollCodeArea.style.display = "none";
        showToast("error", "La vinculación fue " + (result.status === 'rejected' ? 'rechazada' : 'expirada') + ".");
      } else {
        // Still pending: keep status normal
        if (enrollStatusText) {
          enrollStatusText.textContent = "Esperando aprobación en la web...";
          enrollStatusText.style.color = "var(--text-muted)";
        }
      }
    } else {
      // #563: Resilient polling: if 429 or transient error, do NOT abort the enrollment flow.
      var isRateLimited = result && (result.http_status === 429 || (result.error && result.error.indexOf('429') !== -1));
      if (enrollStatusText) {
        if (isRateLimited) {
          enrollStatusText.textContent = "Servidor ocupado, reintentando...";
          enrollStatusText.style.color = "var(--warning-700)";
        } else {
          enrollStatusText.textContent = "Reintentando verificación...";
          enrollStatusText.style.color = "var(--text-muted)";
        }
      }
    }
  }

  function onLoginResult(result) {
    if (window.GraneteCommercialProjection) window.GraneteCommercialProjection.invalidateSession();
    clearEnrollmentTimers();
    loginFormArea.style.display = "block";
    enrollCodeArea.style.display = "none";
    if (result && result.success) {
      if (result.loggedOut) {
        showToast("success", "Sesión cerrada.");
      } else {
        showToast("success", "✓ Dispositivo vinculado. Biblioteca del taller cargada.");
      }
      if (!result.loggedOut && window.sketchup && window.sketchup.get_model_binding) {
        window.sketchup.get_model_binding();
      }
    } else {
      showToast("error", (result && result.error) || "No se pudo iniciar sesión.");
    }
  }

  btnLogin.addEventListener("click", function () {
    var server = loginServer.value.trim();
    if (!server) {
      showToast("error", "Completá el servidor.");
      return;
    }
    btnLogin.disabled = true;
    btnLogin.textContent = "Conectando…";
    if (window.sketchup && window.sketchup.enroll) {
      window.sketchup.enroll(JSON.stringify({ serverUrl: server, displayName: '' }));
    } else {
      btnLogin.disabled = false;
      btnLogin.textContent = "Generar código";
      showToast("error", "Vincular dispositivo no disponible fuera de SketchUp.");
    }
  });

  btnCancelEnroll.addEventListener("click", function () {
    clearEnrollmentTimers();
    currentEnrollmentId = null;
    loginFormArea.style.display = "block";
    enrollCodeArea.style.display = "none";
  });

  if (btnCopyEnrollCode) {
    btnCopyEnrollCode.addEventListener("click", function () {
      var code = (enrollCodeDisplay ? enrollCodeDisplay.textContent : "").trim();
      if (!code || code === "--") return;

      var setCopiedUI = function () {
        if (copyEnrollCodeIcon) copyEnrollCodeIcon.innerHTML = icon("check", 14);
        if (copyEnrollCodeText) copyEnrollCodeText.textContent = "¡Copiado!";
        setTimeout(function () {
          if (copyEnrollCodeIcon) copyEnrollCodeIcon.innerHTML = icon("copy", 14);
          if (copyEnrollCodeText) copyEnrollCodeText.textContent = "Copiar";
        }, 2000);
        showToast("success", "Código " + code + " copiado al portapapeles.");
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(setCopiedUI).catch(function () {
          fallbackCopy(code, setCopiedUI);
        });
      } else {
        fallbackCopy(code, setCopiedUI);
      }
    });
  }

  function fallbackCopy(text, onSuccess) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        onSuccess();
      } else {
        showToast("error", "No se pudo copiar automáticamente: " + text);
      }
    } catch (e) {
      showToast("error", "No se pudo copiar: " + e.message);
    }
  }

  if (btnOpenWebDevices) {
    btnOpenWebDevices.addEventListener("click", function () {
      var server = (loginServer ? loginServer.value : "").trim();
      // Derive web URL by stripping trailing slashes, stripping /api, and appending /devices
      var webUrl = server.replace(/\/+$/, "").replace(/\/api\/?$/i, "") + "/devices";
      if (window.sketchup && window.sketchup.open_external_url) {
        window.sketchup.open_external_url(JSON.stringify({ url: webUrl }));
      } else {
        window.open(webUrl, "_blank");
      }
    });
  }

  btnLogout.addEventListener("click", function () {
    if (window.sketchup && window.sketchup.logout) {
      window.sketchup.logout();
    }
  });

  window.GraneteUI.account = {
    // The dialog bootstrap injects the shared presentation helpers before
    // dialog_ready; Ruby cannot reach the enrollment callbacks earlier.
    init: function (deps) {
      deps = deps || {};
      if (deps.showToast) showToast = deps.showToast;
      if (deps.icon) icon = deps.icon;
    },

    open: openAccountPopover,
    close: closeAccountPopover,

    setStatus: setStatus,
    onEnrollResult: onEnrollResult,
    onPollResult: onPollResult,
    onLoginResult: onLoginResult,
    startEnrollCountdown: startEnrollCountdown,
    clearEnrollmentTimers: clearEnrollmentTimers
  };
})();
