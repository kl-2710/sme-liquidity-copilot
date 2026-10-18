/* Lilact · client-only auth screens. No credentials are transmitted or persisted. */
(function (root) {
  "use strict";
  function setView(name) {
    var login = document.getElementById("login-form"), register = document.getElementById("register-form");
    if (!login || !register) return;
    var isRegister = name === "register";
    login.hidden = isRegister; register.hidden = !isRegister;
    document.getElementById("login-register-link").hidden = isRegister;
    document.getElementById("register-login-link").hidden = !isRegister;
    document.getElementById("auth-title").textContent = isRegister ? "Create your Lilact account" : "Welcome back";
    document.querySelector(".la-auth__intro").textContent = isRegister ? "Create an account to start managing your business liquidity." : "Sign in to continue to your Lilact workspace.";
    document.getElementById(isRegister ? "register-email" : "login-email").focus();
  }
  function validate(form) {
    var fields = Array.from(form.querySelectorAll("input[required]")), valid = true;
    fields.forEach(function (field) {
      var msg = "";
      if (!field.value.trim()) msg = field.id === "register-confirm" ? "Please confirm your password." : "Please enter your " + (field.type === "email" ? "email address." : "password.");
      else if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim())) msg = "Enter a valid email address, for example name@company.com.";
      else if (field.id.indexOf("password") >= 0 && field.value.length < 8) msg = "Use at least 8 characters for your password.";
      else if (field.id === "register-confirm" && field.value !== document.getElementById("register-password").value) msg = "The passwords do not match.";
      field.setAttribute("aria-invalid", String(Boolean(msg)));
      var error = document.querySelector('[data-error-for="' + field.id + '"]');
      if (error) error.textContent = msg;
      if (msg) valid = false;
    });
    return valid;
  }
  document.addEventListener("click", function (event) {
    var view = event.target.closest("[data-auth-view]");
    if (view) {
      event.preventDefault();
      var nextView = view.getAttribute("data-auth-view");
      setView(nextView);
      history.pushState(null, "", nextView === "register" ? "#register" : "#login");
    }
    var reveal = event.target.closest("[data-toggle-password]");
    if (reveal) {
      var input = document.getElementById(reveal.getAttribute("data-toggle-password")), show = input.type === "password";
      input.type = show ? "text" : "password"; reveal.textContent = show ? "Hide" : "Show";
      reveal.setAttribute("aria-label", show ? "Hide password" : "Show password");
    }
    if (event.target.closest("[data-enter-demo]")) {
      document.querySelector(".la-skip").setAttribute("href", "#workspace");
      document.getElementById("auth-screen").hidden = true;
      document.getElementById("demo-app").hidden = false;
      if (!location.hash || !/^#\/(uc00|uc01|uc02|uc03|uc04|log)$/.test(location.hash)) location.hash = "#/uc00";
      var title = document.getElementById("page-title"); if (title) title.focus({ preventScroll: true });
    }
  });
  window.addEventListener("popstate", function () {
    if (location.hash !== "" && location.hash !== "#login" && location.hash !== "#register") return;
    document.getElementById("auth-screen").hidden = false;
    document.getElementById("demo-app").hidden = true;
    document.querySelector(".la-skip").setAttribute("href", "#auth-title");
    setView(location.hash === "#register" ? "register" : "login");
  });
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.id !== "login-form" && form.id !== "register-form") return;
    event.preventDefault();
    var message = document.getElementById(form.id === "login-form" ? "login-message" : "register-message");
    message.textContent = "";
    if (!validate(form)) return;
    message.textContent = form.id === "login-form"
      ? "Real authentication is not supported yet. You are not signed in; use the demo option to continue."
      : "Account registration is not supported yet. No account was created; use the demo option to continue.";
    form.querySelectorAll('input[type="password"]').forEach(function (field) { field.value = ""; });
    form.querySelector("input[aria-invalid=\"true\"]")?.focus();
  });
  document.addEventListener("input", function (event) {
    if (event.target.matches("#login-form input, #register-form input")) {
      event.target.removeAttribute("aria-invalid");
      var error = document.querySelector('[data-error-for="' + event.target.id + '"]');
      if (error) error.textContent = "";
    }
  });
})(window);

