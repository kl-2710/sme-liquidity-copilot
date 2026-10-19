"""Port SME_Finance_Copilot_AI_Agent_v2-4.html onto the Lilact identity.
Usage: python tools/port_prototype.py <path/to/SME_Finance_Copilot_AI_Agent_v2-4.html> <repo root>
Flow, markup, data and JS logic are kept as in the prototype; only colours, fonts, logo and brand name change."""
import re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from colormap import repl, ONDARK
SRC, OUT = sys.argv[1], sys.argv[2]
L = open(SRC, encoding="utf-8").read().split("\n")
css_lines = L[:964]; body = "\n".join(L[964:1112]); data_line = L[1112]; js_lines = L[1113:2906]

# ---------------- CSS ----------------
css = "\n".join(css_lines)
css = css[css.index("<style>") + 7: css.index("</style>")]
# drop the prototype's own palette + every hard-coded dark override: Lilact tokens switch light/dark themselves
css = re.sub(r"^:root\{\n --navy.*?\n\}\n", "", css, flags=re.S)
css = re.sub(r":root\{--paper:[^}]*\}", ":root{--chatw:760px;--sbw:276px;--pw:clamp(500px,calc(100vw - var(--sbw) - 430px),880px)}", css)
css = re.sub(r"html\[data-theme=dark\]\{color-scheme:dark;.*?--kcbg:\.14\}\n", "", css, flags=re.S)
css = "\n".join(l for l in css.split("\n") if "html[data-theme=dark]" not in l and "html[data-theme=light]" not in l and not l.startswith("html{--zone"))

def conv_rule(m):
    sel, decls = m.group(1), m.group(2)
    ondark = bool(ONDARK.search(sel))
    def conv_decl(d):
        prop, val = d.group(1), d.group(2)
        if prop.startswith("--"):
            return d.group(0) if "#" not in val else f"{prop}:" + re.sub(r"#[0-9a-fA-F]{3,8}\b", lambda h: repl(h.group(0), "background", ondark), val)
        val = re.sub(r"#[0-9a-fA-F]{3,8}\b", lambda h: repl(h.group(0), prop, ondark), val)
        val = re.sub(r"rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)", lambda r: f"rgba(27,22,56,{r.group(4)})", val)
        return f"{prop}:{val}"
    decls = re.sub(r"([a-zA-Z-]+)\s*:\s*([^;]+)", conv_decl, decls)
    return f"{sel}{{{decls}}}"
# skip data: URLs inside url(...) while converting
urls = []
css = re.sub(r'url\("data:[^"]*"\)', lambda m: urls.append(m.group(0)) or f"__URL{len(urls)-1}__", css)
for _ in range(2):  # rules nested in @media/@container are handled on the second pass level-agnostically
    css = re.sub(r"([^{}]+)\{([^{}]*)\}", conv_rule, css)
for i, u in enumerate(urls): css = css.replace(f"__URL{i}__", u.replace("%23718096", "%236B6585"))
# Lilact is flat: collapse gradients whose stops are all tokens (keep fades to transparent)
def flat(m):
    g = m.group(0)
    if "transparent" in g: return g
    vs = re.findall(r"var\(--lc-color-[a-zA-Z-]+\)", g)
    return vs[0] if vs else g
css = re.sub(r"(?:linear|radial)-gradient\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)", flat, css)

