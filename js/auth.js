/* Lilact · client-only auth screens. No credentials are transmitted or persisted. */
(function (root) {
  "use strict";
  function setView(name) {
    var login = document.getElementById("login-form"), register = document.getElementById("register-form");
    if (!login || !register) return;
    var isRegister = name === "register";
    login.hidden = isRegister; register.hidden = !isRegister;
    document.querySelectorAll("[data-auth-view]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-auth-view") === name));
    });
    document.getElementById("auth-title").textContent = isRegister ? "Tạo tài khoản Lilact" : "Chào mừng trở lại";
    document.querySelector(".la-auth__intro").textContent = isRegister ? "Tạo tài khoản để bắt đầu quản lý thanh khoản doanh nghiệp." : "Đăng nhập để tiếp tục với không gian làm việc Lilact.";
    document.getElementById(isRegister ? "register-email" : "login-email").focus();
  }
  function validate(form) {
    var fields = Array.from(form.querySelectorAll("input[required]")), valid = true;
    fields.forEach(function (field) {
      var msg = "";
      if (!field.value.trim()) msg = field.id === "register-confirm" ? "Vui lòng nhập lại mật khẩu." : "Vui lòng nhập " + (field.type === "email" ? "email." : "mật khẩu.");
      else if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value.trim())) msg = "Email chưa đúng định dạng. Ví dụ: ten@congty.vn.";
      else if (field.id.indexOf("password") >= 0 && field.value.length < 8) msg = "Mật khẩu cần có ít nhất 8 ký tự.";
      else if (field.id === "register-confirm" && field.value !== document.getElementById("register-password").value) msg = "Mật khẩu nhập lại chưa khớp.";
      field.setAttribute("aria-invalid", String(Boolean(msg)));
      var error = document.querySelector('[data-error-for="' + field.id + '"]');
      if (error) error.textContent = msg;
      if (msg) valid = false;
    });
    return valid;
  }
  document.addEventListener("click", function (event) {
    var view = event.target.closest("[data-auth-view]");
    if (view) setView(view.getAttribute("data-auth-view"));
    var reveal = event.target.closest("[data-toggle-password]");
    if (reveal) {
      var input = document.getElementById(reveal.getAttribute("data-toggle-password")), show = input.type === "password";
      input.type = show ? "text" : "password"; reveal.textContent = show ? "Ẩn" : "Hiện";
      reveal.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    }
    if (event.target.closest("[data-enter-demo]")) {
      document.querySelector(".la-skip").setAttribute("href", "#workspace");
      document.getElementById("auth-screen").hidden = true;
      document.getElementById("demo-app").hidden = false;
      if (!location.hash || !/^#\/(uc00|uc01|uc02|uc03|uc04|log)$/.test(location.hash)) location.hash = "#/uc00";
      var title = document.getElementById("page-title"); if (title) title.focus({ preventScroll: true });
    }
  });
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.id !== "login-form" && form.id !== "register-form") return;
    event.preventDefault();
    var message = document.getElementById(form.id === "login-form" ? "login-message" : "register-message");
    message.textContent = "";
    if (!validate(form)) return;
    message.textContent = form.id === "login-form"
      ? "Xác thực thật chưa được hỗ trợ. Bạn chưa đăng nhập; hãy dùng nút vào bản demo."
      : "Đăng ký thật chưa được hỗ trợ. Không có tài khoản nào được tạo; hãy dùng nút vào bản demo.";
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

