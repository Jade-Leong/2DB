let accountMode = location.pathname === "/signup" || new URLSearchParams(location.search).get("auth") === "signup" ? "signup" : "login";
let accountConfig = null;
let accountMessage = "";
let accountError = "";
let accountBusy = false;

function agentOverview() {
  const status = token ? agentStatus?.state || "Checking setup" : "Sign in to check agent status";
  return `<section class="agent-overview" id="agents" aria-label="Two separate agents and your decision">
    <article class="agent-stage"><div class="stage-label">agent 1<small>Build</small></div><div><h2 data-type="agent-one-title">From complaint to proposed fix.</h2><p data-type="agent-one-copy">Investigates the issue, reproduces the behavior, and proposes a change with source evidence.</p><div class="stage-output"><span>agent 1</span> / ${esc(status)}</div></div></article>
    <article class="agent-stage"><div class="stage-label">agent 2<small>Verify</small></div><div><h2 data-type="agent-two-title">Verify the result. See the evidence.</h2><p data-type="agent-two-copy">Checks the approved revision against the requirements. Compare the baseline and candidate before making a decision.</p><div class="stage-output"><span>agent 2</span> / Scripted verification available. Live agent not connected.</div></div></article>
    <article class="agent-stage"><div class="stage-label">you</div><div><h2 data-type="you-title">The final decision stays with you.</h2><p data-type="you-copy">Inspect the proposal. Approve an exact revision for testing. Review the results.</p></div></article>
  </section>`;
}

function localAccess() {
  return `<details class="local-access" ${accountConfig?.enabled ? "" : "open"}><summary>Local engineer access</summary><p>An alternative to account sign-in on this computer. Key sessions are recorded as “Local engineer”.</p><form id="login"><label>Local engineer key<input name="key" type="password" autocomplete="off" required></label><button ${busy ? "disabled" : ""}>Open engineer session →</button></form><p class="muted">Get the key with <code>npm run control:engineer</code> in a separate terminal.</p></details>`;
}

function accountView() {
  const signup = accountMode === "signup";
  return `<section class="login panel" aria-label="Account access"><div class="account-tabs" role="tablist" aria-label="Account access"><button id="login-tab" type="button" role="tab" aria-controls="account-panel" aria-selected="${!signup}" data-account-mode="login">Sign in</button><button id="signup-tab" type="button" role="tab" aria-controls="account-panel" aria-selected="${signup}" data-account-mode="signup">Sign up</button></div><div id="account-panel" role="tabpanel" aria-labelledby="${signup ? "signup" : "login"}-tab"><span class="eyebrow">you</span><h2>${signup ? "Join the workspace." : "Back to building."}</h2><p>${signup ? "Create an account to access the shared tickets, proposals, and verification results." : "Sign in to review tickets and work with your agents."}</p>${accountMessage ? `<p class="auth-message" role="status">${esc(accountMessage)}</p>` : ""}${accountError ? `<p class="auth-message error" role="alert">${esc(accountError)}</p>` : ""}<form id="account-form"><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="${signup ? 12 : 1}" maxlength="128" ${signup ? 'aria-describedby="password-hint"' : ""} required></label>${signup ? '<p id="password-hint" class="muted">Use at least 12 characters. You’ll confirm your email before signing in.</p>' : ""}<button ${accountBusy || !accountConfig?.enabled ? "disabled" : ""}>${accountBusy ? "Please wait…" : signup ? "Create account →" : "Sign in →"}</button></form>${accountConfig?.enabled ? '<p class="muted">Every account joins the same engineering workspace.</p>' : `<p class="muted" role="status">${accountConfig === null ? "Checking account access…" : "Email sign-in is not configured. Use local engineer access below."}</p>`}</div>${localAccess()}</section>`;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-account-mode]");
  if (!button || accountBusy) return;
  accountMode = button.dataset.accountMode;
  if (["/login", "/signup"].includes(location.pathname)) history.replaceState(null, "", `/${accountMode}`);
  accountMessage = ""; accountError = "";
  render();
  document.getElementById(`${accountMode}-tab`)?.focus();
});
document.addEventListener("keydown", (event) => {
  const button = event.target.closest("[data-account-mode]");
  if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const mode = event.key === "Home" ? "login" : event.key === "End" ? "signup" : button.dataset.accountMode === "login" ? "signup" : "login";
  document.querySelector(`[data-account-mode="${mode}"]`)?.click();
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "account-form") return;
  event.preventDefault();
  if (accountBusy) return;
  const data = new FormData(event.target);
  accountBusy = true; accountError = ""; accountMessage = "";
  const submit = event.target.querySelector("button");
  submit.disabled = true; submit.textContent = "Please wait…";
  try {
    const response = await fetch(`/auth-api/${accountMode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Account request failed. Please try again.");
    if (accountMode === "signup") { accountMessage = result.message; accountMode = "login"; }
    else {
      token = result.token;
      sessionStorage.setItem("2db-engineer-session", token);
      if (["/login", "/signup"].includes(location.pathname)) history.replaceState(null, "", "/");
      await refresh();
    }
  } catch (e) { accountError = e.message || "Please try again."; }
  finally { accountBusy = false; render(); document.getElementById("review-workspace")?.scrollIntoView({ block: "start" }); }
});
window.addEventListener("DOMContentLoaded", async () => {
  // Confirmation links can include provider tokens. Password login is used here;
  // discard fragments rather than retaining those tokens in the URL or storage.
  if (/access_token=|refresh_token=|error_description=/.test(location.hash)) {
    const params = new URLSearchParams(location.hash.slice(1));
    accountMessage = params.has("error_description") ? "The confirmation link could not be completed. Try signing in or request a new account confirmation." : "Email confirmation received. Sign in to continue.";
    history.replaceState(null, "", location.pathname + location.search);
  }
  try {
    const response = await fetch("/auth-api/config");
    accountConfig = response.ok ? await response.json() : { enabled: false };
  } catch { accountConfig = { enabled: false }; }
  if (!token) render();
});
