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
  const result = await res.json();
  if (!res.ok) {
    if (res.status === 401 && url !== "/login") {
      token = "";
      sessionStorage.removeItem("2db-engineer-session");
    }
    throw new Error(result.error);
  }
  return result;
}
async function refresh() {
  if (!token) return;
  [inbox, imported, proposals, testSummary] = await Promise.all([
    api("/inbox"),
    api("/tickets"),
    api("/proposals"),
    api("/test-summary"),
  ]);
  if (selected) selected = await api(`/proposals/${selected.id}`);
  await refreshAgent();
  render();
}
function statusClass(s) {
  return /Verified|passed/.test(s)
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
  const p = selected,
    t = p?.ticket || ticket;
  root.innerHTML = `<div class="shell"><aside class="sidebar"><a class="logo" href="/">2<span>DB</span><i>LOCAL</i></a><p class="tagline">Two agents.<br>One reproducible bug.</p><div class="nav-label">ENGINEER WORKSPACE</div><button class="nav active" data-action="home">▤ &nbsp; Complaint review <span>${allTickets().length}</span></button><div class="sidebar-bottom"><div class="connection"><i></i> Local environment</div><p>Human approval required.<br>Every revision. Every test run.</p><a href="http://127.0.0.1:5173" target="_blank" rel="noreferrer">Open Loop Market ↗</a></div></aside><div class="workspace"><header><div><span class="breadcrumb">2DB / ENGINEER REVIEW</span><h1>From complaint to confidence.</h1></div><div class="engineer">${token ? '<span class="avatar">E</span><span>Local engineer<small>Demo review session</small></span><button class="text" data-action="logout">Sign out</button>' : '<span class="badge neutral">Engineer session required</span>'}</div></header><div class="notice-bar"><span>◈</span> Local change proposals · Scripted verification · Human decisions</div>${error ? `<div class="alert error" role="alert">${esc(error)}</div>` : ""}${notice ? `<div class="alert" role="status">${esc(notice)}</div>` : ""}
${
  !token
    ? `<section class="login panel"><span class="eyebrow">LOCAL ENGINEER ACCESS</span><h2>Your approval is the gate.</h2><p>Start a separate engineer session to review complaints and approve exact revisions for testing.</p><form id="login"><label>Local engineer key<input name="key" type="password" autocomplete="off" required></label><button ${busy ? "disabled" : ""}>Open engineer session →</button></form><p class="muted small">Run <code>npm.cmd run control:engineer</code> in a separate PowerShell window to get your key. Marketplace accounts cannot approve proposals. This is a local demo mechanism, not production authentication.</p></section>`
    : `<div class="review-layout"><section class="inbox panel"><div class="section-title"><h2>Ticket inbox</h2><button class="text" data-action="refresh">Refresh ↻</button></div><p class="small muted">Real Loop Market complaints. Imported read-only.</p>${
        allTickets().length
          ? allTickets()
              .map(
                (x) =>
                  `<button class="ticket ${t?.id === x.id ? "chosen" : ""}" data-action="ticket" data-id="${esc(x.id)}"><span class="ticket-person">${esc(x.customer_name)} <span>${x.imported ? "IMPORTED" : "NEW"}</span></span><strong>${esc(x.subject)}</strong><p>${esc(x.complaint)}</p><small>${date(x.submitted_at)}</small></button>`,
              )
              .join("")
          : '<div class="empty small">No submitted complaints yet.<br><br>Open Loop Market → Support, submit a complaint, then refresh this inbox.</div>'
      }<div class="section-title proposals-title"><h2>Local proposals</h2><span>${proposals.length}</span></div>${proposals.map((x) => `<button class="proposal-link ${p?.id === x.id ? "chosen" : ""}" data-action="proposal" data-id="${x.id}"><strong>${x.kind === "agent-generated" ? "Agent-generated proposal" : x.kind === "discount-fix" ? "Discount sample fix" : "Unchanged negative control"}</strong><small>${esc(x.customer_name)} · ${short(x.candidate_revision)}</small>${badge(x.state)}</button>`).join("") || '<p class="muted small">Choose a ticket to create a developer-authored sample proposal.</p>'}</section><div class="detail-column">${researchPanel()}${t ? ticketView(t) + agentView(t) : welcome()}${p ? proposalView(p) : t ? `<section class="panel"><span class="eyebrow">DEVELOPER-AUTHORED DEMO AREA</span><h2>Create a local change proposal</h2><p class="muted">These developer-authored fixtures are separate demonstrations. A failed live investigation never falls back to a fixture.</p><div class="actions"><button data-action="create" data-kind="discount-fix" data-id="${esc(t.id)}">Use discount sample fix</button><button class="secondary" data-action="create" data-kind="unchanged" data-id="${esc(t.id)}">Use unchanged negative control</button></div></section>` : ""}<div class="agent-grid"><section class="panel agent"><span class="agent-number">01</span><h3>Agent 1 — Investigation and proposed fix</h3><p>${agentStatus?.state === "Ready" ? "Live worker ready." : "Setup required for live investigation."}</p><small>Live investigation requires the configured isolated worker. Fixtures remain in the separate demo area.</small></section><section class="panel agent"><span class="agent-number">02</span><h3>Agent 2 — Independent verification</h3><p>Live agent not connected — scripted verification available.</p><small>Independent execution still requires engineer approval.</small></section></div>${testSummary ? `<details class="panel"><summary>Controller automated demonstration · explicit test-engineer session</summary><p class="muted small">Separate test tickets and controller data. These test approvals do not approve any dashboard proposal.</p><pre>${esc(JSON.stringify(testSummary, null, 2))}</pre></details>` : ""}</div></div>`
}<footer>2DB · Local milestone 3 <span>Agent 1 gated by isolation · No live Agent 2 · No GitHub or deployment</span></footer></div></div>`;
  const brand = root.querySelector(".logo");
  brand.innerHTML = '<img src="/logo-reference.png" alt="2DB — Find it. Verify it."><i>LOCAL</i>';
}
function welcome() {
  return `<section class="panel welcome"><span class="eyebrow">REPRODUCE. REVIEW. VERIFY.</span><h2>One complaint.<br>A clear chain of evidence.</h2><p>Choose a submitted ticket to review its original words, inspect a real source diff, and approve an exact revision for local testing.</p><div class="steps"><span>1 &nbsp; Review proposal</span><span>2 &nbsp; Approve revision</span><span>3 &nbsp; Compare evidence</span></div></section>`;
}
function ticketView(t) {
  return `<section class="panel"><div class="section-title"><span class="eyebrow">ORIGINAL CUSTOMER COMPLAINT</span><span class="small muted">${date(t.submitted_at)}</span></div><h2>${esc(t.subject)}</h2><blockquote>${esc(t.complaint)}</blockquote><div class="ticket-meta"><span>${esc(t.customer_name)} · ${esc(t.customer_role)}<small>Customer ID: ${esc(t.customer_id)}</small></span><span>Ticket reference<small>${esc(t.id)}</small></span></div><p class="small muted">Related record: ${t.related_reference ? esc(t.related_reference) : "not provided by the existing ticket schema"}. Original complaint preserved without a diagnosis.</p></section>`;
}
function proposalView(p) {
  const latest = p.runs[0],
    approval = p.approvals.find((a) => a.id === p.current_approval),
    waiting = p.state === "Awaiting engineer approval",
    running = p.state === "Verification running";
  return `<section class="panel"><div class="section-title"><div><span class="eyebrow">LOCAL CHANGE PROPOSAL</span><h2>${p.kind === "agent-generated" ? "Agent-generated proposed fix" : p.kind === "discount-fix" ? "Discount payment correction" : "Unchanged negative control"}</h2></div>${badge(p.state)}</div><div class="author-label">${esc(p.author)} · Revision ${p.revision_number}</div><p>${esc(p.explanation)}</p>${p.agentMetadata ? `<details><summary>Agent explanation, source references, and uncertainties</summary><p><strong>Expected behavior:</strong> ${esc(p.agentMetadata.expected)}</p><pre>${esc(JSON.stringify(p.agentMetadata.conclusion, null, 2))}</pre><p class="small muted">Agent explanation is not proof of correctness. Trusted reproduction evidence is available in the investigation panel above.</p></details>` : ""}<div class="hash-grid">${hashLabel("BASE SNAPSHOT · SHA-256", p.base_revision)}${hashLabel("CANDIDATE SNAPSHOT · SHA-256", p.candidate_revision)}</div><details class="technical"><summary>Frozen requirements and harness identity</summary>${hashLabel("REQUIREMENTS", p.requirements_hash)}${hashLabel("TRUSTED HARNESS", p.harness_hash)}</details><div class="diff-title"><span>Source diff</span><span>${p.kind === "agent-generated" ? "Controller-computed source diff" : "Reviewed developer fixture"}</span></div><pre class="diff">${p.diff
    .split("\n")
    .map(
      (line) =>
        `<span class="${line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : ""}">${esc(line)}\n</span>`,
    )
    .join(
      "",
    )}</pre><details ${p.kind === "agent-generated" ? "hidden" : ""}><summary>Reproduction workflow</summary><p>Use Maya, add the $48 knit to the bag, enter LOOP20, then inspect the receipt and the server-recorded payment. Do not rely on the independently broken order-history page.</p><p class="small muted">${latest ? "Measured evidence appears below." : "No measured reproduction evidence yet. Approval allows the scripted baseline and candidate runs to gather it."}</p></details><div class="revision-tools" ${p.kind === "agent-generated" ? "hidden" : ""}><label>Choose another reviewed fixture<select id="fixture" ${running ? "disabled" : ""}><option value="discount-fix" ${p.kind === "discount-fix" ? "selected" : ""}>Developer-authored discount fix</option><option value="unchanged" ${p.kind === "unchanged" ? "selected" : ""}>Unchanged negative control</option></select></label><button class="secondary" data-action="revision" ${running ? "disabled" : ""}>Replace candidate revision</button></div><p class="small muted">Changing the candidate invalidates approval and previous evidence for this proposal.</p></section><section class="panel gate"><span class="eyebrow">HUMAN APPROVAL GATE</span><h2>Your revision. Your decision.</h2><p class="muted">Testing permission is recorded against the full candidate hash above. It is not permission to merge or deploy.</p>${approval ? `<div class="approval-record">Approved by ${esc(approval.reviewer)} · ${date(approval.created_at)}<code>${esc(approval.revision)}</code></div>` : ""}<div class="actions">${["Proposal ready", "Changes requested"].includes(p.state) ? '<button data-action="submit">Submit revision for engineer approval</button>' : ""}<button data-action="approve" ${!waiting || busy ? "disabled" : ""}>Approve this revision for testing</button><button class="secondary" data-action="changes" ${running ? "disabled" : ""}>Request changes</button><button class="danger" data-action="reject" ${running ? "disabled" : ""}>Reject proposal</button></div><label class="review-note">Review note (optional)<textarea id="review-note" rows="2" maxlength="2000" placeholder="Explain a change request or rejection."></textarea></label><div class="verify-row"><div><strong>Baseline → Approved candidate</strong><p class="small muted">Serial builds and tests. Separate disposable copies and databases.</p></div><button data-action="verify" ${!approval || running || busy ? "disabled" : ""}>${running ? "Verification running…" : "Run scripted verification →"}</button></div><p class="small muted">Stop Loop Market with Ctrl+C before verification. Port 3001 must be free; 2DB remains running on its own port.</p></section>${researchCitationsView(p.agentMetadata?.research)}${evidenceView(p, latest)}<section class="panel"><div class="section-title"><h2>Activity history</h2><span class="small muted">Persisted timestamps</span></div><ol class="timeline">${p.activity.map((e) => `<li><span class="dot"></span><div><strong>${esc(e.event)}</strong><p>${esc(e.details)}</p><small>${esc(e.actor)} · ${date(e.created_at)}</small></div></li>`).join("")}</ol></section>`;
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
  return `<section class="panel"><div class="section-title"><div><span class="eyebrow">SCRIPTED VERIFICATION</span><h2>Evidence, side by side.</h2></div>${run ? badge(current ? run.state : "Stale evidence — approval or revision changed") : badge("Not run")}</div>${run ? `<p class="run-message">${esc(current ? run.message || "Executing the trusted Playwright harness…" : "This evidence is archived and cannot verify the current revision.")}</p><p class="small muted">Run ${esc(run.id)}<br>${date(run.started_at)} → ${date(run.finished_at)}</p>` : '<p class="muted">Approval is required before independent candidate verification can start.</p>'}<div class="table-scroll"><table><thead><tr><th>Required check</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>${p.requirements
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
    if (action === "logout") {
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
      selected = null;
      ticket = allTickets().find((t) => t.id === el.dataset.id);
      await refreshAgent();
    } else if (action === "proposal") {
      selected = await api("/proposals/" + el.dataset.id);
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
    } else if (action === "cancel-investigation") {
      investigation = await api(
        "/investigations/" + el.dataset.id + "/cancel",
        {},
      );
      await refresh();
    } else if (selected) {
      const id = selected.id;
      if (action === "revision")
        selected = await api(`/proposals/${id}/revision`, {
          kind: document.getElementById("fixture").value,
        });
      else if (action === "approve")
        selected = await api(`/proposals/${id}/approve`, {
          revision: selected.candidate_revision,
          revisionNumber: selected.revision_number,
        });
      else if (["changes", "reject"].includes(action))
        selected = await api(`/proposals/${id}/${action}`, {
          note: document.getElementById("review-note").value,
        });
      else if (action === "verify") {
        await api(`/proposals/${id}/verify`, {});
        notice =
          "Scripted verification started. The dashboard will update as each environment finishes.";
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
    (selected?.state === "Verification running" ||
      investigations.some((r) => !r.finished_at))
  )
    refresh().catch((e) => {
      error = e.message;
      render();
    });
}, 2500);
