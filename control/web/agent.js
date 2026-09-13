// Dashboard receives public run summaries and trusted evidence; never worker credentials.
let researchStatus = null;
let agentStatus = null,
  agent2Status = null,
  investigations = [],
  investigation = null,
  scriptedInvestigations = [],
  scriptedInvestigation = null;
async function refreshAgent() {
  const target = selected?.ticket_id || ticket?.id, session = token;
  const values = await Promise.all([api("/agent/status"), api("/agent2/status"), api("/investigations"), api("/scripted-investigations"), api("/research/status")]);
  const latest = values[2].find(r => r.ticket_id === target);
  const detail = latest ? await api("/investigations/" + latest.id) : null;
  if (token !== session || (selected?.ticket_id || ticket?.id) !== target) return;
  [agentStatus, agent2Status, investigations, scriptedInvestigations, researchStatus] = values;
  investigation = detail;
  scriptedInvestigation = scriptedInvestigations.find(r => r.ticket_id === target) || null;
}
function agentView(t) {
  const run = investigation?.ticket_id === t.id ? investigation : null;
  if (!run) return "";
  return `<details><summary>Browser evidence (${run.evidence?.length || 0})</summary>${(run.evidence || []).map(e => `<p>${date(e.at)}</p><div class="actions"><button class="text" data-artifact="/investigations/${esc(run.id)}/evidence/${esc(e.screenshot)}">Screenshot ↗</button><button class="text" data-artifact="/investigations/${esc(run.id)}/evidence/${esc(e.record)}">Observed values ↗</button></div>`).join("") || '<p>No browser captures yet.</p>'}</details><details><summary>Technical details · events & logs</summary><p>Run ${esc(run.id)} · ${date(run.started_at)}</p><ol class="timeline">${(run.events || []).map(e => `<li><strong>${esc(stageName(e.state))}</strong><p>${esc(e.message)}</p><small>${date(e.at)}</small>${e.details && e.details.origin !== "tavily-reference" ? `<pre>${esc(JSON.stringify(e.details, null, 2))}</pre>` : ""}</li>`).join("")}</ol><details><summary>Token usage</summary><pre>${esc(JSON.stringify(run.usage, null, 2))}</pre></details><button class="text" data-artifact="/investigations/${esc(run.id)}">Download run record</button></details>`;
}

function sourceCard(source, citation = null) {
  let url;
  try {
    url = new URL(source.url);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "";
  return `<article class="research-source"><div class="section-title"><span class="eyebrow">${esc(source.id)} · ${source.stage === "extract" ? "EXTRACTED DOCUMENTATION" : "SEARCH RESULT"}</span>${citation ? badge(citation.relationship) : ""}</div><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a><p class="small muted">${esc(url.hostname)}</p>${citation ? `<blockquote>${esc(citation.quote)}</blockquote><p><strong>Agent assessment:</strong> ${esc(citation.relevance)}</p>` : `<details><summary>Read retrieved excerpt</summary><p class="research-excerpt">${esc(source.content)}</p></details>`}</article>`;
}
function researchRecordsView(records) {
  return records
    .map(
      (r) =>
        `<div class="research-request"><p><strong>${r.action === "search_docs" ? "Tavily Search" : "Tavily Extract"}</strong> · ${esc(r.topic)} ${r.cached ? "· reused within this run" : ""}</p><p>${esc(r.query)}</p><p class="small muted">${date(r.at)} · ${(r.durationMs / 1000).toFixed(1)}s · ${r.credits === null ? "Usage not reported" : `${esc(r.credits)} reported credits`}</p>${r.error ? `<p class="research-error">${esc(r.error)}</p>` : ""}${r.sources.map((s) => sourceCard(s)).join("")}</div>`,
    )
    .join("");
}
function researchPanel() {
  const records = (investigation?.events || [])
    .filter((e) => e.details?.origin === "tavily-reference")
    .map((e) => e.details);
  if (!records.length) return "";
  return `<details class="research-panel"><summary>Research findings (${records.length})</summary>${researchRecordsView(records)}</details>`;
}
function researchCitationsView(research) {
  if (!research) return "";
  return `<section class="panel research-panel"><span class="eyebrow">TAVILY · CONTRIBUTION TO THIS PROPOSAL</span><h2>Why these sources matter.</h2><p>${esc(research.summary)}</p>${research.citations.map((c) => sourceCard(c, c)).join("")}<p class="small muted">Excerpts are checked against retrieved content. Relevance is the agent's assessment; independent tests determine whether the change works.</p></section>`;
}

function ticketAgentActivity(t) {
  const first = investigations.find((run) => run.ticket_id === t.id);
  const proposal = selected?.ticket_id === t.id ? selected : proposals.find((p) => p.ticket_id === t.id);
  const secondRunning = ["Verification running", "Live Agent 2 running"].includes(proposal?.state);
  const states = [
    { name: "agent 1", active: Boolean(first && !first.finished_at), state: first?.state || "Not started" },
    { name: "agent 2", active: secondRunning, state: secondRunning ? proposal.state : proposal?.runs?.[0]?.state || proposal?.state || "Not started" },
  ];
  return `<span class="ticket-agents" aria-label="Ticket agent activity">${states.map((agent) => `<span class="ticket-agent"><span class="agent-spinner ${agent.active ? "is-running" : ""}" aria-hidden="true">${agent.active ? "◌" : "·"}</span><span>${agent.name} <span class="muted">${esc(stageName(agent.state))}</span></span></span>`).join("")}</span>`;
}

function ticketAgentPanel(t) {
  const run = investigation?.ticket_id === t.id ? investigation : null;
  const p = selected?.ticket_id === t.id ? selected : null;
  const active = Boolean(run && !run.finished_at), verifying = runningVerification(p);
  return `${nextAction(t, run, p)}<section class="ticket-agent-controls" aria-label="Agents for selected ticket"><details class="agent-disclosure" data-agent-detail="build"><summary>${spinner(active)}<span class="agent-summary"><span class="agent-summary-title"><strong>Agent 1 · Build</strong>${badge(stageName(run?.state || (p ? "Proposal ready" : "Not started")))}</span><span class="agent-summary-message">${esc(run?.message || "Reproduce the issue and propose a change.")}</span></span><span class="disclosure-arrow" aria-hidden="true">›</span></summary><div class="agent-body">${buildFindings(t, run, p)}${p ? reviewProposal(p) : ""}</div></details><details class="agent-disclosure" data-agent-detail="verify"><summary>${spinner(verifying)}<span class="agent-summary"><span class="agent-summary-title"><strong>Agent 2 · Verify</strong>${badge(stageName(p?.runs?.[0]?.state || (currentApproval(p) ? "Ready to verify" : "Waiting for approval")))}</span><span class="agent-summary-message">${esc(p?.runs?.[0]?.message || "Independent checks start after you approve the revision.")}</span></span><span class="disclosure-arrow" aria-hidden="true">›</span></summary><div class="agent-body">${verificationFindings(p)}</div></details></section>`;
}
