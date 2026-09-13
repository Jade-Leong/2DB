// Presentation only: all workflow permissions remain enforced by the controller.
let mobileWorkspacePane = "inbox";
let inboxReadFilter = "all";
const workspaceMemory = new Map();
// Read markers are browser-local; no ticket content or credentials are stored.
const readTicketIds = new Set();
try {
  const saved = JSON.parse(localStorage.getItem("2db-read-tickets") || "[]");
  if (Array.isArray(saved)) saved.filter(id => typeof id === "string").slice(-1000).forEach(id => readTicketIds.add(id));
} catch {}
function markTicketRead(id) {
  if (!id) return;
  readTicketIds.delete(id);
  readTicketIds.add(id);
  while (readTicketIds.size > 1000) readTicketIds.delete(readTicketIds.values().next().value);
  try { localStorage.setItem("2db-read-tickets", JSON.stringify([...readTicketIds])); } catch {}
}
function ticketStatus(t) {
  const run = investigations.find(r => r.ticket_id === t.id);
  const p = selected?.ticket_id === t.id ? selected : proposals.find(p => p.ticket_id === t.id);
  if (run && !run.finished_at) return {label:"Investigating", tone:"active"};
  if (runningVerification(p)) return {label:"Verifying", tone:"active"};
  if (p?.state === "Rejected") return {label:"Denied", tone:"bad"};
  if (p?.state?.startsWith("Verified")) return {label:"Verified", tone:"good"};
  if (p?.state === "Failed" || /failed/i.test(run?.state || "")) return {label:"Failed", tone:"bad"};
  if (p?.state === "Inconclusive" || /inconclusive|needs information/i.test(run?.state || "")) return {label:"Needs attention", tone:"warning"};
  if (p?.state === "Approved for testing") return {label:"Approved", tone:"good"};
  if (p) return {label:"Needs review", tone:"warning"};
  return {label:run ? stageName(run.state) : "Queued", tone:"neutral"};
}
function ticketMarker(t) {
  const status = ticketStatus(t);
  return `<span class="ticket-marker-row"><span class="ticket-status status-${status.tone}">${status.tone === "active" ? spinner(true) : ""}${esc(status.label)}</span><span class="read-marker ${readTicketIds.has(t.id) ? "is-read" : "is-unread"}" title="Read state is saved in this browser">${readTicketIds.has(t.id) ? "Read" : "● Unread"}</span></span>`;
}
function relativeDate(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function stageName(state) {
  return ({ "Rejected": "Denied", "Model response": "Investigating", "Live Agent 2 running": "Verifying", "Verification running": "Running checks", "Awaiting engineer approval": "Needs review", "Approved for testing": "Ready to verify", "Researching with Tavily": "Researching documentation" })[state] || state || "Not started";
}
function currentApproval(p) {
  return p?.approvals?.find(a => a.id === p.current_approval && !a.invalidated_at && a.revision === p.candidate_revision && a.revision_number === p.revision_number);
}
function runningVerification(p) { return ["Verification running", "Live Agent 2 running"].includes(p?.state); }
function spinner(active) { return `<span class="agent-spinner ${active ? "is-running" : ""}" aria-hidden="true">${active ? "◌" : "·"}</span>`; }
function workspaceView(t) {
  const tickets = allTickets();
  const visibleTickets = inboxReadFilter === "unread" ? tickets.filter(x => !readTicketIds.has(x.id)) : tickets;
  return `<div class="workbench" data-pane="${mobileWorkspacePane}"><div class="mobile-workspace-nav" aria-label="Workspace views"><button class="text" data-action="show-inbox" aria-pressed="${mobileWorkspacePane === "inbox"}">Inbox · ${tickets.length}</button><button class="text" data-action="show-ticket" ${!t ? "disabled" : ""} aria-pressed="${mobileWorkspacePane === "ticket"}">Selected ticket</button></div><div class="review-layout"><aside class="inbox panel" aria-label="Ticket inbox"><div class="inbox-heading"><h2>Ticket inbox</h2><button class="text" data-action="refresh" aria-label="Refresh tickets">↻</button></div><div class="inbox-count"><span>${tickets.filter(x => !readTicketIds.has(x.id)).length} unread</span><span>${tickets.length} tickets</span></div><div class="inbox-filters" role="group" aria-label="Filter tickets"><button class="text" data-action="filter-all" aria-pressed="${inboxReadFilter === "all"}">All</button><button class="text" data-action="filter-unread" aria-pressed="${inboxReadFilter === "unread"}">Unread</button></div><div class="inbox-scroll" data-scroll-key="inbox">${visibleTickets.map(x => `<button class="ticket ${t?.id === x.id ? "chosen" : ""} ${readTicketIds.has(x.id) ? "is-read" : "is-unread"}" data-action="ticket" data-id="${esc(x.id)}" aria-current="${t?.id === x.id ? "true" : "false"}">${ticketMarker(x)}<span class="ticket-person"><span>${esc(x.customer_name)}</span><time title="${esc(date(x.submitted_at))}">${relativeDate(x.submitted_at)}</time></span><strong>${esc(x.subject)}</strong><p>${esc(x.complaint)}</p>${ticketAgentActivity(x)}</button>`).join("") || (inboxReadFilter === 'unread' ? '<p class="empty">All caught up. No unread tickets.</p>' : '<p class="empty">No tickets yet. New customer complaints will appear here.</p>')}</div></aside><div class="detail-column" data-scroll-key="ticket">${t ? ticketView(t) + ticketAgentPanel(t) : '<section class="workspace-empty"><span class="muted">2db / workspace</span><h2>Select a ticket to begin.</h2><p>Investigate, review the change, then verify the result.</p></section>'}</div></div></div>`;
}
function nextAction(t, run, p) {
  const active = run && !run.finished_at;
  const approval = currentApproval(p);
  let heading, message, action;
  if (active) {
    heading = "Agent 1 is working"; message = run.message || stageName(run.state);
    action = `<button class="secondary" data-action="cancel-investigation" data-id="${esc(run.id)}">Cancel investigation</button>`;
  } else if (runningVerification(p)) {
    heading = "Agent 2 is verifying"; message = p.runs?.[0]?.message || stageName(p.state);
    action = p.runs?.[0]?.state === "Live Agent 2 running" ? `<button class="secondary" data-action="cancel-agent2" data-id="${esc(p.runs[0].id)}">Cancel verification</button>` : "";
  } else if (p && ["Awaiting engineer approval", "Proposal ready", "Changes requested"].includes(p.state)) {
    heading = "A change is ready for review"; message = `Review revision ${p.revision_number} before authorizing verification.`;
    action = '<button class="primary" data-action="open-review">Review proposed change →</button>';
  } else if (p && approval && p.state === "Approved for testing") {
    heading = "Ready for independent verification"; message = agent2Status?.state === "Ready" ? `Revision ${p.revision_number} is approved. Agent 2 can now test it.` : "Agent 2 is unavailable. Refresh to check its connection.";
    action = `<button class="primary" data-action="verify-live" ${busy || agent2Status?.state !== "Ready" ? "disabled" : ""}>Start Agent 2 →</button>`;
  } else if (p?.runs?.length) {
    heading = stageName(p.state); message = p.runs[0].message || "Review the verification evidence and remaining issues.";
    action = '<button class="primary" data-action="open-results">Review verification results →</button>';
  } else {
    const other = investigations.some(r => !r.finished_at && r.ticket_id !== t.id);
    heading = run ? stageName(run.state) : "Ready to investigate";
    message = other ? "Agent 1 is working on another ticket." : agentStatus?.state !== "Ready" ? "Agent 1 is unavailable. Refresh to check its connection." : run?.message || "Agent 1 will reproduce this issue and propose a change.";
    action = `<button class="primary" data-action="investigate" data-id="${esc(t.id)}" ${busy || other || agentStatus?.state !== "Ready" ? "disabled" : ""}>${run ? "Retry Agent 1" : "Start Agent 1"} →</button>`;
  }
  return `<section class="next-action"><div><span class="eyebrow">NEXT STEP</span><p class="next-heading">${spinner(active || runningVerification(p))}<strong>${esc(heading)}</strong></p><p class="muted" role="status">${esc(message)}</p></div><div class="actions">${action}</div></section>`;
}
function buildFindings(t, run, p) {
  const report = p?.agentMetadata?.conclusion;
  return `<div class="findings"><div><h3>Observed behavior</h3><p>${run?.evidence?.length ? `${run.evidence.length} browser evidence capture${run.evidence.length === 1 ? "" : "s"} recorded. Open the evidence below to inspect the observations.` : "No browser evidence recorded yet."}</p></div><div><h3>Likely cause <span class="muted">· hypothesis</span></h3><p>${esc(report?.likelyCause || "No cause reported yet.")}</p></div><div><h3>Proposed change</h3><p>${esc(p?.explanation || "No change proposed yet.")}</p></div><div><h3>Remaining uncertainty</h3><p>${esc(report?.uncertainties || "Independent verification has not established a result yet.")}</p></div></div>${report?.sourceReferences?.length ? `<details><summary>Source references</summary>${report.sourceReferences.map(ref => `<p><code>${esc(ref)}</code></p>`).join("")}</details>` : ""}${researchPanel()}${researchCitationsView(p?.agentMetadata?.research)}${agentView(t)}`;
}
function reviewProposal(p) {
  const approval = currentApproval(p), running = runningVerification(p);
  return `<section class="proposal-review"><div class="section-title"><h3>Proposed diff · revision ${p.revision_number}</h3>${badge(stageName(p.state))}</div><p>${esc(p.explanation)}</p><pre class="diff">${p.diff.split("\n").map(line => `<span class="${line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : ""}">${esc(line)}\n</span>`).join("")}</pre><details><summary>Revision & approval details</summary>${hashLabel("CANDIDATE", p.candidate_revision)}${hashLabel("BASELINE", p.base_revision)}${hashLabel("REQUIREMENTS", p.requirements_hash)}${hashLabel("HARNESS", p.harness_hash)}${approval ? `<p>Approved by ${esc(approval.reviewer)} · ${date(approval.created_at)}</p>` : ""}</details><p class="muted">Approval permits testing this exact revision. It does not merge or deploy the change.</p><div class="actions">${["Awaiting engineer approval", "Proposal ready", "Changes requested"].includes(p.state) ? `<button class="primary" data-action="approve" ${busy ? "disabled" : ""}>Approve</button>` : approval ? '<span class="approved-label">✓ Exact revision approved</span>' : ""}<button class="secondary" data-action="reject" ${running || busy || p.state === "Rejected" ? "disabled" : ""}>Deny</button></div></section>`;
}
function verificationFindings(p) {
  if (!p) return '<p class="empty">Waiting for Agent 1’s proposed change. You’ll review and approve it before verification starts.</p>';
  return `${!currentApproval(p) ? '<p class="muted">Review and approve the proposed revision in Agent 1 to enable verification.</p>' : '<p class="approved-label">✓ Revision approved for testing</p>'}${p.runs?.length ? evidenceView(p, p.runs[0]) : '<p class="empty">No verification results yet.</p>'}<details><summary>Technical details · activity history</summary><ol class="timeline">${(p.activity || []).map(e => `<li><strong>${esc(e.event)}</strong><p>${esc(e.details)}</p><small>${esc(e.actor)} · ${date(e.at || e.created_at)}</small></li>`).join("")}</ol></details>`;
}
function disclosureKey(el) {
  if (el.dataset.agentDetail) return el.dataset.agentDetail;
  const parent = el.parentElement.closest('details');
  const label = el.querySelector(':scope > summary')?.textContent.replace(/\([^)]*\)/g, '').trim();
  return `${parent ? disclosureKey(parent) : 'ticket'}/${label}`;
}
// Save by ticket and revision; never persist credentials or notes to browser storage.
function captureWorkspace() {
  if (!root.querySelector('.workbench')) return null;
  const key = root.querySelector('.workbench').dataset.ticketKey || "inbox";
  const details = [...root.querySelectorAll('.detail-column details')].map(el => [disclosureKey(el), el.open]);
  const notes = [...root.querySelectorAll('[data-note-key]')].map(el => [el.dataset.noteKey, el.value]);
  const active = document.activeElement;
  const focus = active?.id ? { id: active.id } : active?.dataset.action ? { action: active.dataset.action, dataId: active.dataset.id } : active?.tagName === 'SUMMARY' ? { summary: disclosureKey(active.parentElement) } : null;
  const state = { details, notes, focus, selection: active?.selectionStart == null ? null : [active.selectionStart, active.selectionEnd], scroll: [...root.querySelectorAll('[data-scroll-key]')].map(el => [el.dataset.scrollKey, el.scrollTop]), y: window.scrollY };
  workspaceMemory.set(key, state);
  return { key, state };
}
function restoreWorkspace(previous, t) {
  const workbench = root.querySelector('.workbench');
  if (!workbench) return;
  const key = `${t?.id || 'inbox'}:${selected?.id || ''}:${selected?.revision_number || ''}`;
  workbench.dataset.ticketKey = key;
  const inboxScroll = previous?.state.scroll.find(([name]) => name === 'inbox')?.[1];
  if (inboxScroll !== undefined) root.querySelector('[data-scroll-key="inbox"]').scrollTop = inboxScroll;
  const state = workspaceMemory.get(key);
  if (!state) return;
  root.querySelectorAll('.detail-column details').forEach((el, i) => { const saved = state.details.find(([key]) => key === disclosureKey(el)); if (saved) el.open = saved[1]; });
  for (const [noteKey, value] of state.notes) {
    const el = [...root.querySelectorAll('[data-note-key]')].find(el => el.dataset.noteKey === noteKey);
    if (el) el.value = value;
  }
  for (const [scrollKey, top] of state.scroll) { const el = root.querySelector(`[data-scroll-key="${scrollKey}"]`); if (el) el.scrollTop = scrollKey === 'inbox' && inboxScroll !== undefined ? inboxScroll : top; }
  if (previous?.key !== key) return;
  const focus = state.focus;
  const el = focus?.id ? document.getElementById(focus.id) : focus?.action ? [...root.querySelectorAll('[data-action]')].find(el => el.dataset.action === focus.action && el.dataset.id === focus.dataId) : focus?.summary ? [...root.querySelectorAll('.detail-column details')].find(el => disclosureKey(el) === focus.summary)?.querySelector(':scope > summary') : null;
  el?.focus({ preventScroll: true });
  if (state.selection && el?.setSelectionRange) el.setSelectionRange(...state.selection);
  window.scrollTo({ top: state.y, behavior: 'instant' });
}