TOKENS = """/* Lilact identity layer: the prototype's variables now point at Lilact design tokens (lilact-tokens.css),
   so light and dark themes come from the brand kit. */
:root,html{
 --navy:var(--lc-color-bg-brand);--navy2:var(--lc-color-bg-brand);--blue:var(--lc-color-action-primary);--blue2:var(--lc-color-data-receivables);
 --cyan:var(--lc-color-brand-accent);--bg:var(--lc-color-bg-page);--card:var(--lc-color-bg-surface);--ink:var(--lc-color-text-primary);
 --ink2:var(--lc-color-text-secondary);--muted:var(--lc-color-text-muted);--line:var(--lc-color-border-default);
 --line2:color-mix(in srgb,var(--lc-color-border-default) 55%,var(--lc-color-bg-surface));
 --green:var(--lc-color-status-success);--amber:var(--lc-color-status-warning);--red:var(--lc-color-status-error);--purple:var(--lc-color-data-receivables);--gray:var(--lc-color-text-muted);
 --green-bg:var(--lc-color-status-success-bg);--amber-bg:var(--lc-color-status-warning-bg);--red-bg:var(--lc-color-status-error-bg);--blue-bg:var(--lc-color-bg-selected);--gray-bg:var(--lc-color-bg-subtle);
 --shadow:var(--lc-shadow-md);--shadow2:var(--lc-shadow-lg);--ease:var(--lc-motion-easing-standard);--r:var(--lc-radius-lg);
 --paper:var(--lc-color-bg-page);--side:var(--lc-color-bg-sidebar);--sline:var(--lc-color-border-default);
 --zone:var(--lc-color-bg-subtle);--zline:var(--lc-color-border-default);--hov:var(--lc-color-bg-hover);--kcbg:.07;
 --accent:var(--lc-color-action-primary);--serif:var(--lc-font-display);
}
html[data-theme=dark]{--kcbg:.14}
"""
LILACT = """
/* ---------- Lilact brand elements ---------- */
body{font-family:var(--lc-font-sans);font-feature-settings:"cv11" 1}
.brand .lilact-logo{height:30px;width:auto;display:block}
.auth-brand .lilact-logo{height:40px}
.brand small,.auth-brand small{letter-spacing:.02em}
.lilact-logo--dark{display:none!important}
html[data-theme=dark] .lilact-logo--light{display:none!important}html[data-theme=dark] .lilact-logo--dark{display:block!important}
.auth-hero .lilact-logo--light{display:none!important}.auth-hero .lilact-logo--dark{display:block!important}
.brandmark{display:none}
.themebtn .i-moon{display:none}html[data-theme=dark] .themebtn .i-sun{display:none}html[data-theme=dark] .themebtn .i-moon{display:block}
.hero .hm{background:none;box-shadow:none;width:44px;height:44px}.hero .hm img{width:44px;height:44px}
.msg.bot:before{content:"";background:var(--lc-color-bg-selected) url("../assets/brand/lilact-symbol-light.svg") center/20px no-repeat}
html[data-theme=dark] .msg.bot:before{background-image:url("../assets/brand/lilact-symbol-dark.svg")}
.msg.user{background:var(--lc-color-bg-subtle);color:var(--lc-color-text-primary)}
.hero h1,.aform h2,.auth-copy h1{font-family:var(--lc-font-display);font-weight:600;letter-spacing:-.02em}
.auth-copy h1 em{font-style:normal;color:var(--lc-color-action-primary-active)}
html[data-theme=dark] .auth-copy h1 em{color:var(--lc-color-brand-accent)}
.auth-hero{background:var(--lc-color-bg-brand)}
.auth-copy h1 em{color:var(--lc-color-brand-accent)}
:focus-visible{outline:2px solid var(--lc-color-border-focus)}
.btn.primary,.send{background:var(--lc-color-action-primary);color:var(--lc-color-text-onAction)}
.btn.primary:hover,.send:hover{background:var(--lc-color-action-primary-hover);filter:none}
.tnav.on .ti{background:var(--lc-color-action-primary);color:var(--lc-color-text-onAction)}
.tnav.on .ti svg .kn{fill:var(--lc-color-action-primary)}
.tnav .ti svg .kn{fill:var(--lc-color-bg-subtle)}
.ink{background:var(--lc-color-action-primary)}
.result{background:var(--lc-color-bg-brand);color:var(--lc-color-text-onBrand)}
.toast{background:var(--lc-color-bg-brand);color:var(--lc-color-text-onBrand)}
.tip,#tt,.info:hover:after,.info:focus:after{background:var(--lc-color-bg-brand);color:var(--lc-color-text-onBrand)}
.status.amber,.tier.t1,.tl.t2,.pending-chip{color:var(--lc-color-status-warning)}
.pending-chip b,.tab .badge,.tnav .badge{background:var(--lc-color-status-warning);color:var(--lc-color-text-onAction)}
.simtag{color:var(--lc-color-status-success);background:var(--lc-color-status-success-bg);border-color:transparent}
.avatar{background:var(--lc-color-bg-selected);color:var(--lc-color-text-link)}
.tog[aria-checked=true],.sw[aria-checked=true]{background:var(--lc-color-action-primary)}
.tog{background:var(--lc-color-border-control)}
.sel{background-color:var(--lc-color-bg-input);color:var(--lc-color-text-primary)}
.fld input[type=text],.fld input[type=email],.fld input[type=password],.dform input,.dform select,.search,.modal textarea,.inputrow input,.composer{background:var(--lc-color-bg-input)}
.jsonrow td,.toolchip pre{background:var(--lc-color-bg-brand)}.jsonrow pre,.toolchip pre{color:var(--lc-color-text-onBrand)}
.kc .ki{color:var(--kc)}
.btn.ok{background:var(--lc-color-status-success);color:var(--lc-color-text-onAction)}
tr.top1 .rank{background:var(--lc-color-status-success);color:var(--lc-color-text-onAction)}
.pv.l{background:linear-gradient(90deg,#EFEDF7 28%,#FFFFFF 28%)}.pv.d{background:linear-gradient(90deg,#130F26 28%,#17132B 28%)}.pv.s{background:linear-gradient(115deg,#EFEDF7 0 45%,#130F26 45%)}
"""
FONTS = """@font-face{font-family:"Inter";src:url("../assets/fonts/Inter-Regular.woff2") format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Inter";src:url("../assets/fonts/Inter-Medium.woff2") format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:"Inter";src:url("../assets/fonts/Inter-SemiBold.woff2") format("woff2");font-weight:600 800;font-display:swap}
@font-face{font-family:"Inter Display";src:url("../assets/fonts/InterDisplay-SemiBold.woff2") format("woff2");font-weight:600;font-display:swap}
"""
open(f"{OUT}/css/app.css", "w", encoding="utf-8").write(
    "/* SME Finance Copilot prototype v2-4 layout, re-skinned with the Lilact brand kit.\n"
    "   Generated by tools/port_prototype.py from the prototype CSS: every colour is a Lilact token. */\n" + FONTS + TOKENS + css.strip() + "\n" + LILACT)

