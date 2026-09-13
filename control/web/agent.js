// Dashboard receives public run summaries and trusted evidence; never worker credentials.
let researchStatus = null;
let agentStatus = null,
  investigations = [],
  investigation = null;
async function refreshAgent() {
  [agentStatus, investigations, researchStatus] = await Promise.all([
    api("/agent/status"),
    api("/investigations"),
    api("/research/status"),
  ]);
  const t = selected?.ticket || ticket;
  const latest = investigations.find((r) => r.ticket_id === t?.id);
  investigation = latest ? await api("/investigations/" + latest.id) : null;
}
function agentView(t) {
  const run = investigation?.ticket_id === t?.id ? investigation : null;
  const running = investigations.some((r) => !r.finished_at);
  return `<section class="panel live-agent"><div class="section-title"><div><span class="eyebrow">AGENT 1 · LIVE INVESTIGATION</span><h2>Reproduce before proposing.</h2></div>${badge(agentStatus?.state || "Checking setup")}</div>
    <p class="muted">The model chooses actions in a fresh thread. Browser evidence gates source edits; your approval gates candidate execution.</p>
    <div class="setup-grid">${["sdk", "authentication", "browser", "isolation"].map((k) => `<div><strong>${esc(k === "sdk" ? "Codex SDK" : k)}</strong>${badge(agentStatus?.[k]?.ready ? "Ready" : "Setup required")}<p class="small muted">${esc(agentStatus?.[k]?.message || "Checking…")}</p></div>`).join("")}</div>
    <p class="small">Setup guide: <code>control/AGENT-1.md</code> · Check with <code>npm.cmd run control:agent:status</code>. Never put an API key in a ticket.</p>
    <div class="actions"><button data-action="investigate" data-id="${esc(t.id)}" ${running || busy || agentStatus?.state !== "Ready" ? "disabled" : ""}>Investigate with Agent 1</button><button class="secondary" data-action="refresh">Recheck setup</button>${run && !run.finished_at ? `<button class="danger" data-action="cancel-investigation" data-id="${esc(run.id)}">Cancel investigation</button>` : ""}</div>
    ${
      run
        ? `<div class="run-message">${badge(run.state)}<p>${esc(run.message)}</p><small>${date(run.started_at)} → ${date(run.finished_at)} · Run ${esc(run.id)}<br>Thread: ${esc(run.thread_id || "Not started")}</small></div>
    ${run.proposal_id ? `<button data-action="proposal" data-id="${esc(run.proposal_id)}">Review agent-generated proposal →</button>` : ""}
    <details ${!run.finished_at ? "open" : ""}><summary>Actual investigation actions</summary><ol class="timeline">${run.events.map((e) => `<li><span class="dot"></span><div><strong>${esc(e.state)}</strong><p>${esc(e.message)}</p>${e.details && e.details.origin !== "tavily-reference" ? `<pre>${esc(JSON.stringify(e.details, null, 2))}</pre>` : ""}<small>${date(e.at)}</small></div></li>`).join("")}</ol></details>
    <details><summary>Trusted browser evidence (${run.evidence.length})</summary>${run.evidence.map((e) => `<p class="small">${date(e.at)} ${e.orderId ? `· Order ${esc(e.orderId)} · displayed ${esc(e.displayedCents)} / order ${esc(e.orderCents)} / payment ${esc(e.paymentCents)} cents` : ""}<br><button class="text" data-artifact="/investigations/${run.id}/evidence/${e.screenshot}">Screenshot</button><button class="text" data-artifact="/investigations/${run.id}/evidence/${e.record}">Observed values and responses</button></p>`).join("")}</details>
    <details><summary>Reported token usage · no estimated dollar cost</summary><pre>${esc(JSON.stringify(run.usage, null, 2))}</pre></details>`
        : ""
    }
    ${
      investigations.filter((r) => r.ticket_id === t.id && r.id !== run?.id)
        .length
        ? `<details><summary>Earlier investigations</summary>${investigations
            .filter((r) => r.ticket_id === t.id && r.id !== run?.id)
            .map(
              (r) =>
                `<p>${esc(r.state)} · ${date(r.started_at)} <button class="text" data-artifact="/investigations/${r.id}">Run record</button></p>`,
            )
            .join("")}</details>`
        : ""
    }
  </section>`;
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
  const check = researchStatus?.lastCheck;
  const records = (investigation?.events || [])
    .filter((e) => e.details?.origin === "tavily-reference")
    .map((e) => e.details);
  return `<section class="panel research-panel"><div class="section-title"><div><span class="eyebrow">POWERED BY TAVILY · SEARCH + EXTRACT</span><h2>From uncertainty to a cited explanation.</h2></div>${badge(check ? (check.verified ? "Connection verified" : "Check failed") : "Not checked")}</div><p>Agent 1 can consult official documentation after reproducing a complaint, then explain how the sources support or challenge its proposed fix.</p><p class="small muted">${esc(researchStatus?.message || "Checking research configuration…")}</p><div class="actions"><button class="secondary" data-action="check-tavily" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Test Tavily connection"}</button><span class="small muted">One public docs search and extraction. No customer data is sent by this check.</span></div>${check ? `<details ${!check.verified ? "open" : ""}><summary>${check.verified ? "Live connection check passed" : "Live connection check did not pass"} · ${date(check.at)}</summary><p class="small muted">${esc(check.purpose)}</p>${researchRecordsView(check.records)}</details>` : ""}${records.length ? `<details open><summary>This investigation's documentation research (${records.length} actions)</summary>${researchRecordsView(records)}</details>` : `<p class="small muted">No documentation research recorded for the selected investigation yet. A connection check does not establish a bug or a fix.</p>`}</section>`;
}
function researchCitationsView(research) {
  if (!research) return "";
  return `<section class="panel research-panel"><span class="eyebrow">TAVILY · CONTRIBUTION TO THIS PROPOSAL</span><h2>Why these sources matter.</h2><p>${esc(research.summary)}</p>${research.citations.map((c) => sourceCard(c, c)).join("")}<p class="small muted">Excerpts are checked against retrieved content. Relevance is the agent's assessment; independent tests determine whether the change works.</p></section>`;
}
