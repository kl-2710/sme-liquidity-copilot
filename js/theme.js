/* Lilact theme: Light / Dark / System.
   - "system" = no data-theme attribute → CSS follows prefers-color-scheme (and updates live when the OS changes).
   - Choice is remembered per browser (localStorage, wrapped in try/catch).
   - Fires a "lilact:theme" event so charts drawn with JS (e.g. Plotly) can re-colour themselves.
   Load this file in <head> WITHOUT defer so the page never flashes the wrong theme. */
(function () {
  var KEY = "lilact-theme", root = document.documentElement, mq = window.matchMedia("(prefers-color-scheme: dark)");
  function stored() { try { return localStorage.getItem(KEY) || "system"; } catch (e) { return "system"; } }
  function effective() { var v = root.getAttribute("data-theme"); return v || (mq.matches ? "dark" : "light"); }
  function apply(choice) {
    if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice); else root.removeAttribute("data-theme");
    document.dispatchEvent(new CustomEvent("lilact:theme", { detail: { choice: choice, theme: effective() } }));
  }
  function sync() {
    var c = stored();
    document.querySelectorAll("[data-theme-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === c)); });
  }
  apply(stored());
  mq.addEventListener("change", function () { if (stored() === "system") apply("system"); });
  window.lilactTheme = {
    set: function (choice) { try { choice === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch (e) {} apply(choice); sync(); },
    current: effective
  };
  document.addEventListener("DOMContentLoaded", function () {
    sync();
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.addEventListener("click", function () { window.lilactTheme.set(b.getAttribute("data-theme-set")); });
    });
  });
})();