# ---------------- JS ----------------
def mix(t, p): return f"color-mix(in srgb,var(--lc-color-{t}) {p}%,transparent)"
JS = {"#e9edf4": "var(--lc-color-border-default)", "#8b97aa": "var(--lc-color-text-muted)", "#e49a2414": mix("alert-orange-mark", 8),
      "#e49a2455": mix("alert-orange-mark", 33), "#4567f5": "var(--lc-color-data-cash)", "#e49a24": "var(--lc-color-alert-orange-mark)",
      "#c0821a": "var(--lc-color-alert-orange)", "#b9780f": "var(--lc-color-alert-orange)", "#159b79": "var(--lc-color-status-success)",
      "#17243b": "var(--lc-color-text-primary)", "#fff": "var(--lc-color-bg-surface)", "#e45b7055": mix("alert-red-mark", 33),
      "#e45b7030": mix("alert-red-mark", 19), "#9fb0d6": "var(--lc-color-data-historical)", "#9aa6ba": "var(--lc-color-text-muted)",
      "#e45b70": "var(--lc-color-alert-red-mark)", "#e4e2dc": "var(--lc-color-border-default)", "#2c2a25": "var(--lc-color-text-primary)",
      "#ece9e0": "var(--lc-color-border-default)", "#d1495b": "var(--lc-color-status-error)", "#2f8f5b": "var(--lc-color-status-success)",
      "#3d5a8a": "var(--lc-color-data-cash)", "#7c6cf0": "var(--lc-color-data-receivables)", "#4a9cf5": "var(--lc-color-data-payables)",
      "#1e9e6a": "var(--lc-color-status-success)", "#2f86ea": "var(--lc-color-data-inventory)", "#f0703c": "var(--lc-color-data-payables)",
      "#1fbf9f": "var(--lc-color-data-cash)", "#6c5ce7": "var(--lc-color-data-receivables)", "#bfe0cf": "var(--lc-color-status-success-bg)",
      "#f6c4c4": "var(--lc-color-status-error-bg)", "#e0615f": "var(--lc-color-status-error)", "#fbe3e6": "var(--lc-color-status-error-bg)",
      "#b3261e": "var(--lc-color-status-error)", "#8af5d6": "#6BCB8F", "#ffd78a": "#F2C94C", "#181714": "#0F0C1E", "#f8f7f3": "#F7F6FB"}
