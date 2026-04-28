/**
 * auth.js
 *
 * Staff authentication for the static AlertOrbit demo shell.
 * In production this should be replaced by server-issued sessions or JWTs.
 */

document.addEventListener("DOMContentLoaded", () => {
  _seedStats();

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      _setLoading("loginSubmit", true);

      setTimeout(() => {
        const user = DB.Users.verify(email, password);
        if (user) {
          DB.Session.set(user);
          window.location.href = AlertOrbitConfig.POST_LOGIN_URL;
        } else {
          _showError("loginError", "Invalid email or password. Try staff@demo.com / demo1234");
          _setLoading("loginSubmit", false);
        }
      }, 600);
    });
  }

  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    signupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("signupName").value.trim();
      const role = document.getElementById("signupRole").value;
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPassword").value;

      if (!name || !email || !password || !role) {
        _showError("signupError", "Please fill in all fields.");
        return;
      }
      if (password.length < 8) {
        _showError("signupError", "Password must be at least 8 characters.");
        return;
      }

      _setLoading("signupSubmit", true);
      setTimeout(() => {
        const result = DB.Users.create(name, email, password, role);
        if (result.error) {
          _showError("signupError", result.error);
          _setLoading("signupSubmit", false);
        } else {
          document.getElementById("signupError").hidden = true;
          document.getElementById("signupSuccess").hidden = false;
          document.getElementById("signupSuccess").textContent =
            `Account created. You can now sign in as ${name}.`;
          signupForm.reset();
          _setLoading("signupSubmit", false);
          setTimeout(() => switchTab("login"), 1500);
        }
      }, 700);
    });
  }

  const pwdInput = document.getElementById("signupPassword");
  if (pwdInput) {
    pwdInput.addEventListener("input", () => _checkPasswordStrength(pwdInput.value));
  }
});

function switchTab(tab) {
  const isLogin = tab === "login";
  document.getElementById("tabLogin").classList.toggle("auth-tab--active", isLogin);
  document.getElementById("tabSignup").classList.toggle("auth-tab--active", !isLogin);
  document.getElementById("tabLogin").setAttribute("aria-selected", isLogin);
  document.getElementById("tabSignup").setAttribute("aria-selected", !isLogin);
  document.getElementById("panelLogin").hidden = !isLogin;
  document.getElementById("panelSignup").hidden = isLogin;
  ["loginError", "signupError", "signupSuccess"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}

function togglePwd(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  const btn = typeof btnEl === "string" ? document.getElementById(btnEl) : btnEl;
  if (btn) btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
}

function logout() {
  DB.Session.clear();
  const isNestedStaffPage = window.location.pathname.includes("/staff/");
  window.location.href = isNestedStaffPage ? "../staff-login.html" : AlertOrbitConfig.STAFF_LOGIN_URL;
}

function _showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function _setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const text = btn.querySelector(".btn-submit__text");
  const spin = btn.querySelector(".btn-submit__spinner");
  btn.disabled = loading;
  if (text) text.hidden = loading;
  if (spin) spin.hidden = !loading;
}

function _checkPasswordStrength(pwd) {
  const fill = document.getElementById("pwsFill");
  const label = document.getElementById("pwsLabel");
  if (!fill || !label) return;

  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  const levels = [
    { pct: "0%", color: "transparent", text: "" },
    { pct: "25%", color: "#ef4444", text: "Weak" },
    { pct: "50%", color: "#f59e0b", text: "Fair" },
    { pct: "75%", color: "#3b82f6", text: "Good" },
    { pct: "100%", color: "#00c896", text: "Strong" },
  ];
  const level = levels[Math.min(score, 4)];
  fill.style.width = level.pct;
  fill.style.background = level.color;
  label.textContent = level.text;
  label.style.color = level.color;
}

function _seedStats() {
  const stats = DB.Alerts.stats();
  const liveEl = document.getElementById("abLive");
  const totalEl = document.getElementById("abTotal");
  if (liveEl) liveEl.textContent = stats.active;
  if (totalEl) totalEl.textContent = stats.today;
}

window.switchTab = switchTab;
window.togglePwd = togglePwd;
window.logout = logout;
