const root = document.getElementById("app");
let token = sessionStorage.getItem("2db-engineer-session") || "",
  inbox = [],
  imported = [],
  proposals = [],
  selected = null,
  ticket = null,
  error = "",
  notice = "",
  busy = false,
  testSummary = null;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const short = (value) => (value ? value.slice(0, 12) : "—");
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
async function api(url, data) {
  const res = await fetch("/engineer-api" + url, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (res.status === 401 && url !== "/login") {
      token = "";
      workspaceMemory.clear();
      sessionStorage.removeItem("2db-engineer-session");
      throw new Error("Your session has expired. Please sign in again.");
  }
  return readApiResponse(res);
}
let workspaceRefreshVersion = 0;
async function refresh() {
  if (!token) return;
  const version = ++workspaceRefreshVersion, session = token;
  const result = await Promise.all([
    api("/inbox"),
    api("/tickets"),
    api("/proposals"),
    api("/test-summary"),
  ]);
  if (version !== workspaceRefreshVersion || token !== session) return;
  [inbox, imported, proposals, testSummary] = result;
  if (!selected && ticket) {
    const latest = proposals.find((p) => p.ticket_id === ticket.id);
    if (latest) {
      const updated = await api(`/proposals/${latest.id}`);
      if (version !== workspaceRefreshVersion || token !== session) return;
      selected = updated;
    }
  }
  if (selected) {
    const id = selected.id, updated = await api(`/proposals/${id}`);
    if (version !== workspaceRefreshVersion || selected?.id !== id || token !== session) return;
    selected = updated;
  }
  await refreshAgent();
  render();
}
function statusClass(s) {
  return /inconclusive|cancelled|needs information/i.test(s) ? "warning" : /Verified|passed/.test(s)
    ? "good"
    : /Failed|failed|Rejected/.test(s)
      ? "bad"
      : /running|Approved/.test(s)
        ? "blue"
        : "neutral";
}
function badge(s) {
  return `<span class="badge ${statusClass(s)}">${esc(s)}</span>`;
}
function hashLabel(label, value) {
  return `<div class="hash"><span>${label}</span><code title="${esc(value)}">${esc(value)}</code></div>`;
}
function allTickets() {
  const map = new Map(imported.map((t) => [t.id, { ...t, imported: true }]));
  for (const t of inbox) if (!map.has(t.id)) map.set(t.id, t);
  return [...map.values()];
}
function render() {
  const previousWorkspace = captureWorkspace();
  const p = selected,
    t = p?.ticket || ticket;
  const accountPage = !token && ["/login", "/signup"].includes(location.pathname);
  root.innerHTML = `<div class="shell ${token ? "signed-in" : ""}"><div class="terminal-titlebar"><span class="traffic-lights" aria-hidden="true"><i></i><i></i><i></i></span><span>2db — engineer workspace</span><span class="titlebar-spacer"></span></div><div class="workspace"><header><a class="logo" href="/">2db</a><nav aria-label="Main navigation">${!token ? `<a href="${accountPage ? "/#agents" : "#agents"}">The agents</a>` : ""}<a href="${token ? "#review-workspace" : "/login"}">${token ? "Workspace" : "Sign in"}</a>${!token ? '<a href="/signup">Sign up</a>' : ""}<a href="http://127.0.0.1:3001" target="_blank" rel="noreferrer">Loop Market ↗</a></nav><div class="engineer">${token ? '<span>you</span><button class="text" data-action="logout">Sign out</button>' : '<span class="muted">Local workspace</span>'}</div></header>${token || accountPage ? "" : `<section class="terminal-hero"><span class="breadcrumb">2db / engineer workspace</span><h1 data-type="hero-title">One builds.<br><span>One verifies.</span></h1><p data-type="hero-copy">Two separate agents for your engineering workflow.<br>One proposes the change. One verifies it. You decide what ships.</p><a class="hero-link" href="${token ? "#review-workspace" : "/signup"}">${token ? "Open your workspace" : "Get started"} ↓</a></section>${agentOverview()}`}<main id="review-workspace">${error ? `<div class="alert error" role="alert">${esc(error)}</div>` : ""}${notice ? `<div class="alert" role="status">${esc(notice)}</div>` : ""}
${
  !token
    ? accountView()
    : workspaceView(t)
} </main><footer><span>2db / One builds. One verifies.</span><span>Independent agents. Your approval.</span></footer></div></div>`;
  const brand = root.querySelector(".logo");
  brand.setAttribute("aria-label", "2db home");
  brand.innerHTML = '<img src="/brand-mark.svg" width="104" height="40" alt=""><span>2db</span>';
  restoreWorkspace(previousWorkspace, t);
  window.TerminalMotion?.enhance(root);
}
function ticketView(t) {
  return `<section class="ticket-header"><div class="ticket-kicker"><span>${esc(t.customer_name)}</span><time title="${esc(date(t.submitted_at))}">${relativeDate(t.submitted_at)}</time></div><h2>${esc(t.subject)}</h2><blockquote>${esc(t.complaint)}</blockquote><details><summary>Ticket details</summary><dl class="ticket-metadata"><dt>Ticket reference</dt><dd>${esc(t.id)}</dd><dt>Customer</dt><dd>${esc(t.customer_name)} · ${esc(t.customer_role)}</dd><dt>Customer ID</dt><dd>${esc(t.customer_id)}</dd><dt>Submitted</dt><dd>${date(t.submitted_at)}</dd>${t.related_reference ? `<dt>Related record</dt><dd>${esc(t.related_reference)}</dd>` : ""}</dl></details></section>`;
}
function agent2Assessment(run) {
  if (!run || run.verification_mode !== "live-agent-2") return "";
  let assessment = null;
  try {
    assessment = run.agent_assessment ? JSON.parse(run.agent_assessment) : null;
  } catch {}
  return assessment ? `<div class="assessment-summary"><h3>Agent 2 findings</h3><p>${esc(assessment.summary || "No written summary provided.")}</p><details><summary>Technical details · full assessment</summary><pre>${esc(JSON.stringify(assessment, null, 2))}</pre></details></div>` : "";
}
function evidenceView(p, run) {
  const current =
    run &&
    p.last_run === run.id &&
    run.revision_number === p.revision_number &&
    run.candidate_revision === p.candidate_revision &&
    run.approval_id === p.current_approval;
  const evidence = current ? run.evidence : null,
    base = evidence?.baseline?.required?.assessment,
    candidate = evidence?.candidate?.required?.assessment;
  return `<section class="panel"><div class="section-title"><div><span class="eyebrow">${run?.verification_mode === "live-agent-2" ? "LIVE VERIFICATION" : "AUTOMATED CHECKS"}</span><h3>Verification evidence</h3></div>${run ? badge(current ? run.state : "Stale evidence — approval or revision changed") : badge("Not run")}</div>${run ? `<p class="run-message">${esc(current ? run.message || "Executing the trusted Playwright harness…" : "This evidence is archived and cannot verify the current revision.")}</p><p class="small muted">Run ${esc(run.id)} · ${esc(run.verification_mode || "scripted-verification")}<br>${date(run.started_at)} → ${date(run.finished_at)}</p>` : '<p class="muted">Agent 2 has not reviewed this revision yet.</p>'}${agent2Assessment(run)}<div class="table-scroll"><table><thead><tr><th>Required check</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>${p.requirements
    .map((r) => {
      const b = base?.checks.find((x) => x.id === r.id),
        c = candidate?.checks.find((x) => x.id === r.id);
      return `<tr><td><strong>${r.id}</strong> ${esc(r.title)}<details><summary>Expected / observed</summary><pre>Expected: ${esc(JSON.stringify(r.expected, null, 2))}\nBaseline: ${esc(JSON.stringify(b?.observed ?? null, null, 2))}\nCandidate: ${esc(JSON.stringify(c?.observed ?? null, null, 2))}</pre>${b?.errors?.length ? `<p class="error-text">Baseline: ${esc(b.errors.join("\n"))}</p>` : ""}${c?.errors?.length ? `<p class="error-text">Candidate: ${esc(c.errors.join("\n"))}</p>` : ""}</details></td><td>${badge(b?.status || "missing")}</td><td>${badge(c?.status || "missing")}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div>${evidence ? ["baseline", "candidate"].map((env) => `<details class="artifacts"><summary>${env === "baseline" ? "Baseline" : "Candidate"} process evidence & artifacts</summary><p>Typecheck exit: ${evidence[env].typecheck.exitCode ?? "none"} · Build exit: ${evidence[env].build.exitCode ?? "none"} · Required tests exit: ${evidence[env].required.exitCode ?? "none"}</p><div class="actions"><button class="text" data-artifact="/run-log/${run.id}/${env}/typecheck.log">Typecheck log</button><button class="text" data-artifact="/run-log/${run.id}/${env}/build.log">Build log</button><button class="text" data-artifact="/artifact/${run.id}/${env}/required/process.log">Test log</button><button class="text" data-artifact="/artifact/${run.id}/${env}/required/results.json">Structured results</button></div>${evidence[env].required.report?.tests.map((t) => `<div class="small">${esc(t.id)} ${t.artifacts.map((a) => `<button class="text" data-artifact="/artifact/${run.id}/${env}/required/${encodeURIComponent(a.path)}">${esc(a.name)} ↗</button>`).join("")}</div>`).join("") || ""}</details>`).join("") : ""}<div class="unresolved"><strong>Known unresolved scenarios · separate from this ticket</strong><p>Paid order missing from history · Uploaded photo persistence</p>${evidence ? ["baseline", "candidate"].map((env) => `<p class="small">${env}: ${evidence[env].known?.report?.tests.map((t) => `${esc(t.id)} ${esc(t.status)}`).join(" · ") || "Not measured"} · exit ${evidence[env].known?.exitCode ?? "none"} <button class="text" data-artifact="/artifact/${run.id}/${env}/known-unresolved/results.json">Results</button></p>`).join("") : ""}<small>A discount pass does not mean all bugs are fixed. No merging or deployment occurs.</small></div>${
    p.runs.length > 1
      ? `<details><summary>Earlier runs (not evidence for a newer revision)</summary>${p.runs
          .slice(1)
          .map(
            (r) =>
              `<p class="small">${esc(r.id)} · ${short(r.candidate_revision)} · ${date(r.started_at)} · ${esc(r.state)} <button class="text" data-artifact="/runs/${r.id}">Download archived evidence</button></p>`,
          )
          .join("")}</details>`
      : ""
  }</section>`;
}
root.addEventListener("submit", async (event) => {
  if (event.target.id !== "login") return;
  event.preventDefault();
  busy = true;
  error = "";
  const key = new FormData(event.target).get("key");
  try {
    const session = await api("/login", { key });
    token = session.token;
    sessionStorage.setItem("2db-engineer-session", token);
    await refresh();
  } catch (e) {
    error = e.message;
  } finally {
    busy = false;
    render();
  }
});
root.addEventListener("click", async (event) => {
  const el = event.target.closest("button");
  if (!el) return;
  const action = el.dataset.action,
    artifact = el.dataset.artifact;
  if (!action && !artifact) return;
  if (busy) return;
  error = "";
  notice = "";
  try {
    if (artifact) {
      const response = await fetch("/engineer-api" + artifact, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok)
        throw new Error("Artifact unavailable. Review the process status.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = decodeURIComponent(artifact.split("/").at(-1))
        .split("/")
        .at(-1);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (["filter-all", "filter-unread", "filter-approved"].includes(action)) {
      inboxReadFilter = action.replace("filter-", "");
      render();
      return;
    } else if (action === "show-inbox" || action === "show-ticket") {
      mobileWorkspacePane = action === "show-inbox" ? "inbox" : "ticket";
      render();
      return;
    } else if (action === "open-review" || action === "open-results") {
      const panel = root.querySelector(`[data-agent-detail="${action === "open-review" ? "build" : "verify"}"]`);
      if (panel) { panel.open = true; panel.querySelector("summary").focus({ preventScroll: true }); panel.scrollIntoView({ block: "nearest", behavior: "instant" }); }
      return;
    } else if (action === "logout") {
      workspaceRefreshVersion++;
      workspaceMemory.clear();
      await api("/logout", {});
      token = "";
      sessionStorage.removeItem("2db-engineer-session");
      selected = null;
      ticket = null;
    } else if (action === "home") {
      selected = null;
      ticket = null;
    } else if (action === "refresh") await refresh();
    else if (action === "ticket") {
      workspaceRefreshVersion++;
      mobileWorkspacePane = "ticket";
      selected = null;
      ticket = allTickets().find((t) => t.id === el.dataset.id);
      markTicketRead(ticket?.id);
      const latest = proposals.find((p) => p.ticket_id === ticket?.id);
      if (latest) selected = await api(`/proposals/${latest.id}`);
      await refreshAgent();
    } else if (action === "proposal") {
      workspaceRefreshVersion++;
      mobileWorkspacePane = "ticket";
      selected = await api("/proposals/" + el.dataset.id);
      markTicketRead(selected?.ticket_id);
      ticket = null;
      await refreshAgent();
    } else if (action === "create") {
      selected = await api("/proposals", {
        ticketId: el.dataset.id,
        kind: el.dataset.kind,
      });
      ticket = null;
      await refresh();
    } else if (action === "check-tavily") {
      busy = true;
      render();
      const result = await api("/research/check", {});
      await refreshAgent();
      notice = result.verified
        ? "Tavily Search and Extract verified. This check did not run an investigation."
        : "Tavily check failed. Review the research panel for details.";
    } else if (action === "investigate") {
      busy = true;
      render();
      investigation = await api(
        "/tickets/" + el.dataset.id + "/investigate",
        {},
      );
      await refresh();
    } else if (action === "scripted-demo") {
      busy = true;
      render();
      scriptedInvestigation = await api(
        "/tickets/" + el.dataset.id + "/scripted-demo",
        { kind: document.getElementById("scripted-kind").value },
      );
      notice = "Scripted Agent 1 demonstration started. It makes no model calls.";
      await refresh();
    } else if (action === "cancel-scripted-demo") {
      scriptedInvestigation = await api(
        "/scripted-investigations/" + el.dataset.id + "/cancel",
        {},
      );
      await refresh();
    } else if (action === "cancel-investigation") {
      investigation = await api(
        "/investigations/" + el.dataset.id + "/cancel",
        {},
      );
      await refresh();
    } else if (selected) {
      const id = selected.id;
      busy = true;
      if (action === "revision")
        selected = await api(`/proposals/${id}/revision`, {
          kind: document.getElementById("fixture").value,
        });
      else if (action === "approve") {
        selected = await api(`/proposals/${id}/approve`, {
          revision: selected.candidate_revision,
          revisionNumber: selected.revision_number,
        });
        notice = "Approved. This ticket is now in the human PR queue.";
      } else if (action === "reject")
        selected = await api(`/proposals/${id}/reject`, { note: "" });
      else if (action === "verify") {
        await api(`/proposals/${id}/verify`, {});
        notice =
          "Scripted verification started. The dashboard will update as each environment finishes.";
      } else if (action === "verify-live") {
        await api(`/proposals/${id}/verify-live`, {});
        notice = "Live Agent 2 started. Mandatory scripted checks run before its independent browser exploration.";
      } else if (action === "cancel-agent2") {
        await api(`/agent2/${el.dataset.id}/cancel`, {});
        notice = "Agent 2 cancellation requested.";
      } else if (action === "submit")
        selected = await api(`/proposals/${id}/submit`, {});
      await refresh();
    }
  } catch (e) {
    error = e.message;
  }
  busy = false;
  render();
});
render();
refresh().catch((e) => {
  error = e.message;
  render();
});
setInterval(() => {
  if (
    token &&
    (proposals.some(p => runningVerification(p)) ||
      investigations.some((r) => !r.finished_at) ||
      scriptedInvestigations.some((r) => !r.finished_at))
  )
    refresh().catch((e) => {
      error = e.message;
      render();
    });
}, 2500);