js = "\n".join(js_lines)
sc_line, code = js.split("\n", 1)
missing = set()
def jsrep(m):
    h = m.group(0).lower()
    if h in JS: return JS[h]
    missing.add(h); return m.group(0)
code = re.sub(r"#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])", jsrep, code)
code = code.replace("'SME Finance Copilot | AI Agent'", "'Lilact · SME Liquidity Copilot'").replace("'Sign in | SME Finance Copilot'", "'Sign in · Lilact'")
code = code.replace('<div class="hm" aria-hidden="true">✦</div>', '<div class="hm" aria-hidden="true"><img src="assets/brand/lilact-symbol-light.svg" alt="" class="lilact-logo--light"><img src="assets/brand/lilact-symbol-dark.svg" alt="" class="lilact-logo--dark"></div>')
code = code.replace("M\u1ecdi draft(s) ph\u1ea3i \u0111\u01b0\u1ee3c you duy\u1ec7t in the Approvals tab.", "Every draft needs your approval in the Approvals tab.").replace("</i>Ra ${mm(x.out)}", "</i>Out ${mm(x.out)}")
code = code.replace(">Xong<", ">Done<")
code = code.replace("\u0111\u1ec3 \u0111\u01b0a on h\u00e0ng ch\u1edd, then duy\u1ec7t in the Approvals tab.", "to add it to the queue, then approve it in the Approvals tab.").replace(" before / sau</h3>", " before / after</h3>")
# Prototype bug: botNote() is called after an approval and on chat errors but was never defined (ReferenceError).
anchor = "async function say(bot,html,cls=''){"
assert anchor in code and "function botNote" not in code
code = code.replace(anchor, "async function botNote(html,{suggest}={}){const b=newBot();await say(b,html);suggestRow(b,suggest);return b}\n" + anchor, 1)
if missing: print("JS colours left unmapped:", sorted(missing))
os.makedirs(f"{OUT}/js", exist_ok=True)
open(f"{OUT}/js/data.js", "w", encoding="utf-8").write("/* Synthetic demo data and scenario presets of the SME Finance Copilot prototype v2-4 (unchanged). */\n"
    + data_line.replace("<script>", "", 1) + "\n" + sc_line + "\n")
open(f"{OUT}/js/app.js", "w", encoding="utf-8").write("/* SME Finance Copilot prototype v2-4 application logic (flow and business rules unchanged; colours use Lilact tokens). */\n" + code.strip() + "\n")

# ---------------- HTML ----------------
LOGO = ('<img class="lilact-logo lilact-logo--light" src="assets/brand/lilact-logo-horizontal-light.svg" alt="Lilact" width="83" height="30">'
        '<img class="lilact-logo lilact-logo--dark" src="assets/brand/lilact-logo-horizontal-dark.svg" alt="Lilact" width="83" height="30">')
body = body.replace('<div class="brandmark" aria-hidden="true">✦</div><div><strong>SME Finance Copilot</strong><small>FinTechathon 2026 · Topic E</small></div>',
                    f'<div>{LOGO}<small>SME Liquidity Copilot</small></div>')
body = body.replace("Sign in to continue with Finance Copilot.", "Sign in to continue with Lilact.")
body = body.replace("Copilot computes DSO", "Lilact computes DSO")
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<title>Lilact · SME Liquidity Copilot</title>\n<meta name="color-scheme" content="light dark">\n'
        '<link rel="icon" href="assets/brand/lilact-favicon.svg" type="image/svg+xml">\n<link rel="icon" href="assets/brand/lilact-favicon-32.png" sizes="32x32">\n'
        '<link rel="apple-touch-icon" href="assets/brand/lilact-app-icon-180.png">\n'
        '<link rel="stylesheet" href="css/lilact-tokens.css">\n<link rel="stylesheet" href="css/app.css">\n'
        + L[963][L[963].index("<script>"):] + "\n</head>\n")
html = head + body + '\n<script src="js/data.js"></script>\n<script src="js/app.js"></script>\n</body>\n</html>\n'
open(f"{OUT}/index.html", "w", encoding="utf-8").write(html)
print("ok", len(css), len(code))
